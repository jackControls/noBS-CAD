#[cfg(target_os = "macos")]
use std::ptr::NonNull;
use std::{
    collections::HashMap,
    ffi::c_void,
    num::NonZeroU32,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
#[cfg(target_os = "windows")]
use std::{num::NonZeroIsize, sync::OnceLock};

use bevy::{
    asset::RenderAssetUsages,
    mesh::Indices,
    prelude::*,
    render::render_resource::PrimitiveTopology,
    window::{
        ExitCondition, PresentMode, PrimaryWindow, RawHandleWrapper, RawHandleWrapperHolder,
        WindowPlugin, WindowResolution, WindowWrapper,
    },
};
use nbcad_core::PlaneBasis;
use nbcad_sketch::{EntityDto, SketchDto};
use nbcad_solid::{BodyDto, DatumPlaneDefinitionDto, FaceDto, SolidSceneDto};
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
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
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM, LRESULT, WPARAM},
    Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_DIFF},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::GetDpiForWindow,
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, GetParent, RegisterClassW, SetWindowPos, ShowWindow,
            CS_OWNDC, HTTRANSPARENT, HWND_TOP, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW,
            SW_HIDE, SW_SHOWNA, WM_ERASEBKGND, WM_NCHITTEST, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN,
            WS_CLIPSIBLINGS, WS_EX_NOACTIVATE, WS_EX_NOPARENTNOTIFY,
        },
    },
};

use super::{
    NativePick, NativeViewportMetrics, ViewportAnnotationKind, ViewportCamera, ViewportHud,
    ViewportHudSelection, ViewportLayout, ViewportMode, ViewportModel, ViewportOriginPlane,
    ViewportPalette, ViewportPresentation, ViewportPreview, ViewportRect,
};

const INITIAL_PHYSICAL_SIZE: u32 = 32;
/// Matches the React interaction plane's 100 mm edge length.
const REFERENCE_PLANE_HALF_SIZE: f32 = 50.0;

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
    Camera(ViewportCamera),
    Preview(ViewportPreview),
    Presentation(ViewportPresentation),
}

#[derive(Default)]
struct PendingRenderCommands {
    resize: Option<(f64, f64, f64, ViewportPalette, ViewportHud)>,
    model: Option<ViewportModel>,
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
}

struct PickState {
    scene: SolidSceneDto,
    camera: ViewportCamera,
    logical_size: (f32, f32),
    hidden_body_ids: Vec<u64>,
}

impl Default for PickState {
    fn default() -> Self {
        Self {
            scene: SolidSceneDto::default(),
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
                    let mut webview_hwnd = Default::default();
                    controller
                        .ParentWindow(&mut webview_hwnd)
                        .map_err(|error| {
                            format!("WebView2 did not expose its container HWND: {error}")
                        })
                        .and_then(|_| {
                            install_native_views(webview_hwnd.0, install_pointers.clone())
                        })
                };

                let (view_pointer, scale_factor) = match result {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("native viewport installation failed: {error}");
                        return;
                    }
                };

                let bevy_app = match build_bevy_app(view_pointer, scale_factor as f32) {
                    Ok(app) => app,
                    Err(error) => {
                        eprintln!("native Bevy viewport failed to initialize: {error}");
                        return;
                    }
                };
                let mut render_runtime = Box::new(MainThreadRenderRuntime {
                    app: bevy_app,
                    model: ViewportModel {
                        scene: SolidSceneDto::default(),
                        active_sketch: None,
                        finished_sketches: Vec::new(),
                        datum_planes: Vec::new(),
                    },
                    camera: ViewportCamera::default(),
                    logical_size: (1.0, 1.0),
                    scale_factor: scale_factor as f32,
                });
                render_frames(&mut render_runtime.app, 2, &install_metrics);

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

