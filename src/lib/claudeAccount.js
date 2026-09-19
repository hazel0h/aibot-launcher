const os = require('os');
const path = require('path');

// Claude Code의 로그인 정보, MCP(Notion 등) OAuth 토큰, 플러그인은 전부 설정 폴더
// (기본 ~/.claude)에 저장되어 같은 PC의 모든 에이전트가 공유한다. 한 에이전트에서 다른
// 계정으로 로그인하거나 Notion을 다시 연결하면 전부 같이 바뀌는 이유다.
// 에이전트별 "전용 Claude 계정" 옵션(agent.separateClaude)을 켜면 CLAUDE_CONFIG_DIR로
// 그 에이전트만의 설정 폴더를 따로 줘서 로그인/Notion/플러그인을 완전히 분리한다.

function agentSlug(agent) {
  // discordStateDir(.../discord-<slug>)의 slug를 그대로 재사용해 이름 규칙을 통일
  const base = path.posix.basename(String(agent.discordStateDir || '').replace(/\\/g, '/'));
  const slug = base.replace(/^discord-/, '');
  return slug || String(agent.name).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-');
}

// Windows 실행용 실제 폴더 경로
function windowsConfigDir(agent) {
  return path.join(os.homedir(), '.claude-agents', agentSlug(agent));
}

// WSL 안에서 쓰는 폴더 - bash가 $HOME을 풀어주도록 문자열 그대로 둔다
function wslConfigDir(agent) {
  return `$HOME/.claude-agents/${agentSlug(agent)}`;
}

// child_process/pty에 추가로 넘길 env (Windows 실행 에이전트용)
function agentClaudeEnv(agent) {
  if (agent && agent.separateClaude && agent.runtime !== 'wsl') {
    return { CLAUDE_CONFIG_DIR: windowsConfigDir(agent) };
  }
  return {};
}

// WSL bash -ic 명령 앞에 붙일 prefix
function wslEnvPrefix(agent) {
  if (agent && agent.separateClaude && agent.runtime === 'wsl') {
    return `export CLAUDE_CONFIG_DIR="${wslConfigDir(agent)}" && `;
  }
  return '';
}

module.exports = { agentSlug, windowsConfigDir, wslConfigDir, agentClaudeEnv, wslEnvPrefix };
