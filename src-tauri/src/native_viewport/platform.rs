use bevy::{
    asset::RenderAssetUsages,
    camera::{visibility::RenderLayers, ClearColorConfig},
    light::{NotShadowCaster, NotShadowReceiver},
    mesh::Indices,
    prelude::*,
    render::{render_resource::PrimitiveTopology, RenderPlugin},
    ui::UiTransform,
    window::{
        ExitCondition, PresentMode, PrimaryWindow, RawHandleWrapper, RawHandleWrapperHolder,
        WindowPlugin, WindowResized, WindowResolution, WindowScaleFactorChanged, WindowWrapper,
    },
};
use nbcad_core::{BodyAppearance, PlaneBasis};
use nbcad_sketch::{BodyPoseDto, EntityDto, InstanceBodyPoseDto, SketchDto, Vec2 as SketchVec2};
use nbcad_solid::{
    BodyDto, DatumPlaneDefinitionDto, FaceDto, ProfileCatalogItemDto, ProfileLoopDto, SolidSceneDto,
};
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow, NSWindowOrderingMode};
#[cfg(target_os = "macos")]
use objc2_core_graphics::CGMutablePath;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect, NSSize};
#[cfg(target_os = "macos")]
use objc2_quartz_core::{kCAFillRuleEvenOdd, CAShapeLayer};
#[cfg(target_os = "macos")]
use raw_window_handle::AppKitWindowHandle;
#[cfg(target_os = "windows")]
use raw_window_handle::Win32WindowHandle;
use raw_window_handle::{
    DisplayHandle, HandleError, HasDisplayHandle, HasWindowHandle, RawWindowHandle, WindowHandle,
};
#[cfg(target_os = "macos")]
use std::ptr::NonNull;
use std::{
    any::Any,
    collections::HashMap,
    ffi::c_void,
    num::NonZeroU32,
    panic::AssertUnwindSafe,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
#[cfg(target_os = "windows")]
use std::{num::NonZeroIsize, sync::OnceLock};
use tauri::Manager;
#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
#[cfg(target_os = "windows")]
use windows_core_webview2::PCWSTR;
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{
        GetLastError, ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM,
    },
    Graphics::Gdi::{
        CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, ScreenToClient, SetWindowRgn,
        RGN_DIFF,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::GetDpiForWindow,
        Input::KeyboardAndMouse::{
            GetKeyState, ReleaseCapture, SetCapture, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT,
            VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
        },
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, GetClientRect, GetParent, GetWindowLongPtrW,
            RegisterClassW, SetWindowLongPtrW, SetWindowPos, ShowWindow, CS_DBLCLKS, CS_OWNDC,
            GWLP_USERDATA, HTCLIENT, HWND_TOP, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW,
            SW_HIDE, SW_SHOWNA, WM_CANCELMODE, WM_CAPTURECHANGED, WM_ERASEBKGND, WM_LBUTTONDBLCLK,
            WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDBLCLK, WM_MBUTTONDOWN, WM_MBUTTONUP,
            WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_NCDESTROY, WM_NCHITTEST,
            WM_RBUTTONDBLCLK, WM_RBUTTONDOWN, WM_RBUTTONUP, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN,
            WS_CLIPSIBLINGS, WS_EX_NOACTIVATE, WS_EX_NOPARENTNOTIFY,
        },
    },
};

use super::ui::{self, HudAxisLabel, HudAxisMark, NativeHudRoot, ViewportUiAssets};
use super::{
    NativePick, NativeViewportMetrics, ViewportAnnotationKind, ViewportCamera, ViewportHud,
    ViewportLayout, ViewportMode, ViewportModel, ViewportOriginPlane, ViewportPalette,
    ViewportLinePattern, ViewportPresentation, ViewportPreview, ViewportRect, ViewportSnapKind,
    ViewportSnapMarker,
};
use crate::state::BOOTSTRAP_SESSION_ID;

const INITIAL_PHYSICAL_SIZE: u32 = 32;
/// Base mesh size; a camera-aware transform keeps its screen footprint stable.
const REFERENCE_PLANE_HALF_SIZE: f32 = 50.0;
const REFERENCE_PLANE_SCREEN_FRACTION: f32 = 0.32;
const SKETCH_LINE_WIDTH: f32 = 1.25;
/// Below this projected radius, per-edge gizmos cost more CPU/GPU bandwidth
/// than the outline information they can convey. Bevy still renders the
/// retained shaded mesh and selected/hovered geometry always bypasses LOD.
const OCCURRENCE_EDGE_LOD_MIN_RADIUS_PX: f32 = 3.0;
const SKETCH_DEPTH_BIAS: f32 = -1.0;
const SKETCH_POINT_OUTLINE_WIDTH: f32 = 2.0;
const SKETCH_POINT_OUTLINE_DEPTH_BIAS: f32 = -0.999;
const SKETCH_POINT_RADIUS_PX: f32 = 2.5;
const SKETCH_POINT_OUTLINE_RADIUS_PX: f32 = 3.25;
const HIGHLIGHT_LINE_WIDTH: f32 = 2.0;
const SNAP_MARKER_HALF_SIZE_PX: f32 = 6.0;

#[cfg(target_os = "macos")]
const NATIVE_BACKEND: &str = "Bevy 0.19 / wgpu Metal / embedded NSView";
#[cfg(target_os = "windows")]
const NATIVE_BACKEND: &str = "Bevy 0.19 / wgpu DX12-Vulkan / embedded HWND";

#[derive(Default)]
struct NativePointers {
    webview: AtomicUsize,
    viewport: AtomicUsize,
    window: AtomicUsize,
}

#[derive(Default)]
struct MetricsState {
    ready: bool,
    startup_error: Option<String>,
    ci_probe_written: bool,
    probe_count: u64,
    logical_width: f64,
    logical_height: f64,
    scale_factor: f64,
    physical_width: u32,
    physical_height: u32,
    rendered_frames: u64,
    wakeups: u64,
    total_frame_ms: f64,
    last_pointer_latency_ms: f64,
    body_count: usize,
    triangle_count: usize,
}

enum RenderCommand {
    Resize {
        logical_width: f64,
        logical_height: f64,
        scale_factor: f64,
        palette: ViewportPalette,
        hud: ViewportHud,
    },
    Model(ViewportModel),
    RebindModelSession {
        from: String,
        to: String,
    },
    DropModelSession(String),
    Camera(ViewportCamera),
    Preview(ViewportPreview),
    Presentation(ViewportPresentation),
}

#[derive(Default)]
struct PendingRenderCommands {
    resize: Option<(f64, f64, f64, ViewportPalette, ViewportHud)>,
    model: Option<ViewportModel>,
    rebind_model_sessions: Vec<(String, String)>,
    drop_model_sessions: Vec<String>,
    camera: Option<ViewportCamera>,
    preview: Option<ViewportPreview>,
    presentation: Option<ViewportPresentation>,
    scheduled: bool,
}

struct MainThreadRenderRuntime {
    app: bevy::app::App,
    model: ViewportModel,
    camera: ViewportCamera,
    logical_size: (f32, f32),
    scale_factor: f32,
    session_aliases: HashMap<String, String>,
}

struct PickState {
    scene: SolidSceneDto,
    body_poses: Vec<BodyPoseDto>,
    instance_body_poses: Vec<InstanceBodyPoseDto>,
    camera: ViewportCamera,
    logical_size: (f32, f32),
    hidden_body_ids: Vec<u64>,
}

impl Default for PickState {
    fn default() -> Self {
        Self {
            scene: SolidSceneDto::default(),
            body_poses: Vec::new(),
            instance_body_poses: Vec::new(),
            camera: ViewportCamera::default(),
            logical_size: (1.0, 1.0),
            hidden_body_ids: Vec::new(),
        }
    }
}

pub struct PlatformNativeViewport {
    app: tauri::AppHandle,
    runtime: Arc<AtomicUsize>,
    pending: Arc<Mutex<PendingRenderCommands>>,
    pick_state: Arc<Mutex<PickState>>,
    layout_revision: Arc<AtomicU64>,
    last_layout: Arc<Mutex<Option<ViewportLayout>>>,
    suspended: Arc<AtomicBool>,
    pointers: Arc<NativePointers>,
    metrics: Arc<Mutex<MetricsState>>,
}

impl PlatformNativeViewport {
    pub fn install(app: &mut tauri::App) -> Result<Self, String> {
        let main_window = app
            .get_webview_window("main")
            .ok_or_else(|| "main Tauri webview window is missing".to_string())?;
        let app_handle = app.handle().clone();
        let runtime = Arc::new(AtomicUsize::new(0));
        let pending = Arc::new(Mutex::new(PendingRenderCommands::default()));
        let pick_state = Arc::new(Mutex::new(PickState::default()));
        let layout_revision = Arc::new(AtomicU64::new(0));
        let last_layout = Arc::new(Mutex::new(None));
        let suspended = Arc::new(AtomicBool::new(false));
        let pointers = Arc::new(NativePointers::default());
        let metrics = Arc::new(Mutex::new(MetricsState::default()));
        let install_pointers = pointers.clone();
        let install_metrics = metrics.clone();
        let install_runtime = runtime.clone();
        let install_pending = pending.clone();

        main_window
            .with_webview(move |platform| {
                // Tauri guarantees this closure runs on the native UI thread.
                #[cfg(target_os = "macos")]
                let marker =
                    MainThreadMarker::new().expect("Tauri with_webview must run on main thread");
                #[cfg(target_os = "macos")]
                let result = unsafe {
                    install_native_views(
                        marker,
                        platform.inner(),
                        platform.ns_window(),
                        install_pointers.clone(),
                    )
                };
                #[cfg(target_os = "windows")]
                let result = unsafe {
                    let controller = platform.controller();
                    let core_webview = controller.CoreWebView2().map_err(|error| {
                        format!("WebView2 did not expose its page interface: {error}")
                    });
                    let mut webview_hwnd = Default::default();
                    controller
                        .ParentWindow(&mut webview_hwnd)
                        .map_err(|error| {
                            format!("WebView2 did not expose its container HWND: {error}")
                        })
                        .and_then(|_| core_webview)
                        .and_then(|core_webview| {
                            install_native_views(
                                webview_hwnd.0,
                                install_pointers.clone(),
                                core_webview,
                            )
                        })
                };

                let (view_pointer, scale_factor) = match result {
                    Ok(value) => value,
                    Err(error) => {
                        record_startup_failure(
                            &install_metrics,
                            format!("native viewport installation failed: {error}"),
                        );
                        return;
                    }
                };

                // Renderer initialization can panic inside a platform backend before
                // Tauri has a chance to surface an IPC error. Keep the React shell
                // alive and expose the real cause through metrics/CI instead of
                // silently leaving an empty viewport.
                let initialized = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    let bevy_app = build_bevy_app(view_pointer, scale_factor as f32)?;
                    let mut render_runtime = Box::new(MainThreadRenderRuntime {
                        app: bevy_app,
                        model: ViewportModel {
                            session_id: BOOTSTRAP_SESSION_ID.to_string(),
                            geometry_revision: 0,
                            scene: SolidSceneDto::default(),
                            active_sketch: None,
                            finished_sketches: Vec::new(),
                            datum_planes: Vec::new(),
                            profile_catalog: Vec::new(),
                            body_appearances: Vec::new(),
                            body_poses: Vec::new(),
                            instance_body_poses: Vec::new(),
                        },
                        camera: ViewportCamera::default(),
                        logical_size: (1.0, 1.0),
                        scale_factor: scale_factor as f32,
                        session_aliases: HashMap::new(),
                    });
                    render_frames(&mut render_runtime.app, 2, &install_metrics);
                    Ok::<_, String>(render_runtime)
                }));
                let render_runtime = match initialized {
                    Ok(Ok(runtime)) => runtime,
                    Ok(Err(error)) => {
                        record_startup_failure(
                            &install_metrics,
                            format!("native Bevy viewport failed to initialize: {error}"),
                        );
                        return;
                    }
                    Err(payload) => {
                        record_startup_failure(
                            &install_metrics,
                            format!(
                                "native Bevy viewport panicked during initialization: {}",
                                panic_message(payload)
                            ),
                        );
                        return;
                    }
                };

                // The Bevy App and its native surface stay on the native UI
                // thread. The allocation lives for the process and is
                // dereferenced only by run_on_main_thread closures.
                let runtime_pointer = Box::into_raw(render_runtime) as usize;
                install_runtime.store(runtime_pointer, Ordering::Release);
                if let Ok(mut current) = install_metrics.lock() {
                    current.ready = true;
                    current.scale_factor = scale_factor;
                }
                eprintln!(
                    "native Bevy viewport installed ({NATIVE_BACKEND}, {scale_factor:.2}x scale)"
                );
                drain_render_commands(&install_runtime, &install_pending, &install_metrics);
            })
            .map_err(|error| format!("could not access the native webview: {error}"))?;

        Ok(Self {
            app: app_handle,
            runtime,
            pending,
            pick_state,
            layout_revision,
            last_layout,
            suspended,
            pointers,
            metrics,
        })
    }

    pub fn set_layout(&self, app: &tauri::AppHandle, layout: ViewportLayout) -> Result<(), String> {
        if layout.revision > 0 {
            let previous = self
                .layout_revision
                .fetch_max(layout.revision, Ordering::AcqRel);
            if layout.revision < previous {
                return Ok(());
            }
        }
        if let Ok(mut state) = self.pick_state.lock() {
            state.logical_size = (
                layout.viewport.width.max(1.0) as f32,
                layout.viewport.height.max(1.0) as f32,
            );
        }
        if let Ok(mut last_layout) = self.last_layout.lock() {
            *last_layout = Some(layout.clone());
        }
        if self.suspended.load(Ordering::Acquire) {
            return Ok(());
        }
        let pointers = self.pointers.clone();
        let runtime = self.runtime.clone();
        let pending = self.pending.clone();
        let metrics = self.metrics.clone();
        app.run_on_main_thread(move || {
            let webview_pointer = pointers.webview.load(Ordering::Acquire);
            let viewport_pointer = pointers.viewport.load(Ordering::Acquire);
            let window_pointer = pointers.window.load(Ordering::Acquire);
            if webview_pointer == 0 || viewport_pointer == 0 || window_pointer == 0 {
                return;
            }

            let scale_factor = unsafe {
                apply_native_layout(webview_pointer, viewport_pointer, window_pointer, &layout)
            };
            push_render_command(
                &pending,
                RenderCommand::Resize {
                    logical_width: layout.viewport.width.max(1.0),
                    logical_height: layout.viewport.height.max(1.0),
                    scale_factor,
                    palette: layout.palette,
                    hud: layout.hud,
                },
            );
            drain_render_commands(&runtime, &pending, &metrics);
        })
        .map_err(|error| format!("could not schedule native viewport layout: {error}"))
    }

    pub fn set_suspended(&self, app: &tauri::AppHandle, suspended: bool) -> Result<(), String> {
        self.suspended.store(suspended, Ordering::Release);
        let pointers = self.pointers.clone();
        let layout = self
            .last_layout
            .lock()
            .map_err(|_| "native viewport layout lock poisoned".to_string())?
            .clone();
        app.run_on_main_thread(move || {
            let webview_pointer = pointers.webview.load(Ordering::Acquire);
            let viewport_pointer = pointers.viewport.load(Ordering::Acquire);
            let window_pointer = pointers.window.load(Ordering::Acquire);
            if webview_pointer == 0 || viewport_pointer == 0 || window_pointer == 0 {
                return;
            }
            unsafe {
                set_native_viewport_suspended(
                    webview_pointer,
                    viewport_pointer,
                    window_pointer,
                    suspended,
                    layout.as_ref(),
                );
            }
        })
        .map_err(|error| format!("could not suspend native viewport: {error}"))
    }

    pub fn sync_model(&self, model: ViewportModel) -> Result<(), String> {
        if let Ok(mut state) = self.pick_state.lock() {
            state.scene = model.scene.clone();
            state.body_poses = model.body_poses.clone();
            state.instance_body_poses = model.instance_body_poses.clone();
        }
        self.enqueue(RenderCommand::Model(model))
    }

    pub fn drop_model_session(&self, session_id: String) -> Result<(), String> {
        self.enqueue(RenderCommand::DropModelSession(session_id))
    }

    pub fn rebind_model_session(&self, from: String, to: String) -> Result<(), String> {
        self.enqueue(RenderCommand::RebindModelSession { from, to })
    }

    pub fn set_camera(&self, camera: ViewportCamera) -> Result<(), String> {
        if let Ok(mut state) = self.pick_state.lock() {
            state.camera = camera;
        }
        self.enqueue(RenderCommand::Camera(camera))
    }

    pub fn set_preview(&self, preview: ViewportPreview) -> Result<(), String> {
        const MAX_LINE_FLOATS: usize = 6 * 65_536;
        const MAX_POINT_FLOATS: usize = 3 * 32_768;
        const MAX_TRIANGLE_FLOATS: usize = 9 * 65_536;
        const MAX_ARROWS: usize = 256;
        const MAX_ANNOTATIONS: usize = 2_048;
        let line_floats = preview
            .lines
            .iter()
            .map(|layer| layer.segments.len())
            .sum::<usize>();
        let point_floats = preview
            .points
            .iter()
            .map(|layer| layer.positions.len())
            .sum::<usize>();
        let triangle_floats = preview
            .triangles
            .iter()
            .map(|layer| layer.positions.len())
            .sum::<usize>();
        if preview.lines.len() > 128
            || preview.points.len() > 128
            || preview.triangles.len() > 128
            || preview.arrows.len() > MAX_ARROWS
            || line_floats > MAX_LINE_FLOATS
            || point_floats > MAX_POINT_FLOATS
            || triangle_floats > MAX_TRIANGLE_FLOATS
            || preview.annotations.len() > MAX_ANNOTATIONS
            || preview
                .annotations
                .iter()
                .any(|annotation| annotation.text.len() > 128)
        {
            return Err("native transient presentation is too large".to_string());
        }
        self.enqueue(RenderCommand::Preview(preview))
    }

    pub fn set_presentation(&self, presentation: ViewportPresentation) -> Result<(), String> {
        if let Ok(mut state) = self.pick_state.lock() {
            state.hidden_body_ids = presentation.hidden_body_ids.clone();
            state.body_poses = presentation.body_poses.clone();
            state.instance_body_poses = presentation.instance_body_poses.clone();
        }
        self.enqueue(RenderCommand::Presentation(presentation))
    }

    pub fn pick(
        &self,
        x: f32,
        y: f32,
        camera: Option<ViewportCamera>,
        logical_size: Option<(f32, f32)>,
    ) -> Result<Option<NativePick>, String> {
        let started = Instant::now();
        let result = {
            let state = self
                .pick_state
                .lock()
                .map_err(|_| "native viewport pick state lock poisoned".to_string())?;
            pick_occt_scene(
                &state.scene,
                camera.unwrap_or(state.camera),
                logical_size.unwrap_or(state.logical_size),
                x,
                y,
                &state.hidden_body_ids,
                &state.body_poses,
                &state.instance_body_poses,
            )
        };
        if let Ok(mut current) = self.metrics.lock() {
            current.last_pointer_latency_ms = started.elapsed().as_secs_f64() * 1_000.0;
        }
        Ok(result)
    }

    fn enqueue(&self, command: RenderCommand) -> Result<(), String> {
        let should_schedule = push_render_command(&self.pending, command);
        if !should_schedule {
            return Ok(());
        }
        let runtime = self.runtime.clone();
        let pending = self.pending.clone();
        let metrics = self.metrics.clone();
        if let Err(error) = self.app.run_on_main_thread(move || {
            drain_render_commands(&runtime, &pending, &metrics);
        }) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.scheduled = false;
            }
            return Err(format!("could not schedule native Bevy update: {error}"));
        }
        Ok(())
    }

    pub fn metrics(&self) -> NativeViewportMetrics {
        let mut metrics = self.metrics.lock().expect("viewport metrics lock poisoned");
        if metrics.probe_count == 0 {
            eprintln!(
                "React native-viewport bridge connected (ready={})",
                metrics.ready
            );
        }
        metrics.probe_count += 1;
        NativeViewportMetrics {
            available: true,
            ready: metrics.ready,
            startup_error: metrics.startup_error.clone(),
            backend: NATIVE_BACKEND.to_string(),
            logical_width: metrics.logical_width,
            logical_height: metrics.logical_height,
            scale_factor: metrics.scale_factor,
            physical_width: metrics.physical_width,
            physical_height: metrics.physical_height,
            rendered_frames: metrics.rendered_frames,
            wakeups: metrics.wakeups,
            average_frame_ms: if metrics.rendered_frames == 0 {
                0.0
            } else {
                metrics.total_frame_ms / metrics.rendered_frames as f64
            },
            last_pointer_latency_ms: metrics.last_pointer_latency_ms,
            body_count: metrics.body_count,
            triangle_count: metrics.triangle_count,
        }
    }
}

fn panic_message(payload: Box<dyn Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "unknown renderer panic".to_string()
    }
}

/// Writes only when explicitly requested by a development/CI environment.
/// This contains renderer readiness metadata, never pointer or model data.
fn write_ci_probe(metrics: &MetricsState, status: &str) -> Result<(), String> {
    let Some(path) = std::env::var_os("NBCAD_VIEWPORT_PROBE_FILE") else {
        return Ok(());
    };
    let payload = serde_json::json!({
        "status": status,
        "backend": NATIVE_BACKEND,
        "error": metrics.startup_error,
        "logicalWidth": metrics.logical_width,
        "logicalHeight": metrics.logical_height,
        "scaleFactor": metrics.scale_factor,
        "physicalWidth": metrics.physical_width,
        "physicalHeight": metrics.physical_height,
        "renderedFrames": metrics.rendered_frames,
    });
    let bytes = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("could not encode native viewport probe: {error}"))?;
    std::fs::write(path, bytes)
        .map_err(|error| format!("could not write native viewport probe: {error}"))
}

fn record_startup_failure(metrics: &Arc<Mutex<MetricsState>>, error: String) {
    eprintln!("{error}");
    if let Ok(mut current) = metrics.lock() {
        current.startup_error = Some(error);
        current.ready = false;
        if !current.ci_probe_written {
            match write_ci_probe(&current, "error") {
                Ok(()) => current.ci_probe_written = true,
                Err(probe_error) => eprintln!("{probe_error}"),
            }
        }
    }
}

fn maybe_write_ready_probe(metrics: &Arc<Mutex<MetricsState>>) {
    let Ok(mut current) = metrics.lock() else {
        return;
    };
    if current.ci_probe_written
        || !current.ready
        || current.startup_error.is_some()
        || current.physical_width < 2
        || current.physical_height < 2
        || current.rendered_frames < 2
    {
        return;
    }
    match write_ci_probe(&current, "ready") {
        Ok(()) => current.ci_probe_written = true,
        Err(error) => eprintln!("{error}"),
    }
}

