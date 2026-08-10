import type {
  DrawingAnnotationDto,
  DrawingProjectionDto,
  DrawingProjectedCircleDto,
  DrawingSheetDto,
  DrawingSheetStyleDto,
  DrawingViewDto,
  ProfileCatalogItemDto,
  ProfileCurveDto,
  ProfileLoopDto,
} from '../engine/types';
import type { UnitSystem } from '../types/document';
import {
  angularDimensionGeometry,
  arcLengthDimensionGeometry,
  automaticSymmetryAxisGeometry,
  boltCircleGeometry,
  centerLineBetweenEdgesGeometry,
  centerLineGeometry,
  centerMarkGeometry,
  drawingChamferText,
  drawingAngularDimensionText,
  drawingDimensionText,
  drawingHoleCalloutText,
  drawingProjectedPointToPaper,
  lineDimensionGeometry,
  linearDimensionGeometry,
  pointLineDimensionGeometry,
  ordinateDimensionGeometry,
  radialDimensionGeometry,
  resolveDrawingAnchor,
  resolveDrawingAttachment,
  resolveDrawingCircle,
  resolveDrawingLine,
} from './annotations';
import {
  drawingFormatShortLabel,
  drawingSheetSize,
  drawingToleranceNoteText,
  defaultDrawingSheetStyle,
} from './sheet';
import {
  drawingDxfLineweight,
  drawingDxfLinetypeName,
  drawingDxfPattern,
  type DrawingLineRole,
} from './styles';

type Point2 = [number, number];
type DxfPair = [number, string | number];

const MODEL_SPACE_RECORD = '27';
const BLOCK_RECORD_TABLE = '26';
const LAYER_TABLE = '5';
const DIMSTYLE_NAME = 'NBS_STANDARD';

interface DimensionBlock {
  name: string;
  recordHandle: string;
  beginHandle: string;
  endHandle: string;
  entities: string[];
}

interface DimensionEntity {
  annotationId: number;
  kind: string;
  type: number;
  definition: Point2;
  textPosition: Point2;
  text: string;
  measurement: number;
  viewScale: number;
  subtype: DxfPair[];
  render: (target: string[], owner: string) => void;
}

/**
 * Builds a standards-friendly AutoCAD 2013 ASCII DXF. Sheet coordinates are
 * model-space millimetres: this keeps the file useful in AutoCAD, DraftSight,
 * LibreCAD, and downstream inspection/CAM tools without a proprietary DWG SDK.
 */
export function buildDrawingSheetDxf(
  sheet: DrawingSheetDto,
  projections: DrawingProjectionDto[],
  units: UnitSystem = 'mm',
): string {
  const [width, height] = drawingSheetSize(sheet.format, sheet.orientation);
  const writer = new DrawingDxfWriter(width, height, sheet.standard === 'iso', sheet.style);
  const projectionsByView = new Map(
    sheet.views.map((view, index) => [view.id, projections[index]] as const),
  );

  addSheetFrame(writer, sheet, width, height);
  sheet.views.forEach((view, index) => addProjectedView(writer, view, projections[index], sheet, height));
  sheet.views.forEach((child) => {
    const parentId = child.derivation?.parent_view_id;
    if (parentId == null) return;
    const parent = sheet.views.find((view) => view.id === parentId);
    const projection = projectionsByView.get(parentId);
    if (parent && projection) addDerivedSource(writer, child, parent, projection, sheet, height);
  });
  sheet.annotations.forEach((annotation) => {
    addAnnotation(writer, annotation, sheet, projectionsByView, units, height);
  });
  return writer.finish();
}

/**
 * Exports one manufacturable sketch region at true 1:1 model scale. The
 * selected even-depth loop is the outside boundary and its immediate odd-depth
 * children are emitted as hole wires. No paper size, view scale, or sheet
 * placement is applied.
 */
export function buildManufacturingProfileDxf(
  catalog: ProfileCatalogItemDto,
  profileIndex: number,
): string {
  const outer = catalog.profiles.find((profile) => profile.index === profileIndex);
  if (!outer) throw new Error(`Profile ${profileIndex + 1} no longer exists in ${catalog.sketch_name}.`);
  if (outer.nesting_depth % 2 !== 0) {
    throw new Error('A manufacturing profile must be an outer material region, not a hole boundary.');
  }
  const holes = catalog.profiles.filter((profile) => profile.parent_index === outer.index);
  const loops = [outer, ...holes];
  const bounds = profileBounds(loops);
  const writer = new DrawingDxfWriter(
    Math.max(1, bounds[2] - bounds[0]),
    Math.max(1, bounds[3] - bounds[1]),
    true,
    defaultDrawingSheetStyle(),
    bounds[0],
    bounds[1],
  );
  addManufacturingLoop(writer, outer, 'PROFILE_OUTER');
  holes.forEach((hole) => addManufacturingLoop(writer, hole, 'PROFILE_HOLES'));
  return writer.finish();
}

