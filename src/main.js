const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const agentManager = require('./lib/agentManager');
const sessionManager = require('./lib/sessionManager');
const setupManager = require('./lib/setupManager');
const updateToken = require('./lib/updateToken');

// 저장소가 비공개라 릴리스 확인 API 호출에도 인증이 필요하다. 이 토큰은
// "Contents: Read-only"로만 스코프된 이 저장소 전용 토큰이어야 한다
// (앱을 뜯어보면 누구나 꺼낼 수 있으므로, 절대 쓰기 권한을 주면 안 됨).
if (updateToken) {
  autoUpdater.requestHeaders = { authorization: `token ${updateToken}` };
}
autoUpdater.autoDownload = true;

const TRAY_ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.ico');

let mainWindow;
let tray;
let isQuitting = false;

// 실수로 여러 번 실행해도 인스턴스가 중복되지 않도록 - 오래된 창이 남아 최신 데이터를
// 못 보여주는 혼란을 막기 위함. 두 번째 실행은 즉시 종료되고 기존 창만 앞으로 나온다.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    icon: TRAY_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 창을 닫아도 앱은 종료하지 않고 트레이로 내려간다.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// 숨겨져 있던 창을 다시 보여줄 때는 반드시 최신 데이터로 새로고침한다.
// (트레이/두 번째 실행으로 예전 창을 재사용할 때, 그 사이 파일이 바뀌었어도
// 화면은 계속 켜졌을 때 스냅샷을 들고 있는 문제가 있었음)
function showAndRefresh() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  sendToWindow('app:refresh');
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showAndRefresh();
  }
}

function createTray() {
  tray = new Tray(TRAY_ICON_PATH);
  tray.setToolTip('디코노션ai 런처');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '열기',
        click: showAndRefresh
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('click', toggleWindow);
}

app.on('second-instance', () => {
  // 이미 떠 있는 창을 앞으로 가져온다 (새 인스턴스는 만들지 않음) + 최신 데이터로 새로고침
  showAndRefresh();
});

if (gotLock) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // 기본 File/Edit/View 메뉴 제거 - 종료는 트레이 메뉴로만
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else toggleWindow();
    });

    // 개발 중(npm start, 패키징 안 된 상태)에는 업데이트 확인을 시도하면
    // "찾을 수 없음" 에러만 나므로 실제로 설치된 앱에서만 확인한다.
    if (app.isPackaged) {
      autoUpdater.checkForUpdates().catch(() => {});
    }
  });
}

autoUpdater.on('update-downloaded', (info) => {
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 준비됨',
      message: `새 버전(${info.version})이 준비되었습니다. 지금 재시작해서 설치할까요?`,
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1
    })
    .then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
});

app.on('before-quit', () => {
  isQuitting = true;
  sessionManager.stopAll();
  setupManager.stopLoginTerminal();
});

app.on('window-all-closed', () => {
  // 트레이 상주 앱이므로 창이 닫혀도(트레이로 숨겨져도) 앱은 계속 실행한다.
  // macOS에서 Dock 아이콘까지 닫혔을 때만(트레이 종료 클릭 등) 실제 종료 흐름을 탄다.
});

sessionManager.emitter.on('log', ({ name, chunk }) => {
  sendToWindow('session:log', { name, chunk });
});
sessionManager.emitter.on('status', ({ name, running }) => {
  sendToWindow('session:status', { name, running });
});

setupManager.emitter.on('log', (chunk) => {
  sendToWindow('setup:loginLog', chunk);
});
setupManager.emitter.on('exit', () => {
  sendToWindow('setup:loginExit');
});

