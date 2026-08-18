/**
 * noBS CAD ribbon model.
 *
 * The taxonomy follows the application's own modeling workflow and roadmap:
 * profile selection, solid construction, finishing, repetition, body operations,
 * references, and evaluation. Sketch tools follow draw, edit, dimension, and
 * constrain. Only implemented commands are enabled; future commands appear only
 * where they communicate an intentional near-term capability.
 *
 * Labels are i18n keys and action/payload identifiers are stable application
 * contracts. The grouping and ordering in this file are product-owned UI design.
 */

/** Actions the ribbon can dispatch into app state. */
export type RibbonAction =
  | 'enterSketch'
  | 'exitSketch'
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'loft'
  | 'rib'
  | 'solidFillet'
  | 'solidChamfer'
  | 'hole'
  | 'constructionPlane'
  | 'bodyFeature'
  | 'sketchPattern'
  | 'selectTool'
  | 'sketchTool'
  | 'applyConstraint'
  | 'drawingWorkspace'
  | 'assemblyWorkspace'
  | 'modelWorkspace'
  | 'joint'
  | 'drawingNewSheet'
  | 'drawingAutoLayout'
  | 'drawingAddView'
  | 'drawingTool'
  | 'drawingExportDxf'
  | 'drawingExportProfileDxf'
  | 'drawingPrint';

export type MenuEntry =
  | {
      type: 'item';
      id: string;
      labelKey: string;
      icon?: string;
      shortcut?: string;
      enabled?: boolean;
      action?: RibbonAction;
      /** Action argument (tool id for sketchTool, icon id for applyConstraint). */
      payload?: string;
      /** Present means the row owns a hover flyout submenu. */
      children?: MenuEntry[];
    }
  | { type: 'separator' };

export interface RibbonButton {
  id: string;
  labelKey: string;
  icon: string;
  enabled?: boolean;
  action?: RibbonAction;
  payload?: string;
}

export interface RibbonPanel {
  id: string;
  labelKey: string;
  buttons: RibbonButton[];
  /** Optional extended command list opened from the panel label. */
  menu?: MenuEntry[];
}

export interface RibbonTab {
  id: string;
  labelKey: string;
  enabled: boolean;
  panels: RibbonPanel[];
}

const sep: MenuEntry = { type: 'separator' };

/** Future commands are disabled unless their action is explicitly supplied. */
function item(
  id: string,
  labelKey: string,
  icon?: string,
  extra?: Partial<Extract<MenuEntry, { type: 'item' }>>,
): MenuEntry {
  return { type: 'item', id, labelKey, icon, enabled: false, ...extra };
}

/* ------------------------------------------------------------------ */
/* Model workspace menus                                               */
/* ------------------------------------------------------------------ */

const MODEL_BUILD_MENU: MenuEntry[] = [
  item('extrude', 'ribbon.solid.extrude', 'extrude', {
    shortcut: 'E',
    enabled: true,
    action: 'extrude',
  }),
  item('revolve', 'ribbon.solid.revolve', 'revolve', {
    enabled: true,
    action: 'revolve',
  }),
  item('sweep', 'ribbon.solid.sweep', 'sweep', {
    enabled: true,
    action: 'sweep',
  }),
  item('loft', 'ribbon.solid.loft', 'loft', {
    enabled: true,
    action: 'loft',
  }),
  item('rib', 'ribbon.solid.rib', 'rib', {
    enabled: true,
    action: 'rib',
  }),
];

const MODEL_REFINE_MENU: MenuEntry[] = [
  item('hole', 'ribbon.solid.hole', 'hole', { shortcut: 'H', enabled: true, action: 'hole' }),
  item('externalThread', 'ribbon.solid.externalThread', 'externalThread', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'external_thread',
  }),
  sep,
  item('fillet', 'ribbon.solid.fillet', 'fillet', { enabled: true, action: 'solidFillet' }),
  item('chamfer', 'ribbon.solid.chamfer', 'chamfer', { enabled: true, action: 'solidChamfer' }),
  item('shell', 'ribbon.solid.shell', 'shell', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'shell',
  }),
  item('draft', 'ribbon.solid.draft', 'draft'),
];

const MODEL_REPEAT_MENU: MenuEntry[] = [
  item('mirror', 'ribbon.solid.mirror', 'mirror', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'mirror',
  }),
  sep,
  item('patternRectangular', 'ribbon.solid.patternRectangular', 'rectPattern', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'rectangular_pattern',
  }),
  item('patternCircular', 'ribbon.solid.patternCircular', 'circPattern', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'circular_pattern',
  }),
  item('patternOnPath', 'ribbon.solid.patternOnPath', 'pathPattern'),
  sep,
  item('scale', 'ribbon.solid.scale', 'scale'),
];

