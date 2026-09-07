const fs = require('fs');
const path = require('path');
const os = require('os');
const pty = require('node-pty');
const EventEmitter = require('events');
const { WSL_EXE, toWslPath } = require('./wsl');

// key: agent name -> { proc, logs: string[] }
const sessions = new Map();
const MAX_LOG_CHARS = 500_000;

const emitter = new EventEmitter();

function resolveClaudeExecutable() {
  if (process.platform !== 'win32') return 'claude';

  const exts = ['.exe', '.cmd', '.bat', ''];
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, 'claude' + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const fallback = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(fallback)) return fallback;

  throw new Error('claude 실행 파일을 찾을 수 없습니다. PATH에 claude가 설치되어 있는지 확인하세요.');
}

// Discord로 대화하는 게 이 프레임워크의 핵심이라 채널 플러그인 없이 그냥 claude만
// 띄우면 (대화형 화면은 뜨지만) 디스코드 봇 연결 자체가 안 된다.
const CHANNEL_ARGS = ['--channels', 'plugin:discord@claude-plugins-official'];

// CLAUDE.md는 Claude Code가 세션 시작 시 자동으로 읽지만, 거기 적힌 "노션 역할
// 페이지를 읽어라"는 지시까지 실제로 수행하는 건 누군가 말을 걸어야 시작된다.
// 세션이 뜨자마자 자동으로 이 프롬프트를 넣어줘서, Discord로 첫 대화가 오기 전에
// 미리 역할을 숙지해두게 한다. node-pty는 실제 tty라 자식 프로세스가 아직 입력을
// 못 받는 상태여도 커널이 버퍼링해주므로, 넉넉한 지연 없이 보내도 대개 안전하다.
const AUTO_ROLE_PROMPT = 'CLAUDE.md를 읽고, 거기 링크된 Notion 역할 페이지를 열어서 내용을 숙지해줘.';
const AUTO_ROLE_PROMPT_DELAY_MS = 3000;

function resolveCommand(agent) {
  if (agent.runtime === 'wsl') {
    // bash -lc는 비대화형으로 간주되어 ~/.bashrc 맨 위의
    // "대화형 아니면 return" 가드에 걸려 .bashrc가 통째로 스킵된다.
    // bun 같은 도구의 PATH가 .bashrc에서만 설정되는 경우(설치 스크립트 기본 동작)
    // 여기서 못 찾아 discord/telegram 플러그인이 조용히 실패하므로,
    // 실제 터미널을 열었을 때와 동일하게 -i(대화형)로 띄워 .bashrc가 항상 적용되게 한다.
    const cmd = ['claude', ...CHANNEL_ARGS].join(' ');
    return {
      exe: WSL_EXE,
      args: ['--cd', toWslPath(agent.folder), '-e', 'bash', '-ic', cmd]
    };
  }
  return { exe: resolveClaudeExecutable(), args: [...CHANNEL_ARGS] };
}

function appendLog(name, chunk) {
  const session = sessions.get(name);
  if (!session) return;
  session.logBuffer += chunk;
  if (session.logBuffer.length > MAX_LOG_CHARS) {
    session.logBuffer = session.logBuffer.slice(session.logBuffer.length - MAX_LOG_CHARS);
  }
  emitter.emit('log', { name, chunk });
}

function startSession(agent, { cols = 100, rows = 30 } = {}) {
  if (sessions.has(agent.name) && sessions.get(agent.name).proc) {
    throw new Error(`이미 실행 중인 세션입니다: ${agent.name}`);
  }

  const { exe, args } = resolveCommand(agent);
  const proc = pty.spawn(exe, args, {
    name: 'xterm-color',
    cols,
    rows,
    cwd: agent.runtime === 'wsl' ? undefined : agent.folder,
    env: process.env
  });

  sessions.set(agent.name, { proc, logBuffer: '' });

  proc.onData((chunk) => appendLog(agent.name, chunk));

  proc.onExit(({ exitCode }) => {
    appendLog(agent.name, `\r\n[세션 종료됨: exit code ${exitCode}]\r\n`);
    const session = sessions.get(agent.name);
    if (session) session.proc = null;
    emitter.emit('status', { name: agent.name, running: false });
  });

  if (agent.autoReadOnStart !== false) {
    setTimeout(() => {
      const session = sessions.get(agent.name);
      if (session && session.proc) session.proc.write(AUTO_ROLE_PROMPT + '\r');
    }, AUTO_ROLE_PROMPT_DELAY_MS);
  }

  emitter.emit('status', { name: agent.name, running: true });
  return true;
}

function stopSession(name) {
  const session = sessions.get(name);
  if (!session || !session.proc) {
    throw new Error(`실행 중인 세션이 없습니다: ${name}`);
  }
  session.proc.kill();
  return true;
}

function writeInput(name, data) {
  const session = sessions.get(name);
  if (!session || !session.proc) {
    throw new Error(`실행 중인 세션이 없습니다: ${name}`);
  }
  session.proc.write(data);
  return true;
}

function resizeSession(name, cols, rows) {
  const session = sessions.get(name);
  if (!session || !session.proc) return false;
  session.proc.resize(cols, rows);
  return true;
}

function getStatus(name) {
  const session = sessions.get(name);
  return { running: !!(session && session.proc) };
}

function getLogs(name) {
  const session = sessions.get(name);
  return session ? session.logBuffer : '';
}

function stopAll() {
  for (const session of sessions.values()) {
    if (session.proc) session.proc.kill();
  }
}

module.exports = {
  startSession,
  stopSession,
  stopAll,
  writeInput,
  resizeSession,
  getStatus,
  getLogs,
  resolveClaudeExecutable,
  emitter
};
