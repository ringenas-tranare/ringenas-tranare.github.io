/* Ringenäs Golf Journey – spelet under Spela.
   Spelplanen ritas i 3D (three.js) i en egen <canvas> med egen loop och fast tidssteg; utan WebGL används den gamla 2D-planen.
   Appens vyer rörs bara för menyer och topplista.
   Rundor skickas via Edge Function golf-submit (rimlighetskoll), topplistan läses via golf_board. */
(function(){
"use strict";
const FN="https://fpodgapzvcvzhutrrsuq.supabase.co/functions/v1/golf-submit";
const RPC="https://fpodgapzvcvzhutrrsuq.supabase.co/rest/v1/rpc/golf_board";
const KEY="sb_publishable_HGdeNNMGIc8xby7Kf9Q7fQ_DbKf-6hB";
const DT=1/120,LH=240,GY=196; // fast tidssteg, logisk höjd, marknivå

/* === Nivåer: hcp-spann, banans längd (s), fart, avstånd mellan hinder (s), hinderpool [typ, vikt, från andel av banan] ===
   Samma s/e/d finns i Edge Function golf-submit – ändras de här måste de ändras där också. */
const LEVELS=[
  {n:1,name:"Resan genom Ringenäs",s:99,e:54,d:75,reward:"Grönt kort",open:true,v0:240,v1:315,g0:1.6,g1:1.0,pool:[["boll",3,0],["pegg",3,0],["korg",2,.1],["pinnar",2,.2],["flygboll",2,.3],["peggpar",1,.4],["bag",2,.5]]},
  {n:2,name:"Första rundorna",s:54,e:20,d:80,reward:"Klubbgolfare",open:false,v0:280,v1:345,g0:1.35,g1:.88,pool:[["ruff",3,0],["bunker",2,0],["vatten",2,.2],["boll",1,0]]},
  {n:3,name:"Kusthål",s:20,e:10,d:80,reward:"Avancerad spelare",open:false,v0:310,v1:375,g0:1.15,g1:.8,pool:[["mas",3,0],["kratta",2,0],["vindby",2,.15],["bunker",1,0]]},
  {n:4,name:"Tävlingsgolf",s:10,e:0,d:85,reward:"Singelhandicap",open:false,v0:350,v1:420,g0:1.0,g1:.72,pool:[["bunker",2,0],["vatten",2,0],["mas",2,0],["vindby",2,0],["peggpar",1,0]]},
  {n:5,name:"Tour-nivå",s:0,e:-8,d:90,reward:"Ringenäs Elite",open:false,v0:390,v1:465,g0:.9,g1:.64,pool:[["bunker",2,0],["vatten",2,0],["mas",2,0],["vindby",2,0],["kratta",1,0],["peggpar",1,0]]}
];

/* === Hinderbibliotek: träffyta (w, y0–y1 över marken), egen fart mot spelaren, handling och utseende ===
   Nytt hinder = en ny rad här + namnet i en nivås pool. */
const OBS={
  boll:{act:"hoppa",w:11,y0:0,y1:11,vx:70,draw:(c,o)=>{shadow(c,0,9);ball(c,0,-5.5,5.5,o.rot)}},
  pegg:{act:"hoppa",w:7,y0:0,y1:22,draw:c=>{shadow(c,0,6);tee(c,0)}},
  peggpar:{act:"hoppa",w:30,y0:0,y1:22,draw:c=>{shadow(c,-11,6);shadow(c,11,6);tee(c,-11);tee(c,11)}},
  korg:{act:"ducka",w:28,y0:27,y1:1e3,draw:(c,o)=>basket(c,o)},
  pinnar:{act:"hoppa",w:16,y0:0,y1:25,draw:c=>{shadow(c,0,8);sticks(c)}},
  bag:{act:"hoppa",w:22,y0:0,y1:30,draw:c=>{shadow(c,0,12);bag(c)}},
  flygboll:{act:"ducka",w:8,y0:29,y1:41,vx:170,draw:c=>flyball(c)},
  ruff:{act:"hoppa",w:34,y0:0,y1:15,draw:c=>grass(c,34,16)},
  bunker:{act:"hoppa",w:56,y0:-10,y1:1.5,draw:c=>pit(c,56,"#e6d3a3","#c9b27c")},
  vatten:{act:"hoppa",w:66,y0:-10,y1:1.5,draw:(c,o)=>pit(c,66,"#4f86b8","#2f5f8f",o.age)},
  kratta:{act:"hoppa",w:40,y0:0,y1:9,draw:c=>rake(c)},
  mas:{act:"ducka",w:26,y0:27,y1:44,vx:80,draw:(c,o)=>gull(c,o.age)},
  vindby:{act:"ducka",w:30,y0:25,y1:1e3,draw:(c,o)=>gust(c,o.age)}
};

/* === Lagring (allt i try/catch – spelet fungerar även när lagringen är tom eller blockerad) === */
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function lj(k,d){try{const v=JSON.parse(ls(k)||"null");return v==null?d:v}catch(e){return d}}
let dev=ls("rgj_dev");if(!dev||!/^[A-Za-z0-9-]{16,64}$/.test(dev)){dev=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():"d"+Date.now().toString(36)+Math.random().toString(36).slice(2,14);ls("rgj_dev",dev)}
let nick=ls("rgj_nick")||"",unlocked=Math.max(1,+lj("rgj_unlocked",1)||1),best=lj("rgj_best",null),pbs=lj("rgj_pb",{}),medals=lj("rgj_medals",[]),soundOn=ls("rgj_sound")==="1";
function persist(){ls("rgj_unlocked",JSON.stringify(unlocked));ls("rgj_best",JSON.stringify(best));ls("rgj_pb",JSON.stringify(pbs));ls("rgj_medals",JSON.stringify(medals))}

/* === Smeknamn: max 12 tecken, inga olämpliga ord, ingen e-post eller telefonnummer === */
const BAD=["fitta","kuk","hora","neger","nigg","bög","jävl","javl","fuck","fuk","shit","cunt","whore","slut","hitler","nazi","rape","våldt","valdt","knull","snopp","porr","porn","dick","cock","pussy","bitch","hore"];
function nickOk(n){
  if(!/^[\p{L}\p{N} ._-]{1,12}$/u.test(n)||!n.trim()||/\d{6,}/.test(n))return false;
  const k=n.toLowerCase().replace(/[\s._-]/g,"").replace(/0/g,"o").replace(/1/g,"i").replace(/3/g,"e").replace(/4/g,"a").replace(/5/g,"s");
  return k!=="cp"&&!BAD.some(w=>k.includes(w));
}

/* === Hjälp === */
const hcpTxt=h=>h<0?"+"+(-h):String(h);
const resTxt=r=>r?(r.hcp===99?"99 · "+r.progress+" %":hcpTxt(r.hcp)):"–";
const better=(a,b)=>!b||a.hcp<b.hcp||(a.hcp===b.hcp&&a.progress>b.progress);
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
const reduced=()=>matchMedia("(prefers-reduced-motion:reduce)").matches;

/* === Ljud: av som standard, startas först efter spelarens tryck (iOS) === */
let ac=null;
function audioOn(){if(!soundOn)return;try{if(!ac)ac=new(window.AudioContext||window.webkitAudioContext)();if(ac.state==="suspended")ac.resume()}catch(e){ac=null}}
function tone(f0,f1,dur,type,vol,delay){const t=ac.currentTime+(delay||0),o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(ac.destination);o.start(t);o.stop(t+dur+.02)}
function noise(dur,f,vol,q){const n=ac.createBufferSource(),b=ac.createBuffer(1,ac.sampleRate*dur|0,ac.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;n.buffer=b;const fl=ac.createBiquadFilter();fl.type="bandpass";fl.frequency.value=f;fl.Q.value=q||.8;const g=ac.createGain(),t=ac.currentTime;g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(vol,t+dur*.3);g.gain.exponentialRampToValueAtTime(.001,t+dur);n.connect(fl).connect(g).connect(ac.destination);n.start()}
function snd(k){if(!soundOn||!ac||ac.state!=="running")return;try{
  if(k==="jump")tone(380,760,.13,"square",.05);
  else if(k==="duck")tone(300,160,.1,"triangle",.06);
  else if(k==="crash"){noise(.35,500,.25,.5);tone(160,45,.35,"sine",.25)}
  else if(k==="cheer"){noise(1.4,1600,.18,.4);[523,659,784,1047].forEach((f,i)=>tone(f,f,.22,"triangle",.09,i*.12))}
  else if(k==="tick")tone(1200,1500,.05,"sine",.03)}catch(e){}}

/* === Spelets tillstånd (bara här – aldrig via appens vyer) === */
let ov=null,cv=null,ctx=null,raf=0,last=0,acc=0,W=0,H=0,dpr=1,sc=1,oy=0,LW=360,PX=80,safeTop=0;
let mode3d=false; // 3D när WebGL finns, annars den gamla 2D-planen som reserv
let G=null; // aktuell runda
function newRun(lv){
  const L=LEVELS[lv-1];
  return {L,lv,t:0,dist:0,v:L.v0,obs:[],nextAt:L.v0*2.2,state:"run",py:0,vy:0,duck:0,held:false,buf:0,crashT:0,endT:0,hcp:L.s,blink:0,prog:0,run:null,parts:[],dustT:0,newBest:false,seen:{},ms:{},msg:null,lastArr:-9,lastAct:null};
}

/* === Ritverktyg (logiska enheter, marken på y=0 lokalt) === */
function shadow(c,x,r){c.fillStyle="rgba(0,0,0,.22)";c.beginPath();c.ellipse(x,1,r,2.2,0,0,7);c.fill()}
function ball(c,x,y,r,rot){c.fillStyle="#fff";c.beginPath();c.arc(x,y,r,0,7);c.fill();c.fillStyle="rgba(120,140,160,.55)";for(let i=0;i<4;i++){const a=(rot||0)+i*1.57;c.beginPath();c.arc(x+Math.cos(a)*r*.5,y+Math.sin(a)*r*.5,.9,0,7);c.fill()}c.strokeStyle="rgba(0,0,0,.18)";c.lineWidth=.6;c.beginPath();c.arc(x,y,r,0,7);c.stroke()}
function tee(c,x){c.fillStyle="#e0bb4a";c.fillRect(x-1.2,-14,2.4,14);c.beginPath();c.moveTo(x-4,-15);c.lineTo(x+4,-15);c.lineTo(x+1.5,-12.5);c.lineTo(x-1.5,-12.5);c.fill();ball(c,x,-18.5,4,0)}
function basket(c,o){const sw=Math.sin(o.age*3)*1.5,rg=c.createLinearGradient(0,-170,0,-60);rg.addColorStop(0,"rgba(230,238,247,0)");rg.addColorStop(1,"rgba(230,238,247,.8)");c.strokeStyle=rg;c.lineWidth=1.2;c.beginPath();c.moveTo(sw,-170);c.lineTo(sw,-50);c.stroke();
  c.save();c.translate(sw,-29);c.fillStyle="#1f5e3a";c.beginPath();c.moveTo(-14,-20);c.lineTo(14,-20);c.lineTo(11,0);c.lineTo(-11,0);c.closePath();c.fill();
  c.strokeStyle="rgba(255,255,255,.35)";c.lineWidth=.6;for(let i=-10;i<=10;i+=5){c.beginPath();c.moveTo(i,-20);c.lineTo(i*.8,0);c.stroke()}
  for(let i=0;i<5;i++)ball(c,-9+i*4.5,-21-(i%2)*2,2.4,0);c.strokeStyle="#e6eef7";c.lineWidth=1;c.beginPath();c.moveTo(-13,-20);c.quadraticCurveTo(0,-34,13,-20);c.stroke();c.restore()}
function grass(c,w,h){c.fillStyle="#2f5a2c";for(let i=0;i<9;i++){const x=-w/2+i*w/8;c.beginPath();c.moveTo(x-3,0);c.lineTo(x+(i%2?2:-2),-h+(i%3)*3);c.lineTo(x+3,0);c.fill()}}
function pit(c,w,a,b,age){c.fillStyle=b;c.beginPath();c.ellipse(0,1,w/2+3,6,0,0,7);c.fill();c.fillStyle=a;c.beginPath();c.ellipse(0,1.5,w/2,4.5,0,0,7);c.fill();if(age!=null){c.strokeStyle="rgba(255,255,255,.55)";c.lineWidth=.8;const s=Math.sin(age*5)*3;c.beginPath();c.moveTo(-w/4+s,1);c.lineTo(-w/8+s,1);c.moveTo(w/8-s,2.5);c.lineTo(w/4-s,2.5);c.stroke()}}
function rake(c){c.strokeStyle="#c9b27c";c.lineWidth=2;c.beginPath();c.moveTo(-18,-2);c.lineTo(14,-8);c.stroke();c.fillStyle="#e6eef7";c.fillRect(12,-11,4,10);for(let i=0;i<4;i++)c.fillRect(11+i*1.6,-2,.8,3)}
function gull(c,a){const f=Math.sin(a*14)*7;c.fillStyle="#f4f6f8";c.beginPath();c.ellipse(0,-35,8,3.5,0,0,7);c.fill();c.strokeStyle="#f4f6f8";c.lineWidth=2.2;c.beginPath();c.moveTo(-2,-36);c.quadraticCurveTo(-8,-42-f,-15,-38-f);c.moveTo(2,-36);c.quadraticCurveTo(8,-42-f,15,-38-f);c.stroke();c.fillStyle="#e0bb4a";c.beginPath();c.moveTo(-8,-35);c.lineTo(-12,-34);c.lineTo(-8,-33.5);c.fill();c.fillStyle="#26323d";c.fillRect(-6,-36.6,1.2,1.2)}
// Alignment-pinnar i marken, som på träningsbilderna
function sticks(c){c.lineCap="round";c.lineWidth=1.8;c.strokeStyle="#e8c33a";c.beginPath();c.moveTo(-6,0);c.lineTo(-2,-26);c.stroke();c.strokeStyle="#e07a2e";c.beginPath();c.moveTo(5,0);c.lineTo(1,-25);c.stroke();c.lineCap="butt"}
// Bärbag på vagn
function bag(c){c.strokeStyle="#3a4048";c.lineWidth=1.4;c.beginPath();c.moveTo(-9,-3.5);c.lineTo(5,-3.5);c.lineTo(9,-26);c.stroke();c.fillStyle="#222";c.beginPath();c.arc(-6,-3.5,3.5,0,7);c.fill();c.beginPath();c.arc(5,-3.5,3.5,0,7);c.fill();
  c.save();c.translate(1,-6);c.rotate(.12);c.fillStyle="#1c2b44";c.beginPath();c.roundRect?c.roundRect(-5,-24,10,24,3):c.rect(-5,-24,10,24);c.fill();c.fillStyle="#e6eef7";c.fillRect(-5,-17,10,1.6);c.fillStyle="#e0bb4a";c.fillRect(-5,-4,10,1.2);
  c.strokeStyle="#cfd8e2";c.lineWidth=1;for(let i=0;i<3;i++){c.beginPath();c.moveTo(-3+i*3,-24);c.lineTo(-4+i*3.5,-30);c.stroke()}c.restore()}
// Rangeboll som kommer flygande från ett slagbås, med fartstrimma
function flyball(c){const g=c.createLinearGradient(0,0,26,0);g.addColorStop(0,"rgba(255,255,255,.75)");g.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=g;c.fillRect(0,-37,26,3);ball(c,0,-35.5,3.2,0)}
function gust(c,a){c.strokeStyle="rgba(230,238,247,.7)";c.lineWidth=1.6;c.lineCap="round";for(let i=0;i<4;i++){const y=-30-i*16,s=Math.sin(a*6+i)*4;c.beginPath();c.moveTo(-15+s,y);c.bezierCurveTo(-5+s,y-6,5+s,y+6,15+s,y);c.stroke()}c.lineCap="butt"}

/* Golfaren: springa, hoppa, ducka, krock, målgång. Utrustningen blir snyggare per nivå. */
// Nivå 1 som på bilden: marinblå keps, ljusgrå jacka med mörka axelpartier, marinblå byxor, vita skor och en wedge
const GEAR=[null,
  {jacket:"#c9ced3",panel:"#2b3442",pants:"#1d2638",cap:"#1c2b44",shoe:"#f4f5f6"},
  {jacket:"#1a559c",panel:"#0f3a72",pants:"#e6eef7",cap:"#f2f4f7",shoe:"#ffffff"},
  {jacket:"#f2f4f7",panel:"#132a45",pants:"#132a45",cap:"#132a45",shoe:"#ffffff",glove:1},
  {jacket:"#2f7fd0",panel:"#1a559c",pants:"#f2f4f7",cap:"#f2f4f7",shoe:"#ffffff",glove:1},
  {jacket:"#132a45",panel:"#e0bb4a",pants:"#f2f4f7",cap:"#e0bb4a",shoe:"#ffffff",glove:1}];
const SKIN="#e2b994";
function limb(c,x,y,a1,l1,a2,l2){const kx=x+Math.sin(a1)*l1,ky=y+Math.cos(a1)*l1,fx=kx+Math.sin(a2)*l2,fy=ky+Math.cos(a2)*l2;c.beginPath();c.moveTo(x,y);c.lineTo(kx,ky);c.lineTo(fx,fy);c.stroke();return[fx,fy]}
function golfer(c,g,lv){
  const k=GEAR[lv]||GEAR[1],st=g.state,air=g.py>.5,duck=(g.duck>0||g.held)&&st==="run",ph=g.dist/11;
  c.save();c.translate(PX,-g.py);
  if(st==="crash")c.rotate(-Math.min(1.25,g.crashT*4));
  const hip=duck?12:22,th=duck?8:11,sh=duck?8:11;
  // ben: lår och smalben med knäböj i löpsteget (bakre benet först)
  const run=i=>{const p=ph+i*Math.PI,a=Math.sin(p)*.8;return[a,a-(Math.max(0,Math.cos(p))*1.2+.15)]};
  const L=st==="finish"||st==="crash"?[[.1,0],[-.1,0]]:air?[[1.0,-.4],[.2,-.9]]:duck?[[1.2,-.3],[.6,-.9]]:[run(1),run(0)];
  c.lineCap="round";c.lineJoin="round";c.lineWidth=4;
  L.forEach((l,i)=>{c.strokeStyle=i?k.pants:"#151c2a";const f=limb(c,0,-hip,l[0],th,l[1],sh);c.fillStyle=k.shoe;c.beginPath();c.roundRect?c.roundRect(f[0]-2,f[1]-2.2,6.5,2.8,1.2):c.rect(f[0]-2,f[1]-2.2,6.5,2.8);c.fill()});
  c.save();c.translate(0,-hip);c.rotate(duck?.6:air?.15:.24);
  const sw=st==="finish"?0:air?.6:Math.sin(ph)*.9;
  // bakre armen
  c.strokeStyle=k.panel;c.lineWidth=3;limb(c,0,-16,st==="finish"?Math.PI+.4:sw,6.5,st==="finish"?Math.PI+.3:sw+.6,6);
  // jackan med mörka axelpartier och sidopanel
  c.fillStyle=k.jacket;c.beginPath();c.roundRect?c.roundRect(-5,-19,10.5,19.5,3):c.rect(-5,-19,10.5,19.5);c.fill();
  c.fillStyle=k.panel;c.fillRect(-5,-19,10.5,4.2);c.fillRect(-5,-14.8,2.4,11);c.fillRect(-5,-1.5,10.5,2);
  c.strokeStyle="rgba(255,255,255,.35)";c.lineWidth=.5;c.beginPath();c.moveTo(3.5,-18);c.lineTo(3.5,-1);c.stroke();
  // huvud och keps med logga
  c.fillStyle=SKIN;c.fillRect(-.8,-21.5,3,3);c.beginPath();c.arc(1,-24.2,4.4,0,7);c.fill();
  c.fillStyle=k.cap;c.beginPath();c.arc(.6,-25,4.7,Math.PI,0);c.fill();c.fillRect(2,-26.2,6.2,1.7);c.fillStyle="#fff";c.beginPath();c.arc(1.6,-27.4,.7,0,7);c.fill();
  // främre armen med wedge
  const fin=st==="finish",fa=fin?Math.PI-.4:-sw;c.strokeStyle=k.jacket;c.lineWidth=3.2;const h=limb(c,0,-16,fa,6.5,fin?Math.PI-.3:fa+.6,6);
  c.fillStyle=k.glove?"#fff":SKIN;c.beginPath();c.arc(h[0],h[1],1.6,0,7);c.fill();
  const ca=fin?Math.PI-.2:-.45,cx=h[0]+Math.sin(ca)*19,cy=h[1]+Math.cos(ca)*19;
  c.strokeStyle="#22262b";c.lineWidth=1;c.beginPath();c.moveTo(h[0],h[1]);c.lineTo(cx,cy);c.stroke();c.fillStyle="#c9a14a";c.fillRect(cx-1.5,cy-1,4.5,2.2);
  c.restore();c.lineCap="butt";c.lineJoin="miter";
  if(st==="crash"){c.fillStyle="#e0bb4a";for(let i=0;i<3;i++){const a=g.crashT*6+i*2.1;c.beginPath();c.arc(Math.cos(a)*9,-40+Math.sin(a)*3,1.6,0,7);c.fill()}}
  c.restore();
}

/* === Bakgrund: Ringenäs driving range – mulen Hallandshimmel, havet med ön och fyren längst bort,
   rangen med bollnät, målgreener och belysningsmaster, kala björkar, Golfcentret i svart trä,
   puttinggreenen och flaggstången vid start, och slagbåsens svarta spaljéer närmast. === */
let skyG=null,clouds=[];
const wrap=(x,span)=>((x%span)+span)%span;
function bg(c,g){
  const d=g?g.dist:0,top=-oy/sc,hz=GY-70,rf=hz+15,lv=g?g.lv:1;
  c.fillStyle=skyG;c.fillRect(0,top,LW,hz-top+2);
  // moln
  c.fillStyle="rgba(236,240,244,.5)";for(const k of clouds){const x=wrap(k.x-d*.02,LW+260)-130;for(const b of k.b){c.beginPath();c.ellipse(x+b[0],k.y+b[1],b[2],b[2]*.5,0,0,7);c.fill()}}
  // havet längst bort
  c.fillStyle="#8797a6";c.fillRect(0,hz,LW,16);c.fillStyle="rgba(255,255,255,.2)";for(let i=0;i<5;i++)c.fillRect(wrap(i*131-d*.03,LW),hz+3+i*2.4,30,.7);
  // ön med fyren och den röda bojen
  const ix=wrap(LW*.7-d*.04,LW+260)-130;
  c.fillStyle="#26323d";c.beginPath();c.moveTo(ix-70,hz+7);c.quadraticCurveTo(ix-20,hz-5,ix+15,hz-3);c.quadraticCurveTo(ix+55,hz-1,ix+80,hz+7);c.fill();
  c.fillStyle="#ece6dd";c.fillRect(ix+2,hz-19,4.5,16);c.fillStyle="#26323d";c.fillRect(ix+1.2,hz-22,6,3);
  const bt=(performance.now()/1000)%6;if(bt<2.2){c.fillStyle="rgba(255,216,74,"+(.32*(1-Math.abs(bt-1.1)/1.1))+")";c.beginPath();c.moveTo(ix+4,hz-20.5);c.lineTo(ix+90,hz-28);c.lineTo(ix+90,hz-13);c.fill()}
  c.fillStyle="#ffd84a";c.beginPath();c.arc(ix+4,hz-20.5,1.3,0,7);c.fill();c.fillStyle="#c4473c";c.fillRect(ix+110,hz+9,2,4);
  // trädrand bortom rangen
  c.fillStyle="#5a6f50";c.beginPath();c.moveTo(0,rf+1);for(let x=0;x<=LW+6;x+=6){const w=x+d*.08;c.lineTo(x,rf-3-Math.abs(Math.sin(w/23))*4-Math.sin(w/71)*2)}c.lineTo(LW,rf+1);c.fill();
  // rangefältet
  const fg=c.createLinearGradient(0,rf,0,GY);fg.addColorStop(0,"#7fa266");fg.addColorStop(1,"#5c8a4b");c.fillStyle=fg;c.fillRect(0,rf,LW,GY-rf);
  // bollnätet längst bak
  c.strokeStyle="rgba(58,64,70,.55)";c.lineWidth=.7;for(let i=0;i<Math.ceil(LW/70)+2;i++){const x=wrap(i*70-d*.12,Math.ceil(LW/70+2)*70)-35;c.beginPath();c.moveTo(x,rf-34);c.lineTo(x,rf+2);c.stroke()}
  c.strokeStyle="rgba(58,64,70,.22)";c.beginPath();c.moveTo(0,rf-34);c.lineTo(LW,rf-34);c.moveTo(0,rf-17);c.lineTo(LW,rf-17);c.stroke();
  if(lv===1){
    // rangebollar i gräset
    c.fillStyle="rgba(255,255,255,.85)";for(let i=0;i<46;i++){const y=rf+3+((i*37)%29)*((GY-rf-26)/29),s=.5+(y-rf)/(GY-rf)*1.1;c.beginPath();c.arc(wrap(i*53.7-d*(.2+(y-rf)/(GY-rf)*.3),LW+40)-20,y,s,0,7);c.fill()}
    // målgreener med flaggor
    for(let i=0;i<3;i++){const x=wrap(i*230+120-d*.3,690)-60,y=rf+9+i*6;c.fillStyle="#4c7d40";c.beginPath();c.ellipse(x,y,20+i*4,3+i,0,0,7);c.fill();c.fillStyle="#e6eef7";c.fillRect(x,y-11,.8,11);c.fillStyle=i%2?"#c4473c":"#e8c33a";c.beginPath();c.moveTo(x+.8,y-11);c.lineTo(x+6,y-9.5);c.lineTo(x+.8,y-8);c.fill()}
    // avståndsskyltar
    for(let i=0;i<6;i++){const x=wrap(i*170+60-d*.45,1020)-80;if(x<-40||x>LW+40)continue;c.fillStyle="#e6eef7";c.fillRect(x,GY-40,1.2,16);c.fillRect(x-8,GY-47,17.5,8);c.fillStyle="#132a45";c.font="700 6px Montserrat,system-ui,sans-serif";c.textAlign="center";c.fillText(String(50+(i%6)*25),x+.8,GY-41)}
  }
  // belysningsmaster
  for(let i=0;i<2;i++){const x=wrap(i*330+200-d*.4,660)-40;c.strokeStyle="#7d868e";c.lineWidth=1.2;c.beginPath();c.moveTo(x,GY-26);c.lineTo(x,GY-118);c.stroke();c.fillStyle="#5d666e";c.fillRect(x-4,GY-121,9,3.5);c.fillStyle="rgba(255,250,220,.7)";c.fillRect(x-3,GY-118,7,1)}
  // Ringenäs Golfcenter i svartbetsat trä, vid start
  const gc=LW*.55-d*.3;if(gc>-150){c.fillStyle="#3b4045";c.beginPath();c.moveTo(gc-4,GY-50);c.lineTo(gc+60,GY-57);c.lineTo(gc+124,GY-50);c.fill();c.fillStyle="#22272b";c.fillRect(gc,GY-50,120,30);
    c.fillStyle="rgba(255,255,255,.05)";for(let x=gc+2;x<gc+120;x+=3)c.fillRect(x,GY-50,.6,30);
    c.fillStyle="#f2f4f6";c.fillRect(gc+18,GY-40,6,16);c.fillRect(gc+70,GY-40,6,16);c.fillRect(gc+96,GY-40,6,16);c.fillRect(gc+40,GY-44,8,5);c.fillRect(gc+82,GY-44,8,5);
    c.font="700 4.6px Montserrat,system-ui,sans-serif";c.textAlign="center";c.fillText("RINGENÄS GOLFCENTER",gc+86,GY-46.5)}
  // kala björkar med vita stammar
  for(let i=0;i<3;i++){const x=wrap(i*240+90-d*.6,720)-60;birch(c,x,GY-22,.8+i*.12)}
  // puttinggreen med blå flaggor och flaggstången med svenska flaggan, vid start
  const pg=PX+130-d*.5;if(pg>-90){c.fillStyle="#62a050";c.beginPath();c.ellipse(pg,GY-9,58,5.5,0,0,7);c.fill();for(const o of[-40,-14,10,34]){c.fillStyle="#e6eef7";c.fillRect(pg+o,GY-17,.7,8);c.fillStyle="#2f7fd0";c.fillRect(pg+o+.7,GY-17,3.6,2.4)}
    const fp=pg+78;c.fillStyle="#f2f4f6";c.fillRect(fp,GY-92,1.4,86);c.fillStyle="#2f6fb5";c.fillRect(fp+1.4,GY-90,15,9.5);c.fillStyle="#f2c230";c.fillRect(fp+6,GY-90,2.6,9.5);c.fillRect(fp+1.4,GY-86.6,15,2.4)}
  // slagbåsen längre bak: svarta spaljéer och gröna mattor (nedtonade så att de aldrig ser ut som hinder)
  for(let i=0;i<Math.ceil(LW/150)+2;i++){const x=wrap(i*150-d*.62,(Math.ceil(LW/150)+2)*150)-70,b=GY-15;
    c.fillStyle="rgba(46,139,74,.8)";c.fillRect(x,b-2,20,2.2);c.fillStyle="rgba(27,30,32,.6)";c.fillRect(x+24,b-12,26,11);c.fillStyle="rgba(255,255,255,.08)";for(let y=b-11;y<b-1;y+=2.5)c.fillRect(x+24,y,26,.6);c.fillStyle="rgba(27,30,32,.6)";c.fillRect(x+25,b-1,1.2,2.5);c.fillRect(x+48,b-1,1.2,2.5)}
  // gräset där golfaren springer
  c.fillStyle="#4c7a3d";c.fillRect(0,GY-3,LW,LH-GY+3+(H/sc));
  c.fillStyle="#548545";const sw=40,o=wrap(d,sw*2);for(let x=-o;x<LW;x+=sw*2)c.fillRect(x,GY,sw,LH-GY+(H/sc));
  c.fillStyle="rgba(255,255,255,.16)";c.fillRect(0,GY,LW,1.2);
}
function birch(c,x,y,s){c.save();c.translate(x,y);c.scale(s,s);c.fillStyle="rgba(120,100,95,.1)";c.beginPath();c.ellipse(0,-52,20,18,0,0,7);c.fill();
  c.strokeStyle="rgba(92,80,74,.75)";c.lineWidth=.7;for(const [a,l] of[[-.7,18],[.6,17],[-.3,22],[.25,20],[-1,12],[1,13]]){c.beginPath();c.moveTo(0,-34);c.quadraticCurveTo(Math.sin(a)*l*.5,-34-l*.6,Math.sin(a)*l,-34-Math.cos(a)*l)}c.stroke();
  c.fillStyle="#ece8e0";c.fillRect(-1.3,-46,2.6,46);c.fillStyle="#2a2a28";for(const t of[-40,-31,-22,-12,-6])c.fillRect(-1.3,t,1.6,1);c.restore()}

/* === 3D: Ringenäs i tecknad 3D-stil (three.js ligger på sidan själv: three.module.min.js) ===
   Spelmotorn räknar som förut i logiska enheter (samma tider, hinder och krockytor som Edge Function golf-submit litar på).
   Här ritas bara samma läge i 3D: 20 logiska enheter = 1 meter, golfaren springer mot -z och kameran följer snett bakifrån.
   Allt är rundat (kapslar, klot, svarvade former) med tecknad toon-skuggning, solnedgångsljus som på Ringenäs-fotot och kantljus. */
const S=1/20,TL=80,LW3=700,SHORE=132;
let T=null,R=null,loading3d=null;
function load3D(){if(T)return Promise.resolve(T);if(!loading3d)loading3d=import("./three.module.min.js").then(m=>(T=m)).catch(e=>{loading3d=null;throw e});return loading3d}
const GEO={},MAT={},TEX={};
const gget=(k,f)=>GEO[k]||(GEO[k]=f());
// tecknad skuggning i fyra mjuka steg
function toon(c,o){const k="t"+c+(o?JSON.stringify(o):"");return MAT[k]||(MAT[k]=new T.MeshToonMaterial(Object.assign({color:c,gradientMap:TEX.grad},o||{})))}
function bas(c,o){const k="b"+c+(o?JSON.stringify(o):"");return MAT[k]||(MAT[k]=new T.MeshBasicMaterial(Object.assign({color:c},o||{})))}
function mesh(g,m,x,y,z){const o=new T.Mesh(g,m);o.position.set(x||0,y||0,z||0);return o}
const Cap=(r,l,n)=>gget("A"+[r,l,n],()=>new T.CapsuleGeometry(r,l,4,n||12));
const Cyl=(a,b,h,n)=>gget("C"+[a,b,h,n],()=>new T.CylinderGeometry(a,b,h,n||14));
const Sph=(r,a,b)=>gget("S"+[r,a,b],()=>new T.SphereGeometry(r,a||18,b||12));
const Ico=(r,d)=>gget("I"+[r,d],()=>new T.IcosahedronGeometry(r,d==null?1:d));
const Cone=(r,h,n)=>gget("K"+[r,h,n],()=>new T.ConeGeometry(r,h,n||8));
const Tor=(r,t,a)=>gget("T"+[r,t,a],()=>new T.TorusGeometry(r,t,8,28,a||Math.PI*2));
const Disc=n=>gget("D"+n,()=>new T.CircleGeometry(1,n||32).rotateX(-Math.PI/2));
const RBox=(w,h,d,r)=>gget("R"+[w,h,d,r],()=>{const s=new T.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  const g=new T.ExtrudeGeometry(s,{depth:Math.max(.001,d-2*Math.min(r,d/2.2)),bevelEnabled:true,bevelSize:Math.min(r,d/2.2)*.9,bevelThickness:Math.min(r,d/2.2),bevelSegments:3,curveSegments:4});g.center();return g});
const Lathe=(k,pts,n)=>gget("L"+k,()=>new T.LatheGeometry(pts.map(p=>new T.Vector2(p[0],p[1])),n||20));
function ctex(w,h,fn){const c=document.createElement("canvas");c.width=w;c.height=h;fn(c.getContext("2d"),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t}
function rrp(c,x,y,w,h,r){c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h)}
const F3="Montserrat,Inter,system-ui,sans-serif";
function pillTex(txt,bg,fg){return ctex(256,88,(c,w,h)=>{rrp(c,6,6,w-12,h-12,(h-12)/2);c.fillStyle=bg;c.fill();c.lineWidth=4;c.strokeStyle="rgba(255,255,255,.75)";c.stroke();c.fillStyle=fg;c.font="900 46px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText(txt,w/2,h/2+2)})}
function sprite(tex,w,h,o){const m=new T.SpriteMaterial(Object.assign({map:tex,transparent:true},o||{})),s=new T.Sprite(m);s.scale.set(w,h,1);return s}
function rng(s){s=(s*9301+49297)%233280||1;return()=>(s=(s*16807)%2147483647)/2147483647}
function shade(o,cast){o.traverse(c=>{if(c.isMesh&&!c.userData.flat){c.castShadow=cast!==false;c.receiveShadow=true}});return o}
function textures(){if(TEX.ok)return;TEX.ok=1;
  const gd=new Uint8Array([95,150,205,255]);TEX.grad=new T.DataTexture(gd,4,1,T.RedFormat);TEX.grad.minFilter=TEX.grad.magFilter=T.NearestFilter;TEX.grad.needsUpdate=true;
  TEX.blob=ctex(64,64,(c,w)=>{const g=c.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);g.addColorStop(0,"rgba(20,40,20,.5)");g.addColorStop(1,"rgba(20,40,20,0)");c.fillStyle=g;c.fillRect(0,0,w,w)});
  TEX.dot=ctex(64,64,(c,w)=>{const g=c.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.45,"rgba(255,255,255,.85)");g.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=g;c.fillRect(0,0,w,w)});
  const dimples=(c,w,h,bump)=>{for(let row=0,y=4;y<h;row++,y+=7.2)for(let x=(row%2)*4.5;x<w+6;x+=9){const r=3.3;if(bump){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,"#000");g.addColorStop(1,"#fff");c.fillStyle=g}else{const g=c.createRadialGradient(x+1,y+1,0,x,y,r);g.addColorStop(0,"rgba(255,255,255,0)");g.addColorStop(.7,"rgba(150,165,185,.18)");g.addColorStop(1,"rgba(120,135,160,.32)");c.fillStyle=g}c.beginPath();c.arc(x,y,r,0,7);c.fill()}};
  TEX.ball=ctex(512,256,(c,w,h)=>{c.fillStyle="#fbfcfd";c.fillRect(0,0,w,h);dimples(c,w,h,false);for(const u of[.25,.75]){c.fillStyle="rgba(251,252,253,.75)";c.beginPath();c.ellipse(u*w,h/2+2,52,38,0,0,7);c.fill();drawLogo(c,u*w,h/2+2,1.25,"#1d2c4c")}});
  TEX.ballBump=ctex(512,256,(c,w,h)=>{c.fillStyle="#fff";c.fillRect(0,0,w,h);dimples(c,w,h,true)});
  TEX.trail=ctex(256,8,(c,w,h)=>{const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0,"rgba(255,255,255,.85)");g.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=g;c.fillRect(0,0,w,h)});
  TEX.logoW=ctex(128,100,(c,w,h)=>{c.clearRect(0,0,w,h);drawLogo(c,w/2,h/2-2,1.25,"#eef2f6")});
  TEX.capLogo=ctex(256,132,(c,w,h)=>{c.clearRect(0,0,w,h);c.save();c.scale(1,1.35);drawLogo(c,w/2,58,1.05,"#1d2c4c");c.restore()});
  const stripes=(a,b)=>ctex(8,64,(c,w,h)=>{c.fillStyle=a;c.fillRect(0,0,w,h/2);c.fillStyle=b;c.fillRect(0,h/2,w,h/2)});
  TEX.ground=stripes("#3f9435","#4aa33d");TEX.lane=stripes("#57b043","#62bd4b");
  [TEX.ground,TEX.lane].forEach(t=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.NearestFilter});
  TEX.sand=ctex(128,128,(c,w,h)=>{c.fillStyle="#f1dca4";c.fillRect(0,0,w,h);for(let i=0;i<500;i++){c.fillStyle=i%2?"rgba(196,160,96,.25)":"rgba(255,255,255,.35)";c.fillRect(Math.random()*w,Math.random()*h,2,2)}c.strokeStyle="rgba(190,150,90,.35)";c.lineWidth=2;for(let y=8;y<h;y+=12){c.beginPath();c.moveTo(0,y);for(let x=0;x<=w;x+=16)c.lineTo(x,y+Math.sin(x/12)*2);c.stroke()}});
  TEX.hoppa=pillTex("HOPPA","#f2c94c","#1a1405");TEX.ducka=pillTex("DUCKA","#2f8be6","#ffffff");TEX.mal=pillTex("MÅL","#132a45","#f2c94c");
  TEX.sign=ctex(512,72,(c,w,h)=>{c.fillStyle="#1e2326";c.fillRect(0,0,w,h);c.fillStyle="#f2f4f6";c.font="800 40px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText("RINGENÄS",w/2,h/2+2)});
  TEX.gc=ctex(512,64,(c,w,h)=>{c.fillStyle="#22272b";c.fillRect(0,0,w,h);c.fillStyle="#f2f4f6";c.font="800 32px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText("RINGENÄS GOLFCENTER",w/2,h/2+2)});
  TEX.flag=ctex(160,100,(c,w,h)=>{c.fillStyle="#2f6fb5";c.fillRect(0,0,w,h);c.fillStyle="#f2c230";c.fillRect(50,0,20,h);c.fillRect(0,40,w,20)});
  TEX.birch=ctex(16,128,(c,w,h)=>{c.fillStyle="#f1ede6";c.fillRect(0,0,w,h);c.fillStyle="#2a2a28";for(let i=0;i<14;i++)c.fillRect((i*7)%10,i*9+3,4+(i%3)*2,2)});
  TEX.cloud=ctex(256,128,(c,w,h)=>{[[80,76,44],[132,60,52],[184,76,40],[128,84,48]].forEach(([x,y,r])=>{const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,"rgba(255,246,238,.95)");g.addColorStop(.6,"rgba(255,236,222,.6)");g.addColorStop(1,"rgba(255,236,222,0)");c.fillStyle=g;c.fillRect(0,0,w,h)})});
  TEX.sun=ctex(128,128,(c,w)=>{const g=c.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);g.addColorStop(0,"rgba(255,250,225,1)");g.addColorStop(.18,"rgba(255,226,160,.9)");g.addColorStop(1,"rgba(255,190,120,0)");c.fillStyle=g;c.fillRect(0,0,w,w)});
  TEX.sea=ctex(256,256,(c,w,h)=>{c.fillStyle="#2f86c9";c.fillRect(0,0,w,h);for(let i=0;i<140;i++){c.fillStyle=i%3?"rgba(255,255,255,.18)":"rgba(15,60,110,.25)";c.fillRect(Math.random()*w,Math.random()*h,10+Math.random()*24,2)}});TEX.sea.wrapS=TEX.sea.wrapT=T.RepeatWrapping;
  TEX.win=ctex(64,64,(c,w,h)=>{const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,"#ffe6b0");g.addColorStop(1,"#f4b968");c.fillStyle=g;c.fillRect(0,0,w,h);c.fillStyle="rgba(255,255,255,.35)";c.fillRect(0,0,w,6)});
  // Ringenäs flagga: marinblå med guldkant, boll över vågor och namnet
  TEX.pin=ctex(192,128,(c,w,h)=>{c.fillStyle="#132a45";c.fillRect(0,0,w,h);c.strokeStyle="#e0bb4a";c.lineWidth=8;c.strokeRect(4,4,w-8,h-8);
    c.fillStyle="#f4f6f8";c.beginPath();c.arc(w/2,44,20,0,7);c.fill();c.fillStyle="rgba(19,42,69,.35)";for(let i=0;i<9;i++){c.beginPath();c.arc(w/2-10+(i%3)*10,34+((i/3)|0)*10,2.2,0,7);c.fill()}
    c.strokeStyle="#f4f6f8";c.lineWidth=4;c.beginPath();c.moveTo(w/2-40,70);c.bezierCurveTo(w/2-20,58,w/2+4,80,w/2+40,64);c.stroke();
    c.fillStyle="#f4f6f8";c.font="800 22px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText("RINGENÄS",w/2,98)});
  TEX.plank=ctex(64,256,(c,w,h)=>{for(let i=0;i<32;i++){c.fillStyle=["#9c7650","#8d6a46","#a67f58","#94704b"][i%4];c.fillRect(0,i*8,w,7);c.fillStyle="#4a3424";c.fillRect(0,i*8+7,w,1)}});TEX.plank.wrapS=TEX.plank.wrapT=T.RepeatWrapping;TEX.plank.repeat.set(1,4);
  TEX.stone=TEX.stoneT=ctex(128,128,(c,w,h)=>{c.fillStyle="#6f685e";c.fillRect(0,0,w,h);let y=0;while(y<h){const rh=14+((y*7)%10);let x=-((y*13)%20);while(x<w){const rw=18+((x*y+7)%22);c.fillStyle=["#b0a89b","#9d9588","#bdb5a8","#a59c8e"][((x+y)/7|0)%4];rrp(c,x+1.5,y+1.5,rw-3,rh-3,4);c.fill();x+=rw}y+=rh}});TEX.stone.wrapS=TEX.stone.wrapT=T.RepeatWrapping;
  TEX.net=ctex(64,64,(c,w,h)=>{c.clearRect(0,0,w,h);c.strokeStyle="#e2d2ad";c.lineWidth=3;c.beginPath();c.moveTo(0,0);c.lineTo(w,h);c.moveTo(w,0);c.lineTo(0,h);c.stroke()});TEX.net.wrapS=TEX.net.wrapT=T.RepeatWrapping;TEX.net.repeat.set(48,1.4);
  TEX.chk=ctex(512,140,(c,w,h)=>{for(let x=0;x<w;x+=16)for(let y=0;y<2;y++){c.fillStyle=((x/16+y)%2)?"#111":"#fff";c.fillRect(x,y*16,16,16);c.fillStyle=((x/16+y+1)%2)?"#111":"#fff";c.fillRect(x,h-32+y*16,16,16)}
    c.fillStyle="#132a45";c.fillRect(0,32,w,h-64);c.fillStyle="#f6f8fa";c.font="900 54px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText("R I N G E N Ä S",w/2,h/2+2)});
  TEX.chkG=ctex(128,32,(c,w,h)=>{for(let x=0;x<w;x+=16)for(let y=0;y<h;y+=16){c.fillStyle=((x+y)/16%2)?"#111":"#fff";c.fillRect(x,y,16,16)}});
}
function blob(r,y){const m=new T.Mesh(gget("P1",()=>new T.PlaneGeometry(1,1).rotateX(-Math.PI/2)),MAT.blob||(MAT.blob=new T.MeshBasicMaterial({map:TEX.blob,transparent:true,depthWrite:false})));m.scale.set(r*2,1,r*2);m.position.y=y||.02;m.renderOrder=1;m.userData.flat=1;return m}

/* --- Golfaren efter karaktärsbladet: vit Ringenäs-keps, marinblå tröja med kort dragkedja och vit krage,
   beige byxor, vita skor och klocka på vänster handled. Ansiktet byts efter läget: glad, fokuserad, jublande och ledsen. --- */
// Ringenäs-loggan: boll över vågor och namnet
function drawLogo(c,x,y,s,col,text){c.save();c.translate(x,y);c.scale(s,s);c.fillStyle=col;c.strokeStyle=col;
  c.beginPath();c.arc(0,-18,15,0,7);c.lineWidth=2.6;c.stroke();for(let i=0;i<12;i++){const a=i*2.4,rr=(i%3+1)*4.2;c.beginPath();c.arc(Math.cos(a)*rr*.8,-18+Math.sin(a)*rr*.8,1.9,0,7);c.fill()}
  c.lineWidth=3.2;c.lineCap="round";c.beginPath();c.moveTo(-34,2);c.bezierCurveTo(-20,-6,-8,8,6,0);c.bezierCurveTo(16,-6,26,4,36,-2);c.stroke();
  c.beginPath();c.moveTo(-26,7);c.bezierCurveTo(-12,1,0,12,14,6);c.stroke();
  if(text!==false){c.font="600 15px Montserrat,Georgia,serif";c.textAlign="center";c.textBaseline="middle";c.fillText("RINGENÄS",0,24)}c.restore()}
/* Mjuka former: en yta lyfts genom elliptiska ringar {y,rx,rz,x,z}. Ger organiska kroppsdelar i stället för kapslar. u=0 höger sida, .25 fram, .5 vänster, .75 bak. */
function loft(key,rings,seg,sub){return gget("lf"+key,()=>{seg=seg||24;sub=sub||3;const R0=[];const ks=["y","rx","rz","x","z"],get=(i,k)=>{const q=rings[Math.max(0,Math.min(rings.length-1,i))];return q[k]||0};
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<sub;j++){const t=j/sub,o={};for(const k of ks){const a=get(i-1,k),b=get(i,k),c=get(i+1,k),d=get(i+2,k);o[k]=.5*(2*b+(c-a)*t+(2*a-5*b+4*c-d)*t*t+(3*b-a-3*c+d)*t*t*t)}R0.push(o)}R0.push(Object.assign({},rings[rings.length-1]));
  const n=R0.length,P=[],U=[],I=[];for(let i=0;i<n;i++){const q=R0[i];for(let j=0;j<=seg;j++){const u=j/seg,a=u*Math.PI*2;P.push((q.x||0)+Math.cos(a)*q.rx,q.y,(q.z||0)-Math.sin(a)*q.rz);U.push(u,i/(n-1))}}
  for(let i=0;i<n-1;i++)for(let j=0;j<seg;j++){const A=i*(seg+1)+j,B=A+1,C=A+seg+2,D=A+seg+1;I.push(A,B,C,A,C,D)}
  const a0=P.length/3;P.push(R0[0].x||0,R0[0].y,R0[0].z||0);U.push(.5,0);for(let j=0;j<seg;j++)I.push(a0,j+1,j);const a1=P.length/3,top=(n-1)*(seg+1);P.push(R0[n-1].x||0,R0[n-1].y,R0[n-1].z||0);U.push(.5,1);for(let j=0;j<seg;j++)I.push(a1,top+j,top+j+1);
  const G=new T.BufferGeometry();G.setAttribute("position",new T.Float32BufferAttribute(P,3));G.setAttribute("uv",new T.Float32BufferAttribute(U,2));G.setIndex(I);G.computeVertexNormals();
  const N=G.attributes.normal;for(let i=0;i<n;i++){const a=i*(seg+1),b=a+seg,x=N.getX(a)+N.getX(b),y=N.getY(a)+N.getY(b),z=N.getZ(a)+N.getZ(b),l=Math.hypot(x,y,z)||1;N.setXYZ(a,x/l,y/l,z/l);N.setXYZ(b,x/l,y/l,z/l)}return G})}
// en sammanhängande arm eller ett ben som böjer sig mjukt vid leden (två ben i skelettet), utan synliga skarvar
function skinned(key,rings,seg,mat,A,B,y0,y1,parent){const G=gget("sk"+key,()=>{const g=loft(key,rings,seg,3).clone(),P=g.attributes.position,I=[],W=[];for(let i=0;i<P.count;i++){const q=sm((y0-P.getY(i))/(y0-y1));I.push(0,1,0,0);W.push(1-q,q,0,0)}g.setAttribute("skinIndex",new T.Uint16BufferAttribute(I,4));g.setAttribute("skinWeight",new T.Float32BufferAttribute(W,4));return g});
  const m=new T.SkinnedMesh(G,mat);m.position.copy(A.position);m.frustumCulled=false;parent.add(m);parent.updateMatrixWorld(true);m.bind(new T.Skeleton([A,B]));return m}
const r3=(y,rx,rz,x,z)=>({y,rx,rz:rz==null?rx:rz,x:x||0,z:z||0});
function std(k,o){return MAT["st"+k]||(MAT["st"+k]=new T.MeshStandardMaterial(Object.assign({roughness:.85,metalness:0},o)))}
// tygerna ritas en gång: stickad tröja, ribbstickning, byxtyg med fickor, hår, keps och sko
function clothTex(){if(TEX.knit)return;const rep=(t,a,b)=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(a,b);t.anisotropy=4;return t};
  TEX.knit=rep(ctex(256,256,(c,w,h)=>{c.fillStyle="#2b3f6e";c.fillRect(0,0,w,h);for(let x=0;x<w;x+=4){c.fillStyle=x%8?"rgba(255,255,255,.035)":"rgba(0,0,0,.14)";c.fillRect(x,0,2,h)}for(let y=0;y<h;y+=3){c.fillStyle="rgba(0,0,0,.07)";c.fillRect(0,y,w,1)}}),5,4);
  TEX.knitB=rep(ctex(128,128,(c,w,h)=>{c.fillStyle="#808080";c.fillRect(0,0,w,h);for(let x=0;x<w;x+=8){c.fillStyle="#e4e4e4";c.fillRect(x,0,3,h);c.fillStyle="#3a3a3a";c.fillRect(x+5,0,2,h)}}),10,6);
  TEX.rib=rep(ctex(128,32,(c,w,h)=>{c.fillStyle="#22335c";c.fillRect(0,0,w,h);for(let x=0;x<w;x+=8){c.fillStyle="#34497a";c.fillRect(x,0,4,h)}}),4,1);
  TEX.twill=rep(ctex(256,256,(c,w,h)=>{c.fillStyle="#d3bf9b";c.fillRect(0,0,w,h);c.lineWidth=1;for(let i=-h;i<w;i+=5){c.strokeStyle=i%10?"rgba(120,96,60,.1)":"rgba(255,246,226,.14)";c.beginPath();c.moveTo(i,0);c.lineTo(i+h,h);c.stroke()}}),3,4);
  // bäcken med sidosöm och bakfickor (u=.75 är bak)
  TEX.seat=ctex(1024,512,(c,w,h)=>{c.drawImage(TEX.twill.image,0,0,w,h);c.fillStyle="#d3bf9b";c.fillRect(0,0,w,h);c.globalAlpha=.8;for(let x=0;x<w;x+=256)for(let y=0;y<h;y+=256)c.drawImage(TEX.twill.image,x,y);c.globalAlpha=1;
    const pk=x=>{c.fillStyle="rgba(120,96,62,.2)";rrp(c,x-54,262,108,132,12);c.fill();c.strokeStyle="rgba(92,70,42,.8)";c.lineWidth=3;c.setLineDash([9,5]);rrp(c,x-48,268,96,120,10);c.stroke();c.setLineDash([]);c.fillStyle="rgba(92,70,42,.55)";c.fillRect(x-56,258,112,8)};pk(w*.75-96);pk(w*.75+96);
    c.strokeStyle="rgba(92,70,42,.55)";c.lineWidth=3;c.beginPath();c.moveTo(w*.75,0);c.bezierCurveTo(w*.75,220,w*.75,300,w*.75,h);c.stroke();c.beginPath();c.moveTo(w*.25,300);c.lineTo(w*.25,0);c.stroke()});
  TEX.hair=ctex(512,256,(c,w,h)=>{c.clearRect(0,0,w,h);const edge=x=>{const d=Math.abs(x/w-.75),q=Math.min(d,1-d),e=q<.26?.64:.64-(q-.26)*2.2;return h*(e+Math.sin(x*.11)*.012)},gap=x=>Math.abs(x/w-.25)<.17||Math.abs(x/w-1.25)<.17;
    c.fillStyle="#5e3d26";c.beginPath();c.moveTo(0,0);for(let x=0;x<=w;x+=2){c.lineTo(x,gap(x)?0:edge(x))}c.lineTo(w,0);c.closePath();c.fill();
    c.globalCompositeOperation="source-atop";for(let i=0;i<1800;i++){const x=Math.random()*w,y=Math.random()*h,t=Math.random();c.strokeStyle="rgba("+(58+t*60)+","+(36+t*38)+","+(22+t*20)+",.8)";c.lineWidth=1.6;c.beginPath();c.moveTo(x,y);c.lineTo(x+(Math.random()-.5)*6,y+10+Math.random()*16);c.stroke()}c.globalCompositeOperation="source-over"});
  TEX.cap=ctex(1024,512,(c,w,h)=>{c.fillStyle="#efebe3";c.fillRect(0,0,w,h);for(let i=0;i<9000;i++){c.fillStyle=i%2?"rgba(255,255,255,.1)":"rgba(90,80,60,.05)";c.fillRect(Math.random()*w,Math.random()*h,2,2)}
    c.strokeStyle="rgba(120,108,90,.5)";c.lineWidth=3;for(const u of[.083,.417,.583,.75,.917]){c.beginPath();c.moveTo(w*u,h);c.lineTo(w*u,0);c.stroke();c.setLineDash([6,5]);c.lineWidth=1.5;c.beginPath();c.moveTo(w*u+8,h);c.lineTo(w*u+8,0);c.stroke();c.setLineDash([]);c.lineWidth=3}
    c.fillStyle="rgba(120,108,90,.65)";for(const u of[.17,.33,.5,.67,.84,1]){c.beginPath();c.arc(w*(u-.083),h*.58,5,0,7);c.fill()}
    c.save();c.translate(w*.25,h*.56);c.scale(2.3,2.3);drawLogo(c,0,0,1.25,"#1b2a4a");c.restore();
    // bakre öppningen med spännet
    c.globalCompositeOperation="destination-out";c.beginPath();c.moveTo(w*.75-64,h);c.lineTo(w*.75-60,h*.86);c.quadraticCurveTo(w*.75,h*.5,w*.75+60,h*.86);c.lineTo(w*.75+64,h);c.closePath();c.fill();c.globalCompositeOperation="source-over"});
  TEX.shoe=ctex(512,256,(c,w,h)=>{c.fillStyle="#f6f5f1";c.fillRect(0,0,w,h);c.fillStyle="rgba(120,124,130,.16)";for(let i=0;i<40;i++)c.fillRect(Math.random()*w,Math.random()*h,8,2);c.strokeStyle="rgba(120,124,130,.55)";c.lineWidth=3;for(const u of[.02,.48]){c.beginPath();c.moveTo(w*u,h*.2);c.quadraticCurveTo(w*(u+.04),h*.5,w*u,h*.85);c.stroke()}});
}
function buildGolfer(lv){
  clothTex();
  const root=new T.Group(),body=new T.Group(),hips=new T.Group();root.add(body);body.add(hips);
  const navy=std("navy",{map:TEX.knit,bumpMap:TEX.knitB,bumpScale:.5,emissive:"#0b1220"}),rib=std("rib",{map:TEX.rib,emissive:"#0b1220"}),beige=std("beige",{map:TEX.twill,roughness:.92,emissive:"#2a2418"}),seat=std("seat",{map:TEX.seat,roughness:.92,emissive:"#2a2418"}),
    skin=std("skin",{color:"#dfa684",roughness:.6}),white=std("white",{color:"#f7f6f2",roughness:.7}),shoeM=std("shoe",{map:TEX.shoe,roughness:.55}),sole=std("sole",{color:"#6f737a",roughness:.9}),soleW=std("soleW",{color:"#f0efea",roughness:.8}),
    hairM=std("hair",{map:TEX.hair,alphaTest:.5,side:T.DoubleSide,roughness:.75}),capM=std("cap",{map:TEX.cap,alphaTest:.5,side:T.DoubleSide,roughness:.9,emissive:"#3a3834"}),capP=std("capP",{color:"#f4f1ea",roughness:.9,side:T.DoubleSide,emissive:"#3a3834"}),dark=std("dark",{color:"#17181b",roughness:.45}),legs=[],arms=[];
  // bäcken och rumpa
  hips.add(mesh(loft("pelvis",[r3(-.15,.1,.09),r3(-.11,.172,.122,0,.004),r3(-.04,.197,.132,0,.01),r3(.04,.197,.128,0,.006),r3(.11,.185,.118),r3(.17,.17,.11)],32,3),seat,0,.03,0));
  [-.105,.105].forEach(x=>{const th=new T.Bone();th.position.x=x;hips.add(th);const kn=new T.Bone();kn.position.y=-.48;th.add(kn);
    skinned("leg",[r3(.1,.06),r3(.05,.105,.11),r3(-.06,.114,.12,0,.004),r3(-.22,.103,.11,0,-.004),r3(-.38,.09,.095),r3(-.48,.087,.09),r3(-.58,.082,.088,0,.005),r3(-.72,.076,.08,0,.005),r3(-.86,.073),r3(-.93,.08,.084),r3(-.942,.08,.084)],22,beige,th,kn,-.42,-.54,hips);
    // skon: vit sneaker med grå sula, snören och hälkappa
    const f=new T.Group();f.position.set(0,-.5,-.06);kn.add(f);const upper=loft("upper",[r3(-.135,.03,.03,0,-.005),r3(-.12,.068,.066,0,.012),r3(-.04,.08,.078,0,.022),r3(.06,.082,.066,0,.006),r3(.16,.086,.05,0,-.01),r3(.235,.07,.034,0,-.022),r3(.255,.03,.016,0,-.03)],22,3);
    const fu=mesh(gget("fu2",()=>upper.clone().rotateX(-Math.PI/2)),shoeM,0,.0,0);f.add(fu);
    const fs=mesh(gget("fsW",()=>loft("soleW",[r3(-.145,.03,.02),r3(-.13,.074,.024),r3(.06,.086,.024),r3(.22,.08,.024),r3(.265,.03,.014)],20,3).clone().rotateX(-Math.PI/2)),soleW,0,-.052,0);f.add(fs);
    const fg=mesh(gget("fsG",()=>loft("soleG",[r3(-.142,.03,.008),r3(-.128,.07,.011),r3(.06,.082,.011),r3(.22,.076,.011),r3(.26,.03,.008)],20,3).clone().rotateX(-Math.PI/2)),sole,0,-.08,0);f.add(fg);
    for(let i=0;i<4;i++){const l=mesh(Cap(.007,.075,6),soleW,0,.045-i*.012,-.03-i*.038);l.rotation.z=Math.PI/2;l.rotation.x=-.3;f.add(l)}
    legs.push({th,kn})});
  // bålen: stickad quarter-zip med ribbad nederkant
  const torso=new T.Group();hips.add(torso);
  torso.add(mesh(loft("torso",[r3(.1,.21,.158,0,.006),r3(.14,.212,.16,0,.006),r3(.27,.21,.156,0,.006),r3(.4,.228,.162,0,.006),r3(.49,.238,.162,0,.008),r3(.55,.205,.142,0,.012),r3(.61,.14,.11,0,.012),r3(.65,.09,.09,0,.008)],34,3),navy));
  torso.add(mesh(loft("hemr",[r3(.04,.205,.155,0,.006),r3(.055,.214,.164,0,.006),r3(.125,.216,.166,0,.006),r3(.14,.21,.16,0,.006)],34,2),rib));
  // krage: ståkrage, vit piké innanför och dragkedja med vita kanter
  torso.add(mesh(loft("coll",[r3(.61,.118,.11,0,.008),r3(.65,.112,.104,0,.012),r3(.71,.104,.096,0,.016),r3(.725,.1,.092,0,.016)],26,2),std("collar",{map:TEX.rib,side:T.DoubleSide})));
  const pk=mesh(Tor(.094,.018),white,0,.735,.016);pk.rotation.x=Math.PI/2;pk.scale.set(1.04,.96,1);torso.add(pk);
  const zp=mesh(gget("zip",()=>new T.BoxGeometry(.012,.2,.006)),std("zip",{color:"#cfd5dc",roughness:.4}),0,.61,-.15);zp.rotation.x=-.24;torso.add(zp);
  const lg=mesh(gget("chest",()=>new T.PlaneGeometry(.13,.1)),MAT.logoW,.105,.47,-.169);lg.rotation.y=Math.PI;lg.rotation.x=.08;lg.userData.flat=1;torso.add(lg);
  const pg=mesh(gget("pgaP",()=>new T.PlaneGeometry(.1,.1)),MAT.pga,-.105,.47,-.169);pg.rotation.y=Math.PI;pg.rotation.x=.08;pg.userData.flat=1;torso.add(pg);
  const tag=mesh(gget("btag",()=>new T.PlaneGeometry(.035,.03)),std("tag",{color:"#f4f4f0"}),0,.665,.112);tag.rotation.x=-.25;tag.userData.flat=1;torso.add(tag);
  torso.add(mesh(loft("neck",[r3(.68,.075,.078,0,.01),r3(.76,.07,.072,0,.008),r3(.84,.074,.076,0,.004)],16,2),skin));
  // huvudet: formen efter karaktärsbladet, ansiktet målat rakt framifrån
  const head=new T.Group();head.position.y=.93;torso.add(head);
  const hr=[r3(-.262,.03,.03,0,-.012),r3(-.245,.08,.08,0,-.012),r3(-.2,.128,.13,0,-.008),r3(-.11,.168,.172),r3(-.01,.186,.188),r3(.08,.19,.194),r3(.15,.176,.18),r3(.2,.135,.14),r3(.228,.05,.052)];
  const hg=gget("headP",()=>{const g=loft("head",hr,34,3).clone(),P=g.attributes.position,U=g.attributes.uv;for(let i=0;i<P.count;i++)U.setXY(i,.5-P.getX(i)/.56,.5+(P.getY(i)+.026)/.56);return g});
  const face=mesh(hg,MAT.faceglad,0,0,0);head.add(face);
  const faces={glad:MAT.faceglad,fokus:MAT.facefokus,jubel:MAT.facejubel,ledsen:MAT.faceledsen};
  head.add(mesh(loft("hairL",hr.map(q=>r3(q.y,q.rx*1.022,q.rz*1.028,0,q.z)),34,3),hairM));
  for(const sd of[-1,1]){const e=mesh(Sph(.05,12,10),skin,sd*.192,-.05,.015);e.scale.set(.42,1.15,.8);e.rotation.z=sd*-.12;head.add(e);const ei=mesh(Sph(.026,8,6),std("earI",{color:"#c98d6c"}),sd*.205,-.05,.01);ei.scale.set(.3,1,.7);head.add(ei)}
  // kepsen: panelerad krona med söm, öljetter, knapp, bakre öppning med spänne och böjd skärm
  const capG=new T.Group();capG.rotation.x=.13;capG.position.y=.012;head.add(capG);
  capG.add(mesh(loft("cap",[r3(.095,.206,.215),r3(.145,.205,.214),r3(.205,.18,.19),r3(.255,.13,.14),r3(.285,.06,.066),r3(.295,.012,.012)],36,3),capM));
  capG.add(mesh(Sph(.016,10,8),capP,0,.297,0));
  const strap=mesh(gget("strap",()=>new T.BoxGeometry(.13,.02,.012)),capP,0,.112,.212);capG.add(strap);capG.add(mesh(gget("buck",()=>new T.BoxGeometry(.028,.024,.014)),std("buck",{color:"#d9d5cc",roughness:.5}),.018,.112,.219));
  const brim=gget("brimC",()=>{const nS=20,nT=5,P=[],I=[],U=[];for(let l=0;l<2;l++)for(let i=0;i<=nS;i++)for(let j=0;j<=nT;j++){const s=i/nS*2-1,t=j/nT,a=s*1.08,x0=Math.sin(a)*.206,z0=-Math.cos(a)*.215,len=.19*Math.sqrt(1-s*s*.92)*t,dir=[Math.sin(a*.35),-Math.cos(a*.35)];P.push(x0+dir[0]*len,-.03*t-s*s*.06*t-l*.012,z0+dir[1]*len);U.push(i/nS,t)}
    const W=nT+1;for(let l=0;l<2;l++){const o=l*(nS+1)*W;for(let i=0;i<nS;i++)for(let j=0;j<nT;j++){const a=o+i*W+j,b=a+W,c=b+1,d=a+1;if(l)I.push(a,b,c,a,c,d);else I.push(a,c,b,a,d,c)}}
    const m=(nS+1)*W;for(let i=0;i<nS;i++){const a=i*W+nT,b=a+W;I.push(a,a+m,b+m,a,b+m,b)}const G=new T.BufferGeometry();G.setAttribute("position",new T.Float32BufferAttribute(P,3));G.setAttribute("uv",new T.Float32BufferAttribute(U,2));G.setIndex(I);G.computeVertexNormals();return G});
  capG.add(mesh(brim,capP,0,.098,0));
  // armar med tröjärm, ribbad mudd, klocka och knutna händer med fingrar
  [-1,1].forEach(sd=>{const s=new T.Bone();s.position.set(sd*.232,.505,.006);torso.add(s);const elb=new T.Bone();elb.position.y=-.3;s.add(elb);
    skinned("arm",[r3(.085,.02),r3(.07,.058,.062),r3(.03,.08,.086),r3(-.12,.078,.083),r3(-.25,.071,.075),r3(-.34,.066,.07),r3(-.44,.062,.066),r3(-.49,.056,.058),r3(-.515,.054)],20,navy,s,elb,-.24,-.36,torso);
    elb.add(mesh(loft("cuff",[r3(-.18,.05),r3(-.19,.06,.062),r3(-.235,.056,.058),r3(-.24,.05)],18,2),rib));
    const hand=new T.Group();hand.position.y=-.3;elb.add(hand);
    hand.add(mesh(loft("palm",[r3(.06,.03),r3(.035,.05,.04),r3(-.02,.062,.05),r3(-.055,.055,.046),r3(-.075,.025)],14,2),skin));
    for(let i=0;i<4;i++){const fg=mesh(Cap(.0145,.03,6),skin,(i-1.5)*.0245,-.052,-.05);fg.rotation.x=Math.PI/2+.25;hand.add(fg)}
    const th=mesh(Cap(.017,.05,6),skin,-sd*.052,-.015,-.03);th.rotation.z=sd*.5;th.rotation.x=.5;hand.add(th);
    if(sd<0){const w=mesh(gget("wband",()=>new T.TorusGeometry(.056,.007,6,20).rotateX(Math.PI/2)),dark,0,-.18,0);elb.add(w);const wf=mesh(Cyl(.024,.024,.012,16),dark,sd*.054,-.18,0);wf.rotation.z=Math.PI/2;elb.add(wf)}
    arms.push({sh:s,elb})});
  const stars=new T.Group();stars.position.y=2.25;for(let i=0;i<3;i++)stars.add(mesh(Ico(.08,0),bas("#f2c94c"),0,0,0));stars.visible=false;root.add(stars);
  shade(root);const sh=blob(.42);return {root,body,hips,legs,arms,torso,head,face,faces,stars,shadow:sh,lv,turn:0};
}
function poseGolfer(P,g,V,now){
  const st=g.state,air=g.py>.5,duck=(g.duck>0||g.held)&&st==="run",ph=g.dist/11,dt=V.dt||0;
  const run=i=>{const p=ph+i*Math.PI,a=Math.sin(p)*.8;return[a,a-(Math.max(0,Math.cos(p))*1.25+.15)]};
  const up=g.vy>0;
  // ben: springa, glädjeskutt med knäna högt, djup duck och sittande när han krockat
  const L=st==="finish"?[[.08,0],[-.08,0]]:st==="crash"?[[1.5,1.45],[1.4,1.5]]:air?(up?[[1.45,-.55],[.25,-1.35]]:[[.7,-.15],[.1,-.45]]):duck?[[1.5,-.25],[1.5,-.25]]:[run(1),run(0)];
  L.forEach((l,i)=>{P.legs[i].th.rotation.x=l[0];P.legs[i].kn.rotation.x=l[1]-l[0]});
  const hip=st==="crash"?.2:air?1.0:Math.max(...L.map(l=>.48*Math.cos(l[0])+.47*Math.cos(l[1])))+.07;
  const lt=V.landT,sq=lt<.16?Math.sin(lt/.16*Math.PI)*.16:0,st2=air&&up?Math.min(.1,g.vy/5400):0;
  P.body.scale.set(1+sq*.6-st2*.4,1-sq+st2,1+sq*.6-st2*.4);
  const bob=st==="run"&&!air&&!duck?Math.abs(Math.sin(ph))*.045:0;
  P.hips.position.y=hip+bob;
  P.torso.rotation.x=st==="finish"?.05:st==="crash"?-.25:duck?-.9:air?(up?-.2:-.05):-.22;
  P.head.rotation.x=st==="crash"?.3:st==="finish"?.25:duck?.5:air?.1:-.05;P.head.rotation.z=st==="crash"?Math.sin(now*3)*.12:0;
  const sw=Math.sin(ph)*1.0;
  P.arms.forEach((a,i)=>{const sd=i?1:-1;a.sh.rotation.z=0;
    if(st==="finish"){a.sh.rotation.x=Math.PI-.15+Math.sin(now*10+i*1.7)*.18;a.sh.rotation.z=sd*.45;a.elb.rotation.x=.35}
    else if(st==="crash"){a.sh.rotation.x=.25;a.sh.rotation.z=sd*.25;a.elb.rotation.x=.3}
    else if(duck){a.sh.rotation.x=.75;a.sh.rotation.z=-sd*.12;a.elb.rotation.x=.15}
    else if(air){if(sd>0){a.sh.rotation.x=up?2.95:2.6;a.sh.rotation.z=.15;a.elb.rotation.x=.25}else{a.sh.rotation.x=.5;a.sh.rotation.z=-.85;a.elb.rotation.x=1.1}}
    else{a.sh.rotation.x=sd*sw*.85;a.elb.rotation.x=1.35}});
  // ansiktet följer läget
  const fk=st==="crash"?"ledsen":st==="finish"||(air&&up)?"jubel":duck?"fokus":"glad";if(P.face.material!==P.faces[fk])P.face.material=P.faces[fk];
  // vid mål och krock vänder han sig mot kameran så att man ser glädjen eller besvikelsen
  const tgt=st==="finish"||st==="crash"?Math.PI:0;P.turn+=(tgt-P.turn)*Math.min(1,dt*5);P.body.rotation.y=P.turn;P.body.rotation.x=0;
  P.root.position.y=g.py*S*1.15+(st==="finish"?Math.abs(Math.sin(g.endT*7))*.25:0);
  P.stars.visible=st==="crash";if(st==="crash")P.stars.children.forEach((s,i)=>{const a=g.crashT*6+i*2.1;s.position.set(Math.cos(a)*.45,Math.sin(a*1.3)*.08-.9,Math.sin(a)*.45);s.rotation.y=a*2});
  P.shadow.scale.setScalar(Math.max(.3,.84-g.py*S*.25));
}
/* --- Hindren: samma namn och krockytor som OBS (w = längd längs banan, y0–y1 = höjd) --- */
const B3={
  boll:()=>{const g=new T.Group(),b=mesh(Sph(.275,32,20),MAT.ball,0,.275,0);b.name="spin";g.add(b,blob(.3));
    [[-.34,.3],[-.66,.14]].forEach(([z,o])=>{const gh=mesh(Sph(.27,16,10),new T.MeshBasicMaterial({color:"#ffffff",transparent:true,opacity:o,depthWrite:false}),0,.275,z);gh.userData.flat=1;g.add(gh)});g.userData.trail=1;return g},
  pegg:()=>{const g=new T.Group();g.add(tee3(0),blob(.25));return g},
  peggpar:()=>{const g=new T.Group();g.add(tee3(-.55),tee3(.55));const a=blob(.25),b=blob(.25);a.position.z=-.55;b.position.z=.55;g.add(a,b);return g},
  korg:()=>{const g=new T.Group(),p=new T.Group();p.name="sway";p.position.y=10;g.add(p);
    p.add(mesh(Cyl(.014,.014,8.05,5),toon("#e8eef4"),0,-4.02,0));
    const bk=mesh(Lathe("korg",[[.46,0],[.5,.05],[.6,.55],[.66,.6],[.62,.62]],22),toon("#1f7a45",{side:T.DoubleSide}),0,-8.65,0);p.add(bk);
    const rim=mesh(Tor(.64,.04),toon("#16603a"),0,-8.04,0);rim.rotation.x=Math.PI/2;p.add(rim);
    const h=mesh(Tor(.52,.03,Math.PI),toon("#e6eef7"),0,-8.05,0);p.add(h);
    const bm=new T.InstancedMesh(Sph(.075,10,8),toon("#ffffff"),16),m=new T.Matrix4();for(let i=0;i<16;i++){const a=i*2.4,r=(i%4)*.14+.05;m.makeTranslation(Math.cos(a)*r,-8.05+(i%3)*.05+(.3-r)*.25,Math.sin(a)*r);bm.setMatrixAt(i,m)}p.add(bm);
    shade(g);g.add(blob(.55));return g},
  pinnar:()=>{const g=new T.Group(),a=mesh(Cap(.03,1.26,6),toon("#f2cf3a"),-.06,.66,-.05),b=mesh(Cap(.03,1.24,6),toon("#f08a32"),.06,.65,.08);a.rotation.set(.16,0,.12);b.rotation.set(-.14,0,-.1);g.add(shade(a),shade(b),blob(.2));return g},
  bag:()=>{const g=new T.Group(),w=gget("whl",()=>new T.TorusGeometry(.14,.055,8,18).rotateY(Math.PI/2));
    g.add(mesh(w,toon("#25282c"),-.25,.18,.12),mesh(w,toon("#25282c"),.25,.18,.12));const ax=mesh(Cap(.025,.5,6),toon("#4a5058"),0,.18,.12);ax.rotation.z=Math.PI/2;g.add(ax);
    const b=new T.Group();b.position.set(0,.24,0);b.rotation.x=-.18;g.add(b);
    b.add(mesh(Cap(.18,.78,16),toon("#1c3a6b"),0,.58,0),mesh(Tor(.18,.03),toon("#f4f6f8"),0,.85,0),mesh(Tor(.18,.025),toon("#f2c94c"),0,.3,0),mesh(Cap(.07,.3,8),toon("#16305a"),0,.55,-.2));
    b.children[1].rotation.x=b.children[2].rotation.x=Math.PI/2;
    [[-.07,1.22,.02,"#d4ad55"],[.07,1.18,-.05,"#c9d2dc"],[0,1.26,.08,"#1c1f23"]].forEach(p=>{b.add(mesh(Cyl(.014,.014,.3,6),toon("#cfd8e2"),p[0],p[1]-.1,p[2]),mesh(Cap(.05,.06,8),toon(p[3]),p[0],p[1]+.06,p[2]-.02))});
    shade(g);g.add(blob(.42));return g},
  flygboll:()=>{const g=new T.Group(),b=mesh(Sph(.17,24,16),MAT.ball,0,1.75,0);b.name="fly";
    const tm=MAT.trail||(MAT.trail=new T.MeshBasicMaterial({map:TEX.trail,transparent:true,depthWrite:false,side:T.DoubleSide}));
    for(const [o,rad] of[[0,.07],[.08,.035]]){const pts=[];for(let i=0;i<=8;i++)pts.push(new T.Vector3(.02*i*i+o,1.75+.025*i-o,-i*.42));const t=mesh(gget("slice"+o,()=>new T.TubeGeometry(new T.CatmullRomCurve3(pts),32,rad,6)),tm);t.userData.flat=1;g.add(t)}
    g.add(shade(b),blob(.15));return g},
  ruff:()=>{const g=new T.Group(),r=rng(7);for(let i=0;i<26;i++){const c=mesh(Cone(.07,.5+r()*.35,5),toon(["#2f6b2a","#3d8a34","#4e9c3c"][i%3]),(r()-.5)*2.6,.3,(r()-.5)*1.6);c.rotation.set((r()-.5)*.6,r()*3,(r()-.5)*.6);g.add(c)}
    for(let i=0;i<5;i++)g.add(mesh(Sph(.05,8,6),toon(i%2?"#ffffff":"#f2c94c"),(r()-.5)*2.2,.62,(r()-.5)*1.3));shade(g);return g},
  bunker:()=>{const g=new T.Group(),lip=mesh(Tor(1,.16),toon("#4f9c3d"),0,.02,0);lip.rotation.x=Math.PI/2;lip.scale.set(1.45,1.55,.6);
    const sd=mesh(gget("dune",()=>new T.SphereGeometry(1,28,8,0,Math.PI*2,0,Math.PI/2)),MAT.sand||(MAT.sand=new T.MeshToonMaterial({map:TEX.sand,gradientMap:TEX.grad})),0,-.02,0);sd.scale.set(1.36,.07,1.46);g.add(shade(lip,false),shade(sd,false));g.userData.fx="sand";return g},
  vatten:()=>{const g=new T.Group(),lip=mesh(Tor(1,.14),toon("#3f8a35"),0,.02,0);lip.rotation.x=Math.PI/2;lip.scale.set(1.5,1.8,.55);
    const w=mesh(Disc(),MAT.water||(MAT.water=new T.MeshStandardMaterial({color:"#2a8ad6",roughness:.5,metalness:0,emissive:"#0a3a6a",emissiveIntensity:.3})),0,.03,0);w.scale.set(1.4,1,1.7);g.add(shade(lip,false),w);
    for(let i=0;i<3;i++){const r=mesh(gget("rip",()=>new T.RingGeometry(.9,1,40).rotateX(-Math.PI/2)),new T.MeshBasicMaterial({color:"#ffffff",transparent:true,opacity:.5,depthWrite:false}),0,.035,0);r.name="rip";r.userData.ph=i/3;r.userData.flat=1;g.add(r)}
    for(let i=0;i<6;i++){const a=i*1.05+.3,rd=mesh(Cap(.025,.5,5),toon("#5b7d2e"),Math.cos(a)*1.45,.3,Math.sin(a)*1.75);rd.rotation.z=(i%2-.5)*.3;g.add(shade(rd))}
    g.userData.fx="water";return g},
  kratta:()=>{const g=new T.Group(),h=mesh(Cap(.028,2,6),toon("#d9b977"),0,.2,.1);h.rotation.x=Math.PI/2-.18;g.add(h);
    const hd=mesh(Cap(.04,.48,8),toon("#eef2f6"),0,.36,-.9);hd.rotation.z=Math.PI/2;g.add(hd);for(let i=0;i<7;i++)g.add(mesh(Cap(.016,.08,5),toon("#eef2f6"),-.24+i*.08,.28,-.9));shade(g);g.add(blob(.35));return g},
  mas:()=>{const g=new T.Group(),b=new T.Group();b.position.y=1.78;g.add(b);const w=toon("#fbfcfd"),gr=toon("#b8c3cf");
    const bd=mesh(Cap(.14,.3,12),w);bd.rotation.x=Math.PI/2;b.add(bd,mesh(Sph(.12,14,10),w,0,.1,.26),mesh(Cone(.06,.16,6),gr,0,.02,-.32));b.children[2].rotation.x=-Math.PI/2;
    const bk=mesh(Cone(.035,.15,6),toon("#f2c94c"),0,.07,.42);bk.rotation.x=Math.PI/2;b.add(bk,mesh(Sph(.022,6,4),toon("#26323d"),-.07,.13,.33),mesh(Sph(.022,6,4),toon("#26323d"),.07,.13,.33));
    [-1,1].forEach(sd=>{const p=new T.Group();p.name="wing";p.userData.sd=sd;p.position.x=sd*.1;b.add(p);const wg=mesh(Cap(.1,.5,8),w,sd*.35,0,0);wg.rotation.z=Math.PI/2;wg.scale.set(1,1,.25);const tip=mesh(Cap(.08,.16,6),gr,sd*.7,0,0);tip.rotation.z=Math.PI/2;tip.scale.set(1,1,.25);p.add(wg,tip)});
    shade(g);g.add(blob(.3));return g},
  vindby:()=>{const g=new T.Group();for(let i=0;i<5;i++){const r=mesh(Tor(.62,.04,Math.PI*1.25),new T.MeshBasicMaterial({color:"#ffffff",transparent:true,opacity:.65,depthWrite:false}),0,1.5+i*.55,0);r.rotation.y=Math.PI/2;r.name="gust";r.userData.i=i;g.add(r)}
    for(let i=0;i<6;i++){const l=mesh(Sph(.08,6,4),toon(i%2?"#e8a33a":"#c96b2c"),0,1.6+i*.4,0);l.scale.set(1,.3,.6);l.name="leaf";l.userData.i=i;g.add(l)}return g}
};
function tee3(z){const g=new T.Group();g.position.z=z;g.add(mesh(Lathe("tee",[[0,0],[.025,.02],[.04,.6],[.06,.7],[.12,.79],[.12,.8]],16),toon("#f2c94c"),0,0,0),mesh(Sph(.2,20,14),MAT.ball,0,.98,0));return shade(g)}

/* --- Omgivning: träd, flaggor och skyltar som modulerna byggs av --- */
function tree3(x,z,s,r,autumn){const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);
  g.add(mesh(Cap(.16,2.4,8),toon("#6b4a32"),0,1.4,0));const cs=autumn?["#e3a33a","#d47f2c","#f0c454"]:["#3f8f3a","#4ea445","#62b84e"];
  for(let i=0;i<5;i++){const c=mesh(Ico(1.1+r()*.5,1),toon(cs[i%3],{flatShading:true}),(r()-.5)*1.4,3.2+r()*1.2,(r()-.5)*1.2);c.rotation.set(r()*3,r()*3,0);g.add(c)}return shade(g)}
function birch3(x,z,s,r){const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);
  g.add(mesh(Cap(.13,4.6,8),MAT.birch||(MAT.birch=new T.MeshToonMaterial({map:TEX.birch,gradientMap:TEX.grad})),0,2.4,0));
  for(let i=0;i<4;i++){const c=mesh(Ico(.8+r()*.4,1),toon(i%2?"#f0c454":"#c9d65a",{flatShading:true}),(r()-.5)*1.2,4.4+r()*1.4,(r()-.5)*1);g.add(c)}return shade(g)}
// green med Ringenäs marinblå flagga (guldkant)
function flagGreen(x,z,r){const g=new T.Group();g.position.set(x,0,z);const d=mesh(Disc(),toon("#7fd065"),0,.025,0);d.scale.set(r,1,r*.7);d.userData.flat=1;
  const f=mesh(gget("pen",()=>new T.PlaneGeometry(.9,.6).translate(.45,0,0)),MAT.pin||(MAT.pin=new T.MeshToonMaterial({map:TEX.pin,side:T.DoubleSide,gradientMap:TEX.grad})),0,2.15,0);f.name="pen";
  g.add(d,mesh(Cyl(.03,.03,2.5,6),toon("#f4f6f8"),0,1.25,0),mesh(Sph(.05,8,6),toon("#f4f6f8"),0,2.52,0),f);return shade(g)}
// träskylt med text, vänd mot spelaren
function woodSign(lines,w,x,z){const k="ws"+lines.join("|");const tex=TEX[k]||(TEX[k]=ctex(512,lines.length>1?200:120,(c,W,H)=>{const gr=c.createLinearGradient(0,0,0,H);gr.addColorStop(0,"#80573a");gr.addColorStop(1,"#5c3c26");rrp(c,4,4,W-8,H-8,18);c.fillStyle=gr;c.fill();c.lineWidth=8;c.strokeStyle="#3f2817";c.stroke();
    c.strokeStyle="rgba(0,0,0,.12)";c.lineWidth=3;for(let y=30;y<H;y+=34){c.beginPath();c.moveTo(16,y);c.lineTo(W-16,y+((y/34)%2?3:-3));c.stroke()}
    c.fillStyle="#f6ead2";c.textAlign="center";c.textBaseline="middle";lines.forEach((t,i)=>{c.font=(i?"700 44px ":"900 58px ")+F3;c.fillText(t,W/2,lines.length>1?(i?140:70):H/2+3)})}));
  const h=w*(lines.length>1?200:120)/512,g=new T.Group();g.position.set(x,0,z);
  g.add(mesh(Cyl(.06,.07,1+h,6),toon("#5c3c26"),-w*.4,(1+h)/2,-.03),mesh(Cyl(.06,.07,1+h,6),toon("#5c3c26"),w*.4,(1+h)/2,-.03));
  const b=mesh(gget("sgP"+w+"_"+h,()=>new T.PlaneGeometry(w,h)),new T.MeshToonMaterial({map:tex,gradientMap:TEX.grad,side:T.DoubleSide}),0,1+h/2-.05,0);b.rotation.y=x<0?.35:-.35;g.add(b);return shade(g)}
function rope(a,b,rad,mat){const d=new T.Vector3().subVectors(b,a),L=d.length(),m=new T.Mesh(Cyl(rad,rad,1,5),mat);m.scale.y=L;m.position.copy(a).addScaledVector(d,.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return m}
// Många likadana saker (gräs, blommor, granar) ritas som en enda instans-mesh. Sorteras närmast först så att de bortom strandkanten kan döljas.
function inst(geo,mat,list,cast){list.sort((a,b)=>b.z-a.z);const m=new T.InstancedMesh(geo,mat,Math.max(1,list.length)),M=new T.Matrix4(),Q=new T.Quaternion(),E=new T.Euler(),P=new T.Vector3(),Sc=new T.Vector3(),C=new T.Color();
  list.forEach((o,i)=>{E.set(o.rx||0,o.ry||0,o.rz||0);Q.setFromEuler(E);P.set(o.x,o.y||0,o.z);const s=o.s||1;Sc.set(o.sx||s,o.sy||s,o.sz||s);M.compose(P,Q,Sc);m.setMatrixAt(i,M);if(o.c)m.setColorAt(i,C.set(o.c))});
  m.count=list.length;m.computeBoundingSphere();m.userData.zs=list.map(o=>o.z);m.userData.flat=1;m.castShadow=cast!==false;m.receiveShadow=true;return m}
const pick=(r,a)=>a[Math.floor(r()*a.length)%a.length];
const sm=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};

/* --- Nivå 1, i meter längs banan: unik start vid klubbhuset → samma sidor hela vägen (dyner till vänster, strand och hav till höger) → unik målgång.
   Sidorna byggs i moduler om 40 m som upprepas var fjärde modul, skapas framför golfaren och tas bort bakom honom.
   Ljuset går från eftermiddag till solnedgång längs banan. Andra nivåer blir egna typer av banor. --- */
const CH=40;
const MEND=(LEVELS[0].v0*LEVELS[0].d+(LEVELS[0].v1-LEVELS[0].v0)*LEVELS[0].d/2)*S; // målet (ca 1041 m)
function holeLabel(m){return m>MEND-110?"Upploppet · mot klubbhuset":"Hål "+Math.min(9,1+Math.floor(m/((MEND-110)/9)))+" av 9"}
// två hinderfria sträckor – samma svårighet som tidigare, så att gamla rekord står sig
const restGap=m=>(m>314&&m<364)||(m>634&&m<684);
// här står klubbhusen och läktaren – ingen annan dekor
function blocked(m,x){return (m<140&&x<-5)||(m>MEND-82&&(x<-5||x>4))}

// tofsar av strandgräs: två korsade plan med målat gräs
function tuftGeo(){return gget("tuft",()=>{const G=new T.BufferGeometry(),h=.5,p=[-h,0,0,h,0,0,h,1,0,-h,1,0,0,0,-h,0,0,h,0,1,h,0,1,-h],u=[0,0,1,0,1,1,0,1,0,0,1,0,1,1,0,1],n=[0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0];
  G.setAttribute("position",new T.Float32BufferAttribute(p,3));G.setAttribute("uv",new T.Float32BufferAttribute(u,2));G.setAttribute("normal",new T.Float32BufferAttribute(n,3));G.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);return G})}
function chunkRun(g,k,m0){
  const q=k&3,r=rng(q*131+17),Tf=[],Gr=[],Ps=[],GOLD=["#e6cf86","#d9bd6c","#c9b45e","#efe0a0","#b5ae58"],GREEN=["#9cc25e","#b0cc68","#c2d474","#8fb856"];
  const dune=(x,z,sx,sy,sz,cnt)=>{if(blocked(m0-z,x))return;const d=mesh(Sph(1,22,12),MAT.dune,x,-.7,z);d.scale.set(sx,sy,sz);d.userData.flat=1;g.add(d);
    for(let n=0;n<cnt;n++){const a=r()*6.283,b=.15+r()*.8,dx=Math.cos(a)*b*sx,dz=Math.sin(a)*b*sz,t=.9+r()*.9;Tf.push({x:x+dx,y:-.7+sy*Math.sqrt(1-b*b)-.12,z:z+dz,sx:t*1.5,sy:t,sz:t*1.5,c:pick(r,GOLD)})}};
  // bakre dynrygg som stänger av horisonten åt vänster, och lägre dyner framför
  for(let n=0;n<2;n++)dune(-(36+r()*10),-(9+n*20+r()*3),20+r()*6,7.5+r()*3,16+r()*4,26);
  for(let n=0;n<3;n++)dune(-(15+r()*7),-(5+n*13+r()*5),5.5+r()*3.5,1.9+r()*1.5,6+r()*4,13);
  // strandgräs mot stranden
  for(let n=0;n<24;n++){const x=4.8+r()*2.6,z=-r()*CH;if(!blocked(m0-z,x)){const t=.5+r()*.6;Tf.push({x,y:-.02,z,sx:t*1.5,sy:t,sz:t*1.5,c:pick(r,GOLD)})}}
  for(let n=0;n<7;n++){const z=-2-n*5.6;if(!blocked(m0-z,7.7))Ps.push({x:7.7,y:.45,z,s:1})}
  for(let n=0;n<6;n++){const x=(r()<.6?-(2.8+r()*5):(2.5+r()*1.6)),z=-r()*CH;Gr.push({x,y:.06,z,s:.9+r()*.4})}
  g.add(inst(tuftGeo(),MAT.tuft,Tf,false));
  if(Ps.length)g.add(inst(Cyl(.07,.09,1,6),toon("#8a6a4a"),Ps,false));
  g.add(inst(Sph(.07,8,6),toon("#fbfcfd"),Gr,false));
  if(q===1&&!blocked(m0+20,-9))g.add(flagGreen(-9,-20,3.4));
  if(q===3&&!blocked(m0+18,-9)){const b=B3.bunker();b.position.set(-9,0,-18);b.scale.setScalar(1.3);b.rotation.y=.7;g.add(b)}
  if(q===2&&!blocked(m0+26,-13))g.add(tree3(-13,-26,.9,r,false));
  // stranden, vågkanten och havet
  const bch=mesh(gget("bchS",()=>new T.PlaneGeometry(8,CH).rotateX(-Math.PI/2)),MAT.sandS,10,.012,-CH/2),sea=mesh(gget("seaS",()=>new T.PlaneGeometry(400,CH).rotateX(-Math.PI/2)),MAT.seaS,213.5,.02,-CH/2),
    foam=mesh(gget("foam",()=>new T.PlaneGeometry(2.2,CH).rotateX(-Math.PI/2)),MAT.foam,13.8,.03,-CH/2);
  [bch,sea,foam].forEach(o=>{o.userData.band=0;o.userData.flat=1;o.receiveShadow=true;g.add(o)});
}
function buildChunk(k){
  const g=new T.Group();g.position.z=-k*CH;chunkRun(g,k,k*CH);
  g.userData.waves=[];g.traverse(o=>{if(o.name==="pen")g.userData.waves.push(o)});
  g.children.forEach(c=>{if(c.userData.band==null)c.userData.band=c.position.z});
  return g;
}
function dropChunk(g){g.traverse(o=>{if(o.isInstancedMesh)o.dispose()});g.removeFromParent()}
// ljuset längs banan: eftermiddag → gyllene timmen → solnedgång
const LK=[{t:0,sun:"#fff1dc",si:2.5,hs:"#d8ecff",hg:"#5a8a3a",hi:1.15,fog:"#e9e6dc",fn:60,ff:230,sea:"#ffffff",rim:"#fff0d8",ri:.7,p:[-8,14,6]},
  {t:.6,sun:"#ffd79c",si:2.4,hs:"#f0dcc4",hg:"#5f7c38",hi:1,fog:"#f6dcb4",fn:55,ff:210,sea:"#ffdcb8",rim:"#ffc98a",ri:1,p:[-10,10,0]},
  {t:1,sun:"#ffa768",si:2.4,hs:"#d8b4c0",hg:"#6f6240",hi:.92,fog:"#f7b27e",fn:45,ff:190,sea:"#f0a67c",rim:"#ff9a60",ri:1.5,p:[-11,6.5,-9]}];
const lkA={};function lookAt(m){const t=Math.max(0,Math.min(1,m/MEND)),i=t<LK[1].t?0:1,a=LK[i],b=LK[i+1],f=sm((t-a.t)/(b.t-a.t)),o={sky:sm((t-.2)/.72),p:a.p.map((v,n)=>v+(b.p[n]-v)*f)};
  for(const k of["si","hi","fn","ff","ri"])o[k]=a[k]+(b[k]-a[k])*f;for(const k of["sun","hs","hg","fog","sea","rim"]){o[k]=lkA[k]||(lkA[k]=new T.Color());o[k].set(a[k]).lerp(col(b[k]),f)}return o}
function win(w,h){const m=mesh(gget("wn"+[w,h],()=>new T.PlaneGeometry(w,h)),MAT.win||(MAT.win=new T.MeshBasicMaterial({map:TEX.win})));m.userData.flat=1;return m}
// Ringenäs klubbhus efter fotot: svart träbyggnad med branta gavlar och vit veranda, hotellet med gröna glasbalkonger, dammen med fontän
function buildClubhouse(fin){
  const g=new T.Group(),dark=toon("#2b3034"),roof=toon("#23272a"),white=toon("#f4f6f8"),glass=new T.MeshStandardMaterial({color:"#5fb39a",roughness:.1,metalness:.2,transparent:true,opacity:.55});
  // restaurangen
  const rs=new T.Group();rs.position.set(-17,0,-78);g.add(rs);
  rs.add(mesh(RBox(9,4.4,13,.12),dark,0,2.2,0));
  const rf=mesh(gget("gab",()=>{const s=new T.Shape();s.moveTo(-5.4,0);s.lineTo(0,4.2);s.lineTo(5.4,0);s.lineTo(-5.4,0);return new T.ExtrudeGeometry(s,{depth:14,bevelEnabled:false}).translate(0,0,-7)}),roof,0,4.4,0);rs.add(rf);
  const trim=mesh(gget("gabt",()=>{const s=new T.Shape();s.moveTo(-5.6,-.1);s.lineTo(0,4.35);s.lineTo(5.6,-.1);s.lineTo(5.3,-.1);s.lineTo(0,4.0);s.lineTo(-5.3,-.1);return new T.ExtrudeGeometry(s,{depth:.15,bevelEnabled:false})}),white,0,4.4,7);rs.add(trim);
  const dm=mesh(gget("dorm",()=>{const s=new T.Shape();s.moveTo(-1.6,0);s.lineTo(0,1.8);s.lineTo(1.6,0);s.lineTo(-1.6,0);return new T.ExtrudeGeometry(s,{depth:3.2,bevelEnabled:false})}),roof,3.2,5.6,-2);dm.rotation.y=Math.PI/2;rs.add(dm,mesh(RBox(.2,1.6,3,.05),dark,4.4,5.4,-.4));
  rs.add(Object.assign(win(2.4,1.1),{}));rs.children[rs.children.length-1].position.set(4.52,5.4,-.4);rs.children[rs.children.length-1].rotation.y=Math.PI/2;
  for(const z of[-4.5,-1.5,1.5,4.5]){const w=win(2.2,2.4);w.position.set(4.52,2,z);w.rotation.y=Math.PI/2;rs.add(w)}
  // vita verandan med pergola och glas
  const ve=new T.Group();ve.position.set(7.5,0,0);rs.add(ve);ve.add(mesh(RBox(6,.3,15,.08),toon("#8a6a4d"),0,.15,0));
  for(let z=-7;z<=7;z+=2.33){ve.add(mesh(Cyl(.07,.07,3,8),white,2.8,1.6,z),mesh(Cyl(.07,.07,3,8),white,-2.8,1.6,z))}
  ve.add(mesh(RBox(6.2,.18,15.2,.06),white,0,3.1,0));for(let x=-2.4;x<=2.4;x+=.8)ve.add(mesh(RBox(.08,.12,15,.03),white,x,3.25,0));
  const gl=mesh(gget("vgl",()=>new T.PlaneGeometry(15,1).rotateY(Math.PI/2)),glass,2.85,.85,0);gl.userData.flat=1;ve.add(gl);
  for(let z=-5;z<=5;z+=3.3){ve.add(mesh(Cyl(.5,.5,.06,14),white,0,1.05,z),mesh(Cyl(.05,.05,.75,6),white,0,.65,z));const um=mesh(Cone(1.1,.5,10),white,0,2.5,z);ve.add(um,mesh(Cyl(.03,.03,2,5),white,0,1.5,z))}
  // hotellet i tre våningar med gröna glasbalkonger, flagga på taket
  const ht=new T.Group();ht.position.set(-22,0,-112);g.add(ht);
  ht.add(mesh(RBox(10,9.6,30,.15),toon("#3b4247"),0,4.8,0),mesh(RBox(10.4,.3,30.4,.1),toon("#2a2f33"),0,9.7,0),mesh(RBox(8,2.6,16,.12),toon("#3b4247"),-.5,11.1,4),mesh(RBox(8.4,.25,16.4,.08),toon("#2a2f33"),-.5,12.5,4));
  for(let f=0;f<3;f++){const y=.6+f*3.1;ht.add(mesh(RBox(1.6,.15,29,.05),toon("#d9dee2"),5.6,y,0));const rl=mesh(gget("bal",()=>new T.PlaneGeometry(29,.9).rotateY(Math.PI/2)),glass,6.38,y+.55,0);rl.userData.flat=1;ht.add(rl);
    for(let z=-12.5;z<=12.5;z+=3.6){const w=win(2.6,2.2);w.position.set(5.02,y+1.3,z);w.rotation.y=Math.PI/2;ht.add(w)}}
  for(let z=-1;z<=11;z+=3.6){const w=win(2.6,1.6);w.position.set(3.52,11.1,z);w.rotation.y=Math.PI/2;ht.add(w)}
  const sg=mesh(gget("sgn",()=>new T.PlaneGeometry(7,1).rotateY(Math.PI/2)),new T.MeshBasicMaterial({map:TEX.sign}),5.04,8.9,2);sg.userData.flat=1;ht.add(sg);
  ht.add(mesh(Cyl(.06,.08,7,8),white,-2,16,-6));const fl=mesh(gget("flag",()=>new T.PlaneGeometry(2.2,1.4)),new T.MeshToonMaterial({map:TEX.flag,side:T.DoubleSide,gradientMap:TEX.grad}),-2,18.7,-7.1);fl.rotation.y=Math.PI/2;fl.name="flag";ht.add(fl);
  const hill=mesh(Sph(1,24,12),toon("#4c9a3c"),-36,-3,-112);hill.scale.set(18,11,40);hill.userData.flat=1;g.add(hill);
  // dammen med fontänen och en green med flagga framför
  const pond=mesh(Disc(48),MAT.water,-7.5,.04,-58);pond.scale.set(4.2,1,9);g.add(pond);const pl=mesh(Tor(1,.12),toon("#3f8a35"),-7.5,.03,-58);pl.rotation.x=Math.PI/2;pl.scale.set(4.3,9.1,.5);g.add(pl);
  g.add(mesh(Cyl(.25,.3,.3,10),toon("#9aa3ab"),-7.5,.15,-60));g.userData.founts=[new T.Vector3(-7.5,.4,-60)];
  g.add(flagGreen(-11,-68,3));
  g.userData.waves=[];g.traverse(o=>{if(o.name==="flag"||o.name==="pen")g.userData.waves.push(o)});
  return shade(g);
}
// Havet, stranden, ön med fyren och segelbåtar – följer med längst bort
function buildSea(){
  const g=new T.Group();
  const sand=mesh(gget("bch",()=>new T.PlaneGeometry(700,20).rotateX(-Math.PI/2)),MAT.sandF,0,.01,-SHORE-6);sand.userData.flat=1;g.add(sand);
  const sea=mesh(gget("sea",()=>new T.PlaneGeometry(2400,1000).rotateX(-Math.PI/2)),MAT.seaF,0,-.02,-SHORE-12-500);sea.renderOrder=-7;g.add(sea);
  const sails=[];for(let i=0;i<3;i++){const b=new T.Group();b.position.set(-200+i*150,0,-420-i*120);const hl=mesh(Cap(1.2,5,8),toon("#f4f6f8",{fog:false}),0,.8,0);hl.rotation.z=Math.PI/2;hl.scale.set(.6,1,.5);
    const sl=mesh(Cone(3,9,3),toon("#ffffff",{fog:false}),0,6,0);sl.scale.z=.12;b.add(hl,sl);g.add(b);sails.push(b)}
  return {g,sails};
}
// Unik målgång: sista greenen, läktaren på stranden och publik längs upploppet – klubbhuset bakom i kvällsljus
function buildFinish(g,z){
  const navy=toon("#132a45"),gld=toon("#e0bb4a"),F=new T.Group();F.position.z=z;g.add(F);
  const gr=mesh(Disc(48),new T.MeshLambertMaterial({color:"#9be67c"}),0,.02,-3);gr.scale.set(8,1,15);gr.userData.flat=1;gr.receiveShadow=true;F.add(gr);
  const col_=mesh(Disc(48),new T.MeshLambertMaterial({color:"#6cc452"}),0,.015,-3);col_.scale.set(9.2,1,16.4);col_.userData.flat=1;F.add(col_);
  const flag=flagGreen(0,-13,.1);F.add(flag);
  // läktaren
  const bodies=[],heads=[],SH=["#132a45","#ffffff","#e0bb4a","#2f7fd0","#c4473c","#e6eef7","#6cc055","#1a559c"],SK=["#f0c9a6","#e0b08a","#c98f66","#8a5a3c"],r=rng(77);
  for(let t=0;t<4;t++){const x=5.4+t*1.15,y=.3+t*.55;F.add(mesh(RBox(1.15,.6+t*.55*2,30,.06),navy,x,(.6+t*1.1)/2,14));F.add(mesh(RBox(1.2,.06,30,.02),gld,x,.62+t*1.1,14));
    for(let n=0;n<26;n++){const zz=1+n*1.02+r()*.2;if(r()<.12)continue;const sc=.9+r()*.25,top=.62+t*1.1;bodies.push({x:x+(r()-.5)*.2,y:top+.42*sc,z:zz,s:sc,c:pick(r,SH)});heads.push({x,y:top+.92*sc,z:zz,s:sc,c:pick(r,SK)})}}
  // publik bakom repet på vänster sida
  for(let n=0;n<30;n++){const zz=n<15?14+n*.8+r()*.4:-2-(n-15)*.7-r()*.3,x=-3.5-r()*1.1,sc=.9+r()*.25;if(zz>2&&zz<4)continue;bodies.push({x,y:.5*sc,z:zz,s:sc*1.05,c:pick(r,SH)});heads.push({x,y:1.05*sc,z:zz,s:sc,c:pick(r,SK)})}
  F.add(inst(Cap(.2,.5,8),toon("#ffffff"),bodies,false),inst(Sph(.15,10,8),toon("#ffffff"),heads,false));
  // repet och banderollen bakom läktaren
  for(let n=0;n<14;n++){F.add(mesh(Cyl(.035,.035,.9,6),gld,-3.1,.45,20-n*2.2))}
  const rope=mesh(gget("rope",()=>new T.CylinderGeometry(.015,.015,29,5).rotateX(Math.PI/2)),gld,-3.1,.8,6);F.add(rope);
  const bnr=mesh(gget("fbnr",()=>new T.PlaneGeometry(30,2.2)),new T.MeshBasicMaterial({map:TEX.finBanner,side:T.DoubleSide}),9.6,6,14);bnr.rotation.y=-Math.PI/2;F.add(bnr);
  // varma lyktor längs upploppet
  for(let n=0;n<4;n++){const zz=7+n*7;F.add(mesh(Cyl(.05,.06,3.4,8),navy,3.4,1.7,zz));const s=sprite(TEX.dot,1.5,1.5,{color:"#ffc56a",blending:T.AdditiveBlending,depthWrite:false,fog:false});s.position.set(3.4,3.5,zz);F.add(s);F.add(mesh(Sph(.14,10,8),new T.MeshBasicMaterial({color:"#ffe3a8",fog:false}),3.4,3.5,zz))}
}
// Unik start: skylt, flaggor och terrass med parasoller vid klubbhuset
function buildStart(g){
  g.add(woodSign(["VÄLKOMMEN TILL","RINGENÄS"],2.3,-3.5,-2.2));
  const para=[["#132a45",-11,-27],["#f4f6f8",-13.6,-25],["#132a45",-15.6,-29],["#e0bb4a",-12,-31.5]];
  for(const[c,x,z]of para){const p=new T.Group();p.position.set(x,0,z);p.add(mesh(Cyl(.05,.05,2.6,8),toon("#d9dde0"),0,1.3,0),mesh(Cone(1.5,.6,14),toon(c),0,2.6,0),mesh(Cyl(.65,.65,.06,18),toon("#f4f6f8"),0,.75,0),mesh(Cyl(.06,.07,.75,8),toon("#d9dde0"),0,.37,0));g.add(p)}
  const r=rng(9),H=[],Fw=[];for(let n=0;n<44;n++){const z=-6-n*.52;H.push({x:-5+r()*.15,y:.2,z,sx:.42,sy:.32+r()*.08,sz:.34,c:pick(r,["#3f7f3a","#4a8d41","#356f32"])});if(n%2===0)Fw.push({x:-4.7+r()*.15,y:.16,z:z+r()*.3,s:.9+r()*.5,c:pick(r,["#ffffff","#f1c7d8","#e3a1c4","#f6d365"])})}
  const lw=MAT.lw||(MAT.lw=new T.MeshLambertMaterial({color:"#ffffff"}));g.add(inst(Sph(1,12,8),lw,H,false),inst(Sph(.14,8,6),lw,Fw,false));
  // två flaggstänger vid starten
  for(const x of[-5.2,5.2]){g.add(mesh(Cyl(.05,.07,7,8),toon("#f4f6f8"),x,3.5,-9));const f=mesh(gget("sef",()=>new T.PlaneGeometry(1.8,1.12).translate(.9,0,0)),MAT.se||(MAT.se=new T.MeshBasicMaterial({map:TEX.sweFlag,side:T.DoubleSide})),x,6.3,-9);f.name="flag";g.add(f)}
}

/* --- Partiklar: sand, vatten, damm, gnistor och konfetti --- */
function fxSystem(n,size,add){const geo=new T.BufferGeometry();geo.setAttribute("position",new T.Float32BufferAttribute(new Float32Array(n*3),3));geo.setAttribute("color",new T.Float32BufferAttribute(new Float32Array(n*3),3));
  const m=new T.PointsMaterial({size,map:TEX.dot,vertexColors:true,transparent:true,depthWrite:false,blending:add?T.AdditiveBlending:T.NormalBlending,alphaTest:.02});const p=new T.Points(geo,m);p.frustumCulled=false;p.renderOrder=5;return {p,n,list:[]}}
const CC={};function col(c){return CC[c]||(CC[c]=new T.Color(c))}
function emit(sys,x,y,z,n,o){if(!R)return;const s=R.fx[sys];for(let i=0;i<n&&s.list.length<s.n;i++){const a=Math.random()*Math.PI*2,sp=(o.sp||2)*(.4+Math.random()*.8);
  s.list.push({x:x+(Math.random()-.5)*(o.r||.3),y,z:z+(Math.random()-.5)*(o.r||.3),vx:Math.cos(a)*sp*(o.spread||1),vy:(o.up||2)*(.6+Math.random()*.8),vz:Math.sin(a)*sp*(o.spread||1)+(o.vz||0),g:o.g==null?9:o.g,life:(o.life||.8)*(.6+Math.random()*.7),c:o.cols[i%o.cols.length]})}}
function updFx(dt){for(const k in R.fx){const s=R.fx[k],pa=s.p.geometry.attributes.position,ca=s.p.geometry.attributes.color;
  for(let i=s.list.length-1;i>=0;i--){const q=s.list[i];q.life-=dt;if(q.life<=0){s.list.splice(i,1);continue}q.vy-=q.g*dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.z+=q.vz*dt;if(q.y<.02&&q.g>0){q.y=.02;q.vy*=-.3;q.vx*=.6;q.vz*=.6}}
  for(let i=0;i<s.n;i++){if(i<s.list.length){const q=s.list[i],c=col(q.c),f=Math.min(1,q.life*3);pa.setXYZ(i,q.x,q.y,q.z);ca.setXYZ(i,c.r*f,c.g*f,c.b*f)}else pa.setXYZ(i,0,-99,0)}
  pa.needsUpdate=true;ca.needsUpdate=true}}

/* --- Popups på golfspråk – bara effekt, påverkar inte rundan eller topplistan --- */
function popup(txt,big){if(!ov||!R)return;const v=new T.Vector3(0,(G?G.py*S:0)+2.3,-(G?G.dist:0)*S).project(R.cam);
  const e=el("div","rgj-pop"+(big?" big":""),txt);e.style.left=((v.x*.5+.5)*W)+"px";e.style.top=((-v.y*.5+.5)*H)+"px";ov.append(e);setTimeout(()=>e.remove(),1100)}
function cleared(g,o,V){V.streak++;const D=OBS[o.k],gz=-g.dist*S;
  emit("spark",0,g.py*S+1.2,gz,14,{sp:2.4,up:2.5,g:3,life:.6,cols:["#fff3c4","#f2c94c","#ffffff"]});
  if(V.streak%15===0)popup("Hole in one!",1);else if(V.streak%10===0)popup("Albatross!",1);else if(V.streak%5===0)popup("Eagle!",1);
  else if(o.k==="bunker")popup("Sandräddning!");else if(o.k==="vatten")popup("Carry över vattnet!");else popup(D.act==="ducka"?"Räddning!":"Birdie!")}

/* --- Kvalitet: skuggor och full upplösning på nyare telefoner, sänks automatiskt om bilden hackar --- */
// iPhone uppger inte sin riktiga kraft i webbläsaren, så där avgör skärmen (3x = iPhone X eller nyare). Klarar telefonen det ändå inte sänks kvaliteten av kvalitetsstegen nedan.
function tierHigh(){const ua=navigator.userAgent;if(/iPhone|iPad|iPod/.test(ua))return (devicePixelRatio||1)>=3;const dm=navigator.deviceMemory||4,hc=navigator.hardwareConcurrency||4;return !/Mobi|Android/.test(ua)||(hc>=6&&dm>=4)}
/* Kvalitetssteg: [upplösning, riktiga skuggor]. Spelet börjar överst, går ner ett steg om telefonen inte hinner med och upp igen när det flyter. */
function qLadder(hi){const d=devicePixelRatio||1;return (hi?[[2,1],[1.75,1],[1.75,0],[1.5,0],[1.25,0]]:[[1.5,0],[1.25,0],[1,0]]).map(([p,s])=>[Math.min(p,d),s])}
function setQ(r,i){const[p,s]=r.ladder[i];r.q=i;r.sun.castShadow=!!s;MAT.blob.visible=!s;if(p!==r.pr){r.pr=p;r.rd.setPixelRatio(p);if(W&&H)r.rd.setSize(W,H,false)}}
/* --- Målade ytor och himmel (jpg-filer i repot). Tills de laddat visas enkla färger, så spelet startar direkt även på segt nät. --- */
const ART_V="2";
function surfaces(){
  if(MAT.tuft)return;
  TEX.tuft=ctex(256,256,(c,w,h)=>{c.clearRect(0,0,w,h);c.lineCap="round";for(let i=0;i<150;i++){const x=w*(.08+Math.random()*.84),b=x+(x-w/2)*(.3+Math.random()*.6),l=h*(.45+Math.random()*.5),t=Math.random();c.strokeStyle="rgb("+(235-t*40)+","+(235-t*30)+","+(210-t*30)+")";c.lineWidth=2+Math.random()*2.4;c.beginPath();c.moveTo(x,h);c.quadraticCurveTo(x+(b-x)*.3,h-l*.7,b,h-l);c.stroke()}});
  TEX.laneA=ctex(128,4,(c,w,h)=>{const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0,"#000");g.addColorStop(.1,"#fff");g.addColorStop(.9,"#fff");g.addColorStop(1,"#000");c.fillStyle=g;c.fillRect(0,0,w,h)});TEX.laneA.colorSpace=T.NoColorSpace;
  TEX.seaA=ctex(4,256,(c,w,h)=>{const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,"#000");g.addColorStop(.45,"#fff");g.addColorStop(1,"#fff");c.fillStyle=g;c.fillRect(0,0,w,h)});TEX.seaA.colorSpace=T.NoColorSpace;
  TEX.foam=ctex(128,512,(c,w,h)=>{c.clearRect(0,0,w,h);const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0,"rgba(255,255,255,0)");g.addColorStop(.55,"rgba(255,255,255,.25)");g.addColorStop(.72,"rgba(255,255,255,.95)");g.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=g;c.fillRect(0,0,w,h);c.fillStyle="#fff";for(let i=0;i<70;i++)c.fillRect(w*(.3+Math.random()*.5),Math.random()*h,2+Math.random()*6,6+Math.random()*30)});TEX.foam.wrapT=T.RepeatWrapping;TEX.foam.repeat.set(1,2);
  TEX.finBanner=ctex(1024,76,(c,w,h)=>{c.fillStyle="#132a45";c.fillRect(0,0,w,h);c.fillStyle="#e0bb4a";c.fillRect(0,0,w,4);c.fillRect(0,h-4,w,4);c.font="900 44px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillStyle="#fff";c.fillText("RINGENÄS  ·  VÄLKOMMEN IN  ·  RINGENÄS",w/2,h/2+2)});
  TEX.sweFlag=ctex(160,100,(c,w,h)=>{c.fillStyle="#1a6bb5";c.fillRect(0,0,w,h);c.fillStyle="#f6c91e";c.fillRect(50,0,20,h);c.fillRect(0,40,w,20)});
  for(const k of["glad","fokus","jubel","ledsen"])MAT["face"+k]=new T.MeshStandardMaterial({color:"#dfa684",roughness:.6});
  MAT.pga=new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});
  MAT.tuft=new T.MeshLambertMaterial({map:TEX.tuft,alphaTest:.3,alphaToCoverage:true,side:T.DoubleSide});
  MAT.gnd=new T.MeshLambertMaterial({map:TEX.ground});MAT.lane=new T.MeshLambertMaterial({map:TEX.lane,alphaMap:TEX.laneA,transparent:true,depthWrite:false});
  MAT.dune=new T.MeshLambertMaterial({color:"#efdcae"});MAT.sandS=new T.MeshLambertMaterial({color:"#f0dca8"});MAT.sandF=new T.MeshLambertMaterial({color:"#f0dca8"});
  MAT.seaS=new T.MeshBasicMaterial({color:"#3b93d8",fog:false,toneMapped:false});
  MAT.seaF=new T.MeshBasicMaterial({color:"#3b93d8",fog:false,toneMapped:false,alphaMap:TEX.seaA,transparent:true,depthWrite:false});
  MAT.foam=new T.MeshBasicMaterial({map:TEX.foam,transparent:true,depthWrite:false,fog:false,toneMapped:false});
  MAT.back=new T.ShaderMaterial({uniforms:{a:{value:null},b:{value:null},t:{value:0}},depthTest:false,depthWrite:false,fog:false,vertexShader:"varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",fragmentShader:"uniform sampler2D a,b;uniform float t;varying vec2 v;void main(){gl_FragColor=vec4(mix(texture2D(a,v).rgb,texture2D(b,v).rgb,t),1.);}"});
}
function art(rd){
  if(TEX.artOn)return;TEX.artOn=1;const L=new T.TextureLoader(),aniso=Math.min(8,rd.capabilities.getMaxAnisotropy());
  const tile=(n,mats,rep,srgb)=>L.load("golf-"+n+".jpg?v="+ART_V,t=>{t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=aniso;t.repeat.set(rep[0],rep[1]);TEX["a_"+n]=t;for(const m of mats){const[mat,r]=m;const x=r?t.clone():t;if(r){x.repeat.set(r[0],r[1]);x.needsUpdate=true;if(n==="hav")(TEX.aSea=TEX.aSea||[]).push(x)}mat.map=x;mat.color.set("#ffffff");mat.needsUpdate=true}});
  tile("gras",[[MAT.gnd]],[40,24]);tile("fairway",[[MAT.lane]],[.55,24]);
  tile("sand",[[MAT.dune,[1.5,1.5]],[MAT.sandS,[1,5]],[MAT.sandF,[80,2.5]]],[1,1]);
  tile("hav",[[MAT.seaS,[20,2]],[MAT.seaF,[120,50]]],[1,1]);
  for(const k of["glad","fokus","jubel","ledsen"])L.load("golf-ansikte-"+k+".jpg?v="+ART_V,t=>{t.colorSpace=T.SRGBColorSpace;t.anisotropy=aniso;t.wrapS=t.wrapT=T.ClampToEdgeWrapping;const m=MAT["face"+k];m.map=t;m.color.set("#ffffff");m.needsUpdate=true});
  L.load("pga-logo.png",t=>{t.colorSpace=T.SRGBColorSpace;t.anisotropy=aniso;MAT.pga.map=t;MAT.pga.opacity=1;MAT.pga.needsUpdate=true});
  let n=0;for(const[k,f]of[["a","dag"],["b","kvall"]])L.load("golf-sky-"+f+".jpg?v="+ART_V,t=>{t.colorSpace=T.NoColorSpace;t.generateMipmaps=false;t.minFilter=T.LinearFilter;MAT.back.uniforms[k].value=t;if(++n===2&&R)R.back.visible=true});
}
function init3D(canvas){
  textures();blob(1);
  MAT.ball=MAT.ball||new T.MeshToonMaterial({map:TEX.ball,bumpMap:TEX.ballBump,bumpScale:2,gradientMap:TEX.grad});
  MAT.logoW=MAT.logoW||new T.MeshBasicMaterial({map:TEX.logoW,transparent:true,depthWrite:false});MAT.capLogo=MAT.capLogo||new T.MeshToonMaterial({map:TEX.capLogo,transparent:true,depthWrite:false,gradientMap:TEX.grad});
  MAT.water=MAT.water||new T.MeshStandardMaterial({color:"#2a8ad6",roughness:.92,metalness:0,emissive:"#0a3a6a",emissiveIntensity:.35});
  MAT.sand=MAT.sand||new T.MeshToonMaterial({map:TEX.sand,gradientMap:TEX.grad});
  surfaces();
  MAT.plank=MAT.plank||new T.MeshToonMaterial({map:TEX.plank,gradientMap:TEX.grad});MAT.stone=MAT.stone||new T.MeshToonMaterial({map:TEX.stone,gradientMap:TEX.grad});
  MAT.net=MAT.net||new T.MeshBasicMaterial({map:TEX.net,transparent:true,alphaTest:.3,side:T.DoubleSide});
  const hi=tierHigh(),rd=new T.WebGLRenderer({canvas,antialias:hi||(devicePixelRatio||1)<2.5,powerPreference:"high-performance",stencil:false});
  rd.toneMapping=T.ACESFilmicToneMapping;rd.toneMappingExposure=.95;
  rd.shadowMap.enabled=true;rd.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene();scene.fog=new T.Fog("#f3dfc9",45,190);
  const cam=new T.PerspectiveCamera(50,1,.1,2500);
  const hemi=new T.HemisphereLight("#cfe4ff","#3f7a2a",1.05);scene.add(hemi);
  // låg kvällssol som på fotot, och ett kantljus framifrån som lyfter konturerna
  const sun=new T.DirectionalLight("#ffdcae",2.1);sun.castShadow=hi;sun.shadow.mapSize.set(1024,1024);const sc=sun.shadow.camera;sc.left=-14;sc.right=14;sc.top=16;sc.bottom=-12;sc.near=1;sc.far=60;sun.shadow.bias=-.0006;sun.shadow.normalBias=.03;sun.shadow.radius=3;
  scene.add(sun,sun.target);const rim=new T.DirectionalLight("#ffd9a8",1.3);rim.position.set(0,6,-20);scene.add(rim,rim.target);
  // himmel i kvällsljus: blå upptill, varm vid horisonten
  const sg=new T.SphereGeometry(1000,32,16),p=sg.attributes.position,cl=[],c=new T.Color(),A=new T.Color("#ffe1c2"),B=new T.Color("#a9cdef"),C=new T.Color("#4f8ed6");
  for(let i=0;i<p.count;i++){const y=p.getY(i)/1000;if(y<.02)c.copy(A);else if(y<.22)c.copy(A).lerp(B,(y-.02)/.2);else c.copy(B).lerp(C,Math.min(1,(y-.22)/.5));cl.push(c.r,c.g,c.b)}
  sg.setAttribute("color",new T.Float32BufferAttribute(cl,3));const sky=new T.Mesh(sg,new T.MeshBasicMaterial({vertexColors:true,side:T.BackSide,fog:false,depthWrite:false}));sky.renderOrder=-10;scene.add(sky);
  const back=mesh(gget("back",()=>new T.PlaneGeometry(1500,644)),MAT.back,0,0,0);back.renderOrder=-9;back.frustumCulled=false;back.visible=!!(MAT.back.uniforms.a.value&&MAT.back.uniforms.b.value);scene.add(back);
  const ground=mesh(gget("gr",()=>new T.PlaneGeometry(320,SHORE+60).rotateX(-Math.PI/2)),MAT.gnd,0,0,0);ground.receiveShadow=true;TEX.ground.repeat.set(1,(SHORE+60)/4);scene.add(ground);
  const lane=mesh(gget("ln",()=>new T.PlaneGeometry(4.4,SHORE+60).rotateX(-Math.PI/2)),MAT.lane,0,.008,0);lane.receiveShadow=true;lane.renderOrder=-1;TEX.lane.repeat.set(1,(SHORE+60)/4);scene.add(lane);
  const sea=buildSea();scene.add(sea.g);
  const club=buildClubhouse();buildStart(club);club.userData.waves=[];club.traverse(o=>{if(o.name==="flag"||o.name==="pen")club.userData.waves.push(o)});shade(club);scene.add(club);
  const club2=buildClubhouse(true);club2.position.z=-MEND+70;buildFinish(club2,-71);shade(club2);scene.add(club2);
  const chunks=new T.Group();scene.add(chunks);
  const obsG=new T.Group();scene.add(obsG);
  const fx={dust:fxSystem(260,.22),sand:fxSystem(260,.16),water:fxSystem(260,.17),spark:fxSystem(200,.32,true),conf:fxSystem(300,.24)};for(const k in fx)scene.add(fx[k].p);
  // målportal vid klubbhuset: rutig banderoll med RINGENÄS och rutig mållinje
  const fin=new T.Group();fin.visible=false;scene.add(fin);const gold=toon("#f2c94c"),wh=toon("#f4f6f8");
  fin.add(mesh(Cap(.11,5.6,10),wh,-3,2.9,0),mesh(Cap(.11,5.6,10),wh,3,2.9,0),mesh(Sph(.18,10,8),gold,-3,5.85,0),mesh(Sph(.18,10,8),gold,3,5.85,0));
  const bn=mesh(gget("finB",()=>new T.PlaneGeometry(6,1.64)),new T.MeshBasicMaterial({map:TEX.chk,side:T.DoubleSide}),0,5,0);fin.add(bn);
  const gl=mesh(gget("finG",()=>new T.PlaneGeometry(3.4,.8).rotateX(-Math.PI/2)),new T.MeshBasicMaterial({map:TEX.chkG}),0,.03,0);gl.userData.flat=1;fin.add(gl);
  for(const sd of[-1,1]){const f=mesh(gget("flag",()=>new T.PlaneGeometry(2.2,1.4)),MAT.pin||(MAT.pin=new T.MeshToonMaterial({map:TEX.pin,side:T.DoubleSide,gradientMap:TEX.grad})),sd*4.6,4.4,0);f.scale.setScalar(.7);f.name="flag";fin.add(f,mesh(Cyl(.04,.04,5,6),wh,sd*(4.6-.78),2.5,0))}
  shade(fin);fin.userData.waves=fin.children.filter(o=>o.name==="flag");
  R={rd,scene,cam,sky,back,sun,rim,hemi,ground,lane,sea,club,club2,chunks,cmap:new Map(),obsG,fx,fin,P:null,ladder:qLadder(hi),q:0,qMin:0,pr:0,fr:0,ft:0,f2:0,skip:120,calm:0,sinceUp:1e9,gRef:null,finZ:null,V:null,fountT:0};
  setQ(R,0);art(rd);
}
function dispose3D(){if(!R)return;try{R.rd.dispose();R.rd.forceContextLoss()}catch(e){}R=null}
function draw3(dt){
  const g=G,r=R;if(!r||!g)return;dt=dt||0;
  if(r.gRef!==g){if(r.gRef&&r.q>r.qMin){setQ(r,r.q-1);r.sinceUp=0}r.skip=120;r.calm=0;r.gRef=g;r.obsG.clear();r.finZ=null;r.fin.visible=false;r.V={py0:0,landT:9,streak:0,confT:0};for(const k in r.fx)r.fx[k].list.length=0}
  const V=r.V;
  if(!r.P||r.P.lv!==g.lv){if(r.P){r.scene.remove(r.P.root,r.P.shadow)}r.P=buildGolfer(g.lv);r.scene.add(r.P.root,r.P.shadow)}
  const gz=-g.dist*S,now=performance.now()/1000;
  const sn=Math.round(gz/4)*4,len=SHORE+60,mNow=g.dist*S;r.ground.position.z=Math.round(gz/8)*8-SHORE+len/2;r.lane.position.z=r.ground.position.z;r.sea.g.position.z=sn;
  r.club.visible=mNow<175;r.club2.visible=mNow>MEND-210;
  // världens moduler: bygg framför, ta bort bakom; allt bortom strandkanten döljs
  const k0=Math.floor(mNow/CH),kMax=Math.floor((mNow+SHORE-1)/CH),shoreZ=sn-SHORE+1;let built=0;
  for(const [k,c] of r.cmap)if(k<k0-1||k>kMax){dropChunk(c);r.cmap.delete(k)}
  for(let k=Math.max(-1,k0-1);k<=kMax;k++)if(!r.cmap.has(k)&&(built<1||r.cmap.size<3)){const c=buildChunk(k);r.chunks.add(c);r.cmap.set(k,c);built++}
  for(const [k,c] of r.cmap){const lim=shoreZ-c.position.z;for(const o of c.children){const zs=o.userData.zs;if(zs){let n=0;while(n<zs.length&&zs[n]>lim)n++;o.count=n;o.visible=n>0}else o.visible=o.userData.band>lim}}
  // ljuset följer banan: från eftermiddag till solnedgång
  const lk=lookAt(mNow);r.hemi.color.copy(lk.hs);r.hemi.groundColor.copy(lk.hg);r.hemi.intensity=lk.hi;r.sun.color.copy(lk.sun);r.sun.intensity=lk.si;r.rim.color.copy(lk.rim);r.rim.intensity=lk.ri;r.scene.fog.near=lk.fn;r.scene.fog.far=lk.ff;r.scene.fog.color.copy(lk.fog);
  MAT.seaS.color.copy(lk.sea);MAT.seaF.color.copy(lk.sea);MAT.back.uniforms.t.value=lk.sky;
  const zn=mNow>MEND-110?"mal":"start";if(V.zone!==zn&&g.state==="run"&&g.lv===1&&g.t>.25){V.zone=zn;zn==="mal"?zoneShow("Upploppet!","Klubbhuset väntar"):zoneShow("Välkommen till din resa genom Ringenäs!","Nivå 1")}
  // golfaren, landning och uppstuds
  const gy=g.py;if(V.py0>0&&gy<=0&&g.state==="run"){V.landT=0;emit("dust",0,.05,gz+.1,12,{sp:1.6,up:1,g:4,life:.5,spread:1,cols:["#e9dcc2","#d8c9a8"]})}
  if(V.py0<=0&&gy>0)emit("dust",0,.05,gz+.15,8,{sp:1.2,up:.8,g:4,life:.4,cols:["#e9dcc2"]});V.py0=gy;V.landT+=dt;
  V.dt=dt;poseGolfer(r.P,g,V,now);r.P.root.position.x=0;r.P.root.position.z=gz;r.P.shadow.position.set(0,.02,gz);
  if(g.state==="run"&&!(g.py>0)&&Math.random()<dt*10)emit("dust",(Math.random()-.5)*.2,.04,gz+.25,1,{sp:.5,up:.5,g:2,life:.35,cols:["#d8e8c0"]});
  // hinder
  const seen=new Set();
  for(const o of g.obs){let m=o.m;if(!m||m.parent!==r.obsG){m=o.m=B3[o.k]();m.userData.o=o;if(o.lbl){const s=sprite(o.lbl==="ducka"?TEX.ducka:TEX.hoppa,1.5,.52,{depthTest:false});s.position.y=o.lbl==="ducka"?3.15:1.95;s.renderOrder=20;s.name="lbl";m.add(s)}r.obsG.add(m)}
    seen.add(m);const z=gz-(o.x-PX)*S;m.position.z=z;const gr=Math.min(1,o.age*3.5),e=gr<1?1+Math.sin(gr*Math.PI)*.12:1;m.scale.setScalar((.3+.7*gr)*e);
    const lb=m.getObjectByName("lbl");if(lb){lb.visible=o.x>PX+14;lb.position.y=(o.lbl==="ducka"?3.15:1.95)+Math.sin(now*5)*.06}
    if(o.k==="boll"){m.getObjectByName("spin").rotation.x=-o.rot*.55;if(g.state==="run"&&Math.random()<dt*30)emit("dust",(Math.random()-.5)*.3,.05,z-.35,2,{sp:.6,up:1.2,g:5,life:.45,cols:["#8fc25a","#b9a27a","#6fa648"]})}
    else if(o.k==="flygboll")m.getObjectByName("fly").rotation.x=-o.age*14;
    else if(o.k==="korg")m.getObjectByName("sway").rotation.z=Math.sin(o.age*3)*.012;
    else if(o.k==="mas")m.traverse(c=>{if(c.name==="wing")c.rotation.z=c.userData.sd*Math.sin(o.age*14)*.6});
    else if(o.k==="vindby")m.traverse(c=>{if(c.name==="gust"){c.rotation.x=o.age*3+c.userData.i;c.position.x=Math.sin(o.age*6+c.userData.i)*.2}else if(c.name==="leaf"){const a=o.age*5+c.userData.i;c.position.x=Math.cos(a)*.6;c.position.z=Math.sin(a)*.6;c.rotation.y=a*2}});
    else if(o.k==="vatten")m.traverse(c=>{if(c.name==="rip"){const t=(o.age*.5+c.userData.ph)%1;c.scale.set(.25+t*1.15,1,.25+t*1.45);c.material.opacity=.55*(1-t)}});
    // stänk när golfaren passerar över sand eller vatten
    const D=OBS[o.k],rel=o.x-PX;
    if(m.userData.fx&&Math.abs(rel)<D.w/2&&g.state==="run"&&Math.random()<dt*28){if(m.userData.fx==="sand")emit("sand",(Math.random()-.5)*1.4,.08,gz+.3,4,{sp:1.2,up:3.2,g:9,life:.7,cols:["#f1dca4","#e2c27e","#fff1c8"]});else emit("water",(Math.random()-.5)*1.4,.08,gz+.3,5,{sp:1,up:3.6,g:9,life:.7,cols:["#e9f6ff","#9fd3ff","#ffffff"]})}
    if(!o.cl&&g.state==="run"&&rel+D.w/2<-8){o.cl=1;cleared(g,o,V)}}
  for(let i=r.obsG.children.length-1;i>=0;i--){const m=r.obsG.children[i];if(!seen.has(m))r.obsG.remove(m)}
  // mållinjen och konfetti
  if(r.finZ==null)r.finZ=-(g.L.v0*g.L.d+(g.L.v1-g.L.v0)*g.L.d/2)*S-.9;
  r.fin.visible=Math.abs(gz-r.finZ)<170;r.fin.position.z=r.finZ;
  if(g.state==="finish"&&!reduced()){V.confT+=dt;if(V.confT<1.6&&Math.random()<dt*30)emit("conf",(Math.random()-.5)*8,7+Math.random()*2,gz-2-Math.random()*6,6,{sp:1.2,up:.2,g:2.2,life:2.6,cols:["#f2c94c","#2f8be6","#ffffff","#e04a3c","#6cc055"]})}
  if(g.state==="crash"&&g.crashT<dt+.001)emit("dust",0,.4,gz,24,{sp:3,up:3,g:8,life:.7,cols:["#ffffff","#e9dcc2"]});
  // fontänen i dammen
  for(const c of [r.club,r.club2]){const fs=c.userData.founts;if(!fs||!c.visible)continue;for(const fp of fs){const wz=fp.z+c.position.z;if(Math.abs(wz-gz)<90&&Math.random()<dt*40)emit("water",fp.x,fp.y,wz,3,{sp:.6,up:6.5,g:9,life:1.2,r:.2,cols:["#ffffff","#d9f0ff"]})}}
  updFx(dt);
  // kameran snett bakifrån – i stående mobil högre upp så att man ser hindren i god tid
  const por=H>=W,c=r.cam,sh=g.state==="crash"&&g.crashT<.3?(Math.random()-.5)*.12:0;
  c.position.set((por?1.7:2.1)+sh,(por?4.3:3.2)+g.py*S*.3+sh,gz+(por?10.5:8.2));c.lookAt(.2,(por?.7:1.0)+g.py*S*.15,gz-(por?12:15));
  r.sun.position.set(lk.p[0],lk.p[1],gz-6+lk.p[2]);r.sun.target.position.set(0,0,gz-6);r.rim.position.set(2,7,gz-22);r.rim.target.position.set(0,1,gz);
  r.sky.position.copy(c.position);
  const bd=1200,vw=2*bd*Math.tan(c.fov*Math.PI/360)*c.aspect,bk=Math.max(1,vw/1460);r.back.scale.set(bk,bk,1);r.back.position.set(c.position.x-110*bk,c.position.y+155*bk,c.position.z-bd);
  const se=r.sea,wv=now*.012;for(const t of TEX.aSea||[])t.offset.set(now*.004,wv);TEX.foam.offset.y=now*.02;
  se.sails.forEach((b,i)=>{b.position.x=((-260+i*170+now*1.5)%700+700)%700-350;b.rotation.z=Math.sin(now*.8+i)*.05});
  for(const c of [r.club,r.club2,r.fin,...r.cmap.values()]){if(!c.visible||!c.userData.waves)continue;for(const o of c.userData.waves){if(o.name==="flag")o.rotation.y=(c===r.fin?0:Math.PI/2)+Math.sin(now*2.2+o.id)*.15;else o.rotation.y=Math.sin(now*3+o.id)*.3}}
  r.rd.render(r.scene,c);
  // kvalitetsstegen: mät utan starten och pauser. Ett låst tempo på 30 bilder/s (strömsparläge) är inte ett kraftproblem och sänker inget.
  if(!dt){r.fr=r.ft=r.f2=0;r.skip=60}
  else if(r.skip>0)r.skip--;
  else{r.fr++;r.ft+=dt;r.f2+=dt*dt;if(r.fr>=90){
    const avg=r.ft/r.fr,sd=Math.sqrt(Math.max(0,r.f2/r.fr-avg*avg)),locked=avg>.03&&avg<.036&&sd<.003,last=r.ladder.length-1;r.fr=r.ft=r.f2=0;r.sinceUp++;
    if(avg>1/38&&!locked){r.calm=0;if(r.q<last){if(r.sinceUp<8)r.qMin=r.q+1;setQ(r,r.q+1);r.sinceUp=1e9;r.skip=45}}
    else if(avg<1/54){if(++r.calm>=4&&r.q>r.qMin&&(g.state!=="run"||r.ladder[r.q-1][1]===r.ladder[r.q][1])){setQ(r,r.q-1);r.calm=0;r.sinceUp=0;r.skip=45}}
    else r.calm=0}}
}

