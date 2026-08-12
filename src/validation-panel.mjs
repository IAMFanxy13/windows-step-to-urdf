export function groupValidationIssues(issues) {
  return ['BLOCKER', 'WARNING', 'INFO'].map(severity => ({ severity, issues: issues.filter(item => item.severity === severity) }));
}

export function exportBlockedByVerificationStatuses(model) {
  const invalid = model.joints.filter(joint => ['UNRESOLVED', 'INVALID'].includes(joint.verificationStatus));
  return { blocked: invalid.length > 0, invalidJointIds: invalid.map(item => item.id) };
}
