import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const PASSCODE = "071079";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

let pin = "";
let stream = null;
let landmarker = null;
let raf = null;
let lastTime = -1;
let latestLandmarks = null;
let savedAnalysis = null;
let stableFrames = 0;
let capturing = false;

let activeZone = "face";
let activeEffect = "brows";
let effectIntensity = .55;
let activeColor = "#8a5a52";
let activeMood = null;

const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d",{willReadFrequently:true});

const FACE_OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];

function buildPin(){
  const dots=$("#pinDots"); dots.innerHTML="";
  for(let i=0;i<6;i++){const d=document.createElement("span");d.className="pin-dot"+(i<pin.length?" on":"");dots.appendChild(d)}
  const pad=$("#keypad"); pad.innerHTML="";
  ["1","2","3","4","5","6","7","8","9","","0","del"].forEach(v=>{
    const b=document.createElement("button"); b.type="button"; b.className="key"+(v===""?" blank":""); b.disabled=v===""; b.textContent=v==="del"?"⌫":v;
    if(v!=="") b.addEventListener("click",()=>tapPin(v)); pad.appendChild(b);
  });
}
function tapPin(v){
  if(v==="del"){pin=pin.slice(0,-1);$("#pinError").textContent="";buildPin();return}
  if(pin.length>=6)return;
  pin+=v; buildPin();
  if(pin.length===6){
    setTimeout(()=>{
      if(pin===PASSCODE){
        $("#lockScreen").classList.add("hidden");
        $("#mainApp").classList.remove("hidden");
      }else{
        $("#pinError").textContent="Code incorrect";
        pin=""; buildPin();
      }
    },100);
  }
}
buildPin();

const videos=()=>[$("#analysisVideo"),$("#mirrorVideo"),$("#tryVideo"),$("#adviceVideo")].filter(Boolean);

async function initLandmarker(){
  if(landmarker)return;
  const vision=await FilesetResolver.forVisionTasks(WASM_URL);
  landmarker=await FaceLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},
    runningMode:"VIDEO",
    numFaces:1,
    minFaceDetectionConfidence:.62,
    minFacePresenceConfidence:.62,
    minTrackingConfidence:.62,
    outputFaceBlendshapes:false,
    outputFacialTransformationMatrixes:false
  });
}

async function startCamera(){
  if(!stream){
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"user"},width:{ideal:720},height:{ideal:960}},
      audio:false
    });
  }
  for(const v of videos()){v.srcObject=stream; await v.play().catch(()=>{})}
  await initLandmarker();
}

$("#beginAnalysisButton").addEventListener("click",async()=>{
  $("#analysisIntro").classList.add("hidden");
  $("#analysisProgress").classList.remove("hidden");
  $("#analysisProgressTitle").textContent="Ouverture de la caméra…";
  try{
    await startCamera();
    stableFrames=0; savedAnalysis=null; capturing=false;
    $("#analysisProgressTitle").textContent="Détection du visage";
    $("#analysisProgressText").textContent="Regarde droit devant toi et reste immobile quelques secondes.";
    analyzeLoop();
  }catch(e){
    console.error(e);
    $("#analysisProgressTitle").textContent="Caméra indisponible";
    $("#analysisProgressText").textContent="Autorise l’accès à la caméra dans Safari puis relance l’analyse.";
  }
});

$("#cameraButton").addEventListener("click",()=>{
  $("#appHeader").classList.add("hidden");
  $("#bottomNav").classList.add("hidden");
  $$(".tab-view").forEach(v=>v.classList.remove("active"));
  $("#analysisProgress").classList.remove("hidden");
  stableFrames=0; savedAnalysis=null; capturing=false;
  $("#analysisProgressTitle").textContent="Nouvelle analyse";
  $("#analysisProgressText").textContent="Regarde droit devant toi.";
});

