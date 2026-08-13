use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::constraint::{Constraint, ConstraintId};
use crate::entity::{Entity, EntityId};
use crate::geometry::Vec2;
use crate::params::{ParamId, ParamTable};

/// Result of [`Sketch::degrees_of_freedom`].
///
/// `value` is computed from the constraint solver's Jacobian rank.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DofReport {
    /// Remaining degrees of freedom.
    pub value: i32,
    /// Whether the sketch has no remaining degrees of freedom.
    pub fully_defined: bool,
}

/// Errors returned by [`Sketch::solve`].
///
/// Over-constraining input is rejected with an explicit conflict report
/// naming the offending constraints/entities; it is never silently converted
/// to driven dimensions.
#[derive(Debug, Clone, PartialEq)]
pub enum SolveError {
    /// The new constraint set is over-constrained; `conflicts` names the
    /// constraints involved in the conflict.
    OverConstrained { conflicts: Vec<ConstraintId> },
    /// The Newton iteration failed to converge.
    NumericalFailure,
}

impl fmt::Display for SolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SolveError::OverConstrained { conflicts } => {
                write!(f, "sketch is over-constrained (conflicts: {:?})", conflicts)
            }
            SolveError::NumericalFailure => write!(f, "sketch solver failed to converge"),
        }
    }
}

impl std::error::Error for SolveError {}

/// Full cloneable state of a [`Sketch`], used by the session command stack
/// for undo/redo. Cheap at sketch scale and exact by construction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SketchSnapshot {
    entities: Vec<(EntityId, Entity)>,
    constraints: Vec<(ConstraintId, Constraint)>,
    fix_targets: HashMap<ConstraintId, Vec<f64>>,
    params: ParamTable,
    dim_params: HashMap<ConstraintId, ParamId>,
    dim_placements: HashMap<ConstraintId, Vec2>,
    next_entity: u64,
    next_constraint: u64,
}

/// 2D sketch on a plane: entities plus constraints between them.
///
/// Entities and constraints keep insertion order and are addressed by
/// stable, monotonically increasing ids. Line endpoints are shared `Point`
/// entities (structural coincident, see [`Entity`]).
#[derive(Debug, Clone, Default)]
pub struct Sketch {
    entities: Vec<(EntityId, Entity)>,
    constraints: Vec<(ConstraintId, Constraint)>,
    /// Fix-constraint pin targets (entity unknown values captured when the
    /// Fix was added), keyed by constraint id. The `Constraint::Fix`
    /// variant itself carries no values, so the solver reads targets here.
    fix_targets: HashMap<ConstraintId, Vec<f64>>,
    /// Named parameters (d1, d2, …) backing driving dimensions (D9).
    params: ParamTable,
    /// Dimensional constraint → driving parameter binding.
    dim_params: HashMap<ConstraintId, ParamId>,
    /// Dimensional constraint → annotation text position (sketch mm).
    dim_placements: HashMap<ConstraintId, Vec2>,
    next_entity: u64,
    next_constraint: u64,
}

impl Sketch {
    pub fn new() -> Self {
        Self::default()
    }

    // --- Entities ---

    pub fn add_entity(&mut self, entity: Entity) -> EntityId {
        self.next_entity += 1;
        let id = EntityId(self.next_entity);
        self.entities.push((id, entity));
        id
    }

