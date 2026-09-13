/** Original machining pictograms: steel stock/tools and blue cutting geometry.
 * The shared drill depicts flute surfaces, not a line wrapped around a shaft.
 * Editable geometry lives here; ownership and licensing: docs/ICON_PROVENANCE.md.
 */
import { useId, type ReactNode } from 'react';
import type { CamOperationDto } from '../../engine/types';
import './camToolIcons.css';

function BodyEdges({ children }: { children: ReactNode }) {
  return <g stroke="var(--cam-icon-line)" strokeWidth={1.75}>{children}</g>;
}

function Flow({ d }: { d: string }) {
  return <path d={d} fill="none" stroke="var(--cam-icon-cut-line)" strokeWidth={2} />;
}

function BlankStock() {
  return (
    <BodyEdges>
      <path d="M7 27 32 40 59 26 34 13Z" fill="var(--cam-icon-top)" />
      <path d="M7 27 32 40 32 50 7 37Z" fill="var(--cam-icon-left)" />
      <path d="M32 40 59 26 59 36 32 50Z" fill="var(--cam-icon-right)" />
    </BodyEdges>
  );
}

function SetupStock() {
  return (
    <>
      <g transform="translate(3 5) scale(0.88)"><BlankStock /></g>
      <g stroke="var(--cam-icon-cut)" strokeWidth={2.5}>
        <path d="M20 34V7M20 34 40 45M20 34 38 24" />
        <path d="m16 12 4-5 4 5m10 32 6 1-2-6m-6-15h6l-2 6" />
      </g>
      <circle cx="20" cy="34" r="2.5" fill="var(--cam-icon-cut-line)" />
    </>
  );
}

function NcSheet() {
  return (
    <>
      <BodyEdges>
        <path d="M12 6H38L50 18V56H12Z" fill="var(--cam-icon-top)" />
        <path d="M38 6V18H50" fill="var(--cam-icon-right)" />
      </BodyEdges>
      {/* NC is drawn as geometry, with no font or external artwork. */}
      <path d="M20 28V20L26 28V20M36 21C30 17 29 30 36 27" stroke="var(--cam-icon-cut)" strokeWidth={2.3} />
      <path d="M20 35H41M20 41H33M20 47H29" stroke="var(--cam-icon-line)" strokeWidth={2} />
    </>
  );
}

function PlayBadge() {
  return (
    <g>
      <circle cx="47" cy="46" r="14" fill="var(--cam-icon-top)" stroke="var(--cam-icon-line)" strokeWidth={1.8} />
      <path d="M43 38 54 46 43 54Z" fill="var(--cam-icon-cut)" />
    </g>
  );
}

