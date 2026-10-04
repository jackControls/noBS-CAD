use super::super::super::super::*;
use super::super::runtime::Editor;
use super::*;

fn prepare(
    engine: &AppState,
    bridge: &SessionBridgeState,
    stamp: &Stamp,
    target: &radial::Target,
    validate: impl FnOnce() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    bridge.with_native_document_receipt(engine, &stamp.owner, |revision| {
        if revision != stamp.revision {
            return Err("Drawing changed; choose the refreshed circle".into());
        }
        validate()?;
        let encoded = engine.engine_call("hole_definitions", "");
        if encoded.len() > 8 * 1024 * 1024 {
            return Err("Modeled hole definitions exceed the callout limit".into());
        }
        let definitions = serde_json::from_value::<Vec<HoleDefinitionDto>>(
            crate::session_bridge::parse_engine_envelope(encoded)?,
        )
        .map_err(|error| error.to_string())?;
        let next = create(&engine.drawing_snapshot(), stamp, target, &definitions)?;
        serde_json::to_value(next).map_err(|error| error.to_string())
    })
}

fn prepare_dispatch(
    services: &NativeServices,
    stamp: &Stamp,
    target: &radial::Target,
    guard: &worker::DispatchGuard,
) -> Result<Value, String> {
    prepare(&services.engine, &services.bridge, stamp, target, || {
        guard.validate_preparation()
    })
}

