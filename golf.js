/* Ringenäs Golf Journey – spelet under Spela.
   Spelplanen ritas i en egen <canvas> med egen loop och fast tidssteg; appens vyer rörs bara för menyer och topplista.
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
function crash(){const g=G;g.state="crash";g.crashT=0;snd("crash");if(navigator.vibrate)try{navigator.vibrate(60)}catch(e){}
  for(let i=0;i<14;i++)g.parts.push({x:PX,y:-20-g.py,vx:(Math.random()-.5)*160,vy:-60-Math.random()*120,gr:300,life:.7,c:"#e6eef7"});
  setTimeout(()=>endRun(false),900)}
function onFinish(){const g=G;snd("cheer");g.hcp=g.L.e;g.prog=100;g.blink=1.2;
  if(!reduced())for(let i=0;i<70;i++)g.parts.push({x:Math.random()*LW,y:-GY-10,vx:(Math.random()-.5)*60,vy:40+Math.random()*90,gr:40,life:2.6,c:["#e0bb4a","#6db3f5","#fff","#2f7fd0"][i%4]});
  setTimeout(()=>endRun(true),1500)}

function draw(){
  if(!ctx||!G)return;const c=ctx,g=G;
  c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,W,H);
  c.setTransform(dpr*sc,0,0,dpr*sc,0,dpr*oy);bg(c,g);
  c.save();c.translate(0,GY);
  // mållinjen
  if(g.t>g.L.d-2.5){const fx=PX+(g.L.d-g.t)*g.v+(g.state==="finish"?-g.endT*g.v*.3:0)+18;c.fillStyle="#e6eef7";c.fillRect(fx,-70,2,70);c.fillStyle="#e0bb4a";c.beginPath();c.moveTo(fx+2,-70);c.lineTo(fx+26,-63);c.lineTo(fx+2,-56);c.fill();c.fillStyle="rgba(224,187,74,.35)";c.fillRect(fx-2,-1,6,3)}
  for(const o of g.obs){c.save();c.translate(o.x,0);OBS[o.k].draw(c,o);
    // första gången ett hinder dyker upp: skylt HOPPA (guld) eller DUCKA (blå)
    if(o.lbl&&o.x>PX+14){const dk=o.lbl==="ducka",y=dk?-70:-46;c.fillStyle=dk?"#2f7fd0":"#e0bb4a";rr(c,-17,y-6,34,11,5.5);c.fillStyle=dk?"#fff":"#1a1405";c.font="800 6.5px Montserrat,system-ui,sans-serif";c.textAlign="center";c.fillText(dk?"DUCKA":"HOPPA",0,y+2.2);
      c.beginPath();c.moveTo(-3,y+5);c.lineTo(3,y+5);c.lineTo(0,y+8.5);c.fill()}
    c.restore()}
  // svag ljus kontur så att golfaren syns mot mörka partier i bakgrunden
  shadow(c,PX,Math.max(3,8-g.py/16));c.shadowColor="rgba(255,255,255,.6)";c.shadowBlur=3*sc*dpr;golfer(c,g,g.lv);c.shadowBlur=0;
  for(const q of g.parts){c.globalAlpha=Math.min(1,q.life*2);c.fillStyle=q.c;c.fillRect(q.x,q.y,2.4,2.4)}c.globalAlpha=1;
  c.restore();
  hud(c,g);
}
function hud(c,g){
  c.setTransform(dpr,0,0,dpr,0,0);const top=safeTop+80,x0=16,x1=W-16,F="Montserrat,Inter,system-ui,sans-serif";
  const gr=c.createLinearGradient(0,0,0,top+70);gr.addColorStop(0,"rgba(5,13,24,.75)");gr.addColorStop(1,"rgba(5,13,24,0)");c.fillStyle=gr;c.fillRect(0,0,W,top+70);
  c.textBaseline="alphabetic";c.textAlign="left";c.fillStyle="#d8c8a4";c.font="600 11px "+F;c.fillText((nick||"Spelare").toUpperCase(),x0,top);
  c.fillStyle=g.blink>0&&Math.floor(g.blink*10)%2===0?"#e0bb4a":"#ffffff";c.font="800 26px "+F;c.fillText("HCP "+hcpTxt(g.hcp),x0,top+28);
  c.textAlign="right";c.fillStyle="#b8c6d3";c.font="600 11px "+F;c.fillText("REKORD",x1,top);c.fillStyle="#ffffff";c.font="800 18px "+F;c.fillText(resTxt(best),x1,top+24);
  const by=top+42,bw=x1-x0;c.fillStyle="rgba(255,255,255,.16)";rr(c,x0,by,bw,6,3);c.fillStyle="#e0bb4a";rr(c,x0,by,Math.max(6,bw*g.prog/100),6,3);
  c.textAlign="left";c.fillStyle="#b8c6d3";c.font="600 11px "+F;c.fillText("Nivå "+g.lv+" · "+g.L.name,x0,by+20);c.textAlign="right";c.fillText(g.prog+" %",x1,by+20);
  if(g.t<2.2&&g.state==="run"){c.globalAlpha=Math.min(1,(2.2-g.t)*1.5);c.textAlign="center";c.fillStyle="#fff";c.font="700 15px "+F;c.fillText("Tryck = hoppa · Svep nedåt = ducka",W/2,oy+GY*sc*.42);c.globalAlpha=1}
  if(g.msg){c.globalAlpha=Math.min(1,g.msg.left*2.5);c.textAlign="center";c.fillStyle="#e0bb4a";c.font="900 24px "+F;c.shadowColor="rgba(0,0,0,.45)";c.shadowBlur=8;c.fillText(g.msg.t,W/2,oy+GY*sc*.42);c.shadowBlur=0;c.globalAlpha=1}
}
function rr(c,x,y,w,h,r){c.beginPath();c.roundRect?c.roundRect(x,y,w,h,r):c.rect(x,y,w,h);c.fill()}

function frame(now){
  raf=requestAnimationFrame(frame);
  let e=(now-last)/1000;last=now;if(e>.1)e=.1;
  if(G&&!paused){acc+=e;let n=0;while(acc>=DT&&n<12){step();acc-=DT;n++}if(n===12)acc=0}
  draw();
}
function size(){
  W=innerWidth;H=innerHeight;dpr=Math.min(2,devicePixelRatio||1);cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);cv.style.width=W+"px";cv.style.height=H+"px";
  // golfaren lite till vänster så att man ser hindren i god tid även på en stående mobil
  sc=Math.min(H/LH,W/360);LW=W/sc;PX=Math.min(96,LW*.19);
  const probe=el("div");probe.style.cssText="position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden";document.body.append(probe);safeTop=probe.offsetHeight||0;probe.remove();
  // Stående mobil: spelplanen läggs med marken på ca 2/3 av höjden och golfarens hopp under HUD:en
  oy=Math.max(0,Math.min(H-LH*sc,Math.max(H*.68-GY*sc,safeTop+150-55*sc)));
  // Mulen himmel: mörkare upptill där HUD:en ligger, ljus vid horisonten
  const st=-oy/sc,hz=GY-70;skyG=ctx.createLinearGradient(0,st,0,hz);skyG.addColorStop(0,"#3c4856");skyG.addColorStop(.55,"#8e9aa6");skyG.addColorStop(1,"#c6ced5");
  clouds=[];for(let i=0;i<6;i++){const r=n=>Math.abs(Math.sin(i*12.9898+n*78.233)*43758.5453)%1;clouds.push({x:i*(LW+260)/6,y:st+(hz-st)*(.25+r(1)*.5),b:[0,1,2,3].map(j=>[j*14-20+r(j+2)*8,r(j+6)*5-2,10+r(j+9)*12])})}
}

/* === Styrning: tryck = hopp, svep nedåt (och håll) = ducka. Ingen zoom, scroll eller dra-för-att-uppdatera. === */
let py0=0,pid=null,swiped=false;
function jump(){const g=G;if(!g||g.state!=="run"||paused)return;g.buf=.12;g.held=false}
function duck(on){const g=G;if(!g||g.state!=="run"||paused)return;if(on){if(!g.held&&g.duck<=0)snd("duck");g.held=true;g.duck=Math.max(g.duck,.45);g.buf=0}else g.held=false}
function onDown(e){if(e.target.closest("button,.rgj-sheet"))return;e.preventDefault();audioOn();pid=e.pointerId;py0=e.clientY;swiped=false;jump()}
function onMove(e){if(e.pointerId!==pid)return;e.preventDefault();if(!swiped&&e.clientY-py0>22){swiped=true;const g=G;if(g&&g.buf>0)g.buf=0;if(g&&g.py>0&&g.vy>0)g.vy=0;duck(true)}}
function onUp(e){if(e.pointerId!==pid)return;pid=null;if(swiped)duck(false)}
function onKey(e){if(!ov||sheet&&e.key!=="Escape")return;const k=e.key;if(k===" "||k==="ArrowUp"||k==="w"){e.preventDefault();if(!e.repeat){audioOn();jump()}}else if(k==="ArrowDown"||k==="s"){e.preventDefault();duck(true)}else if(k==="Escape"||k==="p"){pause(true)}}
function onKeyUp(e){if(e.key==="ArrowDown"||e.key==="s")duck(false)}
// Knappar och resultatrutan undantas, annars uteblir klicken på iPhone
const stopTouch=e=>{if(ov&&!(e.target.closest&&e.target.closest(".rgj-sheet,button")))e.preventDefault()};

