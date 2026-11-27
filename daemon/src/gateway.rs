use anyhow::{bail, Context, Result};
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    Router,
};
use hyper_util::{
    client::legacy::{connect::HttpConnector, Client},
    rt::TokioExecutor,
};
use std::{
    ffi::OsString,
    future::IntoFuture,
    io::{BufRead, BufReader, Read},
    net::SocketAddr,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tokio::sync::watch;
use uuid::Uuid;

const INTERNAL_HEADER: &str = "x-axiom-gateway-secret";

#[derive(Clone)]
struct Gateway {
    client: Client<HttpConnector, Body>,
    upstream: SocketAddr,
    port: u16,
    secret: HeaderValue,
}

fn failure(status: StatusCode, message: &'static str) -> Response {
    (status, axum::Json(serde_json::json!({"error":message}))).into_response()
}

fn strip_hop_headers(headers: &mut HeaderMap) {
    // Connection can nominate additional hop-by-hop headers.
    let names: Vec<_> = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|name| header::HeaderName::from_bytes(name.trim().as_bytes()).ok())
        .collect();
    for name in names {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}

async fn proxy(State(gateway): State<Gateway>, mut req: Request) -> Response {
    let expected = format!("127.0.0.1:{}", gateway.port);
    let localhost = format!("localhost:{}", gateway.port);
    let host = match req.headers().get(header::HOST) {
        Some(host) if host == expected.as_str() || host == localhost.as_str() => host.clone(),
        _ => return failure(StatusCode::FORBIDDEN, "Invalid host"),
    };
    if req.uri().authority().is_some() || !req.uri().path().starts_with('/') {
        return failure(StatusCode::BAD_REQUEST, "Invalid request target");
    }
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    let uri: Uri = match format!("http://{}{path}", gateway.upstream).parse() {
        Ok(uri) => uri,
        Err(_) => return failure(StatusCode::BAD_REQUEST, "Invalid request target"),
    };
    *req.uri_mut() = uri;
    strip_hop_headers(req.headers_mut());
    req.headers_mut().insert(header::HOST, host);
    req.headers_mut()
        .insert(INTERNAL_HEADER, gateway.secret.clone());
    match gateway.client.request(req).await {
        Ok(response) => {
            let (mut parts, body) = response.into_parts();
            strip_hop_headers(&mut parts.headers);
            Response::from_parts(parts, Body::new(body))
        }
        Err(_) => failure(StatusCode::BAD_GATEWAY, "Internal host unavailable"),
    }
}

struct Host(Child);
impl Drop for Host {
    fn drop(&mut self) {
        drop(self.0.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if matches!(self.0.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub async fn run(args: &[OsString]) -> Result<()> {
    if args.len() != 2 {
        bail!("Usage: axiom-daemon --gateway <node> <server.mjs>");
    }
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await?;
    let port = listener.local_addr()?.port();
    let secret = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let mut command = Command::new(&args[0]);
    command
        .arg(&args[1])
        .env("AXIOM_DESKTOP", "1")
        .env("AXIOM_GATEWAY_PORT", port.to_string())
        .env("AXIOM_GATEWAY_SECRET", &secret)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut host = Host(command.spawn().context("Start private Node host")?);
    let stdout = host.0.stdout.take().context("Private host stdout")?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Some(port) = line
                .strip_prefix("AXIOM_READY ")
                .and_then(|p| p.parse::<u16>().ok())
            {
                let _ = tx.send(port);
            } else {
                eprintln!("{line}");
            }
        }
    });
    let upstream_port =
        tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(20))).await??;
    if upstream_port == 0 || upstream_port == port {
        bail!("Invalid private host port");
    }
    let gateway = Gateway {
        client: Client::builder(TokioExecutor::new()).build_http(),
        upstream: SocketAddr::from(([127, 0, 0, 1], upstream_port)),
        port,
        secret: HeaderValue::from_str(&secret)?,
    };
    let (stop, mut stop_rx) = watch::channel(false);
    thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        let mut byte = [0u8; 1];
        while matches!(stdin.read(&mut byte), Ok(1)) {}
        stop.send_replace(true);
    });
    let router = Router::new().fallback(proxy).with_state(gateway);
    println!("AXIOM_READY {port}");
    let serve = axum::serve(listener, router).into_future();
    tokio::pin!(serve);
    let mut poll = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            result=&mut serve=>{result?;break;}
            _=stop_rx.wait_for(|v|*v)=>break,
            _=tokio::signal::ctrl_c()=>break,
            _=poll.tick()=>{if let Some(status)=host.0.try_wait()?{bail!("Private host exited: {status}");}}
        }
    }
    // Drop the public server first; terminating the private host closes its
    // streams and Pi foreground client. Background jobs remain independent.
    drop(host);
    Ok(())
}
