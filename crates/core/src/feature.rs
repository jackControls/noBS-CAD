use serde::{Deserialize, Serialize};

/// Stable identifier of a parametric feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct FeatureId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeatureKind {
    Sketch,
    ConstructionPlane,
    Extrude,
    Revolve,
    Sweep,
    Loft,
    Rib,
    Fillet,
    Chamfer,
    Hole,
    ExternalThread,
    Shell,
    MoveCopy,
    Mirror,
    RectangularPattern,
    CircularPattern,
    Combine,
    SplitBody,
    ImportStep,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum FeatureStatus {
    Ok,
    Error { message: String },
}

impl Default for FeatureStatus {
    fn default() -> Self {
        Self::Ok
    }
}

/// One persistent entry in the parametric history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Feature {
    pub id: FeatureId,
    pub name: String,
    pub kind: FeatureKind,
    pub suppressed: bool,
    pub status: FeatureStatus,
}

impl Feature {
    pub fn new(id: FeatureId, name: impl Into<String>, kind: FeatureKind) -> Self {
        Self {
            id,
            name: name.into(),
            kind,
            suppressed: false,
            status: FeatureStatus::Ok,
        }
    }
}

/// Ordered feature history. `rollback_index` is a feature count: entries
/// before it are active, entries at/after it are rolled back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeatureTree {
    pub features: Vec<Feature>,
    pub rollback_index: usize,
}

impl Default for FeatureTree {
    fn default() -> Self {
        Self {
            features: Vec::new(),
            rollback_index: 0,
        }
    }
}

impl FeatureTree {
    pub fn len(&self) -> usize {
        self.features.len()
    }

