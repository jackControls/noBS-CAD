/**
 * Browser OCCT adapter.
 *
 * OpenCascade.js is the Emscripten build of OCCT. This module deliberately
 * mirrors `crates/occt/src/shim.cpp`: same full-replay jobs, same taper
 * convention, same boolean semantics, same face/edge ordering, and the same
 * mesh DTO contract. It is lazy-loaded on the first solid operation.
 */
import type {
  gp_Ax2,
  OpenCascadeInstance,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Wire,
} from 'opencascade.js';
import type {
  KernelBodyDto,
  KernelEdgeDto,
  KernelExtrudeJobDto,
  KernelFaceDto,
  KernelFilletJobDto,
  KernelChamferJobDto,
  KernelCombineJobDto,
  KernelHoleJobDto,
  KernelFeatureErrorDto,
  KernelJobDto,
  KernelLoftJobDto,
  KernelProfileDto,
  KernelRevolveJobDto,
  KernelRibJobDto,
  KernelShellJobDto,
  KernelSceneDto,
  KernelSplitBodyJobDto,
  KernelSweepJobDto,
  KernelTransformDto,
  KernelTransformJobDto,
  PlaneBasis,
  Point3Dto,
  RecomputePlanDto,
  StepExportRequest,
  MeshExportRequest,
  PlanarFaceSignatureDto,
} from './types';
import { translate } from '../i18n';

const TAU = Math.PI * 2;

type Oc = OpenCascadeInstance;

let ocPromise: Promise<Oc> | null = null;

async function loadOc(): Promise<Oc> {
  if (!ocPromise) {
    ocPromise = import('opencascade.js').then(async ({ default: initOpenCascade }) => {
      return await initOpenCascade() as Oc;
    });
  }
  return ocPromise;
}

function point(p: Point3Dto): [number, number, number] {
  return [p.x, p.y, p.z];
}

function unit(v: Point3Dto): [number, number, number] {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length < 1e-12) throw new Error('extrude normal is degenerate');
  return [v.x / length, v.y / length, v.z / length];
}

function sectionTransform(
  profile: Point3Dto[],
  normal: Point3Dto,
  offset: number,
  taperDeg: number,
): (point: Point3Dto) => Point3Dto {
  const n = unit(normal);
  const center = profile.reduce(
    (sum, p) => [sum[0] + p.x, sum[1] + p.y, sum[2] + p.z] as [number, number, number],
    [0, 0, 0] as [number, number, number],
  ).map((value) => value / profile.length) as [number, number, number];
  const radius = Math.max(
    1e-6,
    profile.reduce(
      (sum, p) => sum + Math.hypot(p.x - center[0], p.y - center[1], p.z - center[2]),
      0,
    ) / profile.length,
  );
  const scale = 1 + Math.tan(taperDeg * Math.PI / 180) * offset / radius;
  if (!Number.isFinite(scale) || scale <= 1e-6) {
    throw new Error('taper collapses or inverts the profile');
  }
  return (p) => ({
    x: center[0] + (p.x - center[0]) * scale + n[0] * offset,
    y: center[1] + (p.y - center[1]) * scale + n[1] * offset,
    z: center[2] + (p.z - center[2]) * scale + n[2] * offset,
  });
}

function makePolygonWire(oc: Oc, points: Point3Dto[]) {
  if (points.length < 3) throw new Error('profile must contain at least three points');
  const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
  for (const value of points) {
    const p = new oc.gp_Pnt_3(value.x, value.y, value.z);
    polygon.Add_1(p);
    p.delete();
  }
  polygon.Close();
  if (!polygon.IsDone()) {
    polygon.delete();
    throw new Error('OCCT could not build the profile wire');
  }
  const wire = polygon.Wire();
  polygon.delete();
  return wire;
}

function makeWire(
  oc: Oc,
  profile: KernelProfileDto,
  transform: (point: Point3Dto) => Point3Dto = (value) => value,
) {
  const curves = profile.curves ?? [];
  if (curves.length === 0) {
    return makePolygonWire(oc, profile.points.map(transform));
  }

  const wireMaker = new oc.BRepBuilderAPI_MakeWire_1();
  const addLine = (startValue: Point3Dto, endValue: Point3Dto) => {
    const start = transform(startValue);
    const end = transform(endValue);
    const p1 = new oc.gp_Pnt_3(start.x, start.y, start.z);
    const p2 = new oc.gp_Pnt_3(end.x, end.y, end.z);
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    p1.delete();
    p2.delete();
    if (!edgeMaker.IsDone()) {
      edgeMaker.delete();
      throw new Error('OCCT could not build a line profile edge');
    }
    const edge = edgeMaker.Edge();
    wireMaker.Add_1(edge);
    edge.delete();
    edgeMaker.delete();
  };

  try {
    for (const curve of curves) {
      switch (curve.kind) {
        case 'line':
          addLine(curve.start, curve.end);
          break;
        case 'arc': {
          const values = [curve.start, curve.mid, curve.end].map(transform);
          const p1 = new oc.gp_Pnt_3(values[0].x, values[0].y, values[0].z);
          const pm = new oc.gp_Pnt_3(values[1].x, values[1].y, values[1].z);
          const p2 = new oc.gp_Pnt_3(values[2].x, values[2].y, values[2].z);
          const arcMaker = new oc.GC_MakeArcOfCircle_4(p1, pm, p2);
          p1.delete();
          pm.delete();
          p2.delete();
          if (!arcMaker.IsDone()) {
            arcMaker.delete();
            throw new Error('OCCT could not build an analytic arc');
          }
          const trimmedArc = arcMaker.Value();
          // Embind does not apply OCCT handle inheritance automatically:
          // GC returns Handle_Geom_TrimmedCurve while MakeEdge expects the
          // base Handle_Geom_Curve. Upcast the pointed-to curve explicitly.
          const baseCurve = new oc.Handle_Geom_Curve_2(trimmedArc.get());
          const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_24(baseCurve);
          baseCurve.delete();
          trimmedArc.delete();
          arcMaker.delete();
          if (!edgeMaker.IsDone()) {
            edgeMaker.delete();
            throw new Error('OCCT could not build an arc profile edge');
          }
          const edge = edgeMaker.Edge();
          wireMaker.Add_1(edge);
          edge.delete();
          edgeMaker.delete();
          break;
        }
        case 'circle': {
          const centerValue = transform(curve.center);
          const axisValue = transform(curve.axis_point);
          const dx = axisValue.x - centerValue.x;
          const dy = axisValue.y - centerValue.y;
          const dz = axisValue.z - centerValue.z;
          const radius = Math.hypot(dx, dy, dz);
          if (radius < 1e-9) throw new Error('circle curve has a zero radius');
          const center = new oc.gp_Pnt_3(centerValue.x, centerValue.y, centerValue.z);
          const normal = new oc.gp_Dir_4(curve.normal.x, curve.normal.y, curve.normal.z);
          const xDirection = new oc.gp_Dir_4(dx, dy, dz);
          const axes = new oc.gp_Ax2_2(center, normal, xDirection);
          const circle = new oc.gp_Circ_2(axes, radius);
          const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_8(circle);
          circle.delete();
          axes.delete();
          xDirection.delete();
          normal.delete();
          center.delete();
          if (!edgeMaker.IsDone()) {
            edgeMaker.delete();
            throw new Error('OCCT could not build a circle profile edge');
          }
          const edge = edgeMaker.Edge();
          wireMaker.Add_1(edge);
          edge.delete();
          edgeMaker.delete();
          break;
        }
        case 'polyline':
          for (let index = 0; index + 1 < curve.points.length; index += 1) {
            addLine(curve.points[index], curve.points[index + 1]);
          }
          break;
        default: {
          const exhaustive: never = curve;
          throw new Error(`Unknown profile curve: ${String(exhaustive)}`);
        }
      }
    }
    if (!wireMaker.IsDone()) {
      throw new Error('OCCT could not build the analytic profile wire');
    }
    return wireMaker.Wire();
  } finally {
    wireMaker.delete();
  }
}

function makeOpenWire(oc: Oc, points: Point3Dto[]) {
  if (points.length < 2) throw new Error('path must contain at least two points');
  const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
  for (const value of points) {
    const p = new oc.gp_Pnt_3(value.x, value.y, value.z);
    polygon.Add_1(p);
    p.delete();
  }
  if (!polygon.IsDone()) {
    polygon.delete();
    throw new Error('OCCT could not build the path wire');
  }
  const wire = polygon.Wire();
  polygon.delete();
  return wire;
}

