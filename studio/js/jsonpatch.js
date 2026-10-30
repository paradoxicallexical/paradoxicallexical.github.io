/* Minimal RFC 6902 JSON Patch (add/remove/replace/move/copy/test) + a structural diff that emits patches.
 * Used for every Studio edit, manual or AI-proposed, so the history and the AI contract share one format. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JSONPatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function parse(ptr) {
    if (ptr === '') return [];
    if (ptr.charAt(0) !== '/') throw new Error('Bad JSON pointer: ' + ptr);
    return ptr.slice(1).split('/').map(function (s) { return s.replace(/~1/g, '/').replace(/~0/g, '~'); });
  }
  function esc(k) { return String(k).replace(/~/g, '~0').replace(/\//g, '~1'); }
  function get(doc, ptr) {
    var parts = parse(ptr), cur = doc;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function parentOf(doc, ptr) {
    var parts = parse(ptr), key = parts.pop(), cur = doc;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) throw new Error('Path not found: ' + ptr);
      cur = cur[parts[i]];
    }
    return { obj: cur, key: key };
  }
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function applyOp(doc, op) {
    var p;
    switch (op.op) {
      case 'add':
        if (op.path === '') return clone(op.value);
        p = parentOf(doc, op.path);
        if (Array.isArray(p.obj)) {
          var idx = p.key === '-' ? p.obj.length : parseInt(p.key, 10);
          if (isNaN(idx) || idx < 0 || idx > p.obj.length) throw new Error('Bad array index: ' + op.path);
          p.obj.splice(idx, 0, clone(op.value));
        } else p.obj[p.key] = clone(op.value);
        return doc;
      case 'remove':
        p = parentOf(doc, op.path);
        if (!(p.key in p.obj)) throw new Error('Nothing to remove at ' + op.path);
        if (Array.isArray(p.obj)) p.obj.splice(parseInt(p.key, 10), 1); else delete p.obj[p.key];
        return doc;
      case 'replace':
        if (op.path === '') return clone(op.value);
        p = parentOf(doc, op.path);
        if (!(p.key in p.obj)) throw new Error('Nothing to replace at ' + op.path);
        p.obj[p.key] = clone(op.value);
        return doc;
      case 'move': case 'copy':
        var v = get(doc, op.from);
        if (v === undefined) throw new Error('Nothing at ' + op.from);
        if (op.op === 'move') doc = applyOp(doc, { op: 'remove', path: op.from });
        return applyOp(doc, { op: 'add', path: op.path, value: clone(v) });
      case 'test':
        if (!equal(get(doc, op.path), op.value)) throw new Error('Test failed at ' + op.path);
        return doc;
      default: throw new Error('Unknown op ' + op.op);
    }
  }
  function apply(doc, patch) {
    var d = clone(doc);
    (patch || []).forEach(function (op) { d = applyOp(d, op); });
    return d;
  }
  // Structural diff a -> b as a patch (arrays of equal length diffed per index; otherwise replaced).
  function diff(a, b, path, out) {
    path = path || ''; out = out || [];
    if (equal(a, b)) return out;
    var ao = a && typeof a === 'object', bo = b && typeof b === 'object';
    if (!ao || !bo || Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) {
      out.push({ op: 'replace', path: path, value: clone(b) }); return out;
    }
    if (Array.isArray(a)) { for (var i = 0; i < a.length; i++) diff(a[i], b[i], path + '/' + i, out); return out; }
    Object.keys(a).forEach(function (k) { if (!(k in b)) out.push({ op: 'remove', path: path + '/' + esc(k) }); });
    Object.keys(b).forEach(function (k) {
      if (!(k in a)) out.push({ op: 'add', path: path + '/' + esc(k), value: clone(b[k]) });
      else diff(a[k], b[k], path + '/' + esc(k), out);
    });
    return out;
  }
  return { apply: apply, get: get, diff: diff, clone: clone, esc: esc, parse: parse };
});
