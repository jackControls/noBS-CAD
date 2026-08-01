//! Native application-menu integration.
//!
//! Tauri's default macOS Undo/Redo entries are predefined AppKit responder
//! actions. They work for native text controls, but a CAD operation stack in
//! the webview/Rust engine is not part of that responder chain. Keep the
//! standard menu and replace only those two entries with application commands
//! that the frontend routes through the same history controller as shortcuts.

use std::io;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub const EDIT_COMMAND_EVENT: &str = "native-edit-command";
const UNDO_ID: &str = "nbcad-edit-undo";
const REDO_ID: &str = "nbcad-edit-redo";

#[derive(Default)]
pub struct NativeEditMenuState {
    items: Mutex<Option<(MenuItem<Wry>, MenuItem<Wry>)>>,
}

impl NativeEditMenuState {
    fn install(&self, undo: MenuItem<Wry>, redo: MenuItem<Wry>) {
        if let Ok(mut items) = self.items.lock() {
            *items = Some((undo, redo));
        }
    }

    fn set_enabled(&self, can_undo: bool, can_redo: bool) -> Result<(), String> {
        let items = self
            .items
            .lock()
            .map_err(|_| "native Edit menu state is unavailable".to_string())?;
        let Some((undo, redo)) = items.as_ref() else {
            // Non-macOS builds do not install an application menu.
            return Ok(());
        };
        undo.set_enabled(can_undo)
            .map_err(|error| error.to_string())?;
        redo.set_enabled(can_redo)
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

/// Build the normal Tauri/macOS menu, replacing only responder-chain
/// Undo/Redo with application-owned items and standard accelerators.
#[cfg(target_os = "macos")]
pub fn build(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let edit = menu
        .items()?
        .into_iter()
        .find_map(|item| match item {
            MenuItemKind::Submenu(submenu) if submenu.text().ok().as_deref() == Some("Edit") => {
                Some(submenu)
            }
            _ => None,
        })
        .ok_or_else(|| io::Error::other("default macOS menu has no Edit submenu"))?;

    // Default order is Undo, Redo, separator. Removing index zero twice keeps
    // the separator and every standard Cut/Copy/Paste item untouched.
    edit.remove_at(0)?;
    edit.remove_at(0)?;
    let undo = MenuItem::with_id(app, UNDO_ID, "Undo", false, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, REDO_ID, "Redo", false, Some("CmdOrCtrl+Shift+Z"))?;
    edit.insert_items(&[&undo, &redo], 0)?;
    app.state::<NativeEditMenuState>().install(undo, redo);
    Ok(menu)
}

#[cfg(target_os = "macos")]
pub fn handle_event(app: &AppHandle<Wry>, event: MenuEvent) {
    let command = if event.id() == UNDO_ID {
        Some("undo")
    } else if event.id() == REDO_ID {
        Some("redo")
    } else {
        None
    };
    if let Some(command) = command {
        let _ = app.emit(EDIT_COMMAND_EVENT, command);
    }
}

#[tauri::command]
pub fn native_edit_menu_set_state(
    state: tauri::State<'_, NativeEditMenuState>,
    can_undo: bool,
    can_redo: bool,
) -> Result<(), String> {
    state.set_enabled(can_undo, can_redo)
}