function makeCurveWire(oc: Oc, curves: KernelSweepJobDto['path'], label: string) {
  if (curves.length === 0) throw new Error(`${label} contains no curves`);
  try {
    return makeWire(oc, {
      profile_index: 0,
      points: [],
      curves,
      holes: [],
    });
  } catch (error) {
    throw new Error(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function fixedProfileAxes(oc: Oc, profile: KernelProfileDto) {
  if (profile.points.length < 3) {
    throw new Error('Fixed sweep orientation needs three profile points');
  }
  const originValue = profile.points[0];
  const x = {
    x: profile.points[1].x - originValue.x,
    y: profile.points[1].y - originValue.y,
    z: profile.points[1].z - originValue.z,
  };
  let normal: Point3Dto | null = null;
  for (let index = 2; index < profile.points.length && !normal; index += 1) {
    normal = crossNormal(originValue, profile.points[1], profile.points[index]);
  }
  if (!normal || Math.hypot(x.x, x.y, x.z) < 1e-12) {
    throw new Error('Fixed sweep profile plane is degenerate');
  }
  const origin = new oc.gp_Pnt_3(originValue.x, originValue.y, originValue.z);
  const normalDirection = new oc.gp_Dir_4(normal.x, normal.y, normal.z);
  const xDirection = new oc.gp_Dir_4(x.x, x.y, x.z);
  const axes = new oc.gp_Ax2_2(origin, normalDirection, xDirection);
  origin.delete();
  normalDirection.delete();
  xDirection.delete();
  return axes;
}

function makeProfileFace(
  oc: Oc,
  profile: KernelProfileDto,
  transform: (point: Point3Dto) => Point3Dto = (value) => value,
) {
  const outer = makeWire(oc, profile, transform);
  try {
    const maker = new oc.BRepBuilderAPI_MakeFace_15(outer, true);
    if (!maker.IsDone()) {
      maker.delete();
      throw new Error('OCCT could not build the profile face');
    }
    const face = maker.Face();
    maker.delete();
    return face;
  } finally {
    outer.delete();
  }
}

function loftPair(
  oc: Oc,
  profile: KernelProfileDto,
  firstTransform: (point: Point3Dto) => Point3Dto,
  lastTransform: (point: Point3Dto) => Point3Dto,
): TopoDS_Shape {
  const loftWire = (wireProfile: KernelProfileDto) => {
    const first = makeWire(oc, wireProfile, firstTransform);
    const last = makeWire(oc, wireProfile, lastTransform);
    try {
      const loft = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-7);
      loft.CheckCompatibility(true);
      loft.AddWire(first);
      loft.AddWire(last);
      const progress = new oc.Message_ProgressRange_1();
      loft.Build(progress);
      progress.delete();
      if (!loft.IsDone()) {
        loft.delete();
        throw new Error('OCCT tapered loft construction failed');
      }
      const shape = loft.Shape();
      loft.delete();
      return shape;
    } finally {
      first.delete();
      last.delete();
    }
  };
  let result = loftWire(profile);
  for (const hole of profile.holes ?? []) {
    const cutter = loftWire(hole);
    const next = booleanShape(oc, 'cut', result, cutter);
    result.delete();
    cutter.delete();
    result = next;
  }
  return result;
}

function makeTool(
  oc: Oc,
  job: KernelExtrudeJobDto | KernelRibJobDto,
  profile: KernelProfileDto,
): TopoDS_Shape {
  const taper = 'taper_angle_deg' in job ? job.taper_angle_deg : 0;
  const firstTransform = sectionTransform(profile.points, job.normal, job.start_offset, taper);
  const lastTransform = sectionTransform(profile.points, job.normal, job.end_offset, taper);
  if (Math.abs(taper) < 1e-12) {
    const prismProfile = (wireProfile: KernelProfileDto) => {
      const face = makeProfileFace(oc, wireProfile, firstTransform);
      try {
        const n = unit(job.normal);
        const depth = job.end_offset - job.start_offset;
        const direction = new oc.gp_Vec_4(n[0] * depth, n[1] * depth, n[2] * depth);
        const prism = new oc.BRepPrimAPI_MakePrism_1(face, direction, true, true);
        direction.delete();
        if (!prism.IsDone()) {
          prism.delete();
          throw new Error('OCCT prism construction failed');
        }
        const shape = prism.Shape();
        prism.delete();
        return shape;
      } finally {
        face.delete();
      }
    };
    let result = prismProfile(profile);
    for (const hole of profile.holes ?? []) {
      const cutter = prismProfile(hole);
      const next = booleanShape(oc, 'cut', result, cutter);
      result.delete();
      cutter.delete();
      result = next;
    }
    return result;
  }
  return loftPair(oc, profile, firstTransform, lastTransform);
}

/** Build an Extrude tool from the original OCCT face. The face itself owns
 * its outer wire and every inner wire, so no displayed triangle or sampled
 * profile becomes modeling input. */
function makeExactFaceTool(
  oc: Oc,
  job: KernelExtrudeJobDto,
  sourceFace: TopoDS_Face,
): TopoDS_Shape {
  const basis = facePlane(oc, sourceFace);
  if (!basis) throw new Error('Extrude source face is not planar');
  const normal = unit(job.normal);
  const properties = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(sourceFace, properties, false, false);
  const rawCenter = properties.CentreOfMass();
  const center: [number, number, number] = [
    rawCenter.X(),
    rawCenter.Y(),
    rawCenter.Z(),
  ];
  rawCenter.delete();
  properties.delete();

  const transformShape = (
    shape: TopoDS_Shape,
    offset: number,
    scale: number,
  ): TopoDS_Shape => {
    if (!Number.isFinite(scale) || scale <= 1e-6) {
      throw new Error('Taper collapses or inverts the planar face');
    }
    const transform = new oc.gp_Trsf_1();
    transform.SetValues(
      scale, 0, 0, center[0] * (1 - scale) + normal[0] * offset,
      0, scale, 0, center[1] * (1 - scale) + normal[1] * offset,
      0, 0, scale, center[2] * (1 - scale) + normal[2] * offset,
    );
    try {
      const maker = new oc.BRepBuilderAPI_Transform_2(shape, transform, true);
      if (!maker.IsDone()) {
        maker.delete();
        throw new Error('OCCT could not transform the planar face');
      }
      const result = maker.Shape();
      maker.delete();
      if (result.IsNull()) {
        result.delete();
        throw new Error('OCCT planar-face transform produced a null shape');
      }
      return result;
    } finally {
      transform.delete();
    }
  };

  if (Math.abs(job.taper_angle_deg) < 1e-12) {
    const shifted = transformShape(sourceFace, job.start_offset, 1);
    const startFace = oc.TopoDS.Face_1(shifted);
    shifted.delete();
    try {
      const depth = job.end_offset - job.start_offset;
      const direction = new oc.gp_Vec_4(
        normal[0] * depth,
        normal[1] * depth,
        normal[2] * depth,
      );
      const prism = new oc.BRepPrimAPI_MakePrism_1(startFace, direction, true, true);
      direction.delete();
      if (!prism.IsDone()) {
        prism.delete();
        throw new Error('OCCT exact-face prism construction failed');
      }
      const result = prism.Shape();
      prism.delete();
      return result;
    } finally {
      startFace.delete();
    }
  }

  const vertexMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    sourceFace,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
    vertexMap,
  );
  let radius = 0;
  try {
    if (vertexMap.Size() === 0) throw new Error('Planar face has no boundary vertices');
    for (let index = 1; index <= vertexMap.Size(); index += 1) {
      const raw = vertexMap.FindKey(index);
      const vertex = oc.TopoDS.Vertex_1(raw);
      raw.delete();
      const position = oc.BRep_Tool.Pnt(vertex);
      radius += Math.hypot(
        position.X() - center[0],
        position.Y() - center[1],
        position.Z() - center[2],
      );
      position.delete();
      vertex.delete();
    }
    radius = Math.max(radius / vertexMap.Size(), 1e-6);
  } finally {
    vertexMap.delete();
  }

  const outer = oc.BRepTools.OuterWire(sourceFace);
  if (outer.IsNull()) {
    outer.delete();
    throw new Error('Planar face has no outer boundary wire');
  }
  const wires: TopoDS_Wire[] = [outer];
  const wireMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    sourceFace,
    oc.TopAbs_ShapeEnum.TopAbs_WIRE as never,
    wireMap,
  );
  for (let index = 1; index <= wireMap.Size(); index += 1) {
    const raw = wireMap.FindKey(index);
    const wire = oc.TopoDS.Wire_1(raw);
    raw.delete();
    if (wire.IsSame(outer)) wire.delete();
    else wires.push(wire);
  }
  wireMap.delete();

  const tangent = Math.tan(job.taper_angle_deg * Math.PI / 180);
  const scaleAt = (offset: number) => 1 + tangent * offset / radius;
  const loftWire = (wire: TopoDS_Wire): TopoDS_Shape => {
    const firstShape = transformShape(wire, job.start_offset, scaleAt(job.start_offset));
    const lastShape = transformShape(wire, job.end_offset, scaleAt(job.end_offset));
    const first = oc.TopoDS.Wire_1(firstShape);
    const last = oc.TopoDS.Wire_1(lastShape);
    firstShape.delete();
    lastShape.delete();
    try {
      const loft = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-7);
      loft.CheckCompatibility(true);
      loft.AddWire(first);
      loft.AddWire(last);
      const progress = new oc.Message_ProgressRange_1();
      loft.Build(progress);
      progress.delete();
      if (!loft.IsDone()) {
        loft.delete();
        throw new Error('OCCT exact-wire tapered loft failed');
      }
      const result = loft.Shape();
      loft.delete();
      return result;
    } finally {
      first.delete();
      last.delete();
    }
  };

  try {
    let result = loftWire(wires[0]);
    for (const hole of wires.slice(1)) {
      const cutter = loftWire(hole);
      const next = booleanShape(oc, 'cut', result, cutter);
      result.delete();
      cutter.delete();
      result = next;
    }
    return result;
  } finally {
    wires.forEach((wire) => wire.delete());
  }
}