function DrillBit() {
  // Ribbon, overflow menus and browser rows can all display drills at once.
  // Every instance owns its paint/clip IDs, including the library's drill.
  const instance = useId().replace(/:/g, '');
  const land = `cam-drill-land-${instance}`;
  const flute = `cam-drill-flute-${instance}`;
  const clip = `cam-drill-clip-${instance}`;
  return (
    <g data-cam-drill-bit="true">
      <defs>
        <linearGradient id={land} x1="0" y1="0" x2="14" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--cam-icon-tool-shade)" />
          <stop offset="0.28" stopColor="var(--cam-icon-tool)" />
          <stop offset="0.48" stopColor="var(--cam-icon-tool-glint)" />
          <stop offset="0.74" stopColor="var(--cam-icon-tool)" />
          <stop offset="1" stopColor="var(--cam-icon-tool-shade)" />
        </linearGradient>
        <linearGradient id={flute} x1="0" y1="0" x2="14" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--cam-icon-tool-shade)" />
          <stop offset="0.32" stopColor="var(--cam-icon-tool-flute)" />
          <stop offset="0.68" stopColor="var(--cam-icon-tool-shade)" />
          <stop offset="1" stopColor="var(--cam-icon-tool)" />
        </linearGradient>
        <clipPath id={clip}>
          <path d="M0 1Q7-1 14 1V36.8L7 41 0 36.8Z" />
        </clipPath>
      </defs>
      <path d="M0 1Q7-1 14 1V36.8L7 41 0 36.8Z" fill={`url(#${land})`} />
      <g clipPath={`url(#${clip})`}>
        <path d="M14 8C14 16 4 20 0 31V21C2 14 9 10 10 8Z" fill={`url(#${flute})`} />
        <path d="M14 28C14 35 10 37 7 41L0 36.8C2 29 10 26 14 21Z" fill={`url(#${flute})`} />
        <path d="M14 8C14 16 4 20 0 31V32.4C4 21.4 14 17.4 14 9.4Z" fill="var(--cam-icon-tool-glint)" opacity={0.75} />
        <path d="M14 28C14 35 10 37 7 41L8.4 40.2C12 37.5 14 35 14 30Z" fill="var(--cam-icon-tool-glint)" opacity={0.75} />
        <path d="M0 1H3V9.5L0 13Z" fill="var(--cam-icon-tool)" opacity={0.5} />
      </g>
      <path d="M0 36.8 7.5 34.7 7 41Z" fill="var(--cam-icon-tool)" />
      <path d="M7.5 34.7 14 36.8 7 41Z" fill="var(--cam-icon-tool-shade)" />
      <path d="M0 36.8 7.5 34.7 7 41" fill="none" stroke="var(--cam-icon-tool-edge)" strokeWidth={0.65} />
      <path d="M0 1Q7-1 14 1V36.8L7 41 0 36.8Z" fill="none" stroke="var(--cam-icon-tool-edge)" strokeWidth={1.1} />
    </g>
  );
}

export type CamIconId =
  | 'camManufacture'
  | 'camModel'
  | 'camNewSetup'
  | 'camSetup'
  | 'camTool'
  | 'camGeometry'
  | 'camHeights'
  | 'camPasses'
  | 'camLinking'
  | 'camFace'
  | 'camAdaptive'
  | 'camPocket'
  | 'camContour'
  | 'camChamfer'
  | 'camDrill'
  | 'camThread'
  | 'camToolLibrary'
  | 'camSimulate'
  | 'camNcSimulate'
  | 'camPostNc'
  | 'camPostEvents';

