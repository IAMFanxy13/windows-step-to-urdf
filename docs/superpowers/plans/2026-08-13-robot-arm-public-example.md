# Robot-Arm Public Example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat two-servo public fixture into a raised, bent desktop robot arm with a pedestal, shoulder, upper arm, elbow, forearm, and two-finger gripper.

**Architecture:** Keep the pinned SG51R definition and the existing XCAF assembly pipeline. Replace only repository-generated rigid structures and occurrence transforms, preserving one shared servo definition, two output axes, two candidate revolute joints, and three intended links. Regenerate the AP242 fixture, exercise it through the real importer/browser, and capture the real application for the README.

**Tech Stack:** Python 3.13, OCP/Open CASCADE 7.9, STEP AP242/XCAF, JavaScript ESM, Three.js, Vite, Vitest, Playwright.

## Global Constraints

- Keep two SG51R occurrences sourced from the existing pinned MIT-licensed STEP.
- Keep exactly two revolute joints and three intended rigid links.
- Keep the imported AP242 pose as URDF `q=0`.
- Both servo output axes must be parallel, right-handed, unit length, and centred on the generated horns.
- Never add proprietary or otherwise private CAD to the public repository.
- Complex geometry fallbacks must remain explicitly marked for review.
- The README preview must be a real application screenshot at 1440 x 810.

---

### Task 1: Lock the Raised Robot-Arm Geometry Contract

**Files:**
- Modify: `test/test_step_import.py`
- Test: `test/test_step_import.py`

**Interfaces:**
- Consumes: `write_two_joint_servo_arm(target: Path, source_unit: str) -> Path`.
- Produces: regression assertions on occurrence transforms, definition bounds, gripper geometry, repeated servo identity, horn axes, and joint candidates.

- [ ] **Step 1: Write the failing geometry assertions**

Add assertions to `test_two_joint_example_produces_an_automatic_movable_first_draft` that require:

```python
by_name = {item["name"]: item for item in parts}
servo_a_origin = [by_name["servo_a"]["sourceTransformMeters"][i] for i in (3, 7, 11)]
servo_b_origin = [by_name["servo_b"]["sourceTransformMeters"][i] for i in (3, 7, 11)]
self.assertGreater(servo_a_origin[2], 0.09)
self.assertGreater(servo_b_origin[0], servo_a_origin[0] + 0.07)
self.assertGreater(servo_b_origin[2], servo_a_origin[2] + 0.06)
self.assertEqual(
    [round(by_name["servo_a"]["sourceTransformMeters"][i], 8) for i in (2, 6, 10)],
    [0.0, 1.0, 0.0],
)
forearm_bounds = definitions["forearm_structure"]["boundsMeters"]
self.assertGreater(forearm_bounds["max"][0] - forearm_bounds["min"][0], 0.12)
self.assertGreater(forearm_bounds["max"][2] - forearm_bounds["min"][2], 0.035)
```

Also require at least two separated terminal finger solids through definition face/topology growth and retain two `0.008 m` horn cylinders with world axes parallel to the servo axes.

- [ ] **Step 2: Run the targeted Python test and verify RED**

Run:

```powershell
python -m unittest discover -s test -p "test_step_import.py"
```

Expected: FAIL because Servo A is currently at `z=0.055`, Servo B is horizontal at `z=0.055`, and the occurrence rotations keep output axes on world Z.

- [ ] **Step 3: Commit only after the implementation in Task 2 turns these assertions green**

The failing test stays uncommitted until its corresponding generated geometry passes.

---

### Task 2: Generate the Raised Two-Servo Arm

**Files:**
- Modify: `test/fixtures/generate_step_fixtures.py`
- Modify: `public/examples/two_joint_servo_arm_ap242.step`
- Test: `test/test_step_import.py`

**Interfaces:**
- Consumes: `_compound`, `_box`, `_horn`, `_load_pinned_sg51r`.
- Produces: `_transform_shape(shape, translation, rotation_y)`, `_beam_between(scale, start, end, width, depth)`, revised `_make_base_structure`, `_make_upper_arm_structure`, `_make_forearm_structure`, and the regenerated AP242 file.

- [ ] **Step 1: Add deterministic transform helpers**

Implement a shape transform helper using `BRepBuilderAPI_Transform`, `gp_Ax1`, and `gp_Trsf`, then create a beam along the vector from `start` to `end` by rotating an X-aligned box around world Y:

```python
def _beam_between(scale, start, end, width_y, depth_z):
    dx, dz = end[0] - start[0], end[2] - start[2]
    length = math.hypot(dx, dz)
    beam = _box(scale, 0, -width_y / 2, -depth_z / 2, length, width_y, depth_z)
    angle = -math.atan2(dz, dx)
    return _rotate_translate(beam, scale, angle, start)
```

- [ ] **Step 2: Build the base and shoulder**

Use a `0.11 m` diameter circular foot, stacked pedestal cylinders, a shoulder bridge, and two cradle cheeks. Put the shoulder/output centre at `(0.0, 0.0, 0.105)`.

- [ ] **Step 3: Build the upper arm and elbow carrier**

Create the output horn on world Y, two parallel diagonal ribs from shoulder to elbow, and a compact elbow cradle. Put the elbow centre at `(0.09, 0.0, 0.18)` relative to world, or `(0.09, 0.0, 0.075)` relative to the upper-arm occurrence.

