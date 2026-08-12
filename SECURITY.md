# Security policy

Please report vulnerabilities through GitHub's private **Security → Report a vulnerability** flow. Do not disclose an unpatched vulnerability in a public issue and do not attach confidential CAD or credentials.

Relevant surfaces include untrusted STEP parsing, native OCCT code, oversized input, artifact path validation, localhost endpoints, and generated ZIP bundles. Reports should include the affected version, a minimal non-confidential reproduction, and impact.

The service binds to `127.0.0.1`, uses UUID job directories, limits uploads, and validates artifact paths. It is not hardened for multi-user, LAN, or internet-facing deployment.
