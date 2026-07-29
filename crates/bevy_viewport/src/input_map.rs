//! Mode-scoped keyboard actions → session / sim commands.

use bevy::prelude::*;

use crate::session::{CadMode, SetMode};
use crate::sim::{SetSimLoad, SetSimSpeed, ToggleSimPause};

pub struct InputMapPlugin;

impl Plugin for InputMapPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, (mode_hotkeys, sim_hotkeys.run_if(in_state(CadMode::Simulate))));
    }
}

fn mode_hotkeys(keys: Res<ButtonInput<KeyCode>>, mut modes: MessageWriter<SetMode>) {
    if keys.just_pressed(KeyCode::Digit1) || keys.just_pressed(KeyCode::Numpad1) {
        modes.write(SetMode(CadMode::Sketch));
    }
    if keys.just_pressed(KeyCode::Digit2) || keys.just_pressed(KeyCode::Numpad2) {
        modes.write(SetMode(CadMode::Solid));
    }
    if keys.just_pressed(KeyCode::Digit3) || keys.just_pressed(KeyCode::Numpad3) {
        modes.write(SetMode(CadMode::Simulate));
    }
}

fn sim_hotkeys(
    keys: Res<ButtonInput<KeyCode>>,
    mut pause: MessageWriter<ToggleSimPause>,
    mut load: MessageWriter<SetSimLoad>,
    mut speed: MessageWriter<SetSimSpeed>,
    sim_load: Res<crate::sim::SimLoad>,
) {
    if keys.just_pressed(KeyCode::Space) {
        pause.write(ToggleSimPause);
    }
    if keys.just_pressed(KeyCode::BracketLeft) {
        load.write(SetSimLoad((sim_load.0 - 0.08).clamp(0.2, 1.0)));
    }
    if keys.just_pressed(KeyCode::BracketRight) {
        load.write(SetSimLoad((sim_load.0 + 0.08).clamp(0.2, 1.0)));
    }
    if keys.just_pressed(KeyCode::Comma) {
        speed.write(SetSimSpeed(0.5));
    }
    if keys.just_pressed(KeyCode::Period) {
        speed.write(SetSimSpeed(1.0));
    }
    if keys.just_pressed(KeyCode::Slash) {
        speed.write(SetSimSpeed(2.0));
    }
}
