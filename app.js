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
let analysisLoopId = 0;
let liveRunning = false;

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

function clearSavedResults(){
  savedAnalysis=null;
  latestLandmarks=null;
  stableFrames=0;
  capturing=false;
  lastTime=-1;
  $("#aFace").textContent="Analyse en cours…";
  $("#aForehead").textContent="Analyse en cours…";
  $("#aEyes").textContent="Analyse en cours…";
  $("#aBrows").textContent="Analyse en cours…";
  $("#aLips").textContent="Analyse en cours…";
  $("#aJaw").textContent="Analyse en cours…";
  $("#aColor").textContent="Analyse en cours…";
  $("#aBrowAdvice").textContent="Analyse en cours…";
  $("#profileAnalysis").textContent="Analyse en cours…";
  $("#profileColor").textContent="Analyse en cours…";
  $("#palette").innerHTML="";
  $("#mirrorResultTitle").textContent="Analyse";
  $("#mirrorResult").textContent="Nouvelle analyse en cours…";
}

async function stopCameraAndModel(){
  liveRunning=false;
  analysisLoopId++;
  if(raf){
    cancelAnimationFrame(raf);
    raf=null;
  }
  if(appLoopFrame){
    cancelAnimationFrame(appLoopFrame);
    appLoopFrame=0;
  }
  for(const v of videos()){
    try{
      v.pause();
      v.srcObject=null;
    }catch(e){}
  }
  if(stream){
    stream.getTracks().forEach(track=>track.stop());
    stream=null;
  }
  if(landmarker){
    try{ landmarker.close(); }catch(e){}
    landmarker=null;
  }
  await new Promise(r=>setTimeout(r,180));
}

async function restartAnalysis(){
  liveRunning=false;
  await detachSecondaryVideos();
  $("#appHeader").classList.add("hidden");
  $("#bottomNav").classList.add("hidden");
  $$(".tab-view").forEach(v=>v.classList.remove("active"));
  $("#analysisIntro").classList.add("hidden");
  $("#analysisProgress").classList.remove("hidden");
  $("#analysisProgressTitle").textContent="Redémarrage de l’analyse…";
  $("#analysisProgressText").textContent="La caméra et le moteur d’analyse redémarrent complètement.";
  $("#analysisGuide").textContent="Préparation…";
  clearCanvas($("#analysisCanvas"));
  clearSavedResults();

  try{
    await stopCameraAndModel();
    await startCamera();
    $("#analysisProgressTitle").textContent="Détection du visage";
    $("#analysisProgressText").textContent="Regarde droit devant toi et reste immobile quelques secondes.";
    $("#analysisGuide").textContent="Place ton visage face caméra";
    const loopId=++analysisLoopId;
    analyzeLoop(loopId);
  }catch(err){
    console.error("Erreur redémarrage analyse",err);
    $("#analysisProgressTitle").textContent="Impossible de relancer";
    $("#analysisProgressText").textContent="Ferme puis rouvre Safari et autorise la caméra.";
  }
}

async function initLandmarker(){
  if(landmarker)return;
  const vision=await FilesetResolver.forVisionTasks(WASM_URL);
  const options={
    runningMode:"VIDEO",
    numFaces:1,
    minFaceDetectionConfidence:.58,
    minFacePresenceConfidence:.58,
    minTrackingConfidence:.58,
    outputFaceBlendshapes:false,
    outputFacialTransformationMatrixes:false
  };
  try{
    landmarker=await FaceLandmarker.createFromOptions(vision,{
      ...options,
      baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"}
    });
  }catch(gpuError){
    console.warn("GPU indisponible, bascule CPU",gpuError);
    landmarker=await FaceLandmarker.createFromOptions(vision,{
      ...options,
      baseOptions:{modelAssetPath:MODEL_URL,delegate:"CPU"}
    });
  }
}

async function startCamera(){
  if(!stream){
    stream=await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:{ideal:"user"},
        width:{ideal:480,max:720},
        height:{ideal:640,max:960},
        frameRate:{ideal:24,max:30}
      },
      audio:false
    });
  }
  const analysisVideo=$("#analysisVideo");
  analysisVideo.srcObject=stream;
  await analysisVideo.play();
  await initLandmarker();
}

