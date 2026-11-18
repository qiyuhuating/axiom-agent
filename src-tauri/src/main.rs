#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::os::windows::process::CommandExt;
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Host(Mutex<Child>);

fn stop_host(child: &mut Child) {
    // EOF is the desktop host's graceful shutdown signal.
    drop(child.stdin.take());
    let until = Instant::now() + Duration::from_secs(5);
    while Instant::now() < until {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let mut runtime = app.path().resource_dir()?.join("runtime");
    #[cfg(debug_assertions)]
    if !runtime.join("bin/node.exe").is_file() {
        runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.desktop-runtime");
    }
    let data = app.path().app_local_data_dir()?;
    fs::create_dir_all(&data)?;
    let config = data.join("axiom.config.json");
    if !config.exists() {
        let defaults = serde_json::json!({
            "workspace": data.join("workspace"),
            "sessionDir": data.join("sessions"),
            "runtimePort": 4798,
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
        .append(true)
        .open(data.join("desktop-host.log"))?;
    let mut child = Command::new(bin.join("node.exe"))
        .arg(runtime.join("src/server.mjs"))
        .current_dir(&runtime)
        .env("AXIOM_CONFIG", &config)
        .env("AXIOM_DESKTOP", "1")
        .env("PATH", path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log.try_clone()?))
        .creation_flags(0x08000000)
        .spawn()?;
    let stdout = child.stdout.take().expect("piped stdout");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        use std::io::Write;
        let mut log = log;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let _ = writeln!(log, "{line}");
            if let Some(port) = line
                .strip_prefix("AXIOM_READY ")
                .and_then(|p| p.parse::<u16>().ok())
            {
                let _ = tx.send(port);
            }
        }
    });
    let port = match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(port) if port != 0 => port,
        _ => {
            stop_host(&mut child);
            return Err("Axiom backend failed to start; see desktop-host.log".into());
        }
    };
    let url = format!("http://127.0.0.1:{port}/").parse::<tauri::Url>()?;
    let origin = url.origin();
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Axiom Agent")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 580.0)
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
