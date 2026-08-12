# Third-Party Notices

## gkjohnson/urdf-loaders

- Repository: https://github.com/gkjohnson/urdf-loaders
- JavaScript version: `0.13.1`
- License: Apache License 2.0
- Copyright: 2020 California Institute of Technology
Runtime installs use the official `urdf-loader@0.13.1` npm package. The upstream
Apache-2.0 license is retained under `licenses/`; no upstream source tree or examples are vendored.

## Three.js

- Repository: https://github.com/mrdoob/three.js
- Version: resolved by `package-lock.json`
- License: MIT

Used for rendering, `OrbitControls`, raycasting, STL loading, helpers and
interactive kinematics.

## three-mesh-bvh

- Repository: https://github.com/gkjohnson/three-mesh-bvh
- Version: resolved by `package-lock.json`
- License: MIT

Used for triangle-mesh spatial intersection queries during joint collision
scans.

## Open CASCADE Technology (OCCT)

- Project: https://dev.opencascade.org/
- Runtime version: 7.9.3
- License: GNU LGPL 2.1 with the Open CASCADE exception
- Official license notice: https://dev.opencascade.org/resources/licensing

OCCT supplies STEP/AP242 translation, XCAF assembly data, exact B-Rep
topology, tessellation, and geometric mass properties. Binary redistribution
must include the complete LGPL 2.1 text and OCCT exception, a prominent
notice that OCCT is used, and the mechanisms/rights required by LGPL section
6. This repository distributes source and dependency instructions, not an OCCT binary bundle.

## CadQuery/OCP Python bindings (headless wheel)

- Package: `cadquery-ocp-novtk==7.9.3.1.1`
- Project: https://github.com/CadQuery/OCP
- Installed wrapper license: Apache License 2.0 (`cadquery_ocp/LICENSE`)
- Windows wheel: https://pypi.org/project/cadquery-ocp-novtk/7.9.3.1.1/

The project calls the generated OCP bindings directly; it does not use or
copy CadQuery's high-level modeling API. The wheel contains/loads OCCT, whose
separate LGPL 2.1 + exception obligations remain applicable.

The selected wheel intentionally omits VTK. It is exercised by the CPython 3.13
test suite, including generated AP242 XCAF hierarchy import, exact B-Rep
interrogation, meshing and mass properties.
The converter does not call any VTK API.

## Other npm dependencies

The exact graph is recorded in `package-lock.json`. Direct dependencies
`csv-parse`, `fast-xml-parser`, `yaml`, Vite and Vitest are used for parsing,
validation, serving and tests. A future binary Windows package will include a generated SBOM.
