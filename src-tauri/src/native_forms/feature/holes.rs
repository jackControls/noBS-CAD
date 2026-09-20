//! Hole controls retain the shared feature, thread specification and associative references.
use super::*;
use nbcad_core::{PlaneBasis, UnitSystem};
use nbcad_solid::{
    HoleBottomStyle, HoleDefinitionDto, HoleExtent, HolePositionDto, HoleRequest, HoleStyle,
    Point2Dto, SketchPointRefDto,
};

#[derive(Debug)]
pub(super) struct HoleFields {
    support: Option<PlanarFaceSourceDto>,
    positions: Vec<HolePositionDto>,
    uv: [MeasurementInput; 2],
    diameter: MeasurementInput,
    extent: HoleExtent,
    depth: MeasurementInput,
    style: HoleStyle,
    counterbore: [MeasurementInput; 2],
    countersink: [MeasurementInput; 2],
    bottom: HoleBottomStyle,
    drill_angle: MeasurementInput,
    threaded: bool,
    thread: ThreadFields,
    flip: bool,
}
fn length(v: f64, units: UnitSystem) -> MeasurementInput {
    MeasurementInput::new(DimensionKind::Length, v, units)
}
fn angle(v: f64, units: UnitSystem) -> MeasurementInput {
    MeasurementInput::new(DimensionKind::Angle, v, units)
}
fn option<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, String> {
    serde_json::from_value(json!(value)).map_err(|_| "Choose an available hole option".into())
}
fn key<T: serde::Serialize>(v: T) -> String {
    serde_json::to_value(v).unwrap().as_str().unwrap().into()
}

impl HoleFields {
    pub fn new(units: UnitSystem) -> Self {
        Self {
            support: None,
            positions: vec![],
            uv: [0., 0.].map(|v| length(v, units)),
            diameter: length(5., units),
            extent: HoleExtent::ThroughAll,
            depth: length(10., units),
            style: HoleStyle::Simple,
            counterbore: [9., 3.].map(|v| length(v, units)),
            countersink: [length(9., units), angle(90., units)],
            bottom: HoleBottomStyle::DrillPoint,
            drill_angle: angle(118., units),
            threaded: false,
            thread: ThreadFields::new_internal(units),
            flip: false,
        }
    }
    pub fn set(
        &mut self,
        field: SolidField,
        value: &str,
        model: &FormModel<'_>,
    ) -> Result<(), String> {
        use SolidField::*;
        match field {
            OriginX | OriginY => {
                self.uv[usize::from(field == OriginY)].set_text(value.into());
                self.positions.clear();
            }
            HoleDiameter => self.diameter.set_text(value.into()),
            HoleDepth => self.depth.set_text(value.into()),
            Extent => {
                self.extent = serde_json::from_value(json!({"type":value,"depth":10.}))
                    .map_err(|_| "Choose Through all or Distance")?
            }
            HoleStyle => self.style = option(value)?,
            CounterboreDiameter => self.counterbore[0].set_text(value.into()),
            CounterboreDepth => self.counterbore[1].set_text(value.into()),
            CountersinkDiameter => self.countersink[0].set_text(value.into()),
            CountersinkAngle => self.countersink[1].set_text(value.into()),
            BottomStyle => self.bottom = option(value)?,
            DrillPointAngle => self.drill_angle.set_text(value.into()),
            Flip => self.flip = value.parse().map_err(|_| "Flip expects true or false")?,
            Threaded => {
                self.threaded = value
                    .parse()
                    .map_err(|_| "Threaded expects true or false")?;
                if self.threaded {
                    self.use_drill(model);
                }
            }
            _ => {
                self.thread.set(field, value, model)?;
                if matches!(field, ThreadStandard | ThreadSeries | ThreadPreset) {
                    self.use_drill(model);
                }
            }
        }
        Ok(())
    }
    fn use_drill(&mut self, model: &FormModel<'_>) {
        if let Some(d) = self.thread.preset_drill() {
            self.diameter = length(d, model.document.settings.units);
        }
    }
}

impl SolidForm {
    pub(super) fn hole_notes(&self) -> Vec<String> {
        let Some(f) = &self.hole else {
            return vec![];
        };
        let mut notes = if f.threaded { f.thread.notes() } else { vec![] };
        if f.positions.iter().any(|p| p.position_reference.is_some()) {
            notes.insert(
                0,
                "Sketch point references move these holes when the source sketch changes.".into(),
            );
        }
        notes
    }

