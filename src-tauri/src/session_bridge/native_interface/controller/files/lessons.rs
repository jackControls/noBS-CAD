//! Short installed lessons use the existing live script runner. The runner
//! waits for inbox receipts, so it must never occupy the modeling worker.
use super::*;
use std::sync::OnceLock;

pub(super) struct Lesson {
    pub id: String,
    pub name: String,
    source: String,
}

pub(super) fn catalog() -> &'static [Lesson] {
    static LESSONS: OnceLock<Vec<Lesson>> = OnceLock::new();
    LESSONS.get_or_init(|| {
        nbcad_mcp::script_examples()
            .as_array()
            .into_iter()
            .flatten()
            .filter(|entry| entry["kind"] == "lesson")
            .filter_map(|entry| {
                Some(Lesson {
                    id: entry["id"].as_str()?.into(),
                    name: entry["name"].as_str()?.into(),
                    source: entry["source"].as_str()?.into(),
                })
            })
            .collect()
    })
}

fn lesson(id: &str) -> Result<&'static Lesson, String> {
    catalog()
        .iter()
        .find(|lesson| lesson.id == id)
        .ok_or_else(|| "Choose a short built-in lesson from Scripts".into())
}

pub(super) struct Running {
    owner: DocumentContext,
    kind: &'static str,
    result: Mutex<mpsc::Receiver<Result<Value, String>>>,
}

pub(super) fn start(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    owner: &DocumentContext,
    id: &str,
) -> Result<Value, String> {
    let lesson = lesson(id)?;
    start_source(
        world,
        handle,
        services,
        owner,
        &lesson.name,
        lesson.source.clone(),
        "Lesson",
    )?;
    Ok(json!({"lesson_started":lesson.id}))
}

pub(super) fn start_source(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    owner: &DocumentContext,
    name: &str,
    source: String,
    kind: &'static str,
) -> Result<(), String> {
    start_source_with_options(
        world, handle, services, owner, name, source, kind, "present", 1.,
    )
}

pub(super) fn start_source_with_options(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    owner: &DocumentContext,
    name: &str,
    source: String,
    kind: &'static str,
    mode: &'static str,
    speed: f64,
) -> Result<(), String> {
    if world.resource::<Files>().script.preview.building() {
        return Err("Wait for the isolated lesson preview to finish preparing".into());
    }
    if world.resource::<Files>().lesson.is_some() {
        return Err(
            "A script is already running. Use its playback controls to stop or pause it".into(),
        );
    }
    if awaiting(world) {
        return Err("Finish the current File dialog first".into());
    }
    let receipt =
        services
            .bridge
            .with_native_document_receipt(&services.engine, owner, |revision| {
                if !services.engine.is_blank_for_script() {
                    return Err("Scripts require a blank document. Use New document first".into());
                }
                Ok(DocumentReceipt {
                    owner: owner.clone(),
                    revision,
                })
            })?;
    let session = services
        .bridge
        .session_id_for_window(&owner.window_id)?
        .ok_or("Publish the current document before running a script")?;
    let session = services.bridge.active_script_session(
        &owner.window_id,
        &services.engine,
        &owner.document_id,
        &session,
    )?;
    let (send, receive) = mpsc::channel();
    let services = services.clone();
    let wake = handle.clone();
    std::thread::Builder::new()
        .name("cad-native-script".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if services
                    .bridge
                    .native_document_receipt(&services.engine, &receipt.owner)?
                    != receipt
                {
                    return Err("The document changed before the script started".into());
                }
                nbcad_mcp::run_script(&source, None, Some(&session), mode, speed)
            }))
            .unwrap_or_else(|_| {
                Err(
                    "The script worker stopped unexpectedly; any completed work is preserved"
                        .into(),
                )
            });
            let _ = send.send(result);
            wake.request_redraw();
        })
        .map_err(|error| format!("Cannot start script: {error}"))?;
    let mut files = world.resource_mut::<Files>();
    files.lesson = Some(Running {
        owner: owner.clone(),
        kind,
        result: Mutex::new(receive),
    });
    files.lesson_status = Some((owner.clone(), format!("Running {name}")));
    files.scripts = false;
    Ok(())
}

pub(super) fn poll(world: &mut World) {
    let result = world
        .resource::<Files>()
        .lesson
        .as_ref()
        .and_then(|running| {
            Some(match running.result.lock() {
                Ok(receiver) => match receiver.try_recv() {
                    Ok(result) => result,
                    Err(mpsc::TryRecvError::Empty) => return None,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        Err("The script worker disconnected".into())
                    }
                },
                Err(_) => Err("The script result could not be read".into()),
            })
        });
    let Some(result) = result else { return };
    let mut files = world.resource_mut::<Files>();
    let running = files.lesson.take().unwrap();
    let status = match result {
        Ok(report) => format!(
            "{} complete: {} steps, {} checks",
            running.kind, report["steps_completed"], report["checks_completed"]
        ),
        Err(error) => format!("{} stopped: {error}", running.kind),
    };
    files.lesson_status = Some((running.owner, status));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lesson_catalog_excludes_flagship_and_arbitrary_sources() {
        assert_eq!(catalog().len(), 4);
        assert!(lesson("fillet-basics")
            .unwrap()
            .source
            .contains("solid_fillet"));
        for id in [
            "d-screw-vise",
            "garden-bench",
            "vertical-axis-turbine",
            "../lesson.jsonc",
        ] {
            assert!(lesson(id).is_err(), "{id}");
        }
    }

    #[test]
    fn lesson_refuses_work_before_starting_any_worker() {
        let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
        let fixture = super::super::super::super::tests::Fixture::new();
        let services = NativeServices {
            engine: fixture.engine.clone(),
            bridge: fixture.bridge.clone(),
        };
        let mut world = World::new();
        initialize(
            &mut world,
            Arc::new(Mutex::new(DocumentWorkspace::default())),
        );
        let owner = fixture.owner();
        fixture
            .bridge
            .apply_native_mutation(
                &fixture.engine,
                &owner,
                "sketch_begin",
                &json!({"type":"origin_plane","plane":"xy"}),
                || Ok(()),
            )
            .unwrap();
        let before = fixture.engine.engine_call("project_export_model", "");
        let error = start(
            &mut world,
            &NativeInterfaceHandle::new(|| {}),
            &services,
            &owner,
            "fillet-basics",
        )
        .unwrap_err();
        assert!(error.contains("blank"));
        assert!(world.resource::<Files>().lesson.is_none());
        assert_eq!(
            before,
            fixture.engine.engine_call("project_export_model", "")
        );
    }
}
