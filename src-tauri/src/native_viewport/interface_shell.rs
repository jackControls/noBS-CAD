//! Retained native controls on the existing application's Bevy surface.
//!
//! This is a renderer and input adapter, not a second document controller.
//! Human input and MCP resolve the same generational control key. The native
//! application reducer consumes the resulting action with its document owner.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use bevy::{
    prelude::*,
    text::FontWeight,
    ui::{CalculatedClip, ComputedStackIndex, UiGlobalTransform, UiSystems},
};
use nbcad_interface::{
    Canvas, Control, ControlInput, ControlKey, ControlRequest, DocumentContext, Field, KeyChord,
    KeyboardRoute, Rect as InterfaceRect, ResolvedControl, Surface, SurfaceFrame, SurfaceRegistry,
};

use super::ui::{ViewportUiAssets, ViewportUiTheme};

#[cfg(feature = "dev-bevy-host")]
pub(crate) mod fields;
pub(crate) mod ribbon;

const MAX_PENDING_ACTIONS: usize = 64;

/// Window pixels and surface pixels are distinct while the web shell is being
/// replaced. The 3D rectangle remains the frame's `viewport` canvas; it is not
/// inferred from the full client size or duplicated in another UI taxonomy.
#[derive(Debug, Clone, PartialEq)]
pub struct InterfaceFrame {
    pub context: DocumentContext,
    pub client: InterfaceRect,
    pub surface: InterfaceRect,
    pub canvases: Vec<Canvas>,
    pub surfaces: Vec<Surface>,
    pub modal_stack: Vec<String>,
    pub document_visible: bool,
}

impl InterfaceFrame {
    fn validate(&self) -> Result<(), String> {
        if !valid_rect(self.client) || !valid_rect(self.surface) {
            return Err("Native interface needs finite, positive client and surface bounds".into());
        }
        if !contains_rect(self.client, self.surface) {
            return Err("Native interface surface must fit inside the client area".into());
        }
        if self
            .canvases
            .iter()
            .any(|canvas| !valid_rect(canvas.bounds) || !contains_rect(self.client, canvas.bounds))
        {
            return Err("Native interface canvases must fit inside the client area".into());
        }
        Ok(())
    }

    /// Map physical native-child input to the logical application-window
    /// coordinates used by inspection. A scale change never rescales model data.
    pub fn physical_to_window(&self, point: [f64; 2], physical_size: [f64; 2]) -> Option<[f64; 2]> {
        if point
            .iter()
            .chain(physical_size.iter())
            .any(|v| !v.is_finite())
            || physical_size.iter().any(|v| *v <= 0.0)
        {
            return None;
        }
        Some([
            self.surface.x + point[0] * self.surface.width / physical_size[0],
            self.surface.y + point[1] * self.surface.height / physical_size[1],
        ])
    }
}

/// Metadata on an actual retained Bevy widget. Identity and hit bounds are
/// obtained from its entity and computed layout, never supplied by a client.
#[derive(Component, Debug, Clone, PartialEq)]
pub struct InterfaceControl {
    /// Advance when this retained widget is rebound to another native action
    /// or target, even when its visible label does not change.
    pub binding: u64,
    pub surface: String,
    pub label: String,
    pub role: String,
    pub visible: bool,
    pub disabled: bool,
    pub expanded: Option<bool>,
    pub selected: Option<bool>,
    pub field: Field,
    pub modal_scope: Option<String>,
    pub text_editing: bool,
    pub owned_keys: Vec<KeyChord>,
}

/// The text adapter changes this only for buffer/selection edits. Camera or
/// font-layout updates must not clone long editor values into every frame.
#[derive(Component, Default)]
pub(crate) struct InterfaceTextRevision(pub u64);

/// A painted panel blocks model picking without inventing an actionable
/// control for its background. Its children retain normal control semantics.
#[derive(Component)]
pub(crate) struct InterfaceOccluder;

