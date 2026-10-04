//! Portable release builds register only the current user's URL handler.
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::System::Registry::*,
};

struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}
fn set(path: &str, name: &str, value: &str) -> Result<(), String> {
    let mut key = HKEY::default();
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(path),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .ok()
        .map_err(|error| error.to_string())?;
    }
    let key = Key(key);
    let bytes: Vec<u8> = value
        .encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    unsafe {
        RegSetValueExW(key.0, &HSTRING::from(name), None, REG_SZ, Some(&bytes))
            .ok()
            .map_err(|error| error.to_string())
    }
}
pub(super) fn register() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable = executable
        .to_str()
        .ok_or("The recipe handler executable path must be Unicode")?;
    if executable.contains(['"', '\0']) {
        return Err("Invalid recipe handler executable path".into());
    }
    // This is a Windows command-line registry value, never shell execution.
    // Both the executable and one URL argument are independently quoted.
    set(
        r"Software\Classes\nbcad\shell\open\command",
        "",
        &format!("\"{executable}\" \"%1\""),
    )?;
    set(r"Software\Classes\nbcad", "", "URL:noBS CAD Recipe")?;
    set(r"Software\Classes\nbcad", "URL Protocol", "")
}