function analyzeLoop(){
  if(!stream||!landmarker){raf=requestAnimationFrame(analyzeLoop);return}
  const v=$("#analysisVideo");
  if(v.readyState>=2&&v.currentTime!==lastTime){
    lastTime=v.currentTime;
    const res=landmarker.detectForVideo(v,performance.now());
    if(res.faceLandmarks?.length){
      latestLandmarks=res.faceLandmarks[0];
      drawGuide($("#analysisCanvas"),v,latestLandmarks);
      stableFrames++;
      $("#analysisGuide").textContent=stableFrames<12?"Reste bien face caméra":"Ne bouge plus";
      $("#analysisProgressTitle").textContent=stableFrames<12?"Visage détecté":"Analyse du visage…";
      if(stableFrames>=16&&!capturing) captureWithFlash();
    }else{
      latestLandmarks=null; stableFrames=0;
      clearCanvas($("#analysisCanvas"));
      $("#analysisGuide").textContent="Place ton visage face caméra";
      $("#analysisProgressTitle").textContent="Détection du visage";
    }
  }
  if(!savedAnalysis) raf=requestAnimationFrame(analyzeLoop);
}

async function captureWithFlash(){
  if(capturing||!latestLandmarks)return;
  capturing=true;
  $("#analysisProgressTitle").textContent="Capture des couleurs";
  $("#analysisProgressText").textContent="Ne bouge pas.";

  const flash=$("#globalScreenFlash");
  const previousBackground=document.documentElement.style.backgroundColor;
  const previousFilter=document.body.style.filter;
  document.documentElement.style.backgroundColor="#ffffff";
  document.body.style.filter="brightness(1.18)";
  flash.classList.add("on");

  // Strong front-screen selfie flash: illuminate first, then sample colors.
  await new Promise(r=>setTimeout(r,1150));

  savedAnalysis=analyzeFace(latestLandmarks,$("#analysisVideo"));

  await new Promise(r=>setTimeout(r,180));
  flash.classList.remove("on");
  document.documentElement.style.backgroundColor=previousBackground;
  document.body.style.filter=previousFilter;
  await new Promise(r=>setTimeout(r,220));

  updateAll(savedAnalysis);
  $("#analysisProgressTitle").textContent="Analyse terminée ✓";
  $("#analysisProgressText").textContent="Tes caractéristiques ont été enregistrées.";

  await new Promise(r=>setTimeout(r,700));
  $("#analysisProgress").classList.add("hidden");
  $("#appHeader").classList.remove("hidden");
  $("#bottomNav").classList.remove("hidden");
  $("#cameraStatus").textContent="Analyse terminée ✓";
  switchTab("mirror");
  startLiveViews();
}

function startLiveViews(){
  for(const v of [$("#mirrorVideo"),$("#tryVideo"),$("#adviceVideo")]) if(v) v.srcObject=stream;
  requestAnimationFrame(liveLoop);
}
function liveLoop(){
  if(!stream||!landmarker)return;
  const v=$("#mirrorVideo");
  if(v.readyState>=2){
    const res=landmarker.detectForVideo(v,performance.now());
    if(res.faceLandmarks?.length){
      latestLandmarks=res.faceLandmarks[0];
      drawGuide($("#mirrorCanvas"),v,latestLandmarks);
      drawMakeup($("#tryCanvas"),$("#tryVideo"),latestLandmarks,activeEffect,activeColor,effectIntensity);
      drawMood($("#adviceCanvas"),$("#adviceVideo"),latestLandmarks,activeMood);
    }
  }
  requestAnimationFrame(liveLoop);
}

function switchTab(tab){
  $$(".nav-button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  $$(".tab-view").forEach(v=>v.classList.toggle("active",v.id===`tab-${tab}`));
  $("#screenTitle").textContent=({mirror:"Miroir",analysis:"Analyse",try:"Essayer",advice:"Conseils",profile:"Profil"})[tab];
}
$$(".nav-button").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));

$$(".zone-chip").forEach(btn=>btn.addEventListener("click",()=>{
  activeZone=btn.dataset.zone;
  $$(".zone-chip").forEach(b=>b.classList.toggle("active",b===btn));
  renderMirrorZone();
}));

