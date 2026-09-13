---
type: Concept
title: Additive workholding and captured mechanisms
description: Printed vise and fixture design, captured guides, assembly access, hardware envelopes, D-flat screws, grip clearance and physical qualification.
status: stable
updated: 2026-09-11
---

# Additive workholding and captured mechanisms

Use this when designing a printed vise, clamp, sliding fixture or retained drive.
Start by identifying the operator, workpiece, mounting surface, intended forces,
travel, material and print process. Resolve these inputs before changing geometry.

## Load path and capture

- Trace closing force, opening force and off-axis moments through the workpiece,
  jaws, guides, screw, nut, housing and mount. A motion constraint does not supply
  a physical bearing, retention feature or anti-lift restraint.
- Decide which degrees of freedom each guide must restrain. If a jaw must remain
  captured during lifting or off-centre loading, open rails that merely align it
  are insufficient. Give it a deliberate captured section or keeper, adequate
  engagement through its full travel, and an accessible assembly/removal path.
- Separate bearing faces from running clearance. Name radial versus diametral
  gaps and per-side versus total gaps explicitly. Avoid two guides fighting each
  other because tolerance or print distortion was omitted.
- Check accessible pinch regions through the complete motion: jaws, guide ends,
  exposed screws, collars, handles and the mounting board. Zero solid overlap
  is not finger clearance. Check the hand's intended grip as well as the handle's
  swept geometry; a longer lever also changes the torque users can apply.

## Assembly and hardware

Plan insertion order before closing pockets. Model the approach path for the
screw head, nut, washer and installation tool; check how a nut is held while
tightening and how a wear part is removed. Check assembly at intermediate
positions, not only at the final pose. Use supplier dimensions for purchased
hardware. Label simplified clearance envelopes as such; they do not represent
fastener threads, strength, or a qualified supplier substitution.

## D flats, roots and printing

A print-bed flat on a threaded screw and a torque-transfer flat or key on a
shaft serve different functions. Specify each independently: a bed flat affects
printability and thread engagement; a mating shaft flat must transmit torque and
retain the hub with suitable contact and stock.

A through-axis D flat removes roughly half a circular shaft before other cuts;
it changes torsion, bending, eccentric contact and available thread engagement.
Do not rate it using an intact circular-shaft formula. Review the narrowest neck,
thread root and abrupt handle junction independently. Use a load-spreading hub
or blend where needed, then selectively soften touched edges without eroding
bearing shoulders, clamp faces, guide fits or the thread.

Name a custom rounded trapezoidal thread as custom, not as an ISO metric or
Unified fastener. Record nominal diameter, pitch, radial depth, corner radius,
and radial/axial clearances for both mating parts. Matching nominal diameter and
pitch alone does not establish a compatible profile. The native custom profile
uses shared male/female parameters and applies clearance to the female cavity;
its editable geometry still requires printed fit and load-path qualification.

Print orientation affects layer strength, bridging and fit. A full round knob
may conflict with a shaft intended to rest on a through-axis flat; resolve
one-piece versus separate-handle assembly before styling the grip. Bed-facing
roundovers can introduce difficult overhangs; chamfers can provide lead-ins while
retaining a useful bearing face. Qualify thin features and mating allowances
with the actual nozzle, layer height and material rather than a universal gap.
[Prusa design guidance](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135).

Fit the grip to the task and the intended hands, minimize concentrated edge
pressure, and leave room for a neutral working posture. Adult hand-tool size
guidelines are not children's anthropometric data or automatic dimensions for a
small turning knob. [NIOSH hand-tool guidance](https://www.cdc.gov/niosh/docs/2004-164/pdfs/2004-164.pdf).

## Evidence before claims

In MCP, use ordinary editable features and returned geometry references. Validate
dimension edits, assembly access, full travel, interference, retained components,
save/reopen and exported print orientation. Then print representative thread,
guide and grip/root samples; measure fit and turning effort, and inspect creep,
wear and retention under the intended use. A manifold mesh, a material label,
an ideal joint solution or an illustrative force calculation is not a load rating.

The [D-screw vise record](../../docs/d-screw-vise.md) is a worked development
example with explicit assumptions and unresolved qualification, not a universal
fixture standard. Do not copy its dimensions without reviewing the new use.
See also [gear pairs](gears.md) and [export and print](export-print.md).
