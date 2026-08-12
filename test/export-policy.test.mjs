import { describe, expect, it } from 'vitest';

import { EXPORT_LEVELS, evaluateExportReadiness } from '../src/domain/export-policy.mjs';

describe('dual-level export policy', () => {
  it('allows a clearly labelled preview while engineering values are incomplete', () => {
    const readiness = evaluateExportReadiness({
      validationIssues: [{ severity: 'BLOCKER', code: 'JOINT_LIMIT_MISSING', targetId: 'joint_1' }],
      unresolvedRecognition: [],
      engineeringValues: { limitsComplete: false, inertialsReliable: false, hardwareLimitsReliable: false },
    });
    expect(readiness[EXPORT_LEVELS.PREVIEW].allowed).toBe(true);
    expect(readiness[EXPORT_LEVELS.ENGINEERING].allowed).toBe(false);
    expect(readiness[EXPORT_LEVELS.PREVIEW].disclaimers).toContain('NOT_FOR_CONTROL_OR_SAFETY');
  });

  it('blocks both exports for invalid geometry or unresolved high-risk recognition', () => {
    const readiness = evaluateExportReadiness({
      validationIssues: [{ severity: 'BLOCKER', code: 'JOINT_AXIS_INVALID', targetId: 'joint_1' }],
      unresolvedRecognition: [{ id: 'occ:1/9', risk: 'high' }],
      engineeringValues: { limitsComplete: true, inertialsReliable: true, hardwareLimitsReliable: true },
    });
    expect(readiness[EXPORT_LEVELS.PREVIEW].allowed).toBe(false);
    expect(readiness[EXPORT_LEVELS.ENGINEERING].allowed).toBe(false);
  });

  it('permits engineering export only when the model and required values are verified', () => {
    const readiness = evaluateExportReadiness({
      validationIssues: [], unresolvedRecognition: [],
      engineeringValues: { limitsComplete: true, inertialsReliable: true, hardwareLimitsReliable: true },
    });
    expect(readiness[EXPORT_LEVELS.ENGINEERING].allowed).toBe(true);
  });
});
