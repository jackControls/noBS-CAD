//! Retained File menu, project tabs and owned confirmation/name dialogs.
use super::*;
use crate::native_viewport::interface_shell::{fields, InterfaceCaption, InterfaceOccluder};
use crate::{app_preferences::locale as dictionary, native_viewport::localization};
use bevy::text::{LetterSpacing, LineHeight};
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
    if key.starts_with("tab-") {
        // Long document names must stay inside their slot, clear of Close.
        bounds.overflow = Overflow::clip();
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
    control.expanded = (key == "file").then_some(scope.is_some());
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
        interface_shell::compact_label(world, entity, 34.);
        interface_shell::control_colors(
            world,
            entity,
            if selected == Some(true) {
                theme.ink
            } else {
                theme.mute
            },
            if selected == Some(true) {
                theme.panel
            } else {
                theme.header
            },
        );
    } else if key.starts_with("file-item-") {
        interface_shell::compact_label(world, entity, 34.);
        interface_shell::caption_size(world, entity, 11.);
    } else {
        if scope != Some("file-dialog") {
            world
                .entity_mut(entity)
                .insert(interface_shell::InterfaceFlat);
        }
        interface_shell::center_caption(world, entity);
        interface_shell::caption_size(world, entity, if key == "new" { 14. } else { 11. });
        if matches!(key.as_str(), "rename-apply" | "save-continue") {
            interface_shell::primary_button(world, entity);
        }
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
    let theme = crate::native_viewport::ui::theme(world);
    let locale = localization::locale(world);
    let t = |key| dictionary::translate(locale, key);
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
            node(27.5, 10.5, 7., 7.),
            interface_shell::ribbon::Icon::ChevronDown,
            theme.mute,
            66,
        );
        // The product mark is decorative; the complete 40px File button
        // remains the single keyboard, pointer and accessibility target.
        let mut badge = node(5.5, 6., 20., 16.);
        badge.border = UiRect::all(px(1.));
        state.chrome.panel(
            world,
            camera,
            "product-mark",
            badge,
            theme.accent.with_alpha(0.1),
            66,
        );
        world
            .entity_mut(state.chrome.entity("product-mark").unwrap())
            .remove::<InterfaceOccluder>()
            .insert(BorderColor::all(theme.accent.with_alpha(0.4)));
        state.chrome.text(
            world,
            camera,
            "product-mark-text",
            node(5.5, 10., 20., 8.),
            "NB",
            7.,
            67,
        );
        world
            .entity_mut(state.chrome.entity("product-mark-text").unwrap())
            .insert((
                theme.text(&assets, 7., FontWeight::BLACK),
                TextColor(theme.accent),
                TextLayout::justify(Justify::Center),
                LineHeight::Px(8.),
                LetterSpacing::Px(-0.56),
            ));
        let layout = format!(
            "{width}:{height}:{menu}:{:?}:{}:{locale:?}",
            dialog,
            crate::native_viewport::ui::appearance_revision(world)
        );
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
                let row_height = ((height - 132.) / 18.).clamp(24., 32.);
                let mut menu_bounds = node(6., 28., 256., 90. + 18. * row_height);
                menu_bounds.border = UiRect::all(px(1.));
                rectangle(
                    world,
                    &mut state,
                    camera,
                    menu_bounds,
                    theme.panel.with_alpha(1.),
                    60,
                );
                world.entity_mut(*state.decoration.last().unwrap()).insert((
                    BorderColor::all(theme.edge),
                    bevy::ui::BoxShadow::new(
                        Color::BLACK.with_alpha(0.5),
                        px(0.),
                        px(10.),
                        px(-5.),
                        px(25.),
                    ),
                ));
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
                let mut dialog_bounds = node(x, y, w, 220.);
                dialog_bounds.border = UiRect::all(px(2.));
                dialog_bounds.border_radius = BorderRadius::all(px(14.));
                rectangle(
                    world,
                    &mut state,
                    camera,
                    dialog_bounds,
                    theme.header.with_alpha(1.),
                    71,
                );
                world.entity_mut(*state.decoration.last().unwrap()).insert((
                    BorderColor::all(theme.accent.with_alpha(0.78)),
                    bevy::ui::BoxShadow::new(
                        theme.dialog_shadow, px(0.), px(18.), px(0.), px(48.),
                    ),
                ));
                let title = match dialog.kind {
                    DialogKind::Rename(_) => t("file.rename"),
                    DialogKind::Confirm(_) => t("file.unsaved"),
                    DialogKind::Export(_) => t("meshExport.title"),
                    DialogKind::Profile(_) => t("drawing.workspace.exportManufacturingProfile"),
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
                if let DialogKind::Confirm(intent) = &dialog.kind {
                    let name = tabs
                        .iter()
                        .find(|t| t.active)
                        .map(|t| t.name.as_str())
                        .unwrap_or_else(|| t("app.untitledDocument"));
                    let prompt = t(match intent {
                        Intent::Close => "file.closeSaveConfirm",
                        Intent::Open(_) => "file.replaceSaveConfirm",
                        Intent::Exit => "file.quitSaveConfirm",
                    });
                    text(
                        world,
                        &mut state,
                        camera,
                        node(x + 16., y + 46., w - 32., 62.),
                        &format!("{name}\n{prompt}"),
                        theme,
                        &assets,
                        72,
                        false,
                    );
                } else if matches!(dialog.kind, DialogKind::Rename(_)) {
                    text(
                        world,
                        &mut state,
                        camera,
                        node(x + 16., y + 43., w - 32., 20.),
                        t("file.renamePrompt"),
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
            t("file.menu").into(),
            Some(""),
            FileCommand::Menu,
            node(0., 0., 40., 28.),
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
            t("topbar.newDesign").into(),
            Some("+"),
            FileCommand::New,
            node(40., 0., 28., 28.),
            None,
            42,
            None,
            picker,
        )?;
        // Left file controls, the MCP chip, tab arrows, and Scripts.
        let available = ((width - 286.) / 192.).floor().max(1.) as usize;
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
                node(x + 12., 10., 10., 10.),
                interface_shell::ribbon::Icon::Box,
                if tab.active { theme.accent } else { theme.mute },
                44,
            );
            let mut dot = node(x + 28., 12., 6., 6.);
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
                        t("topbar.closeDocument").into()
                    } else {
                        format!("{}: {}", t("topbar.closeDocument"), tab.name)
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
                    t("file.previousDocument").into(),
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
                    t("file.nextDocument").into(),
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
            let geometry = native_viewport::interface_geometry(world);
            let export_disabled =
                geometry.scene.bodies.is_empty() || !geometry.scene.errors.is_empty();
            let selected_disabled = export_disabled
                || native_viewport::interface_view_snapshot(world)
                    .2
                    .selected_body_ids
                    .is_empty();
            let drawing = services.engine.drawing_snapshot();
            let drawing_disabled = !drawing
                .sheets
                .iter()
                .any(|sheet| Some(sheet.id) == drawing.active_sheet_id)
                || !geometry.scene.errors.is_empty();
            let row_height = ((height - 132.) / 18.).clamp(24., 32.);
            let primary = if cfg!(target_os = "macos") {
                "⌘"
            } else {
                "Ctrl+"
            };
            let mut y = 33.;
            for (i, (label_key, command, icon, shortcut, disabled)) in [
                (
                    "file.open",
                    FileCommand::Open,
                    Icon::FolderOpen,
                    format!("{primary}O"),
                    false,
                ),
                (
                    "topbar.openScript",
                    FileCommand::DismissMenu,
                    Icon::Book,
                    String::new(),
                    true,
                ),
                (
                    "file.save",
                    FileCommand::Save,
                    Icon::Save,
                    format!("{primary}S"),
                    false,
                ),
                (
                    "file.saveAs",
                    FileCommand::SaveAs,
                    Icon::Export,
                    format!(
                        "{}{primary}S",
                        if cfg!(target_os = "macos") {
                            "⇧"
                        } else {
                            "Shift+"
                        }
                    ),
                    false,
                ),
                (
                    "file.rename",
                    FileCommand::Rename,
                    Icon::Pencil,
                    String::new(),
                    false,
                ),
                (
                    "file.importStep",
                    FileCommand::ImportStep,
                    Icon::Import,
                    String::new(),
                    false,
                ),
                (
                    "file.exportStepAll",
                    FileCommand::Export(io::Format::Step, false),
                    Icon::Box,
                    String::new(),
                    export_disabled,
                ),
                (
                    "file.exportStepSelected",
                    FileCommand::Export(io::Format::Step, true),
                    Icon::Box,
                    String::new(),
                    selected_disabled,
                ),
                (
                    "file.export3mfAll",
                    FileCommand::Export(io::Format::ThreeMf, false),
                    Icon::Export,
                    String::new(),
                    export_disabled,
                ),
                (
                    "file.export3mfSelected",
                    FileCommand::Export(io::Format::ThreeMf, true),
                    Icon::Export,
                    String::new(),
                    selected_disabled,
                ),
                (
                    "file.exportStlAll",
                    FileCommand::Export(io::Format::Stl, false),
                    Icon::Export,
                    String::new(),
                    export_disabled,
                ),
                (
                    "file.exportStlSelected",
                    FileCommand::Export(io::Format::Stl, true),
                    Icon::Export,
                    String::new(),
                    selected_disabled,
                ),
                (
                    "file.exportManufacturingProfileDxf",
                    FileCommand::ExportProfile,
                    Icon::Export,
                    String::new(),
                    false,
                ),
                (
                    "file.exportDrawingDxf",
                    FileCommand::ExportDrawing(drawing_output::Format::Dxf),
                    Icon::Export,
                    String::new(),
                    drawing_disabled,
                ),
                (
                    "file.exportDrawingSvg",
                    FileCommand::ExportDrawing(drawing_output::Format::Svg),
                    Icon::Export,
                    String::new(),
                    drawing_disabled,
                ),
                (
                    "drawing.workspace.printSaveAsPdf",
                    FileCommand::PrintDrawing,
                    Icon::Export,
                    format!("{primary}P"),
                    drawing_disabled,
                ),
                (
                    "topbar.settings",
                    FileCommand::ShowSettings,
                    Icon::Settings,
                    String::new(),
                    false,
                ),
                (
                    "file.exit",
                    FileCommand::Exit,
                    Icon::Cancel,
                    String::new(),
                    false,
                ),
            ]
            .into_iter()
            .enumerate()
            {
                if matches!(i, 5 | 6 | 12 | 16) {
                    state.chrome.panel(
                        world,
                        camera,
                        &format!("file-separator-{i}"),
                        node(7., y + 4., 254., 1.),
                        theme.edge,
                        61,
                    );
                    y += 9.;
                }
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    format!("file-item-{i}"),
                    t(label_key).into(),
                    Some(t(label_key)),
                    command,
                    node(7., y, 254., row_height),
                    Some("file-menu"),
                    61,
                    None,
                    disabled,
                )?;
                state.chrome.glyph(
                    world,
                    camera,
                    &format!("file-icon-{i}"),
                    node(19., y + (row_height - 14.) / 2., 14., 14.),
                    icon,
                    if disabled { theme.edge } else { theme.mute },
                    62,
                );
                if !shortcut.is_empty() {
                    state.chrome.text(
                        world,
                        camera,
                        &format!("file-shortcut-{i}"),
                        node(191., y + (row_height - 14.) / 2., 58., 14.),
                        &shortcut,
                        10.,
                        62,
                    );
                    world
                        .entity_mut(state.chrome.entity(&format!("file-shortcut-{i}")).unwrap())
                        .insert((TextLayout::justify(Justify::Right), TextColor(theme.mute)));
                }
                y += row_height;
            }
            state.chrome.panel(
                world,
                camera,
                "file-footer-edge",
                node(7., y + 4., 254., 1.),
                theme.edge,
                61,
            );
            state.chrome.text(
                world,
                camera,
                "file-footer",
                node(19., y + 13., 230., 32.),
                t("file.zipHint"),
                9.,
                62,
            );
            world
                .entity_mut(state.chrome.entity("file-footer").unwrap())
                .insert(TextColor(theme.mute));
            // A real transparent backdrop dismisses the menu, including through MCP.
            let key = "file-backdrop".to_owned();
            live.insert(key.clone());
            let entity = if let Some((entity, _)) = state.controls.get(&key) {
                *entity
            } else {
                let mut control = InterfaceControl::button("file-menu", t("file.closeMenu"));
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
            if let Some(mut control) = world.get_mut::<InterfaceControl>(entity) {
                let label = t("file.closeMenu");
                if control.label != label {
                    control.label = label.into();
                }
            }
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
                let mut control = InterfaceControl::button("file-dialog", t("file.renamePrompt"));
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
                // Locale changes relabel the retained editor without changing
                // its binding/baseline or discarding uncommitted native text.
                {
                    let mut existing = world.get_mut::<InterfaceControl>(entity).unwrap();
                    existing.field = control.field;
                    existing.label = control.label;
                }
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "rename-apply".into(),
                    t("file.rename").into(),
                    Some(t("file.rename")),
                    FileCommand::ApplyName(token),
                    node(x + w - 128., y + 173., 112., 30.),
                    Some("file-dialog"),
                    73,
                    None,
                    picker,
                )?;
            } else if let DialogKind::Profile(selection) = &dialog.kind {
                let selected = &selection.choices[selection.selected];
                let mut control = InterfaceControl::button("file-dialog", t("file.manufacturingProfile"));
                control.role = "combobox".into();
                control.modal_scope = Some("file-dialog".into());
                control.disabled = picker;
                control.owned_keys = [
                    "ArrowUp",
                    "ArrowDown",
                    "ArrowLeft",
                    "ArrowRight",
                    "Home",
                    "End",
                ]
                .map(nbcad_interface::KeyChord::plain)
                .into();
                control.field = Field::Choice {
                    value: selected.key(),
                    options: selection
                        .choices
                        .iter()
                        .map(|item| nbcad_interface::ChoiceOption {
                            value: item.key(),
                            label: item.label(),
                            disabled: false,
                        })
                        .collect(),
                };
                state.chrome.button(
                    world,
                    camera,
                    "profile-choice",
                    control,
                    Some(&selected.label()),
                    NativeCommand::File(FileCommand::ProfileSelect(token)),
                    node(x + 16., y + 46., w - 32., 30.),
                    None,
                    73,
                )?;
                if dialog.error.is_none() {
                    state.chrome.text(
                        world,
                        camera,
                        "profile-units",
                        node(x + 16., y + 87., w - 32., 72.),
                        t("drawing.workspace.exportManufacturingProfileHint"),
                        11.,
                        73,
                    );
                }
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "profile-continue".into(),
                    t("meshExport.continue").into(),
                    Some(t("meshExport.continue")),
                    FileCommand::ApplyProfile(token),
                    node(x + w - 128., y + 173., 112., 30.),
                    Some("file-dialog"),
                    73,
                    None,
                    picker,
                )?;
            } else if let DialogKind::Export(intent) = &dialog.kind {
                for (index, (scope, label_key)) in [
                    (
                        nbcad_export::MeshExportScope::Assembly,
                        "meshExport.assembly",
                    ),
                    (
                        nbcad_export::MeshExportScope::Definition,
                        "meshExport.definition",
                    ),
                ]
                .into_iter()
                .enumerate()
                {
                    button(
                        world,
                        &mut state,
                        &mut live,
                        camera,
                        theme,
                        &assets,
                        format!("export-scope-{index}"),
                        t(label_key).into(),
                        Some(t(label_key)),
                        FileCommand::ExportScope(token, scope),
                        node(x + 16., y + 46. + index as f32 * 34., w - 32., 30.),
                        Some("file-dialog"),
                        73,
                        Some(intent.scope == scope),
                        picker,
                    )?;
                }
                if dialog.error.is_none() {
                    let export_description = if intent.format == io::Format::Stl {
                        "STL uses millimetres; colours and materials are not included.".into()
                    } else {
                        format!(
                            "3MF uses millimetres and includes body appearance. Target: {}.",
                            body_appearance::preferences::label(intent.slicer_target)
                        )
                    };
                    state.chrome.text(
                        world,
                        camera,
                        "export-units",
                        node(x + 16., y + 120., w - 32., 40.),
                        &export_description,
                        11.,
                        73,
                    );
                }
                button(
                    world,
                    &mut state,
                    &mut live,
                    camera,
                    theme,
                    &assets,
                    "export-continue".into(),
                    t("meshExport.continue").into(),
                    Some(t("meshExport.continue")),
                    FileCommand::ApplyExport(token),
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
                    t("file.discard").into(),
                    Some(t("file.discard")),
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
                    t("file.save").into(),
                    Some(t("file.save")),
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
                t("file.cancel").into(),
                Some(t("file.cancel")),
                FileCommand::Cancel(token),
                node(x + 16., y + 173., 112., 30.),
                Some("file-dialog"),
                73,
                None,
                picker,
            )?;
        }
        let presence = nbcad_mcp::desktop_mcp_presence();
        let (mcp_label, mcp_selected) = match presence {
            nbcad_mcp::DesktopMcpPresence::Attached => ("MCP attached", Some(true)),
            nbcad_mcp::DesktopMcpPresence::Waiting => ("MCP waiting", None),
            nbcad_mcp::DesktopMcpPresence::Off => ("MCP off", None),
        };
        let mut mcp = InterfaceControl::button("document/session", mcp_label);
        mcp.role = "status".into();
        mcp.selected = mcp_selected;
        state.chrome.button(
            world,
            camera,
            "mcp",
            mcp,
            Some("MCP"),
            NativeCommand::File(FileCommand::ReportMcp),
            node(width - 218., 0., 72., 28.),
            None,
            42,
        )?;
        let mut dot = node(width - 210., 11., 6., 6.);
        dot.border_radius = BorderRadius::all(px(3.));
        state.chrome.panel(
            world,
            camera,
            "mcp-dot",
            dot,
            match presence {
                nbcad_mcp::DesktopMcpPresence::Attached => theme.accent,
                nbcad_mcp::DesktopMcpPresence::Waiting => theme.mute,
                nbcad_mcp::DesktopMcpPresence::Off => theme.edge,
            },
            43,
        );
        let mut scripts = InterfaceControl::button("document/session", t("topbar.scripts"));
        scripts.selected = Some(world.resource::<Files>().scripts);
        state.chrome.button(
            world,
            camera,
            "scripts",
            scripts,
            Some(t("topbar.scripts")),
            NativeCommand::File(FileCommand::ShowScripts),
            node(width - 86., 0., 86., 28.),
            Some(interface_shell::ribbon::Icon::Book),
            42,
        )?;
        if world.resource::<Files>().scripts {
            paint_lessons(
                world, camera, &mut state, width, height, theme, services, owner,
            )?;
        }
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