    pub(crate) fn hole_support(&self) -> Option<PlanarFaceSourceDto> {
        self.hole.as_ref()?.support
    }
    pub(crate) fn hole_basis(&self, model: &FormModel<'_>) -> Option<PlaneBasis> {
        let s = self.hole_support()?;
        model
            .scene
            .bodies
            .iter()
            .find(|b| b.id == s.body_id)?
            .faces
            .iter()
            .find(|f| f.id == s.face_id)?
            .plane
    }
    pub(crate) fn set_hole_support(
        &mut self,
        support: Option<PlanarFaceSourceDto>,
        point: Option<[f64; 3]>,
        model: &FormModel<'_>,
    ) -> Result<(), String> {
        self.editing(model)?;
        let position = if let Some(s) = support {
            validate_face(s, model)?;
            let body = model
                .scene
                .bodies
                .iter()
                .find(|b| b.id == s.body_id)
                .unwrap();
            let face = body.faces.iter().find(|f| f.id == s.face_id).unwrap();
            let point = point
                .or_else(|| face_center(body, face))
                .ok_or("The support face has no usable surface")?;
            if !point.iter().all(|v| v.is_finite()) {
                return Err("Hole position must be finite".into());
            }
            face.plane.unwrap().to_2d(point)
        } else {
            [0., 0.]
        };
        let f = self
            .hole
            .as_mut()
            .ok_or("This feature has no hole support")?;
        f.support = support;
        f.positions.clear();
        f.uv = position.map(|v| length(v, model.document.settings.units));
        self.changed();
        Ok(())
    }
    pub(crate) fn set_hole_position(
        &mut self,
        world: [f64; 3],
        reference: Option<SketchPointRefDto>,
        model: &FormModel<'_>,
    ) -> Result<(), String> {
        self.editing(model)?;
        let basis = self
            .hole_basis(model)
            .ok_or("Select a planar support face first")?;
        let mut uv = basis.to_2d(world);
        if let Some(r) = &reference {
            uv = reference_position(r, model, basis)?;
        }
        if !uv.iter().all(|v| v.is_finite()) {
            return Err("Hole position must be finite".into());
        }
        let f = self.hole.as_mut().unwrap();
        if let Some(r) = reference {
            if let Some(index) = f
                .positions
                .iter()
                .position(|p| p.position_reference.as_ref() == Some(&r))
            {
                f.positions.remove(index);
            } else {
                f.positions.retain(|p| p.position_reference.is_some());
                f.positions.push(HolePositionDto {
                    position: Point2Dto::new(uv[0], uv[1]),
                    position_reference: Some(r),
                });
            }
        } else {
            f.positions.clear();
        }
        f.uv = uv.map(|v| length(v, model.document.settings.units));
        self.changed();
        Ok(())
    }
    pub(crate) fn clear_hole_positions(&mut self, model: &FormModel<'_>) -> Result<(), String> {
        self.editing(model)?;
        let f = self
            .hole
            .as_mut()
            .ok_or("This feature has no hole positions")?;
        f.positions.clear();
        f.uv = [0., 0.].map(|v| length(v, model.document.settings.units));
        self.changed();
        Ok(())
    }
    pub(crate) fn edit_hole(definition: &Value, model: &FormModel<'_>) -> Result<Self, String> {
        let d: HoleDefinitionDto =
            serde_json::from_value(definition.clone()).map_err(|e| e.to_string())?;
        let units = model.document.settings.units;
        let mut form = Self::new_kind(SolidFormKind::Hole, model);
        form.feature = Some(d.feature_id);
        let mut f = HoleFields::new(units);
        f.support = Some(PlanarFaceSourceDto {
            body_id: d.body_id,
            face_id: d.face_id,
        });
        f.positions = if d.positions.is_empty() {
            vec![HolePositionDto {
                position: d.position,
                position_reference: d.position_reference,
            }]
        } else {
            d.positions
        };
        let p = &f.positions[0].position;
        f.uv = [p.x, p.y].map(|v| length(v, units));
        f.diameter = length(d.diameter, units);
        f.extent = d.extent;
        if let HoleExtent::Distance { depth } = d.extent {
            f.depth = length(depth, units);
        }
        f.style = d.style;
        f.counterbore = [d.counterbore_diameter, d.counterbore_depth].map(|v| length(v, units));
        f.countersink = [
            length(d.countersink_diameter, units),
            angle(d.countersink_angle_deg, units),
        ];
        f.bottom = d.bottom_style;
        f.drill_angle = angle(d.drill_point_angle_deg, units);
        f.flip = d.flip;
        if let Some(t) = d.thread {
            f.threaded = true;
            f.thread = ThreadFields::from_thread(t, false, units, false);
        }
        form.hole = Some(f);
        form.hole_request(model).map_err(first_error)?;
        Ok(form)
    }
    fn hole_request(
        &self,
        model: &FormModel<'_>,
    ) -> Result<HoleRequest, Vec<(SolidField, String)>> {
        use SolidField as F;
        let f = self.hole.as_ref().unwrap();
        let mut errors = vec![];
        if let Err(e) = self.check_model(model) {
            return Err(vec![(F::HoleSupport, e)]);
        }
        if self.feature.is_some_and(|id| {
            !model
                .document
                .features
                .iter()
                .any(|v| v.id == id && v.kind == FeatureKind::Hole)
        }) {
            return Err(vec![(
                F::HoleSupport,
                "The edited hole no longer exists".into(),
            )]);
        }
        let support = f
            .support
            .ok_or_else(|| vec![(F::HoleSupport, "Select a planar support face".into())])?;
        validate_face(support, model).map_err(|e| vec![(F::HoleSupport, e)])?;
        let basis = self.hole_basis(model).unwrap();
        let mut number = |field, v: &MeasurementInput| match v
            .evaluate(model.document.settings.units, model.parameters)
        {
            Ok(v) => v,
            Err(e) => {
                errors.push((field, e));
                0.
            }
        };
        let uv = if f.positions.is_empty() {
            [number(F::OriginX, &f.uv[0]), number(F::OriginY, &f.uv[1])]
        } else {
            [f.positions[0].position.x, f.positions[0].position.y]
        };
        let diameter = number(F::HoleDiameter, &f.diameter);
        let extent = if matches!(f.extent, HoleExtent::ThroughAll) {
            HoleExtent::ThroughAll
        } else {
            HoleExtent::Distance {
                depth: number(F::HoleDepth, &f.depth),
            }
        };
        let (counterbore_diameter, counterbore_depth) = if f.style == HoleStyle::Counterbore {
            (
                number(F::CounterboreDiameter, &f.counterbore[0]),
                number(F::CounterboreDepth, &f.counterbore[1]),
            )
        } else {
            (0., 0.)
        };
        let (countersink_diameter, countersink_angle_deg) = if f.style == HoleStyle::Countersink {
            (
                number(F::CountersinkDiameter, &f.countersink[0]),
                number(F::CountersinkAngle, &f.countersink[1]),
            )
        } else {
            (0., 90.)
        };
        let drill_point_angle_deg = if f.bottom == HoleBottomStyle::DrillPoint {
            number(F::DrillPointAngle, &f.drill_angle)
        } else {
            118.
        };
        let mut positions = if f.positions.is_empty() {
            vec![HolePositionDto {
                position: Point2Dto::new(uv[0], uv[1]),
                position_reference: None,
            }]
        } else {
            f.positions.clone()
        };
        for p in &mut positions {
            if let Some(r) = &p.position_reference {
                match reference_position(r, model, basis) {
                    Ok(puv) => p.position = Point2Dto::new(puv[0], puv[1]),
                    Err(e) => errors.push((F::HolePositions, e)),
                }
            }
        }
        let thread = if f.threaded {
            match f.thread.evaluate(model) {
                Ok(t) => Some(t),
                Err(e) => {
                    errors.extend(e);
                    None
                }
            }
        } else {
            None
        };
        let first = &positions[0];
        let request = HoleRequest {
            body_id: support.body_id,
            face_id: support.face_id,
            position: first.position,
            position_reference: first.position_reference.clone(),
            positions,
            diameter,
            extent,
            style: f.style,
            counterbore_diameter,
            counterbore_depth,
            countersink_diameter,
            countersink_angle_deg,
            bottom_style: f.bottom,
            drill_point_angle_deg,
            thread,
            flip: f.flip,
        };
        if let Err(e) = nbcad_solid::validate_hole(&request) {
            errors.push((F::HoleDiameter, e.to_string()));
        }
        if errors.is_empty() {
            Ok(request)
        } else {
            Err(errors)
        }
    }
    pub(super) fn hole_payload(
        &self,
        model: &FormModel<'_>,
    ) -> Result<(&'static str, Value), Vec<(SolidField, String)>> {
        let hole = self.hole_request(model)?;
        Ok(if let Some(id) = self.feature {
            ("solid_edit_hole", json!({"feature_id":id,"hole":hole}))
        } else {
            ("solid_hole", json!(hole))
        })
    }
    pub(crate) fn hole_guide(
        &self,
        model: &FormModel<'_>,
    ) -> Option<(HoleRequest, PlaneBasis, f64)> {
        self.hole.as_ref()?;
        let r = self.hole_request(model).ok()?;
        let basis = self.hole_basis(model)?;
        let depth = match r.extent {
            HoleExtent::Distance { depth } => depth,
            HoleExtent::ThroughAll => {
                let body = model.scene.bodies.iter().find(|b| b.id == r.body_id)?;
                body.mesh
                    .positions
                    .chunks_exact(3)
                    .map(|p| {
                        (0..3)
                            .map(|i| {
                                (p[i] as f64 - basis.origin[i])
                                    * basis.normal[i]
                                    * if r.flip { 1. } else { -1. }
                            })
                            .sum::<f64>()
                    })
                    .fold(0., f64::max)
                    .max(r.diameter)
            }
        };
        Some((r, basis, depth))
    }
    pub(super) fn hole_fields(&self, model: &FormModel<'_>) -> Vec<SolidFieldView> {
        use SolidField as F;
        let f = self.hole.as_ref().unwrap();
        let errors = self.hole_request(model).err().unwrap_or_default();
        let editable = self.phase == Phase::Editing && self.check_model(model).is_ok();
        let text = |v: &str| Field::Text {
            value: v.into(),
            read_only: false,
            selection: None,
        };
        let choice = |value: String, options: &[(&str, &str)]| Field::Choice {
            value,
            options: options
                .iter()
                .map(|(v, l)| ChoiceOption {
                    value: (*v).into(),
                    label: (*l).into(),
                    disabled: false,
                })
                .collect(),
        };
        let support = f
            .support
            .and_then(|s| model.scene.bodies.iter().find(|b| b.id == s.body_id))
            .map(|b| format!("{} · planar face", b.name))
            .unwrap_or_else(|| "Click a planar face".into());
        let position = if f.support.is_none() {
            "Select a support face first".into()
        } else if f.positions.len() > 1
            || f.positions.iter().any(|p| p.position_reference.is_some())
        {
            format!("{} selected positions", f.positions.len())
        } else {
            format!("U {} · V {}", f.uv[0].text(), f.uv[1].text())
        };
        let mut rows = vec![
            (F::HoleSupport, support, Field::None, true, true),
            (
                F::HolePositions,
                position,
                Field::None,
                true,
                f.support.is_some(),
            ),
            (
                F::OriginX,
                "Position U".into(),
                text(f.uv[0].text()),
                true,
                true,
            ),
            (
                F::OriginY,
                "Position V".into(),
                text(f.uv[1].text()),
                true,
                true,
            ),
            (
                F::HoleStyle,
                "Hole style".into(),
                choice(
                    key(f.style),
                    &[
                        ("simple", "Simple"),
                        ("counterbore", "Counterbore"),
                        ("countersink", "Countersink"),
                    ],
                ),
                true,
                true,
            ),
            (
                F::Threaded,
                "Threaded hole".into(),
                Field::Toggle(f.threaded),
                true,
                true,
            ),
        ];
        let mut fields: Vec<_> = rows
            .drain(..)
            .map(|(field, label, value, visible, enabled)| SolidFieldView {
                field,
                label,
                value,
                visible,
                enabled: editable && enabled,
                error: errors
                    .iter()
                    .find(|(k, _)| *k == field)
                    .map(|(_, e)| e.clone()),
            })
            .collect();
        if f.threaded {
            fields.extend(
                f.thread
                    .fields(&errors, editable)
                    .into_iter()
                    .filter(|r| !matches!(r.field, F::Cylinder | F::Flip)),
            );
        }
        rows.extend([
            (
                F::HoleDiameter,
                if f.threaded {
                    "Predrill diameter"
                } else {
                    "Diameter"
                }
                .into(),
                text(f.diameter.text()),
                true,
                true,
            ),
            (
                F::CounterboreDiameter,
                "Counterbore diameter".into(),
                text(f.counterbore[0].text()),
                f.style == HoleStyle::Counterbore,
                true,
            ),
            (
                F::CounterboreDepth,
                "Counterbore depth".into(),
                text(f.counterbore[1].text()),
                f.style == HoleStyle::Counterbore,
                true,
            ),
            (
                F::CountersinkDiameter,
                "Countersink diameter".into(),
                text(f.countersink[0].text()),
                f.style == HoleStyle::Countersink,
                true,
            ),
            (
                F::CountersinkAngle,
                "Included angle (deg)".into(),
                text(f.countersink[1].text()),
                f.style == HoleStyle::Countersink,
                true,
            ),
            (
                F::Extent,
                "Extent".into(),
                choice(
                    if matches!(f.extent, HoleExtent::ThroughAll) {
                        "through_all"
                    } else {
                        "distance"
                    }
                    .into(),
                    &[("through_all", "Through all"), ("distance", "Distance")],
                ),
                true,
                true,
            ),
            (
                F::HoleDepth,
                "Depth".into(),
                text(f.depth.text()),
                matches!(f.extent, HoleExtent::Distance { .. }),
                true,
            ),
            (
                F::BottomStyle,
                "Hole bottom".into(),
                choice(
                    key(f.bottom),
                    &[("drill_point", "Drill point"), ("flat", "Flat bottom")],
                ),
                true,
                true,
            ),
            (
                F::DrillPointAngle,
                "Drill point angle (deg)".into(),
                text(f.drill_angle.text()),
                matches!(f.extent, HoleExtent::Distance { .. })
                    && f.bottom == HoleBottomStyle::DrillPoint,
                true,
            ),
            (
                F::Flip,
                "Flip cutting direction".into(),
                Field::Toggle(f.flip),
                true,
                true,
            ),
        ]);
        fields.extend(
            rows.into_iter()
                .map(|(field, label, value, visible, enabled)| SolidFieldView {
                    field,
                    label,
                    value,
                    visible,
                    enabled: editable && enabled,
                    error: errors
                        .iter()
                        .find(|(k, _)| *k == field)
                        .map(|(_, e)| e.clone()),
                }),
        );
        fields
    }
}