/// Installs a sibling NSView directly below the WKWebView. The NSWindow stays
/// opaque; only the WKWebView's layer gets a viewport-shaped mask.
#[cfg(target_os = "macos")]
unsafe fn install_native_views(
    marker: MainThreadMarker,
    webview_pointer: *mut c_void,
    window_pointer: *mut c_void,
    pointers: Arc<NativePointers>,
) -> Result<(usize, f64), String> {
    if webview_pointer.is_null() || window_pointer.is_null() {
        return Err("Tauri returned a null AppKit handle".to_string());
    }

    let webview = unsafe { &*webview_pointer.cast::<NSView>() };
    let ns_window = unsafe { &*window_pointer.cast::<NSWindow>() };
    let parent = unsafe { webview.superview() }
        .ok_or_else(|| "WKWebView is not attached to an NSView hierarchy".to_string())?;

    // Tauri/Wry may expose the main WKWebView through its child-view path,
    // whose default mask only anchors the top edge. The CAD host requires the
    // WebView and its container to follow every live resize and native
    // full-screen transition, including while the Bevy viewport is unmounted.
    let flexible =
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable;
    parent.setAutoresizingMask(parent.autoresizingMask() | flexible);
    webview.setAutoresizingMask(webview.autoresizingMask() | flexible);
    webview.setWantsLayer(true);
    let viewport = NSView::new(marker);
    viewport.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0)));
    viewport.setWantsLayer(true);
    viewport.setHidden(true);
    parent.addSubview_positioned_relativeTo(&viewport, NSWindowOrderingMode::Below, Some(webview));

    let view_pointer = (&*viewport as *const NSView) as usize;
    pointers
        .webview
        .store(webview_pointer as usize, Ordering::Release);
    pointers.viewport.store(view_pointer, Ordering::Release);
    pointers
        .window
        .store(window_pointer as usize, Ordering::Release);

    Ok((view_pointer, ns_window.backingScaleFactor()))
}

#[cfg(target_os = "macos")]
unsafe fn apply_native_layout(
    webview_pointer: usize,
    viewport_pointer: usize,
    window_pointer: usize,
    layout: &ViewportLayout,
) -> f64 {
    let webview = unsafe { &*(webview_pointer as *const NSView) };
    let viewport = unsafe { &*(viewport_pointer as *const NSView) };
    let ns_window = unsafe { &*(window_pointer as *const NSWindow) };
    let webview_bounds = webview.bounds();
    let Some(parent) = (unsafe { webview.superview() }) else {
        viewport.setHidden(true);
        return ns_window.backingScaleFactor();
    };

    // AppKit can replace the WKWebView's container during native full-screen
    // transitions. Keep the Metal sibling attached to the WebView's current
    // parent; applying a frame converted for a different parent can otherwise
    // expand the viewport across the whole application shell after exit.
    let parent_pointer = (&*parent as *const NSView) as usize;
    let viewport_parent_pointer = unsafe { viewport.superview() }
        .as_deref()
        .map(|view| (view as *const NSView) as usize);
    if viewport_parent_pointer != Some(parent_pointer) {
        viewport.removeFromSuperview();
        parent.addSubview_positioned_relativeTo(
            viewport,
            NSWindowOrderingMode::Below,
            Some(webview),
        );
    }

    let viewport_in_webview = dom_rect_to_view_rect(webview, layout.viewport);
    let viewport_in_parent = webview.convertRect_toView(viewport_in_webview, Some(&parent));
    viewport.setFrame(viewport_in_parent);
    let viewport_visible = layout.viewport.width >= 2.0 && layout.viewport.height >= 2.0;
    viewport.setHidden(!viewport_visible);
    if std::env::var_os("NBCAD_NATIVE_LAYOUT_DEBUG").is_some() {
        eprintln!(
            "native viewport layout: bounds={webview_bounds:?} safe={:?} dom={:?} appkit={viewport_in_webview:?}",
            webview.safeAreaRect(),
            layout.viewport,
        );
    }

    if let Some(webview_layer) = webview.layer() {
        // Drawing (and future non-3D workspaces) unmount the DOM viewport.
        // Leaving an old even-odd mask installed clips the resized WebView to
        // its previous window bounds, producing black strips after entering
        // full screen. With no viewport hole, no mask is needed at all.
        if !viewport_visible {
            webview_layer.setMask(None);
            return ns_window.backingScaleFactor();
        }
        let layer_bounds = webview_layer.bounds();
        let mask = CAShapeLayer::layer();
        mask.setFrame(layer_bounds);

        let path = CGMutablePath::new();
        let outer = webview.convertRectToLayer(webview_bounds);
        let hole = webview.convertRectToLayer(viewport_in_webview);
        unsafe {
            CGMutablePath::add_rect(Some(&path), std::ptr::null(), outer);
            CGMutablePath::add_rect(Some(&path), std::ptr::null(), hole);
        }

        // Overlay rectangles are clipped to the viewport hole before being
        // toggled back on. React intentionally sends non-overlapping islands.
        for overlay in &layout.overlays {
            if let Some(intersection) = intersect_rect(*overlay, layout.viewport) {
                let overlay_rect =
                    webview.convertRectToLayer(dom_rect_to_view_rect(webview, intersection));
                unsafe {
                    if intersection.corner_radius > 0.5 {
                        CGMutablePath::add_rounded_rect(
                            Some(&path),
                            std::ptr::null(),
                            overlay_rect,
                            intersection.corner_radius,
                            intersection.corner_radius,
                        );
                    } else {
                        CGMutablePath::add_rect(Some(&path), std::ptr::null(), overlay_rect);
                    }
                }
            }
        }

        mask.setPath(Some(&path));
        mask.setFillRule(kCAFillRuleEvenOdd);
        unsafe {
            webview_layer.setMask(Some(&mask));
        }
    }

    ns_window.backingScaleFactor()
}

#[cfg(target_os = "macos")]
unsafe fn set_native_viewport_suspended(
    webview_pointer: usize,
    viewport_pointer: usize,
    window_pointer: usize,
    suspended: bool,
    layout: Option<&ViewportLayout>,
) {
    let webview = unsafe { &*(webview_pointer as *const NSView) };
    let viewport = unsafe { &*(viewport_pointer as *const NSView) };
    if suspended {
        viewport.setHidden(true);
        if let Some(layer) = webview.layer() {
            layer.setMask(None);
        }
    } else if let Some(layout) = layout {
        let _ = unsafe {
            apply_native_layout(
                webview_pointer,
                viewport_pointer,
                window_pointer,
                layout,
            )
        };
    }
}

#[cfg(target_os = "macos")]
fn dom_rect_to_view_rect(view: &NSView, rect: ViewportRect) -> NSRect {
    let bounds = view.bounds();
    // `getBoundingClientRect()` is relative to WebKit's unobscured content
    // viewport. In a normal macOS window the WKWebView can still extend under
    // the title bar, so its NSView bounds are taller than that DOM viewport by
    // the title-bar safe-area inset. Full screen has no such inset. Mapping
    // against the safe-area rect keeps both the Metal sibling and every DOM
    // mask island on the same origin through window/full-screen transitions.
    let content = view.safeAreaRect();
    dom_rect_to_content_rect(bounds, content, view.isFlipped(), rect)
}

#[cfg(target_os = "macos")]
fn dom_rect_to_content_rect(
    bounds: NSRect,
    content: NSRect,
    flipped: bool,
    rect: ViewportRect,
) -> NSRect {
    let content = if content.size.width > 0.0 && content.size.height > 0.0 {
        content
    } else {
        bounds
    };
    let y = if flipped {
        content.origin.y + rect.y
    } else {
        content.origin.y + content.size.height - rect.y - rect.height
    };
    NSRect::new(
        NSPoint::new(content.origin.x + rect.x, y),
        NSSize::new(rect.width.max(0.0), rect.height.max(0.0)),
    )
}

#[cfg(target_os = "windows")]
static WINDOWS_VIEWPORT_CLASS: OnceLock<Result<(), u32>> = OnceLock::new();

#[cfg(target_os = "windows")]
const WINDOWS_WM_MOUSELEAVE: u32 = 0x02A3;
#[cfg(target_os = "windows")]
const WINDOWS_INPUT_PREFIX: &str = "__nbcad_native_input__|";

#[cfg(target_os = "windows")]
struct WindowsInputBridge {
    webview: ICoreWebView2,
    tracking_mouse_leave: bool,
    last_x: i32,
    last_y: i32,
}

#[cfg(target_os = "windows")]
impl WindowsInputBridge {
    fn post(
        &self,
        kind: char,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        button: i32,
        buttons: u32,
        delta: i32,
    ) {
        let payload = format!(
            "{WINDOWS_INPUT_PREFIX}{kind}|{x}|{y}|{width}|{height}|{button}|{buttons}|{}|{delta}",
            windows_input_modifiers()
        );
        let wide = payload
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        if let Err(error) = unsafe { self.webview.PostWebMessageAsString(PCWSTR(wide.as_ptr())) } {
            if std::env::var_os("NBCAD_NATIVE_INPUT_DEBUG").is_some() {
                eprintln!("native viewport input bridge failed: {error}");
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_input_modifiers() -> u32 {
    let pressed = |key: u16| unsafe { GetKeyState(key as i32) } < 0;
    u32::from(pressed(VK_SHIFT))
        | (u32::from(pressed(VK_CONTROL)) << 1)
        | (u32::from(pressed(VK_MENU)) << 2)
        | (u32::from(pressed(VK_LWIN) || pressed(VK_RWIN)) << 3)
}

#[cfg(target_os = "windows")]
fn windows_dom_buttons(wparam: WPARAM) -> u32 {
    let keys = wparam as u32;
    u32::from(keys & 0x0001 != 0)
        | (u32::from(keys & 0x0002 != 0) << 1)
        | (u32::from(keys & 0x0010 != 0) << 2)
        | (u32::from(keys & 0x0020 != 0) << 3)
        | (u32::from(keys & 0x0040 != 0) << 4)
}

#[cfg(target_os = "windows")]
fn windows_lparam_point(lparam: LPARAM) -> POINT {
    let packed = lparam as u32;
    POINT {
        x: packed as u16 as i16 as i32,
        y: (packed >> 16) as u16 as i16 as i32,
    }
}

#[cfg(target_os = "windows")]
unsafe fn post_windows_input(
    hwnd: HWND,
    kind: char,
    point: POINT,
    button: i32,
    buttons: u32,
    delta: i32,
) {
    let pointer = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut WindowsInputBridge;
    if pointer.is_null() {
        return;
    }
    let mut bounds = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut bounds) } == 0 {
        return;
    }
    let bridge = unsafe { &mut *pointer };
    bridge.last_x = point.x;
    bridge.last_y = point.y;
    bridge.post(
        kind,
        point.x,
        point.y,
        (bounds.right - bounds.left).max(1),
        (bounds.bottom - bounds.top).max(1),
        button,
        buttons,
        delta,
    );
}

#[cfg(target_os = "windows")]
unsafe fn post_windows_cancel(hwnd: HWND) {
    let pointer = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut WindowsInputBridge;
    if pointer.is_null() {
        return;
    }
    let bridge = unsafe { &*pointer };
    unsafe {
        post_windows_input(
            hwnd,
            'c',
            POINT {
                x: bridge.last_x,
                y: bridge.last_y,
            },
            -1,
            0,
            0,
        )
    };
}

#[cfg(target_os = "windows")]
unsafe fn begin_windows_mouse_leave_tracking(hwnd: HWND) {
    let pointer = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut WindowsInputBridge;
    if pointer.is_null() || unsafe { &*pointer }.tracking_mouse_leave {
        return;
    }
    let mut tracking = TRACKMOUSEEVENT {
        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
        dwFlags: TME_LEAVE,
        hwndTrack: hwnd,
        dwHoverTime: 0,
    };
    if unsafe { TrackMouseEvent(&mut tracking) } != 0 {
        unsafe { &mut *pointer }.tracking_mouse_leave = true;
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn windows_viewport_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        // WebView2's actual renderer HWND lives on another UI thread, so
        // HTTRANSPARENT cannot walk from this sibling all the way to the DOM.
        // Own the hit and relay it through CoreWebView2; the page dispatches it
        // onto the existing transparent interaction surface.
        WM_NCHITTEST => HTCLIENT as LRESULT,
        WM_MOUSEMOVE => {
            unsafe { begin_windows_mouse_leave_tracking(hwnd) };
            unsafe {
                post_windows_input(
                    hwnd,
                    'm',
                    windows_lparam_point(lparam),
                    -1,
                    windows_dom_buttons(wparam),
                    0,
                )
            };
            0
        }
        WM_LBUTTONDOWN | WM_MBUTTONDOWN | WM_RBUTTONDOWN | WM_LBUTTONDBLCLK | WM_MBUTTONDBLCLK
        | WM_RBUTTONDBLCLK => {
            unsafe {
                SetCapture(hwnd);
            }
            let button = match message {
                WM_LBUTTONDOWN | WM_LBUTTONDBLCLK => 0,
                WM_MBUTTONDOWN | WM_MBUTTONDBLCLK => 1,
                _ => 2,
            };
            let kind = if matches!(
                message,
                WM_LBUTTONDBLCLK | WM_MBUTTONDBLCLK | WM_RBUTTONDBLCLK
            ) {
                'b'
            } else {
                'd'
            };
            unsafe {
                post_windows_input(
                    hwnd,
                    kind,
                    windows_lparam_point(lparam),
                    button,
                    windows_dom_buttons(wparam),
                    0,
                )
            };
            0
        }
        WM_LBUTTONUP | WM_MBUTTONUP | WM_RBUTTONUP => {
            let button = match message {
                WM_LBUTTONUP => 0,
                WM_MBUTTONUP => 1,
                _ => 2,
            };
            let buttons = windows_dom_buttons(wparam);
            unsafe {
                post_windows_input(hwnd, 'u', windows_lparam_point(lparam), button, buttons, 0)
            };
            if buttons == 0 {
                unsafe {
                    ReleaseCapture();
                }
            }
            0
        }
        WM_MOUSEWHEEL => {
            let mut point = windows_lparam_point(lparam);
            unsafe {
                ScreenToClient(hwnd, &mut point);
            }
            let delta = ((wparam >> 16) as u16 as i16) as i32;
            unsafe {
                post_windows_input(
                    hwnd,
                    'v',
                    point,
                    -1,
                    windows_dom_buttons(wparam & 0xffff),
                    delta,
                )
            };
            0
        }
        // Wheel tilt is intentionally consumed. Only the center-wheel press
        // participates in CAD navigation on Windows.
        WM_MOUSEHWHEEL => 0,
        WM_CANCELMODE | WM_CAPTURECHANGED => {
            unsafe { post_windows_cancel(hwnd) };
            0
        }
        WINDOWS_WM_MOUSELEAVE => {
            let pointer =
                unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut WindowsInputBridge;
            if !pointer.is_null() {
                unsafe { &mut *pointer }.tracking_mouse_leave = false;
            }
            unsafe { post_windows_input(hwnd, 'l', POINT::default(), -1, 0, 0) };
            0
        }
        // The swapchain owns every visible pixel; suppress background erases
        // that would otherwise flash while resizing.
        WM_ERASEBKGND => 1,
        WM_NCDESTROY => {
            let pointer =
                unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut WindowsInputBridge;
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
            if !pointer.is_null() {
                drop(unsafe { Box::from_raw(pointer) });
            }
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

#[cfg(target_os = "windows")]
fn register_windows_viewport_class() -> Result<(), String> {
    let registration = WINDOWS_VIEWPORT_CLASS.get_or_init(|| unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        if module.is_null() {
            return Err(GetLastError());
        }
        let class = WNDCLASSW {
            style: CS_OWNDC | CS_DBLCLKS,
            lpfnWndProc: Some(windows_viewport_proc),
            hInstance: module,
            lpszClassName: windows_sys::w!("noBS.CAD.BevyViewport"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            let error = GetLastError();
            if error != ERROR_CLASS_ALREADY_EXISTS {
                return Err(error);
            }
        }
        Ok(())
    });
    match *registration {
        Ok(()) => Ok(()),
        Err(code) => Err(format!(
            "could not register the native viewport window class (Win32 error {code})"
        )),
    }
}

/// Installs an opaque Win32 child above Wry's WebView2 container. Its window
/// region is cut around visible DOM overlay islands, while viewport input is
/// relayed to the page through CoreWebView2. This avoids both transparent
/// top-level windows and a transparent WebView2 compositor.
#[cfg(target_os = "windows")]
unsafe fn install_native_views(
    webview_pointer: *mut c_void,
    pointers: Arc<NativePointers>,
    core_webview: ICoreWebView2,
) -> Result<(usize, f64), String> {
    if webview_pointer.is_null() {
        return Err("WebView2 returned a null container HWND".to_string());
    }
    let webview = webview_pointer as HWND;
    let window = unsafe { GetParent(webview) };
    if window.is_null() {
        return Err("WebView2 container is not attached to a Win32 parent".to_string());
    }
    register_windows_viewport_class()?;

    let module = unsafe { GetModuleHandleW(std::ptr::null()) };
    if module.is_null() {
        return Err(format!(
            "could not resolve the application module (Win32 error {})",
            unsafe { GetLastError() }
        ));
    }
    let viewport = unsafe {
        CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_NOPARENTNOTIFY,
            windows_sys::w!("noBS.CAD.BevyViewport"),
            std::ptr::null(),
            WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
            0,
            0,
            1,
            1,
            window,
            std::ptr::null_mut(),
            module,
            std::ptr::null(),
        )
    };
    if viewport.is_null() {
        return Err(format!(
            "could not create the native viewport HWND (Win32 error {})",
            unsafe { GetLastError() }
        ));
    }
    let input_bridge = Box::new(WindowsInputBridge {
        webview: core_webview,
        tracking_mouse_leave: false,
        last_x: 0,
        last_y: 0,
    });
    unsafe {
        SetWindowLongPtrW(
            viewport,
            GWLP_USERDATA,
            Box::into_raw(input_bridge) as isize,
        );
    }

    pointers.webview.store(webview as usize, Ordering::Release);
    pointers
        .viewport
        .store(viewport as usize, Ordering::Release);
    pointers.window.store(window as usize, Ordering::Release);

    Ok((viewport as usize, windows_scale_factor(window)))
}

#[cfg(target_os = "windows")]
fn windows_scale_factor(window: HWND) -> f64 {
    let dpi = unsafe { GetDpiForWindow(window) };
    if dpi == 0 {
        1.0
    } else {
        dpi as f64 / 96.0
    }
}

#[cfg(target_os = "windows")]
unsafe fn apply_native_layout(
    _webview_pointer: usize,
    viewport_pointer: usize,
    window_pointer: usize,
    layout: &ViewportLayout,
) -> f64 {
    let viewport = viewport_pointer as HWND;
    let window = window_pointer as HWND;
    let scale_factor = windows_scale_factor(window);
    let rect = layout.viewport;
    let visible = rect.width >= 2.0 && rect.height >= 2.0;
    if !visible {
        unsafe {
            ShowWindow(viewport, SW_HIDE);
        }
        return scale_factor;
    }

    let x = (rect.x * scale_factor).round() as i32;
    let y = (rect.y * scale_factor).round() as i32;
    let width = (rect.width * scale_factor).round().max(1.0) as i32;
    let height = (rect.height * scale_factor).round().max(1.0) as i32;
    let positioned = unsafe {
        SetWindowPos(
            viewport,
            HWND_TOP,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
        )
    };
    if positioned == 0 {
        eprintln!("native viewport resize failed (Win32 error {})", unsafe {
            GetLastError()
        });
    }

    apply_windows_viewport_region(viewport, layout, width, height, scale_factor);
    unsafe {
        ShowWindow(viewport, SW_SHOWNA);
    }
    scale_factor
}

#[cfg(target_os = "windows")]
unsafe fn set_native_viewport_suspended(
    webview_pointer: usize,
    viewport_pointer: usize,
    window_pointer: usize,
    suspended: bool,
    layout: Option<&ViewportLayout>,
) {
    let viewport = viewport_pointer as HWND;
    if suspended {
        unsafe {
            ShowWindow(viewport, SW_HIDE);
        }
    } else if let Some(layout) = layout {
        let _ = unsafe {
            apply_native_layout(
                webview_pointer,
                viewport_pointer,
                window_pointer,
                layout,
            )
        };
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_viewport_region(
    viewport: HWND,
    layout: &ViewportLayout,
    width: i32,
    height: i32,
    scale_factor: f64,
) {
    let region = unsafe { CreateRectRgn(0, 0, width, height) };
    if region.is_null() {
        return;
    }

    for overlay in &layout.overlays {
        let Some(intersection) = intersect_rect(*overlay, layout.viewport) else {
            continue;
        };
        let left = ((intersection.x - layout.viewport.x) * scale_factor)
            .floor()
            .clamp(0.0, width as f64) as i32;
        let top = ((intersection.y - layout.viewport.y) * scale_factor)
            .floor()
            .clamp(0.0, height as f64) as i32;
        let right = ((intersection.x + intersection.width - layout.viewport.x) * scale_factor)
            .ceil()
            .clamp(0.0, width as f64) as i32;
        let bottom = ((intersection.y + intersection.height - layout.viewport.y) * scale_factor)
            .ceil()
            .clamp(0.0, height as f64) as i32;
        if right <= left || bottom <= top {
            continue;
        }
        let corner_diameter = (intersection.corner_radius * 2.0 * scale_factor).round() as i32;
        let overlay_region = if corner_diameter > 1 {
            unsafe {
                CreateRoundRectRgn(left, top, right, bottom, corner_diameter, corner_diameter)
            }
        } else {
            unsafe { CreateRectRgn(left, top, right, bottom) }
        };
        if overlay_region.is_null() {
            continue;
        }
        unsafe {
            CombineRgn(region, region, overlay_region, RGN_DIFF);
            DeleteObject(overlay_region);
        }
    }

    // SetWindowRgn takes ownership on success.
    if unsafe { SetWindowRgn(viewport, region, 1) } == 0 {
        unsafe {
            DeleteObject(region);
        }
    }
}

fn intersect_rect(a: ViewportRect, b: ViewportRect) -> Option<ViewportRect> {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = (a.x + a.width).min(b.x + b.width);
    let bottom = (a.y + a.height).min(b.y + b.height);
    (right > left && bottom > top).then_some(ViewportRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        corner_radius: if left == a.x
            && top == a.y
            && right == a.x + a.width
            && bottom == a.y + a.height
        {
            a.corner_radius
                .min((right - left) / 2.0)
                .min((bottom - top) / 2.0)
        } else {
            0.0
        },
    })
}

#[derive(Debug)]
struct NativeViewHandle(usize);

unsafe impl Send for NativeViewHandle {}
unsafe impl Sync for NativeViewHandle {}

impl HasWindowHandle for NativeViewHandle {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        #[cfg(target_os = "macos")]
        {
            let pointer =
                NonNull::new(self.0 as *mut c_void).expect("NSView handle cannot be null");
            let raw = RawWindowHandle::AppKit(AppKitWindowHandle::new(pointer));
            Ok(unsafe { WindowHandle::borrow_raw(raw) })
        }
        #[cfg(target_os = "windows")]
        {
            let pointer = NonZeroIsize::new(self.0 as isize).expect("viewport HWND cannot be null");
            let module = unsafe { GetModuleHandleW(std::ptr::null()) };
            let mut handle = Win32WindowHandle::new(pointer);
            // Vulkan requires this field. Without it wgpu can create only a
            // DX12 surface, so Windows systems whose best compatible adapter
            // is exposed through Vulkan end up with no usable viewport.
            handle.hinstance = NonZeroIsize::new(module as isize);
            let raw = RawWindowHandle::Win32(handle);
            Ok(unsafe { WindowHandle::borrow_raw(raw) })
        }
    }
}

impl HasDisplayHandle for NativeViewHandle {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        #[cfg(target_os = "macos")]
        {
            Ok(DisplayHandle::appkit())
        }
        #[cfg(target_os = "windows")]
        {
            Ok(DisplayHandle::windows())
        }
    }
}

#[derive(Resource, Default)]
struct ModelResource {
    session_id: String,
    geometry_revision: u64,
    scene: SolidSceneDto,
    active_sketch: Option<SketchDto>,
    finished_sketches: Vec<SketchDto>,
    datum_planes: Vec<DatumPlaneDefinitionDto>,
    profile_catalog: Vec<ProfileCatalogItemDto>,
    body_appearances: Vec<BodyAppearance>,
    body_poses: Vec<BodyPoseDto>,
    instance_body_poses: Vec<InstanceBodyPoseDto>,
    instance_revision: u64,
    revision: u64,
}

#[derive(Resource, Default)]
struct ModelGeometryCache(HashMap<String, (u64, u64)>);

#[derive(Resource)]
struct CameraResource {
    camera: ViewportCamera,
    revision: u64,
}

#[derive(Resource, Default)]
struct PreviewResource {
    value: ViewportPreview,
    revision: u64,
    /// Changes only when GPU mesh content changes. Screen annotations and
    /// sketch gizmos may update at camera frequency without reallocating the
    /// retained profile/tool meshes.
    mesh_revision: u64,
}

#[derive(Resource, Clone, Copy, Default)]
struct PaletteResource(ViewportPalette);

#[derive(Resource)]
struct HudResource {
    hud: ViewportHud,
    revision: u64,
}

#[derive(Resource, Clone, Copy)]
struct ViewportSizeResource {
    logical_width: f32,
    logical_height: f32,
}

impl Default for ViewportSizeResource {
    fn default() -> Self {
        Self {
            logical_width: INITIAL_PHYSICAL_SIZE as f32,
            logical_height: INITIAL_PHYSICAL_SIZE as f32,
        }
    }
}

#[derive(Resource, Default)]
struct PresentationResource(ViewportPresentation);

impl Default for HudResource {
    fn default() -> Self {
        Self {
            hud: ViewportHud::default(),
            revision: 1,
        }
    }
}

impl Default for CameraResource {
    fn default() -> Self {
        Self {
            camera: ViewportCamera::default(),
            revision: 1,
        }
    }
}

#[derive(Resource, Default)]
struct RenderedRevisions {
    model: u64,
    camera: u64,
    hud: u64,
    annotations: u64,
    preview_meshes: u64,
}

#[derive(Component)]
struct NativeCadBody {
    body_id: u64,
    occurrence_id: Option<u64>,
}

#[derive(Component)]
struct NativeCadFace {
    body_id: u64,
    occurrence_id: Option<u64>,
    face_id: u64,
    boundary: Vec<(Vec3, Vec3)>,
}

#[derive(Component)]
struct NativeCadFaceOverlay {
    body_id: u64,
    occurrence_id: Option<u64>,
}

#[derive(Component)]
struct NativeModelGeometry {
    session_id: String,
    geometry_revision: u64,
    instance_revision: u64,
}

#[derive(Component)]
struct NativeCadCamera;

/// Common marker for the model camera and the depth-independent transient
/// overlay camera. Both always receive exactly the same projection.
#[derive(Component)]
struct NativeViewportCamera;

#[derive(Component)]
struct NativeOverlayCamera;

#[derive(Component)]
struct NativePreviewMesh;

#[derive(Clone, Copy)]
enum NativePreviewArrowPartKind {
    Shaft,
    Head,
    Base,
}

/// Semantic arrow data retained on each unit primitive. Camera movement only
/// updates these transforms; it never allocates a new Mesh or Material.
#[derive(Component, Clone, Copy)]
struct NativePreviewArrowPart {
    start: Vec3,
    end: Vec3,
    width: f32,
    kind: NativePreviewArrowPartKind,
}

#[derive(Component)]
struct CadKeyLight;

#[derive(Component)]
struct CadFillLight;

#[derive(Component)]
struct NativeDatumPlane {
    datum_id: u64,
}

#[derive(Component, Clone, Copy)]
struct NativeOriginPlane {
    plane: ViewportOriginPlane,
}

#[derive(Component)]
struct NativeAnnotationRoot;

#[derive(Default, Reflect, GizmoConfigGroup)]
struct CadHighlightGizmos;

#[derive(Default, Reflect, GizmoConfigGroup)]
struct CadSketchGizmos;

#[derive(Default, Reflect, GizmoConfigGroup)]
struct CadSketchPointOutlineGizmos;

#[derive(Default, Reflect, GizmoConfigGroup)]
struct CadSketchPointGizmos;

fn build_bevy_app(view_pointer: usize, scale_factor: f32) -> Result<bevy::app::App, String> {
    let mut app = bevy::app::App::new();
    let plugins = DefaultPlugins
        .build()
        .set(WindowPlugin {
            primary_window: Some(Window {
                title: "noBS CAD embedded viewport".to_string(),
                resolution: WindowResolution::new(INITIAL_PHYSICAL_SIZE, INITIAL_PHYSICAL_SIZE)
                    .with_scale_factor_override(scale_factor.max(1.0)),
                visible: true,
                present_mode: PresentMode::AutoNoVsync,
                desired_maximum_frame_latency: NonZeroU32::new(2),
                ..default()
            }),
            primary_cursor_options: None,
            exit_condition: ExitCondition::DontExit,
            close_when_requested: false,
        })
        .set(RenderPlugin {
            // This renderer advances only in response to bridge commands. On
            // Windows, asynchronously compiled PBR/UI pipelines can otherwise
            // finish after the two-frame render burst and remain invisible
            // until unrelated input happens to wake Bevy again. Blocking the
            // pipeline queue keeps origin-plane fills and native HUD chrome
            // deterministic. Bevy ignores this setting on macOS.
            synchronous_pipeline_compilation: true,
            ..default()
        });
    app.add_plugins(plugins)
        .init_gizmo_group::<CadHighlightGizmos>()
        .init_gizmo_group::<CadSketchGizmos>()
        .init_gizmo_group::<CadSketchPointOutlineGizmos>()
        .init_gizmo_group::<CadSketchPointGizmos>();

    let (window_entity, holder) = {
        let world = app.world_mut();
        let mut query =
            world.query_filtered::<(Entity, &RawHandleWrapperHolder), With<PrimaryWindow>>();
        let (entity, holder) = query
            .single(world)
            .map_err(|error| format!("Bevy primary window entity is missing: {error}"))?;
        (entity, holder.clone())
    };

    let wrapped_view = WindowWrapper::new(NativeViewHandle(view_pointer));
    let raw_handle = RawHandleWrapper::new(&wrapped_view)
        .map_err(|error| format!("could not wrap the embedded native view: {error}"))?;
    *holder
        .0
        .lock()
        .map_err(|_| "Bevy raw-window handle lock poisoned".to_string())? =
        Some(raw_handle.clone());
    app.world_mut().entity_mut(window_entity).insert(raw_handle);

    let initial_palette = ViewportPalette::default();
    app.insert_resource(ClearColor(rgb(initial_palette.background)))
        .insert_resource(GlobalAmbientLight {
            color: Color::srgb(1.0, 1.0, 1.0),
            brightness: 900.0,
            ..default()
        })
        .init_resource::<ModelResource>()
        .init_resource::<ModelGeometryCache>()
        .init_resource::<CameraResource>()
        .init_resource::<PreviewResource>()
        .init_resource::<PaletteResource>()
        .init_resource::<HudResource>()
        .init_resource::<ViewportSizeResource>()
        .init_resource::<PresentationResource>()
        .init_resource::<RenderedRevisions>()
        .init_resource::<ViewportUiAssets>()
        .add_systems(Startup, (ui::load_system_font, setup_scene).chain())
        .add_systems(
            Update,
            (
                rebuild_occt_meshes,
                apply_camera,
                resize_reference_planes,
                apply_native_presentation_styles,
                rebuild_native_face_overlays,
                apply_body_poses,
                rebuild_native_preview_meshes,
                update_native_preview_arrows,
                rebuild_native_annotations,
                rebuild_native_hud,
                update_native_hud_orientation,
                draw_cad_gizmos,
            )
                .chain(),
        );

    app.finish();
    app.cleanup();
    Ok(app)
}

fn setup_scene(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut gizmo_config: ResMut<GizmoConfigStore>,
) {
    let (highlight_config, _) = gizmo_config.config_mut::<CadHighlightGizmos>();
    highlight_config.line.width = HIGHLIGHT_LINE_WIDTH;
    highlight_config.depth_bias = -1.0;
    let (sketch_config, _) = gizmo_config.config_mut::<CadSketchGizmos>();
    sketch_config.line.width = SKETCH_LINE_WIDTH;
    // Visible sketches are reference graphics, not occluded model edges.
    // Match the browser renderer's depthTest:false contract so a sketch on a
    // face (or behind a body) remains readable until its eye toggle is hidden.
    sketch_config.depth_bias = SKETCH_DEPTH_BIAS;
    let (point_outline_config, _) = gizmo_config.config_mut::<CadSketchPointOutlineGizmos>();
    point_outline_config.line.width = SKETCH_POINT_OUTLINE_WIDTH;
    point_outline_config.depth_bias = SKETCH_POINT_OUTLINE_DEPTH_BIAS;
    let (point_config, _) = gizmo_config.config_mut::<CadSketchPointGizmos>();
    point_config.line.width = SKETCH_LINE_WIDTH;
    point_config.depth_bias = SKETCH_DEPTH_BIAS;

    let camera = ViewportCamera::default();
    let (key_transform, fill_transform) = camera_relative_light_transforms(camera);
    commands.spawn((
        Name::new("React-synchronized CAD camera"),
        NativeViewportCamera,
        NativeCadCamera,
        Camera3d::default(),
        BoxShadowSamples(6),
        Projection::Perspective(PerspectiveProjection {
            fov: camera.vertical_fov_degrees.to_radians(),
            near: 0.1,
            far: 20_000.0,
            ..default()
        }),
        camera_transform(camera),
    ));

    commands.spawn((
        Name::new("CAD transient overlay camera"),
        NativeViewportCamera,
        NativeOverlayCamera,
        IsDefaultUiCamera,
        Camera3d::default(),
        Camera {
            order: 1,
            clear_color: ClearColorConfig::None,
            ..default()
        },
        Projection::Perspective(PerspectiveProjection {
            fov: camera.vertical_fov_degrees.to_radians(),
            near: 0.1,
            far: 20_000.0,
            ..default()
        }),
        camera_transform(camera),
        RenderLayers::layer(1),
    ));

    commands.spawn((
        Name::new("CAD key light"),
        CadKeyLight,
        DirectionalLight {
            color: Color::srgb(1.0, 1.0, 1.0),
            illuminance: 2_200.0,
            shadow_maps_enabled: false,
            ..default()
        },
        key_transform,
    ));
    commands.spawn((
        Name::new("CAD fill light"),
        CadFillLight,
        DirectionalLight {
            color: Color::srgb(1.0, 1.0, 1.0),
            illuminance: 2_200.0,
            shadow_maps_enabled: false,
            ..default()
        },
        fill_transform,
    ));

    for (name, basis, color) in origin_plane_bases() {
        let plane = match name {
            "XY" => ViewportOriginPlane::Xy,
            "XZ" => ViewportOriginPlane::Xz,
            _ => ViewportOriginPlane::Yz,
        };
        commands.spawn((
            Name::new(format!("Origin plane {name}")),
            NativeOriginPlane { plane },
            Visibility::Hidden,
            Mesh3d(meshes.add(reference_plane_mesh(&basis, REFERENCE_PLANE_HALF_SIZE))),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: color,
                alpha_mode: AlphaMode::Blend,
                unlit: true,
                cull_mode: None,
                ..default()
            })),
        ));
    }
}