/* === Spelloopen === */
function step(){
  const g=G,L=g.L;
  if(g.state==="run"){
    g.t+=DT;const fin=g.t>=L.d;if(fin)g.t=L.d;
    const p=g.t/L.d;g.v=L.v0+(L.v1-L.v0)*p;g.prog=Math.min(100,Math.floor(100*p));
    const h=g.lv===1?L.s:Math.max(L.e,L.s-Math.floor((L.s-L.e)*p));if(h!==g.hcp){g.hcp=h;g.blink=.6;snd("tick")}
    // delmål – hcp står still på Driving Range, så framstegen firas i stället
    for(const [m,t] of [[25,"25 %"],[50,"Halvvägs!"],[75,"75 %"],[90,g.lv===1?"Snart Grönt kort!":"Snart i mål!"]])if(g.prog>=m&&!g.ms[m]&&!fin){g.ms[m]=1;g.msg={t,left:1.4};snd("tick")}
    if(fin){g.state="finish";g.endT=0;onFinish()}
  }else if(g.state==="finish"){g.endT+=DT;g.v=Math.max(0,g.v-260*DT)}
  else{g.crashT+=DT;parts(g);return}
  g.blink=Math.max(0,g.blink-DT);if(g.msg&&(g.msg.left-=DT)<=0)g.msg=null;
  const dx=g.v*DT;g.dist+=dx;
  // hopp och ducka
  if(g.buf>0){g.buf-=DT;if(g.py<=0&&g.state==="run"){g.vy=540;g.py=.01;g.buf=0;g.duck=0;snd("jump")}}
  if(g.py>0){const fall=(g.held||g.duck>0)&&g.vy<200?3:1;g.vy-=1500*fall*DT;g.py+=g.vy*DT;if(g.py<=0){g.py=0;g.vy=0}}
  if(g.duck>0&&!g.held)g.duck-=DT;
  // nya hinder
  if(g.state==="run"&&g.t<L.d-2.4){g.nextAt-=dx;if(g.nextAt<=0)spawn(g)}
  // flytta och krocka
  const ph=(g.duck>0||g.held)&&g.py<=0?21:40,pl=PX-7,pr=PX+7,pb=g.py,pt=g.py+ph;
  for(let i=g.obs.length-1;i>=0;i--){const o=g.obs[i],D=OBS[o.k];o.x-=dx+(D.vx||0)*DT;o.age+=DT;o.rot=(o.rot||0)-dx/6;
    if(o.x<-80){g.obs.splice(i,1);continue}
    if(g.state==="run"&&o.x+D.w/2-1.5>pl&&o.x-D.w/2+1.5<pr&&D.y1-1.5>pb&&D.y0+1.5<pt){crash();return}}
  parts(g);
}
// damm och konfetti
function parts(g){for(let i=g.parts.length-1;i>=0;i--){const q=g.parts[i];q.x+=q.vx*DT;q.y+=q.vy*DT;q.vy+=q.gr*DT;q.life-=DT;if(q.life<=0)g.parts.splice(i,1)}}
function spawn(g){
  const L=g.L,p=g.t/L.d,pool=L.pool.filter(x=>p>=x[2]);let sum=0;pool.forEach(x=>sum+=x[1]);let r=Math.random()*sum,k=pool[0][0];
  for(const x of pool){r-=x[1];if(r<=0){k=x[0];break}}
  // Rättvis takt: räkna ut när hindret når golfaren och se till att man hinner landa/resa sig från förra hindret
  const D=OBS[k],sp=g.v+(D.vx||0),need=g.lastAct?MINT[g.lastAct+D.act]:0;
  let x=LW+40;const arr=Math.max(g.t+(x-PX)/sp,g.lastArr+need);x=PX+(arr-g.t)*sp;
  if(g.lv===1&&restGap((g.dist+(x-PX)*g.v/sp)*S)){g.nextAt=g.v*.25;return}
  g.lastArr=arr;g.lastAct=D.act;
  const o={k,x,age:0,rot:0};if(!g.seen[k]){g.seen[k]=1;if(g.lv===1)o.lbl=D.act}g.obs.push(o);
  const gap=(L.g0+(L.g1-L.g0)*p)*(g.lv===1&&g.t<10?1.35:1);g.nextAt=g.v*gap*(.92+Math.random()*.4)+D.w;
}
// minsta tid (s) mellan två hinder beroende på handling: hopp → hopp, hopp → duck osv.
const MINT={hoppahoppa:.85,hoppaducka:.95,duckahoppa:.65,duckaducka:.55};
function crash(){const g=G;g.state="crash";g.crashT=0;snd("crash");buzz(60);
  for(let i=0;i<14;i++)g.parts.push({x:PX,y:-20-g.py,vx:(Math.random()-.5)*160,vy:-60-Math.random()*120,gr:300,life:.7,c:"#e6eef7"});
  setTimeout(()=>endRun(false),900)}
