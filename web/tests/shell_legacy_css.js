// The deck document as tests that read legacy CSS text out of index.html expect it: index.html with app.css and the page
// stylesheets it links from /css/ inlined as one <style> block in the head (those tests slice that block). The legacy page blocks moved
// verbatim into static/css/<page>.css (design v3 foundation, 2026-11-14); page lanes delete the old-look assertions as
// they rewrite their files.
'use strict';
const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', 'static');

module.exports = function deckDocument() {
  const links = /<link rel="stylesheet" href="\/((?:css\/)?[a-z]+\.css)">\n?/g;
  const html = fs.readFileSync(path.join(STATIC, 'index.html'), 'utf8');
  const css = [...html.matchAll(links)].filter((m) => /^(css\/|app\.css)/.test(m[1])).map((m) => fs.readFileSync(path.join(STATIC, m[1]), 'utf8')).join('\n');
  const doc = html.replace(links, '');
  const end = doc.indexOf('</style>');
  return end < 0 ? doc.replace('</head>', `<style>${css}</style></head>`) : doc.slice(0, end) + css + doc.slice(end);
};