const palettes={
  brows:["#4c342f","#69483e","#8c6656","#2f2727"],
  eyes:["#9a786f","#8c6d8f","#806f5b","#6b728b"],
  blush:["#d98b96","#d47f72","#ba6e76","#c983a7"],
  bronzer:["#a86f4b","#8d5e43","#bd8357","#79503d"],
  lips:["#a34f5d","#b9656b","#8f4052","#c87875"],
  complexion:["#e7b69d","#d99b80","#b7745d","#8a503f"]
};
function buildEffectColors(){
  const wrap=$("#effectColors");wrap.innerHTML="";
  const arr=palettes[activeEffect]||palettes.lips;activeColor=arr[0];
  arr.forEach((c,i)=>{
    const b=document.createElement("button");b.type="button";b.className="color-button"+(i===0?" active":"");b.style.background=c;
    b.addEventListener("click",()=>{activeColor=c;$$(".color-button").forEach(x=>x.classList.remove("active"));b.classList.add("active")});
    wrap.appendChild(b);
  });
}
buildEffectColors();
$$(".try-chip").forEach(btn=>btn.addEventListener("click",()=>{activeEffect=btn.dataset.effect;$$(".try-chip").forEach(b=>b.classList.toggle("active",b===btn));buildEffectColors()}));
$("#effectIntensity").addEventListener("input",e=>effectIntensity=Number(e.target.value)/100);

$$(".mood-card").forEach(btn=>btn.addEventListener("click",()=>{
  activeMood=btn.dataset.mood;$$(".mood-card").forEach(b=>b.classList.toggle("active",b===btn));
  const txt={soft:["Douce 🌸","Blush rosé diffus, lèvres fraîches et regard léger."],confident:["Confiante ✨","Sourcils structurés, teint lumineux et lèvres équilibrées."],bold:["Audacieuse 🔥","Regard plus intense, bronzer plus présent et lèvres affirmées."],chill:["Chill 😌","Teint naturel, blush très léger et couleurs discrètes."]}[activeMood];
  $("#moodTitle").textContent=txt[0];$("#moodDescription").textContent=txt[1];
}));

function P(lm,i){return lm[i]}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function avg(...v){return v.reduce((a,b)=>a+b,0)/v.length}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function deg(a,b){return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}
function label3(v,a,b,labels){return v<a?labels[0]:v>b?labels[2]:labels[1]}

function analyzeFace(lm,video){
  prepareSample(video);

  const faceW=dist(P(lm,234),P(lm,454));
  const faceH=dist(P(lm,10),P(lm,152));
  const ratio=faceH/(faceW||1);
  const jawW=dist(P(lm,172),P(lm,397))/(faceW||1);
  const chinWidth=dist(P(lm,176),P(lm,400))/(faceW||1);
  const foreheadShare=(avg(P(lm,70).y,P(lm,300).y)-avg(P(lm,10).y,P(lm,151).y))/(faceH||1);

  let faceShape="ovale";
  if(ratio>1.55)faceShape="allongé";
  else if(ratio<1.25&&jawW>.72)faceShape="rond";
  else if(jawW>.78)faceShape="carré";
  else if(chinWidth<.28&&jawW<.70)faceShape="cœur";

  const forehead=label3(foreheadShare,.17,.24,["court","moyen","haut"]);

  const eyeRatio=dist(P(lm,33),P(lm,133))/(dist(P(lm,159),P(lm,145))||1);
  const eyeShape=eyeRatio>3.2?"amande":eyeRatio<2.5?"ronds":"amande douce";
  const eyeTilt=(deg(P(lm,133),P(lm,33))+deg(P(lm,362),P(lm,263)))/2;
  const eyeTiltLabel=eyeTilt>5?`relevés d’environ ${Math.round(eyeTilt)}°`:eyeTilt<-5?`descendants d’environ ${Math.abs(Math.round(eyeTilt))}°`:`presque horizontaux (${Math.abs(Math.round(eyeTilt))}°)`;

  const browThickness=avg(dist(P(lm,70),P(lm,63)),dist(P(lm,300),P(lm,293)))/(faceH||1);
  const browSize=label3(browThickness,.010,.018,["fins","moyens","épais"]);
  const browArch=avg(P(lm,105).y-avg(P(lm,70).y,P(lm,107).y),P(lm,334).y-avg(P(lm,300).y,P(lm,336).y))/(faceH||1);
  const browShape=browArch<-.018?"arqués":Math.abs(browArch)<.010?"plutôt droits":"courbe douce";

  const mouthW=dist(P(lm,61),P(lm,291))/(faceW||1);
  const lipH=dist(P(lm,13),P(lm,14))/(faceH||1);
  const lipWidth=label3(mouthW,.34,.43,["étroites","moyennes","larges"]);
  const lipVolume=label3(lipH,.018,.035,["fines","moyennes","pleines"]);
  const lipShape=lipVolume==="pleines"?"pulpeuses":lipWidth==="larges"?"étirées douces":lipVolume==="fines"?"fines et définies":"équilibrées";

  const jaw=label3(jawW,.66,.76,["fine","moyenne","large"]);
  const chin=chinWidth<.24?"pointu":chinWidth>.34?"large et arrondi":"arrondi";

  const colors=sampleColors(video,lm);
  return {faceShape,forehead,eyeShape,eyeTiltLabel,browSize,browShape,lipWidth,lipVolume,lipShape,jaw,chin,...colors};
}

