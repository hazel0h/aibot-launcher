// GitHub Release 발행 전용 스크립트.
//
// electron-builder가 exe/blockmap 파일을 동시에 업로드할 때, 해당 태그의 릴리스가
// 아직 없으면 각 업로드가 독립적으로 "릴리스 없음 -> 새로 생성"을 시도해서
// 같은 태그로 릴리스가 2개(파일이 나뉜 채로) 생기는 경쟁 상태(race condition)가
// 실제로 발생했다. 그래서 electron-builder를 부르기 "전에" 이 스크립트가 먼저
// draft 릴리스를 만들어두면, electron-builder의 두 업로드 모두 "이미 있는 릴리스"를
// 찾아서 거기에 파일만 추가하므로 경쟁이 생기지 않는다. 빌드가 끝나면 draft를
// 정식 공개(draft:false)로 전환한다 - electron-updater는 draft 릴리스를 무시하므로
// 이 마지막 단계가 없으면 자동 업데이트가 새 버전을 못 찾는다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');

function readToken(fileName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, fileName), 'utf-8')).token || '';
  } catch (e) {
    return '';
  }
}

const token = readToken('publish-token.local.json');
if (!token) {
  console.error(
    `발행용 토큰이 없습니다. ${path.join(ROOT, 'publish-token.local.json')} 파일을 만들고 { "token": "쓰기권한토큰" } 형식으로 채워주세요.`
  );
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const tag = `v${version}`;
const OWNER = 'hazel0h';
const REPO = 'aibot-launcher';

function gh(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'User-Agent': 'aibot-launcher-release-script',
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        }
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          const parsed = chunks ? JSON.parse(chunks) : null;
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`GitHub API ${method} ${apiPath} -> ${res.statusCode}: ${chunks}`));
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ghWithRetry(method, apiPath, body, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await gh(method, apiPath, body);
    } catch (e) {
      if (i === attempts) throw e;
      console.warn(`[release] ${method} ${apiPath} 실패 (${i}/${attempts}), 재시도: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function findReleaseByTag(t) {
  try {
    return await gh('GET', `/repos/${OWNER}/${REPO}/releases/tags/${t}`);
  } catch (e) {
    return null; // 404 등 - 없는 것으로 취급
  }
}

async function main() {
  let release = await findReleaseByTag(tag);
  if (!release) {
    console.log(`[release] draft 릴리스 미리 생성: ${tag}`);
    release = await gh('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: tag,
      target_commitish: 'main',
      name: tag,
      draft: true,
      prerelease: false
    });
  } else if (!release.draft) {
    console.error(
      `[release] ${tag} 릴리스가 이미 "공개" 상태로 존재합니다. package.json의 version을 올린 뒤 다시 시도해주세요.`
    );
    process.exit(1);
  } else {
    console.log(`[release] 기존 draft 릴리스 재사용: ${tag}`);
  }

  execFileSync('npx', ['electron-builder', '--publish', 'always'], {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: token },
    shell: true
  });

  console.log(`[release] ${tag} 정식 공개로 전환`);
  const published = await ghWithRetry('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.id}`, {
    draft: false
  });
  console.log(
    `[release] 완료: ${published.html_url} (assets: ${(published.assets || []).map((a) => a.name).join(', ') || '(빌드 시점 목록엔 안 보일 수 있음 - GitHub에서 확인)'})`
  );
}

main().catch((err) => {
  console.error('[release] 실패:', err.message);
  process.exit(1);
});
