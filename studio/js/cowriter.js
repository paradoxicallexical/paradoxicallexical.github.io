/*
 * "Ask the co-writer": prompt templates, the JSON-patch edit contract, a pluggable LLM client, and
 * offline demo suggestions. The AI NEVER edits the game directly: it proposes a JSON Patch; the Studio
 * applies it to a copy, runs the validator + solver, and only offers "Apply" if the game stays winnable.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./jsonpatch.js'));
  else root.CoWriter = factory(root.JSONPatch);
})(typeof self !== 'undefined' ? self : this, function (JP) {
  'use strict';

  var SYSTEM = [
    'You are the co-writer inside "PNC Studio", a tool that helps a non-technical creator make a classic point-and-click adventure game',
    '(think Monkey Island, Sam & Max Hit the Road, Day of the Tentacle, King\'s Quest).',
    'You are warm, funny and brief. You help with story, characters, dialogue, puzzles and art direction.',
    '',
    'THE PROJECT is one JSON document: {"design": {...}, "game": {...}}.',
    '- /game is the playable game file (schema below). The engine plays it exactly as written.',
    '- /design holds creator-facing notes: pitch, summary, style, characters (role/personality/look), beats (story timeline), rooms (descriptions), puzzles (description, blocked_story).',
    '',
    'GAME FILE ESSENTIALS',
    '- rooms.<id>.hotspots[]: {id, name, polygon:[[x,y]...] in 1024x576 pixels, walk_to:[x,y] INSIDE the room\'s walkable polygon, if?:condition, exit?:{to,at,if,else}, actions}',
    '- actions: {look|pickup|use|talk: rules, use_item: {<itemId>: rules}}. rules = [{if?:condition, do:[effects]}], first matching rule runs, so put specific rules BEFORE the catch-all.',
    '- condition: {flags:{name:bool}, has:[itemIds], lacks:[itemIds], all:[...], any:[...], not:{...}}',
    '- effects: {say:"text", by?:characterId} | {set:{flag:bool}} | {give:itemId} | {take:itemId} | {sfx:name} | {goto:roomId, at:[x,y]} | {dialogue:dialogueId} | {win:true}',
    '- Every flag must be declared in /game/flags (initial value false). Every item in /game/items {name, icon (emoji), look}.',
    '- dialogues.<id>.nodes.<nodeId>: {lines:[{by,say}], do?:[effects], choices?:[{text, if?, do?, next}], next?}',
    '- puzzles[]: {id, name, requires:[puzzleIds], solved_when:{flags:{flag:true}}}. This is the puzzle dependency chart.',
    '',
    'HOW TO ANSWER: reply with ONE JSON object and nothing else:',
    '{',
    '  "reply": "1-3 friendly sentences to the creator about what you suggest (or a question if you need one)",',
    '  "label": "short verb phrase for the undo history, e.g. \\"Make the parrot funnier\\"",',
    '  "patch": [ RFC 6902 JSON Patch operations on the project document; paths start with /game or /design ],',
    '  "needs_assets": [ "plain-English list of NEW art/voice/music the change needs, e.g. \\"sprite: rat\\"" ]',
    '}',
    'If you are only chatting or asking a question, return "patch": [].',
    '',
    'HARD RULES (the Studio runs a solver on your patch and rejects it if any are broken):',
    '1. Never change or remove an existing id, key, flag name, item id or character id. Rename things by changing their "name" text only.',
    '2. Use "replace" for existing values, "add" for new ones (use "/-" to append to arrays). Use "test" ops if you depend on a current value.',
    '3. Anything you reference (flag, item, character, room, dialogue, puzzle) must exist or be added in the same patch.',
    '4. The game must stay WINNABLE with NO DEAD ENDS: never let a required item be used up, lost or skipped in a way that blocks the ending.',
    '5. New puzzles: add the mechanics (flags, hotspot or character actions), a /game/puzzles entry with requires + solved_when, update the requires of whatever it now gates,',
    '   and add /design/puzzles/<id> {"description", "blocked_story"} where blocked_story finishes the sentence "if this puzzle breaks, ..." (e.g. "Gus never leaves the basement door").',
    '6. Keep lines short (under 140 characters), in character, and funny. Fair LucasArts-style puzzles: no deaths, every puzzle has an in-world hint.',
    '7. Prefer small, focused patches. Do the one thing the creator asked.',
  ].join('\n');

  var STEPS = {
    pitch: {
      title: 'Pitch',
      focus: 'The creator\'s messy pitch and the organized summary. Help clarify the premise, tone, and title. Edit /design/summary, /game/meta/title, /game/meta/subtitle and /game/meta/intro.',
      chips: ['Make the opening line punchier', 'Suggest 3 alternative titles', 'What\'s missing from my idea?'],
      organize: 'Turn the creator\'s messy pitch (in /design/pitch) into an organized summary. Return a patch that replaces /design/summary with {title, logline, facts:[[label,value]...], decisions:[[what the creator said, design decision]...]}. Resolve contradictions, keep their jokes, cap scope to what they asked for.',
    },
    style: {
      title: 'Art style',
      focus: 'Art direction. Edit /design/style/notes and /game/style_guide (prompt, background_rules, character_rules). The style guide is the locked text prefix of every image prompt, so it must be concrete (medium, line, palette, lighting, what to avoid).',
      chips: ['Lean a bit spookier', 'Describe the palette for each room', 'Make the style guide more specific'],
    },
    characters: {
      title: 'Characters',
      focus: 'The cast: /game/characters/<id> (name, voice.notes, voice.pitch 0-2, voice.rate 0.5-1.5, actions) and /design/characters/<id> (role, personality, look), plus their spoken lines anywhere in /game. Renaming = change the "name" text only (ids never change).',
      chips: ['Make the parrot funnier', 'Give Gus a catchphrase', 'Make the Mayor more dramatic'],
    },
    plot: {
      title: 'Plot & rooms',
      focus: 'Story beats (/design/beats: [{id, title, text}]), room names (/game/rooms/<id>/name) and descriptions (/design/rooms/<id>), hotspot look-text and the ending text (/game/win/text).',
      chips: ['Add a twist beat', 'Make the ending more triumphant', 'Describe the basement creepier'],
    },
    puzzles: {
      title: 'Puzzles',
      focus: 'The puzzle dependency chart (/game/puzzles) and the actual mechanics in rooms/characters. New puzzles must be fair, hinted, and keep the game winnable with no dead ends.',
      chips: ['Add a puzzle in the basement', 'Have the parrot want the quarter instead', 'Make the key puzzle harder'],
    },
    playtest: {
      title: 'Playtest',
      focus: 'Polish after playtesting: hints, funnier look-at lines, smoother pacing. Small text edits preferred.',
      chips: ['Add more hints for stuck players', 'Make the ending more triumphant'],
    },
  };

  var REPAIR = 'The Studio applied your patch to a copy and the solver REJECTED it.\nWhat broke (plain English): {{explanation}}\nDetails: {{details}}\nReturn a corrected JSON object in the same format (a full replacement patch against the ORIGINAL project, not on top of the rejected one).';

  function contextFor(step, project) {
    // Compact project context: full design + game (it's small), minus nothing. Large games would send a slice.
    return 'STEP: ' + STEPS[step].title + '\nFOCUS: ' + STEPS[step].focus + '\n\nPROJECT JSON:\n' + JSON.stringify(project);
  }
  function buildMessages(step, project, userText, chat, failure) {
    var msgs = [{ role: 'system', content: SYSTEM }, { role: 'user', content: contextFor(step, project) }, { role: 'assistant', content: '{"reply":"Got it, I\'ve read the project.","label":"","patch":[]}' }];
    (chat || []).slice(-6).forEach(function (m) { msgs.push({ role: m.role, content: m.content }); });
    msgs.push({ role: 'user', content: userText });
    if (failure) msgs.push({ role: 'user', content: REPAIR.replace('{{explanation}}', failure.explanation || '').replace('{{details}}', JSON.stringify(failure.details || failure.lint_errors || [])) });
    return msgs;
  }

  // ---------------------------------------------------------------- pluggable LLM client
  var CFG_KEY = 'pnc.studio.ai';
  function loadConfig() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } }
  function saveConfig(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }
  function hasKey() { var c = loadConfig(); return !!(c.key && c.endpoint); }
  var PRESETS = {
    openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1' },
    xai: { endpoint: 'https://api.x.ai/v1/chat/completions', model: 'grok-4' },
    openrouter: { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'anthropic/claude-sonnet-4' },
    anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' },
    custom: { endpoint: '', model: '' },
  };
  function parseJSON(text) {
    var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    var obj = JSON.parse(a >= 0 ? t.slice(a, b + 1) : t);
    if (!Array.isArray(obj.patch)) obj.patch = [];
    return obj;
  }
  function call(messages) {
    var c = loadConfig();
    if (!c.key || !c.endpoint) return Promise.reject(new Error('NO_KEY'));
    if (c.provider === 'anthropic') {
      var sys = messages.filter(function (m) { return m.role === 'system'; }).map(function (m) { return m.content; }).join('\n');
      return fetch(c.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: c.model, max_tokens: 4000, system: sys, messages: messages.filter(function (m) { return m.role !== 'system'; }) }) })
        .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error('AI service error ' + r.status + ': ' + t.slice(0, 200)); }); return r.json(); })
        .then(function (j) { return parseJSON(j.content.map(function (x) { return x.text || ''; }).join('')); });
    }
    return fetch(c.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key },
      body: JSON.stringify({ model: c.model, messages: messages, temperature: 0.7, response_format: { type: 'json_object' } }) })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error('AI service error ' + r.status + ': ' + t.slice(0, 200)); }); return r.json(); })
      .then(function (j) { return parseJSON(j.choices[0].message.content); });
  }

  // ---------------------------------------------------------------- offline demo suggestions (no key needed)
  function findIdx(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i; return -1; }
  var DEMOS = {
    'Make the opening line punchier': function (p) {
      return { reply: 'Shorter and meaner, like a noir narrator who hasn\'t slept.', label: 'Punch up the opening line',
        patch: [{ op: 'replace', path: '/game/meta/intro/0/say', value: 'Brineville. Pickle capital of the world. Tonight, somebody took a bite out of its heart.' }] };
    },
    'Lean a bit spookier': function (p) {
      return { reply: 'I added a note to push the lighting moodier without changing the cartoon style.', label: 'Lean the style spookier',
        patch: [{ op: 'replace', path: '/design/style/notes', value: 'A touch spookier: longer shadows, sickly green under-lighting in the basement, flickering neon in the diner.' }] };
    },
    'Make the parrot funnier': function (p) {
      var c = p.game.characters.captain;
      var patch = [];
      if (c.actions && c.actions.talk && c.actions.talk[1]) patch.push({ op: 'replace', path: '/game/characters/captain/actions/talk/1/do/0/say', value: 'SQUAWK! Captain Squawks don\'t work for free! Crackers up front, or ye walk the PLANK! ...Plank\'s a figure of speech. Crackers though.' });
      if (c.actions && c.actions.talk && c.actions.talk[0]) patch.push({ op: 'replace', path: '/game/characters/captain/actions/talk/0/do/0/say', value: 'CRUNCH! Pleasure doin\' business! Tell yer friends! Don\'t tell the Mayor!' });
      patch.push({ op: 'replace', path: '/design/characters/captain/personality', value: 'Loud, transactional, terrible at pirate jargon, will sell out anyone for a cracker' });
      return { reply: 'He\'s now a terrible negotiator who keeps breaking character. Two lines changed, nothing about the puzzle.', label: 'Make the parrot funnier', patch: patch };
    },
    'Add a twist beat': function (p) {
      return { reply: 'A small mid-story twist that doesn\'t change any puzzle.', label: 'Add a twist beat',
        patch: [{ op: 'add', path: '/design/beats/5', value: { id: 'twist', title: 'Twist', text: 'The flashlight Captain Squawks trades was stolen from Gus\'s kitchen. Gus knew the parrot had it all along.' } }] };
    },
    'Make the ending more triumphant': function (p) {
      return { reply: 'A bigger finish with a polka parade.', label: 'Make the ending more triumphant',
        patch: [{ op: 'replace', path: '/game/win/text', value: 'The Golden Pickle is home! Brineville throws a polka parade, Gus leads the band in handcuffs, and Rocco is paid in a lifetime supply of saltines.' }] };
    },
    'Add a puzzle in the basement': function (p) {
      var g = p.game, room = g.rooms.basement, bi = findIdx(room.hotspots, 'barrel');
      var barrel = room.hotspots[bi], fi = findIdx(g.puzzles, 'find_trophy');
      var walk = barrel.walk_to || [545, 430];
      var patch = [
        { op: 'add', path: '/game/flags/rat_scared', value: false },
        { op: 'add', path: '/game/rooms/basement/hotspots/-', value: { id: 'rat', name: 'Rat on the barrel', polygon: [[590, 128], [690, 128], [690, 190], [590, 190]], walk_to: walk,
          if: { flags: { basement_lit: true, rat_scared: false } },
          actions: {
            look: [{ do: [{ say: 'A rat the size of a toaster, sitting on the barrel lid like it pays rent.' }] }],
            talk: [{ do: [{ say: 'Shoo.' }, { say: 'It looks at me like I\'m the one trespassing. Maybe it respects authority.' }] }],
            pickup: [{ do: [{ say: 'I\'m a detective, not an exterminator.' }] }],
            use_item: { badge: [{ do: [{ set: { rat_scared: true } }, { sfx: 'squawk' }, { say: 'Health inspector! Everybody out!' }, { say: 'The rat salutes and scurries off. Respect.' }] }] } } } },
        { op: 'add', path: '/game/rooms/basement/hotspots/' + bi + '/actions/pickup/1', value: { if: { flags: { rat_scared: false } }, do: [{ say: 'A rat on the lid gives me a look. A \'try it, pal\' look. I need something official.' }] } },
        { op: 'add', path: '/game/puzzles/' + fi, value: { id: 'scare_rat', name: 'Flash the badge to scare off the rat', requires: ['light_basement', 'take_case'], solved_when: { flags: { rat_scared: true } } } },
        { op: 'replace', path: '/game/puzzles/' + (fi + 1) + '/requires', value: ['scare_rat'] },
        { op: 'add', path: '/design/puzzles/scare_rat', value: { description: 'A rat guards the barrel lid. Flash the badge ("Health inspector!") and it runs.', blocked_story: 'the rat never moves off the barrel' } },
      ];
      return { reply: 'A rat squats on the barrel lid. Flashing your badge ("Health inspector!") scares it off. It reuses the badge, so no new item, and the chart gets a new step before finding the trophy.', label: 'Add a rat puzzle in the basement', patch: patch, needs_assets: ['sprite: rat sitting on the barrel lid'] };
    },
    'Have the parrot want the quarter instead': function (p) {
      var trade = JP.clone(p.game.characters.captain.actions.use_item.saltines);
      trade.forEach(function (r) { (r.do || []).forEach(function (e) { if (e.take === 'saltines') e.take = 'quarter'; }); r.do = r.do.map(function (e) { return e.say && /CRACKERS/.test(e.say) ? { by: e.by, say: 'SHINY! Arr, a fair trade! Take this shiny stick!' } : e; }); });
      return { reply: 'Captain Squawks now trades the flashlight for the shiny quarter instead of crackers.', label: 'Make the parrot want the quarter',
        patch: [{ op: 'remove', path: '/game/characters/captain/actions/use_item/saltines' }, { op: 'replace', path: '/game/characters/captain/actions/use_item/quarter', value: trade }] };
    },
  };
  function demoFor(text) { return DEMOS[text] || null; }

  return { SYSTEM: SYSTEM, STEPS: STEPS, REPAIR: REPAIR, buildMessages: buildMessages, call: call, parseJSON: parseJSON,
    loadConfig: loadConfig, saveConfig: saveConfig, hasKey: hasKey, PRESETS: PRESETS, demoFor: demoFor, DEMOS: DEMOS };
});