function makeSweepTool(oc: Oc, job: KernelSweepJobDto): TopoDS_Shape {
  const sweepProfile = (profile: KernelProfileDto, useGuide: boolean) => {
    const profileWire = makeWire(oc, profile);
    const pathWire = makeCurveWire(oc, job.path, 'Sweep path');
    try {
      const pipe = new oc.BRepOffsetAPI_MakePipeShell(pathWire);
      if (job.orientation === 'fixed') {
        const axes = fixedProfileAxes(oc, profile);
        pipe.SetMode_2(axes);
        axes.delete();
      } else {
        pipe.SetMode_1(job.orientation === 'frenet');
      }
      pipe.SetTransitionMode(
        (job.transition === 'right_corner'
          ? oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner
          : job.transition === 'round_corner'
            ? oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RoundCorner
            : oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_Transformed) as never,
      );
      pipe.SetForceApproxC1(job.force_c1);
      let guideWire: ReturnType<typeof makeCurveWire> | null = null;
      if (useGuide && job.guide_rail.length > 0) {
        guideWire = makeCurveWire(oc, job.guide_rail, 'Sweep guide rail');
        pipe.SetMode_5(
          guideWire,
          true,
          oc.BRepFill_TypeOfContact.BRepFill_ContactOnBorder as never,
        );
      }
      pipe.Add_1(profileWire, false, false);
      const progress = new oc.Message_ProgressRange_1();
      pipe.Build(progress);
      progress.delete();
      if (!pipe.IsDone()) {
        guideWire?.delete();
        pipe.delete();
        throw new Error('OCCT sweep construction failed');
      }
      if (!pipe.MakeSolid()) {
        guideWire?.delete();
        pipe.delete();
        throw new Error('OCCT sweep could not close into a solid');
      }
      const shape = pipe.Shape();
      guideWire?.delete();
      pipe.delete();
      return shape;
    } finally {
      profileWire.delete();
      pathWire.delete();
    }
  };
  let result = sweepProfile(job.profile, true);
  for (const hole of job.profile.holes ?? []) {
    const cutter = sweepProfile(hole, false);
    const next = booleanShape(oc, 'cut', result, cutter);
    result.delete();
    cutter.delete();
    result = next;
  }
  return result;
}

function makeLoftTool(oc: Oc, job: KernelLoftJobDto): TopoDS_Shape {
  if (job.sections.length < 2) throw new Error('Loft needs at least two sections');
  const holeCount = job.sections[0].holes?.length ?? 0;
  if (job.sections.some((section) => (section.holes?.length ?? 0) !== holeCount)) {
    throw new Error('Loft sections must contain the same number of profile holes');
  }
  const guided = job.centerline.length > 0 || job.guide_rail.length > 0;
  const makeCenterline = () => {
    if (job.centerline.length > 0) {
      return makeCurveWire(oc, job.centerline, 'Loft centerline');
    }
    const centroids = job.sections.map((section) => {
      const total = section.points.reduce(
        (sum, value) => ({
          x: sum.x + value.x,
          y: sum.y + value.y,
          z: sum.z + value.z,
        }),
        { x: 0, y: 0, z: 0 },
      );
      return {
        x: total.x / section.points.length,
        y: total.y / section.points.length,
        z: total.z / section.points.length,
      };
    });
    return makeOpenWire(oc, centroids);
  };
  const loftProfiles = (profiles: KernelProfileDto[]) => {
    const wires = profiles.map((section) => makeWire(oc, section));
    try {
      if (guided) {
        const centerline = makeCenterline();
        const loft = new oc.BRepOffsetAPI_MakePipeShell(centerline);
        loft.SetMode_1(false);
        loft.SetForceApproxC1(job.continuity !== 'g0');
        let guide: ReturnType<typeof makeCurveWire> | null = null;
        if (profiles === job.sections && job.guide_rail.length > 0) {
          guide = makeCurveWire(oc, job.guide_rail, 'Loft guide rail');
          loft.SetMode_5(
            guide,
            true,
            oc.BRepFill_TypeOfContact.BRepFill_ContactOnBorder as never,
          );
        }
        wires.forEach((wire) => loft.Add_1(wire, false, false));
        const progress = new oc.Message_ProgressRange_1();
        loft.Build(progress);
        progress.delete();
        if (!loft.IsDone()) {
          guide?.delete();
          loft.delete();
          centerline.delete();
          throw new Error('OCCT guided Loft construction failed');
        }
        if (!loft.MakeSolid()) {
          guide?.delete();
          loft.delete();
          centerline.delete();
          throw new Error('OCCT guided Loft could not close into a solid');
        }
        const shape = loft.Shape();
        guide?.delete();
        loft.delete();
        centerline.delete();
        return shape;
      }
      const loft = new oc.BRepOffsetAPI_ThruSections(true, job.ruled, 1e-7);
      loft.CheckCompatibility(true);
      loft.SetContinuity(
        (job.continuity === 'g0'
          ? oc.GeomAbs_Shape.GeomAbs_C0
          : job.continuity === 'g2'
            ? oc.GeomAbs_Shape.GeomAbs_G2
            : oc.GeomAbs_Shape.GeomAbs_G1) as never,
      );
      wires.forEach((wire) => loft.AddWire(wire));
      const progress = new oc.Message_ProgressRange_1();
      loft.Build(progress);
      progress.delete();
      if (!loft.IsDone()) {
        loft.delete();
        throw new Error('OCCT Loft construction failed');
      }
      const shape = loft.Shape();
      loft.delete();
      return shape;
    } finally {
      wires.forEach((wire) => wire.delete());
    }
  };
  let result = loftProfiles(job.sections);
  for (let holeIndex = 0; holeIndex < holeCount; holeIndex += 1) {
    const cutter = loftProfiles(job.sections.map((section) => section.holes[holeIndex]));
    const next = booleanShape(oc, 'cut', result, cutter);
    result.delete();
    cutter.delete();
    result = next;
  }
  return result;
}

function makeRevolveTool(
  oc: Oc,
  job: KernelRevolveJobDto,
  profile: KernelProfileDto,
): TopoDS_Shape {
  const revolveProfile = (wireProfile: KernelProfileDto) => {
    const face = makeProfileFace(oc, wireProfile);
    try {
      const origin = new oc.gp_Pnt_3(
        job.axis_origin.x,
        job.axis_origin.y,
        job.axis_origin.z,
      );
      const direction = new oc.gp_Dir_4(
        job.axis_direction.x,
        job.axis_direction.y,
        job.axis_direction.z,
      );
      const axis = new oc.gp_Ax1_2(origin, direction);
      origin.delete();
      direction.delete();
      const revolve = new oc.BRepPrimAPI_MakeRevol_1(
        face,
        axis,
        job.angle_rad,
        true,
      );
      axis.delete();
      if (!revolve.IsDone()) {
        revolve.delete();
        throw new Error('OCCT revolve construction failed');
      }
      const shape = revolve.Shape();
      revolve.delete();
      return shape;
    } finally {
      face.delete();
    }
  };
  let result = revolveProfile(profile);
  for (const hole of profile.holes ?? []) {
    const cutter = revolveProfile(hole);
    const next = booleanShape(oc, 'cut', result, cutter);
    result.delete();
    cutter.delete();
    result = next;
  }
  return result;
}

