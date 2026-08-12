# Privacy

- The repository contains one programmatically generated two-joint STEP example and no private robot model.
- The application starts with an empty scene and never uploads CAD to a cloud service.
- Imported files, tessellated meshes, reports, and exported bundles stay in `%LOCALAPPDATA%\STEPtoURDF\jobs` when using the Windows launcher.
- Local logs redact the current Windows user profile prefix. Native geometry libraries may still include filenames in diagnostics, so inspect logs before sharing them.
- Starting a new project does not automatically delete local job directories. Remove them manually when your retention policy requires it.
- Do not attach confidential STEP, meshes, logs, or generated URDF bundles to public issues.
- The localhost server is designed for one local user and must not be exposed to a LAN or the public internet.
