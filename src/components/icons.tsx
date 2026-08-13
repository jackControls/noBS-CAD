/**
 * noBS CAD tool icons.
 *
 * CAD-specific glyphs are authored here as an original diagram family: 24×24,
 * rounded monochrome strokes, open construction geometry, and small directional
 * markers. They describe an operation instead of imitating a physical toolbar
 * button. General-purpose UI symbols come from the ISC-licensed Lucide library.
 *
 * The custom inventory and its construction rationale are recorded in
 * docs/ICON_PROVENANCE.md. Do not paste, trace, or adapt vendor icon paths here.
 */
import type { ReactNode } from 'react';
import {
  Crosshair,
  Equal,
  FlipHorizontal2,
  Lock,
  MousePointer2,
  Move,
  PenLine,
  Ruler,
  Scissors,
  Spline,
  Type,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Product-owned CAD diagrams                                          */
/* ------------------------------------------------------------------ */

const GLYPHS: Record<string, ReactNode> = {
  // Solid construction: a profile, transformation path, and result.
  extrude: (
    <>
      <rect x="3" y="8" width="6" height="10" rx="0.8" />
      <rect x="15" y="5" width="6" height="10" rx="0.8" />
      <path d="M9 8l6-3M9 18l6-3M9 13h6" />
      <path d="M12.5 10.5L15 13l-2.5 2.5" />
    </>
  ),
  revolve: (
    <>
      <path d="M5 3v18" strokeDasharray="2 2" />
      <path d="M8 18V7h4.5c2.7 0 4.5 2 4.5 5s-1.8 5-4.5 5H8" />
      <path d="M10 4.5a8.5 8.5 0 0 1 9 4" />
      <path d="M19 5.5v3h-3" />
    </>
  ),
  sweep: (
    <>
      <path d="M3.5 15.5l3-2 3 2-3 2-3-2z" />
      <path d="M9.5 15.5c3.5 0 3-8 8.5-8" />
      <ellipse cx="19.5" cy="7.5" rx="2" ry="3" />
      <path d="M15.5 6.5L18 7.5l-2 1.7" />
    </>
  ),
  loft: (
    <>
      <ellipse cx="12" cy="4.5" rx="4" ry="1.8" />
      <ellipse cx="12" cy="12" rx="7" ry="2.5" />
      <ellipse cx="12" cy="20" rx="5" ry="2" />
      <path d="M8 4.5L5 12l2 8M16 4.5l3 7.5-2 8" />
    </>
  ),
  rib: (
    <>
      <path d="M3 18l7 3 11-5-7-3-11 5z" />
      <path d="M9 17.5l3-11 4 8.2" />
      <path d="M12 6.5l2.2 1v7" strokeDasharray="2 2" />
    </>
  ),

  // Solid refinement and body operations use section diagrams.
  hole: (
    <>
      <ellipse cx="12" cy="7" rx="7.5" ry="3" />
      <ellipse cx="12" cy="7" rx="2.3" ry="1" />
      <path d="M4.5 7v8c0 1.6 3.4 3 7.5 3s7.5-1.4 7.5-3V7" />
      <path d="M12 8v11" strokeDasharray="2 2" />
    </>
  ),
  fillet: (
    <>
      <path d="M4 20V9h7a9 9 0 0 1 9 9v2" />
      <path d="M8 16a7 7 0 0 1 7-7" strokeDasharray="2 2" />
    </>
  ),
  chamfer: (
    <>
      <path d="M4 20V9h7l9 9v2" />
      <path d="M9 12l6 6" strokeDasharray="2 2" />
    </>
  ),
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
  moveCopy: (
    <>
      <path d="M5 5h7v7H5z" />
      <path d="M12 12h7v7h-7z" strokeDasharray="2 2" />
      <path d="M13 5h6v6M19 5l-8 8" />
    </>
  ),

  // Repetition and transforms.
  rectPattern: (
    <>
      <rect x="3" y="4" width="5" height="5" rx="0.6" />
      <rect x="11" y="4" width="5" height="5" rx="0.6" />
      <rect x="3" y="12" width="5" height="5" rx="0.6" />
      <rect x="11" y="12" width="5" height="5" rx="0.6" />
      <path d="M18 8h3M19.5 6.5V9.5" />
    </>
  ),
  circPattern: (
    <>
      <circle cx="12" cy="12" r="2" />
      <rect x="10" y="3" width="4" height="4" rx="0.7" />
      <rect x="16.5" y="13.5" width="4" height="4" rx="0.7" />
      <rect x="3.5" y="13.5" width="4" height="4" rx="0.7" />
      <path d="M7 7a7 7 0 0 1 10 0" strokeDasharray="2 2" />
    </>
  ),
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
  line: (
    <>
      <path d="M4 19L20 5" />
      <circle cx="4" cy="19" r="1.8" />
      <circle cx="20" cy="5" r="1.8" />
    </>
  ),
  midpointLine: (
    <>
      <path d="M3 18L21 6" />
      <circle cx="3" cy="18" r="1.6" />
      <circle cx="21" cy="6" r="1.6" />
      <path d="M12 9l2.2 3.2-4.4.2L12 9z" />
    </>
  ),
  rect: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="1" />
      <circle cx="4" cy="18" r="1.2" />
      <circle cx="20" cy="6" r="1.2" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="1.3" />
      <path d="M12 12l5-4" strokeDasharray="2 2" />
    </>
  ),
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
  arc: (
    <>
      <path d="M4 18C6 7 15 3 20 12" />
      <circle cx="4" cy="18" r="1.5" />
      <circle cx="20" cy="12" r="1.5" />
      <circle cx="12" cy="8" r="1.2" />
    </>
  ),
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
  slot: (
    <>
      <path d="M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z" />
      <path d="M8 10v4M16 10v4" strokeDasharray="2 2" />
    </>
  ),
  conic: (
    <>
      <path d="M4 19C6 8 11 5 20 4" />
      <path d="M4 19L20 4" strokeDasharray="2 2" />
      <circle cx="4" cy="19" r="1.5" />
      <circle cx="20" cy="4" r="1.5" />
    </>
  ),
  dimension: (
    <>
      <path d="M4 7v10M20 7v10M4 12h16" />
      <path d="M4 12l3-2v4l-3-2zM20 12l-3-2v4l3-2z" />
      <path d="M9 7l1.5-2h3L15 7" />
    </>
  ),
  // Sketch editing.
  offset: (
    <>
      <path d="M4 18V8h10" />
      <path d="M9 21V13h10" />
      <path d="M6.5 10.5l5 5" strokeDasharray="2 2" />
    </>
  ),
  extend: (
    <>
      <path d="M4 19L13 10" />
      <path d="M13 10l7-7" strokeDasharray="2 2" />
      <path d="M15 3h5v5" />
    </>
  ),
  break: (
    <>
      <path d="M4 19l6-6M14 10l6-6" />
      <path d="M9 9l3 2-2 3M15 15l-3-2 2-3" />
    </>
  ),
  // Constraints: geometric relation plus a small construction cue.
  coincident: (
    <>
      <path d="M4 18L12 10M20 18l-8-8" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M12 3v4M5 10h4M15 10h4" />
    </>
  ),
  midpointC: (
    <>
      <path d="M3 18h18" />
      <path d="M12 6l4 7H8l4-7z" />
      <path d="M12 13v5" strokeDasharray="2 2" />
    </>
  ),
  collinear: (
    <>
      <path d="M3 18L21 6" strokeDasharray="2 2" />
      <path d="M4 15l6-4M14 9l6-4" />
      <circle cx="12" cy="10" r="1.2" />
    </>
  ),
  hv: (
    <>
      <path d="M5 4v15h15" />
      <path d="M9 8h4M9 8v4" strokeDasharray="2 2" />
    </>
  ),
  parallel: (
    <>
      <path d="M5 19L10 5M14 19l5-14" />
      <path d="M7 10l3-1M14 15l3-1" />
    </>
  ),
  perpendicular: (
    <>
      <path d="M5 4v15h15" />
      <path d="M5 14h5v5" />
    </>
  ),
  tangent: (
    <>
      <circle cx="11" cy="14" r="6" />
      <path d="M4 7l16 5" />
      <circle cx="11" cy="9.2" r="1.2" />
    </>
  ),
  concentric: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  symmetry: (
    <>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="M4 7l5 5-5 5M20 7l-5 5 5 5" />
      <path d="M7 12h10" />
    </>
  ),
  fix: (
    <>
      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
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
export const CUSTOM_ICON_IDS: readonly string[] = Object.freeze(Object.keys(GLYPHS));

/* ------------------------------------------------------------------ */
/* Licensed general-purpose icons                                      */
/* ------------------------------------------------------------------ */

const LUCIDE: Record<string, LucideIcon> = {
  sketch: PenLine,
  spline: Spline,
  point: Crosshair,
  text: Type,
  mirror: FlipHorizontal2,
  trim: Scissors,
  moveCopy: Move,
  equal: Equal,
  measure: Ruler,
  select: MousePointer2,
  fixLucide: Lock,
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
