/* Daily Brick: "Make today's reel" (owner only).
   Draws a 15-second vertical video (1080x1920) from the real wall today, with original music,
   records it on the phone and lets the owner share or save it. Loaded only when the button is tapped. */
(function () {
  'use strict';
  var W = 1080, H = 1920, DUR = 15, FPS = 30;
  var C = { bg: '#0b1d26', panel: '#10303b', line: '#24505c', ink: '#f1f7f4', muted: '#8fb3b5', coral: '#ff9a62', coralInk: '#3a1406', mint: '#5fd6c4', gold: '#e8be5c', red: '#c62f3b', snow: '#f0f6fc' };
  var COUNTS = [[1000, 'First 1,000 bricks'], [10000, '10,000 bricks'], [100000, '100,000 bricks'], [1e6, 'Section 1 complete'], [1e7, '10 million bricks'], [1e9, '1 billion bricks'], [23e9, 'Longer than the Great Wall']];
  var THEMES = ['today', 'messages', 'streaks', 'progress'];
  var THEME_NAMES = { today: 'Today on the wall', messages: 'Written on the wall', streaks: 'Streak watch', progress: 'How far we’ve come' };
  var st = null;

  function xmas() { var d = new Date(Date.now() + 2 * 3600e3), m = d.getUTCMonth() + 1, day = d.getUTCDate(); return (m === 11 && day >= 15) || m === 12 || (m === 1 && day <= 6) || /[?&]xmas=1/.test(location.search); }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeOut(x) { x = clamp(x); return 1 - Math.pow(1 - x, 3); }
  function prog(t, a, d) { return clamp((t - a) / d); }
  function fmt(n) { return Math.round(n).toLocaleString('en-ZA').replace(/ /g, ' '); }
  function lengthText(total) { var m = total * 921 / 1e6; return m < 1000 ? m.toFixed(1) + ' m' : (m / 1000).toFixed(1) + ' km'; }
  function todayText() { return new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function lightColor(hex) { var n = parseInt(String(hex || '#888888').slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 > 0.78; }

  /* ---------- data ---------- */
  async function loadData(sb) {
    var d = { total: 0, today: 0, builders: 0, users: 0, best: 0, top: [], recent: [] };
    try { var o = await sb.rpc('owner_stats'); if (o.data) { d.total = Number(o.data.wall_total) || 0; d.today = Number(o.data.bricks_today) || 0; d.builders = Number(o.data.builders_today) || 0; d.users = Number(o.data.users) || 0; d.best = Number(o.data.best_streak) || 0; } } catch (e) {}
    if (!d.total) { try { var s = await sb.from('wall_stats').select('total_bricks').eq('id', 1).single(); if (s.data) d.total = Number(s.data.total_bricks) || 0; } catch (e) {} }
    try { var t = await sb.rpc('top_streaks'); if (t.data && t.data.top) d.top = t.data.top.slice(0, 3); } catch (e) {}
    try { var r = await sb.from('bricks').select('color,finish,message,placed_on').order('id', { ascending: false }).limit(80); d.recent = (r.data || []).reverse(); } catch (e) {}
    if (!d.recent.length) d.recent = [{ color: '#d9714e' }, { color: '#5fa3b0' }, { color: '#d4a76a' }];
    var seen = {}; d.messages = d.recent.slice().reverse().filter(function (b) { var k = (b.message || '').toUpperCase(); if (!k || seen[k]) return false; seen[k] = 1; return true; }).slice(0, 3);
    return d;
  }

  /* ---------- drawing ---------- */
  function font(w, size, fam) { return w + ' ' + size + 'px ' + (fam === 'c' ? 'Cinzel, Georgia, serif' : fam === 'm' ? '"IBM Plex Mono", monospace' : 'Figtree, system-ui, sans-serif'); }
  function text(g, s, x, y, f, col, a, align) { if (a <= 0) return; g.save(); g.globalAlpha = a; g.font = f; g.fillStyle = col; g.textAlign = align || 'center'; g.textBaseline = 'top'; g.fillText(s, x, y, W - 80); g.restore(); }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function brick(g, x, y, w, h, b, a) {
    if (a <= 0) return;
    g.save(); g.globalAlpha = a;
    var col = b.finish === 'gold' ? '#d9a93b' : (b.color || '#d9714e');
    rrect(g, x, y, w, h, Math.max(3, h * 0.08)); g.fillStyle = col; g.fill();
    g.save(); rrect(g, x, y, w, h, Math.max(3, h * 0.08)); g.clip();
    if (window.__dbPaintFestive) window.__dbPaintFestive(g, x, y, w, h, b.finish, col);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x, y, w, h * 0.12);
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + h * 0.86, w, h * 0.14);
    g.restore();
    if (b.message) {
      g.font = font('700', Math.round(h * 0.38)); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = Math.max(2, h * 0.08); g.strokeStyle = 'rgba(20,30,40,.55)'; g.strokeText(b.message, x + w / 2, y + h / 2, w - 12);
      g.fillStyle = '#fff'; g.fillText(b.message, x + w / 2, y + h / 2, w - 12);
    }
    g.restore();
  }
  function logo(g, cx, cy, s, a) {
    if (a <= 0) return; g.save(); g.globalAlpha = a; g.fillStyle = C.coral;
    [[-1, -1], [0.05, -1], [-0.47, -0.08], [-1, 0.84], [0.05, 0.84]].forEach(function (p) { rrect(g, cx + p[0] * s, cy + p[1] * s * 0.62, s * 0.95, s * 0.48, s * 0.06); g.fill(); });
    g.restore();
  }
  function flame(g, cx, cy, s) {
    g.fillStyle = C.coral; g.beginPath(); g.ellipse(cx, cy + s * 0.4, s * 0.62, s * 0.55, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx - s * 0.6, cy + s * 0.3); g.lineTo(cx - s * 0.1, cy - s * 1.15); g.lineTo(cx + s * 0.25, cy - s * 0.45); g.lineTo(cx + s * 0.6, cy + s * 0.3); g.fill();
    g.fillStyle = '#ffd678'; g.beginPath(); g.ellipse(cx, cy + s * 0.6, s * 0.3, s * 0.25, 0, 0, 7); g.fill();
  }
  var FLAKES = []; for (var i = 0; i < 90; i++) FLAKES.push([Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 50 + Math.random() * 90]);
  function snow(g, t) { g.fillStyle = 'rgba(240,246,252,.7)'; FLAKES.forEach(function (f) { var y = (f[1] + t * f[3]) % (H + 20) - 10, x = f[0] + Math.sin(t * 1.3 + f[1]) * 16; g.beginPath(); g.arc(x, y, f[2], 0, 7); g.fill(); }); }

  function intro(g, t, d) {
    var a = easeOut(prog(t, 0.1, 0.5));
    logo(g, W / 2, 560 - (1 - a) * 30, 110, a);
    text(g, 'Daily Brick', W / 2, 760, font('800', 120, 'c'), C.ink, easeOut(prog(t, 0.3, 0.5)));
    text(g, todayText(), W / 2, 930, font('600', 58), d.xmas ? C.gold : C.coral, easeOut(prog(t, 0.6, 0.5)));
    text(g, THEME_NAMES[d.theme], W / 2, 1020, font('500', 54), C.muted, easeOut(prog(t, 0.9, 0.5)));
  }
  function header(g, t, title, sub) {
    text(g, title, W / 2, 150, font('800', 86, 'c'), C.ink, easeOut(prog(t, 0, 0.4)));
    if (sub) text(g, sub, W / 2, 270, font('600', 50), C.muted, easeOut(prog(t, 0.2, 0.4)));
  }
  function sceneToday(g, t, d) {
    header(g, t, 'Today on the wall', todayText());
    var n = Math.min(36, d.recent.length), cols = 4, bw = 210, bh = 96, gap = 14, x0 = (W - (cols * bw + (cols - 1) * gap)) / 2, yb = 1220;
    for (var k = 0; k < n; k++) {
      var b = d.recent[d.recent.length - n + k], row = Math.floor(k / cols), col = k % cols, off = row % 2 ? bw / 2 : 0;
      var p = easeOut(prog(t, 0.4 + k * 0.12, 0.35)); if (p <= 0) continue;
      var x = x0 + col * (bw + gap) + off - (row % 2 ? bw / 4 : 0), y = yb - row * (bh + gap) - (1 - p) * 500;
      if (y < 380) continue;
      brick(g, x, y, bw, bh, b, Math.min(1, p * 1.4));
    }
    var c = easeOut(prog(t, 1.0, 1.6));
    g.fillStyle = 'rgba(11,29,38,.92)'; rrect(g, 90, 1380, W - 180, 330, 34); g.fill();
    g.strokeStyle = C.line; g.lineWidth = 3; g.stroke();
    text(g, fmt(d.today * c), W / 2, 1410, font('800', 130, 'c'), C.coral, 1);
    text(g, d.today === 1 ? 'brick placed today' : 'bricks placed today', W / 2, 1565, font('600', 52), C.ink, 1);
    text(g, 'Wall total: ' + fmt(d.total) + ' bricks  ·  ' + lengthText(d.total), W / 2, 1640, font('500', 40), C.muted, easeOut(prog(t, 2.2, 0.5)));
  }
  function sceneMessages(g, t, d) {
    header(g, t, 'Written on the wall', 'Real bricks from this week');
    var list = d.messages.length ? d.messages : [{ message: 'YOUR NAME', color: '#d9714e' }];
    list.forEach(function (b, k) {
      var p = easeOut(prog(t, 0.4 + k * 1.6, 0.5));
      brick(g, 120 + (1 - p) * (k % 2 ? 600 : -600), 480 + k * 360, W - 240, 260, b, p);
    });
    text(g, 'What will you write?', W / 2, 1650, font('700', 60), C.mint, easeOut(prog(t, 5.2, 0.5)));
  }
  function sceneStreaks(g, t, d) {
    header(g, t, 'Streak watch', 'Top builders right now');
    var top = d.top.length ? d.top : [{ name: 'You?', streak: 1 }];
    var max = Math.max.apply(null, top.map(function (r) { return r.streak; })) || 1;
    top.forEach(function (r, k) {
      var p = easeOut(prog(t, 0.5 + k * 0.6, 0.6)), y = 520 + k * 300;
      g.globalAlpha = p; g.fillStyle = C.panel; rrect(g, 90, y, W - 180, 240, 30); g.fill(); g.strokeStyle = k === 0 ? C.coral : C.line; g.lineWidth = 4; g.stroke(); g.globalAlpha = 1;
      text(g, String(k + 1), 150, y + 60, font('800', 100, 'c'), k === 0 ? C.gold : C.muted, p, 'left');
      text(g, String(r.name || 'Builder').slice(0, 18), 270, y + 50, font('700', 62), C.ink, p, 'left');
      var bw = (W - 640) * (r.streak / max) * easeOut(prog(t, 1.0 + k * 0.6, 1.2));
      g.globalAlpha = p; g.fillStyle = C.coral; rrect(g, 270, y + 150, Math.max(10, bw), 40, 20); g.fill(); g.globalAlpha = 1;
      if (p > 0.5) { flame(g, 290 + Math.max(10, bw) + 30, y + 150, 26); text(g, r.streak + ' days', 290 + Math.max(10, bw) + 70, y + 146, font('700', 46), C.coral, p, 'left'); }
    });
    text(g, 'Can you catch them?', W / 2, 1520, font('700', 64), C.mint, easeOut(prog(t, 3.0, 0.5)));
  }
  function sceneProgress(g, t, d) {
    header(g, t, 'How far we’ve come', null);
    var c = easeOut(prog(t, 0.3, 2.5));
    text(g, fmt(d.total * c), W / 2, 420, font('800', 150, 'c'), C.coral, 1);
    text(g, 'bricks on the wall', W / 2, 600, font('600', 56), C.ink, easeOut(prog(t, 0.4, 0.5)));
    text(g, 'That’s ' + lengthText(d.total) + ' of wall', W / 2, 690, font('500', 50), C.muted, easeOut(prog(t, 1.2, 0.5)));
    var next = COUNTS.filter(function (m) { return m[0] > d.total; })[0] || COUNTS[COUNTS.length - 1];
    var pa = easeOut(prog(t, 2.2, 0.5)); g.globalAlpha = pa;
    g.fillStyle = C.panel; rrect(g, 90, 900, W - 180, 330, 30); g.fill(); g.globalAlpha = 1;
    text(g, 'Next goal: ' + next[1], W / 2, 950, font('700', 54), C.ink, pa);
    var frac = Math.min(1, d.total / next[0]) * easeOut(prog(t, 2.6, 1.5));
    g.globalAlpha = pa; g.fillStyle = '#0b2230'; rrect(g, 150, 1070, W - 300, 60, 30); g.fill();
    g.fillStyle = C.mint; rrect(g, 150, 1070, Math.max(60, (W - 300) * frac), 60, 30); g.fill(); g.globalAlpha = 1;
    text(g, fmt(d.total) + ' / ' + fmt(next[0]), W / 2, 1160, font('600', 40, 'm'), C.muted, pa);
    text(g, 'Every brick counts. Add yours today.', W / 2, 1420, font('700', 58), C.mint, easeOut(prog(t, 4.0, 0.5)));
  }
  function outro(g, t, d) {
    logo(g, W / 2, 520, 90, easeOut(prog(t, 0, 0.5)));
    text(g, 'Place your free brick', W / 2, 700, font('800', 84, 'c'), C.ink, easeOut(prog(t, 0.2, 0.5)));
    text(g, 'today', W / 2, 810, font('800', 84, 'c'), d.xmas ? C.gold : C.coral, easeOut(prog(t, 0.35, 0.5)));
    var a = easeOut(prog(t, 0.7, 0.5)); g.globalAlpha = a;
    g.fillStyle = d.xmas ? C.red : C.coral; rrect(g, 110, 1010, W - 220, 150, 24); g.fill(); g.globalAlpha = 1;
    text(g, location.host || 'daily-brick.vercel.app', W / 2, 1052, font('600', 56, 'm'), d.xmas ? C.snow : C.coralInk, a);
    text(g, 'Free to join  ·  link in bio', W / 2, 1220, font('500', 48), C.muted, easeOut(prog(t, 1.0, 0.5)));
  }
  var SCENES = { today: sceneToday, messages: sceneMessages, streaks: sceneStreaks, progress: sceneProgress };
  function draw(g, t, d) {
    g.fillStyle = d.xmas ? '#09162a' : C.bg; g.fillRect(0, 0, W, H);
    if (d.xmas) snow(g, t);
    var fade = 1;
    if (t < 3) { intro(g, t, d); fade = Math.min(1, (3 - t) / 0.3); }
    else if (t < 11.5) { SCENES[d.theme](g, t - 3, d); fade = Math.min(1, (t - 3) / 0.3, (11.5 - t) / 0.3); }
    else { outro(g, t - 11.5, d); fade = Math.min(1, (t - 11.5) / 0.3); }
    if (fade < 1) { g.fillStyle = d.xmas ? '#09162a' : C.bg; g.globalAlpha = 1 - fade; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  }

  /* ---------- music (made live with WebAudio, so it is original and copyright-free) ---------- */
  function music(ac, dest, t0, festive) {
    var BAR = 2.0, B = BAR / 4, S = B / 4, master = ac.createGain(); master.gain.value = 0.8; master.connect(dest);
    master.gain.setValueAtTime(0.8, t0 + DUR - 1.5); master.gain.linearRampToValueAtTime(0, t0 + DUR);
    var comp = ac.createDynamicsCompressor(); comp.connect(master);
    var noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate), nd = noise.getChannelData(0); for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    function env(node, t, a, d, peak) { node.gain.setValueAtTime(0, t); node.gain.linearRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    function kick(t) { var o = ac.createOscillator(), gg = ac.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12); env(gg, t, 0.002, 0.3, 0.9); o.connect(gg).connect(comp); o.start(t); o.stop(t + 0.4); }
    function hat(t, v) { var s = ac.createBufferSource(), f = ac.createBiquadFilter(), gg = ac.createGain(); s.buffer = noise; f.type = 'highpass'; f.frequency.value = festive ? 6500 : 7500; env(gg, t, 0.001, 0.05, v); s.connect(f).connect(gg).connect(comp); s.start(t); s.stop(t + 0.1); }
    function clap(t) { var s = ac.createBufferSource(), f = ac.createBiquadFilter(), gg = ac.createGain(); s.buffer = noise; f.type = 'bandpass'; f.frequency.value = 1500; env(gg, t, 0.002, 0.12, 0.35); s.connect(f).connect(gg).connect(comp); s.start(t); s.stop(t + 0.25); }
    var shaper = ac.createWaveShaper(), curve = new Float32Array(256); for (var c = 0; c < 256; c++) { var x = c / 128 - 1; curve[c] = Math.tanh(2.5 * x); } shaper.curve = curve; shaper.connect(comp);
    function logd(t, m) { var o = ac.createOscillator(), gg = ac.createGain(), f = 440 * Math.pow(2, (m - 69) / 12); o.frequency.setValueAtTime(f * 1.9, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.04); env(gg, t, 0.003, 0.25, 0.5); o.connect(gg).connect(shaper); o.start(t); o.stop(t + 0.4); }
    function chord(t, notes, v, d) { notes.forEach(function (m) { var o = ac.createOscillator(), gg = ac.createGain(); o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); env(gg, t, 0.004, d, v); o.connect(gg).connect(comp); o.start(t); o.stop(t + d + 0.1); }); }
    function bell(t, m) { var o = ac.createOscillator(), gg = ac.createGain(); o.type = 'sine'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); env(gg, t, 0.002, 0.8, 0.12); o.connect(gg).connect(comp); o.start(t); o.stop(t + 1); }
    var CH = festive ? [[60, 64, 67, 72], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]] : [[53, 56, 60, 63], [49, 53, 56, 60], [51, 55, 58, 61], [48, 51, 55, 58]];
    var ROOT = festive ? [48, 45, 41, 43] : [53, 49, 51, 48];
    var MEL = [[0, 79], [4, 76], [8, 79], [12, 84]];
    var bars = Math.ceil(DUR / BAR);
    for (var b = 0; b < bars; b++) {
      var tb = t0 + b * BAR, ch = CH[b % 4], full = b >= 1 && tb < t0 + DUR - 1;
      for (var k = 0; k < 16; k++) hat(tb + k * S + (k % 2 ? 0.012 : 0), k % 4 === 2 ? 0.25 : 0.12);
      [2, 6, 10, 13].forEach(function (s) { chord(tb + s * S, ch, 0.05, 0.35); });
      if (full) {
        for (var q = 0; q < 4; q++) kick(tb + q * B);
        clap(tb + B); clap(tb + 3 * B);
        [[0, 0], [3, 0], [6, 7], [10, 0], [11, 12], [14, 7]].forEach(function (p) { logd(tb + p[0] * S, ROOT[b % 4] - 12 + p[1]); });
        if (festive) MEL.forEach(function (p) { bell(tb + p[0] * S, p[1] - (b % 2) * 3); });
      }
    }
  }

  /* ---------- UI ---------- */
  function css() {
    if (document.getElementById('reelCss')) return;
    var s = document.createElement('style'); s.id = 'reelCss';
    s.textContent = '.reel{position:fixed;inset:0;z-index:80;background:rgba(5,14,20,.96);display:grid;grid-template-rows:auto 1fr auto;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px calc(env(safe-area-inset-bottom,0px) + 14px);color:#f1f7f4}' +
      '.reel-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.reel-top b{font:700 17px/1.2 Figtree,sans-serif}' +
      '.reel-x{width:44px;height:44px;border-radius:50%;border:1px solid #24505c;background:#10303b;color:#f1f7f4;font-size:22px}' +
      '.reel canvas{justify-self:center;align-self:center;max-width:100%;max-height:100%;height:auto;width:auto;aspect-ratio:9/16;border-radius:14px;border:1px solid #24505c;background:#0b1d26;min-height:0}' +
      '.reel-acts{display:grid;gap:8px}.reel-acts .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.reel-acts button{min-height:50px;border-radius:12px;border:1px solid #24505c;background:#10303b;color:#f1f7f4;font:700 15px Figtree,sans-serif}' +
      '.reel-acts button.go{background:#ff9a62;color:#3a1406;border:0}.reel-acts button:disabled{opacity:.5}.reel-note{font:500 13px/1.4 Figtree,sans-serif;color:#8fb3b5;text-align:center;margin:0}';
    document.head.appendChild(s);
  }
  function build() {
    css();
    var root = document.createElement('div'); root.className = 'reel'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', "Today's reel");
    root.innerHTML = '<div class="reel-top"><b>Today’s reel</b><button class="reel-x" type="button" aria-label="Close">×</button></div>' +
      '<canvas width="1080" height="1920"></canvas>' +
      '<div class="reel-acts"><p class="reel-note" data-r="note">Preview. Tap Record to make the video (15 seconds, with music). Keep this screen open while it records.</p>' +
      '<div class="row"><button type="button" data-r="style">Another style</button><button type="button" class="go" data-r="rec">Record video</button></div>' +
      '<div class="row" data-r="done" hidden><button type="button" data-r="share">Share</button><button type="button" data-r="save">Save video</button></div></div>';
    document.body.appendChild(root); return root;
  }
  function loop() {
    if (!st) return;
    var t = st.rec ? (performance.now() - st.recStart) / 1000 : ((performance.now() - st.t0) / 1000) % DUR;
    draw(st.g, Math.min(t, DUR), st.d);
    if (st.rec && t >= DUR + 0.15) { finishRec(); }
    st.raf = requestAnimationFrame(loop);
  }
  function pickType() {
    // H.264 MP4 first: Instagram, TikTok and WhatsApp all accept it
    var types = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs="avc1.4D401F,mp4a.40.2"', 'video/mp4;codecs="avc1.42E01E,opus"', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', 'video/webm'];
    for (var i = 0; i < types.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }
  function startRec() {
    if (!window.MediaRecorder || !st.canvas.captureStream) { st.note.textContent = 'This browser can’t record video. Try Chrome on your phone.'; return; }
    var type = pickType(), stream = st.canvas.captureStream(FPS);
    try {
      var AC = window.AudioContext || window.webkitAudioContext; st.ac = new AC();
      var dest = st.ac.createMediaStreamDestination();
      music(st.ac, dest, st.ac.currentTime + 0.05, st.d.xmas);
      dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
    } catch (e) {}
    st.chunks = []; st.type = type || 'video/webm';
    st.mr = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8000000 } : { videoBitsPerSecond: 8000000 });
    st.mr.ondataavailable = function (e) { if (e.data && e.data.size) st.chunks.push(e.data); };
    st.mr.onstop = function () {
      var ext = /mp4/.test(st.type) ? 'mp4' : 'webm';
      st.blob = new Blob(st.chunks, { type: st.type.split(';')[0] });
      st.file = new File([st.blob], 'daily-brick-reel-' + new Date().toISOString().slice(0, 10) + '.' + ext, { type: st.blob.type });
      st.root.querySelector('[data-r=done]').hidden = false;
      st.note.textContent = 'Done! Share it, or save it and post it from your gallery.' + (ext === 'webm' ? ' (Saved as .webm. If an app won’t take it, open it in CapCut and export.)' : '');
      st.rb.disabled = false; st.rb.textContent = 'Record again'; st.sb.disabled = false;
      try { if (st.ac && st.ac.state !== 'closed') st.ac.close(); } catch (e) {}
    };
    st.rec = true; st.recStart = performance.now(); st.mr.start(500);
    st.rb.disabled = true; st.sb.disabled = true; st.rb.textContent = 'Recording…'; st.note.textContent = 'Recording. Keep this screen open for 15 seconds.';
    st.root.querySelector('[data-r=done]').hidden = true;
  }
  function finishRec() { if (!st.rec) return; st.rec = false; st.t0 = performance.now(); try { st.mr.stop(); } catch (e) {} }
  async function open(opts) {
    if (st) return;
    var root = build(), canvas = root.querySelector('canvas');
    st = { root: root, canvas: canvas, g: canvas.getContext('2d'), t0: performance.now(), note: root.querySelector('[data-r=note]'), rb: root.querySelector('[data-r=rec]'), sb: root.querySelector('[data-r=style]') };
    var day = Math.floor(Date.now() / 864e5);
    st.d = { theme: THEMES[day % THEMES.length], xmas: xmas(), recent: [], messages: [], top: [], total: 0, today: 0 };
    loop();
    try { await Promise.all([document.fonts.load('800 80px Cinzel'), document.fonts.load('700 50px Figtree'), document.fonts.load('600 50px "IBM Plex Mono"')]); } catch (e) {}
    var data = await loadData(opts.sb); if (!st) return; Object.keys(data).forEach(function (k) { st.d[k] = data[k]; }); st.t0 = performance.now();
    root.querySelector('.reel-x').addEventListener('click', close);
    st.sb.addEventListener('click', function () { st.d.theme = THEMES[(THEMES.indexOf(st.d.theme) + 1) % THEMES.length]; st.t0 = performance.now(); });
    st.rb.addEventListener('click', startRec);
    root.querySelector('[data-r=share]').addEventListener('click', async function () {
      if (navigator.canShare && navigator.canShare({ files: [st.file] })) { try { await navigator.share({ files: [st.file], text: 'One free brick a day. Join the wall: https://' + (location.host || 'daily-brick.vercel.app') }); } catch (e) {} }
      else save();
    });
    root.querySelector('[data-r=save]').addEventListener('click', save);
  }
  function save() { var a = document.createElement('a'); a.href = URL.createObjectURL(st.blob); a.download = st.file.name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  function close() { if (!st) return; cancelAnimationFrame(st.raf); try { if (st.rec) st.mr.stop(); } catch (e) {} try { if (st.ac && st.ac.state !== 'closed') st.ac.close(); } catch (e) {} st.root.remove(); st = null; }
  window.DailyBrickReel = { open: open, close: close, _draw: draw, _state: function () { return st; } };
})();
