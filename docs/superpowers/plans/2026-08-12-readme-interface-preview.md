# README Interface Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the README's overly wide empty-workspace screenshot with a legible 16:9 capture of the real application running the generated public two-joint STEP example.

**Architecture:** Reuse the existing Vite application and Playwright-tested example workflow. Drive the application to the automatic-review state, frame the generated model in the existing Three.js viewport, capture only the application viewport, and update both language README files to reference the same public image.

**Tech Stack:** Vite, Playwright/Chromium, Three.js application UI, Markdown, GitHub README rendering.

## Global Constraints

- Do not use or expose private CAD, robot models, screenshots, local paths, or generated job data.
- Use only `public/examples/two_joint_servo_arm_ap242.step` as the model source.
- Keep the screenshot at a 16:9 resolution of 1440×810 or 1280×720.
- Do not modify application behaviour or unrelated README content.
- Preserve the repository's public-release privacy gate.

---

### Task 1: Capture the real example interface

**Files:**
- Create: `docs/images/interface-preview.png`
- Reference: `test/e2e/product-workflow.e2e.mjs`
- Reference: `public/examples/two_joint_servo_arm_ap242.step`

**Interfaces:**
- Consumes: The existing `🧪 示例` workflow and the application readiness flag `html[data-app-ready="true"]`.
- Produces: A 16:9 PNG containing the public example model and readable task panel.

- [ ] **Step 1: Start the existing local application**

Run:

```powershell
npm run dev -- --port 5175 --strictPort
```

Expected: Vite serves the application at `http://127.0.0.1:5175`.

- [ ] **Step 2: Load the generated public example**

Open the local page at a 1440×810 viewport, wait for `data-app-ready="true"`, click the button with accessible name `先试两关节示例`, and wait until the region named `舵机模板确认` is visible.

Expected: The generated model is present and the UI reports an automatic result without runtime errors.

- [ ] **Step 3: Compose and capture**

Use the existing viewport controls to fit the full example model, keep the main task panel visible, close no required application content, and save a viewport screenshot to:

```text
docs/images/interface-preview.png
```

Expected: The PNG is exactly 1440×810 or 1280×720; it contains no browser chrome, modal, desktop content, private model, or clipped primary controls.

- [ ] **Step 4: Visually inspect the image**

Check the output at full size and GitHub-like width.

Expected: The model purpose is recognizable, the task panel is readable, and the composition is balanced.

### Task 2: Publish the preview in both READMEs

**Files:**
- Modify: `README.md`
- Modify: `README_zh-CN.md`
- Test: `scripts/check-public-release.mjs`

**Interfaces:**
- Consumes: `docs/images/interface-preview.png` from Task 1.
- Produces: Matching English and Chinese README previews.

- [ ] **Step 1: Update the English image reference**

Replace:

```markdown
![Empty workspace: no bundled robot is loaded before the user imports STEP](docs/images/empty-workspace.png)
```

with:

```markdown
![Windows STEP-to-URDF workbench showing the generated two-joint example](docs/images/interface-preview.png)
```

- [ ] **Step 2: Update the Chinese image reference**

Replace the existing empty-workspace image with:

```markdown
![Windows STEP-to-URDF 工作台正在显示仓库生成的两关节示例](docs/images/interface-preview.png)
```

- [ ] **Step 3: Verify the public release**

Run:

```powershell
npm run release:check
git diff --check
```

Expected: The release scan passes, Markdown has no whitespace errors, and only the public example is represented.

- [ ] **Step 4: Commit the preview update**

```powershell
git add README.md README_zh-CN.md docs/images/interface-preview.png
git commit -m "docs: improve README interface preview"
```

### Task 3: Push and verify GitHub rendering

**Files:**
- No additional repository files.

**Interfaces:**
- Consumes: The committed README and screenshot.
- Produces: A visually verified public GitHub README.

- [ ] **Step 1: Push the latest main branch**

Run:

```powershell
git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 push origin main
```

Expected: GitHub accepts the commit on `main`.

- [ ] **Step 2: Inspect the rendered README**

Open `https://github.com/IAMFanxy13/windows-step-to-urdf` and verify the new image is visible, 16:9, and not compressed into the former ultra-wide layout.

- [ ] **Step 3: Verify remote privacy and status**

Confirm the remote file tree contains `docs/images/interface-preview.png`, contains no private-model path markers, and the latest CI run corresponds to the pushed commit.

