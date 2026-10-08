import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Vec3}=require('vec3');
const {goals}=require('mineflayer-pathfinder');
const v=p=>new Vec3(p.x,p.y,p.z);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const CAMP_TASK='按照营地蓝图施工：搭建有完整地板、两格高围墙、玻璃窗、屋顶和可通行入口的小屋，配备工作台、熔炉、篝火、座位、照明和步道，最后返回出发营地。材料已提供，不需要采集或合成。';
export function campPlan(y){
  const groups=[];
  const add=(id,label,category,blocks)=>groups.push({id,label,category,blocks});
  const block=(x,dy,z,name)=>({x,y:y+dy,z,name});
  for(let z=-2;z<=2;z++)add(`floor_${z+2}`,`铺设地板第 ${z+3} 排`,'floor',Array.from({length:5},(_,i)=>block(6+i,0,z,'stone_bricks')));
  for(let x=6;x<=10;x++)for(let z=-2;z<=2;z++){
    if(x!==6&&x!==10&&z!==-2&&z!==2)continue;
    if(x===6&&z===0)continue; // 西侧留两格高入口，可以走进去。
    const corner=(x===6||x===10)&&(z===-2||z===2);
    const window=(x===8&&(z===-2||z===2))||(x===10&&z===0);
    add(`wall_${x}_${z}`,`搭建墙柱 (${x},${z})${window?'与玻璃窗':''}`,'structure',[
      block(x,1,z,corner?'oak_log':'oak_planks'),block(x,2,z,window?'glass':corner?'oak_log':'oak_planks')]);
  }
  for(let z=-2;z<=2;z++)add(`roof_${z+2}`,`封好屋顶第 ${z+3} 排`,'structure',Array.from({length:5},(_,i)=>block(6+i,3,z,'oak_planks')));
  add('workbench','放置屋内工作台','facilities',[block(7,1,1,'crafting_table')]);
  add('furnace','放置屋内熔炉','facilities',[block(9,1,1,'furnace')]);
  add('path','铺设入口步道','facilities',[3,4,5].map(x=>block(x,0,0,'stone_bricks')));
  add('fire','安放庭院篝火','facilities',[block(4,0,-3,'campfire')]);
  add('seats','摆放篝火旁的座位','facilities',[block(3,0,-4,'oak_stairs'),block(5,0,-4,'oak_stairs')]);
  add('lights','设置入口两侧照明','facilities',[block(3,0,1,'lantern'),block(5,0,1,'lantern')]);
  return groups;
}
const matched=(bot,b)=>bot.blockAt(v(b))?.name===b.name;
export function campSnapshot(bot,game){
  const categories={floor:{done:0,total:0},structure:{done:0,total:0},facilities:{done:0,total:0}};
  const groups=game.plan.map(g=>{
    const count=g.blocks.filter(b=>matched(bot,b)).length;
    categories[g.category].done+=count;categories[g.category].total+=g.blocks.length;
    return {id:g.id,label:g.label,done:count,total:g.blocks.length,finished:count===g.blocks.length};
  });
  const nearCamp=bot.entity.position.distanceTo(v(game.camp))<1.6;
  const entranceClear=[1,2].every(dy=>bot.blockAt(new Vec3(6,game.camp.y+dy,0))?.name==='air');
  const inventory=bot.inventory.items().map(({name,count})=>({name,count}));
  const p=bot.entity.position;
  return {task:CAMP_TASK,position:{x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10,z:Math.round(p.z*10)/10},health:bot.health,food:bot.food,gameMode:bot.game.gameMode,
    inventory,wood:inventory.filter(i=>i.name.endsWith('_log')).reduce((s,i)=>s+i.count,0),nearCamp,
    camp:game.camp,marker:game.marker,campProgress:categories,groups,entranceClear,
    built:groups.reduce((s,g)=>s+g.done,0),total:groups.reduce((s,g)=>s+g.total,0),
    finished:groups.every(g=>g.finished)&&entranceClear&&nearCamp};
}
export function campActions(bot,game){
  const state=campSnapshot(bot,game),floorDone=state.campProgress.floor.done===state.campProgress.floor.total;
  const wallsDone=game.plan.filter(g=>g.id.startsWith('wall_')).every(g=>g.blocks.every(b=>matched(bot,b)));
  const roofDone=game.plan.filter(g=>g.id.startsWith('roof_')).every(g=>g.blocks.every(b=>matched(bot,b)));
  const available=[];
  for(const group of game.plan){
    if(group.blocks.every(b=>matched(bot,b)))continue;
    if(group.id.startsWith('wall_')&&!floorDone)continue;
    if(group.id.startsWith('roof_')&&!wallsDone)continue;
    if(group.category==='facilities'&&!roofDone)continue;
    const remaining=group.blocks.filter(b=>!matched(bot,b));
    const needs={};for(const b of remaining)needs[b.name]=(needs[b.name]||0)+1;
    if(Object.entries(needs).some(([name,count])=>state.inventory.filter(i=>i.name===name).reduce((s,i)=>s+i.count,0)<count))continue;
    available.push({id:group.id,kind:'camp_build',label:group.label,description:`按蓝图完成这段施工，最多放置 ${remaining.length} 块，实际消耗材料；需要 ${JSON.stringify(needs)}。`,groupId:group.id});
  }
  if(!state.nearCamp)available.push({id:'go_camp',kind:'move',label:'回到出发营地',description:'走回原营地中心，不增加建筑进度。'});
  available.push({id:'look_around',kind:'look',label:'环顾工地',description:'转头查看，不增加施工进度。'},
    {id:'wait',kind:'wait',label:'原地等待',description:'等待一秒，不增加施工进度。'});
  return available;
}
export function campRequest(bot,game,available){
  return {model:'jev-latest',state:{...campSnapshot(bot,game),
    construction:'营地蓝图由程序给定，你决定下一段施工。候选中的一段包含 1—5 块，每一块通过真实 Minecraft 协议放置。不是自由生成建筑设计。',
    rules:['材料已经装入背包。优先完成有实际进度的建造动作，不要等待或来回走。','完整地板后搭墙柱，完整围墙后封屋顶，封顶后安放营地设施。','西侧入口必须保持两格高，不要堵住。所有设施齐全后回出发营地。'],
    recentActions:game.records.slice(-5).map(r=>({action:r.action.label,effect:r.effect,ok:r.ok})),
    availableActions:available.map(({id,label,description})=>({id,label,effect:description}))},
    questions:{next_action:{type:'choice',instructions:'根据真实建筑进度、背包材料和可执行施工段，选择最有助于完成整座营地的下一步；设施全部齐全后返回出发营地。',criteria:Object.fromEntries(available.map(a=>[a.id,a.label+'。'+a.description]))}}};
}
async function goto(bot,goal){
  let timer;try{await Promise.race([bot.pathfinder.goto(goal),new Promise((_,reject)=>{timer=setTimeout(()=>{bot.pathfinder.setGoal(null);bot.clearControlStates();reject(new Error('营地施工寻路超时，请重新选择'));},10000);})]);}finally{clearTimeout(timer);}
}
function standing(bot,b,base){
  const result=[];
  for(let x=b.x-3;x<=b.x+3;x++)for(let z=b.z-3;z<=b.z+3;z++){
    if(x===b.x&&z===b.z)continue;
    for(let y=base+1;y>=base;y--){
      const p=new Vec3(x,y,z),foot=bot.blockAt(p),head=bot.blockAt(p.offset(0,1,0)),under=bot.blockAt(p.offset(0,-1,0));
      if(foot?.boundingBox==='empty'&&head?.boundingBox==='empty'&&under?.boundingBox==='block'&&p.offset(.5,1.62,.5).distanceTo(v(b).offset(.5,.5,.5))<4.25){result.push(p);break;}
    }
  }
  return result.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position));
}
const faces=[new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,-1,0)];
async function place(bot,game,b){
  if(matched(bot,b))return false;
  const target=v(b),old=bot.blockAt(target);
  if(old?.name!=='air')throw new Error(`施工位置 ${target} 被 ${old?.name} 占用，请清理后再继续`);
  const stands=standing(bot,b,game.camp.y);
  let reached=false;
  for(const stand of stands.slice(0,8)){
    try{await goto(bot,new goals.GoalBlock(stand.x,stand.y,stand.z));reached=true;break;}catch{}
  }
  if(!reached)throw new Error(`暂时走不到 ${target} 附近`);
  const reference=faces.map(face=>({face,block:bot.blockAt(target.minus(face))})).find(r=>r.block&&r.block.boundingBox==='block');
  if(!reference)throw new Error(`方块 ${target} 没有可用的放置支撑`);
  const item=bot.inventory.items().find(i=>i.name===b.name);if(!item)throw new Error(`缺少 ${b.name}`);
  const before=bot.inventory.items().filter(i=>i.name===b.name).reduce((s,i)=>s+i.count,0);
  await bot.equip(item,'hand');await bot.placeBlock(reference.block,reference.face);await sleep(120);
  if(!matched(bot,b))throw new Error(`服务端未确认 ${b.name} 放置成功`);
  const after=bot.inventory.items().filter(i=>i.name===b.name).reduce((s,i)=>s+i.count,0);
  if(after!==before-1)throw new Error('建造材料没有按生存规则消耗');
  return true;
}
export async function campExecute(bot,game,action){
  if(action.kind==='camp_build'){
    const group=game.plan.find(g=>g.id===action.groupId);let placed=0;
    for(const b of group.blocks){if(await place(bot,game,b))placed++;}
    const state=campSnapshot(bot,game);return `${group.label} · 实际放置 ${placed} 块 · 营地 ${state.built}/${state.total} 块`;
  }
  if(action.kind==='move'){await goto(bot,new goals.GoalNear(Math.floor(game.camp.x),game.camp.y,Math.floor(game.camp.z),1));await bot.lookAt(new Vec3(8,game.camp.y+2,0),true);return '已返回出发营地，可走进新营地查看';}
  if(action.kind==='look'){await bot.look(bot.entity.yaw+Math.PI/2,0,true);return '观察了营地工地';}
  await sleep(1000);return '原地等待了一秒';
}
export async function prepareCamp(server,player,game){
  const y=game.camp.y;game.plan=campPlan(y);
  // 演示开工前准备平整空地与材料，建筑本身由 Jev 选择施工并通过协议逐块放置。
  for(let x=3;x<=12;x++)for(let z=-5;z<=5;z++){
    await server.setBlock(server.overworld,new Vec3(x,y-1,z),server.registry.blocksByName.grass_block.defaultState);
    for(let dy=0;dy<=6;dy++)await server.setBlock(server.overworld,new Vec3(x,y+dy,z),0);
  }
  const Item=createRequire(require.resolve('flying-squid'))('prismarine-item')(server.registry);
  for(let slot=0;slot<player.inventory.slots.length;slot++)if(player.inventory.slots[slot])player.inventory.updateSlot(slot,null);
  const kit=[['oak_planks',64],['oak_log',16],['stone_bricks',64],['glass',8],['crafting_table',1],['furnace',1],['campfire',1],['lantern',2],['oak_stairs',2]];
  kit.forEach(([name,count],i)=>player.inventory.updateSlot(36+i,new Item(server.registry.itemsByName[name].id,count,0)));
  player.teleport(v(game.camp));
}
