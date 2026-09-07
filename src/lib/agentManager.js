const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pty = require('node-pty');
const store = require('./store');
const wsl = require('./wsl');
const sessionManager = require('./sessionManager');

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildClaudeMd({ name, roleOneLiner, notionUrl }) {
  const lines = [`너는 ${name}라는 ${roleOneLiner || '에이전트'}야. 세션 시작 시 가장 먼저 아래 페이지를 읽고 그 내용대로 행동해:`, ''];
  if (notionUrl) {
    lines.push(`${name} 역할·데이터·규칙: ${notionUrl}`);
  }
  return lines.join('\n') + '\n';
}

// "https://discord.com/channels/길드ID/채널ID" 링크나 숫자만 있는 채널 ID를 그대로 받는다.
function extractChannelId(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const linkMatch = trimmed.match(/channels\/\d+\/(\d+)/);
  if (linkMatch) return linkMatch[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return '';
}

const DEFAULT_ACCESS = { dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} };

function readAccessJson(agent) {
  let raw = null;
  if (agent.runtime === 'wsl') {
    raw = wsl.readWslFile(agent.discordStateDir, 'access.json');
  } else {
    const p = path.join(agent.discordStateDir, 'access.json');
    if (fs.existsSync(p)) raw = fs.readFileSync(p, 'utf-8');
  }
  if (!raw) return { ...DEFAULT_ACCESS, groups: {} };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ACCESS, ...parsed, groups: parsed.groups || {} };
  } catch (e) {
    return { ...DEFAULT_ACCESS, groups: {} };
  }
}

function writeAccessJson(agent, access) {
  const content = JSON.stringify(access, null, 2) + '\n';
  if (agent.runtime === 'wsl') {
    wsl.writeWslFile(agent.discordStateDir, 'access.json', content);
    return;
  }
  fs.mkdirSync(agent.discordStateDir, { recursive: true });
  fs.writeFileSync(path.join(agent.discordStateDir, 'access.json'), content, 'utf-8');
}

function buildSettingsJson({ discordStateDir }) {
  return JSON.stringify(
    {
      env: {
        DISCORD_STATE_DIR: discordStateDir
      }
    },
    null,
    2
  ) + '\n';
}

function createAgent({ name, roleOneLiner, notionUrl, discordToken, runtime }) {
  const data = store.load();

  if (!name || !name.trim()) {
    throw new Error('에이전트 이름이 필요합니다.');
  }
  if (data.agents.some((a) => a.name === name)) {
    throw new Error(`이미 존재하는 에이전트 이름입니다: ${name}`);
  }

  runtime = runtime === 'wsl' ? 'wsl' : 'windows';
  const slug = slugify(name);
  const folder = path.join(data.agentsRoot, name);
  const claudeDir = path.join(folder, '.claude');
  const stateBase = runtime === 'wsl' ? data.discordStateBaseWsl : data.discordStateBase;
  if (runtime === 'wsl' && !stateBase) {
    throw new Error('WSL Discord 상태 기본 경로가 설정되어 있지 않습니다. 설정 화면에서 먼저 지정해주세요.');
  }
  const discordStateDir = `${stateBase}/discord-${slug}`;

  if (fs.existsSync(folder)) {
    throw new Error(`이미 존재하는 폴더입니다: ${folder}`);
  }

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    buildSettingsJson({ discordStateDir }),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(folder, 'CLAUDE.md'),
    buildClaudeMd({ name, roleOneLiner, notionUrl }),
    'utf-8'
  );

  const agent = {
    name,
    folder,
    runtime,
    roleOneLiner: roleOneLiner || '',
    notionUrl: notionUrl || '',
    discordStateDir,
    discordToken: discordToken || '',
    autoReadOnStart: true,
    createdAt: new Date().toISOString()
  };

  data.agents.push(agent);
  store.save(data);
  return agent;
}

