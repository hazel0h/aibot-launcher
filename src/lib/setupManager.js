const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const EventEmitter = require('events');
const store = require('./store');
const sessionManager = require('./sessionManager');
const { envWithFreshPath } = require('./freshEnv');

// 첫 실행 마법사 전용 — 에이전트 세션과 별개로, "claude 로그인"을 진행할 동안만
// 잠깐 띄우는 단발성 터미널. 에이전트 세션(sessionManager)의 sessions 맵과는
// 완전히 분리되어 있다 (특정 에이전트에 속하지 않는 로그인 절차이기 때문).
const emitter = new EventEmitter();

// exePath가 .cmd/.bat(예: npm 전역 설치본 claude.cmd)면 shell 없이는 실행 자체가 안
// 되고(EINVAL), cmd.exe를 프로그램으로 두고 exePath를 인자 배열 항목으로 넘기는
// 방법도 시도해봤지만 cmd.exe의 /c 재해석 규칙 때문에 경로에 공백이 있으면
// ("C:\Users\Generic User\...") 여전히 깨진다(직접 재현해서 확인함). 실제로 되는
// 방법은 shell: true를 쓰되 exePath를 우리가 직접 큰따옴표로 감싸는 것 - shell: true는
// file/args를 그대로 이어붙이기만 하고 따옴표를 안 씌워주므로, 공백이 있는 경로는
// 호출하는 쪽에서 직접 따옴표를 책임져야 한다(Node 공식 문서에 명시된 동작).
function execClaudeFile(exePath, args, options) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exePath)) {
    return execFileSync(`"${exePath}"`, args, { ...options, shell: true });
  }
  return execFileSync(exePath, args, options);
}
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
    const out = execFileSync('node', ['-v'], { encoding: 'utf-8', timeout: 10000, env: envWithFreshPath() });
    return { ok: true, version: out.trim() };
  } catch (e) {
    return { ok: false };
  }
}

// Claude Code CLI 설치 방식에 따라 실행 파일이 진짜 .exe(예: ~/.local/bin/claude.exe)일
// 수도, npm 전역 설치의 배치 파일(claude.cmd)일 수도 있다. execClaudeFile()이 두 경우
// 모두(공백이 포함된 경로 포함) 안전하게 처리한다.
function checkClaude() {
  try {
    const exe = sessionManager.resolveClaudeExecutable();
    const out = execClaudeFile(exe, ['--version'], {
      encoding: 'utf-8',
      timeout: 10000,
      env: envWithFreshPath()
    });
    return { ok: true, path: exe, version: out.trim() };
  } catch (e) {
    return { ok: false };
  }
}

function installClaudeCli() {
  try {
    // npm도 마찬가지로 실제로는 npm.cmd라서 shell 없이는 못 찾는다(ENOENT).
    const out = execFileSync('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      encoding: 'utf-8',
      timeout: 180000,
      shell: true,
      env: envWithFreshPath()
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString() };
  }
}

function installDiscordPlugin() {
  try {
    const exe = sessionManager.resolveClaudeExecutable();
    const out = execClaudeFile(exe, ['plugin', 'install', 'discord@claude-plugins-official'], {
      encoding: 'utf-8',
      timeout: 60000,
      env: envWithFreshPath()
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString() };
  }
}

// Discord(및 Telegram) 채널 플러그인의 실제 서버는 bun으로 실행되는 스크립트다
// (#!/usr/bin/env bun). node/claude가 멀쩡해도 bun이 없으면 그 서버 프로세스
// 스폰 자체가 실패해서, 게이트웨이 연결 시도조차 못 하고 봇이 영원히 오프라인으로
// 남는다 - 에러 메시지도 잘 안 보여서 원인 찾기가 특히 어려웠던 문제
// (실제 사용자 컴퓨터에서 겪고 나서 이 체크를 추가함). 공식 설치 스크립트로
// 깔면 %USERPROFILE%\.bun\bin\bun.exe로 진짜 실행 파일이 생겨서, npm/claude.cmd
// 때와 달리 shell 관련 이슈가 없다.
function resolveBunExecutable() {
  const home = os.homedir();
  const candidate = path.join(home, '.bun', 'bin', 'bun.exe');
  if (fs.existsSync(candidate)) return candidate;
  return 'bun'; // PATH에 있을 수도 있음 - execFileSync가 PATH에서 찾아줌
}

function checkBun() {
  try {
    const exe = resolveBunExecutable();
    const out = execFileSync(exe, ['--version'], {
      encoding: 'utf-8',
      timeout: 10000,
      env: envWithFreshPath()
    });
    return { ok: true, version: out.trim() };
  } catch (e) {
    return { ok: false };
  }
}

function installBun() {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm bun.sh/install.ps1 | iex'],
      { encoding: 'utf-8', timeout: 120000, env: envWithFreshPath() }
    );
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
  loginProc = pty.spawn(exe, [], { name: 'xterm-color', cols, rows, env: envWithFreshPath() });
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
  checkBun,
  installBun,
  startLoginTerminal,
  stopLoginTerminal,
  writeLoginInput,
  resizeLoginTerminal,
  emitter
};
