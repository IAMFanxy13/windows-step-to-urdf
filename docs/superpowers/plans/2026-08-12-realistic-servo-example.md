# Realistic Public Servo Example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the block-only public fixture with a deterministic two-joint arm containing two recognizable SG51R servo occurrences, output horns, brackets, and links while preserving automatic candidate and motion-preview coverage.

**Architecture:** Pin the licensed Adafruit servo STEP as a source asset, load it through OCCT in the fixture generator, and compose three repository-generated rigid structures around two occurrences of one servo definition. Keep the generated AP242 assembly as the browser input so the exact production import and inference pipeline remains under test.

**Tech Stack:** Python 3.13, OCP/Open CASCADE 7.9.3, STEP AP214 source import, XCAF AP242 assembly export, Vitest, Python unittest, Playwright, Three.js.

## Global Constraints

- The upstream servo source is `adafruit/Adafruit_CAD_Parts` commit `ab3dfc47c32468ba87e7652556cab25efd906eb0`, file `2201 Submicro servo/2201 Submicro Servo SG51R.step`.
- The source asset SHA-256 is `66fa3c9570de91e698b0077e20adc652eaf3e21f98db499cfc4980c35e740013`.
- Preserve the MIT license and exact source attribution.
- Do not use or derive geometry from any private robot or CAD file.
- Keep two occurrences of one servo definition, one root, three intended rigid links, and two revolute-joint candidates.
- Keep the imported STEP pose as `q=0`.
- Do not weaken topology, contact, privacy, or export validation to make the example pass.

---

### Task 1: Pin and audit the public servo source

**Files:**
- Create: `third_party/adafruit_sg51r/2201_Submicro_Servo_SG51R.step`
- Create: `third_party/adafruit_sg51r/LICENSE`
- Create: `third_party/adafruit_sg51r/SOURCE.md`
- Modify: `scripts/check-public-release.mjs`
- Modify: `test/public-release-boundary.test.mjs`

**Interfaces:**
- Consumes: the exact raw GitHub URLs at the pinned commit.
- Produces: `SERVO_SOURCE_PATH` and a release allowlist containing exactly the generated AP242 example and pinned source STEP.

- [ ] **Step 1: Write the failing boundary expectations**

Add assertions that the two permitted STEP paths are exactly:

```js
[
  'public/examples/two_joint_servo_arm_ap242.step',
  'third_party/adafruit_sg51r/2201_Submicro_Servo_SG51R.step',
]
```

and that the pinned source hash equals `66fa3c9570de91e698b0077e20adc652eaf3e21f98db499cfc4980c35e740013`.

- [ ] **Step 2: Run the boundary tests and observe failure**

Run:

```powershell
npx vitest run test/public-release-boundary.test.mjs test/release-check.test.mjs
```

Expected: failure because the source asset and two-path allowlist do not exist.

- [ ] **Step 3: Download and record the pinned asset**

Download the STEP and MIT license from the pinned commit, verify the SHA-256, and write `SOURCE.md` containing repository, commit, original path, raw URL, checksum, license, and the note that generated brackets/links are original repository geometry.

- [ ] **Step 4: Replace the scalar allowlist with a path set**

Define:

```js
const ALLOWED_STEP_FILES = new Set([
  'public/examples/two_joint_servo_arm_ap242.step',
  'third_party/adafruit_sg51r/2201_submicro_servo_sg51r.step',
]);
```

and reject every other `.step` or `.stp` path.

- [ ] **Step 5: Run the boundary tests**

Expected: all targeted tests pass and `npm run release:check` reports no unapproved STEP.

- [ ] **Step 6: Commit the licensed source**

```powershell
git add third_party scripts/check-public-release.mjs test/public-release-boundary.test.mjs
git commit -m "build: pin licensed SG51R reference geometry"
```

### Task 2: Generate the realistic XCAF assembly

**Files:**
- Modify: `test/fixtures/generate_step_fixtures.py`
- Modify: `test/test_step_import.py`
- Replace: `public/examples/two_joint_servo_arm_ap242.step`

**Interfaces:**
- Consumes: `third_party/adafruit_sg51r/2201_Submicro_Servo_SG51R.step`.
- Produces: `write_two_joint_servo_arm(target, source_unit)` with five part occurrences: `base`, `servo_a`, `upper_arm`, `servo_b`, and `forearm`; servo occurrences share one definition.