function updateAgent(name, { roleOneLiner, notionUrl, discordToken, autoReadOnStart }) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  if (roleOneLiner !== undefined) agent.roleOneLiner = roleOneLiner;
  if (notionUrl !== undefined) agent.notionUrl = notionUrl;
  if (autoReadOnStart !== undefined) agent.autoReadOnStart = autoReadOnStart;

  const tokenChanged = discordToken !== undefined && discordToken !== agent.discordToken;
  if (discordToken !== undefined) agent.discordToken = discordToken;

  fs.writeFileSync(
    path.join(agent.folder, 'CLAUDE.md'),
    buildClaudeMd({ name: agent.name, roleOneLiner: agent.roleOneLiner, notionUrl: agent.notionUrl }),
    'utf-8'
  );

  store.save(data);

  // 토큰은 저장 즉시 실제 .env에도 반영한다. 다만 이미 떠 있는 세션은
  // 부팅 시 한 번만 .env를 읽는 구조라 재시작해야 실제로 적용된다.
  if (tokenChanged && agent.discordToken) {
    writeDiscordEnv(agent);
  }

  return agent;
}

function listAgents() {
  return store.load().agents;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteAgent(name, { removeFiles }) {
  const data = store.load();
  const idx = data.agents.findIndex((a) => a.name === name);
  if (idx === -1) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);
  const agent = data.agents[idx];

  // 세션이 켜진 채로 폴더를 지우려 하면, claude 프로세스가 그 폴더를 cwd로
  // 물고 있어서 Windows가 파일이 사용 중이라며 삭제를 거부한다(EBUSY/EPERM).
  // 삭제 전에 먼저 세션을 중지시키고, 프로세스가 실제로 파일 핸들을 놓을
  // 때까지(비동기라 즉시는 아님) 약간의 재시도 여유를 준다.
  if (sessionManager.getStatus(name).running) {
    try {
      sessionManager.stopSession(name);
    } catch (e) {
      // 이미 죽어있는 등 - 무시하고 삭제 계속 진행
    }
    await sleep(500);
  }

  if (removeFiles && fs.existsSync(agent.folder)) {
    const attempts = 5;
    for (let i = 1; i <= attempts; i++) {
      try {
        fs.rmSync(agent.folder, { recursive: true, force: true });
        break;
      } catch (e) {
        if (i === attempts) throw e;
        await sleep(400 * i);
      }
    }
  }

  data.agents.splice(idx, 1);
  store.save(data);
}

function checkDiscordStateDir(name) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  if (agent.runtime === 'wsl') {
    const { exists, files } = wsl.wslPathExists(agent.discordStateDir);
    return { path: agent.discordStateDir, exists, files };
  }

  const exists = fs.existsSync(agent.discordStateDir);
  let files = [];
  if (exists) {
    try {
      files = fs.readdirSync(agent.discordStateDir);
    } catch (e) {
      // ignore
    }
  }
  return { path: agent.discordStateDir, exists, files };
}

// /discord:configure 슬래시 명령은 DISCORD_STATE_DIR을 무시하고 기본 경로에만 저장하는
// 알려진 버그가 있어서, 터미널에 명령을 자동 입력하는 대신 런처가 직접 올바른 위치에
// .env를 써준다.
function writeDiscordEnv(agent) {
  if (!agent.discordToken) return;
  const content = `DISCORD_BOT_TOKEN=${agent.discordToken}\n`;
  if (agent.runtime === 'wsl') {
    wsl.writeWslFile(agent.discordStateDir, '.env', content);
  } else {
    fs.mkdirSync(agent.discordStateDir, { recursive: true });
    fs.writeFileSync(path.join(agent.discordStateDir, '.env'), content, 'utf-8');
  }
}

// 세션 시작 직전에 호출하면, claude가 부팅하면서 바로 올바른 토큰을 읽는다.
function ensureDiscordConfigured(agent) {
  writeDiscordEnv(agent);
}

// ---- Discord 채널(길드 채널 멘션 반응) 관리 ----
// 채널을 추가/삭제하면 access.json에 바로 반영된다(재시작 불필요 - 메시지마다 다시 읽는 구조).
// 메모는 access.json 스키마에 없는 필드라 런처 자체 데이터(agent.discordChannelLabels)에 보관한다.