$("#beginAnalysisButton").addEventListener("click",async()=>{
  $("#analysisIntro").classList.add("hidden");
  $("#analysisProgress").classList.remove("hidden");
  $("#analysisProgressTitle").textContent="Ouverture de la caméra…";
  try{
    await startCamera();
    stableFrames=0; savedAnalysis=null; capturing=false; lastTime=-1;
    liveRunning=false;
    $("#analysisProgressTitle").textContent="Détection du visage";
    $("#analysisProgressText").textContent="Regarde droit devant toi et reste immobile quelques secondes.";
    const loopId=++analysisLoopId;
    analyzeLoop(loopId);
  }catch(e){
    console.error(e);
    $("#analysisProgressTitle").textContent="Analyse impossible";
    $("#analysisProgressText").textContent="Sur iPhone : ouvre le site dans Safari, autorise la caméra puis recharge la page. Si la caméra est déjà autorisée, ferme l’app et relance-la.";
  }
});

$("#cameraButton").addEventListener("click",restartAnalysis);


function analyzeLoop(loopId){
  if(loopId!==analysisLoopId)return;
  if(!stream||!landmarker){raf=requestAnimationFrame(()=>analyzeLoop(loopId));return}
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
      if(stableFrames>=16&&!capturing) captureAnalysis();
    }else{
      latestLandmarks=null; stableFrames=0;
      clearCanvas($("#analysisCanvas"));
      $("#analysisGuide").textContent="Place ton visage face caméra";
      $("#analysisProgressTitle").textContent="Détection du visage";
    }
  }
  if(!savedAnalysis && loopId===analysisLoopId) raf=requestAnimationFrame(()=>analyzeLoop(loopId));
}


let activeAppTab="mirror";
let appLoopFrame=0;
let lastAppDetectAt=0;

function currentVideoForTab(tab){
  if(tab==="mirror") return $("#mirrorVideo");
  if(tab==="try") return $("#tryVideo");
  if(tab==="advice") return $("#adviceVideo");
  return null;
}

async function detachSecondaryVideos(){
  for(const v of [$("#mirrorVideo"),$("#tryVideo"),$("#adviceVideo")]){
    if(!v) continue;
    try{
      v.pause();
      v.srcObject=null;
    }catch(e){}
  }
}

async function attachOnlyVideo(tab){
  await detachSecondaryVideos();
  const v=currentVideoForTab(tab);
  if(!v || !stream) return null;
  try{
    v.srcObject=stream;
    await v.play();
    return v;
  }catch(err){
    console.warn("Impossible d’ouvrir la caméra sur",tab,err);
    return null;
  }
}

