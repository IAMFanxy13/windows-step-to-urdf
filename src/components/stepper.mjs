import { WORKFLOW_STAGES } from '../app/workflow-state.mjs';
import { visualForStage } from '../app/visual-language.mjs';

export function renderStepper(container, state) {
  container.replaceChildren();
  const list = document.createElement('ol'); list.className = 'product-stepper';
  for (const stage of WORKFLOW_STAGES) {
    const entry = document.createElement('li');
    const complete = state.completedStages.includes(stage.id), current = state.currentStage === stage.id;
    const visual = visualForStage(stage.id);
    entry.className = complete ? 'is-complete' : current ? 'is-current' : 'is-pending';
    if (current) entry.setAttribute('aria-current', 'step');
    entry.setAttribute('aria-label', `任务 ${stage.number}/${WORKFLOW_STAGES.length}：${stage.label}`);
    entry.dataset.accent = visual.accent;
    entry.innerHTML = `<span class="step-icon" aria-hidden="true">${complete ? '✅' : visual.icon}</span><span><small>${stage.number}/${WORKFLOW_STAGES.length}</small><strong>${visual.shortLabel}</strong><span class="advanced-only step-full-label">${stage.label}</span></span>`;
    list.appendChild(entry);
  }
  container.appendChild(list);
}

export function renderAnalysisProgress(container, state) {
  container.hidden = state.currentStage !== 'ANALYZE';
  if (container.hidden) return;
  const labels = { assembly: '解析装配', mechanisms: '查找机构', contacts: '建立接触关系', tree: '生成运动树' };
  container.replaceChildren();
  const heading = document.createElement('strong'); heading.textContent = '自动分析子任务'; container.appendChild(heading);
  const list = document.createElement('ol');
  for (const [key, label] of Object.entries(labels)) {
    const status = state.analysisTasks[key]; const row = document.createElement('li'); row.dataset.status = status;
    row.innerHTML = `<span aria-hidden="true">${status === 'complete' ? '✓' : status === 'running' ? '…' : '○'}</span><span>${label}</span><small>${status === 'complete' ? '完成' : status === 'running' ? '进行中' : '等待'}</small>`;
    list.appendChild(row);
  }
  container.appendChild(list);
}