/* === Overlay: helskärm under spel === */
let paused=false,sheet=null,scrollBack=0;
function openOverlay(){
  if(ov)return;scrollBack=scrollY;scrollTo(0,0);ov=el("div","rgj-ov");ov.setAttribute("role","application");ov.setAttribute("aria-label","Ringenäs Golf Journey");
  cv=el("canvas","rgj-cv");ctx=cv.getContext("2d");ov.append(cv);
  const sb=el("button","rgj-btn rgj-snd");sb.type="button";const setS=()=>{sb.textContent=soundOn?"🔊":"🔇";sb.setAttribute("aria-label",soundOn?"Stäng av ljud":"Slå på ljud")};setS();
  sb.onclick=()=>{soundOn=!soundOn;ls("rgj_sound",soundOn?"1":"0");audioOn();setS()};
  const pb=el("button","rgj-btn rgj-pau","❚❚");pb.type="button";pb.setAttribute("aria-label","Pausa");pb.onclick=()=>pause(true);
  ov.append(sb,pb);document.body.append(ov);document.documentElement.classList.add("rgj-lock");
  ov.addEventListener("pointerdown",onDown);ov.addEventListener("pointermove",onMove,{passive:false});ov.addEventListener("pointerup",onUp);ov.addEventListener("pointercancel",onUp);
  ov.addEventListener("touchmove",stopTouch,{passive:false});ov.addEventListener("touchstart",stopTouch,{passive:false});
  document.addEventListener("gesturestart",stopTouch,{passive:false});addEventListener("keydown",onKey);addEventListener("keyup",onKeyUp);addEventListener("resize",size);
  size();last=performance.now();acc=0;raf=requestAnimationFrame(frame);
}
function closeOverlay(){
  if(!ov)return;cancelAnimationFrame(raf);raf=0;removeEventListener("keydown",onKey);removeEventListener("keyup",onKeyUp);removeEventListener("resize",size);document.removeEventListener("gesturestart",stopTouch);
  ov.remove();ov=null;cv=null;ctx=null;G=null;paused=false;sheet=null;document.documentElement.classList.remove("rgj-lock");render();scrollTo(0,tab==="play"?scrollBack:0);
}
function showSheet(build){if(sheet)sheet.remove();sheet=el("div","rgj-sheet");const c=el("div","card rgj-card");build(c);sheet.append(c);ov.append(sheet);const b=c.querySelector("button.go");if(b)b.focus({preventScroll:true})}
function pause(on){
  if(!ov||!G||G.state!=="run")return;
  if(on&&!paused){paused=true;showSheet(c=>{c.append(el("h2",null,"Pausat"),el("p",null,"Rundan väntar på dig."));const g1=el("button","go","Fortsätt");g1.onclick=()=>pause(false);const g2=el("button","ghost","Avsluta rundan");g2.onclick=()=>{paused=false;closeOverlay()};c.append(g1,g2)})}
  else if(!on&&paused){paused=false;if(sheet){sheet.remove();sheet=null}last=performance.now();acc=0}
}
document.addEventListener("visibilitychange",()=>{if(document.hidden)pause(true)});

