const $ = (id) => document.getElementById(id);
let current = null;
let thirdPerson = false;
let localBusy = false;
let lastSignature = '';
let traceRecords = [];
let promptedForKey = false;
let pendingCommand = null;
let keySaving = false;

async function api(url, payload) {
  const res = await fetch(url, payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}
function labelFor(id, record) {
  return record.request.state.availableActions.find((a) => a.id === id)?.label || id;
}
function renderStatus(state) {
  current = state;
  $('key-status').textContent = state.configured ? '官方 Jev 密钥已配置' : '未检测到 Jev 密钥，请输入后开始';
  $('configure-key').textContent = state.configured ? '更换密钥' : '输入密钥';
  $('configure-key').disabled = localBusy || state.busy || state.running;
  if (!state.configured && !promptedForKey) {
    promptedForKey = true;
    openKeyDialog();
  }
  const campMode=state.mode==='camp';
  $('camp-task').disabled=localBusy||!state.ready||state.busy||state.running;
  $('camp-task').hidden=campMode;
  $('mission-title').textContent=campMode?'搭建一个可以走进去的营地。':'砍树，回营地，搭木柱。';
  $('mission-copy').textContent=campMode?'地板、围墙、玻璃窗、屋顶与入口，加上工作台、熔炉、篝火、座位和照明。蓝图已给定，Jev 选择施工顺序。':'空手出发，在森林收集 4 块原木，到营地的金色地基上搭 3 格高木柱。';
  $('label-wood').textContent=campMode?'铺设地板':'采集原木';
  $('label-tower').textContent=campMode?'围墙与屋顶':'搭起木柱';
  $('label-home').textContent=campMode?'营地设施':'返回营地';
  $('won-title').textContent=campMode?'营地建好了，可以走进去看看。':'任务完成，木柱搭好了。';
  $('connection').textContent = state.ready ? `开源世界已连接 · 官方 Jev ${state.configured ? '已配置' : '未配置'}` : '正在连接开源世界';
  $('loading').hidden = state.ready;
  $('message').textContent = state.message;
  $('message').dataset.status = state.world?.finished ? 'won' : state.error ? 'error' : state.busy ? 'acting' : state.running ? 'running' : 'ready';
  $('steps').textContent = `第 ${state.steps} 步`;
  $('run').disabled = localBusy || !state.ready || (!state.running && state.busy) || state.world?.finished || state.steps >= (state.maxSteps||30);
  $('run').textContent = state.running ? 'Ⅱ 暂停演示' : state.busy ? '正在执行…' : state.world?.finished ? '✓ 任务已完成' : !state.configured ? '输入密钥并开始' : state.steps ? '▶ 继续让 Jev 玩' : '▶ 让 Jev 开始';
  $('step').disabled = localBusy || !state.ready || state.busy || state.running || state.world?.finished || state.steps >= (state.maxSteps||30);
  $('reset').disabled = localBusy || !state.ready || state.busy || state.running;
  $('error').hidden = !state.error;
  if (state.error) $('error').textContent = `演示已暂停：${state.error}。可以继续让模型重新选择，或重置世界。`;
  $('light').classList.toggle('busy', Boolean(state.busy));
  if (state.world) {
    const world = state.world;
    $('position').textContent = [world.position.x,world.position.y,world.position.z].map(n=>Number(n).toFixed(1)).join(', ');
    $('wood').textContent = world.wood;
    $('inventory-label').textContent = world.wood ? `原木 ${world.wood} 块` : '空手';
    $('hearts').textContent = Array.from({ length: 10 }, (_, i) => i * 2 < world.health ? '♥' : '♡').join(' ');
    if(campMode){const p=world.campProgress;
      $('collected').textContent=`${p.floor.done} / ${p.floor.total}`;
      $('tower').textContent=`${p.structure.done} / ${p.structure.total}`;
      $('home').textContent=`${p.facilities.done} / ${p.facilities.total}`;
      $('p-wood').classList.toggle('done',p.floor.done===p.floor.total);
      $('p-tower').classList.toggle('done',p.structure.done===p.structure.total);
      $('p-home').classList.toggle('done',p.facilities.done===p.facilities.total);
      $('inventory-label').textContent=`建筑材料 ${world.inventory.reduce((s,i)=>s+i.count,0)} 件`;
    }else{
      $('collected').textContent = `${world.collected} / 4`;
      $('tower').textContent = `${world.towerHeight} / 3`;
      $('home').textContent = world.finished ? '已完成' : world.nearCamp ? '在营地' : '在森林';
      $('p-wood').classList.toggle('done', world.collected >= 4);
      $('p-tower').classList.toggle('done', world.towerHeight === 3);
      $('p-home').classList.toggle('done', world.finished);
    }
    $('won').hidden = !world.finished;
    if (world.finished) $('won-copy').textContent = campMode?`官方 Jev 用 ${state.steps} 次决策完成 ${world.total} 块营地施工，入口保持畅通。`:`官方 Jev 用 ${state.steps} 次决策完成采集与建造，背包还剩 ${world.wood} 块原木。`;
  }
  const signature = `${state.id}:${state.steps}:${state.last?.effect}:${state.last?.ok}`;
  if (signature !== lastSignature) {
    lastSignature = signature;
    if (state.last) {
      const record = state.last;
      $('decision').textContent = record.action.label;
      $('effect').textContent = record.effect;
      $('model').textContent = record.model;
      $('latency').textContent = `${record.latencyMs} ms`;
      $('prob-note').hidden = false;
      $('probabilities').replaceChildren();
      const entries = Object.entries(record.answer.probabilities).sort((a, b) => b[1] - a[1]);
      for (const [id, probability] of entries) {
        const row = document.createElement('div'); row.className = 'probability';
        if (id === record.answer.choice) row.classList.add('selected');
        row.style.setProperty('--p', `${Math.min(100, Math.max(0, probability * 100))}%`);
        const label = document.createElement('span'); label.textContent = `${id === record.answer.choice ? '↳ ' : ''}${labelFor(id, record)}`;
        const value = document.createElement('b'); value.textContent = `${(probability * 100).toFixed(1)}%`;
        row.append(label, value); $('probabilities').append(row);
      }
    } else {
      $('decision').textContent = '还没有开始决策'; $('effect').textContent = 'Jev 选择操作，Mineflayer 控制机器人执行。';
      $('model').textContent = '模型待确认'; $('latency').textContent = '— ms'; $('probabilities').replaceChildren(); $('prob-note').hidden = true;
    }
    $('history').replaceChildren();
    if (!state.history.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '开始后会逐步记录模型选择和游戏结果。'; $('history').append(p); }
    for (const record of state.history.toReversed()) {
      const row = document.createElement('button'); row.className = `history-row${record.ok ? '' : ' error'}`;
      const label = document.createElement('strong'); label.textContent = `${String(record.step).padStart(2, '0')} · ${record.label}`;
      const time = document.createElement('em'); time.textContent = `${record.latencyMs} ms ↗`;
      const effect = document.createElement('small'); effect.textContent = record.effect;
      row.append(label, time, effect); row.addEventListener('click', () => inspect(record.step)); $('history').append(row);
    }
  }
}
async function update() {
  try { renderStatus(await api('/api/status')); }
  catch (error) { $('connection').textContent = '服务暂未连接'; $('error').textContent = error.message; $('error').hidden = false; }
}
async function control(command) {
  if (localBusy) return;
  if (['run', 'step'].includes(command) && !current?.configured) {
    openKeyDialog(command); return;
  }
  localBusy = true; if (current) renderStatus(current);
  try { renderStatus(await api('/api/control', { command })); }
  catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
  finally { localBusy = false; await update(); }
}
function openKeyDialog(command = null) {
  pendingCommand = command;
  $('key-title').textContent = current?.configured ? '更换官方 Jev 密钥' : '输入官方 Jev 密钥';
  $('key-error').hidden = true;
  if (!$('key-dialog').open) $('key-dialog').showModal();
}
function closeKeyDialog() {
  if (!keySaving) $('key-dialog').close();
}
$('configure-key').addEventListener('click', () => openKeyDialog());
$('close-key').addEventListener('click', closeKeyDialog);
$('skip-key').addEventListener('click', closeKeyDialog);
$('key-dialog').addEventListener('cancel', (event) => { if (keySaving) event.preventDefault(); });
$('key-dialog').addEventListener('close', () => { $('jev-key').value = ''; pendingCommand = null; });
$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (keySaving) return;
  keySaving = true;
  $('save-key').disabled = true;
  $('save-key').textContent = '正在启用…';
  $('key-error').hidden = true;
  try {
    await api('/api/config/jev', { apiKey: $('jev-key').value });
    const command = pendingCommand;
    $('jev-key').value = '';
    $('key-dialog').close();
    await update();
    if (command) await control(command);
  } catch (error) {
    $('jev-key').value = '';
    $('key-error').textContent = error.message;
    $('key-error').hidden = false;
  } finally {
    keySaving = false;
    $('save-key').disabled = false;
    $('save-key').textContent = '输入并启用';
  }
});
$('run').addEventListener('click', () => control(current?.running ? 'pause' : 'run'));
$('step').addEventListener('click', () => control('step'));
$('reset').addEventListener('click', () => control('reset'));
$('camp-task').addEventListener('click',()=>control('camp'));
$('camera').addEventListener('click', () => {
  thirdPerson = !thirdPerson;
  $('viewer').src = `/view/?camera=${thirdPerson ? 'third' : 'first'}`;
  $('camera').textContent = thirdPerson ? '切换第一人称 ↗' : '切换第三人称 ↗';
  $('mode-label').textContent = thirdPerson ? '第三人称' : '第一人称';
  $('crosshair').hidden = thirdPerson;
  $('world-note').textContent = thirdPerson ? '拖动旋转 · 滚轮缩放 · 观察 Jev 的实际行动' : '你看到的是 Jev 机器人的实时视角';
});
$('fullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.game-panel').requestFullscreen();
});
async function inspect(step) {
  try {
    const data = await api('/api/records'); traceRecords = data.records;
    $('trace-step').replaceChildren();
    for (const record of traceRecords) {
      const option = document.createElement('option'); option.value = record.step; option.textContent = `第 ${record.step} 步 · ${record.action.label}`; $('trace-step').append(option);
    }
    const chosen = step || traceRecords.at(-1)?.step;
    if (chosen) $('trace-step').value = chosen;
    fillTrace(chosen); if (!$('trace').open) $('trace').showModal();
  } catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
}
function fillTrace(step) {
  const record = traceRecords.find((r) => r.step === Number(step));
  $('request').textContent = record ? JSON.stringify(record.request, null, 2) : '尚无请求。';
  $('response').textContent = record ? JSON.stringify({ response: record.response, actualExecution: { action: record.action, ok: record.ok, effect: record.effect, after: record.after } }, null, 2) : '尚无响应。';
}
$('inspect').addEventListener('click', () => inspect());
$('trace-step').addEventListener('change', (event) => fillTrace(event.target.value));
$('close-trace').addEventListener('click', () => $('trace').close());
await update(); setInterval(update, 800);
