import { createEmptyRobotModel } from './robot-model.mjs';
import { assignServoRolesToGroups } from './servo-role-assignment.mjs';

const clone = value => structuredClone(value);
const finiteTuple = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

function normalizeAxis(axis) {
  if (!finiteTuple(axis, 3)) throw new Error('Joint axis must contain three finite values');
  const length = Math.hypot(...axis);
  if (length <= 1e-12) throw new Error('Joint axis must be non-zero');
  return axis.map(value => Math.abs(value / length) < 1e-15 ? 0 : value / length);
}

function markUserModified(target, source = 'user') {
  target.source = source;
  target.lastModifiedBy = 'user';
  target.reviewRequired = false;
}

function safeName(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, match => `_${match}`);
  return normalized || fallback;
}

function uniqueName(base, used) {
  let value = base;
  let suffix = 2;
  while (used.has(value)) value = `${base}_${suffix++}`;
  used.add(value);
  return value;
}

export function createRobotModelFromAssembly(assembly, jobId) {
  const model = createEmptyRobotModel(jobId);
  model.mirroredOccurrences = assembly.occurrences.filter(item => item.transformDiagnostics?.mirrored).map(item => ({
    occurrenceId: item.id,
    determinant: item.transformDiagnostics.determinant,
    meshBaked: item.meshReflectionBaked === true && item.meshTransformDiagnostics?.mirrored === false,
    mesh: item.mesh || null,
  }));
  const used = new Set();
  const parts = assembly.occurrences.filter(item => item.kind === 'part');
  model.rigidGroups = parts.map((occurrence, index) => ({
    id: `group-${index + 1}`,
    name: uniqueName(safeName(occurrence.name, `link_${index + 1}`), used),
    occurrenceIds: [occurrence.id],
    confidence: 'LOW',
    evidence: ['created from one STEP part occurrence; rigid connections are not yet inferred'],
    reviewRequired: true,
    source: 'automatic_step_occurrence',
    lastModifiedBy: 'automatic_system',
    provenance: { source: 'automatic_step_occurrence', reviewRequired: true },
  }));
  model.rootLinkId = model.rigidGroups[0]?.id || null;
  return model;
}

