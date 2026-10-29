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
  {n:1,name:"Driving Range",s:99,e:54,d:75,reward:"Grönt kort",open:true,v0:240,v1:315,g0:1.6,g1:1.0,pool:[["boll",3,0],["pegg",3,0],["korg",2,.1],["pinnar",2,.2],["flygboll",2,.3],["peggpar",1,.4],["bag",2,.5]]},
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

/* === 3D: Ringenäs driving range i tre dimensioner (three.js ligger på sidan själv: three.module.min.js) ===
   Spelmotorn räknar som förut i logiska enheter (samma tider, hinder och krockytor som Edge Function golf-submit litar på).
   Här ritas bara samma läge i 3D: 20 logiska enheter = 1 meter, golfaren springer mot -z och kameran följer snett bakifrån. */
const S=1/20,TL=80,LW3=700;
let T=null,R=null,loading3d=null;
function load3D(){if(T)return Promise.resolve(T);if(!loading3d)loading3d=import("./three.module.min.js").then(m=>(T=m)).catch(e=>{loading3d=null;throw e});return loading3d}
const GEO={},MAT={},TEX={};
const gget=(k,f)=>GEO[k]||(GEO[k]=f());
function lam(c,o){const k="l"+c+(o?JSON.stringify(o):"");return MAT[k]||(MAT[k]=new T.MeshLambertMaterial(Object.assign({color:c},o||{})))}
function bas(c,o){const k="b"+c+(o?JSON.stringify(o):"");return MAT[k]||(MAT[k]=new T.MeshBasicMaterial(Object.assign({color:c},o||{})))}
function mesh(g,m,x,y,z){const o=new T.Mesh(g,m);o.position.set(x||0,y||0,z||0);return o}
const Box=(w,h,d)=>gget("B"+[w,h,d],()=>new T.BoxGeometry(w,h,d));
const Cyl=(a,b,h,n)=>gget("C"+[a,b,h,n],()=>new T.CylinderGeometry(a,b,h,n||10));
const Sph=(r,a,b)=>gget("S"+[r,a,b],()=>new T.SphereGeometry(r,a||14,b||10));
const Cone=(r,h,n)=>gget("K"+[r,h,n],()=>new T.ConeGeometry(r,h,n||6));
const Disc=n=>gget("D"+n,()=>new T.CircleGeometry(1,n||28).rotateX(-Math.PI/2));
function ctex(w,h,fn){const c=document.createElement("canvas");c.width=w;c.height=h;fn(c.getContext("2d"),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t}
function rrp(c,x,y,w,h,r){c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h)}
const F3="Montserrat,Inter,system-ui,sans-serif";
function pillTex(txt,bg,fg){return ctex(256,88,(c,w,h)=>{rrp(c,6,6,w-12,h-12,(h-12)/2);c.fillStyle=bg;c.fill();c.lineWidth=4;c.strokeStyle="rgba(255,255,255,.7)";c.stroke();c.fillStyle=fg;c.font="900 46px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText(txt,w/2,h/2+2)})}
function sprite(tex,w,h,o){const m=new T.SpriteMaterial(Object.assign({map:tex,transparent:true},o||{})),s=new T.Sprite(m);s.scale.set(w,h,1);return s}
function rng(s){s=(s*9301+49297)%233280||1;return()=>(s=(s*16807)%2147483647)/2147483647}
function textures(){if(TEX.ok)return;TEX.ok=1;
  TEX.blob=ctex(64,64,(c,w)=>{const g=c.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);g.addColorStop(0,"rgba(0,0,0,.5)");g.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=g;c.fillRect(0,0,w,w)});
  TEX.ball=ctex(128,64,(c,w,h)=>{c.fillStyle="#fbfcfd";c.fillRect(0,0,w,h);c.fillStyle="rgba(120,140,160,.55)";for(let y=5;y<h;y+=9)for(let x=(y/9|0)%2*5;x<w;x+=10){c.beginPath();c.arc(x,y,2,0,7);c.fill()}c.fillStyle="#e0bb4a";c.fillRect(0,h/2-1,w,2)});
  const stripes=(a,b)=>ctex(8,64,(c,w,h)=>{c.fillStyle=a;c.fillRect(0,0,w,h/2);c.fillStyle=b;c.fillRect(0,h/2,w,h/2)});
  TEX.ground=stripes("#4f7f40","#578a47");TEX.lane=stripes("#5d924c","#67a055");
  [TEX.ground,TEX.lane].forEach(t=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.NearestFilter});
  TEX.hoppa=pillTex("HOPPA","#e0bb4a","#1a1405");TEX.ducka=pillTex("DUCKA","#2f7fd0","#ffffff");TEX.mal=pillTex("MÅL","#132a45","#e0bb4a");
  TEX.gc=ctex(512,64,(c,w,h)=>{c.fillStyle="#22272b";c.fillRect(0,0,w,h);c.fillStyle="#f2f4f6";c.font="800 34px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText("RINGENÄS GOLFCENTER",w/2,h/2+2)});
  TEX.flag=ctex(160,100,(c,w,h)=>{c.fillStyle="#2f6fb5";c.fillRect(0,0,w,h);c.fillStyle="#f2c230";c.fillRect(50,0,20,h);c.fillRect(0,40,w,20)});
  TEX.birch=ctex(16,128,(c,w,h)=>{c.fillStyle="#ece8e0";c.fillRect(0,0,w,h);c.fillStyle="#2a2a28";for(let i=0;i<14;i++)c.fillRect((i*7)%10,i*9+3,4+(i%3)*2,2)});
  TEX.cloud=ctex(128,64,(c,w,h)=>{c.fillStyle="#fff";[[40,38,22],[66,30,26],[92,38,20],[64,42,24]].forEach(([x,y,r])=>{const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,"rgba(240,243,246,.9)");g.addColorStop(1,"rgba(240,243,246,0)");c.fillStyle=g;c.fillRect(0,0,w,h)})});
  // Havet med ön, fyren och den röda bojen – längst bort, som i 2D-versionen
  TEX.sea=ctex(2048,160,(c,w,h)=>{c.clearRect(0,0,w,h);const sy=104;c.fillStyle="#8797a6";c.fillRect(0,sy,w,h-sy);c.fillStyle="rgba(255,255,255,.22)";for(let i=0;i<60;i++)c.fillRect((i*157)%w,sy+6+(i%7)*7,40+(i%3)*20,1.5);
    const ix=1350;c.fillStyle="#26323d";c.beginPath();c.moveTo(ix-210,sy+4);c.quadraticCurveTo(ix-60,sy-26,ix+40,sy-20);c.quadraticCurveTo(ix+160,sy-14,ix+240,sy+4);c.fill();
    c.fillStyle="#ece6dd";c.fillRect(ix+4,sy-62,12,44);c.fillStyle="#26323d";c.fillRect(ix+1,sy-72,18,10);c.fillStyle="#ffd84a";c.fillRect(ix+7,sy-69,6,5);c.fillStyle="#c4473c";c.fillRect(ix+330,sy+14,5,10)});
  TEX.trees=ctex(1024,64,(c,w,h)=>{c.clearRect(0,0,w,h);c.fillStyle="#56694d";c.beginPath();c.moveTo(0,h);for(let x=0;x<=w;x+=8)c.lineTo(x,h*.38+Math.abs(Math.sin(x/37))*10+Math.sin(x/113)*7);c.lineTo(w,h);c.fill();c.fillStyle="#4a5c43";c.fillRect(0,h-14,w,14)});
  TEX.beam=ctex(256,64,(c,w,h)=>{const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0,"rgba(255,216,74,.9)");g.addColorStop(1,"rgba(255,216,74,0)");c.fillStyle=g;c.beginPath();c.moveTo(0,h/2-3);c.lineTo(w,0);c.lineTo(w,h);c.lineTo(0,h/2+3);c.fill()});
}
function blob(r,y){const m=new T.Mesh(gget("P1",()=>new T.PlaneGeometry(1,1).rotateX(-Math.PI/2)),MAT.blob||(MAT.blob=new T.MeshBasicMaterial({map:TEX.blob,transparent:true,depthWrite:false})));m.scale.set(r*2,1,r*2);m.position.y=y||.015;m.renderOrder=1;return m}

/* --- Golfaren i 3D: samma kläder per nivå som tidigare (GEAR) --- */
function buildGolfer(lv){
  const k=GEAR[lv]||GEAR[1],root=new T.Group(),body=new T.Group(),hips=new T.Group();root.add(body);body.add(hips);
  const pants=lam(k.pants),skin=lam(SKIN),jk=lam(k.jacket),pn=lam(k.panel),shoe=lam(k.shoe),legs=[],arms=[];
  [-.115,.115].forEach(x=>{const th=new T.Group();th.position.x=x;hips.add(th);th.add(mesh(Box(.17,.5,.19),pants,0,-.24,0));
    const kn=new T.Group();kn.position.y=-.48;th.add(kn);kn.add(mesh(Box(.15,.48,.16),pants,0,-.24,0),mesh(Box(.15,.09,.3),shoe,0,-.49,-.06));legs.push({th,kn})});
  const torso=new T.Group();hips.add(torso);
  torso.add(mesh(Box(.46,.6,.28),jk,0,.33,0),mesh(Box(.47,.14,.29),pn,0,.57,0),mesh(Box(.47,.06,.29),pn,0,.05,0),mesh(Box(.04,.42,.29),pn,-.215,.3,0));
  torso.add(mesh(Cyl(.06,.06,.1,8),skin,0,.66,0),mesh(Sph(.135),skin,0,.8,0));
  const cap=lam(k.cap);torso.add(mesh(gget("cap",()=>new T.SphereGeometry(.148,14,8,0,Math.PI*2,0,Math.PI/2)),cap,0,.83,0),mesh(Box(.2,.025,.17),cap,0,.835,-.16),mesh(Sph(.025,6,4),lam("#ffffff"),0,.93,-.12));
  [-1,1].forEach(sd=>{const sh=new T.Group();sh.position.set(sd*.29,.55,0);torso.add(sh);sh.add(mesh(Box(.12,.31,.13),sd<0?pn:jk,0,-.15,0));
    const elb=new T.Group();elb.position.y=-.3;sh.add(elb);elb.add(mesh(Box(.11,.28,.12),jk,0,-.14,0),mesh(Sph(.065,8,6),k.glove&&sd<0?lam("#ffffff"):skin,0,-.3,0));
    if(sd>0){const club=new T.Group();club.position.y=-.3;club.rotation.x=-.5;elb.add(club);club.add(mesh(Cyl(.013,.013,.95,6),lam("#22262b"),0,-.47,0),mesh(Box(.07,.1,.13),lam("#c9a14a"),0,-.95,-.04))}
    arms.push({sh,elb})});
  const stars=new T.Group();stars.position.y=2.15;for(let i=0;i<3;i++)stars.add(mesh(Sph(.07,6,4),bas("#e0bb4a"),0,0,0));stars.visible=false;root.add(stars);
  const sh=blob(.42);return {root,body,hips,legs,arms,torso,stars,shadow:sh,lv};
}
function poseGolfer(P,g){
  const st=g.state,air=g.py>.5,duck=(g.duck>0||g.held)&&st==="run",ph=g.dist/11;
  const run=i=>{const p=ph+i*Math.PI,a=Math.sin(p)*.8;return[a,a-(Math.max(0,Math.cos(p))*1.2+.15)]};
  const L=st==="finish"||st==="crash"?[[.1,0],[-.1,0]]:air?[[1.0,-.4],[.2,-.9]]:duck?[[1.35,-.6],[.95,-1.0]]:[run(1),run(0)];
  L.forEach((l,i)=>{P.legs[i].th.rotation.x=l[0];P.legs[i].kn.rotation.x=l[1]-l[0]});
  const hip=air?1.0:Math.max(...L.map(l=>.48*Math.cos(l[0])+.48*Math.cos(l[1])))+.06;
  P.hips.position.y=hip;P.torso.rotation.x=st==="finish"?0:duck?-1.05:air?-.15:st==="crash"?.2:-.24;
  const sw=Math.sin(ph)*.9;
  P.arms.forEach((a,i)=>{const sd=i?1:-1;a.sh.rotation.z=0;
    if(st==="finish"){a.sh.rotation.x=Math.PI-.25;a.sh.rotation.z=sd*.35;a.elb.rotation.x=.25}
    else if(st==="crash"){a.sh.rotation.x=Math.sin(g.crashT*18+i*2)*1.3;a.elb.rotation.x=.8}
    else if(duck){a.sh.rotation.x=.9;a.elb.rotation.x=1.3}
    else if(air){a.sh.rotation.x=-.7*sd;a.sh.rotation.z=sd*.4;a.elb.rotation.x=.9}
    else{a.sh.rotation.x=sd*sw;a.elb.rotation.x=.6}});
  P.body.rotation.x=st==="crash"?Math.min(1.25,g.crashT*4):0;
  P.stars.visible=st==="crash";if(st==="crash")P.stars.children.forEach((s,i)=>{const a=g.crashT*6+i*2.1;s.position.set(Math.cos(a)*.45,Math.sin(a*1.3)*.08,Math.sin(a)*.45)});
  P.shadow.scale.setScalar(Math.max(.3,.84-g.py*S*.25));
}

/* --- Hindren i 3D: samma namn och krockytor som OBS (w = längd längs banan, y0–y1 = höjd) --- */
const B3={
  boll:()=>{const g=new T.Group(),b=mesh(Sph(.275,20,14),MAT.ball||(MAT.ball=new T.MeshLambertMaterial({map:TEX.ball})),0,.275,0);b.name="spin";g.add(b,blob(.3));return g},
  pegg:()=>{const g=new T.Group();g.add(tee3(0),blob(.25));return g},
  peggpar:()=>{const g=new T.Group();g.add(tee3(-.55),tee3(.55),blob(.25),blob(.25));g.children[2].position.z=-.55;g.children[3].position.z=.55;return g},
  korg:()=>{const g=new T.Group(),p=new T.Group();p.name="sway";p.position.y=10;g.add(p);const gr=lam("#1f5e3a");
    p.add(mesh(Cyl(.012,.012,8.05,5),lam("#dfe6ee"),0,-4.02,0),mesh(Cyl(.64,.5,.6,14),gr,0,-8.35,0),mesh(Cyl(.66,.66,.05,14),lam("#174a2d"),0,-8.06,0));
    const h=mesh(gget("han",()=>new T.TorusGeometry(.5,.025,6,18,Math.PI)),lam("#e6eef7"),0,-8.05,0);p.add(h);
    for(let i=0;i<9;i++)p.add(mesh(Sph(.075,8,6),lam("#ffffff"),Math.cos(i*2.4)*.38*(i%3?1:.4),-7.98+(i%2)*.06,Math.sin(i*2.4)*.38*(i%3?1:.4)));g.add(blob(.55));return g},
  pinnar:()=>{const g=new T.Group(),a=mesh(Cyl(.025,.025,1.32,6),lam("#e8c33a"),-.06,.62,-.05),b=mesh(Cyl(.025,.025,1.3,6),lam("#e07a2e"),.06,.61,.08);a.rotation.set(.16,0,.12);b.rotation.set(-.14,0,-.1);g.add(a,b,blob(.2));return g},
  bag:()=>{const g=new T.Group(),w=gget("whl",()=>new T.TorusGeometry(.15,.05,6,14).rotateY(Math.PI/2));
    g.add(mesh(w,lam("#222222"),-.24,.17,.12),mesh(w,lam("#222222"),.24,.17,.12),mesh(Box(.52,.04,.06),lam("#3a4048"),0,.17,.12));
    const b=new T.Group();b.position.set(0,.22,0);b.rotation.x=-.18;g.add(b);
    b.add(mesh(Cyl(.18,.17,1.05,14),lam("#1c2b44"),0,.55,0),mesh(Cyl(.185,.185,.06,14),lam("#e6eef7"),0,.82,0),mesh(Cyl(.185,.185,.05,14),lam("#e0bb4a"),0,.2,0));
    [[-.07,1.24,.02],[.07,1.2,-.05],[0,1.28,.08]].forEach(p=>{b.add(mesh(Cyl(.012,.012,.28,5),lam("#cfd8e2"),p[0],p[1]-.1,p[2]),mesh(Box(.06,.06,.11),lam("#c9a14a"),p[0],p[1]+.04,p[2]-.03))});g.add(blob(.4));return g},
  flygboll:()=>{const g=new T.Group(),t=mesh(Cyl(.15,.01,1.6,8),bas("#ffffff",{transparent:true,opacity:.45,depthWrite:false}),0,1.75,-.85);t.rotation.x=-Math.PI/2;g.add(mesh(Sph(.17,14,10),MAT.ball,0,1.75,0),t,blob(.15));return g},
  ruff:()=>{const g=new T.Group(),r=rng(7);for(let i=0;i<22;i++){const c=mesh(Cone(.08,.55+r()*.3,4),lam(i%2?"#2f5a2c":"#3b6b35"),(r()-.5)*2.6,.33,(r()-.5)*1.6);c.rotation.set((r()-.5)*.5,0,(r()-.5)*.5);g.add(c)}return g},
  bunker:()=>{const g=new T.Group(),a=mesh(Disc(),lam("#c9b27c"),0,.012,0),b=mesh(Disc(),lam("#e6d3a3"),0,.018,0);a.scale.set(1.45,1,1.55);b.scale.set(1.3,1,1.4);g.add(a,b);
    for(let i=-3;i<=3;i++){const l=mesh(Box(1.9-Math.abs(i)*.2,.004,.03),lam("#d6c08c"),0,.022,i*.32);g.add(l)}return g},
  vatten:()=>{const g=new T.Group(),a=mesh(Disc(),lam("#2f5f8f"),0,.012,0),b=mesh(Disc(),new T.MeshLambertMaterial({color:"#4f86b8",emissive:"#1b3a5c"}),0,.018,0);a.scale.set(1.5,1,1.8);b.scale.set(1.36,1,1.65);g.add(a,b);
    for(let i=0;i<2;i++){const r=mesh(gget("rip",()=>new T.RingGeometry(.92,1,32).rotateX(-Math.PI/2)),bas("#ffffff",{transparent:true,opacity:.5,depthWrite:false}),0,.024,0);r.name="rip";r.userData.ph=i*.5;g.add(r)}return g},
  kratta:()=>{const g=new T.Group(),h=mesh(Cyl(.025,.025,2.1,6),lam("#c9b27c"),0,.2,.1);h.rotation.x=Math.PI/2-.18;g.add(h);
    const hd=mesh(Box(.55,.06,.06),lam("#e6eef7"),0,.36,-.9);g.add(hd);for(let i=0;i<7;i++)g.add(mesh(Box(.025,.12,.025),lam("#e6eef7"),-.24+i*.08,.27,-.9));g.add(blob(.35));return g},
  mas:()=>{const g=new T.Group(),b=new T.Group();b.position.y=1.78;g.add(b);const w=lam("#f4f6f8");
    const bd=mesh(Sph(.28,12,8),w);bd.scale.set(.55,.5,1);b.add(bd,mesh(Sph(.12,10,8),w,0,.08,.26));const bk=mesh(Cone(.04,.16,5),lam("#e0bb4a"),0,.06,.42);bk.rotation.x=Math.PI/2;b.add(bk,mesh(Sph(.02,5,4),lam("#26323d"),-.08,.12,.32),mesh(Sph(.02,5,4),lam("#26323d"),.08,.12,.32));
    [-1,1].forEach(sd=>{const p=new T.Group();p.name="wing";p.userData.sd=sd;p.position.x=sd*.1;b.add(p);const wg=mesh(Box(.7,.03,.3),w,sd*.36,0,0);p.add(wg,mesh(Box(.18,.031,.3),lam("#9aa6b2"),sd*.65,0,0))});g.add(blob(.3));return g},
  vindby:()=>{const g=new T.Group();for(let i=0;i<5;i++){const r=mesh(gget("gst",()=>new T.TorusGeometry(.62,.035,6,26,Math.PI*1.25)),bas("#e6eef7",{transparent:true,opacity:.6,depthWrite:false}),0,1.5+i*.55,0);r.rotation.y=Math.PI/2;r.name="gust";r.userData.i=i;g.add(r)}return g}
};
function tee3(z){const g=new T.Group();g.position.z=z;const gd=lam("#e0bb4a");g.add(mesh(Cyl(.05,.03,.72,8),gd,0,.36,0),mesh(Cyl(.11,.05,.09,10),gd,0,.76,0),mesh(Sph(.2,16,12),MAT.ball,0,.98,0));return g}

/* --- Omgivningen: rangen i rutor om 80 m som återanvänds, startområdet vid Golfcentret, havet och ön långt bort --- */
function birch3(x,z,s){const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);
  g.add(mesh(Cyl(.12,.16,5.2,7),MAT.birch||(MAT.birch=new T.MeshLambertMaterial({map:TEX.birch})),0,2.6,0));
  const br=lam("#5c504a");[[-.7,1.8],[.6,1.7],[-.3,2.2],[.3,2],[-1,1.2],[1.05,1.3],[0,2.4]].forEach(([a,l],i)=>{const b=mesh(Cyl(.02,.05,l,5),br,Math.sin(a)*l*.5,4.4+Math.cos(a)*l*.45-(i%3)*.4,(i%2-.5)*.4);b.rotation.z=-a;g.add(b)});
  g.add(mesh(Sph(1.5,8,6),lam("#7a6a66",{transparent:true,opacity:.22,depthWrite:false}),0,5.2,0));return g}
