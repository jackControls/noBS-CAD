//! Production open/save uses the OS file dialog. Tests install the choice
//! before the picker thread starts, so a library test never shows a modal.
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(test)]
static PREPARED: Mutex<Option<Option<PathBuf>>> = Mutex::new(None);

pub(super) fn pick(dialog: rfd::FileDialog, save: bool) -> Option<PathBuf> {
    #[cfg(test)]
    {
        if let Some(choice) = PREPARED.lock().expect("script dialog choice").take() {
            return choice;
        }
    }
    if save {
        dialog.save_file()
    } else {
        dialog.pick_file()
    }
}

/// `None` is Cancel. A path is the file the dialog would return.
#[cfg(test)]
pub(crate) fn prepare(path: Option<PathBuf>) {
    *PREPARED.lock().expect("script dialog choice") = Some(path);
}
