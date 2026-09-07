const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 비공개 GitHub 저장소의 릴리스를 확인하려면 읽기 전용 토큰이 필요하다.
// 이 토큰은 절대 git에 커밋하지 않고, 패키징된 설치 파일에만
// electron-builder의 extraResources로 포함시킨다 (package.json build.extraResources 참고).
// 개발 중(npm start)에는 프로젝트 루트의 파일을, 패키징된 앱에서는
// resources 폴더의 파일을 읽는다.
function readTokenFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw).token || '';
  } catch (e) {
    return '';
  }
}

function loadToken() {
  if (app.isPackaged) {
    return readTokenFile(path.join(process.resourcesPath, 'update-token.local.json'));
  }
  return readTokenFile(path.join(__dirname, '..', '..', 'update-token.local.json'));
}

module.exports = loadToken();