class DrawingDxfWriter {
  private readonly entities: string[] = [];
  private readonly dimensionBlocks: DimensionBlock[] = [];
  private nextHandleValue = 0x100;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly metricStandard: boolean,
    private readonly style: DrawingSheetStyleDto,
    private readonly minX = 0,
    private readonly minY = 0,
  ) {}

  line(layer: string, start: Point2, end: Point2, target = this.entities, owner = MODEL_SPACE_RECORD): void {
    target.push(entity([
      [0, 'LINE'], [5, this.handle()], [330, owner], [100, 'AcDbEntity'], [8, layer],
      [100, 'AcDbLine'], ...pointPairs(10, start), ...pointPairs(11, end),
    ]));
  }

  polyline(
    layer: string,
    points: Point2[],
    closed = false,
    target = this.entities,
    owner = MODEL_SPACE_RECORD,
  ): void {
    const normalized = normalizePolyline(points, closed);
    if (normalized.length < 2) return;
    const pairs: DxfPair[] = [
      [0, 'LWPOLYLINE'], [5, this.handle()], [330, owner], [100, 'AcDbEntity'], [8, layer],
      [100, 'AcDbPolyline'], [90, normalized.length], [70, closed ? 1 : 0], [43, 0],
    ];
    for (const [x, y] of normalized) pairs.push([10, x], [20, y]);
    target.push(entity(pairs));
  }

  circle(
    layer: string,
    center: Point2,
    radius: number,
    target = this.entities,
    owner = MODEL_SPACE_RECORD,
  ): void {
    if (!(radius > 0)) return;
    target.push(entity([
      [0, 'CIRCLE'], [5, this.handle()], [330, owner], [100, 'AcDbEntity'], [8, layer],
      [100, 'AcDbCircle'], ...pointPairs(10, center), [40, radius],
    ]));
  }

  arc(
    layer: string,
    center: Point2,
    radius: number,
    startAngle: number,
    endAngle: number,
    target = this.entities,
    owner = MODEL_SPACE_RECORD,
  ): void {
    if (!(radius > 0)) return;
    target.push(entity([
      [0, 'ARC'], [5, this.handle()], [330, owner], [100, 'AcDbEntity'], [8, layer],
      [100, 'AcDbCircle'], ...pointPairs(10, center), [40, radius],
      [100, 'AcDbArc'], [50, normalizeDegrees(startAngle)], [51, normalizeDegrees(endAngle)],
    ]));
  }

  hatch(layer: string, loops: Point2[][], angleDeg: number, spacing: number): void {
    const boundaries = loops.map((loop) => normalizePolyline(loop, true)).filter((loop) => loop.length >= 3);
    if (boundaries.length === 0) return;
    const pairs: DxfPair[] = [
      [0, 'HATCH'], [5, this.handle()], [330, MODEL_SPACE_RECORD], [100, 'AcDbEntity'], [8, layer],
      [100, 'AcDbHatch'], [10, 0], [20, 0], [30, 0], [210, 0], [220, 0], [230, 1],
      [2, 'NBS_SECTION'], [70, 0], [71, 0], [91, boundaries.length],
    ];
    for (const loop of boundaries) {
      pairs.push([92, 2], [72, 0], [73, 1], [93, loop.length]);
      for (const point of loop) pairs.push([10, point[0]], [20, point[1]]);
      pairs.push([97, 0]);
    }
    pairs.push(
      [75, 0], [76, 1], [52, angleDeg], [41, 1], [77, 0], [78, 1],
      [53, angleDeg], [43, 0], [44, 0], [45, 0], [46, Math.max(0.1, spacing)], [79, 0], [47, 0], [98, 0],
    );
    this.entities.push(entity(pairs));
  }

  solid(
    layer: string,
    points: [Point2, Point2, Point2],
    target = this.entities,
    owner = MODEL_SPACE_RECORD,
  ): void {
    target.push(entity([
      [0, 'SOLID'], [5, this.handle()], [330, owner], [100, 'AcDbEntity'], [8, layer],
      [100, 'AcDbTrace'], ...pointPairs(10, points[0]), ...pointPairs(11, points[1]),
      ...pointPairs(12, points[2]), ...pointPairs(13, points[2]),
    ]));
  }

  mtext(
    layer: string,
    position: Point2,
    text: string,
    height = this.style.text_height_mm,
    attachment = 1,
    rotation = 0,
    target = this.entities,
    owner = MODEL_SPACE_RECORD,
  ): string {
    const handle = this.handle();
    target.push(this.mtextEntity(handle, layer, position, text, height, attachment, rotation, owner));
    return handle;
  }

  leader(
    vertices: Point2[],
    textPosition: Point2,
    text: string,
    annotationId: number,
    annotationKind: string,
  ): void {
    if (vertices.length < 2) return;
    const textHandle = this.mtext('NOTES', textPosition, text, this.style.text_height_mm, 1);
    const pairs: DxfPair[] = [
      [0, 'LEADER'], [5, this.handle()], [330, MODEL_SPACE_RECORD], [100, 'AcDbEntity'], [8, 'LEADERS'],
      [100, 'AcDbLeader'], [3, DIMSTYLE_NAME], [71, 1], [72, 0], [73, 0], [74, 1], [75, 0],
      [76, vertices.length],
    ];
    for (const vertex of vertices) pairs.push(...pointPairs(10, vertex));
    pairs.push([77, 256], [340, textHandle], [210, 0], [220, 0], [230, 1]);
    pairs.push(...metadataPairs(annotationKind, annotationId));
    this.entities.push(entity(pairs));
  }

  dimension(spec: DimensionEntity): void {
    const name = `*D${this.dimensionBlocks.length + 1}`;
    const block: DimensionBlock = {
      name,
      recordHandle: this.handle(),
      beginHandle: this.handle(),
      endHandle: this.handle(),
      entities: [],
    };
    spec.render(block.entities, block.recordHandle);
    this.dimensionBlocks.push(block);
    this.entities.push(entity([
      [0, 'DIMENSION'], [5, this.handle()], [330, MODEL_SPACE_RECORD], [100, 'AcDbEntity'], [8, 'DIMENSIONS'],
      [100, 'AcDbDimension'], [2, name], ...pointPairs(10, spec.definition),
      ...pointPairs(11, spec.textPosition), [70, spec.type | 32], [42, spec.measurement],
      [1, dxfText(spec.text)], [3, DIMSTYLE_NAME], ...spec.subtype,
      ...metadataPairs(spec.kind, spec.annotationId, spec.measurement, spec.viewScale),
    ]));
  }

  warning(position: Point2, annotationId: number): void {
    this.mtext('WARNINGS', position, `! BROKEN REFERENCE [${annotationId}]`, this.style.text_height_mm, 5);
  }

  finish(): string {
    const parts = [
      this.headerSection(),
      this.tablesSection(),
      this.blocksSection(),
      section('ENTITIES', this.entities.join('')),
      entity([[0, 'EOF']]),
    ];
    return parts.join('').replace(/\n/g, '\r\n');
  }

  private handle(): string {
    const handle = this.nextHandleValue.toString(16).toUpperCase();
    this.nextHandleValue += 1;
    return handle;
  }

  private mtextEntity(
    handle: string,
    layer: string,
    position: Point2,
    text: string,
    height: number,
    attachment: number,
    rotation: number,
    owner: string,
  ): string {
    return entity([
      [0, 'MTEXT'], [5, handle], [330, owner], [100, 'AcDbEntity'], [8, layer],
      [100, 'AcDbMText'], ...pointPairs(10, position), [40, height], [41, 0],
      [71, attachment], [72, 1], [1, dxfText(text)], [7, 'STANDARD'], [50, normalizeDegrees(rotation)],
      [210, 0], [220, 0], [230, 1],
    ]);
  }

  private headerSection(): string {
    return section('HEADER', entity([
      [9, '$ACADVER'], [1, 'AC1027'],
      [9, '$DWGCODEPAGE'], [3, 'UTF-8'],
      [9, '$INSBASE'], [10, 0], [20, 0], [30, 0],
      [9, '$EXTMIN'], [10, this.minX], [20, this.minY], [30, 0],
      [9, '$EXTMAX'], [10, this.minX + this.width], [20, this.minY + this.height], [30, 0],
      [9, '$LIMMIN'], [10, this.minX], [20, this.minY],
      [9, '$LIMMAX'], [10, this.minX + this.width], [20, this.minY + this.height],
      [9, '$INSUNITS'], [70, 4],
      [9, '$MEASUREMENT'], [70, this.metricStandard ? 1 : 0],
      [9, '$LUNITS'], [70, 2], [9, '$LUPREC'], [70, 4],
      [9, '$AUNITS'], [70, 0], [9, '$AUPREC'], [70, 2],
      [9, '$TEXTSIZE'], [40, this.style.text_height_mm], [9, '$DIMSTYLE'], [2, DIMSTYLE_NAME],
      [9, '$HANDSEED'], [5, this.nextHandleValue.toString(16).toUpperCase()],
    ]));
  }

  private tablesSection(): string {
    const weight = (role: DrawingLineRole) => drawingDxfLineweight(this.style, role);
    const layerRows = [
      layer('0', '6', 'CONTINUOUS', 7, 25),
      layer('BORDER', '7', drawingDxfLinetypeName('visible'), 7, weight('visible')),
      layer('VISIBLE', '8', drawingDxfLinetypeName('visible'), 7, weight('visible')),
      layer('HIDDEN', '9', drawingDxfLinetypeName('hidden'), 8, weight('hidden')),
      layer('DIMENSIONS', 'A', drawingDxfLinetypeName('dimension'), 2, weight('dimension')),
      layer('EXTENSION', 'B', drawingDxfLinetypeName('extension'), 2, weight('extension')),
      layer('LEADERS', 'C', drawingDxfLinetypeName('leader'), 3, weight('leader')),
      layer('NOTES', 'D', 'CONTINUOUS', 3, weight('leader')),
      layer('VIEW_LABELS', 'E', 'CONTINUOUS', 8, weight('leader')),
      layer('WARNINGS', '10', drawingDxfLinetypeName('break_line'), 1, weight('break_line')),
      layer('CENTER', '11', drawingDxfLinetypeName('center'), 4, weight('center')),
      layer('CUTTING_PLANE', '12', drawingDxfLinetypeName('cutting_plane'), 6, weight('cutting_plane')),
      layer('PHANTOM', '13', drawingDxfLinetypeName('phantom'), 6, weight('phantom')),
      layer('BREAK', '14', drawingDxfLinetypeName('break_line'), 7, weight('break_line')),
      layer('HATCH', '15', 'CONTINUOUS', 8, weight('hatch')),
      layer('PROFILE_OUTER', '16', 'CONTINUOUS', 7, weight('visible')),
      layer('PROFILE_HOLES', '17', 'CONTINUOUS', 4, weight('visible')),
    ].join('');
    const blockRows = [
      blockRecord('*Model_Space', MODEL_SPACE_RECORD),
      blockRecord('*Paper_Space', '28'),
      ...this.dimensionBlocks.map((block) => blockRecord(block.name, block.recordHandle)),
    ].join('');
    const tables = [
      table('LTYPE', '2', 6, [
        entity([[0, 'LTYPE'], [5, '3'], [330, '2'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbLinetypeTableRecord'], [2, 'CONTINUOUS'], [70, 0], [3, 'Solid line'], [72, 65], [73, 0], [40, 0]]),
        lineType('NBS_HIDDEN', '4', drawingDxfPattern(this.style, 'hidden')),
        lineType('NBS_CENTER', 'F', drawingDxfPattern(this.style, 'center')),
        lineType('NBS_CUTTING', '30', drawingDxfPattern(this.style, 'cutting_plane')),
        lineType('NBS_PHANTOM', '31', drawingDxfPattern(this.style, 'phantom')),
        lineType('NBS_BREAK', '32', drawingDxfPattern(this.style, 'break_line')),
      ].join('')),
      table('LAYER', LAYER_TABLE, 17, layerRows),
      table('STYLE', '20', 1, entity([[0, 'STYLE'], [5, '21'], [330, '20'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbTextStyleTableRecord'], [2, 'STANDARD'], [70, 0], [40, 0], [41, 1], [50, 0], [71, 0], [42, this.style.text_height_mm], [3, this.style.font_family.split(',')[0].trim() || 'Arial'], [4, '']])),
      table('APPID', '22', 1, entity([[0, 'APPID'], [5, '23'], [330, '22'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbRegAppTableRecord'], [2, 'NBS_CAD'], [70, 0]])),
      table('DIMSTYLE', '24', 1, dimStyle(this.style)),
      table('BLOCK_RECORD', BLOCK_RECORD_TABLE, 2 + this.dimensionBlocks.length, blockRows),
    ].join('');
    return section('TABLES', tables);
  }

  private blocksSection(): string {
    const blocks = [
      blockDefinition('*Model_Space', MODEL_SPACE_RECORD, '29', '2A', ''),
      blockDefinition('*Paper_Space', '28', '2B', '2C', ''),
      ...this.dimensionBlocks.map((block) => blockDefinition(
        block.name,
        block.recordHandle,
        block.beginHandle,
        block.endHandle,
        block.entities.join(''),
      )),
    ].join('');
    return section('BLOCKS', blocks);
  }
}

function addManufacturingLoop(
  writer: DrawingDxfWriter,
  loop: ProfileLoopDto,
  layerName: 'PROFILE_OUTER' | 'PROFILE_HOLES',
): void {
  if (loop.curves.length === 0) {
    writer.polyline(layerName, loop.points.map(profilePoint), true);
    return;
  }
  loop.curves.forEach((curve) => addManufacturingCurve(writer, curve, layerName));
}

function addManufacturingCurve(
  writer: DrawingDxfWriter,
  curve: ProfileCurveDto,
  layerName: 'PROFILE_OUTER' | 'PROFILE_HOLES',
): void {
  if (curve.kind === 'line') {
    writer.line(layerName, profilePoint(curve.start), profilePoint(curve.end));
    return;
  }
  if (curve.kind === 'circle') {
    writer.circle(layerName, profilePoint(curve.center), curve.radius);
    return;
  }
  if (curve.kind === 'polyline') {
    writer.polyline(layerName, curve.points.map(profilePoint), false);
    return;
  }
  const arc = arcThroughThreePoints(
    profilePoint(curve.start),
    profilePoint(curve.mid),
    profilePoint(curve.end),
  );
  if (arc) {
    writer.arc(layerName, arc.center, arc.radius, arc.startAngle, arc.endAngle);
  } else {
    writer.polyline(layerName, [profilePoint(curve.start), profilePoint(curve.mid), profilePoint(curve.end)]);
  }
}

function profileBounds(loops: ProfileLoopDto[]): [number, number, number, number] {
  const points = loops.flatMap((loop) => loop.points.map(profilePoint));
  if (points.length === 0) return [0, 0, 1, 1];
  return points.reduce<[number, number, number, number]>(
    (bounds, point) => [
      Math.min(bounds[0], point[0]),
      Math.min(bounds[1], point[1]),
      Math.max(bounds[2], point[0]),
      Math.max(bounds[3], point[1]),
    ],
    [points[0][0], points[0][1], points[0][0], points[0][1]],
  );
}

function profilePoint(point: { x: number; y: number }): Point2 {
  return [point.x, point.y];
}

function arcThroughThreePoints(
  start: Point2,
  middle: Point2,
  end: Point2,
): { center: Point2; radius: number; startAngle: number; endAngle: number } | null {
  const determinant = 2 * (
    start[0] * (middle[1] - end[1])
    + middle[0] * (end[1] - start[1])
    + end[0] * (start[1] - middle[1])
  );
  if (Math.abs(determinant) < 1e-10) return null;
  const startNorm = start[0] ** 2 + start[1] ** 2;
  const middleNorm = middle[0] ** 2 + middle[1] ** 2;
  const endNorm = end[0] ** 2 + end[1] ** 2;
  const center: Point2 = [
    (startNorm * (middle[1] - end[1]) + middleNorm * (end[1] - start[1]) + endNorm * (start[1] - middle[1])) / determinant,
    (startNorm * (end[0] - middle[0]) + middleNorm * (start[0] - end[0]) + endNorm * (middle[0] - start[0])) / determinant,
  ];
  const radius = distance(center, start);
  const startAngle = angleDegrees(center, start);
  const middleAngle = angleDegrees(center, middle);
  const endAngle = angleDegrees(center, end);
  const middleOnCounterClockwiseArc = normalizeDegrees(middleAngle - startAngle)
    <= normalizeDegrees(endAngle - startAngle) + 1e-7;
  return middleOnCounterClockwiseArc
    ? { center, radius, startAngle, endAngle }
    : { center, radius, startAngle: endAngle, endAngle: startAngle };
}

function addProjectedView(
  writer: DrawingDxfWriter,
  view: DrawingViewDto,
  projection: DrawingProjectionDto | undefined,
  sheet: DrawingSheetDto,
  sheetHeight: number,
): void {
  if (!projection) return;
  const circles = projection.circles.filter((circle) => circle.closed);
  const exactCircles = circles.filter((circle) => {
    const target = circle.hidden ? projection.hidden : projection.visible;
    const opposite = circle.hidden ? projection.visible : projection.hidden;
    const targetMatches = target.some((polyline) => projectedPolylineMatchesCircle(polyline.points, circle));
    const oppositeMatches = opposite.some((polyline) => projectedPolylineMatchesCircle(polyline.points, circle));
    if (projectedCoverageIsFullCircle(target, circle) && !oppositeMatches) return true;

    // OCCT can omit both coincident end rims from HLR because each boundary is
    // coplanar with its cap. Circle recovery resolves that ambiguity by marking
    // only the front-most member of the coincident stack visible. Preserve that
    // exact analytic rim in DXF. A partially occluded circle still has matching
    // HLR spans, so it remains clipped polyline/arc geometry instead.
    return !circle.hidden
      && !targetMatches
      && !oppositeMatches
      && circles.some((other) => other.hidden && sameProjectedCircle(other, circle));
  });
  const addPolylines = (layer: string, polylines: DrawingProjectionDto['visible'], hidden: boolean) => {
    for (const polyline of polylines) {
      if (exactCircles.some((circle) => circle.hidden === hidden && projectedPolylineMatchesCircle(polyline.points, circle))) continue;
      const paper = polyline.points.map((point) => drawingProjectedPointToPaper(view, projection, point));
      const closed = paper.length > 2 && distance(paper[0], paper[paper.length - 1]) < 1e-5;
      writer.polyline(layer, paper.map((point) => paperToDxf(point, sheetHeight)), closed);
    }
  };
  const removedSection = view.derivation?.type === 'removed_section';
  if (!removedSection) {
    addPolylines('VISIBLE', projection.visible, false);
    addPolylines('HIDDEN', projection.hidden, true);
    for (const circle of exactCircles) {
      const layer = circle.hidden ? 'HIDDEN' : 'VISIBLE';
      writer.circle(
        layer,
        paperToDxf(drawingProjectedPointToPaper(view, projection, circle.center), sheetHeight),
        circle.radius * view.scale,
      );
    }
  }
  const sectionDerivation = view.derivation?.type === 'section' || view.derivation?.type === 'removed_section'
    ? view.derivation
    : null;
  if (sectionDerivation) {
    for (const polyline of projection.section) {
      const paper = polyline.points.map((point) => drawingProjectedPointToPaper(view, projection, point));
      writer.polyline('VISIBLE', paper.map((point) => paperToDxf(point, sheetHeight)), false);
    }
    const loops = sectionLoopsPaper(view, projection).map((loop) => loop.map((point) => paperToDxf(point, sheetHeight)));
    const angle = sectionDerivation.hatch_angle_deg;
    const spacing = sectionDerivation.hatch_spacing_mm || sheet.style.hatch_spacing_mm;
    writer.hatch('HATCH', loops, -angle, spacing);
  }
  const labelY = view.position[1]
    + Math.max(8, (projection.bounds[3] - projection.bounds[1]) * view.scale / 2 + 5);
  writer.mtext(
    'VIEW_LABELS',
    paperToDxf([view.position[0], labelY], sheetHeight),
    `${view.name} · ${scaleLabel(view.scale)}`,
    sheet.style.small_text_height_mm,
    2,
  );
}

function addDerivedSource(
  writer: DrawingDxfWriter,
  child: DrawingViewDto,
  parent: DrawingViewDto,
  projection: DrawingProjectionDto,
  sheet: DrawingSheetDto,
  sheetHeight: number,
): void {
  const derivation = child.derivation;
  if (!derivation) return;
  const toDxf = (point: Point2) => paperToDxf(point, sheetHeight);
  if (derivation.type === 'section' || derivation.type === 'removed_section') {
    const first = resolveDrawingAnchor(derivation.first, parent, projection);
    const second = resolveDrawingAnchor(derivation.second, parent, projection);
    if (!first || !second) return;
    const direction = normalize([second.paper[0] - first.paper[0], second.paper[1] - first.paper[1]]);
    const normal: Point2 = [-direction[1], direction[0]];
    const firstArrow: Point2 = [first.paper[0] + normal[0] * 5, first.paper[1] + normal[1] * 5];
    const secondArrow: Point2 = [second.paper[0] + normal[0] * 5, second.paper[1] + normal[1] * 5];
    const firstDxf = toDxf(first.paper);
    const secondDxf = toDxf(second.paper);
    writer.line('CUTTING_PLANE', firstDxf, secondDxf);
    writer.solid('CUTTING_PLANE', arrowTriangle(firstDxf, toDxf(firstArrow), sheet.style.arrow_size_mm));
    writer.solid('CUTTING_PLANE', arrowTriangle(secondDxf, toDxf(secondArrow), sheet.style.arrow_size_mm));
    const labelParts = derivation.label.trim().split(/\s+/);
    const label = labelParts[labelParts.length - 1] || derivation.label;
    writer.mtext('VIEW_LABELS', toDxf([first.paper[0] - direction[0] * 4, first.paper[1] - direction[1] * 4]), label, sheet.style.text_height_mm, 5);
    writer.mtext('VIEW_LABELS', toDxf([second.paper[0] + direction[0] * 4, second.paper[1] + direction[1] * 4]), label, sheet.style.text_height_mm, 5);
    return;
  }
  if (derivation.type === 'detail') {
    const center = resolveDrawingAnchor(derivation.center, parent, projection)?.paper;
    if (!center) return;
    writer.circle('PHANTOM', toDxf(center), derivation.radius * parent.scale);
    writer.mtext('VIEW_LABELS', toDxf([center[0] + derivation.radius * parent.scale + 3, center[1] - derivation.radius * parent.scale]), derivation.label, sheet.style.text_height_mm, 1);
    return;
  }
  if (derivation.type === 'auxiliary') {
    const line = resolveDrawingLine(derivation.reference, parent, projection);
    if (!line) return;
    const center: Point2 = [(line.start[0] + line.end[0]) / 2, (line.start[1] + line.end[1]) / 2];
    const direction = normalize([line.end[0] - line.start[0], line.end[1] - line.start[1]]);
    const normal: Point2 = [-direction[1], direction[0]];
    const sign = derivation.flipped ? -1 : 1;
    const end: Point2 = [center[0] + normal[0] * sign * 8, center[1] + normal[1] * sign * 8];
    writer.line('PHANTOM', toDxf(line.start), toDxf(line.end));
    writer.line('PHANTOM', toDxf(center), toDxf(end));
    writer.solid('PHANTOM', arrowTriangle(toDxf(end), toDxf(center), sheet.style.arrow_size_mm));
    writer.mtext('VIEW_LABELS', toDxf(end), derivation.label, sheet.style.text_height_mm, 5);
    return;
  }
  if (derivation.type === 'broken') {
    const width = (projection.bounds[2] - projection.bounds[0]) * parent.scale;
    const height = (projection.bounds[3] - projection.bounds[1]) * parent.scale;
    const x = parent.position[0] - width / 2;
    const y = parent.position[1] - height / 2;
    const center = derivation.axis === 'horizontal' ? x + width / 2 : y + height / 2;
    const points = derivation.axis === 'horizontal'
      ? breakZigzagPoints(center, y, y + height, 'vertical')
      : breakZigzagPoints(center, x, x + width, 'horizontal');
    writer.polyline('BREAK', points.map(toDxf));
  }
}

function sectionLoopsPaper(view: DrawingViewDto, projection: DrawingProjectionDto): Point2[][] {
  const edges = projection.section.flatMap((polyline) => polyline.points.slice(1).map((point, index) => [
    drawingProjectedPointToPaper(view, projection, polyline.points[index]),
    drawingProjectedPointToPaper(view, projection, point),
  ] as [Point2, Point2])).filter(([first, second]) => distance(first, second) > 1e-5);
  const key = (point: Point2) => `${Math.round(point[0] * 1_000)},${Math.round(point[1] * 1_000)}`;
  const adjacency = new Map<string, number[]>();
  edges.forEach((edge, index) => edge.forEach((point) => adjacency.set(key(point), [...(adjacency.get(key(point)) ?? []), index])));
  const used = new Set<number>();
  const loops: Point2[][] = [];
  for (let seed = 0; seed < edges.length; seed += 1) {
    if (used.has(seed)) continue;
    used.add(seed);
    const chain: Point2[] = [edges[seed][0], edges[seed][1]];
    for (let guard = 0; guard < edges.length; guard += 1) {
      const end = chain[chain.length - 1];
      if (chain.length > 2 && key(end) === key(chain[0])) break;
      const nextIndex = (adjacency.get(key(end)) ?? []).find((candidate) => !used.has(candidate));
      if (nextIndex === undefined) break;
      used.add(nextIndex);
      const next = edges[nextIndex];
      chain.push(key(next[0]) === key(end) ? next[1] : next[0]);
    }
    if (chain.length >= 4 && key(chain[0]) === key(chain[chain.length - 1])) loops.push(chain.slice(0, -1));
  }
  return loops;
}

function breakZigzagPoints(position: number, start: number, end: number, orientation: 'horizontal' | 'vertical'): Point2[] {
  const middle = (start + end) / 2;
  return orientation === 'vertical'
    ? [[position, start], [position, middle - 4], [position - 2, middle - 2], [position + 2, middle], [position - 2, middle + 2], [position, middle + 4], [position, end]]
    : [[start, position], [middle - 4, position], [middle - 2, position - 2], [middle, position + 2], [middle + 2, position - 2], [middle + 4, position], [end, position]];
}

function addAnnotation(
  writer: DrawingDxfWriter,
  annotation: DrawingAnnotationDto,
  sheet: DrawingSheetDto,
  projections: Map<number, DrawingProjectionDto | undefined>,
  units: UnitSystem,
  sheetHeight: number,
): void {
  if (annotation.kind === 'note') {
    writer.mtext('NOTES', paperToDxf(annotation.position, sheetHeight), annotation.text, sheet.style.text_height_mm, 1);
    return;
  }
  if (annotation.kind === 'revision_cloud') {
    writer.polyline('WARNINGS', annotation.points.map((point) => paperToDxf(point, sheetHeight)), true);
    writer.mtext('WARNINGS', paperToDxf(annotation.points[0] ?? [0, 0], sheetHeight), `REV ${annotation.revision}`, sheet.style.text_height_mm, 1);
    return;
  }
  const view = sheet.views.find((candidate) => candidate.id === annotation.view_id);
  const projection = projections.get(annotation.view_id);
  if (!view || !projection) return;
  const toDxf = (point: Point2) => paperToDxf(point, sheetHeight);

  if (annotation.kind === 'linear_dimension') {
    const first = resolveDrawingAnchor(annotation.first, view, projection);
    const second = resolveDrawingAnchor(annotation.second, view, projection);
    const geometry = first && second
      ? linearDimensionGeometry(first, second, annotation.mode, annotation.offset, view.scale)
      : null;
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    const firstPoint = toDxf(geometry.first);
    const secondPoint = toDxf(geometry.second);
    const dimensionStart = toDxf(geometry.dimensionStart);
    const dimensionEnd = toDxf(geometry.dimensionEnd);
    const textPosition = toDxf(geometry.textPosition);
    const text = drawingDimensionText(geometry.value, annotation.precision, annotation.prefix, annotation.suffix, units, annotation.presentation, sheet.standard);
    const rotated = annotation.mode !== 'aligned';
    const rotation = annotation.mode === 'vertical' ? 90 : 0;
    writer.dimension({
      annotationId: annotation.id,
      kind: 'linear_dimension',
      type: rotated ? 0 : 1,
      definition: dimensionStart,
      textPosition,
      text,
      measurement: geometry.value,
      viewScale: view.scale,
      subtype: [
        [100, 'AcDbAlignedDimension'], ...pointPairs(13, firstPoint), ...pointPairs(14, secondPoint),
        ...(rotated ? [[50, rotation], [100, 'AcDbRotatedDimension']] as DxfPair[] : []),
      ],
      render: (target, owner) => {
        writer.line('EXTENSION', toDxf(geometry.firstExtension[0]), toDxf(geometry.firstExtension[1]), target, owner);
        writer.line('EXTENSION', toDxf(geometry.secondExtension[0]), toDxf(geometry.secondExtension[1]), target, owner);
        writer.line('DIMENSIONS', dimensionStart, dimensionEnd, target, owner);
        writer.solid('DIMENSIONS', arrowTriangle(dimensionStart, dimensionEnd, geometry.arrowSize), target, owner);
        writer.solid('DIMENSIONS', arrowTriangle(dimensionEnd, dimensionStart, geometry.arrowSize), target, owner);
        writer.mtext('DIMENSIONS', textPosition, text, sheet.style.text_height_mm, 5, -geometry.textAngle, target, owner);
      },
    });
    return;
  }

  if (annotation.kind === 'line_dimension') {
    const first = resolveDrawingLine(annotation.first, view, projection);
    const second = annotation.second ? resolveDrawingLine(annotation.second, view, projection) : null;
    const result = first && (!annotation.second || second)
      ? lineDimensionGeometry(first, second, annotation.mode, annotation.position, view.scale)
      : null;
    if (!result) return writer.warning(toDxf(view.position), annotation.id);
    if (result.kind === 'angular') {
      const geometry = result.geometry;
      const center = toDxf(geometry.vertex);
      const firstPoint = toDxf(geometry.firstRay);
      const secondPoint = toDxf(geometry.secondRay);
      const arcStart = toDxf(geometry.arcStart);
      const arcEnd = toDxf(geometry.arcEnd);
      const textPosition = toDxf(geometry.textPosition);
      const [startAngle, endAngle] = minorArcAngles(center, arcStart, arcEnd);
      const radius = distance(center, arcStart);
      const text = drawingAngularDimensionText(geometry.value, annotation.precision, annotation.prefix, annotation.suffix, annotation.presentation, sheet.standard);
      writer.dimension({
        annotationId: annotation.id,
        kind: 'line_angle_dimension',
        type: 5,
        definition: arcStart,
        textPosition,
        text,
        measurement: geometry.value * Math.PI / 180,
        viewScale: view.scale,
        subtype: [
          [100, 'AcDb3PointAngularDimension'], ...pointPairs(13, firstPoint),
          ...pointPairs(14, secondPoint), ...pointPairs(15, center), ...pointPairs(16, arcStart),
        ],
        render: (target, owner) => {
          writer.line('DIMENSIONS', center, firstPoint, target, owner);
          writer.line('DIMENSIONS', center, secondPoint, target, owner);
          writer.arc('DIMENSIONS', center, radius, startAngle, endAngle, target, owner);
          writer.mtext('DIMENSIONS', textPosition, text, sheet.style.text_height_mm, 5, 0, target, owner);
        },
      });
      return;
    }
    const geometry = result.geometry;
    const firstPoint = toDxf(geometry.first);
    const secondPoint = toDxf(geometry.second);
    const dimensionStart = toDxf(geometry.dimensionStart);
    const dimensionEnd = toDxf(geometry.dimensionEnd);
    const textPosition = toDxf(geometry.textPosition);
    const text = drawingDimensionText(geometry.value, annotation.precision, annotation.prefix, annotation.suffix, units, annotation.presentation, sheet.standard);
    writer.dimension({
      annotationId: annotation.id,
      kind: `line_${annotation.mode}_dimension`,
      type: 1,
      definition: dimensionStart,
      textPosition,
      text,
      measurement: geometry.value,
      viewScale: view.scale,
      subtype: [[100, 'AcDbAlignedDimension'], ...pointPairs(13, firstPoint), ...pointPairs(14, secondPoint)],
      render: (target, owner) => {
        writer.line('EXTENSION', toDxf(geometry.firstExtension[0]), toDxf(geometry.firstExtension[1]), target, owner);
        writer.line('EXTENSION', toDxf(geometry.secondExtension[0]), toDxf(geometry.secondExtension[1]), target, owner);
        writer.line('DIMENSIONS', dimensionStart, dimensionEnd, target, owner);
        writer.solid('DIMENSIONS', arrowTriangle(dimensionStart, dimensionEnd, geometry.arrowSize), target, owner);
        writer.solid('DIMENSIONS', arrowTriangle(dimensionEnd, dimensionStart, geometry.arrowSize), target, owner);
        writer.mtext('DIMENSIONS', textPosition, text, sheet.style.text_height_mm, 5, -geometry.textAngle, target, owner);
      },
    });
    return;
  }

  if (annotation.kind === 'point_line_dimension') {
    const point = resolveDrawingAnchor(annotation.point, view, projection);
    const line = resolveDrawingLine(annotation.line, view, projection);
    const geometry = point && line
      ? pointLineDimensionGeometry(point, line, annotation.position, view.scale)
      : null;
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    const firstPoint = toDxf(geometry.first);
    const secondPoint = toDxf(geometry.second);
    const dimensionStart = toDxf(geometry.dimensionStart);
    const dimensionEnd = toDxf(geometry.dimensionEnd);
    const textPosition = toDxf(geometry.textPosition);
    const text = drawingDimensionText(geometry.value, annotation.precision, annotation.prefix, annotation.suffix, units, annotation.presentation, sheet.standard);
    writer.dimension({
      annotationId: annotation.id,
      kind: 'point_line_dimension',
      type: 1,
      definition: dimensionStart,
      textPosition,
      text,
      measurement: geometry.value,
      viewScale: view.scale,
      subtype: [[100, 'AcDbAlignedDimension'], ...pointPairs(13, firstPoint), ...pointPairs(14, secondPoint)],
      render: (target, owner) => {
        writer.line('EXTENSION', toDxf(geometry.firstExtension[0]), toDxf(geometry.firstExtension[1]), target, owner);
        writer.line('EXTENSION', toDxf(geometry.secondExtension[0]), toDxf(geometry.secondExtension[1]), target, owner);
        writer.line('DIMENSIONS', dimensionStart, dimensionEnd, target, owner);
        writer.solid('DIMENSIONS', arrowTriangle(dimensionStart, dimensionEnd, geometry.arrowSize), target, owner);
        writer.solid('DIMENSIONS', arrowTriangle(dimensionEnd, dimensionStart, geometry.arrowSize), target, owner);
        writer.mtext('DIMENSIONS', textPosition, text, sheet.style.text_height_mm, 5, -geometry.textAngle, target, owner);
      },
    });
    return;
  }

  if (annotation.kind === 'radial_dimension') {
    const resolved = resolveDrawingCircle(annotation.feature, view, projection);
    if (!resolved) return writer.warning(toDxf(view.position), annotation.id);
    const geometry = radialDimensionGeometry(resolved, annotation.mode, annotation.leader_angle_deg, annotation.offset);
    const center = toDxf(geometry.center);
    const featurePoint = toDxf(geometry.featurePoint);
    const shoulder = toDxf(geometry.shoulder);
    const textPosition = toDxf(geometry.textPosition);
    const symbol = annotation.mode === 'diameter' ? '%%c' : 'R';
    const text = drawingDimensionText(geometry.value, annotation.precision, `${annotation.prefix}${symbol}`, annotation.suffix, units, annotation.presentation, sheet.standard);
    const opposite: Point2 = [2 * center[0] - featurePoint[0], 2 * center[1] - featurePoint[1]];
    writer.dimension({
      annotationId: annotation.id,
      kind: `${annotation.mode}_dimension`,
      type: annotation.mode === 'diameter' ? 3 : 4,
      definition: annotation.mode === 'diameter' ? opposite : center,
      textPosition,
      text,
      measurement: geometry.value,
      viewScale: view.scale,
      subtype: [
        [100, annotation.mode === 'diameter' ? 'AcDbDiametricDimension' : 'AcDbRadialDimension'],
        ...pointPairs(15, featurePoint), [40, annotation.offset],
      ],
      render: (target, owner) => {
        writer.line('DIMENSIONS', center, featurePoint, target, owner);
        writer.line('DIMENSIONS', featurePoint, shoulder, target, owner);
        writer.solid('DIMENSIONS', arrowTriangle(featurePoint, center, 1.8), target, owner);
        writer.mtext('DIMENSIONS', textPosition, text, sheet.style.text_height_mm, geometry.textPosition[0] >= geometry.center[0] ? 4 : 6, 0, target, owner);
      },
    });
    return;
  }

  if (annotation.kind === 'angular_dimension') {
    const vertex = resolveDrawingAnchor(annotation.vertex, view, projection);
    const first = resolveDrawingAnchor(annotation.first, view, projection);
    const second = resolveDrawingAnchor(annotation.second, view, projection);
    const geometry = vertex && first && second
      ? angularDimensionGeometry(vertex, first, second, annotation.radius)
      : null;
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    const center = toDxf(geometry.vertex);
    const firstPoint = toDxf(first!.paper);
    const secondPoint = toDxf(second!.paper);
    const arcStart = toDxf(geometry.arcStart);
    const arcEnd = toDxf(geometry.arcEnd);
    const textPosition = toDxf(geometry.textPosition);
    const [startAngle, endAngle] = minorArcAngles(center, arcStart, arcEnd);
    const text = drawingAngularDimensionText(geometry.value, annotation.precision, annotation.prefix, annotation.suffix, annotation.presentation, sheet.standard);
    writer.dimension({
      annotationId: annotation.id,
      kind: 'angular_dimension',
      type: 5,
      definition: arcStart,
      textPosition,
      text,
      measurement: geometry.value * Math.PI / 180,
      viewScale: view.scale,
      subtype: [
        [100, 'AcDb3PointAngularDimension'], ...pointPairs(13, firstPoint),
        ...pointPairs(14, secondPoint), ...pointPairs(15, center), ...pointPairs(16, arcStart),
      ],
      render: (target, owner) => {
        writer.line('DIMENSIONS', center, toDxf(geometry.firstRay), target, owner);
        writer.line('DIMENSIONS', center, toDxf(geometry.secondRay), target, owner);
        writer.arc('DIMENSIONS', center, annotation.radius, startAngle, endAngle, target, owner);
        writer.mtext('DIMENSIONS', textPosition, text, sheet.style.text_height_mm, 5, 0, target, owner);
      },
    });
    return;
  }

  if (annotation.kind === 'hole_note') {
    const resolved = resolveDrawingCircle(annotation.feature, view, projection);
    if (!resolved) return writer.warning(toDxf(view.position), annotation.id);
    const direction = normalize([
      annotation.position[0] - resolved.center[0],
      annotation.position[1] - resolved.center[1],
    ]);
    const featurePoint: Point2 = [
      resolved.center[0] + direction[0] * resolved.paperRadius,
      resolved.center[1] + direction[1] * resolved.paperRadius,
    ];
    const text = drawingHoleCalloutText(annotation, sheet.standard, units).replace(/⌀/g, '%%c').replace(/\n/g, '\\P');
    writer.leader([toDxf(featurePoint), toDxf(annotation.position)], toDxf([annotation.position[0] + 1.2, annotation.position[1] - 0.8]), text, annotation.id, 'hole_note');
    return;
  }

  if (annotation.kind === 'center_mark') {
    const resolved = resolveDrawingCircle(annotation.feature, view, projection);
    if (!resolved) return writer.warning(toDxf(view.position), annotation.id);
    const geometry = centerMarkGeometry(resolved, annotation.extension);
    writer.line('CENTER', toDxf(geometry.horizontal[0]), toDxf(geometry.horizontal[1]));
    writer.line('CENTER', toDxf(geometry.vertical[0]), toDxf(geometry.vertical[1]));
    return;
  }

  if (annotation.kind === 'center_line') {
    const first = resolveDrawingCircle(annotation.first, view, projection);
    const second = resolveDrawingCircle(annotation.second, view, projection);
    const geometry = first && second
      ? centerLineGeometry(first, second, annotation.extension)
      : null;
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    writer.line('CENTER', toDxf(geometry.start), toDxf(geometry.end));
    return;
  }

  if (annotation.kind === 'center_line_between_edges') {
    const first = resolveDrawingLine(annotation.first, view, projection);
    const second = resolveDrawingLine(annotation.second, view, projection);
    const geometry = first && second
      ? centerLineBetweenEdgesGeometry(first, second, annotation.extension)
      : null;
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    writer.line('CENTER', toDxf(geometry.start), toDxf(geometry.end));
    return;
  }

  if (annotation.kind === 'automatic_symmetry_axis') {
    for (const [start, end] of automaticSymmetryAxisGeometry(view, projection, annotation.axis, annotation.extension)) {
      writer.line('CENTER', toDxf(start), toDxf(end));
    }
    return;
  }

  if (annotation.kind === 'bolt_circle_center_line') {
    const circles = annotation.features.map((feature) => resolveDrawingCircle(feature, view, projection));
    if (circles.some((circle) => !circle)) return writer.warning(toDxf(view.position), annotation.id);
    const geometry = boltCircleGeometry(circles.filter((circle): circle is NonNullable<typeof circle> => Boolean(circle)), annotation.extension);
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    writer.circle('CENTER', toDxf(geometry.center), geometry.radius);
    for (const mark of geometry.marks) {
      writer.line('CENTER', toDxf(mark.horizontal[0]), toDxf(mark.horizontal[1]));
      writer.line('CENTER', toDxf(mark.vertical[0]), toDxf(mark.vertical[1]));
    }
    return;
  }

  if (annotation.kind === 'chain_dimension') {
    const anchors = annotation.anchors.map((anchor) => resolveDrawingAnchor(anchor, view, projection));
    if (anchors.some((anchor) => !anchor)) return writer.warning(toDxf(view.position), annotation.id);
    const resolved = anchors.filter((anchor): anchor is NonNullable<typeof anchor> => Boolean(anchor));
    const pairs = annotation.layout === 'baseline'
      ? resolved.slice(1).map((target, index) => [resolved[0], target, annotation.offset + index * annotation.spacing] as const)
      : resolved.slice(1).map((target, index) => [resolved[index], target, annotation.offset + (annotation.layout === 'continued' ? index * annotation.spacing : 0)] as const);
    for (const [first, second, offset] of pairs) {
      const geometry = linearDimensionGeometry(first, second, annotation.mode, offset, view.scale);
      if (!geometry) continue;
      writer.line('EXTENSION', toDxf(geometry.firstExtension[0]), toDxf(geometry.firstExtension[1]));
      writer.line('EXTENSION', toDxf(geometry.secondExtension[0]), toDxf(geometry.secondExtension[1]));
      writer.line('DIMENSIONS', toDxf(geometry.dimensionStart), toDxf(geometry.dimensionEnd));
      writer.mtext('DIMENSIONS', toDxf(geometry.textPosition), drawingDimensionText(
        geometry.value, annotation.precision, annotation.prefix, annotation.suffix,
        units, annotation.presentation, sheet.standard,
      ), sheet.style.text_height_mm, 5, -geometry.textAngle);
    }
    return;
  }

  if (annotation.kind === 'ordinate_dimension') {
    const origin = resolveDrawingAnchor(annotation.origin, view, projection);
    const target = resolveDrawingAnchor(annotation.target, view, projection);
    const geometry = origin && target ? ordinateDimensionGeometry(origin, target, annotation.offset, view.scale) : null;
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    writer.line('DIMENSIONS', toDxf(geometry.target), toDxf(geometry.elbow));
    writer.circle('DIMENSIONS', toDxf(geometry.origin), 1.1);
    const text = annotation.axis === 'x'
      ? `X ${drawingDimensionText(geometry.xValue, annotation.precision, '', '', units, annotation.presentation, sheet.standard)}`
      : annotation.axis === 'y'
        ? `Y ${drawingDimensionText(geometry.yValue, annotation.precision, '', '', units, annotation.presentation, sheet.standard)}`
        : `X ${drawingDimensionText(geometry.xValue, annotation.precision, '', '', units, annotation.presentation, sheet.standard)}  Y ${drawingDimensionText(geometry.yValue, annotation.precision, '', '', units, annotation.presentation, sheet.standard)}`;
    writer.mtext('DIMENSIONS', toDxf(geometry.textPosition), text, sheet.style.text_height_mm, 5);
    return;
  }

  if (annotation.kind === 'arc_length_dimension') {
    const circle = resolveDrawingCircle(annotation.feature, view, projection);
    const first = resolveDrawingAnchor(annotation.first, view, projection);
    const second = resolveDrawingAnchor(annotation.second, view, projection);
    const geometry = circle && first && second ? arcLengthDimensionGeometry(circle, first, second, annotation.offset) : null;
    if (!geometry) return writer.warning(toDxf(view.position), annotation.id);
    const center = toDxf(geometry.center);
    const [startAngle, endAngle] = minorArcAngles(center, toDxf(geometry.start), toDxf(geometry.end));
    writer.arc('DIMENSIONS', center, geometry.radius, startAngle, endAngle);
    writer.mtext('DIMENSIONS', toDxf(geometry.textPosition), `ARC ${drawingDimensionText(
      geometry.value, annotation.precision, '', '', units, annotation.presentation, sheet.standard,
    )}`, sheet.style.text_height_mm, 5);
    return;
  }

  if (annotation.kind === 'jogged_radius_dimension') {
    const circle = resolveDrawingCircle(annotation.feature, view, projection);
    if (!circle) return writer.warning(toDxf(view.position), annotation.id);
    const direction = normalize([annotation.jog[0] - circle.center[0], annotation.jog[1] - circle.center[1]]);
    const featurePoint: Point2 = [circle.center[0] + direction[0] * circle.paperRadius, circle.center[1] + direction[1] * circle.paperRadius];
    const jogPath: Point2[] = [featurePoint, annotation.jog, [annotation.jog[0] + 2, annotation.jog[1] - 1], [annotation.jog[0] + 4, annotation.jog[1] + 1], annotation.position];
    writer.polyline('DIMENSIONS', jogPath.map(toDxf), false);
    writer.mtext('DIMENSIONS', toDxf(annotation.position), drawingDimensionText(
      circle.circle.radius, annotation.precision, 'R', '', units, annotation.presentation, sheet.standard,
    ), sheet.style.text_height_mm, 1);
    return;
  }

  if (annotation.kind === 'datum_feature'
    || annotation.kind === 'gdt_frame'
    || annotation.kind === 'surface_texture'
    || annotation.kind === 'item_balloon') {
    const attachment = resolveDrawingAttachment(annotation.attachment, view, projection);
    if (!attachment) return writer.warning(toDxf(view.position), annotation.id);
    const text = annotation.kind === 'datum_feature'
      ? (annotation.target_index ? `${annotation.label}${annotation.target_index}` : annotation.label)
      : annotation.kind === 'gdt_frame'
        ? dxfGdtText(annotation)
        : annotation.kind === 'surface_texture'
          ? `SURFACE Ra ${trimNumber(annotation.roughness_ra)}${annotation.process ? ` ${annotation.process}` : ''}`
          : sheet.bom.find((item) => item.id === annotation.bom_item_id)?.item_number ?? '?';
    writer.leader([toDxf(attachment.point), toDxf(annotation.position)], toDxf(annotation.position), text, annotation.id, annotation.kind);
    return;
  }

  if (annotation.kind === 'edge_requirement' || annotation.kind === 'weld_symbol') {
    const line = resolveDrawingLine(annotation.attachment, view, projection);
    if (!line) return writer.warning(toDxf(view.position), annotation.id);
    const attachment: Point2 = [(line.start[0] + line.end[0]) / 2, (line.start[1] + line.end[1]) / 2];
    const text = annotation.kind === 'edge_requirement'
      ? `EDGE ${annotation.upper_deviation >= 0 ? '+' : ''}${trimNumber(annotation.upper_deviation)}/${trimNumber(annotation.lower_deviation)}${annotation.note ? ` ${annotation.note}` : ''}`
      : `${annotation.weld_type.toUpperCase()} ${trimNumber(annotation.size)}${annotation.length ? ` L${trimNumber(annotation.length)}` : ''}${annotation.pitch ? ` P${trimNumber(annotation.pitch)}` : ''}${annotation.tail ? ` ${annotation.tail}` : ''}`;
    writer.leader([toDxf(attachment), toDxf(annotation.position)], toDxf(annotation.position), text, annotation.id, annotation.kind);
    return;
  }

  if (annotation.kind !== 'chamfer_note') return;
  const first = resolveDrawingAnchor(annotation.first, view, projection);
  const second = resolveDrawingAnchor(annotation.second, view, projection);
  if (!first || !second) return writer.warning(toDxf(view.position), annotation.id);
  const attachment: Point2 = [
    (first.paper[0] + second.paper[0]) / 2,
    (first.paper[1] + second.paper[1]) / 2,
  ];
  const text = drawingChamferText(
    annotation.length,
    annotation.angle_deg,
    annotation.prefix,
    sheet.standard,
    units,
  );
  writer.leader([toDxf(attachment), toDxf(annotation.position)], toDxf([annotation.position[0] + 1.2, annotation.position[1] - 0.8]), text, annotation.id, 'chamfer_note');
}

function addSheetFrame(
  writer: DrawingDxfWriter,
  sheet: DrawingSheetDto,
  width: number,
  height: number,
): void {
  const toDxf = (point: Point2) => paperToDxf(point, height);
  const sheetBorder: Point2[] = [[5, 5], [width - 5, 5], [width - 5, height - 5], [5, height - 5]];
  writer.polyline('BORDER', sheetBorder.map(toDxf), true);
  const blockWidth = Math.min(180, width - 10);
  const blockHeight = 44;
  const x = width - 5 - blockWidth;
  const y = height - 5 - blockHeight;
  const titleBorder: Point2[] = [[x, y], [x + blockWidth, y], [x + blockWidth, y + blockHeight], [x, y + blockHeight]];
  writer.polyline('BORDER', titleBorder.map(toDxf), true);
  for (const row of [15, 23, 31, 38]) writer.line('BORDER', toDxf([x, y + row]), toDxf([x + blockWidth, y + row]));
  writer.line('BORDER', toDxf([x + blockWidth * 0.62, y]), toDxf([x + blockWidth * 0.62, y + 23]));
  writer.line('BORDER', toDxf([x + blockWidth * 0.78, y + 23]), toDxf([x + blockWidth * 0.78, y + blockHeight]));
  writer.line('BORDER', toDxf([x + blockWidth * 0.9, y + 31]), toDxf([x + blockWidth * 0.9, y + blockHeight]));
  const small = sheet.style.small_text_height_mm;
  writer.mtext('NOTES', toDxf([x + 3, y + 2.5]), sheet.title_block.title || sheet.name, sheet.style.text_height_mm + 0.8, 1);
  writer.mtext('NOTES', toDxf([x + 3, y + 9]), `DRAWING: ${sheet.title_block.drawing_number || '—'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + blockWidth * 0.64, y + 2.5]), `SHEET: ${sheet.name}`, small, 1);
  writer.mtext('NOTES', toDxf([x + blockWidth * 0.64, y + 9]), `${drawingFormatShortLabel(sheet.format)} · ${sheet.projection_method === 'first_angle' ? '1ST ANGLE' : '3RD ANGLE'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + 3, y + 17]), drawingToleranceNoteText(sheet.tolerance_note) || 'TOLERANCES: AS SPECIFIED', small, 1);
  writer.mtext('NOTES', toDxf([x + 3, y + 25]), `COMPANY: ${sheet.title_block.company || '—'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + blockWidth * 0.8, y + 25]), `REV ${sheet.title_block.revision || '—'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + 3, y + 33]), `MATERIAL: ${sheet.title_block.material || '—'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + blockWidth * 0.8, y + 33]), `FINISH: ${sheet.title_block.finish || '—'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + 3, y + 40]), `DRAWN: ${sheet.title_block.author || '—'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + blockWidth * 0.4, y + 40]), `CHECKED: ${sheet.title_block.checked_by || '—'}`, small, 1);
  writer.mtext('NOTES', toDxf([x + blockWidth * 0.79, y + 40]), `APPROVED: ${sheet.title_block.approved_by || '—'}`, small, 1);
  addRevisionTable(writer, sheet, height);
  addBomTable(writer, sheet, height);
}

function addRevisionTable(writer: DrawingDxfWriter, sheet: DrawingSheetDto, sheetHeight: number): void {
  if (!sheet.revision_table_position) return;
  const [x, y] = sheet.revision_table_position;
  const rowHeight = 6;
  const width = 112;
  const height = rowHeight * (sheet.revisions.length + 1);
  const toDxf = (point: Point2) => paperToDxf(point, sheetHeight);
  const border: Point2[] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  writer.polyline('BORDER', border.map(toDxf), true);
  for (let row = 1; row <= sheet.revisions.length; row += 1) writer.line('BORDER', toDxf([x, y + row * rowHeight]), toDxf([x + width, y + row * rowHeight]));
  for (const column of [12, 28]) writer.line('BORDER', toDxf([x + column, y]), toDxf([x + column, y + height]));
  const textHeight = sheet.style.small_text_height_mm;
  writer.mtext('NOTES', toDxf([x + 2, y + 1]), 'REV', textHeight, 1); writer.mtext('NOTES', toDxf([x + 14, y + 1]), 'DATE', textHeight, 1); writer.mtext('NOTES', toDxf([x + 30, y + 1]), 'DESCRIPTION / APPROVAL', textHeight, 1);
  sheet.revisions.forEach((revision, index) => {
    const rowY = y + (index + 1) * rowHeight + 1;
    writer.mtext('NOTES', toDxf([x + 2, rowY]), revision.revision, textHeight, 1); writer.mtext('NOTES', toDxf([x + 14, rowY]), revision.date, textHeight, 1); writer.mtext('NOTES', toDxf([x + 30, rowY]), revision.description || revision.change_order || '—', textHeight, 1);
  });
}

function addBomTable(writer: DrawingDxfWriter, sheet: DrawingSheetDto, sheetHeight: number): void {
  if (!sheet.bom_table_position) return;
  const [x, y] = sheet.bom_table_position;
  const rowHeight = 6;
  const width = 132;
  const height = rowHeight * (sheet.bom.length + 1);
  const toDxf = (point: Point2) => paperToDxf(point, sheetHeight);
  const border: Point2[] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  writer.polyline('BORDER', border.map(toDxf), true);
  for (let row = 1; row <= sheet.bom.length; row += 1) writer.line('BORDER', toDxf([x, y + row * rowHeight]), toDxf([x + width, y + row * rowHeight]));
  for (const column of [12, 40, 100, 112]) writer.line('BORDER', toDxf([x + column, y]), toDxf([x + column, y + height]));
  const textHeight = sheet.style.small_text_height_mm;
  for (const [offset, label] of [[2, 'ITEM'], [14, 'PART'], [42, 'DESCRIPTION'], [102, 'QTY'], [114, 'MATERIAL']] as Array<[number, string]>) writer.mtext('NOTES', toDxf([x + offset, y + 1]), label, textHeight, 1);
  sheet.bom.forEach((item, index) => {
    const rowY = y + (index + 1) * rowHeight + 1;
    for (const [offset, label] of [[2, item.item_number], [14, item.part_number || '—'], [42, item.description], [102, trimNumber(item.quantity)], [114, item.material || '—']] as Array<[number, string]>) writer.mtext('NOTES', toDxf([x + offset, rowY]), label, textHeight, 1);
  });
}

function projectedPolylineMatchesCircle(
  points: Point2[],
  circle: DrawingProjectedCircleDto,
): boolean {
  if (points.length < 4) return false;
  const tolerance = Math.max(0.02, circle.radius * 0.004);
  return points.every((point) => Math.abs(distance(point, circle.center) - circle.radius) <= tolerance);
}

function sameProjectedCircle(
  left: DrawingProjectedCircleDto,
  right: DrawingProjectedCircleDto,
): boolean {
  const scale = Math.max(1, left.radius, right.radius);
  return distance(left.center, right.center) <= scale * 1e-5
    && Math.abs(left.radius - right.radius) <= scale * 1e-5;
}

function projectedCoverageIsFullCircle(
  polylines: DrawingProjectionDto['visible'],
  circle: DrawingProjectedCircleDto,
): boolean {
  const points = polylines
    .filter((polyline) => projectedPolylineMatchesCircle(polyline.points, circle))
    .flatMap((polyline) => polyline.points);
  if (points.length < 5) return false;
  const angles = points
    .map((point) => normalizeDegrees(angleDegrees(circle.center, point)))
    .sort((left, right) => left - right);
  let largestGap = angles[0] + 360 - angles[angles.length - 1];
  for (let index = 1; index < angles.length; index += 1) {
    largestGap = Math.max(largestGap, angles[index] - angles[index - 1]);
  }
  // Exact curve sampling is intentionally sparse. A gap larger than 72° is
  // treated as an occluded arc and stays polyline geometry instead of being
  // incorrectly promoted to a complete CIRCLE entity.
  return largestGap <= 72;
}

function paperToDxf([x, y]: Point2, sheetHeight: number): Point2 {
  return [x, sheetHeight - y];
}

function arrowTriangle(tip: Point2, toward: Point2, size: number): [Point2, Point2, Point2] {
  const direction = normalize([toward[0] - tip[0], toward[1] - tip[1]]);
  const normal: Point2 = [-direction[1], direction[0]];
  const base: Point2 = [tip[0] + direction[0] * size, tip[1] + direction[1] * size];
  const half = size * 0.38;
  return [
    tip,
    [base[0] + normal[0] * half, base[1] + normal[1] * half],
    [base[0] - normal[0] * half, base[1] - normal[1] * half],
  ];
}

function minorArcAngles(center: Point2, first: Point2, second: Point2): [number, number] {
  const a = angleDegrees(center, first);
  const b = angleDegrees(center, second);
  const ccw = normalizeDegrees(b - a);
  return ccw <= 180 ? [a, b] : [b, a];
}

function angleDegrees(center: Point2, point: Point2): number {
  return Math.atan2(point[1] - center[1], point[0] - center[0]) * 180 / Math.PI;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalize([x, y]: Point2): Point2 {
  const length = Math.hypot(x, y);
  return length < 1e-9 ? [1, 0] : [x / length, y / length];
}

function distance(left: Point2, right: Point2): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function normalizePolyline(points: Point2[], closed: boolean): Point2[] {
  if (!closed || points.length < 2 || distance(points[0], points[points.length - 1]) > 1e-6) return points;
  return points.slice(0, -1);
}

function scaleLabel(scale: number): string {
  if (scale >= 1) return `${trimNumber(scale)}:1`;
  return `1:${trimNumber(1 / scale)}`;
}

function trimNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function dxfGdtText(annotation: Extract<DrawingAnnotationDto, { kind: 'gdt_frame' }>): string {
  const symbol: Record<typeof annotation.characteristic, string> = {
    straightness: 'STRAIGHTNESS', flatness: 'FLATNESS', circularity: 'CIRCULARITY',
    cylindricity: 'CYLINDRICITY', profile_line: 'PROFILE LINE', profile_surface: 'PROFILE SURFACE',
    angularity: 'ANGULARITY', perpendicularity: 'PERPENDICULARITY', parallelism: 'PARALLELISM',
    position: 'POSITION', concentricity: 'CONCENTRICITY', symmetry: 'SYMMETRY',
    circular_runout: 'CIRCULAR RUNOUT', total_runout: 'TOTAL RUNOUT',
  };
  const material = annotation.material_condition === 'maximum' ? ' MMC'
    : annotation.material_condition === 'least' ? ' LMC'
      : annotation.material_condition === 'regardless' ? ' RFS' : '';
  const datums = annotation.datums.map((datum) => datum.label).join('|');
  return `${symbol[annotation.characteristic]}|${annotation.diameter_zone ? '%%c' : ''}${trimNumber(annotation.tolerance)}${material}${datums ? `|${datums}` : ''}`;
}

function pointPairs(base: number, point: Point2): DxfPair[] {
  return [[base, point[0]], [base + 10, point[1]], [base + 20, 0]];
}

function metadataPairs(
  kind: string,
  annotationId: number,
  measurement?: number,
  viewScale?: number,
): DxfPair[] {
  const pairs: DxfPair[] = [[1001, 'NBS_CAD'], [1000, kind], [1071, annotationId]];
  if (measurement !== undefined) pairs.push([1040, measurement]);
  if (viewScale !== undefined) pairs.push([1040, viewScale]);
  return pairs;
}

function dxfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\P')
    .replace(/\0/g, '')
    .slice(0, 2048);
}

function entity(pairs: DxfPair[]): string {
  return pairs.map(([code, value]) => `${code}\n${formatValue(value)}\n`).join('');
}

function formatValue(value: string | number): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(8)).toString();
}

function section(name: string, content: string): string {
  return entity([[0, 'SECTION'], [2, name]]) + content + entity([[0, 'ENDSEC']]);
}

function table(name: string, handle: string, count: number, rows: string): string {
  return entity([[0, 'TABLE'], [2, name], [5, handle], [100, 'AcDbSymbolTable'], [70, count]])
    + rows
    + entity([[0, 'ENDTAB']]);
}

function layer(name: string, handle: string, lineType: string, color: number, lineweight: number): string {
  return entity([
    [0, 'LAYER'], [5, handle], [330, LAYER_TABLE], [100, 'AcDbSymbolTableRecord'],
    [100, 'AcDbLayerTableRecord'], [2, name], [70, 0], [62, color], [6, lineType], [370, lineweight],
  ]);
}

function lineType(name: string, handle: string, pattern: number[]): string {
  const total = pattern.reduce((sum, value) => sum + Math.abs(value), 0);
  const pairs: DxfPair[] = [
    [0, 'LTYPE'], [5, handle], [330, '2'], [100, 'AcDbSymbolTableRecord'],
    [100, 'AcDbLinetypeTableRecord'], [2, name], [70, 0], [3, name], [72, 65],
    [73, pattern.length], [40, total],
  ];
  for (const value of pattern) pairs.push([49, value], [74, 0]);
  return entity(pairs);
}

function dimStyle(style: DrawingSheetStyleDto): string {
  return entity([
    [0, 'DIMSTYLE'], [105, '25'], [330, '24'], [100, 'AcDbSymbolTableRecord'],
    [100, 'AcDbDimStyleTableRecord'], [2, DIMSTYLE_NAME], [70, 0],
    [3, ''], [4, ''], [5, ''], [6, ''], [7, 'STANDARD'],
    [40, 1], [41, style.arrow_size_mm], [42, 0.625], [43, 0], [44, 1.25], [140, style.text_height_mm], [147, 0.625],
    [71, 0], [72, 0], [73, 0], [74, 0], [75, 0], [76, 0], [77, 1], [78, 8],
    [170, 0], [171, 2], [172, 0], [173, 0], [174, 0], [175, 0], [176, 0], [177, 0],
    [271, 4], [272, 2], [273, 2], [274, 3], [275, 0], [276, 0], [277, 2], [278, 44], [279, 0],
  ]);
}

function blockRecord(name: string, handle: string): string {
  return entity([
    [0, 'BLOCK_RECORD'], [5, handle], [330, BLOCK_RECORD_TABLE], [100, 'AcDbSymbolTableRecord'],
    [100, 'AcDbBlockTableRecord'], [2, name], [70, 0], [280, 1], [281, 0],
  ]);
}

function blockDefinition(
  name: string,
  recordHandle: string,
  beginHandle: string,
  endHandle: string,
  contents: string,
): string {
  return entity([
    [0, 'BLOCK'], [5, beginHandle], [330, recordHandle], [100, 'AcDbEntity'], [8, '0'],
    [100, 'AcDbBlockBegin'], [2, name], [70, 0], [10, 0], [20, 0], [30, 0], [3, name], [1, ''],
  ]) + contents + entity([
    [0, 'ENDBLK'], [5, endHandle], [330, recordHandle], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbBlockEnd'],
  ]);
}
