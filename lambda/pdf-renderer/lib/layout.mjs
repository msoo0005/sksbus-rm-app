// The page engine behind every SKS Chassis PDF.
//
// Chrome's own print pagination can't do what the spec asks: a different
// header line on page 1, on later body pages and on photo pages; "(continued)"
// headings repeated where a section or photo group carries over; blocks that
// never split unless taller than a page; and "Page X of Y" plus "photos on
// pages a–b" filled in once the layout is final. So the report is laid out
// here instead, in the browser, before printing:
//
//   1. The template emits a flat list of ITEMS (blocks, table rows, photo
//      rows) into a hidden #source, each with a few data- attributes.
//   2. paginate() measures every item at the real content width and fills
//      fixed A4 pages (794 × 1123 px at 96 dpi), one item at a time.
//   3. Chrome prints the finished pages one per sheet, with no margins of its
//      own (they are part of each page's padding).
//
// Item attributes:
//   data-break="page"     start a new page before this item
//   data-page-kind="..."  "body" (default) or "photo": picks the header line
//   data-keep-next        never end a page after this item (headings)
//   data-cont="tplId"     <template> whose content is placed at the top of a
//                         page this item starts ("... (continued)" headings)
//   data-split="tplId"    <template> holding this block cut into rows, used
//                         when the whole block is taller than a page

export const PAGE = { width: 794, height: 1123, top: 34, side: 40, bottom: 24 };

export function baseCss(fontCss = "") {
  return `
${fontCss}
@page { size: ${PAGE.width}px ${PAGE.height}px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  font-family: "TeX Gyre Heros", Helvetica, Arial, "Liberation Sans", sans-serif;
  font-size: 11px; line-height: 1.3; color: #000;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.page {
  position: relative; width: ${PAGE.width}px; height: ${PAGE.height}px; overflow: hidden;
  padding: ${PAGE.top}px ${PAGE.side}px ${PAGE.bottom}px; page-break-after: always; break-after: page;
  display: flex; flex-direction: column;
}
.page:last-child { page-break-after: auto; break-after: auto; }
.page-content { flex: 1 1 auto; overflow: hidden; padding-top: 9px; }
#source, #measure { position: absolute; left: -10000px; top: 0; width: ${PAGE.width - 2 * PAGE.side}px; }
.item { margin: 0 0 10px; display: flow-root; }
.item.tight { margin-bottom: 0; }

/* Header and footer, every page */
.hdr { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 7px; border-bottom: 2px solid #000; }
.hdr-left { display: flex; align-items: center; gap: 10px; }
.hdr-logo { height: 36px; display: block; }
.hdr-logo-text { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; }
.hdr-divider { width: 1px; height: 30px; background: #000; }
.hdr-unit { font-size: 9.5px; line-height: 1.3; }
.hdr-right { text-align: right; }
.hdr-title { font-size: 19px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; line-height: 1.1; }
.hdr-ref { margin-top: 4px; font-size: 11px; font-weight: 700; }
.hdr-ref .lbl { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 3px; }
.hdr-sub { margin-top: 2px; font-size: 9.5px; }
.ftr { flex: 0 0 auto; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
       border-top: 1px solid #000; padding-top: 6px; font-size: 9.5px; }
.ftr .c { text-align: center; }
.ftr .r { text-align: right; font-weight: 700; }

/* Building blocks */
.sec { display: flex; justify-content: space-between; align-items: baseline;
       border-bottom: 1.5px solid #000; padding-bottom: 4px; margin-top: 4px; }
.sec h2 { margin: 0; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.sec .note { font-size: 9.5px; }
.sub { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 2px 0 0; }
.lbl-caps { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th { background: #D9D9D9; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
     text-align: left; padding: 5px 8px; }
td { padding: 5px 8px; vertical-align: top; border-bottom: 1px solid #E2E2E2; word-break: break-word; overflow-wrap: anywhere; }
tr.stripe td { background: #F2F2F2; }
tr.hl td { background: #E3E3E3; font-weight: 700; }
td.num, th.num { text-align: right; }
.b { font-weight: 700; }
.muted-none { font-weight: 400; }
`;
}