function onFinish(){const g=G;snd("cheer");g.hcp=g.L.e;g.prog=100;g.blink=1.2;
  if(!reduced())for(let i=0;i<70;i++)g.parts.push({x:Math.random()*LW,y:-GY-10,vx:(Math.random()-.5)*60,vy:40+Math.random()*90,gr:40,life:2.6,c:["#e0bb4a","#6db3f5","#fff","#2f7fd0"][i%4]});
  setTimeout(()=>endRun(true),1500)}

// Reserv utan WebGL: den tidigare 2D-planen
function draw2(){
  if(!ctx||!G)return;const c=ctx,g=G;
  c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,W,H);
  c.setTransform(dpr*sc,0,0,dpr*sc,0,dpr*oy);bg(c,g);
  c.save();c.translate(0,GY);
  if(g.t>g.L.d-2.5){const fx=PX+(g.L.d-g.t)*g.v+(g.state==="finish"?-g.endT*g.v*.3:0)+18;c.fillStyle="#e6eef7";c.fillRect(fx,-70,2,70);c.fillStyle="#e0bb4a";c.beginPath();c.moveTo(fx+2,-70);c.lineTo(fx+26,-63);c.lineTo(fx+2,-56);c.fill()}
  for(const o of g.obs){c.save();c.translate(o.x,0);OBS[o.k].draw(c,o);
    if(o.lbl&&o.x>PX+14){const dk=o.lbl==="ducka",y=dk?-70:-46;c.fillStyle=dk?"#2f7fd0":"#e0bb4a";rr(c,-17,y-6,34,11,5.5);c.fillStyle=dk?"#fff":"#1a1405";c.font="800 6.5px Montserrat,system-ui,sans-serif";c.textAlign="center";c.fillText(dk?"DUCKA":"HOPPA",0,y+2.2)}
    c.restore()}
  shadow(c,PX,Math.max(3,8-g.py/16));c.shadowColor="rgba(255,255,255,.6)";c.shadowBlur=3*sc*dpr;golfer(c,g,g.lv);c.shadowBlur=0;
  for(const q of g.parts){c.globalAlpha=Math.min(1,q.life*2);c.fillStyle=q.c;c.fillRect(q.x,q.y,2.4,2.4)}c.globalAlpha=1;
  c.restore();
}
function rr(c,x,y,w,h,r){c.beginPath();c.roundRect?c.roundRect(x,y,w,h,r):c.rect(x,y,w,h);c.fill()}