const MODEL_BODY_MENU: MenuEntry[] = [
  item('moveCopy', 'ribbon.solid.moveCopy', 'moveCopy', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'move_copy',
  }),
  sep,
  item('combine', 'ribbon.solid.combine', 'combine', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'combine',
  }),
  item('splitBody', 'ribbon.solid.splitBody', 'splitBody', {
    enabled: true,
    action: 'bodyFeature',
    payload: 'split_body',
  }),
];

const MODEL_REFERENCE_MENU: MenuEntry[] = [
  item('offsetPlane', 'ribbon.solid.offsetPlane', 'plane', {
    enabled: true,
    action: 'constructionPlane',
    payload: 'offset',
  }),
  item('midplane', 'ribbon.solid.midplane', 'midplane', {
    enabled: true,
    action: 'constructionPlane',
    payload: 'midplane',
  }),
  item('planeAtAngle', 'ribbon.solid.planeAtAngle', 'planeAngle', {
    enabled: true,
    action: 'constructionPlane',
    payload: 'at_angle',
  }),
  sep,
  item('axisThrough', 'ribbon.solid.axisThrough', 'axis'),
  item('pointAtVertex', 'ribbon.solid.pointAtVertex', 'point'),
];

const MODEL_CHECK_MENU: MenuEntry[] = [
  item('measure', 'ribbon.solid.measure', 'measure'),
  item('sectionAnalysis', 'ribbon.solid.sectionAnalysis', 'section'),
  item('interference', 'ribbon.solid.interference', 'interference'),
];

/* ------------------------------------------------------------------ */
/* Sketch workspace menus                                              */
/* ------------------------------------------------------------------ */

const SKETCH_DRAW_MENU: MenuEntry[] = [
  item('line', 'ribbon.sketch.line', 'line', {
    shortcut: 'L',
    enabled: true,
    action: 'sketchTool',
    payload: 'line',
  }),
  item('arc', 'ribbon.sketch.arc', 'arc', {
    children: [
      item('arc3pt', 'ribbon.sketch.arc3pt', 'arc', {
        enabled: true,
        action: 'sketchTool',
        payload: 'arc3pt',
      }),
      item('arcCenter', 'ribbon.sketch.arcCenter', 'arc', {
        enabled: true,
        action: 'sketchTool',
        payload: 'arcCenter',
      }),
      item('arcTangent', 'ribbon.sketch.arcTangent', 'arc'),
    ],
  }),
  item('spline', 'ribbon.sketch.spline', 'spline', {
    children: [
      item('splineFit', 'ribbon.sketch.splineFit', 'spline', {
        enabled: true,
        action: 'sketchTool',
        payload: 'splineFit',
      }),
      item('splineControl', 'ribbon.sketch.splineControl', 'spline'),
    ],
  }),
  sep,
  item('rectangle', 'ribbon.sketch.rectangle', 'rect', {
    children: [
      item('rect2pt', 'ribbon.sketch.rect2pt', 'rect', {
        enabled: true,
        action: 'sketchTool',
        payload: 'rect2pt',
      }),
      item('rectCenter', 'ribbon.sketch.rectCenter', 'rect', {
        enabled: true,
        action: 'sketchTool',
        payload: 'rectCenter',
      }),
      item('rect3pt', 'ribbon.sketch.rect3pt', 'rect'),
    ],
  }),
  item('circle', 'ribbon.sketch.circle', 'circle', {
    children: [
      item('circleCenter', 'ribbon.sketch.circleCenter', 'circle', {
        enabled: true,
        action: 'sketchTool',
        payload: 'circleCenter',
      }),
      item('circle2pt', 'ribbon.sketch.circle2pt', 'circle', {
        enabled: true,
        action: 'sketchTool',
        payload: 'circle2pt',
      }),
      item('circle3pt', 'ribbon.sketch.circle3pt', 'circle'),
    ],
  }),
  item('polygon', 'ribbon.sketch.polygon', 'polygon', {
    children: [
      item('polygonInscribed', 'ribbon.sketch.polygonInscribed', 'polygon', {
        enabled: true,
        action: 'sketchTool',
        payload: 'polygon:inscribed',
      }),
      item('polygonCircumscribed', 'ribbon.sketch.polygonCircumscribed', 'polygon', {
        enabled: true,
        action: 'sketchTool',
        payload: 'polygon:circumscribed',
      }),
      item('polygonEdge', 'ribbon.sketch.polygonEdge', 'polygon'),
    ],
  }),
  item('slot', 'ribbon.sketch.slot', 'slot', {
    children: [
      item('slotCenterToCenter', 'ribbon.sketch.slotCenterToCenter', 'slot', {
        enabled: true,
        action: 'sketchTool',
        payload: 'slot:centerToCenter',
      }),
      item('slotOverall', 'ribbon.sketch.slotOverall', 'slot', {
        enabled: true,
        action: 'sketchTool',
        payload: 'slot:overall',
      }),
      item('slotCenterPoint', 'ribbon.sketch.slotCenterPoint', 'slot', {
        enabled: true,
        action: 'sketchTool',
        payload: 'slot:centerPoint',
      }),
      item('slotThreePointArc', 'ribbon.sketch.slotThreePointArc', 'slot'),
      item('slotCenterPointArc', 'ribbon.sketch.slotCenterPointArc', 'slot'),
    ],
  }),
  sep,
  item('midpointLine', 'ribbon.sketch.midpointLine', 'midpointLine', {
    enabled: true,
    action: 'sketchTool',
    payload: 'midpointLine',
  }),
  item('point', 'ribbon.sketch.point', 'point', {
    enabled: true,
    action: 'sketchTool',
    payload: 'point',
  }),
  item('ellipse', 'ribbon.sketch.ellipse', 'ellipse'),
  item('conicCurve', 'ribbon.sketch.conicCurve', 'conic'),
  item('text', 'ribbon.sketch.text', 'text'),
];

