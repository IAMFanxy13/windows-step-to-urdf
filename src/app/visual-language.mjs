const stages = Object.freeze({
  IMPORT: { icon: '📥', shortLabel: '导入', accent: 'blue' },
  ANALYZE: { icon: '⏳', shortLabel: '分析', accent: 'blue' },
  RESULTS: { icon: '🤖', shortLabel: '结果', accent: 'green' },
  REVIEW: { icon: '⚠️', shortLabel: '纠错', accent: 'amber' },
  MOTION_TEST: { icon: '🎚️', shortLabel: '测试', accent: 'violet' },
  EXPORT: { icon: '📦', shortLabel: '导出', accent: 'green' },
});

const severities = Object.freeze({
  BLOCKER: { icon: '🔴', label: '必须修复' },
  WARNING: { icon: '🟡', label: '建议检查' },
  PASS: { icon: '🟢', label: '已通过' },
  INFO: { icon: '🔵', label: '提示' },
});

export const visualForStage = id => stages[id] || { icon: '•', shortLabel: '任务', accent: 'gray' };
export const visualForSeverity = severity => severities[String(severity || '').toUpperCase()] || severities.INFO;
