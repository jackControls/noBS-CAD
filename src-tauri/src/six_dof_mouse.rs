//! Cross-platform raw-HID adapter for common 3Dconnexion six-degree-of-
//! freedom mice. It deliberately contains no vendor SDK code: browser and
//! desktop transports emit one small, shared motion event consumed by the
//! viewport camera.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const CURRENT_VENDOR_ID: u16 = 0x256f;
const LEGACY_VENDOR_ID: u16 = 0x046d;

#[derive(Debug, Clone, Serialize)]
pub struct SixDofMouseInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: String,
    pub serial_number: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct MotionPacket {
    #[serde(skip_serializing_if = "Option::is_none")]
    translation: Option<[i16; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rotation: Option<[i16; 3]>,
}

#[derive(Debug, Clone, Copy, Serialize)]
struct ButtonPacket {
    button: u32,
}

struct Worker {
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}

#[derive(Default)]
pub struct SixDofMouseState {
    operation: Mutex<()>,
    worker: Mutex<Option<Worker>>,
}

impl SixDofMouseState {
    fn stop(&self) {
        if let Some(worker) = self
            .worker
            .lock()
            .expect("six-dof mouse worker mutex poisoned")
            .take()
        {
            worker.stop.store(true, Ordering::Relaxed);
            let _ = worker.thread.join();
        }
    }
}

fn supported_device(info: &hidapi::DeviceInfo) -> bool {
    if info.vendor_id() == CURRENT_VENDOR_ID {
        return true;
    }
    if info.vendor_id() != LEGACY_VENDOR_ID {
        return false;
    }
    let product = info
        .product_string()
        .unwrap_or_default()
        .to_ascii_lowercase();
    product.contains("space") || product.contains("3dconnexion") || product.contains("cadman")
}

fn vector(data: &[u8], offset: usize) -> Option<[i16; 3]> {
    if data.len() < offset + 6 {
        return None;
    }
    Some([
        i16::from_le_bytes([data[offset], data[offset + 1]]),
        i16::from_le_bytes([data[offset + 2], data[offset + 3]]),
        i16::from_le_bytes([data[offset + 4], data[offset + 5]]),
    ])
}

#[tauri::command]
pub async fn six_dof_mouse_devices() -> Result<Vec<SixDofMouseInfo>, String> {
    let api = hidapi::HidApi::new().map_err(|error| error.to_string())?;
    Ok(api
        .device_list()
        .filter(|info| supported_device(info))
        .map(|info| SixDofMouseInfo {
            vendor_id: info.vendor_id(),
            product_id: info.product_id(),
            product_name: info.product_string().unwrap_or("3D mouse").to_string(),
            serial_number: info.serial_number().map(str::to_string),
        })
        .collect())
}

#[tauri::command]
pub async fn six_dof_mouse_connect(
    app: AppHandle,
    state: State<'_, SixDofMouseState>,
) -> Result<SixDofMouseInfo, String> {
    let _operation = state
        .operation
        .lock()
        .map_err(|_| "six-dof mouse operation mutex poisoned".to_string())?;
    state.stop();
    let api = hidapi::HidApi::new().map_err(|error| error.to_string())?;
    let info = api
        .device_list()
        .find(|candidate| supported_device(candidate))
        .ok_or_else(|| "No supported 3D mouse was found.".to_string())?;
    let result = SixDofMouseInfo {
        vendor_id: info.vendor_id(),
        product_id: info.product_id(),
        product_name: info.product_string().unwrap_or("3D mouse").to_string(),
        serial_number: info.serial_number().map(str::to_string),
    };
    let device = info.open_device(&api).map_err(|error| error.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let thread = std::thread::Builder::new()
        .name("nbcad-six-dof-mouse".to_string())
        .spawn(move || {
            let mut buffer = [0_u8; 64];
            let mut previous_buttons = 0_u32;
            while !worker_stop.load(Ordering::Relaxed) {
                let length = match device.read_timeout(&mut buffer, 25) {
                    Ok(length) => length,
                    Err(error) => {
                        let _ = app.emit("six-dof-mouse-error", error.to_string());
                        break;
                    }
                };
                if length < 2 {
                    continue;
                }
                let report_id = buffer[0];
                let data = &buffer[1..length];
                match report_id {
                    1 => {
                        let _ = app.emit(
                            "six-dof-mouse-motion",
                            MotionPacket {
                                translation: vector(data, 0),
                                rotation: vector(data, 6),
                            },
                        );
                    }
                    2 => {
                        let _ = app.emit(
                            "six-dof-mouse-motion",
                            MotionPacket {
                                translation: None,
                                rotation: vector(data, 0),
                            },
                        );
                    }
                    3 => {
                        let mut bytes = [0_u8; 4];
                        let count = data.len().min(bytes.len());
                        bytes[..count].copy_from_slice(&data[..count]);
                        let buttons = u32::from_le_bytes(bytes);
                        let newly_pressed = buttons & !previous_buttons;
                        previous_buttons = buttons;
                        for index in 0..32 {
                            if newly_pressed & (1 << index) != 0 {
                                let _ = app.emit(
                                    "six-dof-mouse-button",
                                    ButtonPacket { button: index + 1 },
                                );
                            }
                        }
                    }
                    _ => {}
                }
            }
        })
        .map_err(|error| error.to_string())?;
    *state
        .worker
        .lock()
        .map_err(|_| "six-dof mouse worker mutex poisoned".to_string())? =
        Some(Worker { stop, thread });
    Ok(result)
}

#[tauri::command]
pub async fn six_dof_mouse_disconnect(state: State<'_, SixDofMouseState>) -> Result<(), String> {
    let _operation = state
        .operation
        .lock()
        .map_err(|_| "six-dof mouse operation mutex poisoned".to_string())?;
    state.stop();
    Ok(())
}