function prepareSample(video){
  const w=video.videoWidth,h=video.videoHeight;if(!w||!h)return false;
  sampleCanvas.width=w;sampleCanvas.height=h;sampleCtx.drawImage(video,0,0,w,h);return true;
}
function getPixel(video,x,y,r=2){
  const w=video.videoWidth,h=video.videoHeight;
  const px=clamp(Math.round(x*w),r,w-r-1),py=clamp(Math.round(y*h),r,h-r-1),s=r*2+1;
  const data=sampleCtx.getImageData(px-r,py-r,s,s).data;let R=0,G=0,B=0,n=0;
  for(let i=0;i<data.length;i+=4){R+=data[i];G+=data[i+1];B+=data[i+2];n++}
  return [Math.round(R/n),Math.round(G/n),Math.round(B/n)];
}
function mix(samples){const n=samples.length;return samples.reduce((a,c)=>[a[0]+c[0]/n,a[1]+c[1]/n,a[2]+c[2]/n],[0,0,0]).map(Math.round)}
function hex(c){return "#"+c.map(v=>clamp(v,0,255).toString(16).padStart(2,"0")).join("")}
function lum([r,g,b]){return .2126*r+.7152*g+.0722*b}

function irisName([r,g,b]){
  const l=lum([r,g,b]);
  if(b>r*1.12&&b>g*1.05)return l>105?"bleu-gris":"bleu foncé";
  if(g>r*1.02&&g>b*1.08)return l>105?"vert-gris":"vert";
  if(r>95&&g>70&&g/r>.58&&b<g*.9)return g>105?"noisette":"brun noisette";
  return l<65?"brun très foncé":l<105?"brun foncé":"brun clair";
}
function browName([r,g,b]){const l=lum([r,g,b]);if(l<55)return"brun-noir";if(l<90)return"brun foncé";if(r>g*1.15)return"brun chaud";return l>135?"châtain clair":"châtain"}
function lipName([r,g,b]){const l=lum([r,g,b]);if(r>b*1.35&&r>g*1.22)return l>150?"rose pêche":"rose chaud";if(b>g*.95&&r>b*1.15)return l>145?"rose froid":"bois de rose";return l>150?"rose naturel clair":"rose naturel"}
function skinName(c){const l=lum(c);if(l>205)return"très claire";if(l>175)return"claire";if(l>140)return"claire à moyenne";if(l>110)return"moyenne";if(l>82)return"mate";return"profonde"}

function sampleColors(video,lm){
  const skin=mix([getPixel(video,P(lm,123).x,P(lm,123).y,3),getPixel(video,P(lm,352).x,P(lm,352).y,3),getPixel(video,P(lm,9).x,P(lm,9).y,3)]);
  const lips=mix([getPixel(video,P(lm,13).x,P(lm,13).y,2),getPixel(video,P(lm,14).x,P(lm,14).y,2)]);
  const brows=mix([getPixel(video,P(lm,70).x,P(lm,70).y,2),getPixel(video,P(lm,105).x,P(lm,105).y,2),getPixel(video,P(lm,300).x,P(lm,300).y,2),getPixel(video,P(lm,334).x,P(lm,334).y,2)]);
  const iris=mix([getPixel(video,P(lm,468)?.x??P(lm,159).x,P(lm,468)?.y??P(lm,159).y,2),getPixel(video,P(lm,473)?.x??P(lm,386).x,P(lm,473)?.y??P(lm,386).y,2)]);
  const warmth=(skin[0]-skin[2])+(skin[1]-skin[2])*.25;
  const undertone=warmth>48?"chaud":warmth<26?"froid":"neutre";
  const contrastValue=Math.abs(lum(skin)-lum(iris));
  const contrast=contrastValue>=95?"fort":contrastValue>=55?"moyen":"doux";
  return {skinHex:hex(skin),skinName:skinName(skin),lipHex:hex(lips),lipName:lipName(lips),browHex:hex(brows),browName:browName(brows),irisHex:hex(iris),irisName:irisName(iris),undertone,contrast};
}