    pub fn sync_model(&self, model: ViewportModel) -> Result<(), String> {
        if let Ok(mut state) = self.pick_state.lock() {
            state.scene = model.scene.clone();
        }
        self.enqueue(RenderCommand::Model(model))
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
        if preview.lines.len() > 128
            || preview.points.len() > 128
            || line_floats > MAX_LINE_FLOATS
            || point_floats > MAX_POINT_FLOATS
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
        }
        self.enqueue(RenderCommand::Presentation(presentation))
    }

    pub fn pick(&self, x: f32, y: f32) -> Result<Option<NativePick>, String> {
        let started = Instant::now();
        let result = {
            let state = self
                .pick_state
                .lock()
                .map_err(|_| "native viewport pick state lock poisoned".to_string())?;
            pick_occt_scene(
                &state.scene,
                state.camera,
                state.logical_size,
                x,
                y,
                &state.hidden_body_ids,
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
    viewport.setHidden(layout.viewport.width < 2.0 || layout.viewport.height < 2.0);
    if std::env::var_os("NBCAD_NATIVE_LAYOUT_DEBUG").is_some() {
        eprintln!(
            "native viewport layout: bounds={webview_bounds:?} safe={:?} dom={:?} appkit={viewport_in_webview:?}",
            webview.safeAreaRect(),
            layout.viewport,
        );
    }

    if let Some(webview_layer) = webview.layer() {
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
                    CGMutablePath::add_rect(Some(&path), std::ptr::null(), overlay_rect);
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
unsafe extern "system" fn windows_viewport_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        // Pointer input remains owned by the real DOM viewport behind this
        // opaque render sibling. That preserves the React interaction kernel
        // and accessibility tree without a transparent WebView2 surface.
        WM_NCHITTEST => HTTRANSPARENT as LRESULT,
        // The swapchain owns every visible pixel; suppress background erases
        // that would otherwise flash while resizing.
        WM_ERASEBKGND => 1,
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
            style: CS_OWNDC,
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
/// region is cut around DOM overlay islands, and `WM_NCHITTEST` passes pointer
/// input through to WebView2. This avoids both transparent top-level windows
/// and a transparent WebView2 compositor.
#[cfg(target_os = "windows")]
unsafe fn install_native_views(
    webview_pointer: *mut c_void,
    pointers: Arc<NativePointers>,
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
        let overlay_region = unsafe { CreateRectRgn(left, top, right, bottom) };
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
            let raw = RawWindowHandle::Win32(Win32WindowHandle::new(pointer));
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
    scene: SolidSceneDto,
    active_sketch: Option<SketchDto>,
    finished_sketches: Vec<SketchDto>,
    datum_planes: Vec<DatumPlaneDefinitionDto>,
    revision: u64,
}

#[derive(Resource)]
struct CameraResource {
    camera: ViewportCamera,
    revision: u64,
}

#[derive(Resource, Default)]
struct PreviewResource {
    value: ViewportPreview,
    revision: u64,
}

#[derive(Resource, Clone, Copy, Default)]
struct PaletteResource(ViewportPalette);

#[derive(Resource)]
struct HudResource {
    hud: ViewportHud,
    revision: u64,
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
}

#[derive(Component)]
struct NativeCadBody;

#[derive(Component, Clone, Copy)]
struct NativeCadFace {
    body_id: u64,
    face_id: u64,
}

#[derive(Component)]
struct NativeModelGeometry;

#[derive(Component)]
struct NativeCadCamera;

#[derive(Component)]
struct NativeDatumPlane {
    datum_id: u64,
}

#[derive(Component, Clone, Copy)]
struct NativeOriginPlane {
    plane: ViewportOriginPlane,
}

#[derive(Component)]
struct NativeHudRoot;

#[derive(Component)]
struct NativeAnnotationRoot;

#[derive(Component, Clone, Copy)]
struct HudAxisMark {
    axis: Vec3,
    fraction: f32,
    radius: f32,
}

#[derive(Component, Clone, Copy)]
struct HudAxisLabel {
    axis: Vec3,
}

#[derive(Default, Reflect, GizmoConfigGroup)]
struct CadHighlightGizmos;

fn build_bevy_app(view_pointer: usize, scale_factor: f32) -> Result<bevy::app::App, String> {
    let mut app = bevy::app::App::new();
    let plugins = DefaultPlugins.build().set(WindowPlugin {
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
    });
    app.add_plugins(plugins)
        .init_gizmo_group::<CadHighlightGizmos>();

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
            color: Color::srgb(0.92, 0.95, 1.0),
            brightness: 450.0,
            ..default()
        })
        .init_resource::<ModelResource>()
        .init_resource::<CameraResource>()
        .init_resource::<PreviewResource>()
        .init_resource::<PaletteResource>()
        .init_resource::<HudResource>()
        .init_resource::<PresentationResource>()
        .init_resource::<RenderedRevisions>()
        .add_systems(Startup, setup_scene)
        .add_systems(
            Update,
            (
                rebuild_occt_meshes,
                apply_camera,
                apply_native_presentation_styles,
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
    highlight_config.line.width = 2.6;
    highlight_config.depth_bias = -1.0;

    let camera = ViewportCamera::default();
    commands.spawn((
        Name::new("React-synchronized CAD camera"),
        NativeCadCamera,
        Camera3d::default(),
        Projection::Perspective(PerspectiveProjection {
            fov: camera.vertical_fov_degrees.to_radians(),
            near: 0.1,
            far: 20_000.0,
            ..default()
        }),
        camera_transform(camera),
    ));

    commands.spawn((
        Name::new("CAD key light"),
        DirectionalLight {
            color: Color::srgb(1.0, 0.97, 0.92),
            illuminance: 9_000.0,
            shadow_maps_enabled: true,
            ..default()
        },
        Transform::from_xyz(130.0, -110.0, 180.0).looking_at(Vec3::ZERO, Vec3::Z),
    ));
    commands.spawn((
        Name::new("CAD fill light"),
        DirectionalLight {
            color: Color::srgb(0.72, 0.82, 1.0),
            illuminance: 2_400.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(-120.0, 80.0, 70.0).looking_at(Vec3::ZERO, Vec3::Z),
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
    existing: Query<Entity, With<NativeModelGeometry>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    palette: Res<PaletteResource>,
) {
    if revisions.model == model.revision {
        return;
    }
    revisions.model = model.revision;

    for entity in &existing {
        commands.entity(entity).despawn();
    }

    for body in &model.scene.bodies {
        for face in &body.faces {
            let Some(mesh) = face_mesh(body, face) else {
                continue;
            };
            commands.spawn((
                Name::new(format!(
                    "OCCT face {} on {} ({})",
                    face.id.0, body.id.0, body.name
                )),
                NativeCadBody,
                NativeCadFace {
                    body_id: body.id.0,
                    face_id: face.id.0,
                },
                NativeModelGeometry,
                Mesh3d(meshes.add(mesh)),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: rgb(palette.0.body),
                    metallic: 0.03,
                    perceptual_roughness: 0.72,
                    cull_mode: None,
                    ..default()
                })),
            ));
        }
    }

    for plane in &model.datum_planes {
        commands.spawn((
            Name::new(format!("Construction plane {}", plane.name)),
            NativeDatumPlane {
                datum_id: plane.datum_id.0,
            },
            NativeModelGeometry,
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
    mut query: Query<(&mut Transform, &mut Projection), With<NativeCadCamera>>,
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
}

#[allow(clippy::type_complexity)]
fn apply_native_presentation_styles(
    presentation: Res<PresentationResource>,
    palette: Res<PaletteResource>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut faces: Query<
        (
            &NativeCadFace,
            &MeshMaterial3d<StandardMaterial>,
            &mut Visibility,
        ),
        (Without<NativeDatumPlane>, Without<NativeOriginPlane>),
    >,
    mut datum_planes: Query<
        (
            &NativeDatumPlane,
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
    for (face, handle, mut visibility) in &mut faces {
        *visibility = if state.hidden_body_ids.contains(&face.body_id) {
            Visibility::Hidden
        } else {
            Visibility::Inherited
        };
        let Some(mut material) = materials.get_mut(&handle.0) else {
            continue;
        };
        let selected_face = state.selected_face_ids.contains(&face.face_id);
        let hovered_face = state.hovered_face_id == Some(face.face_id);
        let selected_body_index = state
            .selected_body_ids
            .iter()
            .position(|body_id| *body_id == face.body_id);
        let color = if selected_face {
            palette.0.face_selected
        } else if hovered_face {
            palette.0.face_hover
        } else if selected_body_index == Some(0) {
            palette.0.body_selected
        } else if selected_body_index.is_some() {
            palette.0.body_tool
        } else {
            palette.0.body
        };
        material.base_color = rgb(color);
        material.emissive = if selected_face || hovered_face {
            rgb(color).to_linear() * 0.32
        } else {
            LinearRgba::BLACK
        };
    }

    for (plane, handle, mut visibility) in &mut datum_planes {
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

fn rebuild_native_annotations(
    mut commands: Commands,
    preview: Res<PreviewResource>,
    palette: Res<PaletteResource>,
    mut revisions: ResMut<RenderedRevisions>,
    existing: Query<Entity, With<NativeAnnotationRoot>>,
    cameras: Query<Entity, With<NativeCadCamera>>,
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
                    left: px(annotation.screen[0] + 4.0),
                    top: px(annotation.screen[1] - if constraint { 9.0 } else { 11.0 }),
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
    mut revisions: ResMut<RenderedRevisions>,
    existing: Query<Entity, With<NativeHudRoot>>,
    cameras: Query<Entity, With<NativeCadCamera>>,
) {
    if revisions.hud == hud.revision {
        return;
    }
    revisions.hud = hud.revision;

    for entity in &existing {
        commands.entity(entity).despawn();
    }
    if !hud.hud.render_native_chrome {
        return;
    }
    let Ok(camera) = cameras.single() else {
        return;
    };

    let panel = rgba(palette.0.panel, 0.94);
    let header = rgba(palette.0.header, 0.96);
    let ink = rgb(palette.0.ink);
    let mute = rgb(palette.0.mute);
    let edge = rgba(palette.0.ui_edge, 0.92);
    let accent = rgb(palette.0.accent);

    commands
        .spawn((
            Name::new("Native orientation dial"),
            NativeHudRoot,
            UiTargetCamera(camera),
            Node {
                position_type: PositionType::Absolute,
                right: px(12.0),
                top: px(12.0),
                width: px(132.0),
                padding: UiRect::axes(px(8.0), px(6.0)),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                border: UiRect::all(px(1.0)),
                border_radius: BorderRadius::all(px(12.0)),
                ..default()
            },
            BackgroundColor(panel),
            BorderColor::all(edge),
            ZIndex(20),
        ))
        .with_children(|card| {
            card.spawn((
                Text::new("ORIENTATION DIAL"),
                TextFont::from_font_size(8.0),
                TextColor(mute),
                Node {
                    height: px(12.0),
                    ..default()
                },
            ));

            card.spawn(Node {
                position_type: PositionType::Relative,
                width: px(104.0),
                height: px(104.0),
                flex_shrink: 0.0,
                ..default()
            })
            .with_children(|dial| {
                for (label, left, top) in [
                    ("F", 38.0, 0.0),
                    ("R", 76.0, 42.0),
                    ("B", 38.0, 84.0),
                    ("L", 0.0, 42.0),
                ] {
                    dial.spawn((
                        Node {
                            position_type: PositionType::Absolute,
                            left: px(left),
                            top: px(top),
                            width: px(28.0),
                            height: px(20.0),
                            justify_content: JustifyContent::Center,
                            align_items: AlignItems::Center,
                            border: UiRect::all(px(1.0)),
                            border_radius: BorderRadius::all(px(10.0)),
                            ..default()
                        },
                        BackgroundColor(header),
                        BorderColor::all(edge),
                    ))
                    .with_child((
                        Text::new(label),
                        TextFont::from_font_size(9.0),
                        TextColor(mute),
                    ));
                }

                dial.spawn((
                    Node {
                        position_type: PositionType::Absolute,
                        left: px(14.0),
                        top: px(14.0),
                        width: px(76.0),
                        height: px(76.0),
                        border: UiRect::all(px(1.0)),
                        border_radius: BorderRadius::MAX,
                        overflow: Overflow::clip(),
                        ..default()
                    },
                    BackgroundColor(rgba(palette.0.background, 0.82)),
                    BorderColor::all(edge),
                ))
                .with_children(|indicator| {
                    for angle_index in 0..20 {
                        let angle = angle_index as f32 * std::f32::consts::TAU / 20.0;
                        indicator.spawn((
                            Node {
                                position_type: PositionType::Absolute,
                                left: px(37.0 + angle.cos() * 31.0),
                                top: px(37.0 + angle.sin() * 31.0),
                                width: px(2.0),
                                height: px(2.0),
                                border_radius: BorderRadius::MAX,
                                ..default()
                            },
                            BackgroundColor(rgba(palette.0.grid_major, 0.65)),
                        ));
                    }

                    for (axis, label, color) in [
                        (Vec3::X, "X", Color::srgb(0.88, 0.36, 0.39)),
                        (Vec3::Y, "Y", Color::srgb(0.35, 0.68, 0.45)),
                        (Vec3::Z, "Z", Color::srgb(0.26, 0.65, 0.91)),
                    ] {
                        for index in 1..=9 {
                            let fraction = index as f32 / 9.0;
                            let radius = if index == 9 { 2.5 } else { 1.15 };
                            indicator.spawn((
                                HudAxisMark {
                                    axis,
                                    fraction,
                                    radius,
                                },
                                Node {
                                    position_type: PositionType::Absolute,
                                    width: px(radius * 2.0),
                                    height: px(radius * 2.0),
                                    border_radius: BorderRadius::MAX,
                                    ..default()
                                },
                                BackgroundColor(color),
                            ));
                        }
                        indicator.spawn((
                            HudAxisLabel { axis },
                            Text::new(label),
                            TextFont::from_font_size(8.0),
                            TextColor(color),
                            Node {
                                position_type: PositionType::Absolute,
                                ..default()
                            },
                        ));
                    }

                    indicator.spawn((
                        Node {
                            position_type: PositionType::Absolute,
                            left: px(35.5),
                            top: px(35.5),
                            width: px(5.0),
                            height: px(5.0),
                            border_radius: BorderRadius::MAX,
                            ..default()
                        },
                        BackgroundColor(ink),
                    ));
                });
            });

            card.spawn(Node {
                width: percent(100.0),
                height: px(20.0),
                margin: UiRect::top(px(4.0)),
                column_gap: px(4.0),
                ..default()
            })
            .with_children(|row| {
                for (label, emphasized) in [("+Z", false), ("ISO", true), ("-Z", false)] {
                    row.spawn((
                        Node {
                            height: px(20.0),
                            flex_grow: 1.0,
                            justify_content: JustifyContent::Center,
                            align_items: AlignItems::Center,
                            border: UiRect::all(px(1.0)),
                            border_radius: BorderRadius::all(px(4.0)),
                            ..default()
                        },
                        BackgroundColor(header),
                        BorderColor::all(edge),
                    ))
                    .with_child((
                        Text::new(label),
                        TextFont::from_font_size(9.0),
                        TextColor(if emphasized { ink } else { mute }),
                    ));
                }
            });
            card.spawn((
                Text::new("Drag the dial to orbit"),
                TextFont::from_font_size(8.0),
                TextColor(rgba(palette.0.mute, 0.72)),
                Node {
                    margin: UiRect::top(px(3.0)),
                    ..default()
                },
            ));
        });

    commands
        .spawn((
            Name::new("Native viewport navigation"),
            NativeHudRoot,
            UiTargetCamera(camera),
            Node {
                position_type: PositionType::Absolute,
                left: px(0.0),
                bottom: px(12.0),
                width: percent(100.0),
                justify_content: JustifyContent::Center,
                ..default()
            },
            ZIndex(20),
        ))
        .with_children(|center| {
            center
                .spawn((
                    Node {
                        height: px(34.0),
                        padding: UiRect::axes(px(6.0), px(4.0)),
                        align_items: AlignItems::Center,
                        column_gap: px(2.0),
                        border: UiRect::all(px(1.0)),
                        border_radius: BorderRadius::all(px(5.0)),
                        ..default()
                    },
                    BackgroundColor(header),
                    BorderColor::all(edge),
                ))
                .with_children(|bar| {
                    let mut buttons = Vec::new();
                    if hud.hud.sketch_mode {
                        buttons.extend([
                            ("U", false, !hud.hud.can_undo),
                            ("R", false, !hud.hud.can_redo),
                            ("N", false, false),
                        ]);
                    }
                    buttons.extend([
                        ("O", hud.hud.nav_tool == "orbit", false),
                        ("P", hud.hud.nav_tool == "pan", false),
                        ("+", hud.hud.nav_tool == "zoom", false),
                        ("[]", hud.hud.nav_tool == "zoomWindow", false),
                        ("F", false, false),
                        ("D", false, true),
                        ("G", false, true),
                        (
                            "3D",
                            hud.hud.six_dof_state == "connected",
                            hud.hud.six_dof_state == "unsupported",
                        ),
                    ]);

                    for (index, (label, active, disabled)) in buttons.into_iter().enumerate() {
                        if hud.hud.sketch_mode && index == 3 {
                            spawn_hud_separator(bar, edge);
                        }
                        if label == "3D" {
                            spawn_hud_separator(bar, edge);
                        }
                        bar.spawn((
                            Node {
                                width: px(24.0),
                                height: px(24.0),
                                justify_content: JustifyContent::Center,
                                align_items: AlignItems::Center,
                                border_radius: BorderRadius::all(px(4.0)),
                                ..default()
                            },
                            BackgroundColor(if active {
                                rgba(palette.0.accent, 0.30)
                            } else {
                                Color::NONE
                            }),
                        ))
                        .with_child((
                            Text::new(label),
                            TextFont::from_font_size(if label.len() > 1 { 7.5 } else { 10.0 }),
                            TextColor(if disabled {
                                rgba(palette.0.mute, 0.35)
                            } else if active {
                                accent
                            } else {
                                mute
                            }),
                        ));
                    }
                });
        });

    if let Some(selection) = &hud.hud.selection {
        spawn_selection_hud(&mut commands, camera, selection, header, edge, ink, mute);
    }
}

fn spawn_hud_separator(parent: &mut bevy::ecs::hierarchy::ChildSpawnerCommands, color: Color) {
    parent.spawn((
        Node {
            width: px(1.0),
            height: px(16.0),
            margin: UiRect::horizontal(px(4.0)),
            ..default()
        },
        BackgroundColor(color),
    ));
}

#[allow(clippy::too_many_arguments)]
fn spawn_selection_hud(
    commands: &mut Commands,
    camera: Entity,
    selection: &ViewportHudSelection,
    header: Color,
    edge: Color,
    ink: Color,
    mute: Color,
) {
    commands
        .spawn((
            Name::new("Native selection readout"),
            NativeHudRoot,
            UiTargetCamera(camera),
            Node {
                position_type: PositionType::Absolute,
                right: px(12.0),
                bottom: px(48.0),
                min_width: px(208.0),
                max_width: px(280.0),
                padding: UiRect::all(px(10.0)),
                flex_direction: FlexDirection::Column,
                row_gap: px(4.0),
                border: UiRect::all(px(1.0)),
                border_radius: BorderRadius::all(px(5.0)),
                ..default()
            },
            BackgroundColor(header),
            BorderColor::all(edge),
            ZIndex(20),
        ))
        .with_children(|card| {
            card.spawn(Node {
                min_width: px(218.0),
                padding: UiRect::bottom(px(6.0)),
                margin: UiRect::bottom(px(2.0)),
                justify_content: JustifyContent::SpaceBetween,
                align_items: AlignItems::Center,
                column_gap: px(16.0),
                border: UiRect::bottom(px(1.0)),
                ..default()
            })
            .with_children(|header_row| {
                header_row.spawn((
                    Text::new(selection.title.clone()),
                    TextFont::from_font_size(9.0),
                    TextColor(mute),
                ));
                header_row.spawn((
                    Text::new(selection.subject.clone()),
                    TextFont::from_font_size(11.0),
                    TextColor(ink),
                ));
            });

            for row in &selection.rows {
                card.spawn(Node {
                    width: percent(100.0),
                    justify_content: JustifyContent::SpaceBetween,
                    column_gap: px(16.0),
                    ..default()
                })
                .with_children(|values| {
                    values.spawn((
                        Text::new(row.label.clone()),
                        TextFont::from_font_size(11.0),
                        TextColor(mute),
                    ));
                    values.spawn((
                        Text::new(row.value.clone()),
                        TextFont::from_font_size(11.0),
                        TextColor(ink),
                    ));
                });
            }

            if let Some(footer) = &selection.footer {
                card.spawn((
                    Node {
                        width: percent(100.0),
                        justify_content: JustifyContent::FlexEnd,
                        padding: UiRect::top(px(4.0)),
                        margin: UiRect::top(px(2.0)),
                        border: UiRect::top(px(1.0)),
                        ..default()
                    },
                    BorderColor::all(edge),
                ))
                .with_child((
                    Text::new(footer.clone()),
                    TextFont::from_font_size(9.0),
                    TextColor(mute),
                ));
            }
        });
}

fn update_native_hud_orientation(
    camera: Res<CameraResource>,
    mut marks: Query<(&HudAxisMark, &mut Node)>,
    mut labels: Query<(&HudAxisLabel, &mut Node), Without<HudAxisMark>>,
) {
    let position = Vec3::from_array(camera.camera.position);
    let target = Vec3::from_array(camera.camera.target);
    let forward = (target - position).normalize_or_zero();
    let up_hint = Vec3::from_array(camera.camera.up).normalize_or_zero();
    let mut right = forward.cross(up_hint).normalize_or_zero();
    if right == Vec3::ZERO {
        right = Vec3::X;
    }
    let screen_up = right.cross(forward).normalize_or_zero();

    for (mark, mut node) in &mut marks {
        let endpoint = Vec2::new(mark.axis.dot(right), -mark.axis.dot(screen_up)) * 25.0;
        let point = Vec2::splat(38.0) + endpoint * mark.fraction;
        node.left = px(point.x - mark.radius);
        node.top = px(point.y - mark.radius);
    }
    for (label, mut node) in &mut labels {
        let endpoint = Vec2::new(label.axis.dot(right), -label.axis.dot(screen_up)) * 25.0;
        let point = Vec2::splat(38.0) + endpoint;
        node.left = px(point.x + if endpoint.x >= 0.0 { 4.0 } else { -8.0 });
        node.top = px(point.y + if endpoint.y >= 0.0 { 2.0 } else { -10.0 });
    }
}

fn camera_transform(camera: ViewportCamera) -> Transform {
    let position = Vec3::from_array(camera.position);
    let target = Vec3::from_array(camera.target);
    let mut up = Vec3::from_array(camera.up).normalize_or_zero();
    let forward = (target - position).normalize_or_zero();
    if up == Vec3::ZERO || forward.cross(up).length_squared() < 1.0e-6 {
        up = Vec3::Z;
    }
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
    mut highlights: Gizmos<CadHighlightGizmos>,
    model: Res<ModelResource>,
    preview: Res<PreviewResource>,
    palette: Res<PaletteResource>,
    presentation: Res<PresentationResource>,
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
                REFERENCE_PLANE_HALF_SIZE,
                origin_plane_color(plane, alpha),
            );
        }
        gizmos.sphere(Vec3::ZERO, 0.46, Color::srgba(0.94, 0.95, 0.98, 0.98));
        gizmos.arrow(
            Vec3::ZERO,
            Vec3::X * 14.0,
            Color::srgba(0.88, 0.36, 0.39, 0.98),
        );
        gizmos.arrow(
            Vec3::ZERO,
            Vec3::Y * 14.0,
            Color::srgba(0.35, 0.68, 0.45, 0.98),
        );
        gizmos.arrow(
            Vec3::ZERO,
            Vec3::Z * 14.0,
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
        draw_plane_outline(
            &mut gizmos,
            &plane.basis,
            REFERENCE_PLANE_HALF_SIZE,
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
        let selected_body_index = state
            .selected_body_ids
            .iter()
            .position(|body_id| *body_id == body.id.0);
        let hovered_body = state.hovered_body_id == Some(body.id.0);

        if selected_body_index.is_some() || hovered_body {
            let color = if selected_body_index == Some(0) {
                rgb(palette.0.face_selected)
            } else if selected_body_index.is_some() {
                rgb(palette.0.edge_selected)
            } else {
                rgb(palette.0.edge_hover)
            };
            for edge in &body.edges {
                draw_edge_segments(&mut highlights, edge, color);
            }
        }

        for edge in &body.edges {
            let selected = state.selected_edge_ids.contains(&edge.id.0);
            let hovered = state.hovered_edge_id == Some(edge.id.0);
            let color = if selected {
                palette.0.edge_selected
            } else if hovered {
                palette.0.edge_hover
            } else if selected_body_index.is_some() {
                palette.0.body_selected_edge
            } else {
                palette.0.edge
            };
            draw_edge_segments(&mut gizmos, edge, rgba(color, 0.92));
            if selected || hovered {
                draw_edge_segments(
                    &mut highlights,
                    edge,
                    rgb(if selected {
                        palette.0.edge_selected
                    } else {
                        palette.0.edge_hover
                    }),
                );
            }
        }

        for face in &body.faces {
            let selected = state.selected_face_ids.contains(&face.id.0);
            let hovered = state.hovered_face_id == Some(face.id.0);
            if selected || hovered {
                draw_face_boundary(
                    &mut highlights,
                    body,
                    face,
                    rgb(if selected {
                        palette.0.edge_selected
                    } else {
                        palette.0.edge_hover
                    }),
                );
            }
        }
    }

    for sketch in &model.finished_sketches {
        draw_sketch(&mut gizmos, sketch, |_| {
            Some(rgba(palette.0.finished_sketch, 0.58))
        });
    }
    if let Some(sketch) = &model.active_sketch {
        draw_sketch(&mut gizmos, sketch, |entity| {
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
        });
        draw_sketch(&mut highlights, sketch, |entity| {
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
            if layer.width >= 2.0 {
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
            highlights.line(center - Vec3::X * radius, center + Vec3::X * radius, color);
            highlights.line(center - Vec3::Y * radius, center + Vec3::Y * radius, color);
            highlights.line(center - Vec3::Z * radius, center + Vec3::Z * radius, color);
        }
    }

    if let Some(marker) = preview.value.marker {
        let center = Vec3::from_array(marker);
        let radius = 0.42;
        let marker_color = Color::srgba(0.20, 0.52, 0.92, 1.0);
        gizmos.line(
            center - Vec3::X * radius,
            center + Vec3::X * radius,
            marker_color,
        );
        gizmos.line(
            center - Vec3::Y * radius,
            center + Vec3::Y * radius,
            marker_color,
        );
        gizmos.line(
            center - Vec3::Z * radius,
            center + Vec3::Z * radius,
            marker_color,
        );
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
) {
    for pair in edge.points.windows(2) {
        gizmos.line(
            Vec3::new(pair[0].x as f32, pair[0].y as f32, pair[0].z as f32),
            Vec3::new(pair[1].x as f32, pair[1].y as f32, pair[1].z as f32),
            color,
        );
    }
}

fn draw_face_boundary<Config: GizmoConfigGroup>(
    gizmos: &mut Gizmos<Config>,
    body: &BodyDto,
    face: &FaceDto,
    color: Color,
) {
    let start = face.first_index as usize;
    let end = start
        .saturating_add(face.index_count as usize)
        .min(body.mesh.indices.len());
    let mut counts = HashMap::<(u32, u32), u32>::new();
    for triangle in body.mesh.indices[start..end].chunks_exact(3) {
        for (a, b) in [
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ] {
            let edge = if a <= b { (a, b) } else { (b, a) };
            *counts.entry(edge).or_default() += 1;
        }
    }
    for ((a, b), count) in counts {
        if count != 1 {
            continue;
        }
        let Some(start) = mesh_position(body, a) else {
            continue;
        };
        let Some(end) = mesh_position(body, b) else {
            continue;
        };
        gizmos.line(start, end, color);
    }
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
    mut color_for: ColorFor,
) where
    Config: GizmoConfigGroup,
    ColorFor: FnMut(&EntityDto) -> Option<Color>,
{
    for entity in &sketch.entities {
        let Some(color) = color_for(entity) else {
            continue;
        };
        match entity {
            EntityDto::Point { position, .. } => {
                let point = sketch_world(&sketch.basis, position.x, position.y, 0.05);
                let radius = 0.22;
                let u = basis_vector(sketch.basis.u) * radius;
                let v = basis_vector(sketch.basis.v) * radius;
                gizmos.line(point - u, point + u, color);
                gizmos.line(point - v, point + v, color);
            }
            EntityDto::Line { start, end, .. } => {
                gizmos.line(
                    sketch_world(&sketch.basis, start.x, start.y, 0.05),
                    sketch_world(&sketch.basis, end.x, end.y, 0.05),
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
                        &sketch.basis,
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
                        &sketch.basis,
                        center.x + radius * angle.cos(),
                        center.y + radius * angle.sin(),
                        0.05,
                    )
                });
            }
            EntityDto::Spline { tessellation, .. } => {
                for pair in tessellation.windows(2) {
                    gizmos.line(
                        sketch_world(&sketch.basis, pair[0].x, pair[0].y, 0.05),
                        sketch_world(&sketch.basis, pair[1].x, pair[1].y, 0.05),
                        color,
                    );
                }
            }
        }
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
                pending.camera.take(),
                pending.preview.take(),
                pending.presentation.take(),
            )
        };

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
        if let Some(camera) = commands.2 {
            apply_render_command(RenderCommand::Camera(camera), runtime, metrics, &mut dirty);
        }
        if let Some(preview) = commands.3 {
            apply_render_command(
                RenderCommand::Preview(preview),
                runtime,
                metrics,
                &mut dirty,
            );
        }
        if let Some(presentation) = commands.4 {
            apply_render_command(
                RenderCommand::Presentation(presentation),
                runtime,
                metrics,
                &mut dirty,
            );
        }
        if dirty {
            // Two updates account for Bevy's extracted/pipelined render world.
            // With no queued changes there is no timer and no idle render loop.
            render_frames(&mut runtime.app, 2, metrics);
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
            let size_changed = (runtime.logical_size.0 - logical_width as f32).abs() > 0.01
                || (runtime.logical_size.1 - logical_height as f32).abs() > 0.01
                || (runtime.scale_factor - scale_factor as f32).abs() > 0.001;
            if size_changed {
                let world = runtime.app.world_mut();
                let mut query = world.query_filtered::<&mut Window, With<PrimaryWindow>>();
                if let Ok(mut window) = query.single_mut(world) {
                    window
                        .resolution
                        .set_scale_factor_override(Some(scale_factor as f32));
                    window
                        .resolution
                        .set_physical_resolution(physical_width, physical_height);
                }
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
            *dirty |= size_changed || palette_changed || hud_changed;
        }
        RenderCommand::Model(next) => {
            runtime.model = next;
            let mut resource = runtime.app.world_mut().resource_mut::<ModelResource>();
            resource.scene = runtime.model.scene.clone();
            resource.active_sketch = runtime.model.active_sketch.clone();
            resource.finished_sketches = runtime.model.finished_sketches.clone();
            resource.datum_planes = runtime.model.datum_planes.clone();
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
        RenderCommand::Camera(next) => {
            runtime.camera = next;
            let mut resource = runtime.app.world_mut().resource_mut::<CameraResource>();
            resource.camera = next;
            resource.revision = resource.revision.wrapping_add(1);
            *dirty = true;
        }
        RenderCommand::Preview(next) => {
            let mut resource = runtime.app.world_mut().resource_mut::<PreviewResource>();
            resource.value = next;
            resource.revision = resource.revision.wrapping_add(1);
            *dirty = true;
        }
        RenderCommand::Presentation(next) => {
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

    let mut best: Option<NativePick> = None;
    for body in &scene.bodies {
        if hidden_body_ids.contains(&body.id.0) {
            continue;
        }
        pick_body(body, origin, direction, &mut best);
    }
    best
}

fn pick_body(body: &BodyDto, origin: Vec3, direction: Vec3, best: &mut Option<NativePick>) {
    for face in &body.faces {
        let start = face.first_index as usize;
        let end = start
            .saturating_add(face.index_count as usize)
            .min(body.mesh.indices.len());
        for triangle in body.mesh.indices[start..end].chunks_exact(3) {
            let Some(a) = mesh_position(body, triangle[0]) else {
                continue;
            };
            let Some(b) = mesh_position(body, triangle[1]) else {
                continue;
            };
            let Some(c) = mesh_position(body, triangle[2]) else {
                continue;
            };
            let Some(distance) = ray_triangle(origin, direction, a, b, c) else {
                continue;
            };
            if best
                .as_ref()
                .is_some_and(|current| current.distance <= distance)
            {
                continue;
            }
            *best = Some(NativePick {
                body_id: body.id.0,
                face_id: face.id.0,
                point: (origin + direction * distance).to_array(),
                distance,
            });
        }
    }
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
        };
        let overlay = ViewportRect {
            x: 80.0,
            y: 40.0,
            width: 80.0,
            height: 50.0,
        };
        assert_eq!(
            intersect_rect(overlay, viewport)
                .expect("rectangles overlap")
                .width,
            60.0
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

        let (scene, _, _, _) = state.viewport_snapshot();
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
            )
            .is_none(),
            "browser-hidden bodies must not remain pickable"
        );
        for face in &scene.bodies[0].faces {
            let mesh = face_mesh(&scene.bodies[0], face)
                .expect("every OCCT face should become an independent Bevy mesh");
            assert_eq!(
                mesh.count_vertices(),
                face.index_count as usize,
                "per-face meshes preserve the OCCT tessellation range"
            );
        }

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
            ));
        }
        let average_micros = started.elapsed().as_secs_f64() * 100.0;
        eprintln!("actual OCCT box pick average: {average_micros:.3} µs");
        assert!(
            average_micros < 5_000.0,
            "native picking exceeded the demo's 5 ms CPU budget"
        );
    }
}
