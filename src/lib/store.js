const fs = require('fs');
const path = require('path');
const os = require('os');

// 원래는 Electron 기본 userData 경로(AppData\Roaming)에 저장했었는데,
// 이 경로가 개발 환경과 실제 실행 환경에서 서로 다른 파일을 가리키는
// 문제가 있었음(같은 경로 문자열이어도 물리적으로 다른 파일).
// 항상 같은 프로젝트 폴더 안에 저장하도록 바꿔서 이 문제를 원천 차단한다.
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'launcher-data.json');

const DEFAULTS = {
  agentsRoot: path.join(os.homedir(), 'ClaudeAgents'),
  discordStateBase: `${os.homedir().replace(/\\/g, '/')}/.claude/channels`,
  discordStateBaseWsl: '', // 예: /home/사용자명/.claude/channels (설정 화면의 "자동 감지"로 채움)
  agents: [], // { name, folder, runtime: 'windows'|'wsl', roleOneLiner, notionUrl, discordStateDir, discordToken, createdAt }
  setupWizardDone: false // 첫 실행 마법사(Claude 로그인/플러그인 설치)를 이미 완료/건너뛰었는지
};

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const merged = { ...DEFAULTS, ...JSON.parse(raw) };
    delete merged.commonRulesUrl; // 폐기된 설정 - 남아있으면 제거
    return merged;
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { load, save, DATA_FILE };
