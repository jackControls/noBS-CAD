//! The native viewport decodes the transient cursor HUD through serde enums
//! whose variant names are exactly the icon ids the frontend sends. An id the
//! native decoder does not know is not a cosmetic mismatch: serde rejects the
//! WHOLE preview payload, and because the send failure is swallowed the native
//! cursor HUD simply freezes on screen while the model keeps updating. Keep
//! both lists in step.
//!
//! These read the sources instead of importing them because the lists live on
//! opposite sides of the JS/Rust boundary; a missing entry must fail here in
//! the ordinary engine test run, not on someone's screen.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read(relative: &str) -> String {
    let path = repo_path(relative);
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

/// Single-quoted strings inside `text[start..end]`, where `end` is the first
/// `;` after `start`.
fn quoted_kinds(source: &str, start_marker: &str) -> BTreeSet<String> {
    let start = source
        .find(start_marker)
        .unwrap_or_else(|| panic!("missing {start_marker}"))
        + start_marker.len();
    let end = source[start..]
        .find(';')
        .unwrap_or_else(|| panic!("unterminated {start_marker}"))
        + start;
    source[start..end]
        .split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

/// Every `nativeIcon: '<id>'` literal in the viewport tool table.
fn native_icon_ids(source: &str) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let mut rest = source;
    while let Some(index) = rest.find("nativeIcon: '") {
        let tail = &rest[index + "nativeIcon: '".len()..];
        let end = tail.find('\'').expect("unterminated nativeIcon literal");
        ids.insert(tail[..end].to_owned());
        rest = &tail[end..];
    }
    ids
}

/// Serde's snake_case form of the variants declared in `pub enum {name}`.
fn enum_variants(source: &str, name: &str) -> BTreeSet<String> {
    let header = format!("pub enum {name} {{");
    let start = source
        .find(&header)
        .unwrap_or_else(|| panic!("missing {header}"))
        + header.len();
    let mut variants = BTreeSet::new();
    for line in source[start..].lines() {
        let line = line.trim();
        if line == "}" {
            break;
        }
        let identifier = line.trim_end_matches(',').trim();
        if identifier.is_empty()
            || identifier.starts_with("///")
            || identifier.starts_with("//")
            || !identifier
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            continue;
        }
        variants.insert(snake_case(identifier));
    }
    assert!(!variants.is_empty(), "{name} parsed as empty");
    variants
}

fn snake_case(identifier: &str) -> String {
    let mut out = String::new();
    for (index, character) in identifier.chars().enumerate() {
        if character.is_ascii_uppercase() {
            if index > 0 {
                out.push('_');
            }
            out.push(character.to_ascii_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}

#[test]
fn every_frontend_constraint_icon_has_a_native_variant() {
    let frontend = quoted_kinds(
        &read("src/sketch/constraintIcons.tsx"),
        "export type ConstraintIconKind =",
    );
    let native = enum_variants(
        &read("src-tauri/src/native_viewport/mod.rs"),
        "ViewportConstraintIcon",
    );
    assert_eq!(
        frontend, native,
        "the frontend constraint icon kinds and the native decoder must match; \
         a native miss rejects the whole preview payload and freezes the cursor HUD"
    );
}

#[test]
fn every_frontend_tool_icon_has_a_native_variant() {
    let frontend = native_icon_ids(&read("src/components/viewport/Viewport.tsx"));
    let native = enum_variants(
        &read("src-tauri/src/native_viewport/mod.rs"),
        "ViewportToolIcon",
    );
    assert_eq!(
        frontend, native,
        "the frontend tool icon ids and the native decoder must match"
    );
}