/* === HUD som vanlig HTML i appens Liquid Glass (skarp text på alla skärmar, oberoende av 3D-ritningen) === */
let hud=null;
function buildHud(){
  const h=el("div","rgj-hud");h.setAttribute("aria-live","polite");
  const top=el("div","rgj-hrow"),l=el("div"),rt=el("div","rgj-hrt");
  hud={root:h,name:el("span","rgj-hn"),hcp:el("b","rgj-hh"),best:el("b","rgj-hb"),bar:el("i"),lvl:el("span"),pct:el("span"),msg:el("div","rgj-msg"),hint:el("div","rgj-hint"),c:{}};
  l.append(hud.name,hud.hcp);rt.append(el("span",null,"Rekord"),hud.best);top.append(l,rt);
  const bar=el("div","rgj-bar");bar.append(hud.bar);const r2=el("div","rgj-hrow rgj-hsub");r2.append(hud.lvl,hud.pct);
  h.append(top,bar,r2);
  hud.hint.innerHTML='<b>↑</b> Tryck för att hoppa &nbsp;·&nbsp; <b>↓</b> Håll för att ducka';
  hud.zone=el("div","rgj-zone");ov.append(h,hud.msg,hud.hint,hud.zone);
}
// banderoll under siffrorna när man kommer in i en ny värld
function zoneShow(a,b){if(!hud)return;const z=hud.zone;z.textContent="";z.append(el("b",null,a),el("span",null,b));z.classList.remove("on");void z.offsetWidth;z.classList.add("on")}
function setTxt(k,node,v){if(hud.c[k]!==v){hud.c[k]=v;node.textContent=v}}
function updHud(){
  const g=G;if(!hud||!g)return;
  setTxt("n",hud.name,(nick||"Spelare").toUpperCase());setTxt("h",hud.hcp,"HCP "+hcpTxt(g.hcp));setTxt("b",hud.best,resTxt(best));
  setTxt("l",hud.lvl,mode3d&&g.lv===1?holeLabel(g.dist*S):"Nivå "+g.lv+" · "+g.L.name);setTxt("p",hud.pct,g.prog+" %");
  const w=Math.max(2,g.prog)+"%";if(hud.c.w!==w){hud.c.w=w;hud.bar.style.width=w}
  hud.hcp.classList.toggle("on",g.blink>0&&Math.floor(g.blink*10)%2===0);
  const m=g.msg?g.msg.t:"";setTxt("m",hud.msg,m);hud.msg.style.opacity=g.msg?Math.min(1,g.msg.left*2.5):0;
  const hi=g.t<2.6&&g.state==="run"?Math.min(1,(2.6-g.t)*1.5):0;if(hud.c.hi!==hi){hud.c.hi=hi;hud.hint.style.opacity=hi}
  if(ctl)ctl.root.classList.toggle("rgj-glow",g.t<2.6&&g.state==="run");
}

