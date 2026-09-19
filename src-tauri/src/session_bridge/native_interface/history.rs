//! Sketch and solid application Undo/Redo through the shared live dispatcher.
//! Assembly and drawing command histories have separate snapshot boundaries;
//! their native workspace reducers must dispatch those before this solid path.

use super::super::{
    bump_engine_revision, dispatch_inbox_on_engine, dispatch_project_replacement,
    native_history::{self, HistoryState, RedoStep, UndoStep},
    parse_engine_envelope, retire_project_publisher, ProjectPublisher, SessionBridgeState,
    WindowPublisher,
};
use super::{check_owner, context, NativeMutationResult};
use crate::state::AppState;
use nbcad_interface::DocumentContext;
use serde_json::{json, Value};

fn state(owner: &DocumentContext, project: &ProjectPublisher) -> HistoryState {
    HistoryState {
        context: owner.clone(),
        engine_revision: project.engine_revision,
    }
}

fn active_sketch_history(engine: &AppState) -> Result<Option<(bool, bool)>, String> {
    // Do not clone the B-rep scene just to query command availability.
    let sketch = parse_engine_envelope(engine.engine_call("active_sketch", ""))?;
    if sketch.is_null() {
        return Ok(None);
    }
    let undo = sketch["can_undo"]
        .as_bool()
        .ok_or("Active sketch omitted Undo availability")?;
    let redo = sketch["can_redo"]
        .as_bool()
        .ok_or("Active sketch omitted Redo availability")?;
    Ok(Some((undo, redo)))
}

fn mutate(
    engine: &AppState,
    publisher: &mut WindowPublisher,
    owner: &DocumentContext,
    process_instance_id: &str,
    operation: &str,
    arguments: &Value,
) -> Result<Value, String> {
    publisher
        .active_mut()
        .engine_revision
        .checked_add(1)
        .ok_or("Session engine revision exhausted")?;
    let value = dispatch_inbox_on_engine(engine, operation, arguments)?;
    // Publication failure is retriable independently; the successful engine
    // operation must not be reported failed and blindly replayed a second time.
    if let Err(error) = bump_engine_revision(
        publisher.active_mut(),
        &owner.window_id,
        Some(&owner.document_id),
        process_instance_id,
    ) {
        eprintln!("Native history could not publish engine revision: {error}");
    }
    Ok(value)
}

