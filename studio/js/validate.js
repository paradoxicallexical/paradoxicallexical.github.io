/*
 * PNC Studio validator: lint + full state-space solver + plain-English explanations.
 * A browser/worker/node port of tools/solve.js (same checks, minus asset-file checks),
 * built on the SAME engine/core.js interpreter the game uses.
 *
 *   PNCValidate.run(project | game, { label, prevGame }) -> report
 * report.level: 'ok' | 'warn' | 'broken'.  'broken' = lint errors, unwinnable, or dead ends.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../engine/core.js'));
  else root.PNCValidate = factory(root.PNCCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  var MAX_STATES = 300000;

  function pip(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function ent(o) { return Object.keys(o || {}).map(function (k) { return [k, o[k]]; }); }
  function q(s) { return '\u201c' + s + '\u201d'; }

  // ------------------------------------------------------------------ lint (port of tools/solve.js)
  function lint(game) {
    var errors = [], warnings = [], usedFlags = {}, usedItems = {};
    function walkRules(rules, where, fn) { (rules || []).forEach(function (r, i) { fn(r.if, where + '[' + i + '].if'); (r.do || []).forEach(function (e) { fn(null, where, e); }); }); }
    function checkCond(c, where) {
      if (!c) return;
      Object.keys(c.flags || {}).forEach(function (f) { usedFlags[f] = 1; if (!(f in game.flags)) errors.push(where + ': unknown flag ' + f); });
      (c.has || []).concat(c.lacks || []).forEach(function (it) { if (!game.items[it]) errors.push(where + ': unknown item ' + it); });
      ['all', 'any'].forEach(function (k) { (c[k] || []).forEach(function (x) { checkCond(x, where); }); });
      if (c.not) checkCond(c.not, where);
    }
    function checkEffect(e, where) {
      if (e.set) Object.keys(e.set).forEach(function (f) { usedFlags[f] = 1; if (!(f in game.flags)) errors.push(where + ': sets unknown flag ' + f); });
      ['give', 'take'].forEach(function (k) { if (e[k]) { usedItems[e[k]] = 1; if (!game.items[e[k]]) errors.push(where + ': unknown item ' + e[k]); } });
      if (e.by && !game.characters[e.by]) errors.push(where + ': unknown speaker ' + e.by);
      if (e.dialogue && !game.dialogues[e.dialogue]) errors.push(where + ': unknown dialogue ' + e.dialogue);
      if (e.goto && !game.rooms[e.goto]) errors.push(where + ': unknown room ' + e.goto);
    }
    var cb = function (c, w, e) { return e ? checkEffect(e, w) : checkCond(c, w); };
    function checkActions(actions, where) {
      ent(actions).forEach(function (kv) {
        if (kv[0] === 'use_item') ent(kv[1]).forEach(function (ir) {
          if (!game.items[ir[0]]) errors.push(where + '.use_item: unknown item ' + ir[0]);
          walkRules(ir[1], where + '.use_item.' + ir[0], cb);
        });
        else walkRules(kv[1], where + '.' + kv[0], cb);
      });
    }
    if (!game.meta || !game.rooms || !game.items || !game.characters || !game.flags || !game.dialogues) { errors.push('game file is missing a required section'); return { errors: errors, warnings: warnings }; }
    if (!game.rooms[game.meta.start_room]) errors.push('meta.start_room does not exist');
    if (!game.characters[game.meta.player.character]) errors.push('meta.player: unknown character ' + game.meta.player.character);
    ent(game.items).forEach(function (kv) { if (!kv[1].name || !String(kv[1].name).trim()) errors.push('items.' + kv[0] + ': needs a name'); if (!kv[1].image && !kv[1].icon) warnings.push('items.' + kv[0] + ': no icon'); });
    ent(game.characters).forEach(function (kv) {
      var id = kv[0], ch = kv[1];
      if (!ch.name || !String(ch.name).trim()) errors.push('characters.' + id + ': needs a name');
      if (!ch.voice || !ch.voice.notes) warnings.push('characters.' + id + ': no voice notes');
      checkActions(ch.actions, 'characters.' + id + '.actions');
    });
    ent(game.rooms).forEach(function (kv) {
      var rid = kv[0], room = kv[1], W = 'rooms.' + rid;
      if (!room.name || !String(room.name).trim()) errors.push(W + ': needs a name');
      (room.props || []).forEach(function (p, i) { checkCond(p.if, W + '.props[' + i + ']'); });
      if (!room.walkable || room.walkable.length < 3) errors.push(W + ': walkable polygon missing');
      var ids = {};
      (room.hotspots || []).forEach(function (h) {
        var H = W + '.hotspots.' + h.id;
        if (ids[h.id]) errors.push(H + ': duplicate id'); ids[h.id] = 1;
        if (!h.polygon || h.polygon.length < 3) errors.push(H + ': polygon missing');
        if (h.walk_to && room.walkable && !pip(h.walk_to, room.walkable)) errors.push(H + ': walk_to ' + h.walk_to + ' is outside the walkable area');
        checkCond(h.if, H);
        if (h.exit) {
          if (!game.rooms[h.exit.to]) errors.push(H + ': exit to unknown room ' + h.exit.to);
          else if (h.exit.at && !pip(h.exit.at, game.rooms[h.exit.to].walkable)) errors.push(H + ': exit arrival ' + h.exit.at + ' outside ' + h.exit.to + ' walkable area');
          checkCond(h.exit.if, H + '.exit');
          walkRules(h.exit.else, H + '.exit.else', cb);
        }
        checkActions(h.actions, H + '.actions');
      });
      (room.actors || []).forEach(function (a, i) {
        if (!game.characters[a.character]) errors.push(W + '.actors[' + i + ']: unknown character ' + a.character);
        if (!a.scale && room.walkable && !pip(a.at, room.walkable)) warnings.push(W + '.actors[' + i + ']: ' + a.character + ' stands outside walkable area');
        if (a.walk_to && room.walkable && !pip(a.walk_to, room.walkable)) errors.push(W + '.actors[' + i + ']: walk_to outside walkable area');
        checkCond(a.if, W + '.actors[' + i + ']');
      });
      if (room.darkness) checkCond(room.darkness.if, W + '.darkness');
      (room.music || []).forEach(function (m, i) { if (!(game.music || {})[m.track]) errors.push(W + '.music[' + i + ']: unknown track ' + m.track); checkCond(m.if, W + '.music[' + i + ']'); });
    });
    var sr = game.rooms[game.meta.start_room];
    if (sr && !pip(game.meta.player.at, sr.walkable)) errors.push('meta.player.at outside start room walkable area');
    (game.meta.intro || []).forEach(function (l, i) { if (l.by && !game.characters[l.by]) errors.push('meta.intro[' + i + ']: unknown speaker ' + l.by); });
    ent(game.dialogues).forEach(function (kv) {
      var did = kv[0], d = kv[1];
      if (!d.nodes[d.start || 'root']) errors.push('dialogues.' + did + ': missing start node');
      ent(d.nodes).forEach(function (nv) {
        var nid = nv[0], n = nv[1], N = 'dialogues.' + did + '.' + nid;
        (n.lines || []).forEach(function (l) { if (l.by && !game.characters[l.by]) errors.push(N + ': unknown speaker ' + l.by); });
        (n.do || []).forEach(function (e) { checkEffect(e, N); });
        if (n.next && !d.nodes[n.next]) errors.push(N + ': next -> missing node ' + n.next);
        (n.choices || []).forEach(function (c, i) {
          checkCond(c.if, N + '.choices[' + i + ']'); (c.do || []).forEach(function (e) { checkEffect(e, N + '.choices[' + i + ']'); });
          if (c.next && !d.nodes[c.next]) errors.push(N + '.choices[' + i + ']: next -> missing node ' + c.next);
        });
      });
    });
    var pz = {};
    (game.puzzles || []).forEach(function (p) { if (pz[p.id]) errors.push('puzzles.' + p.id + ': duplicate id'); pz[p.id] = p; });
    (game.puzzles || []).forEach(function (p) {
      checkCond(p.solved_when, 'puzzles.' + p.id);
      (p.requires || []).forEach(function (r) { if (!pz[r]) errors.push('puzzles.' + p.id + ': requires unknown puzzle ' + r); });
    });
    // studio extra: the chart must not loop
    var color = {};
    function dfs(id, stack) {
      if (color[id] === 1) { var cyc = stack.slice(stack.indexOf(id)).concat(id); errors.push('puzzles.' + id + ': puzzle chart loop ' + cyc.map(function (x) { return pz[x] ? pz[x].name : x; }).join(' -> ')); return; }
      if (color[id] === 2 || !pz[id]) return;
      color[id] = 1; (pz[id].requires || []).forEach(function (r) { dfs(r, stack.concat(id)); }); color[id] = 2;
    }
    Object.keys(pz).forEach(function (id) { if (!errors.some(function (e) { return /chart loop/.test(e); })) dfs(id, []); });
    checkCond(game.win && game.win.if, 'win');
    Object.keys(game.flags).forEach(function (f) { if (!usedFlags[f]) warnings.push('flag ' + f + ' is never used'); });
    Object.keys(game.items).forEach(function (i) { if (!usedItems[i]) warnings.push('item ' + i + ' is never given'); });
    return { errors: errors, warnings: warnings };
  }

  // ------------------------------------------------------------------ rule walker / trigger finder
  // Calls fn(rule, ctx) for every rule-like {if, do} in the game. ctx.ptr is a JSON pointer.
  function walkAll(game, fn) {
    function rulesOf(list, base, ctx) { (list || []).forEach(function (r, j) { fn(r, Object.assign({ ptr: base + '/' + j }, ctx)); }); }
    function actions(acts, base, ctx) {
      ent(acts).forEach(function (kv) {
        if (kv[0] === 'use_item') ent(kv[1]).forEach(function (ir) { rulesOf(ir[1], base + '/use_item/' + ir[0], Object.assign({ verb: 'use_item', item: ir[0] }, ctx)); });
        else rulesOf(kv[1], base + '/' + kv[0], Object.assign({ verb: kv[0] }, ctx));
      });
    }
    ent(game.rooms).forEach(function (kv) {
      var rid = kv[0];
      (kv[1].hotspots || []).forEach(function (h, i) {
        var base = '/rooms/' + rid + '/hotspots/' + i, ctx = { kind: 'hotspot', room: rid, target: h.id, targetName: h.name };
        actions(h.actions, base + '/actions', ctx);
        if (h.exit) rulesOf(h.exit.else, base + '/exit/else', Object.assign({ verb: 'walk' }, ctx));
      });
    });
    ent(game.characters).forEach(function (kv) {
      actions(kv[1].actions, '/characters/' + kv[0] + '/actions', { kind: 'character', target: kv[0], targetName: kv[1].name });
    });
    ent(game.dialogues).forEach(function (kv) {
      var did = kv[0];
      ent(kv[1].nodes).forEach(function (nv) {
        var base = '/dialogues/' + did + '/nodes/' + nv[0];
        if (nv[1].do) fn({ do: nv[1].do }, { kind: 'dialogue', dialogue: did, node: nv[0], ptr: base });
        (nv[1].choices || []).forEach(function (c, k) { if (c.do) fn({ if: c.if, do: c.do }, { kind: 'choice', dialogue: did, node: nv[0], choice: k, text: c.text, ptr: base + '/choices/' + k }); });
      });
    });
  }
  function dialogueOwner(game, did) {
    var who = null;
    walkAll(game, function (r, ctx) { (r.do || []).forEach(function (e) { if (e.dialogue === did && ctx.kind === 'character') who = ctx.target; }); });
    if (!who) { var n = game.dialogues[did].nodes[game.dialogues[did].start || 'root']; who = n && n.lines && n.lines[0] && n.lines[0].by; }
    return who;
  }
  function choiceInto(game, did, nid) {
    var t = null;
    ent(game.dialogues[did].nodes).forEach(function (nv) { (nv[1].choices || []).forEach(function (c) { if (c.next === nid && !t) t = c.text; }); });
    return t;
  }
  function puzzleFlag(p) {
    var f = p.solved_when && p.solved_when.flags ? Object.keys(p.solved_when.flags).filter(function (k) { return p.solved_when.flags[k]; }) : [];
    return f.length === 1 ? f[0] : null;
  }
  function describeCtx(game, ctx) {
    var verbs = (game.verbs && game.verbs.labels) || {};
    if (ctx.kind === 'dialogue' || ctx.kind === 'choice') {
      var owner = dialogueOwner(game, ctx.dialogue), oname = owner && game.characters[owner] ? game.characters[owner].name : 'someone';
      var choice = ctx.kind === 'choice' ? ctx.text : choiceInto(game, ctx.dialogue, ctx.node);
      return 'Talk to ' + oname + (choice ? ' and choose ' + q(choice) : '');
    }
    if (ctx.verb === 'use_item') return 'Use the ' + itemName(game, ctx.item) + ' on ' + ctx.targetName;
    return (verbs[ctx.verb] || ctx.verb) + ' ' + ctx.targetName;
  }
  function itemName(game, id) { return game.items[id] ? game.items[id].name : id; }
  function triggers(game, p) {
    var flag = puzzleFlag(p), out = [];
    if (!flag) return out;
    walkAll(game, function (r, ctx) {
      (r.do || []).forEach(function (e) {
        if (e.set && e.set[flag]) out.push({ ptr: ctx.ptr, ctx: ctx, cond: r.if || null, text: describeCtx(game, ctx), takes: (r.do.filter(function (x) { return x.take; }).map(function (x) { return x.take; })), gives: r.do.filter(function (x) { return x.give; }).map(function (x) { return x.give; }) });
      });
    });
    return out;
  }
  function condNeeds(c, acc) {
    acc = acc || { items: [], flags: [] };
    if (!c) return acc;
    (c.has || []).forEach(function (i) { acc.items.push(i); });
    Object.keys(c.flags || {}).forEach(function (f) { if (c.flags[f]) acc.flags.push(f); });
    (c.all || []).forEach(function (x) { condNeeds(x, acc); });
    return acc;
  }

  // ------------------------------------------------------------------ solver (port of tools/solve.js BFS)
  function solve(game) {
    var start = Core.newState(game), sk = Core.key(start);
    var nodes = new Map([[sk, { state: start, parent: null, move: null, depth: 0 }]]);
    var edges = new Map(), queue = [sk], head = 0, winKeys = [], runtime = {}, tooBig = false;
    while (head < queue.length) {
      var k = queue[head++], n = nodes.get(k);
      if (n.state.won) { winKeys.push(k); edges.set(k, []); continue; }
      var kids = [], ms = Core.moves(game, n.state);
      for (var i = 0; i < ms.length; i++) {
        var r;
        try { r = Core.step(game, n.state, ms[i]); } catch (e) { runtime[e.message] = 1; continue; }
        var ck = Core.key(r.state); kids.push(ck);
        if (!nodes.has(ck)) {
          if (nodes.size >= MAX_STATES) { tooBig = true; break; }
          nodes.set(ck, { state: r.state, parent: k, move: ms[i], depth: n.depth + 1 }); queue.push(ck);
        }
      }
      edges.set(k, kids);
      if (tooBig) break;
    }
    var rev = new Map();
    edges.forEach(function (kids, k) { kids.forEach(function (c) { if (!rev.has(c)) rev.set(c, []); rev.get(c).push(k); }); });
    var canWin = new Set(winKeys), stack = winKeys.slice();
    while (stack.length) { var x = stack.pop(); (rev.get(x) || []).forEach(function (p) { if (!canWin.has(p)) { canWin.add(p); stack.push(p); } }); }
    var deadEnds = []; nodes.forEach(function (v, kk) { if (!canWin.has(kk)) deadEnds.push(kk); });
    var shortest = winKeys.length ? winKeys.reduce(function (a, b) { return nodes.get(a).depth <= nodes.get(b).depth ? a : b; }) : null;
    function pathTo(kk) { var out = []; while (kk && nodes.get(kk).parent) { var nn = nodes.get(kk); out.unshift({ move: nn.move, room: nodes.get(nn.parent).state.room }); kk = nn.parent; } return out; }
    return { nodes: nodes, winKeys: winKeys, deadEnds: deadEnds, shortest: shortest, pathTo: pathTo, runtime: Object.keys(runtime), tooBig: tooBig };
  }

  // ------------------------------------------------------------------ plain English
  function where(game, w) {
    var m;
    if ((m = /^rooms\.([^.\[]+)\.hotspots\.([^.\[:]+)/.exec(w))) { var r = game.rooms[m[1]], h = r && (r.hotspots || []).filter(function (x) { return x.id === m[2]; })[0]; return 'the ' + (h ? h.name : m[2]) + ' in ' + (r ? r.name : m[1]); }
    if ((m = /^rooms\.([^.\[:]+)/.exec(w))) return game.rooms[m[1]] ? game.rooms[m[1]].name : 'room ' + m[1];
    if ((m = /^characters\.([^.\[:]+)/.exec(w))) return game.characters[m[1]] ? game.characters[m[1]].name : m[1];
    if ((m = /^dialogues\.([^.\[:]+)/.exec(w))) { var o = game.dialogues[m[1]] && dialogueOwner(game, m[1]); return 'the conversation with ' + (o && game.characters[o] ? game.characters[o].name : m[1]); }
    if ((m = /^puzzles\.([^.\[:]+)/.exec(w))) { var p = (game.puzzles || []).filter(function (x) { return x.id === m[1]; })[0]; return 'the puzzle ' + q(p ? p.name : m[1]); }
    if ((m = /^items\.([^.\[:]+)/.exec(w))) return 'the item ' + q(m[1]);
    if (/^meta\.intro/.test(w)) return 'the opening scene';
    if (/^win/.test(w)) return 'the ending';
    return 'the game';
  }
  function friendlyLint(game, e) {
    var parts = /^(.*?): (.*)$/.exec(e), w = parts ? where(game, parts[1]) : 'the game', msg = parts ? parts[2] : e, m;
    if ((m = /unknown item (\S+)/.exec(msg))) return cap(w) + ' still refers to an item ' + q(m[1]) + ' that no longer exists.';
    if ((m = /unknown flag (\S+)/.exec(msg))) return cap(w) + ' uses a story switch ' + q(m[1]) + ' that doesn\u2019t exist.';
    if ((m = /unknown speaker (\S+)/.exec(msg))) return cap(w) + ' has a line spoken by ' + q(m[1]) + ', who isn\u2019t in the cast.';
    if ((m = /unknown character (\S+)/.exec(msg))) return cap(w) + ' places ' + q(m[1]) + ', who isn\u2019t in the cast.';
    if ((m = /unknown dialogue (\S+)/.exec(msg))) return cap(w) + ' starts a conversation ' + q(m[1]) + ' that doesn\u2019t exist.';
    if ((m = /unknown room (\S+)/.exec(msg))) return cap(w) + ' leads to a room ' + q(m[1]) + ' that doesn\u2019t exist.';
    if ((m = /requires unknown puzzle (\S+)/.exec(msg))) return cap(w) + ' depends on a puzzle ' + q(m[1]) + ' that no longer exists.';
    if (/chart loop/.test(msg)) return 'The puzzle chart goes in a circle (' + msg.replace(/^puzzle chart loop /, '').replace(/ -> /g, ' \u2192 ') + '), so none of those puzzles could ever come first.';
    if (/needs a name/.test(msg)) return cap(w) + ' needs a name.';
    if (/outside/.test(msg)) return cap(w) + ' sends the hero to a spot outside the floor they can walk on.';
    if (/missing node|missing start/.test(msg)) return cap(w) + ' jumps to a part of the conversation that doesn\u2019t exist.';
    if (/duplicate id/.test(msg)) return cap(w) + ' has the same ID as something else.';
    return cap(w) + ': ' + msg;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function leadFrom(label) {
    if (!label) return 'This change';
    return label.replace(/^Remove(d)? /i, 'Removing ').replace(/^Change(d)? /i, 'Changing ').replace(/^Rename(d)? /i, 'Renaming ')
      .replace(/^Set /i, 'Setting ').replace(/^Add(ed)? /i, 'Adding ').replace(/^Edit(ed)? /i, 'Editing ').replace(/^AI: /, 'The co-writer\u2019s change (').replace(/(\(.*)$/, function (s) { return s.indexOf(')') < 0 && s.indexOf('(') >= 0 ? s + ')' : s; });
  }
  function moveText(game, m, room) {
    if (m.choice !== undefined) return 'choosing ' + q(m.text);
    var t = Core.findTarget(game, Object.assign(Core.newState(game), { room: room, flags: {}, inv: [] }), m.target);
    var name = m.target;
    (game.rooms[room].hotspots || []).forEach(function (h) { if (h.id === m.target) name = h.name; });
    if (game.characters[m.target]) name = game.characters[m.target].name;
    if (m.verb === 'use_item') return 'using the ' + itemName(game, m.item) + ' on ' + name;
    var vl = { walk: 'walking to', look: 'looking at', pickup: 'picking up', use: 'using', talk: 'talking to' };
    return (vl[m.verb] || m.verb) + ' ' + name;
  }

  // ------------------------------------------------------------------ main entry
  function run(input, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var game = input && input.game ? input.game : input;
    var L = lint(game);
    var rep = { level: 'ok', ok: true, headline: '', explanation: '', details: [], lint_errors: L.errors, lint_warnings: L.warnings,
      chart_issues: [], winnable: false, dead_end_states: 0, solution_steps: null, states: 0, puzzle_status: {}, ms: 0, solution: null };
    if (L.errors.length) {
      rep.level = 'broken'; rep.ok = false;
      rep.headline = 'Something in the game points at a thing that isn\u2019t there';
      var friendly = L.errors.slice(0, 5).map(function (e) { return friendlyLint(game, e); });
      rep.explanation = leadFrom(opts.label) + ' left a loose end: ' + friendly[0];
      rep.details = friendly;
      rep.ms = Date.now() - t0; return rep;
    }
    var S;
    try { S = solve(game); } catch (e) { rep.level = 'broken'; rep.ok = false; rep.headline = 'The game crashed while being tested'; rep.explanation = String(e.message || e); rep.ms = Date.now() - t0; return rep; }
    var nodes = S.nodes, puzzles = game.puzzles || [], pz = {};
    puzzles.forEach(function (p) { pz[p.id] = p; });
    rep.states = nodes.size; rep.winnable = !!S.shortest; rep.dead_end_states = S.deadEnds.length;
    var sol = S.shortest ? S.pathTo(S.shortest) : null;
    rep.solution_steps = sol ? sol.length : null;
    rep.solution = sol ? sol.map(function (s) { return Object.assign({ room: s.room }, s.move); }) : null;
    // puzzle reachability, items/flags ever seen, co-solved pairs
    var solvedIn = function (s, p) { return Core.cond(game, s, p.solved_when); };
    var reach = {}, itemsSeen = {}, flagsSeen = {}, masks = new Set();
    nodes.forEach(function (n) {
      var mask = '';
      puzzles.forEach(function (p) { var sv = solvedIn(n.state, p); if (sv) reach[p.id] = 1; mask += sv ? '1' : '0'; });
      masks.add(mask);
      n.state.inv.forEach(function (i) { itemsSeen[i] = 1; });
      Object.keys(n.state.flags).forEach(function (f) { flagsSeen[f] = 1; });
    });
    puzzles.forEach(function (p) { rep.puzzle_status[p.id] = reach[p.id] ? 'ok' : 'blocked'; });
    var maskArr = Array.from(masks);
    function coSolved(a, b) { var ia = puzzles.indexOf(pz[a]), ib = puzzles.indexOf(pz[b]); return maskArr.some(function (m) { return m[ia] === '1' && m[ib] === '1'; }); }
    function transReq(id) { var seen = {}, st = (pz[id].requires || []).slice(); while (st.length) { var x = st.pop(); if (!seen[x] && pz[x]) { seen[x] = 1; st.push.apply(st, pz[x].requires || []); } } return Object.keys(seen); }
    // chart vs logic (informational)
    var shortestState = S.shortest ? nodes.get(S.shortest).state : null;
    puzzles.forEach(function (p) {
      if (shortestState && !solvedIn(shortestState, p)) rep.chart_issues.push(q(p.name) + ' isn\u2019t needed to win (it\u2019s optional).');
      (p.requires || []).forEach(function (r) {
        var rp = pz[r]; if (!rp) return;
        var bad = false; nodes.forEach(function (n) { if (!bad && solvedIn(n.state, p) && !solvedIn(n.state, rp)) bad = true; });
        if (bad) rep.chart_issues.push('The chart says ' + q(p.name) + ' needs ' + q(rp.name) + ' first, but players can do it before that.');
      });
    });
    rep.lint_errors = rep.lint_errors.concat(S.runtime.map(function (r) { return 'runtime: ' + r; }));
    if (S.tooBig) rep.lint_errors.push('State space too large');

    var lead = leadFrom(opts.label);
    if (S.runtime.length) {
      rep.level = 'broken'; rep.headline = 'The game crashed while being tested'; rep.explanation = lead + ' makes the game crash: ' + S.runtime[0];
    } else if (!rep.winnable) {
      rep.level = 'broken'; rep.headline = 'The game can\u2019t be finished anymore';
      var blocked = puzzles.filter(function (p) { return !reach[p.id]; });
      var roots = blocked.filter(function (p) { return (p.requires || []).every(function (r) { return reach[r]; }); });
      if (!roots.length && blocked.length) roots = [blocked[0]];
      var sentences = [];
      roots.slice(0, 2).forEach(function (rp) {
        var why = whyBlocked(rp);
        var downstream = blocked.filter(function (b) { return b !== rp && transReq(b.id).indexOf(rp.id) >= 0; });
        var story = (opts.blockedStory && opts.blockedStory[rp.id]) || '';
        var s = lead + ' means ' + q(rp.name) + ' can\u2019t be solved' + (why ? ' (' + why + ')' : '') + (story ? ', so ' + story : '') + '.';
        if (downstream.length) s += ' That blocks ' + downstream.length + ' later puzzle' + (downstream.length > 1 ? 's' : '') + ' (' + downstream.map(function (d) { return d.name; }).join(' \u2192 ') + '), so the game can\u2019t be finished.';
        else s += ' The game can\u2019t be finished without it.';
        sentences.push(s);
        rep.details.push({ puzzle: rp.id, why: why, blocked: downstream.map(function (d) { return d.id; }) });
      });
      if (!sentences.length) sentences.push(lead + ' means the ending can never trigger (no way to reach the win condition).');
      rep.explanation = sentences.join(' ');
    } else if (S.deadEnds.length) {
      rep.level = 'broken'; rep.headline = 'Players can get stuck (a dead end)';
      var dk = S.deadEnds.reduce(function (a, b) { return nodes.get(a).depth <= nodes.get(b).depth ? a : b; });
      var dn = nodes.get(dk), pn = nodes.get(dn.parent);
      var mv = moveText(game, dn.move, pn.state.room);
      var lost = pn.state.inv.filter(function (i) { return dn.state.inv.indexOf(i) < 0; });
      var neededFor = [];
      lost.forEach(function (it) {
        puzzles.forEach(function (p) {
          if (solvedIn(dn.state, p)) return;
          triggers(game, p).forEach(function (t) { if (t.ctx.item === it || condNeeds(t.cond).items.indexOf(it) >= 0) neededFor.push({ item: it, puzzle: p }); });
        });
      });
      var path = S.pathTo(dk).map(function (s) { return moveText(game, s.move, s.room); });
      rep.explanation = lead + ' creates a dead end: ' + (neededFor.length
        ? 'if a player tries ' + mv + ', the ' + itemName(game, neededFor[0].item) + ' gets used up, but it\u2019s still needed for ' + q(neededFor[0].puzzle.name) + '. After that the game can\u2019t be won.'
        : 'after ' + mv + ' the game can no longer be won.') ;
      rep.details.push({ how_to_get_stuck: path, dead_end_states: S.deadEnds.length });
    } else if (rep.chart_issues.filter(function (c) { return !/optional/.test(c); }).length) {
      rep.level = 'warn'; rep.headline = 'Winnable, but the puzzle chart doesn\u2019t match the game';
      rep.explanation = rep.chart_issues.filter(function (c) { return !/optional/.test(c); })[0] + ' The game still works; the chart is just out of date.';
    }
    if (rep.level === 'ok') {
      rep.headline = 'Game is winnable, no dead ends';
      rep.explanation = 'Checked all ' + rep.states + ' possible game situations. The shortest solution is ' + rep.solution_steps + ' steps.';
    }
    rep.ok = rep.level !== 'broken';
    rep.ms = Date.now() - t0;
    return rep;

    function whyBlocked(p) {
      // 1. two puzzles it depends on can never both be done
      var req = transReq(p.id).filter(function (r) { return reach[r]; });
      var used = function (id) { return [].concat.apply([], triggers(game, pz[id]).map(function (t) { return t.takes; })); };
      var fallback = null;
      for (var a = 0; a < req.length; a++) for (var b = a + 1; b < req.length; b++) {
        if (!coSolved(req[a], req[b])) {
          var ta = used(req[a]), tb = used(req[b]);
          var shared = ta.filter(function (i) { return tb.indexOf(i) >= 0; });
          var msg = q(pz[req[a]].name) + ' and ' + q(pz[req[b]].name) + ' can\u2019t both happen' + (shared.length ? ': they both use up the ' + itemName(game, shared[0]) : '');
          if (shared.length) return msg;
          if (!fallback) fallback = msg;
        }
      }
      if (fallback) return fallback;
      var ts = triggers(game, p);
      if (!ts.length) {
        var prev = opts.prevGame ? triggers(opts.prevGame, (opts.prevGame.puzzles || []).filter(function (x) { return x.id === p.id; })[0] || p) : [];
        return prev.length ? 'the only way to do it, \u201c' + prev[0].text + '\u201d, is gone' : 'nothing in the game makes it happen anymore';
      }
      var reasons = ts.map(function (t) {
        var needs = condNeeds(t.cond); if (t.ctx.item) needs.items.push(t.ctx.item);
        var missingItem = needs.items.filter(function (i) { return !itemsSeen[i]; })[0];
        if (missingItem) return t.text + ' needs the ' + itemName(game, missingItem) + ', which players can never get';
        var missingFlag = needs.flags.filter(function (f) { return !flagsSeen[f]; })[0];
        if (missingFlag) {
          var fp = puzzles.filter(function (x) { return puzzleFlag(x) === missingFlag; })[0];
          return t.text + ' only works after ' + (fp ? q(fp.name) : 'something (' + missingFlag + ') that never happens');
        }
        return null;
      }).filter(Boolean);
      return reasons[0] || '';
    }
  }

  return { run: run, lint: lint, triggers: triggers, walkAll: walkAll, describeCtx: describeCtx, puzzleFlag: puzzleFlag, friendlyLint: friendlyLint, condNeeds: condNeeds, pip: pip };
});
