export function servoCardCopy(template, { instances = 0 } = {}) {
  return {
    icon: '🦾',
    title: '这是舵机吗？',
    name: template?.displayName || '候选零件',
    summary: `发现 ${instances} 个相同零件`,
  };
}

export function jointCardCopy(joint, index, total) {
  return {
    icon: '🎚️',
    title: `关节 ${index}/${total}`,
    name: joint?.name || '未命名关节',
    question: '运动的是正确部分吗？',
  };
}