function frame(now){
  raf=requestAnimationFrame(frame);
  let e=(now-last)/1000;last=now;if(e>.1)e=.1;
  if(G&&!paused){acc+=e;let n=0;while(acc>=DT&&n<12){step();acc-=DT;n++}if(n===12)acc=0}
  if(mode3d)draw3(paused?0:e);else draw2();updHud();
}
function size(){
  W=innerWidth;H=innerHeight;dpr=Math.min(2,devicePixelRatio||1);
  const probe=el("div");probe.style.cssText="position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden";document.body.append(probe);safeTop=probe.offsetHeight||0;probe.remove();
  if(mode3d){LW=LW3;PX=96;R.rd.setSize(W,H,false);cv.style.width=W+"px";cv.style.height=H+"px";R.cam.aspect=W/H;R.cam.fov=H>=W?50:36;R.cam.updateProjectionMatrix();return}
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);cv.style.width=W+"px";cv.style.height=H+"px";
  sc=Math.min(H/LH,W/360);LW=W/sc;PX=Math.min(96,LW*.19);
  oy=Math.max(0,Math.min(H-LH*sc,Math.max(H*.68-GY*sc,safeTop+150-55*sc)));
  const st=-oy/sc,hz=GY-70;skyG=ctx.createLinearGradient(0,st,0,hz);skyG.addColorStop(0,"#3c4856");skyG.addColorStop(.55,"#8e9aa6");skyG.addColorStop(1,"#c6ced5");
  clouds=[];for(let i=0;i<6;i++){const r=n=>Math.abs(Math.sin(i*12.9898+n*78.233)*43758.5453)%1;clouds.push({x:i*(LW+260)/6,y:st+(hz-st)*(.25+r(1)*.5),b:[0,1,2,3].map(j=>[j*14-20+r(j+2)*8,r(j+6)*5-2,10+r(j+9)*12])})}
}

