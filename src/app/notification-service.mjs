const severities = new Set(['info', 'success', 'warning', 'blocker', 'unexpected']);
const clone = value => structuredClone(value);
let nextId = 1;

export function redactPrivatePaths(value) {
  return String(value ?? '')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+\\[^\s"']+/g, '<LOCAL_PATH>')
    .replace(/\/(?:home|Users)\/[^/\s]+\/[^\s"']+/g, '<LOCAL_PATH>');
}

export function normalizeNotification(input) {
  const severity = input.severity || 'info';
  if (!severities.has(severity)) throw new Error(`Unknown notification severity ${severity}`);
  return {
    id: input.id || `notice-${nextId++}`, severity, title: input.title || '状态更新',
    whatHappened: redactPrivatePaths(input.whatHappened || input.message || ''), possibleCause: redactPrivatePaths(input.possibleCause || ''), impact: redactPrivatePaths(input.impact || ''),
    recommendation: redactPrivatePaths(input.recommendation || ''), recoverability: input.recoverability || 'NONE', actions: clone(input.actions || []),
    target: clone(input.target || null), timestamp: input.timestamp || new Date().toISOString(),
  };
}

export function normalizeFailure(error, context = {}) {
  return normalizeNotification({ severity: 'unexpected', title: context.title || '发生未预期错误', whatHappened: error?.message || String(error), ...context });
}

export function createNotificationService() {
  let history = []; const listeners = new Set();
  const emit = () => { const snapshot = clone(history); for (const listener of listeners) listener(snapshot); };
  const publish = input => { const item = normalizeNotification(input); history = [item, ...history].slice(0, 100); emit(); return clone(item); };
  return {
    publish, info: input => publish({ ...input, severity: 'info' }), success: input => publish({ ...input, severity: 'success' }),
    warning: input => publish({ ...input, severity: 'warning' }), blocker: input => publish({ ...input, severity: 'blocker' }),
    unexpected: (error, context) => publish(normalizeFailure(error, context)), list: () => clone(history),
    dismiss: id => { history = history.filter(item => item.id !== id); emit(); },
    subscribe: listener => { listeners.add(listener); listener(clone(history)); return () => listeners.delete(listener); },
  };
}