fn rebuild_occt_meshes(
    mut commands: Commands,
    model: Res<ModelResource>,
    mut revisions: ResMut<RenderedRevisions>,
    mut cache: ResMut<ModelGeometryCache>,
    mut existing: Query<(
        Entity,
        &NativeModelGeometry,
        &mut Visibility,
        Option<&Mesh3d>,
        Option<&MeshMaterial3d<StandardMaterial>>,
    )>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    palette: Res<PaletteResource>,
) {
    if revisions.model == model.revision {
        return;
    }
    revisions.model = model.revision;

    for (entity, geometry, mut visibility, mesh, material) in &mut existing {
        if geometry.session_id == model.session_id {
            if geometry.geometry_revision != model.geometry_revision
                || geometry.instance_revision != model.instance_revision
            {
                if let Some(mesh) = mesh {
                    meshes.remove(&mesh.0);
                }
                if let Some(material) = material {
                    materials.remove(&material.0);
                }
                commands.entity(entity).despawn();
            }
        } else {
            *visibility = Visibility::Hidden;
        }
    }

    let cache_key = (model.geometry_revision, model.instance_revision);
    if cache.0.get(&model.session_id) == Some(&cache_key) {
        return;
    }
    cache.0.insert(model.session_id.clone(), cache_key);

    for body in &model.scene.bodies {
        let instances = if model.instance_body_poses.is_empty() {
            vec![None]
        } else {
            model
                .instance_body_poses
                .iter()
                .filter(|instance| instance.body_id == body.id && instance.visible)
                .map(|instance| Some(instance.occurrence_id.0))
                .collect::<Vec<_>>()
        };
        if instances.is_empty() {
            continue;
        }
        let mesh_handle = body_mesh(body).map(|mesh| meshes.add(mesh));
        for occurrence_id in instances {
            let transform = instance_body_pose_transform(
                &model.instance_body_poses,
                &model.body_poses,
                body.id.0,
                occurrence_id,
            );
            if let Some(mesh_handle) = &mesh_handle {
                commands.spawn((
                    Name::new(format!(
                        "OCCT body {} occurrence {:?} ({})",
                        body.id.0, occurrence_id, body.name
                    )),
                    NativeCadBody {
                        body_id: body.id.0,
                        occurrence_id,
                    },
                    NativeModelGeometry {
                        session_id: model.session_id.clone(),
                        geometry_revision: model.geometry_revision,
                        instance_revision: model.instance_revision,
                    },
                    Mesh3d(mesh_handle.clone()),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: body_appearance_color(&model, body.id.0, palette.0.body),
                        metallic: 0.0,
                        perceptual_roughness: 0.86,
                        cull_mode: None,
                        ..default()
                    })),
                    transform,
                ));
            }
            for face in &body.faces {
                commands.spawn((
                    Name::new(format!(
                        "OCCT face metadata {} on {} occurrence {:?} ({})",
                        face.id.0, body.id.0, occurrence_id, body.name
                    )),
                    NativeCadFace {
                        body_id: body.id.0,
                        occurrence_id,
                        face_id: face.id.0,
                        boundary: face_boundary_segments(body, face),
                    },
                    NativeModelGeometry {
                        session_id: model.session_id.clone(),
                        geometry_revision: model.geometry_revision,
                        instance_revision: model.instance_revision,
                    },
                    Visibility::Inherited,
                    transform,
                ));
            }
        }
    }

    for plane in &model.datum_planes {
        commands.spawn((
            Name::new(format!("Construction plane {}", plane.name)),
            NativeDatumPlane {
                datum_id: plane.datum_id.0,
            },
            NativeModelGeometry {
                session_id: model.session_id.clone(),
                geometry_revision: model.geometry_revision,
                instance_revision: model.instance_revision,
            },
            Mesh3d(meshes.add(reference_plane_mesh(
                &plane.basis,
                REFERENCE_PLANE_HALF_SIZE,
            ))),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgba(0.85, 0.65, 0.30, 0.08),
                alpha_mode: AlphaMode::Blend,
                unlit: true,
                cull_mode: None,
                ..default()
            })),
        ));
    }
}

fn apply_camera(
    camera: Res<CameraResource>,
    mut revisions: ResMut<RenderedRevisions>,
    mut query: Query<(&mut Transform, &mut Projection), With<NativeViewportCamera>>,
    mut key_lights: Query<
        &mut Transform,
        (
            With<CadKeyLight>,
            Without<CadFillLight>,
            Without<NativeViewportCamera>,
        ),
    >,
    mut fill_lights: Query<
        &mut Transform,
        (
            With<CadFillLight>,
            Without<CadKeyLight>,
            Without<NativeViewportCamera>,
        ),
    >,
) {
    if revisions.camera == camera.revision {
        return;
    }
    revisions.camera = camera.revision;
    for (mut transform, mut projection) in &mut query {
        *transform = camera_transform(camera.camera);
        if let Projection::Perspective(perspective) = &mut *projection {
            perspective.fov = camera
                .camera
                .vertical_fov_degrees
                .clamp(1.0, 150.0)
                .to_radians();
        }
    }
    let (key_transform, fill_transform) = camera_relative_light_transforms(camera.camera);
    for mut transform in &mut key_lights {
        *transform = key_transform;
    }
    for mut transform in &mut fill_lights {
        *transform = fill_transform;
    }
}

/// A neutral, camera-relative two-light studio rig. The equal left/right
/// offsets remove the arbitrary world-side darkening that makes a CAD part
/// appear fixed under a room light while preserving gentle normal cues.
fn camera_relative_light_transforms(camera: ViewportCamera) -> (Transform, Transform) {
    let target = Vec3::from_array(camera.target);
    let eye = Vec3::from_array(camera.position);
    let view = (eye - target).normalize_or_zero();
    let view = if view.length_squared() < 1.0e-8 {
        Vec3::Y
    } else {
        view
    };
    let up_hint = Vec3::from_array(camera.up).normalize_or_zero();
    let up_hint = if up_hint.length_squared() < 1.0e-8 {
        Vec3::Z
    } else {
        up_hint
    };
    let right = view.cross(up_hint).normalize_or_zero();
    let right = if right.length_squared() < 1.0e-8 {
        view.any_orthonormal_vector()
    } else {
        right
    };
    let rig_distance = eye.distance(target).max(100.0);
    let key_position = target + (view + right * 0.28).normalize() * rig_distance;
    let fill_position = target + (view - right * 0.28).normalize() * rig_distance;
    (
        Transform::from_translation(key_position)
            .looking_at(target, stable_view_up(target - key_position, up_hint)),
        Transform::from_translation(fill_position)
            .looking_at(target, stable_view_up(target - fill_position, up_hint)),
    )
}

fn world_per_pixel_at(camera: ViewportCamera, viewport: ViewportSizeResource, origin: Vec3) -> f32 {
    let position = Vec3::from_array(camera.position);
    let forward = (Vec3::from_array(camera.target) - position).normalize_or_zero();
    let depth = (origin - position).dot(forward).max(0.2);
    let height = viewport.logical_height.max(1.0);
    2.0 * depth * (camera.vertical_fov_degrees.to_radians() * 0.5).tan() / height
}

fn reference_plane_half_size(
    camera: ViewportCamera,
    viewport: ViewportSizeResource,
    origin: Vec3,
) -> f32 {
    world_per_pixel_at(camera, viewport, origin)
        * viewport.logical_width.min(viewport.logical_height).max(1.0)
        * (REFERENCE_PLANE_SCREEN_FRACTION * 0.5)
}

fn reference_plane_transform(origin: Vec3, half_size: f32) -> Transform {
    let scale = (half_size / REFERENCE_PLANE_HALF_SIZE).max(1.0e-6);
    Transform::from_translation(origin * (1.0 - scale)).with_scale(Vec3::splat(scale))
}

fn body_local_bounding_sphere(body: &BodyDto) -> Option<(Vec3, f32)> {
    let mut minimum = Vec3::splat(f32::INFINITY);
    let mut maximum = Vec3::splat(f32::NEG_INFINITY);
    let mut count = 0usize;
    for point in body.mesh.positions.chunks_exact(3) {
        let point = Vec3::new(point[0], point[1], point[2]);
        minimum = minimum.min(point);
        maximum = maximum.max(point);
        count += 1;
    }
    if count == 0 {
        return None;
    }
    let center = (minimum + maximum) * 0.5;
    let radius = (maximum - center).length().max(1.0e-5);
    Some((center, radius))
}

fn occurrence_edges_are_visible(
    local_bounds: Option<(Vec3, f32)>,
    transform: &Transform,
    camera: ViewportCamera,
    viewport: ViewportSizeResource,
) -> bool {
    let Some((local_center, local_radius)) = local_bounds else {
        return true;
    };
    let center = transform.transform_point(local_center);
    let radius = local_radius * transform.scale.max_element().abs().max(1.0e-6);
    let eye = Vec3::from_array(camera.position);
    let forward = (Vec3::from_array(camera.target) - eye).normalize_or_zero();
    let up_hint = Vec3::from_array(camera.up).normalize_or_zero();
    let right = forward.cross(up_hint).normalize_or_zero();
    let up = right.cross(forward).normalize_or_zero();
    if forward == Vec3::ZERO || right == Vec3::ZERO || up == Vec3::ZERO {
        return true;
    }
    let delta = center - eye;
    let depth = delta.dot(forward);
    if depth + radius <= 0.0 {
        return false;
    }
    let tangent = (camera.vertical_fov_degrees.to_radians() * 0.5).tan();
    let aspect = viewport.logical_width.max(1.0) / viewport.logical_height.max(1.0);
    if delta.dot(right).abs() > depth.max(0.0) * tangent * aspect + radius
        || delta.dot(up).abs() > depth.max(0.0) * tangent + radius
    {
        return false;
    }
    radius / world_per_pixel_at(camera, viewport, center)
        >= OCCURRENCE_EDGE_LOD_MIN_RADIUS_PX
}

fn resize_reference_planes(
    camera: Res<CameraResource>,
    viewport: Res<ViewportSizeResource>,
    model: Res<ModelResource>,
    mut origin_planes: Query<&mut Transform, (With<NativeOriginPlane>, Without<NativeDatumPlane>)>,
    mut datum_planes: Query<
        (&NativeDatumPlane, &NativeModelGeometry, &mut Transform),
        (Without<NativeOriginPlane>, Without<NativeCadFace>),
    >,
) {
    let size = *viewport;
    let origin_half_size = reference_plane_half_size(camera.camera, size, Vec3::ZERO);
    for mut transform in &mut origin_planes {
        *transform = reference_plane_transform(Vec3::ZERO, origin_half_size);
    }
    for (plane, geometry, mut transform) in &mut datum_planes {
        if geometry.session_id != model.session_id {
            continue;
        }
        let Some(definition) = model
            .datum_planes
            .iter()
            .find(|candidate| candidate.datum_id.0 == plane.datum_id)
        else {
            continue;
        };
        let origin = basis_vector(definition.basis.origin);
        let half_size = reference_plane_half_size(camera.camera, size, origin);
        *transform = reference_plane_transform(origin, half_size);
    }
}

