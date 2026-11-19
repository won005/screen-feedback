export const styles = `
:host { all:initial; color-scheme:light; }
.sf-root { font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#22252c; pointer-events:none; --accent:#d92d35; }
*,*::before,*::after { box-sizing:border-box; }
button,input,textarea { font:inherit; }
button { border:0; cursor:pointer; color:inherit; }
button:disabled { cursor:default; opacity:.45; }
button:focus-visible,textarea:focus-visible,input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
button { touch-action:manipulation; }
svg { display:block; width:18px; height:18px; flex-shrink:0; }
.sf-toolbar { position:fixed; display:flex; align-items:center; gap:3px; padding:5px; border:1px solid #e5e5e8; border-radius:14px; box-shadow:0 8px 32px #11182724,0 2px 6px #11182710; background:#fff; pointer-events:auto; user-select:none; z-index:5; max-width:calc(100vw - 16px); }
.sf-grip { padding:7px 2px; color:#a0a3ab; cursor:grab; touch-action:none; background:transparent; }
.sf-grip:active,.sf-collapsed:active { cursor:grabbing; }
.sf-mode { display:flex; align-items:center; gap:8px; background:#f7f7f8; border-radius:9px; padding:8px 10px; white-space:nowrap; font-weight:600; }
.sf-switch { width:26px; height:16px; border-radius:20px; background:#c5c7ce; padding:2px; }
.sf-switch::after { content:""; display:block; width:12px; height:12px; background:white; border-radius:50%; box-shadow:0 1px 2px #0002; transition:transform .15s; }
.sf-mode[aria-pressed=true] .sf-switch { background:var(--accent); }
.sf-mode[aria-pressed=true] .sf-switch::after { transform:translateX(10px); }
.sf-icon { position:relative; width:32px; height:32px; display:flex; align-items:center; justify-content:center; border-radius:8px; background:transparent; color:#626771; }
.sf-icon:hover { background:#f0f1f3; }
.sf-icon[aria-pressed=true] { background:#fcecee; color:var(--accent); }
.sf-badge { position:absolute; top:-1px; right:-1px; display:flex; align-items:center; justify-content:center; min-width:15px; height:15px; padding:0 3px; border-radius:9px; background:var(--accent); color:#fff; font-size:9px; font-weight:700; }
.sf-divider { height:22px; width:1px; background:#ececf0; margin:0 3px; }
.sf-collapsed { position:fixed; display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:var(--accent); color:#fff; box-shadow:0 5px 18px #11182733; pointer-events:auto; touch-action:none; cursor:grab; z-index:5; }
.sf-collapsed[data-enabled=false] { background:#6b707b; }
.sf-pin { position:fixed; display:flex; align-items:center; justify-content:center; width:30px; height:30px; transform:translate(-5px,-25px); border-radius:50% 50% 50% 3px; background:var(--accent); border:2px solid white; color:#fff; font-size:11px; font-weight:700; box-shadow:0 2px 9px #11182730; pointer-events:auto; z-index:2; }
.sf-pin[data-selected=true] { outline:3px solid #d92d3530; }
.sf-pin[data-resolved=true] { background:#818692; }
.sf-panel { position:fixed; display:flex; flex-direction:column; width:360px; max-width:calc(100vw - 24px); max-height:min(560px,calc(100dvh - 24px)); background:#fff; border:1px solid #dddfe5; border-radius:12px; box-shadow:0 12px 40px #11182724,0 2px 8px #11182712; overflow:hidden; pointer-events:auto; z-index:4; }
.sf-panel-head { padding:11px 12px 10px 16px; display:flex; align-items:center; gap:8px; border-bottom:1px solid #eeeef2; flex-shrink:0; min-height:50px; }
.sf-panel-title { flex:1; margin:0; font-size:13px; font-weight:650; }
.sf-status { color:#6a707b; font-size:11px; }
.sf-body { overflow:auto; overscroll-behavior:contain; padding:0 16px; }
.sf-comment { padding:16px 0 12px; border-bottom:1px solid #f0f0f3; }
.sf-comment:last-child { border-bottom:0; }
.sf-author-row { display:flex; gap:8px; align-items:center; }
.sf-avatar { display:flex; align-items:center; justify-content:center; width:25px; height:25px; flex-shrink:0; border-radius:50%; background:#f4e6e6; color:#9e383e; font-size:10px; font-weight:600; object-fit:cover; }
.sf-name { font-weight:650; font-size:12px; }
.sf-time { color:#8c919a; font-size:11px; margin-left:auto; }
.sf-comment-copy { margin:9px 0 8px 33px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.55; }
.sf-images { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0; }
.sf-image { display:block; width:84px; height:70px; border:1px solid #e8e9ec; border-radius:7px; object-fit:cover; }
.sf-attachment { position:relative; }
.sf-remove-image { position:absolute; top:-5px; right:-5px; border:1px solid #ddd; border-radius:50%; background:white; width:20px; height:20px; display:grid; place-items:center; }
.sf-remove-image svg { width:12px; height:12px; }
.sf-like { margin-left:33px; display:flex; gap:5px; align-items:center; border:1px solid #e8e9ed; background:#fff; border-radius:12px; padding:3px 7px; color:#7c818d; font-size:11px; }
.sf-like svg { width:12px; height:12px; }
.sf-like[aria-pressed=true] { color:var(--accent); background:#fff0f1; border-color:#f1cdd0; }
.sf-composer { border-top:1px solid #e9eaf0; padding:12px; background:#fcfcfd; flex-shrink:0; }
.sf-textarea { display:block; width:100%; min-height:62px; max-height:170px; resize:vertical; padding:8px; border:1px solid #e3e4e9; border-radius:8px; color:#22252c; background:#fff; }
.sf-textarea::placeholder { color:#999ea8; }
.sf-composer-bottom { display:flex; align-items:center; gap:3px; margin-top:7px; }
.sf-send { margin-left:auto; display:flex; gap:6px; align-items:center; justify-content:center; border-radius:7px; padding:7px 10px; background:var(--accent); color:#fff; font-size:12px; font-weight:600; }
.sf-send svg { width:14px; height:14px; }
.sf-note { color:#8c919a; font-size:10px; margin:0 0 7px; }
.sf-editing { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-size:12px; }
.sf-editing button { background:transparent; color:#7b818c; }
.sf-menu { margin:0 12px 8px; padding:4px; border:1px solid #e6e7eb; border-radius:8px; background:#fff; box-shadow:0 3px 12px #0001; }
.sf-menu button { display:block; width:100%; text-align:left; background:transparent; border-radius:5px; padding:8px; }
.sf-menu button:hover { background:#f6f6f8; }
.sf-danger { color:#ce2933; }
.sf-confirm { padding:14px 16px; background:#fff4f4; border-top:1px solid #f4d7d9; }
.sf-confirm p { margin:0 0 10px; }
.sf-confirm-actions { display:flex; gap:6px; justify-content:flex-end; }
.sf-confirm button { padding:7px 11px; border-radius:6px; background:white; border:1px solid #e6d5d6; }
.sf-confirm .sf-danger { background:#d92d35; border-color:#d92d35; color:white; }
.sf-empty { padding:26px 16px; text-align:center; color:#8b909a; font-size:12px; }
.sf-list { overflow:auto; padding:5px; }
.sf-list-item { display:flex; gap:10px; width:100%; padding:11px; text-align:left; background:#fff; border-radius:8px; }
.sf-list-item:hover { background:#f7f7f9; }
.sf-list-item[data-unread=true] { background:#fff4f5; }
.sf-list-copy { flex:1; min-width:0; }
.sf-list-copy strong { display:block; font-size:12px; }
.sf-list-copy p { margin:3px 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:#737986; }
.sf-list-copy small { font-size:10px; color:#999da6; }
.sf-error { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); max-width:calc(100vw - 24px); display:flex; align-items:center; gap:10px; padding:10px 12px; background:#fff; border:1px solid #e7c9cc; border-radius:9px; box-shadow:0 4px 16px #0002; color:#aa333c; pointer-events:auto; z-index:10; font-size:12px; }
.sf-error button { padding:5px 8px; border-radius:5px; background:#fff0f1; color:#aa333c; white-space:nowrap; }
.sf-members { max-height:150px; overflow:auto; border:1px solid #e1e3e8; border-radius:7px; padding:3px; margin-bottom:7px; background:white; }
.sf-member { display:flex; align-items:center; gap:8px; width:100%; background:white; padding:6px; text-align:left; border-radius:5px; }
.sf-member:hover { background:#f7f7f9; }
.sf-loading { padding:8px; text-align:center; color:#8b909a; font-size:11px; }
@media(prefers-reduced-motion:reduce) { * { transition:none !important; } }
.sf-controls { display:contents; }
.sf-panel { width:320px; max-height:min(440px,calc(100dvh - 24px)); }
.sf-panel-head { min-height:42px; padding:5px 7px 5px 12px; gap:4px; }
.sf-panel-title { font-size:12px; }
.sf-panel-grip { width:16px; height:28px; padding:0; flex-shrink:0; }
.sf-panel-grip svg { width:12px; height:12px; }
.sf-body { padding:0 12px; scrollbar-width:thin; }
.sf-comment { padding:12px 0 8px; }
.sf-comment-copy { font-size:12px; margin:6px 0 4px 33px; }
.sf-comment-actions { display:flex; align-items:center; gap:5px; margin-left:33px; }
.sf-comment-actions .sf-like { margin:0; border:0; border-radius:5px; background:transparent; padding:3px; min-height:26px; }
.sf-comment-action { display:grid; place-items:center; background:transparent; width:26px; height:26px; padding:3px; border-radius:5px; color:#8b9099; }
.sf-comment-action:hover,.sf-comment-actions .sf-like:hover { background:#f3f3f5; }
.sf-comment-action svg { width:13px; height:13px; }
.sf-composer { padding:10px 12px; }
.sf-textarea { min-height:42px; resize:vertical; }
.sf-textarea::placeholder { font-size:12px; }
.sf-photo-preview { padding:0; background:transparent; border-radius:7px; cursor:zoom-in; }
.sf-photo-viewer { position:fixed; inset:0; z-index:20; display:grid; grid-template-rows:44px minmax(0,1fr); padding:12px; gap:8px; background:#101216f5; color:white; pointer-events:auto; }
.sf-photo-header { display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; }
.sf-photo-header span { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sf-photo-close { display:grid; place-items:center; width:44px; height:44px; flex-shrink:0; border-radius:50%; background:#ffffff20; color:white; }
.sf-photo-stage { display:flex; align-items:center; justify-content:center; min-height:0; min-width:0; }
.sf-photo-full { display:block; width:100%; height:100%; min-width:0; min-height:0; object-fit:contain; }
@media(max-width:480px) { .sf-panel { width:300px; } }
@media(pointer:coarse) { .sf-textarea { font-size:16px; } .sf-comment-action,.sf-comment-actions .sf-like { min-width:36px; min-height:36px; } }
`;