function listDiscordChannels(name) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const access = readAccessJson(agent);
  const labels = agent.discordChannelLabels || {};
  return Object.keys(access.groups || {}).map((id) => ({ id, label: labels[id] || '' }));
}

function addDiscordChannel(name, channelIdOrLink, label) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const channelId = extractChannelId(channelIdOrLink);
  if (!channelId) throw new Error('채널 링크 또는 ID를 확인해주세요.');

  const access = readAccessJson(agent);
  if (!access.groups[channelId]) {
    access.groups[channelId] = { requireMention: true, allowFrom: [] };
    writeAccessJson(agent, access);
  }

  agent.discordChannelLabels = agent.discordChannelLabels || {};
  if (label) agent.discordChannelLabels[channelId] = label;
  store.save(data);

  return { id: channelId, label: agent.discordChannelLabels[channelId] || '' };
}

// 에이전트 폴더 전용(local scope) Notion MCP 연결을 걸고, OAuth 로그인을 위해
// 브라우저를 띄운다. Notion MCP는 계정 고정 토큰이 아니라 OAuth 방식이라
// 최초 연결/워크스페이스 전환 시 사용자가 직접 로그인해야 한다 - 이 부분은 자동화 불가.
//
// `claude mcp login`은 브라우저에서 로그인이 끝날 때까지 프로세스가 안 끝날 수 있어서
// (동기 실행하면 런처 전체가 멈춘다) 백그라운드로 띄우고 결과를 기다리지 않는다.
function connectNotionWorkspace(name) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const addArgs = ['mcp', 'add', '--transport', 'http', 'notion', 'https://mcp.notion.com/mcp'];

  if (agent.runtime === 'wsl') {
    const wslFolder = wsl.toWslPath(agent.folder);
    try {
      execFileSync(wsl.WSL_EXE, ['-e', 'bash', '-ic', `cd '${wslFolder}' && claude ${addArgs.join(' ')}`], {
        stdio: 'ignore'
      });
    } catch (e) {
      // 이미 등록돼 있으면 실패할 수 있음 - 로그인은 계속 진행
    }
    // claude mcp login은 "stdin이 터미널이어야" 진행되는 대화형 명령이라
    // 일반 child_process(파이프/ignore)로는 즉시 거부된다. 실제 터미널(pty)로 띄운다.
    pty.spawn(wsl.WSL_EXE, ['-e', 'bash', '-ic', `cd '${wslFolder}' && claude mcp login notion`], {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      env: process.env
    });
    return;
  }

  try {
    // claude가 npm 전역 설치본이면 claude.cmd라서, shell 없이 직접 실행하면
    // Windows에서 EINVAL이 난다 (배치 파일은 cmd.exe를 거쳐야 실행 가능).
    execFileSync('claude', addArgs, { cwd: agent.folder, stdio: 'ignore', shell: true });
  } catch (e) {
    // 이미 등록돼 있으면 add가 실패하는데, 그래도 로그인은 계속 진행한다
  }

  const exe = sessionManager.resolveClaudeExecutable();
  pty.spawn(exe, ['mcp', 'login', 'notion'], {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd: agent.folder,
    env: process.env
  });
}

function getNotionMcpStatus(agent) {
  try {
    let out;
    if (agent.runtime === 'wsl') {
      const wslFolder = wsl.toWslPath(agent.folder);
      out = execFileSync(wsl.WSL_EXE, ['-e', 'bash', '-ic', `cd '${wslFolder}' && claude mcp get notion`], {
        encoding: 'utf-8'
      });
    } else {
      out = execFileSync('claude', ['mcp', 'get', 'notion'], {
        cwd: agent.folder,
        encoding: 'utf-8',
        shell: true
      });
    }
    return /Connected/i.test(out) ? 'connected' : 'pending';
  } catch (e) {
    return 'none';
  }
}

