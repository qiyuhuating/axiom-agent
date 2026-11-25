use anyhow::{bail, Context, Result};
use std::{
    ffi::OsStr,
    io, mem,
    os::unix::process::{CommandExt, ExitStatusExt},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};

static STOP: AtomicBool = AtomicBool::new(false);
extern "C" fn request_stop(_: libc::c_int) {
    STOP.store(true, Ordering::Relaxed);
}

pub fn run(parent: libc::pid_t, shell: &OsStr) -> Result<i32> {
    let session = unsafe { libc::getpid() };
    if unsafe { libc::getsid(0) } != session || unsafe { libc::getppid() } != parent {
        bail!("Expected a PTY session owned by the daemon");
    }
    // portable-pty sends HUP on close. A caught signal returns to its default
    // disposition when exec starts the shell.
    for sig in [libc::SIGHUP, libc::SIGTERM] {
        if unsafe { libc::signal(sig, request_stop as *const () as libc::sighandler_t) }
            == libc::SIG_ERR
        {
            return Err(io::Error::last_os_error()).context("Install PTY shutdown handler");
        }
    }
    let mut child = Command::new(shell)
        .args(["-NoLogo", "-NoProfile"])
        .process_group(0)
        .spawn()
        .context("Start PTY shell")?;
    let group = child.id() as libc::pid_t;
    let result = (|| -> Result<()> {
        if unsafe { libc::tcsetpgrp(libc::STDIN_FILENO, group) } != 0 {
            return Err(io::Error::last_os_error()).context("Set foreground PTY process group");
        }
        // The child may have read the terminal before becoming foreground.
        unsafe { libc::kill(-group, libc::SIGCONT) };
        while !STOP.load(Ordering::Relaxed) && unsafe { libc::getppid() } == parent {
            let mut info = unsafe { mem::zeroed() };
            // Keep the shell PID reserved until its process group is cleaned up.
            if unsafe {
                libc::waitid(
                    libc::P_PID,
                    group as _,
                    &mut info,
                    libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                )
            } < 0
            {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error.into());
            }
            if unsafe { info.si_pid() } == group {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    })();
    // Interactive shells can place the current command in a distinct group.
    let foreground = unsafe { libc::tcgetpgrp(libc::STDIN_FILENO) };
    if foreground > 1
        && foreground != group
        && foreground != session
        && unsafe { libc::getsid(foreground) } == session
    {
        unsafe { libc::kill(-foreground, libc::SIGKILL) };
    }
    unsafe { libc::kill(-group, libc::SIGKILL) };
    let status = child.wait().context("Reap PTY shell")?;
    result?;
    Ok(status
        .code()
        .unwrap_or_else(|| 128 + status.signal().unwrap_or(1)))
}
