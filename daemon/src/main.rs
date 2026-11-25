//! First migration slice: the native terminal HTTP contract.
//! The existing Node runtime remains authoritative until parity gates pass.
mod gateway;
mod history;
use history::History;
#[cfg(windows)]
mod process_tree;
#[cfg(unix)]
mod unix_pty;
use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
#[cfg(windows)]
use process_tree::ProcessTree;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    convert::Infallible,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tokio::sync::{broadcast, watch};
use uuid::Uuid;

const MAX_TERMINALS: usize = 8;

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    id: String,
    buffer: History,
    exit: Option<u32>,
    #[serde(default)]
    interrupted: bool,
}

struct Terminal {
    record: Mutex<Record>,
    events: broadcast::Sender<Value>,
    live: Mutex<Option<Live>>,
    dirty: Arc<AtomicBool>,
}

struct Live {
    #[cfg(windows)]
    _tree: ProcessTree,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    input: mpsc::SyncSender<Vec<u8>>,
}

struct Store {
    terminals: Mutex<BTreeMap<String, Arc<Terminal>>>,
    workspace: PathBuf,
    archive: PathBuf,
    dirty: Arc<AtomicBool>,
    persist_lock: Mutex<()>,
    stopping: AtomicBool,
    _lock: File,
}

impl Terminal {
    fn new(record: Record, dirty: Arc<AtomicBool>) -> Self {
        let (events, _) = broadcast::channel(128);
        Self {
            record: Mutex::new(record),
            events,
            live: Mutex::new(None),
            dirty,
        }
    }

    fn append(&self, text: &str) {
        if text.is_empty() {
            return;
        }
        let mut record = self.record.lock().unwrap();
        record.buffer.append(text);
        self.dirty.store(true, Ordering::Release);
        let _ = self.events.send(json!({"data":text}));
    }

    fn stop(&self, interrupted: bool) {
        let handles = self.live.lock().unwrap().take();
        if let Some(mut handles) = handles {
            if interrupted {
                self.record.lock().unwrap().interrupted = true;
                self.dirty.store(true, Ordering::Release);
            }
            let _ = handles.killer.kill();
        }
    }

    fn finish(&self, code: u32) {
        let mut record = self.record.lock().unwrap();
        record.exit = Some(code);
        self.dirty.store(true, Ordering::Release);
        let _ = self.events.send(json!({"exit":code}));
        drop(record);
        let handles = self.live.lock().unwrap().take();
        drop(handles);
    }
}