const CAM_GLYPHS: Record<CamIconId, ReactNode> = {
  camManufacture: (
    <>
      <BodyEdges>
        <path d="M6 7H51V18H19V48H57V58H6Z" fill="var(--cam-icon-left)" />
        <path d="M6 7H51V12H12V53H57V58H6Z" fill="var(--cam-icon-right)" />
        <path d="M31 18H45V25H31Z" fill="var(--cam-icon-tool-shade)" />
        <path d="M34 25H42V37H34Z" fill="var(--cam-icon-tool)" />
      </BodyEdges>
      <path d="m35 31 6-3m-6 8 6-3" stroke="var(--cam-icon-tool-flute)" strokeWidth={1.2} />
      <g transform="translate(21 24) scale(0.57)"><BlankStock /></g>
      <path d="m29 40 11 6 10-5" stroke="var(--cam-icon-cut)" strokeWidth={2.3} />
    </>
  ),
  camModel: (
    <BodyEdges>
      <path d="M9 19 33 6 56 19 32 33Z" fill="var(--cam-icon-top)" />
      <path d="M9 19 32 33 32 58 9 44Z" fill="var(--cam-icon-left)" />
      <path d="M32 33 56 19 56 44 32 58Z" fill="var(--cam-icon-right)" />
    </BodyEdges>
  ),
  camNewSetup: (
    <>
      <SetupStock />
      <circle cx="50" cy="13" r="10" fill="var(--cam-icon-top)" stroke="var(--cam-icon-line)" strokeWidth={1.8} />
      <path d="M45 13H55M50 8V18" stroke="var(--cam-icon-cut)" strokeWidth={2.5} />
    </>
  ),
  camSetup: <SetupStock />,
  camTool: (
    <>
      <path d="M21 7Q32 3 43 7V55Q32 59 21 55Z" fill="var(--cam-icon-tool)" stroke="var(--cam-icon-tool-edge)" strokeWidth={1.5} />
      <path d="M36 6Q40 6 43 7V55L36 57Z" fill="var(--cam-icon-tool-shade)" />
      <path d="M25 7H28V25H25Z" fill="var(--cam-icon-tool-glint)" />
      <path d="M21 27H43M21 7Q32 11 43 7" stroke="var(--cam-icon-tool-edge)" strokeWidth={1.5} />
      <path d="M29 28C30 39 23 44 21 51V55L25 56C25 44 35 39 34 28ZM41 28C43 40 33 47 32 57L37 56C37 48 43 43 43 38V28Z" fill="var(--cam-icon-tool-flute)" />
      <path d="M21 55Q32 59 43 55" stroke="var(--cam-icon-tool-edge)" strokeWidth={1.5} />
    </>
  ),
  camGeometry: (
    <>
      <BlankStock />
      <path d="M7 27 34 13 59 26 32 40Z" fill="var(--cam-icon-cut-fill)" stroke="var(--cam-icon-cut)" strokeWidth={2.5} />
      <g fill="var(--cam-icon-cut-line)">
        <circle cx="7" cy="27" r="2.7" /><circle cx="34" cy="13" r="2.7" />
        <circle cx="59" cy="26" r="2.7" /><circle cx="32" cy="40" r="2.7" />
      </g>
    </>
  ),
  camHeights: (
    <>
      <g transform="translate(0 19) scale(0.78)"><BlankStock /></g>
      <path d="M6 29 27 18 47 29 26 40Z" fill="var(--cam-icon-cut-fill)" fillOpacity={0.3} stroke="var(--cam-icon-cut)" strokeWidth={1.8} />
      <path d="M6 17 27 6 47 17 26 28Z" stroke="var(--cam-icon-cut)" strokeWidth={1.8} />
      <path d="M56 8V53m-4-40 4-5 4 5m-8 35 4 5 4-5" stroke="var(--cam-icon-cut-line)" strokeWidth={2.5} />
    </>
  ),
  camPasses: (
    <>
      <path d="M10 15H24V26H38V37H54V55H10Z" fill="var(--cam-icon-top)" stroke="var(--cam-icon-line)" strokeWidth={1.8} />
      <path d="M10 48H54V55H10Z" fill="var(--cam-icon-left)" />
      <path d="M6 15H24M6 26H38M6 37H54" stroke="var(--cam-icon-cut)" strokeWidth={2.8} />
      <path d="m20 11 4 4-4 4m14 3 4 4-4 4m16 3 4 4-4 4" stroke="var(--cam-icon-cut-line)" strokeWidth={2} />
    </>
  ),
  camLinking: (
    <>
      <g transform="translate(0 20) scale(0.9)"><BlankStock /></g>
      <path d="M6 6V24Q6 32 14 36L27 43 43 35Q55 29 55 17V6" stroke="var(--cam-icon-cut)" strokeWidth={2.8} />
      <path d="m2 16 4 5 4-5m41-4 4-6 4 6" stroke="var(--cam-icon-cut-line)" strokeWidth={2.5} />
      <path d="m14 36 13 7 16-8" stroke="var(--cam-icon-cut-line)" strokeWidth={2.8} />
    </>
  ),
  camFace: (
    <>
      <BlankStock />
      <path d="M10 27 34 15 55 26 32 38Z" fill="var(--cam-icon-cut-fill)" />
      <Flow d="M13 29 37 17Q41 15 43 18Q44 20 40 22L21 32Q17 34 21 36Q24 38 27 36L49 25" />
      <path d="m47 22 4 2-2 4" stroke="var(--cam-icon-cut-line)" strokeWidth={1.8} />
    </>
  ),
  camAdaptive: (
    <>
      <BodyEdges>
        <path d="M6 32 34 17 60 30 32 46Z" fill="var(--cam-icon-cut-fill)" />
        <path d="M6 32 32 46 32 54 6 40Z" fill="var(--cam-icon-left)" />
        <path d="M32 46 60 30 60 38 32 54Z" fill="var(--cam-icon-right)" />
      </BodyEdges>
      <Flow d="M12 32C12 27 19 27 24 30S33 39 40 36S48 26 54 30" />
      <Flow d="M12 38C17 33 20 35 25 38S34 43 41 40S50 32 55 35" />
      <BodyEdges>
        <path d="M24 18 36 11 48 17 36 24Z" fill="var(--cam-icon-top)" />
        <path d="M24 18 36 24 36 34 24 28Z" fill="var(--cam-icon-left)" />
        <path d="M36 24 48 17 48 27 36 34Z" fill="var(--cam-icon-right)" />
      </BodyEdges>
      <path d="m51 33 4 2-2 4" stroke="var(--cam-icon-cut-line)" strokeWidth={1.8} />
    </>
  ),
  camPocket: (
    <>
      <BlankStock />
      <BodyEdges>
        <path d="M15 27 34 18 51 27 32 37Z" fill="var(--cam-icon-inside)" />
        <path d="M15 27 15 32 32 41 32 37Z" fill="var(--cam-icon-cut-side)" />
        <path d="M15 32 34 23 51 32 32 41Z" fill="var(--cam-icon-cut-fill)" />
        <path d="M32 37 51 27 51 32 32 41Z" fill="var(--cam-icon-cut-side)" />
      </BodyEdges>
      <Flow d="m21 32 13-6 11 6-13 6Z" />
      <Flow d="m28 32 6-3 5 3-7 3Z" />
      <path d="M7 27 32 40 59 26" stroke="var(--cam-icon-line)" strokeWidth={1.75} />
    </>
  ),
  camContour: (
    <>
      <BlankStock />
      <path d="M3 39 32 55 62 39V33" stroke="var(--cam-icon-cut)" strokeWidth={2.8} />
      <path d="M3 39V26L33 10 62 25V33" stroke="var(--cam-icon-cut)" strokeWidth={2} strokeDasharray="2 4" />
      <path d="m58 36 4-4 1 5" stroke="var(--cam-icon-cut)" strokeWidth={2} />
    </>
  ),
  camChamfer: (
    <>
      <BodyEdges>
        <path d="M7 30 32 43 59 29 59 37 32 51 7 38Z" fill="var(--cam-icon-left)" />
        <path d="M32 43 59 29 59 37 32 51Z" fill="var(--cam-icon-right)" />
        <path d="M7 30 7 27 34 13 59 26 59 29 32 43Z" fill="var(--cam-icon-cut-fill)" />
        <path d="M12 27 34 16 54 26 32 38Z" fill="var(--cam-icon-top)" />
      </BodyEdges>
      <path d="m9 29 23 12 25-13" stroke="var(--cam-icon-cut)" strokeWidth={2} />
    </>
  ),
  camDrill: (
    <>
      <BodyEdges>
        <path d="M11 49 33 38 55 49 32 60Z" fill="var(--cam-icon-top)" />
        <path d="M11 49 32 60 32 63 11 53Z" fill="var(--cam-icon-left)" />
        <path d="M32 60 55 49 55 53 32 63Z" fill="var(--cam-icon-right)" />
        <ellipse cx="32" cy="49" rx="6.5" ry="3" fill="var(--cam-icon-inside)" stroke="var(--cam-icon-cut)" strokeWidth={2} />
      </BodyEdges>
      <g transform="translate(25.7 3.9) scale(0.9)"><DrillBit /></g>
      <path d="M32 43V45" stroke="var(--cam-icon-cut)" strokeWidth={1.7} />
    </>
  ),
  camThread: (
    <>
      <path d="M17 18H47V45C47 53 17 53 17 45Z" fill="var(--cam-icon-right)" stroke="var(--cam-icon-line)" strokeWidth={1.8} />
      <path d="M17 18H32V51C22 51 17 48 17 45Z" fill="var(--cam-icon-left)" />
      <ellipse cx="32" cy="18" rx="15" ry="6" fill="var(--cam-icon-top)" stroke="var(--cam-icon-line)" strokeWidth={1.8} />
      <path d="M18 25C25 30 37 27 46 22M18 33C25 38 37 35 46 30M18 41C25 46 37 43 46 38" stroke="var(--cam-icon-cut)" strokeWidth={3.6} />
      <path d="M46 22C49 24 48 27 46 30M46 30C49 32 48 35 46 38" stroke="var(--cam-icon-cut-side)" strokeWidth={2.5} />
    </>
  ),
  camToolLibrary: (
    <>
      <g stroke="var(--cam-icon-tool-edge)" strokeWidth={1.6}>
        <path d="M8 11H56V18H8Z" fill="var(--cam-icon-right)" />
        <path d="M10 9H54V13H10Z" fill="var(--cam-icon-top)" />
        <path d="M10 16H22V23H10Z" fill="var(--cam-icon-tool-shade)" />
        <path d="M26 16H38V23H26Z" fill="var(--cam-icon-tool-shade)" />
        <path d="M42 16H54V23H42Z" fill="var(--cam-icon-tool-shade)" />
        <path d="M12 23H20V46H12Z" fill="var(--cam-icon-tool)" />
        <path d="M46 23H50V36L55 40 48 48 41 40 46 36Z" fill="var(--cam-icon-tool)" />
      </g>
      <g transform="translate(27.2 23) scale(0.686)"><DrillBit /></g>
      <path d="M13 33 19 30M13 39 19 36M13 45 19 42" stroke="var(--cam-icon-tool-flute)" strokeWidth={1.25} />
      <path d="M42 40 48 46 54 40Z" fill="var(--cam-icon-tool-shade)" stroke="var(--cam-icon-tool-flute)" strokeWidth={1.25} />
    </>
  ),
  camSimulate: (
    <>
      <BlankStock />
      <path d="M12 27 34 16 53 26 32 37Z" fill="var(--cam-icon-cut-fill)" />
      <Flow d="m16 27 18-9 15 8-17 9-10-5 12-6 7 3" />
      <PlayBadge />
    </>
  ),
  camNcSimulate: (
    <>
      <NcSheet />
      <PlayBadge />
    </>
  ),
  camPostNc: (
    <>
      <NcSheet />
      <path d="M34 44H48V35L62 48 48 61V52H34Z" fill="var(--cam-icon-cut-fill)" stroke="var(--cam-icon-cut)" strokeWidth={2} />
    </>
  ),
  camPostEvents: (
    <>
      <BodyEdges>
        <path d="M10 7H54V57H10Z" fill="var(--cam-icon-top)" />
      </BodyEdges>
      <path d="M21 19V45" stroke="var(--cam-icon-cut)" strokeWidth={2} />
      <path d="M30 19H45M30 32H45M30 45H41" stroke="var(--cam-icon-line)" strokeWidth={2.5} />
      <circle cx="21" cy="19" r="3.2" fill="var(--cam-icon-cut)" />
      <circle cx="21" cy="32" r="3.2" fill="var(--cam-icon-cut)" />
      <circle cx="21" cy="45" r="3.2" fill="var(--cam-icon-cut)" />
    </>
  ),
};

/** Stable inventory for the shared icon registry and provenance audit. */
export const CAM_ICON_IDS: readonly CamIconId[] = Object.freeze(Object.keys(CAM_GLYPHS) as CamIconId[]);

/** One operation identity across browser rows, edit headers and tool pickers. */
export const CAM_OPERATION_ICON: Readonly<Record<CamOperationDto['kind'], CamIconId>> = {
  face: 'camFace',
  adaptive3d: 'camAdaptive',
  contour2d: 'camContour',
  pocket2d: 'camPocket',
  chamfer2d: 'camChamfer',
  drill: 'camDrill',
  thread: 'camThread',
};

export function isCamIcon(id: string | undefined): id is CamIconId {
  return id !== undefined && Object.prototype.hasOwnProperty.call(CAM_GLYPHS, id);
}

export function CamToolIcon({ id, size = 16, className }: { id: CamIconId; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['cam-tool-icon', className].filter(Boolean).join(' ')}
      data-cam-icon={id}
      aria-hidden="true"
      focusable="false"
    >
      {CAM_GLYPHS[id]}
    </svg>
  );
}
