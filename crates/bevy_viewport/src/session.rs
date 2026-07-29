//! Product session bridge + CadMode as Bevy States.

use bevy::prelude::*;

#[derive(Debug, Clone, Copy, Default, Eq, PartialEq, Hash, States)]
pub enum CadMode {
    Sketch,
    Solid,
    /// Structural mock powered by Virtual + Fixed game time.
    #[default]
    Simulate,
}

impl CadMode {
    pub fn label(self) -> &'static str {
        match self {
            CadMode::Sketch => "Sketch",
            CadMode::Solid => "Solid",
            CadMode::Simulate => "Simulate",
        }
    }
}

/// Shared session state — stand-in for appStore / kernel bridge.
#[derive(Resource, Debug, Clone)]
pub struct CadSession {
    pub material_name: String,
    pub color: Color,
    pub selection: String,
    pub body_name: String,
}

impl Default for CadSession {
    fn default() -> Self {
        Self {
            material_name: "Stress field (mock)".into(),
            color: Color::srgb(0.85, 0.35, 0.2),
            selection: "Simulate — Space pause · [ ] load · scroll zoom".into(),
            body_name: "Cantilever".into(),
        }
    }
}

pub const COLOR_PRESETS: &[(&str, &str, f32, f32, f32)] = &[
    ("PLA Red", "Bambu-ish red", 0.85, 0.35, 0.2),
    ("PLA White", "Jade white", 0.92, 0.92, 0.90),
    ("PETG Blue", "Tooling blue", 0.20, 0.45, 0.85),
    ("ABS Black", "Enclosure", 0.12, 0.12, 0.14),
];

#[derive(Message, Debug, Clone, Copy)]
pub struct SetMode(pub CadMode);

#[derive(Message, Debug, Clone, Copy)]
pub struct ApplyAppearance {
    pub preset_index: usize,
}

#[derive(Message, Debug, Clone)]
pub struct SetSelection {
    pub text: String,
    pub body_name: Option<String>,
}

pub struct SessionPlugin;

impl Plugin for SessionPlugin {
    fn build(&self, app: &mut App) {
        app.init_state::<CadMode>()
            .init_resource::<CadSession>()
            .add_message::<SetMode>()
            .add_message::<ApplyAppearance>()
            .add_message::<SetSelection>()
            .add_systems(
                Update,
                (
                    apply_set_mode,
                    apply_appearance,
                    apply_selection,
                    sync_session_copy_on_mode_enter,
                ),
            );
    }
}

fn apply_set_mode(
    mut messages: MessageReader<SetMode>,
    mut next: ResMut<NextState<CadMode>>,
    current: Res<State<CadMode>>,
) {
    for SetMode(mode) in messages.read() {
        if *current.get() != *mode {
            info!("CadMode -> {}", mode.label());
            next.set(*mode);
        }
    }
}

fn apply_appearance(
    mut messages: MessageReader<ApplyAppearance>,
    mut session: ResMut<CadSession>,
) {
    for ApplyAppearance { preset_index } in messages.read() {
        let (name, _hint, r, g, b) = COLOR_PRESETS[*preset_index % COLOR_PRESETS.len()];
        session.material_name = name.to_string();
        session.color = Color::srgb(r, g, b);
        info!("Appearance -> {name}");
    }
}

fn apply_selection(mut messages: MessageReader<SetSelection>, mut session: ResMut<CadSession>) {
    for msg in messages.read() {
        session.selection = msg.text.clone();
        if let Some(name) = &msg.body_name {
            session.body_name = name.clone();
        }
    }
}

fn sync_session_copy_on_mode_enter(
    mut transitions: MessageReader<StateTransitionEvent<CadMode>>,
    mut session: ResMut<CadSession>,
) {
    for event in transitions.read() {
        let Some(mode) = event.entered else {
            continue;
        };
        match mode {
            CadMode::Sketch => {
                session.selection = "Sketch — layout mode (spike).".into();
                session.body_name = "—".into();
            }
            CadMode::Solid => {
                session.selection = "Solid — click the orange body.".into();
                session.body_name = "FixtureCube".into();
                session.material_name = "PLA Red".into();
                session.color = Color::srgb(0.85, 0.35, 0.2);
            }
            CadMode::Simulate => {
                session.selection = "Simulate — Space pause · [ ] load · scroll zoom".into();
                session.body_name = "Cantilever".into();
                session.material_name = "Stress field (mock)".into();
            }
        }
    }
}
