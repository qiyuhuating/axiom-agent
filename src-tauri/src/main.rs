#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::os::windows::process::CommandExt;
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Host(Mutex<Child>);

struct CappedLog(std::fs::File);
impl Write for CappedLog {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        const LIMIT: usize = 8 * 1024 * 1024;
        let tail = &data[data.len().saturating_sub(LIMIT)..];
        if self.0.metadata()?.len() + tail.len() as u64 > LIMIT as u64 {
            self.0.set_len(0)?;
        }
        self.0.seek(SeekFrom::End(0))?;
        self.0.write_all(tail)?;
        Ok(data.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

fn stop_host(child: &mut Child) {
    // EOF is the desktop host's graceful shutdown signal.
    drop(child.stdin.take());
    let until = Instant::now() + Duration::from_secs(7);
    while Instant::now() < until {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

// Serialize stderr and stdout records; inherited file handles can interleave
// writes from different processes (including the readiness record).
fn drain_host_output(
    input: impl Read,
    log: Arc<Mutex<impl Write>>,
    ready: Option<mpsc::Sender<u16>>,
) {
    let mut reader = BufReader::new(input);
    let mut line = Vec::new();
    let mut ready = ready;
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if !line.ends_with(b"\n") {
            line.push(b'\n');
        }
        if let Ok(mut log) = log.lock() {
            let _ = log.write_all(&line);
        }
        if let Some(port) = std::str::from_utf8(&line)
            .ok()
            .and_then(|line| {
                line.trim_end_matches(['\r', '\n'])
                    .strip_prefix("AXIOM_READY ")
            })
            .and_then(|port| port.parse::<u16>().ok())
            .filter(|port| *port != 0)
        {
            if let Some(tx) = ready.take() {
                let _ = tx.send(port);
            }
        }
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Node cannot resolve Win32 verbatim paths (e.g. \\?\D:\\...).
    let runtime = app.path().resource_dir()?.join("runtime");
    #[cfg(debug_assertions)]
    let runtime = if runtime.join("bin/node.exe").is_file() {
        runtime
    } else {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.desktop-runtime")
    };
    let runtime = dunce::simplified(&runtime).to_owned();
    let data = app.path().app_local_data_dir()?;
    let data = dunce::simplified(&data).to_owned();
    fs::create_dir_all(&data)?;
    let config = data.join("axiom.config.json");
    if !config.exists() {
        let defaults = serde_json::json!({
            "workspace": data.join("workspace"),
            "sessionDir": data.join("sessions"),
            "runtimePort": 4798,
            "nativeGateway": true,
            "terminalBackend": "rust",
            "rustTerminalPort": 4799,
            "discoverContext": true
        });
        fs::write(&config, serde_json::to_vec_pretty(&defaults)?)?;
    }
    let bin = runtime.join("bin");
    let path = std::env::join_paths(std::iter::once(bin.clone()).chain(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    )))?;
    let log = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(data.join("desktop-host.log"))?;
    let config_bytes = fs::read(&config)?;
    let settings: serde_json::Value = serde_json::from_slice(
        config_bytes
            .strip_prefix(&[0xef, 0xbb, 0xbf])
            .unwrap_or(&config_bytes),
    )?;
    let node = bin.join("node.exe");
    let server = runtime.join("src/server.mjs");
    let mut command = if settings
        .get("nativeGateway")
        .and_then(serde_json::Value::as_bool)
        != Some(false)
    {
        let mut command = Command::new(bin.join("axiom-daemon.exe"));
        command.arg("--gateway").arg(&node).arg(&server);
        command
    } else {
        let mut command = Command::new(&node);
        command.arg(&server);
        command
    };
    let mut child = command
        .current_dir(&runtime)
        .env("AXIOM_CONFIG", &config)
        .env("AXIOM_DESKTOP", "1")
        .env("PATH", path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .spawn()?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let log = Arc::new(Mutex::new(CappedLog(log)));
    let stderr_log = Arc::clone(&log);
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || drain_host_output(stderr, stderr_log, None));
    thread::spawn(move || drain_host_output(stdout, log, Some(tx)));
    let port = match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(port) if port != 0 => port,
        _ => {
            stop_host(&mut child);
            return Err("Axiom backend failed to start; see desktop-host.log".into());
        }
    };
    let url = format!("http://127.0.0.1:{port}/").parse::<tauri::Url>()?;
    let origin = url.origin();
    // Tauri's window builder takes logical pixels, while monitor work areas
    // are physical pixels. Convert exactly once using the monitor DPI.
    let (width, height) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let work = monitor
                .work_area()
                .size
                .to_logical::<f64>(monitor.scale_factor());
            (
                (work.width * 0.85).min(1920.0),
                (work.height * 0.85).min(1200.0),
            )
        })
        .unwrap_or((1440.0, 900.0));
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Axiom Agent")
        .inner_size(width, height)
        .min_inner_size(width.min(900.0), height.min(580.0))
        .center()
        .on_navigation(move |url| url.origin() == origin)
        .build();
    if let Err(error) = window {
        stop_host(&mut child);
        return Err(error.into());
    }
    app.manage(Host(Mutex::new(child)));
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(setup)
        .build(tauri::generate_context!())
        .expect("failed to initialize Axiom desktop");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(host) = app.try_state::<Host>() {
                if let Ok(mut child) = host.0.lock() {
                    stop_host(&mut child);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_log_rolls_over_on_windows() {
        let path = std::env::temp_dir().join(format!("axiom-log-test-{}", std::process::id()));
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .unwrap();
        let mut log = CappedLog(file);
        log.write_all(&vec![b'x'; 8 * 1024 * 1024]).unwrap();
        log.write_all(b"new").unwrap();
        drop(log);
        assert_eq!(fs::read(&path).unwrap(), b"new");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn concurrent_log_records_preserve_stdout_readiness() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let stderr_log = Arc::clone(&log);
        let (tx, rx) = mpsc::channel();
        let stderr = thread::spawn(move || {
            drain_host_output(&b"AXIOM_READY 1\nprivate host log\n"[..], stderr_log, None);
        });
        drain_host_output(
            &b"\xff\nAXIOM_READY 4567\nAXIOM_READY 2"[..],
            Arc::clone(&log),
            Some(tx),
        );
        stderr.join().unwrap();
        assert_eq!(rx.try_iter().collect::<Vec<_>>(), vec![4567]);
        let log = log.lock().unwrap();
        assert_eq!(log.split(|b| *b == b'\n').count(), 6);
        assert!(log
            .split(|b| *b == b'\n')
            .any(|line| line == b"AXIOM_READY 4567"));
    }
}
