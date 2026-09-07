const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    onRefresh: (cb) => ipcRenderer.on('app:refresh', () => cb())
  },
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    create: (payload) => ipcRenderer.invoke('agents:create', payload),
    update: (name, patch) => ipcRenderer.invoke('agents:update', { name, patch }),
    delete: (name, removeFiles) => ipcRenderer.invoke('agents:delete', { name, removeFiles }),
    checkDiscordState: (name) => ipcRenderer.invoke('agents:checkDiscordState', name),
    getDiscordAccess: (name) => ipcRenderer.invoke('agents:getDiscordAccess', name),
    approvePairing: (name, code) => ipcRenderer.invoke('agents:approvePairing', { name, code }),
    denyPairing: (name, code) => ipcRenderer.invoke('agents:denyPairing', { name, code }),
    removeAllowedUser: (name, userId) => ipcRenderer.invoke('agents:removeAllowedUser', { name, userId }),
    setContactLabel: (name, userId, label) => ipcRenderer.invoke('agents:setContactLabel', { name, userId, label }),
    listDiscordChannels: (name) => ipcRenderer.invoke('agents:listDiscordChannels', name),
    addDiscordChannel: (name, channelIdOrLink, label) => ipcRenderer.invoke('agents:addDiscordChannel', { name, channelIdOrLink, label }),
    removeDiscordChannel: (name, channelId) => ipcRenderer.invoke('agents:removeDiscordChannel', { name, channelId }),
    connectNotionWorkspace: (name) => ipcRenderer.invoke('agents:connectNotionWorkspace', name),
    refreshNotionWorkspaceLabel: (name) => ipcRenderer.invoke('agents:refreshNotionWorkspaceLabel', name),
    scanUnregistered: () => ipcRenderer.invoke('agents:scanUnregistered'),
    import: (name) => ipcRenderer.invoke('agents:import', name)
  },
  setup: {
    isWizardDone: () => ipcRenderer.invoke('setup:isWizardDone'),
    markWizardDone: (done) => ipcRenderer.invoke('setup:markWizardDone', done),
    checkNode: () => ipcRenderer.invoke('setup:checkNode'),
    checkClaude: () => ipcRenderer.invoke('setup:checkClaude'),
    installClaudeCli: () => ipcRenderer.invoke('setup:installClaudeCli'),
    installDiscordPlugin: () => ipcRenderer.invoke('setup:installDiscordPlugin'),
    startLoginTerminal: (cols, rows) => ipcRenderer.invoke('setup:startLoginTerminal', { cols, rows }),
    stopLoginTerminal: () => ipcRenderer.invoke('setup:stopLoginTerminal'),
    writeLoginInput: (data) => ipcRenderer.invoke('setup:writeLoginInput', data),
    resizeLoginTerminal: (cols, rows) => ipcRenderer.invoke('setup:resizeLoginTerminal', { cols, rows }),
    onLoginLog: (cb) => ipcRenderer.on('setup:loginLog', (_e, chunk) => cb(chunk)),
    onLoginExit: (cb) => ipcRenderer.on('setup:loginExit', () => cb())
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (partial) => ipcRenderer.invoke('settings:update', partial),
    detectWslBase: () => ipcRenderer.invoke('settings:detectWslBase')
  },
  session: {
    start: (agent, cols, rows) => ipcRenderer.invoke('session:start', { agent, cols, rows }),
    stop: (name) => ipcRenderer.invoke('session:stop', name),
    write: (name, data) => ipcRenderer.invoke('session:write', { name, data }),
    resize: (name, cols, rows) => ipcRenderer.invoke('session:resize', { name, cols, rows }),
    status: (name) => ipcRenderer.invoke('session:status', name),
    logs: (name) => ipcRenderer.invoke('session:logs', name),
    onLog: (cb) => ipcRenderer.on('session:log', (_e, data) => cb(data)),
    onStatus: (cb) => ipcRenderer.on('session:status', (_e, data) => cb(data))
  }
});