function updateAll(a){
  $("#aFace").textContent=`Visage ${a.faceShape}.`;
  $("#aForehead").textContent=`Front ${a.forehead}.`;
  $("#aEyes").textContent=`Yeux ${a.eyeShape}, ${a.eyeTiltLabel}. Couleur : ${a.irisName} (${a.irisHex}).`;
  $("#aBrows").textContent=`Sourcils ${a.browSize}, ${a.browShape}. Couleur : ${a.browName} (${a.browHex}).`;
  $("#aLips").textContent=`Lèvres ${a.lipShape}, largeur ${a.lipWidth}, volume ${a.lipVolume}. Couleur : ${a.lipName} (${a.lipHex}).`;
  $("#aJaw").textContent=`Mâchoire ${a.jaw}. Menton ${a.chin}.`;
  $("#aColor").textContent=`Peau ${a.skinName} (${a.skinHex}), sous-ton ${a.undertone}, contraste ${a.contrast}.`;
  $("#aBrowAdvice").textContent=browAdvice(a.faceShape);
  $("#profileAnalysis").textContent=`Visage ${a.faceShape} · yeux ${a.eyeShape} · mâchoire ${a.jaw}.`;
  $("#profileColor").textContent=`Peau ${a.skinName} · sous-ton ${a.undertone} · contraste ${a.contrast}.`;
  $("#palette").innerHTML=recommendPalette(a).map(c=>`<span class="palette-swatch" style="background:${c}"></span>`).join("");
  renderMirrorZone();
}
function browAdvice(shape){
  return ({rond:"Soft arch : arc doux pour structurer le visage.",allongé:"Droit doux : ligne moins arquée pour équilibrer la longueur.",carré:"Arc doux : courbe souple pour adoucir la structure.",cœur:"Arc léger : montée progressive pour équilibrer le front et le menton.",ovale:"Arc naturel : ligne douce qui respecte l’équilibre général."})[shape]||"Arc naturel.";
}
function recommendPalette(a){
  if(a.undertone==="chaud")return["#D28A70","#B96F52","#9B6A46","#C77A72"];
  if(a.undertone==="froid")return["#C9859C","#A86882","#8D718A","#B86276"];
  return["#CD8A82","#B67B75","#9B786A","#B76D83"];
}
function renderMirrorZone(){
  if(!savedAnalysis)return;
  const a=savedAnalysis;
  const data={
    face:["Visage",`Forme ${a.faceShape}.`],
    forehead:["Front",`Front ${a.forehead}.`],
    brows:["Sourcils",`Épaisseur ${a.browSize}. Forme ${a.browShape}. Couleur ${a.browName} (${a.browHex}).`],
    eyes:["Yeux",`Forme ${a.eyeShape}. Inclinaison : ${a.eyeTiltLabel}. Couleur ${a.irisName} (${a.irisHex}).`],
    lips:["Lèvres",`Forme ${a.lipShape}. Largeur ${a.lipWidth}. Volume ${a.lipVolume}. Couleur ${a.lipName} (${a.lipHex}).`],
    jaw:["Mâchoire",`Mâchoire ${a.jaw}. Menton ${a.chin}.`],
    skin:["Peau",`Teinte ${a.skinName} (${a.skinHex}). Sous-ton ${a.undertone}. Contraste ${a.contrast}.`]
  }[activeZone];
  $("#mirrorResultTitle").textContent=data[0];$("#mirrorResult").textContent=data[1];
}

