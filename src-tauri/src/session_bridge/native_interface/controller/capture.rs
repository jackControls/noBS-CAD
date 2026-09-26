//! Capture this application's rendered window through the same MCP lane.
//! Bevy reads its own render target; no desktop pixels or other windows enter
//! the image. Encoding runs off the presentation thread.

use super::*;
use bevy::render::view::screenshot::{Screenshot, ScreenshotCaptured};
use std::{fs::OpenOptions, io::BufWriter, path::PathBuf, time::Instant};

type Outcome = Arc<Mutex<Option<Result<Value, String>>>>;

#[derive(Resource)]
struct Capture {
    entity: Entity,
    started: Instant,
    outcome: Outcome,
}

fn destination(ui: &Value) -> Result<(PathBuf, bool), String> {
    let path = PathBuf::from(
        ui["path"]
            .as_str()
            .ok_or("Capture requires an absolute PNG path")?,
    );
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        return Err("Capture requires an absolute PNG path".into());
    }
    let overwrite = match ui.get("overwrite") {
        None => false,
        Some(value) => value.as_bool().ok_or("overwrite must be boolean")?,
    };
    if !path.parent().is_some_and(|parent| parent.is_dir()) {
        return Err("Capture output directory does not exist".into());
    }
    if path.exists() && !overwrite {
        return Err("Capture file exists; choose a new path or set overwrite: true".into());
    }
    Ok((path, overwrite))
}

pub(super) fn begin(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    owner: &DocumentContext,
    ui: &Value,
) -> Result<Value, String> {
    if world.contains_resource::<Capture>() {
        return Err("A window capture is already in progress".into());
    }
    let (path, overwrite) = destination(ui)?;
    if !world
        .get_resource::<crate::native_viewport::winit_host::NativeRenderAvailability>()
        .is_some_and(|availability| availability.drawable)
    {
        return Err("Restore the CAD window before capturing its rendered interface".into());
    }
    let owner = owner.clone();
    let services = services.clone();
    let handle = handle.clone();
    let outcome: Outcome = Arc::new(Mutex::new(None));
    let completed = outcome.clone();
    let entity = world.spawn(Screenshot::primary_window()).observe(
        move |event: On<ScreenshotCaptured>| {
            let image = event.image.clone();
            let path = path.clone();
            let services = services.clone();
            let owner = owner.clone();
            let completed = completed.clone();
            let wake = handle.clone();
            let fallback = completed.clone();
            let fallback_wake = wake.clone();
            if let Err(error) = std::thread::Builder::new()
                .name("cad-window-capture".into())
                .spawn(move || {
                    let result = (|| {
                        services.bridge.with_native_document_owner(&services.engine, &owner, || Ok(()))?;
                        let image = image.try_into_dynamic().map_err(|e| format!("Capture image: {e}"))?.to_rgb8();
                        let (width, height) = image.dimensions();
                        let file = OpenOptions::new().write(true).create(overwrite)
                            .truncate(overwrite).create_new(!overwrite).open(&path)
                            .map_err(|e| format!("Capture output: {e}"))?;
                        let mut output = BufWriter::new(file);
                        image.write_to(&mut output, bevy::image::ImageFormat::Png.as_image_crate_format().expect("PNG support is enabled"))
                            .map_err(|e| format!("Encode capture: {e}"))?;
                        std::io::Write::flush(&mut output).map_err(|e| format!("Flush capture: {e}"))?;
                        Ok(json!({"path":path,"width":width,"height":height,"source":"bevy_window"}))
                    })();
                    *completed.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
                    wake.request_redraw();
                }) {
                    *fallback.lock().unwrap_or_else(|e| e.into_inner()) = Some(Err(format!("Start capture writer: {error}")));
                    fallback_wake.request_redraw();
                }
        },
    ).id();
    world.insert_resource(Capture {
        entity,
        started: Instant::now(),
        outcome,
    });
    Ok(json!({"capture_pending":true}))
}

pub(super) fn poll(world: &mut World) -> Option<Result<Value, String>> {
    let capture = world.get_resource::<Capture>()?;
    let result = capture
        .outcome
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if result.is_none() && capture.started.elapsed() < Duration::from_secs(15) {
        return None;
    }
    let entity = capture.entity;
    world.despawn(entity);
    world.remove_resource::<Capture>();
    Some(result.unwrap_or_else(|| {
        Err("The renderer did not complete the capture within 15 seconds".into())
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_never_overwrites_without_explicit_permission() {
        let root = std::env::temp_dir().join(format!("cad-capture-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("frame.png");
        assert!(destination(&json!({"path":path})).is_ok());
        std::fs::write(&path, b"existing image").unwrap();
        assert!(destination(&json!({"path":path})).is_err());
        assert!(destination(&json!({"path":path,"overwrite":true})).is_ok());
        for ui in [
            json!({}),
            json!({"path":"relative.png"}),
            json!({"path":root.join("model.nbcad")}),
            json!({"path":path,"overwrite":"yes"}),
        ] {
            assert!(destination(&ui).is_err());
        }
        assert_eq!(std::fs::read(&path).unwrap(), b"existing image");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