function booleanShape(
  oc: Oc,
  kind: KernelExtrudeJobDto['operation'],
  target: TopoDS_Shape,
  tool: TopoDS_Shape,
  simplifyResult = true,
): TopoDS_Shape {
  const progress = new oc.Message_ProgressRange_1();
  const operation =
    kind === 'join'
      ? new oc.BRepAlgoAPI_Fuse_3(target, tool, progress)
      : kind === 'cut'
        ? new oc.BRepAlgoAPI_Cut_3(target, tool, progress)
        : new oc.BRepAlgoAPI_Common_3(target, tool, progress);
  progress.delete();
  if (!operation.IsDone()) {
    operation.delete();
    throw new Error(`OCCT ${kind} failed`);
  }
  // Boolean builders retain same-domain subdivisions by default. Collapse
  // coplanar/tangent result faces once here so combined bodies do not expose
  // selectable seam edges on an otherwise flat face.
  if (simplifyResult) {
    operation.SimplifyResult(true, true, 1e-7);
  }
  const result = operation.Shape();
  operation.delete();
  if (result.IsNull()) {
    result.delete();
    throw new Error(`${kind} produced a null shape`);
  }
  return result;
}

function cutThreadTools(
  oc: Oc,
  target: TopoDS_Shape,
  cutters: TopoDS_Shape[],
): TopoDS_Shape {
  if (cutters.length === 0) {
    throw new Error('Modeled thread contains no cutter');
  }
  let result: TopoDS_Shape | null = null;
  try {
    for (const cutter of cutters) {
      const next = booleanShape(oc, 'cut', result ?? target, cutter, false);
      result?.delete();
      result = next;
    }
    if (!result) {
      throw new Error('Modeled thread cut did not produce a result');
    }
    const completed = result;
    result = null;
    return completed;
  } finally {
    result?.delete();
  }
}

function fuseTools(oc: Oc, tools: TopoDS_Shape[]): TopoDS_Shape {
  if (tools.length === 0) throw new Error('extrude contains no tool profiles');
  let result = tools[0];
  for (let index = 1; index < tools.length; index += 1) {
    const next = booleanShape(oc, 'join', result, tools[index]);
    result.delete();
    tools[index].delete();
    result = next;
  }
  return result;
}