// Runs inside the page. Returns the number of pages produced.
export const PAGINATE_JS = String.raw`
window.__paginate = function () {
  var src = document.getElementById('source');
  var measure = document.getElementById('measure');
  var shell = document.getElementById('shell');
  var out = document.getElementById('pages');
  var headers = {
    first: document.getElementById('hdr-first'),
    body: document.getElementById('hdr-body'),
    photo: document.getElementById('hdr-photo')
  };
  var footerTpl = document.getElementById('ftr');

  // Content height of a page: the full page minus padding, header and footer.
  function contentHeight(kind) {
    var page = makePage(kind);
    measure.appendChild(page);
    page.style.position = 'static';
    var content = page.querySelector('.page-content');
    var h = content.getBoundingClientRect().height;
    var pt = parseFloat(getComputedStyle(content).paddingTop) || 0;
    measure.removeChild(page);
    return h - pt - 1;
  }

  function makePage(kind) {
    var page = document.createElement('div');
    page.className = 'page';
    var h = headers[kind] || headers.body;
    page.appendChild(h.content.cloneNode(true));
    var content = document.createElement('div');
    content.className = 'page-content';
    page.appendChild(content);
    page.appendChild(footerTpl.content.cloneNode(true));
    return page;
  }

  function heightOf(el) {
    measure.appendChild(el);
    var r = el.getBoundingClientRect().height;
    var mb = parseFloat(getComputedStyle(el).marginBottom) || 0;
    measure.removeChild(el);
    return r + mb;
  }

  function fromTemplate(id) {
    var t = id && document.getElementById(id);
    if (!t) return [];
    var div = document.createElement('div');
    div.appendChild(t.content.cloneNode(true));
    return Array.prototype.slice.call(div.children);
  }

  var queue = Array.prototype.slice.call(src.children);
  var pages = [];
  var cur = null;
  var remain = 0;
  var hasContent = false;
  var heights = new Map();
  var H = { first: contentHeight('first'), body: contentHeight('body'), photo: contentHeight('photo') };

  function h(el) {
    if (!heights.has(el)) heights.set(el, heightOf(el));
    return heights.get(el);
  }

  function newPage(kind) {
    var k = pages.length === 0 ? 'first' : (kind === 'photo' ? 'photo' : 'body');
    cur = { kind: k, items: [] };
    pages.push(cur);
    remain = H[k];
    hasContent = false;
  }

  function put(el) {
    cur.items.push(el);
    remain -= h(el);
  }

  // The chain of items that must stay together: this one and every
  // keep-next item after it, up to and including the first that isn't.
  function chainFrom(i) {
    var chain = [queue[i]];
    while (chain[chain.length - 1].hasAttribute('data-keep-next') && i + chain.length < queue.length) {
      chain.push(queue[i + chain.length]);
    }
    return chain;
  }

  var i = 0;
  var guard = 0;
  while (i < queue.length && guard++ < 20000) {
    var item = queue[i];
    var kind = item.getAttribute('data-page-kind') || (cur ? (cur.kind === 'photo' ? 'photo' : 'body') : 'body');

    if (!cur) newPage(kind);
    else if (item.getAttribute('data-break') === 'page' && hasContent) newPage(kind);

    var chain = chainFrom(i);
    var chainH = chain.reduce(function (s, el) { return s + h(el); }, 0);

    if (chainH > remain) {
      var last = chain[chain.length - 1];
      var full = H[cur.kind === 'first' ? 'body' : cur.kind];
      // A block taller than a whole page is cut into its rows instead.
      if (last.getAttribute('data-split') && h(last) > full - 40) {
        var rows = fromTemplate(last.getAttribute('data-split'));
        queue.splice.apply(queue, [i + chain.length - 1, 1].concat(rows));
        continue;
      }
      if (hasContent) {
        newPage(kind);
        // Repeat the headings for whatever this page continues.
        fromTemplate(item.getAttribute('data-cont')).forEach(function (el) { put(el); });
      }
    }

    chain.forEach(function (el) { put(el); });
    hasContent = true;
    i += chain.length;
  }

  // Build the real pages.
  out.innerHTML = '';
  pages.forEach(function (p) {
    var page = makePage(p.kind);
    var content = page.querySelector('.page-content');
    p.items.forEach(function (el) { content.appendChild(el); });
    out.appendChild(page);
  });

  var total = pages.length;
  var all = out.querySelectorAll('.page');
  for (var n = 0; n < all.length; n++) {
    var fill = all[n].querySelectorAll('[data-fill="page"]');
    for (var k = 0; k < fill.length; k++) fill[k].textContent = 'Page ' + (n + 1) + ' of ' + total;
  }

  // "13 photos on pages 2–4"
  var photoPages = [];
  pages.forEach(function (p, idx) { if (p.kind === 'photo') photoPages.push(idx + 1); });
  var label = photoPages.length === 0 ? '' :
    photoPages.length === 1 ? 'page ' + photoPages[0] :
    'pages ' + photoPages[0] + '–' + photoPages[photoPages.length - 1];
  var spans = out.querySelectorAll('[data-fill="photo-pages"]');
  for (var s = 0; s < spans.length; s++) spans[s].textContent = label;

  src.remove();
  measure.remove();
  if (shell) shell.remove();
  return total;
};
`;

