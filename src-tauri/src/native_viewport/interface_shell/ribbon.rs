//! Original ribbon geometry and typography on retained native controls.
//! Both renderers consume the same SVG sources. Rust rasterizes each vector
//! once, then Bevy draws a cached texture; there is no webview here.
use super::*;
use bevy::{
    asset::RenderAssetUsages,
    render::render_resource::{Extent3d, TextureDimension, TextureFormat},
    text::{LetterSpacing, LineHeight},
};
use std::collections::HashMap;

#[derive(Component)]
pub(crate) struct RibbonButton {
    pub finish: bool,
    display_label: String,
}
impl RibbonButton {
    pub(super) fn fill(
        &self,
        theme: ViewportUiTheme,
        active: bool,
        hover: bool,
        disabled: bool,
    ) -> Color {
        if self.finish {
            return if hover && !disabled {
                Color::srgb(88. / 255. * 1.1, 166. / 255. * 1.1, 92. / 255. * 1.1)
            } else {
                Color::srgb_u8(88, 166, 92)
            };
        }
        if disabled {
            Color::NONE
        } else if active {
            // CSS composites opacity in sRGB; leaving alpha for Bevy's linear
            // framebuffer makes selected cells visibly brighter than the source.
            css_mix(theme.accent, theme.header, if hover { 0.30 } else { 0.25 })
        } else if hover {
            theme.edge.with_alpha(1.)
        } else {
            Color::NONE
        }
    }
    pub(super) fn ink(&self, theme: ViewportUiTheme, _disabled: bool) -> Color {
        // The original caption explicitly uses text-mute, including disabled cells.
        if self.finish {
            Color::WHITE
        } else {
            theme.mute
        }
    }
    pub(super) fn label(&self) -> &str {
        &self.display_label
    }
}

