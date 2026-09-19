// Canonical product/Lucide geometry shared with the Rust renderer.
import extrude from '../assets/ribbon-icons/extrude.svg?raw';
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

const sources = { extrude, line, midpointLine, rect, circle, arc, slot, sketch, spline, point, finish, cancel, chevron };
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
