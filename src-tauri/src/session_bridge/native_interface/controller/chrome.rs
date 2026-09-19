//! Small retained chrome shared by native panels, menus and history.
//! This only paints and binds controls; document behavior stays in reducers.
use super::*;
use interface_shell::{
    compact_label,
    ribbon::{self, Icon},
    InterfaceCaption, InterfaceOccluder,
};
use std::collections::HashSet;

#[derive(Default)]
pub(super) struct Widgets {
    controls: HashMap<String, (Entity, NativeCommand, Option<Icon>)>,
    decoration: HashMap<String, Entity>,
    live: HashSet<String>,
}
pub(super) fn rect(x: f32, y: f32, w: f32, h: f32) -> Node {
    Node {
        position_type: PositionType::Absolute,
        left: px(x),
        top: px(y),
        width: px(w.max(0.)),
        height: px(h.max(0.)),
        align_items: AlignItems::Center,
        border_radius: BorderRadius::all(px(3.)),
        overflow: Overflow::clip(),
        ..default()
    }
}
impl Widgets {
    pub(super) fn begin(&mut self) {
        self.live.clear();
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn button(
        &mut self,
        world: &mut World,
        camera: Entity,
        key: &str,
        mut control: InterfaceControl,
        caption: Option<&str>,
        command: NativeCommand,
        bounds: Node,
        icon: Option<Icon>,
        z: i32,
    ) -> Result<Entity, String> {
        self.live.insert(key.into());
        let assets = world.resource::<ViewportUiAssets>().clone();
        let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
        let entity = if let Some((entity, _, _)) = self.controls.get(key) {
            *entity
        } else {
            let entity = spawn_button(
                &mut world.commands(),
                camera,
                bounds.clone(),
                control.clone(),
                theme,
                &assets,
            );
            world.flush();
            bind_command(world, entity, command.clone())?;
            compact_label(
                world,
                entity,
                if caption == Some("") {
                    0.
                } else if icon.is_some() {
                    24.
                } else {
                    8.
                },
            );
            if let Some(icon) = icon {
                ribbon::compact_glyph(world, entity, icon, 4., 13.);
            }
            self.controls
                .insert(key.into(), (entity, command.clone(), icon));
            entity
        };
        let entry = self.controls.get_mut(key).unwrap();
        if entry.1 != command {
            bind_command(world, entity, command.clone())?;
            entry.1 = command;
        }
        if entry.2 != icon {
            if let Some(icon) = icon {
                ribbon::replace_compact_glyph(world, entity, icon);
            }
            entry.2 = icon;
        }
        control.binding = world.get::<InterfaceControl>(entity).unwrap().binding;
        if world.get::<InterfaceControl>(entity) != Some(&control) {
            world.entity_mut(entity).insert(control.clone());
        }
        let caption = InterfaceCaption(caption.unwrap_or(&control.label).into());
        if world.get::<InterfaceCaption>(entity) != Some(&caption) {
            world.entity_mut(entity).insert(caption);
        }
        if world.get::<Node>(entity) != Some(&bounds) {
            world.entity_mut(entity).insert(bounds);
        }
        if world.get::<ZIndex>(entity) != Some(&ZIndex(z)) {
            world.entity_mut(entity).insert(ZIndex(z));
        }
        Ok(entity)
    }
    pub(super) fn backdrop(
        &mut self,
        world: &mut World,
        camera: Entity,
        key: &str,
        scope: &str,
        command: NativeCommand,
        bounds: Node,
        z: i32,
    ) -> Result<(), String> {
        self.live.insert(key.into());
        let entity = if let Some((entity, _, _)) = self.controls.get(key) {
            *entity
        } else {
            let mut control = InterfaceControl::button(
                scope,
                if scope.ends_with("menu") {
                    "Close menu"
                } else {
                    "Close dialog"
                },
            );
            control.modal_scope = Some(scope.into());
            let entity = world
                .spawn((control, UiTargetCamera(camera), bounds.clone(), ZIndex(z)))
                .id();
            bind_command(world, entity, command.clone())?;
            self.controls.insert(key.into(), (entity, command, None));
            entity
        };
        if world.get::<Node>(entity) != Some(&bounds) {
            world.entity_mut(entity).insert(bounds);
        }
        Ok(())
    }
    pub(super) fn panel(
        &mut self,
        world: &mut World,
        camera: Entity,
        key: &str,
        bounds: Node,
        color: Color,
        z: i32,
    ) {
        self.live.insert(key.into());
        let entity = *self.decoration.entry(key.into()).or_insert_with(|| {
            world
                .spawn((UiTargetCamera(camera), InterfaceOccluder))
                .id()
        });
        if world.get::<Node>(entity) != Some(&bounds) {
            world.entity_mut(entity).insert(bounds);
        }
        if world.get::<BackgroundColor>(entity) != Some(&BackgroundColor(color)) {
            world.entity_mut(entity).insert(BackgroundColor(color));
        }
        if world.get::<ZIndex>(entity) != Some(&ZIndex(z)) {
            world.entity_mut(entity).insert(ZIndex(z));
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn text(
        &mut self,
        world: &mut World,
        camera: Entity,
        key: &str,
        bounds: Node,
        value: &str,
        size: f32,
        z: i32,
    ) {
        self.live.insert(key.into());
        let entity = *self.decoration.entry(key.into()).or_insert_with(|| {
            let assets = world.resource::<ViewportUiAssets>().clone();
            let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
            world
                .spawn((
                    UiTargetCamera(camera),
                    Text::default(),
                    theme.text(&assets, size, FontWeight::NORMAL),
                    TextColor(theme.ink),
                ))
                .id()
        });
        if world.get::<Text>(entity).is_none_or(|text| text.0 != value) {
            world.entity_mut(entity).insert(Text::new(value));
        }
        if world.get::<Node>(entity) != Some(&bounds) {
            world.entity_mut(entity).insert(bounds);
        }
        if world.get::<ZIndex>(entity) != Some(&ZIndex(z)) {
            world.entity_mut(entity).insert(ZIndex(z));
        }
    }
    pub(super) fn finish(&mut self, world: &mut World) {
        self.controls.retain(|key, (entity, _, _)| {
            if self.live.contains(key) {
                true
            } else {
                world.despawn(*entity);
                false
            }
        });
        self.decoration.retain(|key, entity| {
            if self.live.contains(key) {
                true
            } else {
                world.despawn(*entity);
                false
            }
        });
    }
}
