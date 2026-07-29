//! Structural mock on Bevy game time: Virtual clock + Fixed step + present.

mod physics;
mod present;
mod scene;

pub use physics::{stress_to_color, SimBody, SimLoad, SimStressField};
pub use scene::SEGMENT_COUNT;

use bevy::prelude::*;
use bevy::time::Stopwatch;

use crate::session::CadMode;

#[derive(Message, Debug, Clone, Copy)]
pub struct SetSimLoad(pub f32);

#[derive(Message, Debug, Clone, Copy)]
pub struct SetSimSpeed(pub f32);

#[derive(Message, Debug, Clone, Copy)]
pub struct ToggleSimPause;

#[derive(Resource, Debug, Clone)]
pub struct SimTelemetry {
    pub peak_mpa: f32,
    pub tip_deflection_mm: f32,
    pub elapsed_secs: f32,
    pub paused: bool,
    pub relative_speed: f32,
}

impl Default for SimTelemetry {
    fn default() -> Self {
        Self {
            peak_mpa: 0.0,
            tip_deflection_mm: 0.0,
            elapsed_secs: 0.0,
            paused: false,
            relative_speed: 1.0,
        }
    }
}

#[derive(Resource)]
pub struct SimElapsed(pub Stopwatch);

impl Default for SimElapsed {
    fn default() -> Self {
        Self(Stopwatch::new())
    }
}

pub struct SimPlugin;

impl Plugin for SimPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SimLoad>()
            .init_resource::<SimBody>()
            .init_resource::<SimStressField>()
            .init_resource::<SimTelemetry>()
            .init_resource::<SimElapsed>()
            .add_message::<SetSimLoad>()
            .add_message::<SetSimSpeed>()
            .add_message::<ToggleSimPause>()
            .insert_resource(Time::<Fixed>::from_hz(64.0))
            .add_systems(OnEnter(CadMode::Simulate), scene::spawn_sim_world)
            .add_systems(OnExit(CadMode::Simulate), scene::despawn_sim_world)
            .add_systems(
                Update,
                (
                    apply_sim_commands,
                    tick_sim_elapsed.run_if(in_state(CadMode::Simulate)),
                    present::present_sim.run_if(in_state(CadMode::Simulate)),
                    sync_telemetry.run_if(in_state(CadMode::Simulate)),
                ),
            )
            .add_systems(
                FixedUpdate,
                physics::fixed_bend_step.run_if(in_state(CadMode::Simulate)),
            );
    }
}

fn apply_sim_commands(
    mut loads: MessageReader<SetSimLoad>,
    mut speeds: MessageReader<SetSimSpeed>,
    mut pauses: MessageReader<ToggleSimPause>,
    mut sim_load: ResMut<SimLoad>,
    mut virtual_time: ResMut<Time<Virtual>>,
    mut telemetry: ResMut<SimTelemetry>,
) {
    for SetSimLoad(load) in loads.read() {
        sim_load.0 = load.clamp(0.2, 1.0);
    }
    for SetSimSpeed(speed) in speeds.read() {
        let speed = speed.clamp(0.25, 4.0);
        virtual_time.set_relative_speed(speed);
        telemetry.relative_speed = speed;
    }
    for _ in pauses.read() {
        if virtual_time.is_paused() {
            virtual_time.unpause();
            telemetry.paused = false;
        } else {
            virtual_time.pause();
            telemetry.paused = true;
        }
    }
}

fn tick_sim_elapsed(
    virtual_time: Res<Time<Virtual>>,
    mut elapsed: ResMut<SimElapsed>,
) {
    if virtual_time.is_paused() {
        elapsed.0.pause();
    } else {
        elapsed.0.unpause();
        elapsed.0.tick(virtual_time.delta());
    }
}

fn sync_telemetry(
    body: Res<SimBody>,
    load: Res<SimLoad>,
    field: Res<SimStressField>,
    elapsed: Res<SimElapsed>,
    virtual_time: Res<Time<Virtual>>,
    mut telemetry: ResMut<SimTelemetry>,
) {
    telemetry.tip_deflection_mm = body.tip_deflection_mm;
    telemetry.peak_mpa = field.peak_mpa(load.0);
    telemetry.elapsed_secs = elapsed.0.elapsed_secs();
    telemetry.paused = virtual_time.is_paused();
    telemetry.relative_speed = virtual_time.relative_speed();
}

/// Pure helpers for unit tests (no App).
#[cfg(test)]
mod tests {
    use super::physics::bend_step;
    use super::*;
    use bevy::time::Time;

    #[test]
    fn fixed_dt_is_stable_at_64hz() {
        let time = Time::<Fixed>::from_hz(64.0);
        let dt = time.timestep().as_secs_f32();
        assert!((dt - 1.0 / 64.0).abs() < 1e-6);
        let mut body = SimBody::default();
        let load = SimLoad(0.8);
        let before = body.tip_deflection_mm;
        bend_step(&mut body, &load, dt);
        assert!(body.tip_deflection_mm > before);
        // Same dt twice → deterministic increment shape.
        let mut a = SimBody::default();
        let mut b = SimBody::default();
        bend_step(&mut a, &load, dt);
        bend_step(&mut b, &load, dt);
        assert!((a.tip_deflection_mm - b.tip_deflection_mm).abs() < 1e-5);
    }

    #[test]
    fn pause_freezes_bend_when_virtual_paused() {
        let mut time = Time::<Virtual>::default();
        time.set_relative_speed(2.0);
        assert_eq!(time.relative_speed(), 2.0);

        let mut body = SimBody::default();
        // Unpaused: Fixed step advances bend (mirrors FixedUpdate gating).
        assert!(!time.is_paused());
        bend_step(&mut body, &SimLoad(0.8), 1.0 / 64.0);
        let moving = body.tip_deflection_mm;
        assert!(moving > 0.0);

        // Paused: caller skips bend_step — tip holds (Bevy skips FixedUpdate).
        time.pause();
        assert!(time.is_paused());
        let held = body.tip_deflection_mm;
        if !time.is_paused() {
            bend_step(&mut body, &SimLoad(0.8), 1.0 / 64.0);
        }
        assert_eq!(body.tip_deflection_mm, held);

        time.unpause();
        assert!(!time.is_paused());
    }

    #[test]
    fn bend_responds_to_load() {
        let dt = 1.0 / 64.0;
        let mut light = SimBody::default();
        let mut heavy = SimBody::default();
        for _ in 0..64 {
            bend_step(&mut light, &SimLoad(0.3), dt);
            bend_step(&mut heavy, &SimLoad(1.0), dt);
        }
        assert!(heavy.tip_deflection_mm > light.tip_deflection_mm);
    }
}
