use std::{
    ffi::c_void,
    num::NonZeroU32,
    ptr::NonNull,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

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
use nbcad_solid::{BodyDto, SolidSceneDto};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
use objc2_core_graphics::CGMutablePath;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::{kCAFillRuleEvenOdd, CAShapeLayer};
use raw_window_handle::{
    AppKitWindowHandle, DisplayHandle, HandleError, HasDisplayHandle, HasWindowHandle,
    RawWindowHandle, WindowHandle,
};
use tauri::Manager;

use super::{
    NativePick, NativeViewportMetrics, ViewportCamera, ViewportLayout, ViewportModel,
    ViewportPalette, ViewportPreview, ViewportRect,
};

const INITIAL_PHYSICAL_SIZE: u32 = 32;
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
    },
    Model(ViewportModel),
    Camera(ViewportCamera),
    Preview(ViewportPreview),
}

#[derive(Default)]
struct PendingRenderCommands {
    resize: Option<(f64, f64, f64, ViewportPalette)>,
    model: Option<ViewportModel>,
    camera: Option<ViewportCamera>,
    preview: Option<ViewportPreview>,
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
}

impl Default for PickState {
    fn default() -> Self {
        Self {
            scene: SolidSceneDto::default(),
            camera: ViewportCamera::default(),
            logical_size: (1.0, 1.0),
        }
    }
}

pub struct MacNativeViewport {
    app: tauri::AppHandle,
    runtime: Arc<AtomicUsize>,
    pending: Arc<Mutex<PendingRenderCommands>>,
    pick_state: Arc<Mutex<PickState>>,
    pointers: Arc<NativePointers>,
    metrics: Arc<Mutex<MetricsState>>,
}

