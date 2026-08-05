//! Native viewport bridge.
//!
//! Bevy owns viewport rendering and viewport-local visual state. React owns the
//! application shell, accessible input proxies, and form-heavy command dialogs.
//! The DOM proxies are transparent when the native surface is active, which
//! keeps keyboard/screen-reader semantics without letting CSS and native pixels
//! drift apart. macOS clips WKWebView over a sibling Metal NSView; Windows clips
//! an opaque DX12/Vulkan HWND around real DOM islands and passes hit tests
//! through to WebView2. Model synchronization stays entirely in-process: the
//! OCCT tessellation is cloned from `AppState` instead of being serialized
//! through JavaScript.

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod platform;
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub mod ui;
#[cfg(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "dev-ui-lab"
))]
pub mod ui_lab;

use nbcad_core::BodyAppearance;
use nbcad_sketch::SketchDto;
use nbcad_solid::{DatumPlaneDefinitionDto, ProfileCatalogItemDto, ProfileRefDto, SolidSceneDto};
use serde::{Deserialize, Serialize};
use tauri::{App, AppHandle};

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub corner_radius: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportLayout {
    #[serde(default)]
    pub revision: u64,
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
    pub body_selected: [f32; 3],
    pub body_tool: [f32; 3],
    pub body_selected_edge: [f32; 3],
    pub face_hover: [f32; 3],
    pub face_selected: [f32; 3],
    pub edge: [f32; 3],
    pub edge_hover: [f32; 3],
    pub edge_selected: [f32; 3],
    pub active_sketch: [f32; 3],
    pub defined_sketch: [f32; 3],
    pub hover: [f32; 3],
    pub selection: [f32; 3],
    pub finished_sketch: [f32; 3],
    pub finished_sketch_point: [f32; 3],
    pub finished_sketch_point_outline: [f32; 3],
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
            body_selected: [105.0 / 255.0, 169.0 / 255.0, 212.0 / 255.0],
            body_tool: [181.0 / 255.0, 138.0 / 255.0, 67.0 / 255.0],
            body_selected_edge: [13.0 / 255.0, 117.0 / 255.0, 165.0 / 255.0],
            face_hover: [158.0 / 255.0, 213.0 / 255.0, 243.0 / 255.0],
            face_selected: [48.0 / 255.0, 174.0 / 255.0, 232.0 / 255.0],
            edge: [41.0 / 255.0, 51.0 / 255.0, 61.0 / 255.0],
            edge_hover: [88.0 / 255.0, 199.0 / 255.0, 1.0],
            edge_selected: [1.0, 200.0 / 255.0, 87.0 / 255.0],
            active_sketch: [93.0 / 255.0, 169.0 / 255.0, 1.0],
            defined_sketch: [232.0 / 255.0, 233.0 / 255.0, 236.0 / 255.0],
            hover: [1.0, 209.0 / 255.0, 102.0 / 255.0],
            selection: [196.0 / 255.0, 185.0 / 255.0, 1.0],
            finished_sketch: [74.0 / 255.0, 199.0 / 255.0, 1.0],
            finished_sketch_point: [1.0, 159.0 / 255.0, 67.0 / 255.0],
            finished_sketch_point_outline: [21.0 / 255.0, 25.0 / 255.0, 31.0 / 255.0],
            preview: [143.0 / 255.0, 196.0 / 255.0, 1.0],
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ViewportMode {
    #[default]
    Solid,
    PickPlane,
    Sketch,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ViewportOriginPlane {
    Xy,
    Xz,
    Yz,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportPresentation {
    #[serde(default)]
    pub mode: ViewportMode,
    pub hovered_origin_plane: Option<ViewportOriginPlane>,
    pub hovered_datum_plane_id: Option<u64>,
    #[serde(default)]
    pub selected_body_ids: Vec<u64>,
    pub hovered_body_id: Option<u64>,
    #[serde(default)]
    pub selected_face_ids: Vec<u64>,
    pub hovered_face_id: Option<u64>,
    #[serde(default)]
    pub selected_edge_ids: Vec<u64>,
    pub hovered_edge_id: Option<u64>,
    #[serde(default)]
    pub selected_sketch_entity_ids: Vec<u64>,
    pub hovered_sketch_entity_id: Option<u64>,
    #[serde(default)]
    pub hidden_body_ids: Vec<u64>,
    #[serde(default)]
    pub hidden_datum_plane_ids: Vec<u64>,
    #[serde(default)]
    pub hidden_sketch_names: Vec<String>,
    #[serde(default)]
    pub profile_picker_active: bool,
    #[serde(default)]
    pub selected_profiles: Vec<ProfileRefDto>,
    #[serde(default)]
    pub candidate_profiles: Vec<ProfileRefDto>,
    pub hovered_profile: Option<ProfileRefDto>,
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
    #[serde(default)]
    pub render_native_chrome: bool,
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
    #[serde(default)]
    pub hovered_control: String,
    #[serde(default)]
    pub pressed_control: String,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub dof_label: Option<String>,
    #[serde(default)]
    pub coordinate_readout: Option<String>,
    #[serde(default)]
    pub dim_opacity: f32,
    pub selection: Option<ViewportHudSelection>,
}

fn default_nav_tool() -> String {
    "select".to_string()
}

impl Default for ViewportHud {
    fn default() -> Self {
        Self {
            render_native_chrome: false,
            nav_tool: default_nav_tool(),
            sketch_mode: false,
            can_undo: false,
            can_redo: false,
            six_dof_state: "disconnected".to_string(),
            hovered_control: String::new(),
            pressed_control: String::new(),
            prompt: None,
            dof_label: None,
            coordinate_readout: None,
            dim_opacity: 0.0,
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
pub struct ViewportLineLayer {
    /// sRGBA from the DOM theme/presentation material.
    #[serde(default)]
    pub color: [f32; 4],
    /// Requested screen-space width. Bevy maps this to its normal/highlight
    /// gizmo pipelines rather than treating it as a world-space measurement.
    #[serde(default = "default_line_width")]
    pub width: f32,
    /// World-space line segments, packed as x0, y0, z0, x1, y1, z1.
    #[serde(default)]
    pub segments: Vec<f32>,
}

fn default_line_width() -> f32 {
    1.0
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportPointLayer {
    /// sRGBA from the DOM theme/presentation material.
    #[serde(default)]
    pub color: [f32; 4],
    /// Approximate world-space marker radius derived from the current camera.
    #[serde(default)]
    pub radius: f32,
    /// World-space point positions, packed as x, y, z.
    #[serde(default)]
    pub positions: Vec<f32>,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportTriangleLayer {
    /// sRGBA fill color. Positions are an already-triangulated world-space
    /// triangle list because profile topology is owned by the command layer.
    #[serde(default)]
    pub color: [f32; 4],
    #[serde(default)]
    pub positions: Vec<f32>,
    /// Draw after model depth for internal datum/profile selection.
    #[serde(default)]
    pub xray: bool,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportArrow {
    #[serde(default)]
    pub start: [f32; 3],
    #[serde(default)]
    pub end: [f32; 3],
    #[serde(default)]
    pub color: [f32; 4],
    #[serde(default = "default_line_width")]
    pub width: f32,
    #[serde(default)]
    pub xray: bool,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ViewportAnnotationKind {
    #[default]
    Dimension,
    Constraint,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportAnnotation {
    /// Viewport-local logical pixels. React already owns the exact projection
    /// used for picking, so annotations stay aligned with its interaction
    /// scene during orbit, resize, and DPI changes.
    #[serde(default)]
    pub screen: [f32; 2],
    #[serde(default)]
    pub color: [f32; 4],
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub kind: ViewportAnnotationKind,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ViewportSnapKind {
    #[default]
    Grid,
    Origin,
    Point,
    Midpoint,
    ReferenceMidpoint,
    Curve,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportSnapMarker {
    pub position: [f32; 3],
    #[serde(default)]
    pub kind: ViewportSnapKind,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportPreview {
    /// Small, transient presentation layers only. Committed sketches and OCCT
    /// tessellations continue to travel through the direct Rust snapshot path.
    #[serde(default)]
    pub lines: Vec<ViewportLineLayer>,
    #[serde(default)]
    pub points: Vec<ViewportPointLayer>,
    #[serde(default)]
    pub triangles: Vec<ViewportTriangleLayer>,
    #[serde(default)]
    pub arrows: Vec<ViewportArrow>,
    #[serde(default)]
    pub annotations: Vec<ViewportAnnotation>,
    /// Optional semantic, world-space sketch snap marker. Keeping the kind
    /// prevents the native viewport from flattening endpoints, midpoints,
    /// origins, and ordinary grid acquisition into one ambiguous crosshair.
    pub marker: Option<ViewportSnapMarker>,
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
    pub startup_error: Option<String>,
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
    pub session_id: String,
    pub geometry_revision: u64,
    pub scene: SolidSceneDto,
    pub active_sketch: Option<SketchDto>,
    pub finished_sketches: Vec<SketchDto>,
    pub datum_planes: Vec<DatumPlaneDefinitionDto>,
    pub profile_catalog: Vec<ProfileCatalogItemDto>,
    pub body_appearances: Vec<BodyAppearance>,
}

pub struct NativeViewport {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    inner: platform::PlatformNativeViewport,
}

impl NativeViewport {
    pub fn install(app: &mut App) -> Result<Self, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            platform::PlatformNativeViewport::install(app).map(|inner| Self { inner })
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = app;
            Ok(Self {})
        }
    }

    pub fn set_layout(&self, app: &AppHandle, layout: ViewportLayout) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.set_layout(app, layout)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (app, layout);
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub(crate) fn sync_model(&self, model: ViewportModel) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.sync_model(model)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = model;
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub(crate) fn drop_model_session(&self, session_id: String) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.drop_model_session(session_id)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = session_id;
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub(crate) fn rebind_model_session(&self, from: String, to: String) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.rebind_model_session(from, to)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (from, to);
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub fn set_camera(&self, camera: ViewportCamera) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.set_camera(camera)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = camera;
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub fn set_preview(&self, preview: ViewportPreview) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.set_preview(preview)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = preview;
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub fn set_presentation(&self, presentation: ViewportPresentation) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.set_presentation(presentation)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = presentation;
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub fn pick(
        &self,
        x: f32,
        y: f32,
        camera: Option<ViewportCamera>,
        logical_size: Option<(f32, f32)>,
    ) -> Result<Option<NativePick>, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.pick(x, y, camera, logical_size)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (x, y, camera, logical_size);
            Err("the embedded native viewport is unavailable on this platform".to_string())
        }
    }

    pub fn metrics(&self) -> NativeViewportMetrics {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.metrics()
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            NativeViewportMetrics {
                backend: "unavailable".to_string(),
                ..Default::default()
            }
        }
    }
}