export function createRobotModelFromAnalysis(assembly, candidates = {}, jobId) {
  const model = createRobotModelFromAssembly(assembly, jobId);
  model.servoTemplates = clone(candidates.servoTemplates || []);
  model.servoInstances = clone(candidates.servoInstances || []);
  const groupByOccurrence = new Map(model.rigidGroups.flatMap(group => group.occurrenceIds.map(id => [id, group.id])));
  let contactMergesApplied = 0;
  for (const contactGroup of candidates.contactRigidGroups || []) {
    const groupIds = [...new Set(contactGroup.occurrenceIds.map(id => groupByOccurrence.get(id)).filter(Boolean))];
    if (groupIds.length < 2) continue;
    const selected = model.rigidGroups.filter(group => groupIds.includes(group.id));
    const survivor = selected[0];
    survivor.occurrenceIds = [...new Set(selected.flatMap(group => group.occurrenceIds))];
    survivor.confidence = contactGroup.confidence || 'MEDIUM';
    survivor.evidence = [...(contactGroup.evidence || []), 'joint-aware contact grouping applied before joint construction'];
    survivor.reviewRequired = contactGroup.reviewRequired !== false;
    survivor.source = 'automatic_joint_aware_contact_grouping';
    const removed = new Set(selected.slice(1).map(group => group.id));
    model.rigidGroups = model.rigidGroups.filter(group => !removed.has(group.id));
    for (const occurrenceId of survivor.occurrenceIds) groupByOccurrence.set(occurrenceId, survivor.id);
    contactMergesApplied += selected.length - 1;
  }
  const root = candidates?.rootRecommendation;
  const initialRootGroupId = groupByOccurrence.get(root?.occurrenceId);
  if (initialRootGroupId) {
    model.rootLinkId = initialRootGroupId;
    model.rootSelection = {
      confidence: root.confidence || 'LOW', evidence: clone(root.evidence || []),
      reviewRequired: root.reviewRequired !== false,
      source: 'automatic_root_candidate', lastModifiedBy: 'automatic_system',
    };
  }
  const rootOccurrence = assembly.occurrences.find(item => item.id === root?.occurrenceId);
  const rootTransform = rootOccurrence?.sourceTransformMeters || rootOccurrence?.worldTransformMeters;
  const rootPosition = Array.isArray(rootTransform) && rootTransform.length >= 12
    ? [rootTransform[3], rootTransform[7], rootTransform[11]]
    : [0, 0, 0];
  const orderedCandidates = [...(candidates?.jointCandidates || [])].sort((left, right) => {
    const distance = item => Math.hypot(...item.originMeters.map((value, index) => value - rootPosition[index]));
    return distance(left) - distance(right);
  });
  const usedNames = new Set();
  let skipped = 0;
  let rigidMergesApplied = 0;
  const graphState = () => {
    const incoming = new Set(model.joints.map(joint => joint.childLinkId));
    const outgoing = new Map(model.rigidGroups.map(group => [group.id, []]));
    for (const joint of model.joints) outgoing.get(joint.parentLinkId)?.push(joint.childLinkId);
    const currentRoot = groupByOccurrence.get(root?.occurrenceId) || model.rootLinkId;
    const reachable = new Set();
    const visit = id => {
      if (!id || reachable.has(id)) return;
      reachable.add(id);
      for (const child of outgoing.get(id) || []) visit(child);
    };
    visit(currentRoot);
    return { incoming, outgoing, reachable };
  };
  const pathExists = (outgoing, start, target) => {
    const visited = new Set();
    const visit = id => {
      if (id === target) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return (outgoing.get(id) || []).some(visit);
    };
    return visit(start);
  };
  for (const candidate of orderedCandidates) {
    const beforeCandidate = {
      rigidGroups: clone(model.rigidGroups), joints: clone(model.joints),
      rootLinkId: model.rootLinkId, groupByOccurrence: new Map(groupByOccurrence),
      rigidMergesApplied,
    };
    const rollbackCandidate = () => {
      model.rigidGroups = beforeCandidate.rigidGroups;
      model.joints = beforeCandidate.joints;
      model.rootLinkId = beforeCandidate.rootLinkId;
      groupByOccurrence.clear();
      for (const [occurrenceId, groupId] of beforeCandidate.groupByOccurrence) groupByOccurrence.set(occurrenceId, groupId);
      rigidMergesApplied = beforeCandidate.rigidMergesApplied;
    };
    let { incoming, outgoing, reachable } = graphState();
    const alternatives = candidate.topologyAlternatives || [];
    const topology = [...alternatives].sort((left, right) => {
      const score = item => {
        const parent = groupByOccurrence.get(item.parentOccurrenceId);
        const child = groupByOccurrence.get(item.childOccurrenceId);
        return (incoming.has(child) ? 100 : 0) + (reachable.has(parent) ? 0 : 10) + (reachable.has(child) ? 5 : 0) + (child === initialRootGroupId ? 50 : 0);
      };
      return score(left) - score(right);
    })[0];
    let parentLinkId = candidate.parentLinkId || groupByOccurrence.get(topology?.parentOccurrenceId);
    let childLinkId = candidate.childLinkId || groupByOccurrence.get(topology?.childOccurrenceId);
    let axis;
    try { axis = normalizeAxis(candidate.axis); } catch { skipped += 1; continue; }
    if (!parentLinkId || !childLinkId || parentLinkId === childLinkId || !finiteTuple(candidate.originMeters, 3)) {
      skipped += 1;
      continue;
    }
    const actuatorGroupId = groupByOccurrence.get(candidate.actuatorOccurrenceId);
    if (actuatorGroupId && actuatorGroupId !== parentLinkId && actuatorGroupId !== childLinkId) {
      const actuatorGroup = model.rigidGroups.find(group => group.id === actuatorGroupId);
      const parentGroup = model.rigidGroups.find(group => group.id === parentLinkId);
      if (actuatorGroup && parentGroup && actuatorGroup.occurrenceIds.includes(candidate.actuatorOccurrenceId)) {
        const remap = id => id === actuatorGroupId ? parentLinkId : id;
        const wouldCollapseJoint = model.joints.some(joint => remap(joint.parentLinkId) === remap(joint.childLinkId));
        if (wouldCollapseJoint) {
          skipped += 1;
          continue;
        }
        actuatorGroup.occurrenceIds = actuatorGroup.occurrenceIds.filter(id => id !== candidate.actuatorOccurrenceId);
        parentGroup.occurrenceIds.push(candidate.actuatorOccurrenceId);
        parentGroup.confidence = candidate.confidence || 'LOW';
        parentGroup.reviewRequired = true;
        parentGroup.source = 'automatic_actuator_fixed_side_grouping';
        parentGroup.lastModifiedBy = 'automatic_system';
        parentGroup.evidence = [...(parentGroup.evidence || []), `candidate ${candidate.id}: actuator body assigned to inferred fixed side`];
        groupByOccurrence.set(candidate.actuatorOccurrenceId, parentLinkId);
        if (!actuatorGroup.occurrenceIds.length) {
          for (const joint of model.joints) {
            joint.parentLinkId = remap(joint.parentLinkId);
            joint.childLinkId = remap(joint.childLinkId);
            joint.movingSideLinkId = joint.childLinkId;
          }
          model.rigidGroups = model.rigidGroups.filter(group => group.id !== actuatorGroupId);
          if (model.rootLinkId === actuatorGroupId) model.rootLinkId = parentLinkId;
        }
        rigidMergesApplied += 1;
      }
    }
    parentLinkId = groupByOccurrence.get(topology?.parentOccurrenceId) || parentLinkId;
    childLinkId = groupByOccurrence.get(topology?.childOccurrenceId) || childLinkId;
    ({ incoming, outgoing, reachable } = graphState());
    if (parentLinkId === childLinkId || incoming.has(childLinkId) || pathExists(outgoing, childLinkId, parentLinkId)) {
      rollbackCandidate();
      skipped += 1;
      continue;
    }
    const movingSideLinkId = childLinkId;
    incoming.add(childLinkId);
    reachable.add(parentLinkId);
    reachable.add(childLinkId);
    const index = model.joints.length + 1;
    const actuatorName = safeName(candidate.actuatorOccurrenceId, `candidate_${index}`);
    const templateVerified = candidate.verificationStatus === 'TEMPLATE_VERIFIED';
    model.joints.push({
      id: `joint-${index}`,
      name: uniqueName(`joint_${actuatorName}`, usedNames),
      type: 'revolute', parentLinkId, childLinkId, movingSideLinkId,
      originMeters: [...candidate.originMeters], axis,
      confidence: candidate.confidence || 'LOW',
      verificationStatus: candidate.verificationStatus || (candidate.reviewRequired === true ? 'UNRESOLVED' : 'AUTOMATIC_UNVERIFIED'),
      evidence: clone(candidate.evidence || []),
      reviewRequired: ['UNRESOLVED', 'INVALID'].includes(candidate.verificationStatus) || candidate.reviewRequired === true,
      source: candidate.source || 'automatic_brep_candidate', lastModifiedBy: candidate.lastModifiedBy || 'automatic_system',
      originSource: candidate.axisFaceId ? 'automatic_brep_face' : candidate.axisEdgeId ? 'automatic_brep_edge' : 'automatic_candidate',
      candidateId: candidate.id,
      templateId: candidate.templateId || null,
      usesTemplate: candidate.usesTemplate === true,
      overrides: clone(candidate.overrides || {}),
      actuatorOccurrenceId: candidate.actuatorOccurrenceId,
      actuationMode: groupByOccurrence.get(candidate.actuatorOccurrenceId) === parentLinkId ? 'direct' : 'reaction',
      limits: { lowerRadians: null, upperRadians: null, source: 'unset' },
      confirmation: { axis: templateVerified, topology: templateVerified, movingSide: templateVerified, limits: false },
      motionVerification: {
        posesTestedDegrees: [],
        movingPartsCorrect: false, pivotCorrect: false, directionCorrect: false,
      },
    });
  }
  const rootGroupId = groupByOccurrence.get(root?.occurrenceId);
  if (rootGroupId && model.rigidGroups.some(group => group.id === rootGroupId)) {
    model.rootLinkId = rootGroupId;
    model.rootSelection = {
      confidence: root.confidence || 'LOW', evidence: clone(root.evidence || []),
      reviewRequired: root.reviewRequired !== false,
      source: 'automatic_root_candidate', lastModifiedBy: 'automatic_system',
    };
  } else if (!model.rigidGroups.some(group => group.id === model.rootLinkId)) {
    model.rootLinkId = model.rigidGroups[0]?.id || null;
  }
  model.automation = {
    engineVersion: 4,
    jointCandidatesReceived: candidates?.jointCandidates?.length || 0,
    jointsApplied: model.joints.length,
    candidatesSkipped: skipped,
    rigidMergesApplied,
    contactMergesApplied,
    rigidGroupStrategy: 'actuator_body_is_grouped_with_inferred_fixed_side; all other contacts remain reviewable',
  };
  return model;
}