impl InterfaceControl {
    pub fn button(surface: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            binding: 1,
            surface: surface.into(),
            label: label.into(),
            role: "button".into(),
            visible: true,
            disabled: false,
            expanded: None,
            selected: None,
            field: Field::None,
            modal_scope: None,
            text_editing: false,
            owned_keys: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeInterfaceAction {
    pub context: DocumentContext,
    pub control: ResolvedControl,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeModalKey {
    pub context: DocumentContext,
    pub modal_scope: String,
    pub key: KeyChord,
    generation: u64,
    controls: Vec<(ControlKey, u64)>,
}

/// Layout is usable even while minimized. Submission only records completion
/// of a host render update; it does not certify GPU presentation or visibility.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RenderReceipt {
    pub laid_out_revision: u64,
    pub submitted_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointerPhase {
    Move,
    Down,
    Up,
    DoubleClick,
    Leave,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointerButton {
    Primary,
    Secondary,
}

#[derive(Debug, Clone)]
struct Capture {
    resolved: ResolvedControl,
    context: DocumentContext,
    button: PointerButton,
}

struct Shared {
    registry: SurfaceRegistry,
    desired_frame: Option<InterfaceFrame>,
    presented_frame: Option<InterfaceFrame>,
    hit_order: Vec<(Option<ControlKey>, InterfaceRect)>,
    receipt: RenderReceipt,
    submission_waiter: Option<u64>,
    render_dirty: bool,
    modal_generation: u64,
    modal_focus: Vec<(String, Option<ControlKey>)>,
    hovered: Option<ControlKey>,
    focused: Option<ControlKey>,
    capture: Option<Capture>,
    actions: VecDeque<NativeInterfaceAction>,
    modal_keys: VecDeque<NativeModalKey>,
    revision: u64,
}

impl Default for Shared {
    fn default() -> Self {
        Self {
            registry: SurfaceRegistry::new(),
            desired_frame: None,
            presented_frame: None,
            hit_order: Vec::new(),
            receipt: RenderReceipt::default(),
            submission_waiter: None,
            render_dirty: false,
            modal_generation: 0,
            modal_focus: Vec::new(),
            hovered: None,
            focused: None,
            capture: None,
            actions: VecDeque::new(),
            modal_keys: VecDeque::new(),
            revision: 0,
        }
    }
}

/// Shared transport/input endpoint. It never owns a second SketchManager and
/// never dispatches commands through DOM nodes. `wake` schedules the existing
/// event-driven renderer after presentation or input changes.
#[derive(Resource, Clone)]
pub struct NativeInterfaceHandle {
    shared: Arc<Mutex<Shared>>,
    wake: Arc<dyn Fn() + Send + Sync>,
}

impl NativeInterfaceHandle {
    pub fn new(wake: impl Fn() + Send + Sync + 'static) -> Self {
        Self {
            shared: Arc::new(Mutex::new(Shared::default())),
            wake: Arc::new(wake),
        }
    }

    pub fn present(&self, frame: InterfaceFrame) -> Result<(), String> {
        frame.validate()?;
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if shared.desired_frame.as_ref() == Some(&frame) {
            return Ok(());
        }
        let old_modals = shared
            .desired_frame
            .as_ref()
            .map(|old| old.modal_stack.clone())
            .unwrap_or_default();
        if old_modals != frame.modal_stack {
            shared.modal_generation = shared.modal_generation.saturating_add(1);
        }
        // Revoke input immediately, before the renderer publishes a replacement
        // tab. An old control cannot mutate the new active document in between.
        if shared.desired_frame.as_ref().map(|f| &f.context) != Some(&frame.context) {
            shared.capture = None;
            shared.focused = None;
            shared.hovered = None;
            shared.actions.clear();
            shared.modal_keys.clear();
            shared.modal_focus.clear();
        } else {
            let common = old_modals
                .iter()
                .zip(&frame.modal_stack)
                .take_while(|(old, next)| old == next)
                .count();
            while shared.modal_focus.len() > common {
                if let Some((_, previous)) = shared.modal_focus.pop() {
                    shared.focused = previous;
                }
            }
            for scope in frame.modal_stack.iter().skip(common) {
                let previous = shared.focused;
                shared.modal_focus.push((scope.clone(), previous));
                shared.focused = None;
            }
        }
        shared.desired_frame = Some(frame);
        shared.revision = shared.revision.wrapping_add(1);
        drop(shared);
        (self.wake)();
        Ok(())
    }

    pub fn inspect(&self) -> Result<serde_json::Value, String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        current_context(&shared)?;
        shared.registry.inspect().map_err(|e| e.to_string())
    }

    /// Read native presentation metadata without copying editor buffers or
    /// consuming MCP inspection IDs. The callback must not re-enter the handle.
    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn read_surface<T>(
        &self,
        read: impl FnOnce(&DocumentContext, &SurfaceFrame) -> T,
    ) -> Result<T, String> {
        let shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        let context = current_context(&shared)?;
        Ok(read(&context, shared.registry.frame()))
    }

    /// Assistive input uses the same stamped control as pointer and MCP input.
    /// A queued accessibility request cannot follow a control rebind or tab.
    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn assistive_action(
        &self,
        action: &NativeInterfaceAction,
        activate: bool,
    ) -> Result<(), String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if current_context(&shared)? != action.context {
            return Err("Native interface document changed".into());
        }
        shared
            .registry
            .validate_resolved(&action.control, &action.context)
            .map_err(|error| error.to_string())?;
        if activate && shared.actions.len() >= MAX_PENDING_ACTIONS {
            return Err("Native interface is busy".into());
        }
        set_focus(&mut shared, Some(action.control.key))?;
        if activate {
            shared.actions.push_back(action.clone());
        }
        shared.revision = shared.revision.wrapping_add(1);
        drop(shared);
        (self.wake)();
        Ok(())
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn resolve_retained(
        &self,
        key: ControlKey,
    ) -> Result<NativeInterfaceAction, String> {
        let shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        let context = current_context(&shared)?;
        let control = shared
            .registry
            .resolve_key(key, ControlInput::Click, &context)
            .map_err(|error| error.to_string())?;
        Ok(NativeInterfaceAction { context, control })
    }

    /// The MCP path returns the exact same owned action as human input. The
    /// caller applies it through the native reducer and returns its real result.
    pub fn resolve(
        &self,
        request: &ControlRequest,
        context: &DocumentContext,
    ) -> Result<NativeInterfaceAction, String> {
        let shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if current_context(&shared)? != *context {
            return Err("Native interface document changed".into());
        }
        let control = shared
            .registry
            .resolve(request, context)
            .map_err(|e| e.to_string())?;
        Ok(NativeInterfaceAction {
            context: context.clone(),
            control,
        })
    }

    /// Revalidate queued human input immediately before applying it. Removed,
    /// disabled, covered or replaced controls are rejected by the same registry.
    pub fn validate_action(&self, action: &NativeInterfaceAction) -> Result<(), String> {
        let shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if current_context(&shared)? != action.context {
            return Err("Native interface document changed".into());
        }
        shared
            .registry
            .validate_resolved(&action.control, &action.context)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Give a resolved direct/API action the same focus transition as a native
    /// press. The caller still performs the one authoritative reduction; this
    /// method does not enqueue or run the command a second time.
    pub(crate) fn prepare_activation(&self, action: &NativeInterfaceAction) -> Result<(), String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if current_context(&shared)? != action.context {
            return Err("Native interface document changed".into());
        }
        shared
            .registry
            .validate_resolved(&action.control, &action.context)
            .map_err(|error| error.to_string())?;
        set_focus(&mut shared, Some(action.control.key))?;
        shared.revision = shared.revision.wrapping_add(1);
        drop(shared);
        (self.wake)();
        Ok(())
    }

    pub fn take_actions(&self) -> Result<Vec<NativeInterfaceAction>, String> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?
            .actions
            .drain(..)
            .collect())
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn resolve_input(
        &self,
        key: ControlKey,
        input: ControlInput,
        context: &DocumentContext,
    ) -> Result<NativeInterfaceAction, String> {
        let shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if current_context(&shared)? != *context {
            return Err("Native interface document changed".into());
        }
        let control = shared
            .registry
            .resolve_key(key, input, context)
            .map_err(|e| e.to_string())?;
        Ok(NativeInterfaceAction {
            context: context.clone(),
            control,
        })
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn enqueue_action(&self, action: NativeInterfaceAction) -> Result<(), String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if current_context(&shared)? != action.context {
            return Err("Native interface document changed".into());
        }
        shared
            .registry
            .validate_resolved(&action.control, &action.context)
            .map_err(|e| e.to_string())?;
        if shared.actions.len() >= MAX_PENDING_ACTIONS {
            return Err("Native interface is busy".into());
        }
        shared.actions.push_back(action);
        drop(shared);
        (self.wake)();
        Ok(())
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn focused_key(&self) -> Option<ControlKey> {
        self.shared.lock().ok()?.focused
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn hit_key(&self, point: [f64; 2]) -> Option<ControlKey> {
        let shared = self.shared.lock().ok()?;
        hit(&shared, point)
    }

    pub(crate) fn owns_pointer(&self, point: [f64; 2]) -> bool {
        self.shared.lock().is_ok_and(|shared| {
            shared
                .hit_order
                .iter()
                .any(|(_, rect)| contains_point(*rect, point))
        })
    }

    pub fn take_modal_keys(&self) -> Result<Vec<NativeModalKey>, String> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?
            .modal_keys
            .drain(..)
            .collect())
    }

    pub fn validate_modal_key(&self, request: &NativeModalKey) -> Result<(), String> {
        let shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if current_context(&shared)? != request.context
            || shared.modal_generation != request.generation
            || shared.registry.frame().modal_stack.last() != Some(&request.modal_scope)
            || modal_controls(&shared, &request.modal_scope) != request.controls
        {
            return Err("Native modal changed before keyboard input could run".into());
        }
        Ok(())
    }

    pub(crate) fn request_redraw(&self) {
        (self.wake)();
    }

    pub(crate) fn invalidate_presentation(&self) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.render_dirty = true;
        }
        (self.wake)();
    }

