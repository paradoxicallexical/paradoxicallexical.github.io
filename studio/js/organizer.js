/*
 * Quick organizer (no AI): turns a messy pitch into a structured summary IN THE BROWSER, with simple,
 * explainable heuristics (sentence splitting, keyword lists, a few phrase patterns, typo fixes).
 * It never invents a story; anything it suggests (title, hero name, puzzle ideas, open places) is labelled
 * "suggested". With an AI key the co-writer does a full rewrite instead.
 *   PNCOrganizer.organize(text) -> summary  (see bottom for the shape)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PNCOrganizer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- lexicons
  var TYPOS = [
    [/\bsea[ -]?goals\b/gi, 'seagulls'], [/\bsea[ -]?goal\b/gi, 'seagull'], [/\bsea gulls\b/gi, 'seagulls'], [/\bsea gull\b/gi, 'seagull'],
    [/\bseagul\b/gi, 'seagull'], [/\bseaguls\b/gi, 'seagulls'], [/\brubish\b/gi, 'rubbish'], [/\bracoons?\b/gi, function (m) { return /s$/i.test(m) ? 'raccoons' : 'raccoon'; }],
    [/\bkangeroos?\b/gi, 'kangaroo'], [/\bquoka\b/gi, 'quokka'], [/\bquokkka\b/gi, 'quokka'], [/\bpengiun\b/gi, 'penguin'], [/\bwheet\b/gi, 'wheat'],
    [/\bdetectve\b/gi, 'detective'], [/\bwallrus\b/gi, 'walrus'], [/\bparot\b/gi, 'parrot'], [/\bcrocodil\b/gi, 'crocodile'], [/\bpelicon\b/gi, 'pelican'],
    [/\bseperate\b/gi, 'separate'], [/\bwierd\b/gi, 'weird'], [/\bghosts?t\b/gi, 'ghost'], [/\bligthouse\b/gi, 'lighthouse'], [/\bgraveyeard\b/gi, 'graveyard'],
  ];
  // creature -> [label, emoji, colour]; keys are singular, lower-case. Slang maps to a species.
  var CREATURES = {
    quokka: ['quokka', '🐹', '#c8955a'], raccoon: ['raccoon', '🦝', '#9a9aa6'], walrus: ['walrus', '🦭', '#a77b5e'], parrot: ['parrot', '🦜', '#4fbf4f'],
    goose: ['goose', '🪿', '#eeeeee'], raven: ['raven', '🐦‍⬛', '#33334a'], crow: ['crow', '🐦‍⬛', '#33334a'], seagull: ['seagull', '🕊️', '#e8e8f0'],
    gull: ['seagull', '🕊️', '#e8e8f0'], ibis: ['ibis', '🦩', '#f0f0f0'], 'bin chicken': ['ibis', '🦩', '#f0f0f0'], kangaroo: ['kangaroo', '🦘', '#c8814f'],
    roo: ['kangaroo', '🦘', '#c8814f'], wombat: ['wombat', '🐻', '#8a6b4f'], koala: ['koala', '🐨', '#9a9aa6'], emu: ['emu', '🐦', '#7a6650'],
    possum: ['possum', '🐭', '#8d8d99'], cockatoo: ['cockatoo', '🦜', '#f5f5dc'], cocky: ['cockatoo', '🦜', '#f5f5dc'], galah: ['galah', '🦜', '#f2a0b8'],
    magpie: ['magpie', '🐦', '#222'], maggie: ['magpie', '🐦', '#222'], kookaburra: ['kookaburra', '🐦', '#a6835a'], crocodile: ['crocodile', '🐊', '#4f7f3f'],
    croc: ['crocodile', '🐊', '#4f7f3f'], dingo: ['dingo', '🐕', '#d9a05b'], platypus: ['platypus', '🦫', '#7a5a3a'], echidna: ['echidna', '🦔', '#6b5444'],
    pelican: ['pelican', '🐦', '#f0f0f0'], shark: ['shark', '🦈', '#7f93a8'], dolphin: ['dolphin', '🐬', '#7fb0d8'], crab: ['crab', '🦀', '#e0503a'],
    octopus: ['octopus', '🐙', '#d06090'], cat: ['cat', '🐈', '#e0a050'], dog: ['dog', '🐕', '#c08850'], rat: ['rat', '🐀', '#888'], mouse: ['mouse', '🐁', '#aaa'],
    fox: ['fox', '🦊', '#e07030'], owl: ['owl', '🦉', '#8a6b4f'], pigeon: ['pigeon', '🐦', '#9090a0'], penguin: ['penguin', '🐧', '#222'],
    frog: ['frog', '🐸', '#5fbf4f'], snake: ['snake', '🐍', '#5f9f3f'], lizard: ['lizard', '🦎', '#7fbf4f'], goanna: ['goanna', '🦎', '#8f8f4f'],
    bear: ['bear', '🐻', '#7a5030'], pig: ['pig', '🐖', '#f0a0b0'], cow: ['cow', '🐄', '#eee'], sheep: ['sheep', '🐑', '#eee'], horse: ['horse', '🐎', '#8a5a3a'],
    duck: ['duck', '🦆', '#e0c040'], chicken: ['chicken', '🐔', '#eee'], chook: ['chicken', '🐔', '#eee'], weasel: ['weasel', '🦡', '#a0703a'],
    badger: ['badger', '🦡', '#777'], moose: ['moose', '🫎', '#6a4a2a'], monkey: ['monkey', '🐒', '#9a6a3a'], goat: ['goat', '🐐', '#ddd'], bat: ['bat', '🦇', '#443'],
    snail: ['snail', '🐌', '#c0a070'], squirrel: ['squirrel', '🐿️', '#c07040'], tortoise: ['tortoise', '🐢', '#6a8a4a'], turtle: ['turtle', '🐢', '#6a8a4a'],
    camel: ['camel', '🐪', '#d0a060'], fly: ['fly', '🪰', '#333'], cockroach: ['cockroach', '🪳', '#6a3a1a'], spider: ['spider', '🕷️', '#333'], whale: ['whale', '🐋', '#5a7a9a'],
  };
  var ROLES = ['detective', 'cook', 'chef', 'mayor', 'pirate', 'wizard', 'witch', 'ghost', 'robot', 'alien', 'knight', 'princess', 'king', 'queen', 'cop', 'sheriff',
    'farmer', 'miner', 'teacher', 'scientist', 'lighthouse keeper', 'captain', 'bartender', 'barman', 'waiter', 'janitor', 'nurse', 'doctor', 'cowboy', 'ninja',
    'vampire', 'zombie', 'granny', 'grandma', 'grandpa', 'sailor', 'fisherman', 'bus driver', 'tradie', 'surfer', 'bogan', 'ranger', 'shopkeeper', 'janitor'];
  var PLACES = ['landfill', 'tip', 'dump', 'beach', 'wheat fields', 'wheat field', 'wheatbelt', 'gold mine site', 'gold mine', 'mine site', 'mine', 'urban', 'city', 'town square',
    'town', 'diner', 'basement', 'outside', 'main street', 'street', 'forest', 'bush', 'outback', 'desert', 'island', 'ocean', 'harbour', 'harbor', 'port', 'jetty', 'pier',
    'farm', 'school', 'castle', 'cave', 'space station', 'spaceship', 'ship', 'shipwreck', 'swamp', 'jungle', 'mansion', 'office', 'museum', 'pub', 'bar', 'servo',
    'petrol station', 'gas station', 'airport', 'train station', 'highway', 'river', 'lake', 'mountain', 'suburb', 'suburbs', 'lighthouse', 'fishing village', 'village',
    'cannery', 'graveyard', 'cemetery', 'church', 'hospital', 'library', 'kitchen', 'attic', 'sewer', 'zoo', 'circus', 'carnival', 'market', 'markets', 'mall', 'park',
    'car park', 'caravan park', 'roadhouse', 'shearing shed', 'billabong', 'reef'];
  var ITEMS = ['key', 'coin', 'quarter', 'trophy', 'flashlight', 'torch', 'crackers', 'saltines', 'map', 'sandwich', 'scraps', 'hot chips', 'chips', 'sausage roll', 'meat pie',
    'pie', 'vegemite', 'rope', 'ticket', 'phone', 'hat', 'eyepatch', 'diary', 'lantern', 'badge', 'bottle', 'can', 'thong', 'thongs', 'esky', 'shovel', 'pickaxe',
    'gold nugget', 'nugget', 'bread', 'cheese', 'fish', 'bait', 'net', 'ladder', 'crowbar', 'compass', 'letter', 'photo', 'camera', 'umbrella', 'surfboard', 'bucket',
    'feather', 'bone', 'sausage', 'snag', 'ferry ticket', 'boat', 'raft'];
  var ADJ = ['fat', 'little', 'tiny', 'big', 'giant', 'grumpy', 'dramatic', 'pirate', 'rude', 'lazy', 'sneaky', 'evil', 'friendly', 'shy', 'crude', 'loud', 'drunk',
    'posh', 'old', 'young', 'cranky', 'sleepy', 'hungry', 'greedy', 'cheeky', 'smelly', 'angry', 'nervous', 'clumsy', 'bossy', 'cocky', 'deadpan', 'goofy', 'spooky', 'mysterious', 'secret', 'chubby', 'scruffy'];
  var STYLE_RULES = [
    ['sierra_pixel', /\b(pixel(?:ated)?(?: art)?|8[- ]?bit|16[- ]?bit|ega|vga|sierra|low[- ]?res|sprite art)\b/gi],
    ['lucasarts', /\b(hand[- ]painted|painted|lucasarts|cartoon(?:y)?|90s cartoon)\b/gi],
    ['claymation', /\b(clay(?:mation)?|plasticine|stop[- ]motion)\b/gi],
    ['noir_ink', /\b(noir|ink(?:ed)?|black and white|graphic novel)\b/gi],
    ['watercolou?r', /\b(watercolou?r|storybook|picture book|pastel)\b/gi],
    ['modern_handdrawn', /\b(modern|clean lines?|hand[- ]?drawn|cel[- ]shad\w*|vector)\b/gi],
  ];
  var ERA = /\b(90s|nineties|'90s|1990s|80s|eighties|retro|throwback|old[- ]school|classic)\b/gi;
  var REFERENCES = [[/\bsam\s*(?:and|&|n|'n')\s*max\b(?:\s*hit the road)?/i, 'Sam & Max Hit the Road'], [/\bmonkey island\b/i, 'Monkey Island'],
    [/\bday of the tentacle\b/i, 'Day of the Tentacle'], [/\bmaniac mansion\b/i, 'Maniac Mansion'], [/\bking'?s quest\b/i, "King's Quest"], [/\bspace quest\b/i, 'Space Quest'],
    [/\bscooby[- ]?doo\b/i, 'Scooby-Doo'], [/\bzork\b/i, 'Zork'], [/\bgrim fandango\b/i, 'Grim Fandango'], [/\bbroken sword\b/i, 'Broken Sword'],
    [/\bthimbleweed\b/i, 'Thimbleweed Park'], [/\bfull throttle\b/i, 'Full Throttle'], [/\bleisure suit larry\b/i, 'Leisure Suit Larry'], [/\bdiscworld\b/i, 'Discworld'],
    [/\bbluey\b/i, 'Bluey'], [/\bkath (?:and|&) kim\b/i, 'Kath & Kim'], [/\bcrocodile dundee\b/i, 'Crocodile Dundee']];
  var TONES = [[/\b(funny|goofy|comedy|comedic|lol|lmao|silly|hilarious|humou?r|jokes?)\b/i, 'Comedy'], [/\b(aussie|australian|straya|ocker)\b/i, 'Very Aussie'],
    [/\bcrude\b/i, 'A little crude'], [/\bmostly pg\b|\bpg\b/i, 'Mostly PG'], [/\b(for kids|kids-?ish|family)\b/i, 'Family-friendly'], [/\b(spooky|haunted|creepy)\b/i, 'Spooky'],
    [/\bnot too scary\b/i, 'Not too scary'], [/\bbittersweet\b/i, 'Bittersweet'], [/\bnoir\b/i, 'Noir'], [/\b(cozy|cosy|wholesome)\b/i, 'Cozy'], [/\b(dark|grim)\b/i, 'Dark'],
    [/\b(mystery|whodunn?it|murder)\b/i, 'Mystery'], [/\b(throwback|retro|90s vibes?|nineties vibes?)\b/i, '90s throwback']];
  var SWEARS = [/\bc+u+n+t+s?\b/gi, /\bf+u+c+k+\w*/gi, /\bs+h+i+t+\w*/gi, /\bbastards?\b/gi, /\bbitch\w*/gi, /\bdickheads?\b/gi, /\bwankers?\b/gi, /\bpricks?\b/gi];
  var MILD = [/\bbloody\b/gi, /\bbugger\b/gi, /\bdamn\b/gi, /\bcrap\b/gi, /\barse\b/gi];
  var ING = { solving: 'solve', finding: 'find', getting: 'get', escaping: 'escape', saving: 'save', rescuing: 'rescue', stopping: 'stop', catching: 'catch', making: 'make', winning: 'win', returning: 'return', proving: 'prove', recovering: 'recover', reaching: 'reach' };
  var KNOWN_PLACES = { 'rottnest island': 'Rottnest Island', rottnest: 'Rottnest Island', rotto: 'Rottnest Island', 'western australia': 'Western Australia', perth: 'Perth', fremantle: 'Fremantle', freo: 'Fremantle', 'the pinnacles': 'the Pinnacles', maine: 'Maine' };
  var AUSSIE_NAMES = ['Kev', 'Bazza', 'Davo', 'Shazza', 'Robbo', 'Gazza', 'Muzza', 'Tezza'];
  var NAMES = { a: 'Alfie', b: 'Bert', c: 'Clem', d: 'Doug', e: 'Eddie', f: 'Fitz', g: 'Gil', h: 'Hank', i: 'Iggy', j: 'Jojo', k: 'Kip', l: 'Lou', m: 'Moe', n: 'Ned', o: 'Ollie', p: 'Pip', q: 'Quincy', r: 'Rusty', s: 'Sid', t: 'Tito', u: 'Ugo', v: 'Vic', w: 'Wally', x: 'Xan', y: 'Yuri', z: 'Ziggy' };

  // ---------------------------------------------------------------- helpers
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function title(s) { return String(s).replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); }).replace(/\b(Of|The|And|A|An|In|On|At|To)\b(?!$)/g, function (m, w, i) { return i === 0 ? m : m.toLowerCase(); }); }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '').trim(); }
  function stripFiller(s) { return clean(String(s).replace(/\((?:[^)]*)\)/g, '').replace(/\b(maybe|idk|lol|lmao|i guess|kinda|sorta|like|or something|probably|obviously|tho|though)\b/gi, '').replace(/[?!]+/g, '').replace(/\.{2,}|…/g, '')); }
  function sentences(t) { return t.replace(/([.!?…]+)\s+/g, '$1\n').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function fixApos(s) { return String(s).replace(/\b(she|he|there|it|that|what)s\b(?=\s+(?:a|an|the|stuck|gonna|going|not|so|got|really|just|in|on|at|been|secretly|very|all)\b)/gi, "$1's").replace(/\b(can|don|won|isn|wasn|didn|doesn|couldn|shouldn|wouldn|aren)t\b/gi, "$1't").replace(/\bim\b/g, "I'm").replace(/\bive\b/g, "I've"); }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function snippet(raw, needle, n) {
    n = n || 70; var i = raw.toLowerCase().indexOf(String(needle).toLowerCase());
    if (i < 0) return null;
    var a = Math.max(0, i - 12), b = Math.min(raw.length, i + needle.length + 30);
    if (b - a > n) b = a + n;
    var s = raw.slice(a, b).replace(/\s+/g, ' ').trim();
    return (a > 0 ? '…' : '') + s + (b < raw.length ? '…' : '');
  }
  function firstPerson(s) { return s.replace(/\bhis\b/gi, 'my').replace(/\bher\b/gi, 'my').replace(/\btheir\b/gi, 'my').replace(/\bhimself\b|\bherself\b|\bthemselves\b/gi, 'myself').replace(/\bhe\b|\bshe\b|\bthey\b/gi, 'I'); }
  function creatureRegex() {
    var keys = Object.keys(CREATURES).sort(function (a, b) { return b.length - a.length; });
    return new RegExp('\\b(' + keys.map(esc).join('|') + ')(s|es)?\\b', 'gi');
  }
  var CRE = creatureRegex();
  function findCreatures(text) {
    var out = [], m; CRE.lastIndex = 0;
    while ((m = CRE.exec(text))) {
      var key = m[1].toLowerCase(), plural = !!m[2] || /^(sheep|fish)$/.test(key);
      if (key === 'fly' && !/\bfl(y|ies)\b/i.test(m[0])) continue;
      if (key === 'bat' && /\bbat(s)?\b/i.test(m[0]) && /\bcricket bat\b/i.test(text.slice(Math.max(0, m.index - 8), m.index + 4))) continue;
      out.push({ key: key, species: CREATURES[key][0], word: m[0], index: m.index, plural: plural });
    }
    return out;
  }
  function wordsBefore(text, idx, n) { return text.slice(Math.max(0, idx - 60), idx).split(/[^A-Za-z'-]+/).filter(Boolean).slice(-n); }
  function adjsBefore(text, idx) { return wordsBefore(text, idx, 3).filter(function (w) { return ADJ.indexOf(w.toLowerCase()) >= 0; }).map(function (w) { return w.toLowerCase(); }); }
  function bleep(s) { return String(s).replace(/\b([A-Za-z])([A-Za-z]{2,})([A-Za-z])\b/g, function (m, a, mid, z) { return SWEARS.some(function (r) { r.lastIndex = 0; return r.test(m); }) ? a + mid.replace(/./g, '*') + z : m; }); }
  function swearIn(s) { return SWEARS.some(function (r) { r.lastIndex = 0; return r.test(s); }); }

  // ---------------------------------------------------------------- main
  function organize(raw) {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('The pitch is empty. Type or paste your idea first.');
    var corrections = [], text = raw;
    TYPOS.forEach(function (t) {
      text = text.replace(t[0], function (m) { var to = typeof t[1] === 'function' ? t[1](m) : t[1]; if (m.toLowerCase() !== to.toLowerCase()) corrections.push({ from: m, to: to }); return to; });
    });
    var low = text.toLowerCase(), sents = sentences(text);
    // hide references (e.g. "monkey island") and glosses ("bin chickens (ibis)") from the creature scan
    var scan = text;
    REFERENCES.forEach(function (r) { scan = scan.replace(new RegExp(r[0].source, 'gi'), function (m) { return m.replace(/[A-Za-z]/g, '_'); }); });
    scan = scan.replace(/\(([^)]*)\)/g, function (m, inner) { return CREATURES[inner.toLowerCase().trim()] ? m.replace(/[A-Za-z]/g, '_') : m; });
    var creatures = findCreatures(scan);

    // ---- hero
    var hero = { species: null, key: null, descriptors: [], origin: null, name: null, nameSuggested: false, look: '', phrase: '' };
    var heroPats = [/\b(?:my guy|my character|my hero|the hero|main character|protagonist)\s+(?:is|=)\s+(?:a|an|the)?\s*([^.;!?]+)/i, /\b(?:you play as|play as|you are|you're)\s+(?:a|an|the)?\s*([^.;!?]+)/i,
      /\babout (?:a|an|this|the) ([^.;!?]+)/i, /\b(?:there'?s|theres) (?:a|an|this) ([^.;!?]+)/i];
    var hm = null, hIdx = -1;
    for (var i = 0; i < heroPats.length && !hm; i++) { var mm = heroPats[i].exec(text); if (mm) { var cs = findCreatures(mm[1]); var rl = roleIn(mm[1]); if (cs.length || rl) { hm = mm; hIdx = mm.index + mm[0].indexOf(mm[1]); } } }
    var heroCre = null;
    if (hm) {
      var cs2 = findCreatures(hm[1]);
      if (cs2.length) { heroCre = cs2[0]; heroCre.index += hIdx; }
      else { var r0 = roleIn(hm[1]); hero.species = r0; hero.key = r0; hero.role = r0; }
      hero.phrase = clean(hm[1].split(/\bwho\b|\bthat\b/i)[0]);
    } else if (creatures.length) heroCre = creatures[0];
    else { var r1 = roleIn(text); if (r1) { hero.species = r1; hero.key = r1; hero.role = r1; hIdx = text.toLowerCase().indexOf(r1); } }
    if (heroCre) { hero.species = heroCre.species; hero.key = heroCre.key; hero.descriptors = adjsBefore(text, heroCre.index); hIdx = heroCre.index; }
    if (!hero.species) { hero.species = 'hero'; hero.key = 'hero'; }
    var heroRole = roleIn(hero.phrase || ''); if (heroRole && heroRole !== hero.species) hero.role = heroRole;
    var afterHero = hIdx >= 0 ? text.slice(hIdx, hIdx + 160) : '';
    var om = /\bfrom ((?:the )?[A-Za-z][\w'-]*(?: [A-Za-z][\w'-]*){0,2}?)(?= who\b| that\b| and\b|[,.;!?)]|$)/i.exec(afterHero);
    if (om) hero.origin = KNOWN_PLACES[om[1].toLowerCase()] || title(om[1]);
    var lm = /\b(?:in|wearing|with) (?:a|an) ([a-z ]{3,30}?(?:coat|hat|eyepatch|jacket|scarf|apron|glasses|sunglasses|boots|cape|thongs|singlet))\b/i.exec(afterHero);
    hero.look = clean([hero.descriptors.join(' '), hero.species, lm ? 'in a ' + lm[1] : ''].join(' '));
    var nwin = text.slice(Math.max(0, hIdx - 10), hIdx + 140);
    var nm = /\b(?:named|called|name(?:'s| is)?|his name is|her name is)\s+([A-Za-z][a-z'-]+)/i.exec(nwin);
    if (nm && !/^(maybe|something|idk|the|a|is|of)$/i.test(nm[1])) {
      hero.name = cap(nm[1].toLowerCase());
      var nm2 = new RegExp(esc(nm[1]) + '\\s+([A-Z][a-z\'-]+)').exec(nwin.slice(nm.index));
      if (nm2 && !/^(And|Maybe|The|But|Or)$/.test(nm2[1]) && /^[A-Z]/.test(nm[1])) hero.name += ' ' + nm2[1];
    }
    // "robot janitor", "goofy detective game": a role right after the species, or "<role> game"
    var nextW = hIdx >= 0 ? /^[A-Za-z]+\s+([a-z]+(?: keeper)?)/i.exec(text.slice(hIdx)) : null;
    if (nextW && ROLES.indexOf(nextW[1].toLowerCase()) >= 0 && nextW[1].toLowerCase() !== hero.species) hero.role = nextW[1].toLowerCase();
    var gameRole = new RegExp('\\b(' + ROLES.map(esc).join('|') + ')\\s+(?:game|adventure|story)\\b', 'i').exec(text);
    if (!hero.role && gameRole && gameRole[1].toLowerCase() !== hero.species) hero.role = gameRole[1].toLowerCase();
    var aussie = /\b(aussie|australia|australian|straya|rottnest|perth|sydney|melbourne|outback|wa)\b/i.test(text);
    if (!hero.name) { hero.name = aussie ? AUSSIE_NAMES[hash(hero.species) % AUSSIE_NAMES.length] : NAMES[hero.species.charAt(0)] || 'Max'; hero.nameSuggested = true; }
    var heroSentence = sents.filter(function (s) { return hero.key && s.toLowerCase().indexOf(hero.key) >= 0; })[0] || sents[0];

    // ---- inciting event
    var inciting = null, incitingStart = null;
    var wm = heroSentence && /\b(?:who|that)\s+(.+)$/i.exec(heroSentence);
    if (wm && /\b(falls?|fell|wakes?|woke|gets?|got|loses?|lost|is|was|stole|crash|stuck|trapped|kidnapp|cursed|dies|died|sleep|asleep)/i.test(wm[1])) inciting = wm[1];
    if (!inciting) { var ks = sents.filter(function (s) { return /\b(stole|stolen|steals? the|kidnapp\w*|lost|wakes? up|woke up|crash\w*|stuck|trapped|cursed|died|murder\w*|disappear\w*|missing|falls? asleep)\b/i.test(s); })[0]; if (ks) inciting = ks; }
    if (inciting) inciting = inciting.split(/,?\s+so\s+(?:the|that|now)\b|,?\s+(?:kinda|sorta)\s+like\b/i)[0].replace(/^.*?\bnamed\s+[A-Z][a-z]+\s+and\s+/, '');
    inciting = inciting ? fixApos(stripFiller(inciting).replace(/\s+in\s+(?:like\s+)?(\w+)\s+or somewhere/i, ' in $1').replace(/\s+or somewhere\b/i, '')).replace(/[.]+$/, '') : null;
    if (inciting) inciting = inciting.replace(/^(ok so |so |okay so )/i, '');
    var stm = /\b(?:stole|stolen|steals?|nicked|swiped|took)\s+(?:the|a|an|my|our)\s+([a-z ]+?)(?=\s*\(|\s+from\b|[,.;!?]|$)/i.exec(text);
    var stolen = stm ? clean(stm[1]) : null;
    var wakeIn = /\bwakes? up (?:in|on|at) (?:a|an|the)\s+([a-z ]+?)(?= on\b| in\b| at\b|[,.;!?]|$)/i.exec(text);
    if (wakeIn) incitingStart = clean(wakeIn[1]);

    // ---- goal
    var goal = null, gm = null, gre = /\b(?:has to|have to|must|needs? to|wants? to|tries to|goal is to|trying to|got to|gotta)\s+([^.;!?]+)/gi, g0;
    while ((g0 = gre.exec(text))) {
      var before = text.slice(Math.max(0, g0.index - 12), g0.index);
      if (/\b(i|we|you|u|i'd|i)\s*(?:really\s+)?$/i.test(before) || /^(make|create|build|do|design|have|see|be useful|sound|say)\b/i.test(g0[1])) continue;
      gm = g0; break;
    }
    if (gm) goal = stripFiller(gm[1].split(/\b(?:kinda|sorta|like)\b/i)[0]);
    if (!goal) { var ig = /\b(?:the whole game is|game is about|is about)\s+(?:him |her |them |you )?(\w+ing)\b([^.;!?]*)/i.exec(text); if (ig) goal = (ING[ig[1].toLowerCase()] || ig[1].replace(/ing$/, '')) + ' ' + stripFiller(ig[2].split(/\b(?:kinda|sorta|like)\b/i)[0]); }
    if (!goal && stolen) goal = 'get the ' + stolen + ' back';
    if (!goal) { var sv = /\b(solve|find|escape|save|rescue|stop|catch|win)\s+(?:the|a|his|her|their|my)\s+([a-z ]{3,30})/i.exec(text); if (sv) goal = sv[1].toLowerCase() + ' ' + sv[0].split(/\s+/).slice(1).join(' '); }
    goal = goal ? clean(goal).replace(/[,]+$/, '') : 'find out what happened and set it right';
    goal = goal.replace(/\s+(kinda|sorta).*$/i, '');

    // ---- characters
    var roleBinds = [], boundRoles = {}, boundIdx = {};
    var roleRe = new RegExp('\\b(' + ROLES.map(esc).join('|') + ')\\b.{0,60}?\\b(?:is|who is|he\'?s|she\'?s|hes|shes|it\'?s)\\s+(?:a|an)\\s+((?:\\w+\\s+){0,2}?)(' + Object.keys(CREATURES).map(esc).join('|') + ')\\b', 'gi');
    var rb; while ((rb = roleRe.exec(text))) { roleBinds.push({ role: rb[1].toLowerCase(), key: rb[3].toLowerCase(), adjs: rb[2].trim().toLowerCase().split(/\s+/).filter(function (w) { return ADJ.indexOf(w) >= 0; }) }); boundRoles[rb[1].toLowerCase()] = 1; boundIdx[rb.index] = 1; }
    var chars = [], seen = {};
    creatures.forEach(function (c) {
      if (heroCre && c.index === heroCre.index) return;
      if (c.species === hero.species && !c.plural && !seen[c.species]) { seen[c.species] = 1; return; } // repeated mention of the hero's species
      if (seen[c.species + (c.plural ? 's' : '')]) return;
      var sameSpeciesAsHero = c.species === hero.species;
      if (sameSpeciesAsHero && !c.plural) return;
      seen[c.species + (c.plural ? 's' : '')] = 1;
      var clauseEnd = text.slice(c.index).search(/[.;!?\n]|,\s*(?:and\s+)?(?:a|an|the|some)?\s*(?=[a-z]+\s+(?:that|who)\b)|\s+and\s+(?:a|an|the|some)\s/i);
      var clause = text.slice(c.index, c.index + (clauseEnd > 0 ? clauseEnd : 120));
      var ch = { species: c.species, key: c.key, plural: c.plural, word: c.word, emoji: CREATURES[c.key][1], color: CREATURES[c.key][2], descriptors: adjsBefore(text, c.index), role: null, name: null, catchphrase: null, note: null, alias: null };
      var bind = roleBinds.filter(function (b) { return CREATURES[b.key][0] === c.species; })[0];
      if (bind) { ch.role = bind.role; ch.descriptors = ch.descriptors.concat(bind.adjs).filter(function (v, i, a) { return a.indexOf(v) === i; }); }
      var say = /\b(?:that|who|which)?\s*(?:say|says|saying|squawk|squawks|yell|yells|go|goes)\s+["“'‘]?([^"”'’,.;)]+?)["”'’]?(?=[,.;)]|\s+and\b|\s*$)/i.exec(clause) || /["“]([^"”]{2,40})["”]/.exec(clause);
      if (say) ch.catchphrase = clean(say[1]);
      var note = /\b(?:that|who)\s+(?!say|says)([^,.;!?]{4,60})/i.exec(clause); if (note && !/^is (?:a|an)\b/i.test(note[1])) ch.note = fixApos(stripFiller(note[1].split('(')[0]));
      var nmc = /\b(?:named|called)\s+((?:[A-Z][a-z'-]+)(?:\s+[A-Z][a-z'-]+)?|[a-z]+)/.exec(clause); if (nmc) ch.name = /^[a-z]/.test(nmc[1]) ? cap(nmc[1]) : nmc[1];
      var par = new RegExp(esc(c.word) + '\\s*\\(([^)]+)\\)', 'i').exec(text);
      if (c.key === 'bin chicken') { ch.alias = 'bin chickens'; }
      if (c.key === 'bin chicken' && c.plural) ch.name = 'The Bin Chickens';
      if (par && CREATURES[par[1].toLowerCase().trim()]) { ch.species = CREATURES[par[1].toLowerCase().trim()][0]; ch.alias = c.word.toLowerCase(); }
      if (c.key === 'gull' || /sea ?goal/i.test(c.word)) ch.species = 'seagull';
      var desc = clean(clause.slice(c.word.length).replace(/^\s*\([^)]*\)/, ''));
      if (/\bpirate\b/i.test(text.slice(c.index - 40, c.index + 60)) && ch.descriptors.indexOf('pirate') < 0 && /parrot/.test(c.species)) ch.descriptors.push('pirate');
      if (!ch.name) {
        if (ch.alias) ch.name = title(ch.alias);
        else if (c.plural) ch.name = 'The ' + title(c.species.replace(/y$/, 'ie') + 's').replace('Ibiss', 'Ibises').replace('Sheeps', 'Sheep');
        else if (ch.role && /^(mayor|captain|king|queen|sheriff|doctor|granny|grandma|grandpa|princess|professor)$/.test(ch.role)) ch.name = title(ch.role + ' ' + c.species);
        else ch.name = title((ch.role ? '' : ch.descriptors.filter(function (d) { return d !== 'little' && d !== 'big'; })[0] || '') + ' ' + c.species + (ch.role ? ' ' + ch.role : '')).trim();
      }
      if (c.plural && !ch.alias) ch.name = ch.name.replace(/Ravenss/, 'Ravens');
      if (c.species === 'raven' && c.plural) ch.name = 'The Ravens';
      if (c.species === 'seagull' && c.plural) ch.name = 'The Seagulls';
      ch.raw = desc;
      chars.push(ch);
    });
    // pure role characters with no animal ("the mayor") are kept only if not bound to an animal
    ROLES.forEach(function (r) {
      if (boundRoles[r] || r === hero.role || r === hero.species) return;
      var rm = new RegExp('\\b(?:the|a|an)\\s+(?:\\w+\\s+)?' + esc(r) + '\\b', 'i').exec(text);
      if (rm && chars.length < 8 && !chars.some(function (c) { return c.role === r; })) chars.push({ species: r, key: r, plural: false, word: r, emoji: '🧑', color: '#c9a0ff', descriptors: adjsBefore(text, rm.index), role: r, name: title(r), catchphrase: null, note: null, alias: null });
    });
    chars = chars.slice(0, 8);

    // ---- places
    var places = [], pseen = {}, open = [];
    function addPlace(name, src, tag) {
      var n = stripFiller(name).replace(/^(the|a|an|some)\s+/i, '').replace(/\s+(maybe|underwater maybe)$/i, '').trim();
      if (!n || n.length > 40) return;
      if (/^(something|somewhere|anything|idk|etc|more|other stuff)\b/i.test(n)) { open.push({ said: clean(name), src: src }); return; }
      var k = n.toLowerCase().replace(/s$/, '');
      if (pseen[k]) { if (tag) pseen[k].tag = pseen[k].tag || tag; return; }
      var label = n.toLowerCase() === 'urban' ? 'Urban streets' : n.toLowerCase() === 'outside' ? 'Outside' : title(n);
      pseen[k] = { name: label, said: n, tag: tag || null }; places.push(pseen[k]);
    }
    if (incitingStart) addPlace(incitingStart, 'inciting', 'start');
    var lists = /\b(?:settings?(?: examples?)?|setting ideas|places?|locations?|rooms?|levels?|areas?)\s*(?:examples?)?\s*(?:include|includes|including|like|are|could be|:|max,?|max:)\s*([^.]+?)(?=\.(?:\s|$)|$)/gi, lm2;
    while ((lm2 = lists.exec(text))) lm2[1].split(/,|\/|;|\band\b|\bor\b|\+/).forEach(function (p) { addPlace(p, 'list'); });
    var placeRe = new RegExp('\\b(' + PLACES.slice().sort(function (a, b) { return b.length - a.length; }).map(esc).join('|') + ')s?\\b', 'gi'), pm;
    var found = [];
    while ((pm = placeRe.exec(text))) { var pw = pm[1].toLowerCase(); if (pw === 'island') continue; if (/^(tip|bar|can|port|park)$/.test(pw) && !new RegExp('\\b(the|a) ' + pw + '\\b', 'i').test(text)) continue; found.push(pw); }
    found.forEach(function (pw) {
      var inOther = found.some(function (o) { return o !== pw && o.indexOf(pw) >= 0; }) || places.some(function (p) { return p.said.toLowerCase().indexOf(pw) >= 0 && p.said.toLowerCase() !== pw; });
      if (!inOther) addPlace(pw, 'mentioned');
    });
    var homeName = hero.origin && /\bhome\b|\bway back\b|\breturn\b/i.test(goal) ? hero.origin : null;
    if (homeName) addPlace(homeName, 'goal', 'home');
    // named regions mentioned (for suggestions)
    var wa = /\b(western australia|\bwa\b|perth|rottnest|fremantle|freo)\b/i.test(text), aus = aussie;
    var suggestions = wa ? ['Perth / Fremantle (the port, Freo markets)', 'The Pinnacles desert'] : aus ? ['Sydney Harbour', 'Uluru', 'a "Big Thing" roadside attraction'] : /\bmaine\b|\blighthouse\b/i.test(text) ? ['a famous lighthouse', 'the harbour'] : ['a famous local landmark'];

    // ---- items
    var items = [], iseen = {};
    var itemRe = new RegExp('\\b(' + ITEMS.slice().sort(function (a, b) { return b.length - a.length; }).map(esc).join('|') + ')\\b', 'gi'), im2;
    while ((im2 = itemRe.exec(text))) { var iw = im2[1].toLowerCase(); if (iseen[iw] || (iw === 'can' && !/\b(a|the) can\b/i.test(text)) || (iw === 'fish' && /\bfishing\b/i.test(im2.input.slice(im2.index, im2.index + 7)))) continue; iseen[iw] = 1; items.push(iw); }
    if (stolen && !items.some(function (x) { return stolen.indexOf(x) >= 0; })) items.unshift(stolen);
    else if (stolen) items = items.map(function (x) { return stolen.indexOf(x) >= 0 ? stolen : x; }).filter(function (v, i, a) { return a.indexOf(v) === i; });

    // ---- tone, refs, rating, art, length
    var tone = TONES.filter(function (t) { return t[0].test(text); }).map(function (t) { return t[1]; });
    var refs = REFERENCES.filter(function (r) { return r[0].test(text); }).map(function (r) { return r[1]; });
    var swears = []; SWEARS.forEach(function (r) { r.lastIndex = 0; var m; while ((m = r.exec(text))) if (swears.indexOf(m[0]) < 0) swears.push(m[0]); });
    var mild = []; MILD.forEach(function (r) { r.lastIndex = 0; var m; while ((m = r.exec(text))) if (mild.indexOf(m[0].toLowerCase()) < 0) mild.push(m[0].toLowerCase()); });
    var wantsPG = /\bpg\b|kids|family/i.test(text);
    var artWords = [], styleScores = {};
    STYLE_RULES.forEach(function (r) { r[1].lastIndex = 0; var m; while ((m = r[1].exec(text))) { artWords.push(m[0]); styleScores[r[0]] = (styleScores[r[0]] || 0) + 1; } });
    var era = []; ERA.lastIndex = 0; var em; while ((em = ERA.exec(text))) era.push(em[0]);
    var styleId = Object.keys(styleScores).sort(function (a, b) { return styleScores[b] - styleScores[a]; })[0] || null;
    if (styleScores.sierra_pixel) styleId = 'sierra_pixel';
    if (styleId === 'watercolou?r') styleId = 'watercolor';
    var lenm = /(\d+)\s*(?:-|to)?\s*(\d+)?\s*(min|mins|minutes|hours?|hrs?)\b/i.exec(text);
    var length = lenm ? lenm[0] : /\bshort\b/i.test(text) ? 'short' : null;

    // ---- title
    var explicit = /\b(?:game (?:is )?(?:called|named)|titled|title(?: is|:))\s*["“]?([^"”.,!?]+)/i.exec(text);
    var Sp = title(hero.species), options = [];
    if (explicit) options.push(title(clean(explicit[1])));
    if (/\bhome\b|\bway back\b/i.test(goal)) {
      if (aussie) options.push(Sp + ' Gone Walkabout');
      options.push('The Long Way Home');
      if (hero.origin === 'Rottnest Island') options.push('Rotto or Bust'); else if (hero.origin) options.push(hero.origin + ' or Bust');
      if (!aussie) options.push(hero.name + '\u2019s Long Way Home');
    }
    if (stolen) { var key = stolen.split(' ').filter(function (w) { return ['giant', 'golden', 'big', 'little', 'the', 'old'].indexOf(w) < 0; }); options.push('The Great ' + title(key[0] || stolen) + ' Heist'); options.push('Who Stole the ' + title(stolen.replace(/^giant /, '')) + '?'); }
    if (/\bmurder|killer|killed|who ?dunn?it\b/i.test(text)) { options.push('Who Killed ' + hero.name + '?'); options.push(hero.name + ' Moves On'); }
    if (!options.length) { options.push(hero.name + '\u2019s Big Adventure'); options.push('The ' + Sp + ' Who Wasn\u2019t There'); }
    options = options.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 4);

    // ---- logline + opening lines
    if (hero.role && /^(detective|janitor|cook|chef|pirate|wizard|knight|captain)$/.test(hero.role) && !hero.look.match(hero.role)) hero.look = clean(hero.look.replace(hero.species, hero.species + ' ' + hero.role));
    var heroDesc = clean((hero.descriptors.length ? hero.descriptors.join(' ') + ' ' : '') + hero.species + (hero.role && hero.role !== hero.species ? ' ' + hero.role : '') + (hero.origin ? ' from ' + hero.origin : ''));
    var art = /^[aeiou]/i.test(heroDesc) ? 'An ' : 'A ';
    var logline;
    if (inciting && wm) logline = art + heroDesc + ' ' + inciting.replace(/\s+and\s+(?=wakes?|woke)/i, ', ').replace(/^who /i, '') + ', and has to ' + goal + '.';
    else if (inciting && stolen && inciting.indexOf(stolen) >= 0) logline = art + heroDesc + ' has to ' + goal + '. ' + cap(inciting.replace('the ' + stolen, 'it').replace(stolen, 'it')) + '.';
    else if (inciting) logline = art + heroDesc + ' has to ' + goal + '. ' + cap(inciting.replace(/^(she|he|they)\b/i, function (m) { return m; })) + '.';
    else logline = art + heroDesc + ' has to ' + goal + '.';
    logline = logline.replace(/\s+/g, ' ').replace(/,\s*,/g, ',');
    var intro = [];
    if (incitingStart) {
      intro.push({ by: 'hero', say: 'Urrrgh\u2026 where am I? This doesn\u2019t smell like ' + (hero.origin || 'home') + '. It smells like ' + (incitingStart.indexOf('landfill') >= 0 ? 'a landfill' : 'a ' + incitingStart) + '.' });
      intro.push({ by: 'hero', say: 'Right. ' + cap(firstPerson(goal)) + '. How hard can it be?' });
    } else if (stolen) {
      intro.push({ by: 'hero', say: 'Somebody stole the ' + stolen + '. In MY town.' });
      intro.push({ by: 'hero', say: 'Time to ' + firstPerson(goal).replace('the ' + stolen, 'it') + '.' });
    } else if (/murder/i.test(text)) {
      intro.push({ by: 'hero', say: 'Somebody murdered me. Rude.' });
      intro.push({ by: 'hero', say: 'Time to ' + firstPerson(goal) + '.' });
    } else {
      intro.push({ by: 'hero', say: 'Well. This is a pickle.' });
      intro.push({ by: 'hero', say: 'Time to ' + firstPerson(goal) + '.' });
    }

    // ---- puzzle ideas (suggested) and story beats
    var startPlace = places.filter(function (p) { return p.tag === 'start'; })[0] || places[0];
    var puzzles = [];
    if (startPlace && startPlace.tag === 'start') puzzles.push('Get out of the ' + startPlace.name.toLowerCase());
    chars.forEach(function (c) { puzzles.push((c.catchphrase ? 'Win over ' : 'Get help from ') + c.name.replace(/^The /, 'the ') + (c.catchphrase ? ' (they only say \u201c' + c.catchphrase + '\u201d)' : '')); });
    if (items.length) puzzles.push('Use the ' + items[0] + ' to bargain or bribe someone');
    if (stolen) puzzles.push('Find where the ' + stolen + ' is hidden');
    puzzles.push(cap(goal.replace(/\b(his|her|their)\b/g, 'your')));
    puzzles = puzzles.slice(0, 7);
    var notes = sents.filter(function (s) { return /\b(useful|somehow|guarding|puzzle|has to|needs to|should)\b/i.test(s); }).map(stripFiller).filter(Boolean).slice(0, 4);

    // ---- facts + decisions ("how I read your notes")
    var dec = [];
    var heroSnip = snippet(raw, hero.phrase || (heroCre ? heroCre.word : hero.species)) || snippet(raw, hero.species);
    dec.push([heroSnip || '(no hero described)', 'Hero: ' + heroDesc + (hero.nameSuggested ? ' (suggested name: ' + hero.name + ')' : ', named ' + hero.name)]);
    if (inciting) dec.push([snippet(raw, inciting.split(' ').slice(0, 4).join(' ')) || inciting, 'Opening event: ' + inciting]);
    dec.push([gm ? snippet(raw, gm[0].slice(0, 20)) || gm[0] : '(no goal stated)', 'Goal: ' + goal + (gm ? '' : ' (suggested)')]);
    chars.forEach(function (c) {
      var corr = corrections.filter(function (x) { return x.to.toLowerCase().indexOf(c.species) >= 0 || c.word.toLowerCase().indexOf(x.to.toLowerCase()) >= 0; })[0];
      var said = snippet(raw, corr ? corr.from : (c.alias || c.word)) || c.word;
      dec.push([said, 'Character: ' + c.name + (c.alias ? ' (' + c.alias + ' = ' + c.species + ')' : c.name.toLowerCase().indexOf(c.species) < 0 ? ' (' + c.species + ')' : '') + (c.role ? ', the ' + c.role : '') +
        (corr ? ' \u2014 read \u201c' + corr.from + '\u201d as ' + corr.to : '') + (c.catchphrase ? '. Catchphrase: \u201c' + c.catchphrase + '\u201d' : '') + (c.note ? '. ' + cap(c.note) : '')]);
    });
    if (places.length || open.length) dec.push([lists.lastIndex || /settings?|places?/i.test(raw) ? (snippet(raw, 'setting') || snippet(raw, 'places') || places.map(function (p) { return p.said; }).join(', ')) : places.map(function (p) { return p.said; }).join(', '), 'Places: ' + places.map(function (p) { return p.name + (p.tag === 'start' ? ' (start)' : p.tag === 'home' ? ' (home, the ending)' : ''); }).join(', ')]);
    open.forEach(function (o) { dec.push([snippet(raw, o.said) || o.said, 'Left open on purpose. Ideas: ' + suggestions.join(' or ')]); });
    if (tone.length || refs.length) dec.push([snippet(raw, (/\b(funny|aussie|crude|pg|spooky|goofy|comedy|vibes?)\b/i.exec(raw) || [refs[0] || ''])[0]) || '', 'Tone: ' + tone.concat(refs.map(function (r) { return 'like ' + r; })).join(', ')]);
    if (swears.length) dec.push([snippet(raw, swears[0]) || swears[0], 'Language: \u201c' + swears.join('\u201d, \u201c') + '\u201d is stronger than ' + (wantsPG ? '\u201cmostly PG\u201d' : 'a PG rating') + '. Your call: keep it, or bleep it.']);
    if (artWords.length || era.length) dec.push([snippet(raw, (artWords[0] || era[0])) || '', 'Art style: ' + (styleId ? styleName(styleId) : 'not sure') + (era.length ? ' with a ' + era[0] + ' feel' : '') + ' (preselected in step 2)']);
    if (items.length) dec.push([snippet(raw, items[0]) || items[0], 'Items: ' + items.join(', ')]);
    corrections.filter(function (c) { return !dec.some(function (d) { return d[1].indexOf(c.from) >= 0; }); }).forEach(function (c) { dec.push(['\u201c' + c.from + '\u201d', 'Read as \u201c' + c.to + '\u201d (typo)']); });

    var facts = [['Hero', heroDesc + ' \u00b7 ' + hero.name + (hero.nameSuggested ? ' (suggested)' : '')], ['Goal', cap(goal)]];
    if (inciting) facts.push(['Opening event', cap(inciting)]);
    facts.push(['Cast', chars.length ? chars.map(function (c) { return c.name; }).join(', ') : 'Just the hero so far']);
    facts.push(['Places', places.length ? places.map(function (p) { return p.name; }).join(', ') + (open.length ? ', + one open slot' : '') : 'None named yet']);
    if (tone.length) facts.push(['Tone', tone.join(', ')]);
    if (refs.length) facts.push(['Like', refs.join(', ')]);
    if (styleId || era.length) facts.push(['Art style', (styleId ? styleName(styleId) : '') + (era.length ? (styleId ? ', ' : '') + era[0] + ' throwback' : '')]);
    facts.push(['Rating', swears.length ? (wantsPG ? 'Mostly PG, but with strong language (see below)' : 'Contains strong language') : wantsPG ? 'Mostly PG' : mild.length ? 'PG (mild language)' : 'Not stated']);
    if (length) facts.push(['Length', length]);

    var kpRe = new RegExp('\\b(' + Object.keys(KNOWN_PLACES).sort(function (x, y) { return y.length - x.length; }).map(esc).join('|') + ')\\b', 'gi');
    function placesCap(x) { return x.replace(kpRe, function (m) { return KNOWN_PLACES[m.toLowerCase()]; }); }
    logline = placesCap(logline); if (inciting) inciting = placesCap(inciting);
    facts = facts.map(function (f) { return [f[0], placesCap(f[1])]; });
    dec = dec.map(function (d) { return [d[0], placesCap(d[1])]; });
    return {
      source: 'local', title: options[0], title_options: options, logline: logline, facts: facts, decisions: dec, intro: intro,
      parsed: { hero: hero, goal: goal, inciting: inciting, start: startPlace ? startPlace.name : null, stolen: stolen, characters: chars, places: places,
        open_places: open, place_suggestions: suggestions, items: items, puzzle_ideas: puzzles, notes: notes, tone: tone, references: refs,
        language: { strong: swears, mild: mild, wants_pg: wantsPG }, art: { style: styleId, words: artWords, era: era }, length: length, corrections: corrections, aussie: aussie },
      language: 'keep', thin: !chars.length && !places.length && hero.species === 'hero',
    };
  }
  function roleIn(s) {
    var best = null, bi = 1e9;
    ROLES.forEach(function (r) { var m = new RegExp('\\b' + esc(r) + '\\b', 'i').exec(s); if (m && m.index < bi) { bi = m.index; best = r; } });
    return best;
  }
  var STYLE_NAMES = { lucasarts: '90s Painted Cartoon', sierra_pixel: '16-Color Pixel Art', claymation: 'Claymation', noir_ink: 'Noir Ink', watercolor: 'Watercolor Storybook', modern_handdrawn: 'Modern Hand-Drawn' };
  function styleName(id) { return STYLE_NAMES[id] || id; }
  return { organize: organize, bleep: bleep, swearIn: swearIn, CREATURES: CREATURES };
});
