export const REVIEW_POSES_DEGREES = Object.freeze([0, 5, -5]);

export function createJointMotionReviewQueue(joints) {
  return joints.filter(joint => ['AUTOMATIC_UNVERIFIED', 'UNRESOLVED', 'INVALID'].includes(joint.verificationStatus) || joint.reviewRequired).map(joint => ({
    jointId: joint.id, jointName: joint.name, posesDegrees: [...REVIEW_POSES_DEGREES], currentPoseIndex: 0,
    confirmations: { movingPartsCorrect: false, pivotCorrect: false, directionCorrect: false },
    status: joint.verificationStatus === 'INVALID' ? 'INVALID' : 'PENDING',
  }));
}

export function confirmMotionAspect(item, aspect, value = true) {
  if (!Object.hasOwn(item.confirmations, aspect)) throw new Error(`Unknown motion confirmation ${aspect}`);
  const next = structuredClone(item); next.confirmations[aspect] = Boolean(value);
  next.status = Object.values(next.confirmations).every(Boolean) ? 'USER_VERIFIED' : 'PENDING';
  return next;
}

export function nextReviewPose(item) {
  const next = structuredClone(item); next.currentPoseIndex = (next.currentPoseIndex + 1) % next.posesDegrees.length; return next;
}

export function reviewSceneSpec(joint, model, angleDegrees) {
  const descendants = [];
  const outgoing = new Map(model.rigidGroups.map(group => [group.id, []]));
  for (const item of model.joints) outgoing.get(item.parentLinkId)?.push(item.childLinkId);
  const walk = id => { if (descendants.includes(id)) return; descendants.push(id); for (const child of outgoing.get(id) || []) walk(child); };
  walk(joint.childLinkId);
  return { angleDegrees, ghostAtZero: angleDegrees !== 0, parentLinkId: joint.parentLinkId, childLinkId: joint.childLinkId, descendantLinkIds: descendants, axis: joint.axis, originMeters: joint.originMeters, showDirection: true, showPotentialCollision: true };
}