/* === Runda: start, slut, inskick === */
function startRun(lv){
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
  go.onclick=()=>{if(!nick){const inp=document.getElementById("rgjNick"),v=(inp&&inp.value||"").trim();if(!nickOk(v)){err.textContent=v?"Välj ett annat smeknamn (bokstäver och siffror, max 12 tecken).":"Skriv ett smeknamn först.";err.classList.remove("hide");if(inp)inp.focus();return}nick=v;ls("rgj_nick",v)}startRun(sel)};
  lc.append(go,err,el("p","msg","Tryck var som helst = hoppa · Svep nedåt = ducka"));root.append(lc);
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
  ["Golfaren springer av sig själv. Tryck var som helst för att hoppa.","Svep nedåt för att ducka – håll kvar fingret för att ducka längre.","Krockar du är rundan slut. Ju längre du kommer, desto bättre handicap.","På Driving Range står du kvar på HCP 99 – klarar du hela banan får du Grönt kort och HCP 54.","Därefter sjunker handicapet ett slag i taget, ända till +8.","Klarar du en bana låses nästa upp. Du kan alltid spela en lägre bana igen."].forEach((t,i)=>{const p=el("p");p.append(el("b",null,(i+1)+". "),t);c.append(p)});
  root.append(c);
  const l=el("div","card");l.append(el("h2",null,"Banorna"));LEVELS.forEach(L=>{const d=el("div","rl");d.append(el("b",null,L.n+". "+L.name+": "),"HCP "+hcpTxt(L.s)+" → "+hcpTxt(L.e)+" · Belöning: "+L.reward+(L.open?"":" (kommer snart)"));l.append(d)});
  l.append(el("p","msg","Använd smeknamn eller förnamn – topplistan är publik. Ingen e-post eller annan personinfo sparas."));root.append(l);
}

// state() läser rundan utan att ändra den (används vid test av banorna)
window.RGJ={show(){if(tab==="board")boardFor="";render()},hide(){if(ov)closeOverlay()},levels:LEVELS,obstacles:OBS,state:()=>G&&{t:G.t,state:G.state,py:G.py,v:G.v,lv:G.lv,hcp:G.hcp,prog:G.prog,px:PX,obs:G.obs.map(o=>({k:o.k,x:o.x}))}};
})();
