import { describe, expect, it } from 'vitest';

const metricsModule = await import('../src/inference-metrics.mjs').catch(() => null);

describe('kinematic inference accuracy metrics', () => {
  it('computes literal candidate precision recall and F1', () => {
    expect(metricsModule).not.toBeNull();
    if (!metricsModule) return;
    expect(metricsModule.precisionRecall(['servo-a', 'not-a-servo'], ['servo-a', 'servo-b'])).toEqual({
      truePositive: 1, falsePositive: 1, falseNegative: 1,
      precision: 0.5, recall: 0.5, f1: 0.5,
    });
  });

  it('measures an unoriented axis line independently from joint positive direction', () => {
    expect(metricsModule).not.toBeNull();
    if (!metricsModule) return;
    const exact = metricsModule.axisLineError(
      { origin: [0, 0, 0], direction: [0, 0, -1] },
      { origin: [0, 0, 0], direction: [0, 0, 1] },
    );
    expect(exact).toEqual({ angleDegrees: 0, lineDistanceMeters: 0 });
    const offset = metricsModule.axisLineError(
      { origin: [0.001, 0, 0], direction: [0, 0, 1] },
      { origin: [0, 0, 0], direction: [0, 0, 1] },
    );
    expect(offset.angleDegrees).toBe(0);
    expect(offset.lineDistanceMeters).toBeCloseTo(0.001);
  });

  it('computes pairwise rigid grouping and oriented topology accuracy', () => {
    expect(metricsModule).not.toBeNull();
    if (!metricsModule) return;
    expect(metricsModule.rigidGroupingMetrics([['a', 'b'], ['c']], [['a', 'b', 'c']])).toMatchObject({
      pairwise: { truePositive: 1, falsePositive: 0, falseNegative: 2, precision: 1, recall: 1 / 3, f1: 0.5 },
    });
    expect(metricsModule.topologyMetrics(
      [{ actuatorId: 's1', parent: 'base', child: 'arm' }, { actuatorId: 's2', parent: 'tip', child: 'arm' }],
      [{ actuatorId: 's1', parent: 'base', child: 'arm' }, { actuatorId: 's2', parent: 'arm', child: 'tip' }],
    )).toEqual({ compared: 2, endpointAccuracy: 1, orientedParentChildAccuracy: 0.5 });
  });
});
