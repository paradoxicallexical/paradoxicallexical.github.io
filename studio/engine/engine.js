/*
 * PNC browser engine: plays any game file in the PNC format.
 * Rendering + input + presentation only. All game logic lives in core.js.
 * URL params: ?game=games/<id>/game.json  &fast=1 (instant text, for tests)  &debug=1 (show polygons)
 */
(function () {
  'use strict';
  var Core = window.PNCCore, Audio = window.PNCAudio, Nav = window.PNCNav;
  var params = new URLSearchParams(location.search);
  var FAST = params.get('fast') === '1';
  var DEBUG = params.get('debug') === '1';
  var canvas = document.getElementById('screen'), g = canvas.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };

  var game, base = '', images = {}, state, view = { room: null };
  var W = 1024, H = 576, K = 1;            // logical resolution and canvas backing-store scale (devicePixelRatio)
  var tapLabel = null, hintsUntil = 0, compact = false;
  var player = { x: 0, y: 0, tx: 0, ty: 0, facing: 1, walking: false, onArrive: null, path: [] };
  var meshes = {}, layerCanvas = {}, lastOrder = [], darkCanvas = null;   // per-room nav mesh; per-layer cut-out canvases (built once at load)
  var verb = 'walk', selItem = null, hover = null, mouse = { x: -1, y: -1 };
  var queue = [], speech = null, inDialogue = false, started = false, won = false, t0 = performance.now();
  var dbg = window.PNC_DEBUG = { ready: false, errors: [], log: [] };
  window.addEventListener('error', function (e) { dbg.errors.push(String(e.message)); });

  // ---------- loading ----------
  function asset(p) { return (game.__assets && game.__assets[p]) || (base + p); }
  function loadImage(p) {
    return new Promise(function (res) {
      if (!p || images[p]) return res();
      var im = new Image(); im.onload = function () { images[p] = im; res(); };
      im.onerror = function () { dbg.errors.push('Failed to load ' + p); res(); }; im.src = asset(p);
    });
  }
  function load() {
    var src = params.get('game') || 'games/pickle-heist/game.json';
    var p = window.PNC_EMBEDDED_GAME ? Promise.resolve(window.PNC_EMBEDDED_GAME)
      : fetch(src).then(function (r) { return r.json(); });
    return p.then(function (gm) {
      game = gm; base = window.PNC_EMBEDDED_GAME ? '' : src.replace(/[^/]*$/, '');
      W = game.meta.resolution[0]; H = game.meta.resolution[1]; layout();
      var list = [];
      Object.values(game.rooms).forEach(function (r) { list.push(r.background); (r.props || []).forEach(function (pr) { list.push(pr.image); });
        (r.layers || []).forEach(function (L) { list.push(L.mask || L.image); }); });
      Object.values(game.characters).forEach(function (c) { list.push(c.sprite, c.portrait); });
      Object.values(game.items).forEach(function (it) { if (it.image) list.push(it.image); });
      // never let a slow/failed image decode block the game forever (seen as an endless loading screen)
      return Promise.race([Promise.all(list.map(loadImage)), new Promise(function (r) { setTimeout(function () { dbg.errors.push('image load timeout'); r(); }, 12000); })]);
    }).then(buildLayers);
  }

  // ---------- foreground layers ----------
  // A layer is a piece of the background (counter, lamp post...) that is redrawn on top of any actor
  // standing behind it (feet above its baseline_y). It is cut from the background at load time with
  // either an alpha mask image (mask + rect), a polygon, or comes as a ready-cut image (image + at).
  function buildLayers() {
    Object.keys(game.rooms).forEach(function (rid) {
      var R = game.rooms[rid], bg = images[R.background];
      (R.layers || []).forEach(function (L, i) {
        var key = rid + '/' + (L.id || i);
        try {
          if (L.image) { layerCanvas[key] = images[L.image] ? { c: images[L.image], x: L.at[0], y: L.at[1] } : null; return; }
          if (!bg) return;
          var box = L.rect;
          if (!box && L.polygon) { var xs = L.polygon.map(function (q) { return q[0]; }), ys = L.polygon.map(function (q) { return q[1]; });
            var x0 = Math.floor(Math.min.apply(0, xs)) - 1, y0 = Math.floor(Math.min.apply(0, ys)) - 1;
            box = [x0, y0, Math.ceil(Math.max.apply(0, xs)) + 2 - x0, Math.ceil(Math.max.apply(0, ys)) + 2 - y0]; }
          // cut at the background's native resolution so the cut-out lines up pixel for pixel
          var sx = bg.naturalWidth / W, sy = bg.naturalHeight / H;
          var c = document.createElement('canvas'); c.width = Math.round(box[2] * sx); c.height = Math.round(box[3] * sy);
          var cg = c.getContext('2d');
          cg.drawImage(bg, box[0] * sx, box[1] * sy, c.width, c.height, 0, 0, c.width, c.height);
          cg.globalCompositeOperation = 'destination-in';
          if (L.mask && images[L.mask]) cg.drawImage(images[L.mask], 0, 0, c.width, c.height);
          else if (L.polygon) { cg.beginPath(); L.polygon.forEach(function (q, k) { var X = (q[0] - box[0]) * sx, Y = (q[1] - box[1]) * sy; k ? cg.lineTo(X, Y) : cg.moveTo(X, Y); }); cg.closePath(); cg.fill(); }
          layerCanvas[key] = { c: c, x: box[0], y: box[1], w: box[2], h: box[3] };
        } catch (e) { dbg.errors.push('layer ' + key + ': ' + e.message); }
      });
    });
  }
  function drawLayer(rid, L, i, ctx) {
    var lc = layerCanvas[rid + '/' + (L.id || i)]; if (!lc) return;
    (ctx || g).drawImage(lc.c, lc.x, lc.y, lc.w || lc.c.width, lc.h || lc.c.height);
  }
  function mesh(rid) { rid = rid || view.room; return meshes[rid] || (meshes[rid] = new Nav.Mesh(game.rooms[rid])); }

  // ---------- geometry ----------
  function pip(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function area(poly) { var a = 0; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a / 2); }
  function room() { return game.rooms[view.room]; }
  function depthScale(y) {
    var d = room().depth; if (!d) return 1;
    var t = (y - d.far_y) / (d.near_y - d.far_y); t = Math.max(0, Math.min(1.2, t));
    return d.far_scale + t * (d.near_scale - d.far_scale);
  }
  // Screen rect of an actor sprite (anchored bottom-centre)
  function actorRect(a, x, y) {
    var ch = game.characters[a.character], im = images[ch.sprite]; if (!im) return null;
    var s = a.scale || depthScale(y); return { x: x - im.width * s / 2, y: y - im.height * s, w: im.width * s, h: im.height * s, s: s, im: im };
  }

  // ---------- targets / hit test ----------
  function visibleTargets() { return Core.targets(game, Object.assign({}, state, { room: view.room })); }
  function hitTest(x, y) {
    var ts = visibleTargets(), best = null, bestArea = Infinity;
    var actors = ts.filter(function (t) { return t.kind === 'actor'; }).sort(function (a, b) { return b.def.at[1] - a.def.at[1]; });
    for (var i = 0; i < actors.length; i++) {
      var r = actorRect(actors[i].def, actors[i].def.at[0], actors[i].def.at[1]);
      if (r && x >= r.x + r.w * 0.15 && x <= r.x + r.w * 0.85 && y >= r.y + r.h * 0.05 && y <= r.y + r.h) return actors[i];
    }
    ts.forEach(function (t) {
      if (t.kind !== 'hotspot') return;
      if (pip([x, y], t.def.polygon)) { var a = area(t.def.polygon); if (a < bestArea) { bestArea = a; best = t; } }
    });
    return best;
  }
  // A point inside the target that really hit-tests to it (used by automated tests)
  dbg.targetPoint = function (id) {
    var t = visibleTargets().find(function (x) { return x.id === id; }); if (!t) return null;
    var box;
    if (t.kind === 'actor') { var r = actorRect(t.def, t.def.at[0], t.def.at[1]); box = [r.x, r.y, r.x + r.w, r.y + r.h]; }
    else { var xs = t.def.polygon.map(function (p) { return p[0]; }), ys = t.def.polygon.map(function (p) { return p[1]; });
      box = [Math.min.apply(0, xs), Math.min.apply(0, ys), Math.max.apply(0, xs), Math.max.apply(0, ys)]; }
    var cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, best = null, bd = Infinity;
    for (var x = box[0]; x <= box[2]; x += 4) for (var y = box[1]; y <= box[3]; y += 4) {
      var h = hitTest(x, y); if (h && h.id === id) { var d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = [x, y]; } }
    }
    return best;
  };
  dbg.busy = function () { return !started || player.walking || !!speech || queue.length > 0; };
  dbg.teleport = function (rid) { var r = game.rooms[rid]; var c = r.walkable.reduce(function (a, p) { return [a[0] + p[0] / r.walkable.length, a[1] + p[1] / r.walkable.length]; }, [0, 0]);
    speech = null; queue = []; state.room = rid; enterRoom(rid, mesh(rid).clamp(c)); };
  dbg.place = function (x, y, f) { player.x = player.tx = x; player.y = player.ty = y; player.walking = false; player.path = []; if (f) player.facing = f; };
  dbg.setFlags = function (f) { for (var k in f) { if (f[k]) state.flags[k] = true; else delete state.flags[k]; } };
  dbg.player = function () { return { x: player.x, y: player.y, walking: player.walking, path: player.path.slice() }; };
  dbg.walkTo = function (x, y) { walkTo([x, y]); return player.path.slice(); };
  dbg.inside = function (x, y, rid) { return mesh(rid).inside([x, y]); };
  dbg.drawOrder = function () { return lastOrder.slice(); };
  dbg.state = function () { return JSON.parse(JSON.stringify(state)); };
  dbg.view = function () { return { room: view.room, inDialogue: inDialogue, won: won, verb: verb, selItem: selItem }; };

  // ---------- event playback ----------
  function push(events) { queue = queue.concat(events); pump(); }
  function pump() {
    while (!speech && queue.length && !player.walking) {
      var e = queue.shift();
      dbg.log.push(e);
      if (e.type === 'say') { startSpeech(e); return; }
      if (e.type === 'room') enterRoom(e.room, e.at);
      if (e.type === 'sfx') Audio.sfx(e.name);
      if (e.type === 'dialogue') showChoices();
      if (e.type === 'dialogue_end') hideChoices();
      if (e.type === 'win') showWin();
    }
    renderHud();
  }
  function startSpeech(e) {
    var ch = game.characters[e.by] || {};
    var dur = FAST ? 60 : Math.max(1600, e.text.length * 65);
    speech = { by: e.by, text: e.text, until: performance.now() + dur, color: ch.color || '#fff' };
    if (!FAST) {
      var sp = speech;
      var spoke = Audio.speak(e.text, ch.voice, function () { if (speech === sp) speech.until = Math.min(speech.until, performance.now() + 250); });
      if (spoke) speech.until = performance.now() + Math.max(dur, e.text.length * 90 / ((ch.voice && ch.voice.rate) || 1));
    }
    renderHud();
  }
  function endSpeech() { speech = null; Audio.hush(); pump(); }

  function enterRoom(id, at) {
    view.room = id; var p0 = mesh(id).clamp(at); player.x = player.tx = p0[0]; player.y = player.ty = p0[1]; player.walking = false; player.path = [];
    hover = null; updateMusic();
  }
  function updateMusic() { var tr = Core.musicFor(game, state, view.room); Audio.playMusic(tr, tr && game.music[tr]); }

  // ---------- actions ----------
  // Walk around obstacles: A* over the room's nav mesh, then follow the waypoints.
  function walkTo(pt, cb) {
    var m = mesh(), path = m.path([player.x, player.y], pt);
    if (!path || !path.length) path = [m.clamp(pt)];
    player.path = path; var p = path[0];
    player.tx = p[0]; player.ty = p[1]; player.walking = true; player.onArrive = cb || null;
  }
  function targetWalkPoint(t, click) {
    if (t.def.walk_to) return t.def.walk_to;
    if (t.kind === 'actor') { var a = t.def.at, ar = actorRect(t.def, a[0], a[1]), off = (ar ? ar.w * 0.5 : 60) + 45; return [a[0] + (a[0] > player.x ? -off : off), a[1] + 6]; }
    return click;
  }
  function perform(t, click) {
    var action = selItem ? { verb: 'use_item', target: t.id, item: selItem }
      : { verb: verb, target: t.id };
    var face = t.kind === 'actor' ? t.def.at[0] : (t.def.polygon ? t.def.polygon.reduce(function (s, p) { return s + p[0]; }, 0) / t.def.polygon.length : click[0]);
    resetVerb();
    walkTo(targetWalkPoint(t, click), function () {
      player.facing = face >= player.x ? 1 : -1;
      var r = Core.act(game, state, action); state = r.state;
      updateMusic();
      push(r.events);
    });
  }
  function resetVerb() { verb = 'walk'; selItem = null; renderHud(); }

  function onCanvasClick(ev) {
    if (!started) return;
    var p = toLogical(ev);
    if (speech) { endSpeech(); return; }
    if (inDialogue || won || queue.length) return;
    var t = hitTest(p[0], p[1]);
    if (t) perform(t, p);
    else { resetVerb(); walkTo(p); }
  }
  function onItemClick(id) {
    if (!started || speech || inDialogue || won || player.walking) return;
    if (verb === 'use' && !selItem) { selItem = id; renderHud(); return; }
    if (selItem) { var a = selItem; resetVerb(); push([{ type: 'say', by: game.meta.player.character, text: a === id ? "Using it on itself? Deep." : "Those two don't go together." }]); return; }
    var v = verb === 'walk' ? 'look' : verb;
    var r = v === 'pickup' ? { state: state, events: [{ type: 'say', by: game.meta.player.character, text: 'I already have it.' }] }
      : Core.act(game, state, { verb: v, target: 'item:' + id });
    resetVerb(); push(r.events);
  }
  function toLogical(ev) {
    var r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height];
  }
  function cssScale() { var r = canvas.getBoundingClientRect(); return r.width ? W / r.width : 1; }

  // ---------- responsive layout ----------
  // compact = phone-sized: stacked HUD, big buttons, speech shown as HTML captions (canvas text would be ~8px).
  // landscape-phone = short landscape viewport: scene left, controls right. Canvas backing store follows devicePixelRatio.
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight, b = document.body, st = $('stage');
    var landscapePhone = vw > vh && vh < 520;
    compact = landscapePhone || vw < 720;
    b.classList.toggle('compact', compact);
    b.classList.toggle('landscape-phone', landscapePhone);
    b.classList.toggle('portrait-phone', !landscapePhone && vw < 520 && vh > vw);
    if (landscapePhone) {
      var hudW = Math.max(190, Math.min(300, vw * 0.27));
      var w = Math.min(vw - hudW - 16, (vh - 4) * W / H);
      st.style.width = Math.floor(w) + 'px'; st.style.height = Math.floor(w * H / W) + 'px';
    } else { st.style.width = ''; st.style.height = ''; }
    var cssW = st.getBoundingClientRect().width || W, dpr = window.devicePixelRatio || 1;
    var k = Math.max(1, Math.min(2, cssW * dpr / W));
    if (Math.abs(k - K) > 0.01 || canvas.width !== Math.round(W * k)) {
      K = k; canvas.width = Math.round(W * K); canvas.height = Math.round(H * K);
    }
    g.setTransform(K, 0, 0, K, 0, 0);
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  // ---------- dialogue / win ----------
  function showChoices() {
    inDialogue = true;
    var box = $('choices'); box.innerHTML = '';
    Core.choices(game, state).forEach(function (c) {
      var b = document.createElement('button'); b.className = 'choice'; b.textContent = c.text;
      b.onclick = function () {
        if (speech || queue.length) return;
        hideChoices();
        var r = Core.choose(game, state, c.index); state = r.state; push(r.events);
      };
      box.appendChild(b);
    });
    $('hud').classList.add('dialogue');
  }
  function hideChoices() { inDialogue = false; $('hud').classList.remove('dialogue'); $('choices').innerHTML = ''; }
  function showWin() {
    won = true;
    var ov = $('win'); $('win-title').textContent = game.win.title || 'YOU WIN';
    $('win-text').textContent = game.win.text || ''; ov.style.display = 'flex';
  }

  // ---------- HUD ----------
  function renderHud() {
    if (!game) return;
    var vb = $('verbs');
    if (!vb.childElementCount) game.verbs.order.forEach(function (v) {
      var b = document.createElement('button'); b.className = 'verb'; b.dataset.verb = v; b.textContent = game.verbs.labels[v];
      b.onclick = function () { if (speech || inDialogue) return; verb = v; selItem = null; renderHud(); };
      vb.appendChild(b);
    });
    Array.prototype.forEach.call(vb.children, function (b) { b.classList.toggle('active', b.dataset.verb === verb); });
    var inv = $('inventory'); inv.innerHTML = '';
    state.inv.forEach(function (id) {
      var it = game.items[id], d = document.createElement('button'); d.type = 'button';
      d.className = 'item' + (selItem === id ? ' selected' : ''); d.dataset.item = id; d.title = it.name;
      d.innerHTML = (it.image ? '<img class="icon" src="' + asset(it.image) + '">' : '<span class="icon">' + (it.icon || '?') + '</span>') + '<span class="iname">' + it.name + '</span>';
      d.onclick = function () { onItemClick(id); };
      d.onmouseenter = function () { hover = { name: it.name, item: true }; renderSentence(); };
      d.onmouseleave = function () { hover = null; renderSentence(); };
      inv.appendChild(d);
    });
    var who = speech ? game.characters[speech.by] : null;
    $('hud').classList.toggle('speaking', !!speech);
    if (who) { $('cap-name').textContent = who.name + ':'; $('cap-name').style.color = who.color || '#f5d76e'; $('cap-text').textContent = speech.text;
      var cp = $('cap-portrait'); if (who.portrait) { cp.src = asset(who.portrait); cp.style.display = ''; } else cp.style.display = 'none'; }
    var pt = $('portrait');
    if (who && who.portrait) { pt.src = asset(who.portrait); pt.style.visibility = 'visible'; $('pname').textContent = who.name; }
    else { pt.style.visibility = 'hidden'; $('pname').textContent = ''; }
    $('btn-music').textContent = 'Music: ' + (Audio.musicOn ? 'on' : 'off');
    $('btn-voice').textContent = 'Voices: ' + (Audio.voiceOn ? 'on' : 'off');
    renderSentence();
  }
  function renderSentence() {
    var s = game.verbs.labels[verb];
    if (selItem) s = 'Use ' + game.items[selItem].name + ' with';
    if (hover) s += ' ' + hover.name;
    $('sentence').textContent = inDialogue ? 'Choose what to say:' : s;
  }

  // ---------- rendering ----------
  function drawSprite(im, x, y, s, flip, rot, bob, sx, sy) {
    var w = im.width * s, h = im.height * s;
    g.save(); g.translate(x, y - (bob || 0)); if (rot) g.rotate(rot); if (flip) g.scale(-1, 1);
    if (sx || sy) g.scale(sx || 1, sy || 1);
    g.drawImage(im, -w / 2, -h, w, h); g.restore();
  }
  function wrap(text, maxW) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines;
  }
  function labelFont(px) { return 'bold ' + Math.round(Math.max(px, 15 * cssScale())) + 'px "Trebuchet MS", Verdana, sans-serif'; }
  function drawLabel(text, x, y) {
    g.font = labelFont(18); g.textAlign = 'center'; g.textBaseline = 'bottom';
    var w = g.measureText(text).width / 2 + 6; x = Math.max(w, Math.min(W - w, x)); y = Math.max(parseInt(g.font.split(' ')[1], 10) + 4, y);
    g.lineWidth = 4 * Math.max(1, cssScale() / 2); g.strokeStyle = '#000'; g.strokeText(text, x, y); g.fillStyle = '#fff'; g.fillText(text, x, y);
  }
  function drawSpeech(now) {
    if (!speech || compact) return;
    var sx = W / 2, sy = 60;
    if (speech.by === game.meta.player.character) {
      var r = actorRect({ character: speech.by }, player.x, player.y); if (r) { sx = player.x; sy = r.y - 10; }
    } else {
      var t = visibleTargets().find(function (x) { return x.kind === 'actor' && x.id === speech.by; });
      if (t) { var r2 = actorRect(t.def, t.def.at[0], t.def.at[1]); sx = t.def.at[0]; sy = r2.y - 10; }
    }
    g.font = 'bold 22px "Trebuchet MS", Verdana, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    var lines = wrap(speech.text, 440), lh = 26;
    sy = Math.max(sy, lines.length * lh + 8); sx = Math.max(230, Math.min(W - 230, sx));
    lines.forEach(function (l, i) {
      var y = sy - (lines.length - 1 - i) * lh;
      g.lineWidth = 5; g.strokeStyle = '#000'; g.strokeText(l, sx, y); g.fillStyle = speech.color; g.fillText(l, sx, y);
    });
  }
  function frame(now) {
    var dt = Math.min(0.05, (now - (frame.last || now)) / 1000); frame.last = now;
    if (speech && now > speech.until) endSpeech();
    // walk
    if (player.walking) {
      var dx = player.tx - player.x, dy = player.ty - player.y, d = Math.hypot(dx, dy);
      var sp = (FAST ? 4000 : 230) * depthScale(player.y) / 0.6 * dt;
      if (Math.abs(dx) > 2) player.facing = dx > 0 ? 1 : -1;
      if (d <= sp && player.path.length > 1) { player.x = player.tx; player.y = player.ty; player.path.shift(); player.tx = player.path[0][0]; player.ty = player.path[0][1]; }
      else if (d <= sp) { player.x = player.tx; player.y = player.ty; player.walking = false; player.path = []; var cb = player.onArrive; player.onArrive = null; if (cb) cb(); pump(); }
      else { player.x += dx / d * sp; player.y += dy / d * sp; }
    }
    if (game && view.room) render(now);
    requestAnimationFrame(frame);
  }
  function render(now) {
    var R = room(), t = (now - t0) / 1000;
    g.clearRect(0, 0, W, H);
    var bg = images[R.background]; if (bg) g.drawImage(bg, 0, 0, W, H);
    drawAmbient(R, t);
    // Props without a baseline are painted onto the background (wall decals etc.)
    (R.props || []).forEach(function (p) { if (p.baseline_y === undefined && Core.cond(game, state, p.if) && images[p.image]) g.drawImage(images[p.image], p.at[0], p.at[1]); });
    // Everything that stands on the floor is drawn back-to-front by the y where it touches the floor:
    // actors by their feet, foreground layers and props by their baseline_y. Ties go to the layer first,
    // so an actor standing exactly on a baseline is in front of it.
    var list = visibleTargets().filter(function (x) { return x.kind === 'actor'; }).map(function (x) { return { a: x.def, y: x.def.at[1], x: x.def.at[0], id: x.id }; });
    list.push({ player: true, y: player.y, x: player.x, id: 'player' });
    (R.layers || []).forEach(function (L, i) { if (Core.cond(game, state, L.if)) list.push({ layer: L, i: i, y: L.baseline_y, id: 'layer:' + (L.id || i), k: -1 }); });
    (R.props || []).forEach(function (p) { if (p.baseline_y !== undefined && Core.cond(game, state, p.if)) list.push({ prop: p, y: p.baseline_y, id: 'prop:' + p.image, k: -1 }); });
    list.sort(function (a, b) { return (a.y - b.y) || ((a.k || 0) - (b.k || 0)); });
    lastOrder = list.map(function (o) { return o.id; });
    list.forEach(function (o, idx) {
      if (o.layer) { drawLayer(view.room, o.layer, o.i); return; }
      if (o.prop) { if (images[o.prop.image]) g.drawImage(images[o.prop.image], o.prop.at[0], o.prop.at[1]); return; }
      if (o.player) {
        var pc = game.characters[game.meta.player.character], im = images[pc.sprite]; if (!im) return;
        var nativeRight = pc.faces !== 'left', flip = (player.facing === 1) !== nativeRight;
        var bob = player.walking ? Math.abs(Math.sin(t * 12)) * 6 : 0, rot = player.walking ? Math.sin(t * 12) * 0.04 : 0;
        var ps = depthScale(player.y);
        shadow(player.x, player.y, im.width * ps, bob / 40);
        drawSprite(im, player.x, player.y, ps, flip, rot, bob);
      } else {
        var ch = game.characters[o.a.character], im2 = images[ch.sprite], s = o.a.scale || depthScale(o.y);
        if (!im2) return;
        var dance = o.a.anim === 'dance';
        if (dance) {
          var dx = Math.sin(t * 5) * 30, hop = Math.abs(Math.sin(t * 10)) * 18;
          if (o.a.shadow !== false && !o.a.scale) shadow(o.x + dx, o.y, im2.width * s, hop / 40);
          drawSprite(im2, o.x + dx, o.y, s, !!o.a.flip !== (Math.sin(t * 2.5) > 0), Math.sin(t * 10) * 0.18, hop);
        } else {
          var P = idlePose(o, ch, t);
          if (o.a.shadow !== false && !o.a.scale) shadow(o.x + P.dx, o.y, im2.width * s * P.sx, P.dy / 40);
          drawSprite(im2, o.x + P.dx, o.y, s, P.flip, P.rot, P.dy, P.sx, P.sy);
        }
      }
    });
    // darkness
    if (R.darkness && Core.cond(game, state, R.darkness.if)) {
      var gl = R.darkness.glow || [W / 2, H / 2, 100];
      var grad = g.createRadialGradient(gl[0], gl[1], 10, gl[0], gl[1], gl[2] * 3);
      grad.addColorStop(0, 'rgba(0,25,5,' + (R.darkness.alpha - 0.35) + ')'); grad.addColorStop(1, 'rgba(0,0,0,' + R.darkness.alpha + ')');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      // keep the player readable: re-draw them faintly, but still masked by any layer in front of them
      var pr = actorRect({ character: game.meta.player.character }, player.x, player.y);
      if (pr) {
        var oc = darkCanvas || (darkCanvas = document.createElement('canvas'));
        if (oc.width !== canvas.width || oc.height !== canvas.height) { oc.width = canvas.width; oc.height = canvas.height; }
        var og = oc.getContext('2d'); og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, oc.width, oc.height); og.setTransform(K, 0, 0, K, 0, 0);
        var pc2 = game.characters[game.meta.player.character], gsave = g; g = og;
        drawSprite(pr.im, player.x, player.y, pr.s, (player.facing === 1) !== (pc2.faces !== 'left'), 0, 0);
        g = gsave; og.globalCompositeOperation = 'destination-out';
        (R.layers || []).forEach(function (L, i) { if (L.baseline_y > player.y && Core.cond(game, state, L.if)) drawLayer(view.room, L, i, og); });
        og.globalCompositeOperation = 'source-over';
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 0.55; g.drawImage(oc, 0, 0); g.restore();
      }
    }
    if (DEBUG) drawDebug(R);
    // hover label near the cursor (re-hit-test every frame so state changes update it)
    if (mouse.x >= 0 && !(hover && hover.item)) { var ht = hitTest(mouse.x, mouse.y), old = hover && hover.name; hover = ht ? { name: ht.name } : null; if ((hover && hover.name) !== old) renderSentence(); }
    if (hover && !hover.item && !speech && !inDialogue && mouse.x >= 0) drawLabel(hover.name, mouse.x, mouse.y - 14);
    // touch: name of the thing just tapped (there is no hover on a phone)
    if (tapLabel && now < tapLabel.until && !inDialogue) drawLabel(tapLabel.name, tapLabel.x, tapLabel.y);
    // "Show hotspots" button: label everything clickable for a few seconds
    if (now < hintsUntil && !inDialogue) visibleTargets().forEach(function (t) {
      var pt = dbg.targetPoint(t.id); if (!pt) return;
      g.fillStyle = 'rgba(245,215,110,0.9)'; g.beginPath(); g.arc(pt[0], pt[1], 6 * Math.max(1, cssScale() / 1.5), 0, Math.PI * 2); g.fill();
      drawLabel(t.name, pt[0], pt[1] - 10);
    });
    drawSpeech(now);
  }
  // ---------- idle behaviour (procedural: breathing, ambient actions, facing the player) ----------
  // characters[id].idle = { breathe, period, face_player, face_radius, actions: [{ type, every: [min,max] s, dur }] }
  var idleState = {}, forced = null;
  function rnd(r) { return r[0] + Math.random() * (r[1] - r[0]); }
  function idlePose(o, ch, t) {
    var I = ch.idle || {}, key = view.room + ':' + o.id, st = idleState[key];
    var phase = (o.x * 0.013) % 6.28, P = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };
    var nativeRight = ch.faces !== 'left', baseDir = (!!o.a.flip) !== nativeRight ? 1 : -1, dir = baseDir;
    var talking = speech && speech.by === o.a.character, busy = inDialogue || talking;
    // breathing: gentle vertical squash/stretch about the feet (volume roughly kept)
    var b = Math.sin(t * 6.283 / (I.period || 3.2) + phase) * (I.breathe === undefined ? 0.012 : I.breathe);
    P.sy += b; P.sx -= b * 0.5;
    if (talking) { P.sy += Math.abs(Math.sin(t * 13)) * 0.02; P.rot += Math.sin(t * 6.5) * 0.015; }
    // face the player when they come close or during a conversation
    if (I.face_player !== false && (busy || Math.hypot(player.x - o.x, player.y - o.y) < (I.face_radius || 230))) dir = player.x >= o.x ? 1 : -1;
    // ambient actions on randomized timers (suppressed while talking, so the speaker just breathes and nods)
    var acts = I.actions || [];
    if (!st) st = idleState[key] = { next: t + 1 + Math.random() * 3, act: null };
    if (forced && forced.id === o.id) { st.act = { type: forced.type, start: t, dur: forced.dur || 2 }; forced = null; }
    if (busy) st.act = null;
    else if (!st.act && acts.length && t >= st.next) { var a = acts[Math.floor(Math.random() * acts.length)]; st.act = { type: a.type, start: t, dur: a.dur || 2, sign: Math.random() < 0.5 ? -1 : 1 }; }
    if (st.act) {
      var p = (t - st.act.start) / st.act.dur;
      if (p >= 1) { var a2 = acts.filter(function (x) { return x.type === st.act.type; })[0] || { every: [4, 9] }; st.act = null; st.next = t + rnd(a2.every || [4, 9]); }
      else {
        var env = Math.sin(Math.PI * p), sg = st.act.sign || 1;
        switch (st.act.type) {
          case 'wipe': P.dx += Math.sin(p * Math.PI * 6) * 9 * env; P.rot += 0.07 * env * dir; P.sy -= 0.02 * env; break;
          case 'shift': P.rot += 0.045 * env * sg; P.dx += 5 * env * sg; break;
          case 'look': if (p > 0.2 && p < 0.75) dir = -dir; P.sy += 0.015 * env; break;
          case 'ruffle': P.sx += 0.07 * Math.sin(p * 70) * env; P.sy -= 0.035 * env; P.rot += 0.03 * Math.sin(p * 45) * env; break;
          case 'bob': P.dy += Math.abs(Math.sin(p * Math.PI * 4)) * 5 * env; P.rot += 0.12 * Math.sin(p * Math.PI * 4) * env * dir; break;
          case 'hop': var q = Math.max(0, Math.min(1, (p - 0.15) / 0.7)); P.dy += Math.sin(Math.PI * q) * 16;
            if (p < 0.15 || p > 0.85) { P.sy -= 0.14 * Math.sin(Math.PI * (p < 0.15 ? p / 0.15 : (p - 0.85) / 0.15)); P.sx += 0.08 * Math.sin(Math.PI * (p < 0.15 ? p / 0.15 : (p - 0.85) / 0.15)); }
            if (p > 0.5 && sg > 0) dir = -dir; break;
          case 'flap': P.sx += 0.14 * Math.sin(p * 55) * env; P.sy += 0.05 * Math.cos(p * 55) * env; P.dy += 7 * env; P.rot += 0.05 * Math.sin(p * 30) * env; break;
        }
      }
    }
    P.flip = (dir === 1) !== nativeRight;
    return P;
  }
  dbg.idle = function () { var r = {}; for (var k in idleState) r[k] = idleState[k].act ? idleState[k].act.type : null; return r; };
  dbg.forceIdle = function (id, type, dur) { forced = { id: id, type: type, dur: dur }; };
  // Room ambience: drawn right over the background, so every actor and foreground layer stays in front.
  var steamPuffs = [];
  function drawAmbient(R, t, dt) {
    (R.ambient || []).forEach(function (A, n) {
      if (!Core.cond(game, state, A.if)) return;
      if (A.type === 'steam') {
        var key = view.room + n; for (var k = 0; k < (A.count || 7); k++) {
          var life = A.life || 3.2, age = ((t + k * life / (A.count || 7)) % life) / life;
          var x = A.at[0] + Math.sin(t * 1.3 + k * 2.1) * 6 * age + ((k * 37) % (A.width || 40)) - (A.width || 40) / 2, y = A.at[1] - age * (A.rise || 70), r = 6 + age * 16;
          var gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,' + (0.32 * Math.sin(Math.PI * age)) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
        }
      } else if (A.type === 'glow' || A.type === 'flicker') {
        var f = A.type === 'glow' ? 0.75 + 0.25 * Math.sin(t * (A.speed || 2)) : (Math.sin(t * 23) + Math.sin(t * 7.3) > 1.5 || ((t * 1000) % 4300) < 120 ? 0.15 : 0.9);
        var gr2 = g.createRadialGradient(A.at[0], A.at[1], 0, A.at[0], A.at[1], A.radius || 40);
        gr2.addColorStop(0, A.color.replace('A', (A.alpha || 0.45) * f)); gr2.addColorStop(1, A.color.replace('A', 0));
        g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr2; g.beginPath(); g.arc(A.at[0], A.at[1], A.radius || 40, 0, 6.283); g.fill(); g.restore();
      }
    });
  }
  // Soft contact shadow: a squashed radial gradient under the feet (shrinks/fades as the actor hops).
  function shadow(x, y, w, lift) {
    var f = Math.max(0.5, 1 - (lift || 0)), rx = w * 0.34 * f, ry = Math.max(3, w * 0.075) * f;
    g.save(); g.translate(x, y - ry * 0.15); g.scale(1, ry / rx);
    var gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, 'rgba(0,0,0,' + (0.42 * f) + ')'); gr.addColorStop(0.55, 'rgba(0,0,0,' + (0.26 * f) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
  }
  function drawDebug(R) {
    function poly(p, c, fill) { g.beginPath(); p.forEach(function (q, i) { i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } g.strokeStyle = c; g.lineWidth = 2; g.stroke(); }
    poly(R.walkable, 'rgba(0,255,0,0.9)', 'rgba(0,255,0,0.10)');
    (R.walkable_holes || []).forEach(function (h) { poly(h, 'rgba(255,60,60,0.95)', 'rgba(255,0,0,0.18)'); });
    mesh().nodes.forEach(function (n) { g.fillStyle = 'rgba(0,255,0,0.8)'; g.fillRect(n[0] - 2, n[1] - 2, 4, 4); });
    // foreground layers: tinted cut-out + baseline
    (R.layers || []).forEach(function (L, i) {
      var lc = layerCanvas[view.room + '/' + (L.id || i)]; if (!lc) return;
      g.save(); g.globalAlpha = 0.35; g.fillStyle = '#0ff'; g.fillRect(lc.x, lc.y, lc.w, lc.h); g.restore();
      drawLayer(view.room, L, i);
      g.strokeStyle = 'rgba(0,255,255,0.95)'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(lc.x, L.baseline_y); g.lineTo(lc.x + lc.w, L.baseline_y); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#0ff'; g.font = '12px monospace'; g.fillText((L.id || i) + ' y=' + L.baseline_y, lc.x + 2, L.baseline_y - 4);
    });
    if (player.path.length) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(player.x, player.y); player.path.forEach(function (q) { g.lineTo(q[0], q[1]); }); g.stroke(); }
    visibleTargets().forEach(function (t) {
      if (t.kind === 'hotspot') { poly(t.def.polygon, t.def.exit ? 'rgba(0,200,255,0.95)' : 'rgba(255,230,0,0.95)');
        g.fillStyle = '#ff0'; g.font = '12px monospace'; g.fillText(t.id, t.def.polygon[0][0] + 4, t.def.polygon[0][1] + 14); }
      else { var r = actorRect(t.def, t.def.at[0], t.def.at[1]); g.strokeStyle = 'magenta'; g.strokeRect(r.x, r.y, r.w, r.h); }
      if (t.def.walk_to) { g.fillStyle = 'red'; g.fillRect(t.def.walk_to[0] - 3, t.def.walk_to[1] - 3, 6, 6); }
    });
  }

  // ---------- boot ----------
  // Pointer events cover mouse, touch and pen (iOS 13+). Taps act on pointerup; no reliance on 'click' or hover.
  function onMove(ev) {
    if (ev.pointerType && ev.pointerType !== 'mouse') return;   // no hover on touch
    var p = toLogical(ev); mouse.x = p[0]; mouse.y = p[1];
    if (!game || !view.room) return;
    var t = hitTest(p[0], p[1]); hover = t ? { name: t.name } : null; canvas.style.cursor = t ? 'pointer' : 'crosshair'; renderSentence();
  }
  function onTap(ev, isTouch) {
    if (!game || !view.room) return;
    var p = toLogical(ev);
    if (isTouch && started && !speech && !inDialogue) {
      var t = hitTest(p[0], p[1]);
      if (t) { tapLabel = { name: t.name, x: p[0], y: p[1] - 18, until: performance.now() + 1400 }; hover = { name: t.name }; renderSentence(); hover = null; }
    }
    onCanvasClick(ev);
  }
  if (window.PointerEvent) {
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', function (ev) { if (ev.button > 0) return; ev.preventDefault(); onTap(ev, ev.pointerType !== 'mouse'); });
  } else {
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('touchend', function (ev) { ev.preventDefault(); var t = ev.changedTouches[0]; onTap({ clientX: t.clientX, clientY: t.clientY }, true); }, { passive: false });
    canvas.addEventListener('click', function (ev) { onTap(ev, false); });
  }
  canvas.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') { mouse.x = -1; hover = null; if (game) renderSentence(); } });
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  // iOS can suspend/interrupt audio at any time; re-resume on any later gesture (never blocks anything)
  document.addEventListener('pointerdown', function () { if (started) Audio.resume(); }, true);
  // tapping the speech caption also skips the line
  $('caption').addEventListener('click', function () { if (speech) endSpeech(); });
  $('btn-hints').onclick = function () { hintsUntil = performance.now() + 3000; };
  document.addEventListener('keydown', function (e) {
    if (e.key === '.' || e.key === 'Escape') { if (speech) endSpeech(); }
    if (e.key === 'd' || e.key === 'D') DEBUG = !DEBUG;
  });
  $('btn-music').onclick = function () { Audio.setMusic(!Audio.musicOn); renderHud(); };
  $('btn-voice').onclick = function () { Audio.setVoice(!Audio.voiceOn); renderHud(); };
  $('btn-restart').onclick = function () { location.reload(); };
  $('again-btn').onclick = function () { location.reload(); };
  layout();
  // If the game hasn't loaded after a while, show the "open in a real browser" help again.
  setTimeout(function () { if (!dbg.ready) $('boot-msg').style.display = ''; }, 8000);

  load().then(function () {
    state = Core.newState(game);
    view.room = state.room;
    player.x = player.tx = game.meta.player.at[0]; player.y = player.ty = game.meta.player.at[1];
    document.title = game.meta.title;
    $('title-name').textContent = game.meta.title; $('title-sub').textContent = game.meta.subtitle || '';
    renderHud();
    requestAnimationFrame(frame);
    dbg.ready = true;
    function start(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (started) return; started = true; $('title').style.display = 'none';
      if (FAST) { Audio.setVoice(false); }
      // Audio must be created/unlocked synchronously inside the tap on iOS, and must never block the game.
      try { Audio.init(); if (!(game.meta.intro || []).length) Audio.unlockVoice(); updateMusic(); } catch (e) { dbg.errors.push('audio: ' + e.message); }
      layout();
      push((game.meta.intro || []).map(function (l) { return { type: 'say', by: l.by || game.meta.player.character, text: l.say }; }));
    }
    var sb = $('start-btn'); sb.disabled = false; sb.textContent = '▶  Tap to start';
    sb.addEventListener('click', start);
    $('title').addEventListener('click', start);   // tapping anywhere on the title card works too
    $('boot-msg').style.display = 'none';
    dbg.start = start;
  }).catch(function (e) { dbg.errors.push('Load failed: ' + e.message); $('start-btn').textContent = 'Could not load'; $('boot-error').textContent = 'Failed to load game: ' + e.message; });
})();