#[allow(clippy::type_complexity)]
fn apply_native_presentation_styles(
    model: Res<ModelResource>,
    presentation: Res<PresentationResource>,
    palette: Res<PaletteResource>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut bodies: Query<
        (
            &NativeCadBody,
            &NativeModelGeometry,
            &MeshMaterial3d<StandardMaterial>,
            &mut Visibility,
        ),
        (
            Without<NativeCadFace>,
            Without<NativeCadFaceOverlay>,
            Without<NativeDatumPlane>,
            Without<NativeOriginPlane>,
        ),
    >,
    mut datum_planes: Query<
        (
            &NativeDatumPlane,
            &NativeModelGeometry,
            &MeshMaterial3d<StandardMaterial>,
            &mut Visibility,
        ),
        (Without<NativeCadFace>, Without<NativeOriginPlane>),
    >,
    mut origin_planes: Query<
        (
            &NativeOriginPlane,
            &MeshMaterial3d<StandardMaterial>,
            &mut Visibility,
        ),
        (Without<NativeCadFace>, Without<NativeDatumPlane>),
    >,
) {
    let state = &presentation.0;
    for (body, geometry, handle, mut visibility) in &mut bodies {
        if geometry.session_id != model.session_id {
            *visibility = Visibility::Hidden;
            continue;
        }
        *visibility = if state.hidden_body_ids.contains(&body.body_id) {
            Visibility::Hidden
        } else {
            Visibility::Inherited
        };
        let Some(mut material) = materials.get_mut(&handle.0) else {
            continue;
        };
        let occurrence_is_selected = state
            .selected_occurrence_id
            .is_none_or(|occurrence_id| body.occurrence_id == Some(occurrence_id));
        let selected_body_index = occurrence_is_selected
            .then(|| {
                state
                    .selected_body_ids
                    .iter()
                    .position(|body_id| *body_id == body.body_id)
            })
            .flatten();
        let color = if selected_body_index == Some(0) {
            rgb(palette.0.body_selected)
        } else if selected_body_index.is_some() {
            rgb(palette.0.body_tool)
        } else {
            body_appearance_color(&model, body.body_id, palette.0.body)
        };
        material.base_color = color;
        material.emissive = if selected_body_index.is_some() {
            color.to_linear() * 0.08
        } else {
            LinearRgba::BLACK
        };
    }

    for (plane, geometry, handle, mut visibility) in &mut datum_planes {
        if geometry.session_id != model.session_id {
            *visibility = Visibility::Hidden;
            continue;
        }
        *visibility = if state.hidden_datum_plane_ids.contains(&plane.datum_id) {
            Visibility::Hidden
        } else {
            Visibility::Inherited
        };
        if let Some(mut material) = materials.get_mut(&handle.0) {
            let hovered = state.hovered_datum_plane_id == Some(plane.datum_id);
            material.base_color = Color::srgba(
                0.85,
                0.65,
                0.30,
                if hovered {
                    0.32
                } else if state.mode == ViewportMode::PickPlane {
                    0.14
                } else {
                    0.08
                },
            );
        }
    }

    for (plane, handle, mut visibility) in &mut origin_planes {
        let visible = state.mode == ViewportMode::PickPlane;
        *visibility = if visible {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        if let Some(mut material) = materials.get_mut(&handle.0) {
            let hovered = state.hovered_origin_plane == Some(plane.plane);
            material.base_color =
                origin_plane_color(plane.plane, if hovered { 0.28 } else { 0.10 });
        }
    }
}

fn rebuild_native_face_overlays(
    mut commands: Commands,
    model: Res<ModelResource>,
    presentation: Res<PresentationResource>,
    palette: Res<PaletteResource>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    existing: Query<
        (Entity, &Mesh3d, &MeshMaterial3d<StandardMaterial>),
        With<NativeCadFaceOverlay>,
    >,
    mut last: Local<Option<(String, u64, u64, ViewportPresentation, ViewportPalette)>>,
) {
    let mut overlay_presentation = presentation.0.clone();
    overlay_presentation.body_poses.clear();
    overlay_presentation.instance_body_poses.clear();
    let next = (
        model.session_id.clone(),
        model.geometry_revision,
        model.instance_revision,
        overlay_presentation,
        palette.0,
    );
    if last.as_ref() == Some(&next) {
        return;
    }
    *last = Some(next);

    for (entity, mesh, material) in &existing {
        meshes.remove(&mesh.0);
        materials.remove(&material.0);
        commands.entity(entity).despawn();
    }

    let state = &presentation.0;
    let mut requested = state
        .selected_face_ids
        .iter()
        .copied()
        .map(|face_id| (face_id, true))
        .collect::<Vec<_>>();
    if let Some(face_id) = state.hovered_face_id {
        if !state.selected_face_ids.contains(&face_id) {
            requested.push((face_id, false));
        }
    }

    for (face_id, selected) in requested {
        let Some((body, face)) = model.scene.bodies.iter().find_map(|body| {
            body.faces
                .iter()
                .find(|face| face.id.0 == face_id)
                .map(|face| (body, face))
        }) else {
            continue;
        };
        if state.hidden_body_ids.contains(&body.id.0) {
            continue;
        }
        let Some(mesh) = face_mesh(body, face) else {
            continue;
        };
        let mesh_handle = meshes.add(mesh);
        let color = rgb(if selected {
            palette.0.face_selected
        } else {
            palette.0.face_hover
        });
        let material_handle = materials.add(StandardMaterial {
            base_color: color,
            emissive: color.to_linear() * 0.32,
            metallic: 0.0,
            perceptual_roughness: 0.86,
            cull_mode: None,
            depth_bias: 1.0,
            ..default()
        });
        let occurrences = if model.instance_body_poses.is_empty() {
            vec![None]
        } else {
            model
                .instance_body_poses
                .iter()
                .filter(|instance| {
                    instance.body_id == body.id
                        && instance.visible
                        && if selected {
                            state.selected_occurrence_id.is_none()
                                || state.selected_occurrence_id == Some(instance.occurrence_id.0)
                        } else {
                            state.hovered_occurrence_id.is_none()
                                || state.hovered_occurrence_id == Some(instance.occurrence_id.0)
                        }
                })
                .map(|instance| Some(instance.occurrence_id.0))
                .collect::<Vec<_>>()
        };
        for occurrence_id in occurrences {
            commands.spawn((
                Name::new(format!(
                    "OCCT face highlight {face_id} occurrence {occurrence_id:?}"
                )),
                NativeCadFaceOverlay {
                    body_id: body.id.0,
                    occurrence_id,
                },
                NativeModelGeometry {
                    session_id: model.session_id.clone(),
                    geometry_revision: model.geometry_revision,
                    instance_revision: model.instance_revision,
                },
                Mesh3d(mesh_handle.clone()),
                MeshMaterial3d(material_handle.clone()),
                NotShadowCaster,
                NotShadowReceiver,
                instance_body_pose_transform(
                    &model.instance_body_poses,
                    &model.body_poses,
                    body.id.0,
                    occurrence_id,
                ),
            ));
        }
    }
}

fn apply_body_poses(
    model: Res<ModelResource>,
    mut entities: Query<(
        Option<&NativeCadBody>,
        Option<&NativeCadFace>,
        Option<&NativeCadFaceOverlay>,
        &mut Transform,
    )>,
) {
    if !model.is_changed() {
        return;
    }
    for (body, face, overlay, mut transform) in &mut entities {
        let identity = body
            .map(|body| (body.body_id, body.occurrence_id))
            .or_else(|| face.map(|face| (face.body_id, face.occurrence_id)))
            .or_else(|| overlay.map(|overlay| (overlay.body_id, overlay.occurrence_id)));
        if let Some((body_id, occurrence_id)) = identity {
            *transform = instance_body_pose_transform(
                &model.instance_body_poses,
                &model.body_poses,
                body_id,
                occurrence_id,
            );
        }
    }
}

/// Rebuilds only command-owned transient fills and manipulators. These meshes
/// are intentionally separate from OCCT scene geometry: they may be
/// translucent, depth-independent, and replaced on every debounced edit.
fn rebuild_native_preview_meshes(
    mut commands: Commands,
    preview: Res<PreviewResource>,
    mut revisions: ResMut<RenderedRevisions>,
    existing: Query<(Entity, &Mesh3d, &MeshMaterial3d<StandardMaterial>), With<NativePreviewMesh>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    if revisions.preview_meshes == preview.mesh_revision {
        return;
    }
    revisions.preview_meshes = preview.mesh_revision;

    for (entity, mesh, material) in &existing {
        meshes.remove(mesh.0.id());
        materials.remove(material.0.id());
        commands.entity(entity).despawn();
    }

    for layer in &preview.value.triangles {
        let positions = layer
            .positions
            .chunks_exact(3)
            .filter_map(|point| {
                point
                    .iter()
                    .all(|value| value.is_finite())
                    .then_some([point[0], point[1], point[2]])
            })
            .collect::<Vec<_>>();
        if positions.len() < 3 || positions.len() % 3 != 0 {
            continue;
        }
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        mesh.compute_flat_normals();
        let color = Color::srgba(
            layer.color[0].clamp(0.0, 1.0),
            layer.color[1].clamp(0.0, 1.0),
            layer.color[2].clamp(0.0, 1.0),
            layer.color[3].clamp(0.0, 1.0),
        );
        let mut entity = commands.spawn((
            Name::new("Native command profile/tool fill"),
            NativePreviewMesh,
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: color,
                alpha_mode: AlphaMode::Blend,
                unlit: true,
                double_sided: true,
                cull_mode: None,
                depth_bias: 2.0,
                ..default()
            })),
            NotShadowCaster,
            NotShadowReceiver,
        ));
        if layer.xray {
            entity.insert(RenderLayers::layer(1));
        }
    }

    for arrow in &preview.value.arrows {
        let start = Vec3::from_array(arrow.start);
        let end = Vec3::from_array(arrow.end);
        if !start.is_finite() || !end.is_finite() {
            continue;
        }
        let delta = end - start;
        let length = delta.length();
        if !length.is_finite() || length <= 1.0e-5 {
            continue;
        }
        let color = Color::srgba(
            arrow.color[0].clamp(0.0, 1.0),
            arrow.color[1].clamp(0.0, 1.0),
            arrow.color[2].clamp(0.0, 1.0),
            arrow.color[3].clamp(0.0, 1.0),
        );
        let material = materials.add(StandardMaterial {
            base_color: color,
            alpha_mode: AlphaMode::Blend,
            unlit: true,
            double_sided: true,
            cull_mode: None,
            depth_bias: 4.0,
            ..default()
        });
        let render_layer = arrow.xray.then(|| RenderLayers::layer(1));

        let mut shaft = commands.spawn((
            Name::new("Native Extrude direction shaft"),
            NativePreviewMesh,
            NativePreviewArrowPart {
                start,
                end,
                width: arrow.width,
                kind: NativePreviewArrowPartKind::Shaft,
            },
            Mesh3d(meshes.add(Cylinder::new(1.0, 1.0))),
            MeshMaterial3d(material.clone()),
            Transform::default(),
            NotShadowCaster,
            NotShadowReceiver,
        ));
        if let Some(layer) = render_layer.clone() {
            shaft.insert(layer);
        }

        let mut head = commands.spawn((
            Name::new("Native Extrude direction head"),
            NativePreviewMesh,
            NativePreviewArrowPart {
                start,
                end,
                width: arrow.width,
                kind: NativePreviewArrowPartKind::Head,
            },
            Mesh3d(meshes.add(Cone::new(1.0, 1.0))),
            MeshMaterial3d(material.clone()),
            Transform::default(),
            NotShadowCaster,
            NotShadowReceiver,
        ));
        if let Some(layer) = render_layer.clone() {
            head.insert(layer);
        }

        let mut base = commands.spawn((
            Name::new("Native Extrude direction origin"),
            NativePreviewMesh,
            NativePreviewArrowPart {
                start,
                end,
                width: arrow.width,
                kind: NativePreviewArrowPartKind::Base,
            },
            Mesh3d(meshes.add(Sphere::new(1.0))),
            MeshMaterial3d(material),
            Transform::default(),
            NotShadowCaster,
            NotShadowReceiver,
        ));
        if let Some(layer) = render_layer {
            base.insert(layer);
        }
    }
}

/// Preserve a constant logical-pixel arrow footprint without touching GPU
/// assets. This is intentionally cheap enough to run on every demanded frame.
fn update_native_preview_arrows(
    camera: Res<CameraResource>,
    viewport: Res<ViewportSizeResource>,
    mut arrows: Query<(&NativePreviewArrowPart, &mut Transform)>,
) {
    for (arrow, mut transform) in &mut arrows {
        let delta = arrow.end - arrow.start;
        let length = delta.length();
        if !length.is_finite() || length <= 1.0e-5 {
            *transform = Transform::from_scale(Vec3::ZERO);
            continue;
        }
        let direction = delta / length;
        let center = arrow.start + delta * 0.5;
        let world_per_pixel = world_per_pixel_at(camera.camera, *viewport, center);
        let width = arrow.width.clamp(1.0, 4.0);
        let shaft_radius = (world_per_pixel * width * 0.46).max(length * 0.003);
        let head_length = (world_per_pixel * 11.0)
            .max(length * 0.10)
            .min(length * 0.42);
        let shaft_length = (length - head_length).max(length * 0.05);
        let head_radius = (world_per_pixel * width * 2.2).max(shaft_radius * 2.5);
        let rotation = Quat::from_rotation_arc(Vec3::Y, direction);

        *transform = match arrow.kind {
            NativePreviewArrowPartKind::Shaft => {
                Transform::from_translation(arrow.start + direction * (shaft_length * 0.5))
                    .with_rotation(rotation)
                    .with_scale(Vec3::new(shaft_radius, shaft_length, shaft_radius))
            }
            NativePreviewArrowPartKind::Head => Transform::from_translation(
                arrow.start + direction * (shaft_length + head_length * 0.5),
            )
            .with_rotation(rotation)
            .with_scale(Vec3::new(head_radius, head_length, head_radius)),
            NativePreviewArrowPartKind::Base => {
                Transform::from_translation(arrow.start).with_scale(Vec3::splat(head_radius * 0.54))
            }
        };
    }
}

fn rebuild_native_annotations(
    mut commands: Commands,
    preview: Res<PreviewResource>,
    palette: Res<PaletteResource>,
    mut revisions: ResMut<RenderedRevisions>,
    existing: Query<Entity, With<NativeAnnotationRoot>>,
    cameras: Query<Entity, With<NativeOverlayCamera>>,
) {
    if revisions.annotations == preview.revision {
        return;
    }
    revisions.annotations = preview.revision;

    for entity in &existing {
        commands.entity(entity).despawn();
    }
    let Ok(camera) = cameras.single() else {
        return;
    };

    for annotation in &preview.value.annotations {
        if annotation.text.trim().is_empty()
            || !annotation.screen[0].is_finite()
            || !annotation.screen[1].is_finite()
        {
            continue;
        }
        let constraint = annotation.kind == ViewportAnnotationKind::Constraint;
        // Dimension `screen` coordinates are the projected center of the
        // browser-side annotation sprite. Keep the native label centered on
        // that same point so the visible number and its DOM interaction proxy
        // share one hit target. Constraint glyphs intentionally retain their
        // small upper-right offset from the referenced sketch geometry.
        let annotation_transform = if constraint {
            UiTransform::default()
        } else {
            UiTransform::from_translation(Val2::percent(-50.0, -50.0))
        };
        let foreground = Color::srgba(
            annotation.color[0],
            annotation.color[1],
            annotation.color[2],
            annotation.color[3].clamp(0.0, 1.0),
        );
        commands
            .spawn((
                Name::new(format!("Native viewport annotation {}", annotation.text)),
                NativeAnnotationRoot,
                UiTargetCamera(camera),
                Node {
                    position_type: PositionType::Absolute,
                    left: px(annotation.screen[0] + if constraint { 4.0 } else { 0.0 }),
                    top: px(annotation.screen[1] - if constraint { 9.0 } else { 0.0 }),
                    min_width: px(if constraint { 15.0 } else { 24.0 }),
                    min_height: px(if constraint { 15.0 } else { 18.0 }),
                    padding: UiRect::axes(
                        px(if constraint { 2.0 } else { 4.0 }),
                        px(if constraint { 1.0 } else { 2.0 }),
                    ),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    border: UiRect::all(px(1.0)),
                    border_radius: BorderRadius::all(px(if constraint { 4.0 } else { 5.0 })),
                    ..default()
                },
                annotation_transform,
                BackgroundColor(rgba(
                    if constraint {
                        palette.0.background
                    } else {
                        palette.0.header
                    },
                    if constraint { 0.78 } else { 0.90 },
                )),
                BorderColor::all(rgba(palette.0.ui_edge, 0.88)),
                ZIndex(18),
            ))
            .with_child((
                Text::new(annotation.text.clone()),
                TextFont::from_font_size(if constraint { 9.0 } else { 10.0 }),
                TextColor(foreground),
            ));
    }
}

fn rebuild_native_hud(
    mut commands: Commands,
    hud: Res<HudResource>,
    palette: Res<PaletteResource>,
    assets: Res<ViewportUiAssets>,
    mut revisions: ResMut<RenderedRevisions>,
    existing: Query<Entity, With<NativeHudRoot>>,
    cameras: Query<Entity, With<NativeOverlayCamera>>,
) {
    if revisions.hud == hud.revision {
        return;
    }
    revisions.hud = hud.revision;

    for entity in &existing {
        commands.entity(entity).despawn();
    }
    let Ok(camera) = cameras.single() else {
        return;
    };

    ui::spawn_viewport_hud(&mut commands, camera, &hud.hud, &palette.0, &assets);
}

fn update_native_hud_orientation(
    camera: Res<CameraResource>,
    mut marks: Query<(&HudAxisMark, &mut Node)>,
    mut labels: Query<(&HudAxisLabel, &mut Node), Without<HudAxisMark>>,
) {
    ui::update_orientation_nodes(camera.camera, &mut marks, &mut labels);
}

fn stable_view_up(direction: Vec3, up_hint: Vec3) -> Vec3 {
    let forward = direction.normalize_or_zero();
    if !forward.is_finite() || forward.length_squared() < 1.0e-8 {
        return Vec3::Z;
    }

    // Gram-Schmidt removes any component parallel to the view direction.
    // This remains valid at the exact top/bottom angles where a fixed Z-up
    // fallback would still be parallel and produce a degenerate transform.
    let mut up = up_hint.normalize_or_zero();
    up -= forward * up.dot(forward);
    if !up.is_finite() || up.length_squared() < 1.0e-8 {
        forward.any_orthonormal_vector()
    } else {
        up.normalize()
    }
}

fn camera_transform(camera: ViewportCamera) -> Transform {
    let position = Vec3::from_array(camera.position);
    let mut target = Vec3::from_array(camera.target);
    let direction = target - position;
    if !direction.is_finite() || direction.length_squared() < 1.0e-8 {
        target = position + Vec3::NEG_Z;
    }
    let up = stable_view_up(target - position, Vec3::from_array(camera.up));
    Transform::from_translation(position).looking_at(target, up)
}

fn origin_plane_bases() -> [(&'static str, PlaneBasis, Color); 3] {
    [
        (
            "XY",
            PlaneBasis {
                origin: [0.0, 0.0, 0.0],
                u: [1.0, 0.0, 0.0],
                v: [0.0, 1.0, 0.0],
                normal: [0.0, 0.0, 1.0],
            },
            Color::srgba(0.25, 0.60, 0.94, 0.055),
        ),
        (
            "XZ",
            PlaneBasis {
                origin: [0.0, 0.0, 0.0],
                u: [1.0, 0.0, 0.0],
                v: [0.0, 0.0, 1.0],
                normal: [0.0, -1.0, 0.0],
            },
            Color::srgba(0.31, 0.74, 0.47, 0.050),
        ),
        (
            "YZ",
            PlaneBasis {
                origin: [0.0, 0.0, 0.0],
                u: [0.0, 1.0, 0.0],
                v: [0.0, 0.0, 1.0],
                normal: [1.0, 0.0, 0.0],
            },
            Color::srgba(0.88, 0.36, 0.39, 0.050),
        ),
    ]
}

fn origin_plane_color(plane: ViewportOriginPlane, alpha: f32) -> Color {
    match plane {
        ViewportOriginPlane::Xy => Color::srgba(0.25, 0.60, 0.94, alpha),
        ViewportOriginPlane::Xz => Color::srgba(0.31, 0.74, 0.47, alpha),
        ViewportOriginPlane::Yz => Color::srgba(0.88, 0.36, 0.39, alpha),
    }
}

fn reference_plane_mesh(basis: &PlaneBasis, half_size: f32) -> Mesh {
    let origin = basis_vector(basis.origin);
    let u = basis_vector(basis.u) * half_size;
    let v = basis_vector(basis.v) * half_size;
    let normal = basis_vector(basis.normal).normalize_or_zero();
    let positions = vec![
        (origin - u - v).to_array(),
        (origin + u - v).to_array(),
        (origin + u + v).to_array(),
        (origin - u + v).to_array(),
    ];
    let normals = vec![normal.to_array(); 4];

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(
        Mesh::ATTRIBUTE_UV_0,
        vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
    );
    mesh.insert_indices(Indices::U32(vec![0, 1, 2, 0, 2, 3]));
    mesh
}

fn body_mesh(body: &BodyDto) -> Option<Mesh> {
    if body.mesh.positions.len() < 9
        || body.mesh.positions.len() % 3 != 0
        || body.mesh.normals.len() != body.mesh.positions.len()
        || body
            .mesh
            .indices
            .iter()
            .any(|index| (*index as usize) * 3 + 2 >= body.mesh.positions.len())
    {
        return None;
    }
    let positions = body
        .mesh
        .positions
        .chunks_exact(3)
        .map(|value| [value[0], value[1], value[2]])
        .collect::<Vec<_>>();
    let normals = body
        .mesh
        .normals
        .chunks_exact(3)
        .map(|value| [value[0], value[1], value[2]])
        .collect::<Vec<_>>();
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_indices(Indices::U32(body.mesh.indices.clone()));
    Some(mesh)
}

fn body_appearance_color(model: &ModelResource, body_id: u64, fallback: [f32; 3]) -> Color {
    let Some(appearance) = model
        .body_appearances
        .iter()
        .find(|appearance| appearance.body_id.0 == body_id)
    else {
        return rgb(fallback);
    };
    Color::srgb(
        f32::from(appearance.color.r) / 255.0,
        f32::from(appearance.color.g) / 255.0,
        f32::from(appearance.color.b) / 255.0,
    )
}

fn body_pose_transform(poses: &[BodyPoseDto], body_id: u64) -> Transform {
    let Some(pose) = poses.iter().find(|pose| pose.body_id.0 == body_id) else {
        return Transform::IDENTITY;
    };
    let rotation = Quat::from_xyzw(
        pose.rotation[0] as f32,
        pose.rotation[1] as f32,
        pose.rotation[2] as f32,
        pose.rotation[3] as f32,
    )
    .normalize();
    Transform::from_translation(Vec3::new(
        pose.translation[0] as f32,
        pose.translation[1] as f32,
        pose.translation[2] as f32,
    ))
    .with_rotation(rotation)
}

fn same_instance_layout(a: &[InstanceBodyPoseDto], b: &[InstanceBodyPoseDto]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            a.occurrence_id == b.occurrence_id
                && a.component_id == b.component_id
                && a.body_id == b.body_id
                && a.visible == b.visible
        })
}

