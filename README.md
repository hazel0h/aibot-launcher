# 디코노션ai 런처

Discord + Claude Code + Notion으로 개인 AI 에이전트를 운영하는 [디코노션ai](.) 프레임워크의 에이전트 생성/세션 관리용 데스크톱 앱(Electron, Windows 전용).

## 할 수 있는 것

- 새 에이전트 생성: 이름·역할·Notion 역할 페이지 링크·Discord 봇 토큰을 입력하면 `.claude/settings.json` + `CLAUDE.md`를 자동 생성
- 에이전트별 Claude Code 세션을 실제 터미널(대화형)로 시작/중지
- Windows 네이티브 또는 WSL 중 실행 환경 선택 (에이전트별로 다르게 지정 가능)
- 이미 폴더만 있는(런처로 안 만든) 기존 에이전트를 자동 감지해서 가져오기
- 트레이 상주 — 창을 닫아도 백그라운드에서 계속 실행

## 사전 준비

1. **Node.js** (18 이상 권장) — 이것만 미리 설치해두면 됩니다.
2. 나머지(**Claude Code CLI 설치/확인**, **Claude 계정 로그인**, **Discord 채널 플러그인 설치**)는 앱을 처음 켜면 뜨는
   **🚀 시작 가이드** 마법사 안에서 버튼 클릭으로 진행할 수 있습니다 (사이드바 하단에서 언제든 다시 열 수 있음).
   - Claude 로그인만은 실제 계정 인증이라 브라우저에서 승인 클릭 한 번은 직접 해야 합니다.
3. WSL 쪽 에이전트를 쓸 계획이면 **WSL**과 그 안에 Claude Code CLI(+플러그인)가 별도로 설치되어 있어야 함 (Windows 쪽 설치와 완전히 별개, 시작 가이드는 Windows 쪽만 도와줍니다)

## 설치

```bash
git clone <이 저장소 URL>
cd LauncherApp
npm install
```

## 실행

개발/테스트용:

```bash
npm start
```

⚠️ 이 방법은 터미널 창에 붙어서 실행되기 때문에, **그 터미널을 닫으면 앱도 같이 꺼집니다.**

터미널 없이 완전히 백그라운드로 띄우려면, 아래 PowerShell 스니펫으로 바로가기(`.lnk`)를 한 번 만들어두고 그걸 더블클릭해서 쓰세요 (경로는 실제 설치 위치로 바꿔서 실행):

```powershell
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$PWD\런처 시작.lnk")
$Shortcut.TargetPath = "$PWD\node_modules\electron\dist\electron.exe"
$Shortcut.Arguments = "."
$Shortcut.WorkingDirectory = "$PWD"
$Shortcut.Save()
```

## 첫 실행 후

1. 사이드바 하단 **⚙ 설정**에서 에이전트 루트 폴더(기본값: `~/ClaudeAgents`)와 필요하면 WSL Discord 상태 경로("자동 감지" 버튼 사용)를 확인/설정
2. **+ 새 에이전트**로 만들거나, 이미 있는 에이전트 폴더가 감지되면 사이드바의 "폴더에서 감지됨" 목록에서 **가져오기**
3. 에이전트 선택 → **세션 시작** → 뜨는 터미널 안에서 (WSL/Windows 어느 쪽이든) 필요하면 `/discord:configure`, `/discord:access` 등으로 봇 페어링 진행

## 알아두면 좋은 것

- 데이터(에이전트 목록·설정)는 `data/launcher-data.json`에 저장됩니다. 이 파일은 개인 정보(디스코드 토큰, 상태 경로 등)를 담기 때문에 `.gitignore`에 포함되어 있고, 없으면 첫 실행 시 자동으로 새로 만들어집니다.
- Windows 전용입니다 (WSL 실행 지원 포함 — macOS/Linux 지원은 없음).
- 여러 명이 함께 쓰는 프레임워크의 배경/설계 원칙은 상위 폴더의 디코노션ai 문서를 참고하세요.

## 라이선스

MIT (필요하면 다른 라이선스로 바꿔도 됩니다 — 임의로 골라둔 기본값입니다)
