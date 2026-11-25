// Own the terminal process tree rather than only its root PowerShell process.
// Closing the last job handle terminates descendants, including on daemon crash.
#[cfg(windows)]
mod windows {
    use anyhow::{Context, Result};
    use std::{
        io, mem,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        ptr,
    };
    use winapi::um::{
        jobapi2::{AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject},
        winnt::{
            JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    };

    pub struct ProcessTree {
        _handle: OwnedHandle,
    }
    impl ProcessTree {
        pub fn attach(child: &dyn portable_pty::Child) -> Result<Self> {
            let process = child
                .as_raw_handle()
                .context("PTY child process handle unavailable")?;
            let raw = unsafe { CreateJobObjectW(ptr::null_mut(), ptr::null()) };
            if raw.is_null() {
                return Err(io::Error::last_os_error()).context("Create PTY job");
            }
            let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = unsafe {
                SetInformationJobObject(
                    raw,
                    JobObjectExtendedLimitInformation,
                    (&mut info as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    mem::size_of_val(&info) as u32,
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error()).context("Configure PTY job");
            }
            if unsafe { AssignProcessToJobObject(handle.as_raw_handle().cast(), process.cast()) }
                == 0
            {
                return Err(io::Error::last_os_error()).context("Assign PTY process to job");
            }
            Ok(Self { _handle: handle })
        }
    }
}
#[cfg(windows)]
pub use windows::ProcessTree;
