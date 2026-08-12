const typeLabel = { EXACT_GEOMETRY: '精确几何计算', GEOMETRY_ESTIMATE: '几何估算', HEURISTIC: '规则/启发式推断', TEMPLATE_MATCH: '模板匹配', USER_CONFIRMED: '用户人工确认' };

export function renderEvidencePanel(container, provenance) {
  container.replaceChildren();
  if (!provenance) { container.textContent = '选择识别结果或异常后查看证据。'; return; }
  const dl = document.createElement('dl'); dl.className = 'evidence-list';
  const entries = [
    ['数据性质', typeLabel[provenance.resultType] || provenance.resultType], ['算法/规则版本', provenance.algorithmVersion],
    ['单位', provenance.unit || '无量纲'], ['来源', provenance.source], ['阈值', JSON.stringify(provenance.thresholdValues || {})],
  ];
  for (const [term, value] of entries) { const dt = document.createElement('dt'); dt.textContent = term; const dd = document.createElement('dd'); dd.textContent = value || '未记录'; dl.append(dt, dd); }
  const evidence = document.createElement('ul'); for (const value of provenance.evidence || []) { const li = document.createElement('li'); li.textContent = value; evidence.appendChild(li); }
  container.append(dl, evidence);
}
