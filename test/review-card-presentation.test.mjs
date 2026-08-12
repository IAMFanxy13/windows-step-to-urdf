import { describe, expect, it } from 'vitest';

import { jointCardCopy, servoCardCopy } from '../src/views/review-card-presentation.mjs';

describe('visual review card copy', () => {
  it('presents one servo decision without CAD jargon', () => {
    expect(servoCardCopy({ displayName: 'Servo-X' }, { instances: 4 })).toMatchObject({
      icon: '🦾',
      title: '这是舵机吗？',
      summary: '发现 4 个相同零件',
    });
  });

  it('presents joint review as one mechanical question', () => {
    expect(jointCardCopy({ name: 'elbow' }, 1, 13)).toMatchObject({
      icon: '🎚️',
      title: '关节 1/13',
      name: 'elbow',
      question: '运动的是正确部分吗？',
    });
  });
});