fn paint_lessons(
    world: &mut World,
    camera: Entity,
    state: &mut Widgets,
    width: f32,
    viewport_height: f32,
    theme: ViewportUiTheme,
    services: &NativeServices,
    owner: &DocumentContext,
) -> Result<(), String> {
    let lessons = lessons::catalog();
    let blank = services.engine.is_blank_for_script();
    let files = world.resource::<Files>();
    let script_blocked = files.lesson.is_some()
        || files.script.loading()
        || files.script.preview.building()
        || worker::busy(world)
        || awaiting(world)
        || feature::panel(world).is_some()
        || native_viewport::interface_view_snapshot(world).2.mode
            == native_viewport::ViewportMode::Sketch;
    let blocked = script_blocked || !blank;
    if files.script.preview.open {
        return scripts::paint_preview(world, camera, &mut state.chrome, width, viewport_height, theme);
    }
    if files.script.chapters.open {
        return scripts::paint_chapters(world, camera, &mut state.chrome, width, viewport_height, theme, script_blocked);
    }
    if files.script.library.open {
        return scripts::paint_library(
            world,
            camera,
            &mut state.chrome,
            width,
            viewport_height,
            theme,
            script_blocked,
        );
    }
    if files.script.editor_open {
        return scripts::paint_source(
            world,
            camera,
            &mut state.chrome,
            width,
            viewport_height,
            theme,
            script_blocked,
        );
    }
    let loaded = files.script.loaded.clone();
    let script_path = files.script.path.clone();
    let script_generation = files.script.generation;
    let can_run = files.script.selected(script_generation).is_ok()
        && files.script.library.pending().is_none();
    let source_label = files.script.source_label();
    let has_file_path = files.script.source_path.is_some();
    let script_status = files.script.status.clone().unwrap_or_else(|| {
        "Opening a script does not run it. Run creates a separate design tab.".into()
    });
    let status = files
        .lesson_status
        .as_ref()
        .filter(|(context, _)| context == owner)
        .map(|(_, text)| text.clone())
        .unwrap_or_else(|| {
            if blank {
                "Choose a lesson to run".into()
            } else {
                "Use New document to run a lesson".into()
            }
        });
    let row = 40. + lessons.len() as f32 * 28.;
    let browse_y = row + if loaded.is_some() { 380. } else { 188. };
    let height = browse_y;
    state.chrome.panel(
        world,
        camera,
        "scripts-card",
        node(width - 300., 32., 280., height),
        theme.panel.with_alpha(1.),
        60,
    );
    for (index, lesson) in lessons.iter().enumerate() {
        let mut control = InterfaceControl::button("document/session", &lesson.name);
        control.disabled = blocked;
        state.chrome.button(
            world,
            camera,
            &format!("scripts-lesson-{index}"),
            control,
            Some(&lesson.name),
            NativeCommand::File(FileCommand::RunLesson(lesson.id.clone())),
            node(width - 288., 40. + index as f32 * 28., 256., 24.),
            None,
            61,
        )?;
    }
    state.chrome.text(
        world,
        camera,
        "scripts-status",
        node(width - 288., row + 4., 256., 44.),
        &status,
        11.,
        61,
    );
    for (key, label, command, y, disabled) in [
        (
            "scripts-open",
            "Open script...",
            FileCommand::OpenScript,
            row + 52.,
            script_blocked,
        ),
        (
            "scripts-load",
            "Load script",
            FileCommand::LoadScript,
            row + 112.,
            script_blocked || script_path.trim().is_empty(),
        ),
    ] {
        let mut control = InterfaceControl::button("document/scripts", label);
        control.disabled = disabled;
        state.chrome.button(
            world,
            camera,
            key,
            control,
            Some(label),
            NativeCommand::File(command),
            node(width - 288., y, 256., 24.),
            None,
            61,
        )?;
    }
    let mut path = InterfaceControl::button("document/scripts", "Script path");
    path.disabled = script_blocked;
    path.field = Field::Text {
        value: script_path,
        selection: None,
        read_only: script_blocked,
    };
    state.chrome.text(
        world,
        camera,
        "scripts-path-label",
        node(width - 288., row + 82., 40., 24.),
        "Path",
        11.,
        61,
    );
    state.chrome.button(
        world,
        camera,
        "scripts-path",
        path,
        None,
        NativeCommand::File(FileCommand::ScriptPath),
        node(width - 246., row + 82., 214., 24.),
        None,
        61,
    )?;
    state.chrome.text(
        world,
        camera,
        "scripts-file-status",
        Node {
            overflow: Overflow::clip(),
            ..node(width - 288., row + 144., 256., 44.)
        },
        &script_status,
        11.,
        61,
    );
    if let Some(loaded) = loaded {
        let summary = format!(
            "{}{}\n{} steps, {} checks",
            if can_run { "" } else { "Last validated: " },
            loaded.name,
            loaded.steps,
            loaded.checks
        );
        state.chrome.text(
            world,
            camera,
            "scripts-file-summary",
            Node {
                overflow: Overflow::clip(),
                ..node(width - 288., row + 192., 256., 44.)
            },
            &summary,
            11.,
            61,
        );
        let mut provenance = InterfaceControl::button(
            "document/scripts",
            if has_file_path {
                "Loaded script path"
            } else {
                "Loaded bundled source"
            },
        );
        provenance.field = Field::Text {
            value: source_label,
            selection: None,
            read_only: true,
        };
        state.chrome.text(
            world,
            camera,
            "scripts-loaded-label",
            node(width - 288., row + 240., 48., 24.),
            "Loaded",
            11.,
            61,
        );
        state.chrome.button(
            world,
            camera,
            "scripts-loaded-path",
            provenance,
            None,
            NativeCommand::File(FileCommand::ScriptPath),
            node(width - 238., row + 240., 206., 24.),
            None,
            61,
        )?;
        let mut source = InterfaceControl::button("document/scripts", "Inspect and edit source");
        source.disabled = script_blocked;
        state.chrome.button(
            world,
            camera,
            "scripts-edit",
            source,
            Some("Inspect / edit source"),
            NativeCommand::File(FileCommand::ShowScriptSource),
            node(width - 288., row + 276., 256., 24.),
            None,
            61,
        )?;
        let mut run = InterfaceControl::button("document/scripts", "Run in new design");
        scripts::paint_launch(world, camera, &mut state.chrome, width - 288., row + 308., 256., script_blocked)?;
        run.disabled = script_blocked || !can_run;
        state.chrome.button(
            world,
            camera,
            "scripts-run",
            run,
            Some("Run in new design"),
            NativeCommand::File(FileCommand::RunScript(script_generation)),
            node(width - 288., row + 344., 256., 28.),
            None,
            61,
        )?;
    }
    let mut browse = InterfaceControl::button("document/scripts", "Browse examples");
    browse.disabled = script_blocked;
    state.chrome.button(
        world,
        camera,
        "scripts-browse",
        browse,
        Some("Browse examples"),
        NativeCommand::File(FileCommand::BrowseExamples),
        node(width - 288., browse_y, 256., 26.),
        None,
        61,
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "panel/localization_tests.rs"]
mod localization_tests;

#[cfg(test)]
mod tests {
    #[test]
    fn lesson_catalog_lists_the_short_built_in_lessons() {
        let lessons = super::lessons::catalog();
        assert!(lessons
            .iter()
            .any(|lesson| lesson.name == "Sketch, extrude, ease the edges"));
        assert!(lessons.len() >= 4);
        assert!(lessons.iter().all(|lesson| !lesson.name.is_empty()));
    }
}