function mast3(x,z){const g=new T.Group();g.position.set(x,0,z);g.add(mesh(Cyl(.08,.12,11,7),lam("#7d868e"),0,5.5,0),mesh(Box(1,.35,.4),lam("#5d666e"),0,11.1,0),mesh(Box(.85,.06,.3),bas("#fffae0"),0,10.9,-.05));return g}
function flagGreen(x,z,r,c){const g=new T.Group();g.position.set(x,0,z);const d=mesh(Disc(),lam("#4c8d3e"),0,.02,0);d.scale.set(r,1,r*.7);g.add(d,mesh(Cyl(.03,.03,2.4,5),lam("#e6eef7"),0,1.2,0));const f=mesh(Box(.02,.4,.6),lam(c),0,2.2,-.3);g.add(f);return g}
function buildTile(i,lv){
  const g=new T.Group(),r=rng(i*31+lv*7+3);
  for(let n=0;n<6;n++){const sd=n%2?1:-1;g.add(birch3(sd*(7+r()*20),-r()*TL,.8+r()*.5))}
  g.add(mast3(12,-30-r()*20));
  // bollnätet till vänster
  for(let z=0;z<TL;z+=10)g.add(mesh(Cyl(.06,.06,9,5),lam("#3a4046"),-18,4.5,-z));
  g.add(mesh(gget("net",()=>new T.PlaneGeometry(TL,9).rotateY(Math.PI/2)),bas("#2a3036",{transparent:true,opacity:.07,side:T.DoubleSide,depthWrite:false}),-18,4.5,-TL/2));
  // slagbås till höger: gröna mattor och svarta spaljéer, nedtonade så att de aldrig ser ut som hinder
  for(let n=0;n<3;n++){const z=-10-n*25-r()*8;g.add(mesh(Box(1.5,.03,1.3),lam("#2e8b4a"),5.2,.02,z),mesh(Box(.08,1.1,1.6),lam("#1b1e20"),6.2,.55,z))}
  if(lv===1){
    for(let n=0;n<3;n++){const sd=r()<.5?-1:1;g.add(flagGreen(sd*(9+r()*16),-r()*TL,2+r()*2,n%2?"#c4473c":"#e8c33a"))}
    const sign=new T.Group();sign.position.set(-3.1,0,-40);sign.add(mesh(Cyl(.03,.03,1.4,5),lam("#e6eef7"),0,.7,0));
    const num=String(50+(i%6)*25);sign.add(sprite(ctex(128,64,(c,w,h)=>{rrp(c,4,4,w-8,h-8,10);c.fillStyle="#e6eef7";c.fill();c.fillStyle="#132a45";c.font="900 38px "+F3;c.textAlign="center";c.textBaseline="middle";c.fillText(num,w/2,h/2+2)}),.9,.45));sign.children[1].position.y=1.55;g.add(sign);
    const bm=new T.InstancedMesh(Sph(.06,6,4),lam("#ffffff"),150),m=new T.Matrix4();
    for(let n=0;n<150;n++){let x=(r()-.5)*56;if(Math.abs(x)<2.4)x+=x<0?-2.4:2.4;m.makeTranslation(x,.06,-r()*TL);bm.setMatrixAt(n,m)}g.add(bm)}
  return g;
}
function buildStart(){
  const g=new T.Group();
  // Ringenäs Golfcenter i svartbetsat trä till vänster vid start
  const gc=new T.Group();gc.position.set(-13,0,-24);g.add(gc);
  gc.add(mesh(Box(7,4.2,20),lam("#22272b"),0,2.1,0));const rf=mesh(gget("roof",()=>new T.CylinderGeometry(.01,4.6,1.4,4,1).rotateY(Math.PI/4)),lam("#3b4045"),0,4.9,0);rf.scale.set(1,1,3.1);gc.add(rf);
  for(const z of[-7,-2,3,7.5])gc.add(mesh(Box(.05,2,1.1),lam("#f2f4f6"),3.52,1.6,z));
  const sg=mesh(gget("gcs",()=>new T.PlaneGeometry(8,1).rotateY(Math.PI/2)),new T.MeshBasicMaterial({map:TEX.gc}),3.53,3.55,0);gc.add(sg);
  // puttinggreen med blå flaggor och flaggstången med svenska flaggan
  const pg=mesh(Disc(),lam("#62a050"),6.5,.02,-16);pg.scale.set(4,1,6);g.add(pg);
  for(const z of[-12,-15,-18,-20])g.add(mesh(Cyl(.02,.02,1,5),lam("#e6eef7"),6+(z%3),.5,z),mesh(Box(.02,.18,.28),lam("#2f7fd0"),6+(z%3),.92,z-.14));
  g.add(mesh(Cyl(.06,.08,10,8),lam("#f2f4f6"),8.5,5,-30));const fl=mesh(gget("flag",()=>new T.PlaneGeometry(2.2,1.4)),new T.MeshLambertMaterial({map:TEX.flag,side:T.DoubleSide}),8.5,9.2,-31.1);fl.rotation.y=Math.PI/2;fl.name="flag";g.add(fl);
  // utslagsmattan där golfaren startar
  g.add(mesh(Box(2.6,.04,3),lam("#2e8b4a"),0,.02,1.2));
  return g;
}
function init3D(canvas){
  textures();
  const rd=new T.WebGLRenderer({canvas,antialias:(devicePixelRatio||1)<2.5,powerPreference:"high-performance",stencil:false});
  const scene=new T.Scene();scene.fog=new T.Fog("#bcc6cf",34,200);
  const cam=new T.PerspectiveCamera(60,1,.1,1200);
  scene.add(new T.HemisphereLight("#eef3f8","#4a6b3c",2.1));const sun=new T.DirectionalLight("#fff6e6",1.5);sun.position.set(-6,12,8);scene.add(sun);
  // himlen: mörkare upptill där HUD:en ligger, ljus mot horisonten
  const sg=new T.SphereGeometry(500,24,16),p=sg.attributes.position,col=[],c=new T.Color(),A=new T.Color("#c9d1d8"),B=new T.Color("#8e9aa6"),C=new T.Color("#3c4856");
  for(let i=0;i<p.count;i++){const y=p.getY(i)/500;if(y<.03)c.copy(A);else if(y<.25)c.copy(A).lerp(B,(y-.03)/.22);else c.copy(B).lerp(C,Math.min(1,(y-.25)/.4));col.push(c.r,c.g,c.b)}
  sg.setAttribute("color",new T.Float32BufferAttribute(col,3));const sky=new T.Mesh(sg,new T.MeshBasicMaterial({vertexColors:true,side:T.BackSide,fog:false,depthWrite:false}));sky.renderOrder=-10;scene.add(sky);
  const back=new T.Group();scene.add(back);
  const sea=mesh(gget("sea",()=>new T.PlaneGeometry(1800,60)),new T.MeshBasicMaterial({map:TEX.sea,transparent:true,fog:false,depthWrite:false}),0,15,-420);sea.renderOrder=-9;back.add(sea);
  const beam=sprite(TEX.beam,40,10,{fog:false,depthWrite:false});beam.position.set((1360/2048-.5)*1800+20,15+(.5-38/160)*60,-418);beam.renderOrder=-8;back.add(beam);
  const trees=mesh(gget("trees",()=>new T.PlaneGeometry(900,14)),new T.MeshBasicMaterial({map:TEX.trees,transparent:true,alphaTest:.5,fog:false}),0,.6,-205);back.add(trees);
  const clouds=[];for(let i=0;i<7;i++){const s=sprite(TEX.cloud,60+i*9,24+i*3,{fog:false,depthWrite:false,opacity:.75});s.position.set(-220+i*75,45+(i*37%30),-300-(i*53%80));s.renderOrder=-9;back.add(s);clouds.push(s)}
  const ground=mesh(gget("gr",()=>new T.PlaneGeometry(260,280).rotateX(-Math.PI/2)),new T.MeshLambertMaterial({map:TEX.ground}),0,0,0);TEX.ground.repeat.set(1,70);scene.add(ground);
  const lane=mesh(gget("ln",()=>new T.PlaneGeometry(3.4,280).rotateX(-Math.PI/2)),new T.MeshLambertMaterial({map:TEX.lane}),0,.006,0);TEX.lane.repeat.set(1,70);scene.add(lane);
  const start=buildStart();scene.add(start);
  const obsG=new T.Group();scene.add(obsG);
  const pg=new T.BufferGeometry();pg.setAttribute("position",new T.Float32BufferAttribute(new Float32Array(600),3));pg.setAttribute("color",new T.Float32BufferAttribute(new Float32Array(600),3));
  const pts=new T.Points(pg,new T.PointsMaterial({size:.16,vertexColors:true,transparent:true,depthWrite:false}));pts.frustumCulled=false;scene.add(pts);
  const fin=new T.Group();fin.visible=false;scene.add(fin);const gold=lam("#e0bb4a");
  fin.add(mesh(Cyl(.09,.09,6.4,8),gold,-2.6,3.2,0),mesh(Cyl(.09,.09,6.4,8),gold,2.6,3.2,0),mesh(Box(5.4,.8,.1),lam("#132a45"),0,6.2,0),mesh(Box(5.5,.05,.05),gold,0,5.78,.06));
  const ms=sprite(TEX.mal,2.4,.83,{depthWrite:false});ms.position.set(0,6.2,.2);fin.add(ms);const fl=mesh(Disc(),bas("#e0bb4a",{transparent:true,opacity:.4,depthWrite:false}),0,.03,0);fl.scale.set(1.7,1,.25);fin.add(fl);
  R={rd,scene,cam,sky,back,beam,clouds,ground,lane,start,obsG,pts,fin,tiles:[],tilesLv:0,P:null,pr:Math.min(2,devicePixelRatio||1),fr:0,ft:0,gRef:null,finZ:null};
  rd.setPixelRatio(R.pr);
}
function dispose3D(){if(!R)return;try{R.rd.dispose();R.rd.forceContextLoss()}catch(e){}R=null}
function draw3(dt){
  const g=G,r=R;if(!r||!g)return;
  if(r.gRef!==g){r.gRef=g;r.obsG.clear();r.finZ=null;r.fin.visible=false}
  if(!r.P||r.P.lv!==g.lv){if(r.P){r.scene.remove(r.P.root,r.P.shadow)}r.P=buildGolfer(g.lv);r.scene.add(r.P.root,r.P.shadow)}
  if(r.tilesLv!==g.lv){r.tiles.forEach(t=>r.scene.remove(t));r.tiles=[0,1,2,3].map(i=>buildTile(i,g.lv));r.tiles.forEach(t=>r.scene.add(t));r.tilesLv=g.lv}
  const gz=-g.dist*S,now=performance.now()/1000;
  // rutor med rangen runt golfaren
  const k0=Math.floor(g.dist*S/TL);for(let k=k0-1;k<=k0+2;k++){const t=r.tiles[((k%4)+4)%4];t.position.z=-k*TL}
  const sn=Math.round(gz/4)*4-100;r.ground.position.z=sn;r.lane.position.z=sn;
  r.start.visible=g.dist*S<90;
  // golfaren
  poseGolfer(r.P,g);r.P.root.position.set(0,g.py*S,gz);r.P.shadow.position.set(0,.016,gz);
  // hinder
  const seen=new Set();
  for(const o of g.obs){let m=o.m;if(!m||m.parent!==r.obsG){m=o.m=B3[o.k]();m.userData.o=o;if(o.lbl){const s=sprite(o.lbl==="ducka"?TEX.ducka:TEX.hoppa,1.5,.52,{depthTest:false});s.position.y=o.lbl==="ducka"?3.15:1.95;s.renderOrder=20;s.name="lbl";m.add(s)}r.obsG.add(m)}
    seen.add(m);const z=gz-(o.x-PX)*S;m.position.z=z;const gr=Math.min(1,o.age*4);m.scale.setScalar(.3+.7*gr);
    const lb=m.getObjectByName("lbl");if(lb){lb.visible=o.x>PX+14;lb.position.y=(o.lbl==="ducka"?3.15:1.95)+Math.sin(now*5)*.06}
    if(o.k==="boll")m.getObjectByName("spin").rotation.x=-o.rot*.55;
    else if(o.k==="korg")m.getObjectByName("sway").rotation.z=Math.sin(o.age*3)*.012;
    else if(o.k==="mas")m.traverse(c=>{if(c.name==="wing")c.rotation.z=c.userData.sd*Math.sin(o.age*14)*.6});
    else if(o.k==="vindby")m.traverse(c=>{if(c.name==="gust"){c.rotation.x=o.age*3+c.userData.i;c.position.x=Math.sin(o.age*6+c.userData.i)*.2}});
    else if(o.k==="vatten")m.traverse(c=>{if(c.name==="rip"){const t=(o.age*.6+c.userData.ph)%1;c.scale.set(.3+t*1.1,1,.3+t*1.4);c.material.opacity=.5*(1-t)}})}
  for(let i=r.obsG.children.length-1;i>=0;i--){const m=r.obsG.children[i];if(!seen.has(m))r.obsG.remove(m)}
  // mållinjen
  if(g.t>g.L.d-2.6&&r.finZ==null)r.finZ=gz-(g.L.d-g.t)*g.v*S;
  if(r.finZ!=null){r.fin.visible=true;r.fin.position.z=r.finZ}
  // damm och konfetti
  const pa=r.pts.geometry.attributes.position,ca=r.pts.geometry.attributes.color,n=Math.min(200,g.parts.length),cc=new T.Color();
  for(let i=0;i<200;i++){if(i<n){const q=g.parts[i];if(q.lx==null)q.lx=(Math.random()-.5)*(q.y<-100?7:1.6);pa.setXYZ(i,q.lx,-q.y*S,gz-(q.x-PX)*S);cc.set(q.c);ca.setXYZ(i,cc.r,cc.g,cc.b)}else pa.setXYZ(i,0,-50,0)}
  pa.needsUpdate=true;ca.needsUpdate=true;
  // kameran snett bakifrån – i stående mobil högre upp så att man ser hindren i god tid
  const por=H>=W,c=r.cam,sh=g.state==="crash"&&g.crashT<.3?(Math.random()-.5)*.12:0;
  c.position.set((por?1.7:2.1)+sh,(por?4.3:3.2)+g.py*S*.3+sh,gz+(por?10.5:8.2));c.lookAt(.2,(por?.7:1.0)+g.py*S*.15,gz-(por?12:15));
  r.sky.position.copy(c.position);r.back.position.set(0,0,gz);
  r.beam.material.opacity=((now%6)<2.2)?.85*(1-Math.abs((now%6)-1.1)/1.1):0;
  r.clouds.forEach((s,i)=>{s.position.x=((-220+i*75-g.dist*S*.03)%600+900)%600-300});
  const fg=r.start.getObjectByName("flag");if(fg&&r.start.visible)fg.rotation.y=Math.PI/2+Math.sin(now*2.2)*.12;
  r.rd.render(r.scene,c);
  // sänk upplösningen lite om telefonen inte hinner med
  if(dt){r.fr++;r.ft+=dt;if(r.fr>=90){const avg=r.ft/r.fr;r.fr=0;r.ft=0;if(avg>1/42&&r.pr>1){r.pr=Math.max(1,r.pr-.35);r.rd.setPixelRatio(r.pr);r.rd.setSize(W,H,false)}}}
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
  ov.append(h,hud.msg,hud.hint);
}
function setTxt(k,node,v){if(hud.c[k]!==v){hud.c[k]=v;node.textContent=v}}
function updHud(){
  const g=G;if(!hud||!g)return;
  setTxt("n",hud.name,(nick||"Spelare").toUpperCase());setTxt("h",hud.hcp,"HCP "+hcpTxt(g.hcp));setTxt("b",hud.best,resTxt(best));
  setTxt("l",hud.lvl,"Nivå "+g.lv+" · "+g.L.name);setTxt("p",hud.pct,g.prog+" %");
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
  const tabs=el("div","chips ctabs rgj-tabs");[["play","Spela"],["board","Topplista"],["rules","Regler"]].forEach(([k,t])=>{const b=el("button","chip"+(tab===k?" on":""),t);b.type="button";b.onclick=()=>{tab=k;if(k==="board")boardFor="";render()};tabs.append(b)});root.append(tabs);
  if(tab==="play")renderPlay(root);else if(tab==="board")renderBoard(root);else renderRules(root);
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
function renderRules(root){
  const c=el("div","card");c.append(el("h2",null,"Så spelar du"));
  ["Golfaren springer av sig själv. Tryck på ↑-knappen nere till höger för att hoppa (eller tryck var som helst på skärmen).","Håll in ↓-knappen för att ducka – släpp när faran passerat. Trycker du ↓ mitt i ett hopp landar du snabbare.","Krockar du är rundan slut. Ju längre du kommer, desto bättre handicap.","På Driving Range står du kvar på HCP 99 – klarar du hela banan får du Grönt kort och HCP 54.","Därefter sjunker handicapet ett slag i taget, ända till +8.","Klarar du en bana låses nästa upp. Du kan alltid spela en lägre bana igen."].forEach((t,i)=>{const p=el("p");p.append(el("b",null,(i+1)+". "),t);c.append(p)});
  root.append(c);
  const l=el("div","card");l.append(el("h2",null,"Banorna"));LEVELS.forEach(L=>{const d=el("div","rl");d.append(el("b",null,L.n+". "+L.name+": "),"HCP "+hcpTxt(L.s)+" → "+hcpTxt(L.e)+" · Belöning: "+L.reward+(L.open?"":" (kommer snart)"));l.append(d)});
  l.append(el("p","msg","Använd smeknamn eller förnamn – topplistan är publik. Ingen e-post eller annan personinfo sparas."));root.append(l);
}

// state() läser rundan utan att ändra den (används vid test av banorna)
window.RGJ={show(){if(tab==="board")boardFor="";render();load3D().catch(()=>{})},hide(){if(ov)closeOverlay()},levels:LEVELS,obstacles:OBS,state:()=>G&&{mode:mode3d?"3d":"2d",t:G.t,state:G.state,py:G.py,v:G.v,lv:G.lv,hcp:G.hcp,prog:G.prog,px:PX,obs:G.obs.map(o=>({k:o.k,x:o.x}))}};
})();