function selectedEdges(oc: Oc, shape: TopoDS_Shape, keys: string[]) {
  const indices = keys.map((key) => {
    const value = Number(key.replace(/^edge:/, ''));
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid edge reference ${key}`);
    }
    return value;
  });
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, map);
  try {
    return indices.map((index) => {
      if (index >= map.Size()) throw new Error('Referenced solid edge no longer exists');
      const raw = map.FindKey(index + 1);
      const edge = oc.TopoDS.Edge_1(raw);
      raw.delete();
      return edge;
    });
  } finally {
    map.delete();
  }
}

function applyFillet(oc: Oc, target: TopoDS_Shape, job: KernelFilletJobDto): TopoDS_Shape {
  const edges = selectedEdges(oc, target, job.edge_keys);
  try {
    const maker = new oc.BRepFilletAPI_MakeFillet(
      target,
      oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
    );
    for (const edge of edges) maker.Add_2(job.radius, edge);
    const progress = new oc.Message_ProgressRange_1();
    maker.Build(progress);
    progress.delete();
    if (!maker.IsDone()) {
      maker.delete();
      throw new Error('OCCT could not build the selected solid fillet');
    }
    const result = maker.Shape();
    maker.delete();
    return result;
  } finally {
    edges.forEach((edge) => edge.delete());
  }
}

function applyChamfer(oc: Oc, target: TopoDS_Shape, job: KernelChamferJobDto): TopoDS_Shape {
  const edges = selectedEdges(oc, target, job.edge_keys);
  try {
    const maker = new oc.BRepFilletAPI_MakeChamfer(target);
    for (const edge of edges) maker.Add_2(job.distance, edge);
    const progress = new oc.Message_ProgressRange_1();
    maker.Build(progress);
    progress.delete();
    if (!maker.IsDone()) {
      maker.delete();
      throw new Error('OCCT could not build the selected solid chamfer');
    }
    const result = maker.Shape();
    maker.delete();
    return result;
  } finally {
    edges.forEach((edge) => edge.delete());
  }
}

function boundedThroughDepth(oc: Oc, shape: TopoDS_Shape, margin: number): number {
  const bounds = new oc.Bnd_Box_1();
  try {
    oc.BRepBndLib.Add(shape, bounds, true);
    if (bounds.IsVoid()) throw new Error('Could not bound the through-hole target');
    const diagonal = Math.sqrt(bounds.SquareExtent());
    if (!Number.isFinite(diagonal) || diagonal <= 0) {
      throw new Error('Through-hole target bounds are degenerate');
    }
    return diagonal + Math.max(margin, 1);
  } finally {
    bounds.delete();
  }
}

function boundedDirectionalDepth(
  oc: Oc,
  shape: TopoDS_Shape,
  origin: Point3Dto,
  direction: readonly [number, number, number],
): number {
  const bounds = new oc.Bnd_Box_1();
  try {
    oc.BRepBndLib.Add(shape, bounds, true);
    if (bounds.IsVoid()) throw new Error('Could not bound the threaded-hole target');
    const minimum = bounds.CornerMin();
    const maximum = bounds.CornerMax();
    const values = {
      min: [minimum.X(), minimum.Y(), minimum.Z()] as const,
      max: [maximum.X(), maximum.Y(), maximum.Z()] as const,
    };
    minimum.delete();
    maximum.delete();
    let depth = 0;
    for (const x of [values.min[0], values.max[0]]) {
      for (const y of [values.min[1], values.max[1]]) {
        for (const z of [values.min[2], values.max[2]]) {
          depth = Math.max(
            depth,
            (x - origin.x) * direction[0]
              + (y - origin.y) * direction[1]
              + (z - origin.z) * direction[2],
          );
        }
      }
    }
    if (!Number.isFinite(depth) || depth <= 0) {
      throw new Error('Threaded-hole target depth is degenerate');
    }
    return depth;
  } finally {
    bounds.delete();
  }
}

function makeLineEdge(
  oc: Oc,
  first: readonly [number, number, number],
  last: readonly [number, number, number],
) {
  const start = new oc.gp_Pnt_3(first[0], first[1], first[2]);
  const end = new oc.gp_Pnt_3(last[0], last[1], last[2]);
  const maker = new oc.BRepBuilderAPI_MakeEdge_3(start, end);
  start.delete();
  end.delete();
  if (!maker.IsDone()) {
    maker.delete();
    throw new Error('OCCT could not build a thread flank edge');
  }
  const edge = maker.Edge();
  maker.delete();
  return edge;
}

function makeThreadProfile(
  oc: Oc,
  axis: gp_Ax2,
  center: number,
  innerRadius: number,
  outerRadius: number,
  innerHalfWidth: number,
  outerHalfWidth: number,
  angle = 0,
) {
  const location = axis.Location();
  const normal = axis.Direction();
  const xAxis = axis.XDirection();
  const yAxis = axis.YDirection();
  const origin = [location.X(), location.Y(), location.Z()] as const;
  const axial = [normal.X(), normal.Y(), normal.Z()] as const;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const radial = [
    cosine * xAxis.X() + sine * yAxis.X(),
    cosine * xAxis.Y() + sine * yAxis.Y(),
    cosine * xAxis.Z() + sine * yAxis.Z(),
  ] as const;
  location.delete();
  normal.delete();
  xAxis.delete();
  yAxis.delete();
  const pointAt = (radius: number, offset: number) => [
    origin[0] + radius * radial[0] + (center + offset) * axial[0],
    origin[1] + radius * radial[1] + (center + offset) * axial[1],
    origin[2] + radius * radial[2] + (center + offset) * axial[2],
  ] as const;
  const points = [
    pointAt(innerRadius, -innerHalfWidth),
    pointAt(outerRadius, -outerHalfWidth),
    pointAt(outerRadius, outerHalfWidth),
    pointAt(innerRadius, innerHalfWidth),
  ];
  const maker = new oc.BRepBuilderAPI_MakeWire_1();
  try {
    for (let index = 0; index < points.length; index += 1) {
      const edge = makeLineEdge(oc, points[index], points[(index + 1) % points.length]);
      maker.Add_1(edge);
      edge.delete();
    }
    if (!maker.IsDone()) {
      throw new Error('OCCT could not close the thread cutter profile');
    }
    return maker.Wire();
  } finally {
    maker.delete();
  }
}

function makeInternalThreadCutters(
  oc: Oc,
  axis: gp_Ax2,
  predrillDiameter: number,
  nominalDiameter: number,
  pitch: number,
  threadDepth: number,
  throughAll: boolean,
  leftHand: boolean,
): TopoDS_Shape[] {
  const nominalRadialDepth = (nominalDiameter - predrillDiameter) * 0.5;
  // Penetrate the predrill void by a real modeling allowance. A tangent or
  // near-coincident cutter can leave the cylindrical predrill face behind.
  const overlap = Math.max(
    2e-3,
    Math.min(
      predrillDiameter * 5e-3,
      pitch * 5e-2,
      nominalRadialDepth * 1e-1,
    ),
  );
  const innerRadius = predrillDiameter * 0.5 - overlap;
  const outerRadius = nominalDiameter * 0.5;
  const radialDepth = outerRadius - innerRadius;
  // Start with the P/8 basic root flat at the major diameter, then widen the
  // internal-thread void toward the actual predrill along 60° flanks.
  const outerHalfWidth = pitch * 0.0625;
  const innerHalfWidth = outerHalfWidth + radialDepth * Math.tan(Math.PI / 6);
  if (
    innerRadius <= 0
    || outerRadius <= innerRadius
    || innerHalfWidth >= pitch * 0.499
  ) {
    throw new Error('Predrill diameter is too small for a non-overlapping 60° thread');
  }
  const centerStart = -pitch;
  const centerEnd = throughAll
    ? threadDepth + pitch
    : Math.max(centerStart + pitch * 0.25, threadDepth - innerHalfWidth);
  const turns = (centerEnd - centerStart) / pitch;
  if (!Number.isFinite(turns) || turns > 256) {
    throw new Error(
      'This modeled thread exceeds 256 turns; use simplified representation',
    );
  }

  const sectionCount = Math.max(2, Math.ceil(turns * 8));
  const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  try {
    for (let index = 0; index <= sectionCount; index += 1) {
      const ratio = index / sectionCount;
      const center = centerStart + (centerEnd - centerStart) * ratio;
      const angle = (leftHand ? -1 : 1) * TAU * turns * ratio;
      const profile = makeThreadProfile(
        oc,
        axis,
        center,
        innerRadius,
        outerRadius,
        innerHalfWidth,
        outerHalfWidth,
        angle,
      );
      loft.AddWire(profile);
      profile.delete();
    }
    loft.CheckCompatibility(false);
    const progress = new oc.Message_ProgressRange_1();
    loft.Build(progress);
    progress.delete();
    if (!loft.IsDone()) {
      throw new Error('OCCT could not loft the modeled thread cutter');
    }
    const loftShape = loft.Shape();
    if (loftShape.IsNull()
      || loftShape.ShapeType() !== oc.TopAbs_ShapeEnum.TopAbs_SOLID) {
      loftShape.delete();
      throw new Error('OCCT modeled thread loft is not a solid');
    }
    const cutter = oc.TopoDS.Solid_1(loftShape);
    loftShape.delete();
    if (!oc.BRepLib.OrientClosedSolid(cutter)) {
      cutter.delete();
      throw new Error('OCCT could not orient the thread cutter solid');
    }
    cutter.Orientation_2(oc.TopAbs_Orientation.TopAbs_FORWARD as never);
    const analyzer = new oc.BRepCheck_Analyzer(cutter, true, false);
    const isValid = analyzer.IsValid_2();
    analyzer.delete();
    if (!isValid) {
      cutter.delete();
      throw new Error('OCCT modeled thread cutter is invalid');
    }
    const properties = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(cutter, properties, true, false, false);
    const volume = properties.Mass();
    properties.delete();
    if (!Number.isFinite(volume) || Math.abs(volume) <= 1e-9) {
      cutter.delete();
      throw new Error('OCCT modeled thread cutter has no volume');
    }
    return [cutter];
  } finally {
    loft.delete();
  }
}

function addThreadMetadataToStep(
  bytes: Uint8Array,
  metadata: StepExportRequest['thread_metadata'],
): Uint8Array {
  if (metadata.length === 0) return bytes;
  const text = new TextDecoder().decode(bytes);
  const marker = 'FILE_DESCRIPTION((';
  const markerIndex = text.indexOf(marker);
  const firstQuote = text.indexOf("'", markerIndex + marker.length);
  if (markerIndex < 0 || firstQuote < 0) {
    throw new Error('OCCT STEP output is missing FILE_DESCRIPTION');
  }
  let closingQuote = firstQuote + 1;
  while (closingQuote < text.length) {
    if (text[closingQuote] !== "'") {
      closingQuote += 1;
      continue;
    }
    if (text[closingQuote + 1] === "'") {
      closingQuote += 2;
      continue;
    }
    break;
  }
  if (closingQuote >= text.length) {
    throw new Error('OCCT STEP FILE_DESCRIPTION is malformed');
  }
  const metadataHex = Array.from(
    new TextEncoder().encode(JSON.stringify(metadata)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const description = `noBS CAD AP242; NBCAD_THREAD_METADATA_V1_HEX=${metadataHex}`;
  const wrappedDescription = description.match(/.{1,58}/g)?.join('\n') ?? description;
  return new TextEncoder().encode(
    `${text.slice(0, firstQuote + 1)}${wrappedDescription}${text.slice(closingQuote)}`,
  );
}

function applyHole(oc: Oc, target: TopoDS_Shape, job: KernelHoleJobDto): TopoDS_Shape {
  const direction = unit(job.direction);
  const overlap = 1e-4;
  const start = new oc.gp_Pnt_3(
    job.center.x - direction[0] * overlap,
    job.center.y - direction[1] * overlap,
    job.center.z - direction[2] * overlap,
  );
  const dir = new oc.gp_Dir_4(direction[0], direction[1], direction[2]);
  const axis = new oc.gp_Ax2_3(start, dir);
  start.delete();
  dir.delete();
  const depth = job.extent.type === 'through_all'
    ? boundedThroughDepth(oc, target, (job.thread?.pitch ?? 0) * 2)
    : job.extent.depth;
  const mainMaker = new oc.BRepPrimAPI_MakeCylinder_3(
    axis,
    job.diameter * 0.5,
    depth + overlap * 2,
  );
  let cutter = mainMaker.Shape();
  mainMaker.delete();
  let threadCutters: TopoDS_Shape[] = [];
  try {
    if (job.style === 'counterbore') {
      const secondary = new oc.BRepPrimAPI_MakeCylinder_3(
        axis,
        job.counterbore_diameter * 0.5,
        job.counterbore_depth + overlap * 2,
      );
      const shape = secondary.Shape();
      secondary.delete();
      const next = booleanShape(oc, 'join', cutter, shape);
      cutter.delete();
      shape.delete();
      cutter = next;
    } else if (job.style === 'countersink') {
      const largeRadius = job.countersink_diameter * 0.5;
      const smallRadius = job.diameter * 0.5;
      const sinkDepth = (largeRadius - smallRadius) /
        Math.tan(job.countersink_angle_deg * Math.PI / 360);
      const secondary = new oc.BRepPrimAPI_MakeCone_3(
        axis,
        largeRadius,
        smallRadius,
        sinkDepth + overlap,
      );
      const shape = secondary.Shape();
      secondary.delete();
      const next = booleanShape(oc, 'join', cutter, shape);
      cutter.delete();
      shape.delete();
      cutter = next;
    }
    if (job.thread?.representation === 'modeled') {
      const fullThreadDepth = job.thread.depth === null;
      const availableThreadDepth = job.extent.type === 'through_all'
        ? boundedDirectionalDepth(oc, target, job.center, direction)
        : depth;
      const requestedThreadDepth = fullThreadDepth
        ? availableThreadDepth
        : Math.min(job.thread.depth!, availableThreadDepth);
      const threadOrigin = new oc.gp_Pnt_3(job.center.x, job.center.y, job.center.z);
      const threadDirection = new oc.gp_Dir_4(direction[0], direction[1], direction[2]);
      const xDirection = axis.XDirection();
      const threadAxis = new oc.gp_Ax2_2(threadOrigin, threadDirection, xDirection);
      threadOrigin.delete();
      threadDirection.delete();
      xDirection.delete();
      threadCutters = makeInternalThreadCutters(
        oc,
        threadAxis,
        job.diameter,
        job.thread.nominal_diameter,
        job.thread.pitch,
        requestedThreadDepth,
        job.extent.type === 'through_all' && fullThreadDepth,
        job.thread.hand === 'left',
      );
      threadAxis.delete();
    }
    if (job.extent.type === 'distance' && job.bottom_style === 'drill_point') {
      const halfAngle = job.drill_point_angle_deg * Math.PI / 360;
      const tipDepth = (job.diameter * 0.5) / Math.tan(halfAngle);
      if (!Number.isFinite(tipDepth) || tipDepth <= 0) {
        throw new Error('Drill point angle is invalid');
      }
      const tipStart = new oc.gp_Pnt_3(
        job.center.x + direction[0] * (depth - overlap),
        job.center.y + direction[1] * (depth - overlap),
        job.center.z + direction[2] * (depth - overlap),
      );
      const tipDirection = new oc.gp_Dir_4(direction[0], direction[1], direction[2]);
      const tipAxis = new oc.gp_Ax2_3(tipStart, tipDirection);
      tipStart.delete();
      tipDirection.delete();
      const tipMaker = new oc.BRepPrimAPI_MakeCone_3(
        tipAxis,
        job.diameter * 0.5,
        0,
        tipDepth + overlap,
      );
      const tip = tipMaker.Shape();
      tipMaker.delete();
      tipAxis.delete();
      const next = booleanShape(oc, 'join', cutter, tip);
      cutter.delete();
      tip.delete();
      cutter = next;
    }
    let result: TopoDS_Shape;
    if (threadCutters.length > 0) {
      let threadedResult: TopoDS_Shape | null = null;
      try {
        // Subtract the helical tool before opening the predrill bore. Passing
        // both overlapping tools as a compound can preserve the removed thread
        // volume as a detached second solid, visually filling the groove.
        threadedResult = cutThreadTools(oc, target, threadCutters);
        result = booleanShape(oc, 'cut', threadedResult, cutter, false);
      } catch (error) {
        throw new Error(
          `Modeled thread cut failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        threadedResult?.delete();
      }
    } else {
      result = booleanShape(oc, 'cut', target, cutter);
    }
    if (threadCutters.length > 0) {
      const resultAnalyzer = new oc.BRepCheck_Analyzer(result, true, false);
      const resultIsValid = resultAnalyzer.IsValid_2();
      resultAnalyzer.delete();
      if (!resultIsValid) {
        result.delete();
        throw new Error('OCCT modeled thread result is invalid');
      }
    }
    return result;
  } finally {
    threadCutters.forEach((threadCutter) => threadCutter.delete());
    cutter.delete();
    axis.delete();
  }
}

