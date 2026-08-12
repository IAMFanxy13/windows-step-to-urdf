import { visualForSeverity } from '../app/visual-language.mjs';

const sections = [
  ['blockers', '阻止导出', '必须修复后才能正式导出'], ['warnings', '建议检查', '允许继续检查，但需了解风险'],
  ['passed', '已自动通过', '证据满足模板或结构规则'], ['info', '仅供参考', '统计和普通提示'],
];

export function queueSummary(queue) {
  return [
    ['BLOCKER', queue.blockers?.length || 0],
    ['WARNING', queue.warnings?.length || 0],
    ['PASS', queue.passed?.length || 0],
  ].map(([severity, count]) => ({ severity, ...visualForSeverity(severity), count }));
}

function issueCard(issue, onAction) {
  const card = document.createElement('article');
  card.className = 'issue-card';
  card.dataset.targetId = issue.targetId;
  card.dataset.severity = issue.severity;
  card.dataset.testid = 'issue-card';
  const visual = visualForSeverity(issue.severity);
  const heading = document.createElement('strong');
  heading.textContent = `${visual.icon} ${issue.title}`;
  card.appendChild(heading);
  const badge = document.createElement('span');
  badge.className = 'status-badge';
  badge.textContent = issue.category;
  card.appendChild(badge);
  if (issue.evidence[0]) {
    const evidence = document.createElement('p');
    evidence.className = 'advanced-only';
    evidence.textContent = issue.evidence[0];
    card.appendChild(evidence);
  }
  const actions = document.createElement('div');
  actions.className = 'issue-actions';
  for (const action of issue.actions.slice(0, 3)) {
    const actionId = typeof action === 'string' ? action : action.id;
    const button = document.createElement('button');
    button.type = 'button';
    const label = (typeof action === 'object' && action.label) || (actionId === 'focus' ? '定位零件' : actionId === 'reselect-axis' ? '重新选择轴' : actionId === 'motion-review' ? '检查运动' : actionId === 'edit-limits' ? '填写运动范围' : actionId === 'edit-inertial' ? '填写材料密度' : '处理问题');
    const icon = actionId === 'focus' ? '🎯' : actionId === 'reselect-axis' ? '⭕' : actionId === 'motion-review' ? '🎚️' : actionId === 'edit-limits' ? '📐' : actionId === 'edit-inertial' ? '⚖️' : '🛠️';
    button.textContent = `${icon} ${label}`;
    button.setAttribute('aria-label', `${label}：${issue.title}`);
    button.dataset.action = actionId;
    button.addEventListener('click', () => onAction(issue, actionId));
    actions.appendChild(button);
  }
  card.appendChild(actions);
  return card;
}

export function renderAnomalyQueue(container, queue, { onAction = () => {} } = {}) {
  container.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = '⚠️ 只看需要处理的';
  container.appendChild(title);

  const chips = document.createElement('div');
  chips.className = 'queue-summary-chips';
  for (const item of queueSummary(queue)) {
    const chip = document.createElement('div');
    chip.className = `queue-summary-chip severity-${item.severity.toLowerCase()}`;
    chip.innerHTML = `<span aria-hidden="true">${item.icon}</span><strong>${item.count}</strong><small>${item.label}</small>`;
    chips.appendChild(chip);
  }
  container.appendChild(chips);

  const nextIssue = queue.blockers?.[0] || queue.warnings?.[0];
  if (nextIssue) {
    const next = document.createElement('section');
    next.className = 'next-issue';
    next.innerHTML = '<small>现在只处理这一项</small>';
    next.appendChild(issueCard(nextIssue, onAction));
    container.appendChild(next);
  } else {
    const clear = document.createElement('p');
    clear.className = 'queue-clear';
    clear.textContent = '✅ 没有需要处理的异常';
    container.appendChild(clear);
  }

  const fullQueue = document.createElement('div');
  fullQueue.className = 'advanced-only full-queue';
  for (const [key, label, description] of sections) {
    const details = document.createElement('details');
    details.className = `queue-section queue-${key}`;
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${label}</span><strong>${queue[key].length}</strong><small>${description}</small>`;
    details.appendChild(summary);
    const list = document.createElement('div');
    list.className = 'queue-list';
    for (const issue of queue[key]) list.appendChild(issueCard(issue, onAction));
    if (!queue[key].length) {
      const empty = document.createElement('p');
      empty.className = 'queue-empty';
      empty.textContent = '当前没有此类项目。';
      list.appendChild(empty);
    }
    details.appendChild(list);
    fullQueue.appendChild(details);
  }
  container.appendChild(fullQueue);
}
