const unique = values => [...new Set(values || [])];

function groupContaining(model, occurrenceId) {
  return model.rigidGroups.find(group => group.occurrenceIds.includes(occurrenceId));
}

export function assignServoRolesToGroups(model, joint, mode) {
  if (!['direct', 'reaction'].includes(mode)) throw new Error('Actuation mode must be direct or reaction');
  const roles = joint?.componentRoleOccurrenceIds;
  const housing = unique(roles?.housing);
  const output = unique(roles?.output);
  if (!housing.length || !output.length) return { applied: false, reason: 'multipart role sets are incomplete' };
  const parent = model.rigidGroups.find(group => group.id === joint.parentLinkId);
  const child = model.rigidGroups.find(group => group.id === joint.childLinkId);
  if (!parent || !child || parent === child) throw new Error('Servo role assignment requires distinct parent and child groups');
  const assigned = [...housing, ...output];
  for (const occurrenceId of assigned) if (!groupContaining(model, occurrenceId)) throw new Error(`Servo role occurrence ${occurrenceId} is not assigned to a rigid group`);
  for (const group of model.rigidGroups) group.occurrenceIds = group.occurrenceIds.filter(id => !assigned.includes(id));
  const parentRole = mode === 'direct' ? housing : output;
  const childRole = mode === 'direct' ? output : housing;
  parent.occurrenceIds = unique([...parent.occurrenceIds, ...parentRole]);
  child.occurrenceIds = unique([...child.occurrenceIds, ...childRole]);
  const emptied = model.rigidGroups.filter(group => group.occurrenceIds.length === 0);
  if (emptied.length) throw new Error(`Servo role assignment would leave empty links: ${emptied.map(group => group.name || group.id).join(', ')}`);
  parent.evidence = [...(parent.evidence || []), `${mode}: assigned servo ${mode === 'direct' ? 'housing' : 'output'} role upstream`];
  child.evidence = [...(child.evidence || []), `${mode}: assigned servo ${mode === 'direct' ? 'output' : 'housing'} role downstream`];
  parent.lastModifiedBy = child.lastModifiedBy = 'user';
  return { applied: true, parentOccurrenceIds: parentRole, childOccurrenceIds: childRole };
}
