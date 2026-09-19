//! The existing ribbon's 48 × 52 command cells, rendered with Bevy UI.
//! Geometry for the first migrated icons follows `src/components/icons.tsx`.
//! This styles real controls; it does not add a parallel command registry.
use super::*;
use bevy::ui::UiTransform;

#[derive(Component)]
pub(crate) struct RibbonButton {
    pub finish: bool,
}

#[derive(Component)]
pub(super) struct RibbonGlyph {
    owner: Entity,
    ink: Color,
    filled: bool,
}

pub(super) fn update_glyphs(
    controls: Query<&InterfaceControl>,
    mut glyphs: Query<(
        &RibbonGlyph,
        Option<&mut BackgroundColor>,
        Option<&mut BorderColor>,
    )>,
) {
    for (glyph, fill, border) in &mut glyphs {
        let Ok(control) = controls.get(glyph.owner) else {
            continue;
        };
        let ink = if control.disabled {
            glyph.ink.with_alpha(0.4)
        } else {
            glyph.ink
        };
        if let Some(mut fill) = fill {
            let next = if glyph.filled { ink } else { Color::NONE };
            if fill.0 != next {
                fill.0 = next;
            }
        }
        if let Some(mut border) = border {
            let next = BorderColor::all(ink);
            if *border != next {
                *border = next;
            }
        }
    }
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
                Color::srgb_u8(97, 183, 101)
            } else {
                Color::srgb_u8(88, 166, 92)
            };
        }
        if disabled {
            Color::NONE
        } else if active {
            theme.accent.with_alpha(if hover { 0.30 } else { 0.25 })
        } else if hover {
            theme.edge.with_alpha(1.)
        } else {
            Color::NONE
        }
    }
    pub(super) fn ink(&self, theme: ViewportUiTheme, disabled: bool) -> Color {
        let color = if self.finish {
            Color::WHITE
        } else {
            theme.mute
        };
        if disabled {
            color.with_alpha(0.4)
        } else {
            color
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Icon {
    Extrude,
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
        padding: UiRect::top(px(4.)),
        border_radius: BorderRadius::all(px(4.)),
        ..default()
    }
}

pub(crate) fn finish_node(x: f32, y: f32) -> Node {
    Node {
        height: px(32.),
        ..node(x, y, 140.)
    }
}

pub(crate) fn decorate(world: &mut World, entity: Entity, icon: Icon) {
    if world.get::<RibbonButton>(entity).is_some() {
        return;
    }
    let label = world.get::<InterfaceLabel>(entity).unwrap().0;
    let theme = world.get::<InterfaceButtonStyle>(entity).unwrap().0;
    let assets = world.resource::<ViewportUiAssets>().clone();
    let finish = matches!(icon, Icon::Finish);
    world.entity_mut(entity).insert(RibbonButton { finish });
    world.entity_mut(label).insert((
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
        Node {
            position_type: PositionType::Absolute,
            top: px(if finish { 8. } else { 28. }),
            left: if finish { px(28.) } else { px(0.) },
            width: if finish { px(104.) } else { percent(100.) },
            height: px(if finish { 16. } else { 24. }),
            ..default()
        },
    ));
    let canvas = world
        .spawn(Node {
            position_type: if finish {
                PositionType::Absolute
            } else {
                PositionType::Relative
            },
            left: if finish { px(8.) } else { Val::Auto },
            top: if finish { px(9.) } else { Val::Auto },
            width: px(if finish { 14. } else { 22. }),
            height: px(if finish { 14. } else { 24. }),
            ..default()
        })
        .id();
    world.entity_mut(entity).add_child(canvas);
    let color = if finish { Color::WHITE } else { theme.ink };
    // The source diagrams are 24 × 24; preserve their stroke width and radius.
    let mut painter = Painter {
        world,
        canvas,
        color,
        scale: if finish { 14. / 24. } else { 22. / 24. },
        stroke: if finish { 2.5 } else { 1.6 },
    };
    match icon {
        Icon::Extrude => {
            painter.rect(3., 8., 6., 10., 0.8);
            painter.rect(15., 5., 6., 10., 0.8);
            for (a, b) in [
                ([9., 8.], [15., 5.]),
                ([9., 18.], [15., 15.]),
                ([9., 13.], [15., 13.]),
                ([12.5, 10.5], [15., 13.]),
                ([15., 13.], [12.5, 15.5]),
            ] {
                painter.line(a, b);
            }
        }
        Icon::Line => {
            painter.line([4., 19.], [20., 5.]);
            painter.circle(4., 19., 1.8);
            painter.circle(20., 5., 1.8);
        }
        Icon::MidpointLine => {
            painter.line([3., 18.], [21., 6.]);
            painter.circle(3., 18., 1.6);
            painter.circle(21., 6., 1.6);
            painter.line([12., 9.], [14.2, 12.2]);
            painter.line([14.2, 12.2], [9.8, 12.4]);
            painter.line([9.8, 12.4], [12., 9.]);
        }
        Icon::Rectangle => {
            painter.rect(4., 6., 16., 12., 1.);
            painter.circle(4., 18., 1.2);
            painter.circle(20., 6., 1.2);
        }
        Icon::Circle => {
            painter.circle(12., 12., 8.);
            painter.circle(12., 12., 1.3);
            painter.line([12., 12.], [13.6, 10.7]);
            painter.line([15.1, 9.5], [17., 8.]);
        }
        Icon::Arc => {
            painter.curve([[4., 18.], [6., 7.], [15., 3.], [20., 12.]]);
            painter.circle(4., 18., 1.5);
            painter.circle(20., 12., 1.5);
            painter.circle(12., 8., 1.2);
        }
        Icon::Slot => {
            painter.rect(3., 7., 18., 10., 5.);
            painter.line([8., 10.], [8., 14.]);
            painter.line([16., 10.], [16., 14.]);
        }
        Icon::Point => {
            painter.circle(12., 12., 10.);
            painter.line([2., 12.], [6., 12.]);
            painter.line([18., 12.], [22., 12.]);
            painter.line([12., 2.], [12., 6.]);
            painter.line([12., 18.], [12., 22.]);
        }
        Icon::Spline => {
            painter.curve([[5., 17.], [5., 10.372583], [10.372583, 5.], [17., 5.]]);
            painter.circle(5., 19., 2.);
            painter.circle(19., 5., 2.);
        }
        Icon::Sketch => {
            for (a, b) in [
                ([3., 17.], [3., 21.]),
                ([3., 21.], [7., 21.]),
                ([7., 21.], [21., 7.]),
                ([21., 7.], [17., 3.]),
                ([17., 3.], [3., 17.]),
                ([16., 5.], [19., 8.]),
                ([9., 21.], [21., 21.]),
            ] {
                painter.line(a, b);
            }
        }
        Icon::Finish => {
            painter.line([5., 12.], [10., 17.]);
            painter.line([10., 17.], [20., 7.]);
        }
        Icon::Cancel => {
            painter.line([6., 6.], [18., 18.]);
            painter.line([6., 18.], [18., 6.]);
        }
    }
    let children: Vec<Entity> = world.get::<Children>(canvas).unwrap().iter().collect();
    for child in children {
        let filled = world
            .get::<BackgroundColor>(child)
            .is_some_and(|fill| fill.0 == color);
        world.entity_mut(child).insert(RibbonGlyph {
            owner: entity,
            ink: color,
            filled,
        });
    }
}

struct Painter<'a> {
    world: &'a mut World,
    canvas: Entity,
    color: Color,
    scale: f32,
    stroke: f32,
}
impl Painter<'_> {
    fn line(&mut self, a: [f32; 2], b: [f32; 2]) {
        let scale = self.scale;
        let a = Vec2::from(a) * scale;
        let b = Vec2::from(b) * scale;
        let delta = b - a;
        let center = (a + b) * 0.5;
        let thickness = self.stroke * scale;
        let child = self
            .world
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(center.x - delta.length() * 0.5),
                    top: px(center.y - thickness * 0.5),
                    width: px(delta.length()),
                    height: px(thickness),
                    border_radius: BorderRadius::MAX,
                    ..default()
                },
                UiTransform::from_rotation(Rot2::radians(delta.y.atan2(delta.x))),
                BackgroundColor(self.color),
            ))
            .id();
        self.world.entity_mut(self.canvas).add_child(child);
    }
    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, r: f32) {
        let s = self.scale;
        let child = self
            .world
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px((x - 0.8) * s),
                    top: px((y - 0.8) * s),
                    width: px((w + 1.6) * s),
                    height: px((h + 1.6) * s),
                    border: UiRect::all(px(1.6 * s)),
                    border_radius: BorderRadius::all(px((r + 0.8) * s)),
                    ..default()
                },
                BorderColor::all(self.color),
            ))
            .id();
        self.world.entity_mut(self.canvas).add_child(child);
    }
    fn circle(&mut self, x: f32, y: f32, r: f32) {
        self.rect(x - r, y - r, r * 2., r * 2., r);
    }
    fn curve(&mut self, points: [[f32; 2]; 4]) {
        let [a, b, c, d] = points.map(Vec2::from);
        let mut previous = a;
        for step in 1..=24 {
            let t = step as f32 / 24.;
            let u = 1. - t;
            let next = a * u * u * u + b * 3. * u * u * t + c * 3. * u * t * t + d * t * t * t;
            self.line(previous.to_array(), next.to_array());
            previous = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabling_a_ribbon_control_dims_its_strokes_without_filling_its_open_geometry() {
        let mut app = App::new();
        let assets = ViewportUiAssets::default();
        app.insert_resource(assets.clone())
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
            &assets,
        );
        app.world_mut().flush();
        decorate(app.world_mut(), button, Icon::Extrude);
        let count = app.world().entities().len();
        decorate(app.world_mut(), button, Icon::Extrude);
        assert_eq!(
            app.world().entities().len(),
            count,
            "Synchronization cannot duplicate the glyph"
        );
        for disabled in [false, true, false] {
            app.world_mut()
                .get_mut::<InterfaceControl>(button)
                .unwrap()
                .disabled = disabled;
            app.update();
            let mut outlines = 0;
            for (glyph, fill, border) in app
                .world_mut()
                .query::<(&RibbonGlyph, &BackgroundColor, &BorderColor)>()
                .iter(app.world())
            {
                if !glyph.filled {
                    outlines += 1;
                    assert_eq!(fill.0, Color::NONE);
                    assert_eq!(
                        *border,
                        BorderColor::all(if disabled {
                            theme.ink.with_alpha(0.4)
                        } else {
                            theme.ink
                        })
                    );
                }
            }
            assert_eq!(outlines, 2);
        }
    }
}
