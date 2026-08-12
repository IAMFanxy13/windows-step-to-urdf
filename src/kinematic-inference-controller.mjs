import { applyFunctionalTemplate } from './servo-functional-template.mjs';
import { deriveRigidGroupsFromContactGraph } from './contact-graph-controller.mjs';
import { createRobotModelFromAssembly } from './editor-store.mjs';
import { solveKinematicTree } from './global-kinematic-solver.mjs';

const clone = value => structuredClone(value);

function applyConfirmedTemplates(assembly, analysisCandidates, confirmedTemplates) {
  const withExplicitStatus = candidates => candidates.map(candidate => ({
    ...candidate,
    verificationStatus: candidate.verificationStatus
      || (candidate.reviewRequired === true ? 'UNRESOLVED' : 'AUTOMATIC_UNVERIFIED'),
  }));
  if (!confirmedTemplates?.length) return withExplicitStatus(clone(analysisCandidates.jointCandidates || []));
  const coveredDefinitions = new Set(confirmedTemplates.flatMap(template => template.componentDefinitionIds || [template.definitionId]));
  const untouched = (analysisCandidates.jointCandidates || []).filter(candidate => !coveredDefinitions.has(candidate.definitionId));
  const templated = confirmedTemplates.flatMap(template => applyFunctionalTemplate(
    template,
    assembly,
    analysisCandidates.jointCandidates || [],
    { contactGraph: assembly.contactGraph },
  ));
  return withExplicitStatus([...untouched, ...templated]);
}

function rotationalCuts(candidates) {
  const result = [];
  for (const candidate of candidates) {
    const housing = candidate.housingSideOccurrenceIds || [];
    const output = candidate.outputSideOccurrenceIds || [];
    const actuator = candidate.actuatorOccurrenceId;
    if (actuator) for (const outputOccurrenceId of output) result.push([actuator, outputOccurrenceId]);
    for (const left of housing) for (const right of output) result.push([left, right]);
    if (!housing.length || !output.length) {
      for (const alternative of (candidate.topologyAlternatives || []).slice(0, 1)) {
        if (alternative.parentOccurrenceId && alternative.childOccurrenceId) result.push([alternative.parentOccurrenceId, alternative.childOccurrenceId]);
      }
    }
  }
  return result;
}

function fixedHousingPairs(candidates) {
  const result = [];
  for (const candidate of candidates) {
    const classification = candidate.outputPortContactClassification || {};
    const exactHousingContact = String(classification.method || '').startsWith('CONFIRMED_TEMPLATE_PORT_TO_EXACT_BREP_')
      ? Number.isFinite(classification.housingDistanceMeters)
      : String(classification.method || '').startsWith('EXACT_BREP_') && classification.confidence === 'HIGH';
    if (!exactHousingContact || !candidate.actuatorOccurrenceId) continue;
    for (const housingOccurrenceId of candidate.housingSideOccurrenceIds || []) result.push({
      a: candidate.actuatorOccurrenceId,
      b: housingOccurrenceId,
      evidence: [classification.method, 'housing is the non-output contact of the confirmed servo functional interface'],
    });
  }
  return result;
}

function assignOrphanSinglePartActuators(groups, solver) {
  const next = clone(groups);
  const byId = new Map(next.map(group => [group.id, group]));
  const byOccurrence = new Map(next.flatMap(group => group.occurrenceIds.map(id => [id, group.id])));
  let changed = false;
  for (const joint of solver.joints) {
    const actuatorId = joint.actuatorOccurrenceId;
    const componentIds = joint.componentOccurrenceIds || (actuatorId ? [actuatorId] : []);
    if (!actuatorId || componentIds.length !== 1) continue;
    const sourceId = byOccurrence.get(actuatorId);
    const targetId = joint.actuationMode === 'reaction' ? joint.childLinkId : joint.parentLinkId;
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const source = byId.get(sourceId), target = byId.get(targetId);
    if (!source || !target || !source.occurrenceIds.includes(actuatorId)) continue;
    source.occurrenceIds = source.occurrenceIds.filter(id => id !== actuatorId);
    target.occurrenceIds = [...new Set([...target.occurrenceIds, actuatorId])];
    target.evidence = [...(target.evidence || []), `${actuatorId} assigned to the ${joint.actuationMode === 'reaction' ? 'moving housing' : 'fixed housing'} side for the movable draft`];
    target.mergeEvidence = [...(target.mergeEvidence || []), {
      edgeId: `actuator-side:${actuatorId}`, a: actuatorId, b: target.occurrenceIds.find(id => id !== actuatorId) || targetId,
      classification: joint.verificationStatus === 'AUTOMATIC_UNVERIFIED' ? 'FIXED_PROVISIONAL' : 'FIXED_CONFIRMED',
      evidence: ['servo identity and output port are confirmed', `actuation mode ${joint.actuationMode || 'direct'} determines the housing side`],
    }];
    if (joint.verificationStatus === 'AUTOMATIC_UNVERIFIED') target.reviewRequired = true;
    byOccurrence.set(actuatorId, targetId);
    changed = true;
  }
  return { groups: next.filter(group => group.occurrenceIds.length), changed };
}

