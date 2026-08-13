# Private Servo README Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a public README screenshot in which the tabletop robot arm visibly uses the user's private servo exterior, without publishing any reusable private CAD derivative.

**Architecture:** Export the selected native part to an isolated temporary directory, inspect and transform it entirely outside the repository, and render a temporary two-joint arm through the existing local preview stack. Only the flattened PNG crosses into the Git worktree; the release gate and tracked-file audit enforce the privacy boundary.

**Tech Stack:** Windows CAD COM automation, Python 3.13, OCP/Open CASCADE, existing STEP worker, Three.js browser preview, Playwright browser control, Git release checks.

## Global Constraints

- Do not modify the source CAD part.
- Do not commit or publish a source part, STEP/STL/mesh derivative, private assembly transform, or local recovery data.
- Keep the distributable AP242 example and SG51R dependency unchanged.
- The only public visual derivative is `docs/images/interface-preview.png`.
- Validate both joints through the real preview before capture.

---

### Task 1: Export and inspect the private servo in isolation

**Files:**
- Create temporarily: `%TEMP%/step-urdf-private-render/servo.step`
- Create temporarily: `%TEMP%/step-urdf-private-render/servo-inspection.json`
- Do not modify: source native CAD part

**Interfaces:**
- Consumes: user-selected native CAD part path, installed CAD automation API.
- Produces: temporary neutral B-Rep plus JSON containing bounds, cylinder candidates, selected output-axis line, and unit scale.

- [ ] **Step 1: Confirm the source file exists and record read-only metadata**

Run a read-only PowerShell check for full path, byte length, and modification time. Do not compute or store this path inside the repository.

- [ ] **Step 2: Export through CAD automation to the temporary directory**

Open the part silently, save a copy as STEP in the isolated temporary directory, close only the document opened by this task, and leave the original untouched.

- [ ] **Step 3: Inspect exact B-Rep geometry**

Use OCP to calculate unit-aware bounds and coaxial cylinder clusters. Select the output-axis candidate by repeated coaxial faces near a protruding end, and write the evidence only to temporary JSON.

- [ ] **Step 4: Verify the temporary artifact**

Run the repository's STEP reader against the temporary STEP and require a positive volume, finite bounds, at least one cylinder candidate, and a unit axis vector.

### Task 2: Build the temporary two-joint render assembly

**Files:**
- Create temporarily: `%TEMP%/step-urdf-private-render/private-servo-arm.step`
- Reuse read-only: `test/fixtures/generate_step_fixtures.py`
- Do not modify: `public/examples/two_joint_servo_arm_ap242.step`

**Interfaces:**
- Consumes: temporary servo B-Rep and inspection JSON from Task 1; procedural pedestal, links and gripper from the fixture generator.
- Produces: a temporary AP242 assembly with five occurrences: base, two servo instances, upper arm and forearm/gripper.

- [ ] **Step 1: Calculate servo placement transforms**

Map the servo local output axis onto the arm's two world-space joint axes. Translate each interface centre exactly to its shoulder or elbow joint origin, preserving a right-handed transform.

- [ ] **Step 2: Generate matching brackets and links around the real servo bounds**

Scale only the repository-generated structural members to clear the servo envelope. Do not scale the private servo geometry.

- [ ] **Step 3: Write the temporary AP242 assembly**

Create XCAF definitions and occurrences with finite transforms and distinct occurrence names. Keep the private body as one repeated definition so the template flow can recognize it once and apply it twice.

- [ ] **Step 4: Validate assembly geometry**

Require exactly five part occurrences, two instances of one servo definition, determinant `+1` for every transform, finite bounds, and a recognizable pedestal-to-gripper silhouette.

### Task 3: Render and motion-check the temporary assembly

**Files:**
- Modify: `docs/images/interface-preview.png`
- Do not modify: other public model or mesh assets

**Interfaces:**
- Consumes: temporary AP242 assembly from Task 2 and the existing localhost application.
- Produces: one flattened 1440×810 PNG showing the private servo exterior at both joints.

- [ ] **Step 1: Start the existing local application**

Run the normal Node/Python workspace without installing ROS or additional public dependencies.

- [ ] **Step 2: Import the temporary AP242 assembly**

Use the real import UI. Confirm one servo definition, its output port, and the representative topology; batch-apply it to both occurrences.

- [ ] **Step 3: Test both joints**

For each joint, run `0°`, `+5°`, and `-5°`. Verify the pivot stays at the output interface and only the expected child/downstream structure moves.

- [ ] **Step 4: Capture the review view**

Use a three-quarter camera angle showing pedestal, both servo bodies, both links and the gripper. Capture the default-mode motion-review panel with one joint at `+5°` and save it as `docs/images/interface-preview.png`.

### Task 4: Audit, verify and publish the PNG-only change

**Files:**
- Modify if needed: `README.md`
- Modify if needed: `README_zh-CN.md`
- Verify: `docs/images/interface-preview.png`

**Interfaces:**
- Consumes: final PNG and repository release gate.
- Produces: a clean public commit whose only model-derived artifact is the flattened screenshot.

- [ ] **Step 1: Visually inspect the saved PNG**

Confirm both private servo exteriors are visible, the arm remains connected, the browser UI is legible, and no local paths or private assembly details appear.

- [ ] **Step 2: Run the full verification suite**

Run `npm run verify` and require 0 failures across JavaScript tests, Python/OCP tests, production build, browser workflows, and release gate.

- [ ] **Step 3: Audit Git contents**

Run `git status --short`, `git diff --check`, `git ls-files`, and `npm run release:check`. Require no native CAD, neutral CAD, mesh, private model marker, temporary JSON, or absolute local path in the tracked delta.

- [ ] **Step 4: Commit and publish**

Commit the PNG and any accurate alt-text change, push `main`, then wait for both GitHub CI and CodeQL to complete successfully.
