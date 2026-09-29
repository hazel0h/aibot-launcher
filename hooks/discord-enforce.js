#!/usr/bin/env node
// Claude Code hook — Discord 채널 규칙을 "부탁"이 아니라 코드로 강제한다.
// 대화가 길어지면 텍스트 지시(CLAUDE.md/Notion 규칙)는 흐려지지만, 이 스크립트는
// 매 도구 호출마다 실행되므로 항상 똑같이 작동한다.
//
// 강제하는 것 두 가지:
// 1. Discord에서 온 메시지를 처리하는 턴에서는, react(리액션)를 하기 전까지 다른
//    어떤 도구도 못 쓰게 막는다 ("확인했을 때 이모지를 바로 표시할 것").
// 2. reply(답장) 도구를 쓸 때 reply_to가 비어있으면 막는다 ("항상 답글로 남길 것").
//
// Claude Code 훅 프로토콜(exit code 기반):
//   exit 0  -> 그대로 진행
//   exit 2  -> 이 도구 호출을 막고, stderr 내용을 Claude에게 이유로 돌려줌(재시도 유도)
// 두 이벤트(UserPromptSubmit, PreToolUse) 모두 settings.json에서 이 스크립트를
// 이벤트 이름을 인자로 붙여서 등록한다 - 이 파일 하나가 두 역할을 다 한다.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REACT_TOOL = 'mcp__plugin_discord_discord__react';
const REPLY_TOOL = 'mcp__plugin_discord_discord__reply';
// 실제로 Discord로 결과를 내보내는(=반드시 리액션이 선행됐어야 하는) 도구들.
// 그 외의 조사/읽기 도구(fetch_messages 등)는 굳이 막지 않는다 - 막으면 "지금 뭐가
// 왔는지부터 확인"하는 정상적인 흐름까지 깨진다.
const GATED_TOOLS = new Set([REPLY_TOOL, 'mcp__plugin_discord_discord__edit_message']);

const STATE_DIR = path.join(os.tmpdir(), 'aibot-launcher-discord-hook-state');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch (e) {
    return '';
  }
}

function statePath(sessionId) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return path.join(STATE_DIR, `${sessionId}.json`);
}

function block(reason) {
  process.stderr.write(reason + '\n');
  process.exit(2);
}

function main() {
  const event = process.argv[2];
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch (e) {
    process.exit(0); // 입력을 못 읽으면 막지 않는다 - 안전하게 통과
  }

  const sessionId = payload.session_id || 'unknown';
  const sp = statePath(sessionId);

  if (event === 'user-prompt-submit') {
    // 새 메시지가 들어올 때마다 상태를 리셋한다. Discord 채널 플러그인이 실어보낸
    // 메시지인지(fromDiscord)와, 그런 메시지에 아직 리액션을 안 했는지(reacted)를
    // 따로 기억해둔다 - 런처가 세션 시작 직후 자동으로 넣는 "CLAUDE.md 읽어줘" 같은
    // 터미널 프롬프트나, 나중에 만들 "매일 자동 보고"처럼 실제 Discord 수신 메시지가
    // 아닌 턴까지 이 규칙에 걸려서 막히면 안 되기 때문.
    const prompt = String(payload.prompt || '');
    const fromDiscord = /<channel\s+source="discord"/i.test(prompt);
    fs.writeFileSync(sp, JSON.stringify({ fromDiscord, reacted: !fromDiscord }), 'utf-8');
    process.exit(0);
  }

  if (event === 'pre-tool-use') {
    const toolName = payload.tool_name || '';
    const toolInput = payload.tool_input || {};

    let state = { fromDiscord: false, reacted: true };
    try {
      state = JSON.parse(fs.readFileSync(sp, 'utf-8'));
    } catch (e) {
      // 상태 파일이 없으면(UserPromptSubmit 훅이 아직 한 번도 안 돈 세션 등) 막지 않는다
    }

    if (toolName === REACT_TOOL) {
      state.reacted = true;
      fs.writeFileSync(sp, JSON.stringify(state), 'utf-8');
      process.exit(0);
    }

    if (GATED_TOOLS.has(toolName) && !state.reacted) {
      block(
        '아직 이 메시지에 리액션(👀 또는 ⏳)을 남기지 않았습니다. ' +
          'react 도구로 먼저 리액션을 남긴 뒤 다시 시도하세요.'
      );
    }

    // reply_to 강제는 "실제 Discord 수신 메시지에 답하는 턴"에서만 건다. 예약된
    // 일일 보고처럼 특정 메시지에 대한 답장이 아니라 스스로 올리는 글은 reply_to가
    // 없는 게 정상이라 여기 걸리면 안 된다.
    if (toolName === REPLY_TOOL && state.fromDiscord) {
      const replyTo = toolInput.reply_to;
      if (!replyTo || !String(replyTo).trim()) {
        block(
          'reply_to가 비어있습니다. Discord 메시지에 답할 때는 항상 답글(reply_to)로 남겨야 합니다. ' +
            'reply_to에 방금 받은 메시지의 message_id를 채워서 다시 호출하세요.'
        );
      }
    }

    process.exit(0);
  }

  process.exit(0);
}

main();
