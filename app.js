let FaceLandmarker=null, FilesetResolver=null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const PASSCODE = "071079";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

// Le verrouillage est volontairement géré dans index.html afin qu'il fonctionne
// même si MediaPipe ou son CDN met du temps à charger sur iPhone.

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
    await prepareAnalysisCamera();
    await initLandmarker();
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
  if(!FaceLandmarker || !FilesetResolver){
    const visionModule=await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm");
    FaceLandmarker=visionModule.FaceLandmarker;
    FilesetResolver=visionModule.FilesetResolver;
  }
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

async function requestFrontCamera(){
  if(!window.isSecureContext){
    throw new Error("HTTPS_REQUIRED");
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    throw new Error("CAMERA_UNSUPPORTED");
  }

  // IMPORTANT iPhone/Safari: this call is made directly from the tap handler,
  // before MediaPipe loading or any screen transition.
  const newStream=await navigator.mediaDevices.getUserMedia({
    video:{
      facingMode:{ideal:"user"},
      width:{ideal:480,max:720},
      height:{ideal:640,max:960},
      frameRate:{ideal:24,max:30}
    },
    audio:false
  });

  if(stream && stream!==newStream){
    try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
  }
  stream=newStream;
  return stream;
}

async function prepareAnalysisCamera(){
  const analysisVideo=$("#analysisVideo");
  if(!stream || !stream.getVideoTracks().some(t=>t.readyState==="live")){
    await requestFrontCamera();
  }
  analysisVideo.srcObject=stream;
  analysisVideo.setAttribute("playsinline","");
  analysisVideo.muted=true;
  await analysisVideo.play();
}

