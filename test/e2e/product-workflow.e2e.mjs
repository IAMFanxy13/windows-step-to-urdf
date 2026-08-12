import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

const reportShot = name => `test-results/screenshots/${name}.png`;
const captureReport = async (page, name) => {
  if (!process.env.CI) await page.screenshot({ path: reportShot(name), fullPage: true });
};

test('empty workspace is a clear keyboard-accessible task 1/6', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-test-ready', 'false');
  await expect(page.getByTestId('workflow-stepper')).toContainText('打开机器人模型');
  await expect(page.getByTestId('workflow-stepper')).toContainText('导出机器人文件');
  await expect(page.getByTestId('current-task-card')).toContainText('选择完整机器人 STEP');
  await expect(page.getByText(/文件只在本机 UUID/)).toBeHidden();
  await expect(page.locator('#export-step-job')).toBeDisabled();
  await expect(page.locator('#export-step-job')).toBeHidden();
  const primaryButtonHeight = await page.getByRole('button', { name: '为什么需要这些步骤？' }).evaluate(element => element.getBoundingClientRect().height);
  expect(primaryButtonHeight).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(item => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await captureReport(page, '01_empty_workspace');
});

test('file selection starts analysis automatically', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  const example = await readFile('public/examples/two_joint_servo_arm_ap242.step');
  await page.setInputFiles('#step-file', { name: 'robot.step', mimeType: 'model/step', buffer: example });
  await expect(page.getByTestId('current-task-card')).toContainText(/正在自动识别|查看自动结果|查看自动识别摘要/, { timeout: 45_000 });
  await expect(page.getByRole('region', { name: '舵机模板确认' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'STEP 导入' })).toBeHidden();
});

test('example follows gate, analysis, anomaly and export-blocking flow', async ({ page }) => {
  const runtimeErrors = [], consoleErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: '先试两关节示例' }).click();
  await expect(page.getByTestId('current-task-card')).toContainText(/正在自动分析|查看自动识别摘要/);
  await captureReport(page, '02_analysis_or_results');
  await expect(page.getByRole('region', { name: '舵机模板确认' })).toBeVisible({ timeout: 60_000 });
  await captureReport(page, '02b_servo_template_result');
  const output = page.getByRole('button', { name: '输出接口正确，进入代表实例教学' });
  await expect(output).toHaveCount(0);
  await page.getByRole('button', { name: '是，这是舵机' }).click();
  await expect(output).toBeEnabled();
  await output.click();
  await page.getByRole('button', { name: '确认代表实例并批量应用相同拓扑' }).click();
  await expect(page.locator('input.generic-joint-slider:not([disabled])')).toHaveCount(2, { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.__STEP_URDF_TEST__.counts)).toEqual({ links: 3, joints: 2, sliders: 2 });
  await expect(page.getByText(/软件已经生成整机、Link/)).toBeHidden();
  await expect(page.getByTestId('anomaly-queue')).toBeVisible();
  await expect(page.getByTestId('anomaly-queue')).toContainText('阻止导出');
  await expect(page.getByTestId('formal-export')).toBeDisabled();
  await expect(page.getByTestId('export-review')).toContainText(/🔒还差 \d+ 项/);
  const countsBefore = await page.evaluate(() => window.__STEP_URDF_TEST__.counts);
  await page.getByRole('button', { name: '高级模式' }).click();
  await page.getByRole('button', { name: '默认模式' }).click();
  expect(await page.evaluate(() => window.__STEP_URDF_TEST__.counts)).toEqual(countsBefore);
  expect(runtimeErrors).toEqual([]); expect(consoleErrors).toEqual([]);
  await captureReport(page, '03_anomaly_and_export_blocker');
});

test('motion review requires all poses and all three confirmations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: '先试两关节示例' }).click();
  await expect(page.getByRole('region', { name: '舵机模板确认' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '是，这是舵机' }).click();
  await page.getByRole('button', { name: '输出接口正确，进入代表实例教学' }).click();
  await page.getByRole('button', { name: '确认代表实例并批量应用相同拓扑' }).click();
  await expect(page.locator('input.generic-joint-slider:not([disabled])')).toHaveCount(2, { timeout: 20_000 });
  const cards = page.locator('.generic-joint-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.generic-joint-card.is-active:visible')).toHaveCount(1);
  await expect(page.locator('.generic-joint-card.is-summary:visible')).toHaveCount(0);
  await expect(page.locator('.joint-origin-x:visible')).toHaveCount(0);
  const card = page.locator('.generic-joint-card.is-active');
  const reviewedJointId = await card.getAttribute('data-joint-id');
  await card.getByRole('button', { name: '回到初始位置' }).click();
  await card.getByRole('button', { name: '向一个方向小幅转动' }).click();
  await card.getByRole('button', { name: '向另一个方向小幅转动' }).click();
  await card.getByRole('button', { name: '运动零件正确' }).click();
  await card.getByRole('button', { name: '轴心正确' }).click();
  await expect(card).not.toContainText('已完成三姿态运动验证');
  await card.getByRole('button', { name: '方向正确' }).click();
  await expect(page.locator(`.generic-joint-card[data-joint-id="${reviewedJointId}"]`)).toContainText('已完成三姿态运动验证');
  await page.reload();
  await expect(page.getByRole('heading', { name: '导入完整机器人 STEP' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.generic-joint-card')).toHaveCount(0);
  await page.getByRole('button', { name: '恢复上次工程' }).click();
  await expect(page.locator('.generic-joint-card')).toHaveCount(2);
  await captureReport(page, '04_motion_review_and_recovery');
});
