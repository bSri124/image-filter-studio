/* v5: classic script on purpose. No module import runs before upload. */
(function(){
"use strict";

var $=function(id){return document.getElementById(id)};
var fileInput=$("fileInput"), preview=$("preview"), pctx=preview.getContext("2d");
var status=$("status"), loadAI=$("loadAI"), processBtn=$("process"), downloadBtn=$("download");
var depth=$("depth"), edge=$("edge"), preset=$("preset"), showMask=$("showMask");

var image=null, working=null, finalCanvas=null, multiSegmenter=null, hairSegmenter=null, multiMask=null, busy=false;

function setStatus(t){status.textContent=t}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function lerp(a,b,t){return a+(b-a)*t}

function showImage(file){
  setStatus("Opening photo…");
  var reader=new FileReader();
  reader.onload=function(){
    var img=new Image();
    img.onload=function(){
      image=img;
      var max=1400, s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
      working=document.createElement("canvas");
      working.width=Math.max(1,Math.round(img.naturalWidth*s));
      working.height=Math.max(1,Math.round(img.naturalHeight*s));
      working.getContext("2d").drawImage(img,0,0,working.width,working.height);
      preview.width=working.width; preview.height=working.height;
      pctx.clearRect(0,0,preview.width,preview.height);
      pctx.drawImage(working,0,0);
      loadAI.disabled=false;
      setStatus("PHOTO LOADED ✓  "+img.naturalWidth+" × "+img.naturalHeight);
    };
    img.onerror=function(){setStatus("Browser could not decode this image.")};
    img.src=reader.result;
  };
  reader.onerror=function(){setStatus("Could not read the selected file.")};
  reader.readAsDataURL(file);
}

fileInput.addEventListener("change",function(e){
  var f=e.target.files && e.target.files[0];
  if(f) showImage(f);
});

loadAI.addEventListener("click",async function(){
  if(!image)return;
  loadAI.disabled=true;
  setStatus("Loading Portrait AI library…");
  try{
    var mod=await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm");
    var vision=await mod.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    multiSegmenter=await mod.ImageSegmenter.createFromOptions(vision,{
      baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"},
      runningMode:"IMAGE",outputCategoryMask:true,outputConfidenceMasks:true
    });
    hairSegmenter=await mod.ImageSegmenter.createFromOptions(vision,{
      baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite"},
      runningMode:"IMAGE",outputCategoryMask:true,outputConfidenceMasks:true
    });
    processBtn.disabled=false;
    setStatus("Portrait AI ready. Tap Apply Portrait.");
  }catch(err){
    console.error(err);
    loadAI.disabled=false;
    setStatus("AI load failed. PHOTO UPLOAD IS WORKING. Check browser console/network.");
  }
});

function readMask(m){return m?{w:m.width,h:m.height,a:new Float32Array(m.getAsFloat32Array())}:null}
function buildMask(r,hr){
  var ms=r.confidenceMasks||[];
  if(ms.length<6)throw Error("Expected 6 portrait classes, got "+ms.length);
  var m=ms.map(readMask),w=m[0].w,h=m[0].h,out=new Float32Array(w*h),ep=+edge.value/100;
  var hm=hr&&hr.confidenceMasks&&hr.confidenceMasks[0]?readMask(hr.confidenceMasks[0]):null;
  for(var i=0;i<out.length;i++){
    var v=Math.max(m[1].a[i],m[2].a[i],m[3].a[i],m[4].a[i],m[5].a[i]*lerp(1,1.16,ep));
    if(hm&&hm.w===w&&hm.h===h)v=Math.max(v,hm.a[i]*lerp(.98,1.12,ep));
    out[i]=clamp(v,0,1);
  }
  return {w:w,h:h,a:out};
}
function maskCanvas(m){
  var c=document.createElement("canvas");c.width=m.w;c.height=m.h;
  var x=c.getContext("2d"),d=x.createImageData(m.w,m.h);
  for(var i=0;i<m.a.length;i++){var a=Math.round(m.a[i]*255);d.data[i*4]=255;d.data[i*4+1]=255;d.data[i*4+2]=255;d.data[i*4+3]=a}
  x.putImageData(d,0,0);return c;
}
function refined(c,w,h){
  var ep=+edge.value/100,b=lerp(2.4,.65,ep),o=document.createElement("canvas");o.width=w;o.height=h;
  var x=o.getContext("2d");x.filter="blur("+b+"px)";x.drawImage(c,0,0,w,h);x.filter="none";
  var d=x.getImageData(0,0,w,h);for(var i=0;i<d.data.length;i+=4){var a=d.data[i+3]/255;d.data[i+3]=Math.round((a>.78?1:a)*255)}
  x.putImageData(d,0,0);return o;
}
function bgBlur(src,w,h,amount){
  var c=document.createElement("canvas");c.width=w;c.height=h;var x=c.getContext("2d");
  var passes=Math.max(1,Math.ceil(amount/16)),r=Math.min(16,amount/passes);x.filter="blur("+r+"px)";
  for(var i=0;i<passes;i++)x.drawImage(src,0,0,w,h);x.filter="none";return c;
}
function render(){
  if(!working||!multiMask)return;
  var w=working.width,h=working.height,alpha=refined(maskCanvas(multiMask),w,h);
  if(showMask.checked){
    pctx.drawImage(working,0,0);var o=document.createElement("canvas");o.width=w;o.height=h;
    var x=o.getContext("2d");x.fillStyle="#26e6a1";x.globalAlpha=.4;x.fillRect(0,0,w,h);x.globalCompositeOperation="destination-in";x.drawImage(alpha,0,0);pctx.drawImage(o,0,0);finalCanvas=working;return;
  }
  var bg=bgBlur(working,w,h,lerp(2,34,+depth.value/100)),fg=document.createElement("canvas");fg.width=w;fg.height=h;
  var f=fg.getContext("2d");f.drawImage(working,0,0);f.globalCompositeOperation="destination-in";f.drawImage(alpha,0,0);
  var out=document.createElement("canvas");out.width=w;out.height=h;var x=out.getContext("2d");x.drawImage(bg,0,0);x.drawImage(fg,0,0);
  finalCanvas=out;pctx.clearRect(0,0,w,h);pctx.drawImage(out,0,0);
}
processBtn.addEventListener("click",function(){
  if(!image||!multiSegmenter||busy)return;busy=true;processBtn.disabled=true;
  setStatus("Analyzing hair, face and accessory edges…");
  try{
    var r=multiSegmenter.segment(working),hr=hairSegmenter.segment(working);multiMask=buildMask(r,hr);
    if(r.close)r.close();if(hr.close)hr.close();render();downloadBtn.disabled=false;setStatus("Ready — test hair spikes, glasses and nearby objects.");
  }catch(e){console.error(e);setStatus("Portrait processing failed: "+e.message)}
  finally{processBtn.disabled=false;busy=false}
});
[depth,edge,preset].forEach(function(el){el.addEventListener("input",function(){
  $("depthValue").textContent=depth.value+"%";var e=+edge.value;$("edgeValue").textContent=e>70?"High":e>40?"Medium":"Low";$("presetValue").textContent=preset.options[preset.selectedIndex].text;
  if(multiMask)render();
})});
showMask.addEventListener("change",function(){if(multiMask)render()});
downloadBtn.addEventListener("click",function(){if(!finalCanvas)return;var a=document.createElement("a");a.download="portrait-draft-v5.jpg";a.href=finalCanvas.toDataURL("image/jpeg",.94);a.click()});
setStatus("Choose a photo to begin.");
})();