    pub fn is_empty(&self) -> bool {
        self.features.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Feature> {
        self.features.iter()
    }

    pub fn push(&mut self, feature: Feature) {
        self.features.push(feature);
        self.rollback_index = self.features.len();
    }

    /// Insert a newly-authored feature at the build cursor. Features at and
    /// after the cursor remain in history but stay rolled back, matching the
    /// way a parametric CAD timeline branches when an operation is created in
    /// the middle of the model.
    pub fn insert_at_rollback(&mut self, feature: Feature) {
        let index = self.rollback_index.min(self.features.len());
        self.features.insert(index, feature);
        self.rollback_index = index + 1;
    }

    pub fn set_rollback_index(&mut self, index: usize) {
        self.rollback_index = index.min(self.features.len());
    }

    pub fn feature_mut(&mut self, id: FeatureId) -> Option<&mut Feature> {
        self.features.iter_mut().find(|feature| feature.id == id)
    }

    /// Remove one feature while preserving the build cursor's logical
    /// position. If the removed feature was in the active prefix, the cursor
    /// moves left with it; removing a rolled-back feature leaves the active
    /// prefix unchanged.
    pub fn remove(&mut self, id: FeatureId) -> Option<Feature> {
        let index = self.features.iter().position(|feature| feature.id == id)?;
        let feature = self.features.remove(index);
        if index < self.rollback_index {
            self.rollback_index = self.rollback_index.saturating_sub(1);
        }
        self.rollback_index = self.rollback_index.min(self.features.len());
        Some(feature)
    }

    /// Move one feature to an insertion slot while preserving stable ids.
    /// `target_index` is measured against the pre-move card slots
    /// (`0..=len`), matching the timeline drag UI.
    pub fn reorder(&mut self, id: FeatureId, target_index: usize) -> bool {
        let Some(source_index) = self.features.iter().position(|feature| feature.id == id) else {
            return false;
        };
        let target_index = target_index.min(self.features.len());
        let insertion_index = if source_index < target_index {
            target_index.saturating_sub(1)
        } else {
            target_index
        };
        if source_index == insertion_index {
            return false;
        }
        let feature = self.features.remove(source_index);
        self.features.insert(insertion_index, feature);
        self.rollback_index = self.rollback_index.min(self.features.len());
        true
    }

    pub fn active(&self, id: FeatureId) -> bool {
        self.features
            .iter()
            .position(|feature| feature.id == id)
            .is_some_and(|index| index < self.rollback_index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_advances_rollback_and_clamps_manual_rollback() {
        let mut tree = FeatureTree::default();
        tree.push(Feature::new(FeatureId(1), "Sketch1", FeatureKind::Sketch));
        tree.push(Feature::new(FeatureId(2), "Extrude1", FeatureKind::Extrude));
        assert_eq!(tree.rollback_index, 2);
        tree.set_rollback_index(1);
        assert!(tree.active(FeatureId(1)));
        assert!(!tree.active(FeatureId(2)));
        tree.set_rollback_index(99);
        assert_eq!(tree.rollback_index, 2);
    }

    #[test]
    fn inserting_at_rollback_keeps_later_features_rolled_back() {
        let mut tree = FeatureTree::default();
        tree.push(Feature::new(FeatureId(1), "Sketch1", FeatureKind::Sketch));
        tree.push(Feature::new(FeatureId(2), "Extrude1", FeatureKind::Extrude));
        tree.push(Feature::new(FeatureId(3), "Hole1", FeatureKind::Hole));
        tree.set_rollback_index(1);

        tree.insert_at_rollback(Feature::new(
            FeatureId(4),
            "SplitBody1",
            FeatureKind::SplitBody,
        ));

        assert_eq!(
            tree.features
                .iter()
                .map(|feature| feature.id)
                .collect::<Vec<_>>(),
            vec![FeatureId(1), FeatureId(4), FeatureId(2), FeatureId(3)],
        );
        assert_eq!(tree.rollback_index, 2);
        assert!(tree.active(FeatureId(4)));
        assert!(!tree.active(FeatureId(2)));
    }

    #[test]
    fn remove_preserves_the_logical_build_cursor() {
        let mut tree = FeatureTree::default();
        tree.push(Feature::new(FeatureId(1), "Sketch1", FeatureKind::Sketch));
        tree.push(Feature::new(FeatureId(2), "Extrude1", FeatureKind::Extrude));
        tree.push(Feature::new(FeatureId(3), "Chamfer1", FeatureKind::Chamfer));
        tree.set_rollback_index(2);

        assert_eq!(
            tree.remove(FeatureId(1)).map(|feature| feature.id),
            Some(FeatureId(1))
        );
        assert_eq!(tree.rollback_index, 1);
        assert_eq!(
            tree.features
                .iter()
                .map(|feature| feature.id)
                .collect::<Vec<_>>(),
            vec![FeatureId(2), FeatureId(3)]
        );

        assert_eq!(
            tree.remove(FeatureId(3)).map(|feature| feature.id),
            Some(FeatureId(3))
        );
        assert_eq!(tree.rollback_index, 1);
        assert_eq!(tree.remove(FeatureId(99)), None);
    }

    #[test]
    fn reorder_uses_card_insertion_slots_and_keeps_ids_stable() {
        let mut tree = FeatureTree::default();
        tree.push(Feature::new(FeatureId(1), "A", FeatureKind::Sketch));
        tree.push(Feature::new(FeatureId(2), "B", FeatureKind::Extrude));
        tree.push(Feature::new(FeatureId(3), "C", FeatureKind::Chamfer));

        assert!(tree.reorder(FeatureId(3), 0));
        assert_eq!(
            tree.features
                .iter()
                .map(|feature| feature.id)
                .collect::<Vec<_>>(),
            vec![FeatureId(3), FeatureId(1), FeatureId(2)],
        );
        assert!(tree.reorder(FeatureId(3), 3));
        assert_eq!(
            tree.features
                .iter()
                .map(|feature| feature.id)
                .collect::<Vec<_>>(),
            vec![FeatureId(1), FeatureId(2), FeatureId(3)],
        );
        assert_eq!(tree.rollback_index, 3);
    }
}