impl MacNativeViewport {
    pub fn install(app: &mut tauri::App) -> Result<Self, String> {
        let main_window = app
            .get_webview_window("main")
            .ok_or_else(|| "main Tauri webview window is missing".to_string())?;
        let app_handle = app.handle().clone();
        let runtime = Arc::new(AtomicUsize::new(0));
        let pending = Arc::new(Mutex::new(PendingRenderCommands::default()));
        let pick_state = Arc::new(Mutex::new(PickState::default()));
        let pointers = Arc::new(NativePointers::default());
        let metrics = Arc::new(Mutex::new(MetricsState::default()));
        let install_pointers = pointers.clone();
        let install_metrics = metrics.clone();
        let install_runtime = runtime.clone();
        let install_pending = pending.clone();

        main_window
            .with_webview(move |platform| {
                // Tauri guarantees this closure runs on AppKit's main thread.
                let marker =
                    MainThreadMarker::new().expect("Tauri with_webview must run on main thread");
                let result = unsafe {
                    install_native_views(
                        marker,
                        platform.inner(),
                        platform.ns_window(),
                        install_pointers.clone(),
                    )
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
                    },
                    camera: ViewportCamera::default(),
                    logical_size: (1.0, 1.0),
                    scale_factor: scale_factor as f32,
                });
                render_frames(&mut render_runtime.app, 2, &install_metrics);

                // The Bevy App and raw-window-metal surface are AppKit
                // main-thread-bound. The allocation lives for the process and
                // is dereferenced only by run_on_main_thread closures.
                let runtime_pointer = Box::into_raw(render_runtime) as usize;
                install_runtime.store(runtime_pointer, Ordering::Release);
                if let Ok(mut current) = install_metrics.lock() {
                    current.ready = true;
                    current.scale_factor = scale_factor;
                }
                eprintln!(
                    "native Bevy viewport installed below WKWebView ({scale_factor:.2}x backing scale)"
                );
                drain_render_commands(
                    &install_runtime,
                    &install_pending,
                    &install_metrics,
                );
            })
            .map_err(|error| format!("could not access native WKWebView: {error}"))?;

        Ok(Self {
            app: app_handle,
            runtime,
            pending,
            pick_state,
            pointers,
            metrics,
        })
    }

    pub fn set_layout(&self, app: &tauri::AppHandle, layout: ViewportLayout) -> Result<(), String> {
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
        if preview.segments.len() > 6 * 16_384 {
            return Err("native sketch preview is too large".to_string());
        }
        self.enqueue(RenderCommand::Preview(preview))
    }

    pub fn pick(&self, x: f32, y: f32) -> Result<Option<NativePick>, String> {
        let started = Instant::now();
        let result = {
            let state = self
                .pick_state
                .lock()
                .map_err(|_| "native viewport pick state lock poisoned".to_string())?;
            pick_occt_scene(&state.scene, state.camera, state.logical_size, x, y)
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
            backend: "Bevy 0.19 / wgpu Metal / embedded NSView".to_string(),
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

    let viewport_in_webview = dom_rect_to_view_rect(webview, layout.viewport);
    let viewport_in_parent = webview.convertRect_toView(
        viewport_in_webview,
        unsafe { webview.superview() }.as_deref(),
    );
    viewport.setFrame(viewport_in_parent);
    viewport.setHidden(layout.viewport.width < 2.0 || layout.viewport.height < 2.0);

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

fn dom_rect_to_view_rect(view: &NSView, rect: ViewportRect) -> NSRect {
    let bounds = view.bounds();
    let y = if view.isFlipped() {
        rect.y
    } else {
        bounds.size.height - rect.y - rect.height
    };
    NSRect::new(
        NSPoint::new(rect.x, y),
        NSSize::new(rect.width.max(0.0), rect.height.max(0.0)),
    )
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
struct AppKitViewHandle(usize);

unsafe impl Send for AppKitViewHandle {}
unsafe impl Sync for AppKitViewHandle {}

impl HasWindowHandle for AppKitViewHandle {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let pointer = NonNull::new(self.0 as *mut c_void).expect("NSView handle cannot be null");
        let raw = RawWindowHandle::AppKit(AppKitWindowHandle::new(pointer));
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

impl HasDisplayHandle for AppKitViewHandle {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        Ok(DisplayHandle::appkit())
    }
}

#[derive(Resource, Default)]
struct ModelResource {
    scene: SolidSceneDto,
    active_sketch: Option<SketchDto>,
    finished_sketches: Vec<SketchDto>,
    revision: u64,
}

#[derive(Resource)]
struct CameraResource {
    camera: ViewportCamera,
    revision: u64,
}

#[derive(Resource, Default)]
struct PreviewResource {
    segments: Vec<f32>,
    marker: Option<[f32; 3]>,
}

#[derive(Resource, Clone, Copy, Default)]
struct PaletteResource(ViewportPalette);

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
}

#[derive(Component)]
struct NativeCadBody;

#[derive(Component)]
struct NativeCadCamera;

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
    app.add_plugins(plugins);

    let (window_entity, holder) = {
        let world = app.world_mut();
        let mut query =
            world.query_filtered::<(Entity, &RawHandleWrapperHolder), With<PrimaryWindow>>();
        let (entity, holder) = query
            .single(world)
            .map_err(|error| format!("Bevy primary window entity is missing: {error}"))?;
        (entity, holder.clone())
    };

    let wrapped_view = WindowWrapper::new(AppKitViewHandle(view_pointer));
    let raw_handle = RawHandleWrapper::new(&wrapped_view)
        .map_err(|error| format!("could not wrap embedded NSView: {error}"))?;
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
        .init_resource::<RenderedRevisions>()
        .add_systems(Startup, setup_scene)
        .add_systems(
            Update,
            (rebuild_occt_meshes, apply_camera, draw_cad_gizmos).chain(),
        );

    app.finish();
    app.cleanup();
    Ok(app)
}

fn setup_scene(mut commands: Commands) {
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
}

fn rebuild_occt_meshes(
    mut commands: Commands,
    model: Res<ModelResource>,
    mut revisions: ResMut<RenderedRevisions>,
    existing: Query<Entity, With<NativeCadBody>>,
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
        if positions.is_empty() || body.mesh.indices.is_empty() {
            continue;
        }

        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        if normals.len() == body.mesh.positions.len() / 3 {
            mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
        } else {
            mesh.compute_smooth_normals();
        }
        mesh.insert_indices(Indices::U32(body.mesh.indices.clone()));

        commands.spawn((
            Name::new(format!("OCCT body {} ({})", body.id.0, body.name)),
            NativeCadBody,
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: rgb(palette.0.body),
                metallic: 0.035,
                perceptual_roughness: 0.44,
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

fn draw_cad_gizmos(
    mut gizmos: Gizmos,
    model: Res<ModelResource>,
    preview: Res<PreviewResource>,
    palette: Res<PaletteResource>,
) {
    let fine = rgba(palette.0.grid_fine, 0.28);
    let major = rgba(palette.0.grid_major, 0.48);
    for index in -30..=30 {
        let coordinate = index as f32 * 5.0;
        let color = if index % 5 == 0 { major } else { fine };
        gizmos.line(
            Vec3::new(coordinate, -150.0, -0.03),
            Vec3::new(coordinate, 150.0, -0.03),
            color,
        );
        gizmos.line(
            Vec3::new(-150.0, coordinate, -0.03),
            Vec3::new(150.0, coordinate, -0.03),
            color,
        );
    }
    gizmos.line(
        Vec3::new(-150.0, 0.0, 0.0),
        Vec3::new(150.0, 0.0, 0.0),
        Color::srgba(0.80, 0.25, 0.30, 0.62),
    );
    gizmos.line(
        Vec3::new(0.0, -150.0, 0.0),
        Vec3::new(0.0, 150.0, 0.0),
        Color::srgba(0.25, 0.65, 0.38, 0.62),
    );

    for body in &model.scene.bodies {
        for edge in &body.edges {
            for pair in edge.points.windows(2) {
                gizmos.line(
                    Vec3::new(pair[0].x as f32, pair[0].y as f32, pair[0].z as f32),
                    Vec3::new(pair[1].x as f32, pair[1].y as f32, pair[1].z as f32),
                    rgba(palette.0.edge, 0.92),
                );
            }
        }
    }

    for sketch in &model.finished_sketches {
        draw_sketch(&mut gizmos, sketch, rgba(palette.0.finished_sketch, 0.58));
    }
    if let Some(sketch) = &model.active_sketch {
        draw_sketch(&mut gizmos, sketch, rgba(palette.0.active_sketch, 0.98));
    }

    let preview_color = rgba(palette.0.preview, 0.98);
    for segment in preview.segments.chunks_exact(6) {
        gizmos.line(
            Vec3::new(segment[0], segment[1], segment[2]),
            Vec3::new(segment[3], segment[4], segment[5]),
            preview_color,
        );
    }
    if let Some(marker) = preview.marker {
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

fn draw_sketch(gizmos: &mut Gizmos, sketch: &SketchDto, color: Color) {
    for entity in &sketch.entities {
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
    gizmos: &mut Gizmos,
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
        } => pending.resize = Some((logical_width, logical_height, scale_factor, palette)),
        RenderCommand::Model(model) => pending.model = Some(model),
        RenderCommand::Camera(camera) => pending.camera = Some(camera),
        RenderCommand::Preview(preview) => pending.preview = Some(preview),
    }
    if pending.scheduled {
        false
    } else {
        pending.scheduled = true;
        true
    }
}

/// Drains coalesced mutations on AppKit's main thread. `raw-window-metal`
/// requires NSView access from this thread, so the Bevy App is deliberately
/// kept behind a process-lifetime pointer that is never dereferenced elsewhere.
fn drain_render_commands(
    runtime_pointer: &Arc<AtomicUsize>,
    pending: &Arc<Mutex<PendingRenderCommands>>,
    metrics: &Arc<Mutex<MetricsState>>,
) {
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
            {
                pending.scheduled = false;
                return;
            }
            (
                pending.resize.take(),
                pending.model.take(),
                pending.camera.take(),
                pending.preview.take(),
            )
        };

        if let Ok(mut current) = metrics.lock() {
            current.wakeups += 1;
        }
        let mut dirty = false;
        if let Some((logical_width, logical_height, scale_factor, palette)) = commands.0 {
            apply_render_command(
                RenderCommand::Resize {
                    logical_width,
                    logical_height,
                    scale_factor,
                    palette,
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
            *dirty |= size_changed || palette_changed;
        }
        RenderCommand::Model(next) => {
            runtime.model = next;
            let mut resource = runtime.app.world_mut().resource_mut::<ModelResource>();
            resource.scene = runtime.model.scene.clone();
            resource.active_sketch = runtime.model.active_sketch.clone();
            resource.finished_sketches = runtime.model.finished_sketches.clone();
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
            resource.segments = next.segments;
            resource.marker = next.marker;
            *dirty = true;
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

        let (scene, _, _) = state.viewport_snapshot();
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
        )
        .expect("center ray should hit the OCCT box");
        assert_eq!(hit.body_id, scene.bodies[0].id.0);
        assert!(hit.point[2] > 9.99);

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
            ));
        }
        let average_micros = started.elapsed().as_secs_f64() * 100.0;
        eprintln!("actual OCCT box pick average: {average_micros:.3} µs");
        assert!(
            average_micros < 5_000.0,
            "native picking exceeded the POC's 5 ms CPU budget"
        );
    }
}
