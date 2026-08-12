export const EXPORT_LEVELS = Object.freeze({ PREVIEW: 'PREVIEW', ENGINEERING: 'ENGINEERING' });

const PREVIEW_FATAL_CODES = new Set([
  'JOINT_AXIS_INVALID', 'JOINT_ORIGIN_INVALID', 'MESH_MISSING', 'LINK_REFERENCE_INVALID',
  'TREE_CYCLE', 'MULTIPLE_PARENT', 'PARENT_EQUALS_CHILD', 'TRANSFORM_INVALID',
]);

export function evaluateExportReadiness({ validationIssues = [], unresolvedRecognition = [], engineeringValues = {} } = {}) {
  const blockers = validationIssues.filter(issue => String(issue.severity).toUpperCase() === 'BLOCKER');
  const previewFatal = blockers.filter(issue => PREVIEW_FATAL_CODES.has(issue.code));
  const highRisk = unresolvedRecognition.filter(item => item.risk === 'high' || item.status === 'UNRESOLVED' || item.status === 'INVALID');
  const missingEngineering = [
    ['limitsComplete', '真实关节角度范围尚未完整填写'],
    ['inertialsReliable', '质量、质心或惯性仍缺少可靠来源'],
    ['hardwareLimitsReliable', 'effort 或 velocity 仍是预览占位值'],
  ].filter(([key]) => engineeringValues[key] !== true).map(([, reason]) => reason);

  return {
    [EXPORT_LEVELS.PREVIEW]: {
      allowed: previewFatal.length === 0 && highRisk.length === 0,
      blockers: [...previewFatal, ...highRisk],
      disclaimers: ['PREVIEW_ONLY', 'NOT_FOR_CONTROL_OR_SAFETY'],
    },
    [EXPORT_LEVELS.ENGINEERING]: {
      allowed: blockers.length === 0 && highRisk.length === 0 && missingEngineering.length === 0,
      blockers: [...blockers, ...highRisk, ...missingEngineering.map(message => ({ code: 'ENGINEERING_VALUE_REQUIRED', message }))],
      disclaimers: [],
    },
  };
}
