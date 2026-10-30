/* Seed data for the Studio: the 6 art styles and the design layer for The Great Pickle Heist.
 * The design layer holds things the engine doesn't need (roles, story beats, puzzle descriptions);
 * the playable game file itself is loaded from games/pickle-heist/game.json. */
(typeof window !== "undefined" ? window : globalThis).STUDIO_SEED = {
 "styles": [
  {
   "id": "lucasarts",
   "name": "90s Painted Cartoon",
   "era": "LucasArts, 1993",
   "blurb": "Sam & Max, Day of the Tentacle. Bold outlines, warm gouache, wonky perspective.",
   "img": "assets/styles/lucasarts.jpg",
   "guide": {
    "look": "Hand-painted 1990s cartoon point-and-click adventure art, bold dark outlines, saturated warm palette, painterly gouache textures, slightly exaggerated wonky perspective and crooked architecture.",
    "palette": "Mustard yellow, brick red, teal, warm browns; deep purple shadows.",
    "characters": "Rubber-hose proportions, big heads and expressive eyes, thick outlines matching the backgrounds.",
    "avoid": "Photorealism, gradients that look 3D-rendered, thin lines."
   }
  },
  {
   "id": "sierra_pixel",
   "name": "16-Color Pixel Art",
   "era": "Sierra, 1988",
   "blurb": "King's Quest, Space Quest. Chunky EGA pixels, dithering, 320x200.",
   "img": "assets/styles/sierra_pixel.jpg",
   "guide": {
    "look": "Late-1980s Sierra On-Line EGA pixel art, 320x200 resolution upscaled with hard square pixels, ordered dithering, 16-color EGA palette, flat shading, no anti-aliasing.",
    "palette": "Strict 16-color EGA palette (cyan, magenta, brown, bright green, greys).",
    "characters": "Small sprites (about 40px tall at native res), simple 1-pixel outlines, readable silhouettes.",
    "avoid": "Smooth gradients, more than 16 colors, painterly texture."
   }
  },
  {
   "id": "claymation",
   "name": "Claymation",
   "era": "The Neverhood, 1996",
   "blurb": "Handmade plasticine sets, fingerprints, soft studio light.",
   "img": "assets/styles/claymation.jpg",
   "guide": {
    "look": "Stop-motion claymation miniature set, hand-sculpted plasticine characters with visible fingerprints and tool marks, miniature props, soft studio lighting, shallow depth of field.",
    "palette": "Muted earthy clay tones with saturated accent props.",
    "characters": "Chunky clay figures, simple bead eyes, slightly lumpy forms; same clay texture in every pose.",
    "avoid": "Hard ink outlines, flat 2D shading, pixel art."
   }
  },
  {
   "id": "noir_ink",
   "name": "Noir Ink",
   "era": "Graphic novel",
   "blurb": "Black-and-white brush ink, venetian-blind shadows, one accent color.",
   "img": "assets/styles/noir_ink.jpg",
   "guide": {
    "look": "Film noir brush-ink illustration, black and white with heavy shadows, venetian-blind light stripes, high contrast cross-hatching, a single accent color (pickle green) for important objects.",
    "palette": "Black, white, greys + one accent color reserved for clickable clues.",
    "characters": "Angular silhouettes, hats and coats, faces half in shadow.",
    "avoid": "Full color, soft pastel tones."
   }
  },
  {
   "id": "watercolor",
   "name": "Watercolor Storybook",
   "era": "Picture book",
   "blurb": "Soft washes, paper texture, cozy and whimsical.",
   "img": "assets/styles/watercolor.jpg",
   "guide": {
    "look": "Gentle watercolor children's storybook illustration, soft washes with visible paper grain, loose ink linework, cozy whimsical mood.",
    "palette": "Pastel reds, sage green, cream, sky blue.",
    "characters": "Round friendly shapes, loose ink outlines, small details like hats and scarves.",
    "avoid": "Harsh black shadows, neon colors."
   }
  },
  {
   "id": "modern_handdrawn",
   "name": "Modern Hand-Drawn",
   "era": "2010s indie",
   "blurb": "Crisp clean lines, cel shading, cinematic light.",
   "img": "assets/styles/modern_handdrawn.jpg",
   "guide": {
    "look": "Modern hand-drawn 2D adventure game art, crisp clean linework, flat cel shading with soft gradients, cinematic lighting, vibrant contemporary palette.",
    "palette": "Teal and red diner tones, warm lamp highlights, cool shadows.",
    "characters": "Clean shapes, consistent line weight, expressive poses suited to animation.",
    "avoid": "Visible pixels, rough sketchy lines."
   }
  }
 ],
 "design": {
  "pitch": "ok so i want like a goofy detective game?? like sam and max vibes but my guy is a RACCOON in a trench coat. name rocco maybe. small town. someone stole the giant golden pickle trophy (the town is obsessed w pickles lol) from the town square\n\ntheres a diner. the cook is a grumpy walrus who def did it (or did he??? no he did it). maybe hes guarding something. basement??\n\nalso a parrot that steals shiny stuff. pirate parrot. eyepatch. he should be useful somehow. crackers?? polly want a cracker joke obviously\n\nmayor is a goose. very dramatic. she lost her mind about the trophy\n\n3 places max, diner / outside / basement. short, like 15 min. funny dialogue. the walrus LOVES polka idk why. painted 90s cartoon look\n\nending: trophy goes back on the thing, everyone cheers, walrus gets busted\n",
  "summary": {
   "title": "The Great Pickle Heist",
   "logline": "A 15-minute comedy mystery. Rocco, a raccoon private eye, must recover the Golden Pickle Trophy stolen from pickle-obsessed Brineville, prove the grumpy walrus cook did it, and put it back before the town has a meltdown.",
   "facts": [
    [
     "Length",
     "About 15 minutes"
    ],
    [
     "Tone",
     "Goofy noir comedy (Sam & Max vibes)"
    ],
    [
     "Rooms",
     "3: Main Street, Diner, Basement"
    ],
    [
     "Cast",
     "4: Rocco, Gus, Mayor Marge, Captain Squawks"
    ],
    [
     "Puzzles",
     "10, in a chain"
    ],
    [
     "Ending",
     "Trophy back on the pedestal, crowd cheers, Gus busted"
    ]
   ],
   "decisions": [
    [
     "\"sam and max vibes\", \"painted 90s cartoon look\"",
     "Art style: hand-painted 1990s cartoon, bold outlines, warm palette"
    ],
    [
     "\"walrus... def did it (or did he??? no he did it)\"",
     "Gus is the culprit. Hidden motive: he lost last year's pickle-eating contest to the Mayor"
    ],
    [
     "\"maybe hes guarding something. basement??\"",
     "Gus guards the basement key; the trophy is hidden in the basement pickle barrel"
    ],
    [
     "\"walrus LOVES polka idk why\"",
     "Turned into a puzzle: polka on the jukebox makes Gus dance away from the key"
    ],
    [
     "\"parrot... useful somehow. crackers??\"",
     "The parrot trades a stolen flashlight for crackers; you need light for the dark basement"
    ],
    [
     "\"3 places max\"",
     "Rooms: Diner, Main Street, Basement"
    ],
    [
     "\"ending: trophy back on the thing...\"",
     "Win: put the trophy on the pedestal, everyone cheers, Gus gets busted"
    ]
   ]
  },
  "style": {
   "selected": "lucasarts",
   "notes": ""
  },
  "characters": {
   "rocco": {
    "role": "The hero. Raccoon private eye",
    "personality": "Cocky, deadpan, a little sticky-fingered",
    "look": "Raccoon in a rumpled tan trench coat, mask-like markings, striped tail"
   },
   "gus": {
    "role": "Walrus cook (the culprit)",
    "personality": "Grumpy, defensive, secret polka addict",
    "look": "Huge walrus in a stained white apron and cook's hat, enormous mustache and tusks"
   },
   "marge": {
    "role": "Goose mayor who hires you",
    "personality": "Theatrical, panicky, honks when stressed",
    "look": "White goose with a mayoral sash and pearl necklace"
   },
   "captain": {
    "role": "Pirate parrot and kleptomaniac",
    "personality": "Loud, transactional, loves anything shiny",
    "look": "Green parrot with an eyepatch and a tiny pirate hat, nest full of shiny junk"
   }
  },
  "beats": [
   {
    "id": "b1",
    "title": "The crime",
    "text": "Night in Brineville. The Golden Pickle Trophy is gone from its pedestal. Rocco arrives on Main Street."
   },
   {
    "id": "b2",
    "title": "Hired",
    "text": "Mayor Marge, in full meltdown, hires Rocco and hands him a sticker badge. She mentions Gus's grudge and the parrot's love of crackers."
   },
   {
    "id": "b3",
    "title": "The suspect",
    "text": "At the diner, Gus refuses to talk without a badge, guards the basement key, and admits he can't resist polka."
   },
   {
    "id": "b4",
    "title": "Distraction",
    "text": "A quarter from the booth cushion buys one polka on the jukebox. Gus dances away and Rocco grabs the key."
   },
   {
    "id": "b5",
    "title": "The trade",
    "text": "Captain Squawks swaps his stolen flashlight for a sleeve of saltines."
   },
   {
    "id": "b6",
    "title": "The basement",
    "text": "Rocco unlocks the basement, lights it up, and fishes the trophy out of a giant pickle barrel."
   },
   {
    "id": "b7",
    "title": "Case closed",
    "text": "The trophy goes back on its pedestal. The crowd cheers, Gus is busted, and Rocco gets paid in saltines."
   }
  ],
  "rooms": {
   "street": "Brineville's Main Street at night: the empty trophy pedestal, a lamppost with the parrot's nest, a newspaper box, and the diner door. Mayor Marge paces here.",
   "diner": "A greasy 50s diner: a red booth (something's in the cushion), a counter with saltines, a jukebox with one polka record, the key on a hook, and the locked basement door that Gus guards.",
   "basement": "Pitch black until lit. Stairs up, shelves of pickle jars, a burnt-out bulb, and a giant pickle barrel glowing suspiciously gold-green."
  },
  "puzzles": {
   "take_case": {
    "description": "Talk Mayor Marge into hiring you so you get the badge.",
    "blocked_story": "Rocco never gets hired, so nobody will talk to him"
   },
   "find_quarter": {
    "description": "Search the booth cushion and find a quarter.",
    "blocked_story": "there's no quarter for the jukebox"
   },
   "distract_gus": {
    "description": "Put the quarter in the jukebox. Polka plays and Gus dances away from the key.",
    "blocked_story": "Gus never leaves the basement door"
   },
   "get_key": {
    "description": "Grab the basement key while Gus is dancing (you need an official case first).",
    "blocked_story": "Rocco never gets the basement key"
   },
   "unlock_basement": {
    "description": "Use the key on the basement door.",
    "blocked_story": "the basement stays locked"
   },
   "get_saltines": {
    "description": "Take a sleeve of saltines from the counter.",
    "blocked_story": "there are no crackers for the parrot"
   },
   "feed_parrot": {
    "description": "Give the saltines to Captain Squawks; he drops his flashlight.",
    "blocked_story": "Rocco never gets the flashlight"
   },
   "light_basement": {
    "description": "Use the flashlight in the dark basement.",
    "blocked_story": "the basement stays pitch black"
   },
   "find_trophy": {
    "description": "Fish the Golden Pickle out of the barrel.",
    "blocked_story": "the trophy is never found"
   },
   "return_trophy": {
    "description": "Put the trophy back on the pedestal. Everyone cheers.",
    "blocked_story": "the ending never happens"
   }
  }
 }
};