pub(super) fn css_mix(foreground: Color, background: Color, opacity: f32) -> Color {
    let fg = foreground.to_srgba();
    let bg = background.to_srgba();
    Color::srgb(
        fg.red * opacity + bg.red * (1. - opacity),
        fg.green * opacity + bg.green * (1. - opacity),
        fg.blue * opacity + bg.blue * (1. - opacity),
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Icon {
    Extrude,
    Revolve,
    Sweep,
    Loft,
    Rib,
    Sketch,
    Line,
    MidpointLine,
    Rectangle,
    Circle,
    Arc,
    Slot,
    Point,
    Spline,
    Finish,
    Cancel,
    Chevron,
    Box,
    Boxes,
    Anchor,
    Copy,
    FolderTree,
    Bookmark,
    Crosshair,
    Square,
    CircleDot,
    PenLine,
    Layers,
    Settings,
    ChevronRight,
    ChevronDown,
    Eye,
    EyeOff,
    Pencil,
    Globe,
    ArrowLeft,
    ArrowRight,
    ArrowLeftToLine,
    ArrowRightToLine,
    Trim,
    Extend,
    Break,
    Dimension,
    Select,
    Relation(&'static str),
    Offset,
    Fillet,
    Chamfer,
    Shell,
    ExternalThread,
    Hole,
    Combine,
    OffsetPlane,
    Midplane,
    AnglePlane,
    SplitBody,
    MoveCopy,
    Mirror,
    RectangularPattern,
    CircularPattern,
}
impl Icon {
    fn svg(self) -> &'static str {
        macro_rules! source {
            ($name:literal) => {
                include_str!(concat!(
                    "../../../../src/assets/ribbon-icons/",
                    $name,
                    ".svg"
                ))
            };
        }
        match self {
            Self::Extrude => source!("extrude"),
            Self::Revolve => source!("revolve"),
            Self::Sweep => source!("sweep"),
            Self::Loft => source!("loft"),
            Self::Rib => source!("rib"),
            Self::Sketch => source!("sketch"),
            Self::Line => source!("line"),
            Self::MidpointLine => source!("midpointLine"),
            Self::Rectangle => source!("rect"),
            Self::Circle => source!("circle"),
            Self::Arc => source!("arc"),
            Self::Slot => source!("slot"),
            Self::Point => source!("point"),
            Self::Spline => source!("spline"),
            Self::Finish => source!("finish"),
            Self::Cancel => source!("cancel"),
            Self::Chevron => source!("chevron"),
            Self::Box => source!("box"),
            Self::Boxes => source!("boxes"),
            Self::Anchor => source!("anchor"),
            Self::Copy => source!("copy"),
            Self::FolderTree => source!("folder-tree"),
            Self::Bookmark => source!("bookmark"),
            Self::Crosshair => source!("crosshair"),
            Self::Square => source!("square"),
            Self::CircleDot => source!("circle-dot"),
            Self::PenLine => source!("pen-line"),
            Self::Layers => source!("layers-3"),
            Self::Settings => source!("sliders-horizontal"),
            Self::ChevronRight => source!("chevron-right"),
            Self::ChevronDown => source!("chevron-down"),
            Self::Eye => source!("eye"),
            Self::EyeOff => source!("eye-off"),
            Self::Pencil => source!("pencil"),
            Self::Globe => source!("globe"),
            Self::ArrowLeft => source!("arrow-left"),
            Self::ArrowRight => source!("arrow-right"),
            Self::ArrowLeftToLine => source!("arrow-left-to-line"),
            Self::ArrowRightToLine => source!("arrow-right-to-line"),
            Self::Trim => source!("trim"),
            Self::Extend => source!("extend"),
            Self::Break => source!("break"),
            Self::Dimension => source!("dim"),
            Self::Select => source!("select"),
            Self::Offset => source!("offset"),
            Self::Fillet => source!("fillet"),
            Self::Chamfer => source!("chamfer"),
            Self::Shell => source!("shell"),
            Self::ExternalThread => source!("externalThread"),
            Self::Hole => source!("hole"),
            Self::Combine => source!("combine"),
            Self::OffsetPlane => source!("plane"),
            Self::Midplane => source!("midplane"),
            Self::AnglePlane => source!("planeAngle"),
            Self::SplitBody => source!("splitBody"),
            Self::MoveCopy => source!("moveCopy"),
            Self::Mirror => source!("mirror"),
            Self::RectangularPattern => source!("rectPattern"),
            Self::CircularPattern => source!("circPattern"),
            Self::Relation(name) => match name {
                "hv" => source!("hv"),
                "coincident" => source!("coincident"),
                "tangent" => source!("tangent"),
                "equal" => source!("equal"),
                "parallel" => source!("parallel"),
                "perpendicular" => source!("perpendicular"),
                "fix" => source!("fix"),
                "midpointC" => source!("midpointC"),
                "concentric" => source!("concentric"),
                "collinear" => source!("collinear"),
                "symmetry" => source!("symmetry"),
                _ => unreachable!("Known relation glyph"),
            },
        }
    }
}
#[derive(Resource, Default)]
pub(super) struct GlyphCache(HashMap<(Icon, u32), Handle<Image>>);

/// Rasterize at the actual physical widget size. A large texture minified
/// without mipmaps aliases fine strokes instead of improving their quality.
/// Color belongs to the widget, not to a separate raster for every state.
fn rasterize(icon: Icon, pixels: u32) -> Image {
    let source = icon.svg().replace("currentColor", "white");
    let tree = resvg::usvg::Tree::from_str(&source, &resvg::usvg::Options::default())
        .expect("validated built-in ribbon SVG");
    let mut pixmap = resvg::tiny_skia::Pixmap::new(pixels, pixels).unwrap();
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(pixels as f32 / 24., pixels as f32 / 24.),
        &mut pixmap.as_mut(),
    );
    let mut rgba = Vec::with_capacity((pixels * pixels * 4) as usize);
    for pixel in pixmap.pixels() {
        let pixel = pixel.demultiply();
        rgba.extend_from_slice(&[pixel.red(), pixel.green(), pixel.blue(), pixel.alpha()]);
    }
    Image::new(
        Extent3d {
            width: pixels,
            height: pixels,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        rgba,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    )
}
fn image(world: &mut World, icon: Icon, pixels: u32) -> Handle<Image> {
    world.init_resource::<Assets<Image>>();
    world.init_resource::<GlyphCache>();
    if let Some(image) = world.resource::<GlyphCache>().0.get(&(icon, pixels)) {
        return image.clone();
    }
    let image = world
        .resource_mut::<Assets<Image>>()
        .add(rasterize(icon, pixels));
    world
        .resource_mut::<GlyphCache>()
        .0
        .insert((icon, pixels), image.clone());
    image
}
#[derive(Component)]
pub(super) struct RibbonGlyph {
    owner: Entity,
    icon: Icon,
    ink: Color,
    disabled_ink: Color,
}
pub(super) fn update_glyphs(
    controls: Query<&InterfaceControl>,
    mut glyphs: Query<(&RibbonGlyph, &mut ImageNode, Option<&ComputedNode>)>,
    cache: Option<ResMut<GlyphCache>>,
    mut images: ResMut<Assets<Image>>,
) {
    let Some(mut cache) = cache else {
        return;
    };
    for (glyph, mut image, node) in &mut glyphs {
        if let Some(node) = node.filter(|node| node.size().x > 0.) {
            let pixels = (node.size().x.round() as u32).clamp(1, 512);
            let texture = cache
                .0
                .entry((glyph.icon, pixels))
                .or_insert_with(|| images.add(rasterize(glyph.icon, pixels)));
            if image.image != *texture {
                image.image = texture.clone();
            }
        }
        if let Ok(control) = controls.get(glyph.owner) {
            let color = if control.disabled {
                glyph.disabled_ink
            } else {
                glyph.ink
            };
            if image.color != color {
                image.color = color;
            }
        }
    }
}
pub(crate) fn node(x: f32, y: f32, width: f32) -> Node {
    Node {
        position_type: PositionType::Absolute,
        left: px(x),
        top: px(y),
        width: px(width),
        height: px(52.),
        flex_direction: FlexDirection::Column,
        align_items: AlignItems::Center,
        border_radius: BorderRadius::all(px(4.)),
        ..default()
    }
}
pub(crate) fn finish_node(right: f32, y: f32, compact: bool) -> Node {
    Node {
        position_type: PositionType::Absolute,
        right: px(right),
        top: px(y),
        height: px(32.),
        flex_direction: FlexDirection::Row,
        align_items: AlignItems::Center,
        column_gap: px(6.),
        padding: UiRect::horizontal(px(if compact { 8. } else { 12. })),
        border_radius: BorderRadius::all(px(4.)),
        ..default()
    }
}
fn glyph(
    world: &mut World,
    owner: Entity,
    icon: Icon,
    x: f32,
    y: f32,
    size: f32,
    ink: Color,
) -> Entity {
    let image = image(world, icon, size.round() as u32);
    let finish = world
        .get::<RibbonButton>(owner)
        .is_some_and(|button| button.finish);
    let theme = world.get::<InterfaceButtonStyle>(owner).unwrap().0;
    let child = world
        .spawn((
            Node {
                position_type: if finish {
                    PositionType::Relative
                } else {
                    PositionType::Absolute
                },
                left: if finish { Val::Auto } else { px(x) },
                top: if finish { Val::Auto } else { px(y) },
                width: px(size),
                height: px(size),
                flex_shrink: 0.,
                ..default()
            },
            ImageNode {
                image,
                color: ink,
                ..default()
            },
            RibbonGlyph {
                owner,
                icon,
                ink,
                disabled_ink: css_mix(theme.mute, theme.header, 0.4),
            },
        ))
        .id();
    world.entity_mut(owner).add_child(child);
    child
}
/// Use the same cached SVG pipeline for compact chrome and tree controls.
pub(crate) fn compact_glyph(
    world: &mut World,
    owner: Entity,
    icon: Icon,
    x: f32,
    size: f32,
) -> Entity {
    let theme = world.get::<InterfaceButtonStyle>(owner).unwrap().0;
    glyph(world, owner, icon, x, (24. - size) / 2., size, theme.mute)
}

pub(crate) fn replace_compact_glyph(world: &mut World, owner: Entity, icon: Icon) {
    let mut glyphs = world.query::<&mut RibbonGlyph>();
    for mut glyph in glyphs.iter_mut(world).filter(|glyph| glyph.owner == owner) {
        if glyph.icon != icon {
            glyph.icon = icon;
        }
    }
}

pub(crate) fn decoration(world: &mut World, camera: Entity, icon: Icon, ink: Color) -> Entity {
    let image = image(world, icon, 13);
    let entity = world.spawn_empty().id();
    world.entity_mut(entity).insert((
        UiTargetCamera(camera),
        ZIndex(30),
        ImageNode {
            image,
            color: ink,
            ..default()
        },
        RibbonGlyph {
            owner: entity,
            icon,
            ink,
            disabled_ink: ink,
        },
    ));
    entity
}
pub(crate) fn decorate(world: &mut World, entity: Entity, icon: Icon) {
    if world.get::<RibbonButton>(entity).is_some() {
        return;
    }
    let label = world.get::<InterfaceLabel>(entity).unwrap().0;
    let theme = world.get::<InterfaceButtonStyle>(entity).unwrap().0;
    let assets = world.resource::<ViewportUiAssets>().clone();
    let semantic = &world.get::<InterfaceControl>(entity).unwrap().label;
    let display_label = match semantic.as_str() {
        "Three-point arc" => "Arc",
        "Fit-point spline" => "Spline",
        "Center-to-center slot" => "Slot",
        "Create Sketch" => "Create\nSketch",
        "Finish sketch" => "FINISH SKETCH",
        "Finish spline" => "FINISH SPLINE",
        other => other,
    }
    .to_owned();
    let finish = matches!(icon, Icon::Finish);
    let lines = if display_label.contains('\n') || (!finish && display_label.len() > 11) {
        2.
    } else {
        1.
    };
    world.entity_mut(label).insert((
        Text::new(&display_label),
        theme.text(
            &assets,
            if finish { 11. } else { 8. },
            if finish {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            },
        ),
        TextLayout::justify(Justify::Center),
        FontHinting::Enabled,
        LineHeight::Px(if finish { 16.5 } else { 8. }),
        LetterSpacing::Px(if finish { 0.275 } else { 0. }),
        Node {
            position_type: if finish {
                PositionType::Relative
            } else {
                PositionType::Absolute
            },
            top: if finish {
                Val::Auto
            } else {
                px(40. - lines * 4.)
            },
            left: if finish { Val::Auto } else { px(0.) },
            width: if finish { Val::Auto } else { percent(100.) },
            flex_shrink: 0.,
            ..default()
        },
    ));
    world.entity_mut(entity).insert(RibbonButton {
        finish,
        display_label,
    });
    let primary_glyph = glyph(
        world,
        entity,
        icon,
        if finish { 8. } else { 13. },
        if finish { 9. } else { 5. },
        if finish { 14. } else { 22. },
        if finish {
            Color::WHITE
        } else if matches!(icon, Icon::Relation(_)) {
            Color::srgb_u8(224, 120, 120)
        } else {
            theme.ink
        },
    );
    if finish {
        world
            .entity_mut(entity)
            .insert_children(0, &[primary_glyph]);
        glyph(
            world,
            entity,
            Icon::Chevron,
            121.,
            10.5,
            11.,
            Color::WHITE.with_alpha(0.7),
        );
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_vectors_remain_open_and_transparent_when_tinted_or_disabled() {
        for icon in [
            Icon::Extrude,
            Icon::Sketch,
            Icon::Line,
            Icon::MidpointLine,
            Icon::Rectangle,
            Icon::Circle,
            Icon::Arc,
            Icon::Slot,
            Icon::Point,
            Icon::Spline,
            Icon::Finish,
            Icon::Cancel,
            Icon::Chevron,
        ] {
            let image = rasterize(icon, 96);
            let data = image.data.unwrap();
            assert_eq!(data[3], 0, "{icon:?} background must be transparent");
            assert!(
                data.chunks_exact(4).any(|p| p[3] > 0),
                "{icon:?} must have visible strokes"
            );
        }
        let rectangle = rasterize(Icon::Rectangle, 96).data.unwrap();
        assert_eq!(
            rectangle[(48 * 96 + 48) * 4 + 3],
            0,
            "Do not fill an outlined profile"
        );
        let mut app = App::new();
        app.init_resource::<Assets<Image>>()
            .insert_resource(ViewportUiAssets::default())
            .add_systems(Update, update_glyphs);
        let theme =
            ViewportUiTheme::from_palette(&crate::native_viewport::ViewportPalette::default());
        let camera = app.world_mut().spawn_empty().id();
        let button = spawn_button(
            &mut app.world_mut().commands(),
            camera,
            node(0., 0., 48.),
            InterfaceControl::button("solid/build", "Extrude"),
            theme,
            &ViewportUiAssets::default(),
        );
        app.world_mut().flush();
        decorate(app.world_mut(), button, Icon::Extrude);
        let count = app.world().entities().len();
        decorate(app.world_mut(), button, Icon::Extrude);
        assert_eq!(app.world().entities().len(), count);
        for disabled in [true, false] {
            app.world_mut()
                .get_mut::<InterfaceControl>(button)
                .unwrap()
                .disabled = disabled;
            app.update();
            let image = app
                .world_mut()
                .query::<&ImageNode>()
                .single(app.world())
                .unwrap();
            assert_eq!(
                image.color,
                if disabled {
                    css_mix(theme.mute, theme.header, 0.4)
                } else {
                    theme.ink
                }
            );
        }
    }
}
