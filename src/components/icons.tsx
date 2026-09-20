/**
 * noBS CAD tool icons.
 *
 * CAD-specific glyphs are authored here as an original diagram family: 24×24,
 * rounded monochrome strokes, open construction geometry, and small directional
 * markers. They describe an operation instead of imitating a physical toolbar
 * button. General-purpose UI symbols come from the ISC-licensed Lucide library.
 * CAM operations use the separate steel-and-blue machining pictogram family.
 *
 * The custom inventory and its construction rationale are recorded in
 * docs/ICON_PROVENANCE.md. Do not paste, trace, or adapt vendor icon paths here.
 */
import type { ReactNode } from 'react';
import { SharedRibbonGlyph, SharedRibbonIcon } from './ribbonGlyphs';
import { CAM_ICON_IDS, CamToolIcon, isCamIcon } from './cam/CamToolIcon';
import {
  Code2,
  Cuboid,
  Equal,
  Lock,
  Move,
  Ruler,
  Type,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Product-owned CAD diagrams                                          */
/* ------------------------------------------------------------------ */

const GLYPHS: Record<string, ReactNode> = {
  // Solid construction: a profile, transformation path, and result.
  extrude: <SharedRibbonGlyph id="extrude" />,
  revolve: <SharedRibbonGlyph id="revolve" />,
  sweep: <SharedRibbonGlyph id="sweep" />,
  loft: <SharedRibbonGlyph id="loft" />,
  rib: <SharedRibbonGlyph id="rib" />,

  // Solid refinement and body operations use section diagrams.
  hole: (
    <>
      <ellipse cx="12" cy="7" rx="7.5" ry="3" />
      <ellipse cx="12" cy="7" rx="2.3" ry="1" />
      <path d="M4.5 7v8c0 1.6 3.4 3 7.5 3s7.5-1.4 7.5-3V7" />
      <path d="M12 8v11" strokeDasharray="2 2" />
    </>
  ),
  externalThread: (
    <>
      <path d="M7 4h7c2.2 0 4 1.8 4 4v8c0 2.2-1.8 4-4 4H7" />
      <path d="M7 4v16" strokeDasharray="2 2" />
      <path d="M5 7.5l4 2.2-4 2.2 4 2.2-4 2.2 4 2.2" />
      <path d="M12 6.5h3M12 17.5h3" />
    </>
  ),
  fillet: <SharedRibbonGlyph id="fillet" />,
  chamfer: <SharedRibbonGlyph id="chamfer" />,
  shell: (
    <>
      <path d="M5 5h14v14H5V5z" />
      <path d="M8 8h8v8H8V8z" />
      <path d="M10 5h4" strokeWidth="3.2" />
    </>
  ),
  draft: (
    <>
      <path d="M5 20V5h5M19 20L15 5h-2" />
      <path d="M9 17h7" />
      <path d="M7.5 8.5a5 5 0 0 1 4.5-2" strokeDasharray="2 2" />
    </>
  ),
  combine: (
    <>
      <rect x="3.5" y="5" width="10" height="10" rx="2" />
      <circle cx="15" cy="14" r="5.5" />
      <path d="M11 10l7 7M18 13v4h-4" />
    </>
  ),
  splitBody: (
    <>
      <path d="M5 5h14v14H5z" />
      <path d="M4 15L20 9" strokeDasharray="2 2" />
      <path d="M8 8l-3-3M16 16l3 3" />
    </>
  ),
  moveCopy: <SharedRibbonGlyph id="moveCopy" />,

  // Repetition and transforms.
  rectPattern: <SharedRibbonGlyph id="rectPattern" />,
  circPattern: <SharedRibbonGlyph id="circPattern" />,
  pathPattern: (
    <>
      <path d="M3 19c4-8 8-1 11-8 1.2-2.8 3-4.2 7-5" strokeDasharray="2 2" />
      <rect x="2.5" y="16.5" width="4" height="4" rx="0.6" />
      <rect x="10" y="9" width="4" height="4" rx="0.6" />
      <rect x="18" y="3.5" width="4" height="4" rx="0.6" />
    </>
  ),
  scale: (
    <>
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <path d="M8 8L4 4M4 8V4h4M16 16l4 4m0-4v4h-4" />
      <path d="M5 19h5M19 5v5" strokeDasharray="2 2" />
    </>
  ),

  // Datum/reference and evaluation diagrams.
  plane: (
    <>
      <path d="M3 14l9-5 9 5-9 5-9-5z" />
      <path d="M12 4v16" strokeDasharray="2 2" />
      <path d="M9.5 6.5L12 4l2.5 2.5" />
    </>
  ),
  midplane: (
    <>
      <path d="M3 8l9-4 9 4-9 4-9-4z" />
      <path d="M3 16l9-4 9 4-9 4-9-4z" />
      <path d="M3 12h18" strokeDasharray="2 2" />
    </>
  ),
  planeAngle: (
    <>
      <path d="M3 18h18L12 13 3 18z" />
      <path d="M5 18L15 5l6 3-10 7" />
      <path d="M9 16a5 5 0 0 1 2-4" strokeDasharray="2 2" />
    </>
  ),
  axis: (
    <>
      <path d="M4 17l16-10" strokeDasharray="2 2" />
      <circle cx="7" cy="15" r="3.5" />
      <circle cx="17" cy="9" r="3.5" />
      <path d="M17.5 4.5L20 7l-3.5.5" />
    </>
  ),
  section: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M12 5v14" />
      <path d="M13.5 7l4 2M13.5 11l4 2M13.5 15l3 1.5" />
      <path d="M6 8h4M6 12h4M6 16h4" strokeDasharray="2 2" />
    </>
  ),
  interference: (
    <>
      <rect x="3" y="6" width="11" height="11" rx="2" />
      <circle cx="15" cy="13" r="6" />
      <path d="M11 9l7 7M18 9l-7 7" />
    </>
  ),
  // Sketch creation.
  line: <SharedRibbonGlyph id="line" />,
  midpointLine: <SharedRibbonGlyph id="midpointLine" />,
  rect: <SharedRibbonGlyph id="rect" />,
  circle: <SharedRibbonGlyph id="circle" />,
  centerMark: (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M2.5 12h19M12 2.5v19" strokeDasharray="6 2 1 2" />
    </>
  ),
  centerLine: (
    <>
      <circle cx="6" cy="12" r="3.2" />
      <circle cx="18" cy="12" r="3.2" />
      <path d="M1 12h22" strokeDasharray="6 2 1 2" />
    </>
  ),
  arc: <SharedRibbonGlyph id="arc" />,
  polygon: (
    <>
      <path d="M12 3l8 6-3 10H7L4 9l8-6z" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M12 12l5-5" strokeDasharray="2 2" />
    </>
  ),
  ellipse: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" />
      <circle cx="7" cy="12" r="1.2" />
      <circle cx="17" cy="12" r="1.2" />
    </>
  ),
  slot: <SharedRibbonGlyph id="slot" />,
  conic: (
    <>
      <path d="M4 19C6 8 11 5 20 4" />
      <path d="M4 19L20 4" strokeDasharray="2 2" />
      <circle cx="4" cy="19" r="1.5" />
      <circle cx="20" cy="4" r="1.5" />
    </>
  ),
  dimension: <SharedRibbonGlyph id="dimension" />,
  // Sketch editing.
  offset: <SharedRibbonGlyph id="offset" />,
  extend: <SharedRibbonGlyph id="extend" />,
  break: <SharedRibbonGlyph id="break" />,
  // Constraints: geometric relation plus a small construction cue.
  coincident: <SharedRibbonGlyph id="coincident" />,
  midpointC: <SharedRibbonGlyph id="midpointC" />,
  collinear: <SharedRibbonGlyph id="collinear" />,
  hv: <SharedRibbonGlyph id="hv" />,
  equal: <SharedRibbonGlyph id="equal" />,
  parallel: <SharedRibbonGlyph id="parallel" />,
  perpendicular: <SharedRibbonGlyph id="perpendicular" />,
  tangent: <SharedRibbonGlyph id="tangent" />,
  concentric: <SharedRibbonGlyph id="concentric" />,
  symmetry: <SharedRibbonGlyph id="symmetry" />,
  fix: <SharedRibbonGlyph id="fix" />,
  autoConstrain: (
    <>
      <path d="M4 19V7h10" />
      <path d="M17 3l1.1 2.4L21 6.5l-2.9 1.1L17 10l-1.1-2.4L13 6.5l2.9-1.1L17 3z" />
      <circle cx="9" cy="14" r="2" strokeDasharray="2 2" />
    </>
  ),
  curvature: (
    <>
      <path d="M3 19C8 18 7 8 14 6c2.5-.8 5-.2 7 1.5" />
      <path d="M8 16l-3-5M14 7l2 5" strokeDasharray="2 2" />
    </>
  ),
};

