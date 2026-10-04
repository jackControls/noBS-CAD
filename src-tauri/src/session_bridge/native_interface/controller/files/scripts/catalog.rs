//! The installed recipe catalog opens authored source; it never starts playback.
use super::*;
use std::{collections::VecDeque, sync::OnceLock};

pub(crate) struct Example {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub kind: String,
    pub source: String,
    pub preview: bool,
}
impl Example {
    pub fn group(&self) -> &'static str {
        match (self.id.as_str(), self.kind.as_str()) {
            ("fillet-basics", _) => "Start here",
            (_, "flagship-candidate") => "Complete designs",
            (_, "lesson") => "Feature lessons",
            (_, "assembly") => "Assembly lessons",
            (_, "manufacturing-coupon" | "calibration") => "Manufacturing coupons",
            _ => "Examples",
        }
    }
}

pub(super) fn examples() -> &'static [Example] {
    static EXAMPLES: OnceLock<Vec<Example>> = OnceLock::new();
    EXAMPLES.get_or_init(|| {
        let mut entries: Vec<_> = nbcad_mcp::script_examples()
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                Some(Example {
                    id: entry["id"].as_str()?.into(),
                    name: entry["name"].as_str()?.into(),
                    summary: entry["summary"].as_str()?.into(),
                    kind: entry["kind"].as_str()?.into(),
                    source: entry["source"].as_str()?.into(),
                    preview: entry["preview"].as_bool().unwrap_or(false),
                })
            })
            .collect();
        entries.sort_by_key(|entry| match entry.group() {
            "Start here" => 0,
            "Complete designs" => 1,
            "Feature lessons" => 2,
            "Assembly lessons" => 3,
            "Manufacturing coupons" => 4,
            _ => 5,
        });
        entries
    })
}

fn example(id: &str) -> Result<&'static Example, String> {
    examples()
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| format!("Recipe {id:?} is not included in this build"))
}

pub(crate) struct Pending {
    pub token: u64,
    pub example: &'static Example,
}
#[derive(Default)]
pub(crate) struct Library {
    pub open: bool,
    pub page: usize,
    next_token: u64,
    requests: VecDeque<Pending>,
}
impl Library {
    pub fn pending(&self) -> Option<&Pending> {
        self.requests.front()
    }
    fn queue(&mut self, example: &'static Example) -> Result<(), String> {
        if self
            .requests
            .iter()
            .any(|request| request.example.id == example.id)
        {
            return Ok(());
        }
        if self.requests.len() >= 16 {
            return Err("Finish opening pending recipes before opening another link".into());
        }
        self.next_token = self
            .next_token
            .checked_add(1)
            .ok_or("Recipe request sequence exhausted")?;
        self.requests.push_back(Pending {
            token: self.next_token,
            example,
        });
        Ok(())
    }
}

/// Feeds a raw `nbcad://recipe/ID` into the same startup open path macOS
/// GetURL and argv launches already use.
pub(crate) struct RecipeUrlDouble {
    url: String,
}

impl RecipeUrlDouble {
    pub(crate) fn new(url: impl Into<String>) -> Self {
        Self { url: url.into() }
    }

    pub(crate) fn deliver(self, world: &mut World) {
        super::super::super::open_startup_recipe(world, &self.url);
    }
}

pub(crate) fn open_recipe(world: &mut World, id: &str) -> Result<Value, String> {
    // Validate this receiving build before acknowledging URL/MCP delivery.
    let selected = example(id)?;
    let files = &mut world.resource_mut::<Files>();
    files.script.library.queue(selected)?;
    files.scripts = true;
    files.settings = false;
    files.menu = false;
    Ok(json!({"recipe":{"status":"queued","recipe":id}}))
}

pub(crate) fn cancel_open(world: &mut World, token: u64) -> Result<Value, String> {
    let state = &mut world.resource_mut::<Files>().script;
    if state
        .library
        .pending()
        .is_none_or(|request| request.token != token)
    {
        return Err("The queued recipe changed before it was cancelled".into());
    }
    state.library.requests.pop_front();
    state.status = Some("Recipe opening cancelled; current source retained.".into());
    Ok(json!({"recipe_cancelled":true}))
}

pub(crate) fn browse(world: &mut World) -> Result<Value, String> {
    editor::retain_source_error(world);
    let state = &mut world.resource_mut::<Files>().script;
    state.library.open = !state.library.open;
    state.editor_open = false;
    Ok(json!({"example_library":state.library.open}))
}

pub(crate) fn page(world: &mut World, index: usize) -> Result<Value, String> {
    let state = &mut world.resource_mut::<Files>().script;
    if !state.library.open {
        return Err("Open the example library first".into());
    }
    state.library.page = index.min(examples().len().saturating_sub(1));
    Ok(json!({"example_page":state.library.page}))
}

fn inspect_example(example: &'static Example) -> Result<Loaded, String> {
    let inspection = nbcad_mcp::inspect_script(json!({"source":example.source}))?;
    let mut loaded = inspected(None, inspection)?;
    // Use the same inspection's authored/expanded snapshot, as file loading does.
    loaded.example = Some(example);
    Ok(loaded)
}

pub(super) fn poll(world: &mut World) {
    if available(world).is_err() || worker::busy(world) {
        return;
    }
    let Some(selected) = world
        .resource::<Files>()
        .script
        .library
        .pending()
        .map(|request| request.example)
    else {
        return;
    };
    if world.resource::<Files>().script.dirty() || editor::limit_error(world).is_some() {
        // Keep the requested source queued while Save As / Discard / Cancel
        // remains reviewable in the existing source card. No document changes.
        let state = &mut world.resource_mut::<Files>().script;
        state.editor_open = true;
        state.library.open = false;
        return;
    }
    let handle = world.resource::<NativeInterfaceHandle>().clone();
    let result = begin_load(
        world,
        &handle,
        move || inspect_example(selected),
        "Opening installed recipe source; no commands have run",
    );
    let state = &mut world.resource_mut::<Files>().script;
    state.library.requests.pop_front();
    if let Err(error) = result {
        state.status = Some(error);
    } else {
        state.editor_open = state.loaded.is_some();
        state.library.open = false;
    }
}

#[path = "catalog/panel.rs"]
mod panel;
pub(crate) use panel::paint_library;

#[cfg(test)]
#[path = "catalog/tests.rs"]
mod tests;