- [ ] **Step 4: Build the forearm and gripper**

Create a horn at the elbow, two tapered/parallel forearm ribs to a palm around local `(0.115, 0, -0.025)`, then two separated fixed fingers extending another `0.035 m` with a visible opening of at least `0.022 m`.

- [ ] **Step 5: Rotate both servo occurrences into a classic arm plane**

Apply the same rigid occurrence rotation that maps local output `+Z` to world `+Y`, then translate Servo A to `(0, 0, 0.105)` and Servo B to `(0.09, 0, 0.18)`. Place generated rigid definitions at their joint centres with transforms that preserve their designed world-Y horn axes.

- [ ] **Step 6: Regenerate the public fixture**

Run:

```powershell
$env:PYTHONPATH='test\fixtures'
python -c "from pathlib import Path; from generate_step_fixtures import write_two_joint_servo_arm; write_two_joint_servo_arm(Path('public/examples/two_joint_servo_arm_ap242.step'))"
```

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run:

```powershell
python -m unittest discover -s test -p "test_step_import.py"
```

Expected: all STEP import tests pass; example import produces two SG51R occurrences, two candidates, and the raised geometry assertions.

- [ ] **Step 8: Commit geometry and test together**

```powershell
git add test/test_step_import.py test/fixtures/generate_step_fixtures.py public/examples/two_joint_servo_arm_ap242.step
git commit -m "feat: reshape public example as robot arm"
```

---

### Task 3: Verify Browser Motion and Capture the Preview

**Files:**
- Modify: `docs/images/interface-preview.png`
- Test: `test/e2e/product-workflow.e2e.mjs`

**Interfaces:**
- Consumes: regenerated `public/examples/two_joint_servo_arm_ap242.step`, existing template-confirmation workflow, `window.__STEP_URDF_TEST__` counts.
- Produces: a real 1440 x 810 application screenshot showing the raised arm at `+5°`.

- [ ] **Step 1: Run the Playwright product workflow**

```powershell
npm run test:e2e
```

Expected: 4 tests pass, the template applies to two joints, and two enabled sliders appear.

- [ ] **Step 2: Launch and inspect the actual application**

```powershell
npm run dev -- --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`, load the public example, confirm the one servo family, teach the representative topology, and verify each joint independently at `0°`, `+5°`, and `-5°`.

- [ ] **Step 3: Check motion semantics**

Verify Servo A moves upper arm, elbow servo, forearm, and gripper. Verify Servo B moves only forearm and gripper. Reject the geometry if either link orbits a remote point, intersects the base in the tested range, or leaves its horn behind.

- [ ] **Step 4: Capture the final screenshot**

At 1440 x 810, use a three-quarter isometric view, fit the entire arm, set the shoulder review pose to `+5°`, keep the review card visible, and replace `docs/images/interface-preview.png`.

- [ ] **Step 5: Inspect the PNG**

Confirm exact pixel size `1440 x 810`, no browser chrome, both servo cases visible, and the arm silhouette legible at half width.

- [ ] **Step 6: Commit the screenshot**

```powershell
git add docs/images/interface-preview.png
git commit -m "docs: show raised robot arm in preview"
```

---

### Task 4: Update Public Descriptions

**Files:**
- Modify: `README.md`
- Modify: `README_zh-CN.md`

**Interfaces:**
- Consumes: verified raised-arm fixture and screenshot.
- Produces: accurate English and Chinese example descriptions without changing licensing claims.

- [ ] **Step 1: Update the example wording**

Describe the sample as a raised two-joint desktop robot arm with a pedestal, two real SG51R servo bodies, elbow, forearm, and fixed two-finger gripper. Keep the existing attribution link.

- [ ] **Step 2: Verify release wording and privacy boundary**

```powershell
npm run release:check
npm run release:check
```

Expected: release check passes and the private-model scan returns no private CAD reference in public assets/descriptions.

- [ ] **Step 3: Commit documentation**

```powershell
git add README.md README_zh-CN.md
git commit -m "docs: describe robot-arm public example"
```

---

### Task 5: Full Verification and Publication

**Files:**
- Verify: entire repository
- Update: GitHub `main` and `v0.3.0-rc.1` only after all checks pass

**Interfaces:**
- Consumes: all prior task commits.
- Produces: tested public main branch, refreshed prerelease, green Windows CI and CodeQL.

- [ ] **Step 1: Run complete local verification**

```powershell
npm run verify
npm audit --omit=dev
git diff --check
git status --short
```

Expected: 0 failures, audit reports 0 vulnerabilities, no whitespace errors, clean worktree.

- [ ] **Step 2: Confirm public asset boundary**

Verify only the pinned Adafruit SG51R STEP and generated public example are present. Confirm no proprietary model, source-CAD document, job output, or local recovery file is tracked.

- [ ] **Step 3: Merge the isolated branch into `main` and push**

Use a fast-forward merge after verification, then push `main`.

- [ ] **Step 4: Watch GitHub checks**

Require the final commit's Windows CI and CodeQL runs to both finish with `success`.

- [ ] **Step 5: Refresh the prerelease tag and notes**

Move `v0.3.0-rc.1` to the verified final commit and update its notes to mention the raised robot-arm example and current test counts.

- [ ] **Step 6: Report evidence**

Return the GitHub project/release URLs, final commit, local test totals, CI/CodeQL URLs, and the absolute local preview PNG path.