function fitCanvas(canvas,video){
  const r=video.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
  canvas.style.width=r.width+"px";canvas.style.height=r.height+"px";
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w:r.width,h:r.height};
}
function clearCanvas(c){const x=c.getContext("2d");x.clearRect(0,0,c.width,c.height)}
function mp(p,w,h){return{x:(1-p.x)*w,y:p.y*h}}
function drawGuide(canvas,video,lm){
  const {ctx,w,h}=fitCanvas(canvas,video);ctx.clearRect(0,0,w,h);if(!lm)return;
  ctx.strokeStyle="rgba(255,255,255,.78)";ctx.fillStyle="rgba(255,255,255,.9)";ctx.lineWidth=1.15;ctx.beginPath();
  FACE_OVAL.forEach((i,k)=>{const p=mp(lm[i],w,h);k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});ctx.closePath();ctx.stroke();
  FACE_OVAL.forEach(i=>{const p=mp(lm[i],w,h);ctx.beginPath();ctx.arc(p.x,p.y,1.5,0,Math.PI*2);ctx.fill()});
}
function rgba(hex,a){const n=parseInt(hex.slice(1),16);return`rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`}
function path(ctx,lm,ids,w,h){ids.forEach((i,k)=>{const p=mp(lm[i],w,h);k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)})}
function drawMakeup(canvas,video,lm,effect,color,intensity){
  if(!lm)return;
  const {ctx,w,h}=fitCanvas(canvas,video);ctx.clearRect(0,0,w,h);const a=Math.max(.03,intensity*.34);ctx.lineCap="round";ctx.lineJoin="round";
  if(effect==="lips"){ctx.fillStyle=rgba(color,a+.18);ctx.beginPath();path(ctx,lm,[61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61],w,h);ctx.closePath();ctx.fill()}
  if(effect==="blush"){[123,352].forEach(i=>{const p=mp(lm[i],w,h),g=ctx.createRadialGradient(p.x,p.y,2,p.x,p.y,w*.10);g.addColorStop(0,rgba(color,a));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,w*.11,0,Math.PI*2);ctx.fill()})}
  if(effect==="bronzer"){ctx.strokeStyle=rgba(color,a);ctx.lineWidth=w*.045;[[127,34,139],[356,264,368],[172,136,150],[397,365,379]].forEach(s=>{ctx.beginPath();path(ctx,lm,s,w,h);ctx.stroke()})}
  if(effect==="eyes"){ctx.strokeStyle=rgba(color,a+.1);ctx.lineWidth=w*.025;[[33,160,158,133],[362,385,387,263]].forEach(s=>{ctx.beginPath();path(ctx,lm,s,w,h);ctx.stroke()})}
  if(effect==="brows"){ctx.strokeStyle=rgba(color,a+.15);ctx.lineWidth=w*.018;[[70,63,105,66,107],[336,296,334,293,300]].forEach(s=>{ctx.beginPath();path(ctx,lm,s,w,h);ctx.stroke()})}
  if(effect==="complexion"){const c=mp(lm[1],w,h),g=ctx.createRadialGradient(c.x,c.y,w*.06,c.x,c.y,w*.36);g.addColorStop(0,rgba(color,a*.18));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.fillRect(0,0,w,h)}
}
function drawMood(canvas,video,lm,mood){
  if(!mood){clearCanvas(canvas);return}
  const recipes={soft:[["blush","#D98B96",.42],["lips","#B9656B",.35],["eyes","#9A786F",.22]],confident:[["brows","#69483E",.48],["blush","#C77A72",.35],["lips","#A34F5D",.42]],bold:[["eyes","#6B526F",.55],["bronzer","#8D5E43",.45],["lips","#8F4052",.58]],chill:[["complexion","#D9A18A",.20],["blush","#D98B96",.24],["lips","#C87875",.22]]};
  const r=recipes[mood],base=fitCanvas(canvas,video);base.ctx.clearRect(0,0,base.w,base.h);
  const temp=document.createElement("canvas");temp.width=canvas.width;temp.height=canvas.height;
  r.forEach(([e,c,i])=>{drawMakeup(temp,video,lm,e,c,i);base.ctx.drawImage(temp,0,0,base.w,base.h);temp.getContext("2d").clearRect(0,0,temp.width,temp.height)});
}

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
}