import { createRequire } from 'node:module';
import { once } from 'node:events';
import { attachViewer, Server } from './viewer-server.mjs';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const itemRequire = createRequire(require.resolve('flying-squid'));
const CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];
const FACES = [new Vec3(0,-1,0),new Vec3(0,1,0),new Vec3(0,0,-1),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(1,0,0)];
export function cleanInput(input) {
  if (!input || typeof input !== 'object') return null;
  const yaw = Number(input.yaw), pitch = Number(input.pitch);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return { yaw: yaw % (Math.PI * 2), pitch: Math.max(-1.55, Math.min(1.55,pitch)),
    keys: Object.fromEntries(CONTROLS.map(key => [key,input.keys?.[key] === true])),
    mining: input.mining === true };
}
export async function attachHumanPlayer({http,app,server,port,camp,marker}) {
  const player = mineflayer.createBot({host:'127.0.0.1',port,version:'1.16.5',username:'Player',auth:'offline'});
  let ready=false, connected=true, owner=null, lastInput=0, mining=false, singleDig=false, actionBusy=false;
  let message='正在进入世界…', digStarted=0, digDuration=0, digId=null;
  let lastAction=null;
  player.on('error',error=>{message=`连接出错：${error.message}`; console.error('[human]',error.message);});
  player.on('end',()=>{connected=false;ready=false;stop();});
  player.on('death',()=>{message='角色正在重生…';setTimeout(()=>player.respawn(),500);});
  await once(player,'spawn'); await player.waitForChunksToLoad();
  const serverPlayer=Object.values(server.players).find(p=>p.username==='Player'||p._client?.username==='Player');
  if (!serverPlayer) throw new Error('用户角色没有连接到世界');
  const Item=itemRequire('prismarine-item')(server.registry);
  const kit=[['oak_planks',64],['cobblestone',64],['dirt',64],['glass',32],['oak_log',32],['iron_pickaxe',1],['iron_axe',1],['iron_shovel',1],['stone_bricks',64]];
  // 演示开局材料由服务端发放，随后挖掘与建造仍使用生存背包。
  for (let slot=0;slot<kit.length;slot++) {
    const [name,count]=kit[slot]; serverPlayer.inventory.updateSlot(36+slot,new Item(server.registry.itemsByName[name].id,count,0));
  }
  player.setQuickBarSlot(0);
  await player.look(Math.PI,0,true);
  ready=true;message='已进入世界 · 点击画面开始玩';
  attachViewer(http,app,player,camp,marker,'/play/view');
  const io=new Server(http,{path:'/play/control/socket.io',maxHttpBufferSize:4096,
    allowRequest:(req,callback)=>{
      const origin=req.headers.origin;
      callback(null,!origin||origin===`http://${http.address().address}:${http.address().port}`||origin===`http://localhost:${http.address().port}`);
    }});
  function stop(){mining=false;singleDig=false;player.clearControlStates();if(player.targetDigBlock)player.stopDigging();}
  function cursor(){
    try{const {yaw,pitch,position}=player.entity;const cp=Math.cos(pitch);
      return player.world.raycast(position.offset(0,player.entity.eyeHeight||1.62,0),new Vec3(-Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp),4.5);
    }catch{return null;}
  }
  function state(){
    const p=player.entity.position,block=cursor();
    return {ready,connected,controlled:Boolean(owner),position:{x:p.x,y:p.y,z:p.z},yaw:player.entity.yaw,pitch:player.entity.pitch,
      health:player.health,food:player.food,selected:player.quickBarSlot,message,lastAction,
      target:block?{name:block.name,position:block.position,face:block.face}:null,
      digging:player.targetDigBlock?Math.min(1,(performance.now()-digStarted)/Math.max(1,digDuration)):0,
      inventory:player.inventory.items().map(({name,count})=>({name,count})),
      hotbar:Array.from({length:9},(_,i)=>{const item=player.inventory.slots[36+i];return item?{name:item.name,count:item.count}:null;})};
  }
  app.get('/api/player',(_req,res)=>res.json(state()));
  function note(effect,before,after){lastAction={at:new Date().toISOString(),effect,before,after};message=effect;}
  async function dig(){
    if(actionBusy||!mining||!ready)return;
    const block=cursor();if(!block||!player.canDigBlock(block)||block.name==='bedrock')return;
    actionBusy=true;digId=block.position.toString();digStarted=performance.now();digDuration=player.digTime(block);
    const before={block:block.name,position:block.position};
    try {await player.dig(block,'ignore');
      const after=player.blockAt(block.position);
      if(after?.type!==block.type)note(`挖开了 ${block.name}`,before,{block:after?.name,position:block.position});
    } catch(error){if(!/aborted|cancel/i.test(error.message))message='挖掘已停止，请重新瞄准';}
    finally{actionBusy=false;digId=null;}
  }
  async function place(){
    if(actionBusy||!ready)return;
    const block=cursor(),held=player.heldItem;
    if(!block){message='瞄准 4.5 格内的方块表面再放置';return;}
    if(!held||!server.registry.blocksByName[held.name]){message='请按 1—5 或 9 选择建筑方块';return;}
    const face=FACES[block.face];if(!face)return;
    const destination=block.position.plus(face),beforeCount=held.count;
    // 不能把方块放进自身的碰撞体积。
    const p=player.entity.position;
    if(p.x+.3>destination.x&&p.x-.3<destination.x+1&&p.z+.3>destination.z&&p.z-.3<destination.z+1&&p.y+1.8>destination.y&&p.y<destination.y+1){message='这个位置会卡住自己，换一个位置放';return;}
    actionBusy=true;mining=false;
    try{await player._placeBlockWithOptions(block,face,{forceLook:'ignore',swingArm:'right'});
      const placed=player.blockAt(destination);
      note(`放置了 ${held.name}`,{count:beforeCount,position:destination},{count:player.inventory.slots[36+player.quickBarSlot]?.count||0,block:placed?.name,position:destination});
    }catch(error){message='这里不能放置方块，请换一个表面';}
    finally{actionBusy=false;}
  }
  io.on('connection',socket=>{
    socket.emit('state',state());
    socket.on('claim',()=>{if(owner&&owner!==socket.id){socket.emit('notice','另一页正在控制这个角色，请先在那页退出操作');return;}owner=socket.id;lastInput=Date.now();socket.emit('claimed',state());});
    socket.on('input',raw=>{
      if(owner!==socket.id||!ready)return;
      const input=cleanInput(raw);if(!input)return;
      lastInput=Date.now();player.look(input.yaw,input.pitch,true).catch(()=>{});
      for(const key of CONTROLS)player.setControlState(key,input.keys[key]);
      mining=input.mining||singleDig;
      if(player.targetDigBlock&&(!mining||cursor()?.position.toString()!==digId))player.stopDigging();
    });
    socket.on('slot',value=>{if(owner===socket.id&&Number.isInteger(value)&&value>=0&&value<9&&!actionBusy){player.setQuickBarSlot(value);socket.emit('state',state());}});
    socket.on('place',()=>{if(owner===socket.id)place();});
    socket.on('dig_once',async()=>{if(owner===socket.id&&!actionBusy){singleDig=true;mining=true;try{await dig();}finally{singleDig=false;mining=false;}}});
    socket.on('home',()=>{
      if(owner!==socket.id||actionBusy)return;stop();serverPlayer.teleport(new Vec3(camp.x-1,camp.y,camp.z));
      note('已返回营地',null,{position:camp});setTimeout(()=>socket.emit('state',state()),300);
    });
    socket.on('release',()=>{if(owner===socket.id){stop();owner=null;}});
    socket.on('disconnect',()=>{if(owner===socket.id){stop();owner=null;}});
  });
  const timer=setInterval(()=>{
    if(!connected)return;
    if(owner&&Date.now()-lastInput>800)stop();
    dig();io.emit('state',state());
  },100);
  timer.unref();
  console.log('自己玩 http://127.0.0.1:'+http.address().port+'/play.html');
  return player;
}