/** Stable inventory used by documentation and lightweight integrity checks. */
export const CUSTOM_ICON_IDS: readonly string[] = Object.freeze([...Object.keys(GLYPHS), ...CAM_ICON_IDS]);

/* ------------------------------------------------------------------ */
/* Licensed general-purpose icons                                      */
/* ------------------------------------------------------------------ */

const LUCIDE: Record<string, LucideIcon> = {
  text: Type,
  moveCopy: Move,
  equal: Equal,
  measure: Ruler,
  fixLucide: Lock,
  code: Code2,
  box: Cuboid,
};

/** Glyph ids rendered in the constraint color. */
export const CONSTRAINT_ICON_IDS: ReadonlySet<string> = new Set([
  'hv',
  'coincident',
  'tangent',
  'equal',
  'parallel',
  'perpendicular',
  'fix',
  'midpointC',
  'concentric',
  'collinear',
  'symmetry',
  'curvature',
]);

/** Constraint icons use the constraint color; pass `tone="constraint"`. */
export function ToolIcon({
  id,
  size = 16,
  tone,
  className,
}: {
  id?: string;
  size?: number;
  tone?: 'constraint';
  className?: string;
}) {
  const colorClass = tone === 'constraint' ? 'text-[#e07878]' : undefined;

  if (isCamIcon(id)) {
    return <CamToolIcon id={id} size={size} className={className} />;
  }

  if (id && GLYPHS[id]) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cxIcon(colorClass, className)}
        aria-hidden="true"
      >
        {GLYPHS[id]}
      </svg>
    );
  }

  if (id === 'sketch' || id === 'spline' || id === 'point' || id === 'trim' || id === 'select' || id === 'mirror') {
    return <SharedRibbonIcon id={id} size={size} className={cxIcon(colorClass, className)} />;
  }

  const Lucide = id ? LUCIDE[id] : undefined;
  if (Lucide) {
    return (
      <Lucide size={size} strokeWidth={1.6} className={cxIcon(colorClass, className)} aria-hidden="true" />
    );
  }

  // Unknown ids render a neutral frame rather than breaking the toolbar.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className={cxIcon(colorClass, className)}
      aria-hidden="true"
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}
function cxIcon(...classes: Array<string | undefined>): string | undefined {
  const joined = classes.filter(Boolean).join(' ');
  return joined || undefined;
}
