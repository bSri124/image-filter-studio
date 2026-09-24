const $=s=>document.querySelector(s);
const canvas=$("#canvas"), ctx=canvas.getContext("2d",{willReadFrequently:true});
const fileInput=$("#fileInput"), chooseBtn=$("#chooseBtn"), changeBtn=$("#changeBtn"), dropZone=$("#dropZone");
const editor=$("#editor"), downloadBtn=$("#downloadBtn"), resetBtn=$("#resetBtn"), emptyState=$("#emptyState");
const intensity=$("#intensity"), intensityValue=$("#intensityValue"), fileName=$("#fileName"), dimensions=$("#dimensions");
let source=null, currentFilter="original";

chooseBtn.onclick=()=>fileInput.click();
changeBtn.onclick=()=>fileInput.click();
dropZone.addEventListener("click",e=>{if(e.target!==chooseBtn) fileInput.click()});
["dragenter","dragover"].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove("drag")}));
dropZone.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f) loadFile(f)});
fileInput.onchange=e=>{if(e.target.files[0]) loadFile(e.target.files[0])};

document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));
  b.classList.add("active"); currentFilter=b.dataset.filter; render();
});
intensity.oninput=()=>{intensityValue.textContent=intensity.value+"%";render()};
resetBtn.onclick=()=>{currentFilter="original";intensity.value=100;intensityValue.textContent="100%";document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x.dataset.filter==="original"));render()};

function loadFile(file){
  if(!file.type.startsWith("image/")) return alert("Please choose an image file.");
  const reader=new FileReader();
  reader.onload=()=>{const img=new Image();img.onload=()=>{
    source=img; fileName.textContent=file.name; dimensions.textContent=`${img.naturalWidth} × ${img.naturalHeight}`;
    editor.classList.remove("hidden");dropZone.classList.add("hidden");downloadBtn.disabled=false;resetBtn.disabled=false;emptyState.classList.add("hidden");
    fitCanvas(img);render();
  };img.src=reader.result};reader.readAsDataURL(file);
}
function fitCanvas(img){
  const max=2400, scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
}
function baseImage(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.filter="none";ctx.globalAlpha=1;ctx.drawImage(source,0,0,canvas.width,canvas.height);
}
function mixWithOriginal(filtered,amount){
  const original=document.createElement("canvas");original.width=canvas.width;original.height=canvas.height;
  const o=original.getContext("2d");o.drawImage(source,0,0,canvas.width,canvas.height);
  ctx.globalAlpha=amount;ctx.drawImage(filtered,0,0);ctx.globalAlpha=1;
}
function render(){
  if(!source)return;
  baseImage();
  const a=Number(intensity.value)/100;
  if(currentFilter==="original")return;
  const temp=document.createElement("canvas");temp.width=canvas.width;temp.height=canvas.height;
  const t=temp.getContext("2d");
  t.drawImage(source,0,0,canvas.width,canvas.height);
  if(currentFilter==="enhance"){t.filter=`contrast(${1+0.28*a}) saturate(${1+0.24*a}) brightness(${1+0.06*a})`;t.drawImage(source,0,0,canvas.width,canvas.height)}
  else if(currentFilter==="grey"){t.filter=`grayscale(${a})`;t.drawImage(source,0,0,canvas.width,canvas.height)}
  else if(currentFilter==="bw"){t.filter=`grayscale(1) contrast(${1+0.65*a})`;t.drawImage(source,0,0,canvas.width,canvas.height)}
  else if(currentFilter==="sepia"){t.filter=`sepia(${a}) saturate(${1+0.15*a})`;t.drawImage(source,0,0,canvas.width,canvas.height)}
  else if(currentFilter==="warm"){t.filter=`sepia(${.22*a}) saturate(${1+.25*a}) contrast(${1+.08*a})`;t.drawImage(source,0,0,canvas.width,canvas.height)}
  else if(currentFilter==="cool"){t.filter=`saturate(${1+.12*a}) contrast(${1+.08*a})`;t.drawImage(source,0,0,canvas.width,canvas.height);t.globalCompositeOperation="screen";t.globalAlpha=.10*a;t.fillStyle="#3b6fa3";t.fillRect(0,0,canvas.width,canvas.height)}
  else if(currentFilter==="vintage"){t.filter=`sepia(${.35*a}) contrast(${1+.12*a}) saturate(${1-.18*a}) brightness(${1+.03*a})`;t.drawImage(source,0,0,canvas.width,canvas.height)}
  else if(currentFilter==="retro80"){t.filter=`contrast(${1+.22*a}) saturate(${1+.35*a})`;t.drawImage(source,0,0,canvas.width,canvas.height);t.globalCompositeOperation="screen";t.globalAlpha=.16*a;t.fillStyle="#ff4fa3";t.fillRect(0,0,canvas.width,canvas.height);t.globalCompositeOperation="multiply";t.fillStyle="#3856ff";t.globalAlpha=.08*a;t.fillRect(0,0,canvas.width,canvas.height)}
  else if(currentFilter==="dramatic"){t.filter=`contrast(${1+.55*a}) saturate(${1+.18*a}) brightness(${1-.08*a})`;t.drawImage(source,0,0,canvas.width,canvas.height)}
  else if(currentFilter==="bloom"){drawBloom(t,a);return}
  else if(currentFilter==="pixels"){drawPixels(t,a);return}
  t.globalAlpha=1;t.globalCompositeOperation="source-over";
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.globalAlpha=a;ctx.drawImage(temp,0,0);ctx.globalAlpha=1;
  if(a<1) mixWithOriginal(temp,1-a);
}
function drawBloom(t,a){
  t.drawImage(source,0,0,canvas.width,canvas.height);
  const blur=document.createElement("canvas");blur.width=canvas.width;blur.height=canvas.height;
  const b=blur.getContext("2d");b.filter=`blur(${Math.max(2,14*a)}px) brightness(${1+.15*a})`;b.drawImage(source,0,0,canvas.width,canvas.height);
  t.globalCompositeOperation="screen";t.globalAlpha=.52*a;t.drawImage(blur,0,0);t.globalAlpha=1;t.globalCompositeOperation="source-over";
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(t.canvas,0,0);
}
function drawPixels(t,a){
  const block=Math.max(3,Math.round(3+17*a));
  const w=Math.max(1,Math.floor(canvas.width/block)),h=Math.max(1,Math.floor(canvas.height/block));
  const small=document.createElement("canvas");small.width=w;small.height=h;
  const s=small.getContext("2d");s.imageSmoothingEnabled=true;s.drawImage(source,0,0,w,h);
  t.imageSmoothingEnabled=false;t.drawImage(s,0,0,canvas.width,canvas.height);
  ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(t.canvas,0,0);ctx.imageSmoothingEnabled=true;
}
downloadBtn.onclick=()=>{
  if(!source)return;
  const link=document.createElement("a");
  const safe=(fileName.textContent||"image").replace(/\.[^.]+$/,"");
  link.download=`${safe}-${currentFilter}.png`;link.href=canvas.toDataURL("image/png");link.click();
};