async function switchTab(tab){
  const titles={mirror:"Miroir",analysis:"Analyse",try:"Essayer",advice:"Conseils",profile:"Profil"};
  activeAppTab=tab;

  $$(".nav-button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  $$(".tab-view").forEach(v=>v.classList.toggle("active",v.id===`tab-${tab}`));
  $("#screenTitle").textContent=titles[tab]||"Miroir";

  if(tab==="mirror" || tab==="try" || tab==="advice"){
    const v=await attachOnlyVideo(tab);
    if(tab==="mirror"){
      $("#mirrorRecovery").classList.toggle("hidden",Boolean(v));
      $("#guideMessage").textContent=v?"Analyse enregistrée":"Caméra indisponible";
    }
  }else{
    await detachSecondaryVideos();
  }
}

$$(".nav-button").forEach(btn=>{
  btn.addEventListener("click",()=>switchTab(btn.dataset.tab));
});

$$(".zone-chip").forEach(btn=>{
  btn.addEventListener("click",()=>{
    activeZone=btn.dataset.zone;
    $$(".zone-chip").forEach(b=>b.classList.toggle("active",b===btn));
    renderMirrorZone();
  });
});

async function startLiveViews(){
  liveRunning=true;
  activeAppTab="mirror";
  await switchTab("mirror");
  appLoopFrame=requestAnimationFrame(liveLoop);
}

function liveLoop(now=0){
  if(!liveRunning||!stream||!landmarker)return;

  const tab=activeAppTab;
  const v=currentVideoForTab(tab);

  // iPhone/Safari stability: never run MediaPipe on hidden/paused videos,
  // and throttle tracking to ~10 fps instead of every animation frame.
  if(v && v.readyState>=2 && !v.paused && now-lastAppDetectAt>=100){
    lastAppDetectAt=now;
    try{
      const res=landmarker.detectForVideo(v,performance.now());
      if(res.faceLandmarks?.length){
        latestLandmarks=res.faceLandmarks[0];

        if(tab==="mirror"){
          drawGuide($("#mirrorCanvas"),v,latestLandmarks);
          $("#mirrorRecovery").classList.add("hidden");
        }else if(tab==="try"){
          drawMakeup($("#tryCanvas"),v,latestLandmarks,activeEffect,activeColor,effectIntensity);
        }else if(tab==="advice"){
          drawMood($("#adviceCanvas"),v,latestLandmarks,activeMood);
        }
      }
    }catch(err){
      console.warn("Suivi facial temporairement interrompu",err);
      if(tab==="mirror"){
        $("#mirrorRecovery").classList.remove("hidden");
      }
    }
  }

  appLoopFrame=requestAnimationFrame(liveLoop);
}

async function captureAnalysis(){
  if(capturing||!latestLandmarks)return;
  capturing=true;
  $("#analysisProgressTitle").textContent="Analyse des détails";
  $("#analysisProgressText").textContent="Reste immobile et garde les yeux bien ouverts : lecture détaillée des deux iris…";
  $("#analysisGuide").textContent="Regarde droit devant toi";

  try{
    const video=$("#analysisVideo");

    // Geometry comes from the current stable landmark set.
    const base=analyzeGeometry(latestLandmarks);

    // Color is sampled over several live frames. This is especially important
    // for irises: one frame can contain a blink, reflection or pupil-heavy sample.
    const frames=[];
    for(let i=0;i<15;i++){
      await new Promise(r=>setTimeout(r,70));
      if(latestLandmarks && video.readyState>=2){
        frames.push(sampleRawColors(video,latestLandmarks));
      }
    }

    if(frames.length<4) throw new Error("Pas assez d’images stables");
    const colors=combineColorFrames(frames);
    savedAnalysis={...base,...colors};

    updateAll(savedAnalysis);
  }catch(err){
    console.error("Erreur analyse",err);
    savedAnalysis=null;
  }

  await new Promise(r=>setTimeout(r,150));

  if(!savedAnalysis){
    capturing=false;
    stableFrames=0;
    $("#analysisProgressTitle").textContent="On recommence";
    $("#analysisProgressText").textContent="Reste face caméra, yeux ouverts, quelques secondes.";
    return;
  }

  $("#analysisProgressTitle").textContent="Analyse terminée ✓";
  $("#analysisProgressText").textContent="Tes caractéristiques ont été enregistrées.";

  await new Promise(r=>setTimeout(r,700));

  // Release the analysis video before opening the app.
  try{
    const analysisVideo=$("#analysisVideo");
    analysisVideo.pause();
    analysisVideo.srcObject=null;
  }catch(e){}

  // Show the app before attempting any secondary camera work.
  $("#analysisProgress").classList.add("hidden");
  $("#analysisIntro").classList.add("hidden");
  $("#appHeader").classList.remove("hidden");
  $("#bottomNav").classList.remove("hidden");
  $("#cameraStatus").textContent="Analyse terminée ✓";

  try{
    await startLiveViews();
  }catch(err){
    console.error("Ouverture du miroir impossible",err);
    $$(".tab-view").forEach(v=>v.classList.toggle("active",v.id==="tab-mirror"));
    $("#screenTitle").textContent="Miroir";
    $("#mirrorRecovery").classList.remove("hidden");
    $("#guideMessage").textContent="Analyse enregistrée";
  }
}
function P(lm,i){return lm[i]}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function avg(...v){return v.reduce((a,b)=>a+b,0)/v.length}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function deg(a,b){return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}
function label3(v,a,b,labels){return v<a?labels[0]:v>b?labels[2]:labels[1]}

function analyzeGeometry(lm){
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

  return {faceShape,forehead,eyeShape,eyeTiltLabel,browSize,browShape,lipWidth,lipVolume,lipShape,jaw,chin};
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


function rgbToHsv([r,g,b]){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;
  if(d!==0){
    if(max===r)h=((g-b)/d)%6;
    else if(max===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;if(h<0)h+=360;
  }
  return[h,max===0?0:d/max,max];
}
function saturation(rgb){return rgbToHsv(rgb)[1]}
function median(values){
  const a=[...values].sort((x,y)=>x-y);
  return a[Math.floor(a.length/2)];
}
function medianColor(samples){
  if(!samples.length)return[128,128,128];
  return[0,1,2].map(ch=>Math.round(median(samples.map(c=>c[ch]))));
}
function meanColor(samples){
  if(!samples.length)return[128,128,128];
  return[0,1,2].map(ch=>Math.round(samples.reduce((s,c)=>s+c[ch],0)/samples.length));
}
function interpolatePoint(a,b,t){
  return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}
function applyGain(rgb,g){
  return rgb.map((v,i)=>Math.round(clamp(v*g[i],0,255)));
}
function whiteBalanceGains(video,lm){
  const samples=[];
  const eyes=[
    [P(lm,468),P(lm,33),P(lm,133)],
    [P(lm,473),P(lm,362),P(lm,263)]
  ];
  for(const [center,c1,c2] of eyes){
    if(!center||!c1||!c2)continue;
    for(const corner of [c1,c2]){
      for(const t of [.58,.68]){
        const p=interpolatePoint(center,corner,t);
        const c=getPixel(video,p.x,p.y,1);
        const L=lum(c),S=saturation(c);
        // Keep likely sclera/reflection-neutral pixels, reject skin and deep shadow.
        if(L>115&&L<245&&S<.32)samples.push(c);
      }
    }
  }
  if(samples.length<2)return[1,1,1];
  const w=meanColor(samples);
  const target=(w[0]+w[1]+w[2])/3;
  return w.map(v=>clamp(target/(v||target),.78,1.28));
}
function irisEllipse(video,lm,centerId,ringIds){
  const center=P(lm,centerId);
  const ring=ringIds.map(id=>P(lm,id)).filter(Boolean);
  if(!center||ring.length<4)return null;
  const xs=ring.map(p=>Math.abs(p.x-center.x));
  const ys=ring.map(p=>Math.abs(p.y-center.y));
  const rx=Math.max(...xs);
  const ry=Math.max(...ys);
  if(rx<=0||ry<=0)return null;
  return{center,rx,ry};
}

function denseIrisPixels(video,lm,gains){
  const samples=[];
  const defs=[
    {center:468,ring:[469,470,471,472]},
    {center:473,ring:[474,475,476,477]}
  ];

  for(const def of defs){
    const e=irisEllipse(video,lm,def.center,def.ring);
    if(!e)continue;

    // Dense annulus sampling. The center/pupil is excluded and the very outer
    // edge is excluded to avoid sclera/eyelid contamination.
    for(const rf of [.48,.56,.64,.72,.79]){
      for(let k=0;k<32;k++){
        const a=(Math.PI*2*k)/32;
        const p={
          x:e.center.x+Math.cos(a)*e.rx*rf,
          y:e.center.y+Math.sin(a)*e.ry*rf
        };
        let c=getPixel(video,p.x,p.y,0);
        c=applyGain(c,gains);
        const L=lum(c);
        if(L<28||L>225)continue; // pupil/specular/sclera
        samples.push(c);
      }
    }
  }
  return samples;
}

function irisPixelFamily(rgb){
  const [r,g,b]=rgb;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  const chroma=max-min;
  const L=lum(rgb);

  // Channel-opponent differences are more robust than HSV saturation for
  // pale blue/green irises that phone cameras often desaturate.
  const blue=b-(r+g)/2;
  const green=g-(r+b)/2;
  const warm=(r-b)+0.28*(g-b);

  // Only call a pixel truly neutral gray if all RGB channels are very close.
  if(chroma<=7){
    if(blue>2.2)return"bleu-gris";
    if(green>2.2)return"vert-gris";
    return"gris";
  }

  if(blue>=7){
    return chroma<18?"bleu-gris":"bleu";
  }

  if(green>=6){
    if(r-b>8 && g-b>8)return"vert-noisette";
    return chroma<18?"vert-gris":"vert";
  }

  if(warm>28 && g-b>12){
    if(r-g<18)return"noisette";
    return"ambre";
  }

  if(r-b>18 && g-b>8){
    return L>115?"noisette":"brun";
  }

  // Low-chroma colored pixels: infer tint from small channel differences
  // instead of collapsing immediately to gray.
  if(b-r>=4 || b-g>=4)return"bleu-gris";
  if(g-r>=4 && g-b>=2)return"vert-gris";
  if(r-b>=7 && g-b>=4)return"noisette";

  return"gris";
}

function irisFrameVote(video,lm,gains){
  const pixels=denseIrisPixels(video,lm,gains);
  const votes={
    "bleu":0,"bleu-gris":0,"vert":0,"vert-gris":0,
    "vert-noisette":0,"noisette":0,"ambre":0,"brun":0,"gris":0
  };
  const kept=[];

  for(const c of pixels){
    const family=irisPixelFamily(c);
    const chroma=Math.max(...c)-Math.min(...c);
    const weight=1+Math.min(3,chroma/12);
    votes[family]+=weight;
    kept.push(c);
  }

  // Prevent tiny specular/neutral regions from overpowering a real tint.
  const coloredTotal=Object.entries(votes)
    .filter(([k])=>k!=="gris")
    .reduce((s,[,v])=>s+v,0);

  if(coloredTotal>votes.gris*.55){
    votes.gris*=0.35;
  }

  const sorted=Object.entries(votes).sort((a,b)=>b[1]-a[1]);
  const family=sorted[0]?.[0]||"indéterminée";
  const color=medianColor(kept.length?kept:[[128,128,128]]);

  return{family,color,votes,count:kept.length};
}

function mergeIrisVotes(frames){
  const totals={
    "bleu":0,"bleu-gris":0,"vert":0,"vert-gris":0,
    "vert-noisette":0,"noisette":0,"ambre":0,"brun":0,"gris":0
  };
  const colors=[];

  for(const f of frames){
    if(!f?.irisVote)continue;
    for(const [k,v] of Object.entries(f.irisVote.votes||{})){
      if(k in totals)totals[k]+=v;
    }
    if(f.irisVote.color)colors.push(f.irisVote.color);
  }

  // Merge adjacent semantic families before selecting the final label.
  const groups=[
    ["bleu", totals["bleu"]+totals["bleu-gris"]],
    ["vert", totals["vert"]+totals["vert-gris"]+totals["vert-noisette"]*.55],
    ["noisette", totals["noisette"]+totals["vert-noisette"]*.45],
    ["ambre", totals["ambre"]],
    ["brun", totals["brun"]],
    ["gris", totals["gris"]]
  ].sort((a,b)=>b[1]-a[1]);

  const broad=groups[0]?.[0]||"indéterminée";
  let name=broad;

  if(broad==="bleu"){
    name=totals["bleu-gris"]>totals["bleu"]*.65?"bleu-gris":"bleu";
  }else if(broad==="vert"){
    if(totals["vert-noisette"]>Math.max(totals["vert"],totals["vert-gris"])*.7)name="vert noisette";
    else name=totals["vert-gris"]>totals["vert"]*.65?"vert-gris":"vert";
  }else if(broad==="noisette"){
    name="noisette";
  }else if(broad==="ambre"){
    name="ambre";
  }else if(broad==="brun"){
    name="brun";
  }else if(broad==="gris"){
    // "gris" is allowed only when neutral votes clearly dominate every tint.
    const bestTint=Math.max(
      totals["bleu"]+totals["bleu-gris"],
      totals["vert"]+totals["vert-gris"],
      totals["noisette"]+totals["vert-noisette"],
      totals["ambre"],
      totals["brun"]
    );
    if(totals["gris"]<bestTint*1.8){
      const tintGroups=[
        ["bleu-gris",totals["bleu"]+totals["bleu-gris"]],
        ["vert-gris",totals["vert"]+totals["vert-gris"]],
        ["noisette",totals["noisette"]+totals["vert-noisette"]],
        ["ambre",totals["ambre"]],
        ["brun",totals["brun"]]
      ].sort((a,b)=>b[1]-a[1]);
      name=tintGroups[0][0];
    }else{
      name="gris";
    }
  }

  return{name,color:medianColor(colors.length?colors:[[128,128,128]])};
}

function irisName(rgb){
  // Fallback only. Normal analysis uses mergeIrisVotes().
  return irisPixelFamily(rgb).replace("vert-noisette","vert noisette");
}
function browName(rgb){
  const[h,s,v]=rgbToHsv(rgb),l=lum(rgb);
  if(l<42)return"brun-noir";
  if(l<68)return"brun très foncé";
  if(l<92){
    if(h>30&&h<55)return"brun chaud";
    if(s<.18)return"brun cendré";
    return"brun neutre";
  }
  if(l<122){
    if(h>30&&h<55)return"châtain chaud";
    if(s<.18)return"châtain cendré";
    return"châtain moyen";
  }
  if(l<155)return s<.20?"châtain clair cendré":"châtain clair";
  return h>35&&h<60?"blond doré":"blond cendré";
}
function lipName(rgb){
  const[h,s,v]=rgbToHsv(rgb),l=lum(rgb);
  if(s<.15)return l>155?"beige rosé clair":"beige rosé";
  if(h>=345||h<8){
    if(l<115)return"bois de rose profond";
    if(l<150)return"bois de rose";
    return"rose nude";
  }
  if(h>=8&&h<24){
    if(s>.38&&l>135)return"corail doux";
    if(l>150)return"rose pêche";
    return"rose chaud";
  }
  if(h>=320&&h<345){
    if(l<120)return"vieux rose profond";
    if(s<.28)return"mauve rosé";
    return"vieux rose";
  }
  if(h>=300&&h<320)return"mauve rosé";
  return l>150?"rose naturel clair":"rose naturel";
}
function skinName(c){
  const l=lum(c);
  if(l>220)return"très claire";
  if(l>195)return"claire";
  if(l>168)return"claire à moyenne";
  if(l>140)return"moyenne";
  if(l>112)return"moyenne à mate";
  if(l>88)return"mate";
  if(l>62)return"foncée";
  return"profonde";
}
function sampleCluster(video,lm,ids,r=2,gains=[1,1,1]){
  const pts=[];
  for(const id of ids){
    const p=P(lm,id);
    if(p)pts.push(applyGain(getPixel(video,p.x,p.y,r),gains));
  }
  return medianColor(pts);
}
function sampleRawColors(video,lm){
  prepareSample(video);
  const gains=whiteBalanceGains(video,lm);

  const skin=medianColor([
    P(lm,123),P(lm,352),P(lm,9),P(lm,50),P(lm,280)
  ].filter(Boolean).map(p=>applyGain(getPixel(video,p.x,p.y,3),gains)));

  const lips=sampleCluster(video,lm,[13,14,61,291,78,308],2,gains);
  const brows=sampleCluster(video,lm,[70,63,105,107,300,293,334,336],2,gains);
  const irisVote=irisFrameVote(video,lm,gains);

  return{skin,lips,brows,irisVote};
}
function combineColorFrames(frames){
  const skin=medianColor(frames.map(f=>f.skin));
  const lips=medianColor(frames.map(f=>f.lips));
  const brows=medianColor(frames.map(f=>f.brows));
  const irisMerged=mergeIrisVotes(frames);
  const iris=irisMerged.color;

  const[h,s,v]=rgbToHsv(skin);
  let undertone="neutre";
  if(h>=18&&h<=50&&s>.16)undertone="chaud";
  else if((h<15||h>330)&&s>.12)undertone="froid";
  else if(h>=50&&h<=95&&s>.12)undertone="olive";

  const contrastValue=Math.abs(lum(skin)-lum(iris));
  const contrast=contrastValue>=100?"fort":contrastValue>=60?"moyen":"doux";

  return{
    skinHex:hex(skin),skinName:skinName(skin),
    lipHex:hex(lips),lipName:lipName(lips),
    browHex:hex(brows),browName:browName(brows),
    irisHex:hex(iris),irisName:irisMerged.name,
    undertone,contrast
  };
}
function colorPill(name,color){
  return `<span class="detected-color"><span class="detected-color-dot" style="background:${color}"></span>${name}</span>`;
}

function updateAll(a){
  $("#aFace").textContent=`Visage ${a.faceShape}.`;
  $("#aForehead").textContent=`Front ${a.forehead}.`;
  $("#aEyes").innerHTML=`Yeux ${a.eyeShape}, ${a.eyeTiltLabel}.<br>Couleur ${colorPill(a.irisName,a.irisHex)}`;
  $("#aBrows").innerHTML=`Sourcils ${a.browSize}, ${a.browShape}.<br>Couleur ${colorPill(a.browName,a.browHex)}`;
  $("#aLips").innerHTML=`Lèvres ${a.lipShape}, largeur ${a.lipWidth}, volume ${a.lipVolume}.<br>Couleur ${colorPill(a.lipName,a.lipHex)}`;
  $("#aJaw").textContent=`Mâchoire ${a.jaw}. Menton ${a.chin}.`;
  $("#aColor").innerHTML=`Peau ${colorPill(a.skinName,a.skinHex)} · sous-ton ${a.undertone} · contraste ${a.contrast}.`;
  $("#aBrowAdvice").textContent=browAdvice(a.faceShape);
  $("#profileAnalysis").textContent=`Visage ${a.faceShape} · yeux ${a.eyeShape} · mâchoire ${a.jaw}.`;
  $("#profileColor").innerHTML=`Peau ${colorPill(a.skinName,a.skinHex)} · sous-ton ${a.undertone} · contraste ${a.contrast}.`;
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
    brows:["Sourcils",`Épaisseur ${a.browSize}. Forme ${a.browShape}.<br>Couleur ${colorPill(a.browName,a.browHex)}`],
    eyes:["Yeux",`Forme ${a.eyeShape}. Inclinaison : ${a.eyeTiltLabel}.<br>Couleur ${colorPill(a.irisName,a.irisHex)}`],
    lips:["Lèvres",`Forme ${a.lipShape}. Largeur ${a.lipWidth}. Volume ${a.lipVolume}.<br>Couleur ${colorPill(a.lipName,a.lipHex)}`],
    jaw:["Mâchoire",`Mâchoire ${a.jaw}. Menton ${a.chin}.`],
    skin:["Peau",`Teinte ${colorPill(a.skinName,a.skinHex)} · sous-ton ${a.undertone} · contraste ${a.contrast}.`]
  }[activeZone] || ["Visage",`Forme ${a.faceShape}.`];
  $("#mirrorResultTitle").textContent=data[0];
  $("#mirrorResult").innerHTML=data[1];
}

function fitCanvas(canvas,video){
  const r=video.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
  canvas.style.width=r.width+"px";canvas.style.height=r.height+"px";
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w:r.width,h:r.height};
}
function clearCanvas(c){const x=c.getContext("2d");x.clearRect(0,0,c.width,c.height)}
function mp(p,w,h,video){
  const vw=video?.videoWidth||w;
  const vh=video?.videoHeight||h;
  const scale=Math.min(w/vw,h/vh);
  const drawW=vw*scale, drawH=vh*scale;
  const ox=(w-drawW)/2, oy=(h-drawH)/2;
  return{x:ox+(1-p.x)*drawW,y:oy+p.y*drawH};
}
function drawGuide(canvas,video,lm){
  const {ctx,w,h}=fitCanvas(canvas,video);
  ctx.clearRect(0,0,w,h);
  if(!lm)return;

  const raw=FACE_OVAL.map(i=>mp(lm[i],w,h,video));
  const cx=raw.reduce((s,p)=>s+p.x,0)/raw.length;
  const cy=raw.reduce((s,p)=>s+p.y,0)/raw.length;

  // MediaPipe's outer oval sits near the hair/ear boundary.
  // Pull it inward so the visible guide hugs the facial contour instead.
  const pts=raw.map(p=>({
    x:cx+(p.x-cx)*0.90,
    y:cy+(p.y-cy)*0.94
  }));

  ctx.strokeStyle="rgba(255,255,255,.76)";
  ctx.fillStyle="rgba(255,255,255,.88)";
  ctx.lineWidth=.9;
  ctx.beginPath();
  pts.forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  ctx.closePath();
  ctx.stroke();

  pts.forEach(p=>{
    ctx.beginPath();
    ctx.arc(p.x,p.y,1.05,0,Math.PI*2);
    ctx.fill();
  });
}
function rgba(hex,a){const n=parseInt(hex.slice(1),16);return`rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`}
function path(ctx,lm,ids,w,h,video){ids.forEach((i,k)=>{const p=mp(lm[i],w,h,video);k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)})}
function drawMakeup(canvas,video,lm,effect,color,intensity){
  if(!lm)return;
  const {ctx,w,h}=fitCanvas(canvas,video);ctx.clearRect(0,0,w,h);const a=Math.max(.03,intensity*.34);ctx.lineCap="round";ctx.lineJoin="round";
  if(effect==="lips"){ctx.fillStyle=rgba(color,a+.18);ctx.beginPath();path(ctx,lm,[61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61],w,h,video);ctx.closePath();ctx.fill()}
  if(effect==="blush"){[123,352].forEach(i=>{const p=mp(lm[i],w,h,video),g=ctx.createRadialGradient(p.x,p.y,2,p.x,p.y,w*.10);g.addColorStop(0,rgba(color,a));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,w*.11,0,Math.PI*2);ctx.fill()})}
  if(effect==="bronzer"){ctx.strokeStyle=rgba(color,a);ctx.lineWidth=w*.045;[[127,34,139],[356,264,368],[172,136,150],[397,365,379]].forEach(s=>{ctx.beginPath();path(ctx,lm,s,w,h,video);ctx.stroke()})}
  if(effect==="eyes"){ctx.strokeStyle=rgba(color,a+.1);ctx.lineWidth=w*.025;[[33,160,158,133],[362,385,387,263]].forEach(s=>{ctx.beginPath();path(ctx,lm,s,w,h,video);ctx.stroke()})}
  if(effect==="brows"){ctx.strokeStyle=rgba(color,a+.15);ctx.lineWidth=w*.018;[[70,63,105,66,107],[336,296,334,293,300]].forEach(s=>{ctx.beginPath();path(ctx,lm,s,w,h,video);ctx.stroke()})}
  if(effect==="complexion"){const c=mp(lm[1],w,h,video),g=ctx.createRadialGradient(c.x,c.y,w*.06,c.x,c.y,w*.36);g.addColorStop(0,rgba(color,a*.18));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.fillRect(0,0,w,h)}
}
function drawMood(canvas,video,lm,mood){
  if(!mood){clearCanvas(canvas);return}
  const recipes={soft:[["blush","#D98B96",.42],["lips","#B9656B",.35],["eyes","#9A786F",.22]],confident:[["brows","#69483E",.48],["blush","#C77A72",.35],["lips","#A34F5D",.42]],bold:[["eyes","#6B526F",.55],["bronzer","#8D5E43",.45],["lips","#8F4052",.58]],chill:[["complexion","#D9A18A",.20],["blush","#D98B96",.24],["lips","#C87875",.22]]};
  const r=recipes[mood],base=fitCanvas(canvas,video);base.ctx.clearRect(0,0,base.w,base.h);
  const temp=document.createElement("canvas");temp.width=canvas.width;temp.height=canvas.height;
  r.forEach(([e,c,i])=>{drawMakeup(temp,video,lm,e,c,i);base.ctx.drawImage(temp,0,0,base.w,base.h);temp.getContext("2d").clearRect(0,0,temp.width,temp.height)});
}

if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
  try{
    const reg=await navigator.serviceWorker.register("./sw.js?v=16",{updateViaCache:"none"});
    await reg.update();
  }catch(err){
    console.error(err);
  }
});
}