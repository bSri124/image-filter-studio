/* Portrait upload module.
   IMPORTANT: this file contains NO AI imports.
   The photo must work even when every AI/CDN resource is unavailable. */

(function(){
  "use strict";

  const file = document.getElementById("portraitFile");
  const canvas = document.getElementById("portraitCanvas");
  const ctx = canvas.getContext("2d");
  const status = document.getElementById("portraitStatus");
  const loadAI = document.getElementById("loadPortraitAI");
  const apply = document.getElementById("applyPortrait");
  const download = document.getElementById("downloadPortrait");

  let sourceCanvas = null;
  let finalCanvas = null;

  function statusText(text){
    status.textContent = text;
  }

  file.addEventListener("change", function(event){
    const selected = event.target.files && event.target.files[0];
    if(!selected) return;

    statusText("Opening photo…");

    const reader = new FileReader();

    reader.onload = function(){
      const img = new Image();

      img.onload = function(){
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));

        sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = Math.round(img.naturalWidth * scale);
        sourceCanvas.height = Math.round(img.naturalHeight * scale);

        sourceCanvas.getContext("2d").drawImage(
          img, 0, 0, sourceCanvas.width, sourceCanvas.height
        );

        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sourceCanvas, 0, 0);

        loadAI.disabled = false;
        statusText(
          "PHOTO LOADED ✓  " +
          img.naturalWidth + " × " + img.naturalHeight
        );
      };

      img.onerror = function(){
        statusText("Could not decode this image.");
      };

      img.src = reader.result;
    };

    reader.onerror = function(){
      statusText("Could not read the selected file.");
    };

    reader.readAsDataURL(selected);
  });

  /* AI intentionally comes later.
     We'll put portrait-model.js here once upload is confirmed. */

  loadAI.addEventListener("click", function(){
    statusText("Portrait AI module will be loaded here.");
    apply.disabled = false;
  });

  apply.addEventListener("click", function(){
    if(!sourceCanvas) return;

    /*
      Temporary preview only.
      The real segmentation engine will be added as a separate file:
      portrait-model.js

      This keeps upload, UI and AI independently testable.
    */
    finalCanvas = document.createElement("canvas");
    finalCanvas.width = sourceCanvas.width;
    finalCanvas.height = sourceCanvas.height;

    finalCanvas.getContext("2d").drawImage(sourceCanvas, 0, 0);

    ctx.drawImage(finalCanvas, 0, 0);
    download.disabled = false;
    statusText("Upload pipeline works. AI segmentation module is next.");
  });

  download.addEventListener("click", function(){
    if(!finalCanvas) return;
    const a = document.createElement("a");
    a.download = "portrait-test.jpg";
    a.href = finalCanvas.toDataURL("image/jpeg", .94);
    a.click();
  });
})();