    /// Called after the host submitted this Bevy update. This is a render
    /// submission receipt, not a claim that the GPU/display has presented it.
    pub(crate) fn submitted(&self) -> Result<(), String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        shared.receipt.submitted_revision = shared.receipt.laid_out_revision;
        Ok(())
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn submitted_revision(&self, revision: u64) -> Result<(), String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        if revision > shared.receipt.laid_out_revision {
            return Err("Render submitted an unknown interface revision".into());
        }
        shared.receipt.submitted_revision = shared.receipt.submitted_revision.max(revision);
        let wake = shared
            .submission_waiter
            .is_some_and(|target| target <= revision);
        if wake {
            shared.submission_waiter = None;
        }
        drop(shared);
        if wake {
            (self.wake)();
        }
        Ok(())
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn wait_for_submission(&self, revision: u64) -> bool {
        let Ok(mut shared) = self.shared.lock() else {
            return false;
        };
        if shared.receipt.submitted_revision >= revision {
            return true;
        }
        shared.submission_waiter = Some(revision);
        false
    }

    #[cfg(feature = "dev-bevy-host")]
    pub(crate) fn cancel_submission_wait(&self) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.submission_waiter = None;
        }
    }

    pub fn render_receipt(&self) -> Option<RenderReceipt> {
        Some(self.shared.lock().ok()?.receipt)
    }

    pub fn frame(&self) -> Option<InterfaceFrame> {
        self.shared.lock().ok()?.presented_frame.clone()
    }

    pub fn has_capture(&self) -> bool {
        self.shared
            .lock()
            .is_ok_and(|shared| shared.capture.is_some())
    }

    /// Cancellation never activates the captured control, even while a newer
    /// semantic frame is waiting for layout.
    pub(crate) fn cancel_pointer(&self) {
        if let Ok(mut shared) = self.shared.lock() {
            let changed = shared.capture.take().is_some() || shared.hovered.is_some();
            shared.hovered = None;
            if changed {
                shared.revision = shared.revision.wrapping_add(1);
                drop(shared);
                (self.wake)();
            }
        }
    }

    /// Returns true only when the native interface owns this gesture. A press
    /// captures through release/cancel, even after leaving the original bounds.
    pub fn pointer(
        &self,
        phase: PointerPhase,
        position: [f64; 2],
        button: PointerButton,
    ) -> Result<bool, String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        let context = match current_context(&shared) {
            Ok(context) => context,
            Err(_) => {
                return Ok(hit(&shared, position).is_some()
                    || shared.capture.is_some()
                    || has_modal(&shared))
            }
        };
        if position.iter().any(|v| !v.is_finite()) {
            return Err("Pointer coordinates must be finite".into());
        }
        let key = hit(&shared, position);
        let had_capture = shared.capture.is_some();
        let old_hovered = shared.hovered;
        let consumed = had_capture
            || shared
                .hit_order
                .iter()
                .any(|(_, rect)| contains_point(*rect, position))
            || has_modal(&shared);
        match phase {
            PointerPhase::Move => shared.hovered = key,
            PointerPhase::Leave => shared.hovered = None,
            PointerPhase::Cancel => {
                shared.hovered = None;
                shared.capture = None;
            }
            PointerPhase::Down => {
                shared.capture = None;
                if let Some(key) = key {
                    let resolved = shared
                        .registry
                        .resolve_key(key, activation(button), &context)
                        .map_err(|e| e.to_string())?;
                    set_focus(&mut shared, Some(key))?;
                    shared.capture = Some(Capture {
                        resolved,
                        context,
                        button,
                    });
                }
            }
            PointerPhase::Up => {
                if let Some(capture) = shared.capture.take() {
                    if capture.context == context
                        && capture.button == button
                        && Some(capture.resolved.key) == key
                    {
                        shared
                            .registry
                            .validate_resolved(&capture.resolved, &context)
                            .map_err(|e| e.to_string())?;
                        if shared.actions.len() >= MAX_PENDING_ACTIONS {
                            return Err("Native interface is busy".into());
                        }
                        shared.actions.push_back(NativeInterfaceAction {
                            context,
                            control: capture.resolved,
                        });
                    }
                }
            }
            PointerPhase::DoubleClick => {
                shared.capture = None;
                if let Some(key) = key {
                    enqueue(&mut shared, key, ControlInput::DoubleClick, &context)?;
                }
            }
        }
        shared.revision = shared.revision.wrapping_add(1);
        let changed_hover = old_hovered != shared.hovered;
        drop(shared);
        if consumed || changed_hover {
            (self.wake)();
        }
        Ok(consumed)
    }

    pub fn key(&self, key: KeyChord) -> Result<bool, String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        let context = match current_context(&shared) {
            Ok(context) => context,
            Err(_) => return Ok(has_modal(&shared)),
        };
        if let Some(modal_scope) = shared
            .registry
            .frame()
            .modal_stack
            .last()
            .cloned()
            .filter(|_| key.key == "Escape" || shared.focused.is_none())
        {
            if shared.modal_keys.len() >= MAX_PENDING_ACTIONS {
                return Err("Native interface is busy".into());
            }
            let generation = shared.modal_generation;
            let controls = modal_controls(&shared, &modal_scope);
            shared.modal_keys.push_back(NativeModalKey {
                context,
                modal_scope,
                key,
                generation,
                controls,
            });
        } else if let Some(control) = shared.focused {
            if shared
                .registry
                .keyboard_route(&context, &key)
                .map_err(|e| e.to_string())?
                == KeyboardRoute::Model
            {
                return Ok(false);
            }
            enqueue(&mut shared, control, ControlInput::Key(key), &context)?;
        } else {
            return Ok(false);
        }
        drop(shared);
        (self.wake)();
        Ok(true)
    }

    pub fn focus_next(&self, backwards: bool) -> Result<bool, String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Native interface lock poisoned")?;
        let context = match current_context(&shared) {
            Ok(context) => context,
            Err(_) => return Ok(has_modal(&shared)),
        };
        let keys: Vec<_> = shared
            .registry
            .frame()
            .controls
            .iter()
            .filter(|control| {
                shared
                    .registry
                    .resolve_key(control.key, ControlInput::Click, &context)
                    .is_ok()
            })
            .map(|control| control.key)
            .collect();
        if keys.is_empty() {
            return Ok(has_modal(&shared));
        }
        let index = shared
            .focused
            .and_then(|key| keys.iter().position(|candidate| *candidate == key));
        let next = match (index, backwards) {
            (Some(index), false) => (index + 1) % keys.len(),
            (Some(index), true) => (index + keys.len() - 1) % keys.len(),
            (None, false) => 0,
            (None, true) => keys.len() - 1,
        };
        set_focus(&mut shared, Some(keys[next]))?;
        shared.revision = shared.revision.wrapping_add(1);
        drop(shared);
        (self.wake)();
        Ok(true)
    }

    pub fn blur(&self) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.capture = None;
            let _ = set_focus(&mut shared, None);
            shared.hovered = None;
            shared.revision = shared.revision.wrapping_add(1);
        }
        (self.wake)();
    }
}

