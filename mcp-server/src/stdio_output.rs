//! End a disconnected desktop's MCP output without ending its native window.
//! Only pipes are retired; terminals, files, and absent GUI stdio stay untouched.

pub(super) use platform::retire_stdout_pipe;

#[cfg(windows)]
mod platform {
    use std::{
        fs::File,
        io,
        os::windows::io::{FromRawHandle, IntoRawHandle},
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, CompareObjectHandles, HANDLE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{GetFileType, FILE_TYPE_PIPE},
        System::Console::{GetStdHandle, SetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE},
    };

    pub(crate) fn retire_stdout_pipe() -> io::Result<()> {
        // These handles are process-owned. Replacement precedes disposal, as
        // required by GetStdHandle's documented handle-disposal contract.
        let output = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
        let error = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
        retire_pipe(output, error, |stream, handle| {
            if unsafe { SetStdHandle(stream, handle) } == 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        })?;
        Ok(())
    }

    // On success the returned NUL handle belongs to the process standard-handle
    // table. Tests use private handle tables and explicitly dispose that sink.
    fn retire_pipe(
        output: HANDLE,
        error: HANDLE,
        mut install: impl FnMut(u32, HANDLE) -> io::Result<()>,
    ) -> io::Result<Option<HANDLE>> {
        if output.is_null()
            || output == INVALID_HANDLE_VALUE
            || unsafe { GetFileType(output) } != FILE_TYPE_PIPE
        {
            return Ok(None);
        }
        let aliased_error = !error.is_null()
            && error != INVALID_HANDLE_VALUE
            && (error == output || unsafe { CompareObjectHandles(output, error) } != 0);
        let sink = File::options().write(true).open("NUL")?.into_raw_handle();
        if let Err(error) = install(STD_OUTPUT_HANDLE, sink) {
            // No standard-handle table entry adopted the sink.
            drop(unsafe { File::from_raw_handle(sink) });
            return Err(error);
        }
        if aliased_error {
            // Duplicating this pipe for stderr would itself prevent EOF. Move
            // only aliases to the sink; separately routed stderr is unchanged.
            // If installation fails, retain both valid handles until exit.
            install(STD_ERROR_HANDLE, sink)?;
        }
        if unsafe { CloseHandle(output) } == 0 {
            return Err(io::Error::last_os_error());
        }
        if aliased_error && error != output && unsafe { CloseHandle(error) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Some(sink))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::{Read, Write},
            os::windows::io::AsRawHandle,
            sync::mpsc,
            thread,
            time::Duration,
        };
        use windows_sys::Win32::System::Pipes::CreatePipe;

        fn pipe() -> (File, File) {
            let (mut read, mut write) = (std::ptr::null_mut(), std::ptr::null_mut());
            assert_ne!(
                unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) },
                0
            );
            unsafe { (File::from_raw_handle(read), File::from_raw_handle(write)) }
        }

        fn expect_eof(mut reader: File) {
            let (tx, rx) = mpsc::channel();
            thread::spawn(move || {
                let _ = tx.send(reader.read(&mut [0; 1]));
            });
            assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap(), 0);
        }

        #[test]
        fn retiring_owned_output_pipe_delivers_eof_and_leaves_an_inert_sink() {
            for alias in [false, true] {
                let (reader, writer) = pipe();
                let output = writer.into_raw_handle();
                let error = if alias { output } else { std::ptr::null_mut() };
                let mut installed = Vec::new();
                let sink = retire_pipe(output, error, |stream, handle| {
                    installed.push((stream, handle));
                    Ok(())
                })
                .unwrap()
                .unwrap();
                let mut sink = unsafe { File::from_raw_handle(sink) };
                sink.write_all(b"late output is discarded").unwrap();
                assert_eq!(installed.len(), if alias { 2 } else { 1 });
                assert!(installed
                    .iter()
                    .all(|(_, handle)| *handle == sink.as_raw_handle()));
                expect_eof(reader);
            }
        }

        #[test]
        fn duplicated_stderr_alias_is_retired_but_separate_stderr_is_preserved() {
            let (reader, writer) = pipe();
            let alias = writer.try_clone().unwrap().into_raw_handle();
            let output = writer.into_raw_handle();
            let mut installed = Vec::new();
            let sink = retire_pipe(output, alias, |stream, handle| {
                installed.push((stream, handle));
                Ok(())
            })
            .unwrap()
            .unwrap();
            let _sink = unsafe { File::from_raw_handle(sink) };
            assert_eq!(installed.len(), 2);
            expect_eof(reader);

            let (reader, writer) = pipe();
            let (_error_reader, mut error_writer) = pipe();
            let mut installed = Vec::new();
            let sink = retire_pipe(
                writer.into_raw_handle(),
                error_writer.as_raw_handle(),
                |stream, handle| {
                    installed.push((stream, handle));
                    Ok(())
                },
            )
            .unwrap()
            .unwrap();
            let _sink = unsafe { File::from_raw_handle(sink) };
            assert_eq!(installed.len(), 1);
            error_writer.write_all(b"diagnostic").unwrap();
            expect_eof(reader);
        }

        #[test]
        fn absent_or_non_pipe_output_is_unchanged() {
            let mut sink = File::options().write(true).open("NUL").unwrap();
            for handle in [
                std::ptr::null_mut(),
                INVALID_HANDLE_VALUE,
                sink.as_raw_handle(),
            ] {
                assert!(retire_pipe(handle, std::ptr::null_mut(), |_, _| panic!(
                    "replaced non-pipe output"
                ))
                .unwrap()
                .is_none());
            }
            sink.write_all(b"still valid").unwrap();
        }
    }
}