impl SessionBridgeState {
    pub(crate) fn native_history_available(
        &self,
        engine: &AppState,
        expected: &DocumentContext,
    ) -> Result<(bool, bool), String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "Session publisher lock poisoned")?;
        let publisher = publishers
            .get_mut(&expected.window_id)
            .ok_or("Native interface window is no longer available")?;
        check_owner(publisher, engine, expected)?;
        let project = publisher.active_mut();
        let before = state(expected, project);
        project.native_history.observe(&before)?;
        if let Some(available) = active_sketch_history(engine)? {
            return Ok(available);
        }
        let document = engine.document_snapshot();
        let undo = project.native_history.peek_edit_undo(&before).is_some()
            || native_history::undo_step(document.rollback_index, document.features.len())?
                .is_some();
        let redo = project
            .native_history
            .redo_step(&before, document.rollback_index, document.features.len())?
            .is_some();
        Ok((undo, redo))
    }

    pub(crate) fn apply_native_history(
        &self,
        engine: &AppState,
        expected: &DocumentContext,
        redo: bool,
        validate_control: impl FnOnce() -> Result<(), String>,
    ) -> Result<NativeMutationResult, String> {
        self.apply_native_history_guarded(engine, expected, None, redo, validate_control)
    }

    /// A worker history intent is tied to the same exact revision captured
    /// by its observed control. Check it under the existing mutation fence.
    pub(crate) fn apply_native_history_at(
        &self,
        engine: &AppState,
        expected: &DocumentContext,
        expected_revision: u64,
        redo: bool,
        validate_control: impl FnOnce() -> Result<(), String>,
    ) -> Result<NativeMutationResult, String> {
        self.apply_native_history_guarded(
            engine,
            expected,
            Some(expected_revision),
            redo,
            validate_control,
        )
    }

    fn apply_native_history_guarded(
        &self,
        engine: &AppState,
        expected: &DocumentContext,
        expected_revision: Option<u64>,
        redo: bool,
        validate_control: impl FnOnce() -> Result<(), String>,
    ) -> Result<NativeMutationResult, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "Session publisher lock poisoned")?;
        let publisher = publishers
            .get_mut(&expected.window_id)
            .ok_or("Native interface window is no longer available")?;
        check_owner(publisher, engine, expected)?;
        if expected_revision
            .is_some_and(|revision| revision != publisher.active_mut().engine_revision)
        {
            return Err("The design changed before this history action could run".into());
        }
        validate_control()?;
        let project = publisher.active_mut();
        let before = state(expected, project);
        project.native_history.observe(&before)?;
        let nothing = if redo {
            "There is nothing to redo"
        } else {
            "There is nothing to undo"
        };

        let value = if let Some((can_undo, can_redo)) = active_sketch_history(engine)? {
            if !(if redo { can_redo } else { can_undo }) {
                return Err(nothing.into());
            }
            mutate(
                engine,
                publisher,
                expected,
                &self.process_instance_id,
                if redo { "sketch_redo" } else { "sketch_undo" },
                &json!({}),
            )?
        } else if !redo
            && publisher
                .active_mut()
                .native_history
                .peek_edit_undo(&before)
                .is_some()
        {
            let ticket = publisher
                .active_mut()
                .native_history
                .peek_edit_undo(&before)
                .unwrap();
            let current = parse_engine_envelope(engine.engine_call("project_export_model", ""))?;
            let current = current
                .as_str()
                .ok_or("Engine did not return an Undo snapshot")?;
            let mut replacement = ProjectPublisher::new();
            let after_owner = context(&expected.window_id, &expected.document_id, &replacement);
            let mut history = publisher.active_mut().native_history.clone();
            history.commit_edit_undo(
                ticket.clone(),
                current.to_owned(),
                state(&after_owner, &replacement),
            )?;
            let (outcome, changed) = dispatch_project_replacement(
                engine,
                "cad_load_project_model",
                &json!({"model_json":ticket.model_json()}),
            );
            if changed {
                if outcome.is_ok() {
                    replacement.native_history = history;
                }
                retire_project_publisher(
                    publisher,
                    &expected.window_id,
                    &expected.document_id,
                    &self.process_instance_id,
                    replacement,
                );
            }
            outcome?
        } else {
            let document = engine.document_snapshot();
            if redo {
                match publisher
                    .active_mut()
                    .native_history
                    .redo_step(&before, document.rollback_index, document.features.len())?
                    .ok_or(nothing)?
                {
                    RedoStep::Rollback(index) => mutate(
                        engine,
                        publisher,
                        expected,
                        &self.process_instance_id,
                        "solid_set_rollback",
                        &json!({"rollback_index":index}),
                    )?,
                    RedoStep::Restore(ticket) => {
                        // Preflight policy before touching the model. Carry
                        // only shared immutable snapshots, not the old lease.
                        let mut replacement = ProjectPublisher::new();
                        let after_owner =
                            context(&expected.window_id, &expected.document_id, &replacement);
                        let mut history = publisher.active_mut().native_history.clone();
                        history.commit_redo(ticket.clone(), state(&after_owner, &replacement))?;
                        let (outcome, changed) = dispatch_project_replacement(
                            engine,
                            "cad_load_project_model",
                            &json!({"model_json":ticket.model_json()}),
                        );
                        if changed {
                            if outcome.is_ok() {
                                replacement.native_history = history;
                            }
                            // A partial failed load retires old ownership and
                            // discards history whose model is no longer known.
                            retire_project_publisher(
                                publisher,
                                &expected.window_id,
                                &expected.document_id,
                                &self.process_instance_id,
                                replacement,
                            );
                        }
                        outcome?
                    }
                }
            } else {
                match native_history::undo_step(document.rollback_index, document.features.len())?
                    .ok_or(nothing)?
                {
                    UndoStep::Rollback(index) => mutate(
                        engine,
                        publisher,
                        expected,
                        &self.process_instance_id,
                        "solid_set_rollback",
                        &json!({"rollback_index":index}),
                    )?,
                    UndoStep::DeleteLatest => {
                        let feature = document.features.last().ok_or(nothing)?;
                        let model =
                            parse_engine_envelope(engine.engine_call("project_export_model", ""))?;
                        let model = model
                            .as_str()
                            .ok_or("Engine did not return a complete Undo model")?;
                        let history = &publisher.active_mut().native_history;
                        let ticket = history.prepare_undo(&before, model.to_owned())?;
                        let mut committed = history.clone();
                        let after = HistoryState {
                            context: expected.clone(),
                            engine_revision: before
                                .engine_revision
                                .checked_add(1)
                                .ok_or("Session engine revision exhausted")?,
                        };
                        committed.commit_undo(ticket, after)?;
                        let value = mutate(
                            engine,
                            publisher,
                            expected,
                            &self.process_instance_id,
                            "solid_delete_feature",
                            &json!({"feature_id":feature.id.0}),
                        )?;
                        publisher.active_mut().native_history = committed;
                        value
                    }
                }
            }
        };
        let project = publisher.active_mut();
        Ok(NativeMutationResult {
            context: context(&expected.window_id, &expected.document_id, project),
            engine_revision: project.engine_revision,
            value,
        })
    }
}

#[cfg(test)]
mod tests;
