import { describe, expect, it } from 'vitest';

import { computeRigidGroupInertial } from '../src/mass-properties.mjs';

const matrix = x => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('rigid-group mass properties', () => {
  it('combines occurrence transforms with the parallel-axis theorem', () => {
    const assembly = {
      definitions: [{
        id: 'd', massProperties: {
          volumeCubicMeters: 1,
          centerOfMassMeters: [0, 0, 0],
          inertiaAtUnitDensityKgPerCubicMeter: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      }],
      occurrences: [
        { id: 'o1', definitionId: 'd', sourceTransformMeters: matrix(0) },
        { id: 'o2', definitionId: 'd', sourceTransformMeters: matrix(2) },
      ],
    };
    const result = computeRigidGroupInertial(
      { id: 'g', occurrenceIds: ['o1', 'o2'] }, assembly,
      { densityKgPerCubicMeter: 2, linkFrameMeters: [0.5, 0, 0] },
    );
    expect(result.massKilograms).toBeCloseTo(4);
    expect(result.centerOfMassMeters).toEqual([0.5, 0, 0]);
    expect(result.inertiaKgSquareMeters[0]).toBeCloseTo(4);
    expect(result.inertiaKgSquareMeters[4]).toBeCloseTo(8);
    expect(result.inertiaKgSquareMeters[8]).toBeCloseTo(8);
    expect(result.source).toBe('user_density+occt_brep');
  });

  it('refuses to invent mass without a user density', () => {
    expect(() => computeRigidGroupInertial({ occurrenceIds: [] }, { definitions: [], occurrences: [] }, {}))
      .toThrow(/density/i);
  });

  it('resolves density per STEP definition and records every source', () => {
    const properties = {
      volumeCubicMeters: 1,
      centerOfMassMeters: [0, 0, 0],
      inertiaAtUnitDensityKgPerCubicMeter: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    };
    const assembly = {
      definitions: [{ id: 'aluminium', massProperties: properties }, { id: 'steel', massProperties: properties }],
      occurrences: [
        { id: 'a', definitionId: 'aluminium', sourceTransformMeters: matrix(0) },
        { id: 's', definitionId: 'steel', sourceTransformMeters: matrix(0) },
      ],
    };
    const result = computeRigidGroupInertial({ occurrenceIds: ['a', 's'] }, assembly, {
      densityByDefinitionId: {
        aluminium: { value: 2, source: 'user_material:aluminium' },
        steel: { value: 4, source: 'step_material:steel' },
      },
    });
    expect(result.massKilograms).toBeCloseTo(6);
    expect(result.source).toBe('per_definition_density+occt_brep');
    expect(result.densitySources).toEqual({ aluminium: 'user_material:aluminium', steel: 'step_material:steel' });
  });
});