fn instance_body_pose_transform(
    instances: &[InstanceBodyPoseDto],
    legacy: &[BodyPoseDto],
    body_id: u64,
    occurrence_id: Option<u64>,
) -> Transform {
    let pose = occurrence_id.and_then(|occurrence_id| {
        instances
            .iter()
            .find(|pose| pose.body_id.0 == body_id && pose.occurrence_id.0 == occurrence_id)
    });
    let Some(pose) = pose else {
        return body_pose_transform(legacy, body_id);
    };
    let rotation = Quat::from_xyzw(
        pose.rotation[0] as f32,
        pose.rotation[1] as f32,
        pose.rotation[2] as f32,
        pose.rotation[3] as f32,
    )
    .normalize();
    Transform::from_translation(Vec3::new(
        pose.translation[0] as f32,
        pose.translation[1] as f32,
        pose.translation[2] as f32,
    ))
    .with_rotation(rotation)
}

fn visible_body_occurrences(model: &ModelResource, body_id: u64) -> Vec<Option<u64>> {
    if model.instance_body_poses.is_empty() {
        return vec![None];
    }
    model
        .instance_body_poses
        .iter()
        .filter(|instance| instance.body_id.0 == body_id && instance.visible)
        .map(|instance| Some(instance.occurrence_id.0))
        .collect()
}

fn face_mesh(body: &BodyDto, face: &FaceDto) -> Option<Mesh> {
    let start = face.first_index as usize;
    let end = start
        .saturating_add(face.index_count as usize)
        .min(body.mesh.indices.len());
    let mut positions = Vec::with_capacity(end.saturating_sub(start));
    let mut normals = Vec::with_capacity(end.saturating_sub(start));
    for vertex in &body.mesh.indices[start..end] {
        let offset = *vertex as usize * 3;
        let position = body.mesh.positions.get(offset..offset + 3)?;
        positions.push([position[0], position[1], position[2]]);
        if let Some(normal) = body.mesh.normals.get(offset..offset + 3) {
            normals.push([normal[0], normal[1], normal[2]]);
        }
    }
    if positions.len() < 3 {
        return None;
    }

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    if normals.len() == end.saturating_sub(start) {
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    } else {
        mesh.compute_flat_normals();
    }
    Some(mesh)
}

fn draw_cad_gizmos(
    mut gizmos: Gizmos,
    mut sketch_gizmos: Gizmos<CadSketchGizmos>,
    mut sketch_point_outlines: Gizmos<CadSketchPointOutlineGizmos>,
    mut sketch_points: Gizmos<CadSketchPointGizmos>,
    mut highlights: Gizmos<CadHighlightGizmos>,
    model: Res<ModelResource>,
    camera: Res<CameraResource>,
    viewport: Res<ViewportSizeResource>,
    preview: Res<PreviewResource>,
    palette: Res<PaletteResource>,
    presentation: Res<PresentationResource>,
    face_boundaries: Query<(&NativeCadFace, &NativeModelGeometry)>,
) {
    let state = &presentation.0;
    let fine = rgba(palette.0.grid_fine, 0.28);
    let major = rgba(palette.0.grid_major, 0.48);

    if state.mode == ViewportMode::Sketch {
        if let Some(sketch) = &model.active_sketch {
            draw_grid_on_basis(&mut gizmos, &sketch.basis, fine, major);
        }
    } else {
        draw_grid_on_basis(&mut gizmos, &origin_plane_bases()[0].1, fine, major);
    }

    if state.mode == ViewportMode::PickPlane {
        let origin_half_size = reference_plane_half_size(camera.camera, *viewport, Vec3::ZERO);
        for (name, basis, _) in origin_plane_bases() {
            let plane = match name {
                "XY" => ViewportOriginPlane::Xy,
                "XZ" => ViewportOriginPlane::Xz,
                _ => ViewportOriginPlane::Yz,
            };
            let alpha = if state.hovered_origin_plane == Some(plane) {
                0.92
            } else {
                0.42
            };
            draw_plane_outline(
                &mut highlights,
                &basis,
                origin_half_size,
                origin_plane_color(plane, alpha),
            );
        }
        gizmos.sphere(
            Vec3::ZERO,
            origin_half_size * 0.0092,
            Color::srgba(0.94, 0.95, 0.98, 0.98),
        );
        let axis_length = origin_half_size * 0.28;
        gizmos.arrow(
            Vec3::ZERO,
            Vec3::X * axis_length,
            Color::srgba(0.88, 0.36, 0.39, 0.98),
        );
        gizmos.arrow(
            Vec3::ZERO,
            Vec3::Y * axis_length,
            Color::srgba(0.35, 0.68, 0.45, 0.98),
        );
        gizmos.arrow(
            Vec3::ZERO,
            Vec3::Z * axis_length,
            Color::srgba(0.26, 0.65, 0.91, 0.98),
        );
    } else if state.mode == ViewportMode::Sketch {
        if let Some(sketch) = &model.active_sketch {
            let origin = basis_vector(sketch.basis.origin);
            gizmos.sphere(origin, 0.38, rgba(palette.0.mute, 0.92));
        }
    }

    for plane in &model.datum_planes {
        if state.hidden_datum_plane_ids.contains(&plane.datum_id.0) {
            continue;
        }
        let hovered = state.hovered_datum_plane_id == Some(plane.datum_id.0);
        let origin = basis_vector(plane.basis.origin);
        let half_size = reference_plane_half_size(camera.camera, *viewport, origin);
        draw_plane_outline(
            &mut gizmos,
            &plane.basis,
            half_size,
            Color::srgba(
                0.88,
                0.68,
                0.32,
                if hovered {
                    0.98
                } else if state.mode == ViewportMode::PickPlane {
                    0.76
                } else {
                    0.56
                },
            ),
        );
    }

    for body in &model.scene.bodies {
        if state.hidden_body_ids.contains(&body.id.0) {
            continue;
        }
        let local_bounds = body_local_bounding_sphere(body);
        for occurrence_id in visible_body_occurrences(&model, body.id.0) {
            let occurrence_is_selected = state
                .selected_occurrence_id
                .is_none_or(|selected| occurrence_id == Some(selected));
            let selected_body_index = occurrence_is_selected
                .then(|| {
                    state
                        .selected_body_ids
                        .iter()
                        .position(|body_id| *body_id == body.id.0)
                })
                .flatten();
            let hovered_body = state.hovered_body_id == Some(body.id.0)
                && state
                    .hovered_occurrence_id
                    .is_none_or(|hovered| occurrence_id == Some(hovered));
            let body_transform = instance_body_pose_transform(
                &model.instance_body_poses,
                &model.body_poses,
                body.id.0,
                occurrence_id,
            );
            let draw_default_edges = occurrence_edges_are_visible(
                local_bounds,
                &body_transform,
                camera.camera,
                *viewport,
            );

            if selected_body_index.is_some() || hovered_body {
                let color = if selected_body_index == Some(0) {
                    rgb(palette.0.face_selected)
                } else if selected_body_index.is_some() {
                    rgb(palette.0.edge_selected)
                } else {
                    rgb(palette.0.edge_hover)
                };
                for edge in &body.edges {
                    draw_edge_segments(&mut highlights, edge, color, &body_transform);
                }
            }

            for edge in &body.edges {
                let selected =
                    occurrence_is_selected && state.selected_edge_ids.contains(&edge.id.0);
                let hovered = state.hovered_edge_id == Some(edge.id.0)
                    && state
                        .hovered_occurrence_id
                        .is_none_or(|hovered| occurrence_id == Some(hovered));
                if !draw_default_edges
                    && !selected
                    && !hovered
                    && selected_body_index.is_none()
                    && !hovered_body
                {
                    continue;
                }
                let color = if selected {
                    palette.0.edge_selected
                } else if hovered {
                    palette.0.edge_hover
                } else if selected_body_index.is_some() {
                    palette.0.body_selected_edge
                } else {
                    palette.0.edge
                };
                draw_edge_segments(&mut gizmos, edge, rgba(color, 0.92), &body_transform);
                if selected || hovered {
                    draw_edge_segments(
                        &mut highlights,
                        edge,
                        rgb(if selected {
                            palette.0.edge_selected
                        } else {
                            palette.0.edge_hover
                        }),
                        &body_transform,
                    );
                }
            }
        }
    }

    for (face, geometry) in &face_boundaries {
        if geometry.session_id != model.session_id || state.hidden_body_ids.contains(&face.body_id)
        {
            continue;
        }
        let occurrence_is_selected = state
            .selected_occurrence_id
            .is_none_or(|selected| face.occurrence_id == Some(selected));
        let selected = occurrence_is_selected && state.selected_face_ids.contains(&face.face_id);
        let hovered = state.hovered_face_id == Some(face.face_id)
            && state
                .hovered_occurrence_id
                .is_none_or(|hovered| face.occurrence_id == Some(hovered));
        if !selected && !hovered {
            continue;
        }
        let color = rgb(if selected {
            palette.0.edge_selected
        } else {
            palette.0.edge_hover
        });
        let transform = instance_body_pose_transform(
            &model.instance_body_poses,
            &model.body_poses,
            face.body_id,
            face.occurrence_id,
        );
        for (start, end) in &face.boundary {
            highlights.line(
                transform.transform_point(*start),
                transform.transform_point(*end),
                color,
            );
        }
    }

    for sketch in &model.finished_sketches {
        if state.hidden_sketch_names.contains(&sketch.name) {
            continue;
        }
        let origin = basis_vector(sketch.basis.origin);
        let world_per_pixel = world_per_pixel_at(camera.camera, *viewport, origin);
        let curve_color = rgba(palette.0.finished_sketch, 0.58);
        let point_color = rgb(palette.0.finished_sketch_point);
        let point_outline_color = rgba(palette.0.finished_sketch_point_outline, 0.96);
        for entity in &sketch.entities {
            draw_sketch_curve(&mut sketch_gizmos, &sketch.basis, entity, curve_color);
            draw_sketch_entity_grips(
                &mut sketch_point_outlines,
                &sketch.basis,
                entity,
                world_per_pixel * SKETCH_POINT_OUTLINE_RADIUS_PX,
                point_outline_color,
            );
            draw_sketch_entity_grips(
                &mut sketch_points,
                &sketch.basis,
                entity,
                world_per_pixel * SKETCH_POINT_RADIUS_PX,
                point_color,
            );
        }
    }

    // Explicit solid-command profile selection takes priority over body
    // occlusion. This is essential for sketches on mid/offset planes inside a
    // part: the user must see the selectable section before choosing it for
    // Extrude, Revolve, Sweep, or Loft.
    if state.profile_picker_active {
        for catalog in &model.profile_catalog {
            if state.hidden_sketch_names.contains(&catalog.sketch_name) {
                continue;
            }
            for profile in catalog
                .profiles
                .iter()
                .filter(|candidate| candidate.nesting_depth % 2 == 0)
            {
                if !state.candidate_profiles.iter().any(|candidate| {
                    candidate.sketch_name == catalog.sketch_name
                        && candidate.profile_index == profile.index
                }) {
                    continue;
                }
                let selected = state.selected_profiles.iter().any(|candidate| {
                    candidate.sketch_name == catalog.sketch_name
                        && candidate.profile_index == profile.index
                });
                let hovered = state.hovered_profile.as_ref().is_some_and(|candidate| {
                    candidate.sketch_name == catalog.sketch_name
                        && candidate.profile_index == profile.index
                });
                let candidate_color = rgba(palette.0.finished_sketch, 0.94);
                draw_profile_loop(&mut sketch_gizmos, &catalog.basis, profile, candidate_color);
                for hole in catalog.profiles.iter().filter(|candidate| {
                    candidate.nesting_depth % 2 == 1
                        && candidate.parent_index == Some(profile.index)
                }) {
                    draw_profile_loop(&mut sketch_gizmos, &catalog.basis, hole, candidate_color);
                }
                if selected || hovered {
                    let color = rgb(if selected {
                        palette.0.edge_selected
                    } else {
                        palette.0.edge_hover
                    });
                    draw_profile_loop(&mut highlights, &catalog.basis, profile, color);
                    for hole in catalog.profiles.iter().filter(|candidate| {
                        candidate.nesting_depth % 2 == 1
                            && candidate.parent_index == Some(profile.index)
                    }) {
                        draw_profile_loop(&mut highlights, &catalog.basis, hole, color);
                    }
                }
            }
        }
    }

    if let Some(sketch) = &model.active_sketch {
        let origin = basis_vector(sketch.basis.origin);
        let point_pixel_size = world_per_pixel_at(camera.camera, *viewport, origin);
        draw_sketch(
            &mut sketch_gizmos,
            sketch,
            point_pixel_size * 3.5,
            |entity| {
                let (id, fully_defined) = sketch_entity_style(entity);
                Some(rgb(if state.selected_sketch_entity_ids.contains(&id) {
                    palette.0.selection
                } else if state.hovered_sketch_entity_id == Some(id) {
                    palette.0.hover
                } else if fully_defined {
                    palette.0.defined_sketch
                } else {
                    palette.0.active_sketch
                }))
            },
        );
        draw_sketch(&mut highlights, sketch, point_pixel_size * 5.0, |entity| {
            let (id, _) = sketch_entity_style(entity);
            if state.selected_sketch_entity_ids.contains(&id) {
                Some(rgb(palette.0.selection))
            } else if state.hovered_sketch_entity_id == Some(id) {
                Some(rgb(palette.0.hover))
            } else {
                None
            }
        });
    }

    for layer in &preview.value.lines {
        let color = Color::srgba(
            layer.color[0],
            layer.color[1],
            layer.color[2],
            layer.color[3].clamp(0.0, 1.0),
        );
        for segment in layer.segments.chunks_exact(6) {
            let start = Vec3::new(segment[0], segment[1], segment[2]);
            let end = Vec3::new(segment[3], segment[4], segment[5]);
            if layer.pattern == ViewportLinePattern::Dotted {
                let delta = end - start;
                let length = delta.length();
                if length <= f32::EPSILON {
                    continue;
                }
                let world_per_pixel = world_per_pixel_at(
                    camera.camera,
                    *viewport,
                    start.lerp(end, 0.5),
                )
                .max(f32::EPSILON);
                // Tiny screen-space strokes read as dots without relying on
                // a renderer-specific dash shader. Cap the subdivision so a
                // pathological guide cannot degrade pointer latency.
                let dot_length = world_per_pixel * 1.25;
                let requested_period = world_per_pixel * 4.25;
                let direction = delta / length;
                let requested_count = ((length / requested_period).ceil() as usize).max(1);
                let dot_count = requested_count.min(512);
                let period = if requested_count > dot_count {
                    length / dot_count as f32
                } else {
                    requested_period
                };
                for dot_index in 0..dot_count {
                    let distance = dot_index as f32 * period;
                    if distance >= length {
                        break;
                    }
                    let dot_start = start + direction * distance;
                    let dot_end = start + direction * (distance + dot_length).min(length);
                    if layer.width >= 2.0 {
                        highlights.line(dot_start, dot_end, color);
                    } else {
                        gizmos.line(dot_start, dot_end, color);
                    }
                }
            } else if layer.width >= 2.0 {
                highlights.line(start, end, color);
            } else {
                gizmos.line(start, end, color);
            }
        }
    }

    for layer in &preview.value.points {
        let color = Color::srgba(
            layer.color[0],
            layer.color[1],
            layer.color[2],
            layer.color[3].clamp(0.0, 1.0),
        );
        let radius = layer.radius.clamp(0.08, 4.0);
        for point in layer.positions.chunks_exact(3) {
            let center = Vec3::new(point[0], point[1], point[2]);
            let forward = (Vec3::from_array(camera.camera.target)
                - Vec3::from_array(camera.camera.position))
                .normalize_or_zero();
            let up_hint = Vec3::from_array(camera.camera.up).normalize_or_zero();
            let right = forward.cross(up_hint).normalize_or_zero();
            let right = if right == Vec3::ZERO { Vec3::X } else { right };
            let up = right.cross(forward).normalize_or_zero();
            draw_filled_disc(&mut highlights, center, right, up, radius, color);
        }
    }

    if let Some(marker) = preview.value.marker {
        draw_snap_marker(
            &mut highlights,
            marker,
            camera.camera,
            *viewport,
            &palette.0,
        );
    }
}

fn draw_snap_marker(
    gizmos: &mut Gizmos<CadHighlightGizmos>,
    marker: ViewportSnapMarker,
    camera: ViewportCamera,
    viewport: ViewportSizeResource,
    palette: &ViewportPalette,
) {
    let center = Vec3::from_array(marker.position);
    let camera_position = Vec3::from_array(camera.position);
    let forward = (Vec3::from_array(camera.target) - camera_position).normalize_or_zero();
    let camera_up = Vec3::from_array(camera.up).normalize_or_zero();
    let mut right = forward.cross(camera_up).normalize_or_zero();
    if right.length_squared() < 1.0e-8 {
        right = Vec3::X;
    }
    let mut up = right.cross(forward).normalize_or_zero();
    if up.length_squared() < 1.0e-8 {
        up = Vec3::Y;
    }
    let world_per_pixel = world_per_pixel_at(camera, viewport, center);
    let half = world_per_pixel * SNAP_MARKER_HALF_SIZE_PX;
    let point_color = rgba(palette.hover, 1.0);
    let secondary_color = rgba(palette.selection, 1.0);
    let preview_color = rgba(palette.preview, 0.98);

    match marker.kind {
        ViewportSnapKind::Point => {
            draw_marker_loop(
                gizmos,
                &[
                    center - right * half - up * half,
                    center + right * half - up * half,
                    center + right * half + up * half,
                    center - right * half + up * half,
                ],
                point_color,
            );
        }
        ViewportSnapKind::Midpoint | ViewportSnapKind::ReferenceMidpoint => {
            draw_marker_loop(
                gizmos,
                &[
                    center + up * half,
                    center + right * half - up * half,
                    center - right * half - up * half,
                ],
                secondary_color,
            );
        }
        ViewportSnapKind::Origin => {
            draw_marker_loop(
                gizmos,
                &[
                    center + up * half,
                    center + right * half,
                    center - up * half,
                    center - right * half,
                ],
                secondary_color,
            );
            let inner = half * 0.42;
            gizmos.line(
                center - right * inner,
                center + right * inner,
                secondary_color,
            );
            gizmos.line(center - up * inner, center + up * inner, secondary_color);
        }
        ViewportSnapKind::Curve => {
            draw_marker_loop(
                gizmos,
                &[
                    center + up * half,
                    center + right * half,
                    center - up * half,
                    center - right * half,
                ],
                point_color,
            );
        }
        ViewportSnapKind::Grid => {
            let arm = half * 0.72;
            gizmos.line(center - right * arm, center + right * arm, preview_color);
            gizmos.line(center - up * arm, center + up * arm, preview_color);
        }
    }
}

fn draw_marker_loop(gizmos: &mut Gizmos<CadHighlightGizmos>, points: &[Vec3], color: Color) {
    if points.len() < 2 {
        return;
    }
    for index in 0..points.len() {
        gizmos.line(points[index], points[(index + 1) % points.len()], color);
    }
}

fn draw_grid_on_basis(gizmos: &mut Gizmos, basis: &PlaneBasis, fine: Color, major: Color) {
    let origin = basis_vector(basis.origin) - basis_vector(basis.normal) * 0.03;
    let u = basis_vector(basis.u);
    let v = basis_vector(basis.v);
    for index in -30..=30 {
        let coordinate = index as f32 * 5.0;
        let color = if index % 5 == 0 { major } else { fine };
        gizmos.line(
            origin + u * coordinate - v * 150.0,
            origin + u * coordinate + v * 150.0,
            color,
        );
        gizmos.line(
            origin - u * 150.0 + v * coordinate,
            origin + u * 150.0 + v * coordinate,
            color,
        );
    }
    gizmos.line(
        origin - u * 150.0,
        origin + u * 150.0,
        Color::srgba(0.80, 0.25, 0.30, 0.62),
    );
    gizmos.line(
        origin - v * 150.0,
        origin + v * 150.0,
        Color::srgba(0.25, 0.65, 0.38, 0.62),
    );
}

fn draw_plane_outline<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    basis: &PlaneBasis,
    half_size: f32,
    color: Color,
) {
    let origin = basis_vector(basis.origin);
    let u = basis_vector(basis.u) * half_size;
    let v = basis_vector(basis.v) * half_size;
    let corners = [
        origin - u - v,
        origin + u - v,
        origin + u + v,
        origin - u + v,
    ];
    for index in 0..4 {
        gizmos.line(corners[index], corners[(index + 1) % 4], color);
    }
    gizmos.line(origin - u, origin + u, color.with_alpha(0.46));
    gizmos.line(origin - v, origin + v, color.with_alpha(0.46));
}

fn draw_edge_segments<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    edge: &nbcad_solid::EdgeDto,
    color: Color,
    transform: &Transform,
) {
    for pair in edge.points.windows(2) {
        gizmos.line(
            transform.transform_point(Vec3::new(
                pair[0].x as f32,
                pair[0].y as f32,
                pair[0].z as f32,
            )),
            transform.transform_point(Vec3::new(
                pair[1].x as f32,
                pair[1].y as f32,
                pair[1].z as f32,
            )),
            color,
        );
    }
}

fn face_boundary_segments(body: &BodyDto, face: &FaceDto) -> Vec<(Vec3, Vec3)> {
    let start = face.first_index as usize;
    let end = start
        .saturating_add(face.index_count as usize)
        .min(body.mesh.indices.len());
    triangle_boundary_segments(&body.mesh.positions, &body.mesh.indices[start..end])
}

#[derive(Clone, Copy)]
struct BoundarySegment {
    count: u32,
    start: Vec3,
    end: Vec3,
}

fn triangle_boundary_segments(positions: &[f32], indices: &[u32]) -> Vec<(Vec3, Vec3)> {
    let point = |index: u32| {
        let offset = index as usize * 3;
        let value = positions.get(offset..offset + 3)?;
        Some(Vec3::new(value[0], value[1], value[2]))
    };
    let point_key = |value: Vec3| {
        [
            (value.x * 1_000_000.0).round() as i64,
            (value.y * 1_000_000.0).round() as i64,
            (value.z * 1_000_000.0).round() as i64,
        ]
    };
    let mut segments = HashMap::<([i64; 3], [i64; 3]), BoundarySegment>::new();
    for triangle in indices.chunks_exact(3) {
        for (a, b) in [
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ] {
            let (Some(start), Some(end)) = (point(a), point(b)) else {
                continue;
            };
            let start_key = point_key(start);
            let end_key = point_key(end);
            if start_key == end_key {
                continue;
            }
            let key = if start_key <= end_key {
                (start_key, end_key)
            } else {
                (end_key, start_key)
            };
            segments
                .entry(key)
                .and_modify(|segment| segment.count += 1)
                .or_insert(BoundarySegment {
                    count: 1,
                    start,
                    end,
                });
        }
    }
    segments
        .into_values()
        .filter_map(|segment| (segment.count == 1).then_some((segment.start, segment.end)))
        .collect()
}

