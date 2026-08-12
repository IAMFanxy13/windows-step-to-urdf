import { describe, expect, it } from 'vitest';
import { createNotificationService, normalizeFailure } from '../src/app/notification-service.mjs';

describe('notification service', () => {
  it('stores actionable structured failures', () => {
    const service = createNotificationService();
    service.publish(normalizeFailure(new Error('network timeout'), {
      title: 'STEP 分析超时', possibleCause: '后端仍在计算', impact: '暂时不能进入识别结果', recommendation: '安全重试', recoverability: 'RETRYABLE',
    }));
    expect(service.list()[0]).toMatchObject({ severity: 'unexpected', recoverability: 'RETRYABLE', impact: '暂时不能进入识别结果' });
  });

  it('notifies subscribers without exposing mutable history', () => {
    const service = createNotificationService();
    let observed = [];
    service.subscribe(items => { observed = items; });
    service.success({ title: '已保存', whatHappened: '检查点已更新' });
    observed[0].title = 'mutated';
    expect(service.list()[0].title).toBe('已保存');
  });

  it('redacts local user paths from user-facing failures', () => {
    const windowsPath = ['C:', 'Users', 'student', 'private', 'robot.step'].join('\\');
    const unixPath = ['', 'home', 'student', 'private.step'].join('/');
    const value = normalizeFailure(new Error(`failed at ${windowsPath} and ${unixPath}`));
    expect(value.whatHappened).toContain('<LOCAL_PATH>');
    expect(value.whatHappened).not.toContain('student');
  });
});
