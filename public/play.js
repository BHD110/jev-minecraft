const $=id=>document.getElementById(id);
const socket=io({path:'/play/control/socket.io'});
const surface=$('input-surface');
const names={oak_planks:'橡木木板',cobblestone:'圆石',dirt:'泥土',glass:'玻璃',oak_log:'橡木原木',iron_pickaxe:'铁镐',iron_axe:'铁斧',iron_shovel:'铁锹',stone_bricks:'石砖',grass_block:'草方块',oak_leaves:'橡树叶',stone:'石头',air:'空气'};
const icons={oak_planks:'planks',cobblestone:'stone',dirt:'dirt',glass:'glass',oak_log:'log',stone_bricks:'bricks'};
const keys={},keyMap={KeyW:'forward',KeyS:'back',KeyA:'left',KeyD:'right',Space:'jump',ControlLeft:'sprint',ControlRight:'sprint',ShiftLeft:'sneak',ShiftRight:'sneak'};
let current=null,active=false,owned=false,yaw=0,pitch=0,mining=false,dragging=false,initialized=false,selected=0,hotbarSignature='',dragDistance=0,dragButton=0,holdTimer=null;
function send(){if(owned&&socket.connected)socket.emit('input',{yaw,pitch,keys:active?keys:{},mining:active&&mining});}
function resetControls(){for(const key of Object.keys(keys))delete keys[key];mining=false;dragging=false;clearTimeout(holdTimer);send();}
function pause(){active=false;document.body.classList.remove('playing');resetControls();if(document.pointerLockElement)document.exitPointerLock();$('welcome').hidden=false;$('enter').textContent='继续玩';socket.emit('release');owned=false;}
async function enter(lock=true){
  if(!current?.ready)return;
  if(!owned){socket.emit('claim');}
  active=true;$('welcome').hidden=true;surface.focus();
  if(lock){try{await surface.requestPointerLock();document.body.classList.add('playing');$('mode-note').textContent='WASD 走动 · 鼠标转头 · 左键挖掘 · 右键放置 · Esc 暂停';}
    catch{$('mode-note').textContent='拖动 / 方向键转头 · 左键挖掘 · 右键放置 · Esc 暂停';}}
}
function pick(slot){selected=(slot+9)%9;socket.emit('slot',selected);renderHotbar(true);}
function renderHotbar(force=false){
  if(!current)return;const signature=JSON.stringify([current.hotbar,selected]);if(!force&&signature===hotbarSignature)return;hotbarSignature=signature;
  $('hotbar').replaceChildren();
  current.hotbar.forEach((item,i)=>{const button=document.createElement('button');button.className=`slot ${i===selected?'active':''}`;button.setAttribute('aria-label',`选择 ${i+1}：${item?(names[item.name]||item.name):'空手'}`);button.title=`${i+1} · ${item?(names[item.name]||item.name)+' × '+item.count:'空手'}`;
    const number=document.createElement('span');number.className='number';number.textContent=i+1;button.append(number);
    if(item){const icon=document.createElement('i');icon.className=icons[item.name]?`block-icon ${icons[item.name]}`:'tool-icon';if(!icons[item.name])icon.textContent=item.name.includes('pickaxe')?'⛏':item.name.includes('shovel')?'♠':'⚒';button.append(icon);const count=document.createElement('span');count.className='count';count.textContent=item.count;button.append(count);}
    button.addEventListener('click',()=>{if(!owned)socket.emit('claim');pick(i);});$('hotbar').append(button);
  });
  const item=current.hotbar[selected];$('selected-name').textContent=item?`${names[item.name]||item.name} × ${item.count}`:'空手';
}
function render(state){
  current=state;if(!initialized){yaw=state.yaw;pitch=state.pitch;selected=state.selected;initialized=true;}
  if(!active){yaw=state.yaw;pitch=state.pitch;}
  $('connection').textContent=state.ready?'已连接 · 你的角色 Player':'角色已断开，请刷新或重启项目';
  $('enter').disabled=!state.ready;if(!active&&$('enter').textContent.includes('正在'))$('enter').textContent='进入世界，自己玩';
  $('position').textContent=`${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)}`;
  $('hearts').textContent=Array.from({length:10},(_,i)=>i*2<state.health?'♥':'♡').join(' ');
  const target=state.target;$('target').textContent=target?`瞄准：${names[target.name]||target.name}`:'瞄准附近的方块';
  $('dig-progress').hidden=!state.digging;$('dig-progress').value=state.digging;
  $('message').textContent=state.message.replace(/oak_planks|cobblestone|grass_block|oak_log|stone_bricks|oak_leaves|dirt|glass|stone/g,name=>names[name]||name);renderHotbar();
  if($('bag-dialog').open)renderBag();
}
socket.on('state',render);
socket.on('claimed',state=>{owned=true;yaw=state.yaw;pitch=state.pitch;render(state);send();});
socket.on('notice',text=>{pause();$('mode-note').textContent=text;});
socket.on('disconnect',()=>{active=false;owned=false;initialized=false;resetControls();document.body.classList.remove('playing');if(document.pointerLockElement)document.exitPointerLock();$('welcome').hidden=false;$('enter').disabled=true;$('enter').textContent='连接断开，正在重连…';$('connection').textContent='连接断开，正在重连…';});
$('enter').addEventListener('click',()=>enter());
surface.addEventListener('click',()=>{if(!active)enter();});
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==surface&&active&&document.body.classList.contains('playing'))pause();});
document.addEventListener('mousemove',event=>{
  if(!active||!(document.pointerLockElement===surface||dragging))return;
  if(dragging){dragDistance+=Math.abs(event.movementX)+Math.abs(event.movementY);if(dragDistance>4){clearTimeout(holdTimer);mining=false;}}
  yaw-=event.movementX*.0025;pitch=Math.max(-1.55,Math.min(1.55,pitch-event.movementY*.0025));send();
});
surface.addEventListener('mousedown',event=>{if(!active)return;event.preventDefault();if(document.pointerLockElement===surface){if(event.button===0){mining=true;send();}if(event.button===2)socket.emit('place');}else{dragging=true;dragDistance=0;dragButton=event.button;holdTimer=setTimeout(()=>{if(dragging&&dragDistance<=4&&dragButton===0){mining=true;send();}},180);}});
document.addEventListener('mouseup',()=>{if(dragging&&dragDistance<=4&&active){if(dragButton===0&&!mining)socket.emit('dig_once');if(dragButton===2)socket.emit('place');}clearTimeout(holdTimer);mining=false;dragging=false;send();});
surface.addEventListener('contextmenu',event=>event.preventDefault());
surface.addEventListener('wheel',event=>{if(!active)return;event.preventDefault();pick(selected+(event.deltaY>0?1:-1));},{passive:false});
document.addEventListener('keydown',event=>{
  if(event.code==='Escape'){if(active){event.preventDefault();pause();}return;}
  if(!active)return;
  if(keyMap[event.code]){event.preventDefault();keys[keyMap[event.code]]=true;send();return;}
  if(event.code.startsWith('Arrow')){event.preventDefault();keys[event.code]=true;return;}
  if(/^Digit[1-9]$/.test(event.code)){event.preventDefault();pick(Number(event.code.slice(-1))-1);}
  if(event.code==='KeyE'&&!event.repeat){event.preventDefault();showBag();}
});
document.addEventListener('keyup',event=>{if(keyMap[event.code]){delete keys[keyMap[event.code]];send();}delete keys[event.code];});
setInterval(()=>{
  if(active){if(keys.ArrowLeft)yaw+=.05;if(keys.ArrowRight)yaw-=.05;if(keys.ArrowUp)pitch=Math.min(1.55,pitch+.035);if(keys.ArrowDown)pitch=Math.max(-1.55,pitch-.035);}
  send();
},50);
window.addEventListener('blur',()=>{if(active)pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)pause();});
window.addEventListener('pagehide',()=>{resetControls();socket.emit('release');});
function renderBag(){
  $('bag-items').replaceChildren();for(const item of current?.inventory||[]){const row=document.createElement('div');row.textContent=`${names[item.name]||item.name} × ${item.count}`;$('bag-items').append(row);}
}
function showBag(){pause();renderBag();$('bag-dialog').showModal();}
$('bag').addEventListener('click',showBag);
$('help').addEventListener('click',()=>{pause();$('help-dialog').showModal();});
document.querySelectorAll('dialog .close').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$('fullscreen').addEventListener('click',async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await $('game').requestFullscreen();});
function claimedAction(event){
  if(!owned){socket.emit('claim');socket.once('claimed',()=>socket.emit(event));}else socket.emit(event);
}
$('home').addEventListener('click',()=>{resetControls();claimedAction('home');});
$('dig').addEventListener('click',()=>claimedAction('dig_once'));
$('place').addEventListener('click',()=>claimedAction('place'));
