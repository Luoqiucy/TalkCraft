import { app, BrowserWindow, dialog, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startManagedService } from '../scripts/managed-service.mjs';

// Migration preview: reuse the existing local Node service and React workbench.
// Native HUD, right-Alt gestures, tray and cursor injection remain in Tauri.
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:4317';
let service;
let mainWindow;
let quitting = false;

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

function makeWindow() {
  const window = new BrowserWindow({
    title: 'TalkCraft · Electron 迁移预览',
    width: 1000,
    height: 900,
    minWidth: 600,
    minHeight: 500,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle('TalkCraft · Electron 迁移预览'); });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${origin}/`)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (quitting) return;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning', title: '退出 TalkCraft 预览？',
      message: '退出将中断当前任务，未保存的录音可能丢失。',
      buttons: ['继续使用', '退出预览'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice !== 1) event.preventDefault();
  });
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined; });
  void window.loadURL(`${origin}/react/`);
  return window;
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && webContents === mainWindow?.webContents && webContents.getURL().startsWith(`${origin}/react/`));
  });
  try {
    service = await startManagedService(join(root, 'scripts/asr-file.mjs'), {
      args: ['--port', '4317'], cwd: root,
      // Electron's process.execPath points to electron.exe, not the Node runtime.
      execPath: process.env.TALKCRAFT_NODE_PATH || 'node',
    });
    service.child.once('exit', () => {
      if (!quitting) {
        dialog.showErrorBox('TalkCraft 后台服务已停止', '请保存当前内容并重新启动 Electron 迁移预览。');
        app.quit();
      }
    });
    mainWindow = makeWindow();
  } catch (error) {
    dialog.showErrorBox('TalkCraft 启动失败', `${error.message}\n请检查 Node.js 和 4317 端口。`);
    app.quit();
  }
});

app.on('before-quit', event => {
  if (quitting || !service) return;
  event.preventDefault();
  quitting = true;
  // Only stop the service this Electron instance started; never touch the Tauri process.
  service.stop().catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
