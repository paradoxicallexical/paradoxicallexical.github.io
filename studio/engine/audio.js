/*
 * PNC audio STUBS: procedural WebAudio music + SFX, and browser speechSynthesis voices.
 * These stand in for (a) a generative music model, (b) generated SFX, (c) a TTS voice service.
 * The game file only describes *what* it wants (tempo/mode/style, sfx names, voice notes);
 * swapping in real generated audio files later means changing this module, not the game file.
 */
(function (root) {
  'use strict';
  var ctx = null, master = null, musicGain = null, sfxGain = null;
  var musicOn = true, voiceOn = true, current = null, timer = null;
  var MODES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10] };

  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // Must be called synchronously inside a user gesture (iOS). resume() is fire-and-forget: on iOS its promise can
  // stay pending forever (e.g. ringer switch / interruption), so nothing ever awaits it.
  function resume() {
    try { if (ctx && ctx.state !== 'running') { var pr = ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); } } catch (e) {}
  }
  function init() {
    if (ctx) { resume(); return; }
    var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    // iOS unlock: play one silent sample inside the gesture
    try { var buf = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(0); } catch (e) {}
    resume();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.07; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.18; sfxGain.connect(master);
  }
  function tone(dest, freq, t, dur, type, vol, slideTo) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dest, t, dur, vol, freq) {
    var len = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var s = ctx.createBufferSource(); s.buffer = b; var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 2000;
    var g = ctx.createGain(); g.gain.value = vol || 0.4; s.connect(f); f.connect(g); g.connect(dest); s.start(t);
  }
  function note(spec, degree, octave) {
    var sc = MODES[spec.mode] || MODES.major, n = sc.length;
    var o = Math.floor(degree / n), d = ((degree % n) + n) % n;
    return spec.root * Math.pow(2, (sc[d] + 12 * (o + (octave || 0))) / 12);
  }

  // A 4-bar loop generated deterministically from the track spec.
  function buildPattern(spec) {
    var r = rng(spec.seed || 1), mel = [];
    var prog = [0, 3, 4, 0];
    for (var bar = 0; bar < 4; bar++) for (var s = 0; s < 8; s++) {
      var rest = spec.style === 'drone' ? r() < 0.75 : r() < 0.3;
      mel.push(rest ? null : prog[bar] + Math.floor(r() * 5));
    }
    return { prog: prog, mel: mel };
  }
  function playMusic(name, spec) {
    if (!ctx || current === name) return; stopMusic(); current = name; if (!spec) return;
    var pat = buildPattern(spec), step = 0, eighth = 60 / spec.tempo / 2, next = ctx.currentTime + 0.1;
    timer = setInterval(function () {
      if (!musicOn) { next = ctx.currentTime + 0.1; return; }
      while (next < ctx.currentTime + 0.2) {
        var bar = Math.floor(step / 8) % 4, s = step % 8, chord = pat.prog[bar], m = pat.mel[step % 32];
        var swing = (spec.style === 'swing' && s % 2) ? eighth * 0.33 : 0, t = next + swing;
        if (spec.style === 'polka') {
          if (s % 4 === 0) tone(musicGain, note(spec, chord + (s === 4 ? 4 : 0), -2), t, eighth * 1.5, 'triangle', 0.9);
          if (s % 4 === 2) [0, 2, 4].forEach(function (d) { tone(musicGain, note(spec, chord + d, -1), t, eighth * 0.8, 'square', 0.25); });
          if (m !== null) tone(musicGain, note(spec, m, 0), t, eighth * 0.9, 'square', 0.35);
        } else if (spec.style === 'swing') {
          if (s % 2 === 0) tone(musicGain, note(spec, chord + (s / 2) % 4, -2), t, eighth * 1.8, 'triangle', 0.9);
          noise(musicGain, t, 0.04, 0.15, 7000);
          if (m !== null && s % 2 === 0) tone(musicGain, note(spec, m, 0), t, eighth * 1.6, 'triangle', 0.45);
        } else if (spec.style === 'drone') {
          if (step % 32 === 0) tone(musicGain, note(spec, 0, -1), t, eighth * 32, 'sine', 0.8);
          if (m !== null) tone(musicGain, note(spec, m, 1), t, eighth * 4, 'sine', 0.25);
        } else {
          if (s % 4 === 0) tone(musicGain, note(spec, chord, -2), t, eighth * 1.5, 'triangle', 0.9);
          if (s % 4 === 2) tone(musicGain, note(spec, chord + 4, -2), t, eighth * 1.5, 'triangle', 0.7);
          if (m !== null) tone(musicGain, note(spec, m, 0), t, eighth * 0.9, 'square', 0.3);
        }
        next += eighth; step++;
      }
    }, 50);
  }
  function stopMusic() { if (timer) clearInterval(timer); timer = null; current = null; }

  var SFX = {
    coin: function (t) { tone(sfxGain, 988, t, 0.08, 'square', 0.5); tone(sfxGain, 1319, t + 0.08, 0.25, 'square', 0.5); },
    pickup: function (t) { [523, 659, 784, 1047].forEach(function (f, i) { tone(sfxGain, f, t + i * 0.06, 0.12, 'triangle', 0.6); }); },
    door: function (t) { noise(sfxGain, t, 0.25, 0.9, 300); tone(sfxGain, 90, t, 0.2, 'sine', 0.8); },
    squawk: function (t) { tone(sfxGain, 900, t, 0.18, 'sawtooth', 0.4, 1800); tone(sfxGain, 1500, t + 0.2, 0.22, 'sawtooth', 0.4, 700); },
    jukebox: function (t) { noise(sfxGain, t, 0.3, 0.6, 3000); [392, 494, 587].forEach(function (f) { tone(sfxGain, f, t + 0.3, 0.6, 'square', 0.2); }); },
    splash: function (t) { noise(sfxGain, t, 0.5, 1.0, 900); noise(sfxGain, t + 0.1, 0.4, 0.6, 2500); },
    click: function (t) { tone(sfxGain, 2000, t, 0.03, 'square', 0.4); },
    fanfare: function (t) { [523, 659, 784].forEach(function (f, i) { tone(sfxGain, f, t + i * 0.15, 0.2, 'square', 0.4); });
      [523, 659, 784, 1047].forEach(function (f) { tone(sfxGain, f, t + 0.5, 0.9, 'square', 0.25); }); }
  };
  function sfx(name) { if (!ctx) return; try { (SFX[name] || SFX.click)(ctx.currentTime + 0.01); } catch (e) {} }

  // Voices: browser TTS shaped by the character's voice spec.
  function speak(text, voice, onend) {
    try {
      if (!voiceOn || !root.speechSynthesis || !root.SpeechSynthesisUtterance) return false;
      // iOS Safari: cancel() immediately followed by speak() can silently drop the new utterance, so only cancel if busy.
      if (root.speechSynthesis.speaking || root.speechSynthesis.pending) root.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.pitch = Math.max(0, Math.min(2, voice && voice.pitch || 1)); u.rate = voice && voice.rate || 1; u.volume = 0.9;
      if (onend) u.onend = onend;
      root.speechSynthesis.speak(u); return true;
    } catch (e) { return false; }
  }
  // iOS only allows speech that is first started inside a user gesture: speak a silent utterance from the start tap.
  function unlockVoice() {
    try { if (!root.speechSynthesis || !root.SpeechSynthesisUtterance) return;
      var u = new SpeechSynthesisUtterance(' '); u.volume = 0; root.speechSynthesis.speak(u); } catch (e) {}
  }
  function hush() { try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) {} }

  root.PNCAudio = {
    init: init, resume: resume, unlockVoice: unlockVoice, playMusic: playMusic, stopMusic: stopMusic, sfx: sfx, speak: speak, hush: hush,
    setMusic: function (on) { musicOn = on; if (musicGain) musicGain.gain.value = on ? 0.07 : 0; },
    setVoice: function (on) { voiceOn = on; if (!on) hush(); },
    get musicOn() { return musicOn; }, get voiceOn() { return voiceOn; }
  };
})(typeof self !== 'undefined' ? self : this);
