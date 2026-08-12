# Product and open-source research — 2026-08

## Method

Primary documentation and original papers are preferred. No code was copied from the sources below. Community reports are treated as problem evidence, never as geometric truth. Douyin and Xiaohongshu content could not be accessed in a stable, citable form; no post or quotation from those platforms is claimed.

## Source-to-decision register

| Source | Date/version | Problem solved | Adopt | Do not copy | Confidence / license |
|---|---|---|---|---|---|
| [Onshape Mates](https://cad.onshape.com/help/Content/Assembly/mates.htm), PTC | current 2026 help | Geometry-inferred local connectors, flip/reorient, animate, isolate | Face/edge hover candidates; explicit connector; one-click direction flip; isolate/dim and animate before acceptance | Onshape’s constraint solver and cloud document model | High; documentation, proprietary product |
| [Onshape Mate Connector](https://cad.onshape.com/help/Content/Assembly/assembly_mate_connector.htm), PTC | current 2026 help | Reusable part-local interface frames | Store servo functional ports in definition-local coordinates and transform each occurrence | Treating a suggested connector as certain | High; documentation |
| [SOLIDWORKS Mate References](https://help.solidworks.com/2025/English/SolidWorks/sldworks/c_Mate_References_Overview_SWassy.htm), Dassault Systèmes | 2025 | Named reusable primary/secondary/tertiary mating entities on parts/subassemblies | Template ports may include multiple ordered evidence entities, not only an axis | Dependence on SOLIDWORKS metadata | High; documentation |
| Autodesk Inventor iMate and Fusion Joint help, Autodesk | current product docs | Reuse interface intent and separate joint type/origin/orientation | Keep `axisLine`, `interfaceCenter`, housing/output contacts distinct | Assuming STEP preserves proprietary iMate metadata | Medium-high; documentation |
| [MoveIt Setup Assistant](https://moveit.picknik.ai/main/doc/examples/setup_assistant/setup_assistant_tutorial.html), MoveIt | Rolling, accessed 2026-08 | Guided staged configuration and generated artifacts | Six explicit stages with a final review; retain editable project data | Requiring ROS before URDF exists | High; BSD-licensed project docs/code |
| [Isaac Sim URDF Importer documentation](https://docs.isaacsim.omniverse.nvidia.com/latest/importer_exporter/ext_isaacsim_asset_importer_urdf.html), NVIDIA | current docs | Import options, visual validation, physics-sensitive fields | Separate visual preview from engineering readiness | Claiming simulator import equals mechanical correctness | High; proprietary product docs |
| [Webots documentation](https://www.cyberbotics.com/doc/guide/starting-webots), Cyberbotics | R2025a/current | Beginner entry points and explicit conversion limitations | Double-click start, welcome/example path, clearly labelled incomplete exports | Squashing arbitrary structures silently | High; Apache-2.0 software |
| [Blender armature parenting](https://docs.blender.org/manual/en/latest/animation/armatures/bones/editing/parenting.html), Blender Foundation | current manual | Visual parent/child chain editing and keep-offset semantics | Visual downstream highlighting; preserve q=0 transform | Using mesh-only topology as exact CAD evidence | High; GPL application/documentation terms apply separately |
| AutoMate, Lambourne et al. | SIGGRAPH Asia 2021 | Learned mate prediction from CAD assemblies | Candidate ranking concepts and explicit uncertainty | Training-dependent “fully automatic” claim; model not integrated | High; paper/research code terms must be checked before reuse |
| JoinABLe, Willis et al. | CVPR 2022 | B-Rep joint-axis prediction for part pairs | Axis/interaction feature ideas and benchmark vocabulary | Applying pairwise learned output directly to full robot topology | High; paper; code/data licenses separate |
| Mates2Motion | research publication | Recovering motion from assembly mates | Joint-type/motion validation concepts | Assuming neutral STEP contains native mates | Medium-high; paper |
| [OCCT STEP/XCAF documentation](https://dev.opencascade.org/doc/overview/html/occt_user_guides__step.html), Open Cascade | 7.9.x | Definitions, references, occurrence locations, units, AP242 | Exact XCAF hierarchy; B-Rep queries; metres at domain boundary | Inferring physical attachment from names alone | High; LGPL-2.1 with OCCT exception |
| W3C [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | W3C Recommendation | Keyboard, focus, non-colour status, target size | Visible text + colour, keyboard actions, accessible status regions | Treating automated checks as complete accessibility proof | High; W3C document license |
| [Playwright test documentation](https://playwright.dev/docs/test-intro), Microsoft | current | Repeatable browser and screenshot checks | E2E console-error gate, viewports, screenshots | Snapshot-only tests without functional assertions | High; Apache-2.0 software |
| [Python on Windows](https://docs.python.org/3/using/windows.html), Python Software Foundation | 3.14 docs accessed 2026-08 | Isolated/embedded runtimes | Long-term packaging may ship a private runtime; first RC uses a transparent launcher and records prerequisites | Running pip updates inside a supposedly immutable embedded runtime | High; PSF license |
| [PyInstaller manual](https://pyinstaller.org/en/stable/), PyInstaller team | 6.x | Freeze Python apps | Evaluate for a later signed backend bundle, especially OCCT collection hooks | Promise a working one-file executable before clean-machine testing | High; GPL-2.0 with exception for built apps |
| [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), Tauri | v2 | Desktop shell + external binary | Possible future signed shell after workflow stabilizes | Framework migration in this release candidate | High; MIT/Apache-2.0 project |
| [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security), OpenJS/Electron | current | Desktop web security boundaries | If ever adopted, keep context isolation and no remote code | Electron now: size and rewrite cost are unjustified | High; MIT project |
| [GitHub healthy contributions](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions), GitHub | accessed 2026-08 | Community health files | Prepare CONTRIBUTING, CoC, SECURITY, SUPPORT, templates | Publishing before rights/license approval | High; documentation |
| [GitHub repository security quickstart](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository), GitHub | accessed 2026-08 | Dependabot, CodeQL, secret scanning, policy | Local configs plus owner checklist; public secret scanning after upload | Claiming cloud checks ran locally | High; documentation |

## Engineering decisions

1. **Choose progressive restructuring.** Existing exact geometry, contact graph, templates, transactions and validation remain authoritative. The UI becomes a six-step shell over one RobotModel.
2. **Use functional connectors, not naked vectors.** A connector has a local axis, interface centre, selected geometry and housing/output evidence. This mirrors mature CAD connector patterns and prevents treating a cylinder surface origin as the joint centre.
3. **Recommend, preview, then commit.** Candidate values remain explainable; the user sees a small motion and can flip/select/adjust. Uncertainty is never called a probability of correctness.
4. **Dual export is adopted.** Preview output may use explicitly labelled visual-only placeholders. Engineering output requires verified limits, mass/inertia and hardware values. Invalid geometry/tree/high-risk ambiguity blocks both.
5. **Packaging choice: A for this RC.** A local web + Python service with a double-click launcher preserves the code and is easiest to debug. It can automatically create/check a private environment and open the browser. It still requires a tested Node/Python runtime in this source candidate, so it must not be advertised as an installer. Option B (prebuilt frontend + bundled Python/OCP) is the next packaging experiment. Option C is deferred.
6. **Open-source preparation is reversible.** Prepare health/security/CI files and a license comparison, but do not add a final project license or publish until ownership and model rights are signed off.

## Packaging comparison

| Criterion | A: local web + launcher | B: built frontend + frozen Python | C: Tauri/Electron + sidecar |
|---|---|---|---|
| Rewrite | Minimal | Low-medium | Medium-high |
| Typical size | Development runtime dependent | Large due to OCCT/Python | Largest with Electron; lower with Tauri but more integration |
| OCCT difficulty | Already working | High: native DLL discovery and wheel collection | Same as B plus sidecar lifecycle |
| Debug/update | Best | Medium | Most complex |
| User prerequisites | Present in source RC | None if bundled correctly | None if bundled correctly |
| CI risk | Low | Medium-high | High |
| Decision | Adopt now, label honestly | Next milestone | Defer |

## Limits of the research

- STEP usually carries product structure and geometry, not the originating CAD system’s full proprietary mate semantics; automatic motion recovery remains a candidate-generation problem.
- Learned systems cited above need trained models/data and do not justify a “100% automatic” claim here.
- Community discussions and video platforms are useful for discovering recurring pain points, but were not used as scientific evidence or copied content.
