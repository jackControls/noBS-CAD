//! One collection of authored construction sources, not another interpreter.
//! The app, MCP and xtask all discover these recipes through this catalog.
use serde_json::{json, Value};

pub struct Recipe {
    pub id: &'static str,
    pub source: &'static str,
    pub summary: &'static str,
    pub kind: &'static str,
    pub focus_operations: &'static [&'static str],
    pub preview: bool,
}

pub const RECIPES: &[Recipe] = &[
    Recipe {
        id: "d-screw-vise",
        source: include_str!("../../../examples/scripts/d-screw-vise.nbcad.jsonc"),
        summary: "Build a captured-slide vise with 100 mm jaws, 90 mm travel and a custom rounded 24 x 4 screw with a shallow print flat. Six printed parts and M5/M6 hardware envelopes make 30 bodies including optional mounts, with seven drawing sheets and per-part print layouts. Physical qualification remains required.",
        kind: "flagship-candidate",
        focus_operations: &["solid_external_thread", "assembly_create_joint"],
        preview: false,
    },
    Recipe {
        id: "d-screw-vise-fit",
        source: include_str!("../../../examples/scripts/d-screw-vise-fit.nbcad.jsonc"),
        summary: "Build four fit specimens: a shallow-flat custom rounded 24 x 4 screw, matching relieved female thread, and male/female captured guides. Qualify the actual print process before making the full vise.",
        kind: "manufacturing-coupon",
        focus_operations: &["solid_external_thread", "solid_hole"],
        preview: false,
    },
    Recipe {
        id: "fillet-basics",
        source: include_str!("../../../examples/scripts/fillet-basics.nbcad.jsonc"),
        summary: "Locate a dimensioned sketch, extrude stock, then round only its top rim.",
        kind: "lesson",
        focus_operations: &["solid_extrude", "solid_fillet"],
        preview: true,
    },
    Recipe {
        id: "mounting-plate",
        source: include_str!("../../../examples/scripts/mounting-plate.nbcad.jsonc"),
        summary: "Drill four through holes from the current top-face basis of a fully located plate.",
        kind: "lesson",
        focus_operations: &["solid_hole"],
        preview: false,
    },
    Recipe {
        id: "revolved-spacer",
        source: include_str!("../../../examples/scripts/revolved-spacer.nbcad.jsonc"),
        summary: "Revolve a located radial section into an annular spacer with an editable bore.",
        kind: "lesson",
        focus_operations: &["solid_revolve"],
        preview: false,
    },
    Recipe {
        id: "angle-bracket",
        source: include_str!("../../../examples/scripts/angle-bracket.nbcad.jsonc"),
        summary: "Constrain a six-edge L section and extrude a dimensioned angle bracket.",
        kind: "lesson",
        focus_operations: &["sketch_add_dimension", "solid_extrude"],
        preview: false,
    },
    Recipe {
        id: "repeated-bracket-assembly",
        source: include_str!("../../../examples/scripts/repeated-bracket-assembly.nbcad.jsonc"),
        summary: "Assemble three native parts as four occurrences, then edit the shared bracket definition.",
        kind: "assembly",
        focus_operations: &["assembly_create_occurrence", "assembly_create_joint", "solid_edit_extrude"],
        preview: false,
    },
    Recipe {
        id: "garden-bench",
        source: include_str!("../../../examples/scripts/garden-bench.nbcad.jsonc"),
        summary: "Build the timber bench, connected assembly and geometric manufacturing checks. Design candidate; full drafting remains open.",
        kind: "flagship-candidate",
        focus_operations: &["assembly_create_joint", "construction_plane_midplane"],
        preview: false,
    },
    Recipe {
        id: "turbine-fit-coupons",
        source: include_str!("../../../examples/scripts/turbine-fit-coupons.nbcad.jsonc"),
        summary: "Print dimensioned shaft, bearing, motor-case and motor-shaft fit specimens with the actual turbine clamp geometry before committing the full rotor.",
        kind: "calibration",
        focus_operations: &["sketch_add_circle_locked", "solid_extrude", "drawing_add_radial_dimension"],
        preview: false,
    },
    Recipe {
        id: "vertical-axis-turbine",
        source: include_str!("../../../examples/scripts/vertical-axis-turbine.nbcad.jsonc"),
        summary: "Build a two-stage printable Savonius turbine, constrained 4:1 spur drive and associative manufacturing drawings. Physical print and generator fit qualification pending.",
        kind: "flagship-candidate",
        focus_operations: &["solid_circular_pattern", "assembly_create_gear_relation", "drawing_add_radial_dimension"],
        preview: false,
    },
];

