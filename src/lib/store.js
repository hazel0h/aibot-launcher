const fs = require('fs');
const path = require('path');
const os = require('os');

// 개발 중(npm start)에는 프로젝트 폴더 안 data/에 저장한다 - 예전에 Electron
// 기본 userData 경로(AppData\Roaming)를 썼을 때, 개발 도구 프로세스와 실제
// 실행 중인 앱이 같은 경로 문자열을 물리적으로 다른 파일로 보는 문제가 있어서
// 이렇게 바꿨었다.
//
// 하지만 "패키징된"(설치된) 앱에서는 코드 자체가 app.asar라는 압축 파일 안에
// 들어있어서, __dirname 기준 상대 경로로 쓰기를 시도하면 asar 내부는 진짜
// 디렉터리가 아니라 항상 ENOTDIR로 실패한다(에이전트 생성이 전부 깨지는 실제
// 버그로 발견됨). 그래서 패키징된 앱에서는 Electron의 표준 저장 위치인
// userData(%APPDATA%\<앱이름>)를 쓴다 - 이건 실제 사용자 컴퓨터에서는 문제
// 없는 정상적인 위치다(개발 중 겪었던 문제는 우리 도구 프로세스만의 특수한
// 상황이었지, 실제 설치된 앱을 쓰는 사용자에게는 해당하지 않는다).
function resolveDataDir() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return path.join(app.getPath('userData'), 'data');
    }
  } catch (e) {
    // Electron 메인 프로세스가 아닌 컨텍스트(순수 node 스크립트로 직접 테스트하는
    // 경우 등) - 아래 개발용 기본 경로를 그대로 쓴다.
  }
  return path.join(__dirname, '..', '..', 'data');
}

const DATA_DIR = resolveDataDir();
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