// 연결 상태를 확인하고, 연결됐으면 Notion MCP에게 직접 물어봐서(원샷 프롬프트) 워크스페이스
// 이름을 알아내 메모칸에 자동으로 채운다. 사용자가 직접 입력하는 값이 아니라 항상 이 값으로
// 덮어써서 "지금 실제로 뭐에 연결돼 있는지"를 보여준다.
function refreshNotionWorkspaceLabel(name) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const status = getNotionMcpStatus(agent);
  if (status !== 'connected') {
    return { status, label: agent.notionWorkspaceLabel || '' };
  }

  const prompt = 'Notion 워크스페이스 이름을 한 줄로만 정확히 답해줘. 다른 설명 없이 이름만.';
  let label = '';
  try {
    let out;
    // --print(비대화형)는 도구 사용 권한을 물어볼 수 없어서, 이 조회 하나에 한해서만
    // 권한 확인을 건너뛴다(bypassPermissions) - 읽기 전용 조회이고 사용자가 직접 누른
    // 버튼에서 나온 호출이라 안전하다.
    if (agent.runtime === 'wsl') {
      const wslFolder = wsl.toWslPath(agent.folder);
      out = execFileSync(
        wsl.WSL_EXE,
        ['-e', 'bash', '-ic', `cd '${wslFolder}' && claude --print --permission-mode bypassPermissions '${prompt}'`],
        { encoding: 'utf-8', timeout: 30000 }
      );
    } else {
      out = execFileSync('claude', ['--print', '--permission-mode', 'bypassPermissions', prompt], {
        cwd: agent.folder,
        encoding: 'utf-8',
        timeout: 30000,
        shell: true
      });
    }
    label = out.trim().split('\n')[0].trim().slice(0, 80);
  } catch (e) {
    // 조회 실패해도 연결 상태 자체는 그대로 보고한다
  }

  if (label) {
    agent.notionWorkspaceLabel = label;
    store.save(data);
  }
  return { status, label: agent.notionWorkspaceLabel || '' };
}

function removeDiscordChannel(name, channelId) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const access = readAccessJson(agent);
  delete access.groups[channelId];
  writeAccessJson(agent, access);

  if (agent.discordChannelLabels) {
    delete agent.discordChannelLabels[channelId];
    store.save(data);
  }
}

// ---- Discord 접근(페어링/허용목록) 관리 ----
// 사용자 메모(누구인지)는 access.json 스키마에 없는 필드라 플러그인이 건드리지 않는
// 별도 필드(agent.discordContacts)에 런처가 자체적으로 보관한다.

function getDiscordAccess(name) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const access = readAccessJson(agent);
  const contacts = agent.discordContacts || {};

  const pending = Object.entries(access.pending || {}).map(([code, info]) => ({ code, ...info }));
  const allowed = (access.allowFrom || []).map((id) => ({ id, label: contacts[id] || '' }));

  return { dmPolicy: access.dmPolicy, pending, allowed };
}

function approvePairing(name, code) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const access = readAccessJson(agent);
  const pending = access.pending[code];
  if (!pending) throw new Error(`대기 중인 코드가 아닙니다: ${code}`);

  if (!access.allowFrom.includes(pending.senderId)) {
    access.allowFrom.push(pending.senderId);
  }
  delete access.pending[code];
  writeAccessJson(agent, access);
}

function denyPairing(name, code) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const access = readAccessJson(agent);
  delete access.pending[code];
  writeAccessJson(agent, access);
}

function removeAllowedUser(name, userId) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  const access = readAccessJson(agent);
  access.allowFrom = access.allowFrom.filter((id) => id !== userId);
  writeAccessJson(agent, access);

  if (agent.discordContacts) {
    delete agent.discordContacts[userId];
    store.save(data);
  }
}

function setContactLabel(name, userId, label) {
  const data = store.load();
  const agent = data.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`에이전트를 찾을 수 없습니다: ${name}`);

  agent.discordContacts = agent.discordContacts || {};
  if (label) {
    agent.discordContacts[userId] = label;
  } else {
    delete agent.discordContacts[userId];
  }
  store.save(data);
}

