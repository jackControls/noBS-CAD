use serde::{Deserialize, Serialize};

use crate::entity::EntityId;

/// Stable identifier of a constraint within a sketch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ConstraintId(pub u64);

/// Classification of a constraint (geometric vs. dimensional), exposed for
/// UI badges and future solver partitioning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintKind {
    Geometric,
    Dimensional,
}

/// Which end of an arc (`ArcEndpointCoincident`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArcEndpoint {
    Start,
    End,
}

/// Sketch constraint.
///
/// Covers the geometric constraints exposed by the sketcher, plus Fix/Unfix
/// and dimensional constraints. Variants carry the ids of the entities they
/// act on; dimensional variants also carry their value in
/// document units (mm and degrees for angles).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Constraint {
    // --- Geometric (M1 set) ---
    Horizontal {
        entity: EntityId,
    },
    Vertical {
        entity: EntityId,
    },
    /// Keep two point entities on the same sketch-horizontal axis. This is
    /// the persistent form of temporary horizontal object-snap tracking.
    HorizontalPoints {
        a: EntityId,
        b: EntityId,
    },
    /// Keep two point entities on the same sketch-vertical axis. This is the
    /// persistent form of temporary vertical object-snap tracking.
    VerticalPoints {
        a: EntityId,
        b: EntityId,
    },
    Coincident {
        a: EntityId,
        b: EntityId,
    },
    Tangent {
        a: EntityId,
        b: EntityId,
    },
    Equal {
        a: EntityId,
        b: EntityId,
    },
    Parallel {
        a: EntityId,
        b: EntityId,
    },
    Perpendicular {
        a: EntityId,
        b: EntityId,
    },
    Fix {
        entity: EntityId,
    },
    Midpoint {
        a: EntityId,
        b: EntityId,
    },
    /// Midpoint of an edge's original corner-to-corner span after a corner
    /// modifier trims one or both finite endpoints. `start` and `end` are
    /// the persistent corner reference points retained by Fillet/Chamfer.
    /// This keeps construction datums attached to the overall part envelope
    /// instead of silently shifting to the shortened carrier segment.
    SpanMidpoint {
        point: EntityId,
        start: EntityId,
        end: EntityId,
    },
    Concentric {
        a: EntityId,
        b: EntityId,
    },
    Collinear {
        a: EntityId,
        b: EntityId,
    },
    Symmetry {
        a: EntityId,
        b: EntityId,
        axis: EntityId,
    },
    /// Trim anchor (INTERNAL — created by fillet/slot, not panel-applicable):
    /// a Point entity coincides with an arc's start/end point. Arc endpoints
    /// are implicit (center/radius/angles), so without this link a trimmed
    /// line endpoint is only glued by the infinite-line tangency — free to
    /// slide along the line when a driving dim pulls on it (2026-07-19 bug).
    ArcEndpointCoincident {
        point: EntityId,
        arc: EntityId,
        end: ArcEndpoint,
    },
    /// Equal distances from one origin point to two target points
    /// (INTERNAL — used by equal-distance Chamfer). Keeping this geometric
    /// relation separate from the single driving Distance dimension avoids
    /// duplicate dimension annotations while preserving both cutbacks.
    EqualDistance {
        origin: EntityId,
        a: EntityId,
        b: EntityId,
    },

    // --- Dimensional ---
    /// Distance between two entities, or from an entity to the sketch origin
    /// when `to` is `None`.
    Distance {
        from: EntityId,
        to: Option<EntityId>,
        value: f64,
    },
    Radius {
        entity: EntityId,
        value: f64,
    },
    Diameter {
        entity: EntityId,
        value: f64,
    },
    /// Angle in degrees between two entities.
    Angle {
        a: EntityId,
        b: EntityId,
        value: f64,
    },
}

