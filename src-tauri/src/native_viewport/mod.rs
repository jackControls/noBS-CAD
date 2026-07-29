//! Native viewport bridge.
//!
//! React continues to own the CAD interaction model, accessibility tree, and
//! hit targets. Bevy paints viewport-local HUD chrome as well as CAD graphics;
//! form-heavy command dialogs remain real DOM islands. On macOS the WKWebView
//! is visually clipped over a sibling NSView whose Metal surface is rendered
//! by Bevy. Model synchronization stays entirely in-process: the OCCT
//! tessellation is cloned from `AppState` instead of being serialized through
//! JavaScript.

#[cfg(target_os = "macos")]
mod macos;

use nbcad_sketch::SketchDto;
use nbcad_solid::{DatumPlaneDefinitionDto, SolidSceneDto};
use serde::{Deserialize, Serialize};
use tauri::{App, AppHandle};

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportLayout {
    pub viewport: ViewportRect,
    #[serde(default)]
    pub overlays: Vec<ViewportRect>,
    #[serde(default)]
    pub palette: ViewportPalette,
    #[serde(default)]
    pub hud: ViewportHud,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportPalette {
    pub background: [f32; 3],
    pub panel: [f32; 3],
    pub header: [f32; 3],
    pub ui_edge: [f32; 3],
    pub ink: [f32; 3],
    pub mute: [f32; 3],
    pub accent: [f32; 3],
    pub grid_fine: [f32; 3],
    pub grid_major: [f32; 3],
    pub body: [f32; 3],
    pub edge: [f32; 3],
    pub active_sketch: [f32; 3],
    pub finished_sketch: [f32; 3],
    pub preview: [f32; 3],
}

impl Default for ViewportPalette {
    fn default() -> Self {
        Self {
            background: [42.0 / 255.0, 45.0 / 255.0, 51.0 / 255.0],
            panel: [34.0 / 255.0, 38.0 / 255.0, 44.0 / 255.0],
            header: [40.0 / 255.0, 45.0 / 255.0, 52.0 / 255.0],
            ui_edge: [58.0 / 255.0, 62.0 / 255.0, 70.0 / 255.0],
            ink: [231.0 / 255.0, 235.0 / 255.0, 239.0 / 255.0],
            mute: [154.0 / 255.0, 163.0 / 255.0, 173.0 / 255.0],
            accent: [124.0 / 255.0, 109.0 / 255.0, 242.0 / 255.0],
            grid_fine: [58.0 / 255.0, 63.0 / 255.0, 71.0 / 255.0],
            grid_major: [77.0 / 255.0, 84.0 / 255.0, 95.0 / 255.0],
            body: [139.0 / 255.0, 155.0 / 255.0, 172.0 / 255.0],
            edge: [41.0 / 255.0, 51.0 / 255.0, 61.0 / 255.0],
            active_sketch: [93.0 / 255.0, 169.0 / 255.0, 1.0],
            finished_sketch: [74.0 / 255.0, 199.0 / 255.0, 1.0],
            preview: [143.0 / 255.0, 196.0 / 255.0, 1.0],
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportHudRow {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportHudSelection {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub rows: Vec<ViewportHudRow>,
    pub footer: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportHud {
    #[serde(default = "default_nav_tool")]
    pub nav_tool: String,
    #[serde(default)]
    pub sketch_mode: bool,
    #[serde(default)]
    pub can_undo: bool,
    #[serde(default)]
    pub can_redo: bool,
    #[serde(default)]
    pub six_dof_state: String,
    pub selection: Option<ViewportHudSelection>,
}

fn default_nav_tool() -> String {
    "select".to_string()
}

impl Default for ViewportHud {
    fn default() -> Self {
        Self {
            nav_tool: default_nav_tool(),
            sketch_mode: false,
            can_undo: false,
            can_redo: false,
            six_dof_state: "disconnected".to_string(),
            selection: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportCamera {
    pub position: [f32; 3],
    pub target: [f32; 3],
    pub up: [f32; 3],
    pub vertical_fov_degrees: f32,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportPreview {
    /// World-space line segments, packed as x0, y0, z0, x1, y1, z1.
    #[serde(default)]
    pub segments: Vec<f32>,
    /// Optional world-space sketch snap marker.
    pub marker: Option<[f32; 3]>,
}

impl Default for ViewportCamera {
    fn default() -> Self {
        Self {
            position: [170.0, -170.0, 130.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 0.0, 1.0],
            vertical_fov_degrees: 45.0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePick {
    pub body_id: u64,
    pub face_id: u64,
    pub point: [f32; 3],
    pub distance: f32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeViewportMetrics {
    pub available: bool,
    pub ready: bool,
    pub backend: String,
    pub logical_width: f64,
    pub logical_height: f64,
    pub scale_factor: f64,
    pub physical_width: u32,
    pub physical_height: u32,
    pub rendered_frames: u64,
    pub wakeups: u64,
    pub average_frame_ms: f64,
    pub last_pointer_latency_ms: f64,
    pub body_count: usize,
    pub triangle_count: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct ViewportModel {
    pub scene: SolidSceneDto,
    pub active_sketch: Option<SketchDto>,
    pub finished_sketches: Vec<SketchDto>,
    pub datum_planes: Vec<DatumPlaneDefinitionDto>,
}

pub struct NativeViewport {
    #[cfg(target_os = "macos")]
    inner: macos::MacNativeViewport,
}

impl NativeViewport {
    pub fn install(app: &mut App) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            macos::MacNativeViewport::install(app).map(|inner| Self { inner })
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = app;
            Ok(Self {})
        }
    }

    pub fn set_layout(&self, app: &AppHandle, layout: ViewportLayout) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.inner.set_layout(app, layout)
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, layout);
            Err("the embedded native viewport POC is macOS-only".to_string())
        }
    }

    pub(crate) fn sync_model(&self, model: ViewportModel) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.inner.sync_model(model)
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = model;
            Err("the embedded native viewport POC is macOS-only".to_string())
        }
    }

    pub fn set_camera(&self, camera: ViewportCamera) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.inner.set_camera(camera)
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = camera;
            Err("the embedded native viewport POC is macOS-only".to_string())
        }
    }

    pub fn set_preview(&self, preview: ViewportPreview) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.inner.set_preview(preview)
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = preview;
            Err("the embedded native viewport POC is macOS-only".to_string())
        }
    }

    pub fn pick(&self, x: f32, y: f32) -> Result<Option<NativePick>, String> {
        #[cfg(target_os = "macos")]
        {
            self.inner.pick(x, y)
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (x, y);
            Err("the embedded native viewport POC is macOS-only".to_string())
        }
    }

    pub fn metrics(&self) -> NativeViewportMetrics {
        #[cfg(target_os = "macos")]
        {
            self.inner.metrics()
        }

        #[cfg(not(target_os = "macos"))]
        {
            NativeViewportMetrics {
                backend: "unavailable".to_string(),
                ..Default::default()
            }
        }
    }
}
