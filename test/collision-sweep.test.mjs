import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  deriveSymmetricSafePreviewLimit,
  findNewCollisionPairs,
  geometriesIntersect,
} from '../src/collision-sweep.mjs';

const identity = new THREE.Matrix4();

describe('geometriesIntersect', () => {
  it('returns false for separated triangle meshes', () => {
    const a = new THREE.BoxGeometry(1, 1, 1);
    const b = new THREE.BoxGeometry(1, 1, 1);
    const bWorld = new THREE.Matrix4().makeTranslation(2, 0, 0);
    expect(geometriesIntersect(a, identity, b, bWorld)).toBe(false);
  });

  it('returns true when rotation moves a mesh into another mesh', () => {
    const arm = new THREE.BoxGeometry(2, 0.2, 0.2);
    arm.translate(1, 0, 0);
    const obstacle = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const obstacleWorld = new THREE.Matrix4().makeTranslation(0, 1, 0);
    const armWorld = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    expect(
      geometriesIntersect(arm, armWorld, obstacle, obstacleWorld),
    ).toBe(true);
  });
});

describe('findNewCollisionPairs', () => {
  it('subtracts contacts that already exist at q=0', () => {
    const baseline = new Set(['a|b']);
    const current = new Set(['a|b', 'moving|obstacle']);
    expect(findNewCollisionPairs(current, baseline)).toEqual([
      'moving|obstacle',
    ]);
  });
});

describe('deriveSymmetricSafePreviewLimit', () => {
  it('stops before the first collision on either side of zero', () => {
    const samples = [-20, -18, -16, 0, 16, 18, 20].map(degrees => ({
      degrees,
      newPairs: Math.abs(degrees) >= 18 ? ['collision'] : [],
    }));
    expect(deriveSymmetricSafePreviewLimit(samples, 20)).toBe(16);
  });

  it('keeps the requested range when every sample is clear', () => {
    expect(deriveSymmetricSafePreviewLimit([
      { degrees: -20, newPairs: [] },
      { degrees: 0, newPairs: [] },
      { degrees: 20, newPairs: [] },
    ], 20)).toBe(20);
  });
});