function selectedFaces(oc: Oc, shape: TopoDS_Shape, keys: string[]) {
  const indices = keys.map((key) => {
    const value = Number(key.replace(/^face:/, ''));
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid face reference ${key}`);
    }
    return value;
  });
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, map);
  try {
    return indices.map((index) => {
      if (index >= map.Size()) throw new Error('Referenced Shell face no longer exists');
      const raw = map.FindKey(index + 1);
      const face = oc.TopoDS.Face_1(raw);
      raw.delete();
      return face;
    });
  } finally {
    map.delete();
  }
}

function signatureScalarMatches(actual: number, expected: number): boolean {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  return Math.abs(actual - expected) <= scale * 1e-6;
}

function planarFaceSignatureMatches(
  actual: PlanarFaceSignatureDto | null,
  expected: PlanarFaceSignatureDto,
): boolean {
  if (!actual) return false;
  const centroidDistance = Math.hypot(
    actual.centroid.x - expected.centroid.x,
    actual.centroid.y - expected.centroid.y,
    actual.centroid.z - expected.centroid.z,
  );
  const lengthScale = Math.max(1, Math.sqrt(Math.max(actual.area, 0)), actual.perimeter);
  const expectedNormalLength = Math.hypot(
    expected.normal.x,
    expected.normal.y,
    expected.normal.z,
  );
  if (expectedNormalLength <= 1e-12 || centroidDistance > lengthScale * 1e-6) {
    return false;
  }
  const normalDot =
    (actual.normal.x * expected.normal.x
      + actual.normal.y * expected.normal.y
      + actual.normal.z * expected.normal.z) / expectedNormalLength;
  return normalDot >= 1 - 1e-7
    && signatureScalarMatches(actual.area, expected.area)
    && signatureScalarMatches(actual.perimeter, expected.perimeter)
    && actual.wire_count === expected.wire_count
    && actual.edge_count === expected.edge_count;
}

function resolvePlanarFaceReference(
  oc: Oc,
  shape: TopoDS_Shape,
  expected: PlanarFaceSignatureDto,
): TopoDS_Face {
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, map);
  const matches: TopoDS_Face[] = [];
  try {
    for (let index = 1; index <= map.Size(); index += 1) {
      const raw = map.FindKey(index);
      const face = oc.TopoDS.Face_1(raw);
      raw.delete();
      const plane = facePlane(oc, face);
      const signature = planarFaceSignature(oc, face, plane);
      if (planarFaceSignatureMatches(signature, expected)) {
        matches.push(face);
      } else {
        face.delete();
      }
    }
  } finally {
    map.delete();
  }
  if (matches.length !== 1) {
    matches.forEach((face) => face.delete());
    if (matches.length === 0) {
      throw new Error('Referenced Extrude source face changed or no longer exists');
    }
    throw new Error('Referenced Extrude source face is ambiguous after topology change');
  }
  return matches[0];
}

function applyShell(oc: Oc, target: TopoDS_Shape, job: KernelShellJobDto): TopoDS_Shape {
  if (job.face_keys.length === 0 || job.thickness <= 0) {
    throw new Error('Shell needs removable faces and a positive thickness');
  }
  const faces = selectedFaces(oc, target, job.face_keys);
  const closing = new oc.TopTools_ListOfShape_1();
  try {
    faces.forEach((face) => {
      const appended = closing.Append_1(face);
      appended.delete();
    });
    const maker = new oc.BRepOffsetAPI_MakeThickSolid();
    const progress = new oc.Message_ProgressRange_1();
    maker.MakeThickSolidByJoin(
      target,
      closing,
      job.inward ? -job.thickness : job.thickness,
      1e-3,
      oc.BRepOffset_Mode.BRepOffset_Skin as never,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc as never,
      true,
      progress,
    );
    progress.delete();
    if (!maker.IsDone()) {
      maker.delete();
      throw new Error('OCCT could not build the selected Shell');
    }
    const result = maker.Shape();
    maker.delete();
    if (result.IsNull()) {
      result.delete();
      throw new Error('Shell produced a null body');
    }
    return result;
  } finally {
    closing.delete();
    faces.forEach((face) => face.delete());
  }
}

function makeTransform(oc: Oc, transform: KernelTransformDto) {
  const value = new oc.gp_Trsf_1();
  if (transform.kind === 'translate') {
    const vector = new oc.gp_Vec_4(
      transform.vector.x,
      transform.vector.y,
      transform.vector.z,
    );
    value.SetTranslation_1(vector);
    vector.delete();
  } else if (transform.kind === 'mirror') {
    const origin = new oc.gp_Pnt_3(
      transform.origin.x,
      transform.origin.y,
      transform.origin.z,
    );
    const normal = new oc.gp_Dir_4(
      transform.normal.x,
      transform.normal.y,
      transform.normal.z,
    );
    const plane = new oc.gp_Ax2_3(origin, normal);
    value.SetMirror_3(plane);
    plane.delete();
    normal.delete();
    origin.delete();
  } else {
    const origin = new oc.gp_Pnt_3(
      transform.origin.x,
      transform.origin.y,
      transform.origin.z,
    );
    const direction = new oc.gp_Dir_4(
      transform.axis.x,
      transform.axis.y,
      transform.axis.z,
    );
    const axis = new oc.gp_Ax1_2(origin, direction);
    value.SetRotation_1(axis, transform.angle_rad);
    axis.delete();
    direction.delete();
    origin.delete();
  }
  return value;
}

function applyBodyTransform(
  oc: Oc,
  source: TopoDS_Shape,
  transform: KernelTransformDto,
): TopoDS_Shape {
  const value = makeTransform(oc, transform);
  try {
    const maker = new oc.BRepBuilderAPI_Transform_2(source, value, true);
    if (!maker.IsDone()) {
      maker.delete();
      throw new Error('OCCT body transform failed');
    }
    const result = maker.Shape();
    maker.delete();
    if (result.IsNull()) {
      result.delete();
      throw new Error('Body transform produced a null body');
    }
    return result;
  } finally {
    value.delete();
  }
}

function applySplitBody(
  oc: Oc,
  target: TopoDS_Shape,
  job: KernelSplitBodyJobDto,
): [TopoDS_Shape, TopoDS_Shape] {
  const normal = unit(job.plane_normal);
  const origin = new oc.gp_Pnt_3(
    job.plane_origin.x,
    job.plane_origin.y,
    job.plane_origin.z,
  );
  const direction = new oc.gp_Dir_4(normal[0], normal[1], normal[2]);
  const plane = new oc.gp_Pln_3(origin, direction);
  const faceMaker = new oc.BRepBuilderAPI_MakeFace_3(plane);
  plane.delete();
  direction.delete();
  if (!faceMaker.IsDone()) {
    origin.delete();
    faceMaker.delete();
    throw new Error('OCCT could not build the splitting plane');
  }
  const face = faceMaker.Face();
  faceMaker.delete();
  const positivePoint = new oc.gp_Pnt_3(
    job.plane_origin.x + normal[0],
    job.plane_origin.y + normal[1],
    job.plane_origin.z + normal[2],
  );
  const negativePoint = new oc.gp_Pnt_3(
    job.plane_origin.x - normal[0],
    job.plane_origin.y - normal[1],
    job.plane_origin.z - normal[2],
  );
  origin.delete();
  const positiveMaker = new oc.BRepPrimAPI_MakeHalfSpace_1(face, positivePoint);
  const negativeMaker = new oc.BRepPrimAPI_MakeHalfSpace_1(face, negativePoint);
  positivePoint.delete();
  negativePoint.delete();
  face.delete();
  const positiveHalf = positiveMaker.Shape();
  const negativeHalf = negativeMaker.Shape();
  positiveMaker.delete();
  negativeMaker.delete();
  try {
    return [
      booleanShape(oc, 'intersect', target, positiveHalf),
      booleanShape(oc, 'intersect', target, negativeHalf),
    ];
  } finally {
    positiveHalf.delete();
    negativeHalf.delete();
  }
}

function readPoint(value: { X(): number; Y(): number; Z(): number }): Point3Dto {
  return { x: value.X(), y: value.Y(), z: value.Z() };
}

function crossNormal(a: Point3Dto, b: Point3Dto, c: Point3Dto): Point3Dto | null {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z);
  return length < 1e-12 ? null : { x: x / length, y: y / length, z: z / length };
}

function facePlane(oc: Oc, face: ReturnType<Oc['TopoDS']['Face_1']>): PlaneBasis | null {
  const surface = new oc.BRepAdaptor_Surface_2(face, true);
  try {
    if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) return null;
    const plane = surface.Plane();
    const axes = plane.Position();
    const origin = axes.Location();
    const uDir = axes.XDirection();
    const normalDir = axes.Direction();
    const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const normal: [number, number, number] = [
      normalDir.X() * (reversed ? -1 : 1),
      normalDir.Y() * (reversed ? -1 : 1),
      normalDir.Z() * (reversed ? -1 : 1),
    ];
    const u: [number, number, number] = [uDir.X(), uDir.Y(), uDir.Z()];
    const v: [number, number, number] = [
      normal[1] * u[2] - normal[2] * u[1],
      normal[2] * u[0] - normal[0] * u[2],
      normal[0] * u[1] - normal[1] * u[0],
    ];
    const basis: PlaneBasis = {
      origin: [origin.X(), origin.Y(), origin.Z()],
      u,
      v,
      normal,
    };
    normalDir.delete();
    uDir.delete();
    origin.delete();
    axes.delete();
    plane.delete();
    return basis;
  } finally {
    surface.delete();
  }
}

function planarFaceSignature(
  oc: Oc,
  face: TopoDS_Face,
  plane: PlaneBasis | null,
): PlanarFaceSignatureDto | null {
  if (!plane) return null;
  const surface = new oc.GProp_GProps_1();
  const boundary = new oc.GProp_GProps_1();
  const wires = new oc.TopTools_IndexedMapOfShape_1();
  const edges = new oc.TopTools_IndexedMapOfShape_1();
  try {
    oc.BRepGProp.SurfaceProperties_1(face, surface, false, false);
    oc.BRepGProp.LinearProperties(face, boundary, false, false);
    oc.TopExp.MapShapes_1(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE as never, wires);
    oc.TopExp.MapShapes_1(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, edges);
    const center = surface.CentreOfMass();
    try {
      return {
        centroid: readPoint(center),
        normal: {
          x: plane.normal[0],
          y: plane.normal[1],
          z: plane.normal[2],
        },
        area: Math.abs(surface.Mass()),
        perimeter: Math.abs(boundary.Mass()),
        wire_count: wires.Size(),
        edge_count: edges.Size(),
      };
    } finally {
      center.delete();
    }
  } finally {
    edges.delete();
    wires.delete();
    boundary.delete();
    surface.delete();
  }
}

function meshShape(oc: Oc, bodyId: number, shape: TopoDS_Shape): KernelBodyDto {
  const mesher = new oc.BRepMesh_IncrementalMesh_2(shape, 0.15, false, 0.35, true);
  mesher.delete();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: KernelFaceDto[] = [];
  const edges: KernelEdgeDto[] = [];

  const faceMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    faceMap,
  );
  for (let faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
    const rawFace = faceMap.FindKey(faceIndex);
    const face = oc.TopoDS.Face_1(rawFace);
    rawFace.delete();
    const firstIndex = indices.length;
    const location = new oc.TopLoc_Location_1();
    const handle = oc.BRep_Tool.Triangulation(face, location, 0);
    if (!handle.IsNull()) {
      const triangulation = handle.get();
      if (!triangulation.HasNormals()) triangulation.ComputeNormals();
      const transform = location.Transformation();
      const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      for (let triangleIndex = 1; triangleIndex <= triangulation.NbTriangles(); triangleIndex += 1) {
        const triangle = triangulation.Triangle(triangleIndex);
        const nodeIndices = [triangle.Value(1), triangle.Value(2), triangle.Value(3)];
        if (reversed) [nodeIndices[1], nodeIndices[2]] = [nodeIndices[2], nodeIndices[1]];
        const vertices = nodeIndices.map((nodeIndex) => {
          const node = triangulation.Node(nodeIndex);
          node.Transform(transform);
          const vertexNormal = triangulation.Normal_1(nodeIndex);
          vertexNormal.Transform(transform);
          if (reversed) vertexNormal.Reverse();
          const result = { point: readPoint(node), normal: readPoint(vertexNormal) };
          vertexNormal.delete();
          node.delete();
          return result;
        });
        if (crossNormal(vertices[0].point, vertices[1].point, vertices[2].point)) {
          for (const vertex of vertices) {
            positions.push(vertex.point.x, vertex.point.y, vertex.point.z);
            normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
            indices.push(indices.length);
          }
        }
        triangle.delete();
      }
      transform.delete();
    }
    handle.delete();
    location.delete();
    const plane = facePlane(oc, face);
    faces.push({
      key: `face:${faceIndex - 1}`,
      first_index: firstIndex,
      index_count: indices.length - firstIndex,
      plane,
      signature: planarFaceSignature(oc, face, plane),
    });
    face.delete();
  }
  faceMap.delete();

  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    edgeMap,
  );
  const edgeFaces = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
  oc.TopExp.MapShapesAndUniqueAncestors(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    edgeFaces,
    false,
  );
  for (let edgeIndex = 1; edgeIndex <= edgeMap.Size(); edgeIndex += 1) {
    const rawEdge = edgeMap.FindKey(edgeIndex);
    const edge = oc.TopoDS.Edge_1(rawEdge);
    rawEdge.delete();
    let refinable = false;
    const ancestorIndex = edgeFaces.FindIndex(edge);
    if (ancestorIndex > 0) {
      const borrowedFaces = edgeFaces.FindFromIndex(ancestorIndex);
      const adjacentFaces = new oc.TopTools_ListOfShape_3(borrowedFaces);
      borrowedFaces.delete();
      try {
        if (adjacentFaces.Size() === 2) {
          const rawFirstFace = adjacentFaces.First_1();
          const firstFace = oc.TopoDS.Face_1(rawFirstFace);
          rawFirstFace.delete();
          adjacentFaces.RemoveFirst();
          const rawSecondFace = adjacentFaces.First_1();
          const secondFace = oc.TopoDS.Face_1(rawSecondFace);
          rawSecondFace.delete();
          refinable = oc.BRep_Tool.Continuity_1(edge, firstFace, secondFace)
            === oc.GeomAbs_Shape.GeomAbs_C0;
          secondFace.delete();
          firstFace.delete();
        }
      } finally {
        adjacentFaces.delete();
      }
    }
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const points: Point3Dto[] = [];
    if (curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line) {
      for (const parameter of [curve.FirstParameter(), curve.LastParameter()]) {
        const p = curve.Value(parameter);
        points.push(readPoint(p));
        p.delete();
      }
    } else {
      const discretization = new oc.GCPnts_UniformDeflection_2(curve, 0.05, true);
      try {
        if (discretization.IsDone() && discretization.NbPoints() >= 2) {
          for (let pointIndex = 1; pointIndex <= discretization.NbPoints(); pointIndex += 1) {
            const p = discretization.Value(pointIndex);
            points.push(readPoint(p));
            p.delete();
          }
        } else {
          const first = curve.FirstParameter();
          const last = curve.LastParameter();
          for (let sample = 0; sample < 25; sample += 1) {
            const p = curve.Value(first + (last - first) * sample / 24);
            points.push(readPoint(p));
            p.delete();
          }
        }
      } finally {
        discretization.delete();
      }
    }
    edges.push({ key: `edge:${edgeIndex - 1}`, points, refinable });
    curve.delete();
    edge.delete();
  }
  edgeFaces.delete();
  edgeMap.delete();

  return { body_id: bodyId, positions, normals, indices, faces, edges };
}

function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error('STEP import contains invalid base64 data');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function importStepShape(oc: Oc, dataBase64: string): TopoDS_Shape {
  const path = `/nbcad-import-${Date.now()}-${Math.random().toString(36).slice(2)}.step`;
  const reader = new oc.STEPControl_Reader_1();
  try {
    oc.FS.writeFile(path, decodeBase64(dataBase64));
    if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error('OCCT could not read the STEP file');
    }
    const progress = new oc.Message_ProgressRange_1();
    const transferred = reader.TransferRoots(progress);
    progress.delete();
    if (transferred <= 0) {
      throw new Error('STEP file did not contain transferable shapes');
    }
    const shape = reader.OneShape();
    if (shape.IsNull()) {
      shape.delete();
      throw new Error('STEP import produced a null shape');
    }
    return shape;
  } finally {
    reader.delete();
    try {
      oc.FS.unlink(path);
    } catch {
      // Read failure can happen before the temporary file is created.
    }
  }
}

export class BrowserOcctKernel {
  private readonly bodies = new Map<number, TopoDS_Shape>();

  private constructor(private readonly oc: Oc) {}

  static async create(): Promise<BrowserOcctKernel> {
    return new BrowserOcctKernel(await loadOc());
  }

  clear(): void {
    for (const shape of this.bodies.values()) shape.delete();
    this.bodies.clear();
  }

  dispose(): void {
    this.clear();
  }

  recompute(plan: RecomputePlanDto): KernelSceneDto {
    this.clear();
    const errors: KernelFeatureErrorDto[] = [...(plan.errors ?? [])];

    for (const operation of plan.jobs) {
      try {
        if (operation.kind === 'import_step') {
          this.bodies.set(
            operation.job.result_body_id,
            importStepShape(this.oc, operation.job.data_base64),
          );
          continue;
        }
        if (operation.kind === 'fillet') {
          const target = this.bodies.get(operation.job.target_body_id);
          if (!target) throw new Error('Fillet target body is missing');
          const result = applyFillet(this.oc, target, operation.job);
          target.delete();
          this.bodies.set(operation.job.target_body_id, result);
          continue;
        }
        if (operation.kind === 'chamfer') {
          const target = this.bodies.get(operation.job.target_body_id);
          if (!target) throw new Error('Chamfer target body is missing');
          const result = applyChamfer(this.oc, target, operation.job);
          target.delete();
          this.bodies.set(operation.job.target_body_id, result);
          continue;
        }
        if (operation.kind === 'hole') {
          const target = this.bodies.get(operation.job.target_body_id);
          if (!target) throw new Error('Hole target body is missing');
          const result = applyHole(this.oc, target, operation.job);
          target.delete();
          this.bodies.set(operation.job.target_body_id, result);
          continue;
        }
        if (operation.kind === 'shell') {
          const target = this.bodies.get(operation.job.target_body_id);
          if (!target) throw new Error('Shell target body is missing');
          const result = applyShell(this.oc, target, operation.job);
          target.delete();
          this.bodies.set(operation.job.target_body_id, result);
          continue;
        }
        if (operation.kind === 'transform') {
          const job: KernelTransformJobDto = operation.job;
          if (job.result_body_ids.length !== job.transforms.length * job.source_body_ids.length) {
            throw new Error('Body transform output count is invalid');
          }
          let outputIndex = 0;
          for (const transform of job.transforms) {
            for (const sourceId of job.source_body_ids) {
              const source = this.bodies.get(sourceId);
              if (!source) throw new Error(`Body transform source ${sourceId} is missing`);
              this.bodies.set(
                job.result_body_ids[outputIndex],
                applyBodyTransform(this.oc, source, transform),
              );
              outputIndex += 1;
            }
          }
          continue;
        }
        if (operation.kind === 'combine') {
          const job: KernelCombineJobDto = operation.job;
          const target = this.bodies.get(job.target_body_id);
          if (!target) throw new Error('Combine target body is missing');
          let result = target;
          for (const toolId of job.tool_body_ids) {
            const tool = this.bodies.get(toolId);
            if (!tool) throw new Error(`Combine tool body ${toolId} is missing`);
            const next = booleanShape(this.oc, job.operation, result, tool);
            if (result !== target) result.delete();
            result = next;
          }
          target.delete();
          this.bodies.set(job.target_body_id, result);
          if (!job.keep_tools) {
            for (const toolId of job.tool_body_ids) {
              const tool = this.bodies.get(toolId);
              tool?.delete();
              this.bodies.delete(toolId);
            }
          }
          continue;
        }
        if (operation.kind === 'split_body') {
          const target = this.bodies.get(operation.job.target_body_id);
          if (!target) throw new Error('Split Body target is missing');
          const [first, second] = applySplitBody(this.oc, target, operation.job);
          target.delete();
          this.bodies.set(operation.job.target_body_id, first);
          this.bodies.set(operation.job.new_body_id, second);
          continue;
        }
        const job = operation.job;
        let tools: TopoDS_Shape[];
        switch (operation.kind) {
          case 'extrude': {
            const source = operation.job.source_face;
            if (source) {
              const sourceBody = this.bodies.get(source.body_id);
              if (!sourceBody) throw new Error('Extrude source body is missing');
              const face = resolvePlanarFaceReference(
                this.oc,
                sourceBody,
                source.signature,
              );
              try {
                tools = [makeExactFaceTool(this.oc, operation.job, face)];
              } finally {
                face.delete();
              }
            } else {
              tools = operation.job.profiles.map((profile) =>
                makeTool(this.oc, operation.job, profile));
            }
            break;
          }
          case 'revolve':
            tools = operation.job.profiles.map((profile) =>
              makeRevolveTool(this.oc, operation.job, profile));
            break;
          case 'sweep':
            tools = [makeSweepTool(this.oc, operation.job)];
            break;
          case 'loft':
            tools = [makeLoftTool(this.oc, operation.job)];
            break;
          case 'rib':
            tools = operation.job.profiles.map((profile) =>
              makeTool(this.oc, operation.job, profile));
            break;
        }
        if (job.operation === 'new_body') {
          if (tools.length !== job.result_body_ids.length) {
            tools.forEach((shape) => shape.delete());
            throw new Error('New Body output count does not match profiles');
          }
          tools.forEach((shape, index) => {
            this.bodies.set(job.result_body_ids[index], shape);
          });
        } else if (job.operation === 'join' && job.target_body_ids.length === 0) {
          if (job.result_body_ids.length !== 1 || tools.length < 2) {
            tools.forEach((shape) => shape.delete());
            throw new Error('Join Profiles needs multiple profiles and one output body');
          }
          this.bodies.set(job.result_body_ids[0], fuseTools(this.oc, tools));
        } else {
          const tool = fuseTools(this.oc, tools);
          try {
            for (const targetId of job.target_body_ids) {
              const target = this.bodies.get(targetId);
              if (!target) throw new Error(`boolean target body ${targetId} is missing`);
              const result = booleanShape(this.oc, job.operation, target, tool);
              target.delete();
              this.bodies.set(targetId, result);
            }
          } finally {
            tool.delete();
          }
        }
      } catch (error) {
        errors.push({
          feature_id: operation.job.feature_id,
          message: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    const bodies = [...this.bodies.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bodyId, shape]) => meshShape(this.oc, bodyId, shape));
    return { bodies, errors };
  }

  /** Export selected (or all) live B-reps as AP242 STEP bytes. */
  exportStep(request: StepExportRequest): Uint8Array {
    if (this.bodies.size === 0) {
      throw new Error('There are no active bodies to export.');
    }
    const ids = request.body_ids.length > 0
      ? [...new Set(request.body_ids)]
      : [...this.bodies.keys()].sort((a, b) => a - b);
    const writer = new this.oc.STEPControl_Writer_1();
    const path = `/nbcad-${Date.now()}-${Math.random().toString(36).slice(2)}.step`;
    try {
      this.oc.Interface_Static.SetCVal('write.step.schema', 'AP242DIS');
      for (const bodyId of ids) {
        const shape = this.bodies.get(bodyId);
        if (!shape) throw new Error(`Selected body ${bodyId} is not active.`);
        const progress = new this.oc.Message_ProgressRange_1();
        const status = writer.Transfer(
          shape,
          this.oc.STEPControl_StepModelType.STEPControl_AsIs as never,
          true,
          progress,
        );
        progress.delete();
        if (status !== this.oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
          throw new Error(`OCCT could not transfer Body${bodyId} to STEP.`);
        }
      }
      if (writer.Write(path) !== this.oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
        throw new Error('OCCT could not write the STEP file.');
      }
      return addThreadMetadataToStep(
        new Uint8Array(this.oc.FS.readFile(path)),
        request.thread_metadata,
      );
    } finally {
      writer.delete();
      try {
        this.oc.FS.unlink(path);
      } catch {
        // The file is absent when transfer failed before Write.
      }
    }
  }

  /** Browser mesh export is a follow-up; native shell owns STL/3MF v1. */
  exportStl(_request: MeshExportRequest): Uint8Array {
    throw new Error(translate('file.meshNativeOnly'));
  }

  export3mf(_request: MeshExportRequest): Uint8Array {
    throw new Error(translate('file.meshNativeOnly'));
  }
}
