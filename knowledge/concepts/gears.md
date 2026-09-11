---
type: Concept
title: Gear identification and compatible pairs
description: Spur gear module, diametral pitch, outside diameter, pressure angle, tooth count, backlash and shaft mounting.
status: stable
updated: 2026-09-11
---

# Gear identification and compatible pairs

Use this when replacing an unknown gear, changing a ratio, or designing a printed
gear pair through MCP. Record measurements separately from assumed specifications.

## Identify before modeling

Count the teeth `z` as an integer; measure outside diameter, bore, face width,
hub, key/flat and shaft spacing. Record units, measurement uncertainty, wear and
whether the gear is external/internal, spur/helical or another family. For an odd
tooth count, a caliper span across teeth is not automatically the true outside
diameter. A damaged or chamfered tooth tip is also a poor diameter reference.

For a **standard, unshifted, full-depth external spur gear**, with addendum equal
to one module:

- `d_mm = m_mm × z` is the reference pitch diameter.
- `OD_mm = m_mm × (z + 2)`, so `m_mm = OD_mm / (z + 2)`.
- In inch gearing, `DP = z / d_in = (z + 2) / OD_in`.
- Convert with `m_mm = 25.4 / DP`; do not put a millimetre OD into the inch DP formula.

These OD shortcuts do not identify profile-shifted, stub-tooth, helical, internal,
bevel, or modified-tip gears. Treat a near-standard result as a candidate to
verify against the mating gear or manufacturer drawing, not a complete identity.
Pressure angle and tooth form cannot be established by OD and tooth count alone.
See [KHK's dimension reference](https://khkgears.net/gear-knowledge/gear-technical-reference/calculation-gear-dimensions/)
and [SDP/SI's metric gear reference](https://sdp-si.com/D815/D815-Technical-Section.pdf).

## Design the pair

Mating standard spur gears need the **same module (or DP) and reference pressure
angle**, compatible tooth forms, and suitable installed spacing. Also check face
overlap, backlash, tip/root clearance, contact ratio, runout and shaft alignment.
For an unshifted external pair, `a = m(z1 + z2)/2` is the nominal centre distance;
the driven/driver tooth-count ratio gives the speed reduction. Helical gears
require the correct normal/transverse convention, helix angle and hand as well.
[KHK selection guidance](https://khkgears.net/pdf/2023/spur-gears.pdf).

Keeping a reference pitch diameter while changing tooth count changes module:
`m_new = d / z_new`. It therefore requires redesigning the mating pair, not a
drop-in replacement. Example: a 40 mm pitch diameter with 20 teeth is module 2;
changing to 25 teeth at that diameter gives module 1.6. An existing module-2 mate
is incompatible. At fixed centre distance and module, the tooth-count sum is
fixed; choose integer counts together and recheck the resulting ratio.

Small pinions require an undercut and root-strength check for their actual
pressure angle, addendum and manufacturing method. Profile shift can help, but
also changes tip thickness, contact and working centre-distance requirements.
Do not apply a universal minimum tooth count or add arbitrary clearance by
scaling the entire gear. Preserve bore fit and hub/root stock, check keyways or
set-screw holes against the tooth root, and qualify backlash with the actual
material and print orientation. [KHK tooth-form reference](https://khkgears.net/new/gear_knowledge/gear_technical_reference/involute_gear_profile.html).

## MCP design record

Before construction, record known/assumed `z`, module or DP, pressure angle,
profile shift, centre distance, ratio, face width, backlash convention and shaft
retention. Use the existing operation catalog and editable dimensions. Recheck
both gears and their mounts after an edit, then test motion, interference,
save/reopen and a small printed fit sample. A solved gear relation constrains
motion; it does not establish correct tooth contact, efficiency or load capacity.
See [additive workholding](additive-workholding.md) for mounting and qualification.

## Learning reference provenance

The user supplied Antalz's [Gears part 1/7](https://youtu.be/xEFaYdnqIBQ), titled
“How to Design and 3D print basic spur gears, and how to attach them to shafts”.
Its page and auto-generated English transcript were reviewed on 2026-09-11.
Useful mounting sections cover [set-screw creep and runout at 18:46](https://www.youtube.com/watch?v=xEFaYdnqIBQ&t=1126s),
[washer pockets and opposed screws at 19:53](https://www.youtube.com/watch?v=xEFaYdnqIBQ&t=1193s),
and [a cross-bolt through the shaft at 23:42](https://www.youtube.com/watch?v=xEFaYdnqIBQ&t=1422s).
An embedded nut concentrates clamp load in plastic; relaxation can loosen a
radial set screw, and one-sided clamping can affect runout. A split-clamp hub or
positive cross-pin/cross-bolt is an alternative to evaluate, with its own wall,
fastener, access, drilling and shaft-strength checks. None is a universal fix or
a torque rating. The video's 8.2 mm hole for an 8 mm shaft is explicitly a
printer-specific compensation, not a general allowance.

The creator links [Gear Parameters and Design Tradeoffs (Gears pt 2/7)](https://www.youtube.com/watch?v=ogCGq1aSM80).
Its page and auto-generated English transcript were also reviewed on 2026-09-11.
It develops ratio/centre-distance choices, backlash, pressure angle, shaft
deflection, module, undercut and runout; the OD discussion starts at
[31:51](https://www.youtube.com/watch?v=ogCGq1aSM80&t=1911s).
Treat its worked examples as design tradeoffs, not universal material strengths
or fit allowances. The formula limits above are checked against the engineering
references, rather than extending the video's basic spur example to other forms.