fn modal_controls(shared: &Shared, scope: &str) -> Vec<(ControlKey, u64)> {
    let mut controls: Vec<_> = shared
        .registry
        .frame()
        .controls
        .iter()
        .filter(|control| control.modal_scope.as_deref() == Some(scope))
        .map(|control| (control.key, control.binding))
        .collect();
    controls.sort_by_key(|(key, _)| key.0);
    controls
}

fn set_focus(shared: &mut Shared, focused: Option<ControlKey>) -> Result<(), String> {
    let context = shared
        .registry
        .context()
        .cloned()
        .ok_or("Native interface has no document")?;
    let mut frame = shared.registry.frame().clone();
    frame.focused = focused;
    shared
        .registry
        .replace(context, frame)
        .map_err(|e| e.to_string())?;
    shared.focused = focused;
    Ok(())
}

fn current_context(shared: &Shared) -> Result<DocumentContext, String> {
    let desired = shared
        .desired_frame
        .as_ref()
        .ok_or("Native interface has no document")?;
    let presented = shared
        .presented_frame
        .as_ref()
        .ok_or("Native interface has not been laid out")?;
    if desired != presented {
        return Err("Native interface transition is pending".into());
    }
    Ok(presented.context.clone())
}

fn has_modal(shared: &Shared) -> bool {
    shared
        .desired_frame
        .as_ref()
        .is_some_and(|frame| !frame.modal_stack.is_empty())
        || !shared.registry.frame().modal_stack.is_empty()
}