fn reference_position(
    reference: &SketchPointRefDto,
    model: &FormModel<'_>,
    basis: PlaneBasis,
) -> Result<[f64; 2], String> {
    let active = model
        .document
        .features
        .iter()
        .filter(|f| !f.suppressed)
        .map(|f| f.id)
        .collect();
    nbcad_solid::hole_reference_center(reference, model.profiles, &active, basis)
        .map(|p| basis.to_2d(p))
        .map_err(|e| e.to_string())
}

// A triangle centroid stays on a concave trimmed face, unlike its bounding-box center.
fn face_center(body: &nbcad_solid::BodyDto, face: &nbcad_solid::FaceDto) -> Option<[f64; 3]> {
    use bevy::math::DVec3;
    let mut best = None;
    let start = face.first_index as usize;
    let end = start.checked_add(face.index_count as usize)?;
    for t in body.mesh.indices.get(start..end)?.chunks_exact(3) {
        let point = |i: u32| -> Option<DVec3> {
            let k = (i as usize).checked_mul(3)?;
            let p = body.mesh.positions.get(k..k + 3)?;
            Some(DVec3::new(p[0] as f64, p[1] as f64, p[2] as f64))
        };
        let (a, b, c) = (point(t[0])?, point(t[1])?, point(t[2])?);
        let area = (b - a).cross(c - a).length_squared();
        if area.is_finite() && area > 0. && best.as_ref().is_none_or(|(old, _)| area > *old) {
            best = Some((area, ((a + b + c) / 3.).to_array()));
        }
    }
    best.map(|(_, p)| p)
}
