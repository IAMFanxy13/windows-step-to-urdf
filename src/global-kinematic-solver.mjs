import { collisionEvidenceForAlternative } from './inference-evidence.mjs';

const clone = value => structuredClone(value);

const confidenceScore = value => value === 'HIGH' ? 3 : value === 'MEDIUM' ? 1.5 : value === 'LOW' ? 0.5 : 0;
const verificationScore = value => value === 'USER_VERIFIED' ? 6 : value === 'TEMPLATE_VERIFIED' ? 4 : value === 'AUTOMATIC_UNVERIFIED' ? 1 : 0;

class UnionFind {
  constructor(ids) { this.parent = new Map(ids.map(id => [id, id])); }
  clone() { const next = Object.create(UnionFind.prototype); next.parent = new Map(this.parent); return next; }
  find(id) {
    const parent = this.parent.get(id);
    if (parent == null) return null;
    if (parent !== id) this.parent.set(id, this.find(parent));
    return this.parent.get(id);
  }
  union(a, b) {
    const left = this.find(a), right = this.find(b);
    if (left == null || right == null || left === right) return false;
    this.parent.set(right, left); return true;
  }
  componentCount() { return new Set([...this.parent.keys()].map(id => this.find(id))).size; }
}

function alternativeEndpoints(alternative, candidate, groupByOccurrence) {
  const parent = candidate.parentLinkId || alternative.parentLinkId || groupByOccurrence.get(alternative.parentOccurrenceId || alternative.housingOccurrenceId);
  const child = candidate.childLinkId || alternative.childLinkId || groupByOccurrence.get(alternative.childOccurrenceId || alternative.outputOccurrenceId);
  return { left: parent, right: child };
}

function scoreAlternative(candidate, alternative, index, collisionEvidence) {
  const collision = collisionEvidenceForAlternative(collisionEvidence, candidate.id, index);
  return verificationScore(candidate.verificationStatus) + confidenceScore(candidate.confidence)
    + confidenceScore(alternative.confidence) + (alternative.userConfirmed ? 8 : 0)
    - collision.penalty - index * 1e-6;
}

