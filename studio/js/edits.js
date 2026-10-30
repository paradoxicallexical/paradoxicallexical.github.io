/*
 * Studio edit operations. Every edit is expressed as {label, patch} where patch is RFC 6902 JSON Patch
 * against the project document {design, game}. Manual edits and AI proposals go through the same path:
 * patch -> candidate project -> validator -> (apply | explain + undo).
 * IDs are never changed by these edits: only display text.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./jsonpatch.js'), require('./validate.js'));
  else root.StudioEdits = factory(root.JSONPatch, root.PNCValidate);
})(typeof self !== 'undefined' ? self : this, function (JP, V) {
  'use strict';
  function mutate(project, label, fn, extra2) {
    var next = JP.clone(project);
    var extra = fn(next) || {};
    return Object.assign({ label: label, patch: JP.diff(project, next) }, extra, extra2 || {});
  }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var TEXT_KEYS = { say: 1, text: 1, name: 1, look: 1, title: 1, subtitle: 1, description: 1, notes: 1, blocked_story: 1, logline: 1, role: 1, personality: 1 };

  // Replace whole-word mentions of a display name in every human-readable string (never in IDs/keys).
  function replaceMentions(node, pairs, counter, keyName) {
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) node[i] = replaceMentions(node[i], pairs, counter, keyName); return node; }
    if (node && typeof node === 'object') { Object.keys(node).forEach(function (k) { node[k] = replaceMentions(node[k], pairs, counter, k); }); return node; }
    if (typeof node === 'string' && TEXT_KEYS[keyName]) {
      var s = node;
      pairs.forEach(function (p) { s = s.replace(new RegExp('(^|[^A-Za-z0-9_])' + reEsc(p[0]) + '(?![A-Za-z0-9_])', 'g'), function (m, pre) { counter.n++; return pre + p[1]; }); });
      return s;
    }
    return node;
  }
  function renamePairs(oldName, newName) {
    var pairs = [[oldName, newName]];
    var ow = oldName.split(/\s+/), nw = newName.split(/\s+/);
    if (ow.length > 1 && ow.length === nw.length) ow.forEach(function (w, i) { if (w !== nw[i] && w.length >= 3 && /^[A-Z]/.test(w)) pairs.push([w, nw[i]]); });
    return pairs;
  }


  function slugify(s) { return String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'x'; }
  function uniq(base, taken) { var id = base, n = 2; while (taken[id]) id = base + '_' + n++; return id; }
  function arrToObj(a) { var o = {}; (a || []).forEach(function (x) { o[x.id] = 1; }); return o; }
  function placeActor(room, id) {
    var used = (room.actors || []).map(function (a) { return a.at[0]; }), xs = [640, 800, 480, 900, 360], x = xs.filter(function (v) { return used.every(function (u) { return Math.abs(u - v) > 110; }); })[0] || 600;
    var fy = (room.depth && room.depth.far_y) || 392;
    room.actors = room.actors || []; room.actors.push({ character: id, at: [x, Math.min(540, Math.round(fy + (576 - fy) * 0.62))] });
  }
  // remove spoken lines by a removed character (anywhere in the game)
  function dropLinesBy(node, id) {
    if (Array.isArray(node)) { for (var i = node.length - 1; i >= 0; i--) { var x = node[i]; if (x && typeof x === 'object' && x.say !== undefined && x.by === id) node.splice(i, 1); else dropLinesBy(x, id); } return; }
    if (node && typeof node === 'object') Object.keys(node).forEach(function (k) { dropLinesBy(node[k], id); });
  }

  var E = {
    set: function (project, ptr, value, label) {
      return mutate(project, label || 'Edit text', function (p) {
        var parts = JP.parse(ptr), key = parts.pop(), cur = p;
        parts.forEach(function (k) { cur = cur[k]; });
        cur[key] = value;
      });
    },
    renameCharacter: function (project, id, newName) {
      var oldName = project.game.characters[id].name;
      newName = String(newName);
      var counter = { n: 0 };
      var r = mutate(project, 'Rename ' + oldName + ' to ' + (newName || '(blank)'), function (p) {
        if (newName.trim() && oldName.trim()) {
          var pairs = renamePairs(oldName, newName.trim());
          replaceMentions(p.game, pairs, counter, null);
          replaceMentions(p.design, pairs, counter, null);
        }
        p.game.characters[id].name = newName.trim() ? newName.trim() : '';
      });
      r.mentions = counter.n;
      return r;
    },
    // Remove an item and every place that hands it out or reacts to it (cascade, so nothing dangles).
    removeItem: function (project, itemId) {
      var nm = project.game.items[itemId].name;
      return mutate(project, 'Remove the ' + nm, function (p) {
        var g = p.game;
        delete g.items[itemId];
        function cleanDo(list) { return (list || []).filter(function (e) { return e.give !== itemId && e.take !== itemId; }); }
        function cleanCond(c) {
          if (!c) return c;
          ['has', 'lacks'].forEach(function (k) { if (c[k]) { c[k] = c[k].filter(function (x) { return x !== itemId; }); if (!c[k].length) delete c[k]; } });
          ['all', 'any'].forEach(function (k) { (c[k] || []).forEach(cleanCond); });
          if (c.not) cleanCond(c.not);
          return c;
        }
        function cleanRules(rules) { (rules || []).forEach(function (r) { cleanCond(r.if); r.do = cleanDo(r.do); }); }
        function cleanActions(a) { if (!a) return; Object.keys(a).forEach(function (v) { if (v === 'use_item') { delete a.use_item[itemId]; Object.keys(a.use_item).forEach(function (k) { cleanRules(a.use_item[k]); }); } else cleanRules(a[v]); }); }
        Object.keys(g.rooms).forEach(function (rid) { var r = g.rooms[rid]; (r.hotspots || []).forEach(function (h) { cleanCond(h.if); cleanActions(h.actions); if (h.exit) { cleanCond(h.exit.if); cleanRules(h.exit.else); } }); (r.actors || []).forEach(function (a) { cleanCond(a.if); }); (r.props || []).forEach(function (pr) { cleanCond(pr.if); }); });
        Object.keys(g.characters).forEach(function (c) { cleanActions(g.characters[c].actions); });
        Object.keys(g.dialogues).forEach(function (d) { var ns = g.dialogues[d].nodes; Object.keys(ns).forEach(function (n) { if (ns[n].do) ns[n].do = cleanDo(ns[n].do); (ns[n].choices || []).forEach(function (c) { cleanCond(c.if); if (c.do) c.do = cleanDo(c.do); }); }); });
        (g.puzzles || []).forEach(function (pz) { cleanCond(pz.solved_when); });
        if (g.win) cleanCond(g.win.if);
      });
    },
    // Change which item a "Use X on Y" puzzle step needs. Moves the rule and renames take-effects.
    setTriggerItem: function (project, puzzleId, triggerPtr, newItem) {
      var m = /^(.*\/use_item)\/([^/]+)\/\d+$/.exec(triggerPtr);
      if (!m) throw new Error('Not a use-item trigger');
      var base = m[1], oldItem = m[2];
      var pz = project.game.puzzles.filter(function (x) { return x.id === puzzleId; })[0];
      return mutate(project, 'Change ' + q(pz.name) + ' to need the ' + project.game.items[newItem].name + ' instead of the ' + project.game.items[oldItem].name, function (p) {
        var ui = JP.get(p.game, base);
        var rules = ui[oldItem];
        rules.forEach(function (r) { (r.do || []).forEach(function (e) { if (e.take === oldItem) e.take = newItem; }); });
        delete ui[oldItem];
        ui[newItem] = rules;
      });
    },
    setRequires: function (project, puzzleId, requires) {
      var pz = project.game.puzzles.filter(function (x) { return x.id === puzzleId; })[0];
      return mutate(project, 'Change what ' + q(pz.name) + ' needs', function (p) {
        p.game.puzzles.filter(function (x) { return x.id === puzzleId; })[0].requires = requires.slice();
      });
    },
    addBeat: function (project, afterIdx) {
      return mutate(project, 'Add a story beat', function (p) {
        var id = 'b' + Date.now().toString(36);
        p.design.beats.splice(afterIdx + 1, 0, { id: id, title: 'New beat', text: 'What happens next?' });
      });
    },
    removeBeat: function (project, idx) {
      return mutate(project, 'Remove story beat ' + q(project.design.beats[idx].title), function (p) { p.design.beats.splice(idx, 1); });
    },
    moveBeat: function (project, idx, dir) {
      return mutate(project, 'Move story beat ' + q(project.design.beats[idx].title), function (p) {
        var b = p.design.beats, j = idx + dir; if (j < 0 || j >= b.length) return; var t = b[idx]; b[idx] = b[j]; b[j] = t;
      });
    },
    selectStyle: function (project, style) {
      return mutate(project, 'Choose the ' + style.name + ' art style', function (p) {
        p.design.style.selected = style.id;
        p.game.style_guide = p.game.style_guide || {};
        p.game.style_guide.prompt = style.guide.look + ' Palette: ' + style.guide.palette + ' Characters: ' + style.guide.characters + ' Avoid: ' + style.guide.avoid;
      });
    },
    renameRoom: function (project, rid, newName) {
      var oldName = project.game.rooms[rid].name, counter = { n: 0 };
      newName = String(newName).trim();
      var r = mutate(project, 'Rename room ' + oldName + ' to ' + (newName || '(blank)'), function (p) {
        if (newName && oldName) { replaceMentions(p.game, [[oldName, newName]], counter, null); replaceMentions(p.design, [[oldName, newName]], counter, null); }
        p.game.rooms[rid].name = newName;
      });
      r.mentions = counter.n; return r;
    },
    // New character: pencil-sketch art until it is painted; stands in the chosen room and can be talked to.
    addCharacter: function (project, name, roomId, art) {
      name = String(name || '').trim() || 'New character';
      var g = project.game, id = uniq(slugify(name), g.characters);
      return mutate(project, 'Add character ' + q(name), function (p) {
        p.game.characters[id] = { name: name, sprite: (art && art[0]) || 'sketch:sprite', portrait: (art && art[1]) || 'sketch:portrait', faces: 'left', color: '#c9a86a',
          voice: { notes: 'To be decided', pitch: 1, rate: 1 }, idle: { breathe: 0.018, period: 3.1, actions: [{ type: 'look', every: [5, 10], dur: 1.6 }] },
          actions: { talk: [{ do: [{ by: id, say: 'G\u2019day. I\u2019m ' + name + '. My lines aren\u2019t written yet.' }] }], look: [{ do: [{ say: 'That\u2019s ' + name + '.' }] }] } };
        p.design.characters = p.design.characters || {};
        p.design.characters[id] = { role: 'New character', personality: '', look: '' };
        if (roomId && p.game.rooms[roomId]) placeActor(p.game.rooms[roomId], id);
      }, { id: id });
    },
    removeCharacter: function (project, id) {
      var g = project.game, c = g.characters[id];
      return mutate(project, 'Remove ' + (c ? c.name : id), function (p) {
        Object.keys(p.game.rooms).forEach(function (rid) { var r = p.game.rooms[rid]; r.actors = (r.actors || []).filter(function (a) { return a.character !== id; }); });
        dropLinesBy(p.game, id);
        delete p.game.characters[id];
        if (p.design.characters) delete p.design.characters[id];
      });
    },
    moveCharacter: function (project, id, roomId) {
      var g = project.game;
      return mutate(project, 'Move ' + g.characters[id].name + ' to ' + (roomId ? g.rooms[roomId].name : 'nowhere'), function (p) {
        Object.keys(p.game.rooms).forEach(function (rid) { var r = p.game.rooms[rid]; r.actors = (r.actors || []).filter(function (a) { return a.character !== id; }); });
        if (roomId) placeActor(p.game.rooms[roomId], id);
      });
    },
    // New room: pencil-sketch background, a two-way path to the room it is connected to.
    addRoom: function (project, name, fromId, art) {
      name = String(name || '').trim() || 'New room';
      var g = project.game, id = uniq(slugify(name), g.rooms), from = g.rooms[fromId] ? fromId : g.meta.start_room;
      return mutate(project, 'Add room ' + q(name), function (p) {
        var fr = p.game.rooms[from], fy = (fr.depth && fr.depth.far_y) || 392;
        p.game.rooms[id] = { name: name, background: art || 'sketch:bg', walkable: [[0, 392], [1024, 392], [1024, 576], [0, 576]],
          depth: { far_y: 392, far_scale: 0.55, near_y: 576, near_scale: 0.86 }, music: fr.music ? JP.clone(fr.music) : undefined, actors: [],
          hotspots: [{ id: 'back', name: 'Back to ' + fr.name, polygon: [[0, 392], [70, 392], [70, 576], [0, 576]], walk_to: [36, 520], exit: { to: from, at: [512, Math.round((fy + 576) / 2 + 20)] },
            actions: { look: [{ do: [{ say: 'Back to ' + fr.name + '.' }] }] } }] };
        if (!p.game.rooms[id].music) delete p.game.rooms[id].music;
        fr.hotspots = fr.hotspots || [];
        var y = Math.round((fy + 576) / 2), hid = uniq('to_' + id, arrToObj(fr.hotspots));
        fr.hotspots.push({ id: hid, name: 'To ' + name, polygon: [[452, fy - 6], [572, fy - 6], [572, fy + 34], [452, fy + 34]], walk_to: [512, Math.min(560, y + 20)], exit: { to: id, at: [110, 520] },
          actions: { look: [{ do: [{ say: 'A path to ' + name + '.' }] }] } });
        p.design.rooms = p.design.rooms || {}; p.design.rooms[id] = 'A new place. Describe what\u2019s here.';
      }, { id: id });
    },
    removeRoom: function (project, rid) {
      var g = project.game, r = g.rooms[rid];
      return mutate(project, 'Remove room ' + (r ? r.name : rid), function (p) {
        delete p.game.rooms[rid];
        Object.keys(p.game.rooms).forEach(function (k) { var x = p.game.rooms[k]; x.hotspots = (x.hotspots || []).filter(function (h) { return !(h.exit && h.exit.to === rid); }); });
        if (p.design.rooms) delete p.design.rooms[rid];
      });
    },
    fromPatch: function (project, patch, label) {
      var next = JP.apply(project, patch);
      return { label: label, patch: patch, project: next };
    },
  };
  function q(s) { return '\u201c' + s + '\u201d'; }

  // All spoken lines for a character, with JSON pointers into the project (for the inline line editor).
  E.linesFor = function (project, charId) {
    var g = project.game, out = [], player = g.meta.player.character;
    function take(list, base, ctx) { (list || []).forEach(function (e, i) { if (e.say !== undefined && (e.by || player) === charId) out.push({ ptr: base + '/' + i + '/say', text: e.say, ctx: ctx }); }); }
    (g.meta.intro || []).forEach(function (l, i) { if ((l.by || player) === charId) out.push({ ptr: '/game/meta/intro/' + i + '/say', text: l.say, ctx: 'Opening scene' }); });
    V.walkAll(g, function (r, ctx) { if (ctx.kind === 'dialogue') return; take(r.do, '/game' + ctx.ptr + '/do', V.describeCtx(g, ctx)); });
    Object.keys(g.dialogues).forEach(function (d) { var ns = g.dialogues[d].nodes; Object.keys(ns).forEach(function (n) {
      (ns[n].lines || []).forEach(function (l, i) { if ((l.by || player) === charId) out.push({ ptr: '/game/dialogues/' + d + '/nodes/' + n + '/lines/' + i + '/say', text: l.say, ctx: 'Conversation' }); });
      take(ns[n].do, '/game/dialogues/' + d + '/nodes/' + n + '/do', 'Conversation');
    }); });
    return out;
  };

  // Plain-English summary of a patch (used to preview AI proposals).
  function where(project, path, value, isAdd) {
    var g = project.game, d = project.design, m, parts = JP.parse(path);
    function pz(i) { var p = (i === '-' || (isAdd && parts.length === 3)) ? value : g.puzzles[+i]; return p ? q(p.name) : 'a puzzle'; }
    function hs(r, i) { var room = g.rooms[r]; if (!room) return 'room ' + r; var h = (i === '-' || (isAdd && parts.length === 5)) ? value : room.hotspots[+i]; return (h ? q(h.name) : 'something') + ' in ' + room.name; }
    var VERB = { look: 'Look at', pickup: 'Pick up', use: 'Use', talk: 'Talk to', walk: 'Walk to' };
    function act(rest, owner) {
      if (rest[0] !== 'actions') return owner;
      if (rest[1] === 'use_item') return owner + ': using the ' + (g.items[rest[2]] ? g.items[rest[2]].name : (value && value.name) || rest[2]) + ' on it' + (rest.length > 4 && /say$/.test(path) ? ' (a line)' : '');
      return owner + ': what happens on \u201c' + (VERB[rest[1]] || rest[1]) + '\u201d' + (/say$/.test(path) ? ' (a line)' : '');
    }
    if (parts[0] === 'design') {
      if (parts[1] === 'beats') { var bt = isAdd && parts.length === 3 ? value : d.beats[+parts[2]]; return 'story beat' + (bt && bt.title ? ' ' + q(bt.title) : ''); }
      if (parts[1] === 'puzzles') return 'puzzle notes for ' + parts[2];
      if (parts[1] === 'characters') return (g.characters[parts[2]] ? g.characters[parts[2]].name : parts[2]) + '\u2019s ' + (parts[3] || 'notes');
      if (parts[1] === 'style') return 'art style notes';
      if (parts[1] === 'rooms') return 'description of ' + (g.rooms[parts[2]] ? g.rooms[parts[2]].name : parts[2]);
      return 'design notes';
    }
    if (parts[0] !== 'game') return path;
    var a = parts[1];
    if (a === 'flags') return 'story switch \u201c' + parts[2] + '\u201d';
    if (a === 'items') return 'item ' + q(g.items[parts[2]] ? g.items[parts[2]].name : (value && value.name) || parts[2]);
    if (a === 'puzzles') return parts[3] === 'requires' ? 'what ' + pz(parts[2]) + ' needs first' : 'puzzle ' + pz(parts[2]);
    if (a === 'rooms' && parts[3] === 'hotspots') return parts.length <= 5 ? 'clickable thing ' + hs(parts[2], parts[4]) : act(parts.slice(5), hs(parts[2], parts[4]));
    if (a === 'rooms') return 'room ' + (g.rooms[parts[2]] ? g.rooms[parts[2]].name : parts[2]);
    if (a === 'characters') { var c = g.characters[parts[2]]; return act(parts.slice(3), c ? c.name : parts[2]); }
    if (a === 'dialogues') return 'conversation line';
    if (a === 'meta' && parts[2] === 'intro') return 'opening line';
    if (a === 'win') return 'ending ' + (parts[2] || '');
    if (a === 'style_guide') return 'style guide';
    return parts.slice(1).join(' \u203a ');
  }
  E.describePatch = function (project, patch) {
    var cur = project;
    return patch.map(function (op) {
      var old = JP.get(cur, op.path), w = where(cur, op.path, op.value, op.op === 'add');
      try { cur = JP.apply(cur, [op]); } catch (e) { /* described anyway; the apply step reports the error */ }
      if (op.op === 'replace' && typeof old === 'string') return 'Change ' + w + ': \u201c' + trunc(old) + '\u201d \u2192 \u201c' + trunc(op.value) + '\u201d';
      if (op.op === 'replace') return 'Change ' + w;
      if (op.op === 'add') return 'Add ' + w + (typeof op.value === 'string' ? ': \u201c' + trunc(op.value) + '\u201d' : '');
      if (op.op === 'remove') return 'Remove ' + w;
      if (op.op === 'test') return 'Check ' + w;
      return op.op + ' ' + w;
    });
  };
  function trunc(s) { s = String(s); return s.length > 70 ? s.slice(0, 67) + '\u2026' : s; }
  return E;
});
