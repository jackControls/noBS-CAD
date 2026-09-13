---
type: Concept
title: Small wind rotors and low-speed generators
description: Rotor power, startup torque, brushed motor selection, speed-increasing gears and measured electrical loads.
status: stable
updated: 2026-09-11
---

# Small wind rotors and low-speed generators

Use this before sizing a science turbine, choosing a motor as a generator, or
changing its gear ratio. Record the intended airflow, rotor size, load and
measurement method before assigning an output target.

## Match speed, torque and load

For a vertical rotor, swept area is `A = diameter * bucket_height` in square
metres. Available wind power is `P_air = 0.5 * rho * A * wind_speed^3`;
`P_shaft = C_p * P_air` requires a measured or explicitly assumed power
coefficient. With radius `R`, tip-speed ratio `lambda = omega * R / wind_speed`
gives `rpm = 60 * lambda * wind_speed / (2 * pi * R)`. Running efficiency does
not establish static starting torque. A two-stage Savonius experiment found
improved startup with staggered stages, but its geometry, bearings, flow and
load remain part of that result; do not transfer its starting wind speed or
power coefficient as a rating for another rotor.
[Experimental rotor study](https://myresearchspace.uws.ac.uk/ws/portalfiles/portal/58300379/2022_12_16_Shamsuddin_et_al_Experimental_final.pdf).

For a brushed permanent-magnet motor used as a generator, start with
`E = k_g * rpm`, `V_load = E - I * R_motor` and `P_electric = V_load * I`.
Use compatible units and allow for brush voltage drop and mechanical losses.
A high open-circuit voltage supplies no useful load power by itself. Select a
documented winding with enough voltage per RPM at the available speed; a
motor's nominal voltage, stall torque or advertised wattage alone is not a
generator specification. Motoring efficiency and power are not automatically
generator-mode values. [maxon generator guidance](https://support.maxongroup.com/hc/en-us/articles/360004496254-maxon-Motors-as-Generators).

For speed increase `G = generator_rpm / rotor_rpm`, the rotor must supply
approximately `G * generator_torque / drivetrain_efficiency`, plus losses not
included in that efficiency. At startup, compare worst-angle rotor torque with
the complete drivetrain's measured breakaway torque. A larger ratio multiplies
generator drag as well as speed; avoid an uncharacterized high-ratio gearbox.
Check [compatible gear pairs](gears.md) and [bearing stacks](bearing-stacks.md).

## Specify and measure the actual specimen

Keep motor body diameter, case length, projecting shaft length, usable straight
shaft engagement, terminal envelope and mounting datums separate. A total
length including the shaft cannot determine its projection. Use replaceable
mounts and explicit fit parameters when a supplier gives only an approximate
envelope; do not silently invent a longer shaft or enlarge its diameter.
Independent rotor bearings do not establish the motor's permissible gear side
load. The [turbine design record](../../docs/vertical-axis-turbine.md) documents
one candidate and its remaining physical checks.

Begin with open-circuit speed/voltage and unloaded startup at several rotor
angles. Then measure known resistors from lighter to heavier electrical loading,
recording simultaneous RPM, terminal voltage and current. Confirm `V / I`
against the actual load and `V * I` against reported power; distinguish motor
curves from generator measurements. Check rotor slowing, bearing drag, hub slip
and heating. A failed LED demonstration can be insufficient voltage rather
than a failed generator; use a meter before increasing the ratio.
[Vernier generator test guidance](https://www.vernier.com/til/3183).

Keep fan setting, measured airspeed and its measurement location in the test
record. A nearby fan produces nonuniform flow; a classroom observation is not
a calibrated power curve. Qualify the printed geometry and process separately
using the [export and print guidance](export-print.md).