const SKETCH_EDIT_MENU: MenuEntry[] = [
  item('moveCopy', 'ribbon.sketch.moveCopy', 'moveCopy', {
    shortcut: 'M',
    enabled: true,
    action: 'sketchTool',
    payload: 'moveCopy',
  }),
  item('sketchScale', 'ribbon.sketch.sketchScale', 'scale', {
    enabled: true,
    action: 'sketchTool',
    payload: 'scale',
  }),
  sep,
  item('offset', 'ribbon.sketch.offset', 'offset', {
    shortcut: 'O',
    enabled: true,
    action: 'sketchTool',
    payload: 'offset',
  }),
  item('trim', 'ribbon.sketch.trim', 'trim', {
    shortcut: 'T',
    enabled: true,
    action: 'sketchTool',
    payload: 'trim',
  }),
  item('extend', 'ribbon.sketch.extend', 'extend', {
    enabled: true,
    action: 'sketchTool',
    payload: 'extend',
  }),
  item('break', 'ribbon.sketch.break', 'break', {
    enabled: true,
    action: 'sketchTool',
    payload: 'break',
  }),
  sep,
  item('fillet', 'ribbon.sketch.fillet', 'fillet', {
    shortcut: 'F',
    enabled: true,
    action: 'sketchTool',
    payload: 'fillet',
  }),
  item('chamfer', 'ribbon.sketch.chamfer', 'chamfer', {
    enabled: true,
    action: 'sketchTool',
    payload: 'chamfer',
  }),
];

const SKETCH_REPEAT_MENU: MenuEntry[] = [
  item('mirror', 'ribbon.sketch.mirror', 'mirror', {
    enabled: true,
    action: 'sketchTool',
    payload: 'mirror',
  }),
  sep,
  item('patternRectangular', 'ribbon.sketch.patternRectangular', 'rectPattern', {
    enabled: true,
    action: 'sketchPattern',
    payload: 'rectangular',
  }),
  item('patternCircular', 'ribbon.sketch.patternCircular', 'circPattern', {
    enabled: true,
    action: 'sketchPattern',
    payload: 'circular',
  }),
];

