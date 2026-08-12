# Windows setup

## Supported source environment

- 64-bit Windows 10 or 11
- Node.js 24 or newer
- CPython 3.13
- PowerShell 5.1 or newer

Run `Start-STEP-to-URDF.cmd`. The launcher creates an isolated virtual environment, installs `requirements-step.txt`, installs the locked npm graph, selects a free localhost port beginning at 5173, and opens the browser.

Runtime data is kept outside the checkout:

```text
%LOCALAPPDATA%\STEPtoURDF\
├── runtime\python\
├── jobs\
└── logs\
```

To start without opening a browser:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_windows.ps1 -NoBrowser
```

This repository is a source release candidate. It is not yet a signed, dependency-free installer.