fn activation(button: PointerButton) -> ControlInput {
    match button {
        PointerButton::Primary => ControlInput::Click,
        PointerButton::Secondary => ControlInput::ContextMenu,
    }
}

fn enqueue(
    shared: &mut Shared,
    key: ControlKey,
    input: ControlInput,
    context: &DocumentContext,
) -> Result<(), String> {
    if shared.actions.len() >= MAX_PENDING_ACTIONS {
        return Err("Native interface is busy; wait for the pending command".into());
    }
    let control = shared
        .registry
        .resolve_key(key, input, context)
        .map_err(|e| e.to_string())?;
    shared.actions.push_back(NativeInterfaceAction {
        context: context.clone(),
        control,
    });
    Ok(())
}

fn hit(shared: &Shared, point: [f64; 2]) -> Option<ControlKey> {
    shared
        .hit_order
        .iter()
        .rev()
        .find(|(_, rect)| contains_point(*rect, point))
        .and_then(|(key, _)| *key)
}

fn valid_rect(rect: InterfaceRect) -> bool {
    [
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        rect.x + rect.width,
        rect.y + rect.height,
    ]
    .iter()
    .all(|v| v.is_finite())
        && rect.width > 0.0
        && rect.height > 0.0
}

fn contains_point(rect: InterfaceRect, point: [f64; 2]) -> bool {
    point[0] >= rect.x
        && point[0] < rect.x + rect.width
        && point[1] >= rect.y
        && point[1] < rect.y + rect.height
}

fn contains_rect(outer: InterfaceRect, inner: InterfaceRect) -> bool {
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height
}

#[derive(Component)]
struct InterfaceLabel(Entity);

