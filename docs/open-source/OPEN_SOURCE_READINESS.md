# Open-source readiness

## Published source boundary

- Apache-2.0 project license approved.
- Public tree is built independently from an explicit allowlist.
- Only the generated two-joint AP242 example is included.
- Retired CAD-specific implementation, private models, generated jobs, logs, reports, archives, caches, and build outputs are absent from Git history.
- A release scanner checks filenames, file types, STEP allowlisting, absolute paths, common credential formats, symlinks, and large files.
- CI runs JavaScript, Python/OCCT, browser, build, audit, and release-boundary checks on Windows.

## Remaining release-candidate limitations

- The source launcher requires preinstalled Node.js and Python on its first run.
- A signed dependency-free installer, SBOM, and redistributable OCCT runtime bundle remain future work.
- Generalization accuracy requires more independently licensed assembly benchmarks.
