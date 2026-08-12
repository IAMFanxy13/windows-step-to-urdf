const issue = (title, impact, action, { exportEffect = 'BLOCKS_ENGINEERING', recoverability = 'RETRYABLE' } = {}) =>
  Object.freeze({ title, impact, action, exportEffect, recoverability });

export const ERROR_CATALOG = Object.freeze({
  STEP_UNREADABLE: issue('无法读取这个 STEP 文件', '无法开始识别机器人', '检查文件是否完整，并重新选择 STEP/STP'),
  NOT_ASSEMBLY: issue('文件中没有可用的装配结构', '无法可靠划分机器人结构', '从 CAD 导出完整装配体，优先使用 AP242'),
  UNIT_INVALID: issue('模型单位无法可靠确定', '尺寸、质量和关节位置可能错误', '查看分析详情并指定正确单位'),
  FILE_DAMAGED: issue('STEP 文件可能已损坏', '分析已停止，当前修改不会被清空', '重新导出 STEP 后重试'),
  ANALYSIS_TIMEOUT: issue('自动分析超过等待时间', '结果尚未完成', '保留工程并安全重试'),
  BACKEND_OFFLINE: issue('本地分析服务没有响应', '无法继续分析或导出', '重新双击启动器；已保存修改会恢复'),
  OCCT_UNAVAILABLE: issue('STEP 分析内核不可用', '无法读取精确几何', '查看启动日志并修复本地运行环境', { recoverability: 'RESTART_REQUIRED' }),
  NO_CANDIDATES: issue('没有找到可靠的转动位置', '需要人工建立关节候选', '在三维视图选择真正的舵机和输出端', { exportEffect: 'BLOCKS_ENGINEERING' }),
  CANDIDATE_CONFLICT: issue('多个转动候选互相冲突', '系统不会静默选择其中一个', '查看高亮位置并选择正确候选'),
  JOINT_AXIS_INVALID: issue('旋转轴无效', '这个关节无法安全预览或导出', '重新点击圆柱面、圆边或两点定义轴', { exportEffect: 'BLOCKS_ALL' }),
  JOINT_ORIGIN_INVALID: issue('旋转中心无效', '零件可能绕远处公转', '重新选择输出端中心', { exportEffect: 'BLOCKS_ALL' }),
  TREE_DISCONNECTED: issue('机器人运动结构断开', '预览可临时诊断，但不能正式导出', '定位断开结构并补充或修正关节'),
  TREE_CYCLE: issue('运动结构形成循环', 'URDF 只能表示树形结构', '删除或改正产生闭环的关节', { exportEffect: 'BLOCKS_ALL' }),
  MULTIPLE_PARENT: issue('一个结构连接了多个上级关节', '运动关系不唯一', '选择正确的上级关节并删除冲突'),
  MIRROR_TRANSFORM: issue('检测到镜像安装', '反射矩阵不能直接写入 URDF', '生成独立右手网格并检查轴方向'),
  LIMIT_INVALID: issue('关节角度范围无效', '工程模型不能导出', '填写最小角度小于最大角度且包含初始位置'),
  INERTIAL_INVALID: issue('质量或惯性无效', '工程模型不能用于动力学', '填写材料或导入可靠质量属性'),
  MESH_MISSING: issue('模型网格文件缺失', '预览和导出都会缺少零件', '重新生成网格或定位缺失零件', { exportEffect: 'BLOCKS_ALL' }),
  SAVE_FAILED: issue('工程保存失败', '刷新可能丢失最近修改', '立即导出诊断包并重试保存', { exportEffect: 'WARNING' }),
  RECOVERY_FAILED: issue('无法恢复上次工程', '旧快照未写入当前模型', '保留原快照并打开兼容详情'),
  EXPORT_FAILED: issue('机器人文件导出失败', '没有生成可信的交付包', '按错误定位问题后重新导出'),
  UNEXPECTED: issue('发生未预期错误', '当前操作已停止，最近检查点仍保留', '保存诊断报告并安全重试', { recoverability: 'RETRYABLE' }),
});

export function describeError(code, detail = '') {
  const entry = ERROR_CATALOG[code] || ERROR_CATALOG.UNEXPECTED;
  return { code, ...entry, detail };
}
