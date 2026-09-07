// GitHub Release 발행 전용 스크립트.
// publish-token.local.json (쓰기 권한 토큰, git에는 절대 안 올라감)을 읽어서
// GH_TOKEN 환경변수로만 넘겨준다 - 이 토큰은 배포되는 설치 파일 안에는 절대 포함되지 않는다
// (update-token.local.json - 읽기 전용, extraResources로 앱 안에 포함되는 것 - 과는 완전히 별개).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tokenPath = path.join(__dirname, '..', 'publish-token.local.json');
let token = '';
try {
  token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8')).token || '';
} catch (e) {
  // 파일이 없으면 아래에서 안내하고 종료
}

if (!token) {
  console.error(
    `발행용 토큰이 없습니다. ${tokenPath} 파일을 만들고 { "token": "쓰기권한토큰" } 형식으로 채워주세요.`
  );
  process.exit(1);
}

execFileSync('npx', ['electron-builder', '--publish', 'always'], {
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: token },
  shell: true
});