#[derive(Component)]
struct InterfaceButtonStyle(ViewportUiTheme);

/// Create a genuine retained button; root attaches its typed native command to
/// the returned entity. Updating `InterfaceControl` changes this same widget.
pub(crate) fn spawn_button(
    commands: &mut Commands,
    camera: Entity,
    node: Node,
    control: InterfaceControl,
    theme: ViewportUiTheme,
    assets: &ViewportUiAssets,
) -> Entity {
    let label = commands
        .spawn((
            Text::new(control.label.clone()),
            theme.text(assets, 12.0, FontWeight::SEMIBOLD),
            TextColor(theme.ink),
        ))
        .id();
    commands
        .spawn((
            Name::new(format!("Native interface: {}", control.label)),
            control,
            node,
            UiTargetCamera(camera),
            InterfaceLabel(label),
            InterfaceButtonStyle(theme),
            BackgroundColor(theme.panel),
            BorderColor::all(theme.edge),
            ZIndex(30),
        ))
        .add_child(label)
        .id()
}

#[derive(Resource, Clone)]
struct InterfaceReducer(Arc<dyn Fn(&mut World, &NativeInterfaceHandle) + Send + Sync>);

#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct InterfaceLayout;

#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct InterfaceReduction;

pub(crate) fn install(
    app: &mut App,
    handle: NativeInterfaceHandle,
    reducer: impl Fn(&mut World, &NativeInterfaceHandle) + Send + Sync + 'static,
) {
    app.insert_resource(handle)
        .insert_resource(InterfaceReducer(Arc::new(reducer)))
        .add_systems(Startup, setup_camera)
        .add_systems(
            Update,
            (
                drain_actions.in_set(InterfaceReduction),
                update_controls,
                ribbon::update_glyphs,
            )
                .chain(),
        )
        .add_systems(
            PostUpdate,
            publish_layout
                .in_set(InterfaceLayout)
                .after(UiSystems::Stack)
                .after(bevy::camera::visibility::VisibilitySystems::VisibilityPropagate),
        );
}

fn drain_actions(world: &mut World) {
    let reducer = world.resource::<InterfaceReducer>().clone();
    let handle = world.resource::<NativeInterfaceHandle>().clone();
    (reducer.0)(world, &handle);
}

/// Full-surface interface camera, separate from the CAD camera's inner viewport.
#[derive(Component)]
pub struct InterfaceCamera;

fn setup_camera(mut commands: Commands) {
    commands.spawn((
        Name::new("Native application interface camera"),
        InterfaceCamera,
        Camera2d,
        // UI targets this camera explicitly. World-space gizmos must only be
        // rendered by the CAD cameras, never again as orthographic UI pixels.
        bevy::camera::visibility::RenderLayers::none(),
        Camera {
            order: 2,
            is_active: false,
            clear_color: bevy::camera::ClearColorConfig::None,
            ..default()
        },
    ));
}

fn update_controls(
    handle: Res<NativeInterfaceHandle>,
    mut controls: Query<(
        Entity,
        &InterfaceControl,
        &InterfaceLabel,
        &InterfaceButtonStyle,
        Option<&ribbon::RibbonButton>,
        &mut Node,
        &mut BackgroundColor,
        &mut BorderColor,
    )>,
    mut labels: Query<(&mut Text, &mut TextColor)>,
    mut cameras: Query<&mut Camera, With<InterfaceCamera>>,
) {
    let Ok(shared) = handle.shared.lock() else {
        return;
    };
    let active =
        shared.desired_frame.is_some() && controls.iter().any(|(_, control, ..)| control.visible);
    for mut camera in &mut cameras {
        if camera.is_active != active {
            camera.is_active = active;
        }
    }
    for (entity, control, label, style, ribbon, mut node, mut background, mut border) in
        &mut controls
    {
        let key = ControlKey(entity.to_bits());
        let theme = style.0;
        let active = control.selected == Some(true)
            || shared
                .capture
                .as_ref()
                .is_some_and(|capture| capture.resolved.key == key);
        let display = if control.visible {
            Display::Flex
        } else {
            Display::None
        };
        if node.display != display {
            node.display = display;
        }
        let fill = if let Some(ribbon) = ribbon {
            ribbon.fill(theme, active, shared.hovered == Some(key), control.disabled)
        } else if active {
            theme.accent_soft
        } else if shared.hovered == Some(key) {
            theme.hover
        } else {
            theme.panel
        };
        if background.0 != fill {
            background.0 = fill;
        }
        let edge = BorderColor::all(if shared.focused == Some(key) {
            theme.accent
        } else if ribbon.is_some() {
            Color::NONE
        } else {
            theme.edge
        });
        if *border != edge {
            *border = edge;
        }
        if let Ok((mut text, mut color)) = labels.get_mut(label.0) {
            if text.0 != control.label {
                text.0.clone_from(&control.label);
            }
            let ink = if let Some(ribbon) = ribbon {
                ribbon.ink(theme, control.disabled)
            } else if control.disabled {
                theme.mute
            } else if active {
                theme.accent
            } else {
                theme.ink
            };
            if color.0 != ink {
                color.0 = ink;
            }
        }
    }
}

