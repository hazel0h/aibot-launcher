let agents = [];
let currentAgent = null;

const el = (id) => document.getElementById(id);

const term = new Terminal({
  convertEol: true,
  fontSize: 13,
  fontFamily: '"Cascadia Code", Consolas, monospace',
  theme: { background: '#0e0f12', foreground: '#e6e6e6' }
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(el('terminal'));

term.onData((data) => {
  if (currentAgent) window.api.session.write(currentAgent.name, data);
});

// 버튼 클릭 등으로 다른 요소가 포커스를 가져간 뒤에도 터미널 영역을 클릭하면
// 확실히 키 입력을 받도록 보강. (xterm 자체 mousedown 포커스만으로는
// 버튼 클릭 직후 포커스가 남아있는 경우가 있어 명시적으로 한 번 더 처리)
el('terminal').addEventListener('mousedown', () => term.focus());

function fitTerminal() {
  try {
    fitAddon.fit();
    if (currentAgent) {
      window.api.session.resize(currentAgent.name, term.cols, term.rows);
    }
  } catch (e) {
    // 터미널이 아직 보이지 않는 상태(hidden) 등에서는 fit이 실패할 수 있음
  }
}

window.addEventListener('resize', fitTerminal);

async function refreshAgentList() {
  agents = await window.api.agents.list();
  const list = el('agent-list');
  list.innerHTML = '';
  for (const agent of agents) {
    const li = document.createElement('li');
    li.dataset.name = agent.name;
    if (currentAgent && currentAgent.name === agent.name) li.classList.add('active');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = agent.name;
    li.appendChild(label);
    li.appendChild(dot);
    li.addEventListener('click', () => selectAgent(agent.name));
    list.appendChild(li);

    window.api.session.status(agent.name).then(({ running }) => {
      dot.classList.toggle('running', running);
    });
  }

  await refreshUnregisteredList();
}

async function refreshUnregisteredList() {
  const detected = await window.api.agents.scanUnregistered();
  const section = el('unregistered-section');
  const list = el('unregistered-list');
  list.innerHTML = '';

  if (detected.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  for (const item of detected) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${item.name} (${item.runtime === 'wsl' ? 'WSL' : 'Windows'})`;
    label.title = item.folder;
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = '가져오기';
    btn.addEventListener('click', async () => {
      const res = await window.api.agents.import(item.name);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      await refreshAgentList();
      selectAgent(res.agent.name);
    });
    li.appendChild(label);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function showView(id) {
  ['view-empty', 'view-agent', 'view-settings'].forEach((v) => el(v).classList.toggle('hidden', v !== id));
}

async function selectAgent(name) {
  currentAgent = agents.find((a) => a.name === name);
  if (!currentAgent) return;

  document.querySelectorAll('.agent-list li').forEach((li) => {
    li.classList.toggle('active', li.dataset.name === name);
  });

  el('agent-title').textContent = currentAgent.name;
  el('meta-folder').textContent = currentAgent.folder;
  const notionLink = el('meta-notion');
  notionLink.textContent = currentAgent.notionUrl || '(없음)';
  notionLink.href = currentAgent.notionUrl || '#';
  el('meta-discord-dir').textContent = currentAgent.discordStateDir;
  el('meta-runtime').textContent = currentAgent.runtime === 'wsl' ? 'WSL' : 'Windows';
  el('discord-check-result').textContent = '';
  el('discord-check-result').className = 'check-result';

  showView('view-agent');
  fitTerminal();

  term.reset();
  const buffered = await window.api.session.logs(name);
  if (buffered) term.write(buffered);

  const { running } = await window.api.session.status(name);
  setRunningUi(running);
  term.focus();
}

function setRunningUi(running) {
  el('agent-status').textContent = running ? '실행 중' : '중지됨';
  el('agent-status').classList.toggle('running', running);
  el('btn-start').disabled = running;
  el('btn-stop').disabled = !running;
}

window.api.session.onLog(({ name, chunk }) => {
  if (currentAgent && currentAgent.name === name) {
    term.write(chunk);
  }
});

window.api.session.onStatus(({ name, running }) => {
  if (currentAgent && currentAgent.name === name) {
    setRunningUi(running);
  }
  const li = document.querySelector(`.agent-list li[data-name="${CSS.escape(name)}"] .dot`);
  if (li) li.classList.toggle('running', running);
});

el('btn-start').addEventListener('click', async () => {
  if (!currentAgent) return;
  fitTerminal();
  term.reset();
  const res = await window.api.session.start(currentAgent, term.cols, term.rows);
  if (!res.ok) alert(res.error);
  term.focus();
});

el('btn-stop').addEventListener('click', async () => {
  if (!currentAgent) return;
  const res = await window.api.session.stop(currentAgent.name);
  if (!res.ok) alert(res.error);
});

el('btn-check-discord').addEventListener('click', async () => {
  if (!currentAgent) return;
  const res = await window.api.agents.checkDiscordState(currentAgent.name);
  const box = el('discord-check-result');
  if (!res.ok) {
    box.textContent = res.error;
    box.className = 'check-result fail';
    return;
  }
  const { exists, path, files } = res.result;
  if (exists) {
    box.textContent = `✓ 존재함: ${path} (파일 ${files.length}개: ${files.join(', ') || '없음'})`;
    box.className = 'check-result ok';
  } else {
    box.textContent = `✗ 아직 생성되지 않음: ${path} — 세션에서 /discord:configure 실행 필요`;
    box.className = 'check-result fail';
  }
});

el('btn-delete-agent').addEventListener('click', async () => {
  if (!currentAgent) return;
  const removeFiles = confirm(`"${currentAgent.name}"의 로컬 폴더까지 삭제할까요?\n확인=폴더까지 삭제, 취소=목록에서만 제거`);
  const btn = el('btn-delete-agent');
  btn.disabled = true;
  const res = await window.api.agents.delete(currentAgent.name, removeFiles);
  btn.disabled = false;
  if (!res.ok) {
    alert(`삭제 실패: ${res.error}`);
    return;
  }
  currentAgent = null;
  showView('view-empty');
  await refreshAgentList();
});

// ---- new agent modal ----
el('btn-new-agent').addEventListener('click', () => {
  el('new-name').value = '';
  el('new-role').value = '';
  el('new-notion').value = '';
  el('new-token').value = '';
  el('new-runtime').value = 'windows';
  el('new-agent-error').classList.add('hidden');
  el('modal-new-agent').classList.remove('hidden');
});

el('btn-cancel-new').addEventListener('click', () => {
  el('modal-new-agent').classList.add('hidden');
});

el('btn-create-agent').addEventListener('click', async () => {
  const payload = {
    name: el('new-name').value.trim(),
    roleOneLiner: el('new-role').value.trim(),
    notionUrl: el('new-notion').value.trim(),
    discordToken: el('new-token').value,
    runtime: el('new-runtime').value
  };
  const res = await window.api.agents.create(payload);
  if (!res.ok) {
    el('new-agent-error').textContent = res.error;
    el('new-agent-error').classList.remove('hidden');
    return;
  }
  el('modal-new-agent').classList.add('hidden');
  await refreshAgentList();
  selectAgent(res.agent.name);
});

// ---- edit agent modal ----
el('btn-edit-agent').addEventListener('click', () => {
  if (!currentAgent) return;
  el('edit-agent-title').textContent = `${currentAgent.name} 정보 수정`;
  el('edit-role').value = currentAgent.roleOneLiner || '';
  el('edit-notion').value = currentAgent.notionUrl || '';
  el('edit-token').value = '';
  el('edit-notion-workspace-label').value = currentAgent.notionWorkspaceLabel || '';
  el('edit-auto-read').checked = currentAgent.autoReadOnStart !== false;
  el('edit-agent-error').classList.add('hidden');
  el('modal-edit-agent').classList.remove('hidden');
});

el('btn-cancel-edit').addEventListener('click', () => {
  el('modal-edit-agent').classList.add('hidden');
});

el('btn-save-edit').addEventListener('click', async () => {
  if (!currentAgent) return;
  const patch = {
    roleOneLiner: el('edit-role').value.trim(),
    notionUrl: el('edit-notion').value.trim(),
    autoReadOnStart: el('edit-auto-read').checked
  };
  const token = el('edit-token').value;
  if (token) patch.discordToken = token;

  const res = await window.api.agents.update(currentAgent.name, patch);
  if (!res.ok) {
    el('edit-agent-error').textContent = res.error;
    el('edit-agent-error').classList.remove('hidden');
    return;
  }
  el('modal-edit-agent').classList.add('hidden');
  await refreshAgentList();
  selectAgent(res.agent.name);
});

let notionPollTimer = null;

function stopNotionPolling() {
  if (notionPollTimer) {
    clearInterval(notionPollTimer);
    notionPollTimer = null;
  }
}

el('btn-connect-notion').addEventListener('click', async () => {
  if (!currentAgent) return;
  const agentName = currentAgent.name;

  const res = await window.api.agents.connectNotionWorkspace(agentName);
  if (!res.ok) {
    alert(res.error);
    return;
  }
  alert('잠시 후 브라우저가 열립니다. 연결하려는 Notion 워크스페이스 계정으로 로그인/선택해주세요.\n로그인을 마치면 이 창의 "현재 연결된 워크스페이스" 칸이 잠시 후 자동으로 채워집니다.');

  el('edit-notion-workspace-label').placeholder = '연결 확인 중...';

  stopNotionPolling();
  let attempts = 0;
  notionPollTimer = setInterval(async () => {
    attempts++;
    const r = await window.api.agents.refreshNotionWorkspaceLabel(agentName);
    if (r.ok && r.result.status === 'connected') {
      el('edit-notion-workspace-label').value = r.result.label;
      if (currentAgent) currentAgent.notionWorkspaceLabel = r.result.label;
      stopNotionPolling();
      return;
    }
    if (attempts >= 24) {
      // 2분(24 * 5초)이 지나도 안 되면 그만 확인한다
      el('edit-notion-workspace-label').placeholder = '아직 연결 안 함';
      stopNotionPolling();
    }
  }, 5000);
});

el('btn-cancel-edit').addEventListener('click', stopNotionPolling);
el('btn-save-edit').addEventListener('click', stopNotionPolling);

// ---- settings ----
el('btn-settings').addEventListener('click', async () => {
  const s = await window.api.settings.get();
  el('set-agents-root').value = s.agentsRoot;
  el('set-discord-base').value = s.discordStateBase;
  el('set-discord-base-wsl').value = s.discordStateBaseWsl || '';
  showView('view-settings');
});

el('btn-detect-wsl').addEventListener('click', async () => {
  const detected = await window.api.settings.detectWslBase();
  if (!detected) {
    alert('WSL 홈 디렉터리를 찾지 못했습니다. WSL이 설치·실행 가능한 상태인지 확인해주세요.');
    return;
  }
  el('set-discord-base-wsl').value = detected;
});

el('btn-save-settings').addEventListener('click', async () => {
  await window.api.settings.update({
    agentsRoot: el('set-agents-root').value.trim(),
    discordStateBase: el('set-discord-base').value.trim(),
    discordStateBaseWsl: el('set-discord-base-wsl').value.trim()
  });
  alert('저장되었습니다. (기존 에이전트에는 소급 적용되지 않습니다)');
});

el('btn-quit-app').addEventListener('click', () => {
  if (confirm('런처를 완전히 종료할까요? 실행 중인 모든 에이전트 세션도 함께 종료됩니다.')) {
    window.api.app.quit();
  }
});

window.api.app.onRefresh(async () => {
  await refreshAgentList();
  if (currentAgent) await selectAgent(currentAgent.name);
});

// ---- discord access management ----
async function refreshDiscordAccessModal() {
  if (!currentAgent) return;
  const res = await window.api.agents.getDiscordAccess(currentAgent.name);
  if (!res.ok) {
    alert(res.error);
    return;
  }
  const { pending, allowed } = res.result;

  const pendingList = el('pairing-pending-list');
  pendingList.innerHTML = '';
  el('pairing-pending-empty').classList.toggle('hidden', pending.length > 0);
  for (const p of pending) {
    const li = document.createElement('li');
    const idSpan = document.createElement('span');
    idSpan.className = 'access-id';
    idSpan.textContent = `코드 ${p.code}`;
    const metaSpan = document.createElement('span');
    metaSpan.className = 'access-meta';
    metaSpan.textContent = `발신자 ${p.senderId}`;
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn primary';
    approveBtn.textContent = '승인';
    approveBtn.addEventListener('click', async () => {
      const r = await window.api.agents.approvePairing(currentAgent.name, p.code);
      if (!r.ok) return alert(r.error);
      refreshDiscordAccessModal();
    });
    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn ghost';
    denyBtn.textContent = '거절';
    denyBtn.addEventListener('click', async () => {
      const r = await window.api.agents.denyPairing(currentAgent.name, p.code);
      if (!r.ok) return alert(r.error);
      refreshDiscordAccessModal();
    });
    li.appendChild(idSpan);
    li.appendChild(metaSpan);
    li.appendChild(approveBtn);
    li.appendChild(denyBtn);
    pendingList.appendChild(li);
  }

  const allowedList = el('pairing-allowed-list');
  allowedList.innerHTML = '';
  el('pairing-allowed-empty').classList.toggle('hidden', allowed.length > 0);
  for (const a of allowed) {
    const li = document.createElement('li');
    const idSpan = document.createElement('span');
    idSpan.className = 'access-id';
    idSpan.textContent = a.id;
    const labelInput = document.createElement('input');
    labelInput.className = 'access-label-input';
    labelInput.placeholder = '누구인지 메모';
    labelInput.value = a.label;
    labelInput.addEventListener('change', async () => {
      const r = await window.api.agents.setContactLabel(currentAgent.name, a.id, labelInput.value.trim());
      if (!r.ok) alert(r.error);
    });
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn ghost';
    removeBtn.textContent = '삭제';
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`${a.label || a.id}를 허용 목록에서 삭제할까요?`)) return;
      const r = await window.api.agents.removeAllowedUser(currentAgent.name, a.id);
      if (!r.ok) return alert(r.error);
      refreshDiscordAccessModal();
    });
    li.appendChild(idSpan);
    li.appendChild(labelInput);
    li.appendChild(removeBtn);
    allowedList.appendChild(li);
  }

  const chRes = await window.api.agents.listDiscordChannels(currentAgent.name);
  const channelList = el('channel-list');
  channelList.innerHTML = '';
  if (chRes.ok) {
    el('channel-list-empty').classList.toggle('hidden', chRes.result.length > 0);
    for (const c of chRes.result) {
      const li = document.createElement('li');
      const idSpan = document.createElement('span');
      idSpan.className = 'access-id';
      idSpan.textContent = c.id;
      const labelInput = document.createElement('input');
      labelInput.className = 'access-label-input';
      labelInput.placeholder = '메모 (예: #일반)';
      labelInput.value = c.label;
      labelInput.addEventListener('change', async () => {
        const r = await window.api.agents.addDiscordChannel(currentAgent.name, c.id, labelInput.value.trim());
        if (!r.ok) alert(r.error);
      });
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn ghost';
      removeBtn.textContent = '삭제';
      removeBtn.addEventListener('click', async () => {
        if (!confirm(`${c.label || c.id} 채널을 목록에서 삭제할까요?`)) return;
        const r = await window.api.agents.removeDiscordChannel(currentAgent.name, c.id);
        if (!r.ok) return alert(r.error);
        refreshDiscordAccessModal();
      });
      li.appendChild(idSpan);
      li.appendChild(labelInput);
      li.appendChild(removeBtn);
      channelList.appendChild(li);
    }
  }
}

el('btn-discord-access').addEventListener('click', async () => {
  if (!currentAgent) return;
  el('discord-access-title').textContent = `${currentAgent.name} Discord 접근 관리`;
  el('new-channel-input').value = '';
  el('new-channel-memo').value = '';
  el('modal-discord-access').classList.remove('hidden');
  await refreshDiscordAccessModal();
});

el('btn-close-discord-access').addEventListener('click', () => {
  el('modal-discord-access').classList.add('hidden');
});

el('btn-add-channel').addEventListener('click', async () => {
  if (!currentAgent) return;
  const input = el('new-channel-input').value.trim();
  const memo = el('new-channel-memo').value.trim();
  if (!input) {
    alert('채널 링크 또는 채널 ID를 입력해주세요.');
    return;
  }
  const r = await window.api.agents.addDiscordChannel(currentAgent.name, input, memo);
  if (!r.ok) {
    alert(r.error);
    return;
  }
  el('new-channel-input').value = '';
  el('new-channel-memo').value = '';
  await refreshDiscordAccessModal();
});

// ---- 첫 실행 마법사 ----
const setupTerm = new Terminal({
  convertEol: true,
  fontSize: 13,
  fontFamily: '"Cascadia Code", Consolas, monospace',
  theme: { background: '#0e0f12', foreground: '#e6e6e6' }
});
const setupFitAddon = new FitAddon.FitAddon();
setupTerm.loadAddon(setupFitAddon);
setupTerm.open(el('setup-terminal'));
setupTerm.onData((data) => window.api.setup.writeLoginInput(data));
el('setup-terminal').addEventListener('mousedown', () => setupTerm.focus());

window.api.setup.onLoginLog((chunk) => setupTerm.write(chunk));
window.api.setup.onLoginExit(() => {
  setupTerm.write('\r\n[로그인 세션 종료됨]\r\n');
  el('btn-wizard-stop-login').disabled = true;
});

function setCheckResult(elId, ok, text) {
  const node = el(elId);
  node.textContent = text;
  node.classList.remove('ok', 'fail');
  node.classList.add(ok ? 'ok' : 'fail');
}

async function wizardCheckNode() {
  const r = await window.api.setup.checkNode();
  el('wizard-node-hint').classList.toggle('hidden', r.ok);
  setCheckResult('wizard-node-status', r.ok, r.ok ? `설치됨 (${r.version})` : '설치되어 있지 않음');
}

async function wizardCheckClaude() {
  const r = await window.api.setup.checkClaude();
  setCheckResult(
    'wizard-claude-status',
    r.ok,
    r.ok ? `설치됨 (${r.version || r.path})` : '설치되어 있지 않거나 PATH에서 찾을 수 없음'
  );
}

el('btn-wizard-check-node').addEventListener('click', wizardCheckNode);
el('btn-wizard-check-claude').addEventListener('click', wizardCheckClaude);

el('btn-wizard-install-claude').addEventListener('click', async () => {
  const btn = el('btn-wizard-install-claude');
  btn.disabled = true;
  setCheckResult('wizard-claude-status', true, '설치 중... (몇 분 걸릴 수 있습니다)');
  const r = await window.api.setup.installClaudeCli();
  btn.disabled = false;
  if (!r.ok) {
    setCheckResult('wizard-claude-status', false, `설치 실패: ${r.error}`);
    return;
  }
  await wizardCheckClaude();
});

el('btn-wizard-start-login').addEventListener('click', async () => {
  setupTerm.reset();
  await window.api.setup.startLoginTerminal(setupTerm.cols, setupTerm.rows);
  setupTerm.focus();
  el('btn-wizard-stop-login').disabled = false;
});

el('btn-wizard-stop-login').addEventListener('click', async () => {
  await window.api.setup.stopLoginTerminal();
  el('btn-wizard-stop-login').disabled = true;
});

el('btn-wizard-install-discord').addEventListener('click', async () => {
  const btn = el('btn-wizard-install-discord');
  btn.disabled = true;
  setCheckResult('wizard-discord-status', true, '설치 중...');
  const r = await window.api.setup.installDiscordPlugin();
  btn.disabled = false;
  if (!r.ok) {
    setCheckResult('wizard-discord-status', false, `설치 실패: ${r.error}`);
    return;
  }
  setCheckResult('wizard-discord-status', true, '설치 완료 (이미 설치되어 있었어도 정상입니다)');
});

async function openWizard() {
  el('modal-setup-wizard').classList.remove('hidden');
  setTimeout(() => setupFitAddon.fit(), 50);
  await Promise.all([wizardCheckNode(), wizardCheckClaude()]);
}

el('btn-open-wizard').addEventListener('click', openWizard);

el('btn-wizard-close').addEventListener('click', async () => {
  await window.api.setup.stopLoginTerminal();
  el('btn-wizard-stop-login').disabled = true;
  el('modal-setup-wizard').classList.add('hidden');
  await window.api.setup.markWizardDone(true);
});

refreshAgentList();

(async () => {
  const done = await window.api.setup.isWizardDone();
  if (!done) openWizard();
})();
