const { execFileSync } = require('child_process');

// Windows에서 설치 프로그램이 PATH에 새 항목을 추가해도(예: bun 설치), 이미 떠 있던
// explorer.exe와 그 밑에서 실행되는 프로세스들(우리 앱 포함)은 로그오프/재부팅 전까지
// 그 변경을 못 본다 - process.env.PATH는 "이 앱이 시작될 때 상속받은" 스냅샷이라서다.
// 이 프로젝트에서 여러 번 반복된 문제(npm, bun 등 방금 설치한 도구를 못 찾음)라서,
// claude를 실행할 때만이라도 레지스트리에서 최신 PATH를 직접 읽어와 병합해 쓴다 -
// 이러면 사용자가 재부팅 안 해도 방금 설치한 도구를 바로 인식한다.
function readRegistryPath(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf-8', timeout: 5000 });
    const match = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    return match ? match[1].trim() : '';
  } catch (e) {
    return '';
  }
}

function getFreshPath() {
  if (process.platform !== 'win32') return process.env.PATH || '';

  const userPath = readRegistryPath('HKCU\\Environment');
  const systemPath = readRegistryPath(
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  );
  const inherited = process.env.PATH || '';

  const parts = [...systemPath.split(';'), ...userPath.split(';'), ...inherited.split(';')]
    .map((p) => p.trim())
    .filter(Boolean);

  return [...new Set(parts)].join(';');
}

// 자식 프로세스(claude 등)에 넘길 env 객체를 만든다 - process.env를 그대로 쓰되
// PATH만 레지스트리 기준 최신값으로 교체한다.
function envWithFreshPath() {
  return { ...process.env, PATH: getFreshPath() };
}

module.exports = { getFreshPath, envWithFreshPath };
