//! Native workbench chrome follows the same command catalog and proportions
//! as React. Retained controls keep the normal document/binding guards.
use super::*;
use chrome::{rect, Widgets};
use interface_shell::ribbon::{self, Icon};

#[derive(Resource, Default)]
pub(crate) struct NavigationRectangle(pub Option<InterfaceRect>);

mod ribbon_menu;
#[cfg(test)]
mod tests;
mod viewport;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum NavigationTool {
    #[default]
    Select,
    Orbit,
    Pan,
    Zoom,
    ZoomWindow,
}
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Command {
    Menu(String),
    Dismiss,
    Navigation(NavigationTool),
}
#[derive(Resource, Default)]
struct Workbench {
    owner: Option<DocumentContext>,
    menu: Option<String>,
    menu_x: f32,
    navigation: NavigationTool,
    sketch: bool,
    dial: Option<InterfaceRect>,
    widgets: Widgets,
    axes: Option<Entity>,
}

pub(crate) fn modal(world: &World) -> Option<&'static str> {
    world
        .get_resource::<Workbench>()
        .and_then(|s| s.menu.as_ref())
        .map(|_| "workbench-menu")
}
pub(crate) fn escape(world: &mut World) {
    if let Some(mut state) = world.get_resource_mut::<Workbench>() {
        state.menu = None;
    }
}
pub(crate) fn navigation(world: &World) -> NavigationTool {
    world
        .get_resource::<Workbench>()
        .map_or(NavigationTool::Select, |s| s.navigation)
}
pub(crate) fn dial(world: &World) -> Option<InterfaceRect> {
    world.get_resource::<Workbench>().and_then(|s| s.dial)
}
pub(crate) fn dial_key(world: &World) -> Option<nbcad_interface::ControlKey> {
    world
        .get_resource::<Workbench>()
        .and_then(|s| s.axes)
        .map(|e| nbcad_interface::ControlKey(e.to_bits()))
}
pub(crate) fn execute(world: &mut World, command: &Command) -> Result<Value, String> {
    world.init_resource::<Workbench>();
    let mut state = world.resource_mut::<Workbench>();
    match command {
        Command::Menu(menu) => {
            state.menu = (state.menu.as_ref() != Some(menu)).then(|| menu.clone())
        }
        Command::Dismiss => state.menu = None,
        Command::Navigation(tool) => {
            state.navigation = if state.navigation == *tool {
                NavigationTool::Select
            } else {
                *tool
            };
            state.menu = None;
        }
    }
    Ok(json!({"handled":true}))
}

pub(super) fn tool_node() -> Node {
    ribbon::node(0., 0., 48.)
}

fn centered_button(
    widgets: &mut Widgets,
    world: &mut World,
    camera: Entity,
    key: &str,
    label: &str,
    caption: &str,
    command: NativeCommand,
    mut bounds: Node,
    selected: Option<bool>,
    disabled: bool,
    z: i32,
) -> Result<Entity, String> {
    let mut control = InterfaceControl::button("document/session", label);
    control.selected = selected;
    control.disabled = disabled;
    bounds.justify_content = JustifyContent::Center;
    let entity = widgets.button(
        world,
        camera,
        key,
        control,
        Some(caption),
        command,
        bounds,
        None,
        z,
    )?;
    if world.get::<ribbon::RibbonButton>(entity).is_none() {
        interface_shell::center_caption(world, entity);
        interface_shell::caption_size(world, entity, 10.);
    }
    Ok(entity)
}

pub(super) fn card(
    widgets: &mut Widgets,
    world: &mut World,
    camera: Entity,
    key: &str,
    mut bounds: Node,
    fill: Color,
    radius: f32,
    z: i32,
) {
    let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
    bounds.border = UiRect::all(px(1.));
    bounds.border_radius = BorderRadius::all(px(radius));
    widgets.panel(world, camera, key, bounds, fill, z);
    if let Some(entity) = widgets.entity(key) {
        world
            .entity_mut(entity)
            .insert(BorderColor::all(theme.edge));
    }
}

pub(super) fn synchronize(
    world: &mut World,
    camera: Entity,
    controls: &HashMap<String, Entity>,
    width: f32,
    height: f32,
    side: f32,
    sketch: bool,
    owner: &DocumentContext,
    services: &NativeServices,
) -> Result<(), String> {
    let mut state = world.remove_resource::<Workbench>().unwrap_or_default();
    let result = (|| {
        if state.owner.as_ref() != Some(owner) {
            state.menu = None;
            state.navigation = NavigationTool::Select;
            state.owner = Some(owner.clone());
        }
        if sketch != state.sketch {
            state.navigation = NavigationTool::Select;
            state.sketch = sketch;
        }
        if sketch
            && state
                .menu
                .as_deref()
                .is_some_and(|menu| menu != "workspace")
        {
            state.menu = None;
        }
        if files::modal(world).is_some() || history::modal(world).is_some() {
            state.menu = None;
        }
        state.widgets.begin();
        ribbon_menu::synchronize(world, camera, controls, width, sketch, services, &mut state)?;
        viewport::synchronize(world, camera, controls, width, height, side, &mut state)?;
        state.widgets.finish(world);
        Ok(())
    })();
    world.insert_resource(state);
    result
}
