import { describe, expect, it } from 'vitest';
import { buildContactGraph, looksLikeFastener, matchTopologyPattern, topologyPatternFromRepresentative } from '../src/contact-graph.mjs';

const matrix = (x, y = 0, z = 0) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const definition = (id, name = id, size = 0.02) => ({ id, name, boundsMeters: { min: [-size / 2, -size / 2, -size / 2], max: [size / 2, size / 2, size / 2] }, massProperties: { volumeCubicMeters: size ** 3 } });
const assembly = {
  definitions: [definition('servo'), definition('bracket'), definition('horn'), definition('screw', 'M3 screw', 0.003)],
  occurrences: [
    { id: 's1', kind: 'part', definitionId: 'servo', sourceTransformMeters: matrix(0) },
    { id: 'b1', kind: 'part', definitionId: 'bracket', sourceTransformMeters: matrix(-0.019) },
    { id: 'h1', kind: 'part', definitionId: 'horn', sourceTransformMeters: matrix(0.019) },
    { id: 'f1', kind: 'part', definitionId: 'screw', sourceTransformMeters: matrix(0, 0.011) },
  ],
};

describe('B-Rep contact graph decisions', () => {
  it('coarse-screens neighbors and suppresses fasteners without deleting the edge', () => {
    const graph = buildContactGraph(assembly, { coarseToleranceMeters: 0.01 });
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges.some(edge => edge.a === 's1' && edge.b === 'b1')).toBe(true);
    expect(graph.edges.some(edge => edge.fastenerSuppressed)).toBe(true);
    expect(looksLikeFastener(assembly.definitions[3])).toBe(true);
  });

  it('teaches one representative housing/output topology and matches another instance by definition', () => {
    const graph = buildContactGraph(assembly, { coarseToleranceMeters: 0.01 });
    const pattern = topologyPatternFromRepresentative({ representativeInstanceId: 's1', housingOccurrenceIds: ['b1'], outputOccurrenceIds: ['h1'], assembly, defaultActuationMode: 'direct', ignoredFastenerTypes: ['screw'] });
    expect(matchTopologyPattern(pattern, 's1', graph, assembly)).toMatchObject({ complete: true, housingOccurrenceIds: ['b1'], outputOccurrenceIds: ['h1'], verificationStatus: 'TEMPLATE_VERIFIED' });
  });
});
