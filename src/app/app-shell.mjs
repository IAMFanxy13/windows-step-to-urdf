import { renderAnalysisProgress, renderStepper } from '../components/stepper.mjs';
import { WORKFLOW_STAGES } from './workflow-state.mjs';
import { visualForSeverity, visualForStage } from './visual-language.mjs';

const instructions = Object.freeze({
  SELECT_STEP: '选择完整机器人 STEP',
  WAIT_OR_RETRY: '正在自动识别，请稍候',
  REVIEW_SUMMARY: '查看自动结果',
  FIX_NEXT_ANOMALY: '修复第一个红色项目',
  VERIFY_MOTION: '拖动当前关节',
  REVIEW_AND_EXPORT: '检查并导出',
});

export function taskPresentation(state) {
  const task = state.currentTask;
  return {
    ...visualForStage(state.currentStage),
    title: task.title,
    instruction: instructions[task.action] || '完成当前任务',
    reason: task.reason,
    next: task.next,
  };
}

const validationSeverity = severity => {
  if (severity === 'blocker' || severity === 'unexpected') return 'BLOCKER';
  if (severity === 'warning') return 'WARNING';
  if (severity === 'success') return 'PASS';
  return 'INFO';
};

export function createProductShell({ workflowController, notificationService, elements }) {
  const renderTask = state => {
    const task = state.currentTask;
    const index = WORKFLOW_STAGES.findIndex(stage => stage.id === state.currentStage) + 1;
    const view = taskPresentation(state);
    elements.taskCard.dataset.accent = view.accent;
    elements.taskCard.innerHTML = `<div class="task-hero"><span class="task-hero-icon" aria-hidden="true">${view.icon}</span><div><span class="task-index">${index}/${WORKFLOW_STAGES.length}</span><h2>${view.title}</h2></div></div><p class="task-short-instruction">${view.instruction}</p><details class="advanced-explanation"><summary>为什么？</summary><p>${view.reason}</p><p><strong>下一步：</strong>${view.next}</p></details>`;
    elements.taskCard.dataset.blocksExport = String(task.blocksExport);
  };
  workflowController.subscribe(state => { renderStepper(elements.workflowMap, state); renderAnalysisProgress(elements.analysisProgress, state); renderTask(state); document.documentElement.dataset.workflowStage = state.currentStage; });
  notificationService.subscribe(items => {
    elements.notifications.replaceChildren(); const latest = items[0]; if (!latest) return;
    const row = document.createElement('article'); row.className = `notification notice-${latest.severity}`; row.setAttribute('role', ['blocker', 'unexpected'].includes(latest.severity) ? 'alert' : 'status');
    const visual = visualForSeverity(validationSeverity(latest.severity));
    row.innerHTML = `<div class="notice-title"><span aria-hidden="true">${visual.icon}</span><strong>${latest.title}</strong></div>${latest.recommendation ? `<p class="notice-action">${latest.recommendation}</p>` : ''}<details class="advanced-explanation"><summary>详情</summary><p>${latest.whatHappened}</p>${latest.impact ? `<p><b>影响：</b>${latest.impact}</p>` : ''}</details>`;
    elements.notifications.appendChild(row);
  });
  return { render: () => workflowController.update({}) };
}