    /// Remove an entity, every entity that structurally references it
    /// (transitively — e.g. deleting a point deletes connected lines), and
    /// every constraint that references a removed entity.
    ///
    /// Returns the ids of all removed entities (including `id` itself), or
    /// an empty vec if `id` does not exist.
    pub fn remove_entity(&mut self, id: EntityId) -> Vec<EntityId> {
        if self.entity(id).is_none() {
            return Vec::new();
        }
        let mut removed = vec![id];
        // Transitively collect entities referencing already-removed ones.
        loop {
            let before = removed.len();
            for (eid, entity) in &self.entities {
                if removed.contains(eid) {
                    continue;
                }
                if entity
                    .referenced_entities()
                    .iter()
                    .any(|r| removed.contains(r))
                {
                    removed.push(*eid);
                }
            }
            if removed.len() == before {
                break;
            }
        }
        self.entities.retain(|(eid, _)| !removed.contains(eid));
        self.constraints
            .retain(|(_, c)| !c.referenced_entities().iter().any(|r| removed.contains(r)));
        self.fix_targets
            .retain(|cid, _| self.constraints.iter().any(|(id, _)| id == cid));
        self.dim_params
            .retain(|cid, _| self.constraints.iter().any(|(id, _)| id == cid));
        self.dim_placements
            .retain(|cid, _| self.constraints.iter().any(|(id, _)| id == cid));
        removed
    }

    pub fn entity(&self, id: EntityId) -> Option<&Entity> {
        self.entities
            .iter()
            .find(|(eid, _)| *eid == id)
            .map(|(_, e)| e)
    }

    pub fn entity_mut(&mut self, id: EntityId) -> Option<&mut Entity> {
        self.entities
            .iter_mut()
            .find(|(eid, _)| *eid == id)
            .map(|(_, e)| e)
    }

    pub fn entities(&self) -> impl Iterator<Item = (EntityId, &Entity)> {
        self.entities.iter().map(|(id, e)| (*id, e))
    }

    pub fn entity_count(&self) -> usize {
        self.entities.len()
    }

    // --- Geometry lookups (resolve shared point references) ---

    /// Position of a `Point` entity.
    pub fn point_position(&self, id: EntityId) -> Option<Vec2> {
        match self.entity(id) {
            Some(Entity::Point { position }) => Some(*position),
            _ => None,
        }
    }

    /// Endpoint point ids of a `Line` entity.
    pub fn line_endpoint_ids(&self, id: EntityId) -> Option<(EntityId, EntityId)> {
        match self.entity(id) {
            Some(Entity::Line { start, end }) => Some((*start, *end)),
            _ => None,
        }
    }

    /// Resolved endpoint coordinates of a `Line` entity.
    pub fn resolved_line(&self, id: EntityId) -> Option<(Vec2, Vec2)> {
        let (start, end) = self.line_endpoint_ids(id)?;
        Some((self.point_position(start)?, self.point_position(end)?))
    }

    /// Ids of `Line` entities connected to the given point.
    pub fn lines_connected_to(&self, point_id: EntityId) -> Vec<EntityId> {
        self.entities
            .iter()
            .filter_map(|(eid, e)| match e {
                Entity::Line { start, end } if *start == point_id || *end == point_id => Some(*eid),
                _ => None,
            })
            .collect()
    }

    /// Find the point entity nearest to `p` within `tolerance`.
    pub fn nearest_point(&self, p: Vec2, tolerance: f64) -> Option<(EntityId, f64)> {
        let mut best: Option<(EntityId, f64)> = None;
        for (eid, e) in self.entities() {
            if let Entity::Point { position } = e {
                let d = position.distance(p);
                if d <= tolerance && best.map_or(true, |(_, bd)| d < bd) {
                    best = Some((eid, d));
                }
            }
        }
        best
    }

    /// Find the line whose midpoint is nearest to `p` within `tolerance`
    /// (M1d midpoint auto-snap). Returns the line id and midpoint coords.
    pub fn nearest_line_midpoint(&self, p: Vec2, tolerance: f64) -> Option<(EntityId, Vec2)> {
        let mut best: Option<(EntityId, Vec2, f64)> = None;
        for (eid, e) in self.entities() {
            if let Entity::Line { start, end } = e {
                let (Some(a), Some(b)) = (self.point_position(*start), self.point_position(*end))
                else {
                    continue;
                };
                let mid = (a + b) * 0.5;
                let d = mid.distance(p);
                if d <= tolerance && best.as_ref().map_or(true, |(_, _, bd)| d < *bd) {
                    best = Some((eid, mid, d));
                }
            }
        }
        best.map(|(id, mid, _)| (id, mid))
    }

