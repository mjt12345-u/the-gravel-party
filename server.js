const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const app = express(); const server = http.createServer(app); const io = new Server(server);
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
const rooms = new Map();
const GAMES = [
  { id:'scramble', name:'CONVEYOR SCRAMBLE', desc:'Grab scrap and toss it into the glowing hopper. Move with WASD / arrows; SPACE to grab or throw.', duration:25 },
  { id:'road', name:'FOG ROAD RALLY', desc:'Sprint to the checkpoint and dodge the rolling barrels. First across scores big.', duration:25 },
  { id:'platforms', name:'SHaky GROUND', desc:'Stay on the wobbling platforms. Jump with SPACE; falling is embarrassing, not fatal.', duration:25 }
];
const colors = ['#e6b94c','#63c8b7','#d98769','#9a8de0'];
function code(){ return crypto.randomBytes(2).toString('hex').toUpperCase(); }
function newRoom(){ let c; do { c=code(); } while(rooms.has(c)); const r={code:c,players:{},phase:'lobby',gameIndex:-1,game:null,endsAt:0,items:[],round:0}; rooms.set(c,r); return r; }
function publicRoom(r){return {code:r.code,phase:r.phase,game:r.game,endsAt:r.endsAt,round:r.round,players:Object.values(r.players).map(p=>({id:p.id,name:p.name,color:p.color,score:p.score,x:p.x,y:p.y,ready:p.ready,alive:p.alive,points:p.points||0}))};}
function emitRoom(r){io.to(r.code).emit('state',publicRoom(r));}
function startGame(r){ r.gameIndex=(r.gameIndex+1)%GAMES.length; r.game={...GAMES[r.gameIndex]}; r.phase='playing'; r.round++; r.endsAt=Date.now()+r.game.duration*1000; r.items=[];
  Object.values(r.players).forEach((p,i)=>{p.x=0.15+(i%2)*0.1;p.y=0.25+Math.floor(i/2)*0.12;p.alive=true;p.points=0;p.ready=false;p.lastAction=0;});
  if(r.game.id==='scramble'){for(let i=0;i<12;i++)r.items.push({id:i,x:.18+Math.random()*.64,y:.18+Math.random()*.62,taken:false});}
  if(r.game.id==='platforms'){Object.values(r.players).forEach((p,i)=>{p.x=.35+(i%2)*.25;p.y=.3+Math.floor(i/2)*.25;});}
  emitRoom(r); io.to(r.code).emit('toast',`ROUND ${r.round} — ${r.game.name}`);
}
function finishGame(r){if(r.phase!=='playing')return; r.phase='results';const sorted=Object.values(r.players).sort((a,b)=>b.points-a.points);sorted.forEach((p,i)=>p.score+=Math.max(0,4-i));emitRoom(r);io.to(r.code).emit('toast',`ROUND OVER — ${sorted[0]?.name||'Nobody'} takes the round!`);setTimeout(()=>{if(rooms.has(r.code)&&r.phase==='results'){if(r.round>=5){r.phase='final';emitRoom(r);}else startGame(r);}},4500);}
io.on('connection',socket=>{
 socket.on('create',({name})=>{const r=newRoom();join(socket,r,name);socket.emit('joined',{code:r.code,host:true});});
 socket.on('join',({code:c,name})=>{const r=rooms.get(String(c||'').toUpperCase());if(!r)return socket.emit('errorMsg','Room code not found.');if(r.phase!=='lobby')return socket.emit('errorMsg','That game has already started.');if(Object.keys(r.players).length>=4)return socket.emit('errorMsg','Room is full (4 players maximum).');join(socket,r,name);socket.emit('joined',{code:r.code,host:false});});
 function join(s,r,name){if(Object.keys(r.players).length>=4)return s.emit('errorMsg','Room is full.');s.join(r.code);const i=Object.keys(r.players).length;r.players[s.id]={id:s.id,name:String(name||`Player ${i+1}`).slice(0,16),color:colors[i],score:0,x:.2+i*.15,y:.3,ready:false,alive:true,points:0,lastAction:0};s.data.room=r.code;emitRoom(r);}
 socket.on('start',()=>{const r=rooms.get(socket.data.room);if(!r)return;if(Object.keys(r.players).length<2)return socket.emit('errorMsg','Need at least 2 players to start.');if(r.phase==='lobby'||r.phase==='final'){r.round=0;Object.values(r.players).forEach(p=>p.score=0);startGame(r);}});
 socket.on('input',data=>{const r=rooms.get(socket.data.room);if(!r||r.phase!=='playing')return;const p=r.players[socket.id];if(!p)return;const now=Date.now();const dt=Math.min(.08,(now-(p.lastInput||now))/1000);p.lastInput=now;const speed=.55; p.x=Math.max(.04,Math.min(.96,p.x+(Number(data.dx)||0)*speed*dt));p.y=Math.max(.08,Math.min(.9,p.y+(Number(data.dy)||0)*speed*dt));
  if(data.action&&now-p.lastAction>280){p.lastAction=now;if(r.game.id==='scramble'){let item=r.items.find(it=>!it.taken&&Math.hypot(it.x-p.x,it.y-p.y)<.09);if(item){item.taken=true;p.points+=1;io.to(r.code).emit('spark',{x:item.x,y:item.y});}}
   if(r.game.id==='road'){if(data.action==='jump')p.y=Math.max(.08,p.y-.09);p.points+=.1; if(p.x>.91){p.points+=8;p.x=.08;p.y=.3+Math.random()*.4;}}
   if(r.game.id==='platforms'){p.y=Math.max(.08,Math.min(.9,p.y-.05));p.points+=.5;}
  }
  emitRoom(r);
 });
 socket.on('disconnect',()=>{const r=rooms.get(socket.data.room);if(!r)return;delete r.players[socket.id];if(Object.keys(r.players).length===0){rooms.delete(r.code);return;}emitRoom(r);});
});
setInterval(()=>{for(const r of rooms.values()){if(r.phase==='playing'&&Date.now()>=r.endsAt)finishGame(r);}},250);
const port=process.env.PORT||3000;server.listen(port,()=>console.log(`Gravel Party running on ${port}`));
