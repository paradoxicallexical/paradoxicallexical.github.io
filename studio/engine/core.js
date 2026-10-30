/*
 * PNC core: pure, deterministic game-logic interpreter for the game-file format.
 * Shared by the browser engine (engine.js) and the solver (tools/solve.js), so the
 * solver proves properties of exactly the logic the player experiences.
 *
 * State:  { room, flags:{}, inv:[], dialogue:null|{id,node}, won:false }
 * Events: [{type:'say', by, text} | {type:'room', room, at} | {type:'sfx', name}
 *          | {type:'dialogue'} | {type:'win'}]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PNCCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clone(s) {
    return { room: s.room, flags: Object.assign({}, s.flags), inv: s.inv.slice(),
             dialogue: s.dialogue ? Object.assign({}, s.dialogue) : null, won: !!s.won };
  }

  function newState(game) {
    var flags = {};
    Object.keys(game.flags || {}).forEach(function (k) { if (game.flags[k]) flags[k] = true; });
    return { room: game.meta.start_room, flags: flags, inv: [], dialogue: null, won: false };
  }

  // Condition: undefined -> true. {flags:{f:bool}, has:[...], lacks:[...], room, any:[c], all:[c], not:c}
  function cond(game, s, c) {
    if (!c) return true;
    if (c.flags) for (var f in c.flags) if (!!s.flags[f] !== !!c.flags[f]) return false;
    if (c.has) for (var i = 0; i < c.has.length; i++) if (s.inv.indexOf(c.has[i]) < 0) return false;
    if (c.lacks) for (var j = 0; j < c.lacks.length; j++) if (s.inv.indexOf(c.lacks[j]) >= 0) return false;
    if (c.room && s.room !== c.room) return false;
    if (c.all && !c.all.every(function (x) { return cond(game, s, x); })) return false;
    if (c.any && !c.any.some(function (x) { return cond(game, s, x); })) return false;
    if (c.not && cond(game, s, c.not)) return false;
    return true;
  }

  function applyEffects(game, s, effects, ev) {
    (effects || []).forEach(function (e) {
      if (e.say !== undefined) ev.push({ type: 'say', by: e.by || game.meta.player.character, text: e.say });
      if (e.set) for (var f in e.set) { if (e.set[f]) s.flags[f] = true; else delete s.flags[f]; }
      if (e.give && s.inv.indexOf(e.give) < 0) s.inv.push(e.give);
      if (e.take) s.inv = s.inv.filter(function (x) { return x !== e.take; });
      if (e.sfx) ev.push({ type: 'sfx', name: e.sfx });
      if (e.goto) { s.room = e.goto; ev.push({ type: 'room', room: e.goto, at: e.at }); }
      if (e.dialogue) enterDialogue(game, s, e.dialogue, game.dialogues[e.dialogue].start || 'root', ev);
      if (e.win) s.won = true;
    });
  }

  function runRules(game, s, rules, ev) {
    if (!rules) return false;
    for (var i = 0; i < rules.length; i++) {
      if (cond(game, s, rules[i].if)) { applyEffects(game, s, rules[i].do, ev); return true; }
    }
    return false;
  }

  // Walk dialogue nodes until one with choices (stop) or end.
  function enterDialogue(game, s, id, nodeId, ev) {
    var guard = 0;
    while (nodeId && guard++ < 100) {
      var node = game.dialogues[id].nodes[nodeId];
      if (!node) throw new Error('Missing dialogue node ' + id + '.' + nodeId);
      (node.lines || []).forEach(function (l) { ev.push({ type: 'say', by: l.by || game.meta.player.character, text: l.say }); });
      applyEffects(game, s, node.do, ev);
      if (node.choices) { s.dialogue = { id: id, node: nodeId }; ev.push({ type: 'dialogue' }); return; }
      nodeId = node.next;
    }
    s.dialogue = null;
  }

  function choices(game, s) {
    if (!s.dialogue) return [];
    var node = game.dialogues[s.dialogue.id].nodes[s.dialogue.node];
    var out = [];
    node.choices.forEach(function (c, i) { if (cond(game, s, c.if)) out.push({ index: i, text: c.text }); });
    return out;
  }

  function choose(game, s0, index) {
    var s = clone(s0), ev = [];
    var d = s.dialogue, node = game.dialogues[d.id].nodes[d.node], c = node.choices[index];
    ev.push({ type: 'say', by: game.meta.player.character, text: c.text });
    s.dialogue = null;
    applyEffects(game, s, c.do, ev);
    if (c.next) enterDialogue(game, s, d.id, c.next, ev);
    else ev.push({ type: 'dialogue_end' });
    checkWin(game, s, ev);
    return { state: s, events: ev };
  }

  // Everything clickable in the current room for this state.
  function targets(game, s) {
    var room = game.rooms[s.room], out = [];
    (room.hotspots || []).forEach(function (h) { if (cond(game, s, h.if)) out.push({ kind: 'hotspot', id: h.id, name: h.name, def: h, actions: h.actions || {} }); });
    (room.actors || []).forEach(function (a, i) {
      if (cond(game, s, a.if)) {
        var ch = game.characters[a.character];
        out.push({ kind: 'actor', id: a.character, name: ch.name, def: a, actions: ch.actions || {}, actorIndex: i });
      }
    });
    return out;
  }

  function findTarget(game, s, id) {
    var t = targets(game, s);
    for (var i = 0; i < t.length; i++) if (t[i].id === id) return t[i];
    return null;
  }

  /* act: {verb, target, item?}. verb in walk|look|pickup|use|talk|use_item */
  function act(game, s0, a) {
    var s = clone(s0), ev = [];
    if (s.dialogue) throw new Error('In dialogue; use choose()');
    // Looking at / using an inventory item by itself
    if (a.target && a.target.indexOf('item:') === 0) {
      var it = game.items[a.target.slice(5)];
      if (a.verb === 'look') ev.push({ type: 'say', by: game.meta.player.character, text: it.look || ('A ' + it.name + '.') });
      else ev.push({ type: 'say', by: game.meta.player.character, text: game.verbs.defaults[a.verb] || game.verbs.defaults.use });
      return { state: s, events: ev };
    }
    var t = findTarget(game, s, a.target);
    if (!t) throw new Error('No visible target ' + a.target + ' in ' + s.room);
    var ex = t.kind === 'hotspot' ? t.def.exit : null;
    var handled = false;
    if (a.verb === 'use_item') {
      handled = runRules(game, s, (t.actions.use_item || {})[a.item], ev);
      if (!handled) ev.push({ type: 'say', by: game.meta.player.character, text: game.verbs.defaults.use_item });
    } else if (ex && (a.verb === 'walk' || (a.verb === 'use' && !t.actions.use))) {
      if (cond(game, s, ex.if)) {
        s.room = ex.to; ev.push({ type: 'sfx', name: 'door' }); ev.push({ type: 'room', room: ex.to, at: ex.at });
      } else {
        handled = runRules(game, s, ex.else, ev);
        if (!handled) ev.push({ type: 'say', by: game.meta.player.character, text: "It won't open." });
      }
    } else if (a.verb === 'walk') {
      // plain walk: no logic
    } else {
      handled = runRules(game, s, t.actions[a.verb], ev);
      if (!handled) ev.push({ type: 'say', by: game.meta.player.character, text: game.verbs.defaults[a.verb] || '...' });
    }
    checkWin(game, s, ev);
    return { state: s, events: ev };
  }

  function checkWin(game, s, ev) {
    if (!s.won && game.win && cond(game, s, game.win.if)) { s.won = true; }
    if (s.won && !ev.some(function (e) { return e.type === 'win'; })) ev.push({ type: 'win' });
  }

  function musicFor(game, s, roomId) {
    var rules = game.rooms[roomId || s.room].music || [];
    for (var i = 0; i < rules.length; i++) if (cond(game, s, rules[i].if)) return rules[i].track;
    return null;
  }

  function key(s) {
    return s.room + '|' + Object.keys(s.flags).sort().join(',') + '|' + s.inv.slice().sort().join(',') +
      '|' + (s.dialogue ? s.dialogue.id + '.' + s.dialogue.node : '') + '|' + (s.won ? 'W' : '');
  }

  // All logically distinct moves from a state (used by the solver).
  function moves(game, s) {
    if (s.won) return [];
    if (s.dialogue) return choices(game, s).map(function (c) { return { choice: c.index, text: c.text }; });
    var out = [];
    targets(game, s).forEach(function (t) {
      if (t.kind === 'hotspot' && t.def.exit) out.push({ verb: 'walk', target: t.id });
      ['look', 'pickup', 'use', 'talk'].forEach(function (v) { out.push({ verb: v, target: t.id }); });
      s.inv.forEach(function (item) { out.push({ verb: 'use_item', target: t.id, item: item }); });
    });
    return out;
  }

  function step(game, s, m) {
    return m.choice !== undefined ? choose(game, s, m.choice) : act(game, s, m);
  }

  return { newState: newState, cond: cond, act: act, choose: choose, choices: choices, targets: targets,
           findTarget: findTarget, moves: moves, step: step, key: key, clone: clone, musicFor: musicFor };
});