impl Store {
    fn open(workspace: PathBuf, archive: PathBuf, import_legacy: bool) -> Result<Self> {
        fs::create_dir_all(&workspace)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(archive.with_extension("lock"))?;
        lock.try_lock()
            .context("Terminal state is already owned by another daemon")?;
        let dirty = Arc::new(AtomicBool::new(false));
        let mut terminals = BTreeMap::new();
        // The Rust archive always takes precedence, even if it is empty.
        // Import is explicit and never mutates the legacy archive.
        let source = match fs::read(&archive) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && import_legacy => {
                let path = archive.with_file_name("terminals.json");
                match fs::read(path) {
                    Ok(bytes) => {
                        dirty.store(true, Ordering::Release);
                        Ok(bytes)
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        dirty.store(true, Ordering::Release);
                        Ok(b"[]".to_vec())
                    }
                    Err(e) => Err(e),
                }
            }
            other => other,
        };
        match source {
            Ok(bytes) => {
                let records: Vec<Record> = serde_json::from_slice(&bytes)?;
                for mut record in records {
                    if Uuid::parse_str(&record.id).is_err() || terminals.contains_key(&record.id) {
                        bail!("Invalid or duplicate terminal id in archive");
                    }
                    if record.exit.is_none() {
                        record.interrupted = true;
                        dirty.store(true, Ordering::Release);
                    }
                    terminals.insert(
                        record.id.clone(),
                        Arc::new(Terminal::new(record, dirty.clone())),
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let store = Self {
            terminals: Mutex::new(terminals),
            workspace,
            archive,
            dirty,
            persist_lock: Mutex::new(()),
            stopping: AtomicBool::new(false),
            _lock: lock,
        };
        if import_legacy {
            store.persist()?;
        }
        Ok(store)
    }

    fn persist(&self) -> Result<()> {
        let _guard = self.persist_lock.lock().unwrap();
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return Ok(());
        }
        let result = self.write_snapshot();
        if result.is_err() {
            self.dirty.store(true, Ordering::Release);
        }
        result
    }
    fn write_snapshot(&self) -> Result<()> {
        let terminals = self.terminals.lock().unwrap();
        let records: Vec<_> = terminals
            .values()
            .map(|t| t.record.lock().unwrap().clone())
            .collect();
        let mut tmp =
            tempfile::NamedTempFile::new_in(self.archive.parent().context("archive parent")?)?;
        serde_json::to_writer(tmp.as_file_mut(), &records)?;
        tmp.as_file_mut().sync_all()?;
        tmp.persist(&self.archive)?;
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Arc<Terminal>> {
        self.terminals
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .context("Unknown terminal")
    }

    fn create(&self) -> Result<String> {
        let mut terminals = self.terminals.lock().unwrap();
        if self.stopping.load(Ordering::Acquire) {
            bail!("Runtime is stopping");
        }
        if terminals.len() >= MAX_TERMINALS {
            bail!("Close unused terminals before opening another");
        }
        let shell = shell()?;
        let pair = native_pty_system().openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        #[cfg(windows)]
        let mut command = {
            let mut cmd = CommandBuilder::new(shell);
            cmd.args(["-NoLogo", "-NoProfile"]);
            cmd
        };
        #[cfg(unix)]
        let mut command = {
            let mut cmd = CommandBuilder::new(std::env::current_exe()?);
            cmd.arg("--pty-shell");
            cmd.arg(std::process::id().to_string());
            cmd.arg(shell);
            cmd
        };
        command.cwd(&self.workspace);
        command.env("TERM", "xterm-256color");
        let reader = pair.master.try_clone_reader()?;
        let mut writer = pair.master.take_writer()?;
        let mut child = pair.slave.spawn_command(command)?;
        drop(pair.slave);
        #[cfg(windows)]
        let tree = match ProcessTree::attach(child.as_ref()) {
            Ok(tree) => tree,
            Err(e) => {
                let _ = child.kill();
                return Err(e);
            }
        };
        let killer = child.clone_killer();
        let (input, rx) = mpsc::sync_channel::<Vec<u8>>(32);
        let id = Uuid::new_v4().to_string();
        let terminal = Arc::new(Terminal::new(
            Record {
                id: id.clone(),
                buffer: History::default(),
                exit: None,
                interrupted: false,
            },
            self.dirty.clone(),
        ));
        *terminal.live.lock().unwrap() = Some(Live {
            master: pair.master,
            killer,
            #[cfg(windows)]
            _tree: tree,
            input,
        });
        terminals.insert(id.clone(), terminal.clone());
        self.dirty.store(true, Ordering::Release);
        drop(terminals);

        let output = terminal.clone();
        thread::spawn(move || read_output(reader, output));
        thread::spawn(move || {
            for bytes in rx {
                if writer
                    .write_all(&bytes)
                    .and_then(|_| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        thread::spawn(move || terminal.finish(child.wait().map(|s| s.exit_code()).unwrap_or(1)));
        self.persist()?;
        Ok(id)
    }

    fn action(&self, action: &str, value: Value) -> Result<Value> {
        if action == "create" {
            return Ok(json!({"id":self.create()?}));
        }
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .context("Terminal id required")?;
        let terminal = self.get(id)?;
        if action == "close" {
            self.terminals.lock().unwrap().remove(id);
            self.dirty.store(true, Ordering::Release);
            terminal.stop(false);
            let _ = terminal.events.send(json!({"closed":true}));
            self.persist()?;
            return Ok(json!({"ok":true}));
        }
        if action == "terminate" {
            terminal.stop(false);
            return Ok(json!({"ok":true}));
        }
        let live = terminal.live.lock().unwrap();
        let handles = live.as_ref().context("Terminal is archived or exited")?;
        match action {
            "input" => {
                let data = value
                    .get("data")
                    .and_then(Value::as_str)
                    .context("Invalid terminal input")?;
                if data.encode_utf16().count() > 65536 {
                    bail!("Invalid terminal input");
                }
                handles
                    .input
                    .try_send(data.as_bytes().to_vec())
                    .context("Terminal input queue unavailable")?;
            }
            "resize" => {
                let cols = value
                    .get("cols")
                    .and_then(Value::as_u64)
                    .context("Invalid terminal dimensions")?;
                let rows = value
                    .get("rows")
                    .and_then(Value::as_u64)
                    .context("Invalid terminal dimensions")?;
                if !(2..=500).contains(&cols) || !(2..=200).contains(&rows) {
                    bail!("Invalid terminal dimensions");
                }
                handles.master.resize(PtySize {
                    rows: rows as u16,
                    cols: cols as u16,
                    pixel_width: 0,
                    pixel_height: 0,
                })?;
            }
            _ => bail!("Unknown terminal action"),
        }
        Ok(json!({"ok":true}))
    }

    fn shutdown(&self) -> Result<()> {
        self.stopping.store(true, Ordering::Release);
        for terminal in self.terminals.lock().unwrap().values() {
            terminal.stop(true);
        }
        self.persist()
    }
}

fn read_output(mut reader: Box<dyn Read + Send>, terminal: Arc<Terminal>) {
    let mut block = [0u8; 8192];
    let mut pending = Vec::new();
    // portable-pty requests cursor inheritance on Windows. Our new terminal
    // always begins at row 1, column 1, so answer only this initial query on
    // the wire instead of persisting it into the replay log.
    let mut initial_cursor = cfg!(windows);
    const QUERY: &[u8] = b"\x1b[6n";
    loop {
        let n = match reader.read(&mut block) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        pending.extend_from_slice(&block[..n]);
        if initial_cursor {
            if pending.len() < QUERY.len() && QUERY.starts_with(&pending) {
                continue;
            }
            initial_cursor = false;
            if pending.starts_with(QUERY) {
                let answered = terminal
                    .live
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|h| h.input.try_send(b"\x1b[1;1R".to_vec()).is_ok());
                if answered {
                    pending.drain(..QUERY.len());
                }
            }
        }
        // Preserve an incomplete UTF-8 code point across transport reads.
        loop {
            match std::str::from_utf8(&pending) {
                Ok(text) => {
                    terminal.append(text);
                    pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    if valid > 0 {
                        terminal.append(std::str::from_utf8(&pending[..valid]).unwrap());
                        pending.drain(..valid);
                    }
                    match error.error_len() {
                        Some(n) => {
                            terminal.append("\u{fffd}");
                            pending.drain(..n);
                        }
                        None => break,
                    }
                }
            }
        }
    }
    if !pending.is_empty() {
        terminal.append(&String::from_utf8_lossy(&pending));
    }
}

fn shell() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("AXIOM_PWSH_EXE") {
        return Ok(path.into());
    }
    #[cfg(windows)]
    {
        let base = std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:/Program Files".into());
        let path = PathBuf::from(base).join("PowerShell/7/pwsh.exe");
        if !path.is_file() {
            bail!("PowerShell 7 executable not found; set AXIOM_PWSH_EXE");
        }
        Ok(path)
    }
    #[cfg(not(windows))]
    {
        Ok(PathBuf::from("pwsh"))
    }
}

#[derive(Clone)]
struct App {
    store: Arc<Store>,
    token: Arc<str>,
    host: Arc<str>,
    shutdown: watch::Sender<bool>,
}

fn error(status: StatusCode, message: impl ToString) -> Response {
    (status, Json(json!({"error":message.to_string()}))).into_response()
}

async fn authorize(
    State(app): State<App>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if headers.get(header::HOST).and_then(|v| v.to_str().ok()) != Some(app.host.as_ref()) {
        return error(StatusCode::FORBIDDEN, "Invalid host");
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if token != Some(app.token.as_ref()) {
        return error(StatusCode::FORBIDDEN, "Unauthorized");
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

async fn health(State(app): State<App>) -> Json<Value> {
    Json(
        json!({"ok":true,"pid":std::process::id(),"protocol":1,"backend":"rust-pty","workspace":app.store.workspace}),
    )
}

async fn list(State(app): State<App>) -> Json<Value> {
    let terminals = app.store.terminals.lock().unwrap();
    Json(json!(terminals
        .values()
        .map(|terminal| {
            let r = terminal.record.lock().unwrap();
            json!({"id":r.id,"exit":r.exit,"interrupted":r.interrupted})
        })
        .collect::<Vec<_>>()))
}

#[derive(Deserialize)]
struct Action {
    action: String,
    #[serde(default)]
    value: Value,
}
async fn action(State(app): State<App>, Json(body): Json<Action>) -> Response {
    match tokio::task::spawn_blocking(move || app.store.action(&body.action, body.value)).await {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(e)) => error(StatusCode::BAD_REQUEST, e),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[derive(Deserialize)]
struct TerminalQuery {
    id: String,
}
async fn snapshot(State(app): State<App>, Query(query): Query<TerminalQuery>) -> Response {
    match app.store.get(&query.id) {
        Ok(t) => Json(json!(t.record.lock().unwrap().clone())).into_response(),
        Err(e) => error(StatusCode::BAD_REQUEST, e),
    }
}

async fn events(State(app): State<App>, Query(query): Query<TerminalQuery>) -> Response {
    let t = match app.store.get(&query.id) {
        Ok(t) => t,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    let (snapshot, mut rx) = {
        // Subscribe while holding the same lock used for output publication.
        let r = t.record.lock().unwrap();
        (
            json!({"snapshot":true,"data":r.buffer,"exit":r.exit,"interrupted":r.interrupted}),
            t.events.subscribe(),
        )
    };
    let mut shutdown = app.shutdown.subscribe();
    let stream = async_stream::stream! {
        let _terminal=t;
        yield Ok::<_,Infallible>(Event::default().data(snapshot.to_string()));
        loop {
            let value=tokio::select! { _=shutdown.wait_for(|v| *v)=>break, result=rx.recv()=>match result {Ok(v)=>v,Err(_)=>break} };
            let closed=value.get("closed").and_then(Value::as_bool)==Some(true);
            yield Ok(Event::default().data(value.to_string()));
            if closed { break; }
        }
    };
    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("heartbeat"),
        )
        .into_response()
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    #[cfg(unix)]
    if args.first().is_some_and(|arg| arg == "--pty-shell") {
        let [_, parent, shell] = &args[..] else { bail!("Invalid PTY supervisor arguments"); };
        let code = unix_pty::run(parent.to_str().context("daemon pid")?.parse()?, shell)?;
        std::process::exit(code);
    }
    serve(args)
}

#[tokio::main]
async fn serve(args: Vec<std::ffi::OsString>) -> Result<()> {
    if args.first().is_some_and(|arg| arg == "--gateway") {
        return gateway::run(&args[1..]).await;
    }
    let import_legacy = args.len() == 4 && args[3] == "--import-legacy";
    if args.len() != 3 && !import_legacy {
        bail!("Usage: axiom-daemon <port> <workspace> <private-state-directory> [--import-legacy]");
    }
    let port: u16 = args[0].to_str().context("port")?.parse()?;
    let dir = Path::new(&args[2]);
    fs::create_dir_all(dir)?;
    let token = fs::read_to_string(dir.join("runtime.token"))
        .context("Read existing owner-provisioned runtime.token")?;
    if token.trim() != token || token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("Invalid runtime token");
    }
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await?;
    // Bind first so a second daemon cannot load and overwrite live state.
    let port = listener.local_addr()?.port();
    let store = Arc::new(Store::open(
        PathBuf::from(&args[1]),
        dir.join("rust-terminals.json"),
        import_legacy,
    )?);
    let (shutdown, mut shutdown_rx) = watch::channel(false);
    let app = App {
        store: store.clone(),
        token: Arc::from(token),
        host: Arc::from(format!("127.0.0.1:{port}")),
        shutdown: shutdown.clone(),
    };
    let router = Router::new()
        .route("/api/runtime-health", get(health))
        .route("/api/terminals", get(list))
        .route("/api/terminal-action", post(action))
        .route(
            "/api/runtime-stop",
            post(|State(app): State<App>| async move {
                app.shutdown.send_replace(true);
                Json(json!({"ok":true}))
            }),
        )
        .route("/api/terminal/events", get(events))
        .route("/api/terminal-snapshot", get(snapshot))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .route_layer(middleware::from_fn_with_state(app.clone(), authorize))
        .with_state(app);
    let checkpoint = store.clone();
    let timer = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let s = checkpoint.clone();
            if let Ok(Err(e)) = tokio::task::spawn_blocking(move || s.persist()).await {
                eprintln!("Terminal checkpoint: {e}");
            }
        }
    });
    println!("AXIOM_DAEMON_READY {port}");
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            tokio::select! { _=tokio::signal::ctrl_c()=>{}, _=shutdown_rx.wait_for(|v| *v)=>{} };
            shutdown.send_replace(true);
            if let Err(error) = store.shutdown() {
                eprintln!("Daemon shutdown: {error}");
            }
        })
        .await?;
    timer.abort();
    Ok(())
}
