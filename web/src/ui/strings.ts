/** 界面文字集中管理（目前仅中文）。 */
export const S = {
  appName: 'AzConductor',
  nav: { routes: '路径', run: '运行' },
  connection: {
    idle: '未连接',
    connecting: '连接中…',
    connected: '已连接',
    rejected: '被占用',
    failed: '连接失败',
  },
  update: { ready: '有新版本可用', reload: '刷新', later: '稍后', offlineReady: '已可离线使用' },
  common: { ok: '确定', cancel: '取消', delete: '删除', save: '保存', close: '关闭', confirmDelete: '确认删除？' },
} as const;