fn sketch_entity_style(entity: &EntityDto) -> (u64, bool) {
    match entity {
        EntityDto::Point {
            id, fully_defined, ..
        }
        | EntityDto::Line {
            id, fully_defined, ..
        }
        | EntityDto::Arc {
            id, fully_defined, ..
        }
        | EntityDto::Circle {
            id, fully_defined, ..
        }
        | EntityDto::Spline {
            id, fully_defined, ..
        } => (id.0, *fully_defined),
    }
}

fn draw_sketch<Config, ColorFor>(
    gizmos: &mut Gizmos<Config>,
    sketch: &SketchDto,
    point_radius: f32,
    mut color_for: ColorFor,
) where
    Config: GizmoConfigGroup,
    ColorFor: FnMut(&EntityDto) -> Option<Color>,
{
    for entity in &sketch.entities {
        let Some(color) = color_for(entity) else {
            continue;
        };
        draw_sketch_curve(gizmos, &sketch.basis, entity, color);
        draw_sketch_entity_grips(gizmos, &sketch.basis, entity, point_radius, color);
    }
}

fn draw_sketch_curve<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    basis: &PlaneBasis,
    entity: &EntityDto,
    color: Color,
) {
    match entity {
        EntityDto::Point { .. } => {}
        EntityDto::Line { start, end, .. } => {
            gizmos.line(
                sketch_world(basis, start.x, start.y, 0.05),
                sketch_world(basis, end.x, end.y, 0.05),
                color,
            );
        }
        EntityDto::Arc {
            center,
            radius,
            start_angle,
            end_angle,
            ..
        } => {
            let mut sweep = end_angle - start_angle;
            while sweep <= 0.0 {
                sweep += std::f64::consts::TAU;
            }
            let segments = ((sweep.abs() * 20.0).ceil() as usize).clamp(12, 128);
            draw_parametric_curve(gizmos, segments, color, |ratio| {
                let angle = start_angle + sweep * ratio;
                sketch_world(
                    basis,
                    center.x + radius * angle.cos(),
                    center.y + radius * angle.sin(),
                    0.05,
                )
            });
        }
        EntityDto::Circle { center, radius, .. } => {
            draw_parametric_curve(gizmos, 72, color, |ratio| {
                let angle = std::f64::consts::TAU * ratio;
                sketch_world(
                    basis,
                    center.x + radius * angle.cos(),
                    center.y + radius * angle.sin(),
                    0.05,
                )
            });
        }
        EntityDto::Spline { tessellation, .. } => {
            for pair in tessellation.windows(2) {
                gizmos.line(
                    sketch_world(basis, pair[0].x, pair[0].y, 0.05),
                    sketch_world(basis, pair[1].x, pair[1].y, 0.05),
                    color,
                );
            }
        }
    }
}

fn draw_sketch_entity_grips<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    basis: &PlaneBasis,
    entity: &EntityDto,
    point_radius: f32,
    color: Color,
) {
    for position in sketch_grip_positions(entity) {
        draw_sketch_grip(gizmos, basis, position, point_radius, color);
    }
}

fn sketch_grip_positions(entity: &EntityDto) -> &[SketchVec2] {
    match entity {
        EntityDto::Point { position, .. } => std::slice::from_ref(position),
        EntityDto::Arc { center, .. } | EntityDto::Circle { center, .. } => {
            std::slice::from_ref(center)
        }
        EntityDto::Spline { points, .. } => points,
        EntityDto::Line { .. } => &[],
    }
}

fn draw_sketch_grip<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    basis: &PlaneBasis,
    position: &SketchVec2,
    point_radius: f32,
    color: Color,
) {
    let point = sketch_world(basis, position.x, position.y, 0.05);
    let radius = point_radius.max(0.03);
    draw_filled_disc(
        gizmos,
        point,
        basis_vector(basis.u),
        basis_vector(basis.v),
        radius,
        color,
    );
}

/// Gizmos do not expose a filled world-space disc primitive. A handful of
/// parallel chords gives sketch points a true round-dot silhouette while
/// keeping their physical diameter tied to line weight on Retina and
/// standard-density displays.
fn draw_filled_disc<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    center: Vec3,
    u_axis: Vec3,
    v_axis: Vec3,
    radius: f32,
    color: Color,
) {
    const HALF_STEPS: i32 = 4;
    let u = u_axis.normalize_or_zero();
    let v = v_axis.normalize_or_zero();
    if u == Vec3::ZERO || v == Vec3::ZERO {
        return;
    }
    for step in -HALF_STEPS..=HALF_STEPS {
        let ratio = step as f32 / HALF_STEPS as f32;
        let along_v = ratio * radius;
        let half_chord = (radius * radius - along_v * along_v).max(0.0).sqrt();
        let row_center = center + v * along_v;
        gizmos.line(
            row_center - u * half_chord,
            row_center + u * half_chord,
            color,
        );
    }
}

fn draw_parametric_curve(
    gizmos: &mut Gizmos<impl GizmoConfigGroup>,
    segments: usize,
    color: Color,
    point: impl Fn(f64) -> Vec3,
) {
    let mut previous = point(0.0);
    for index in 1..=segments {
        let next = point(index as f64 / segments as f64);
        gizmos.line(previous, next, color);
        previous = next;
    }
}

fn sketch_world(basis: &PlaneBasis, x: f64, y: f64, offset: f32) -> Vec3 {
    Vec3::new(
        (basis.origin[0] + basis.u[0] * x + basis.v[0] * y) as f32,
        (basis.origin[1] + basis.u[1] * x + basis.v[1] * y) as f32,
        (basis.origin[2] + basis.u[2] * x + basis.v[2] * y) as f32,
    ) + basis_vector(basis.normal) * offset
}

fn draw_profile_loop<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    basis: &PlaneBasis,
    profile: &ProfileLoopDto,
    color: Color,
) {
    if profile.points.len() < 2 {
        return;
    }
    for index in 0..profile.points.len() {
        let start = profile.points[index];
        let end = profile.points[(index + 1) % profile.points.len()];
        gizmos.line(
            sketch_world(basis, start.x, start.y, 0.08),
            sketch_world(basis, end.x, end.y, 0.08),
            color,
        );
    }
}

fn basis_vector(vector: [f64; 3]) -> Vec3 {
    Vec3::new(vector[0] as f32, vector[1] as f32, vector[2] as f32)
}

fn rgb(value: [f32; 3]) -> Color {
    Color::srgb(value[0], value[1], value[2])
}

fn rgba(value: [f32; 3], alpha: f32) -> Color {
    Color::srgba(value[0], value[1], value[2], alpha)
}

fn push_render_command(
    pending: &Arc<Mutex<PendingRenderCommands>>,
    command: RenderCommand,
) -> bool {
    let Ok(mut pending) = pending.lock() else {
        return false;
    };
    match command {
        RenderCommand::Resize {
            logical_width,
            logical_height,
            scale_factor,
            palette,
            hud,
        } => pending.resize = Some((logical_width, logical_height, scale_factor, palette, hud)),
        RenderCommand::Model(model) => pending.model = Some(model),
        RenderCommand::RebindModelSession { from, to } => {
            if !pending
                .rebind_model_sessions
                .iter()
                .any(|(existing_from, existing_to)| existing_from == &from && existing_to == &to)
            {
                pending.rebind_model_sessions.push((from, to));
            }
        }
        RenderCommand::DropModelSession(session_id) => {
            if !pending.drop_model_sessions.contains(&session_id) {
                pending.drop_model_sessions.push(session_id);
            }
        }
        RenderCommand::Camera(camera) => pending.camera = Some(camera),
        RenderCommand::Preview(preview) => pending.preview = Some(preview),
        RenderCommand::Presentation(presentation) => {
            pending.presentation = Some(presentation);
        }
    }
    if pending.scheduled {
        false
    } else {
        pending.scheduled = true;
        true
    }
}

/// Drains coalesced mutations on the platform UI thread. The Bevy App is kept
/// behind a process-lifetime pointer that is never dereferenced elsewhere.
fn drain_render_commands(
    runtime_pointer: &Arc<AtomicUsize>,
    pending: &Arc<Mutex<PendingRenderCommands>>,
    metrics: &Arc<Mutex<MetricsState>>,
) {
    #[cfg(target_os = "macos")]
    debug_assert!(MainThreadMarker::new().is_some());
    let pointer = runtime_pointer.load(Ordering::Acquire);
    if pointer == 0 {
        if let Ok(mut pending) = pending.lock() {
            pending.scheduled = false;
        }
        return;
    }
    let runtime = unsafe { &mut *(pointer as *mut MainThreadRenderRuntime) };

    loop {
        let commands = {
            let Ok(mut pending) = pending.lock() else {
                return;
            };
            if pending.resize.is_none()
                && pending.model.is_none()
                && pending.rebind_model_sessions.is_empty()
                && pending.drop_model_sessions.is_empty()
                && pending.camera.is_none()
                && pending.preview.is_none()
                && pending.presentation.is_none()
            {
                pending.scheduled = false;
                return;
            }
            (
                pending.resize.take(),
                pending.model.take(),
                std::mem::take(&mut pending.rebind_model_sessions),
                std::mem::take(&mut pending.drop_model_sessions),
                pending.camera.take(),
                pending.preview.take(),
                pending.presentation.take(),
            )
        };
        let requires_pipeline_settle = commands.0.is_some()
            || commands.1.is_some()
            || !commands.2.is_empty()
            || !commands.3.is_empty()
            || commands.5.is_some();

        if let Ok(mut current) = metrics.lock() {
            current.wakeups += 1;
        }
        let mut dirty = false;
        if let Some((logical_width, logical_height, scale_factor, palette, hud)) = commands.0 {
            apply_render_command(
                RenderCommand::Resize {
                    logical_width,
                    logical_height,
                    scale_factor,
                    palette,
                    hud,
                },
                runtime,
                metrics,
                &mut dirty,
            );
        }
        if let Some(model) = commands.1 {
            apply_render_command(RenderCommand::Model(model), runtime, metrics, &mut dirty);
        }
        for (from, to) in commands.2 {
            apply_render_command(
                RenderCommand::RebindModelSession { from, to },
                runtime,
                metrics,
                &mut dirty,
            );
        }
        for session_id in commands.3 {
            apply_render_command(
                RenderCommand::DropModelSession(session_id),
                runtime,
                metrics,
                &mut dirty,
            );
        }
        if let Some(camera) = commands.4 {
            apply_render_command(RenderCommand::Camera(camera), runtime, metrics, &mut dirty);
        }
        if let Some(preview) = commands.5 {
            apply_render_command(
                RenderCommand::Preview(preview),
                runtime,
                metrics,
                &mut dirty,
            );
        }
        if let Some(presentation) = commands.6 {
            apply_render_command(
                RenderCommand::Presentation(presentation),
                runtime,
                metrics,
                &mut dirty,
            );
        }
        if dirty {
            // Structural changes get a second update to settle Bevy's
            // extracted/pipelined render world. Camera and presentation-only
            // changes use one frame on every platform; rendering them twice
            // adds pointer latency without creating any new GPU pipelines.
            render_frames(
                &mut runtime.app,
                if requires_pipeline_settle { 2 } else { 1 },
                metrics,
            );
            maybe_write_ready_probe(metrics);
        }
    }
}

fn apply_render_command(
    command: RenderCommand,
    runtime: &mut MainThreadRenderRuntime,
    metrics: &Arc<Mutex<MetricsState>>,
    dirty: &mut bool,
) {
    match command {
        RenderCommand::Resize {
            logical_width,
            logical_height,
            scale_factor,
            palette,
            hud,
        } => {
            let physical_width = (logical_width * scale_factor).round().max(1.0) as u32;
            let physical_height = (logical_height * scale_factor).round().max(1.0) as u32;
            let logical_size_changed = (runtime.logical_size.0 - logical_width as f32).abs() > 0.01
                || (runtime.logical_size.1 - logical_height as f32).abs() > 0.01;
            let scale_factor_changed = (runtime.scale_factor - scale_factor as f32).abs() > 0.001;
            let size_changed = logical_size_changed || scale_factor_changed;
            if size_changed {
                resize_embedded_window(
                    runtime.app.world_mut(),
                    logical_width as f32,
                    logical_height as f32,
                    scale_factor as f32,
                    scale_factor_changed,
                );
            }
            {
                let mut viewport = runtime
                    .app
                    .world_mut()
                    .resource_mut::<ViewportSizeResource>();
                viewport.logical_width = logical_width as f32;
                viewport.logical_height = logical_height as f32;
            }
            let palette_changed = runtime.app.world().resource::<PaletteResource>().0 != palette;
            if palette_changed {
                *runtime.app.world_mut().resource_mut::<ClearColor>() =
                    ClearColor(rgb(palette.background));
                runtime.app.world_mut().resource_mut::<PaletteResource>().0 = palette;
                let mut model = runtime.app.world_mut().resource_mut::<ModelResource>();
                model.revision = model.revision.wrapping_add(1);
            }
            let hud_changed = runtime.app.world().resource::<HudResource>().hud != hud;
            if hud_changed || palette_changed {
                let mut resource = runtime.app.world_mut().resource_mut::<HudResource>();
                resource.hud = hud;
                resource.revision = resource.revision.wrapping_add(1);
            }
            runtime.logical_size = (logical_width as f32, logical_height as f32);
            runtime.scale_factor = scale_factor as f32;
            let mut first_layout = false;
            if let Ok(mut current) = metrics.lock() {
                first_layout = current.physical_width == 0;
                current.logical_width = logical_width;
                current.logical_height = logical_height;
                current.scale_factor = scale_factor;
                current.physical_width = physical_width;
                current.physical_height = physical_height;
            }
            if first_layout {
                eprintln!(
                    "native Bevy viewport ready: {:.0}x{:.0} logical, {}x{} physical, {:.2}x scale",
                    logical_width, logical_height, physical_width, physical_height, scale_factor
                );
            }
            // A full-screen transition can reparent/recreate the native layer
            // without changing its final dimensions. Every accepted layout is
            // therefore also an explicit redraw request.
            *dirty = true;
        }
        RenderCommand::Model(mut next) => {
            next.session_id = canonical_model_session(&runtime.session_aliases, &next.session_id);
            runtime.model = next;
            let mut resource = runtime.app.world_mut().resource_mut::<ModelResource>();
            resource.session_id = runtime.model.session_id.clone();
            resource.geometry_revision = runtime.model.geometry_revision;
            resource.scene = runtime.model.scene.clone();
            resource.active_sketch = runtime.model.active_sketch.clone();
            resource.finished_sketches = runtime.model.finished_sketches.clone();
            resource.datum_planes = runtime.model.datum_planes.clone();
            resource.profile_catalog = runtime.model.profile_catalog.clone();
            resource.body_appearances = runtime.model.body_appearances.clone();
            resource.body_poses = runtime.model.body_poses.clone();
            if !same_instance_layout(
                &resource.instance_body_poses,
                &runtime.model.instance_body_poses,
            ) {
                resource.instance_revision = resource.instance_revision.wrapping_add(1);
            }
            resource.instance_body_poses = runtime.model.instance_body_poses.clone();
            resource.revision = resource.revision.wrapping_add(1);
            if let Ok(mut current) = metrics.lock() {
                current.body_count = runtime.model.scene.bodies.len();
                current.triangle_count = runtime
                    .model
                    .scene
                    .bodies
                    .iter()
                    .map(|body| body.mesh.indices.len() / 3)
                    .sum();
            }
            *dirty = true;
        }
        RenderCommand::RebindModelSession { from, to } => {
            if from != to {
                let to = canonical_model_session(&runtime.session_aliases, &to);
                for alias in runtime.session_aliases.values_mut() {
                    if *alias == from {
                        *alias = to.clone();
                    }
                }
                runtime.session_aliases.insert(from.clone(), to.clone());
                if runtime.model.session_id == from {
                    runtime.model.session_id = to.clone();
                }
                if rebind_cached_model_session(runtime.app.world_mut(), &from, &to) {
                    *dirty = true;
                }
            }
        }
        RenderCommand::DropModelSession(session_id) => {
            drop_cached_model_session(runtime.app.world_mut(), &session_id);
            *dirty = true;
        }
        RenderCommand::Camera(next) => {
            runtime.camera = next;
            let mut resource = runtime.app.world_mut().resource_mut::<CameraResource>();
            resource.camera = next;
            resource.revision = resource.revision.wrapping_add(1);
            *dirty = true;
        }
        RenderCommand::Preview(next) => {
            let mut resource = runtime.app.world_mut().resource_mut::<PreviewResource>();
            if preview_mesh_content_changed(&resource.value, &next) {
                resource.mesh_revision = resource.mesh_revision.wrapping_add(1);
            }
            resource.value = next;
            resource.revision = resource.revision.wrapping_add(1);
            *dirty = true;
        }
        RenderCommand::Presentation(next) => {
            if runtime.model.body_poses != next.body_poses
                || runtime.model.instance_body_poses != next.instance_body_poses
            {
                let layout_changed = !same_instance_layout(
                    &runtime.model.instance_body_poses,
                    &next.instance_body_poses,
                );
                runtime.model.body_poses = next.body_poses.clone();
                runtime.model.instance_body_poses = next.instance_body_poses.clone();
                let mut model = runtime.app.world_mut().resource_mut::<ModelResource>();
                model.body_poses = next.body_poses.clone();
                model.instance_body_poses = next.instance_body_poses.clone();
                if layout_changed {
                    model.instance_revision = model.instance_revision.wrapping_add(1);
                }
                model.revision = model.revision.wrapping_add(1);
            }
            let mut resource = runtime
                .app
                .world_mut()
                .resource_mut::<PresentationResource>();
            if resource.0 != next {
                resource.0 = next;
                *dirty = true;
            }
        }
    }
}

fn preview_mesh_content_changed(current: &ViewportPreview, next: &ViewportPreview) -> bool {
    current.triangles != next.triangles || current.arrows != next.arrows
}

fn canonical_model_session(aliases: &HashMap<String, String>, session_id: &str) -> String {
    let mut current = session_id;
    for _ in 0..aliases.len() {
        let Some(next) = aliases.get(current) else {
            break;
        };
        if next == current {
            break;
        }
        current = next;
    }
    current.to_string()
}

/// Transfer already-uploaded GPU geometry to the permanent project-tab id.
/// This preserves the recovered solid and avoids retessellating it during the
/// startup handoff from the reserved bootstrap engine session.
fn rebind_cached_model_session(world: &mut World, from: &str, to: &str) -> bool {
    if from == to {
        return false;
    }

    let mut changed = false;
    {
        let mut query = world.query::<&mut NativeModelGeometry>();
        for mut geometry in query.iter_mut(world) {
            if geometry.session_id == from {
                geometry.session_id = to.to_string();
                changed = true;
            }
        }
    }
    {
        let mut model = world.resource_mut::<ModelResource>();
        if model.session_id == from {
            model.session_id = to.to_string();
            changed = true;
        }
    }
    {
        let mut cache = world.resource_mut::<ModelGeometryCache>();
        if let Some(revision) = cache.0.remove(from) {
            cache.0.insert(to.to_string(), revision);
            changed = true;
        }
    }
    changed
}

fn drop_cached_model_session(world: &mut World, session_id: &str) {
    let entities = {
        let mut query = world.query::<(Entity, &NativeModelGeometry)>();
        query
            .iter(world)
            .filter_map(|(entity, geometry)| (geometry.session_id == session_id).then_some(entity))
            .collect::<Vec<_>>()
    };
    for entity in entities {
        world.despawn(entity);
    }
    world
        .resource_mut::<ModelGeometryCache>()
        .0
        .remove(session_id);
}

fn resize_embedded_window(
    world: &mut World,
    logical_width: f32,
    logical_height: f32,
    scale_factor: f32,
    scale_factor_changed: bool,
) -> bool {
    let physical_width = (logical_width * scale_factor).round().max(1.0) as u32;
    let physical_height = (logical_height * scale_factor).round().max(1.0) as u32;
    let window_entity = {
        let mut query = world.query_filtered::<(Entity, &mut Window), With<PrimaryWindow>>();
        let Ok((window_entity, mut window)) = query.single_mut(world) else {
            return false;
        };
        window
            .resolution
            .set_scale_factor_override(Some(scale_factor));
        window
            .resolution
            .set_physical_resolution(physical_width, physical_height);
        window_entity
    };

    // This embedded renderer does not run bevy_winit, so no OS adapter exists
    // to translate host resize notifications into Bevy messages. camera_system
    // relies on these messages to recompute PerspectiveProjection::aspect_ratio;
    // without one, the swapchain stretches the old projection until camera
    // motion happens to mark Projection as changed.
    world.write_message(WindowResized {
        window: window_entity,
        width: logical_width,
        height: logical_height,
    });
    if scale_factor_changed {
        world.write_message(WindowScaleFactorChanged {
            window: window_entity,
            scale_factor: scale_factor as f64,
        });
    }
    true
}

fn render_frames(app: &mut bevy::app::App, count: usize, metrics: &Arc<Mutex<MetricsState>>) {
    for _ in 0..count {
        let started = Instant::now();
        app.update();
        let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
        if let Ok(mut current) = metrics.lock() {
            current.rendered_frames += 1;
            current.total_frame_ms += elapsed_ms;
        }
    }
}

fn pick_occt_scene(
    scene: &SolidSceneDto,
    camera: ViewportCamera,
    viewport: (f32, f32),
    x: f32,
    y: f32,
    hidden_body_ids: &[u64],
    body_poses: &[BodyPoseDto],
    instance_body_poses: &[InstanceBodyPoseDto],
) -> Option<NativePick> {
    if viewport.0 <= 1.0 || viewport.1 <= 1.0 {
        return None;
    }
    let origin = Vec3::from_array(camera.position);
    let forward = (Vec3::from_array(camera.target) - origin).normalize_or_zero();
    let up_hint = Vec3::from_array(camera.up).normalize_or_zero();
    let right = forward.cross(up_hint).normalize_or_zero();
    let up = right.cross(forward).normalize_or_zero();
    if forward == Vec3::ZERO || right == Vec3::ZERO || up == Vec3::ZERO {
        return None;
    }

    let ndc_x = x / viewport.0 * 2.0 - 1.0;
    let ndc_y = 1.0 - y / viewport.1 * 2.0;
    let tangent = (camera.vertical_fov_degrees.to_radians() * 0.5).tan();
    let aspect = viewport.0 / viewport.1;
    let direction = (forward + right * ndc_x * tangent * aspect + up * ndc_y * tangent).normalize();
    let world_per_pixel_factor = 2.0 * tangent / viewport.1;

    let mut best: Option<NativePick> = None;
    for body in &scene.bodies {
        if hidden_body_ids.contains(&body.id.0) {
            continue;
        }
        let instances = if instance_body_poses.is_empty() {
            vec![(None, body_pose_transform(body_poses, body.id.0))]
        } else {
            instance_body_poses
                .iter()
                .filter(|instance| instance.body_id == body.id && instance.visible)
                .map(|instance| {
                    (
                        Some(instance.occurrence_id.0),
                        instance_body_pose_transform(
                            instance_body_poses,
                            body_poses,
                            body.id.0,
                            Some(instance.occurrence_id.0),
                        ),
                    )
                })
                .collect::<Vec<_>>()
        };
        for (occurrence_id, transform) in instances {
            pick_body(
                body,
                occurrence_id,
                transform,
                origin,
                direction,
                world_per_pixel_factor,
                &mut best,
            );
        }
    }
    best
}

