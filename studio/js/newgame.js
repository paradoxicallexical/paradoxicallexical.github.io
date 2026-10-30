/*
 * "Start a new game from this pitch": builds a small, valid, WINNABLE draft game from the quick-organized pitch.
 * Linear and simple on purpose: one room per place, the hero's helpers stand in rooms, each room's way onward is
 * opened by a small puzzle (use the found item on the first helper, then talk to each helper), and the last room
 * ends the game. Art comes from the art library (paths.js) when a character or place matches, otherwise a pencil
 * "drafting" sketch until the image service paints it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./organizer.js'), require('./paths.js'));
  else root.PNCNewGame = factory(root.PNCOrganizer, root.PNCPaths);
})(typeof self !== 'undefined' ? self : this, function (O, PATHS) {
  'use strict';
  function slug(s, used) {
    var b = String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'x', id = b, n = 2;
    while (used[id]) id = b + '_' + n++;
    used[id] = 1; return id;
  }
  var AFFINITY = { ibis: /landfill|tip|dump|urban|city|street/i, seagull: /beach|jetty|pier|harbou?r|port|fish|island/i, raven: /wheat|field|farm|urban|mine|graveyard/i,
    crow: /wheat|field|farm|graveyard/i, crab: /beach|ship|reef|lighthouse/i, cat: /village|town|street|lighthouse/i, kangaroo: /field|outback|bush|farm/i,
    emu: /field|outback|farm/i, walrus: /diner|kitchen|basement/i, parrot: /street|town|square/i, goose: /street|town|square|park/i };
  var PALETTE = ['#f5d76e', '#ff9b6a', '#8dff7a', '#7ac8ff', '#ff7ae0', '#c9a0ff', '#ffd07a', '#9be0c9'];

  function build(summary, opts) {
    opts = opts || {};
    var P = summary.parsed, lang = summary.language || 'keep', used = {};
    function line(s) { return lang === 'bleep' ? O.bleep(s) : s; }
    var base = opts.baseGame || {};
    var hero = P.hero, heroId = slug(hero.species === 'hero' ? 'hero' : hero.species, used);
    var chars = {}, charMeta = {}, helpers = [];
    var hl = PATHS.libCharacter(hero.species) || PATHS.libCharacter(hero.key);
    chars[heroId] = { name: hero.name, sprite: hl ? hl[0] : 'sketch:sprite', portrait: hl ? hl[1] : 'sketch:portrait', faces: 'right', color: PALETTE[0],
      voice: { notes: 'Hero voice: ' + (hero.descriptors.join(', ') || 'warm, funny') + ' ' + hero.species, pitch: 1.0, rate: 1.0 },
      idle: { breathe: 0.016, period: 3.2, actions: [{ type: 'look', every: [6, 12], dur: 1.6 }] } };
    charMeta[heroId] = { role: 'The hero', personality: (hero.descriptors.join(', ') || 'determined') + (P.tone.length ? '; ' + P.tone.slice(0, 2).join(', ').toLowerCase() : ''), look: hero.look || hero.species, species: hero.species };
    P.characters.slice(0, 6).forEach(function (c, i) {
      var id = slug(c.alias || c.species, used);
      var cl = PATHS.libCharacter(c.species) || PATHS.libCharacter(c.key);
      chars[id] = { name: c.name, sprite: cl ? cl[0] : 'sketch:sprite', portrait: cl ? cl[1] : 'sketch:portrait', faces: 'left', color: PALETTE[(i + 1) % PALETTE.length],
        voice: { notes: line((c.descriptors.join(', ') || 'distinct') + ' ' + c.species + (c.catchphrase ? ', always says \u201c' + c.catchphrase + '\u201d' : '')), pitch: 0.6 + (i % 4) * 0.35, rate: 1.0 + (i % 3) * 0.1 },
        idle: { breathe: 0.02, period: 2.6 + i * 0.3, actions: /raven|crow|gull|ibis|parrot|goose|bird|magpie|emu|chicken/.test(c.species) ? [{ type: 'ruffle', every: [3, 7], dur: 0.9 }, { type: 'hop', every: [4, 9], dur: 0.8 }, { type: 'flap', every: [6, 12], dur: 1.0 }] : [{ type: 'look', every: [4, 9], dur: 1.8 }, { type: 'shift', every: [5, 10], dur: 1.6 }] } };
      charMeta[id] = { role: c.role ? cap(c.role) : 'Local ' + c.species, personality: [c.descriptors.join(', '), c.note].filter(Boolean).join('; ') || 'tbd', look: c.species + (c.plural ? ' (a group)' : ''), species: c.species, catchphrase: line(c.catchphrase || '') };
      helpers.push({ id: id, c: c });
    });
    // rooms: start + up to 4 middle + home/finale
    var places = P.places.slice();
    var startP = places.filter(function (p) { return p.tag === 'start'; })[0] || places[0] || { name: 'Starting Point', said: 'start' };
    var homeP = places.filter(function (p) { return p.tag === 'home'; })[0] || null;
    var mids = places.filter(function (p) { return p !== startP && p !== homeP; }).slice(0, 4);
    if (!homeP) homeP = { name: P.stolen ? 'The Big Finale' : 'The Finale', said: 'finale', tag: 'home' };
    var plist = [startP].concat(mids, [homeP]);
    var roomIds = plist.map(function (p) { return slug(p.name, used); });
    // place helpers: best affinity, otherwise spread over start + middle rooms
    var slots = roomIds.slice(0, -1), occupant = {};
    helpers.forEach(function (h) {
      var re = AFFINITY[h.c.species], pick = null;
      if (re) slots.forEach(function (rid, i) { if (!pick && !occupant[rid] && re.test(plist[i].name)) pick = rid; });
      if (!pick) pick = slots.filter(function (rid) { return !occupant[rid]; })[0] || slots[helpers.indexOf(h) % slots.length];
      occupant[pick] = occupant[pick] || []; if (!Array.isArray(occupant[pick])) occupant[pick] = [occupant[pick]];
      occupant[pick].push(h); h.room = pick;
    });
    var item = (P.items[0] || 'snack').replace(/^giant |^golden /, '');
    var itemId = slug(item, used);
    var flags = {}, puzzles = [], designPuzzles = {}, rooms = {};
    var W = [[0, 392], [1024, 392], [1024, 576], [0, 576]], depth = { far_y: 392, far_scale: 0.5, near_y: 576, near_scale: 0.78 };
    var tracks = Object.keys(base.music || {});
    var music = base.music || { theme: { tempo: 110, root: 261.6, mode: 'major', style: 'bounce', seed: 3 } };
    if (!tracks.length) tracks = ['theme'];
    flags.got_item = false;
    puzzles.push({ id: 'find_item', name: 'Find the ' + item, requires: [], solved_when: { flags: { got_item: true } } });
    designPuzzles.find_item = { description: 'Pick up the ' + item + ' in the ' + plist[0].name + '.', blocked_story: 'the hero has nothing to bargain with' };
    var prevPuzzle = 'find_item';
    plist.forEach(function (p, i) {
      var rid = roomIds[i], last = i === plist.length - 1, hs = [], here = (occupant[rid] || []);
      var openFlag = 'way_' + i + '_open';
      if (i > 0) hs.push({ id: 'back', name: 'Back to ' + plist[i - 1].name, polygon: [[0, 300], [70, 300], [70, 576], [0, 576]], walk_to: [40, 520], exit: { to: roomIds[i - 1], at: [930, 520] },
        actions: { look: [{ do: [{ say: 'Back the way I came: ' + plist[i - 1].name + '.' }] }] } });
      hs.push({ id: 'scenery', name: p.name, polygon: [[200, 40], [820, 40], [820, 330], [200, 330]], walk_to: [512, 470],
        actions: { look: [{ do: [{ say: line(lookLine(p, P, hero)) }] }] } });
      if (i === 0) hs.push({ id: 'item_' + itemId, name: cap(item), polygon: [[300, 430], [440, 430], [440, 520], [300, 520]], walk_to: [370, 540], if: { flags: { got_item: false } },
        actions: { look: [{ do: [{ say: 'Some ' + item + '. Could come in handy.' }] }], pickup: [{ do: [{ give: itemId }, { set: { got_item: true } }, { sfx: 'pickup' }, { say: 'Into the pocket it goes.' }] }] } });
      var actors = [];
      if (!last) {
        flags[openFlag] = false;
        var gateHelper = here[0];
        var pid = 'open_' + i, pname, need;
        if (gateHelper) {
          var ch = chars[gateHelper.id], cp = gateHelper.c.catchphrase;
          var talkRules = [{ if: { flags: (function () { var f = {}; f[openFlag] = true; return f; })() }, do: [{ by: gateHelper.id, say: line(cp ? cap(cp) + '!' : 'Off you go then.') }] }];
          if (i === 0) {
            talkRules.push({ do: [{ by: gateHelper.id, say: line(cp ? cap(cp) + '!' : 'What do you want?') }, { say: 'I think they want something. Something tasty.' }] });
            ch.actions = { talk: talkRules, look: [{ do: [{ say: lookChar(gateHelper.c, line) }] }], use_item: {} };
            ch.actions.use_item[itemId] = [{ do: [{ take: itemId }, { set: (function () { var f = {}; f[openFlag] = true; return f; })() }, { sfx: 'pickup' }, { by: gateHelper.id, say: line(cp ? cap(cp) + '! ...Fair trade.' : 'Fair trade.') }, { say: 'They point the way out.' }] }];
            pname = 'Trade the ' + item + ' with ' + ch.name; need = [prevPuzzle];
          } else {
            talkRules.push({ do: [{ by: gateHelper.id, say: line(cp ? cap(cp) + '!' : 'G\u2019day.') }, { by: gateHelper.id, say: 'Head that way, past the ' + plist[i + 1].name.toLowerCase() + '.' }, { set: (function () { var f = {}; f[openFlag] = true; return f; })() }] });
            ch.actions = { talk: talkRules, look: [{ do: [{ say: lookChar(gateHelper.c, line) }] }] };
            pname = 'Win over ' + ch.name.replace(/^The /, 'the '); need = [prevPuzzle];
          }
          here.forEach(function (h, k) { actors.push({ character: h.id, at: [600 + k * 150, 500 - k * 30] }); });
          designPuzzles[pid] = { description: pname + ' to find the way to ' + plist[i + 1].name + '.', blocked_story: 'the hero is stuck in the ' + p.name.toLowerCase() };
        } else {
          hs.push({ id: 'obstacle', name: 'Way onward', polygon: [[760, 360], [900, 360], [900, 470], [760, 470]], walk_to: [830, 500], if: { flags: (function () { var f = {}; f[openFlag] = false; return f; })() },
            actions: { look: [{ do: [{ say: 'Something\u2019s in the way. Maybe I can shove it.' }] }], use: [{ do: [{ set: (function () { var f = {}; f[openFlag] = true; return f; })() }, { sfx: 'door' }, { say: 'Hnnngh! ...It moved.' }] }], pickup: [{ do: [{ say: 'Too heavy to carry. Maybe I can just USE it.' }] }] } });
          pname = 'Clear the way out of the ' + p.name; need = prevPuzzle === 'find_item' ? [] : [prevPuzzle];
          designPuzzles[pid] = { description: 'Shove the obstacle aside in the ' + p.name + '.', blocked_story: 'the hero is stuck in the ' + p.name.toLowerCase() };
        }
        puzzles.push({ id: pid, name: pname, requires: need, solved_when: { flags: (function () { var f = {}; f[openFlag] = true; return f; })() } });
        prevPuzzle = pid;
        var gate = {}; gate[openFlag] = true;
        hs.push({ id: 'onward', name: 'To ' + plist[i + 1].name, polygon: [[954, 300], [1024, 300], [1024, 576], [954, 576]], walk_to: [985, 520],
          exit: { to: roomIds[i + 1], at: [90, 520], if: { flags: gate }, else: [{ do: [{ say: i === 0 && gateHelper ? 'Can\u2019t get past. Maybe someone around here can help.' : 'Can\u2019t get through yet.' }] }] },
          actions: { look: [{ do: [{ say: 'The way to ' + plist[i + 1].name + '.' }] }] } });
      } else {
        flags.made_it = false;
        hs.push({ id: 'goal', name: P.hero && /home/i.test(P.goal) ? 'Home sweet home' : 'The goal', polygon: [[420, 250], [620, 250], [620, 470], [420, 470]], walk_to: [520, 500],
          actions: { look: [{ do: [{ say: /home/i.test(P.goal) ? 'Home. Finally.' : 'This is it.' }] }], use: [{ do: [{ set: { made_it: true } }, { sfx: 'fanfare' }, { say: 'Made it!' }] }], pickup: [{ do: [{ set: { made_it: true } }, { sfx: 'fanfare' }, { say: 'Made it!' }] }] } });
        puzzles.push({ id: 'finish', name: cap(P.goal.replace(/\b(his|her|their)\b/g, 'your')), requires: [prevPuzzle], solved_when: { flags: { made_it: true } } });
        designPuzzles.finish = { description: 'Reach ' + p.name + ' and finish the story.', blocked_story: 'the story never ends' };
      }
      rooms[rid] = { name: p.name, background: PATHS.libRoom(p.name + ' ' + (p.said || '')) || 'sketch:bg', walkable: W, depth: depth, music: [{ track: tracks[i % tracks.length] }], actors: actors, hotspots: hs };
    });
    var items = {}; items[itemId] = { name: item, icon: itemEmoji(item), look: 'Some ' + item + '.' };
    var g = {
      schema_version: '0.1',
      meta: { id: 'draft-' + slug(summary.title, {}), title: summary.title, subtitle: 'A draft from your pitch', resolution: [1024, 576], start_room: roomIds[0],
        player: { character: heroId, at: [180, 520] }, intro: (summary.intro || []).map(function (l) { return { by: heroId, say: line(l.say) }; }) },
      style_guide: opts.styleGuide || { prompt: '' },
      verbs: base.verbs || { order: ['walk', 'look', 'pickup', 'use', 'talk'], labels: { walk: 'Walk to', look: 'Look at', pickup: 'Pick up', use: 'Use', talk: 'Talk to' }, defaults: { look: 'Nothing special.', pickup: 'I can\u2019t pick that up.', use: 'That doesn\u2019t do anything.', talk: 'No answer.', use_item: 'That won\u2019t work.' } },
      flags: flags, items: items, characters: chars, music: music, rooms: rooms, dialogues: {}, puzzles: puzzles,
      win: { if: { flags: { made_it: true } }, title: /home/i.test(P.goal) ? 'MADE IT HOME' : 'THE END', text: summary.logline },
    };
    var beats = [];
    if (P.inciting) beats.push({ id: 'b1', title: 'It begins', text: cap(P.inciting) + '.' });
    plist.forEach(function (p, i) { var hh = (occupant[roomIds[i]] || []).map(function (h) { return chars[h.id].name; }); beats.push({ id: 'r' + i, title: p.name, text: i === plist.length - 1 ? 'The finale: ' + P.goal + '.' : 'The hero passes through the ' + p.name.toLowerCase() + (hh.length ? ', where ' + hh.join(' and ') + ' must be won over' : '') + '.' }); });
    var dRooms = {}; plist.forEach(function (p, i) { dRooms[roomIds[i]] = lookLine(p, P, hero); });
    var design = { pitch: opts.pitch || '', summary: summary, style: { selected: (P.art && P.art.style) || 'lucasarts', notes: (P.art && P.art.era.length ? P.art.era.join(' ') + ' throwback. ' : '') }, characters: charMeta, beats: beats, rooms: dRooms, puzzles: designPuzzles };
    return { version: 1, design: design, game: g };
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function lookLine(p, P, hero) {
    var n = p.name.toLowerCase();
    if (/landfill|tip|dump/.test(n)) return 'Mountains of rubbish as far as the eye can see. Smells like breakfast, honestly.';
    if (/beach/.test(n)) return 'Sand, sun and seagulls eyeing my snacks.';
    if (/wheat/.test(n)) return 'Wheat. So much wheat. It\u2019s like a golden ocean that makes me sneeze.';
    if (/mine/.test(n)) return 'A giant hole full of red dirt and grumpy machinery.';
    if (/urban|city|street/.test(n)) return 'Traffic, coffee carts and pigeons with attitude.';
    if (p.tag === 'home') return 'Home. ' + (P.goal ? 'This is where it all ends.' : '');
    return 'The ' + p.name + '. Placeholder art for now.';
  }
  function lookChar(c, line) { line = line || function (x) { return x; }; return line(lookChar0(c)); }
  function lookChar0(c) { return 'A ' + (c.descriptors.join(' ') + ' ' + c.species).trim() + (c.plural ? ' gang' : '') + (c.catchphrase ? ' that only ever says \u201c' + c.catchphrase + '\u201d.' : '.'); }
  function itemEmoji(n) { return /scrap|food|chip|pie|bread|sandwich|snack|sausage/.test(n) ? '🍟' : /key/.test(n) ? '🗝️' : /trophy/.test(n) ? '🏆' : /diary|letter|map/.test(n) ? '📜' : /lantern|torch|flashlight/.test(n) ? '🔦' : /coin|quarter|gold/.test(n) ? '🪙' : '📦'; }
  return { build: build };
});