function orientSelectedEdges(groupIds, selected, rootGroupId) {
  const adjacency = new Map(groupIds.map(id => [id, []]));
  selected.forEach(item => {
    adjacency.get(item.left)?.push({ next: item.right, item });
    adjacency.get(item.right)?.push({ next: item.left, item });
  });
  const orientation = new Map();
  const visited = new Set();
  const starts = [rootGroupId, ...groupIds.filter(id => id !== rootGroupId)].filter(Boolean);
  for (const start of starts) {
    if (visited.has(start)) continue;
    visited.add(start);
    const queue = [start];
    while (queue.length) {
      const parent = queue.shift();
      for (const { next: child, item } of adjacency.get(parent) || []) {
        if (visited.has(child)) continue;
        visited.add(child); queue.push(child);
        orientation.set(item.candidate.id, { parentLinkId: parent, childLinkId: child });
      }
    }
  }
  return { orientation, reachableFromRoot: (() => {
    const reachable = new Set();
    if (!rootGroupId) return reachable;
    const queue = [rootGroupId]; reachable.add(rootGroupId);
    while (queue.length) for (const { next } of adjacency.get(queue.shift()) || []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    return reachable;
  })() };
}

export function solveKinematicTree({
  rigidGroups,
  candidates,
  groupByOccurrence = new Map(),
  rootGroupId = rigidGroups?.[0]?.id || null,
  collisionEvidence = {},
  maxSearchNodes = 250000,
} = {}) {
  const groupIds = (rigidGroups || []).map(group => group.id);
  const activeCandidates = (candidates || []).filter(candidate => !['UNRESOLVED', 'INVALID'].includes(candidate.verificationStatus));
  const options = activeCandidates.map(candidate => (candidate.topologyAlternatives || []).map((alternative, index) => {
    const endpoints = alternativeEndpoints(alternative, candidate, groupByOccurrence);
    return { candidate, alternative, index, ...endpoints, score: scoreAlternative(candidate, alternative, index, collisionEvidence) };
  }).filter(item => item.left && item.right && item.left !== item.right && groupIds.includes(item.left) && groupIds.includes(item.right))
    .sort((left, right) => right.score - left.score || left.index - right.index));
  let best = null;
  let nodesVisited = 0;
  let branchesPruned = 0;
  let searchExhaustive = true;
  const isBetter = value => !best
    || Number(value.completeTree) > Number(best.completeTree)
    || (value.completeTree === best.completeTree && value.selected.length > best.selected.length)
    || (value.completeTree === best.completeTree && value.selected.length === best.selected.length && value.score > best.score + 1e-9)
    || (value.completeTree === best.completeTree && value.selected.length === best.selected.length && Math.abs(value.score - best.score) <= 1e-9 && value.key < best.key);
  const visit = (candidateIndex, union, selected, skipped, score) => {
    nodesVisited += 1;
    if (nodesVisited > maxSearchNodes) { searchExhaustive = false; return; }
    const remainingCandidates = activeCandidates.length - candidateIndex;
    if (best?.completeTree && selected.length + remainingCandidates < best.selected.length) {
      branchesPruned += 1;
      return;
    }
    if (candidateIndex === activeCandidates.length) {
      const completeTree = groupIds.length > 0 && skipped.length === 0 && selected.length === groupIds.length - 1 && union.componentCount() === 1;
      const key = selected.map(item => `${item.candidate.id}:${item.index}`).join('|');
      const value = { selected: [...selected], skipped: [...skipped], score, completeTree, key };
      if (isBetter(value)) best = value;
      return;
    }
    const candidateOptions = options[candidateIndex];
    for (const option of candidateOptions) {
      const nextUnion = union.clone();
      if (!nextUnion.union(option.left, option.right)) continue;
      visit(candidateIndex + 1, nextUnion, [...selected, option], skipped, score + option.score);
      if (!searchExhaustive) return;
    }
    visit(candidateIndex + 1, union.clone(), selected, [...skipped, activeCandidates[candidateIndex].id], score - 10);
  };
  visit(0, new UnionFind(groupIds), [], [], 0);
  best ||= { selected: [], skipped: activeCandidates.map(item => item.id), score: -Infinity, completeTree: false, key: '' };
  const { orientation, reachableFromRoot } = orientSelectedEdges(groupIds, best.selected, rootGroupId);
  const joints = best.selected.map(item => {
    const oriented = orientation.get(item.candidate.id) || { parentLinkId: item.left, childLinkId: item.right };
    const housingGroupId = item.alternative.housingOccurrenceId ? groupByOccurrence.get(item.alternative.housingOccurrenceId) : null;
    const outputGroupId = item.alternative.outputOccurrenceId ? groupByOccurrence.get(item.alternative.outputOccurrenceId) : null;
    const actuationMode = housingGroupId && outputGroupId
      ? (oriented.parentLinkId === housingGroupId ? 'direct' : 'reaction')
      : item.candidate.actuationMode || item.alternative.actuationMode || null;
    return {
      ...clone(item.candidate), topologyAlternatives: clone(item.candidate.topologyAlternatives || []),
      parentLinkId: oriented.parentLinkId, childLinkId: oriented.childLinkId,
      movingSideLinkId: oriented.childLinkId, selectedTopologyAlternativeIndex: item.index,
      actuationMode, solverScore: item.score,
      collisionEvidenceStatus: 'ADVISORY_ONLY',
      collisionEvidence: collisionEvidenceForAlternative(collisionEvidence, item.candidate.id, item.index),
      solverEvidence: ['selected by global acyclic topology solver', `alternative ${item.index + 1}`, `score ${item.score.toFixed(6)}`],
    };
  });
  const disconnectedGroupIds = groupIds.filter(id => !reachableFromRoot.has(id));
  return {
    joints,
    completeTree: best.completeTree,
    score: best.score,
    rootGroupId,
    selectedAlternatives: best.selected.map(item => ({ candidateId: item.candidate.id, alternativeIndex: item.index, left: item.left, right: item.right, score: item.score })),
    unresolvedCandidateIds: [...new Set([...best.skipped, ...(candidates || []).filter(item => ['UNRESOLVED', 'INVALID'].includes(item.verificationStatus)).map(item => item.id)])],
    disconnectedGroupIds,
    searchExhaustive,
    searchDiagnostics: { nodesVisited, branchesPruned, maxSearchNodes },
    evidence: [
      'one topology alternative per actuator is evaluated globally',
      'self edges and undirected cycles are rejected before parent/child orientation',
      'collision contributes a bounded penalty and never verifies a candidate',
      searchExhaustive ? 'global topology search completed exhaustively' : `global topology search stopped at ${maxSearchNodes} nodes; result is provisional`,
    ],
  };
}