/* === Styrning: stora tumknappar nere till höger (↑ hoppa, håll ↓ ducka).
   Tryck var som helst = hoppa och svep nedåt = ducka fungerar också. Ingen zoom, scroll eller dra-för-att-uppdatera. === */
let py0=0,pid=null,swiped=false,ctl=null;
function buzz(ms){if(navigator.vibrate)try{navigator.vibrate(ms)}catch(e){}}
function jump(){const g=G;if(!g||g.state!=="run"||paused)return;g.buf=.12;g.held=false}
function duck(on){const g=G;if(!g||g.state!=="run"||paused)return;if(on){if(!g.held&&g.duck<=0)snd("duck");g.held=true;g.duck=Math.max(g.duck,.45);g.buf=0}else g.held=false}
// ducka mitt i ett hopp = snabb landning
function duckStart(){const g=G;if(g&&g.buf>0)g.buf=0;if(g&&g.py>0&&g.vy>0)g.vy=0;duck(true)}
function onDown(e){if(e.target.closest("button,.rgj-sheet"))return;e.preventDefault();audioOn();pid=e.pointerId;py0=e.clientY;swiped=false;jump()}
function onMove(e){if(e.pointerId!==pid)return;e.preventDefault();if(!swiped&&e.clientY-py0>22){swiped=true;duckStart()}}
function onUp(e){if(e.pointerId!==pid)return;pid=null;if(swiped)duck(false)}
function onKey(e){if(!ov||sheet&&e.key!=="Escape")return;const k=e.key;if(k===" "||k==="ArrowUp"||k==="w"){e.preventDefault();if(!e.repeat){audioOn();jump();flash(ctl&&ctl.j)}}else if(k==="ArrowDown"||k==="s"){e.preventDefault();if(!e.repeat){duckStart();ctl&&ctl.d.classList.add("on")}}else if(k==="Escape"||k==="p"){pause(true)}}
function onKeyUp(e){if(e.key==="ArrowDown"||e.key==="s"){duck(false);ctl&&ctl.d.classList.remove("on")}}
function flash(b){if(!b)return;b.classList.add("on");setTimeout(()=>b.classList.remove("on"),140)}
const ICON={up:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8 9 25h9v14h12V25h9z"/></svg>',down:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 40 9 23h9V9h12v14h9z"/></svg>'};
function buildCtl(){
  const w=el("div","rgj-ctl"),j=el("button","rgj-pad rgj-jump"),d=el("button","rgj-pad rgj-duck");
  j.type=d.type="button";j.setAttribute("aria-label","Hoppa");d.setAttribute("aria-label","Ducka (håll in)");
  j.innerHTML=ICON.up+"<span>Hoppa</span>";d.innerHTML=ICON.down+"<span>Ducka</span>";
  const cap=(b,id)=>{try{b.setPointerCapture(id)}catch(e){}};
  j.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();audioOn();cap(j,e.pointerId);j.classList.add("on");jump();buzz(8)});
  const ju=e=>{j.classList.remove("on")};["pointerup","pointercancel","lostpointercapture"].forEach(t=>j.addEventListener(t,ju));
  let dp=null;
  d.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();audioOn();dp=e.pointerId;cap(d,dp);d.classList.add("on");duckStart();buzz(8)});
  const du=e=>{if(dp!==null&&e.pointerId!==dp)return;dp=null;d.classList.remove("on");duck(false)};["pointerup","pointercancel","lostpointercapture"].forEach(t=>d.addEventListener(t,du));
  w.append(j,d);ov.append(w);ctl={root:w,j,d};
}
// Knappar och resultatrutan undantas, annars uteblir klicken på iPhone (tumknapparna sköts med pointer-händelser)
const stopTouch=e=>{if(!ov)return;const t=e.target;if(t.closest&&(t.closest(".rgj-sheet")||(t.closest("button")&&!t.closest(".rgj-ctl"))))return;e.preventDefault()};