function normalizeSolvedJoint(joint, index) {
  const templateVerified = joint.verificationStatus === 'TEMPLATE_VERIFIED';
  return {
    ...joint,
    name: joint.name || `joint_${String(index + 1).padStart(3, '0')}`,
    type: 'revolute',
    reviewRequired: ['UNRESOLVED', 'INVALID'].includes(joint.verificationStatus),
    originSource: joint.axisEdgeId ? 'template_brep_edge' : joint.axisFaceId ? 'template_brep_face' : 'automatic_candidate',
    limits: joint.limits || { lowerRadians: null, upperRadians: null, source: 'unset' },
    confirmation: joint.confirmation || { axis: templateVerified, topology: templateVerified, movingSide: templateVerified, limits: false },
    motionVerification: joint.motionVerification || {
      posesTestedDegrees: [], movingPartsCorrect: false, pivotCorrect: false, directionCorrect: false,
    },
  };
}

export function runKinematicInference({ assembly, analysisCandidates, confirmedTemplates = [], jobId, collisionEvidence = {} }) {
  const candidates = applyConfirmedTemplates(assembly, analysisCandidates, confirmedTemplates);
  let groups = deriveRigidGroupsFromContactGraph(assembly, assembly.contactGraph || { edges: [] }, {
    rotationalCuts: rotationalCuts(candidates),
    fixedPairs: fixedHousingPairs(candidates),
  });
  let groupByOccurrence = new Map(groups.flatMap(group => group.occurrenceIds.map(id => [id, group.id])));
  const recommendedRootOccurrenceId = analysisCandidates.rootRecommendation?.occurrenceId;
  let rootGroupId = groupByOccurrence.get(recommendedRootOccurrenceId) || groups[0]?.id || null;
  let solver = solveKinematicTree({ rigidGroups: groups, candidates, groupByOccurrence, rootGroupId, collisionEvidence });
  const actuatorAssignment = assignOrphanSinglePartActuators(groups, solver);
  if (actuatorAssignment.changed) {
    groups = actuatorAssignment.groups;
    groupByOccurrence = new Map(groups.flatMap(group => group.occurrenceIds.map(id => [id, group.id])));
    rootGroupId = groupByOccurrence.get(recommendedRootOccurrenceId) || groups[0]?.id || null;
    solver = solveKinematicTree({ rigidGroups: groups, candidates, groupByOccurrence, rootGroupId, collisionEvidence });
  }
  const model = createRobotModelFromAssembly(assembly, jobId);
  model.rigidGroups = groups;
  model.rootLinkId = rootGroupId;
  model.joints = solver.joints.map(normalizeSolvedJoint);
  model.servoTemplates = clone(confirmedTemplates);
  model.servoInstances = candidates.filter(item => item.templateId).map(item => ({
    instanceId: item.servoInstanceId || item.actuatorOccurrenceId,
    templateId: item.templateId,
    usesTemplate: true,
    overrides: clone(item.overrides || {}),
    verificationStatus: item.verificationStatus,
  }));
  model.rootSelection = {
    confidence: analysisCandidates.rootRecommendation?.confidence || 'LOW',
    evidence: clone(analysisCandidates.rootRecommendation?.evidence || ['fallback to first rigid group']),
    reviewRequired: analysisCandidates.rootRecommendation?.reviewRequired !== false,
    source: 'automatic_global_tree_root', lastModifiedBy: 'automatic_system',
  };
  model.automation = {
    engineVersion: 6,
    jointCandidatesReceived: candidates.length,
    jointsApplied: model.joints.length,
    candidatesSkipped: solver.unresolvedCandidateIds.length,
    rigidMergesApplied: groups.reduce((sum, group) => sum + Math.max(0, group.occurrenceIds.length - 1), 0),
    orphanActuatorAssignmentsApplied: actuatorAssignment.changed,
    globalSolverComplete: solver.completeTree,
    globalSolverSearchExhaustive: solver.searchExhaustive,
    rigidGroupStrategy: 'exact_interface_evidence_with_protected_rotational_cuts',
  };
  model.kinematicSolver = solver;
  const anomalies = [
    ...candidates.filter(item => ['UNRESOLVED', 'INVALID'].includes(item.verificationStatus)).map(item => ({ candidateId: item.id, type: 'candidate', status: item.verificationStatus, evidence: clone(item.evidence || []) })),
    ...solver.disconnectedGroupIds.map(groupId => ({ candidateId: null, groupId, type: 'disconnected_group', status: 'UNRESOLVED', evidence: ['group is not reachable from the recommended root'] })),
    ...(solver.searchExhaustive ? [] : [{ candidateId: null, groupId: null, type: 'solver_search_incomplete', status: 'UNRESOLVED', evidence: solver.evidence }]),
  ];
  return { model, candidates, rigidGroups: groups, solver, anomalies };
}
