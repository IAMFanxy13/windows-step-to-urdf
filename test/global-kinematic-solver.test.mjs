import { describe, expect, it } from 'vitest';

import { solveKinematicTree } from '../src/global-kinematic-solver.mjs';

describe('global kinematic solver evidence', () => {
  it('prunes a 30-joint tree search after finding the complete deterministic branch', () => {
    const rigidGroups = Array.from({ length: 31 }, (_, index) => ({ id: `g${index}` }));
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      id: `j${index}`,
      confidence: 'HIGH',
      verificationStatus: 'TEMPLATE_VERIFIED',
      topologyAlternatives: [{ parentLinkId: `g${index}`, childLinkId: `g${index + 1}` }],
    }));

    const result = solveKinematicTree({ rigidGroups, candidates, rootGroupId: 'g0' });

    expect(result.completeTree).toBe(true);
    expect(result.searchExhaustive).toBe(true);
    expect(result.searchDiagnostics.nodesVisited).toBeLessThan(500);
  });

  it('uses collision only as a bounded ranking penalty and never as verification', () => {
    const candidates = [{
      id: 'joint-a', confidence: 'MEDIUM', verificationStatus: 'AUTOMATIC_UNVERIFIED',
      topologyAlternatives: [
        { parentLinkId: 'base', childLinkId: 'arm' },
        { parentLinkId: 'base', childLinkId: 'arm' },
      ],
    }];
    const result = solveKinematicTree({
      rigidGroups: [{ id: 'base' }, { id: 'arm' }], candidates, rootGroupId: 'base',
      collisionEvidence: { 'joint-a': [{ newCollisionCount: 20 }, { newCollisionCount: 0 }] },
    });
    expect(result.completeTree).toBe(true);
    expect(result.selectedAlternatives).toEqual([expect.objectContaining({ candidateId: 'joint-a', alternativeIndex: 1 })]);
    expect(result.joints[0]).toMatchObject({
      verificationStatus: 'AUTOMATIC_UNVERIFIED',
      collisionEvidenceStatus: 'ADVISORY_ONLY',
    });
    expect(result.evidence).toContain('collision contributes a bounded penalty and never verifies a candidate');
  });
});
