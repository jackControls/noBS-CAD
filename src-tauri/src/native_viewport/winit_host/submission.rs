//! Receipt for the exact extracted frame whose GPU commands were submitted.
//! The OS/compositor may present later; hidden windows retain usable semantic
//! layout without claiming that a visible frame was rendered.

use super::super::interface_shell::NativeInterfaceHandle;
use bevy::{
    prelude::*,
    render::{
        renderer::{RenderGraph, RenderGraphSystems},
        view::window::ExtractedWindow,
        Extract, ExtractSchedule, RenderApp,
    },
    window::PrimaryWindow,
};

#[derive(Resource)]
struct ExtractedReceipt {
    handle: NativeInterfaceHandle,
    revision: u64,
}

pub(super) fn install(app: &mut App) {
    let render = app.sub_app_mut(RenderApp);
    render
        .add_systems(ExtractSchedule, extract)
        .add_systems(RenderGraph, submitted.in_set(RenderGraphSystems::Finish));
}

fn extract(mut commands: Commands, handle: Extract<Option<Res<NativeInterfaceHandle>>>) {
    if let Some(handle) = handle.as_ref() {
        if let Some(receipt) = handle.render_receipt() {
            commands.insert_resource(ExtractedReceipt {
                handle: (*handle).clone(),
                revision: receipt.laid_out_revision,
            });
        }
    }
}

fn submitted(
    receipt: Option<Res<ExtractedReceipt>>,
    windows: Query<&ExtractedWindow, With<PrimaryWindow>>,
) {
    let Some(receipt) = receipt else {
        return;
    };
    let Ok(window) = windows.single() else {
        return;
    };
    if window.swap_chain_texture.is_some() && window.swap_chain_texture_view.is_some() {
        if let Err(error) = receipt.handle.submitted_revision(receipt.revision) {
            eprintln!("Native render receipt rejected: {error}");
        }
    }
}