#[cfg(unix)]
mod platform {
    use std::{
        ffi::c_int,
        fs::File,
        io,
        os::fd::{AsRawFd, FromRawFd},
        os::unix::fs::{FileTypeExt, MetadataExt},
    };

    // POSIX signatures shared by Linux and macOS. Rust's standard runtime
    // already links the system C library; no additional Rust dependency.
    unsafe extern "C" {
        fn dup(fd: c_int) -> c_int;
        fn dup2(old: c_int, new: c_int) -> c_int;
        #[cfg(test)]
        fn pipe(fds: *mut c_int) -> c_int;
    }

    fn inspect(fd: c_int) -> io::Result<File> {
        let duplicate = unsafe { dup(fd) };
        if duplicate < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(unsafe { File::from_raw_fd(duplicate) })
        }
    }

    fn replace(sink: &File, target: c_int) -> io::Result<()> {
        loop {
            if unsafe { dup2(sink.as_raw_fd(), target) } >= 0 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }

    pub(crate) fn retire_stdout_pipe() -> io::Result<()> {
        retire_pipe(1, Some(2)).map(|_| ())
    }

    fn retire_pipe(output: c_int, error: Option<c_int>) -> io::Result<bool> {
        let output_file = inspect(output)?;
        let metadata = output_file.metadata()?;
        if !metadata.file_type().is_fifo() {
            return Ok(false);
        }
        let error_file = error.and_then(|fd| inspect(fd).ok());
        let aliased_error = error_file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .is_some_and(|other| {
                other.file_type().is_fifo()
                    && other.dev() == metadata.dev()
                    && other.ino() == metadata.ino()
            });
        let sink = File::options().write(true).open("/dev/null")?;
        replace(&sink, output)?;
        if aliased_error {
            replace(&sink, error.unwrap())?;
        }
        // The inspection duplicates drop here too, so no writer retains the
        // original pipe. dup2 atomically leaves each standard fd occupied.
        Ok(true)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::{Read, Write},
            sync::mpsc,
            thread,
            time::Duration,
        };

        fn owned_pipe() -> (File, File) {
            let mut fds = [-1; 2];
            assert_eq!(unsafe { pipe(fds.as_mut_ptr()) }, 0);
            unsafe { (File::from_raw_fd(fds[0]), File::from_raw_fd(fds[1])) }
        }

        fn expect_eof(mut reader: File) {
            let (tx, rx) = mpsc::channel();
            thread::spawn(move || {
                let _ = tx.send(reader.read(&mut [0; 1]));
            });
            assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap(), 0);
        }

        #[test]
        fn retiring_owned_output_pipe_delivers_eof_and_leaves_an_inert_sink() {
            let (reader, mut writer) = owned_pipe();
            let mut error = writer.try_clone().unwrap();
            assert!(retire_pipe(writer.as_raw_fd(), Some(error.as_raw_fd())).unwrap());
            writer.write_all(b"discard").unwrap();
            error.write_all(b"discard aliased error").unwrap();
            expect_eof(reader);
        }

        #[test]
        fn non_pipe_output_and_separate_stderr_are_unchanged() {
            let mut sink = File::options().write(true).open("/dev/null").unwrap();
            assert!(!retire_pipe(sink.as_raw_fd(), None).unwrap());
            sink.write_all(b"still valid").unwrap();
            let (reader, writer) = owned_pipe();
            let (_error_reader, mut error) = owned_pipe();
            assert!(retire_pipe(writer.as_raw_fd(), Some(error.as_raw_fd())).unwrap());
            error.write_all(b"diagnostic").unwrap();
            expect_eof(reader);
        }
    }
}

#[cfg(not(any(windows, unix)))]
mod platform {
    pub(crate) fn retire_stdout_pipe() -> std::io::Result<()> {
        Ok(())
    }
}
