/*
 * PNC nav: walkable area = outer polygon minus obstacle holes; shortest paths with A* over a
 * visibility graph whose nodes are the polygon corners, nudged a few px into the walkable area.
 * Shared by the browser engine and Node tools (tools/check_nav.js), like core.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PNCNav = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function pip(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function edgesOf(polys) {
    var out = [];
    polys.forEach(function (p) { for (var i = 0, j = p.length - 1; i < p.length; j = i++) out.push([p[j], p[i]]); });
    return out;
  }
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  function properCross(a, b, c, d) {
    var d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  }
  function closestOnSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    return [a[0] + t * dx, a[1] + t * dy];
  }

  // room: { walkable: [[x,y]...], walkable_holes: [[[x,y]...], ...] }
  function Mesh(room) {
    this.outer = room.walkable;
    this.holes = room.walkable_holes || [];
    this.edges = edgesOf([this.outer].concat(this.holes));
    this.nodes = [];
    var self = this;
    [this.outer].concat(this.holes).forEach(function (poly) {
      for (var i = 0; i < poly.length; i++) {
        var p = poly[i], a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length];
        // bisector of the corner; try both sides, keep the one that lands inside the walkable area
        var ua = norm([a[0] - p[0], a[1] - p[1]]), ub = norm([b[0] - p[0], b[1] - p[1]]);
        var bis = norm([ua[0] + ub[0], ua[1] + ub[1]]);
        if (!bis[0] && !bis[1]) bis = [-ua[1], ua[0]];
        for (var s = -1; s <= 1; s += 2) {
          var q = [p[0] + bis[0] * 4 * s, p[1] + bis[1] * 4 * s];
          // only concave-for-the-walker corners matter for shortest paths, but keeping all is cheap
          if (self.inside(q)) { self.nodes.push(q); break; }
        }
      }
    });
  }
  function norm(v) { var l = Math.hypot(v[0], v[1]); return l ? [v[0] / l, v[1] / l] : [0, 0]; }
  Mesh.prototype.inside = function (p) {
    if (!pip(p, this.outer)) return false;
    for (var i = 0; i < this.holes.length; i++) if (pip(p, this.holes[i])) return false;
    return true;
  };
  // nearest walkable point (projects onto the nearest boundary edge, then steps inside)
  Mesh.prototype.clamp = function (p) {
    if (this.inside(p)) return [p[0], p[1]];
    var best = null, bd = Infinity;
    this.edges.forEach(function (e) { var q = closestOnSeg(p, e[0], e[1]), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } });
    for (var r = 1; r <= 12; r++) for (var k = 0; k < 16; k++) {
      var a = k * Math.PI / 8, q = [best[0] + Math.cos(a) * r, best[1] + Math.sin(a) * r];
      if (this.inside(q)) return q;
    }
    var n = this.nodes.slice().sort(function (u, v) { return Math.hypot(u[0] - p[0], u[1] - p[1]) - Math.hypot(v[0] - p[0], v[1] - p[1]); });
    return n.length ? n[0] : best;
  };
  Mesh.prototype.clear = function (a, b) {
    for (var i = 0; i < this.edges.length; i++) if (properCross(a, b, this.edges[i][0], this.edges[i][1])) return false;
    var L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 6);
    for (var s = 1; s < n; s++) { var t = s / n; if (!this.inside([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return false; }
    return true;
  };
  // Returns the list of waypoints to walk (excluding the start), or null if unreachable.
  Mesh.prototype.path = function (from, to) {
    var a = this.clamp(from), b = this.clamp(to);
    if (this.clear(a, b)) return [b];
    var pts = [a].concat(this.nodes, [b]), n = pts.length, self = this;
    var g = new Array(n).fill(Infinity), f = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
    var h = function (i) { return Math.hypot(pts[i][0] - b[0], pts[i][1] - b[1]); };
    g[0] = 0; f[0] = h(0);
    var vis = {};
    function visible(i, j) { var k = i < j ? i + ',' + j : j + ',' + i; if (!(k in vis)) vis[k] = self.clear(pts[i], pts[j]); return vis[k]; }
    while (true) {
      var cur = -1, bf = Infinity;
      for (var i = 0; i < n; i++) if (!done[i] && f[i] < bf) { bf = f[i]; cur = i; }
      if (cur < 0) return null;
      if (cur === n - 1) break;
      done[cur] = true;
      for (var j = 0; j < n; j++) {
        if (done[j] || j === cur) continue;
        var d = g[cur] + Math.hypot(pts[j][0] - pts[cur][0], pts[j][1] - pts[cur][1]);
        if (d < g[j] && visible(cur, j)) { g[j] = d; f[j] = d + h(j); prev[j] = cur; }
      }
    }
    var out = [], k2 = n - 1;
    while (k2 > 0) { out.unshift(pts[k2]); k2 = prev[k2]; }
    return out;
  };
  return { Mesh: Mesh, pip: pip };
});
