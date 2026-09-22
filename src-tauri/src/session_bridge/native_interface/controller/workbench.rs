//! The 0.20 workbench: declarative tool groups, compact navigation and a
//! controlled Feathers number input. Commands still belong to the controller.
use super::*;
use bevy::scene as bevy_scene;

const GROUPS: &[(&str, &[&str])] = &[
    ("CREATE", &["extrude", "revolve", "sweep", "loft", "rib"]),
    (
        "MODIFY",
        &[
            "solid-fillet",
            "solid-chamfer",
            "solid-shell",
            "combine",
            "hole",
            "external-thread",
        ],
    ),
    ("CONSTRUCT", &["offset-plane", "midplane", "angle-plane"]),
    (
        "PATTERN",
        &[
            "solid-mirror",
            "split-body",
            "solid-rectangular-pattern",
            "solid-circular-pattern",
            "move-copy",
        ],
    ),
    ("ASSEMBLE", &["assembly", "joint"]),
];

#[derive(Resource)]
struct Workbench {
    ribbon: Entity,
    groups: Vec<Entity>,
    navigation: Entity,
}

pub(super) fn tool_node() -> Node {
    let mut node = interface_shell::ribbon::node(0., 0., 48.);
    node.position_type = PositionType::Relative;
    node.left = Val::Auto;
    node.top = Val::Auto;
    node.width = Val::Auto;
    node.min_width = px(0.);
    node.flex_basis = px(0.);
    node.flex_grow = 1.;
    node
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
) -> Result<(), String> {
    let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
    let assets = world.resource::<ViewportUiAssets>().clone();
    if !world.contains_resource::<Workbench>() {
        // BSN builds the retained group hierarchy. Flex layout distributes the
        // actual controls, so a narrow window cannot drop the last tools.
        let ribbon = world
            .spawn_scene(bsn! {
                Node {
                    position_type: PositionType::Absolute,
                    left: px(100), top: px(38), right: px(12), height: px(74),
                    column_gap: px(10),
                }
                ~{UiTargetCamera(camera)}
                ZIndex(30)
            })
            .map_err(|e| e.to_string())?
            .id();
        let mut groups = Vec::new();
        for (title, keys) in GROUPS {
            let group = world
                .spawn_scene(bsn! {
                    Node {
                        flex_grow: {keys.len() as f32}, flex_basis: px(0), min_width: px(0),
                        flex_direction: FlexDirection::Column,
                        row_gap: px(5),
                        border: UiRect::left(px(1)), padding: UiRect::left(px(8)),
                    }
                    ~{BorderColor::all(theme.edge)}
                    Children [
                        Node { height: px(54), column_gap: px(2), width: percent(100) }
                        --
                        Text({*title})
                        TextFont { font_size: bevy::text::FontSize::Px(9.) }
                        TextColor({theme.mute})
                        bevy::text::LetterSpacing::Px(1.)
                    ]
                })
                .map_err(|e| e.to_string())?
                .id();
            let row = world.get::<Children>(group).unwrap()[0];
            let caption = world.get::<Children>(group).unwrap()[1];
            world
                .entity_mut(caption)
                .insert(theme.text(&assets, 9., FontWeight::SEMIBOLD));
            world.entity_mut(ribbon).add_child(group);
            groups.push(row);
        }
        let navigation = world
            .spawn_scene(bsn! {
                Node { border_radius: BorderRadius::all(px(9)), border: UiRect::all(px(1)) }
                ~{UiTargetCamera(camera)}
                ZIndex(25)
                BackgroundColor({theme.panel})
                ~{BorderColor::all(theme.edge)}
                ~{bevy::ui::BoxShadow::new(theme.shadow, px(0), px(4), px(0), px(16))}
                interface_shell::InterfaceOccluder
            })
            .map_err(|e| e.to_string())?
            .id();
        world.insert_resource(Workbench {
            ribbon,
            groups,
            navigation,
        });
    }
    let state = world.resource::<Workbench>();
    let (ribbon, groups, navigation) = (state.ribbon, state.groups.clone(), state.navigation);
    world.entity_mut(ribbon).insert(if sketch {
        Visibility::Hidden
    } else {
        Visibility::Inherited
    });
    for ((_, keys), group) in GROUPS.iter().zip(groups) {
        for key in *keys {
            let Some(&entity) = controls.get(*key) else {
                continue;
            };
            if world.get::<ChildOf>(entity).map(ChildOf::parent) != Some(group) {
                world.entity_mut(group).add_child(entity);
            }
        }
    }
    let nav_width = 434.;
    let x = side + ((width - side - nav_width) * 0.5).max(10.);
    let y = height - 120.;
    let mut node = chrome::rect(x - 6., y - 5., nav_width + 12., 40.);
    node.border_radius = BorderRadius::all(px(9.));
    node.border = UiRect::all(px(1));
    world.entity_mut(navigation).insert(node);
    for (i, key) in ["undo", "redo", "fit", "isometric", "front", "top", "clear"]
        .iter()
        .enumerate()
    {
        if let Some(&entity) = controls.get(*key) {
            let mut node = chrome::rect(x + i as f32 * 62., y, 60., 30.);
            node.justify_content = JustifyContent::Center;
            node.border_radius = BorderRadius::all(px(5.));
            world
                .entity_mut(entity)
                .insert((node, interface_shell::InterfaceFlat));
            interface_shell::caption_size(world, entity, 11.);
            let caption = match *key {
                "isometric" => "Iso",
                "clear" => "Clear",
                _ => continue,
            };
            world
                .entity_mut(entity)
                .insert(interface_shell::InterfaceCaption(caption.into()));
        }
    }
    interface_shell::studio::synchronize(world, camera, owner, width, height)?;
    Ok(())
}