fn pick_body(
    body: &BodyDto,
    occurrence_id: Option<u64>,
    transform: Transform,
    origin: Vec3,
    direction: Vec3,
    world_per_pixel_factor: f32,
    best: &mut Option<NativePick>,
) {
    let inverse_rotation = transform.rotation.inverse();
    for face in &body.faces {
        let start = face.first_index as usize;
        let end = start
            .saturating_add(face.index_count as usize)
            .min(body.mesh.indices.len());
        for triangle in body.mesh.indices[start..end].chunks_exact(3) {
            let Some(a) =
                mesh_position(body, triangle[0]).map(|point| transform.transform_point(point))
            else {
                continue;
            };
            let Some(b) =
                mesh_position(body, triangle[1]).map(|point| transform.transform_point(point))
            else {
                continue;
            };
            let Some(c) =
                mesh_position(body, triangle[2]).map(|point| transform.transform_point(point))
            else {
                continue;
            };
            let Some(distance) = ray_triangle(origin, direction, a, b, c) else {
                continue;
            };
            let world_point = origin + direction * distance;
            let local_point = inverse_rotation * (world_point - transform.translation);
            let connector = connector_for_face(face, local_point);
            if !pick_should_replace(
                best.as_ref(),
                distance,
                connector.as_ref().map(|value| value.kind),
            ) {
                continue;
            }
            *best = Some(NativePick {
                body_id: body.id.0,
                occurrence_id,
                face_id: face.id.0,
                edge_id: None,
                point: world_point.to_array(),
                distance,
                connector_kind: connector.as_ref().map(|value| value.kind.to_string()),
                connector_origin: connector.as_ref().map(|value| value.origin.to_array()),
                connector_primary_axis: connector
                    .as_ref()
                    .map(|value| value.primary_axis.to_array()),
                connector_secondary_axis: connector
                    .as_ref()
                    .map(|value| value.secondary_axis.to_array()),
                connector_radius: connector.as_ref().and_then(|value| value.radius),
            });
        }

        let Some(cylinder) = face.cylinder else {
            continue;
        };
        let axis = Vec3::new(
            cylinder.axis.x as f32,
            cylinder.axis.y as f32,
            cylinder.axis.z as f32,
        )
        .normalize_or_zero();
        if axis == Vec3::ZERO || !cylinder.radius.is_finite() || cylinder.radius <= 0.0 {
            continue;
        }
        let axis_origin = Vec3::new(
            cylinder.origin.x as f32,
            cylinder.origin.y as f32,
            cylinder.origin.z as f32,
        );
        let mut min_axial = f32::INFINITY;
        let mut max_axial = f32::NEG_INFINITY;
        for index in &body.mesh.indices[start..end] {
            let Some(point) = mesh_position(body, *index) else {
                continue;
            };
            let axial = (point - axis_origin).dot(axis);
            min_axial = min_axial.min(axial);
            max_axial = max_axial.max(axial);
        }
        if !min_axial.is_finite() || !max_axial.is_finite() || max_axial - min_axial <= 1.0e-5 {
            continue;
        }
        let reference = Vec3::new(
            cylinder.reference.x as f32,
            cylinder.reference.y as f32,
            cylinder.reference.z as f32,
        );
        for (axial, sign) in [(min_axial, -1.0_f32), (max_axial, 1.0_f32)] {
            let local_center = axis_origin + axis * axial;
            let local_primary = axis * sign;
            let world_center = transform.transform_point(local_center);
            let world_normal = (transform.rotation * local_primary).normalize_or_zero();
            let Some(distance) = ray_plane_disk(
                origin,
                direction,
                world_center,
                world_normal,
                cylinder.radius as f32,
            ) else {
                continue;
            };
            if !pick_should_replace(best.as_ref(), distance, Some("virtual_circular_face")) {
                continue;
            }
            let secondary = orthogonal_reference(axis, reference);
            *best = Some(NativePick {
                body_id: body.id.0,
                occurrence_id,
                face_id: face.id.0,
                edge_id: None,
                point: (origin + direction * distance).to_array(),
                distance,
                connector_kind: Some("virtual_circular_face".to_string()),
                connector_origin: Some(local_center.to_array()),
                connector_primary_axis: Some(local_primary.to_array()),
                connector_secondary_axis: Some(secondary.to_array()),
                connector_radius: Some(cylinder.radius as f32),
            });
        }
    }

    for edge in &body.edges {
        let Some(circle) = edge.circle.filter(|circle| circle.closed) else {
            continue;
        };
        if !circle.radius.is_finite() || circle.radius <= 0.0 {
            continue;
        }
        let local_center = Vec3::new(
            circle.center.x as f32,
            circle.center.y as f32,
            circle.center.z as f32,
        );
        let local_normal = Vec3::new(
            circle.normal.x as f32,
            circle.normal.y as f32,
            circle.normal.z as f32,
        )
        .normalize_or_zero();
        let local_reference = Vec3::new(
            circle.reference.x as f32,
            circle.reference.y as f32,
            circle.reference.z as f32,
        );
        if local_normal == Vec3::ZERO {
            continue;
        }
        let world_center = transform.transform_point(local_center);
        let world_normal = (transform.rotation * local_normal).normalize_or_zero();
        let Some(distance) = ray_plane_ring(
            origin,
            direction,
            world_center,
            world_normal,
            circle.radius as f32,
            world_per_pixel_factor,
        ) else {
            continue;
        };
        if !pick_should_replace(best.as_ref(), distance, Some("circular_edge")) {
            continue;
        }
        *best = Some(NativePick {
            body_id: body.id.0,
            occurrence_id,
            face_id: 0,
            edge_id: Some(edge.id.0),
            point: (origin + direction * distance).to_array(),
            distance,
            connector_kind: Some("circular_edge".to_string()),
            connector_origin: Some(local_center.to_array()),
            connector_primary_axis: Some(local_normal.to_array()),
            connector_secondary_axis: Some(
                orthogonal_reference(local_normal, local_reference).to_array(),
            ),
            connector_radius: Some(circle.radius as f32),
        });
    }
}

struct PickConnectorFrame {
    kind: &'static str,
    origin: Vec3,
    primary_axis: Vec3,
    secondary_axis: Vec3,
    radius: Option<f32>,
}

fn connector_for_face(
    face: &nbcad_solid::FaceDto,
    local_point: Vec3,
) -> Option<PickConnectorFrame> {
    if let Some(plane) = face.plane {
        let origin = face.signature.map_or_else(
            || {
                Vec3::new(
                    plane.origin[0] as f32,
                    plane.origin[1] as f32,
                    plane.origin[2] as f32,
                )
            },
            |signature| {
                Vec3::new(
                    signature.centroid.x as f32,
                    signature.centroid.y as f32,
                    signature.centroid.z as f32,
                )
            },
        );
        return Some(PickConnectorFrame {
            kind: "planar_face",
            origin,
            primary_axis: Vec3::new(
                plane.normal[0] as f32,
                plane.normal[1] as f32,
                plane.normal[2] as f32,
            )
            .normalize_or_zero(),
            secondary_axis: Vec3::new(plane.u[0] as f32, plane.u[1] as f32, plane.u[2] as f32)
                .normalize_or_zero(),
            radius: None,
        });
    }
    let cylinder = face.cylinder?;
    let axis_origin = Vec3::new(
        cylinder.origin.x as f32,
        cylinder.origin.y as f32,
        cylinder.origin.z as f32,
    );
    let axis = Vec3::new(
        cylinder.axis.x as f32,
        cylinder.axis.y as f32,
        cylinder.axis.z as f32,
    )
    .normalize_or_zero();
    if axis == Vec3::ZERO {
        return None;
    }
    let origin = axis_origin + axis * (local_point - axis_origin).dot(axis);
    let reference = Vec3::new(
        cylinder.reference.x as f32,
        cylinder.reference.y as f32,
        cylinder.reference.z as f32,
    );
    let radial = local_point - origin;
    Some(PickConnectorFrame {
        kind: "cylindrical_face",
        origin,
        primary_axis: axis,
        secondary_axis: if radial.length_squared() > 1.0e-10 {
            radial.normalize()
        } else {
            orthogonal_reference(axis, reference)
        },
        radius: Some(cylinder.radius as f32),
    })
}

fn orthogonal_reference(axis: Vec3, candidate: Vec3) -> Vec3 {
    let projected = candidate - axis * candidate.dot(axis);
    if projected.length_squared() > 1.0e-10 {
        projected.normalize()
    } else {
        let fallback = if axis.cross(Vec3::X).length_squared() > 1.0e-10 {
            Vec3::X
        } else {
            Vec3::Y
        };
        (fallback - axis * fallback.dot(axis)).normalize_or_zero()
    }
}

fn pick_should_replace(
    current: Option<&NativePick>,
    distance: f32,
    candidate_kind: Option<&str>,
) -> bool {
    let Some(current) = current else {
        return true;
    };
    const TIE_EPSILON: f32 = 1.0e-4;
    if distance < current.distance - TIE_EPSILON {
        return true;
    }
    if (distance - current.distance).abs() > TIE_EPSILON {
        return false;
    }
    let priority = |kind: Option<&str>| match kind {
        Some("circular_edge") => 2,
        Some("virtual_circular_face") => 0,
        _ => 1,
    };
    priority(candidate_kind) > priority(current.connector_kind.as_deref())
}

fn ray_plane_disk(
    origin: Vec3,
    direction: Vec3,
    center: Vec3,
    normal: Vec3,
    radius: f32,
) -> Option<f32> {
    let denominator = direction.dot(normal);
    if denominator.abs() <= 1.0e-7 {
        return None;
    }
    let distance = (center - origin).dot(normal) / denominator;
    if distance <= 1.0e-5 {
        return None;
    }
    let point = origin + direction * distance;
    ((point - center).length_squared() <= (radius * 1.025).powi(2)).then_some(distance)
}

fn ray_plane_ring(
    origin: Vec3,
    direction: Vec3,
    center: Vec3,
    normal: Vec3,
    radius: f32,
    world_per_pixel_factor: f32,
) -> Option<f32> {
    let denominator = direction.dot(normal);
    if denominator.abs() <= 1.0e-7 {
        return None;
    }
    let distance = (center - origin).dot(normal) / denominator;
    if distance <= 1.0e-5 {
        return None;
    }
    let point = origin + direction * distance;
    let radial_distance = (point - center).length();
    let tolerance = (distance * world_per_pixel_factor * 6.0)
        .max(radius * 0.01)
        .max(0.025);
    ((radial_distance - radius).abs() <= tolerance).then_some(distance)
}

fn mesh_position(body: &BodyDto, index: u32) -> Option<Vec3> {
    let offset = index as usize * 3;
    let coordinates = body.mesh.positions.get(offset..offset + 3)?;
    Some(Vec3::new(coordinates[0], coordinates[1], coordinates[2]))
}

