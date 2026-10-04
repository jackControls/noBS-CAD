use super::*;

pub(super) fn paint(
    world: &mut World,
    camera: Entity,
    state: &mut State,
    width: f32,
    height: f32,
) -> Result<(), String> {
    let w = 256.;
    let x = (width - 156. - w).max(284.);
    let y = 132.;
    let h = (height - y - 108.).clamp(210., 428.);
    let per_page = (((h - 102.) / 51.).floor() as usize).clamp(1, 6);
    state.scroll = state.scroll.min(7 - per_page);
    let theme = crate::native_viewport::ui::theme(world);
    workbench::card(
        &mut state.widgets,
        world,
        camera,
        "appearance-card",
        rect(x, y, w, h),
        theme.panel.with_alpha(1.),
        4.,
        45,
    );
    state.widgets.text(
        world,
        camera,
        "appearance-title",
        rect(x + 12., y + 8., w - 24., 18.),
        "Body appearance",
        13.,
        47,
    );
    state.widgets.text(
        world,
        camera,
        "appearance-body",
        rect(x + 12., y + 28., w - 24., 18.),
        &state.name,
        11.,
        47,
    );
    let draft = state.draft.as_ref().unwrap();
    for (row, (field, label)) in [
        (None, "3MF slicer target"),
        (Some(Field::Brand), "Material brand"),
        (Some(Field::Preset), "Material preset"),
        (Some(Field::FilamentType), "Filament type"),
        (Some(Field::Color), "Body color (hex)"),
        (Some(Field::ColorName), "Color name"),
        (Some(Field::MaterialName), "Material name"),
    ]
    .into_iter()
    .skip(state.scroll)
    .take(per_page)
    .enumerate()
    {
        let field_y = y + 53. + row as f32 * 51.;
        state.widgets.text(
            world,
            camera,
            &format!("appearance-label-{field:?}"),
            rect(x + 12., field_y, w - 24., 16.),
            label,
            10.,
            47,
        );
        let mut control = InterfaceControl::button("body/appearance", label);
        control.disabled = worker::busy(world);
        let options = field.map_or_else(|| Some(slicer_choices()), |field| choices(draft, field));
        let value = field.map_or_else(
            || state.slicer_target.as_str().into(),
            |field| {
                state
                    .errors
                    .get(&field)
                    .map_or_else(|| draft.text(field), |error| error.0.clone())
            },
        );
        let caption = options
            .as_ref()
            .and_then(|options| options.iter().find(|o| o.value == value))
            .map(|o| o.label.clone());
        if let Some(options) = options {
            control.role = "combobox".into();
            control.owned_keys = [
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
            ]
            .map(KeyChord::plain)
            .into();
            control.field = ControlField::Choice { value, options };
        } else {
            control.field = ControlField::Text {
                value,
                read_only: false,
                selection: None,
            };
        }
        state.widgets.button(
            world,
            camera,
            &format!("appearance-field-{field:?}"),
            control,
            caption.as_deref(),
            NativeCommand::BodyAppearance(
                state.generation,
                field.map_or(Command::SlicerTarget, Command::Field),
            ),
            rect(x + 12., field_y + 17., w - 24., 28.),
            None,
            47,
        )?;
    }
    // A text widget commits its buffer on blur, before the ordered button
    // action. Keep Apply/Reset enabled while idle so that first click can
    // commit a newly typed value or correct an earlier invalid value.
    // The reducer validates the resulting draft before any engine write.
    for (label, caption, command, offset, disabled) in [
        (
            "Previous appearance fields",
            "↑",
            Command::Scroll(-1),
            12.,
            state.scroll == 0,
        ),
        (
            "More appearance fields",
            "↓",
            Command::Scroll(1),
            43.,
            state.scroll + per_page >= 7,
        ),
        ("Reset appearance", "Reset", Command::Reset, 84., false),
        ("Apply appearance", "Apply", Command::Apply, 167., false),
    ] {
        let mut control = InterfaceControl::button("body/appearance", label);
        control.disabled = disabled || worker::busy(world);
        state.widgets.button(
            world,
            camera,
            &format!("appearance-{label}"),
            control,
            Some(caption),
            NativeCommand::BodyAppearance(state.generation, command),
            rect(
                x + offset,
                y + h - 36.,
                if offset < 80. { 27. } else { 76. },
                26.,
            ),
            None,
            47,
        )?;
    }
    if let Some(error) = state
        .errors
        .values()
        .next()
        .map(|error| &error.1)
        .or(state.preference_error.as_ref())
    {
        state.widgets.text(
            world,
            camera,
            "appearance-error",
            rect(x + 12., y + h - 59., w - 24., 20.),
            error,
            10.,
            47,
        );
        world
            .entity_mut(state.widgets.entity("appearance-error").unwrap())
            .insert(TextColor(Color::srgb(0.95, 0.35, 0.3)));
    }
    Ok(())
}
