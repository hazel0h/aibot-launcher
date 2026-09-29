const path = require('path');

// hooks/discord-enforce.js는 src/ 밖(프로젝트 루트)에 두고 electron-builder의
// extraResources로 포함시킨다 - src/**는 app.asar 안으로 들어가는데, Claude Code가
// 훅을 실행할 때는 우리 Electron 프로세스가 아니라 "그냥 node"로 이 스크립트를
// 실행하므로, asar 내부 파일은 못 읽는다(Electron이 fs를 패치해줘야만 읽히는 경로라서
// - 예전에 launcher-data.json을 asar 안에 두려다 ENOTDIR로 걸렸던 것과 같은 종류의 문제).
// 개발 중(npm start)에는 프로젝트 루트의 hooks/, 패키징된 앱에서는 resources/hooks/.
// require('electron')은 진짜 Electron 프로세스 밖(순수 node 테스트 등)에서는 문자열을
// 돌려줘서 app이 undefined가 되므로, store.js와 동일하게 try/catch로 방어한다.
function discordHookScriptPath() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return path.join(process.resourcesPath, 'hooks', 'discord-enforce.js');
    }
  } catch (e) {
    // 순수 node 컨텍스트 - 아래 개발용 기본 경로를 쓴다
  }
  return path.join(__dirname, '..', '..', 'hooks', 'discord-enforce.js');
}

module.exports = { discordHookScriptPath };