    // --- Constraints ---

    pub fn add_constraint(&mut self, constraint: Constraint) -> ConstraintId {
        self.next_constraint += 1;
        let id = ConstraintId(self.next_constraint);
        self.constraints.push((id, constraint));
        id
    }

    pub fn remove_constraint(&mut self, id: ConstraintId) -> Option<Constraint> {
        let index = self.constraints.iter().position(|(cid, _)| *cid == id)?;
        self.fix_targets.remove(&id);
        self.dim_params.remove(&id);
        self.dim_placements.remove(&id);
        Some(self.constraints.remove(index).1)
    }

    /// Replace one constraint without changing its stable id. Corner-edit
    /// topology migration uses this to retarget midpoint intent while keeping
    /// diagnostics and serialized references stable.
    pub fn replace_constraint(
        &mut self,
        id: ConstraintId,
        constraint: Constraint,
    ) -> Option<Constraint> {
        let (_, current) = self.constraints.iter_mut().find(|(cid, _)| *cid == id)?;
        Some(std::mem::replace(current, constraint))
    }

    pub fn constraint(&self, id: ConstraintId) -> Option<&Constraint> {
        self.constraints
            .iter()
            .find(|(cid, _)| *cid == id)
            .map(|(_, c)| c)
    }

    pub fn constraints(&self) -> impl Iterator<Item = (ConstraintId, &Constraint)> {
        self.constraints.iter().map(|(id, c)| (*id, c))
    }

    pub fn constraint_count(&self) -> usize {
        self.constraints.len()
    }

    /// Constraints of a given kind acting on an entity, e.g. the
    /// `Horizontal`/`Vertical` marks on a line (used by interim drag
    /// projection and by the glyph renderer).
    pub fn has_constraint_on(&self, entity: EntityId, pred: impl Fn(&Constraint) -> bool) -> bool {
        self.constraints
            .iter()
            .any(|(_, c)| c.referenced_entities().contains(&entity) && pred(c))
    }

    /// Register/lookup the pin targets of a Fix constraint (entity unknown
    /// values captured at add time).
    pub fn set_fix_targets(&mut self, id: ConstraintId, targets: Vec<f64>) {
        self.fix_targets.insert(id, targets);
    }

    pub fn fix_targets(&self, id: &ConstraintId) -> Option<&Vec<f64>> {
        self.fix_targets.get(id)
    }

    // --- Parameters & dimension bindings (D9) ---

    pub fn params(&self) -> &ParamTable {
        &self.params
    }

    pub fn params_mut(&mut self) -> &mut ParamTable {
        &mut self.params
    }

    /// Bind a dimensional constraint to its driving parameter and record
    /// the annotation's text position.
    pub fn bind_dimension(&mut self, cid: ConstraintId, param: ParamId, text_pos: Vec2) {
        self.dim_params.insert(cid, param);
        self.dim_placements.insert(cid, text_pos);
    }

    pub fn dim_param(&self, cid: &ConstraintId) -> Option<ParamId> {
        self.dim_params.get(cid).copied()
    }

    pub fn dim_placement(&self, cid: &ConstraintId) -> Option<Vec2> {
        self.dim_placements.get(cid).copied()
    }

    pub fn set_dim_placement(&mut self, cid: ConstraintId, text_pos: Vec2) {
        self.dim_placements.insert(cid, text_pos);
    }

    /// The dimension constraint bound to a parameter, if any (used to
    /// clean up orphan params on dimension delete).
    pub fn dimension_of_param(&self, param: ParamId) -> Option<ConstraintId> {
        self.dim_params
            .iter()
            .find(|(_, p)| **p == param)
            .map(|(cid, _)| *cid)
    }