impl Constraint {
    /// Stable snake_case kind string (matches the serde tag).
    pub fn kind_str(&self) -> &'static str {
        match self {
            Constraint::Horizontal { .. } => "horizontal",
            Constraint::Vertical { .. } => "vertical",
            Constraint::HorizontalPoints { .. } => "horizontal_points",
            Constraint::VerticalPoints { .. } => "vertical_points",
            Constraint::Coincident { .. } => "coincident",
            Constraint::Tangent { .. } => "tangent",
            Constraint::Equal { .. } => "equal",
            Constraint::Parallel { .. } => "parallel",
            Constraint::Perpendicular { .. } => "perpendicular",
            Constraint::Fix { .. } => "fix",
            Constraint::Midpoint { .. } => "midpoint",
            Constraint::SpanMidpoint { .. } => "span_midpoint",
            Constraint::Concentric { .. } => "concentric",
            Constraint::Collinear { .. } => "collinear",
            Constraint::Symmetry { .. } => "symmetry",
            Constraint::ArcEndpointCoincident { .. } => "arc_endpoint_coincident",
            Constraint::EqualDistance { .. } => "equal_distance",
            Constraint::Distance { .. } => "distance",
            Constraint::Radius { .. } => "radius",
            Constraint::Diameter { .. } => "diameter",
            Constraint::Angle { .. } => "angle",
        }
    }

    pub fn kind(&self) -> ConstraintKind {
        match self {
            Constraint::Distance { .. }
            | Constraint::Radius { .. }
            | Constraint::Diameter { .. }
            | Constraint::Angle { .. } => ConstraintKind::Dimensional,
            _ => ConstraintKind::Geometric,
        }
    }

    /// All entities this constraint references (used to cascade deletes).
    pub fn referenced_entities(&self) -> Vec<EntityId> {
        match *self {
            Constraint::Horizontal { entity }
            | Constraint::Vertical { entity }
            | Constraint::Fix { entity }
            | Constraint::Radius { entity, .. }
            | Constraint::Diameter { entity, .. } => vec![entity],
            Constraint::Coincident { a, b }
            | Constraint::HorizontalPoints { a, b }
            | Constraint::VerticalPoints { a, b }
            | Constraint::Tangent { a, b }
            | Constraint::Equal { a, b }
            | Constraint::Parallel { a, b }
            | Constraint::Perpendicular { a, b }
            | Constraint::Midpoint { a, b }
            | Constraint::Concentric { a, b }
            | Constraint::Collinear { a, b }
            | Constraint::Angle { a, b, .. } => vec![a, b],
            Constraint::ArcEndpointCoincident { point, arc, .. } => vec![point, arc],
            Constraint::SpanMidpoint { point, start, end } => vec![point, start, end],
            Constraint::EqualDistance { origin, a, b } => vec![origin, a, b],
            Constraint::Symmetry { a, b, axis } => vec![a, b, axis],
            Constraint::Distance { from, to, .. } => match to {
                Some(to) => vec![from, to],
                None => vec![from],
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_classification() {
        let e = EntityId(1);
        assert_eq!(
            Constraint::Horizontal { entity: e }.kind(),
            ConstraintKind::Geometric
        );
        assert_eq!(
            Constraint::Radius {
                entity: e,
                value: 5.0
            }
            .kind(),
            ConstraintKind::Dimensional
        );
    }

    #[test]
    fn referenced_entities_covers_all_variants() {
        let (a, b, c) = (EntityId(1), EntityId(2), EntityId(3));
        assert_eq!(
            Constraint::Symmetry { a, b, axis: c }.referenced_entities(),
            vec![a, b, c]
        );
        assert_eq!(
            Constraint::Distance {
                from: a,
                to: None,
                value: 10.0
            }
            .referenced_entities(),
            vec![a]
        );
        assert_eq!(
            Constraint::Distance {
                from: a,
                to: Some(b),
                value: 10.0
            }
            .referenced_entities(),
            vec![a, b]
        );
    }
}