// ---- IPC: setup wizard ----
ipcMain.handle('setup:isWizardDone', () => setupManager.isWizardDone());
ipcMain.handle('setup:markWizardDone', (_e, done) => {
  setupManager.markWizardDone(done);
  return true;
});
ipcMain.handle('setup:checkNode', () => setupManager.checkNode());
ipcMain.handle('setup:checkClaude', () => setupManager.checkClaude());
ipcMain.handle('setup:installClaudeCli', () => setupManager.installClaudeCli());
ipcMain.handle('setup:installDiscordPlugin', () => setupManager.installDiscordPlugin());
ipcMain.handle('setup:checkBun', () => setupManager.checkBun());
ipcMain.handle('setup:installBun', () => setupManager.installBun());
ipcMain.handle('setup:startLoginTerminal', (_e, { cols, rows }) => {
  setupManager.startLoginTerminal(cols, rows);
  return true;
});
ipcMain.handle('setup:stopLoginTerminal', () => {
  setupManager.stopLoginTerminal();
  return true;
});
ipcMain.handle('setup:writeLoginInput', (_e, data) => {
  setupManager.writeLoginInput(data);
  return true;
});
ipcMain.handle('setup:resizeLoginTerminal', (_e, { cols, rows }) => {
  setupManager.resizeLoginTerminal(cols, rows);
  return true;
});

// ---- IPC: agents ----
ipcMain.handle('agents:list', () => agentManager.listAgents());

ipcMain.handle('agents:create', (_e, payload) => {
  try {
    return { ok: true, agent: agentManager.createAgent(payload) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:update', (_e, { name, patch }) => {
  try {
    return { ok: true, agent: agentManager.updateAgent(name, patch) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:delete', async (_e, { name, removeFiles }) => {
  try {
    await agentManager.deleteAgent(name, { removeFiles });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:scanUnregistered', () => agentManager.scanUnregisteredAgents());

ipcMain.handle('agents:import', (_e, name) => {
  try {
    return { ok: true, agent: agentManager.importAgent(name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:checkDiscordState', (_e, name) => {
  try {
    return { ok: true, result: agentManager.checkDiscordStateDir(name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:getDiscordAccess', (_e, name) => {
  try {
    return { ok: true, result: agentManager.getDiscordAccess(name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:approvePairing', (_e, { name, code }) => {
  try {
    agentManager.approvePairing(name, code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:denyPairing', (_e, { name, code }) => {
  try {
    agentManager.denyPairing(name, code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:removeAllowedUser', (_e, { name, userId }) => {
  try {
    agentManager.removeAllowedUser(name, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:setContactLabel', (_e, { name, userId, label }) => {
  try {
    agentManager.setContactLabel(name, userId, label);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:listDiscordChannels', (_e, name) => {
  try {
    return { ok: true, result: agentManager.listDiscordChannels(name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:addDiscordChannel', (_e, { name, channelIdOrLink, label }) => {
  try {
    return { ok: true, result: agentManager.addDiscordChannel(name, channelIdOrLink, label) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:removeDiscordChannel', (_e, { name, channelId }) => {
  try {
    agentManager.removeDiscordChannel(name, channelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:connectNotionWorkspace', (_e, name) => {
  try {
    agentManager.connectNotionWorkspace(name);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agents:refreshNotionWorkspaceLabel', (_e, name) => {
  try {
    return { ok: true, result: agentManager.refreshNotionWorkspaceLabel(name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app:quit', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('settings:get', () => agentManager.getSettings());
ipcMain.handle('settings:update', (_e, partial) => agentManager.updateSettings(partial));
ipcMain.handle('settings:detectWslBase', () => agentManager.detectWslDiscordStateBase());

// ---- IPC: sessions ----
ipcMain.handle('session:start', (_e, { agent, cols, rows }) => {
  try {
    agentManager.ensureDiscordConfigured(agent);
    sessionManager.startSession(agent, { cols, rows });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('session:stop', (_e, name) => {
  try {
    sessionManager.stopSession(name);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('session:write', (_e, { name, data }) => {
  try {
    sessionManager.writeInput(name, data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('session:resize', (_e, { name, cols, rows }) => {
  sessionManager.resizeSession(name, cols, rows);
  return { ok: true };
});

ipcMain.handle('session:status', (_e, name) => sessionManager.getStatus(name));
ipcMain.handle('session:logs', (_e, name) => sessionManager.getLogs(name));