fn ray_triangle(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3) -> Option<f32> {
    let edge_1 = b - a;
    let edge_2 = c - a;
    let p = direction.cross(edge_2);
    let determinant = edge_1.dot(p);
    if determinant.abs() < 1.0e-7 {
        return None;
    }
    let inverse = 1.0 / determinant;
    let t = origin - a;
    let u = t.dot(p) * inverse;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = t.cross(edge_1);
    let v = direction.dot(q) * inverse;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let distance = edge_2.dot(q) * inverse;
    (distance > 0.0).then_some(distance)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_engine_ok(response: String) -> serde_json::Value {
        let envelope: serde_json::Value =
            serde_json::from_str(&response).expect("engine response should be JSON");
        assert_eq!(envelope["ok"], true, "engine error: {envelope}");
        envelope["value"].clone()
    }

    #[test]
    fn cad_studio_lights_are_camera_relative_and_bilaterally_balanced() {
        let camera = ViewportCamera::default();
        let target = Vec3::from_array(camera.target);
        let view = (Vec3::from_array(camera.position) - target).normalize();
        let up = Vec3::from_array(camera.up).normalize();
        let right = view.cross(up).normalize();
        let (key, fill) = camera_relative_light_transforms(camera);
        let key_direction = (key.translation - target).normalize();
        let fill_direction = (fill.translation - target).normalize();

        assert!((key_direction.dot(view) - fill_direction.dot(view)).abs() < 1.0e-6);
        assert!((key_direction.dot(right) + fill_direction.dot(right)).abs() < 1.0e-6);

        let rotated = ViewportCamera {
            position: [-170.0, -170.0, 130.0],
            ..camera
        };
        let (rotated_key, rotated_fill) = camera_relative_light_transforms(rotated);
        assert_ne!(key.translation, rotated_key.translation);
        assert_ne!(fill.translation, rotated_fill.translation);
    }

    #[test]
    fn camera_transform_stays_finite_at_up_axis_alignment() {
        for position in [[0.0, 0.0, -25.0], [0.0, 0.0, 25.0]] {
            let transform = camera_transform(ViewportCamera {
                position,
                target: [0.0, 0.0, 0.0],
                up: [0.0, 0.0, 1.0],
                ..ViewportCamera::default()
            });
            assert!(
                transform
                    .to_matrix()
                    .to_cols_array()
                    .iter()
                    .all(|value| value.is_finite()),
                "camera transform must remain finite at position {position:?}"
            );
        }
    }

    #[test]
    fn native_model_carries_closed_profiles_from_an_internal_midplane_sketch() {
        let state = crate::state::AppState::new();
        assert_engine_ok(
            state.engine_call("begin_sketch", r#"{"type":"origin_plane","plane":"xy"}"#),
        );
        assert_engine_ok(state.engine_call(
            "add_rectangle",
            r#"{
                "mode":"two_point",
                "p1":{"x":-20.0,"y":-20.0},
                "p2":{"x":20.0,"y":20.0},
                "ctrl_held":false
            }"#,
        ));
        assert_engine_ok(state.engine_call("end_sketch", ""));
        assert_engine_ok(state.solid_extrude(
            r#"{
                "sketch_name":"Sketch1",
                "profile_indices":[0],
                "operation":"new_body",
                "extent":{"type":"distance","distance":20.0},
                "taper_angle_deg":0.0,
                "flip":false,
                "target_body_ids":[]
            }"#,
        ));
        assert_engine_ok(state.engine_call(
            "datum_plane_create",
            r#"{
                "source":{
                    "type":"offset",
                    "reference":{"type":"origin_plane","plane":"xy"},
                    "distance":20.0
                }
            }"#,
        ));
        assert_engine_ok(state.engine_call(
            "datum_plane_create",
            r#"{
                "source":{
                    "type":"midplane",
                    "first":{"type":"origin_plane","plane":"xy"},
                    "second":{"type":"datum_plane","datum_id":1}
                }
            }"#,
        ));
        assert_engine_ok(
            state.engine_call("begin_sketch", r#"{"type":"datum_plane","datum_id":2}"#),
        );
        assert_engine_ok(state.engine_call(
            "add_rectangle",
            r#"{
                "mode":"two_point",
                "p1":{"x":-5.0,"y":-5.0},
                "p2":{"x":5.0,"y":5.0},
                "ctrl_held":false
            }"#,
        ));
        assert_engine_ok(state.engine_call("end_sketch", ""));

        let (_, _, scene, _, _, datum_planes, profile_catalog, _, _, _) = state.viewport_snapshot();
        assert_eq!(scene.bodies.len(), 1);
        assert_eq!(datum_planes.len(), 2);
        assert!((datum_planes[1].basis.origin[2] - 10.0).abs() < 1.0e-9);
        let profile = profile_catalog
            .iter()
            .find(|entry| entry.sketch_name == "Sketch2")
            .expect("the internal midplane sketch must reach the native model");
        assert_eq!(profile.profiles.len(), 1);
        assert_eq!(profile.profiles[0].nesting_depth, 0);
        assert_eq!(profile.profiles[0].points.len(), 4);
        assert!((profile.basis.origin[2] - 10.0).abs() < 1.0e-9);
    }

    #[test]
    fn visible_sketch_points_use_the_persistent_always_on_top_layer() {
        let point: EntityDto = serde_json::from_str(
            r#"{
                "kind": "point",
                "id": 7,
                "position": { "x": 0.0, "y": 0.0 },
                "fully_defined": false
            }"#,
        )
        .expect("standalone sketch point should deserialize");

        assert_eq!(sketch_grip_positions(&point), &[SketchVec2::ZERO]);
        assert_eq!(SKETCH_DEPTH_BIAS, -1.0);
        assert!(SKETCH_POINT_OUTLINE_DEPTH_BIAS > SKETCH_DEPTH_BIAS);
        assert!(SKETCH_LINE_WIDTH < HIGHLIGHT_LINE_WIDTH);
        assert!(SKETCH_POINT_OUTLINE_WIDTH > SKETCH_LINE_WIDTH);
        assert!(SKETCH_POINT_OUTLINE_WIDTH <= 2.0);
        assert!(SKETCH_POINT_OUTLINE_RADIUS_PX > SKETCH_POINT_RADIUS_PX);
        assert!(SKETCH_POINT_OUTLINE_RADIUS_PX < 3.5);
        assert!(HIGHLIGHT_LINE_WIDTH <= 2.0);
    }

    #[test]
    fn native_preview_preserves_endpoint_snap_semantics() {
        let preview: ViewportPreview = serde_json::from_str(
            r#"{
                "lines": [{
                    "color": [0.2, 0.7, 1.0, 0.68],
                    "width": 1.15,
                    "pattern": "dotted",
                    "segments": [0.0, 0.0, 0.0, 10.0, 0.0, 0.0]
                }],
                "points": [],
                "triangles": [{
                    "color": [1.0, 0.4, 0.2, 0.25],
                    "positions": [0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 5.0, 0.0],
                    "xray": true
                }],
                "arrows": [{
                    "start": [0.0, 0.0, 0.0],
                    "end": [0.0, 0.0, 10.0],
                    "color": [0.2, 0.7, 1.0, 1.0],
                    "width": 2.0,
                    "xray": true
                }],
                "annotations": [],
                "marker": {
                    "position": [12.0, -4.0, 0.18],
                    "kind": "point"
                }
            }"#,
        )
        .expect("semantic snap marker should deserialize across the Tauri boundary");

        let marker = preview.marker.expect("endpoint marker should be retained");
        assert_eq!(marker.kind, ViewportSnapKind::Point);
        assert_eq!(marker.position, [12.0, -4.0, 0.18]);
        assert_eq!(preview.lines[0].pattern, ViewportLinePattern::Dotted);
        assert_eq!(preview.lines[0].segments.len(), 6);
        assert!(preview.triangles[0].xray);
        assert_eq!(preview.triangles[0].positions.len(), 9);
        assert_eq!(preview.arrows[0].end, [0.0, 0.0, 10.0]);
        assert_eq!(preview.arrows[0].width, 2.0);
        assert!(HIGHLIGHT_LINE_WIDTH <= 2.0);
        assert!(SNAP_MARKER_HALF_SIZE_PX >= 5.0);
    }

    #[test]
    fn camera_frequency_annotation_updates_do_not_rebuild_preview_meshes() {
        let base: ViewportPreview = serde_json::from_str(
            r#"{
                "lines": [],
                "points": [],
                "triangles": [{
                    "color": [0.2, 0.7, 1.0, 0.25],
                    "positions": [0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 10.0, 0.0],
                    "xray": true
                }],
                "arrows": [{
                    "start": [0.0, 0.0, 0.0],
                    "end": [0.0, 0.0, 10.0],
                    "color": [0.2, 0.7, 1.0, 1.0],
                    "width": 2.0,
                    "xray": true
                }],
                "annotations": [{
                    "screen": [100.0, 100.0],
                    "color": [1.0, 1.0, 1.0, 1.0],
                    "text": "10 mm",
                    "kind": "dimension"
                }],
                "marker": null
            }"#,
        )
        .expect("preview should deserialize");
        let mut moved_annotation = base.clone();
        moved_annotation.annotations[0].screen = [420.0, 240.0];
        assert!(
            !preview_mesh_content_changed(&base, &moved_annotation),
            "camera projection updates must keep retained GPU meshes"
        );

        let mut edited_tool = base.clone();
        edited_tool.arrows[0].end[2] = 25.0;
        assert!(preview_mesh_content_changed(&base, &edited_tool));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn dom_rect_mapping_accounts_for_window_title_bar_safe_area() {
        let bounds = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1_440.0, 900.0));
        let content = NSRect::new(NSPoint::new(0.0, 32.0), NSSize::new(1_440.0, 868.0));
        let viewport = ViewportRect {
            x: 240.0,
            y: 120.0,
            width: 1_200.0,
            height: 700.0,
            corner_radius: 0.0,
        };

        let mapped = dom_rect_to_content_rect(bounds, content, true, viewport);
        assert_eq!(mapped.origin.x, 240.0);
        assert_eq!(mapped.origin.y, 152.0);
        assert_eq!(mapped.size.height, 700.0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn fullscreen_dom_rect_mapping_uses_the_full_webview_bounds() {
        let bounds = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1_440.0, 900.0));
        let viewport = ViewportRect {
            x: 240.0,
            y: 120.0,
            width: 1_200.0,
            height: 728.0,
            corner_radius: 0.0,
        };

        let mapped = dom_rect_to_content_rect(bounds, bounds, true, viewport);
        assert_eq!(mapped.origin.y, 120.0);
        assert_eq!(mapped.size.height, 728.0);
    }

    #[test]
    fn rectangle_intersection_clips_overlay_to_viewport() {
        let viewport = ViewportRect {
            x: 100.0,
            y: 50.0,
            width: 300.0,
            height: 200.0,
            corner_radius: 0.0,
        };
        let overlay = ViewportRect {
            x: 80.0,
            y: 40.0,
            width: 80.0,
            height: 50.0,
            corner_radius: 12.0,
        };
        assert_eq!(
            intersect_rect(overlay, viewport)
                .expect("rectangles overlap")
                .width,
            60.0
        );
        assert_eq!(
            intersect_rect(viewport, viewport)
                .expect("identical rectangles overlap")
                .corner_radius,
            0.0
        );
        assert_eq!(
            intersect_rect(
                ViewportRect {
                    x: 120.0,
                    y: 70.0,
                    width: 80.0,
                    height: 60.0,
                    corner_radius: 14.0,
                },
                viewport,
            )
            .expect("rounded overlay is inside viewport")
            .corner_radius,
            14.0
        );
        assert_eq!(
            intersect_rect(overlay, viewport)
                .expect("clipped overlay overlaps")
                .corner_radius,
            0.0
        );
    }

    #[test]
    fn reference_planes_scale_with_camera_depth() {
        let viewport = ViewportSizeResource {
            logical_width: 1_200.0,
            logical_height: 800.0,
        };
        let near = ViewportCamera {
            position: [0.0, 0.0, 100.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            vertical_fov_degrees: 45.0,
        };
        let far = ViewportCamera {
            position: [0.0, 0.0, 200.0],
            ..near
        };
        let near_half = reference_plane_half_size(near, viewport, Vec3::ZERO);
        let far_half = reference_plane_half_size(far, viewport, Vec3::ZERO);
        assert!(near_half > 0.0);
        assert!((far_half / near_half - 2.0).abs() < 1.0e-5);
    }

    #[test]
    fn embedded_resize_updates_pixels_and_notifies_bevy_camera_system() {
        let mut app = App::new();
        app.add_message::<WindowResized>()
            .add_message::<WindowScaleFactorChanged>();
        let window_entity = app
            .world_mut()
            .spawn((PrimaryWindow, Window::default()))
            .id();

        assert!(resize_embedded_window(
            app.world_mut(),
            800.0,
            600.0,
            2.0,
            true,
        ));

        let window = app
            .world()
            .get::<Window>(window_entity)
            .expect("primary window should remain available");
        assert_eq!(window.resolution.physical_width(), 1_600);
        assert_eq!(window.resolution.physical_height(), 1_200);

        let resized = app.world().resource::<Messages<WindowResized>>();
        assert_eq!(
            resized.iter_current_update_messages().next(),
            Some(&WindowResized {
                window: window_entity,
                width: 800.0,
                height: 600.0,
            })
        );
        let scale_changed = app.world().resource::<Messages<WindowScaleFactorChanged>>();
        assert_eq!(
            scale_changed.iter_current_update_messages().next(),
            Some(&WindowScaleFactorChanged {
                window: window_entity,
                scale_factor: 2.0,
            })
        );
    }

    #[test]
    fn ray_triangle_returns_forward_hit() {
        let distance = ray_triangle(
            Vec3::new(0.0, 0.0, 5.0),
            Vec3::NEG_Z,
            Vec3::new(-1.0, -1.0, 0.0),
            Vec3::new(1.0, -1.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        )
        .expect("ray should hit");
        assert!((distance - 5.0).abs() < 1.0e-5);
    }

    #[test]
    fn native_reference_plane_matches_the_react_pick_footprint() {
        let mesh = reference_plane_mesh(&origin_plane_bases()[0].1, REFERENCE_PLANE_HALF_SIZE);
        let positions = mesh
            .attribute(Mesh::ATTRIBUTE_POSITION)
            .and_then(|values| values.as_float3())
            .expect("reference plane should expose float3 positions");
        let min_x = positions
            .iter()
            .map(|position| position[0])
            .fold(f32::INFINITY, f32::min);
        let max_x = positions
            .iter()
            .map(|position| position[0])
            .fold(f32::NEG_INFINITY, f32::max);
        let min_y = positions
            .iter()
            .map(|position| position[1])
            .fold(f32::INFINITY, f32::min);
        let max_y = positions
            .iter()
            .map(|position| position[1])
            .fold(f32::NEG_INFINITY, f32::max);
        assert_eq!(max_x - min_x, 100.0);
        assert_eq!(max_y - min_y, 100.0);
    }

    #[test]
    fn highlighted_face_boundary_omits_shared_tessellation_diagonal() {
        // OCCT intentionally emits separate vertices for every triangle so
        // normals remain face-correct. The two copies of the diagonal still
        // represent the same geometric segment and must cancel each other.
        let positions = vec![
            0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 10.0, 10.0, 0.0, // first triangle
            0.0, 0.0, 0.0, 10.0, 10.0, 0.0, 0.0, 10.0, 0.0, // second triangle
        ];
        let segments = triangle_boundary_segments(&positions, &[0, 1, 2, 3, 4, 5]);
        assert_eq!(segments.len(), 4, "only the quad perimeter should remain");
        let first = Vec3::ZERO;
        let opposite = Vec3::new(10.0, 10.0, 0.0);
        assert!(
            !segments.iter().any(|(start, end)| {
                (*start == first && *end == opposite) || (*start == opposite && *end == first)
            }),
            "the internal triangulation diagonal must not be rendered"
        );
    }

    #[test]
    fn native_highlight_stroke_respects_two_pixel_cap() {
        assert!(HIGHLIGHT_LINE_WIDTH <= 2.0);
    }

    #[test]
    fn native_picker_hits_an_actual_occt_extrusion_snapshot() {
        let state = crate::state::AppState::new();
        state.engine_call("begin_sketch", r#"{"type":"origin_plane","plane":"xy"}"#);
        state.engine_call(
            "add_rectangle",
            r#"{
                "mode":"two_point",
                "p1":{"x":-10.0,"y":-10.0},
                "p2":{"x":10.0,"y":10.0},
                "ctrl_held":false
            }"#,
        );
        state.engine_call("end_sketch", "");
        state.solid_extrude(
            r#"{
                "sketch_name":"Sketch1",
                "profile_indices":[0],
                "operation":"new_body",
                "extent":{"type":"distance","distance":10.0},
                "taper_angle_deg":0.0,
                "flip":false,
                "target_body_ids":[]
            }"#,
        );

        let (_, _, scene, _, _, _, _, _, _, _) = state.viewport_snapshot();
        assert_eq!(scene.bodies.len(), 1);
        assert_eq!(scene.bodies[0].mesh.indices.len(), 36);
        let hit = pick_occt_scene(
            &scene,
            ViewportCamera {
                position: [0.0, 0.0, 100.0],
                target: [0.0, 0.0, 0.0],
                up: [0.0, 1.0, 0.0],
                vertical_fov_degrees: 45.0,
            },
            (800.0, 600.0),
            400.0,
            300.0,
            &[],
            &[],
            &[],
        )
        .expect("center ray should hit the OCCT box");
        assert_eq!(hit.body_id, scene.bodies[0].id.0);
        assert!(hit.point[2] > 9.99);
        assert!(
            pick_occt_scene(
                &scene,
                ViewportCamera {
                    position: [0.0, 0.0, 100.0],
                    target: [0.0, 0.0, 0.0],
                    up: [0.0, 1.0, 0.0],
                    vertical_fov_degrees: 45.0,
                },
                (800.0, 600.0),
                400.0,
                300.0,
                &[scene.bodies[0].id.0],
                &[],
                &[],
            )
            .is_none(),
            "browser-hidden bodies must not remain pickable"
        );
        let translated = BodyPoseDto {
            body_id: scene.bodies[0].id,
            translation: [40.0, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
        };
        let moved_hit = pick_occt_scene(
            &scene,
            ViewportCamera {
                position: [40.0, 0.0, 100.0],
                target: [40.0, 0.0, 0.0],
                up: [0.0, 1.0, 0.0],
                vertical_fov_degrees: 45.0,
            },
            (800.0, 600.0),
            400.0,
            300.0,
            &[],
            &[translated],
            &[],
        )
        .expect("native picking must follow the solved body pose");
        assert!((moved_hit.point[0] - 40.0).abs() < 1.0e-4);
        let mesh = body_mesh(&scene.bodies[0])
            .expect("committed OCCT geometry should become one indexed Bevy mesh per body");
        assert_eq!(
            mesh.count_vertices(),
            scene.bodies[0].mesh.positions.len() / 3
        );
        assert_eq!(
            mesh.indices().expect("body mesh should stay indexed").len(),
            scene.bodies[0].mesh.indices.len(),
            "body batching must preserve the complete OCCT tessellation"
        );
        let overlay = face_mesh(&scene.bodies[0], &scene.bodies[0].faces[0])
            .expect("a hovered or selected face can still create a transient overlay");
        assert_eq!(
            overlay.count_vertices(),
            scene.bodies[0].faces[0].index_count as usize
        );

        let expected_face_count = scene.bodies[0].faces.len();
        let mut render_app = App::new();
        render_app
            .init_resource::<ModelResource>()
            .init_resource::<ModelGeometryCache>()
            .init_resource::<RenderedRevisions>()
            .init_resource::<PaletteResource>()
            .init_resource::<Assets<Mesh>>()
            .init_resource::<Assets<StandardMaterial>>()
            .add_systems(Update, rebuild_occt_meshes);
        {
            let mut model = render_app.world_mut().resource_mut::<ModelResource>();
            model.session_id = "batched-body-test".to_string();
            model.geometry_revision = 1;
            model.scene = scene.clone();
            model.revision = 1;
        }
        render_app.update();
        let body_draws = {
            let world = render_app.world_mut();
            let mut query = world.query::<(&NativeCadBody, &Mesh3d)>();
            query.iter(world).count()
        };
        let face_metadata = {
            let world = render_app.world_mut();
            let mut query = world.query::<(&NativeCadFace, Option<&Mesh3d>)>();
            query
                .iter(world)
                .inspect(|(_, mesh)| assert!(mesh.is_none()))
                .count()
        };
        assert_eq!(
            body_draws, 1,
            "one solid body should use one committed draw mesh"
        );
        assert_eq!(face_metadata, expected_face_count);

        let started = Instant::now();
        for _ in 0..10_000 {
            std::hint::black_box(pick_occt_scene(
                &scene,
                ViewportCamera {
                    position: [0.0, 0.0, 100.0],
                    target: [0.0, 0.0, 0.0],
                    up: [0.0, 1.0, 0.0],
                    vertical_fov_degrees: 45.0,
                },
                (800.0, 600.0),
                400.0,
                300.0,
                &[],
                &[],
                &[],
            ));
        }
        let average_micros = started.elapsed().as_secs_f64() * 100.0;
        eprintln!("actual OCCT box pick average: {average_micros:.3} µs");
        assert!(
            average_micros < 5_000.0,
            "native picking exceeded the demo's 5 ms CPU budget"
        );
    }

    #[test]
    fn native_occurrences_share_meshes_and_pick_the_exact_instance() {
        let state = crate::state::AppState::new();
        state.engine_call("begin_sketch", r#"{"type":"origin_plane","plane":"xy"}"#);
        state.engine_call(
            "add_rectangle",
            r#"{
                "mode":"two_point",
                "p1":{"x":-10.0,"y":-10.0},
                "p2":{"x":10.0,"y":10.0},
                "ctrl_held":false
            }"#,
        );
        state.engine_call("end_sketch", "");
        state.solid_extrude(
            r#"{
                "sketch_name":"Sketch1",
                "profile_indices":[0],
                "operation":"new_body",
                "extent":{"type":"distance","distance":10.0},
                "taper_angle_deg":0.0,
                "flip":false,
                "target_body_ids":[]
            }"#,
        );
        let (_, _, scene, _, _, _, _, _, _, _) = state.viewport_snapshot();
        let body_id = scene.bodies[0].id;
        let instances = vec![
            InstanceBodyPoseDto {
                occurrence_id: nbcad_sketch::OccurrenceId(41),
                component_id: nbcad_sketch::ComponentId(7),
                body_id,
                translation: [-30.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
                visible: true,
            },
            InstanceBodyPoseDto {
                occurrence_id: nbcad_sketch::OccurrenceId(42),
                component_id: nbcad_sketch::ComponentId(7),
                body_id,
                translation: [30.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
                visible: true,
            },
        ];
        for (x, occurrence_id) in [(-30.0, 41), (30.0, 42)] {
            let hit = pick_occt_scene(
                &scene,
                ViewportCamera {
                    position: [x, 0.0, 100.0],
                    target: [x, 0.0, 0.0],
                    up: [0.0, 1.0, 0.0],
                    vertical_fov_degrees: 45.0,
                },
                (800.0, 600.0),
                400.0,
                300.0,
                &[],
                &[],
                &instances,
            )
            .expect("each visible occurrence should be independently pickable");
            assert_eq!(hit.body_id, body_id.0);
            assert_eq!(hit.occurrence_id, Some(occurrence_id));
        }

        let mut render_app = App::new();
        render_app
            .init_resource::<ModelResource>()
            .init_resource::<ModelGeometryCache>()
            .init_resource::<RenderedRevisions>()
            .init_resource::<PaletteResource>()
            .init_resource::<Assets<Mesh>>()
            .init_resource::<Assets<StandardMaterial>>()
            .add_systems(Update, rebuild_occt_meshes);
        {
            let mut model = render_app.world_mut().resource_mut::<ModelResource>();
            model.session_id = "instance-mesh-test".to_string();
            model.geometry_revision = 1;
            model.instance_revision = 1;
            model.scene = scene;
            model.instance_body_poses = instances;
            model.revision = 1;
        }
        render_app.update();
        let mesh_ids = {
            let world = render_app.world_mut();
            let mut query = world.query::<(&NativeCadBody, &Mesh3d)>();
            query
                .iter(world)
                .map(|(body, mesh)| (body.occurrence_id, mesh.0.id()))
                .collect::<Vec<_>>()
        };
        assert_eq!(mesh_ids.len(), 2);
        assert_ne!(mesh_ids[0].0, mesh_ids[1].0);
        assert_eq!(
            mesh_ids[0].1, mesh_ids[1].1,
            "reusable occurrences must retain one shared GPU mesh asset",
        );
    }

    #[test]
    fn native_picker_exposes_a_virtual_circular_connector_at_a_cylinder_opening() {
        let body = nbcad_solid::BodyDto {
            id: nbcad_core::BodyId(7),
            name: "Holed component".to_string(),
            feature_id: nbcad_core::FeatureId(3),
            mesh: nbcad_solid::MeshDto {
                positions: vec![5.0, 0.0, 0.0, 5.0, 0.0, 10.0, 0.0, 5.0, 0.0, 0.0, 5.0, 10.0],
                normals: vec![0.0; 12],
                indices: vec![0, 1, 2, 2, 1, 3],
            },
            faces: vec![nbcad_solid::FaceDto {
                id: nbcad_core::FaceId(70),
                key: "cylindrical-wall".to_string(),
                first_index: 0,
                index_count: 6,
                plane: None,
                signature: None,
                cylinder: Some(nbcad_solid::CylindricalSurfaceDto {
                    origin: nbcad_solid::Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    axis: nbcad_solid::Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 1.0,
                    },
                    reference: nbcad_solid::Point3Dto {
                        x: 1.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    radius: 5.0,
                }),
            }],
            edges: vec![nbcad_solid::EdgeDto {
                id: nbcad_core::EdgeId(71),
                key: "outer-chamfer-rim".to_string(),
                points: vec![],
                circle: Some(nbcad_solid::CircularCurveDto {
                    center: nbcad_solid::Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 10.0,
                    },
                    normal: nbcad_solid::Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 1.0,
                    },
                    reference: nbcad_solid::Point3Dto {
                        x: 1.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    radius: 8.0,
                    closed: true,
                }),
                refinable: true,
            }],
        };
        let scene = SolidSceneDto {
            bodies: vec![body],
            errors: vec![],
        };
        let hit = pick_occt_scene(
            &scene,
            ViewportCamera {
                position: [0.0, 0.0, 50.0],
                target: [0.0, 0.0, 0.0],
                up: [0.0, 1.0, 0.0],
                vertical_fov_degrees: 45.0,
            },
            (800.0, 600.0),
            400.0,
            300.0,
            &[],
            &[],
            &[],
        )
        .expect("the otherwise empty cylinder opening should be pickable");
        assert_eq!(hit.connector_kind.as_deref(), Some("virtual_circular_face"));
        assert_eq!(hit.connector_origin, Some([0.0, 0.0, 10.0]));
        assert_eq!(hit.connector_primary_axis, Some([0.0, 0.0, 1.0]));

        let rim_hit = pick_occt_scene(
            &scene,
            ViewportCamera {
                position: [8.0, 0.0, 50.0],
                target: [8.0, 0.0, 0.0],
                up: [0.0, 1.0, 0.0],
                vertical_fov_degrees: 45.0,
            },
            (800.0, 600.0),
            400.0,
            300.0,
            &[],
            &[],
            &[],
        )
        .expect("the exact outer chamfer rim should be pickable");
        assert_eq!(rim_hit.connector_kind.as_deref(), Some("circular_edge"));
        assert_eq!(rim_hit.edge_id, Some(71));
        assert_eq!(rim_hit.connector_origin, Some([0.0, 0.0, 10.0]));
        assert_eq!(rim_hit.connector_primary_axis, Some([0.0, 0.0, 1.0]));
        assert_eq!(rim_hit.connector_radius, Some(8.0));

        let wall_hit = pick_occt_scene(
            &scene,
            ViewportCamera {
                position: [50.0, 0.0, 5.0],
                target: [0.0, 0.0, 5.0],
                up: [0.0, 0.0, 1.0],
                vertical_fov_degrees: 45.0,
            },
            (800.0, 600.0),
            400.0,
            300.0,
            &[],
            &[],
            &[],
        )
        .expect("the physical internal cylinder wall should remain pickable");
        assert_eq!(wall_hit.connector_kind.as_deref(), Some("cylindrical_face"));
        assert_eq!(wall_hit.connector_origin, Some([0.0, 0.0, 5.0]));
        assert_eq!(wall_hit.connector_primary_axis, Some([0.0, 0.0, 1.0]));
        assert_eq!(wall_hit.connector_secondary_axis, Some([1.0, 0.0, 0.0]));
    }

    #[test]
    fn native_body_material_uses_the_document_appearance() {
        let body_id = 73;
        let mut appearance = BodyAppearance::default_for(nbcad_core::BodyId(body_id));
        appearance.color = nbcad_core::Rgba8::opaque(12, 123, 240);
        let model = ModelResource {
            body_appearances: vec![appearance],
            ..default()
        };

        let color = body_appearance_color(&model, body_id, [0.1, 0.2, 0.3]).to_srgba();
        assert!((color.red - 12.0 / 255.0).abs() < 1.0e-6);
        assert!((color.green - 123.0 / 255.0).abs() < 1.0e-6);
        assert!((color.blue - 240.0 / 255.0).abs() < 1.0e-6);
    }

    #[test]
    fn recovery_session_rebind_preserves_solid_faces_and_absorbs_late_bootstrap_sync() {
        let state = crate::state::AppState::new();
        state.engine_call("begin_sketch", r#"{"type":"origin_plane","plane":"xy"}"#);
        state.engine_call(
            "add_rectangle",
            r#"{
                "mode":"two_point",
                "p1":{"x":-10.0,"y":-10.0},
                "p2":{"x":10.0,"y":10.0},
                "ctrl_held":false
            }"#,
        );
        state.engine_call("end_sketch", "");
        state.solid_extrude(
            r#"{
                "sketch_name":"Sketch1",
                "profile_indices":[0],
                "operation":"new_body",
                "extent":{"type":"distance","distance":10.0},
                "taper_angle_deg":0.0,
                "flip":false,
                "target_body_ids":[]
            }"#,
        );

        let (
            session_id,
            geometry_revision,
            scene,
            active_sketch,
            finished_sketches,
            datum_planes,
            profile_catalog,
            body_appearances,
            body_poses,
            instance_body_poses,
        ) = state.viewport_snapshot();
        assert_eq!(session_id, BOOTSTRAP_SESSION_ID);
        let face_count = scene
            .bodies
            .iter()
            .map(|body| body.faces.len())
            .sum::<usize>();
        assert!(
            face_count > 0,
            "the recovery fixture must contain solid faces"
        );

        let bootstrap_model = ViewportModel {
            session_id: session_id.clone(),
            geometry_revision,
            scene,
            active_sketch,
            finished_sketches,
            datum_planes,
            profile_catalog,
            body_appearances,
            body_poses,
            instance_body_poses,
        };
        let mut app = App::new();
        app.init_resource::<ModelResource>()
            .init_resource::<ModelGeometryCache>();
        {
            let mut model = app.world_mut().resource_mut::<ModelResource>();
            model.session_id = session_id.clone();
            model.geometry_revision = geometry_revision;
            model.scene = bootstrap_model.scene.clone();
            model.instance_body_poses = bootstrap_model.instance_body_poses.clone();
        }
        app.world_mut()
            .resource_mut::<ModelGeometryCache>()
            .0
            .insert(session_id.clone(), (geometry_revision, 0));
        for body in &bootstrap_model.scene.bodies {
            for face in &body.faces {
                app.world_mut().spawn((
                    NativeCadFace {
                        body_id: body.id.0,
                        occurrence_id: None,
                        face_id: face.id.0,
                        boundary: face_boundary_segments(body, face),
                    },
                    NativeModelGeometry {
                        session_id: session_id.clone(),
                        geometry_revision,
                        instance_revision: 0,
                    },
                    Visibility::Inherited,
                ));
            }
        }

        let mut runtime = MainThreadRenderRuntime {
            app,
            model: bootstrap_model.clone(),
            camera: ViewportCamera::default(),
            logical_size: (800.0, 600.0),
            scale_factor: 2.0,
            session_aliases: HashMap::new(),
        };
        let metrics = Arc::new(Mutex::new(MetricsState::default()));
        let mut dirty = false;
        apply_render_command(
            RenderCommand::RebindModelSession {
                from: session_id.clone(),
                to: "recovered-tab".to_string(),
            },
            &mut runtime,
            &metrics,
            &mut dirty,
        );

        assert!(dirty, "renaming resident GPU geometry must redraw once");
        assert_eq!(runtime.model.session_id, "recovered-tab");
        assert_eq!(
            runtime.app.world().resource::<ModelResource>().session_id,
            "recovered-tab"
        );
        let cache = &runtime.app.world().resource::<ModelGeometryCache>().0;
        assert_eq!(cache.get("recovered-tab"), Some(&(geometry_revision, 0)));
        assert!(!cache.contains_key(&session_id));
        let retained_faces = {
            let world = runtime.app.world_mut();
            let mut query = world.query::<(&NativeCadFace, &NativeModelGeometry)>();
            query
                .iter(world)
                .filter(|(_, geometry)| geometry.session_id == "recovered-tab")
                .count()
        };
        assert_eq!(retained_faces, face_count);

        // A native model snapshot can race with the bind command. Once the
        // bootstrap id has been rebound, a late snapshot must resolve to the
        // permanent tab instead of recreating the temporary session.
        dirty = false;
        apply_render_command(
            RenderCommand::Model(bootstrap_model),
            &mut runtime,
            &metrics,
            &mut dirty,
        );
        assert!(dirty);
        assert_eq!(runtime.model.session_id, "recovered-tab");
        assert_eq!(
            runtime.app.world().resource::<ModelResource>().session_id,
            "recovered-tab"
        );
        let faces_after_late_sync = {
            let world = runtime.app.world_mut();
            let mut query = world.query::<&NativeModelGeometry>();
            query
                .iter(world)
                .filter(|geometry| geometry.session_id == "recovered-tab")
                .count()
        };
        assert_eq!(faces_after_late_sync, face_count);
    }
}
