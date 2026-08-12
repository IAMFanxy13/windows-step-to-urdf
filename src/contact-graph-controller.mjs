import { matchTopologyPattern } from './contact-graph.mjs';
import { classifyContactEdge } from './contact-interface-policy.mjs';
import { solveKinematicTree } from './global-kinematic-solver.mjs';

const clone = value => structuredClone(value);

class UnionFind {
  constructor(ids) { this.parent = new Map(ids.map(id => [id, id])); }
  find(id) { const parent = this.parent.get(id); if (parent !== id) this.parent.set(id, this.find(parent)); return this.parent.get(id); }
  union(a, b) { const left = this.find(a), right = this.find(b); if (left !== right) this.parent.set(right, left); }
}

export function deriveRigidGroupsFromContactGraph(assembly, contactGraph, { rotationalCuts = [], fixedPairs = [], fixedDistanceMeters = 0.00005 } = {}) {
  const parts = assembly.occurrences.filter(item => item.kind === 'part');
  const union = new UnionFind(parts.map(item => item.id));
  const cuts = new Set(rotationalCuts.map(pair => [...pair].sort().join('|')));
  const mergeEvidence = [];
  for (const pair of fixedPairs) {
    const a = pair.a || pair[0], b = pair.b || pair[1];
    const key = [a, b].sort().join('|');
    if (!a || !b || cuts.has(key)) continue;
    union.union(a, b);
    mergeEvidence.push({
      edgeId: pair.edgeId || `functional:${key}`, a, b,
      classification: 'FIXED_CONFIRMED',
      evidence: pair.evidence || ['confirmed servo functional housing interface'],
    });
  }
  for (const edge of contactGraph.edges) {
    const key = [edge.a, edge.b].sort().join('|');
    const distance = edge.exactMinimumDistanceMeters ?? edge.boundingBoxDistanceMeters;
    const policy = classifyContactEdge(edge, { protectedRotational: cuts.has(key) });
    if (!policy.autoMerge || distance > fixedDistanceMeters) continue;
    union.union(edge.a, edge.b);
    mergeEvidence.push({ edgeId: edge.id || key, a: edge.a, b: edge.b, classification: policy.classification, evidence: policy.evidence });
  }
  const groups = new Map();
  for (const part of parts) {
    const root = union.find(part.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(part.id);
  }
  return [...groups.values()].map((occurrenceIds, index) => {
    const occurrenceSet = new Set(occurrenceIds);
    const responsible = mergeEvidence.filter(item => occurrenceSet.has(item.a) && occurrenceSet.has(item.b));
    return {
      id: `contact-group-${index + 1}`, name: `link_${index + 1}`, occurrenceIds,
      confidence: responsible.length ? 'HIGH' : 'LOW',
      evidence: responsible.length ? responsible.flatMap(item => item.evidence) : ['no exact fixed-interface evidence; occurrence remains separate'],
      mergeEvidence: responsible,
      reviewRequired: !responsible.length, source: 'automatic_contact_interface_grouping', lastModifiedBy: 'automatic_system',
    };
  });
}

export function batchMatchTaughtTopology(template, assembly, contactGraph) {
  if (!template.topologyPattern) throw new Error('Teach one representative topology before batch matching');
  return template.instanceIds.filter(id => !(template.excludedInstanceIds || []).includes(id)).map(instanceId => matchTopologyPattern(template.topologyPattern, instanceId, contactGraph, assembly));
}

export function iterateRigidGroupsAndJoints(model, assembly, contactGraph, functionalCandidates) {
  const before = clone(model);
  try {
    const rotationalCuts = functionalCandidates.flatMap(candidate => (candidate.topologyAlternatives || []).slice(0, 1).map(item => [item.parentOccurrenceId, item.childOccurrenceId]));
    const groups = deriveRigidGroupsFromContactGraph(assembly, contactGraph, { rotationalCuts });
    const groupByOccurrence = new Map(groups.flatMap(group => group.occurrenceIds.map(id => [id, group.id])));
    const rootGroupId = groups.some(group => group.id === before.rootLinkId) ? before.rootLinkId : groups[0]?.id || null;
    const solution = solveKinematicTree({ rigidGroups: groups, candidates: functionalCandidates, groupByOccurrence, rootGroupId, collisionEvidence: before.collisionEvidence || {} });
    return {
      ...before, rootLinkId: rootGroupId, rigidGroups: groups, joints: solution.joints,
      kinematicSolver: solution, contactGraphRevision: (before.contactGraphRevision || 0) + 1,
    };
  } catch (error) {
    return { ...before, contactGraphIterationError: error.message, contactGraphIterationRolledBack: true };
  }
}