export class RobotEditor {
  constructor(model) {
    this.model = clone(model);
    this.undoStack = [];
    this.redoStack = [];
  }

  change(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('RobotEditor.change requires a mutator function');
    const before = clone(this.model);
    const candidate = clone(this.model);
    mutator(candidate);
    this.undoStack.push(before);
    this.redoStack.length = 0;
    this.model = candidate;
    return this.model;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(clone(this.model));
    this.model = this.undoStack.pop();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(clone(this.model));
    this.model = this.redoStack.pop();
    return true;
  }

  renameLink(groupId, name) {
    return this.change(model => {
      const group = model.rigidGroups.find(item => item.id === groupId);
      if (!group) throw new Error(`Unknown rigid group ${groupId}`);
      const clean = safeName(name, 'link');
      if (model.rigidGroups.some(item => item.id !== groupId && item.name === clean)) throw new Error(`Duplicate link name ${clean}`);
      group.name = clean;
      markUserModified(group, 'user_renamed');
    });
  }

  mergeGroups(groupIds, name) {
    if (!Array.isArray(groupIds) || groupIds.length < 2) throw new Error('Select at least two rigid groups to merge');
    return this.change(model => {
      const selected = model.rigidGroups.filter(group => groupIds.includes(group.id));
      if (selected.length !== groupIds.length) throw new Error('Unknown rigid group in merge');
      const survivor = selected[0];
      const mergedName = safeName(name, survivor.name);
      if (model.rigidGroups.some(item => !groupIds.includes(item.id) && item.name === mergedName)) throw new Error(`Duplicate link name ${mergedName}`);
      survivor.name = mergedName;
      survivor.occurrenceIds = [...new Set(selected.flatMap(group => group.occurrenceIds))];
      const removed = new Set(selected.slice(1).map(group => group.id));
      if (model.joints.some(joint => removed.has(joint.parentLinkId) || removed.has(joint.childLinkId))) {
        throw new Error('Remove or reassign joints before merging referenced groups');
      }
      model.rigidGroups = model.rigidGroups.filter(group => !removed.has(group.id));
      if (removed.has(model.rootLinkId)) model.rootLinkId = survivor.id;
      survivor.confidence = 'HIGH';
      survivor.evidence = ['user explicitly merged rigid groups'];
      markUserModified(survivor, 'user_merged');
    });
  }