    /// Effective target value of a dimensional constraint: the bound
    /// parameter's evaluated value when present, else the literal stored
    /// on the constraint variant.
    pub fn dim_value(&self, cid: &ConstraintId, fallback: f64) -> f64 {
        self.dim_params
            .get(cid)
            .and_then(|pid| self.params.get(*pid))
            .map(|p| p.value)
            .unwrap_or(fallback)
    }

    /// The Fix constraint acting on an entity, if any (for Fix/Unfix).
    pub fn fix_constraint_on(&self, entity: EntityId) -> Option<ConstraintId> {
        self.constraints.iter().find_map(|(cid, c)| {
            if matches!(c, Constraint::Fix { entity: e } if *e == entity) {
                Some(*cid)
            } else {
                None
            }
        })
    }

    // --- Snapshot / restore (undo stack) ---

    pub fn snapshot(&self) -> SketchSnapshot {
        SketchSnapshot {
            entities: self.entities.clone(),
            constraints: self.constraints.clone(),
            fix_targets: self.fix_targets.clone(),
            params: self.params.clone(),
            dim_params: self.dim_params.clone(),
            dim_placements: self.dim_placements.clone(),
            next_entity: self.next_entity,
            next_constraint: self.next_constraint,
        }
    }

    pub fn restore(&mut self, snapshot: SketchSnapshot) {
        self.entities = snapshot.entities;
        self.constraints = snapshot.constraints;
        self.fix_targets = snapshot.fix_targets;
        self.params = snapshot.params;
        self.dim_params = snapshot.dim_params;
        self.dim_placements = snapshot.dim_placements;
        self.next_entity = snapshot.next_entity;
        self.next_constraint = snapshot.next_constraint;
    }

    // --- Solver API ---

    /// Real DOF report from the constraint solver's rank analysis:
    /// `unknowns − rank(Jacobian)`.
    pub fn degrees_of_freedom(&self) -> DofReport {
        let analysis = crate::solver::analyze(self);
        DofReport {
            value: analysis.dof,
            fully_defined: analysis.dof == 0 && analysis.unknowns > 0,
        }
    }

    /// Solve the constraint system, updating entity geometry in place.
    /// Newton-based with damping (see [`crate::solver`]); returns
    /// [`SolveError::NumericalFailure`] when it does not converge.
    pub fn solve(&mut self) -> Result<(), SolveError> {
        let analysis = crate::solver::solve(self, &[]);
        if analysis.converged {
            Ok(())
        } else {
            Err(SolveError::NumericalFailure)
        }
    }
}