/* === Overlay: helskärm under spel === */
let paused=false,sheet=null,scrollBack=0;
function openOverlay(){
  if(ov)return;scrollBack=scrollY;scrollTo(0,0);ov=el("div","rgj-ov");ov.setAttribute("role","application");ov.setAttribute("aria-label","Ringenäs Golf Journey");
  cv=el("canvas","rgj-cv");mode3d=false;
  if(T){try{init3D(cv);mode3d=true}catch(e){dispose3D();cv=el("canvas","rgj-cv")}}
  if(!mode3d)ctx=cv.getContext("2d");
  ov.classList.toggle("rgj-3d",mode3d);ov.append(cv);
  const sb=el("button","rgj-btn rgj-snd");sb.type="button";const setS=()=>{sb.textContent=soundOn?"🔊":"🔇";sb.setAttribute("aria-label",soundOn?"Stäng av ljud":"Slå på ljud")};setS();
  sb.onclick=()=>{soundOn=!soundOn;ls("rgj_sound",soundOn?"1":"0");audioOn();setS()};
  const pb=el("button","rgj-btn rgj-pau","❚❚");pb.type="button";pb.setAttribute("aria-label","Pausa");pb.onclick=()=>pause(true);
  ov.append(sb,pb);buildHud();buildCtl();document.body.append(ov);document.documentElement.classList.add("rgj-lock");
  ov.addEventListener("pointerdown",onDown);ov.addEventListener("pointermove",onMove,{passive:false});ov.addEventListener("pointerup",onUp);ov.addEventListener("pointercancel",onUp);
  ov.addEventListener("touchmove",stopTouch,{passive:false});ov.addEventListener("touchstart",stopTouch,{passive:false});ov.addEventListener("contextmenu",e=>e.preventDefault());
  document.addEventListener("gesturestart",stopTouch,{passive:false});addEventListener("keydown",onKey);addEventListener("keyup",onKeyUp);addEventListener("resize",size);
  size();last=performance.now();acc=0;raf=requestAnimationFrame(frame);
}
function closeOverlay(){
  if(!ov)return;cancelAnimationFrame(raf);raf=0;removeEventListener("keydown",onKey);removeEventListener("keyup",onKeyUp);removeEventListener("resize",size);document.removeEventListener("gesturestart",stopTouch);
  dispose3D();ov.remove();ov=null;cv=null;ctx=null;G=null;hud=null;ctl=null;paused=false;sheet=null;document.documentElement.classList.remove("rgj-lock");render();scrollTo(0,tab==="play"?scrollBack:0);
}
function showSheet(build){if(sheet)sheet.remove();sheet=el("div","rgj-sheet");const c=el("div","card rgj-card");build(c);sheet.append(c);ov.append(sheet);const b=c.querySelector("button.go");if(b)b.focus({preventScroll:true})}
function pause(on){
  if(!ov||!G||G.state!=="run")return;
  if(on&&!paused){paused=true;showSheet(c=>{c.append(el("h2",null,"Pausat"),el("p",null,"Rundan väntar på dig."));const g1=el("button","go","Fortsätt");g1.onclick=()=>pause(false);const g2=el("button","ghost","Avsluta rundan");g2.onclick=()=>{paused=false;closeOverlay()};c.append(g1,g2)})}
  else if(!on&&paused){paused=false;if(sheet){sheet.remove();sheet=null}last=performance.now();acc=0}
}
document.addEventListener("visibilitychange",()=>{if(document.hidden)pause(true)});