fn publish_layout(
    handle: Res<NativeInterfaceHandle>,
    controls: Query<(
        Entity,
        Ref<InterfaceControl>,
        Ref<ComputedNode>,
        Ref<UiGlobalTransform>,
        Ref<ComputedStackIndex>,
        Option<Ref<CalculatedClip>>,
        Option<Ref<InheritedVisibility>>,
        Option<&bevy::text::EditableText>,
        Option<Ref<InterfaceTextRevision>>,
    )>,
    occluders: Query<
        (
            Ref<ComputedNode>,
            Ref<UiGlobalTransform>,
            Ref<ComputedStackIndex>,
            Option<Ref<CalculatedClip>>,
            Ref<InheritedVisibility>,
        ),
        With<InterfaceOccluder>,
    >,
    mut removed_occluders: RemovedComponents<InterfaceOccluder>,
    mut removed: RemovedComponents<InterfaceControl>,
    mut removed_clips: RemovedComponents<CalculatedClip>,
    mut last_revision: Local<Option<u64>>,
) {
    let Ok(mut shared) = handle.shared.lock() else {
        return;
    };
    let removed = removed.read().count() > 0
        || removed_clips.read().count() > 0
        || removed_occluders.read().count() > 0;
    if *last_revision == Some(shared.revision)
        && !removed
        && !occluders
            .iter()
            .any(|(node, transform, stack, clip, visibility)| {
                node.is_changed()
                    || transform.is_changed()
                    || stack.is_changed()
                    || clip.as_ref().is_some_and(|clip| clip.is_changed())
                    || visibility.is_changed()
            })
        && !controls.iter().any(
            |(_, control, node, transform, stack, clip, visibility, _, text)| {
                control.is_changed()
                    || node.is_changed()
                    || transform.is_changed()
                    || stack.is_changed()
                    || clip.as_ref().is_some_and(|clip| clip.is_changed())
                    || visibility
                        .as_ref()
                        .is_some_and(|visibility| visibility.is_changed())
                    || text.as_ref().is_some_and(|revision| revision.is_changed())
            },
        )
    {
        if shared.render_dirty {
            shared.receipt.laid_out_revision = shared.receipt.laid_out_revision.saturating_add(1);
            shared.render_dirty = false;
        }
        return;
    }
    let Some(frame) = shared.desired_frame.clone() else {
        return;
    };
    let mut stacked: Vec<_> = controls
        .iter()
        .map(
            |(entity, control, computed, transform, stack, clip, visibility, editor, _)| {
                let scale = f64::from(computed.inverse_scale_factor());
                let half = computed.size() * 0.5;
                let corners = [
                    Vec2::new(-half.x, -half.y),
                    Vec2::new(half.x, -half.y),
                    Vec2::new(half.x, half.y),
                    Vec2::new(-half.x, half.y),
                ]
                .map(|point| transform.transform_point2(point));
                let min = corners
                    .into_iter()
                    .fold(Vec2::splat(f32::INFINITY), Vec2::min)
                    .as_dvec2()
                    * scale;
                let max = corners
                    .into_iter()
                    .fold(Vec2::splat(f32::NEG_INFINITY), Vec2::max)
                    .as_dvec2()
                    * scale;
                let mut bounds = InterfaceRect {
                    x: frame.surface.x + min.x,
                    y: frame.surface.y + min.y,
                    width: max.x - min.x,
                    height: max.y - min.y,
                };
                if let Some(clip) = clip {
                    bounds = intersection(
                        bounds,
                        InterfaceRect {
                            x: frame.surface.x + f64::from(clip.clip.min.x) * scale,
                            y: frame.surface.y + f64::from(clip.clip.min.y) * scale,
                            width: f64::from(clip.clip.width()) * scale,
                            height: f64::from(clip.clip.height()) * scale,
                        },
                    );
                }
                bounds = intersection(bounds, frame.surface);
                (
                    stack.0,
                    Control {
                        key: ControlKey(entity.to_bits()),
                        binding: control.binding,
                        surface: control.surface.clone(),
                        label: control.label.clone(),
                        role: control.role.clone(),
                        bounds,
                        visible: control.visible
                            && bounds.width > 0.0
                            && bounds.height > 0.0
                            && visibility
                                .as_ref()
                                .is_some_and(|visibility| visibility.get()),
                        disabled: control.disabled,
                        expanded: control.expanded,
                        selected: control.selected,
                        field: match (&control.field, editor) {
                            (Field::Text { read_only, .. }, Some(editor)) => {
                                let value = editor.value().to_string();
                                let range = editor.editor.raw_selection().text_range();
                                let selection = if editor.is_composing() {
                                    None
                                } else {
                                    value.get(..range.start).zip(value.get(..range.end)).map(
                                        |(start, end)| nbcad_interface::TextSelection {
                                            start: start.encode_utf16().count(),
                                            end: end.encode_utf16().count(),
                                        },
                                    )
                                };
                                Field::Text {
                                    value,
                                    read_only: *read_only,
                                    selection,
                                }
                            }
                            _ => control.field.clone(),
                        },
                        modal_scope: control.modal_scope.clone(),
                        text_editing: control.text_editing,
                        owned_keys: control.owned_keys.clone(),
                    },
                )
            },
        )
        .collect();
    stacked.sort_by_key(|(stack, _)| *stack);
    let mut hits: Vec<_> = stacked
        .iter()
        .filter(|(_, control)| control.visible)
        .map(|(stack, control)| (*stack, Some(control.key), control.bounds))
        .collect();
    for (node, transform, stack, clip, visibility) in &occluders {
        if !visibility.get() {
            continue;
        }
        let half = node.size() * 0.5;
        let corners = [
            Vec2::new(-half.x, -half.y),
            Vec2::new(half.x, -half.y),
            Vec2::new(half.x, half.y),
            Vec2::new(-half.x, half.y),
        ]
        .map(|point| transform.transform_point2(point));
        let scale = f64::from(node.inverse_scale_factor());
        let min = corners
            .into_iter()
            .fold(Vec2::splat(f32::INFINITY), Vec2::min)
            .as_dvec2()
            * scale;
        let max = corners
            .into_iter()
            .fold(Vec2::splat(f32::NEG_INFINITY), Vec2::max)
            .as_dvec2()
            * scale;
        let mut bounds = intersection(
            InterfaceRect {
                x: frame.surface.x + min.x,
                y: frame.surface.y + min.y,
                width: max.x - min.x,
                height: max.y - min.y,
            },
            frame.surface,
        );
        if let Some(clip) = clip {
            bounds = intersection(
                bounds,
                InterfaceRect {
                    x: frame.surface.x + f64::from(clip.clip.min.x) * scale,
                    y: frame.surface.y + f64::from(clip.clip.min.y) * scale,
                    width: f64::from(clip.clip.width()) * scale,
                    height: f64::from(clip.clip.height()) * scale,
                },
            );
        }
        if bounds.width > 0. && bounds.height > 0. {
            hits.push((stack.0, None, bounds));
        }
    }
    hits.sort_by_key(|(stack, _, _)| *stack);
    let hits = hits
        .into_iter()
        .map(|(_, key, bounds)| (key, bounds))
        .collect();
    let mut published: Vec<_> = stacked.into_iter().map(|(_, control)| control).collect();
    // Stable keyboard traversal independent of ECS archetype movement.
    published.sort_by(|a, b| {
        a.bounds
            .y
            .total_cmp(&b.bounds.y)
            .then(a.bounds.x.total_cmp(&b.bounds.x))
            .then(a.key.0.cmp(&b.key.0))
    });
    let eligible = |key| {
        published.iter().any(|control| {
            control.key == key
                && control.visible
                && !control.disabled
                && frame
                    .modal_stack
                    .last()
                    .is_none_or(|modal| control.modal_scope.as_ref() == Some(modal))
        })
    };
    shared.focused = shared.focused.filter(|key| eligible(*key));
    shared.hovered = shared.hovered.filter(|key| eligible(*key));
    if shared
        .capture
        .as_ref()
        .is_some_and(|capture| !eligible(capture.resolved.key))
    {
        shared.capture = None;
    }
    let next = SurfaceFrame {
        client: frame.client,
        controls: published,
        surfaces: frame.surfaces.clone(),
        canvases: frame.canvases.clone(),
        focused: shared.focused,
        modal_stack: frame.modal_stack.clone(),
        document_visible: frame.document_visible,
    };
    let changed =
        shared.registry.context() != Some(&frame.context) || shared.registry.frame() != &next;
    if changed {
        if let Err(error) = shared.registry.replace(frame.context.clone(), next) {
            eprintln!("Native interface frame rejected: {error}");
            return;
        }
    }
    if changed || shared.render_dirty {
        shared.receipt.laid_out_revision = shared.receipt.laid_out_revision.saturating_add(1);
        shared.render_dirty = false;
    }
    shared.hit_order = hits;
    shared.presented_frame = Some(frame);
    *last_revision = Some(shared.revision);
}

fn intersection(a: InterfaceRect, b: InterfaceRect) -> InterfaceRect {
    let x = a.x.max(b.x);
    let y = a.y.max(b.y);
    InterfaceRect {
        x,
        y,
        width: (a.x + a.width).min(b.x + b.width).max(x) - x,
        height: (a.y + a.height).min(b.y + b.height).max(y) - y,
    }
}

#[cfg(test)]
pub(crate) mod tests;
