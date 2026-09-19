use super::*;

pub(crate) fn synchronize(
    world: &mut World,
    services: &NativeServices,
    owner: &DocumentContext,
    revision: u64,
    width: f32,
    height: f32,
) -> Result<(), String> {
    let mut state = world.remove_resource::<History>().unwrap_or_default();
    let result = (|| {
        let receipt = DocumentReceipt {
            owner: owner.clone(),
            revision,
        };
        if state
            .snapshot
            .as_ref()
            .is_none_or(|(prior, _)| prior != &receipt)
        {
            if state
                .snapshot
                .as_ref()
                .is_none_or(|(prior, _)| prior.owner != *owner)
            {
                state.menu = None;
                state.delete = None;
                state.selected = None;
                state.scroll = 0;
            }
            let document = services.engine.document_snapshot();
            if state
                .selected
                .is_some_and(|id| feature(&document, id).is_err())
            {
                state.selected = None;
            }
            state.snapshot = Some((receipt, Arc::new(document)));
        }
        let document = state.snapshot.as_ref().unwrap().1.clone();
        let mut cameras = world.query_filtered::<Entity, With<InterfaceCamera>>();
        let camera = cameras
            .single(world)
            .map_err(|_| "Missing interface camera")?;
        let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
        let y = (height - 48.).max(0.);
        let locked = idle(world).is_err();
        let count = document.features.len();
        let rollback = document.rollback_index;
        state.widgets.begin();
        state.widgets.panel(
            world,
            camera,
            "history-bg",
            rect(0., y, width, 48.),
            theme.panel,
            22,
        );
        state.widgets.panel(
            world,
            camera,
            "history-title-bg",
            rect(12., y + 8., 166., 32.),
            theme.header,
            23,
        );
        state.widgets.text(
            world,
            camera,
            "history-title",
            rect(23., y + 17., 148., 16.),
            &format!("DESIGN HISTORY   {rollback}/{count}"),
            10.,
            24,
        );
        for (i, (label, icon, index)) in [
            ("Roll back to start", Icon::ArrowLeftToLine, 0),
            (
                "Previous feature",
                Icon::ArrowLeft,
                rollback.saturating_sub(1),
            ),
            ("Next feature", Icon::ArrowRight, (rollback + 1).min(count)),
            ("Roll forward to end", Icon::ArrowRightToLine, count),
        ]
        .into_iter()
        .enumerate()
        {
            state.widgets.button(
                world,
                camera,
                &format!("rollback-{i}"),
                control(label, None, locked || index == rollback),
                Some(""),
                NativeCommand::History(HistoryCommand::Rollback(index)),
                rect(188. + i as f32 * 30., y + 12., 28., 24.),
                Some(icon),
                24,
            )?;
        }
        let list_x = 322.;
        let available = (width - list_x - 42.).max(1.);
        state.scroll = state.scroll.min(count.saturating_sub(1));
        state.widgets.panel(
            world,
            camera,
            "history-strip",
            rect(list_x - 2., y + 6., width - list_x - 10., 36.),
            theme.header,
            23,
        );
        let mut x = list_x + 8.;
        let mut shown = 0;
        for (index, feature) in document.features.iter().enumerate().skip(state.scroll) {
            let w = (feature.name.chars().count() as f32 * 5.3 + 32.).clamp(36., 116.);
            if x + w > list_x + available {
                break;
            }
            if index == rollback {
                state.widgets.panel(
                    world,
                    camera,
                    "history-cursor",
                    rect(x - 4., y + 6., 2., 36.),
                    theme.accent,
                    25,
                );
            }
            let mut c = control(&feature.name, None, false);
            c.selected = Some(state.selected == Some(feature.id.0));
            c.owned_keys = vec![
                KeyChord {
                    key: "ContextMenu".into(),
                    ..default()
                },
                KeyChord {
                    key: "F10".into(),
                    shift: true,
                    ..default()
                },
            ];
            let caption = format!(
                "{}{}",
                feature.name,
                if index >= rollback { " ·" } else { "" }
            );
            let mut bounds = rect(x, y + 10., w, 28.);
            bounds.border = UiRect::all(px(1.));
            bounds.border_radius = BorderRadius::all(px(6.));
            let entity = state.widgets.button(
                world,
                camera,
                &format!("feature-{}", feature.id.0),
                c,
                Some(&caption),
                NativeCommand::History(HistoryCommand::Select(feature.id.0)),
                bounds,
                Some(icon(feature)),
                24,
            )?;
            if world
                .get::<interface_shell::InterfaceFlat>(entity)
                .is_some()
            {
                world
                    .entity_mut(entity)
                    .remove::<interface_shell::InterfaceFlat>();
            }
            interface_shell::caption_size(world, entity, 10.);
            x += w + 6.;
            shown += 1;
        }
        if rollback == count && state.scroll + shown == count {
            state.widgets.panel(
                world,
                camera,
                "history-cursor",
                rect(x - 2., y + 6., 2., 36.),
                theme.accent,
                25,
            );
        }
        if state.scroll > 0 {
            state.widgets.button(
                world,
                camera,
                "scroll-back",
                control("Earlier features", None, false),
                Some("‹"),
                NativeCommand::History(HistoryCommand::Scroll(-1)),
                rect(list_x - 20., y + 12., 20., 24.),
                None,
                26,
            )?;
        }
        if state.scroll + shown < count {
            state.widgets.button(
                world,
                camera,
                "scroll-forward",
                control("Later features", None, false),
                Some("›"),
                NativeCommand::History(HistoryCommand::Scroll(1)),
                rect(width - 28., y + 12., 22., 24.),
                None,
                26,
            )?;
        }
        if let Some(target) = &state.menu {
            if let Ok(feature) = feature(&document, target.id) {
                let index = document
                    .features
                    .iter()
                    .position(|f| f.id.0 == target.id)
                    .unwrap();
                let x = target.anchor[0].min((width - 244.).max(4.));
                let y = (target.anchor[1] - 156.).max(4.);
                let scope = "history-menu";
                state.widgets.backdrop(
                    world,
                    camera,
                    "history-backdrop",
                    scope,
                    NativeCommand::History(HistoryCommand::Cancel),
                    rect(0., 0., width, height),
                    59,
                )?;
                state.widgets.panel(
                    world,
                    camera,
                    "history-menu-bg",
                    rect(x, y, 240., 154.),
                    theme.header.with_alpha(1.),
                    60,
                );
                for (i, (label, command, disabled)) in [
                    (
                        if feature.kind == FeatureKind::Sketch {
                            "Edit sketch"
                        } else {
                            "Edit feature"
                        },
                        HistoryCommand::Edit(target.id),
                        locked
                            || !matches!(feature.kind, FeatureKind::Sketch | FeatureKind::Extrude),
                    ),
                    (
                        "Roll back before",
                        HistoryCommand::Rollback(index),
                        locked || index == rollback,
                    ),
                    (
                        "Roll forward after",
                        HistoryCommand::Rollback(index + 1),
                        locked || index + 1 == rollback,
                    ),
                    (
                        "Roll forward to end",
                        HistoryCommand::Rollback(count),
                        locked || count == rollback,
                    ),
                    ("Delete feature…", HistoryCommand::Delete(target.id), locked),
                ]
                .into_iter()
                .enumerate()
                {
                    state.widgets.button(
                        world,
                        camera,
                        &format!("history-menu-{i}"),
                        control(label, Some(scope), disabled),
                        None,
                        NativeCommand::History(command),
                        rect(x + 4., y + 4. + i as f32 * 29., 232., 28.),
                        None,
                        61,
                    )?;
                }
            }
        }
        if let Some(target) = &state.delete {
            let scope = "delete-feature";
            let w = 448_f32.min((width - 32.).max(1.));
            let x = (width - w) / 2.;
            let y = ((height - 208.) / 2.).max(0.);
            state.widgets.backdrop(
                world,
                camera,
                "delete-backdrop",
                scope,
                NativeCommand::History(HistoryCommand::Cancel),
                rect(0., 0., width, height),
                69,
            )?;
            state.widgets.panel(
                world,
                camera,
                "delete-dim",
                rect(0., 0., width, height),
                Color::srgba(0., 0., 0., 0.45),
                68,
            );
            state.widgets.panel(
                world,
                camera,
                "delete-panel",
                rect(x, y, w, 208.),
                theme.panel.with_alpha(1.),
                70,
            );
            state.widgets.text(
                world,
                camera,
                "delete-title",
                rect(x + 16., y + 12., w - 32., 24.),
                "Delete feature",
                14.,
                71,
            );
            let name = feature(&document, target.id)
                .map(|f| f.name.as_str())
                .unwrap_or("this feature");
            let message=state.error.clone().unwrap_or_else(||format!("Delete {name}? Later features that depend on it may fail. You can undo this change."));
            state.widgets.text(
                world,
                camera,
                "delete-message",
                rect(x + 16., y + 51., w - 32., 93.),
                &message,
                12.,
                71,
            );
            for (key, label, command, x) in [
                (
                    "delete-cancel",
                    "Cancel",
                    HistoryCommand::Cancel,
                    x + w - 188.,
                ),
                (
                    "delete-confirm",
                    "Delete",
                    HistoryCommand::ConfirmDelete(target.id),
                    x + w - 94.,
                ),
            ] {
                let mut bounds = rect(x, y + 161., 78., 32.);
                bounds.border = UiRect::all(px(1.));
                let entity = state.widgets.button(
                    world,
                    camera,
                    key,
                    control(label, Some(scope), false),
                    None,
                    NativeCommand::History(command),
                    bounds,
                    None,
                    72,
                )?;
                if key == "delete-confirm" {
                    interface_shell::destructive_button(world, entity);
                } else if world
                    .get::<interface_shell::InterfaceFlat>(entity)
                    .is_some()
                {
                    world
                        .entity_mut(entity)
                        .remove::<interface_shell::InterfaceFlat>();
                }
            }
        }
        state.widgets.finish(world);
        Ok(())
    })();
    world.insert_resource(state);
    result
}