const SKETCH_CONSTRAIN_MENU: MenuEntry[] = [
  item('coincident', 'ribbon.sketch.coincident', 'coincident', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'coincident',
  }),
  item('midpoint', 'ribbon.sketch.midpoint', 'midpointC', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'midpoint',
  }),
  item('collinear', 'ribbon.sketch.collinear', 'collinear', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'collinear',
  }),
  sep,
  item('horizontalVertical', 'ribbon.sketch.horizontalVertical', 'hv', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'hv',
  }),
  item('parallel', 'ribbon.sketch.parallel', 'parallel', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'parallel',
  }),
  item('perpendicular', 'ribbon.sketch.perpendicular', 'perpendicular', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'perpendicular',
  }),
  sep,
  item('tangent', 'ribbon.sketch.tangent', 'tangent', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'tangent',
  }),
  item('concentric', 'ribbon.sketch.concentric', 'concentric', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'concentric',
  }),
  item('equal', 'ribbon.sketch.equal', 'equal', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'equal',
  }),
  item('symmetry', 'ribbon.sketch.symmetry', 'symmetry', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'symmetry',
  }),
  item('fixUnfix', 'ribbon.sketch.fixUnfix', 'fix', {
    enabled: true,
    action: 'applyConstraint',
    payload: 'fixUnfix',
  }),
  sep,
  item('autoConstrain', 'ribbon.sketch.autoConstrain', 'autoConstrain'),
  item('curvature', 'ribbon.sketch.curvature', 'curvature'),
];

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export const SOLID_TAB: RibbonTab = {
  id: 'solid',
  labelKey: 'ribbon.tabs.model',
  enabled: true,
  panels: [
    {
      id: 'profile',
      labelKey: 'ribbon.panels.profile',
      buttons: [
        {
          id: 'createSketch',
          labelKey: 'ribbon.solid.createSketch',
          icon: 'sketch',
          enabled: true,
          action: 'enterSketch',
        },
      ],
    },
    {
      id: 'build',
      labelKey: 'ribbon.panels.build',
      menu: MODEL_BUILD_MENU,
      buttons: [
        { id: 'extrude', labelKey: 'ribbon.solid.extrude', icon: 'extrude', enabled: true, action: 'extrude' },
        { id: 'revolve', labelKey: 'ribbon.solid.revolve', icon: 'revolve', enabled: true, action: 'revolve' },
        { id: 'sweep', labelKey: 'ribbon.solid.sweep', icon: 'sweep', enabled: true, action: 'sweep' },
        { id: 'loft', labelKey: 'ribbon.solid.loft', icon: 'loft', enabled: true, action: 'loft' },
        { id: 'rib', labelKey: 'ribbon.solid.rib', icon: 'rib', enabled: true, action: 'rib' },
      ],
    },
    {
      id: 'refine',
      labelKey: 'ribbon.panels.refine',
      menu: MODEL_REFINE_MENU,
      buttons: [
        { id: 'hole', labelKey: 'ribbon.solid.hole', icon: 'hole', enabled: true, action: 'hole' },
        { id: 'externalThread', labelKey: 'ribbon.solid.externalThread', icon: 'externalThread', enabled: true, action: 'bodyFeature', payload: 'external_thread' },
        { id: 'fillet', labelKey: 'ribbon.solid.fillet', icon: 'fillet', enabled: true, action: 'solidFillet' },
        { id: 'chamfer', labelKey: 'ribbon.solid.chamfer', icon: 'chamfer', enabled: true, action: 'solidChamfer' },
        { id: 'shell', labelKey: 'ribbon.solid.shell', icon: 'shell', enabled: true, action: 'bodyFeature', payload: 'shell' },
      ],
    },
    {
      id: 'repeat',
      labelKey: 'ribbon.panels.repeat',
      menu: MODEL_REPEAT_MENU,
      buttons: [
        { id: 'mirror', labelKey: 'ribbon.solid.mirror', icon: 'mirror', enabled: true, action: 'bodyFeature', payload: 'mirror' },
        { id: 'patternRectangular', labelKey: 'ribbon.solid.patternRectangular', icon: 'rectPattern', enabled: true, action: 'bodyFeature', payload: 'rectangular_pattern' },
        { id: 'patternCircular', labelKey: 'ribbon.solid.patternCircular', icon: 'circPattern', enabled: true, action: 'bodyFeature', payload: 'circular_pattern' },
      ],
    },
    {
      id: 'body',
      labelKey: 'ribbon.panels.body',
      menu: MODEL_BODY_MENU,
      buttons: [
        { id: 'moveCopy', labelKey: 'ribbon.solid.moveCopy', icon: 'moveCopy', enabled: true, action: 'bodyFeature', payload: 'move_copy' },
        { id: 'combine', labelKey: 'ribbon.solid.combine', icon: 'combine', enabled: true, action: 'bodyFeature', payload: 'combine' },
        { id: 'splitBody', labelKey: 'ribbon.solid.splitBody', icon: 'splitBody', enabled: true, action: 'bodyFeature', payload: 'split_body' },
      ],
    },
    {
      id: 'reference',
      labelKey: 'ribbon.panels.reference',
      menu: MODEL_REFERENCE_MENU,
      buttons: [
        { id: 'offsetPlane', labelKey: 'ribbon.solid.offsetPlane', icon: 'plane', enabled: true, action: 'constructionPlane', payload: 'offset' },
        { id: 'midplane', labelKey: 'ribbon.solid.midplane', icon: 'midplane', enabled: true, action: 'constructionPlane', payload: 'midplane' },
      ],
    },
    {
      id: 'check',
      labelKey: 'ribbon.panels.check',
      menu: MODEL_CHECK_MENU,
      buttons: [
        { id: 'measure', labelKey: 'ribbon.solid.measure', icon: 'measure' },
        { id: 'sectionAnalysis', labelKey: 'ribbon.solid.sectionAnalysis', icon: 'section' },
      ],
    },
    {
      id: 'assembly',
      labelKey: 'ribbon.tabs.assembly',
      buttons: [
        {
          id: 'assemblyBrowser',
          labelKey: 'ribbon.tabs.assembly',
          icon: 'combine',
          enabled: true,
          action: 'assemblyWorkspace',
        },
        {
          id: 'createJoint',
          labelKey: 'ribbon.assembly.joint',
          icon: 'combine',
          enabled: true,
          action: 'joint',
        },
      ],
    },
    {
      id: 'selection',
      labelKey: 'ribbon.panels.selection',
      buttons: [{ id: 'select', labelKey: 'ribbon.solid.select', icon: 'select', enabled: true }],
    },
  ],
};