/* === Runda: start, slut, inskick === */
// 3D-motorn hämtas först när spelet öppnas (och sparas sedan i appens cache, så den fungerar även ute på rangen)
async function startRun(lv){
  if(!T&&!ov){try{await load3D()}catch(e){}}
  openOverlay();if(sheet){sheet.remove();sheet=null}paused=false;
  G=newRun(lv);const g=G;
  fetch(FN,{method:"POST",headers:{"Content-Type":"application/json",apikey:KEY},body:JSON.stringify({action:"start",device:dev,level:lv})}).then(r=>r.json()).then(j=>{if(j&&j.ok)g.run=j.run}).catch(()=>{});
}
async function submit(g,res){
  if(!g.run)return "offline";
  try{const r=await fetch(FN,{method:"POST",headers:{"Content-Type":"application/json",apikey:KEY},body:JSON.stringify({action:"submit",device:dev,level:g.lv,run:g.run,nick,secs:Math.round(g.t*100)/100,hcp:res.hcp,progress:res.progress,completed:res.done})});const j=await r.json();return j.ok?"ok":(j.error||"fel")}catch(e){return "offline"}
}
function endRun(done){
  const g=G;if(!g||!ov)return;const L=g.L,res={hcp:done?L.e:g.hcp,progress:done?100:g.prog,level:g.lv,done};
  const nb=better(res,best);if(nb)best={hcp:res.hcp,progress:res.progress,level:g.lv};
  const pk=String(g.lv);if(better(res,pbs[pk]))pbs[pk]={hcp:res.hcp,progress:res.progress};
  let first=false;if(done&&!medals.includes(L.reward)){medals.push(L.reward);first=true}
  if(done&&g.lv<5)unlocked=Math.max(unlocked,g.lv+1);persist();
  const st=el("p","rgj-st",nb||done?"Skickar till topplistan…":"");
  if(nb||done)submit(g,res).then(s=>{st.textContent=s==="ok"?"Sparat i topplistan ✓":s==="offline"?"Ingen anslutning – resultatet finns kvar på den här enheten.":"Kunde inte spara i topplistan just nu."});
  const legend=done&&g.lv===5;
  showSheet(c=>{
    if(first){const m=el("div","rgj-medal"+(g.lv===1?" green":""));m.append(el("small",null,legend?"Ringenäs":"Klarat"),el("b",null,legend?"Legend":L.reward));c.append(m)}
    c.append(el("div","eyebrow",done?"Nivå "+g.lv+" klar":"Krock!"),el("h2",null,legend?"RINGENÄS LEGEND":done?"Klarat "+L.reward+"!":"Rundan är slut"));
    c.append(el("div","rgj-big","HCP "+hcpTxt(res.hcp)));
    c.append(el("p",null,done?"Du tog dig hela vägen genom "+L.name+".":"Du kom "+res.progress+" % av "+L.name+"."));
    c.append(el("p","rgj-rec",nb?"Nytt personligt rekord!":"Ditt rekord: "+resTxt(best)),st);
    const a=el("button","go","Spela igen");a.onclick=()=>startRun(g.lv);
    const nx=done&&g.lv<5?el("button","go",LEVELS[g.lv].open?"Nästa nivå":"Nivå "+(g.lv+1)+" kommer snart"):null;if(nx){if(LEVELS[g.lv].open)nx.onclick=()=>startRun(g.lv+1);else nx.disabled=true}
    const b=el("button","ghost","Topplista");b.onclick=()=>{tab="board";boardFor="";closeOverlay()};
    const m2=el("button","ghost","Till menyn");m2.onclick=()=>{tab="play";closeOverlay()};
    if(nx&&!nx.disabled)c.append(nx);c.append(a,b,m2);if(nx&&nx.disabled)c.append(el("p","rgj-st",nx.textContent));
  });
}

/* === Menyer och topplista (vanlig app-UI i #golfRoot) === */
let tab="play",period="today",sel=0,boardRows=null,boardErr=false,boardFor="",draft="";
function startLevel(){const h=LEVELS.filter(l=>l.open&&l.n<=unlocked).pop();return h?h.n:1}
function render(){
  const root=document.getElementById("golfRoot");if(!root)return;root.textContent="";
  if(!sel||sel>unlocked||!LEVELS[sel-1].open)sel=startLevel();
  const tabs=el("div","chips ctabs rgj-tabs");[["play","Spela"],["board","Topplista"]].forEach(([k,t])=>{const b=el("button","chip"+(tab===k?" on":""),t);b.type="button";b.onclick=()=>{tab=k;if(k==="board")boardFor="";render()};tabs.append(b)});root.append(tabs);
  if(tab==="board")renderBoard(root);else{tab="play";renderPlay(root)}
}
function renderPlay(root){
  const c=el("div","card rgj-intro");c.append(el("div","eyebrow","Spel"),el("h2",null,"Ringenäs Golf Journey"),el("p",null,"Spring, hoppa och ducka dig genom fem banor – från HCP 99 hela vägen till +8."));
  if(!nick){const lb=el("label",null,"Ditt smeknamn");lb.htmlFor="rgjNick";const inp=el("input");inp.id="rgjNick";inp.maxLength=12;inp.autocomplete="off";inp.placeholder="Max 12 tecken";inp.value=draft;inp.oninput=()=>{draft=inp.value};const msg=el("div","msg","Använd smeknamn eller förnamn – listan är publik.");c.append(lb,inp,msg);c.dataset.nick="1"}
  else{const p=el("p","rgj-who");p.append("Spelar som ",el("b",null,nick)," · ");const ch=el("button","rgj-link","Byt namn");ch.type="button";ch.onclick=()=>{nick="";ls("rgj_nick","");render()};p.append(ch);c.append(p)}
  c.append(el("p","rgj-rec","Ditt rekord: "+resTxt(best)));root.append(c);
  const lc=el("div","card");lc.append(el("h2",null,"Välj bana"));
  LEVELS.forEach(L=>{const ok=L.open&&L.n<=unlocked,b=el("button","ex"+(L.n===sel?" hl":""));b.type="button";
    const ic=el("span","ic rgj-n",String(L.n)),d=el("div");d.append(el("b",null,L.name),el("small",null,!L.open?"Kommer snart · HCP "+hcpTxt(L.s)+" → "+hcpTxt(L.e):ok?"HCP "+hcpTxt(L.s)+" → "+hcpTxt(L.e)+" · Belöning: "+L.reward+(pbs[L.n]?" · Bäst: "+resTxt(pbs[L.n]):""):"Låst – klara nivå "+(L.n-1)+" först"));
    b.append(ic,d);if(medals.includes(L.reward))b.append(el("i","rgj-tick","✓"));if(!ok)b.disabled=true;else b.onclick=()=>{sel=L.n;render()};lc.append(b)});
  if(medals.length){const m=el("div","rgj-medals");medals.forEach(x=>m.append(el("span","rgj-chip",x)));lc.append(m)}
  const go=el("button","go","Spela "+LEVELS[sel-1].name);go.type="button";
  const err=el("div","msg err hide");
  go.onclick=async()=>{if(go.disabled)return;if(!nick){const inp=document.getElementById("rgjNick"),v=(inp&&inp.value||"").trim();if(!nickOk(v)){err.textContent=v?"Välj ett annat smeknamn (bokstäver och siffror, max 12 tecken).":"Skriv ett smeknamn först.";err.classList.remove("hide");if(inp)inp.focus();return}nick=v;ls("rgj_nick",v)}if(!T){go.disabled=true;go.textContent="Laddar 3D-banan…"}await startRun(sel);go.disabled=false;go.textContent="Spela "+LEVELS[sel-1].name};
  lc.append(go,err,el("p","msg","↑ Hoppa · Håll ↓ för att ducka – knapparna sitter nere till höger"));root.append(lc);
}
async function loadBoard(){
  const want=period;boardFor=want;boardRows=null;boardErr=false;
  try{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json",apikey:KEY},body:JSON.stringify({p_period:want})});if(!r.ok)throw 0;const d=await r.json();if(boardFor===want)boardRows=d}catch(e){if(boardFor===want)boardErr=true}
  if(tab==="board"&&document.getElementById("golfRoot"))render();
}
function renderBoard(root){
  const c=el("div","card");c.append(el("h2",null,"Topplista – Golf Journey"));
  const ch=el("div","chips");[["today","Idag"],["week","Veckans"],["all","All time"]].forEach(([k,t])=>{const b=el("button","chip"+(period===k?" on":""),t);b.type="button";b.onclick=()=>{period=k;loadBoard();render()};ch.append(b)});c.append(ch);
  const pl=el("div","msg");pl.style.margin="0 0 .5em";c.append(pl);const bd=el("div");c.append(bd);
  if(boardFor!==period||(!boardRows&&!boardErr)){bd.textContent="Hämtar topplistan…";if(boardFor!==period)loadBoard()}
  else if(boardErr)bd.textContent="Kunde inte hämta topplistan just nu.";
  else if(!boardRows.length)bd.textContent="Inga resultat ännu – bli först!";
  else{const mi=boardRows.findIndex(r=>nick&&r.nick.toLowerCase()===nick.toLowerCase());if(mi>=0)pl.textContent="Du ligger på plats "+(mi+1)+" av "+boardRows.length+" – klättra högre!";
    boardRows.forEach((r,i)=>{const row=el("div","row"+(i===0?" first":"")+(i===mi?" me":""));const nm=el("div","nm",r.nick);nm.append(el("span","sub","Nivå "+r.level+" · "+LEVELS[r.level-1].name+" · "+new Date(r.created_at).toLocaleDateString("sv-SE")));row.append(el("div","rk",String(i+1)),nm,el("div","pts",resTxt(r)));bd.append(row)})}
  const go=el("button","go","Spela");go.type="button";go.onclick=()=>{tab="play";render()};c.append(go);root.append(c);
}

// state() läser rundan utan att ändra den (används vid test av banorna)
window.RGJ={show(){if(tab==="board")boardFor="";render();load3D().catch(()=>{})},hide(){if(ov)closeOverlay()},levels:LEVELS,obstacles:OBS,state:()=>G&&{mode:mode3d?"3d":"2d",t:G.t,state:G.state,py:G.py,v:G.v,lv:G.lv,hcp:G.hcp,prog:G.prog,px:PX,obs:G.obs.map(o=>({k:o.k,x:o.x}))}};
})();
