const item = (category, severity, targetId, title, evidence, actions, source, target = null) => ({ category, severity, targetId, title, evidence: [...evidence], actions: [...actions], source, target: structuredClone(target) });

export function buildAnomalyQueue({ model, validationIssues = [] }) {
  const blockers = [], warnings = [], passed = [], info = [];
  for (const issue of validationIssues) {
    const targetId = issue.target?.id || issue.targetId || issue.code;
    const value = item(issue.severity === 'BLOCKER' ? '阻止导出' : issue.severity === 'WARNING' ? '建议检查' : '仅供参考', issue.severity, targetId, issue.message, issue.evidence || [], issue.actions || [], 'robot_validation', issue.target || null);
    (issue.severity === 'BLOCKER' ? blockers : issue.severity === 'WARNING' ? warnings : info).push(value);
  }
  for (const joint of model?.joints || []) {
    const targetId = joint.actuatorOccurrenceId || joint.id;
    if (['UNRESOLVED', 'INVALID'].includes(joint.verificationStatus)) blockers.push(item('阻止导出', 'BLOCKER', targetId, `${joint.name || joint.id}：自动识别仍未解决`, joint.evidence || [], ['focus', 'fix-topology', 'reselect-axis'], 'template_instance_status'));
    else if (joint.verificationStatus === 'AUTOMATIC_UNVERIFIED') warnings.push(item('建议检查', 'WARNING', targetId, `${joint.name || joint.id}：证据不足，建议运动检查`, joint.evidence || [], ['focus', 'motion-review'], 'template_instance_status'));
    else if (['TEMPLATE_VERIFIED', 'USER_VERIFIED'].includes(joint.verificationStatus)) passed.push(item('已自动通过', 'PASS', targetId, `${joint.name || joint.id}：${joint.verificationStatus === 'USER_VERIFIED' ? '已人工验证' : '模板与拓扑匹配'}`, joint.evidence || [], ['inspect-evidence'], 'template_instance_status'));
  }
  for (const mirror of model?.mirroredOccurrences || []) if (!mirror.meshBaked) blockers.push(item('阻止导出', 'BLOCKER', mirror.occurrenceId, `${mirror.occurrenceId}：镜像变换尚未烘焙为右手 mesh`, [`determinant=${mirror.determinant}`], ['focus', 'inspect-mirror'], 'transform_validation'));
  const dedupe = values => [...new Map(values.map(value => [`${value.severity}:${value.targetId}:${value.title}`, value])).values()];
  return { blockers: dedupe(blockers), warnings: dedupe(warnings), passed: dedupe(passed), info: dedupe(info) };
}
