//! The desktop outlives its MCP launcher, without retaining the MCP's pipes.

#[cfg(not(windows))]
pub(super) fn spawn(path: &std::path::Path) -> std::io::Result<std::process::Child> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(parent) = path.parent() {
        command.current_dir(parent);
    }
    command.spawn()
}

#[cfg(windows)]
pub(super) use windows::spawn;

#[cfg(windows)]
mod windows {
    use std::{
        io,
        os::windows::{
            ffi::OsStrExt,
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
            process::ExitStatusExt,
        },
        path::Path,
        process::ExitStatus,
        ptr,
    };
    use windows_sys::Win32::{
        Foundation::{WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::Threading::{
            CreateProcessW, GetExitCodeProcess, WaitForSingleObject, CREATE_NO_WINDOW,
            CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW,
        },
    };

    pub(crate) struct DesktopChild {
        process: OwnedHandle,
        pid: u32,
    }

    impl DesktopChild {
        pub(crate) fn id(&self) -> u32 {
            self.pid
        }

        pub(crate) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            // A process can legitimately exit with STILL_ACTIVE (259). Its
            // signaled handle, rather than that exit code, determines completion.
            match unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } {
                WAIT_TIMEOUT => Ok(None),
                WAIT_OBJECT_0 => {
                    let mut code = 0;
                    if unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) } == 0 {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(Some(ExitStatus::from_raw(code)))
                }
                WAIT_FAILED => Err(io::Error::last_os_error()),
                result => Err(io::Error::other(format!(
                    "Unexpected desktop process wait result: {result}"
                ))),
            }
        }
    }

    fn wide(path: &Path) -> io::Result<Vec<u16>> {
        let mut value: Vec<_> = path.as_os_str().encode_wide().collect();
        if value.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Desktop executable path contains a null character",
            ));
        }
        value.push(0);
        Ok(value)
    }

    pub(crate) fn spawn(path: &Path) -> io::Result<DesktopChild> {
        let application = wide(path)?;
        let directory = path.parent().map(wide).transpose()?;
        // The canonical executable is also argv[0]. There are no arguments or
        // shell interpolation; Windows file names cannot contain a quote.
        let mut command = vec![b'"' as u16];
        command.extend_from_slice(&application[..application.len() - 1]);
        command.extend_from_slice(&[b'"' as u16, 0]);
        let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        // Stable std::process::Command currently inherits *all* inheritable
        // handles, even with null stdio. A surviving CAD process would retain
        // MCP/PowerShell pipes and prevent their readers from observing EOF.
        // Block inheritance at creation, without racing global handle flags.
        let created = unsafe {
            CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                0,
                CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                ptr::null(), // Preserve the configured SDK/session environment.
                directory.as_ref().map_or(ptr::null(), |v| v.as_ptr()),
                &startup,
                &mut process,
            )
        };
        if created == 0 {
            return Err(io::Error::last_os_error());
        }
        // Both handles are valid after successful CreateProcessW. Dropping the
        // launcher closes handles, and deliberately does not terminate CAD.
        let process_handle = unsafe { OwnedHandle::from_raw_handle(process.hProcess) };
        let thread_handle = unsafe { OwnedHandle::from_raw_handle(process.hThread) };
        drop(thread_handle);
        Ok(DesktopChild {
            process: process_handle,
            pid: process.dwProcessId,
        })
    }

    #[cfg(test)]
    mod tests {
        include!("desktop_process_tests.rs");
    }
}
