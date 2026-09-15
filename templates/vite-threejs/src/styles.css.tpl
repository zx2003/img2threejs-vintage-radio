:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #302b27; background: #ded6ca; }
* { box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; margin: 0; overflow: hidden; }
canvas { display: block; width: 100%; height: 100%; cursor: grab; }
.hud { position: fixed; left: 20px; top: 20px; width: min(360px, calc(100vw - 40px)); padding: 16px 18px; border: 1px solid rgba(255,255,255,.55); border-radius: 16px; background: rgba(250,247,240,.84); box-shadow: 0 14px 40px rgba(65,45,28,.16); backdrop-filter: blur(12px); }
.hud h1 { margin: 0 0 6px; font-size: 20px; }
.hud p { margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: #665d55; }
.hud button { border: 0; border-radius: 9px; padding: 9px 13px; color: white; background: #765a43; cursor: pointer; }
.hud button:hover { background: #5f4634; }
