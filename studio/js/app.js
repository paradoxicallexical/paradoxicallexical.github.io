/* PNC Studio app: guided wizard + free-edit dashboard with a live solver safety net.
 * ONE source of truth: S.project = {design, game}. Every step renders straight from it, so an edit anywhere
 * (pitch, characters, rooms, puzzles, style) shows up everywhere else and in Play on the next render. */
(function () {
  'use strict';
  var JP = window.JSONPatch, V = window.PNCValidate, E = window.StudioEdits, CW = window.CoWriter, PATHS = window.PNCPaths;
  var SEED = window.STUDIO_SEED;
  var $ = function (id) { return document.getElementById(id); };
  var LS = { draft: 'pnc.studio.draft', pub: 'pnc.studio.published', hist: 'pnc.studio.history', versions: 'pnc.studio.versions', ui: 'pnc.studio.ui', play: 'pnc.studio.play' };
  var STEPS = [
    { id: 'pitch', title: 'Pitch' }, { id: 'style', title: 'Art style' }, { id: 'characters', title: 'Characters' },
    { id: 'plot', title: 'Plot & rooms' }, { id: 'puzzles', title: 'Puzzles' }, { id: 'playtest', title: 'Play' }];
  var S = window.STUDIO_STATE = { project: null, history: [], hi: -1, report: null, seq: 0, checking: true, published: null, publishedAt: null,
    ui: { step: 'pitch', mode: 'wizard', visited: {} }, sheet: null, chats: {}, cw: {}, storageWarn: false };

  // ------------------------------------------------------------------ utils
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function q(s) { return '\u201c' + s + '\u201d'; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  // Safari throws QuotaExceededError at ~5 MB. When that happens: drop old versions, then old undo history, then retry.
  function store(k, v) {
    if (lsSet(k, v)) return true;
    var vs = versions();
    while (vs.length) { vs.shift(); lsSet(LS.versions, JSON.stringify(vs)); if (lsSet(k, v)) { warnStorage(); return true; } }
    lsDel(LS.versions); lsSet(LS.hist, JSON.stringify({ h: S.history.slice(S.hi, S.hi + 1), hi: 0 }));
    if (lsSet(k, v)) { warnStorage(); return true; }
    lsDel(LS.hist); if (lsSet(k, v)) { warnStorage(); return true; }
    warnStorage(true); return false;
  }
  function warnStorage(full) {
    if (S.storageWarn === (full ? 'full' : 'pruned')) return; S.storageWarn = full ? 'full' : 'pruned';
    toast(full ? 'This phone\u2019s browser storage is full. Your work stays while this page is open; use \u2630 \u2192 Download project to keep a copy.' : 'Storage was nearly full, so the oldest saved versions were cleared to make room.', 6000);
  }
  function asset(p) { return PATHS.resolve(p, S.project); }
  function isSketchArt(p) { return PATHS.isSketch(p); }
  function styleImg(s) { return s.img; }
  var toastT;
  function toast(msg, ms) { var t = $('toast'); if (!t) return; t.onclick = function () { t.hidden = true; }; t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3200); }
  function puzzleIdx(id) { var p = S.project.game.puzzles; for (var i = 0; i < p.length; i++) if (p[i].id === id) return i; return -1; }
  function blockedStories() { var o = {}, d = S.project.design.puzzles || {}; Object.keys(d).forEach(function (k) { o[k] = d[k].blocked_story; }); return o; }
  function player() { return S.project.game.meta.player.character; }
  function roomOf(cid) { var g = S.project.game, out = null; Object.keys(g.rooms).forEach(function (rid) { (g.rooms[rid].actors || []).forEach(function (a) { if (a.character === cid && !out) out = rid; }); }); if (!out && cid === player()) out = g.meta.start_room; return out; }
  function endRoom() { var g = S.project.game, wf = g.win && g.win.if && g.win.if.flags ? Object.keys(g.win.if.flags)[0] : null, hit = null;
    if (!wf) return null; V.walkAll(g, function (r, ctx) { (r.do || []).forEach(function (e) { if (e.set && e.set[wf] && ctx.room && !hit) hit = ctx.room; }); }); return hit; }
  function art(p, cls, alt) { return '<span class="art ' + (cls || '') + (isSketchArt(p) ? ' sketch' : '') + '"><img src="' + esc(asset(p)) + '" alt="' + esc(alt || '') + '" loading="eager">' + (isSketchArt(p) ? '<i class="drafting">\u270e drafting</i>' : '') + '</span>'; }
  // ------------------------------------------------------------------ validator (Web Worker with main-thread fallback)
  var worker = null, wseq = 0, waiting = {};
  function makeWorker() {
    try {
      var w = new Worker('js/validator-worker.js?root=' + encodeURIComponent(PATHS.ROOT));
      w.onmessage = function (e) { var p = waiting[e.data.seq]; if (p) { delete waiting[e.data.seq]; p.res(e.data.report); } };
      w.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); worker = false; Object.keys(waiting).forEach(function (k) { var p = waiting[k]; delete waiting[k]; p.res(V.run(p.project, p.opts)); }); };
      return w;
    } catch (e) { return false; }
  }
  function runValidator(project, opts) {
    if (worker === null) worker = makeWorker();
    if (worker) return new Promise(function (res) {
      var id = ++wseq; waiting[id] = { res: res, project: project, opts: opts };
      worker.postMessage({ seq: id, project: project, opts: opts });
      setTimeout(function () { if (waiting[id]) { delete waiting[id]; res(V.run(project, opts)); } }, 10000);
    });
    return new Promise(function (res) { setTimeout(function () { res(V.run(project, opts)); }, 0); });
  }
  S.engine = function () { return worker ? 'web worker' : 'main thread'; };

  function validate(o) {
    o = o || {};
    var seq = ++S.seq, json = JSON.stringify(S.project);
    S.checking = true; renderPill();
    var prev = S.published ? JSON.parse(S.published).game : null;
    return runValidator(S.project, { label: o.label, blockedStory: blockedStories(), prevGame: prev }).then(function (rep) {
      if (seq !== S.seq) return rep;
      S.report = rep; S.checking = false;
      if (rep.ok) { S.published = json; S.publishedAt = Date.now(); store(LS.pub, json); S.keptDraft = false; }
      renderPill();
      if (S.ui.step === 'puzzles' && !S.sheet) renderView();
      if (S.sheet && S.sheet.type === 'puzzle') openPuzzle(S.sheet.id);
      if (S.ui.step === 'playtest') renderView();
      if (!rep.ok && o.interactive) showBreak(rep, o.label);
      return rep;
    });
  }

  // ------------------------------------------------------------------ history / commit
  function persist() {
    store(LS.draft, JSON.stringify(S.project));
    // keep undo history small enough for Safari's ~5 MB storage: newest entries up to ~1.2 MB
    var h = [], size = 0;
    for (var i = S.history.length - 1; i >= 0 && h.length < 40; i--) { size += S.history[i].json.length; if (size > 1200000 && h.length) break; h.unshift(S.history[i]); }
    var off = S.history.length - h.length;
    if (!lsSet(LS.hist, JSON.stringify({ h: h, hi: Math.max(0, S.hi - off) }))) lsSet(LS.hist, JSON.stringify({ h: S.history.slice(S.hi, S.hi + 1), hi: 0 }));
    lsSet(LS.ui, JSON.stringify(S.ui));
  }
  function commit(edit, opts) {
    opts = opts || {};
    if (!edit || !edit.patch || !edit.patch.length) return false;
    var next;
    try { next = edit.project || JP.apply(S.project, edit.patch); } catch (e) { toast('Couldn\u2019t apply that change: ' + e.message); return false; }
    var json = JSON.stringify(next), top = S.history[S.hi];
    if (opts.coalesce && top && top.key === opts.coalesce && S.hi === S.history.length - 1 && Date.now() - top.t < 5000) { top.json = json; top.t = Date.now(); }
    else {
      S.history = S.history.slice(0, S.hi + 1);
      S.history.push({ json: json, label: edit.label, t: Date.now(), key: opts.coalesce || null });
      if (S.history.length > 200) S.history.shift();
      S.hi = S.history.length - 1;
    }
    S.project = next; persist();
    if (opts.noRender) renderChrome(); else render();
    validate({ label: edit.label, interactive: opts.interactive !== false });
    return true;
  }
  function jump(i) {
    flushAll();
    if (i < 0 || i >= S.history.length) return;
    S.hi = i; S.project = JSON.parse(S.history[i].json); persist(); closeSheet(); render(); validate({});
  }
  function undo() { if (S.hi > 0) { var l = S.history[S.hi].label; jump(S.hi - 1); toast('Undid: ' + l); } }
  function redo() { if (S.hi < S.history.length - 1) { jump(S.hi + 1); toast('Redid: ' + S.history[S.hi].label); } }

  // generic field binding: data-ptr = JSON pointer into the project, data-rename = character id
  var timers = {};
  function flush(el) {
    var ptr = el.dataset.ptr; clearTimeout(timers[ptr]); delete timers[ptr];
    var v = el.value; if (el.dataset.num !== undefined) v = parseFloat(v);
    if (JP.get(S.project, ptr) === v) return;
    commit(E.set(S.project, ptr, v, el.dataset.label || 'Edit text'), { coalesce: ptr, noRender: true });
  }
  function flushAll() { document.querySelectorAll('[data-ptr]').forEach(function (el) { if (timers[el.dataset.ptr]) flush(el); }); }
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.ptr) { clearTimeout(timers[el.dataset.ptr]); timers[el.dataset.ptr] = setTimeout(function () { flush(el); }, 650); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.ptr) flush(el);
    else if (el.dataset && el.dataset.renameRoom) {
      var rid = el.dataset.renameRoom, oldR = S.project.game.rooms[rid].name, nvR = el.value.trim();
      if (!nvR) { el.value = oldR; return toast('A room needs a name.'); }
      if (nvR === oldR) return;
      var edR = E.renameRoom(S.project, rid, nvR);
      if (commit(edR)) toast('Renamed ' + oldR + ' \u2192 ' + nvR + ' everywhere (' + edR.mentions + ' mention' + (edR.mentions === 1 ? '' : 's') + ' in paths, lines and notes).', 4500);
    }
    else if (el.dataset && el.dataset.rename) {
      var id = el.dataset.rename, old = S.project.game.characters[id].name, nv = el.value.trim();
      if (nv === old) return;
      var ed = E.renameCharacter(S.project, id, nv);
      if (commit(ed)) toast(nv ? 'Renamed ' + old + ' \u2192 ' + nv + '. Updated ' + ed.mentions + ' mention' + (ed.mentions === 1 ? '' : 's') + ' in dialogue and notes. Internal IDs unchanged.' : 'A character needs a name.', 4500);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
    var inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  });

  // ------------------------------------------------------------------ chrome: pill, steps, footer
  function renderPill() {
    var p = $('pill'), t = $('pill-text'), r = S.report;
    p.className = 'pill ' + (S.checking ? 'checking' : r ? r.level : 'checking');
    if (S.checking) t.textContent = 'Checking\u2026';
    else if (r.level === 'ok') t.textContent = 'Game is winnable, no dead ends';
    else if (r.level === 'warn') t.textContent = 'Winnable \u00b7 chart out of date';
    else t.textContent = S.keptDraft ? 'Draft: game is broken' : 'Game is broken \u00b7 tap';
    p.dataset.level = S.checking ? 'checking' : r.level;
    $('btn-undo').disabled = S.hi <= 0; $('btn-redo').disabled = S.hi >= S.history.length - 1;
  }
  function renderChrome() {
    $('proj-title').textContent = S.project.game.meta.title;
    var nav = $('steps'), html = '';
    if (S.ui.mode === 'dashboard') html += '<button class="step' + (S.ui.step === 'home' ? ' on' : '') + '" data-go="home"><span class="n">\u2302</span>Overview</button>';
    STEPS.forEach(function (s, i) {
      html += '<button class="step' + (S.ui.step === s.id ? ' on' : '') + (S.ui.visited[s.id] ? ' done' : '') + '" data-go="' + s.id + '"><span class="n">' + (i + 1) + '</span>' + s.title + '</button>';
    });
    nav.innerHTML = html;
    var on = nav.querySelector('.step.on'); // keep the current tab visible on a narrow phone
    if (on) { var l = on.offsetLeft - nav.offsetLeft, r = l + on.offsetWidth; if (r > nav.scrollLeft + nav.clientWidth - 16 || l < nav.scrollLeft) nav.scrollLeft = Math.max(0, l - (nav.clientWidth - on.offsetWidth) / 2); }
    var f = $('wizard-nav'), idx = STEPS.map(function (s) { return s.id; }).indexOf(S.ui.step);
    if (S.ui.mode === 'wizard') {
      var back = idx > 0 ? '<button class="btn ghost" data-go="' + STEPS[idx - 1].id + '">\u2190 Back</button>' : '';
      var next = idx < STEPS.length - 1 ? '<button class="btn primary" id="btn-next" data-go="' + STEPS[idx + 1].id + '">Next: ' + STEPS[idx + 1].title + ' \u2192</button>'
        : '<button class="btn primary" id="btn-next" data-finish="1">Finish \u2192 open dashboard</button>';
      f.innerHTML = back + next;
    } else {
      f.innerHTML = '<button class="btn ghost" data-go="home">Overview</button><button class="btn primary" data-play="1">\u25b6 Play</button>';
    }
    renderPill();
  }
  function render() { renderChrome(); renderView(); }
  function go(step) {
    flushAll();
    if (S.ui.step && S.ui.step !== 'home') S.ui.visited[S.ui.step] = true;
    S.ui.step = step; persist(); closeSheet(); render(); window.scrollTo(0, 0);
    if (S.focus) { var fid = S.focus; S.focus = null; setTimeout(function () { var el = $(fid); if (el) { scrollToEl(el, false); el.classList.add('flash'); } }, 30); }
    if (!$('cowriter').hidden) renderCowriter();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go],[data-finish],[data-play]');
    if (!b) return;
    if (b.dataset.go) go(b.dataset.go);
    else if (b.dataset.finish) { S.ui.visited.playtest = true; S.ui.mode = 'dashboard'; go('home'); toast('Wizard done! Edit anything from the dashboard. The solver keeps checking every change.'); }
    else if (b.dataset.play) startPlaytest();
  });


  // ------------------------------------------------------------------ views
  var VIEWS = {};
  function renderView() {
    var v = $('view'), fn = VIEWS[S.ui.step] || VIEWS.pitch;
    try { v.innerHTML = fn(); if (fn.after) fn.after(); }
    catch (e) { v.innerHTML = '<div class="card breakbox"><b>This page hit a problem.</b><p>' + esc(e.message) + '</p><p>Your game is safe. Try another step, or \u21b6 Undo the last change.</p></div>'; if (window.console) console.error(e); }
  }
  var O = window.PNCOrganizer, NG = window.PNCNewGame;
  function sum() { return S.project.design.summary || {}; }
  function strongWords() { var s = sum(); return s.strong || (s.parsed && s.parsed.language && s.parsed.language.strong) || []; }
  function bl(t) { return sum().language === 'bleep' ? O.bleep(t) : t; }
  function cap1(x) { return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; }
  function styleOf() { var sel = S.project.design.style.selected; return SEED.styles.filter(function (s) { return s.id === sel; })[0] || SEED.styles[0]; }
  function goal() { var s = sum(); return s.goal || (s.parsed && s.parsed.goal) || ''; }
  function tone() { var s = sum(); return s.tone || (s.parsed && s.parsed.tone) || []; }
  function heading(n, title, lead) { return '<div class="sheet-head"><span class="no">No. ' + n + '</span><h1>' + title + '</h1>' + (lead ? '<p class="lead">' + lead + '</p>' : '') + '</div>'; }

  VIEWS.pitch = function () {
    var d = S.project.design, g = S.project.game, s = sum(), key = CW.hasKey(), pl = player(), end = endRoom();
    var h = heading(1, 'The Pitch', 'Write your idea however it comes out. Typos and tangents welcome. One tap turns it into a playable game.') +
      '<div class="card pitch paper"><label class="f" for="pitch-text">Your idea</label><textarea id="pitch-text" class="typed" data-ptr="/design/pitch" data-label="Edit the pitch">' + esc(d.pitch) + '</textarea>' +
      '<button class="btn primary big" id="organize" type="button">\u2726 Organize &amp; build my game</button>' +
      '<p class="hint">Builds the characters, rooms, puzzles and a playable game from your words. ' + (key ? 'Your co-writer then offers a fuller rewrite.' : 'Runs on this phone, no AI needed.') + ' Your current game is saved in Versions first.</p></div>' +
      '<div id="org-error" class="breakbox" role="alert" hidden></div>' +
      '<div class="samples"><span class="f">Or open a sample game</span><div class="row">' + PATHS.SAMPLES.map(function (x) {
        return '<button class="sample' + (g.meta.id === x.id ? ' on' : '') + '" type="button" data-sample="' + x.id + '"><img src="' + esc(PATHS.ROOT + x.cover) + '" alt=""><b>' + esc(x.title) + '</b><small>' + esc(x.blurb) + '</small></button>'; }).join('') + '</div></div>' +
      '<div id="summary">';
    if (s.source === 'local') h += '<div class="note banner" id="org-banner"><b>Quick organize (no AI).</b> Add an AI key in <a href="#" id="org-settings">settings</a> for a full rewrite.</div>';
    if (s.from !== undefined && s.from.trim() !== (d.pitch || '').trim()) h += '<div class="warnbox" id="org-stale">You\u2019ve changed your idea since the game was built. Tap <b>Organize &amp; build my game</b> to rebuild it.</div>';
    // title, story, facts: all read live from the game
    h += '<div class="card summary paper" id="org-summary"><label class="f" for="org-title">Title</label><input type="text" id="org-title" class="title-input" data-ptr="/game/meta/title" data-label="Change the title" value="' + esc(g.meta.title) + '">' +
      ((s.title_options || []).length ? '<div class="row chips">' + s.title_options.map(function (t) { return '<button class="chip' + (t === g.meta.title ? ' on' : '') + '" type="button" data-title-opt="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
      '<label class="f" for="org-logline">The story in one breath</label><textarea id="org-logline" data-ptr="/design/summary/logline" data-label="Edit the story">' + esc(bl(s.logline || '')) + '</textarea>' +
      '<div class="facts" id="org-facts">' +
        '<div class="fact"><b>Hero</b>' + esc(g.characters[pl] ? g.characters[pl].name : '') + ((d.characters[pl] || {}).look ? ' \u00b7 ' + esc((d.characters[pl].look || '').split(/[:,.]/)[0]) : '') + '</div>' +
        (goal() ? '<div class="fact"><b>Goal</b>' + esc(cap1(goal())) + '</div>' : '') +
        (tone().length ? '<div class="fact"><b>Tone</b>' + esc(tone().join(', ')) + '</div>' : '') +
        '<div class="fact"><b>Art style</b>' + esc(styleOf().name) + '</div>' +
        '<div class="fact"><b>Size</b>' + Object.keys(g.rooms).length + ' rooms \u00b7 ' + Object.keys(g.characters).length + ' characters \u00b7 ' + g.puzzles.length + ' puzzles</div></div></div>';
    // language
    var w = strongWords();
    if (w.length) h += '<div class="card warnbox" id="org-language"><h3>Language check</h3><p>' + w.map(function (x) { return q(esc(x)); }).join(', ') + (w.length > 1 ? ' are' : ' is') + ' stronger than \u201cmostly PG\u201d. Nothing has been removed. Your call:</p>' +
      '<div class="seg" role="group" aria-label="Strong language"><button type="button" class="btn sm' + (s.language !== 'bleep' ? ' primary' : '') + '" data-lang="keep" aria-pressed="' + (s.language !== 'bleep') + '">Keep it as written</button><button type="button" class="btn sm' + (s.language === 'bleep' ? ' primary' : '') + '" data-lang="bleep" aria-pressed="' + (s.language === 'bleep') + '">Bleep it (' + esc(O.bleep(w[0])) + ')</button></div>' +
      '<small class="mute">Applies to the whole game, including Play. Switch back any time.</small></div>';
    // cast, places, puzzles: live from the game
    h += '<div class="card paper" id="org-cast"><h3>Cast <a class="more" href="#" data-go="characters">Edit \u203a</a></h3><ul class="olist">' + Object.keys(g.characters).map(function (id) {
      var c = g.characters[id], m = d.characters[id] || {}, r = roomOf(id);
      return '<li data-cast="' + id + '">' + art(c.portrait, 'portrait sm', c.name) + '<div><b>' + esc(c.name) + '</b>' + (id === pl ? ' <span class="tag">HERO</span>' : '') + '<br><small>' + esc(bl(m.role || '')) + (r ? ' \u00b7 in ' + esc(g.rooms[r].name) : ' \u00b7 not placed yet') + '</small></div></li>'; }).join('') + '</ul></div>';
    h += '<div class="card paper" id="org-places"><h3>Places <a class="more" href="#" data-go="plot">Edit \u203a</a></h3><div class="places">' + Object.keys(g.rooms).map(function (rid) {
      var r = g.rooms[rid];
      return '<button type="button" class="place" data-go="plot" data-place="' + rid + '">' + art(r.background, 'thumb', r.name) + '<b>' + esc(r.name) + '</b>' + (rid === g.meta.start_room ? '<span class="tag">START</span>' : rid === end ? '<span class="tag">END</span>' : '') + '</button>'; }).join('') + '</div>';
    var open = s.open_places || ((s.parsed && s.parsed.open_places) || []).map(function (o) { return { said: String(o.said || o).replace(/[\u2026.!?,\s]+$/, ''), ideas: s.parsed.place_suggestions || [] }; });
    open.forEach(function (o) {
      var have = Object.keys(g.rooms).map(function (k) { return g.rooms[k].name.toLowerCase(); }).join('|');
      var ideas = (o.ideas || []).filter(function (x) { return have.indexOf(x.split(/[ (/]/)[0].toLowerCase()) < 0; });
      if (ideas.length) h += '<div class="open-slot">You left <b>' + q(esc(o.said)) + '</b> open. Ideas: ' + ideas.map(function (x) { var n = x.replace(/\s*\(.*\)/, '').split(' / ')[0].replace(/^The /, 'The '); return '<button class="chip add" type="button" data-add-place="' + esc(n) + '">\uff0b ' + esc(n) + '</button>'; }).join(' ') + '</div>';
    });
    h += '</div>';
    h += '<div class="card paper" id="org-puzzles"><h3>Puzzles <a class="more" href="#" data-go="puzzles">Edit \u203a</a></h3><ol class="pzl">' + g.puzzles.map(function (p) { return '<li>' + esc(bl(p.name)) + '</li>'; }).join('') + '</ol></div>';
    h += '<div class="card paper" id="org-intro"><h3>Opening lines</h3>' + (g.meta.intro || []).map(function (l, i) { var who = g.characters[l.by || pl]; return '<div class="line"><small>' + esc(who ? who.name : '') + '</small><textarea data-ptr="/game/meta/intro/' + i + '/say" data-label="Edit an opening line">' + esc(l.say) + '</textarea></div>'; }).join('') + '</div>';
    if (s.decisions && s.decisions.length) h += '<details class="card paper" id="org-decisions"><summary>How I read your notes (' + s.decisions.length + ')</summary>' +
      (s.parsed && s.parsed.corrections && s.parsed.corrections.length ? '<p class="mute">Typos I read through: ' + s.parsed.corrections.map(function (c) { return esc(q(c.from) + ' \u2192 ' + c.to); }).join(', ') + '</p>' : '') +
      '<table class="decisions">' + s.decisions.map(function (x) { return '<tr><td>' + esc(bl(x[0])) + '</td><td>' + esc(bl(x[1])) + '</td></tr>'; }).join('') + '</table></details>';
    h += '<button class="btn primary big play-cta" data-play="1" type="button">\u25b6 Play ' + esc(g.meta.title) + '</button>';
    return h + '</div>';
  };
  function hdrOffset() { var hd = document.querySelector('header'); var v = (hd ? hd.getBoundingClientRect().height : 0) + 10; document.documentElement.style.setProperty('--hdr', v + 'px'); return v; }
  function scrollToEl(el, smooth) { if (!el) return; var top = el.getBoundingClientRect().top + window.scrollY - hdrOffset(); window.scrollTo({ top: Math.max(0, top), behavior: smooth === false ? 'auto' : 'smooth' }); }
  function flash(root) {
    if (!root) return;
    root.querySelectorAll('.card,.note,.warnbox,.okbox').forEach(function (el, i) { el.classList.remove('flash'); void el.offsetWidth; el.style.animationDelay = (i * 0.07) + 's'; el.classList.add('flash'); });
  }
  function showOrgError(msg) {
    var e = $('org-error'); if (!e) return toast(msg);
    e.innerHTML = '<b>Couldn\u2019t build that.</b> ' + esc(msg) + ' Your text is still there.'; e.hidden = false; scrollToEl(e);
  }
  function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function saveVersion(name) {
    var vs = versions(); vs.push({ name: name, t: Date.now(), json: JSON.stringify(S.project), ok: !!(S.report && S.report.ok) });
    vs = vs.slice(-12); while (vs.length > 1 && JSON.stringify(vs).length > 1500000) vs.shift();
    store(LS.versions, JSON.stringify(vs));
  }
  // Replace the whole game (organize / sample). One undoable step; the old game is kept in Versions.
  function replaceProject(next, label) {
    if (JSON.stringify(S.project) === JSON.stringify(next)) { render(); return true; }
    saveVersion((S.project.game.meta.title || 'Game') + ' (before ' + label.toLowerCase() + ')');
    var report = V.run(next, {});
    if (!report || report.level === 'broken') { showOrgError('The new game didn\u2019t pass the safety check (' + (report ? report.explanation : 'checker error') + '). Nothing was changed.'); return false; }
    return commit({ label: label, patch: [{ op: 'replace', path: '', value: next }], project: next });
  }
  function loadSample(id) {
    var smp = PATHS.SAMPLES.filter(function (x) { return x.id === id; })[0] || PATHS.SAMPLES[0];
    var gp = fetch(PATHS.ROOT + smp.dir + 'game.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('Could not load ' + smp.title + ' (' + r.status + ')'); return r.json(); });
    var dp = smp.design ? fetch(PATHS.ROOT + smp.dir + smp.design, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('Could not load ' + smp.title + ' notes'); return r.json(); }) : Promise.resolve(JP.clone(SEED.design));
    return Promise.all([gp, dp]).then(function (a) {
      var design = a[1]; design.base = smp.dir; design.characters = design.characters || {}; design.rooms = design.rooms || {}; design.puzzles = design.puzzles || {};
      design.summary = design.summary || {}; if (!design.summary.source) design.summary.source = 'sample';
      return { version: 2, design: design, game: a[0] };
    });
  }
  function doOrganize() {
    flushAll();
    var text = $('pitch-text').value; $('org-error').hidden = true;
    var r;
    try { r = O.organize(text); } catch (e) { showOrgError(e.message || String(e)); return; }
    if (r.thin) { showOrgError('I couldn\u2019t find much to build with yet (no characters or places). Add who the hero is, where it happens and who they meet, then tap again.'); return; }
    var btn = $('organize'); btn.disabled = true; btn.textContent = 'Building your game\u2026';
    var smp = PATHS.SAMPLES.filter(function (x) { return x.design; })[0], prev = sum();
    // A pitch that matches a built-in sample opens the finished sample (real art, polished puzzles).
    var sampleP = smp && norm(text) && S.sampleText && S.sampleText[smp.id] === norm(text) ? loadSample(smp.id) : null;
    Promise.resolve(sampleP).then(function (sp) {
      var next;
      r.from = text; r.language = prev.language || 'keep';
      if (sp) { next = sp; next.design.pitch = text; next.design.summary.decisions = r.decisions; next.design.summary.parsed = r.parsed; next.design.summary.from = text; next.design.summary.source = 'local'; next.design.summary.language = r.language; }
      else {
        next = NG.build(r, { baseGame: S.project.game, pitch: text });
        next.design.summary.logline = r.logline; next.design.summary.source = 'local';
        next.design.summary.goal = r.parsed.goal; next.design.summary.tone = r.parsed.tone; next.design.summary.strong = r.parsed.language.strong;
        var st = SEED.styles.filter(function (x) { return x.id === next.design.style.selected; })[0];
        if (st) next = JP.apply(next, E.selectStyle(next, st).patch);
      }
      if (r.language === 'bleep') swapWords(next, (next.design.summary.strong || r.parsed.language.strong || []), true);
      if (replaceProject(next, 'Build the game from my pitch')) {
        var g = S.project.game;
        toast('Built from your idea: ' + Object.keys(g.rooms).length + ' rooms, ' + Object.keys(g.characters).length + ' characters, ' + g.puzzles.length + ' puzzles. Every step now shows it.', 5000);
        setTimeout(function () { scrollToEl($('summary')); flash($('summary')); }, 60);
        if (CW.hasKey()) { openCowriter(); cwSend(CW.STEPS.pitch.organize, true); }
      }
    }).catch(function (e) { showOrgError(e.message || String(e)); if (window.console) console.error(e); })
      .then(function () { var b = $('organize'); if (b) { b.disabled = false; b.innerHTML = '\u2726 Organize &amp; build my game'; } });
  }
  function swapWords(project, words, toBleep) {
    function fix(v) { words.forEach(function (w) { var a = toBleep ? w : O.bleep(w), b = toBleep ? O.bleep(w) : w; v = v.split(a).join(b); v = v.split(cap1(a)).join(cap1(b)); }); return v; }
    function walk(o) { Object.keys(o).forEach(function (k) { if (typeof o[k] === 'string') o[k] = fix(o[k]); else if (o[k] && typeof o[k] === 'object') walk(o[k]); }); }
    walk(project.game); walk(project.design.characters || {}); walk(project.design.beats || []);
  }
  function openSample(id) {
    flushAll();
    loadSample(id).then(function (next) {
      if (replaceProject(next, 'Open the sample ' + q(next.game.meta.title))) { toast('Opened ' + next.game.meta.title + '. Every step now shows it.'); window.scrollTo(0, 0); }
    }).catch(function (e) { showOrgError(e.message); });
  }
  function addPlace(name) {
    var g = S.project.game, from = Object.keys(g.rooms).filter(function (k) { return k !== endRoom(); }).pop() || g.meta.start_room;
    var ed = E.addRoom(S.project, name, from, PATHS.libRoom(name));
    if (commit(ed)) toast('Added the room ' + q(name) + ', reachable from ' + g.rooms[from].name + '. It\u2019s in Plot & rooms and in Play.', 4500);
  }
  VIEWS.pitch.after = function () {
    $('organize').onclick = doOrganize;
    if ($('org-settings')) $('org-settings').onclick = function (e) { e.preventDefault(); openMenu(); setTimeout(function () { scrollToEl($('ai-settings')); }, 50); };
    document.querySelectorAll('[data-sample]').forEach(function (b) { b.onclick = function () { openSample(b.dataset.sample); }; });
    document.querySelectorAll('[data-add-place]').forEach(function (b) { b.onclick = function () { addPlace(b.dataset.addPlace); }; });
    document.querySelectorAll('[data-title-opt]').forEach(function (b) { b.onclick = function () { commit(E.set(S.project, '/game/meta/title', b.dataset.titleOpt, 'Pick the title ' + q(b.dataset.titleOpt))); }; });
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.onclick = function () {
        var want = b.dataset.lang; if ((sum().language || 'keep') === want) return;
        var next = JP.clone(S.project); next.design.summary.language = want; swapWords(next, strongWords(), want === 'bleep');
        commit({ label: want === 'bleep' ? 'Bleep the strong language' : 'Keep the strong language', patch: JP.diff(S.project, next), project: next });
        toast(want === 'bleep' ? 'Bleeped everywhere, including Play: ' + O.bleep(strongWords()[0]) : 'Kept as written: ' + q(strongWords()[0]));
      };
    });
    document.querySelectorAll('[data-cast]').forEach(function (li) { li.onclick = function () { S.focus = 'char-' + li.dataset.cast; go('characters'); }; });
    document.querySelectorAll('[data-place]').forEach(function (b) { b.addEventListener('click', function () { S.focus = 'room-' + b.dataset.place; }, true); });
  };
  VIEWS.style = function () {
    var sel = S.project.design.style.selected, st = SEED.styles.filter(function (s) { return s.id === sel; })[0] || SEED.styles[0];
    var h = heading(2, 'Art style', 'One scene, six looks. Pick one and it becomes the locked style guide for every background, character and item.') + '<div class="styles">';
    SEED.styles.forEach(function (s) {
      h += '<button class="style' + (s.id === sel ? ' on' : '') + '" data-style="' + s.id + '" type="button"><span class="tick">✓ Selected</span><img src="' + esc(styleImg(s)) + '" alt="' + esc(s.name) + ' sample"><div class="meta"><b>' + esc(s.name) + '</b><small>' + esc(s.era) + '</small><small>' + esc(s.blurb) + '</small></div></button>';
    });
    h += '</div><div class="card guide" style="margin-top:14px"><h2>' + esc(st.name) + ' <span class="lock">🔒 Locked style guide</span></h2>' +
      '<dl><dt>Look</dt><dd>' + esc(st.guide.look) + '</dd><dt>Palette</dt><dd>' + esc(st.guide.palette) + '</dd><dt>Characters</dt><dd>' + esc(st.guide.characters) + '</dd><dt>Avoid</dt><dd>' + esc(st.guide.avoid) + '</dd></dl>' +
      '<label class="f">Your extra notes for the artist</label><textarea data-ptr="/design/style/notes" data-label="Edit style notes" placeholder="e.g. a bit spookier, more neon in the diner">' + esc(S.project.design.style.notes || '') + '</textarea>' +
      '<label class="f">Exact text every image prompt starts with</label><textarea data-ptr="/game/style_guide/prompt" data-label="Edit the style guide">' + esc((S.project.game.style_guide || {}).prompt || '') + '</textarea>';
    var painted = S.project.game.meta.id === 'quokka-walkabout' ? 'sierra_pixel' : S.project.game.meta.id === 'pickle-heist' ? 'lucasarts' : null;
    if (painted && sel !== painted) h += '<div class="note">This game\u2019s current art was painted in <b>' + esc((SEED.styles.filter(function (x) { return x.id === painted; })[0] || {}).name) + '</b>. Switching to <b>' + esc(st.name) + '</b> repaints every background and character once the image service is connected. Your story, characters and puzzles stay exactly as they are.</div>';
    else if (!painted) h += '<div class="note">Rooms and characters that matched the art library already have finished art; the rest are pencil sketches until the image service paints them in <b>' + esc(st.name) + '</b>.</div>';
    return h + '</div>';
  };
  VIEWS.style.after = function () {
    document.querySelectorAll('[data-style]').forEach(function (b) {
      b.onclick = function () { var s = SEED.styles.filter(function (x) { return x.id === b.dataset.style; })[0]; if (s.id !== S.project.design.style.selected) commit(E.selectStyle(S.project, s)); };
    });
  };


  VIEWS.characters = function () {
    var g = S.project.game, d = S.project.design.characters, pl = player();
    var roomOpts = function (sel) { return '<option value="">Not placed yet</option>' + Object.keys(g.rooms).map(function (rid) { return '<option value="' + rid + '"' + (rid === sel ? ' selected' : '') + '>' + esc(g.rooms[rid].name) + '</option>'; }).join(''); };
    var h = heading(3, 'Characters', 'Rename anyone and every line, story beat and puzzle that mentions them follows. Moves and new faces show up in Plot & rooms and in Play straight away.') + '<div class="chars">';
    Object.keys(g.characters).forEach(function (id) {
      var c = g.characters[id], m = d[id] || {}, lines = E.linesFor(S.project, id), v = c.voice || {}, rm = roomOf(id);
      h += '<div class="card char paper" id="char-' + id + '" data-char="' + id + '"><div class="head">' + art(c.portrait, 'portrait', c.name) +
        '<div class="nm"><label class="f">Name' + (id === pl ? ' <span class="tag">HERO</span>' : '') + '</label><input type="text" data-rename="' + id + '" value="' + esc(c.name) + '" aria-label="Name of ' + esc(c.name) + '">' +
        (id === pl ? '<small class="mute">Starts in ' + esc(g.rooms[g.meta.start_room].name) + '</small>' : '<label class="f">Appears in</label><select data-move="' + id + '" aria-label="Where ' + esc(c.name) + ' appears">' + roomOpts(rm) + '</select>') + '</div></div>' +
        (isSketchArt(c.sprite) ? '<p class="mute sketch-note">\u270e Still a pencil sketch. It gets painted in the chosen art style once the image service is connected.</p>' : '') +
        '<label class="f">Role</label><input type="text" data-ptr="/design/characters/' + id + '/role" data-label="Edit ' + esc(c.name) + '\u2019s role" value="' + esc(bl(m.role || '')) + '">' +
        '<label class="f">Personality</label><input type="text" data-ptr="/design/characters/' + id + '/personality" data-label="Edit ' + esc(c.name) + '\u2019s personality" value="' + esc(m.personality || '') + '">' +
        '<label class="f">Look</label><textarea data-ptr="/design/characters/' + id + '/look" data-label="Edit ' + esc(c.name) + '\u2019s look">' + esc(m.look || '') + '</textarea>' +
        '<label class="f">Voice</label><textarea data-ptr="/game/characters/' + id + '/voice/notes" data-label="Edit ' + esc(c.name) + '\u2019s voice">' + esc(v.notes || '') + '</textarea>' +
        '<div class="row"><small>Pitch</small><input type="range" min="0.1" max="2" step="0.1" data-num data-ptr="/game/characters/' + id + '/voice/pitch" data-label="Change ' + esc(c.name) + '\u2019s voice pitch" value="' + (v.pitch || 1) + '" style="flex:1"><button class="btn sm" data-voice="' + id + '" type="button">Hear it</button></div>' +
        '<details><summary>' + lines.length + ' lines of dialogue</summary>' + lines.map(function (l) { return '<div class="line"><small>' + esc(l.ctx) + '</small><textarea data-ptr="' + esc(l.ptr) + '" data-label="Edit a line for ' + esc(c.name) + '">' + esc(l.text) + '</textarea></div>'; }).join('') + '</details>' +
        (id === pl ? '' : '<div class="row end"><button class="btn sm danger" data-remove-char="' + id + '" type="button">Remove ' + esc(c.name) + '</button></div>') + '</div>';
    });
    h += '</div><div class="card add paper" id="add-char"><h3>Add a character</h3><div class="row"><input type="text" id="new-char-name" placeholder="Name, e.g. Kev the Kangaroo" style="flex:2"><select id="new-char-room" style="flex:1">' + roomOpts(g.meta.start_room) + '</select><button class="btn primary" id="new-char-add" type="button">\uff0b Add</button></div><small class="mute">New characters start as a pencil sketch and say a hello line you can rewrite.</small></div>';
    return h;
  };
  VIEWS.characters.after = function () {
    document.querySelectorAll('[data-voice]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.voice, c = S.project.game.characters[id], l = E.linesFor(S.project, id)[0];
        if (!window.speechSynthesis) return toast('This browser has no built-in voices.');
        var u = new SpeechSynthesisUtterance(l ? l.text : 'Hi, I\u2019m ' + c.name); u.pitch = (c.voice || {}).pitch || 1; u.rate = (c.voice || {}).rate || 1;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      };
    });
    document.querySelectorAll('[data-move]').forEach(function (s) { s.onchange = function () { commit(E.moveCharacter(S.project, s.dataset.move, s.value)); }; });
    document.querySelectorAll('[data-remove-char]').forEach(function (b) {
      b.onclick = function () { var id = b.dataset.removeChar, n = S.project.game.characters[id].name; if (commit(E.removeCharacter(S.project, id))) toast('Removed ' + n + ' from every room and scene. \u21b6 Undo brings them back.', 4500); };
    });
    $('new-char-add').onclick = function () {
      var n = $('new-char-name').value.trim(); if (!n) { $('new-char-name').focus(); return toast('Type a name first.'); }
      var room = $('new-char-room').value, ed = E.addCharacter(S.project, n, room, PATHS.libCharacter(n.split(/\s+/).pop()) || PATHS.libCharacter(n.split(/\s+/)[0]));
      if (commit(ed)) { toast('Added ' + n + (room ? ' to ' + S.project.game.rooms[room].name : '') + '. They\u2019re on the Pitch page, in Plot & rooms and in Play.', 4500); setTimeout(function () { var el = $('char-' + ed.id); scrollToEl(el); if (el) el.classList.add('flash'); }, 60); }
    };
  };

  VIEWS.plot = function () {
    var d = S.project.design, g = S.project.game, end = endRoom();
    var h = heading(4, 'Plot &amp; rooms', 'The story beats guide the writing. Rooms are the real places in the game: rename, add or remove them and every step and Play follow.') + '<h2 class="sec">Story beats</h2><div class="timeline">';
    d.beats.forEach(function (b, i) {
      h += '<div class="card beat paper" data-n="' + (i + 1) + '"><input type="text" data-ptr="/design/beats/' + i + '/title" data-label="Rename a story beat" value="' + esc(b.title) + '" aria-label="Beat title">' +
        '<textarea data-ptr="/design/beats/' + i + '/text" data-label="Edit a story beat">' + esc(bl(b.text)) + '</textarea>' +
        '<div class="row"><button class="btn sm" data-beat="up" data-i="' + i + '" ' + (i === 0 ? 'disabled' : '') + ' aria-label="Move up">\u2191</button><button class="btn sm" data-beat="down" data-i="' + i + '" ' + (i === d.beats.length - 1 ? 'disabled' : '') + ' aria-label="Move down">\u2193</button>' +
        '<button class="btn sm" data-beat="add" data-i="' + i + '">\uff0b Beat after</button><button class="btn sm danger" data-beat="del" data-i="' + i + '" aria-label="Delete beat">\u2715</button></div></div>';
    });
    h += '</div><h2 class="sec">Rooms</h2>';
    Object.keys(g.rooms).forEach(function (rid) {
      var r = g.rooms[rid], who = (r.actors || []).map(function (a) { return a.character; }).filter(function (x, i, a) { return g.characters[x] && a.indexOf(x) === i; });
      if (rid === g.meta.start_room && who.indexOf(player()) < 0) who.unshift(player());
      var exits = (r.hotspots || []).filter(function (x) { return x.exit && g.rooms[x.exit.to]; });
      h += '<div class="card room paper" id="room-' + rid + '">' + art(r.background, 'bg', r.name) +
        '<div><label class="f">Room name' + (rid === g.meta.start_room ? ' <span class="tag">START</span>' : rid === end ? ' <span class="tag">END</span>' : '') + '</label><input type="text" data-rename-room="' + rid + '" value="' + esc(r.name) + '" aria-label="Room name">' +
        '<label class="f">What\u2019s here</label><textarea data-ptr="/design/rooms/' + rid + '" data-label="Edit a room description">' + esc((d.rooms || {})[rid] || '') + '</textarea>' +
        '<div class="who"><small class="f">Who\u2019s here</small> ' + (who.length ? who.map(function (cid) { return '<button class="chip person" type="button" data-goto-char="' + cid + '">' + esc(g.characters[cid].name) + '</button>'; }).join('') : '<span class="mute">Nobody yet</span>') + '</div>' +
        '<div class="who"><small class="f">Leads to</small> ' + (exits.length ? exits.map(function (x) { return '<span class="chip">' + esc(g.rooms[x.exit.to].name) + (x.exit.if ? ' \ud83d\udd12' : '') + '</span>'; }).join('') : '<span class="mute">Nowhere</span>') + '</div>' +
        (isSketchArt(r.background) ? '<p class="mute sketch-note">\u270e Background is still a pencil sketch until the image service paints it.</p>' : '') +
        (rid === g.meta.start_room ? '' : '<div class="row end"><button class="btn sm danger" type="button" data-remove-room="' + rid + '">Remove room</button></div>') + '</div></div>';
    });
    h += '<div class="card add paper" id="add-room"><h3>Add a room</h3><div class="row"><input type="text" id="new-room-name" placeholder="Name, e.g. The Pinnacles" style="flex:2"><select id="new-room-from" style="flex:1" aria-label="Connected to">' + Object.keys(g.rooms).map(function (rid) { return '<option value="' + rid + '">from ' + esc(g.rooms[rid].name) + '</option>'; }).join('') + '</select><button class="btn primary" id="new-room-add" type="button">\uff0b Add</button></div><small class="mute">A path is drawn both ways, so players can visit it in Play straight away.</small></div>';
    h += '<div class="card paper"><h3>Ending</h3><label class="f">Ending title</label><input type="text" data-ptr="/game/win/title" data-label="Edit the ending title" value="' + esc(g.win.title || '') + '"><label class="f">Ending text</label><textarea data-ptr="/game/win/text" data-label="Edit the ending">' + esc(g.win.text || '') + '</textarea></div>';
    return h;
  };
  VIEWS.plot.after = function () {
    document.querySelectorAll('[data-beat]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.i, a = b.dataset.beat;
        if (a === 'up') commit(E.moveBeat(S.project, i, -1)); else if (a === 'down') commit(E.moveBeat(S.project, i, 1));
        else if (a === 'add') commit(E.addBeat(S.project, i)); else if (a === 'del') commit(E.removeBeat(S.project, i));
      };
    });
    document.querySelectorAll('[data-goto-char]').forEach(function (b) { b.onclick = function () { S.focus = 'char-' + b.dataset.gotoChar; go('characters'); }; });
    document.querySelectorAll('[data-remove-room]').forEach(function (b) {
      b.onclick = function () { var rid = b.dataset.removeRoom, n = S.project.game.rooms[rid].name; if (commit(E.removeRoom(S.project, rid))) toast('Removed ' + n + ' and every path into it. \u21b6 Undo brings it back.', 4500); };
    });
    $('new-room-add').onclick = function () {
      var n = $('new-room-name').value.trim(); if (!n) { $('new-room-name').focus(); return toast('Type a room name first.'); }
      var from = $('new-room-from').value, ed = E.addRoom(S.project, n, from, PATHS.libRoom(n));
      if (commit(ed)) { toast('Added ' + n + ', with a path from ' + S.project.game.rooms[from].name + '. It\u2019s on the Pitch page and in Play.', 4500); setTimeout(function () { var el = $('room-' + ed.id); scrollToEl(el); if (el) el.classList.add('flash'); }, 60); }
    };
  };
  // ---- puzzle dependency chart (layered DAG, top to bottom)
  function chartSVG() {
    var pz = S.project.game.puzzles, byId = {}, depth = {}, st = (S.report && S.report.puzzle_status) || {};
    pz.forEach(function (p) { byId[p.id] = p; });
    function dep(id, seen) { if (depth[id] !== undefined) return depth[id]; if (seen[id]) return 0; seen[id] = 1; var d = 0; (byId[id].requires || []).forEach(function (r) { if (byId[r]) d = Math.max(d, dep(r, seen) + 1); }); return (depth[id] = d); }
    pz.forEach(function (p) { dep(p.id, {}); });
    var layers = []; pz.forEach(function (p) { (layers[depth[p.id]] = layers[depth[p.id]] || []).push(p.id); });
    layers = layers.filter(Boolean);
    var avail = Math.max(320, Math.min(1000, (document.querySelector('main') || document.body).clientWidth - 40));
    var maxN = Math.max.apply(null, layers.map(function (l) { return l.length; }));
    var gap = 8, nodeW = Math.min(210, Math.floor((avail - gap * (maxN + 1)) / maxN)), nodeH = 70, vgap = 40;
    var maxC = Math.max(8, Math.floor((nodeW - 30) / 6.6)), wrapped = {};
    pz.forEach(function (p) {
      var words = String(p.name).split(/\s+/), lines = [''], k;
      words.forEach(function (w) { k = lines.length - 1; if ((lines[k] + ' ' + w).trim().length > maxC && lines[k]) lines.push(w); else lines[k] = (lines[k] + ' ' + w).trim(); });
      if (lines.length > 4) { lines = lines.slice(0, 4); lines[3] = lines[3].slice(0, maxC - 1) + '\u2026'; }
      wrapped[p.id] = lines;
    });
    nodeH = 26 + Math.max.apply(null, pz.map(function (p) { return wrapped[p.id].length; }).concat([2])) * 16;
    var W = Math.max(avail, maxN * (nodeW + gap) + gap), pos = {};
    layers.forEach(function (l, li) {
      if (li > 0) l.sort(function (a, b) { var ax = avg(byId[a].requires), bx = avg(byId[b].requires); return ax - bx; });
      var tot = l.length * nodeW + (l.length - 1) * gap, x0 = (W - tot) / 2;
      l.forEach(function (id, i) { pos[id] = { x: x0 + i * (nodeW + gap), y: 10 + li * (nodeH + vgap) }; });
    });
    function avg(req) { var xs = (req || []).filter(function (r) { return pos[r]; }).map(function (r) { return pos[r].x; }); return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0; }
    var H = 20 + layers.length * (nodeH + vgap) - vgap;
    var winFlag = S.project.game.win && S.project.game.win.if && S.project.game.win.if.flags ? Object.keys(S.project.game.win.if.flags)[0] : null;
    var s = '<svg class="chart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Puzzle dependency chart"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#5b6f8f"/></marker></defs>';
    pz.forEach(function (p) {
      (p.requires || []).forEach(function (r) {
        if (!pos[r] || !pos[p.id]) return;
        var a = pos[r], b = pos[p.id], x1 = a.x + nodeW / 2, y1 = a.y + nodeH, x2 = b.x + nodeW / 2, y2 = b.y - 3, my = (y1 + y2) / 2;
        s += '<path class="edge' + (st[p.id] === 'blocked' && st[r] === 'blocked' ? ' blocked' : '') + '" marker-end="url(#ah)" d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + y2 + '"/>';
      });
    });
    pz.forEach(function (p) {
      var o = pos[p.id], blocked = st[p.id] === 'blocked', goal = winFlag && V.puzzleFlag(p) === winFlag, lines = wrapped[p.id];
      s += '<g class="node' + (blocked ? ' blocked' : '') + (goal ? ' goal' : '') + '" data-puzzle="' + esc(p.id) + '" tabindex="0" role="button" aria-label="' + esc(p.name) + '"><rect x="' + o.x + '" y="' + o.y + '" width="' + nodeW + '" height="' + nodeH + '" rx="14"/>' +
        '<text class="st" x="' + (o.x + nodeW - 20) + '" y="' + (o.y + 19) + '">' + (S.checking && !S.report ? '' : blocked ? '\u2715' : goal ? '\u2605' : '\u2713') + '</text>';
      var ty = o.y + nodeH / 2 - (lines.length - 1) * 8 + 5;
      lines.forEach(function (ln, i) { s += '<text x="' + (o.x + 10) + '" y="' + (ty + i * 16) + '">' + esc(ln) + '</text>'; });
      s += '</g>';
    });
    return s + '</svg>';
  }
  VIEWS.puzzles = function () {
    var g = S.project.game;
    var h = heading(5, 'Puzzles', 'Each card is a puzzle; arrows show what has to happen first. Tap one to edit it. Every change is re-checked by the solver.') +
      '<div class="chart-wrap blueprint" id="chart">' + chartSVG() + '</div><div class="legend"><span><i></i>Solvable</span><span><i class="b"></i>Blocked</span><span><i class="g"></i>Ending</span><span>' + g.puzzles.length + ' puzzles</span></div>' +
      '<h2 class="sec">Items</h2><p class="lead">Rename freely. Removing an item also removes everything that gives or uses it, and the solver tells you what that breaks.</p><div class="items">';
    Object.keys(g.items).forEach(function (id) {
      var it = g.items[id];
      h += '<div class="item"><span class="ic">' + (it.image ? '<img src="' + esc(asset(it.image)) + '" alt="" style="width:30px">' : esc(it.icon || '?')) + '</span><input type="text" data-ptr="/game/items/' + id + '/name" data-label="Rename the ' + esc(it.name) + '" value="' + esc(it.name) + '" aria-label="Item name"><button class="btn sm danger" data-remove-item="' + id + '">Remove</button></div>';
    });
    return h + '</div>';
  };
  VIEWS.puzzles.after = function () {
    document.querySelectorAll('[data-puzzle]').forEach(function (n) { n.addEventListener('click', function () { openPuzzle(n.dataset.puzzle); }); });
    document.querySelectorAll('[data-remove-item]').forEach(function (b) { b.onclick = function () { commit(E.removeItem(S.project, b.dataset.removeItem)); }; });
  };
  function openPuzzle(id) {
    var g = S.project.game, i = puzzleIdx(id); if (i < 0) return closeSheet();
    var p = g.puzzles[i], dz = (S.project.design.puzzles || {})[id] || {}, st = S.report && S.report.puzzle_status ? S.report.puzzle_status[id] : null;
    var trig = V.triggers(g, p), dependents = g.puzzles.filter(function (x) { return (x.requires || []).indexOf(id) >= 0; });
    var h = '<button class="x" data-close aria-label="Close">✕</button><h2>' + esc(p.name) + '</h2>' +
      (st === 'blocked' ? '<div class="breakbox">\u26d4 This puzzle can\u2019t be solved right now. ' + esc(S.report.explanation) + '</div>' : st === 'ok' ? '<div class="okbox">\u2713 Players can solve this.</div>' : '') +
      '<label class="f">Puzzle name</label><input type="text" data-ptr="/game/puzzles/' + i + '/name" data-label="Rename a puzzle" value="' + esc(p.name) + '">' +
      '<label class="f">What happens</label><textarea data-ptr="/design/puzzles/' + id + '/description" data-label="Edit a puzzle description">' + esc(dz.description || '') + '</textarea>' +
      '<label class="f">How the player does it</label>';
    if (!trig.length) h += '<div class="trig mute">Nothing in the game triggers this puzzle right now.</div>';
    trig.forEach(function (t) {
      var needs = V.condNeeds(t.cond), after = needs.flags.map(function (f) { var fp = g.puzzles.filter(function (x) { return V.puzzleFlag(x) === f; })[0]; return fp ? fp.name : null; }).filter(Boolean);
      h += '<div class="trig"><b>' + esc(t.text) + '</b>';
      if (t.ctx.verb === 'use_item') {
        h += '<label class="f">Item it needs</label><select data-trigger="' + esc(t.ptr) + '" data-pid="' + esc(id) + '">' + Object.keys(g.items).map(function (k) { return '<option value="' + k + '"' + (k === t.ctx.item ? ' selected' : '') + '>' + esc(g.items[k].icon || '') + ' ' + esc(g.items[k].name) + '</option>'; }).join('') + '</select>';
      }
      if (after.length) h += '<div class="mute" style="font-size:14px;margin-top:4px">Only works after: ' + after.map(esc).join(', ') + '</div>';
      if (t.gives.length) h += '<div style="margin-top:6px">' + t.gives.map(function (x) { return '<span class="chip">Gives ' + esc(g.items[x] ? g.items[x].name : x) + '</span>'; }).join('') + '</div>';
      h += '</div>';
    });
    h += '<label class="f">Needs first (puzzle chart)</label><div class="checks">' + g.puzzles.filter(function (x) { return x.id !== id; }).map(function (x) {
      return '<label><input type="checkbox" data-req="' + esc(x.id) + '"' + ((p.requires || []).indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc(x.name) + '</label>'; }).join('') + '</div>' +
      '<label class="f">Unlocks</label><div>' + (dependents.length ? dependents.map(function (x) { return '<span class="chip">\u2192 ' + esc(x.name) + '</span>'; }).join('') : '<span class="mute">Nothing; ' + (V.puzzleFlag(p) && g.win.if && g.win.if.flags && g.win.if.flags[V.puzzleFlag(p)] ? 'this is the ending.' : 'it\u2019s a final step.') + '</span>') + '</div>' +
      '<label class="f">If this puzzle breaks\u2026</label><input type="text" data-ptr="/design/puzzles/' + id + '/blocked_story" data-label="Edit what happens if a puzzle breaks" value="' + esc(dz.blocked_story || '') + '" placeholder="e.g. Gus never leaves the basement door">';
    openSheet({ type: 'puzzle', id: id }, h);
    document.querySelectorAll('[data-trigger]').forEach(function (sel) { sel.onchange = function () { commit(E.setTriggerItem(S.project, sel.dataset.pid, sel.dataset.trigger.replace(/^\/game/, ''), sel.value)); }; });
    document.querySelectorAll('[data-req]').forEach(function (cb) {
      cb.onchange = function () { var req = Array.prototype.slice.call(document.querySelectorAll('[data-req]:checked')).map(function (x) { return x.dataset.req; }); commit(E.setRequires(S.project, id, req)); };
    });
  }


  VIEWS.playtest = function () {
    var r = S.report, broken = r && !r.ok, pub = S.published ? JSON.parse(S.published) : null, g = pub ? pub.game : S.project.game;
    var start = g.rooms[g.meta.start_room] || {};
    var h = heading(6, 'Play', 'Plays your latest version full screen in the real game engine. Tap \u201c\u2715 Studio\u201d in the corner to come back here.') + '<div class="card play-hero paper">';
    h += '<div class="screen">' + art(start.background, 'bg', start.name) + '<div class="screen-title"><b>' + esc(g.meta.title) + '</b><small>' + esc(g.meta.subtitle || '') + '</small></div></div>';
    h += broken ? '<div class="breakbox"><b>Your current draft is broken</b>, so you\u2019ll play the <b>last version that worked</b>. ' + esc(r.explanation) + '</div>'
      : r ? '<div class="okbox">\u2713 ' + esc(r.headline) + '. ' + esc(r.explanation) + '</div>' : '';
    h += '<button class="btn primary big" data-play="1" id="btn-play" ' + (pub ? '' : 'disabled') + '>\u25b6 Play ' + esc(g.meta.title) + '</button>' +
      '<p class="hint">Opens in this tab, no pop-ups. Sound starts on your first tap.</p></div><div class="card paper"><h3>What you changed</h3>';
    var changes = S.history.slice(1, S.hi + 1).map(function (x) { return x.label; });
    h += changes.length ? '<ul class="steps-list">' + changes.slice(-12).reverse().map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '<p class="mute">No changes yet. Edit anything and play it here.</p>';
    return h + '</div>';
  };

  VIEWS.home = function () {
    var g = S.project.game, d = S.project.design, st = styleOf();
    var blocked = S.report && S.report.puzzle_status ? Object.keys(S.report.puzzle_status).filter(function (k) { return S.report.puzzle_status[k] === 'blocked'; }).length : 0;
    function card(step, title, body) { return '<button class="dcard paper" data-go="' + step + '"><h3>' + title + '<span class="mute">Edit \u203a</span></h3>' + body + '</button>'; }
    var h = '<div class="sheet-head"><span class="no">Overview</span><h1>' + esc(g.meta.title) + '</h1><p class="lead">' + esc(bl(sum().logline || '')) + '</p></div><div class="dash">' +
      card('pitch', 'Pitch', '<small>' + esc(tone().slice(0, 3).join(' \u00b7 ')) + '</small>') +
      card('style', 'Art style', '<img class="wide" src="' + esc(styleImg(st)) + '" alt=""><small>' + esc(st.name) + '</small>') +
      card('characters', 'Characters', '<div class="thumbs">' + Object.keys(g.characters).map(function (k) { return art(g.characters[k].portrait, 'portrait xs', g.characters[k].name); }).join('') + '</div><small>' + Object.keys(g.characters).map(function (k) { return esc(g.characters[k].name); }).join(', ') + '</small>') +
      card('plot', 'Plot & rooms', '<small>' + d.beats.length + ' story beats \u00b7 ' + Object.keys(g.rooms).length + ' rooms</small><small>' + Object.keys(g.rooms).map(function (k) { return esc(g.rooms[k].name); }).join(', ') + '</small>') +
      card('puzzles', 'Puzzles', '<small>' + g.puzzles.length + ' puzzles \u00b7 ' + Object.keys(g.items).length + ' items</small><small>' + (blocked ? blocked + ' blocked' : '\u2713 all solvable') + '</small>') +
      card('playtest', 'Play', '<small>' + (S.report ? esc(S.report.headline) : '') + '</small>') + '</div>' +
      '<div class="grid two"><div class="card paper"><h3>History</h3>' + historyHTML() + '</div><div class="card paper"><h3>Versions</h3>' + versionsHTML() + '</div></div>';
    return h;
  };
  VIEWS.home.after = function () { bindHistory(); };
  // ------------------------------------------------------------------ history & versions
  function historyHTML() {
    var items = S.history.map(function (x, i) { return { x: x, i: i }; }).slice(-15).reverse();
    return '<ul class="hist">' + items.map(function (o) { return '<li class="' + (o.i === S.hi ? 'cur' : '') + '"><span class="lbl">' + esc(o.x.label) + '</span><small>' + new Date(o.x.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</small>' + (o.i === S.hi ? '<small>now</small>' : '<button class="btn sm ghost" data-jump="' + o.i + '">Go here</button>') + '</li>'; }).join('') + '</ul>';
  }
  function versions() { try { return JSON.parse(lsGet(LS.versions)) || []; } catch (e) { return []; } }
  function versionsHTML() {
    var vs = versions();
    return '<div class="row"><input type="text" id="ver-name" placeholder="Name this version, e.g. \u201cFunnier parrot\u201d" style="flex:1"><button class="btn sm primary" id="ver-save">Save</button></div>' +
      '<ul class="hist">' + (vs.length ? vs.slice().reverse().map(function (v, j) { var i = vs.length - 1 - j; return '<li><span class="lbl">' + (v.ok ? '\u2713 ' : '\u26a0\ufe0f ') + esc(v.name) + '</span><small>' + new Date(v.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</small><button class="btn sm ghost" data-restore="' + i + '">Restore</button></li>'; }).join('') : '<li class="mute">No saved versions yet.</li>') + '</ul>' +
      '<p class="mute" style="font-size:13px">Published (what Playtest uses): ' + (S.publishedAt ? 'last good version, checked ' + new Date(S.publishedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'last good version') + '. Broken drafts are never published.</p>';
  }
  function bindHistory() {
    document.querySelectorAll('[data-jump]').forEach(function (b) { b.onclick = function () { jump(+b.dataset.jump); }; });
    var sv = $('ver-save');
    if (sv) sv.onclick = function () {
      var name = ($('ver-name').value || '').trim() || ('Version ' + (versions().length + 1));
      var vs = versions(); vs.push({ name: name, t: Date.now(), json: JSON.stringify(S.project), ok: !!(S.report && S.report.ok) });
      store(LS.versions, JSON.stringify(vs.slice(-12))); toast('Saved version ' + q(name));
      if (S.sheet && S.sheet.type === 'menu') openMenu(); else renderView();
    };
    document.querySelectorAll('[data-restore]').forEach(function (b) {
      b.onclick = function () { var v = versions()[+b.dataset.restore]; var next = JSON.parse(v.json); closeSheet(); commit({ label: 'Restore version ' + q(v.name), patch: JP.diff(S.project, next), project: next }); };
    });
  }

  // ------------------------------------------------------------------ sheets
  function openSheet(meta, html) {
    S.sheet = meta; $('sheet-body').innerHTML = html; $('sheet').hidden = false; $('scrim').hidden = false;
    $('sheet-body').querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeSheet; });
  }
  function closeSheet() { flushAllIn($('sheet')); S.sheet = null; $('sheet').hidden = true; if ($('cowriter').hidden || window.innerWidth >= 900) $('scrim').hidden = true; }
  function flushAllIn(root) { root.querySelectorAll('[data-ptr]').forEach(function (el) { if (timers[el.dataset.ptr]) flush(el); }); }
  $('scrim').onclick = function () { if (S.sheet && S.sheet.type === 'break') keepDraft(); else closeSheet(); if (!$('cowriter').hidden) closeCowriter(); };

  function stuckHTML(rep) {
    var d = (rep.details || []).filter(function (x) { return x && x.how_to_get_stuck; })[0];
    var lint = (rep.details || []).filter(function (x) { return typeof x === 'string'; });
    var h = '';
    if (d) h += '<details><summary>How a player gets stuck</summary><ol class="steps-list">' + d.how_to_get_stuck.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></details>';
    if (lint.length > 1) h += '<details><summary>All loose ends (' + lint.length + ')</summary><ul class="steps-list">' + lint.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></details>';
    return h;
  }
  function showBreak(rep, label) {
    S.keptDraft = false; renderPill();
    openSheet({ type: 'break' }, '<h2>\u26a0\ufe0f That change breaks the game</h2><div class="breakbox" id="break-text"><b>' + esc(rep.headline) + '</b><p style="margin:.4em 0 0">' + esc(rep.explanation) + '</p></div>' + stuckHTML(rep) +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="break-undo">\u21b6 Undo ' + esc(label ? q(label) : 'it') + '</button><button class="btn ghost" id="break-keep">Keep anyway as a draft</button></div>' +
      '<p class="mute" style="font-size:13px">A draft is saved but never published: Playtest keeps using the last version that worked until the game is winnable again.</p>');
    $('break-undo').onclick = function () { closeSheet(); undo(); };
    $('break-keep').onclick = keepDraft;
  }
  function keepDraft() { S.keptDraft = true; closeSheet(); renderPill(); toast('Kept as a draft. Playtest still uses your last good version.'); }
  $('pill').onclick = function () {
    var r = S.report; if (!r || S.checking) return;
    var box = r.level === 'ok' ? 'okbox' : r.level === 'warn' ? 'warnbox' : 'breakbox';
    var h = '<button class="x" data-close>✕</button><h2>Game check</h2><div class="' + box + '"><b>' + esc(r.headline) + '</b><p style="margin:.4em 0 0">' + esc(r.explanation) + '</p></div>' + (r.level === 'broken' ? stuckHTML(r) : '') +
      '<p class="mute" style="font-size:14px">The solver plays every possible move in every possible order (' + (r.states || 0) + ' game situations, ' + r.ms + ' ms in a ' + S.engine() + ') to prove the game can be finished and nobody gets stuck.</p>';
    if (r.level !== 'ok' && (r.chart_issues || []).length) h += '<details><summary>Puzzle chart notes</summary><ul class="steps-list">' + r.chart_issues.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></details>';
    if (r.level === 'broken') h += '<div class="row"><button class="btn primary" id="pill-undo">\u21b6 Undo last change</button><button class="btn ghost" id="pill-good">Go back to last good version</button></div>';
    openSheet({ type: 'status' }, h);
    if ($('pill-undo')) $('pill-undo').onclick = function () { closeSheet(); undo(); };
    if ($('pill-good')) $('pill-good').onclick = function () { var next = JSON.parse(S.published); closeSheet(); commit({ label: 'Go back to last good version', patch: JP.diff(S.project, next), project: next }); };
  };
  $('btn-undo').onclick = undo; $('btn-redo').onclick = redo;

  function openMenu() {
    var c = CW.loadConfig();
    var h = '<button class="x" data-close>✕</button><h2>Versions & settings</h2><div class="card"><h3>Versions</h3>' + versionsHTML() + '</div><div class="card"><h3>History</h3>' + historyHTML() + '</div>' +
      '<div class="card" id="ai-settings"><h3>Co-writer AI settings</h3><p class="mute" style="font-size:14px">The key stays on this device (browser storage) and is sent only to the AI service you pick.</p>' +
      '<label class="f">Service</label><select id="ai-provider">' + Object.keys(CW.PRESETS).map(function (k) { return '<option value="' + k + '"' + (c.provider === k ? ' selected' : '') + '>' + { openai: 'OpenAI', xai: 'xAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', custom: 'Other (OpenAI-compatible)' }[k] + '</option>'; }).join('') + '</select>' +
      '<label class="f">Endpoint</label><input type="text" id="ai-endpoint" value="' + esc(c.endpoint || CW.PRESETS[c.provider || 'openai'].endpoint) + '">' +
      '<label class="f">Model</label><input type="text" id="ai-model" value="' + esc(c.model || CW.PRESETS[c.provider || 'openai'].model) + '">' +
      '<label class="f">API key</label><input type="password" id="ai-key" value="' + esc(c.key || '') + '" autocomplete="off" placeholder="paste your key">' +
      '<div class="row" style="margin-top:10px"><button class="btn primary" id="ai-save">Save</button><button class="btn ghost" id="ai-forget">Forget key</button></div></div>' +
      '<div class="card"><h3>Sample games</h3><div class="row">' + PATHS.SAMPLES.map(function (x) { return '<button class="btn sm" data-sample-menu="' + x.id + '">Open ' + esc(x.title) + '</button>'; }).join('') + '</div></div>' +
      '<div class="card"><h3>Files</h3><div class="row"><button class="btn sm" id="dl-game">\u2b07 Game file (last good)</button><button class="btn sm" id="dl-proj">\u2b07 Download project</button><button class="btn sm danger" id="reset">Start over</button></div></div>';
    openSheet({ type: 'menu' }, h); bindHistory();
    $('ai-provider').onchange = function () { var p = CW.PRESETS[this.value]; $('ai-endpoint').value = p.endpoint; $('ai-model').value = p.model; };
    $('ai-save').onclick = function () { CW.saveConfig({ provider: $('ai-provider').value, endpoint: $('ai-endpoint').value.trim(), model: $('ai-model').value.trim(), key: $('ai-key').value.trim() }); toast(CW.hasKey() ? 'Co-writer connected.' : 'Saved. Add a key to connect.'); };
    $('ai-forget').onclick = function () { var c2 = CW.loadConfig(); delete c2.key; CW.saveConfig(c2); $('ai-key').value = ''; toast('Key removed from this device.'); };
    $('dl-game').onclick = function () { download('game.json', JSON.stringify(JSON.parse(S.published).game, null, 2)); };
    $('dl-proj').onclick = function () { download('project.json', JSON.stringify(S.project, null, 2)); };
    $('reset').onclick = function () { if (confirm('Start over from the sample game? Your saved versions are kept.')) { [LS.draft, LS.pub, LS.hist, LS.ui].forEach(lsDel); location.reload(); } };
    document.querySelectorAll('[data-sample-menu]').forEach(function (b) { b.onclick = function () { closeSheet(); go('pitch'); openSample(b.dataset.sampleMenu); }; });
  }
  function download(name, text) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  $('btn-menu').onclick = openMenu;

  // ------------------------------------------------------------------ co-writer panel
  function openCowriter() { $('cowriter').hidden = false; if (window.innerWidth < 900) $('scrim').hidden = false; renderCowriter(); }
  function closeCowriter() { $('cowriter').hidden = true; if (!S.sheet) $('scrim').hidden = true; }
  $('fab').onclick = function () { if ($('cowriter').hidden) openCowriter(); else closeCowriter(); };
  function cwStep() { return CW.STEPS[S.ui.step] ? S.ui.step : 'playtest'; }
  function renderCowriter() {
    var step = cwStep(), cfg = CW.STEPS[step], log = S.chats[step] = S.chats[step] || [];
    var h = '<button class="x" id="cw-close" aria-label="Close">✕</button><h2>Co-writer \u00b7 ' + esc(cfg.title) + '</h2>';
    if (!CW.hasKey()) h += '<div class="note">The co-writer isn\u2019t connected yet. To chat freely, add an AI key in <a href="#" id="cw-settings">AI settings</a>. Meanwhile, suggestions marked <b>demo</b> work offline, so you can see how every suggestion is checked by the solver before it touches your game.</div>';
    h += '<div>' + cfg.chips.map(function (c) { return '<button class="chip" data-cw="' + esc(c) + '">' + esc(c) + (CW.demoFor(c) && !CW.hasKey() && isPickle() ? ' <small>demo</small>' : '') + '</button>'; }).join('') + '</div><div class="cw-log" id="cw-log">';
    log.forEach(function (m, i) {
      if (m.role === 'me') h += '<div class="msg me">' + esc(m.text) + '</div>';
      else if (m.role === 'ai') h += '<div class="msg ai">' + esc(m.text) + '</div>';
      else if (m.role === 'proposal') h += proposalHTML(m, i);
    });
    h += '</div><form class="cw-input" id="cw-form"><input type="text" id="cw-text" placeholder="e.g. make the parrot funnier" autocomplete="off"><button class="btn primary" type="submit">Send</button></form>';
    $('cw-body').innerHTML = h;
    $('cw-close').onclick = closeCowriter;
    if ($('cw-settings')) $('cw-settings').onclick = function (e) { e.preventDefault(); closeCowriter(); openMenu(); setTimeout(function () { $('ai-settings').scrollIntoView(); }, 50); };
    $('cw-body').querySelectorAll('[data-cw]').forEach(function (b) { b.onclick = function () { cwSend(b.dataset.cw); }; });
    $('cw-form').onsubmit = function (e) { e.preventDefault(); var t = $('cw-text').value.trim(); if (t) cwSend(t); };
    $('cw-body').querySelectorAll('[data-apply]').forEach(function (b) { b.onclick = function () { applyProposal(+b.dataset.apply); }; });
    $('cw-body').querySelectorAll('[data-fix]').forEach(function (b) { b.onclick = function () { var m = S.chats[cwStep()][+b.dataset.fix]; cwSend(m.ask, true, m.report); }; });
    $('cw-body').querySelectorAll('[data-dismiss]').forEach(function (b) { b.onclick = function () { S.chats[cwStep()][+b.dataset.dismiss].dismissed = true; renderCowriter(); }; });
    var lg = $('cw-log'); if (lg.lastElementChild) lg.lastElementChild.scrollIntoView({ block: 'nearest' });
  }
  function proposalHTML(m, i) {
    var h = '<div class="proposal" data-proposal="' + i + '"><b>Suggested change: ' + esc(m.label) + '</b><ul>' + m.changes.slice(0, 8).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + (m.changes.length > 8 ? '<li>\u2026and ' + (m.changes.length - 8) + ' more</li>' : '') + '</ul>';
    if (m.needs_assets && m.needs_assets.length) h += '<div class="mute" style="font-size:13px">Needs new art/audio later: ' + m.needs_assets.map(esc).join(', ') + '</div>';
    if (!m.report) h += '<div class="organizing"><span class="spinner"></span> Checking it with the solver\u2026</div>';
    else if (m.report.ok) h += '<div class="okbox">\u2713 Solver: ' + esc(m.report.headline) + (m.report.solution_steps ? ' (' + m.report.solution_steps + '-step solution)' : '') + '</div>';
    else h += '<div class="breakbox"><b>Not applied: this would break the game.</b><p style="margin:.4em 0 0">' + esc(m.report.explanation) + '</p></div>';
    if (m.applied) h += '<div class="mute">Applied. Use \u21b6 Undo to take it back.</div>';
    else if (!m.dismissed && m.report) h += '<div class="row">' + (m.report.ok ? '<button class="btn primary sm" data-apply="' + i + '">Apply</button>' : (CW.hasKey() ? '<button class="btn sm" data-fix="' + i + '">Ask it to fix this</button>' : '')) + '<button class="btn ghost sm" data-dismiss="' + i + '">Dismiss</button></div>';
    return h + '</div>';
  }
  function cwSend(text, silentUser, failure) {
    var step = cwStep(), log = S.chats[step] = S.chats[step] || [];
    if (!silentUser) log.push({ role: 'me', text: text });
    var demo = isPickle() ? CW.demoFor(text) : null;
    if (CW.hasKey()) {
      log.push({ role: 'ai', text: '\u2026thinking' }); var thinking = log[log.length - 1]; renderCowriter();
      var msgs = CW.buildMessages(step, S.project, text, (S.cw[step] || []), failure);
      CW.call(msgs).then(function (resp) {
        log.splice(log.indexOf(thinking), 1);
        (S.cw[step] = S.cw[step] || []).push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify(resp) });
        if (resp.reply) log.push({ role: 'ai', text: resp.reply });
        if (resp.patch && resp.patch.length) propose(step, resp, text, (failure && failure.attempt) || 0);
        renderCowriter();
      }).catch(function (e) { thinking.text = 'I couldn\u2019t reach the AI service: ' + e.message; renderCowriter(); });
      return;
    }
    if (demo) { var p = demo(S.project); log.push({ role: 'ai', text: p.reply + ' (Demo suggestion, written ahead of time.)' }); propose(step, p, text, 0); }
    else log.push({ role: 'ai', text: 'I\u2019d love to help with that, but I need an AI key to write something new. Tap AI settings above to connect one. You can still edit everything by hand, and the solver checks each change.' });
    renderCowriter();
  }
  function propose(step, p, ask, attempt) {
    var log = S.chats[step], base = JSON.stringify(S.project), cand;
    var m = { role: 'proposal', label: p.label || 'Co-writer suggestion', patch: p.patch, needs_assets: p.needs_assets || [], base: base, ask: ask, report: null, changes: [] };
    try { cand = JP.apply(S.project, p.patch); m.changes = E.describePatch(S.project, p.patch); }
    catch (e) { m.report = { ok: false, level: 'broken', explanation: 'The suggestion didn\u2019t fit the current game (' + e.message + ').' }; log.push(m); return; }
    log.push(m);
    runValidator(cand, { label: 'AI: ' + m.label, blockedStory: blockedStories(), prevGame: S.project.game }).then(function (rep) {
      m.report = rep; m.candidate = cand;
      if (!rep.ok && CW.hasKey() && attempt < 2) { log.push({ role: 'ai', text: 'That draft broke the game, so I\u2019m asking the co-writer to fix it (try ' + (attempt + 2) + ' of 3)\u2026' }); renderCowriter(); cwSend(ask, true, { explanation: rep.explanation, details: rep.lint_errors, attempt: attempt + 1 }); return; }
      if (!$('cowriter').hidden) renderCowriter();
    });
  }
  function applyProposal(i) {
    var m = S.chats[cwStep()][i];
    if (JSON.stringify(S.project) !== m.base) {
      // project changed since the proposal: re-apply on the current project and re-check before applying
      try { m.candidate = JP.apply(S.project, m.patch); } catch (e) { toast('The game changed since this suggestion; ask again.'); return; }
      m.base = JSON.stringify(S.project); m.report = null; renderCowriter();
      runValidator(m.candidate, { label: 'AI: ' + m.label, blockedStory: blockedStories() }).then(function (rep) { m.report = rep; if (rep.ok) applyProposal(i); else renderCowriter(); });
      return;
    }
    if (commit({ label: 'Co-writer: ' + m.label, patch: m.patch, project: m.candidate })) { m.applied = true; renderCowriter(); toast('Applied: ' + m.label); }
  }

  function isPickle() { var g = S.project.game; return !!(g.characters && g.characters.rocco && g.rooms && g.rooms.diner); }

  // ------------------------------------------------------------------ play (full-screen player page, same tab)
  // No iframe, no srcdoc, no pop-up: play.html is a real page that loads the engine files and reads the last good
  // version from storage. If localStorage is full, the game is handed over in sessionStorage instead.
  function startPlaytest() {
    flushAll();
    if (!S.published) return toast('Nothing playable yet.');
    var ok = lsGet(LS.pub) === S.published;
    try { sessionStorage.removeItem(LS.play); } catch (e) {}
    if (!ok) { try { sessionStorage.setItem(LS.play, S.published); ok = true; } catch (e) {} }
    if (!ok) return toast('Couldn\u2019t hand the game to the player: this browser\u2019s storage is full. Use \u2630 \u2192 Download project, then clear old website data.', 7000);
    S.ui.step = 'playtest'; persist();
    var qs = []; if (S.report && !S.report.ok) qs.push('lastgood=1'); if (/[?&]fast=1/.test(location.search) || window.STUDIO_FAST) qs.push('fast=1');
    location.href = 'play.html' + (qs.length ? '?' + qs.join('&') : '');
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    var params = new URLSearchParams(location.search);
    if (params.get('reset') === '1') {
      [LS.draft, LS.pub, LS.hist, LS.ui, LS.versions].forEach(lsDel);
      try { sessionStorage.removeItem(LS.play); } catch (e) {}
    }
    try { var ui = JSON.parse(lsGet(LS.ui)); if (ui) S.ui = Object.assign(S.ui, ui); } catch (e) {}
    if (params.get('step')) S.ui.step = params.get('step');
    if (params.get('fast') === '1') window.STUDIO_FAST = true;
    if (params.get('reset') || params.get('step') || params.get('sample')) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
    var saved = lsGet(LS.draft), fresh = !saved || !!params.get('sample'), proj = null;
    if (!fresh) { try { proj = JSON.parse(saved); } catch (e) { proj = null; fresh = true; } }
    var p = fresh ? loadSample(params.get('sample') || PATHS.SAMPLES[0].id) : Promise.resolve(proj);
    // remember the sample pitches, so organizing that exact text opens the finished sample
    S.sampleText = {};
    PATHS.SAMPLES.forEach(function (x) { if (x.design) fetch(PATHS.ROOT + x.dir + x.design).then(function (r) { return r.json(); }).then(function (dz) { S.sampleText[x.id] = norm(dz.pitch); }).catch(function () {}); });
    return p.then(function (project) {
      project.design = project.design || {}; project.design.characters = project.design.characters || {}; project.design.rooms = project.design.rooms || {};
      project.design.beats = project.design.beats || []; project.design.puzzles = project.design.puzzles || {}; project.design.summary = project.design.summary || {};
      project.design.style = project.design.style || { selected: 'lucasarts', notes: '' };
      if (!project.design.base && !fresh) project.design.base = 'games/pickle-heist/';
      if (project.design.summary.title && !project.design.summary.source) delete project.design.summary.title;
      var migrated = PATHS.migrate(project);
      S.project = project;
      try { var hh = JSON.parse(lsGet(LS.hist)); if (!fresh && !migrated && hh && hh.h && hh.h.length) { S.history = hh.h; S.hi = Math.min(hh.hi, hh.h.length - 1); } } catch (e) {}
      if (!S.history.length) { S.history = [{ json: JSON.stringify(S.project), label: (migrated ? 'Painted the sketches with real art: ' : 'Start: ') + project.game.meta.title, t: Date.now() }]; S.hi = 0; }
      S.published = fresh || migrated ? null : lsGet(LS.pub);
      persist(); render();
      return validate({}).then(function () { window.STUDIO_READY = true; });
    }).catch(function (e) {
      $('view').innerHTML = '<div class="card breakbox"><b>Couldn\u2019t load the game.</b><p>' + esc(e.message) + '</p><p><a href="?reset=1">Start fresh</a></p></div>';
      window.STUDIO_READY = 'error';
    });
  }
  window.addEventListener('pageshow', function (e) { if (e.persisted && S.project) { S.ui.step = S.ui.step || 'playtest'; render(); } });
  window.STUDIO = { scrollToEl: scrollToEl, S: S, commit: commit, undo: undo, redo: redo, validate: validate, go: go, openPuzzle: openPuzzle, E: E, startPlaytest: startPlaytest };
  boot();
})();
