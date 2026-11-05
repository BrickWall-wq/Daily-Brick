/* Daily Brick - 3D wall view.
   Loaded only when someone taps "3D view" on the Wall screen, so the app stays light for everyone else.
   It reads the real bricks from Supabase and lays them in order, like a real builder:
   one course at a time along a section of 20 bricks, bottom course first; when a section is full height the next starts.
   Each day a business builds, its bricks form a round emblem with its logo, set into the wall (as many as fit side by side).
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
  var BL = 1.0, BH = 0.5, BD = 1.9, GAP = 0.06, ROWS = 7, STEP = BL + GAP, SEC = 20, SECT_LEN = SEC * STEP;
  var PLINTH = 0.6, TOP = PLINTH + ROWS * BH, START = 0;
  var EMB_CY = PLINTH + 1.75, EMB_R = 1.25, EMB_HALF = 1.62;
  // emblem centres in a section, in brick columns: as many as fit side by side
  // (the first one starts clear of the half brick that the section before pokes into this one)
  var EMB_COLS = [1.55, 4.834, 8.118, 11.402, 14.686, 17.97];
  function secStartX(sec) { return START + sec * SECT_LEN; }

  function layout(rows) {
    var out = { bricks: [], emblems: [], cap: {} };
    var reserved = {};                     // section -> emblem centres (x)
    var sec = 0, r = 0, c = 0, groups = {};
    function inWindow(s, row, x) {
      var w = reserved[s]; if (!w || row < 1 || row > 5) return false;
      for (var i = 0; i < w.length; i++) if (Math.abs(x - w[i]) < EMB_HALF + BL / 2 - 0.1) return true;
      return false;
    }
    function nextSlot() {
      for (;;) {
        var x = secStartX(sec) + (c + 0.5 + (r % 2 ? 0.5 : 0)) * STEP, s = { sec: sec, row: r, x: x, y: PLINTH + r * BH + BH / 2 };
        c++; if (c >= SEC) { c = 0; r++; if (r >= ROWS) { r = 0; sec++; } }
        if (!inWindow(s.sec, s.row, s.x)) return s;
      }
    }
    function reserveEmblem() {
      // an emblem needs rows 1-5 still empty: the section being built if it is on its first course, else the next ones
      for (var s = (r === 0 ? sec : sec + 1); ; s++) {
        var w = reserved[s] = reserved[s] || [];
        if (w.length < EMB_COLS.length) { var x = secStartX(s) + (EMB_COLS[w.length] + 0.5) * STEP; w.push(x); return { sec: s, x: x }; }
      }
    }
    rows.forEach(function (b) {
      if (b.biz) {
        var key = b.user_id + '|' + b.placed_on, g = groups[key];
        if (!g) { var at = reserveEmblem(); g = groups[key] = { sec: at.sec, x: at.x, user_id: b.user_id, day: b.placed_on, count: 0, firstId: b.id }; out.emblems.push(g); }
        g.count++;
        return;
      }
      var s = nextSlot(); s.b = b; out.bricks.push(s);
    });
    // capacity of each course (after all emblems are known) and how far it is filled
    out.bricks.forEach(function (s) { var k = s.sec + ':' + s.row; out.cap[k] = (out.cap[k] || 0) + 1; });
    var full = {};
    for (var s = 0; s <= sec + 1; s++) for (var row = 0; row < ROWS; row++) {
      var n = 0;
      for (var cc = 0; cc < SEC; cc++) { var x = secStartX(s) + (cc + 0.5 + (row % 2 ? 0.5 : 0)) * STEP; if (!inWindow(s, row, x)) n++; }
      full[s + ':' + row] = n;
    }
    out.rowsDone = function (s) {
      var done = 0;
      for (var row = 0; row < ROWS; row++) {
        var need = full[s + ':' + row] || 0, have = out.cap[s + ':' + row] || 0;
        // a course taken up entirely by emblems counts as finished once the builder has moved past it
        if (need > 0 ? have >= need : (s < sec || (s === sec && row < r))) done = row + 1; else break;
      }
      return done;
    };
    out.cursorSec = sec; out.cursorRow = r; out.reserved = reserved;
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
      return sb.from('bricks').select('id,color,finish,message,photo_url,photo_status,user_id,placed_on,biz').order('id', { ascending: true }).range(from, from + page - 1).then(function (r) {
        if (r.error) throw r.error;
        rows = rows.concat(r.data || []);
        if ((r.data || []).length === page && rows.length < MAX_BRICKS) return more(from + page);
        return rows;
      });
    }
    return more(0).then(function (bricks) {
      var ids = {}; bricks.forEach(function (b) { ids[b.user_id] = 1; });
      var list = Object.keys(ids), out = {};
      var chunks = []; for (var i = 0; i < list.length; i += 200) chunks.push(list.slice(i, i + 200));
      return Promise.all(chunks.map(function (ch) {
        var base = 'id,display_name,business_name,logo_url,logo_status';
        return sb.from('profiles').select(base + ',website,website_status').in('id', ch).then(function (r) {
          return r.error ? sb.from('profiles').select(base).in('id', ch) : r;
        }).then(function (r) { (r.data || []).forEach(function (p) { out[p.id] = p; }); });
      })).then(function () { return { bricks: bricks, profiles: out, photoUrl: function (path) { return sb.storage.from('brick-photos').getPublicUrl(path).data.publicUrl; }, logoUrl: function (path) { return sb.storage.from('brick-photos').getPublicUrl(path).data.publicUrl; } }; });
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
    var lastSec = Math.max(L.cursorSec, L.emblems.reduce(function (m, e) { return Math.max(m, e.sec); }, 0));
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
    scene.add(new THREE.HemisphereLight(0xffe6c8, 0x2c4a3c, 0.62));
    scene.add(new THREE.AmbientLight(0xffffff, 0.1));
    var SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
    var sun = new THREE.DirectionalLight(0xffd7b0, 1.0); sun.castShadow = true;
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
      var dirt = new THREE.Color('#8a7457'), gA = new THREE.Color('#2c5634'), gB = new THREE.Color('#41703c'), hill = new THREE.Color('#24564a'), dry = new THREE.Color('#77804a');
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i), z = pos.getZ(i), y = height(x, z); pos.setY(i, y);
        c.copy(gA).lerp(gB, 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2) * Math.cos(z * 0.13 + x * 0.05));
        c.lerp(dry, Math.max(0, Math.sin(x / 53 + z / 41)) * 0.35); c.lerp(hill, Math.min(1, y / 22) * 0.55);
        var d = Math.abs(z); if (d < 7) c.lerp(dirt, (7 - d) / 7 * 0.85);
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); geo.computeVertexNormals();
      var ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })); ground.receiveShadow = true; scene.add(ground);
      var N = small ? 260 : 420, d0 = new THREE.Object3D(), col = new THREE.Color(), greens = ['#2f5e3a', '#3b6e3f', '#47784a', '#2a5136', '#55824d'];
      var trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.22, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), N);
      var crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
      for (var t = 0; t < N; t++) {
        var x = wallEnd / 2 - W / 2 + rnd() * W, z = (rnd() < .5 ? -1 : 1) * (16 + Math.pow(rnd(), 1.6) * 360), y = height(x, z), s = 0.8 + rnd() * 1.4;
        d0.position.set(x, y + 0.7 * s, z); d0.rotation.set(0, rnd() * 6.28, 0); d0.scale.set(s, s, s); d0.updateMatrix(); trunk.setMatrixAt(t, d0.matrix);
        d0.position.set(x, y + 1.9 * s, z); d0.scale.set(s, s * (1.1 + rnd() * .5), s); d0.updateMatrix(); crown.setMatrixAt(t, d0.matrix);
        crown.setColorAt(t, col.set(greens[Math.floor(rnd() * greens.length)]));
      }
      crown.instanceColor.needsUpdate = true;
      [trunk, crown].forEach(function (m) { m.castShadow = true; m.receiveShadow = true; scene.add(m); });
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
      col.set(s.b.finish === 'gold' ? '#d9a93b' : (s.b.color || '#c9a27e')).multiplyScalar(0.9 + j * 0.18); bricks.setColorAt(i, col); tints[i] = '#' + col.getHexString();
      if (me && s.b.user_id === me) mine.push(i);
    });
    if (!L.bricks.length) bricks.count = 0;
    if (bricks.instanceColor) bricks.instanceColor.needsUpdate = true;

    /* mortar, base, walkway, battlements, guard posts */
    var mortarMat = new THREE.MeshLambertMaterial({ color: 0x8f877b });
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
    var frontX = Math.max(L.bricks.length ? L.bricks[L.bricks.length - 1].x + 1 : START + 2, L.emblems.reduce(function (mx, e) { return Math.max(mx, e.x + EMB_HALF + 0.4); }, 0));
    var plinth = new THREE.Mesh(new THREE.BoxGeometry(frontX - START + 0.6, PLINTH + 0.4, BD + 0.7), new THREE.MeshLambertMaterial({ map: plainTex(Math.max(2, (frontX - START) / 4.5), 2, '#837d72') }));
    plinth.position.set((START + frontX) / 2, (PLINTH + 0.4) / 2 - 0.4, 0); plinth.castShadow = true; plinth.receiveShadow = true; scene.add(plinth);
    var doneX = secStartX(doneSec + 1);
    if (doneSec >= 0) {
      var walk = new THREE.Mesh(new THREE.BoxGeometry(doneX - START + 0.2, 0.18, BD + 0.24), new THREE.MeshLambertMaterial({ map: plainTex(Math.max(2, (doneX - START) / 3), 1, '#958c7e') }));
      walk.position.set((START + doneX) / 2, TOP + 0.09, 0); walk.castShadow = true; walk.receiveShadow = true; scene.add(walk);
      var nm = Math.floor((doneX - START - 0.5) / 1.4), merl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.52, 0.34), new THREE.MeshLambertMaterial({ map: stoneTex(1, 1, '#9b9284') }), nm * 2);
      for (var k = 0; k < nm; k++) [-1, 1].forEach(function (side, j) { dummy.position.set(START + 0.5 + k * 1.4, TOP + 0.44, side * (BD / 2 - 0.06)); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); merl.setMatrixAt(k * 2 + j, dummy.matrix); });
      merl.castShadow = true; merl.receiveShadow = true; scene.add(merl);
      var towerMat = new THREE.MeshLambertMaterial({ map: stoneTex(2, 3, '#8f8576') }), capMat = new THREE.MeshLambertMaterial({ map: stoneTex(2, 1, '#7d7468') }), slitMat = new THREE.MeshBasicMaterial({ color: 0x1d1a17 });
      for (var t = 3; t <= doneSec + 1; t += 3) {
        var tx = secStartX(t) + STEP / 4;
        var nearEmblem = L.emblems.some(function (e) { return Math.abs(e.x - tx) < EMB_HALF + 2.2; });
        if (nearEmblem) continue;
        var hh = TOP + 3.0, g = new THREE.Group();
        var body = new THREE.Mesh(new THREE.BoxGeometry(3.8, hh, 3.8), towerMat); body.position.y = hh / 2; g.add(body);
        var cap = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.45, 4.5), capMat); cap.position.y = hh + 0.22; g.add(cap);
        [[-1.9, -1.9], [0, -1.9], [1.9, -1.9], [-1.9, 0], [1.9, 0], [-1.9, 1.9], [0, 1.9], [1.9, 1.9]].forEach(function (o) { var cr = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.8, 0.85), capMat); cr.position.set(o[0], hh + 0.85, o[1]); g.add(cr); });
        [1, -1].forEach(function (side) { var sl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.05), slitMat); sl.position.set(0, hh - 1.4, side * 1.93); g.add(sl); var dr = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.05), slitMat); dr.position.set(0, PLINTH + 0.9, side * 1.93); g.add(dr); });
        g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.position.set(tx, 0, 0); scene.add(g);
      }
    }

    /* business emblems: their bricks in a ring around their logo */
    var ringOn = new THREE.MeshPhongMaterial({ color: 0x1fb3a0, map: plainTex(1, 1, '#eeeeee', 300), shininess: 10 });
    var ringOff = new THREE.MeshLambertMaterial({ color: 0xcfc6b6, transparent: true, opacity: .55 });
    var backMat = new THREE.MeshLambertMaterial({ map: plainTex(1, 1, '#d6ccbb', 500) });
    var wedgeGeos = [];
    for (var k = 0; k < 10; k++) {
      var a0 = Math.PI / 2 + (k - 0.5) * Math.PI / 5 + 0.022, a1 = a0 + Math.PI / 5 - 0.044, rin = EMB_R - 0.52, rout = EMB_R, sh = new THREE.Shape();
      sh.moveTo(Math.cos(a0) * rin, Math.sin(a0) * rin); sh.lineTo(Math.cos(a0) * rout, Math.sin(a0) * rout);
      sh.absarc(0, 0, rout, a0, a1, false); sh.lineTo(Math.cos(a1) * rin, Math.sin(a1) * rin); sh.absarc(0, 0, rin, a1, a0, true);
      var wg = new THREE.ExtrudeGeometry(sh, { depth: BD + 0.04, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 1, curveSegments: 6 });
      wg.translate(0, 0, -(BD + 0.04) / 2); wedgeGeos.push(wg);
    }
    var backGeo = new THREE.BoxGeometry(EMB_HALF * 2, 5 * BH - 0.04, BD - 0.06), discGeo = new THREE.CircleGeometry(EMB_R - 0.55, 48);
    var logoCache = {}, pickables = [bricks];
    function discTexture(p, img) {
      return canvasTex(512, 512, function (g) {
        g.fillStyle = '#f4efe6'; g.beginPath(); g.arc(256, 256, 256, 0, 7); g.fill();
        g.strokeStyle = '#1fb3a0'; g.lineWidth = 18; g.beginPath(); g.arc(256, 256, 238, 0, 7); g.stroke();
        var name = (p && (p.business_name || p.display_name)) || 'Business';
        if (img) {
          var s = Math.min(300 / img.width, 230 / img.height), w = img.width * s, h = img.height * s;
          g.save(); g.beginPath(); g.arc(256, 256, 230, 0, 7); g.clip(); g.drawImage(img, 256 - w / 2, 215 - h / 2, w, h); g.restore();
          g.fillStyle = '#0f3a3f'; g.font = '700 40px Figtree, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 256, 400, 300);
        } else {
          g.fillStyle = '#0f3a3f'; g.textAlign = 'center'; g.textBaseline = 'middle';
          var words = name.split(' '), lines = [], cur = '';
          words.forEach(function (wd) { if ((cur + ' ' + wd).trim().length > 12 && cur) { lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); });
          if (cur) lines.push(cur); lines = lines.slice(0, 3);
          g.font = '800 64px Figtree, system-ui, sans-serif';
          lines.forEach(function (ln, i) { g.fillText(ln, 256, 256 + (i - (lines.length - 1) / 2) * 72, 380); });
        }
      });
    }
    function loadLogo(url) {
      if (!logoCache[url]) logoCache[url] = new Promise(function (res) { var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; });
      return logoCache[url];
    }
    L.emblems.forEach(function (e) {
      var p = data.profiles[e.user_id] || {}, g = new THREE.Group(); g.position.set(e.x, EMB_CY, 0);
      g.add(new THREE.Mesh(backGeo, backMat));
      for (var k = 0; k < 10; k++) { var v = new THREE.Mesh(wedgeGeos[k], k < e.count ? ringOn : ringOff); v.userData.emb = e; g.add(v); pickables.push(v); }
      var discs = [];
      [1, -1].forEach(function (side) {
        var disc = new THREE.Mesh(discGeo, new THREE.MeshLambertMaterial({ map: discTexture(p, null) }));
        disc.position.z = side * (BD / 2 + 0.035); if (side < 0) disc.rotation.y = Math.PI;
        disc.userData.emb = e; g.add(disc); discs.push(disc); pickables.push(disc);
      });
      if (p.logo_url && p.logo_status === 'approved') loadLogo(data.logoUrl(p.logo_url)).then(function (img) {
        if (!img || !state) return;
        var tex = discTexture(p, img); discs.forEach(function (d) { d.material.map = tex; d.material.needsUpdate = true; });
      });
      g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      e.name = p.business_name || p.display_name || 'Business';
      e.site = (p.website && p.website_status === 'approved' && /^https?:\/\//i.test(p.website)) ? p.website : null;
      scene.add(g);
    });

    /* photos and writing on the brick faces */
    function photoOf(b) {
      if (!b.photo_url) return null;
      if (b.photo_status === 'approved' || (me && b.user_id === me && b.photo_status === 'pending')) return data.photoUrl(b.photo_url);
      return null;
    }
    var faceMats = [];
    (function () {
      var withPhoto = [], withText = [];
      L.bricks.forEach(function (s, i) { if (photoOf(s.b)) withPhoto.push(i); else if (s.b.message) withText.push(i); });
      var pick = withPhoto.slice(-Math.round(MAX_FACES / 2));
      pick = pick.concat(withText.slice(-(MAX_FACES - pick.length))).sort(function (a, b) { return a - b; });
      if (!pick.length) return;
      var A = 2048, CW = 192, CH = 84, COLS = Math.floor(A / CW), PER = COLS * Math.floor(A / CH);
      var FW = BL - 0.04, FH = BH - 0.09, FZ = BD / 2 + 0.008, v = new THREE.Vector3();
      function drawCell(g, cx, cy, s, img) {
        var b = s.b, gold = b.finish === 'gold';
        g.save(); g.beginPath(); g.rect(cx, cy, CW, CH); g.clip();
        g.fillStyle = gold ? '#d9a93b' : tints[s.idx]; g.fillRect(cx, cy, CW, CH);
        if (img) { var k = Math.max(CW / img.width, CH / img.height), iw = img.width * k, ih = img.height * k; g.drawImage(img, cx + (CW - iw) / 2, cy + (CH - ih) / 2, iw, ih); }
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

    /* camera */
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI / 2 - 0.05; controls.minDistance = 4; controls.maxDistance = 520; controls.screenSpacePanning = false;
    var builtLen = Math.max(12, frontX - START);
    var OVERVIEW = { pos: new THREE.Vector3(START - Math.min(26, builtLen * 0.3), 10 + Math.min(30, builtLen * 0.25), 14 + Math.min(32, builtLen * 0.35)), target: new THREE.Vector3(START + Math.min(builtLen, 200) * 0.45, 2, 0) };
    camera.position.copy(OVERVIEW.pos).add(new THREE.Vector3(30, 60, 90)); controls.target.copy(OVERVIEW.target);
    var tween = null, fly = null, mineIdx = -1, bizIdx = -1, tmp = new THREE.Vector3();
    function goTo(pos, target, dur) { fly = null; tween = { fromP: camera.position.clone(), toP: pos.clone(), fromT: controls.target.clone(), toT: target.clone(), t: 0, dur: reduced ? 0.01 : (dur || 1.6) }; }
    function showTip(html, ms) { tip.innerHTML = html; tip.hidden = false; clearTimeout(showTip.t); showTip.t = setTimeout(function () { tip.hidden = true; }, ms || 5000); }
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
        if (!L.emblems.length) { showTip('No business emblems yet. Businesses get their logo on the wall every day they build.'); return; }
        bizIdx = (bizIdx + 1) % L.emblems.length; var e = L.emblems[bizIdx];
        goTo(new THREE.Vector3(e.x - 2.5, EMB_CY + 1.6, 8.5), new THREE.Vector3(e.x, EMB_CY, 0), 1.6);
        showTip('<strong>' + esc(e.name) + '</strong> · ' + e.count + ' of 10 bricks on ' + esc(e.day) + (L.emblems.length > 1 ? '. Tap again for the next one.' : '') + (e.site ? '<br>' + siteLink(e) : ''), e.site ? 9000 : 5000);
      }
    };

    var ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), down = null, el = renderer.domElement;
    el.addEventListener('pointerdown', function (ev) { down = { x: ev.clientX, y: ev.clientY }; fly = null; tween = null; });
    el.addEventListener('pointerup', function (ev) {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) { down = null; return; }
      down = null;
      var rc = el.getBoundingClientRect(); ptr.set((ev.clientX - rc.left) / rc.width * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      var hit = ray.intersectObjects(pickables, false)[0];
      if (!hit) { tip.hidden = true; return; }
      if (hit.object.userData.emb) { var e = hit.object.userData.emb; showTip('<strong>' + esc(e.name) + '</strong> (business) · ' + e.count + ' bricks on ' + esc(e.day) + (e.site ? '<br>' + siteLink(e) : ''), e.site ? 9000 : 5000); return; }
      var s = L.bricks[hit.instanceId]; if (!s) return;
      var ph = photoOf(s.b), p = data.profiles[s.b.user_id] || {}, fin = { gold: 'Gold leaf', glaze: 'Glazed', carved: 'Carved' }[s.b.finish];
      showTip('<strong>' + (me && s.b.user_id === me ? 'Your brick' : esc(p.display_name || 'A builder')) + '</strong>' + (fin ? ' · ' + fin : '') + (s.b.message ? ' · “' + esc(s.b.message) + '”' : '') + ' · placed ' + esc(s.b.placed_on)
        + (ph ? (s.b.photo_status === 'pending' ? ' · photo waiting for approval' : '') + '<img src="' + esc(ph) + '" alt="Photo on this brick" style="display:block;width:100%;max-height:38vh;object-fit:cover;border-radius:8px;margin-top:8px">' : ''), ph ? 9000 : 5000);
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