pub fn find(id: &str) -> Result<&'static Recipe, String> {
    RECIPES
        .iter()
        .find(|recipe| recipe.id == id)
        .ok_or_else(|| format!("Unknown recipe '{id}'; list the recipe catalog first"))
}

/// Links select installed, authored source only. No URL decoding, paths,
/// parameters, remote fetches or implicit execution cross this boundary.
pub fn from_open_uri(uri: &str) -> Result<&'static Recipe, String> {
    let id = uri
        .strip_prefix("nbcad://recipe/")
        .ok_or("Expected nbcad://recipe/<built-in recipe ID>")?;
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(
            "Recipe links accept a built-in ID only, without parameters or extra paths".into(),
        );
    }
    find(id)
}

/// Titles, chapters, actual calls and counts come from the source itself.
/// A recipe has no pretend `cad_script` operation: that operation records traces.
pub fn catalog(include_source: bool) -> Value {
    Value::Array(
        RECIPES
            .iter()
            .map(|recipe| {
                let mut entry = nbcad_script::Script::parse(recipe.source)
                    .expect("bundled recipe must pass preflight")
                    .metadata();
                entry["id"] = json!(recipe.id);
                entry["summary"] = json!(recipe.summary);
                entry["kind"] = json!(recipe.kind);
                entry["focus_operations"] = json!(recipe.focus_operations);
                entry["preview"] = json!(recipe.preview);
                entry["run"] = json!({"action":"script", "recipe":recipe.id});
                if include_source {
                    entry["source"] = json!(recipe.source);
                }
                entry
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn recipe_links_select_only_installed_source() {
        for recipe in RECIPES {
            assert_eq!(
                from_open_uri(&format!("nbcad://recipe/{}", recipe.id))
                    .unwrap()
                    .source,
                recipe.source
            );
        }
        for uri in [
            "https://example.org/model.jsonc",
            "nbcad://recipe/",
            "nbcad://recipe/unknown",
            "nbcad://recipe/garden-bench?run=true",
            "nbcad://recipe/garden-bench#run",
            "nbcad://recipe/garden-bench/",
            "nbcad://recipe/../garden-bench",
            "nbcad://recipe/%67arden-bench",
            "nbcad://user@recipe/garden-bench",
            "nbcad://recipe:80/garden-bench",
            "nbcad://recipe/garden-bench\n",
            "nbcad://recipe/C:\\model.jsonc",
        ] {
            assert!(from_open_uri(uri).is_err(), "accepted {uri:?}");
        }
    }

    #[test]
    fn showcase_landing_links_select_real_bundled_recipes() {
        let page = include_str!("../../../knowledge/open.html");
        let links = page
            .split("href=\"nbcad:")
            .skip(1)
            .map(|tail| format!("nbcad:{}", tail.split('"').next().unwrap()))
            .collect::<Vec<_>>();
        assert!(!links.is_empty());
        for uri in links {
            from_open_uri(&uri).unwrap();
        }
    }

    #[test]
    fn recipes_have_distinct_ids_and_teach_operations_they_execute() {
        let entries = catalog(false);
        let mut ids = BTreeSet::new();
        for entry in entries.as_array().unwrap() {
            assert!(ids.insert(entry["id"].as_str().unwrap()));
            assert!(!entry["chapters"].as_array().unwrap().is_empty());
            for operation in entry["focus_operations"].as_array().unwrap() {
                assert!(
                    entry["operations"].as_array().unwrap().contains(operation),
                    "{} claims an operation it does not execute: {operation}",
                    entry["id"]
                );
            }
            if entry["preview"] == true {
                assert!(
                    entry["step_count"].as_u64().unwrap() + entry["check_count"].as_u64().unwrap()
                        <= 80
                );
            }
        }
    }
}
