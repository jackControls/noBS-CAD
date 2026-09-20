import rib from '../assets/ribbon-icons/rib.svg?raw';
import shell from '../assets/ribbon-icons/shell.svg?raw';
import sweep from '../assets/ribbon-icons/sweep.svg?raw';
import loft from '../assets/ribbon-icons/loft.svg?raw';
// Canonical product/Lucide geometry shared with the Rust renderer.
import extrude from '../assets/ribbon-icons/extrude.svg?raw';
import revolve from '../assets/ribbon-icons/revolve.svg?raw';
import line from '../assets/ribbon-icons/line.svg?raw';
import midpointLine from '../assets/ribbon-icons/midpointLine.svg?raw';
import rect from '../assets/ribbon-icons/rect.svg?raw';
import circle from '../assets/ribbon-icons/circle.svg?raw';
import arc from '../assets/ribbon-icons/arc.svg?raw';
import slot from '../assets/ribbon-icons/slot.svg?raw';
import sketch from '../assets/ribbon-icons/sketch.svg?raw';
import spline from '../assets/ribbon-icons/spline.svg?raw';
import point from '../assets/ribbon-icons/point.svg?raw';
import finish from '../assets/ribbon-icons/finish.svg?raw';
import cancel from '../assets/ribbon-icons/cancel.svg?raw';
import chevron from '../assets/ribbon-icons/chevron.svg?raw';

import trim from '../assets/ribbon-icons/trim.svg?raw';
import extend from '../assets/ribbon-icons/extend.svg?raw';
import breakGlyph from '../assets/ribbon-icons/break.svg?raw';
import offset from '../assets/ribbon-icons/offset.svg?raw';
import fillet from '../assets/ribbon-icons/fillet.svg?raw';
import chamfer from '../assets/ribbon-icons/chamfer.svg?raw';
import moveCopy from '../assets/ribbon-icons/moveCopy.svg?raw';
import mirror from '../assets/ribbon-icons/mirror.svg?raw';
import select from '../assets/ribbon-icons/select.svg?raw';
import rectPattern from '../assets/ribbon-icons/rectPattern.svg?raw';
import circPattern from '../assets/ribbon-icons/circPattern.svg?raw';
import hv from '../assets/ribbon-icons/hv.svg?raw';
import fix from '../assets/ribbon-icons/fix.svg?raw';
import midpointC from '../assets/ribbon-icons/midpointC.svg?raw';
import coincident from '../assets/ribbon-icons/coincident.svg?raw';
import tangent from '../assets/ribbon-icons/tangent.svg?raw';
import equal from '../assets/ribbon-icons/equal.svg?raw';
import parallel from '../assets/ribbon-icons/parallel.svg?raw';
import perpendicular from '../assets/ribbon-icons/perpendicular.svg?raw';
import concentric from '../assets/ribbon-icons/concentric.svg?raw';
import collinear from '../assets/ribbon-icons/collinear.svg?raw';
import symmetry from '../assets/ribbon-icons/symmetry.svg?raw';
import dimension from '../assets/ribbon-icons/dim.svg?raw';

const sources = { shell, dimension, trim, extend, break: breakGlyph, offset, fillet, chamfer, moveCopy, mirror, select, rectPattern, circPattern, hv, fix, midpointC, coincident, tangent, equal, parallel, perpendicular, concentric, collinear, symmetry, extrude, revolve, sweep, loft, rib, line, midpointLine, rect, circle, arc, slot, sketch, spline, point, finish, cancel, chevron };
const content = Object.fromEntries(Object.entries(sources).map(([id, svg]) => [id, svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')]));
const strokes = Object.fromEntries(Object.entries(sources).map(([id, svg]) => [id, Number(svg.match(/stroke-width="([\d.]+)"/)?.[1] ?? 1.6)]));

/** Only repository-owned SVG literals enter this node; never user content. */
export function SharedRibbonGlyph({ id }: { id: keyof typeof sources }) {
  return <g dangerouslySetInnerHTML={{ __html: content[id] }} />;
}

export function SharedRibbonIcon({ id, size, className }: { id: keyof typeof sources; size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokes[id]} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <SharedRibbonGlyph id={id} />
    </svg>
  );
}