/**
 * The full HTML document for a report.
 * @param {object} o
 * @param {string} o.css              extra CSS for this report
 * @param {string} o.fontCss          @font-face rules
 * @param {{first:string, body:string, photo?:string}} o.headers  header HTML per page kind
 * @param {string} o.footer           footer HTML; put <span data-fill="page"></span> where "Page X of Y" goes
 * @param {string} o.items            the item HTML (see top of file)
 * @param {string} o.templates        <template> elements referenced by data-cont / data-split
 */
export function documentHtml({ css = "", fontCss = "", headers, footer, items, templates = "", title = "Report" }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>${baseCss(fontCss)}${css}</style></head>
<body>
<template id="hdr-first">${headers.first}</template>
<template id="hdr-body">${headers.body}</template>
<template id="hdr-photo">${headers.photo ?? headers.body}</template>
<template id="ftr">${footer}</template>
${templates}
<div id="measure"></div>
<div id="source">${items}</div>
<div id="pages"></div>
<script>${PAGINATE_JS}</script>
</body></html>`;
}

/** Standard SKS Chassis header. */
export function headerHtml({ logoHtml, title, refLabel = "Ref. no.", refValue, sub }) {
  return `<div class="hdr">
  <div class="hdr-left">${logoHtml}<div class="hdr-divider"></div>
    <div class="hdr-unit">Repair &amp; Maintenance<br>EV Bus Fleet</div></div>
  <div class="hdr-right">
    <div class="hdr-title">${title}</div>
    ${refValue ? `<div class="hdr-ref"><span class="lbl">${refLabel}</span>${refValue}</div>` : ""}
    <div class="hdr-sub">${sub ?? "&nbsp;"}</div>
  </div>
</div>`;
}

export function footerHtml(generatedOn) {
  return `<div class="ftr"><div>This is a system-generated report. SKS Chassis.</div>
<div class="c">Generated on ${generatedOn}</div><div class="r"><span data-fill="page"></span></div></div>`;
}

/** One item for #source. */
export function item(html, attrs = {}) {
  const a = [];
  if (attrs.breakBefore) a.push('data-break="page"');
  if (attrs.pageKind) a.push(`data-page-kind="${attrs.pageKind}"`);
  if (attrs.keepNext) a.push("data-keep-next");
  if (attrs.cont) a.push(`data-cont="${attrs.cont}"`);
  if (attrs.split) a.push(`data-split="${attrs.split}"`);
  return `<div class="item${attrs.tight ? " tight" : ""}" ${a.join(" ")}>${html}</div>`;
}

export function template(id, html) {
  return `<template id="${id}">${html}</template>`;
}