- [ ] **Step 1: Strengthen the failing import test**

Assert that the generated assembly has five part occurrences, two occurrences whose definition name is `SG51R_servo_body`, one servo template family with two instances, recognizable horn cylinders centred on the selected output axes, and two candidate joints with contact-based topology alternatives.

- [ ] **Step 2: Run the exact import test and observe failure**

```powershell
python -m unittest test.test_step_import.StepImportTests.test_two_joint_example_produces_an_automatic_movable_first_draft
```

Expected: failure because the current fixture has no licensed SG51R body or horn geometry.

- [ ] **Step 3: Add source loading and checksum verification**

Add `_load_pinned_sg51r()` using `STEPControl_Reader.ReadFile`, `TransferRoots`, and `OneShape`; compute SHA-256 before loading and raise a clear error on mismatch.

- [ ] **Step 4: Add deterministic generated rigid structures**

Create helpers that assemble compounds from exact primitives:

```python
_make_base_structure(scale)
_make_upper_arm_structure(scale)
_make_forearm_structure(scale)
```

Each structure includes visible mounting plates, a U-shaped bracket, a circular horn centred at the relevant local output point, and arm rails. Place Servo A and Servo B with parallel Z axes and different X translations.

- [ ] **Step 5: Export five occurrences with one shared servo definition**

Name definitions `base_structure`, `SG51R_servo_body`, `upper_arm_structure`, and `forearm_structure`; add `servo_a` and `servo_b` from the same label. Export AP242 with XCAF names and transforms.

- [ ] **Step 6: Run and tune only generated interfaces**

Run the focused Python test. If contact classification is ambiguous, adjust horn bottom planes or generated mounting faces while keeping the licensed servo shape unchanged and keeping validation thresholds unchanged.

- [ ] **Step 7: Regenerate the public AP242 file**

```powershell
python -c "from pathlib import Path; from test.fixtures.generate_step_fixtures import write_two_joint_servo_arm; write_two_joint_servo_arm(Path('public/examples/two_joint_servo_arm_ap242.step'))"
```

- [ ] **Step 8: Run Python and browser workflow tests**

```powershell
python -m unittest discover -s test -p "test_*.py"
npm run test:e2e
```

Expected: 20 Python/OCCT tests and four browser workflows pass; the browser reaches three links, two joints, and two enabled sliders.

- [ ] **Step 9: Commit the fixture**

```powershell
git add test/fixtures/generate_step_fixtures.py test/test_step_import.py public/examples/two_joint_servo_arm_ap242.step
git commit -m "feat: add realistic two-servo STEP example"
```

### Task 3: Attribute, capture, verify, and publish

**Files:**
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `docs/open-source/THIRD_PARTY_AUDIT.md`
- Replace: `docs/images/interface-preview.png`

**Interfaces:**
- Consumes: the new generated AP242 example and existing browser workflow.
- Produces: an attributed public release and 1440×810 README preview in motion-review mode.

- [ ] **Step 1: Add exact attribution**

Record upstream repository, commit, file path, MIT license, source hash, and the fact that the source body is combined with original generated fixture geometry.

- [ ] **Step 2: Run the real browser workflow and capture the preview**

At a 1440×810 viewport, click the example, confirm the one servo template once, batch-apply it, wait for two enabled sliders, fit the whole model, and capture `docs/images/interface-preview.png` without browser chrome.

- [ ] **Step 3: Inspect image and repository boundary**

Verify 16:9 dimensions, recognizable two-servo geometry, centred horns, readable task panel, no private-model markers, and exactly the two allowlisted STEP files.

- [ ] **Step 4: Run full verification**

```powershell
npm run verify
npm audit --omit=dev
git diff --check
```

Expected: 114 JavaScript tests, 20 Python/OCCT tests, four Playwright flows, production build, public-release scan, and npm audit all pass.

- [ ] **Step 5: Commit and push**

```powershell
git add THIRD_PARTY_NOTICES.md docs/open-source/THIRD_PARTY_AUDIT.md docs/images/interface-preview.png
git commit -m "docs: showcase licensed servo example"
git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 push origin main
```

- [ ] **Step 6: Verify GitHub**

Confirm GitHub renders the new image, the latest Windows CI and CodeQL runs succeed, and the remote tree contains no non-allowlisted CAD.
