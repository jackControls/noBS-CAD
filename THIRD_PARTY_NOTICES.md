# Third-party notices

noBS CAD is distributed under the license in [`LICENSE`](LICENSE). It also
uses third-party components that remain under their own licenses. The
lockfiles are the authoritative inventory of exact dependency versions; this
document calls out the primary runtime components and preserves notices that
must accompany redistributed builds.

## Geometry kernels

- **Open CASCADE Technology (OCCT) 7.9.x** is used by native builds under the
  GNU Lesser General Public License 2.1 with the Open CASCADE exception.
  Native bundle generation copies `LICENSE_LGPL_21.txt` and
  `OCCT_LGPL_EXCEPTION.txt` from the selected OCCT SDK into the application
  resources. Source and license information:
  <https://github.com/Open-Cascade-SAS/OCCT>.
- **OpenCascade.js `2.0.0-beta.b5ff984`** provides the browser development
  kernel under `LGPL-2.1-only`. Its complete license text is distributed in
  the npm package and is included in generated application resources. Source:
  <https://github.com/donalffons/opencascade.js>.

Native noBS CAD builds make use of and are based on facilities provided by
the Open CASCADE Technology software.

## Application runtime

| Component | Use | License |
|---|---|---|
| React and React DOM | User interface | MIT |
| Bevy | Native viewport | MIT or Apache-2.0 |
| Zustand | Application state | MIT |
| fflate | Local `.nbcad` ZIP files | MIT |
| Earcut | Transient closed-profile triangulation | ISC |
| zip (Rust) | 3MF package writer | MIT or Apache-2.0 |
| Lucide | General-purpose interface icons | ISC |
| Tauri and the dialog plugin | Native application shell | MIT or Apache-2.0 |

Build and test dependencies are listed in `package-lock.json`, `Cargo.lock`,
`src-tauri/Cargo.lock`, and `mcp-server/Cargo.lock`. Their package archives
contain the corresponding license texts.

## Lucide ISC notice

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## Earcut ISC notice

Copyright (c) 2024, Mapbox

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## MIT notices

The following copyright notices apply to their respective MIT-licensed
components:

- React and React DOM: Copyright (c) Facebook, Inc. and its affiliates.
- Zustand: Copyright (c) 2019 Paul Henschel.
- fflate: Copyright (c) 2023 Arjun Barrett.
- Tauri: Copyright (c) 2017-present Tauri Apps Contributors.

For each component above:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Optional 3D mouse bridge

The browser development build can load 3DconnexionJS from 3Dconnexion after an
explicit user action. That bridge is not bundled in this repository.
3Dconnexion and SpaceMouse are trademarks or registered trademarks of
3Dconnexion. The attribution and compatibility details are in
[`README.md`](README.md#3d-mouse-compatibility).