  splitOccurrence(groupId, occurrenceId, name) {
    return this.change(model => {
      const group = model.rigidGroups.find(item => item.id === groupId);
      if (!group?.occurrenceIds.includes(occurrenceId) || group.occurrenceIds.length < 2) throw new Error('Occurrence cannot be split from this group');
      group.occurrenceIds = group.occurrenceIds.filter(id => id !== occurrenceId);
      const next = Math.max(0, ...model.rigidGroups.map(item => Number(item.id.match(/\d+$/)?.[0]) || 0)) + 1;
      model.rigidGroups.push({
        id: `group-${next}`, name: safeName(name, `link_${next}`), occurrenceIds: [occurrenceId],
        confidence: 'HIGH', evidence: ['user explicitly split this occurrence from a rigid group'],
        reviewRequired: false, source: 'user_split', lastModifiedBy: 'user',
        provenance: { source: 'user_split', reviewRequired: false },
      });
      group.evidence = [...(group.evidence || []), `user split occurrence ${occurrenceId}`];
      markUserModified(group, 'user_split_remaining_group');
    });
  }

  setRoot(groupId) {
    return this.change(model => {
      if (!model.rigidGroups.some(group => group.id === groupId)) throw new Error(`Unknown root ${groupId}`);
      model.rootLinkId = groupId;
      model.rootSelection = { confidence: 'HIGH', evidence: ['user selected the fixed base'], reviewRequired: false, source: 'user_selected', lastModifiedBy: 'user' };
    });
  }

