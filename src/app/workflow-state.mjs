export const WORKFLOW_STAGES = Object.freeze([
  { id: 'IMPORT', number: 1, label: '打开机器人模型' },
  { id: 'ANALYZE', number: 2, label: '自动分析' },
  { id: 'RESULTS', number: 3, label: '查看识别结果' },
  { id: 'REVIEW', number: 4, label: '处理需要检查的位置' },
  { id: 'MOTION_TEST', number: 5, label: '测试机器人运动' },
  { id: 'EXPORT', number: 6, label: '导出机器人文件' },
]);

const taskFor = stage => ({
  IMPORT: { title: '导入完整机器人 STEP', action: 'SELECT_STEP', reason: '需要装配结构和精确 B-Rep 才能恢复运动接口', next: '软件将自动分析装配', blocksExport: true },
  ANALYZE: { title: '正在自动分析', action: 'WAIT_OR_RETRY', reason: '软件正在解析装配、机构、接触关系和运动树', next: '查看自动识别结果', blocksExport: true },
  RESULTS: { title: '查看自动识别摘要', action: 'REVIEW_SUMMARY', reason: '先了解自动完成和风险项目，不需要逐项配置', next: '只检查异常', blocksExport: true },
  REVIEW: { title: '处理最高风险异常', action: 'FIX_NEXT_ANOMALY', reason: '未解决拓扑或非法几何不能进入正式 URDF', next: '运动测试与限位', blocksExport: true },
  MOTION_TEST: { title: '测试机器人运动', action: 'VERIFY_MOTION', reason: '逐个小幅转动可发现错误运动侧、轴心或方向', next: '查看导出前总结', blocksExport: true },
  EXPORT: { title: '导出机器人文件', action: 'REVIEW_AND_EXPORT', reason: '预览模型与已验证工程模型使用不同门禁', next: '保存工程或下载 URDF 与 meshes', blocksExport: true },
}[stage]);

export function migrateWorkflowSnapshot(snapshot = {}) {
  const copy = structuredClone(snapshot);
  if ((copy.schemaVersion ?? 1) < 2) {
    if (copy.currentStage === 'TEST_EXPORT') copy.currentStage = 'MOTION_TEST';
    copy.completedStages = (copy.completedStages || []).map(stage => stage === 'TEST_EXPORT' ? 'MOTION_TEST' : stage);
    copy.schemaVersion = 2;
  }
  return copy;
}

export function createWorkflowState(overrides = {}) {
  overrides = migrateWorkflowSnapshot(overrides);
  const currentStage = overrides.currentStage || 'IMPORT';
  return {
    schemaVersion: 2, currentStage, completedStages: [...(overrides.completedStages || [])],
    analysisTasks: { assembly: 'pending', mechanisms: 'pending', contacts: 'pending', tree: 'pending', ...(overrides.analysisTasks || {}) },
    counts: { blockers: 0, warnings: 0, automaticPassed: 0, ...(overrides.counts || {}) },
    mode: overrides.mode || 'novice', currentTask: taskFor(currentStage), progressPercent: overrides.progressPercent ?? 0,
  };
}

export function transitionWorkflow(state, nextStage, patch = {}) {
  const currentIndex = WORKFLOW_STAGES.findIndex(item => item.id === state.currentStage);
  const nextIndex = WORKFLOW_STAGES.findIndex(item => item.id === nextStage);
  if (nextIndex < 0) throw new Error(`Unknown workflow stage ${nextStage}`);
  if (nextIndex > currentIndex + 1) throw new Error(`Workflow cannot skip from ${state.currentStage} to ${nextStage}`);
  const completedStages = new Set(state.completedStages);
  if (patch.completedStage) completedStages.add(patch.completedStage);
  const counts = { ...state.counts, ...(patch.counts || {}) };
  const rawProgress = (completedStages.size / WORKFLOW_STAGES.length) * 100;
  const progressPercent = counts.blockers > 0 ? Math.min(99, rawProgress) : rawProgress;
  return { ...state, ...patch, currentStage: nextStage, completedStages: [...completedStages], counts, currentTask: taskFor(nextStage), progressPercent };
}

export function setAnalysisTask(state, task, status) {
  if (!Object.hasOwn(state.analysisTasks, task)) throw new Error(`Unknown analysis task ${task}`);
  return { ...state, analysisTasks: { ...state.analysisTasks, [task]: status } };
}

export function setWorkflowMode(state, mode) {
  if (!['novice', 'advanced'].includes(mode)) throw new Error(`Unknown workflow mode ${mode}`);
  return { ...state, mode };
}
