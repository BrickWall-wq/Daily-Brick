/* Daily Brick - 3D wall view.
   Loaded only when someone taps "3D view" on the Wall screen, so the app stays light for everyone else.
   It reads the real bricks from Supabase and lays them in order, like a real builder:
   one course at a time along a section of 10 bricks, bottom course first; when a section is full height the next starts.
   Every finished section (70 bricks) ends in a tower. Businesses sponsor a tower for 30 days and their logo hangs on it.
   Photos and writing show on the faces of the bricks, the same as on the flat wall. */
(function () {
  var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';
  var MAX_BRICKS = 30000;
  var MAX_FACES = 960;      // bricks with a photo or writing drawn on their faces (newest first, photos before writing)

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[data-src="' + src + '"]')) return res();
      var s = document.createElement('script'); s.src = src; s.async = true; s.setAttribute('data-src', src);
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- layout (pure: same bricks in, same wall out) ---------- */
  var BL = 1.0, BH = 0.5, BD = 1.9, GAP = 0.06, ROWS = 7, STEP = BL + GAP, SEC = 10, SECT_LEN = SEC * STEP;
  var PLINTH = 0.6, TOP = PLINTH + ROWS * BH, START = 0;
  // a tower stands in the gap after every finished section: tower n after section n-1 (so after every 70 bricks)
  var TGAP = 3.4, TW = 3.9, PER_TOWER = SEC * ROWS;
  function secStartX(sec) { return START + sec * (SECT_LEN + TGAP); }
  function towerX(n) { return secStartX(n) - TGAP / 2 + 0.13; }
  // Christmas look from 15 November to 6 January (South African time). Add ?xmas=1 to the address to preview it.
  function festive() {
    if (/[?&]xmas=1/.test(location.search)) return true;
    var d = new Date(Date.now() + 2 * 3600e3), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return (m === 11 && day >= 15) || m === 12 || (m === 1 && day <= 6);
  }

  function layout(rows) {
    var out = { bricks: [], emblems: [], cap: {} };
    var sec = 0, r = 0, c = 0;
    function nextSlot() {
      var x = secStartX(sec) + (c + 0.5 + (r % 2 ? 0.5 : 0)) * STEP, s = { sec: sec, row: r, x: x, y: PLINTH + r * BH + BH / 2 };
      c++; if (c >= SEC) { c = 0; r++; if (r >= ROWS) { r = 0; sec++; } }
      return s;
    }
    rows.forEach(function (b) { var s = nextSlot(); s.b = b; out.bricks.push(s); });
    out.bricks.forEach(function (s) { var k = s.sec + ':' + s.row; out.cap[k] = (out.cap[k] || 0) + 1; });
    out.rowsDone = function (s) {
      var done = 0;
      for (var row = 0; row < ROWS; row++) { if ((out.cap[s + ':' + row] || 0) >= SEC) done = row + 1; else break; }
      return done;
    };
    out.towers = Math.floor(rows.length / PER_TOWER);
    out.cursorSec = sec; out.cursorRow = r;
    out.next = (function () { var keep = [sec, r, c]; var s = nextSlot(); sec = keep[0]; r = keep[1]; c = keep[2]; return s; })();
    return out;
  }

  /* ---------- the view ---------- */
  var state = null;

  function open(opts) {
    var root = opts.root, sb = opts.sb, me = opts.user ? opts.user.id : null;
    var status = root.querySelector('[data-3d="status"]');
    status.textContent = 'Loading the 3D wall…'; status.hidden = false;
    return Promise.all([loadScript(THREE_URL)]).then(function () { return loadScript(ORBIT_URL); }).then(function () {
      return fetchAll(sb);
    }).then(function (data) {
      status.hidden = true;
      build(root, data, me, opts);
    }).catch(function (e) {
      status.textContent = 'The 3D wall could not load. Check your connection and try again.';
      status.hidden = false;
      throw e;
    });
  }

  function fetchAll(sb) {
    var rows = [], page = 1000;
    function more(from) {
      var base = 'id,color,finish,message,photo_url,photo_status,user_id,placed_on,biz';
      return sb.from('bricks').select(base + ',country').order('id', { ascending: true }).range(from, from + page - 1).then(function (r) {
        return r.error ? sb.from('bricks').select(base).order('id', { ascending: true }).range(from, from + page - 1) : r;
      }).then(function (r) {
        if (r.error) throw r.error;
        rows = rows.concat(r.data || []);
        if ((r.data || []).length === page && rows.length < MAX_BRICKS) return more(from + page);
        return rows;
      });
    }
    var sponsors = [];
    return more(0).then(function (bricks) {
      return sb.from('tower_sponsors').select('tower_no,user_id,until').gt('until', new Date().toISOString()).then(function (r) { sponsors = (r && r.data) || []; return bricks; }, function () { return bricks; });
    }).then(function (bricks) {
      var ids = {}; bricks.forEach(function (b) { ids[b.user_id] = 1; }); sponsors.forEach(function (t) { ids[t.user_id] = 1; });
      var list = Object.keys(ids), out = {};
      var chunks = []; for (var i = 0; i < list.length; i += 200) chunks.push(list.slice(i, i + 200));
      return Promise.all(chunks.map(function (ch) {
        var base = 'id,display_name,business_name,logo_url,logo_status';
        var withCountry = base + ',website,website_status,instagram,tiktok,facebook,country';
        return sb.from('profiles').select(withCountry).in('id', ch).then(function (r) {
          return r.error ? sb.from('profiles').select(base + ',website,website_status,instagram,tiktok,facebook').in('id', ch) : r;
        }).then(function (r) {
          return r.error ? sb.from('profiles').select(base + ',website,website_status').in('id', ch) : r;
        }).then(function (r) {
          return r.error ? sb.from('profiles').select(base).in('id', ch) : r;
        }).then(function (r) { (r.data || []).forEach(function (p) { out[p.id] = p; }); });
      })).then(function () { return { bricks: bricks, profiles: out, sponsors: sponsors, photoUrl: function (path) { return sb.storage.from('brick-photos').getPublicUrl(path).data.publicUrl; }, logoUrl: function (path) { return sb.storage.from('brick-photos').getPublicUrl(path).data.publicUrl; } }; });
    });
  }

  function close() {
    if (!state) return;
    state.stop = true;
    try { (state.faceMats || []).forEach(function (m) { m.map.dispose(); m.dispose(); }); } catch (e) {}
    try { state.renderer.dispose(); state.renderer.forceContextLoss(); } catch (e) {}
    if (state.renderer.domElement.parentNode) state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
    window.removeEventListener('resize', state.resize);
    state = null;
  }

  function build(root, data, me, opts) {
    close();
    var THREE = window.THREE;
    var stage = root.querySelector('[data-3d="stage"]'), tip = root.querySelector('[data-3d="tip"]'), countEl = root.querySelector('[data-3d="count"]');
    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var small = Math.min(window.innerWidth, window.innerHeight) < 600;
    var L = layout(data.bricks);
    var XMAS = festive();
    var nBricks = data.bricks.length;
    countEl.textContent = nBricks.toLocaleString('en-US');

    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);
    var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.3, 2600);
    state = { renderer: renderer, stop: false };
    var seed = 11; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    function canvasTex(w, h, draw, rx, ry) {
      var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (rx) t.repeat.set(rx, ry || 1); return t;
    }
    function speckle(g, w, h, n, dark, light) {
      for (var i = 0; i < n; i++) { g.fillStyle = rnd() < .5 ? dark : light; g.globalAlpha = .03 + rnd() * .08; var s = 1 + rnd() * 2.5; g.fillRect(rnd() * w, rnd() * h, s, s); }
      g.globalAlpha = 1;
    }
    function plainTex(rx, ry, base, n) { return canvasTex(128, 128, function (g, w, h) { g.fillStyle = base; g.fillRect(0, 0, w, h); speckle(g, w, h, n || 700, '#2e2a25', '#ffffff'); }, rx, ry); }
    function stoneTex(rx, ry, base) {
      return canvasTex(256, 256, function (g, w, h) {
        g.fillStyle = '#5f5b54'; g.fillRect(0, 0, w, h);
        for (var r = 0; r < 6; r++) { var x = -rnd() * 40; while (x < w) { var bw = 34 + rnd() * 50, cc = new THREE.Color(base).multiplyScalar(0.85 + rnd() * 0.25); g.fillStyle = '#' + cc.getHexString(); g.fillRect(x + 2, r * h / 6 + 2, bw - 4, h / 6 - 4); x += bw; } }
        speckle(g, w, h, 2400, '#2e2a25', '#ffffff');
      }, rx, ry);
    }

    // wall extent
    var lastSec = L.cursorSec;
    var wallEnd = secStartX(lastSec + 1);
    var span = Math.max(260, wallEnd + 200);

    /* sky and light */
    var skyTex = canvasTex(512, 512, function (g, w, h) {
      var gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#0d2230'); gr.addColorStop(.38, '#1b4656'); gr.addColorStop(.6, '#3d7d84'); gr.addColorStop(.8, '#e9a07f'); gr.addColorStop(1, '#ffcfa3');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 26; i++) {
        var x0 = rnd() * w, y = h * (.5 + rnd() * .22), rw = 30 + rnd() * 90;
        [x0 - w, x0, x0 + w].forEach(function (x) { var cg = g.createRadialGradient(x, y, 0, x, y, rw); cg.addColorStop(0, 'rgba(255,214,190,.26)'); cg.addColorStop(1, 'rgba(255,214,190,0)'); g.save(); g.translate(x, y); g.scale(1, .28); g.translate(-x, -y); g.fillStyle = cg; g.beginPath(); g.arc(x, y, rw, 0, 7); g.fill(); g.restore(); });
      }
    });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    scene.add(sky);
    scene.fog = new THREE.Fog(0xcf8f78, 180, 780);
    scene.add(XMAS ? new THREE.HemisphereLight(0xdfe9f7, 0x3a4a52, 0.6) : new THREE.HemisphereLight(0xffe6c8, 0x2c4a3c, 0.62));
    scene.add(new THREE.AmbientLight(0xffffff, 0.1));
    var SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
    var sun = new THREE.DirectionalLight(XMAS ? 0xffe2c8 : 0xffd7b0, XMAS ? 0.82 : 1.0); sun.castShadow = true;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    var SH = 46; sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH; sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 300; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    var fill = new THREE.DirectionalLight(0xbfe0e8, 0.32); fill.position.set(80, 60, 220); scene.add(fill);

    /* land */
    function height(x, z) {
      var d = Math.abs(z), k = Math.min(1, Math.max(0, (d - 14) / 70)); k = k * k * (3 - 2 * k);
      return k * (16 * (0.6 + 0.4 * Math.sin(x / 37 + z / 90)) + 4 * Math.sin(x / 17) * Math.cos(z / 21) + 2.5 * Math.sin(x / 9 + z / 13));
    }
    (function () {
      var W = span + 700, seg = Math.min(400, Math.round(W / 6.5));
      var geo = new THREE.PlaneGeometry(W, 900, seg, 140); geo.rotateX(-Math.PI / 2); geo.translate(wallEnd / 2, 0, 0);
      var pos = geo.attributes.position, cols = [], c = new THREE.Color();
      var dirt = new THREE.Color('#8a7457'), gA = new THREE.Color('#2c5634'), gB = new THREE.Color('#41703c'), hill = new THREE.Color('#24564a'), dry = new THREE.Color('#77804a'), snowCol = new THREE.Color('#d7e0ea');
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i), z = pos.getZ(i), y = height(x, z); pos.setY(i, y);
        c.copy(gA).lerp(gB, 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2) * Math.cos(z * 0.13 + x * 0.05));
        c.lerp(dry, Math.max(0, Math.sin(x / 53 + z / 41)) * 0.35); c.lerp(hill, Math.min(1, y / 22) * 0.55);
        var d = Math.abs(z); if (d < 7) c.lerp(dirt, (7 - d) / 7 * 0.85);
        if (XMAS) {
          var drift = 0.55 + 0.3 * Math.sin(x * 0.09 + Math.cos(z * 0.07) * 3) * Math.cos(z * 0.11 - x * 0.03);
          if (d < 7) drift *= 0.55 + 0.45 * d / 7;   // trodden snow next to the wall
          c.lerp(snowCol, Math.min(0.92, drift + Math.min(1, y / 18) * 0.2));
        }
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); geo.computeVertexNormals();
      var ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })); ground.receiveShadow = true; scene.add(ground);
      var N = small ? 260 : 420, d0 = new THREE.Object3D(), col = new THREE.Color(), greens = ['#2f5e3a', '#3b6e3f', '#47784a', '#2a5136', '#55824d'];
      var trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.22, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), N);
      var crown = new THREE.InstancedMesh(XMAS ? new THREE.ConeGeometry(1.3, 3.0, 7) : new THREE.IcosahedronGeometry(1.25, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
      var cap = XMAS ? new THREE.InstancedMesh(new THREE.ConeGeometry(0.86, 1.25, 7), new THREE.MeshLambertMaterial({ color: 0xf4f8fc }), N) : null;
      if (XMAS) greens = ['#1f4a33', '#24563a', '#2c5f40', '#1b4430', '#335f45'];
      for (var t = 0; t < N; t++) {
        var x = wallEnd / 2 - W / 2 + rnd() * W, z = (rnd() < .5 ? -1 : 1) * (16 + Math.pow(rnd(), 1.6) * 360), y = height(x, z), s = 0.8 + rnd() * 1.4;
        d0.position.set(x, y + 0.7 * s, z); d0.rotation.set(0, rnd() * 6.28, 0); d0.scale.set(s, s, s); d0.updateMatrix(); trunk.setMatrixAt(t, d0.matrix);
        var sy = s * (1.1 + rnd() * .5);
        if (XMAS) {
          d0.position.set(x, y + 1.35 * s + 1.5 * sy, z); d0.scale.set(s, sy, s); d0.updateMatrix(); crown.setMatrixAt(t, d0.matrix);
          d0.position.set(x, y + 1.35 * s + 2.42 * sy, z); d0.updateMatrix(); cap.setMatrixAt(t, d0.matrix);
        } else {
          d0.position.set(x, y + 1.9 * s, z); d0.scale.set(s, sy, s); d0.updateMatrix(); crown.setMatrixAt(t, d0.matrix);
        }
        crown.setColorAt(t, col.set(greens[Math.floor(rnd() * greens.length)]));
      }
      crown.instanceColor.needsUpdate = true;
      [trunk, crown].concat(cap ? [cap] : []).forEach(function (m) { m.castShadow = true; m.receiveShadow = true; scene.add(m); });
    })();

    /* bricks */
    var brickTex = canvasTex(128, 64, function (g, w, h) {
      g.fillStyle = '#ece6df'; g.fillRect(0, 0, w, h); speckle(g, w, h, 260, '#6b5a4a', '#ffffff');
      var e = g.createLinearGradient(0, 0, 0, h); e.addColorStop(0, 'rgba(255,255,255,.18)'); e.addColorStop(.12, 'rgba(255,255,255,0)'); e.addColorStop(.86, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,.22)');
      g.fillStyle = e; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    });
    var count = Math.max(1, L.bricks.length);
    var bricks = new THREE.InstancedMesh(new THREE.BoxGeometry(BL, BH - 0.05, BD), new THREE.MeshPhongMaterial({ color: 0xffffff, map: brickTex, bumpMap: brickTex, bumpScale: 0.018, shininess: 4, specular: 0x111111 }), count);
    bricks.castShadow = true; bricks.receiveShadow = true; scene.add(bricks);
    var dummy = new THREE.Object3D(), col = new THREE.Color();
    var mine = [], tints = [];
    L.bricks.forEach(function (s, i) {
      var j = ((s.b.id * 9301 + 49297) % 233280) / 233280;
      dummy.position.set(s.x, s.y, 0); dummy.rotation.set(0, (j - .5) * 0.014, 0); dummy.updateMatrix(); bricks.setMatrixAt(i, dummy.matrix);
      col.set(s.b.finish === 'gold' ? '#d9a93b' : s.b.finish === 'diamond' ? '#bfeeff' : (s.b.color || '#c9a27e')).multiplyScalar(0.9 + j * 0.18); bricks.setColorAt(i, col); tints[i] = '#' + col.getHexString();
      if (me && s.b.user_id === me) mine.push(i);
    });
    if (!L.bricks.length) bricks.count = 0;
    if (bricks.instanceColor) bricks.instanceColor.needsUpdate = true;

    /* mortar, base, walkway, battlements, guard posts */
    var mortarMat = new THREE.MeshLambertMaterial({ color: 0x8f877b }), towerMat = null, capMat = null, slitMat = null;
    var doneSec = -1;
    for (var s = 0; s <= L.cursorSec; s++) {
      var rows = L.rowsDone(s);
      if (rows === ROWS && doneSec === s - 1) doneSec = s;
      var built = L.bricks.some(function (b) { return b.sec === s; });
      if (!built) continue;
      var h = Math.max(rows, L.bricks.filter(function (b) { return b.sec === s; }).reduce(function (m, b) { return Math.max(m, b.row); }, 0)) * BH;
      if (h <= 0) continue;
      var m = new THREE.Mesh(new THREE.BoxGeometry(SECT_LEN, h, BD - 0.1), mortarMat);
      m.position.set(secStartX(s) + SECT_LEN / 2 + STEP / 4, PLINTH + h / 2, 0); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    }
    var frontX = Math.max(L.bricks.length ? L.bricks[L.bricks.length - 1].x + 1 : START + 2, L.towers > 0 ? towerX(L.towers) + TW / 2 + 0.3 : 0);
    var plinth = new THREE.Mesh(new THREE.BoxGeometry(frontX - START + 0.6, PLINTH + 0.4, BD + 0.7), new THREE.MeshLambertMaterial({ map: plainTex(Math.max(2, (frontX - START) / 4.5), 2, '#837d72') }));
    plinth.position.set((START + frontX) / 2, (PLINTH + 0.4) / 2 - 0.4, 0); plinth.castShadow = true; plinth.receiveShadow = true; scene.add(plinth);
    var doneX = secStartX(doneSec + 1);
    if (doneSec >= 0) {
      var walk = new THREE.Mesh(new THREE.BoxGeometry(doneX - START + 0.2, 0.18, BD + 0.24), new THREE.MeshLambertMaterial({ map: plainTex(Math.max(2, (doneX - START) / 3), 1, '#958c7e') }));
      walk.position.set((START + doneX) / 2, TOP + 0.09, 0); walk.castShadow = true; walk.receiveShadow = true; scene.add(walk);
      var nm = Math.floor((doneX - START - 0.5) / 1.4), merl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.52, 0.34), new THREE.MeshLambertMaterial({ map: stoneTex(1, 1, '#9b9284') }), nm * 2);
      for (var k = 0; k < nm; k++) [-1, 1].forEach(function (side, j) { dummy.position.set(START + 0.5 + k * 1.4, TOP + 0.44, side * (BD / 2 - 0.06)); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); merl.setMatrixAt(k * 2 + j, dummy.matrix); });
      merl.castShadow = true; merl.receiveShadow = true; scene.add(merl);
      if (XMAS) {
        var snowMat = new THREE.MeshLambertMaterial({ color: 0xf4f8fc });
        var sw = new THREE.Mesh(new THREE.BoxGeometry(doneX - START + 0.1, 0.1, BD - 0.75), snowMat);
        sw.position.set((START + doneX) / 2, TOP + 0.22, 0); sw.receiveShadow = true; scene.add(sw);
        var mcap = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 0.1, 0.38), snowMat, nm * 2);
        for (var k2 = 0; k2 < nm; k2++) [-1, 1].forEach(function (side, j) { dummy.position.set(START + 0.5 + k2 * 1.4, TOP + 0.75, side * (BD / 2 - 0.06)); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); mcap.setMatrixAt(k2 * 2 + j, dummy.matrix); });
        scene.add(mcap);
      }
      towerMat = new THREE.MeshLambertMaterial({ map: stoneTex(2, 3, '#8f8576') }); capMat = new THREE.MeshLambertMaterial({ map: stoneTex(2, 1, '#7d7468') }); slitMat = new THREE.MeshBasicMaterial({ color: 0x1d1a17 });
    }
    /* sponsor towers: one after every finished section of 70 bricks, with the sponsor's logo on both sides */
    var logoCache = {}, pickables = [bricks], towers = [];
    var bySponsor = {}; (data.sponsors || []).forEach(function (t) { bySponsor[t.tower_no] = t; });
    function wrapLines(g, text, maxChars, maxLines) {
      var words = String(text).split(' '), lines = [], cur = '';
      words.forEach(function (wd) { if ((cur + ' ' + wd).trim().length > maxChars && cur) { lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); });
      if (cur) lines.push(cur); return lines.slice(0, maxLines);
    }
    function bannerTexture(tw, img) {
      return canvasTex(512, 512, function (g, w, h) {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        if (tw.sponsor) {
          g.fillStyle = '#f6f1e7'; g.fillRect(0, 0, w, h);
          g.strokeStyle = '#1fb3a0'; g.lineWidth = 22; g.strokeRect(11, 11, w - 22, h - 22);
          g.fillStyle = '#1fb3a0'; g.fillRect(0, 0, w, 64);
          g.fillStyle = '#06302b'; g.font = '800 34px Figtree, system-ui, sans-serif'; g.fillText('TOWER ' + tw.no + ' · SPONSOR', 256, 34);
          if (img) {
            var s = Math.min(380 / img.width, 290 / img.height), iw = img.width * s, ih = img.height * s;
            g.drawImage(img, 256 - iw / 2, 225 - ih / 2, iw, ih);
            g.fillStyle = '#0f3a3f'; g.font = '800 46px Figtree, system-ui, sans-serif'; g.fillText(tw.name, 256, 430, 440);
          } else {
            g.fillStyle = '#0f3a3f'; g.font = '800 70px Figtree, system-ui, sans-serif';
            var ls = wrapLines(g, tw.name, 11, 3); ls.forEach(function (ln, i) { g.fillText(ln, 256, 280 + (i - (ls.length - 1) / 2) * 80, 450); });
          }
          if (tw.site) { g.fillStyle = '#1f7f73'; g.font = '700 28px Figtree, system-ui, sans-serif'; g.fillText('Tap to visit', 256, 476); }
        } else {
          g.fillStyle = '#16323b'; g.fillRect(0, 0, w, h);
          g.strokeStyle = '#ffd7b0'; g.lineWidth = 8; g.setLineDash([26, 16]); g.strokeRect(24, 24, w - 48, h - 48); g.setLineDash([]);
          g.fillStyle = '#ffd7b0'; g.font = '700 36px Figtree, system-ui, sans-serif'; g.fillText('TOWER ' + tw.no, 256, 96);
          g.fillStyle = '#ffffff'; g.font = '900 78px Figtree, system-ui, sans-serif'; g.fillText('YOUR LOGO', 256, 208); g.fillText('HERE', 256, 290);
          g.fillStyle = '#5fd6c4'; g.font = '700 34px Figtree, system-ui, sans-serif'; g.fillText('Sponsor this tower', 256, 382); g.fillText('R99 / 30 days', 256, 426);
        }
      });
    }
    function loadLogo(url) {
      if (!logoCache[url]) logoCache[url] = new Promise(function (res) { var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; });
      return logoCache[url];
    }
    if (towerMat) for (var tn = 1; tn <= doneSec + 1; tn++) (function (n) {
      var sp = bySponsor[n], p = sp ? (data.profiles[sp.user_id] || {}) : null;
      var tw = { no: n, x: towerX(n), sponsor: sp || null, prof: p,
        name: p ? (p.business_name || p.display_name || 'Sponsor') : null,
        site: p && p.website && p.website_status === 'approved' && /^https?:\/\//i.test(p.website) ? p.website : null, until: sp ? sp.until : null };
      towers.push(tw);
      var hh = TOP + 3.0, g = new THREE.Group(), HD = TW / 2;
      var body = new THREE.Mesh(new THREE.BoxGeometry(TW, hh, TW), towerMat); body.position.y = hh / 2; body.userData.tower = tw; g.add(body); pickables.push(body);
      var cap = new THREE.Mesh(new THREE.BoxGeometry(TW + 0.7, 0.45, TW + 0.7), capMat); cap.position.y = hh + 0.22; g.add(cap);
      [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].forEach(function (o) { var cr = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.8, 0.85), capMat); cr.position.set(o[0] * HD, hh + 0.85, o[1] * HD); g.add(cr); });
      if (XMAS) { var sc = new THREE.Mesh(new THREE.BoxGeometry(TW + 0.75, 0.12, TW + 0.75), new THREE.MeshLambertMaterial({ color: 0xf4f8fc })); sc.position.y = hh + 0.5; g.add(sc); }
      var frameMat = new THREE.MeshLambertMaterial({ color: sp ? 0x0f3a3f : 0x2a2622 }), banMat = new THREE.MeshBasicMaterial({ map: bannerTexture(tw, null) });
      var banGeo = new THREE.PlaneGeometry(2.9, 2.9);
      [1, -1].forEach(function (side) {
        var sl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.05), slitMat); sl.position.set(0, hh - 0.75, side * (HD + 0.03)); g.add(sl);
        var dr = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.7, 0.05), slitMat); dr.position.set(0, PLINTH + 0.85, side * (HD + 0.03)); g.add(dr);
        var fr = new THREE.Mesh(new THREE.BoxGeometry(3.15, 3.15, 0.1), frameMat); fr.position.set(0, 4.05, side * (HD + 0.05)); g.add(fr);
        var ban = new THREE.Mesh(banGeo, banMat); ban.position.set(0, 4.05, side * (HD + 0.11)); if (side < 0) ban.rotation.y = Math.PI;
        ban.userData.tower = tw; g.add(ban); pickables.push(ban);
      });
      if (sp) {   // a flag on the roof of every sponsored tower
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), new THREE.MeshLambertMaterial({ color: 0x3b3a36 })); pole.position.set(0, hh + 1.6 + 0.45, 0); g.add(pole);
        var flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.95), new THREE.MeshLambertMaterial({ color: 0x1fb3a0, side: THREE.DoubleSide })); flag.position.set(0.84, hh + 2.75, 0); g.add(flag); tw.flag = flag;
        if (p && p.logo_url && p.logo_status === 'approved') loadLogo(data.logoUrl(p.logo_url)).then(function (img) {
          if (!img || !state) return; banMat.map = bannerTexture(tw, img); banMat.needsUpdate = true;
        });
      }
      g.traverse(function (o) { if (o.isMesh && o.material !== banMat) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.set(tw.x, 0, 0); scene.add(g);
    })(tn);

    /* photos and writing on the brick faces */
    // Christmas finishes: snow-capped, candy cane and fairy lights (same drawing on the flat wall and the 3D wall)
    function lightColor(hex) { var n = parseInt(String(hex || '#888888').slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 > 0.78; }
    function paintFestive(ctx, x, y, w, h, finish, color) {
      if (finish !== 'snow' && finish !== 'candy' && finish !== 'lights') return;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      if (finish === 'candy') {
        ctx.fillStyle = '#fbf6f0'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = lightColor(color) ? '#c62f3b' : color;
        var sw = h * 0.3, gap = h * 0.72;
        for (var k = -h; k < w + h; k += gap) { ctx.beginPath(); ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + sw, y + h); ctx.lineTo(x + k + sw + h, y); ctx.lineTo(x + k + h, y); ctx.closePath(); ctx.fill(); }
        var gl = ctx.createLinearGradient(x, y, x, y + h); gl.addColorStop(0, 'rgba(255,255,255,.35)'); gl.addColorStop(.45, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.fillRect(x, y, w, h);
      }
      if (finish === 'snow') {
        var base = y + h * 0.26, bumps = Math.max(3, Math.round(w / (h * 0.55)));
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x + w, y); ctx.lineTo(x + w, base);
        for (var b = bumps; b >= 0; b--) {
          var bx = x + w * b / bumps, drip = (b % 3 === 1) ? h * 0.14 : 0;
          ctx.quadraticCurveTo(bx + w / bumps / 2, base + h * 0.1 + drip, bx, base);
        }
        ctx.closePath(); ctx.fillStyle = '#f7fbff'; ctx.fill();
        ctx.strokeStyle = 'rgba(120,150,185,.45)'; ctx.lineWidth = Math.max(1, h * 0.035); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        [[.18, .62], [.42, .8], [.66, .58], [.86, .78], [.3, .45]].forEach(function (p, i) {
          ctx.beginPath(); ctx.arc(x + w * p[0], y + h * p[1], Math.max(1.2, h * (i % 2 ? 0.045 : 0.065)), 0, 7); ctx.fill();
        });
      }
      if (finish === 'lights') {
        var cols = ['#ff4d4d', '#ffd23f', '#4dd27a', '#4db8ff', '#ff8adf'];
        var x0 = x - w * 0.05, x1 = x + w * 1.05, yTop = y + h * 0.2, sag = h * 0.42;
        function pt(t) { return [x0 + (x1 - x0) * t, yTop + sag * 4 * t * (1 - t)]; }
        ctx.strokeStyle = '#1d3b2a'; ctx.lineWidth = Math.max(1, h * 0.045); ctx.beginPath();
        for (var s = 0; s <= 24; s++) { var q = pt(s / 24); if (s) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
        ctx.stroke();
        var n = Math.max(4, Math.round(w / (h * 0.45)));
        for (var i = 0; i < n; i++) {
          var p = pt((i + 0.5) / n), c = cols[i % cols.length], r = h * 0.1;
          var g = ctx.createRadialGradient(p[0], p[1] + r, 0, p[0], p[1] + r, r * 3.2);
          g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.55; ctx.fillStyle = g; ctx.fillRect(p[0] - r * 3.2, p[1] + r - r * 3.2, r * 6.4, r * 6.4); ctx.globalAlpha = 1;
          ctx.fillStyle = '#1d3b2a'; ctx.fillRect(p[0] - r * 0.45, p[1] - r * 0.2, r * 0.9, r * 0.6);
          ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(p[0], p[1] + r * 1.05, r * 0.7, r, 0, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(p[0] - r * 0.22, p[1] + r * 0.75, r * 0.22, 0, 7); ctx.fill();
        }
      }
      ctx.restore();
    }
    function photoOf(b) {
      if (!b.photo_url) return null;
      if (b.photo_status === 'approved' || (me && b.user_id === me && b.photo_status === 'pending')) return data.photoUrl(b.photo_url);
      return null;
    }
    var faceMats = [];
    (function () {
      var withPhoto = [], withText = [];
      var FEST = { snow: 1, candy: 1, lights: 1, flag: 1 }, withDiamond = [];
      L.bricks.forEach(function (s, i) { if (s.b.finish === 'diamond') withDiamond.push(i); else if (photoOf(s.b)) withPhoto.push(i); else if (s.b.message || FEST[s.b.finish]) withText.push(i); });
      var pick = withDiamond.slice(-Math.round(MAX_FACES / 4));
      pick = pick.concat(withPhoto.slice(-Math.round(MAX_FACES / 2)));
      pick = pick.concat(withText.slice(-(MAX_FACES - pick.length))).sort(function (a, b) { return a - b; });
      if (!pick.length) return;
      var A = 2048, CW = 192, CH = 84, COLS = Math.floor(A / CW), PER = COLS * Math.floor(A / CH);
      var FW = BL - 0.04, FH = BH - 0.09, FZ = BD / 2 + 0.008, v = new THREE.Vector3();
      function drawCell(g, cx, cy, s, img, flag) {
        var b = s.b, gold = b.finish === 'gold';
        g.save(); g.beginPath(); g.rect(cx, cy, CW, CH); g.clip();
        g.fillStyle = gold ? '#d9a93b' : tints[s.idx]; g.fillRect(cx, cy, CW, CH);
        if (img) { var k = Math.max(CW / img.width, CH / img.height), iw = img.width * k, ih = img.height * k; g.drawImage(img, cx + (CW - iw) / 2, cy + (CH - ih) / 2, iw, ih); }
        paintFestive(g, cx, cy, CW, CH, b.finish, b.color);
        if (b.finish === 'flag' && flag) { var fk = Math.max(CW / 640, CH / 480); g.drawImage(flag, cx + (CW - 640 * fk) / 2, cy + (CH - 480 * fk) / 2, 640 * fk, 480 * fk); }
        if (b.finish === 'diamond' && window.__dbPaintDiamond) window.__dbPaintDiamond(g, cx, cy, CW, CH, 0);
        if (gold) { var gr = g.createLinearGradient(cx, cy, cx + CW, cy + CH); gr.addColorStop(0, 'rgba(255,245,200,.5)'); gr.addColorStop(.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,240,180,.3)'); g.fillStyle = gr; g.fillRect(cx, cy, CW, CH); }
        g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(cx, cy + CH - 5, CW, 5);
        if (b.message) {
          g.font = '700 34px Figtree, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineJoin = 'round';
          g.strokeText(b.message, cx + CW / 2, cy + CH / 2, CW - 14); g.fillStyle = 'rgba(255,255,255,.95)'; g.fillText(b.message, cx + CW / 2, cy + CH / 2, CW - 14);
        }
        g.restore();
      }
      for (var a0 = 0; a0 < pick.length; a0 += PER) (function (list) {
        var cv = document.createElement('canvas'); cv.width = cv.height = A; var g = cv.getContext('2d');
        var tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
        var mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        faceMats.push(mat);
        var pos = [], uv = [], idx = [];
        list.forEach(function (i, n) {
          var s = L.bricks[i]; s.idx = i;
          var cx = (n % COLS) * CW, cy = Math.floor(n / COLS) * CH;
          drawCell(g, cx, cy, s, null);
          var cc = s.b.country || (data.profiles[s.b.user_id] || {}).country;
          if (s.b.finish === 'flag' && /^[A-Z]{2}$/.test(cc || '') && window.__dbFlagUrl) {
            var fl = new Image(); fl.crossOrigin = 'anonymous';
            fl.onload = function () { if (!state) return; try { drawCell(g, cx, cy, s, null, fl); tex.needsUpdate = true; } catch (e) {} };
            fl.src = window.__dbFlagUrl(cc);
          }
          var src = photoOf(s.b);
          if (src) {
            var im = new Image(); im.crossOrigin = 'anonymous';
            im.onload = function () { if (!state) return; try { drawCell(g, cx, cy, s, im); tex.needsUpdate = true; } catch (e) {} };
            im.src = src;
          }
          var u0 = (cx + 2) / A, u1 = (cx + CW - 2) / A, v1 = 1 - (cy + 2) / A, v0 = 1 - (cy + CH - 2) / A;
          bricks.getMatrixAt(i, dummy.matrix);
          [1, -1].forEach(function (side) {
            var base = pos.length / 3;
            // corners: bottom-left, bottom-right, top-right, top-left as seen from that side
            [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { v.set(c[0] * side * FW / 2, c[1] * FH / 2, side * FZ).applyMatrix4(dummy.matrix); pos.push(v.x, v.y, v.z); });
            uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          });
        });
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
        var faces = new THREE.Mesh(geo, mat); faces.receiveShadow = true; scene.add(faces);
      })(pick.slice(a0, a0 + PER));
    })();

    state.faceMats = faceMats;

    /* legendary Diamond bricks: sparkles that twinkle on both faces */
    var sparkMats = [];
    (function () {
      var list = L.bricks.filter(function (s) { return s.b.finish === 'diamond'; }).slice(-150);
      if (!list.length) return;
      var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
      var rg = g.createRadialGradient(32, 32, 0, 32, 32, 30); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(.25, 'rgba(200,240,255,.6)'); rg.addColorStop(1, 'rgba(200,240,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(32, 2); g.quadraticCurveTo(32, 32, 62, 32); g.quadraticCurveTo(32, 32, 32, 62); g.quadraticCurveTo(32, 32, 2, 32); g.quadraticCurveTo(32, 32, 32, 2); g.fill();
      var tex = new THREE.CanvasTexture(c);
      for (var m = 0; m < 4; m++) sparkMats.push(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .8 }));
      var spots = [[-.32, .1], [.3, .14], [.12, -.1]];
      list.forEach(function (s, n) {
        [1, -1].forEach(function (side) {
          spots.forEach(function (sp, k) {
            var sprite = new THREE.Sprite(sparkMats[(n + k + (side > 0 ? 0 : 2)) % 4]);
            sprite.position.set(s.x + sp[0] * BL * side, s.y + sp[1] * BH, side * (BD / 2 + 0.03));
            sprite.scale.set(0.22, 0.22, 1); scene.add(sprite);
          });
        });
      });
    })();

    /* your bricks: outline + pin (the latest 12) */
    var pinGeo = new THREE.ConeGeometry(0.3, 0.9, 16), pinMat = new THREE.MeshBasicMaterial({ color: 0xff9a62 });
    var outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BL + 0.08, BH + 0.02, BD + 0.08)), outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    var pins = mine.slice(-12).map(function (i) {
      var s = L.bricks[i], box = new THREE.LineSegments(outlineGeo, outlineMat); box.position.set(s.x, s.y, 0); scene.add(box);
      var pin = new THREE.Mesh(pinGeo, pinMat); pin.rotation.x = Math.PI; pin.position.set(s.x, TOP + 2, 0); pin.userData.i = i; scene.add(pin); return pin;
    });

    /* next brick + the route still to build */
    var nx = L.next;
    var ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0xff9a62, transparent: true, opacity: .9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(nx.x, nx.y - BH / 2 + 0.02, 0); scene.add(ring);
    var ghost = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(frontX, PLINTH + 0.05, 0), new THREE.Vector3(frontX + 600, PLINTH + 0.05, 0)]),
      new THREE.LineDashedMaterial({ color: 0xffd7b0, dashSize: 1.6, gapSize: 1.2, transparent: true, opacity: .9 }));
    ghost.computeLineDistances(); scene.add(ghost);

    /* Christmas: a decorated tree at the start, falling snow, and Santa's sleigh flying past now and then */
    var xmas = null;
    if (XMAS) xmas = (function () {
      var g = new THREE.Group(); scene.add(g);
      // the tree
      var tx = START - 9, tz = -7, ty = height(tx, tz), tree = new THREE.Group();
      var tTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 8), new THREE.MeshLambertMaterial({ color: 0x5a3a24 })); tTrunk.position.y = 0.8; tree.add(tTrunk);
      [[3.2, 3.4, 2.4], [2.6, 3.0, 4.1], [1.9, 2.6, 5.6], [1.2, 2.0, 6.9]].forEach(function (c) {
        var cone = new THREE.Mesh(new THREE.ConeGeometry(c[0], c[1], 12), new THREE.MeshLambertMaterial({ color: 0x1f5a36 })); cone.position.y = c[2]; cone.castShadow = true; tree.add(cone);
      });
      var balls = [0xff3b4e, 0xffd23f, 0x4fc3ff, 0xff7ad9, 0xffffff];
      var bulbs = [];
      for (var i = 0; i < 46; i++) {
        var h = 1.6 + rnd() * 5.6, rr = (1 - (h - 1.6) / 6.4) * 3.0 + 0.15, a = rnd() * 6.28;
        var b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: balls[i % balls.length] }));
        b.position.set(Math.cos(a) * rr, h, Math.sin(a) * rr); tree.add(b); bulbs.push(b);
      }
      var star = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: 0xffd65a })); star.position.y = 8.3; tree.add(star);
      [[1.6, 0.9, 0xd8283b, 0xffd23f], [-1.4, 1.2, 0x2a9d6f, 0xffffff], [0.2, 1.9, 0x3b6fd8, 0xffd23f]].forEach(function (p) {
        var box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), new THREE.MeshLambertMaterial({ color: p[2] })); box.position.set(p[0], 0.35, p[1]); box.castShadow = true; tree.add(box);
        var rib = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.72, 0.16), new THREE.MeshLambertMaterial({ color: p[3] })); rib.position.copy(box.position); tree.add(rib);
      });
      tree.position.set(tx, ty, tz); g.add(tree);

      // falling snow around wherever you are looking
      var NS = small ? 900 : 1800, BOX = 140, HT = 60, sp = new Float32Array(NS * 3), vel = new Float32Array(NS);
      for (var n = 0; n < NS; n++) { sp[n * 3] = (rnd() - .5) * BOX; sp[n * 3 + 1] = rnd() * HT; sp[n * 3 + 2] = (rnd() - .5) * BOX; vel[n] = 2 + rnd() * 2.5; }
      var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      var flake = canvasTex(32, 32, function (c, w, h) { var gr = c.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
      flake.wrapS = flake.wrapT = THREE.ClampToEdgeWrapping;
      var snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.45, map: flake, transparent: true, depthWrite: false, opacity: .95 }));
      snow.frustumCulled = false; g.add(snow);

      // Santa's sleigh with four reindeer
      var sleigh = new THREE.Group(), red = new THREE.MeshLambertMaterial({ color: 0xc8202f }), goldM = new THREE.MeshLambertMaterial({ color: 0xe8b830 });
      var body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.4), red); body.position.y = 0.9; sleigh.add(body);
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 1.4), red); back.position.set(-1.0, 1.7, 0); sleigh.add(back);
      [-0.62, 0.62].forEach(function (z) {
        var run = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 6, 20, Math.PI * 0.55), goldM); run.rotation.z = Math.PI * 1.23; run.position.set(0.2, 1.55, z); sleigh.add(run);
        var rail = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.1), goldM); rail.position.set(0.1, 0.12, z); sleigh.add(rail);
      });
      var santa = new THREE.Group();
      var sb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), red); sb.position.y = 1.75; santa.add(sb);
      var face = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshLambertMaterial({ color: 0xf2c6a8 })); face.position.set(0.12, 2.45, 0); santa.add(face);
      var beard = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff })); beard.position.set(0.28, 2.3, 0); santa.add(beard);
      var hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 10), red); hat.position.set(0.05, 2.85, 0); hat.rotation.z = 0.35; santa.add(hat);
      var pom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff })); pom.position.set(-0.08, 3.12, 0); santa.add(pom);
      santa.position.x = 0.1; sleigh.add(santa);
      var sack = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), new THREE.MeshLambertMaterial({ color: 0x8a5a2b })); sack.position.set(-0.6, 1.75, 0); sack.scale.set(1, 1.15, 1); sleigh.add(sack);
      var deerM = new THREE.MeshLambertMaterial({ color: 0x7a4a2a }), antM = new THREE.MeshLambertMaterial({ color: 0xd9c3a0 });
      var legs = [];
      for (var r = 0; r < 4; r++) {
        var deer = new THREE.Group(), row = Math.floor(r / 2), side = r % 2 ? 0.75 : -0.75;
        var torso = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 0.55), deerM); torso.position.y = 1.2; deer.add(torso);
        var neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), deerM); neck.position.set(0.65, 1.6, 0); neck.rotation.z = -0.5; deer.add(neck);
        var head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.32), deerM); head.position.set(0.95, 1.95, 0); deer.add(head);
        [-0.12, 0.12].forEach(function (az) { var ant = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), antM); ant.position.set(0.85, 2.3, az); ant.rotation.z = 0.3; deer.add(ant); });
        if (r === 3) { var nose = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 })); nose.position.set(1.25, 1.95, 0); deer.add(nose); }
        [[0.5, .15], [0.5, -.15], [-0.5, .15], [-0.5, -.15]].forEach(function (lp, li) {
          var leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), deerM); leg.position.set(lp[0], 0.6, lp[1]); deer.add(leg); legs.push({ m: leg, ph: r + li * 1.7 });
        });
        deer.position.set(3.6 + row * 2.3, 0, side); sleigh.add(deer);
      }
      var reins = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.9, 1.6, 0), new THREE.Vector3(3.3, 1.3, -0.75), new THREE.Vector3(0.9, 1.6, 0), new THREE.Vector3(3.3, 1.3, 0.75)]), new THREE.LineBasicMaterial({ color: 0xe8b830 }));
      sleigh.add(reins);
      sleigh.scale.setScalar(small ? 2.2 : 2.0); sleigh.visible = false; g.add(sleigh);
      // a trail of sparkles behind the sleigh
      var NT = 140, tp = new Float32Array(NT * 3), tc = new Float32Array(NT * 3), tAge = new Float32Array(NT).fill(9), tHead = 0;
      var tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(tp, 3)); tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      var trail = new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.9, map: flake, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      trail.frustumCulled = false; g.add(trail);
      var ride = null, nextRide = 6;
      return {
        tick: function (dt, now, target) {
          star.rotation.y = now * 1.2;
          bulbs.forEach(function (b, i) { b.visible = reduced || Math.sin(now * 2.5 + i * 1.7) > -0.6; });
          // snow follows the camera's view
          snow.position.set(target.x, 0, target.z);
          if (!reduced) {
            for (var n = 0; n < NS; n++) {
              var iy = n * 3 + 1; sp[iy] -= vel[n] * dt; sp[n * 3] += Math.sin(now * 0.8 + n) * 0.25 * dt;
              if (sp[iy] < 0) { sp[iy] += HT; sp[n * 3] = (rnd() - .5) * BOX; sp[n * 3 + 2] = (rnd() - .5) * BOX; }
            }
            sg.attributes.position.needsUpdate = true;
          }
          // the sleigh: one pass across the sky every 25 to 35 seconds
          if (!ride && now > nextRide) {
            ride = { t: 0, dur: 14, x0: target.x - 110, x1: target.x + 110, z: target.z - 12 - rnd() * 10, y: TOP + 8 + rnd() * 5 };
            sleigh.visible = true;
          }
          if (ride) {
            ride.t += dt;
            var k = ride.t / ride.dur, x = ride.x0 + (ride.x1 - ride.x0) * k;
            sleigh.position.set(x, ride.y + Math.sin(ride.t * 1.6) * 2.2, ride.z);
            sleigh.rotation.z = Math.cos(ride.t * 1.6) * 0.06;
            legs.forEach(function (l) { l.m.rotation.z = Math.sin(now * 9 + l.ph) * 0.6; });
            if (!reduced) for (var e = 0; e < 3; e++) {
              var j = tHead; tHead = (tHead + 1) % NT; tAge[j] = 0;
              tp[j * 3] = x - 2.5 + (rnd() - .5) * 1.5; tp[j * 3 + 1] = sleigh.position.y + 1 + (rnd() - .5) * 1.5; tp[j * 3 + 2] = ride.z + (rnd() - .5) * 1.5;
            }
            if (k >= 1) { ride = null; sleigh.visible = false; nextRide = now + 25 + rnd() * 10; }
          }
          for (var q = 0; q < NT; q++) {
            tAge[q] += dt; var f = Math.max(0, 1 - tAge[q] / 2.2);
            tc[q * 3] = f; tc[q * 3 + 1] = f * 0.85; tc[q * 3 + 2] = f * 0.45; tp[q * 3 + 1] -= dt * 0.8;
          }
          tg.attributes.position.needsUpdate = true; tg.attributes.color.needsUpdate = true;
        }
      };
    })();

    /* camera */
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI / 2 - 0.05; controls.minDistance = 4; controls.maxDistance = 520; controls.screenSpacePanning = false;
    var builtLen = Math.max(12, frontX - START);
    var OVERVIEW = { pos: new THREE.Vector3(START - Math.min(26, builtLen * 0.3), 10 + Math.min(30, builtLen * 0.25), 14 + Math.min(32, builtLen * 0.35)), target: new THREE.Vector3(START + Math.min(builtLen, 200) * 0.45, 2, 0) };
    camera.position.copy(OVERVIEW.pos).add(new THREE.Vector3(30, 60, 90)); controls.target.copy(OVERVIEW.target);
    var tween = null, fly = null, mineIdx = -1, bizIdx = -1, tmp = new THREE.Vector3();
    function goTo(pos, target, dur) { fly = null; tween = { fromP: camera.position.clone(), toP: pos.clone(), fromT: controls.target.clone(), toT: target.clone(), t: 0, dur: reduced ? 0.01 : (dur || 1.6) }; }
    function showTip(html, ms) { tip.innerHTML = html; tip.hidden = false; clearTimeout(showTip.t); showTip.t = setTimeout(function () { tip.hidden = true; }, ms || 5000); }
    function socialLinks(p) {
      var out = '';
      [['instagram', 'Instagram', 'https://www.instagram.com/'], ['tiktok', 'TikTok', 'https://www.tiktok.com/@'], ['facebook', 'Facebook', 'https://www.facebook.com/']].forEach(function (s) {
        if (p && p[s[0]] && /^[A-Za-z0-9._]{1,50}$/.test(p[s[0]])) out += '<a href="' + esc(s[2] + p[s[0]]) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:8px 6px 0 0;padding:7px 12px;border-radius:9px;background:#0f3a3f;color:#f1f7f4;font-weight:700;text-decoration:none">' + s[1] + ' \u2197</a>';
      });
      return out ? '<br>' + out : '';
    }
    function siteLink(e) {
      if (!e.site) return '';
      var host = e.site.replace(/^https?:\/\//i, '').replace(/[\/?#].*$/, '').replace(/^www\./i, '');
      return '<a href="' + esc(e.site) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;padding:8px 14px;border-radius:9px;background:#0f3a3f;color:#f1f7f4;font-weight:700;text-decoration:none">Visit ' + esc(host) + ' \u2197</a>';
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
    goTo(OVERVIEW.pos, OVERVIEW.target, 2.6);

    state.actions = {
      overview: function () { tip.hidden = true; goTo(OVERVIEW.pos, OVERVIEW.target); },
      fly: function () { tip.hidden = true; tween = null; fly = { x: START + 1, speed: reduced ? 0 : 7 }; if (reduced) goTo(new THREE.Vector3(START + 10, TOP + 6, 14), new THREE.Vector3(START + 30, 2, 0)); },
      mine: function () {
        if (!pins.length) { showTip(me ? 'You have no bricks on the wall yet. Place today’s brick to get one!' : 'Log in to find your bricks.'); return; }
        mineIdx = (mineIdx + 1) % pins.length; var s = L.bricks[pins[mineIdx].userData.i];
        goTo(new THREE.Vector3(s.x - 3, s.y + 3.5, 10), new THREE.Vector3(s.x, s.y, 0), 1.4);
        showTip('<strong>Your brick ' + (mineIdx + 1) + ' of ' + pins.length + '</strong> · placed ' + esc(s.b.placed_on) + (pins.length > 1 ? '. Tap again for the next one.' : ''));
      },
      biz: function () {
        if (!towers.length) { showTip('The first tower goes up when the wall reaches 70 bricks. Businesses can sponsor it.'); return; }
        var list = towers.filter(function (t) { return t.sponsor; }); if (!list.length) list = towers;
        bizIdx = (bizIdx + 1) % list.length; var t = list[bizIdx];
        goTo(new THREE.Vector3(t.x - 3, 4.6, 11), new THREE.Vector3(t.x, 4.0, 0), 1.6);
        towerTip(t, list.length > 1 ? 'Tap Sponsors again for the next one.' : '');
      }
    };
    function towerTip(t, extra) {
      if (t.sponsor) {
        var d = new Date(t.until);
        showTip('<strong>' + esc(t.name) + '</strong> sponsors tower ' + t.no + ' · until ' + esc(d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })) + (extra ? '. ' + extra : '') + (t.site ? '<br>' + siteLink(t) : '') + socialLinks(t.prof), t.site || socialLinks(t.prof) ? 9000 : 5000);
      } else {
        showTip('<strong>Tower ' + t.no + ' is free.</strong> Put your business logo on it for R99 for 30 days.' + (extra ? ' ' + extra : '')
          + (opts.onSponsor ? '<br><button type="button" data-sponsor="' + t.no + '" style="margin-top:8px;padding:8px 14px;border:0;border-radius:9px;background:#0f3a3f;color:#f1f7f4;font:700 14px/1.2 inherit">Sponsor tower ' + t.no + '</button>' : ''), 9000);
        var bt = tip.querySelector('[data-sponsor]'); if (bt) bt.addEventListener('click', function () { opts.onSponsor(t.no); });
      }
    }

    var ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), down = null, el = renderer.domElement;
    el.addEventListener('pointerdown', function (ev) { down = { x: ev.clientX, y: ev.clientY }; fly = null; tween = null; });
    el.addEventListener('pointerup', function (ev) {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) { down = null; return; }
      down = null;
      var rc = el.getBoundingClientRect(); ptr.set((ev.clientX - rc.left) / rc.width * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      var hit = ray.intersectObjects(pickables, false)[0];
      if (!hit) { tip.hidden = true; return; }
      if (hit.object.userData.tower) { towerTip(hit.object.userData.tower, ''); return; }
      var s = L.bricks[hit.instanceId]; if (!s) return;
      var ph = photoOf(s.b), p = data.profiles[s.b.user_id] || {}, fin = { diamond: '\ud83d\udc8e Legendary Diamond', gold: 'Gold leaf', glaze: 'Glazed', carved: 'Carved', snow: 'Snow-capped', candy: 'Candy cane', lights: 'Fairy lights', flag: 'Flag' }[s.b.finish];
      var tcc = s.b.country || p.country;
      showTip((/^[A-Z]{2}$/.test(tcc || '') && window.__dbFlagUrl ? '<img src="' + esc(window.__dbFlagUrl(tcc)) + '" alt="" width="20" height="15" style="vertical-align:-2px;margin-right:6px;border-radius:2px">' : '') + '<strong>' + (me && s.b.user_id === me ? 'Your brick' : esc(p.display_name || 'A builder')) + '</strong>' + (fin ? ' · ' + fin : '') + (s.b.message ? ' · “' + esc(s.b.message) + '”' : '') + ' · placed ' + esc(s.b.placed_on)
        + (ph ? (s.b.photo_status === 'pending' ? ' · photo waiting for approval' : '') + '<img src="' + esc(ph) + '" alt="Photo on this brick" style="display:block;width:100%;max-height:38vh;object-fit:cover;border-radius:8px;margin-top:8px">' : '')
        + socialLinks(p), ph || socialLinks(p) ? 9000 : 5000);
    });

    state.resize = function () { var w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 62 : 48; camera.updateProjectionMatrix(); };
    window.addEventListener('resize', state.resize); state.resize();

    var clock = new THREE.Clock(), myState = state;
    function ease(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    (function loop() {
      if (myState.stop) return;
      var dt = Math.min(clock.getDelta(), 0.05), now = clock.elapsedTime;
      if (tween) { tween.t += dt / tween.dur; var k = ease(Math.min(1, tween.t)); camera.position.lerpVectors(tween.fromP, tween.toP, k); controls.target.lerpVectors(tween.fromT, tween.toT, k); if (tween.t >= 1) tween = null; }
      if (fly) { fly.x += fly.speed * dt; if (fly.x > frontX + 8) fly.x = START + 1; camera.position.lerp(tmp.set(fly.x, TOP + 2.4, 5.5), 0.1); controls.target.lerp(tmp.set(fly.x + 14, TOP - 0.5, 0), 0.1); }
      pins.forEach(function (p, n) { p.position.y = TOP + 2 + (reduced ? 0 : Math.sin(now * 2.4 + n) * 0.3); p.rotation.y = now; });
      ring.material.opacity = reduced ? .9 : .55 + .4 * Math.sin(now * 3);
      sparkMats.forEach(function (m, k) { var a = reduced ? .7 : Math.max(0, Math.sin(now * (2.2 + k * .4) + k * 1.7)); m.opacity = a; m.rotation = now * .6 + k; });
      if (xmas) xmas.tick(dt, now, controls.target);
      if (!reduced) towers.forEach(function (t, k) { if (t.flag) t.flag.rotation.y = Math.sin(now * 2.2 + k) * 0.35; });
      sun.target.position.copy(controls.target); sun.position.copy(controls.target).addScaledVector(SUN_DIR, 140); sun.target.updateMatrixWorld();
      if (!fly) controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    })();
  }

  window.DailyBrick3D = {
    open: open,
    close: close,
    act: function (name) { if (state && state.actions && state.actions[name]) state.actions[name](); },
    _layout: layout   // used by tests
  };
})();
