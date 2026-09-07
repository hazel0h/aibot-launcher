const { execFileSync } = require('child_process');
const pty = require('node-pty');
const EventEmitter = require('events');
const store = require('./store');
const sessionManager = require('./sessionManager');

// 첫 실행 마법사 전용 — 에이전트 세션과 별개로, "claude 로그인"을 진행할 동안만
// 잠깐 띄우는 단발성 터미널. 에이전트 세션(sessionManager)의 sessions 맵과는
// 완전히 분리되어 있다 (특정 에이전트에 속하지 않는 로그인 절차이기 때문).
const emitter = new EventEmitter();
let loginProc = null;

function isWizardDone() {
  return !!store.load().setupWizardDone;
}

function markWizardDone(done = true) {
  const data = store.load();
  data.setupWizardDone = done;
  store.save(data);
}

function checkNode() {
  try {
    const out = execFileSync('node', ['-v'], { encoding: 'utf-8', timeout: 10000 });
    return { ok: true, version: out.trim() };
  } catch (e) {
    return { ok: false };
  }
}

function checkClaude() {
  try {
    const exe = sessionManager.resolveClaudeExecutable();
    const out = execFileSync(exe, ['--version'], { encoding: 'utf-8', timeout: 10000 });
    return { ok: true, path: exe, version: out.trim() };
  } catch (e) {
    return { ok: false };
  }
}

function installClaudeCli() {
  try {
    // Windows에서 npm은 실제로 npm.cmd라서, shell 없이 execFileSync('npm', ...)로
    // 호출하면 PATHEXT 확장자 해석이 안 돼 ENOENT가 난다 (node.exe는 확장자가
    // 명시적이라 문제없이 찾아지는 것과 대조적). shell: true로 cmd.exe를 거치게 한다.
    const out = execFileSync('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      encoding: 'utf-8',
      timeout: 180000,
      shell: true
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString() };
  }
}

function installDiscordPlugin() {
  try {
    const exe = sessionManager.resolveClaudeExecutable();
    const out = execFileSync(exe, ['plugin', 'install', 'discord@claude-plugins-official'], {
      encoding: 'utf-8',
      timeout: 60000
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString() };
  }
}

// claude 로그인은 OAuth 방식이라 실제 tty가 있어야 브라우저 인증을 이어받을 수 있다
// (--print/execFileSync처럼 파이프로 실행하면 "stdin isn't a terminal" 에러로 즉시 실패).
function startLoginTerminal(cols = 100, rows = 24) {
  if (loginProc) return true;
  const exe = sessionManager.resolveClaudeExecutable();
  loginProc = pty.spawn(exe, [], { name: 'xterm-color', cols, rows, env: process.env });
  loginProc.onData((chunk) => emitter.emit('log', chunk));
  loginProc.onExit(() => {
    loginProc = null;
    emitter.emit('exit');
  });
  return true;
}

function stopLoginTerminal() {
  if (loginProc) {
    loginProc.kill();
    loginProc = null;
  }
}

function writeLoginInput(data) {
  if (loginProc) loginProc.write(data);
}

function resizeLoginTerminal(cols, rows) {
  if (loginProc) loginProc.resize(cols, rows);
}

module.exports = {
  isWizardDone,
  markWizardDone,
  checkNode,
  checkClaude,
  installClaudeCli,
  installDiscordPlugin,
  startLoginTerminal,
  stopLoginTerminal,
  writeLoginInput,
  resizeLoginTerminal,
  emitter
};