function parseClaudeMd(content) {
  // 옛 형식(공통 규칙 + 개별 역할 링크 2개)에서도 마지막 링크가 해당 에이전트 고유 페이지일 가능성이 높음
  const urls = content.match(/https?:\/\/\S+/g) || [];
  const roleMatch = content.match(/너는\s+\S+라는\s+(.+?)(?:야|입니다)/);
  return {
    notionUrl: urls.length ? urls[urls.length - 1] : '',
    roleOneLiner: roleMatch ? roleMatch[1].trim() : ''
  };
}

function scanUnregisteredAgents() {
  const data = store.load();
  if (!fs.existsSync(data.agentsRoot)) return [];

  const registeredFolders = new Set(data.agents.map((a) => path.resolve(a.folder)));
  const entries = fs.readdirSync(data.agentsRoot, { withFileTypes: true });

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(data.agentsRoot, entry.name);
    if (registeredFolders.has(path.resolve(folder))) continue;

    const settingsPath = path.join(folder, '.claude', 'settings.json');
    const claudeMdPath = path.join(folder, 'CLAUDE.md');
    const hasSettings = fs.existsSync(settingsPath);
    const hasClaudeMd = fs.existsSync(claudeMdPath);
    if (!hasSettings && !hasClaudeMd) continue; // 에이전트 폴더로 보이지 않으면 제외

    let discordStateDir = '';
    if (hasSettings) {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        discordStateDir = parsed?.env?.DISCORD_STATE_DIR || '';
      } catch (e) {
        // ignore malformed settings.json
      }
    }

    let roleOneLiner = '';
    let notionUrl = '';
    if (hasClaudeMd) {
      const parsed = parseClaudeMd(fs.readFileSync(claudeMdPath, 'utf-8'));
      roleOneLiner = parsed.roleOneLiner;
      notionUrl = parsed.notionUrl;
    }

    const runtime = discordStateDir.startsWith('/') ? 'wsl' : 'windows';
    results.push({ name: entry.name, folder, discordStateDir, roleOneLiner, notionUrl, runtime });
  }

  return results;
}

function importAgent(name) {
  const data = store.load();
  if (data.agents.some((a) => a.name === name)) {
    throw new Error(`이미 등록된 에이전트 이름입니다: ${name}`);
  }

  const detected = scanUnregisteredAgents().find((a) => a.name === name);
  if (!detected) throw new Error(`가져올 수 있는 에이전트를 찾지 못했습니다: ${name}`);

  const agent = {
    name: detected.name,
    folder: detected.folder,
    runtime: detected.runtime,
    roleOneLiner: detected.roleOneLiner,
    notionUrl: detected.notionUrl,
    discordStateDir: detected.discordStateDir || `${data.discordStateBase}/discord-${slugify(name)}`,
    discordToken: '',
    createdAt: new Date().toISOString()
  };

  data.agents.push(agent);
  store.save(data);
  return agent;
}

function getSettings() {
  const { agentsRoot, discordStateBase, discordStateBaseWsl } = store.load();
  return { agentsRoot, discordStateBase, discordStateBaseWsl };
}

function updateSettings(partial) {
  const data = store.load();
  Object.assign(data, partial);
  store.save(data);
  return getSettings();
}

function detectWslDiscordStateBase() {
  const home = wsl.detectWslHome();
  if (!home) return null;
  return `${home}/.claude/channels`;
}

module.exports = {
  createAgent,
  updateAgent,
  listAgents,
  deleteAgent,
  checkDiscordStateDir,
  ensureDiscordConfigured,
  getDiscordAccess,
  approvePairing,
  denyPairing,
  removeAllowedUser,
  setContactLabel,
  listDiscordChannels,
  addDiscordChannel,
  removeDiscordChannel,
  connectNotionWorkspace,
  refreshNotionWorkspaceLabel,
  scanUnregisteredAgents,
  importAgent,
  getSettings,
  updateSettings,
  detectWslDiscordStateBase,
  slugify
};