export const SKETCH_TAB: RibbonTab = {
  id: 'sketch',
  labelKey: 'ribbon.tabs.sketch',
  enabled: true,
  panels: [
    {
      id: 'draw',
      labelKey: 'ribbon.panels.draw',
      menu: SKETCH_DRAW_MENU,
      buttons: [
        { id: 'line', labelKey: 'ribbon.sketch.line', icon: 'line', enabled: true, action: 'sketchTool', payload: 'line' },
        { id: 'arc', labelKey: 'ribbon.sketch.arc', icon: 'arc', enabled: true, action: 'sketchTool', payload: 'arc3pt' },
        { id: 'rectangle', labelKey: 'ribbon.sketch.rectangle', icon: 'rect', enabled: true, action: 'sketchTool', payload: 'rect2pt' },
        { id: 'circle', labelKey: 'ribbon.sketch.circle', icon: 'circle', enabled: true, action: 'sketchTool', payload: 'circleCenter' },
        { id: 'spline', labelKey: 'ribbon.sketch.spline', icon: 'spline', enabled: true, action: 'sketchTool', payload: 'splineFit' },
        { id: 'slot', labelKey: 'ribbon.sketch.slot', icon: 'slot', enabled: true, action: 'sketchTool', payload: 'slot:centerToCenter' },
        { id: 'polygon', labelKey: 'ribbon.sketch.polygon', icon: 'polygon', enabled: true, action: 'sketchTool', payload: 'polygon:inscribed' },
      ],
    },
    {
      id: 'edit',
      labelKey: 'ribbon.panels.edit',
      menu: SKETCH_EDIT_MENU,
      buttons: [
        { id: 'moveCopy', labelKey: 'ribbon.sketch.moveCopy', icon: 'moveCopy', enabled: true, action: 'sketchTool', payload: 'moveCopy' },
        { id: 'trim', labelKey: 'ribbon.sketch.trim', icon: 'trim', enabled: true, action: 'sketchTool', payload: 'trim' },
        { id: 'extend', labelKey: 'ribbon.sketch.extend', icon: 'extend', enabled: true, action: 'sketchTool', payload: 'extend' },
        { id: 'offset', labelKey: 'ribbon.sketch.offset', icon: 'offset', enabled: true, action: 'sketchTool', payload: 'offset' },
        { id: 'fillet', labelKey: 'ribbon.sketch.fillet', icon: 'fillet', enabled: true, action: 'sketchTool', payload: 'fillet' },
        { id: 'chamfer', labelKey: 'ribbon.sketch.chamfer', icon: 'chamfer', enabled: true, action: 'sketchTool', payload: 'chamfer' },
      ],
    },
    {
      id: 'dimension',
      labelKey: 'ribbon.panels.dimension',
      buttons: [
        { id: 'sketchDimension', labelKey: 'ribbon.sketch.sketchDimension', icon: 'dimension', enabled: true, action: 'sketchTool', payload: 'dimension' },
      ],
    },
    {
      id: 'repeat',
      labelKey: 'ribbon.panels.repeat',
      menu: SKETCH_REPEAT_MENU,
      buttons: [
        { id: 'mirror', labelKey: 'ribbon.sketch.mirror', icon: 'mirror', enabled: true, action: 'sketchTool', payload: 'mirror' },
        { id: 'patternRectangular', labelKey: 'ribbon.sketch.patternRectangular', icon: 'rectPattern', enabled: true, action: 'sketchPattern', payload: 'rectangular' },
        { id: 'patternCircular', labelKey: 'ribbon.sketch.patternCircular', icon: 'circPattern', enabled: true, action: 'sketchPattern', payload: 'circular' },
      ],
    },
    {
      id: 'constrain',
      labelKey: 'ribbon.panels.constrain',
      menu: SKETCH_CONSTRAIN_MENU,
      buttons: [
        { id: 'coincident', labelKey: 'ribbon.sketch.coincident', icon: 'coincident', enabled: true, action: 'applyConstraint', payload: 'coincident' },
        { id: 'horizontalVertical', labelKey: 'ribbon.sketch.horizontalVertical', icon: 'hv', enabled: true, action: 'applyConstraint', payload: 'hv' },
        { id: 'tangent', labelKey: 'ribbon.sketch.tangent', icon: 'tangent', enabled: true, action: 'applyConstraint', payload: 'tangent' },
        { id: 'parallel', labelKey: 'ribbon.sketch.parallel', icon: 'parallel', enabled: true, action: 'applyConstraint', payload: 'parallel' },
        { id: 'perpendicular', labelKey: 'ribbon.sketch.perpendicular', icon: 'perpendicular', enabled: true, action: 'applyConstraint', payload: 'perpendicular' },
        { id: 'equal', labelKey: 'ribbon.sketch.equal', icon: 'equal', enabled: true, action: 'applyConstraint', payload: 'equal' },
        { id: 'fixUnfix', labelKey: 'ribbon.sketch.fixUnfix', icon: 'fix', enabled: true, action: 'applyConstraint', payload: 'fixUnfix' },
      ],
    },
    {
      id: 'selection',
      labelKey: 'ribbon.panels.selection',
      buttons: [
        { id: 'select', labelKey: 'ribbon.sketch.select', icon: 'select', enabled: true, action: 'selectTool' },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Drawing workspace menus                                            */
/* ------------------------------------------------------------------ */

const DRAWING_VIEWS_MENU: MenuEntry[] = [
  item('drawingStandardViews', 'ribbon.drawing.standardViews', 'plane', {
    children: [
      item('drawingFrontViewMenu', 'ribbon.drawing.front', 'plane', { enabled: true, action: 'drawingAddView', payload: 'front' }),
      item('drawingTopViewMenu', 'ribbon.drawing.top', 'plane', { enabled: true, action: 'drawingAddView', payload: 'top' }),
      item('drawingLeftViewMenu', 'ribbon.drawing.left', 'plane', { enabled: true, action: 'drawingAddView', payload: 'left' }),
      item('drawingRightViewMenu', 'ribbon.drawing.right', 'plane', { enabled: true, action: 'drawingAddView', payload: 'right' }),
      item('drawingIsometricViewMenu', 'ribbon.drawing.isometric', 'section', { enabled: true, action: 'drawingAddView', payload: 'isometric' }),
    ],
  }),
  item('drawingDerivedViews', 'ribbon.drawing.derivedViews', 'section', {
    children: [
      item('drawingSectionViewMenu', 'ribbon.drawing.sectionView', 'section', { enabled: true, action: 'drawingTool', payload: 'section_view' }),
      item('drawingDetailViewMenu', 'ribbon.drawing.detailView', 'circle', { enabled: true, action: 'drawingTool', payload: 'detail_view' }),
      item('drawingAuxiliaryViewMenu', 'ribbon.drawing.auxiliaryView', 'plane', { enabled: true, action: 'drawingTool', payload: 'auxiliary_view' }),
      item('drawingBrokenViewMenu', 'ribbon.drawing.brokenView', 'splitBody', { enabled: true, action: 'drawingTool', payload: 'broken_view' }),
      item('drawingRemovedSectionMenu', 'ribbon.drawing.removedSection', 'section', { enabled: true, action: 'drawingTool', payload: 'removed_section' }),
    ],
  }),
];

const DRAWING_DIMENSIONS_MENU: MenuEntry[] = [
  item('drawingLinearDimensions', 'ribbon.drawing.linearDimensions', 'measure', {
    children: [
      item('drawingDimensionMenu', 'ribbon.drawing.dimension', 'measure', { enabled: true, action: 'drawingTool', payload: 'dimension' }),
      item('drawingChainDimensionMenu', 'ribbon.drawing.chainDimension', 'measure', { enabled: true, action: 'drawingTool', payload: 'chain_dimension' }),
      item('drawingBaselineDimensionMenu', 'ribbon.drawing.baselineDimension', 'measure', { enabled: true, action: 'drawingTool', payload: 'baseline_dimension' }),
      item('drawingContinuedDimensionMenu', 'ribbon.drawing.continuedDimension', 'measure', { enabled: true, action: 'drawingTool', payload: 'continued_dimension' }),
      item('drawingOrdinateDimensionMenu', 'ribbon.drawing.ordinateDimension', 'measure', { enabled: true, action: 'drawingTool', payload: 'ordinate_dimension' }),
    ],
  }),
  item('drawingFeatureDimensions', 'ribbon.drawing.featureDimensions', 'circle', {
    children: [
      item('drawingDiameterMenu', 'ribbon.drawing.diameter', 'circle', { enabled: true, action: 'drawingTool', payload: 'diameter' }),
      item('drawingRadiusMenu', 'ribbon.drawing.radius', 'arc', { enabled: true, action: 'drawingTool', payload: 'radius' }),
      item('drawingArcLengthMenu', 'ribbon.drawing.arcLength', 'arc', { enabled: true, action: 'drawingTool', payload: 'arc_length' }),
      item('drawingJoggedRadiusMenu', 'ribbon.drawing.joggedRadius', 'arc', { enabled: true, action: 'drawingTool', payload: 'jogged_radius' }),
      item('drawingAngleMenu', 'ribbon.drawing.angle', 'planeAngle', { enabled: true, action: 'drawingTool', payload: 'angle' }),
    ],
  }),
];

const DRAWING_ANNOTATE_MENU: MenuEntry[] = [
  item('drawingCenterGeometry', 'ribbon.drawing.centerGeometry', 'centerLine', {
    children: [
      item('drawingCenterMarkMenu', 'ribbon.drawing.centerMark', 'centerMark', { enabled: true, action: 'drawingTool', payload: 'center_mark' }),
      item('drawingCenterLineMenu', 'ribbon.drawing.centerLine', 'centerLine', { enabled: true, action: 'drawingTool', payload: 'center_line' }),
      item('drawingSymmetryAxisMenu', 'ribbon.drawing.symmetryAxis', 'centerLine', { enabled: true, action: 'drawingTool', payload: 'symmetry_axis' }),
      item('drawingBoltCircleMenu', 'ribbon.drawing.boltCircle', 'circle', { enabled: true, action: 'drawingTool', payload: 'bolt_circle' }),
    ],
  }),
  item('drawingManufacturingNotes', 'ribbon.drawing.manufacturingNotes', 'text', {
    children: [
      item('drawingHoleNoteMenu', 'ribbon.drawing.holeNote', 'hole', { enabled: true, action: 'drawingTool', payload: 'hole_note' }),
      item('drawingChamferNoteMenu', 'ribbon.drawing.chamferNote', 'chamfer', { enabled: true, action: 'drawingTool', payload: 'chamfer_note' }),
      item('drawingNoteMenu', 'ribbon.drawing.note', 'text', { enabled: true, action: 'drawingTool', payload: 'note' }),
    ],
  }),
];

const DRAWING_SYMBOLS_MENU: MenuEntry[] = [
  item('drawingTolerancingSymbols', 'ribbon.drawing.tolerancingSymbols', 'measure', {
    children: [
      item('drawingDatumMenu', 'ribbon.drawing.datum', 'plane', { enabled: true, action: 'drawingTool', payload: 'datum' }),
      item('drawingGdtMenu', 'ribbon.drawing.gdt', 'measure', { enabled: true, action: 'drawingTool', payload: 'gdt' }),
      item('drawingSurfaceTextureMenu', 'ribbon.drawing.surfaceTexture', 'chamfer', { enabled: true, action: 'drawingTool', payload: 'surface_texture' }),
      item('drawingEdgeRequirementMenu', 'ribbon.drawing.edgeRequirement', 'chamfer', { enabled: true, action: 'drawingTool', payload: 'edge_requirement' }),
    ],
  }),
  item('drawingDocumentSymbols', 'ribbon.drawing.documentSymbols', 'text', {
    children: [
      item('drawingWeldMenu', 'ribbon.drawing.weld', 'sweep', { enabled: true, action: 'drawingTool', payload: 'weld' }),
      item('drawingBalloonMenu', 'ribbon.drawing.balloon', 'circle', { enabled: true, action: 'drawingTool', payload: 'balloon' }),
      item('drawingRevisionCloudMenu', 'ribbon.drawing.revisionCloud', 'spline', { enabled: true, action: 'drawingTool', payload: 'revision_cloud' }),
    ],
  }),
];

const DRAWING_OUTPUT_MENU: MenuEntry[] = [
  item('exportDrawingDxfMenu', 'ribbon.drawing.exportDxf', 'measure', { enabled: true, action: 'drawingExportDxf' }),
  item('exportDrawingProfileDxfMenu', 'ribbon.drawing.exportProfileDxf', 'profile', { enabled: true, action: 'drawingExportProfileDxf' }),
  sep,
  item('printDrawingMenu', 'ribbon.drawing.print', 'section', { enabled: true, action: 'drawingPrint' }),
];

export const DRAWING_TAB: RibbonTab = {
  id: 'drawing',
  labelKey: 'ribbon.tabs.drawing',
  enabled: true,
  panels: [
    {
      id: 'sheet',
      labelKey: 'ribbon.panels.sheet',
      buttons: [
        { id: 'newSheet', labelKey: 'ribbon.drawing.newSheet', icon: 'rect', enabled: true, action: 'drawingNewSheet' },
        { id: 'autoLayout', labelKey: 'ribbon.drawing.autoLayout', icon: 'rectPattern', enabled: true, action: 'drawingAutoLayout' },
      ],
    },
    {
      id: 'views',
      labelKey: 'ribbon.panels.views',
      menu: DRAWING_VIEWS_MENU,
      buttons: [
        { id: 'frontView', labelKey: 'ribbon.drawing.front', icon: 'plane', enabled: true, action: 'drawingAddView', payload: 'front' },
        { id: 'isometricView', labelKey: 'ribbon.drawing.isometric', icon: 'section', enabled: true, action: 'drawingAddView', payload: 'isometric' },
        { id: 'drawingSectionView', labelKey: 'ribbon.drawing.sectionView', icon: 'section', enabled: true, action: 'drawingTool', payload: 'section_view' },
      ],
    },
    {
      id: 'dimensions',
      labelKey: 'ribbon.panels.dimensions',
      menu: DRAWING_DIMENSIONS_MENU,
      buttons: [
        { id: 'drawingDimension', labelKey: 'ribbon.drawing.dimension', icon: 'measure', enabled: true, action: 'drawingTool', payload: 'dimension' },
      ],
    },
    {
      id: 'annotate',
      labelKey: 'ribbon.panels.annotate',
      menu: DRAWING_ANNOTATE_MENU,
      buttons: [
        { id: 'drawingCenterLine', labelKey: 'ribbon.drawing.centerLine', icon: 'centerLine', enabled: true, action: 'drawingTool', payload: 'center_line' },
        { id: 'drawingHoleNote', labelKey: 'ribbon.drawing.holeNote', icon: 'hole', enabled: true, action: 'drawingTool', payload: 'hole_note' },
        { id: 'drawingNote', labelKey: 'ribbon.drawing.note', icon: 'text', enabled: true, action: 'drawingTool', payload: 'note' },
      ],
    },
    {
      id: 'symbols',
      labelKey: 'ribbon.panels.symbols',
      menu: DRAWING_SYMBOLS_MENU,
      buttons: [
        { id: 'drawingDatum', labelKey: 'ribbon.drawing.datum', icon: 'plane', enabled: true, action: 'drawingTool', payload: 'datum' },
        { id: 'drawingGdt', labelKey: 'ribbon.drawing.gdt', icon: 'measure', enabled: true, action: 'drawingTool', payload: 'gdt' },
      ],
    },
    {
      id: 'output',
      labelKey: 'ribbon.panels.output',
      menu: DRAWING_OUTPUT_MENU,
      buttons: [
        { id: 'exportDrawingDxf', labelKey: 'ribbon.drawing.exportDxf', icon: 'measure', enabled: true, action: 'drawingExportDxf' },
        { id: 'printDrawing', labelKey: 'ribbon.drawing.print', icon: 'section', enabled: true, action: 'drawingPrint' },
      ],
    },
  ],
};

export const ASSEMBLY_TAB: RibbonTab = {
  id: 'assembly',
  labelKey: 'ribbon.tabs.assembly',
  enabled: true,
  panels: [
    {
      id: 'joints',
      labelKey: 'ribbon.panels.joints',
      buttons: [
        {
          id: 'createJoint',
          labelKey: 'ribbon.assembly.joint',
          icon: 'combine',
          enabled: true,
          action: 'joint',
        },
      ],
    },
  ],
};

/** Only real workspaces are shown; planned work lives in the roadmap, not disabled tabs. */
export const SOLID_WORKSPACE_TABS: Array<{ id: string; labelKey: string; enabled: boolean }> = [
  { id: 'solid', labelKey: 'ribbon.tabs.model', enabled: true },
];

export function ribbonTabById(id: string): RibbonTab {
  return id === 'sketch'
    ? SKETCH_TAB
    : id === 'drawing'
      ? DRAWING_TAB
      : id === 'assembly'
        ? ASSEMBLY_TAB
        : SOLID_TAB;
}
