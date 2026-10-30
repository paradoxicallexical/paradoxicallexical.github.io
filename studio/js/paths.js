/*
 * Where things live, and the art library.
 *  - STUDIO_ROOT: path from the Studio folder to the site root that holds engine/ and games/.
 *    Dev (repo): '../'   Published folder (dist/): ''   (set by build_dist.js)
 *  - Asset paths inside a game:
 *      'assets/x.png'           relative to the project's game folder (design.base, e.g. games/pickle-heist/)
 *      'games/<id>/assets/x'    from the shared art library (used by games built from a pitch)
 *      'sketch:bg|sprite|portrait[:id]'  pencil "drafting" art for things that have no art yet
 */
(function (root) {
  'use strict';
  var ROOT = root.STUDIO_ROOT !== undefined ? root.STUDIO_ROOT : '../';
  var SAMPLES = [
    { id: 'quokka-walkabout', title: 'Quokka Gone Walkabout', blurb: 'A cheeky quokka has to get home to Rottnest Island.', dir: 'games/quokka-walkabout/', design: 'studio.json', cover: 'games/quokka-walkabout/assets/bg_landfill.jpg', hero: 'games/quokka-walkabout/assets/portrait_quokka.png' },
    { id: 'pickle-heist', title: 'The Great Pickle Heist', blurb: 'Rocco the raccoon detective hunts a stolen pickle trophy.', dir: 'games/pickle-heist/', design: null, cover: 'games/pickle-heist/assets/bg_street.jpg', hero: 'games/pickle-heist/assets/portrait_rocco.png' },
  ];
  var Q = 'games/quokka-walkabout/assets/', P = 'games/pickle-heist/assets/';
  // Art library: real, finished art that new games can reuse when a character or place matches.
  var LIB = {
    characters: {
      quokka: [Q + 'sprite_quokka.png', Q + 'portrait_quokka.png'], ibis: [Q + 'sprite_ibis.png', Q + 'portrait_ibis.png'],
      raven: [Q + 'sprite_raven.png', Q + 'portrait_raven.png'], crow: [Q + 'sprite_raven.png', Q + 'portrait_raven.png'],
      seagull: [Q + 'sprite_seagull.png', Q + 'portrait_seagull.png'], gull: [Q + 'sprite_seagull.png', Q + 'portrait_seagull.png'],
      raccoon: [P + 'sprite_rocco.png', P + 'portrait_rocco.png'], walrus: [P + 'sprite_gus.png', P + 'portrait_gus.png'],
      goose: [P + 'sprite_marge.png', P + 'portrait_marge.png'], parrot: [P + 'sprite_captain.png', P + 'portrait_captain.png'],
    },
    rooms: [
      [/landfill|tip\b|dump|rubbish|junkyard/i, Q + 'bg_landfill.jpg'], [/beach|shore|coast|jetty|cottesloe/i, Q + 'bg_beach.jpg'],
      [/wheat|field|farm|paddock|wheatbelt/i, Q + 'bg_wheat.jpg'], [/mine|quarry|kalgoorlie|super pit/i, Q + 'bg_mine.jpg'],
      [/fremantle|freo|perth|urban|city|street|cbd/i, Q + 'bg_fremantle.jpg'], [/rottnest|rotto|island|home|burrow/i, Q + 'bg_rottnest.jpg'],
      [/diner|cafe|kitchen/i, P + 'bg_diner.jpg'], [/basement|cellar/i, P + 'bg_basement.jpg'], [/main street|town|square/i, P + 'bg_street.jpg'],
    ],
  };
  var SKETCH = { bg: 'assets/sketch/sketch_room.jpg', sprite: 'assets/sketch/sketch_character.png', portrait: 'assets/sketch/sketch_portrait.png' };
  function libCharacter(species) { var k = String(species || '').toLowerCase().trim(); return LIB.characters[k] || LIB.characters[k.replace(/s$/, '')] || LIB.characters[k.replace(/es$/, '')] || null; }
  function libRoom(name) { for (var i = 0; i < LIB.rooms.length; i++) if (LIB.rooms[i][0].test(name || '')) return LIB.rooms[i][1]; return null; }
  function isSketch(p) { return /^sketch:/.test(p || '') || /^placeholder:/.test(p || ''); }
  // studio-folder-relative URL for an asset path
  function resolve(p, project) {
    if (!p) return '';
    var m = /^(?:sketch|placeholder):(bg|sprite|portrait)/.exec(p);
    if (m) return SKETCH[m[1]];
    if (/^(data:|https?:|blob:)/.test(p)) return p;
    if (/^games\//.test(p)) return ROOT + p;
    if (/^assets\//.test(p)) return ROOT + ((project && project.design && project.design.base) || 'games/pickle-heist/') + p;
    return p;
  }
  // every asset path a game uses -> URL (handed to the engine as game.__assets)
  function assetMap(game, project) {
    var map = {};
    JSON.stringify(game, function (k, v) {
      if (typeof v === 'string' && (/^(assets|games)\/.+\.(png|jpe?g|webp|mp3|ogg|wav)$/i.test(v) || isSketch(v))) map[v] = resolve(v, project);
      return v;
    });
    return map;
  }
  // Old drafts used canvas "placeholder:" blobs; give them library art (or a pencil sketch) instead.
  function migrate(project) {
    var g = project.game, d = project.design || {}, changed = false;
    Object.keys(g.rooms || {}).forEach(function (rid) {
      var r = g.rooms[rid];
      if (/^placeholder:/.test(r.background || '')) { r.background = libRoom(r.name) || 'sketch:bg'; changed = true; }
    });
    Object.keys(g.characters || {}).forEach(function (cid) {
      var c = g.characters[cid], meta = (d.characters || {})[cid] || {};
      if (/^placeholder:/.test(c.sprite || '') || /^placeholder:/.test(c.portrait || '')) {
        var lib = libCharacter(meta.species) || libCharacter(cid) || libCharacter((meta.look || '').split(/[\s(]/)[0]);
        c.sprite = lib ? lib[0] : 'sketch:sprite'; c.portrait = lib ? lib[1] : 'sketch:portrait'; changed = true;
      }
    });
    if (g.placeholder_art) { delete g.placeholder_art; changed = true; }
    return changed;
  }
  root.PNCPaths = { ROOT: ROOT, SAMPLES: SAMPLES, LIB: LIB, SKETCH: SKETCH, libCharacter: libCharacter, libRoom: libRoom, isSketch: isSketch, resolve: resolve, assetMap: assetMap, migrate: migrate };
  if (typeof module === 'object' && module.exports) module.exports = root.PNCPaths;
})(typeof self !== 'undefined' ? self : this);
