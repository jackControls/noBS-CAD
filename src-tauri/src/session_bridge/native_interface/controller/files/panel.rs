//! Retained File menu, project tabs and owned confirmation/name dialogs.
use super::*;
use crate::native_viewport::interface_shell::{fields, InterfaceCaption, InterfaceOccluder};
use nbcad_interface::Field;
use std::collections::HashSet;

#[derive(Resource, Default)]
struct Widgets {
    controls: HashMap<String, (Entity, FileCommand)>,
    decoration: Vec<Entity>,
    layout: Option<String>,
    chrome: super::super::chrome::Widgets,
}
fn node(x: f32, y: f32, width: f32, height: f32) -> Node {
    Node {
        position_type: PositionType::Absolute,
        left: px(x),
        top: px(y),
        width: px(width),
        height: px(height),
        align_items: AlignItems::Center,
        justify_content: JustifyContent::Center,
        border_radius: BorderRadius::all(px(3.)),
        ..default()
    }
}
#[allow(clippy::too_many_arguments)]
fn button(
    world: &mut World,
    state: &mut Widgets,
    live: &mut HashSet<String>,
    camera: Entity,
    theme: ViewportUiTheme,
    assets: &ViewportUiAssets,
    key: String,
    label: String,
    caption: Option<&str>,
    command: FileCommand,
    mut bounds: Node,
    scope: Option<&str>,
    z: i32,
    selected: Option<bool>,
    disabled: bool,
) -> Result<(), String> {
    live.insert(key.clone());
    if key.starts_with("tab-") || key.starts_with("file-item-") {
        bounds.justify_content = JustifyContent::Start;
    }
    let surface = scope.unwrap_or("document/session");
    let entity = if let Some((entity, _)) = state.controls.get(&key) {
        *entity
    } else {
        let entity = spawn_button(
            &mut world.commands(),
            camera,
            bounds.clone(),
            InterfaceControl::button(surface, &label),
            theme,
            assets,
        );
        world.flush();
        bind_command(world, entity, NativeCommand::File(command.clone()))?;
        state
            .controls
            .insert(key.clone(), (entity, command.clone()));
        entity
    };
    if state.controls[&key].1 != command {
        bind_command(world, entity, NativeCommand::File(command.clone()))?;
        state.controls.get_mut(&key).unwrap().1 = command;
    }
    if world.get::<Node>(entity) != Some(&bounds) {
        world.entity_mut(entity).insert(bounds);
    }
    if world.get::<ZIndex>(entity) != Some(&ZIndex(z)) {
        world.entity_mut(entity).insert(ZIndex(z));
    }
    let mut control = world.get::<InterfaceControl>(entity).unwrap().clone();
    control.label = label;
    control.surface = surface.into();
    control.modal_scope = scope.map(str::to_owned);
    control.selected = selected;
    control.disabled = disabled;
    control.role = if key.starts_with("tab-") {
        "tab"
    } else if key.starts_with("file-item-") {
        "menuitem"
    } else {
        "button"
    }
    .into();
    control.owned_keys = if control.role == "tab" {
        ["ArrowLeft", "ArrowRight"]
            .map(nbcad_interface::KeyChord::plain)
            .into()
    } else if control.role == "menuitem" {
        ["ArrowUp", "ArrowDown", "Home", "End"]
            .into_iter()
            .map(nbcad_interface::KeyChord::plain)
            .collect()
    } else {
        vec![]
    };
    if world.get::<InterfaceControl>(entity) != Some(&control) {
        world.entity_mut(entity).insert(control);
    }
    if let Some(caption) = caption {
        let caption = InterfaceCaption(caption.into());
        if world.get::<InterfaceCaption>(entity) != Some(&caption) {
            world.entity_mut(entity).insert(caption);
        }
    }
    if key.starts_with("tab-") {
        interface_shell::compact_label(world, entity, 30.);
        interface_shell::control_colors(world, entity, theme.ink, theme.panel);
    } else if key.starts_with("file-item-") {
        interface_shell::compact_label(world, entity, 28.);
        interface_shell::caption_size(world, entity, 11.);
    } else {
        world
            .entity_mut(entity)
            .insert(interface_shell::InterfaceFlat);
        interface_shell::center_caption(world, entity);
        interface_shell::caption_size(world, entity, 11.);
    }
    Ok(())
}
fn rectangle(
    world: &mut World,
    state: &mut Widgets,
    camera: Entity,
    bounds: Node,
    color: Color,
    z: i32,
) {
    state.decoration.push(
        world
            .spawn((
                bounds,
                BackgroundColor(color),
                UiTargetCamera(camera),
                InterfaceOccluder,
                ZIndex(z),
            ))
            .id(),
    );
}
fn text(
    world: &mut World,
    state: &mut Widgets,
    camera: Entity,
    bounds: Node,
    value: &str,
    theme: ViewportUiTheme,
    assets: &ViewportUiAssets,
    z: i32,
    error: bool,
) {
    state.decoration.push(
        world
            .spawn((
                bounds,
                Text::new(value),
                theme.text(assets, 12., FontWeight::NORMAL),
                TextColor(if error {
                    Color::srgb_u8(224, 85, 85)
                } else {
                    theme.ink
                }),
                UiTargetCamera(camera),
                ZIndex(z),
            ))
            .id(),
    );
}
pub(crate) fn synchronize(
    world: &mut World,
    services: &NativeServices,
    owner: &DocumentContext,
    width: f32,
    height: f32,
) -> Result<(), String> {
    let tabs = super::tabs(world, services, owner)?;
    let mut cameras = world.query_filtered::<Entity, With<InterfaceCamera>>();
    let camera = cameras
        .single(world)
        .map_err(|_| "Native interface camera is unavailable")?;
    let assets = world.resource::<ViewportUiAssets>().clone();
    let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
    let menu = world.resource::<Files>().menu;
    if world
        .resource::<Files>()
        .dialog
        .as_ref()
        .is_some_and(|d| &d.receipt.owner != owner)
    {
        world.resource_mut::<Files>().dialog = None;
    }
    let dialog = world.resource::<Files>().dialog.clone();
    let picker = world.resource::<Files>().picker.is_some();
    let mut state = world.remove_resource::<Widgets>().unwrap_or_default();
    let result = (|| {
        let mut live = HashSet::new();
        state.chrome.begin();
        state.chrome.glyph(
            world,
            camera,
            "file-chevron",
            node(31., 11., 7., 7.),
            interface_shell::ribbon::Icon::ChevronDown,
            theme.mute,
            66,
        );
        let layout = format!("{width}:{height}:{menu}:{:?}", dialog);
        if state.layout.as_ref() != Some(&layout) {
            for entity in state.decoration.drain(..) {
                world.despawn(entity);
            }
            rectangle(
                world,
                &mut state,
                camera,
                node(0., 0., width, 28.),
                theme.panel.with_alpha(1.),
                40,
            );
            if menu {
                rectangle(
                    world,
                    &mut state,
                    camera,
                    node(4., 29., 256., 336.),
                    theme.header.with_alpha(1.),
                    60,
                );
            }
            if let Some(dialog) = &dialog {
                let w = 460_f32.min(width - 24.).max(120.);
                let x = (width - w) / 2.;
                let y = (height - 220.).max(0.) / 2.;
                rectangle(
                    world,
                    &mut state,
                    camera,
                    node(0., 0., width, height),
                    Color::srgba(0., 0., 0., 0.45),
                    70,
                );
                rectangle(
                    world,
                    &mut state,
                    camera,
                    node(x, y, w, 220.),
                    theme.header.with_alpha(1.),
                    71,
                );
                let title = if matches!(dialog.kind, DialogKind::Rename(_)) {
                    "Rename document"
                } else {
                    "Unsaved changes"
                };
                text(
                    world,
                    &mut state,
                    camera,
                    node(x + 16., y + 12., w - 32., 26.),
                    title,
                    theme,
                    &assets,
                    72,
                    false,
                );
                if matches!(dialog.kind, DialogKind::Confirm(_)) {
                    let name = tabs
                        .iter()
                        .find(|t| t.active)
                        .map(|t| t.name.as_str())
                        .unwrap_or("this document");
                    text(
                        world,
                        &mut state,
                        camera,
                        node(x + 16., y + 46., w - 32., 62.),
                        &format!("Save changes to {name} before continuing?"),
                        theme,
                        &assets,
                        72,
                        false,
                    );
                } else {
                    text(
                        world,
                        &mut state,
                        camera,
                        node(x + 16., y + 43., w - 32., 20.),
                        "Document name",
                        theme,
                        &assets,
                        72,
                        false,
                    );
                }
                if let Some(error) = &dialog.error {
                    text(
                        world,
                        &mut state,
                        camera,
                        node(x + 16., y + 114., w - 32., 45.),
                        error,
                        theme,
                        &assets,
                        72,
                        true,
                    );
                }
            }
            state.layout = Some(layout);
        }
        button(
            world,
            &mut state,
            &mut live,
            camera,
            theme,
            &assets,
            "file".into(),
            "File".into(),
            Some("NB"),
            FileCommand::Menu,
            node(0., 0., 44., 28.),
            menu.then_some("file-menu"),
            65,
            None,
            picker,
        )?;
        button(
            world,
            &mut state,
            &mut live,
            camera,
            theme,
            &assets,
            "new".into(),
            "New document".into(),
            Some("+"),
            FileCommand::New,
            node(44., 0., 24., 28.),
            None,
            42,
            None,
            picker,
        )?;
        let available = ((width - 212.) / 192.).floor().max(1.) as usize;
        let active = tabs.iter().position(|t| t.active).unwrap_or(0);
        let start = active.saturating_sub(available - 1);
        for (offset, tab) in tabs.iter().skip(start).take(available).enumerate() {
            let x = 68. + offset as f32 * 192.;
            let label = tab.name.clone();
            state.chrome.panel(
                world,
                camera,
                &format!("tab-bg-{}", tab.owner.document_id),
                node(x, 0., 192., 28.),
                if tab.active {
                    theme.panel.with_alpha(1.)
                } else {
                    theme.header.with_alpha(1.)
                },
                41,
            );
            state.chrome.panel(
                world,
                camera,
                &format!("tab-edge-{}", tab.owner.document_id),
                node(x + 191., 0., 1., 28.),
                theme.edge,
                42,
            );
            if tab.active {
                state.chrome.panel(
                    world,
                    camera,
                    "active-tab-line",
                    node(x, 0., 192., 2.),
                    theme.accent,
                    44,
                );
            }
            state.chrome.glyph(
                world,
                camera,
                &format!("tab-stage-{}", tab.owner.document_id),
                node(x + 12., 9., 11., 11.),
                interface_shell::ribbon::Icon::Box,
                if tab.active { theme.accent } else { theme.mute },
                44,
            );
            let mut dot = node(x + 29., 11., 6., 6.);
            dot.border_radius = BorderRadius::MAX;
            state.chrome.panel(
                world,
                camera,
                &format!("tab-dirty-{}", tab.owner.document_id),
                dot,
                if tab.dirty {
                    Color::srgb_u8(232, 150, 60)
                } else {
                    theme.edge
                },
                44,
            );
            button(
                world,
                &mut state,
                &mut live,
                camera,
                theme,
                &assets,
                format!("tab-{}", tab.owner.document_id),
                label,
                None,
                FileCommand::Activate(tab.owner.clone()),
                node(x + 10., 2., 152., 26.),
                None,
                42,
                Some(tab.active),
                picker,
            )?;
            if let Some((entity, _)) = state
                .controls
                .get(&format!("tab-{}", tab.owner.document_id))
            {
                // Keep selected semantics for tabs while making their selected
                // fill equal to the containing card.
                interface_shell::tab_style(world, *entity);
            }
            {
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    format!("close-tab-{}", tab.owner.document_id),
                    if tab.active {
                        "Close document".into()
                    } else {
                        format!("Close document: {}", tab.name)
                    },
                    Some("×"),
                    FileCommand::CloseTab(tab.owner.clone()),
                    node(x + 166., 5., 20., 20.),
                    None,
                    42,
                    None,
                    picker,
                )?;
            }
        }
        // Previous/next expose every retained tab even in narrow windows.
        if tabs.len() > available {
            if active > 0 {
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "previous-tab".into(),
                    "Previous document".into(),
                    Some("‹"),
                    FileCommand::Activate(tabs[active - 1].owner.clone()),
                    node(width - 142., 0., 26., 28.),
                    None,
                    42,
                    None,
                    picker,
                )?;
            }
            if active + 1 < tabs.len() {
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "next-tab".into(),
                    "Next document".into(),
                    Some("›"),
                    FileCommand::Activate(tabs[active + 1].owner.clone()),
                    node(width - 114., 0., 26., 28.),
                    None,
                    42,
                    None,
                    picker,
                )?;
            }
        }
        if menu {
            use interface_shell::ribbon::Icon;
            let primary = if cfg!(target_os = "macos") {
                "⌘"
            } else {
                "Ctrl+"
            };
            for (i, (label, command, icon, shortcut, disabled)) in [
                (
                    "Open…",
                    FileCommand::Open,
                    Icon::FolderOpen,
                    format!("{primary}O"),
                    false,
                ),
                (
                    "Open script…",
                    FileCommand::DismissMenu,
                    Icon::Book,
                    String::new(),
                    true,
                ),
                (
                    "New document",
                    FileCommand::New,
                    Icon::Box,
                    format!("{primary}N"),
                    false,
                ),
                (
                    "Save",
                    FileCommand::Save,
                    Icon::Save,
                    format!("{primary}S"),
                    false,
                ),
                (
                    "Save as…",
                    FileCommand::SaveAs,
                    Icon::Save,
                    format!(
                        "{}{}S",
                        if cfg!(target_os = "macos") {
                            "⇧"
                        } else {
                            "Shift+"
                        },
                        primary
                    ),
                    false,
                ),
                (
                    "Rename…",
                    FileCommand::Rename,
                    Icon::Pencil,
                    String::new(),
                    false,
                ),
                (
                    "Import STEP…",
                    FileCommand::DismissMenu,
                    Icon::Import,
                    String::new(),
                    true,
                ),
                (
                    "Export…",
                    FileCommand::DismissMenu,
                    Icon::Export,
                    String::new(),
                    true,
                ),
                (
                    "Settings…",
                    FileCommand::DismissMenu,
                    Icon::Settings,
                    String::new(),
                    true,
                ),
                (
                    "Close document",
                    FileCommand::Close,
                    Icon::Cancel,
                    format!("{primary}W"),
                    false,
                ),
                (
                    "Exit",
                    FileCommand::Exit,
                    Icon::Cancel,
                    String::new(),
                    false,
                ),
            ]
            .into_iter()
            .enumerate()
            {
                let y = 33. + i as f32 * 29.;
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    format!("file-item-{i}"),
                    label.into(),
                    None,
                    command,
                    node(8., y, 248., 28.),
                    Some("file-menu"),
                    61,
                    None,
                    disabled,
                )?;
                state.chrome.glyph(
                    world,
                    camera,
                    &format!("file-icon-{i}"),
                    node(16., y + 7., 14., 14.),
                    icon,
                    if disabled { theme.edge } else { theme.mute },
                    62,
                );
                state.chrome.text(
                    world,
                    camera,
                    &format!("file-shortcut-{i}"),
                    node(188., y + 7., 58., 14.),
                    &shortcut,
                    10.,
                    62,
                );
            }
            // A real transparent backdrop dismisses the menu, including through MCP.
            let key = "file-backdrop".to_owned();
            live.insert(key.clone());
            let entity = if let Some((entity, _)) = state.controls.get(&key) {
                *entity
            } else {
                let mut control = InterfaceControl::button("file-menu", "Close File menu");
                control.modal_scope = Some("file-menu".into());
                let entity = world
                    .spawn((
                        control,
                        node(0., 28., width, height - 28.),
                        UiTargetCamera(camera),
                        ZIndex(59),
                    ))
                    .id();
                bind_command(world, entity, NativeCommand::File(FileCommand::DismissMenu))?;
                state
                    .controls
                    .insert(key, (entity, FileCommand::DismissMenu));
                entity
            };
            world
                .entity_mut(entity)
                .insert(node(0., 28., width, height - 28.));
        }
        if let Some(dialog) = &dialog {
            let w = 460_f32.min(width - 24.).max(120.);
            let x = (width - w) / 2.;
            let y = (height - 220.).max(0.) / 2.;
            let token = dialog.token;
            if let DialogKind::Rename(name) = &dialog.kind {
                let key = "rename-value".to_owned();
                live.insert(key.clone());
                let command = FileCommand::Name(token);
                let bounds = node(x + 16., y + 68., w - 32., 32.);
                let mut control = InterfaceControl::button("file-dialog", "Document name");
                control.modal_scope = Some("file-dialog".into());
                control.field = Field::Text {
                    value: name.clone(),
                    selection: None,
                    read_only: false,
                };
                let entity = if let Some((entity, _)) = state.controls.get(&key) {
                    *entity
                } else {
                    let entity = fields::spawn_text_field(
                        &mut world.commands(),
                        camera,
                        bounds.clone(),
                        control.clone(),
                        theme,
                        &assets,
                    )?;
                    world.flush();
                    bind_command(world, entity, NativeCommand::File(command.clone()))?;
                    state
                        .controls
                        .insert(key.clone(), (entity, command.clone()));
                    entity
                };
                if state.controls[&key].1 != command {
                    bind_command(world, entity, NativeCommand::File(command.clone()))?;
                    state.controls.get_mut(&key).unwrap().1 = command;
                }
                world.entity_mut(entity).insert((bounds, ZIndex(73)));
                world.get_mut::<InterfaceControl>(entity).unwrap().field = control.field;
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "rename-apply".into(),
                    "Rename document".into(),
                    Some("Rename"),
                    FileCommand::ApplyName(token),
                    node(x + w - 128., y + 173., 112., 30.),
                    Some("file-dialog"),
                    73,
                    None,
                    picker,
                )?;
            } else {
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "discard".into(),
                    "Discard changes".into(),
                    Some("Discard"),
                    FileCommand::Discard(token),
                    node(x + w - 254., y + 173., 112., 30.),
                    Some("file-dialog"),
                    73,
                    None,
                    picker,
                )?;
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "save-continue".into(),
                    "Save and continue".into(),
                    Some("Save"),
                    FileCommand::SaveContinue(token),
                    node(x + w - 128., y + 173., 112., 30.),
                    Some("file-dialog"),
                    73,
                    None,
                    picker,
                )?;
            }
            button(
                world,
                &mut state,
                &mut live,
                camera,
                theme,
                &assets,
                "cancel-file".into(),
                "Cancel File operation".into(),
                Some("Cancel"),
                FileCommand::Cancel(token),
                node(x + 16., y + 173., 112., 30.),
                Some("file-dialog"),
                73,
                None,
                picker,
            )?;
        }
        let mut scripts = InterfaceControl::button("document/session", "Scripts");
        scripts.disabled = true;
        state.chrome.button(
            world,
            camera,
            "scripts",
            scripts,
            Some("Scripts"),
            NativeCommand::File(FileCommand::DismissMenu),
            node(width - 86., 0., 86., 28.),
            Some(interface_shell::ribbon::Icon::Book),
            42,
        )?;
        state.chrome.finish(world);
        state.controls.retain(|key, (entity, _)| {
            if live.contains(key) {
                true
            } else {
                world.despawn(*entity);
                false
            }
        });
        Ok(())
    })();
    world.insert_resource(state);
    result
}