  addJoint({ name, parentLinkId, childLinkId, originMeters, axis, evidence = {} }) {
    return this.change(model => {
      if (parentLinkId === childLinkId) throw new Error('Joint parent and child must differ');
      const next = Math.max(0, ...model.joints.map(item => Number(item.id.match(/\d+$/)?.[0]) || 0)) + 1;
      model.joints.push({
        id: `joint-${next}`, name: safeName(name, `joint_${next}`), type: 'revolute',
        parentLinkId, childLinkId, movingSideLinkId: childLinkId,
        originMeters: [...originMeters], axis: normalizeAxis(axis), evidence: clone(evidence),
        confidence: 'HIGH', reviewRequired: false,
        source: 'user_created', lastModifiedBy: 'user', originSource: 'selected_axis',
        limits: { lowerRadians: null, upperRadians: null, source: 'unset' },
        confirmation: { axis: true, topology: true, movingSide: true, limits: false },
      });
    });
  }

  renameJoint(jointId, name) {
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      const clean = safeName(name, 'joint');
      if (model.joints.some(item => item.id !== jointId && item.name === clean)) throw new Error(`Duplicate joint name ${clean}`);
      joint.name = clean;
      markUserModified(joint, 'user_renamed');
    });
  }

  setJointTopology(jointId, parentLinkId, childLinkId) {
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      if (parentLinkId === childLinkId) throw new Error('Joint parent and child must differ');
      if (!model.rigidGroups.some(group => group.id === parentLinkId)) throw new Error(`Unknown parent link ${parentLinkId}`);
      if (!model.rigidGroups.some(group => group.id === childLinkId)) throw new Error(`Unknown child link ${childLinkId}`);
      joint.parentLinkId = parentLinkId;
      joint.childLinkId = childLinkId;
      joint.movingSideLinkId = childLinkId;
      joint.confirmation.topology = true;
      joint.confirmation.movingSide = true;
      markUserModified(joint, 'user_topology');
      joint.reviewRequired = true;
    });
  }

  setJointActuationMode(jointId, mode) {
    if (!['direct', 'reaction'].includes(mode)) throw new Error('Actuation mode must be direct or reaction');
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      const roleAssignment = assignServoRolesToGroups(model, joint, mode);
      if (roleAssignment.applied) {
        joint.movingSideLinkId = joint.childLinkId;
        joint.actuationMode = mode;
        joint.overrides = { ...(joint.overrides || {}), actuationMode: mode };
        joint.confirmation.topology = true;
        joint.confirmation.movingSide = true;
        joint.reviewRequired = true;
        joint.source = 'user_selected_actuation_mode';
        joint.lastModifiedBy = 'user';
        joint.evidence = Array.isArray(joint.evidence)
          ? [...joint.evidence, `user assigned complete multipart servo roles for ${mode} mounting`]
          : { ...(joint.evidence || {}), actuationModeSelectedByUser: mode, multipartRolesAssigned: true };
        return;
      }
      const actuatorGroup = model.rigidGroups.find(group => group.occurrenceIds.includes(joint.actuatorOccurrenceId));
      if (!actuatorGroup) throw new Error('无法定位这个舵机本体所在的结构，请在高级模式中修改固定侧和运动侧');
      const desiredGroupId = mode === 'direct' ? joint.parentLinkId : joint.childLinkId;
      const desiredGroup = model.rigidGroups.find(group => group.id === desiredGroupId);
      if (!desiredGroup) throw new Error('这个关节的固定侧或运动侧不存在');
      if (actuatorGroup.id !== desiredGroup.id) {
        if (actuatorGroup.occurrenceIds.length <= 1) {
          throw new Error('舵机本体当前是单独结构，不能自动移动后留下空 Link；请先合并正确的相邻结构');
        }
        actuatorGroup.occurrenceIds = actuatorGroup.occurrenceIds.filter(id => id !== joint.actuatorOccurrenceId);
        desiredGroup.occurrenceIds = [...new Set([...desiredGroup.occurrenceIds, joint.actuatorOccurrenceId])];
        actuatorGroup.evidence = [...(actuatorGroup.evidence || []), `user moved actuator ${joint.actuatorOccurrenceId} to ${desiredGroup.name}`];
        desiredGroup.evidence = [...(desiredGroup.evidence || []), `user assigned actuator ${joint.actuatorOccurrenceId} here for ${mode} actuation`];
        actuatorGroup.lastModifiedBy = desiredGroup.lastModifiedBy = 'user';
      }
      joint.movingSideLinkId = joint.childLinkId;
      joint.actuationMode = mode;
      joint.overrides = { ...(joint.overrides || {}), actuationMode: mode };
      joint.confirmation.topology = true;
      joint.confirmation.movingSide = true;
      joint.reviewRequired = true;
      joint.source = 'user_selected_actuation_mode';
      joint.lastModifiedBy = 'user';
      const explanation = mode === 'direct'
        ? 'user selected: servo body fixed, output disc drives the child structure'
        : 'user selected: output side fixed, reaction torque moves the servo body and child structure';
      joint.evidence = Array.isArray(joint.evidence)
        ? [...joint.evidence, explanation]
        : { ...(joint.evidence || {}), actuationModeSelectedByUser: mode };
    });
  }

  reverseJointAxis(jointId) {
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      joint.axis = joint.axis.map(value => value === 0 ? 0 : -value);
      joint.overrides = { ...(joint.overrides || {}), axisDirectionReversed: !joint.overrides?.axisDirectionReversed };
      joint.axisDirectionStatus = 'USER_CONFIRMED';
      joint.confirmation.axis = true;
      joint.evidence = { ...(joint.evidence || {}), directionReversedByUser: true };
      markUserModified(joint, 'user_reversed_axis');
      joint.reviewRequired = true;
    });
  }

  setJointAxis(jointId, { originMeters, axis, evidence = {}, source = 'user_selected_brep' }) {
    if (!finiteTuple(originMeters, 3)) throw new Error('Joint axis origin must contain three finite metre values');
    const normalized = normalizeAxis(axis);
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      joint.originMeters = [...originMeters];
      joint.axis = normalized;
      joint.overrides = { ...(joint.overrides || {}), originMeters: [...originMeters], axis: normalized, outputFaceId: evidence.faceId || null, outputEdgeId: evidence.edgeId || null };
      joint.evidence = clone(evidence);
      joint.confidence = 'HIGH';
      joint.confirmation.axis = true;
      joint.originSource = source;
      markUserModified(joint, source);
      joint.reviewRequired = true;
    });
  }

  setJointOrigin(jointId, originMeters) {
    if (!finiteTuple(originMeters, 3)) throw new Error('Joint origin must contain three finite metre values');
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      joint.originMeters = [...originMeters];
      joint.originSource = 'user_numeric';
      joint.evidence = { ...(joint.evidence || {}), originEditedByUser: true };
      markUserModified(joint, 'user_origin');
      joint.reviewRequired = true;
    });
  }

  deleteJoint(jointId) {
    return this.change(model => {
      const index = model.joints.findIndex(item => item.id === jointId);
      if (index < 0) throw new Error(`Unknown joint ${jointId}`);
      model.joints.splice(index, 1);
    });
  }

  confirmJoint(jointId) {
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      const motion = joint.motionVerification;
      if (!motion || ![0, 5, -5].every(value => motion.posesTestedDegrees?.includes(value))
        || !motion.movingPartsCorrect || !motion.pivotCorrect || !motion.directionCorrect) {
        throw new Error('Complete q=0°, +5°, -5° and confirm moving parts, pivot and direction separately');
      }
      joint.reviewRequired = false;
      joint.verificationStatus = 'USER_VERIFIED';
      joint.confirmation.axis = true;
      joint.confirmation.topology = true;
      joint.confirmation.movingSide = true;
      joint.lastModifiedBy = 'user';
      joint.source = joint.source === 'automatic_brep_candidate' ? 'user_confirmed_automatic_candidate' : joint.source;
      joint.evidence = Array.isArray(joint.evidence)
        ? [...joint.evidence, 'user visually confirmed axis, topology and moving side']
        : { ...(joint.evidence || {}), visuallyConfirmedByUser: true };
    });
  }

  recordJointReviewPose(jointId, degrees) {
    if (![0, 5, -5].includes(degrees)) throw new Error('Motion review pose must be 0°, +5° or -5°');
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      joint.motionVerification ||= { posesTestedDegrees: [], movingPartsCorrect: false, pivotCorrect: false, directionCorrect: false };
      joint.motionVerification.posesTestedDegrees = [...new Set([...joint.motionVerification.posesTestedDegrees, degrees])];
      joint.lastModifiedBy = 'user';
    });
  }

  confirmJointMotionAspect(jointId, aspect) {
    if (!['movingPartsCorrect', 'pivotCorrect', 'directionCorrect'].includes(aspect)) throw new Error(`Unknown motion verification aspect ${aspect}`);
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      joint.motionVerification ||= { posesTestedDegrees: [], movingPartsCorrect: false, pivotCorrect: false, directionCorrect: false };
      joint.motionVerification[aspect] = true;
      const posesComplete = [0, 5, -5].every(value => joint.motionVerification.posesTestedDegrees.includes(value));
      const aspectsComplete = ['movingPartsCorrect', 'pivotCorrect', 'directionCorrect'].every(key => joint.motionVerification[key]);
      if (posesComplete && aspectsComplete) {
        joint.verificationStatus = 'USER_VERIFIED';
        joint.reviewRequired = false;
        joint.confirmation.axis = true;
        joint.confirmation.topology = true;
        joint.confirmation.movingSide = true;
      }
      if (aspect === 'directionCorrect') joint.axisDirectionStatus = 'USER_CONFIRMED';
      joint.lastModifiedBy = 'user';
      joint.source = 'user_motion_verified';
    });
  }

  setJointLimitsDegrees(jointId, lower, upper) {
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) throw new Error('Joint limits require finite lower < upper');
    if (!(lower <= 0 && upper >= 0)) throw new Error('Current STEP zero pose must lie within the joint limits');
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      joint.limits = { lowerRadians: lower * Math.PI / 180, upperRadians: upper * Math.PI / 180, source: 'user' };
      joint.confirmation.limits = true;
      joint.lastModifiedBy = 'user';
    });
  }

  setJointDynamics(jointId, effort, velocity) {
    if (!Number.isFinite(effort) || effort <= 0 || !Number.isFinite(velocity) || velocity <= 0) {
      throw new Error('Joint dynamics require positive effort and velocity values');
    }
    return this.change(model => {
      const joint = model.joints.find(item => item.id === jointId);
      if (!joint) throw new Error(`Unknown joint ${jointId}`);
      joint.dynamics = { effort, velocity, source: 'user' };
      joint.lastModifiedBy = 'user';
    });
  }
}