impl SketchSnapshot {
    /// Validate all stable-id references before a project snapshot is
    /// admitted into a live sketch session.
    pub(crate) fn validate(&self) -> Result<(), String> {
        use std::collections::HashSet;

        let mut entity_ids = HashSet::new();
        for (id, entity) in &self.entities {
            if id.0 == 0 || !entity_ids.insert(*id) {
                return Err(format!("duplicate or zero entity id {}", id.0));
            }
            if entity.referenced_entities().iter().any(|id| id.0 == 0) {
                return Err(format!("entity {} contains a zero reference", id.0));
            }
        }
        for (id, entity) in &self.entities {
            for reference in entity.referenced_entities() {
                if !entity_ids.contains(&reference) {
                    return Err(format!(
                        "entity {} references missing entity {}",
                        id.0, reference.0
                    ));
                }
                if !matches!(
                    self.entities
                        .iter()
                        .find(|(candidate, _)| *candidate == reference)
                        .map(|(_, entity)| entity),
                    Some(Entity::Point { .. })
                ) {
                    return Err(format!(
                        "entity {} references non-point endpoint {}",
                        id.0, reference.0
                    ));
                }
            }
        }
        if entity_ids.iter().map(|id| id.0).max().unwrap_or(0) > self.next_entity {
            return Err("next entity id is behind the saved entity table".to_string());
        }

        let mut constraint_ids = HashSet::new();
        for (id, constraint) in &self.constraints {
            if id.0 == 0 || !constraint_ids.insert(*id) {
                return Err(format!("duplicate or zero constraint id {}", id.0));
            }
            for reference in constraint.referenced_entities() {
                // Entity zero is the intentional +u-axis sentinel used by
                // angle dimensions.
                if reference.0 != 0 && !entity_ids.contains(&reference) {
                    return Err(format!(
                        "constraint {} references missing entity {}",
                        id.0, reference.0
                    ));
                }
            }
        }
        if constraint_ids.iter().map(|id| id.0).max().unwrap_or(0) > self.next_constraint {
            return Err("next constraint id is behind the saved constraint table".to_string());
        }
        if self
            .fix_targets
            .keys()
            .chain(self.dim_params.keys())
            .chain(self.dim_placements.keys())
            .any(|id| !constraint_ids.contains(id))
        {
            return Err("constraint metadata references a missing constraint".to_string());
        }
        for id in self.fix_targets.keys() {
            if !matches!(
                self.constraints
                    .iter()
                    .find(|(candidate, _)| candidate == id)
                    .map(|(_, constraint)| constraint),
                Some(Constraint::Fix { .. })
            ) {
                return Err(format!(
                    "fix metadata references non-Fix constraint {}",
                    id.0
                ));
            }
        }
        for id in self.dim_params.keys().chain(self.dim_placements.keys()) {
            if !matches!(
                self.constraints
                    .iter()
                    .find(|(candidate, _)| candidate == id)
                    .map(|(_, constraint)| constraint.kind()),
                Some(crate::constraint::ConstraintKind::Dimensional)
            ) {
                return Err(format!(
                    "dimension metadata references non-dimensional constraint {}",
                    id.0
                ));
            }
        }
        self.params.validate()?;
        let parameter_ids = self
            .params
            .all()
            .iter()
            .map(|parameter| parameter.id)
            .collect::<HashSet<_>>();
        let mut referenced_parameters = HashSet::new();
        for id in self.dim_params.values() {
            if !parameter_ids.contains(id) {
                return Err("dimension references a missing parameter".to_string());
            }
            if !referenced_parameters.insert(*id) {
                return Err(format!(
                    "parameter {} is bound to more than one dimension",
                    id.0
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Line (0,0)-(50,0) built from shared points, plus a circle.
    fn sample_sketch() -> (Sketch, EntityId, EntityId, EntityId, EntityId) {
        let mut s = Sketch::new();
        let p1 = s.add_entity(Entity::point(0.0, 0.0));
        let p2 = s.add_entity(Entity::point(50.0, 0.0));
        let line = s.add_entity(Entity::line(p1, p2));
        let circle = s.add_entity(Entity::circle(25.0, 20.0, 10.0));
        (s, p1, p2, line, circle)
    }

    #[test]
    fn entity_ids_are_unique_and_monotonic() {
        let (s, p1, p2, line, circle) = sample_sketch();
        assert!(p2.0 > p1.0 && line.0 > p2.0 && circle.0 > line.0);
        assert_eq!(s.entity_count(), 4);
    }

    #[test]
    fn entities_are_retrievable_and_mutable_by_id() {
        let (mut s, p1, _, line, _) = sample_sketch();
        assert!(matches!(s.entity(line), Some(Entity::Line { .. })));
        if let Some(Entity::Point { position }) = s.entity_mut(p1) {
            position.y = 5.0;
        }
        assert_eq!(s.point_position(p1), Some(Vec2::new(0.0, 5.0)));
        assert!(s.entity(EntityId(999)).is_none());
    }

    #[test]
    fn resolved_line_follows_shared_points() {
        let (mut s, p1, _, line, _) = sample_sketch();
        assert_eq!(
            s.resolved_line(line),
            Some((Vec2::new(0.0, 0.0), Vec2::new(50.0, 0.0)))
        );
        if let Some(Entity::Point { position }) = s.entity_mut(p1) {
            position.x = -10.0;
        }
        assert_eq!(
            s.resolved_line(line),
            Some((Vec2::new(-10.0, 0.0), Vec2::new(50.0, 0.0)))
        );
        assert_eq!(s.lines_connected_to(p1), vec![line]);
    }

    #[test]
    fn removing_a_point_cascades_to_connected_lines_and_constraints() {
        let (mut s, p1, _, line, circle) = sample_sketch();
        s.add_constraint(Constraint::Horizontal { entity: line });
        s.add_constraint(Constraint::Concentric { a: line, b: circle });
        s.add_constraint(Constraint::Radius {
            entity: circle,
            value: 10.0,
        });
        assert_eq!(s.constraint_count(), 3);

        let removed = s.remove_entity(p1);
        // Point + the line referencing it are gone; the circle survives.
        assert!(removed.contains(&p1) && removed.contains(&line));
        assert_eq!(s.entity_count(), 2); // other endpoint point + circle
                                         // Only the radius constraint (circle-only) survives.
        assert_eq!(s.constraint_count(), 1);
        assert!(matches!(
            s.constraints().next().map(|(_, c)| c),
            Some(Constraint::Radius { .. })
        ));
    }

    #[test]
    fn removing_a_line_keeps_its_endpoint_points() {
        let (mut s, p1, p2, line, _) = sample_sketch();
        let removed = s.remove_entity(line);
        assert_eq!(removed, vec![line]);
        assert!(s.entity(p1).is_some() && s.entity(p2).is_some());
    }

    #[test]
    fn remove_unknown_entity_is_a_no_op() {
        let (mut s, ..) = sample_sketch();
        assert!(s.remove_entity(EntityId(999)).is_empty());
    }

    #[test]
    fn constraint_bookkeeping_add_remove() {
        let (mut s, _, _, line, _) = sample_sketch();
        let c1 = s.add_constraint(Constraint::Horizontal { entity: line });
        let c2 = s.add_constraint(Constraint::Fix { entity: line });
        assert_ne!(c1, c2);
        assert_eq!(s.constraint_count(), 2);

        assert_eq!(
            s.remove_constraint(c1),
            Some(Constraint::Horizontal { entity: line })
        );
        assert_eq!(s.constraint_count(), 1);
        assert!(s.constraint(c1).is_none());
        assert!(s.constraint(c2).is_some());
        assert!(s.remove_constraint(c1).is_none());
    }

    #[test]
    fn snapshot_restore_roundtrip() {
        let (mut s, p1, _, line, _) = sample_sketch();
        s.add_constraint(Constraint::Horizontal { entity: line });
        let snap = s.snapshot();
        s.remove_entity(p1);
        assert_eq!(s.entity_count(), 2);
        s.restore(snap);
        assert_eq!(s.entity_count(), 4);
        assert!(s.entity(line).is_some());
        assert_eq!(s.constraint_count(), 1);
        // Ids continue monotonically after a restore.
        let p3 = s.add_entity(Entity::point(1.0, 1.0));
        assert!(p3.0 > line.0);
    }

    #[test]
    fn degrees_of_freedom_uses_solver_rank() {
        // Two shared endpoint points have four unknowns; horizontal removes
        // one degree of freedom.
        let (mut s, _, _, line, circle) = sample_sketch();
        s.remove_entity(circle);
        s.add_constraint(Constraint::Horizontal { entity: line });
        let dof = s.degrees_of_freedom();
        assert_eq!(dof.value, 3);
        assert!(!dof.fully_defined);
    }

    #[test]
    fn solve_converges_for_a_horizontal_line() {
        let (mut s, _, _, line, _) = sample_sketch();
        s.add_constraint(Constraint::Horizontal { entity: line });
        assert_eq!(s.solve(), Ok(()));
    }
}
