/* Web Worker: runs the validator off the main thread. Messages: {seq, project, opts} -> {seq, report}
 * ?root= is the path from the Studio folder to the folder holding engine/ ('../' in the repo, '' when published). */
if (typeof PNCValidate === 'undefined') {
  var root = decodeURIComponent((/[?&]root=([^&]*)/.exec(self.location.search) || [, '../'])[1]);
  importScripts('../' + root + 'engine/core.js', 'validate.js');
}
self.onmessage = function (e) {
  var d = e.data, report;
  try { report = PNCValidate.run(d.project, d.opts || {}); }
  catch (err) { report = { level: 'broken', ok: false, headline: 'The checker hit an error', explanation: String(err && err.message || err), lint_errors: [String(err)] }; }
  self.postMessage({ seq: d.seq, report: report });
};