async function startCamera(){
  await prepareAnalysisCamera();
  await initLandmarker();
}
$("#beginAnalysisButton").addEventListener("click",async()=>{
  const button=$("#beginAnalysisButton");
  const status=$("#cameraPermissionStatus");

  button.disabled=true;
  button.textContent="Autorisation caméra…";
  status.className="camera-permission-status";
  status.textContent="Safari doit maintenant te demander l’accès à la caméra.";

  try{
    // getUserMedia first: this preserves the direct user gesture on iPhone.
    await prepareAnalysisCamera();

    status.className="camera-permission-status ok";
    status.textContent="Caméra autorisée ✓";

    $("#analysisIntro").classList.add("hidden");
    $("#analysisProgress").classList.remove("hidden");
    $("#analysisProgressTitle").textContent="Chargement de l’analyse…";
    $("#analysisProgressText").textContent="La caméra est active. Préparation de l’analyse du visage.";

    await initLandmarker();

    stableFrames=0;
    savedAnalysis=null;
    capturing=false;
    lastTime=-1;
    liveRunning=false;

    $("#analysisProgressTitle").textContent="Détection du visage";
    $("#analysisProgressText").textContent="Regarde droit devant toi et reste immobile quelques secondes.";
    $("#analysisGuide").textContent="Place ton visage face caméra";

    const loopId=++analysisLoopId;
    analyzeLoop(loopId);
  }catch(e){
    console.error("Camera permission / analysis startup error",e);

    button.disabled=false;
    button.textContent="Réessayer la caméra";
    status.className="camera-permission-status error";

    if(e?.name==="NotAllowedError" || e?.name==="PermissionDeniedError"){
      status.textContent="Accès caméra refusé. Sur iPhone : Réglages > Safari > Caméra, puis autorise ce site et réessaie.";
    }else if(e?.name==="NotFoundError" || e?.name==="DevicesNotFoundError"){
      status.textContent="Aucune caméra frontale n’a été trouvée.";
    }else if(e?.message==="HTTPS_REQUIRED"){
      status.textContent="La caméra nécessite l’adresse HTTPS de GitHub Pages.";
    }else if(e?.message==="CAMERA_UNSUPPORTED"){
      status.textContent="Ce navigateur ne donne pas accès à la caméra. Ouvre l’app dans Safari.";
    }else{
      status.textContent="La caméra n’a pas pu démarrer. Ferme l’app, rouvre-la dans Safari puis réessaie.";
    }

    // Stay on preparation screen instead of leaving the app in an impossible analysis state.
    $("#analysisProgress").classList.add("hidden");
    $("#analysisIntro").classList.remove("hidden");
  }finally{
    if(stream && stream.getVideoTracks().some(t=>t.readyState==="live")){
      button.disabled=false;
    }
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
  $("#faceAdvice").textContent=faceAdvice(a);
  $("#eyeAdvice").textContent=eyeAdvice(a);
  $("#lipAdvice").textContent=lipAdvice(a);
  $("#colorAdvice").textContent=colorAdvice(a);
  $("#structureAdvice").textContent=structureAdvice(a);
  updateMakeupStyleRanking(a);
  $("#profileAnalysis").textContent=`Visage ${a.faceShape} · yeux ${a.eyeShape} · mâchoire ${a.jaw}.`;
  $("#profileColor").innerHTML=`Peau ${colorPill(a.skinName,a.skinHex)} · sous-ton ${a.undertone} · contraste ${a.contrast}.`;
  $("#palette").innerHTML=recommendPalette(a).map(c=>`<span class="palette-swatch" style="background:${c}"></span>`).join("");
  renderMirrorZone();
}
function faceAdvice(a){
  if(a.faceShape==="rond") return "Privilégie des placements légèrement remontants : blush étiré vers les tempes et bronzer discret sur les côtés pour structurer sans durcir.";
  if(a.faceShape==="allongé") return "Les placements plus horizontaux fonctionnent bien : blush moins haut et bronzer léger sur le haut du front et le bas du menton pour rééquilibrer la longueur.";
  if(a.faceShape==="carré") return "Les placements souples et diffus peuvent adoucir les angles : blush arrondi et bronzer estompé autour des tempes et de la mâchoire.";
  if(a.faceShape==="cœur") return "Un blush centré puis légèrement étiré et un bronzer doux sur les tempes peuvent équilibrer le haut du visage et le menton.";
  return "Ta morphologie est équilibrée : tu peux garder des placements naturels et jouer davantage sur le style recherché que sur une correction forte.";
}
function eyeAdvice(a){
  const tilt=a.eyeTilt||"";
  if(tilt.includes("relev")) return "Ton regard accepte très bien les styles étirés : liner fin, siren eyes doux, fards tirés vers l’extérieur et coin externe légèrement intensifié.";
  if(tilt.includes("descend")) return "Un placement remontant fonctionne bien : liner qui se relève avant le coin externe, fard plus haut sur l’extérieur et lumière au centre de la paupière.";
  if(a.eyeShape==="rond") return "Pour allonger le regard : liner fin du milieu vers l’extérieur, fard étiré et intensité concentrée sur le coin externe.";
  return "Ton regard est polyvalent : soft glam, halo eye léger, liner fin ou smoky diffus peuvent fonctionner selon l’intensité souhaitée.";
}
function lipAdvice(a){
  if(a.lipVolume==="plein") return "Les textures satinées ou glossy mettent naturellement le volume en valeur. Un contour très léger suffit pour garder un résultat naturel.";
  if(a.lipVolume==="fin") return "Un crayon très proche de la teinte naturelle, légèrement fondu vers l’intérieur, puis une texture satinée peut donner plus de relief sans effet artificiel.";
  if(a.lipWidth==="large") return "Les teintes monochromes et les dégradés doux fonctionnent bien. Le contour peut rester discret pour conserver l’équilibre naturel.";
  return "Un contour doux et une texture satinée ou brillante peuvent souligner la forme sans la modifier fortement.";
}
function colorAdvice(a){
  if(a.undertone==="chaud") return "Privilégie les familles pêche, terracotta doux, caramel, bronze chaud, brun doré et nude chaud. Évite surtout les tons très froids s’ils grisent le teint.";
  if(a.undertone==="froid") return "Les roses froids, bois de rose, mauves, prunes douces et bruns froids devraient mieux respecter ta colorimétrie.";
  if(a.undertone==="olive") return "Les tons terre, bronze neutre, rose brun, pêche sourd et kaki doux sont souvent particulièrement harmonieux sur un sous-ton olive.";
  return "Les tons neutres sont une bonne base : rose naturel, brun doux, beige rosé et bronze neutre. Tu peux ensuite aller plus chaud ou plus froid selon le look.";
}
function structureAdvice(a){
  return `Front ${a.forehead}, mâchoire ${a.jaw}, menton ${a.chinShape}. Ces éléments servent surtout à déterminer où placer le blush et le bronzer, sans chercher à masquer ta morphologie.`;
}
function updateMakeupStyleRanking(a){
  const cards=[...document.querySelectorAll("#makeupStyles .makeup-style-card")];
  const score={};
  score["Soft Glam"]=8;
  score["No-Makeup Makeup"]=8;
  score["Clean Girl"]=7;
  score["Bronzy"]=a.undertone==="chaud"||a.undertone==="olive"?9:6;
  score["Latte Makeup"]=a.undertone==="chaud"||a.undertone==="olive"?9:5;
  score["Cold Girl"]=a.undertone==="froid"?9:5;
  score["Siren Eyes"]=a.eyeTilt?.includes("relev")||a.eyeShape?.includes("amande")?9:6;
  score["Douyin Soft"]=a.contrastLabel==="doux"||a.eyeShape==="rond"?8:6;
  cards.forEach(card=>{
    const name=card.querySelector("strong")?.textContent||"";
    const badge=card.querySelector("em");
    const s=score[name]||6;
    badge.textContent=s>=9?"Top pour toi ✨":s>=8?"Très compatible":s>=7?"Compatible":"À essayer";
    card.dataset.score=s;
  });
  cards.sort((a,b)=>(Number(b.dataset.score)||0)-(Number(a.dataset.score)||0)).forEach(card=>document.querySelector("#makeupStyles").appendChild(card));
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



const PREVIEW_FACE_IMAGE="data:image/jpeg;base64,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";
const PREVIEW_BROWS_IMAGE="data:image/jpeg;base64,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";
let selectedBrowThickness="medium";

const analysisPreview=$("#analysisPreview");
const analysisPreviewTitle=$("#analysisPreviewTitle");
const analysisPreviewVisual=$("#analysisPreviewVisual");
const analysisPreviewText=$("#analysisPreviewText");
const analysisPreviewTag=$("#analysisPreviewTag");

const browPreviewData={
  recommended:{
    title:"Forme recommandée",
    kind:"soft",
    text:"La forme recommandée dépend de ton analyse. L’aperçu sert à comparer clairement la forme et l’épaisseur."
  },
  straight:{
    title:"Droit doux",
    kind:"straight",
    text:"Une ligne presque horizontale avec très peu d’arc. Elle donne un rendu doux et graphique."
  },
  soft:{
    title:"Soft Arch",
    kind:"soft",
    text:"Un arc léger et progressif, sans cassure marquée. Il structure le regard tout en restant naturel."
  },
  natural:{
    title:"Arc naturel",
    kind:"natural",
    text:"Une courbe proche de la ligne naturelle du sourcil, avec une montée modérée et une queue douce."
  },
  lift:{
    title:"Lift léger",
    kind:"lift",
    text:"Une queue légèrement remontée pour ouvrir visuellement le regard sans créer un arc trop prononcé."
  }
};

const lookPreviewData={
  soft:{title:"Soft Glam",text:"Teint lumineux, dégradés doux sur les yeux, blush fondu et lèvres équilibrées."},
  latte:{title:"Latte Makeup",text:"Bruns, caramel et beige chaud utilisés de manière presque monochrome sur les yeux, les joues et les lèvres."},
  clean:{title:"Clean Girl",text:"Peau fraîche, sourcils propres, blush discret, lèvres glossy et yeux très légers."},
  siren:{title:"Siren Eyes",text:"Le regard est étiré horizontalement avec les ombres et le liner dirigés vers l’extérieur."},
  douyin:{title:"Douyin Soft",text:"Teint lumineux, blush délicat, yeux détaillés et points de lumière pour un résultat doux et travaillé."},
  bronzy:{title:"Bronzy",text:"Bronzer plus présent, tons terreux ou dorés et effet soleil pour donner chaleur et relief."},
  cold:{title:"Cold Girl",text:"Blush rose frais sur les joues et légèrement sur le nez, avec des tons froids et rosés."},
  nomakeup:{title:"No-Makeup Makeup",text:"Correction minimale, texture de peau conservée et couleurs très proches des teintes naturelles."}
};

function thicknessLabel(value){
  if(value==="thin") return "fine";
  if(value==="medium") return "moyenne";
  if(value==="thick") return "épaisse";
  return "très épaisse";
}


function showAnalysisPreview(){
  analysisPreview.classList.remove("hidden");
  document.body.classList.add("preview-open");
  const sheet=analysisPreview.querySelector(".analysis-preview-sheet");
  if(sheet) sheet.scrollTop=0;
  requestAnimationFrame(()=>$("#analysisPreviewClose")?.focus({preventScroll:true}));
}
function hideAnalysisPreview(){
  analysisPreview.classList.add("hidden");
  document.body.classList.remove("preview-open");
}

function openBrowPreview(key){
  const d=browPreviewData[key];
  if(!d) return;

  analysisPreviewTitle.textContent=d.title;
  const kind=d.kind||"soft";

  analysisPreviewVisual.innerHTML=`
    <div class="real-preview-frame brows">
      <img src="${PREVIEW_BROWS_IMAGE}" alt="Aperçu réaliste de sourcils">
      <div class="real-brow-overlay ${kind} ${selectedBrowThickness}">
        <span class="brow-stroke left"></span>
        <span class="brow-stroke right"></span>
      </div>
    </div>`;

  analysisPreviewText.textContent=
    d.text+" Épaisseur affichée : "+thicknessLabel(selectedBrowThickness)+".";
  analysisPreviewTag.textContent="Forme + épaisseur";
  showAnalysisPreview();
}

function openLookPreview(key){
  const d=lookPreviewData[key];
  if(!d) return;

  analysisPreviewTitle.textContent=d.title;
  analysisPreviewVisual.innerHTML=`
    <div class="real-preview-frame makeup">
      <img src="${PREVIEW_FACE_IMAGE}" alt="Aperçu réaliste du style ${d.title}">
      <div class="real-makeup-overlay ${key}">
        <span class="eye-shadow left"></span>
        <span class="eye-shadow right"></span>
        <span class="blush left"></span>
        <span class="blush right"></span>
        <span class="bronze left"></span>
        <span class="bronze right"></span>
        <span class="lip-tint"></span>
      </div>
    </div>`;

  analysisPreviewText.textContent=d.text;
  analysisPreviewTag.textContent="Aperçu sur visage réaliste";
  showAnalysisPreview();
}

$$(".brow-thickness-options .thickness-chip").forEach(btn=>{
  btn.addEventListener("click",()=>{
    selectedBrowThickness=btn.dataset.thickness;
    $$(".brow-thickness-options .thickness-chip").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");

    const selected=$(".brow-options .analysis-chip.active");
    if(selected) openBrowPreview(selected.dataset.brow);
  });
});

$$(".brow-options .analysis-chip").forEach(btn=>{
  btn.addEventListener("click",()=>{
    $$(".brow-options .analysis-chip").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    openBrowPreview(btn.dataset.brow);
  });
});

$$("#makeupStyles .makeup-style-card").forEach(card=>{
  card.addEventListener("click",()=>openLookPreview(card.dataset.look));
});

$("#analysisPreviewClose").addEventListener("click",()=>{
  hideAnalysisPreview();
});

analysisPreview.addEventListener("click",e=>{
  if(e.target===analysisPreview){
    hideAnalysisPreview();
  }
});

if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
  try{
    const reg=await navigator.serviceWorker.register("./sw.js?v=23",{updateViaCache:"none"});
    await reg.update();
  }catch(err){
    console.error(err);
  }
});
}