pub(in super::super) fn submit(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    engine: &AppState,
    bridge: &SessionBridgeState,
    stamp: &Stamp,
    target: &radial::Target,
) -> Result<Value, String> {
    if worker::available(world) {
        let stamp = stamp.clone();
        let target = target.clone();
        let expected = stamp.owner.clone();
        return worker::enqueue_transaction(
            world,
            "drawing_set_document".into(),
            move |services, guard| {
                let args = prepare_dispatch(services, &stamp, &target, guard)?;
                services.bridge.apply_native_mutation_at(
                    &services.engine,
                    &stamp.owner,
                    stamp.revision,
                    "drawing_set_document",
                    &args,
                    || guard.validate(),
                )
            },
            move |world, services, result| {
                let result = result.map_err(|error| {
                    if let Some(mut editor) = world.get_resource_mut::<Editor>() {
                        if editor.stamp.as_ref().is_some_and(|s| s.owner == expected) {
                            editor.message = error.clone();
                        }
                    }
                    error
                })?;
                Ok(finish_mutation(
                    &services.engine,
                    &services.bridge,
                    world,
                    "drawing_set_document",
                    result,
                ))
            },
        );
    }
    // Fixtures without a worker exercise the same receipt-fenced preparation.
    let args = prepare(engine, bridge, stamp, target, || {
        handle
            .frame()
            .filter(|frame| frame.context == stamp.owner)
            .map(|_| ())
            .ok_or("Drawing document changed".into())
    })?;
    super::super::runtime::submit(
        world,
        handle,
        engine,
        bridge,
        stamp,
        "drawing_set_document",
        args,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_bridge::{native_interface::tests::Fixture, parse_engine_envelope};

    #[test]
    fn hole_preparation_survives_busy_updates_but_commit_rejects_rebound_controls() {
        use crate::session_bridge::native_interface::controller;
        use std::sync::mpsc;
        let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
        for rebind in [false, true] {
            let f = Fixture::new();
            let document = super::super::super::tests::document();
            f.bridge
                .apply_native_mutation(
                    &f.engine,
                    &f.owner(),
                    "drawing_set_document",
                    &serde_json::to_value(&document).unwrap(),
                    || Ok(()),
                )
                .unwrap();
            let receipt = f
                .bridge
                .native_document_receipt(&f.engine, &f.owner())
                .unwrap();
            let stamp = Stamp {
                owner: receipt.owner.clone(),
                revision: receipt.revision,
                sheet_id: 1,
            };
            let target = super::super::tests::target();
            let expected = create(&document, &stamp, &target, &[]).unwrap();
            let (mut app, handle, entity) = controller::tests::prepare(&f);
            app.init_resource::<Messages<crate::native_viewport::winit_host::NativeHostInput>>();
            let services = app.world().resource::<NativeServices>().clone();
            worker::install(app.world_mut(), services.clone(), handle.clone()).unwrap();
            let snapshot = handle.inspect().unwrap();
            let action = handle
                .resolve(
                    &nbcad_interface::ControlRequest::Click {
                        target: snapshot["surfaces"][0]["controls"][0]["id"]
                            .as_str()
                            .unwrap()
                            .into(),
                    },
                    &receipt.owner,
                )
                .unwrap();
            app.insert_resource(worker::ActiveControl(action));
            let (prepared_tx, prepared_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            // Stop precisely between the production preparation and dispatch,
            // allowing the real busy-frame path to run on the update thread.
            worker::enqueue_transaction(
                app.world_mut(),
                "drawing_set_document".into(),
                move |services, guard| {
                    let args = prepare_dispatch(services, &stamp, &target, guard)?;
                    prepared_tx.send(()).unwrap();
                    release_rx
                        .recv_timeout(Duration::from_secs(10))
                        .map_err(|e| e.to_string())?;
                    services.bridge.apply_native_mutation_at(
                        &services.engine,
                        &stamp.owner,
                        stamp.revision,
                        "drawing_set_document",
                        &args,
                        || guard.validate(),
                    )
                },
                |_, _, result| Ok(result?.value),
            )
            .unwrap();
            app.world_mut().remove_resource::<worker::ActiveControl>();
            prepared_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            app.world_mut()
                .resource_scope(|world, mut state: Mut<controller::Controller>| {
                    controller::maintain_busy_window(world, &handle, &mut state).unwrap();
                });
            if rebind {
                app.world_mut()
                    .get_mut::<InterfaceControl>(entity)
                    .unwrap()
                    .binding += 1;
            }
            app.update();
            release_tx.send(()).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            let outcome = loop {
                if let Some(outcome) = worker::poll(app.world_mut(), &services) {
                    break outcome.value;
                }
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(5));
            };
            if rebind {
                assert!(outcome.unwrap_err().contains("changed"));
                assert_eq!(f.engine.drawing_snapshot(), document);
                assert_eq!(
                    f.bridge
                        .native_document_receipt(&f.engine, &receipt.owner)
                        .unwrap(),
                    receipt
                );
            } else {
                outcome.expect("Preparing the callout must not disable its own dispatch control");
                assert_eq!(f.engine.drawing_snapshot(), expected);
                assert_eq!(
                    f.bridge
                        .native_document_receipt(&f.engine, &receipt.owner)
                        .unwrap()
                        .revision,
                    receipt.revision + 1
                );
            }
        }
    }

    #[test]
    fn hole_preparation_queries_the_owned_document_without_editing_and_rejects_stale_or_cancelled_work(
    ) {
        let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
        let f = Fixture::new();
        let document = super::super::super::tests::document();
        let receipt = f
            .bridge
            .native_document_receipt(&f.engine, &f.owner())
            .unwrap();
        f.bridge
            .apply_native_mutation_at(
                &f.engine,
                &receipt.owner,
                receipt.revision,
                "drawing_set_document",
                &serde_json::to_value(&document).unwrap(),
                || Ok(()),
            )
            .unwrap();
        let receipt = f
            .bridge
            .native_document_receipt(&f.engine, &f.owner())
            .unwrap();
        let stamp = Stamp {
            owner: receipt.owner,
            revision: receipt.revision,
            sheet_id: 1,
        };
        let target = super::super::tests::target();
        let exported =
            || parse_engine_envelope(f.engine.engine_call("project_export_model", "")).unwrap();
        let before = exported();
        let prepared = prepare(&f.engine, &f.bridge, &stamp, &target, || Ok(())).unwrap();
        assert_eq!(
            prepared,
            serde_json::to_value(create(&document, &stamp, &target, &[]).unwrap()).unwrap()
        );
        assert_eq!(exported(), before);
        assert_eq!(
            prepare(&f.engine, &f.bridge, &stamp, &target, || Err(
                "Cancelled owned gesture".into()
            ))
            .unwrap_err(),
            "Cancelled owned gesture"
        );
        let mut stale = stamp.clone();
        stale.revision += 1;
        assert!(prepare(&f.engine, &f.bridge, &stale, &target, || Ok(())).is_err());
        stale = stamp;
        stale.owner.epoch += 1;
        assert!(prepare(&f.engine, &f.bridge, &stale, &target, || Ok(())).is_err());
        assert_eq!(exported(), before);
    }
}
