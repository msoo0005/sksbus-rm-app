// PUSPAKOM Inspection Report (sample PDF, design pages 104-106), in the same
// SKS Chassis layout as the Job Completion Report: black text, greys for
// structure, blocks kept whole, photos at a fixed size on their own pages.
//
// Input: pspBuildReportData in lambda/index.mjs, with each photo's `src`
// already turned into a data: URI by the handler.

import { DASH, escapeHtml, val, fmtDate, fmtDateTime, fmtGenerated, fmtShortDateTime, fmtFigRange, workDoneLines } from "../lib/format.mjs";
import { documentHtml, headerHtml, footerHtml, item, template } from "../lib/layout.mjs";

const TITLE = "PUSPAKOM Inspection Report";

const CSS = `
.top { display: flex; gap: 16px; align-items: flex-start; }
.top-left { flex: 1 1 auto; min-width: 0; }
.veh-lbl { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.plate { font-size: 20px; font-weight: 700; line-height: 1.15; margin-top: 2px; }
.plate .fleet { font-size: 13px; }
.model { font-size: 12px; font-weight: 700; padding-bottom: 6px; }
.details td { padding: 6px 8px; }
.details td.v { font-weight: 700; }
.summary { flex: 0 0 250px; border: 1px solid #000; }
.summary .t { background: #D9D9D9; font-size: 8.5px; font-weight: 700; text-transform: uppercase;
              letter-spacing: 0.05em; padding: 6px 10px; border-bottom: 1px solid #000; }
.summary .r { display: flex; justify-content: space-between; gap: 8px; padding: 5px 10px; border-bottom: 1px solid #BDBDBD; }
.summary .r:last-child { border-bottom: 0; }
.summary .r .v { font-weight: 700; text-align: right; }
.ev td, .ev th { padding: 5px 8px; }
.box { border: 1px solid #000; }
.box-h { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
         background: #D9D9D9; padding: 5px 12px; border-bottom: 1px solid #000; }
.box-h .name { font-size: 12px; font-weight: 700; }
.box-h .meta { font-size: 11px; text-align: right; }
.box-row { display: flex; border-bottom: 1px solid #BDBDBD; }
.box-row:last-child { border-bottom: 0; }
.box-row .k { flex: 0 0 120px; padding: 6px 12px; border-right: 1px solid #BDBDBD;
              font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.box-row .v { flex: 1 1 auto; min-width: 0; padding: 6px 12px; font-size: 12px; overflow-wrap: anywhere; }
.box-row.hl { background: #E3E3E3; }
.box-row.hl .v { font-weight: 700; }
.work { margin: 0; padding-left: 20px; }
.att th { background: none; border-bottom: 1.5px solid #000; padding: 2px 6px 3px; font-size: 8.5px; }
.att td { padding: 3px 6px; font-size: 11px; }
.record { display: flex; gap: 32px; flex-wrap: wrap; }
.photo-group { display: flex; align-items: baseline; gap: 8px; font-size: 9.5px; }
.photo-group .g { font-size: 11px; font-weight: 700; }
.photo-row { display: flex; gap: 14px; }
.photo { width: 345px; }
.photo .frame { width: 345px; height: 259px; background: #F2F2F2; overflow: hidden; }
.photo img { width: 345px; height: 259px; object-fit: cover; display: block; }
.photo .missing { width: 345px; height: 259px; display: flex; align-items: center; justify-content: center;
                  font-size: 11px; font-weight: 700; background: #F2F2F2; }
.photo .cap { display: flex; justify-content: space-between; gap: 8px; font-size: 9.5px; margin-top: 4px; }
.photo .cap .n { flex: 0 0 auto; }
`;

const COLS_EVENT = `<colgroup><col style="width:26px"><col style="width:170px"><col style="width:110px"><col style="width:112px"><col></colgroup>`;

function sectionHeading(title, note = "") {
  return `<div class="sec"><h2>${title}</h2>${note ? `<span class="note">${note}</span>` : ""}</div>`;
}

/** Number the photo groups 3a, 3b … and their figures 1 … N in report order. */
function numberGroups(groups) {
  let fig = 1;
  return (groups ?? [])
    .filter((g) => g.photos?.length)
    .map((g, i) => {
      const out = { ...g, letter: `3${String.fromCharCode(97 + i)}`, first: fig, last: fig + g.photos.length - 1 };
      fig = out.last + 1;
      return out;
    });
}

const TYPE_SHORT = { "Periodic (Berkala)": "Periodic", "Re-inspection (Berkala Semula)": "Re-inspection", "Special (Khas)": "Special" };

function eventRow(e, groups, d) {
  const x = e.detail ?? {};
  const slip = groups.find((g) => g.slipOf === e.inspection_id);
  const slipRef = slip ? ` · result slip ${fmtFigRange(slip.first, slip.last)}` : "";
  switch (e.type) {
    case "REGISTERED":
      return ["Inspection registered", `${TYPE_SHORT[d.type] ?? ""} · ${fmtDateTime(x.scheduled_at)}`];
    case "BOOKING_CHANGED":
      return ["Booking changed", x.scheduled_at ? `Moved to ${fmtDateTime(x.scheduled_at.to)}` : "Booking details updated"];
    case "PRECHECK_SUBMITTED":
      return [
        "Pre-inspection completed",
        `${x.checks} of ${x.checks} checks · ${x.photos} photos · ${(x.needs_attention ?? []).length} need attention`,
      ];
    case "RESULT_FAILED":
      return [
        "Inspection result: FAILED",
        `Failed check${(x.failed ?? []).length === 1 ? "" : "s"}: ${(x.failed ?? []).map((f) => `${f.check_id} ${f.label}`).join(", ")}${slipRef}`,
      ];
    case "REINSPECTION_BOOKED":
      return ["Re-inspection booked", `Re-inspection · ${fmtDateTime(x.scheduled_at)}`];
    case "RECHECK_SUBMITTED": {
      const g = groups.filter((gr) => gr.fix && (x.fixed ?? []).some((f) => gr.fix.endsWith(`:${f.check_id}`)));
      const photos = g.length ? ` · Photos ${g.map((gr) => `${gr.letter} · ${fmtFigRange(gr.first, gr.last)}`).join(", ")}` : "";
      return ["Re-check completed", `${(x.fixed ?? []).map((f) => `${f.check_id} ${f.label}`).join(", ")} fixed${photos}`];
    }
    case "RESULT_PASSED":
      return [
        "Inspection result: PASSED",
        x.next_due ? `Next inspection due ${fmtDate(`${x.next_due}T00:00:00+08:00`)} (set automatically)` : slipRef.replace(/^ · /, ""),
      ];
    default:
      return [e.type, ""];
  }
}

/** "YYYY-MM-DD" (a Malaysian calendar day) as a printable date. */
const day = (s) => (s ? fmtDate(`${s}T00:00:00+08:00`) : DASH);

export function buildPuspakomReportHtml(d, { logoHtml, fontCss = "", generatedAt = new Date() }) {
  const plate = d.vehicle?.plate ?? DASH;
  const fleet = d.vehicle?.fleet_no ? String(d.vehicle.fleet_no).trim() : "";
  const ref = escapeHtml(d.ref_no ?? "");
  const groups = numberGroups(d.photo_groups);
  const totalPhotos = groups.reduce((n, g) => n + g.photos.length, 0);
  const attentionGroup = groups.find((g) => g.checks);
  const reinspected = (d.attempts ?? 1) > 1;

  const headers = {
    first: headerHtml({ logoHtml, title: TITLE, refValue: ref, sub: `Issued ${fmtDate(d.issued_at)}` }),
    body: headerHtml({ logoHtml, title: TITLE, refValue: ref, sub: `${escapeHtml(plate)} · continued` }),
    photo: headerHtml({ logoHtml, title: TITLE, refValue: ref, sub: `${escapeHtml(plate)} · Photo evidence` }),
  };
  const items = [];
  const templates = [];

  // ── Vehicle, details and Inspection Summary ──────────────────────────────
  const recheckBy = [...new Set((d.rechecks ?? []).map((r) => r.fixed_by).filter(Boolean))].join(", ");
  const detailRows = [
    ["Type", val(d.type), "Registered by", val(d.registered_by)],
    ["First inspection", fmtDate(d.first_inspection), "Booking ref.", val(d.booking_ref)],
    ["Booked for", fmtDateTime(d.first_inspection), "Pre-inspection", val(d.precheck?.submitted_by)],
    ["Failed checks", d.failed_checks?.length ? escapeHtml(d.failed_checks.join(", ").toUpperCase()) : "None", "Re-check", val(recheckBy)],
  ];
  const summaryRows = [
    ["Reference", ref || DASH],
    ["Result", escapeHtml(d.result ?? DASH)],
    ["Attempts", `${d.attempts ?? 1}${reinspected ? " (re-inspected)" : " (first time)"}`],
    ["Passed", day(d.passed_date)],
    ["First inspection → pass", d.days_to_pass == null ? DASH : `${d.days_to_pass} day${d.days_to_pass === 1 ? "" : "s"}`],
    ["Last passed", day(d.last_passed)],
    ["Due by", day(d.due_by)],
    ["Next due", d.is_periodic ? day(d.next_due) : "Unchanged (Special)"],
  ];
  items.push(item(`<div class="top">
  <div class="top-left">
    <div class="veh-lbl">Vehicle</div>
    <div class="plate">${escapeHtml(plate)}${fleet ? ` <span class="fleet">(${escapeHtml(fleet)})</span>` : ""}</div>
    <div class="model">${val(d.vehicle?.model)}</div>
    <table class="details"><colgroup><col style="width:92px"><col><col style="width:88px"><col></colgroup>
      ${detailRows.map((r, i) => `<tr class="${i % 2 === 0 ? "stripe" : ""}">
        <td>${r[0]}</td><td class="v">${r[1]}</td><td>${r[2]}</td><td class="v">${r[3]}</td></tr>`).join("")}
    </table>
  </div>
  <div class="summary"><div class="t">Inspection Summary</div>
    ${summaryRows.map(([k, v]) => `<div class="r"><span>${k}</span><span class="v">${v}</span></div>`).join("")}
  </div>
</div>`));

  // ── 1 Chronology ──────────────────────────────────────────────────────────
  const evHead = `<table class="ev">${COLS_EVENT}<tr><th>#</th><th>Event</th><th>By</th><th>Date · Time</th><th>Details</th></tr></table>`;
  templates.push(template("cont-ev", item(sectionHeading("1&nbsp;&nbsp;Chronology (continued)", "Oldest first"), { tight: true }) + item(evHead, { tight: true })));
  items.push(item(sectionHeading("1&nbsp;&nbsp;Chronology", "Oldest first"), { keepNext: true, tight: true }));
  items.push(item(evHead, { keepNext: true, tight: true }));
  (d.events ?? []).forEach((e, i) => {
    const [text, detail] = eventRow(e, groups, d);
    items.push(item(`<table class="ev">${COLS_EVENT}<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${i + 1}</td><td class="b">${escapeHtml(text)}</td><td>${val(e.by)}</td><td>${fmtDateTime(e.at)}</td>
      <td>${escapeHtml(detail || "")}</td></tr></table>`, { tight: true, cont: "cont-ev" }));
  });
  items.push(item("", { tight: true }));

  // ── 2 Pre-inspection and re-check ─────────────────────────────────────────
  const sec2 = sectionHeading("2&nbsp;&nbsp;Pre-inspection and re-check", "Full check list with photos stays in the app");
  templates.push(template("cont-s2", item(sectionHeading("2&nbsp;&nbsp;Pre-inspection and re-check (continued)"))));
  items.push(item(sec2, { keepNext: true }));

  const p = d.precheck;
  if (p) {
    const att = p.attention ?? [];
    let fig = attentionGroup ? attentionGroup.first : null;
    const attRows = att.map((a) => {
      const g = attentionGroup;
      const myFig = g && fig != null ? fig++ : null;
      return `<tr><td>${escapeHtml(`${a.check_id} ${a.label}`)}</td><td>${escapeHtml(a.stop)}</td><td>${escapeHtml(a.result)}</td>
        <td>${val(a.note)}</td><td>${myFig ?? DASH}</td></tr>`;
    });
    const rows = [
      `<div class="box-row"><div class="k">Inspected by</div><div class="v">${val(p.submitted_by)}${p.declared ? " · declaration ticked" : ""}</div></div>`,
      `<div class="box-row"><div class="k">Result</div><div class="v">${p.done} of ${p.total} checks done · ${p.photos} photos · ${att.length} need attention${att.length ? " (listed below)" : ""}</div></div>`,
      ...(p.remarks ? [`<div class="box-row"><div class="k">Remarks</div><div class="v">${escapeHtml(p.remarks)}</div></div>`] : []),
      ...(att.length
        ? [`<div class="box-row"><div class="k">Needs attention (${att.length})</div><div class="v"><table class="att">
            <colgroup><col><col style="width:80px"><col style="width:130px"><col style="width:110px"><col style="width:30px"></colgroup>
            <tr><th>Check</th><th>Stop</th><th>Result</th><th>Note</th><th>Fig.</th></tr>${attRows.join("")}</table></div></div>`]
        : []),
    ];
    items.push(item(`<div class="box">
      <div class="box-h"><span class="name">Pre-inspection · ${p.total} checks · ${p.stops} stops</span>
        <span class="meta"><b>SUBMITTED</b> · ${fmtDateTime(p.submitted_at)}</span></div>${rows.join("")}</div>`, { cont: "cont-s2" }));
  } else {
    items.push(item(`<div class="box"><div class="box-h"><span class="name">Pre-inspection</span><span class="meta">Not recorded</span></div></div>`, { cont: "cont-s2" }));
  }

  for (const r of d.rechecks ?? []) {
    const slip = groups.find((g) => g.slipOf === r.slip_inspection_id);
    const fix = groups.find((g) => g.fix === r.key);
    const lines = workDoneLines(r.fixed);
    const work = !lines.length ? DASH : lines.length === 1 ? escapeHtml(lines[0])
      : `<ol class="work">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ol>`;
    items.push(item(`<div class="box">
      <div class="box-h"><span class="name">Re-check after fail · ${escapeHtml(r.check)}</span>
        <span class="meta"><b>${r.fixed ? "DONE" : "OPEN"}</b> · ${fmtDateTime(r.done_at)}</span></div>
      <div class="box-row hl"><div class="k">Failed at PUSPAKOM</div><div class="v">${escapeHtml(r.check)} · ${day(r.failed_on)} · found: ${escapeHtml(r.found)}${slip ? ` (slip ${fmtFigRange(slip.first, slip.last)})` : ""}</div></div>
      <div class="box-row"><div class="k">What was fixed</div><div class="v">${work}</div></div>
      <div class="box-row"><div class="k">Record</div><div class="v"><div class="record">
        <span>Technician&nbsp;&nbsp;<b>${val(r.fixed_by)}</b></span>
        <span>Photos&nbsp;&nbsp;<b>${fix ? `${fix.letter} · ${fmtFigRange(fix.first, fix.last)} (${fix.photos.length})` : DASH}</b></span>
      </div></div></div>
    </div>`, { cont: "cont-s2" }));
  }

  // ── 3 Photo evidence ──────────────────────────────────────────────────────
  if (groups.length) {
    items.push(item(sectionHeading("3&nbsp;&nbsp;Photo evidence",
      `${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} on <span data-fill="photo-pages"></span>, in the order taken`), { keepNext: true }));
    items.push(item(`<table><colgroup><col><col style="width:90px"><col style="width:60px"><col style="width:90px"></colgroup>
      <tr><th>Group</th><th>Figures</th><th>Photos</th><th>Taken</th></tr>
      ${groups.map((g, i) => `<tr class="${i % 2 === 1 ? "stripe" : ""}"><td>${g.letter} · ${escapeHtml(g.indexTitle)}</td>
        <td>${fmtFigRange(g.first, g.last)}</td><td>${g.photos.length}</td><td>${fmtShortDateTime(g.at)}</td></tr>`).join("")}
    </table>`));

    const photoSec = sectionHeading("3&nbsp;&nbsp;Photo evidence");
    items.push(item(photoSec, { breakBefore: true, pageKind: "photo", keepNext: true }));
    groups.forEach((g) => {
      const line = (cont) => `<div class="photo-group"><span class="g">${g.letter}&nbsp;&nbsp;${escapeHtml(g.title)}${cont ? " (continued)" : ""}</span>
        <span>${val(g.by)} · ${fmtDateTime(g.at)}</span></div>`;
      templates.push(template(`cont-ph-${g.letter}`, item(photoSec) + item(line(true))));
      templates.push(template(`cont-phg-${g.letter}`, item(photoSec)));
      items.push(item(line(false), { keepNext: true, pageKind: "photo", cont: `cont-phg-${g.letter}` }));
      for (let i = 0; i < g.photos.length; i += 2) {
        const cells = g.photos.slice(i, i + 2).map((ph, k) => {
          const img = ph.src
            ? `<div class="frame"><img src="${ph.src}" alt=""></div>`
            : `<div class="missing">Photo not available</div>`;
          return `<div class="photo">${img}<div class="cap"><span>${escapeHtml(ph.caption ?? "")}</span><span class="n">${g.first + i + k}</span></div></div>`;
        }).join("");
        items.push(item(`<div class="photo-row">${cells}</div>`, { pageKind: "photo", cont: `cont-ph-${g.letter}` }));
      }
    });
  }

  return documentHtml({
    css: CSS,
    fontCss,
    headers,
    footer: footerHtml(fmtGenerated(generatedAt)),
    items: items.join("\n"),
    templates: templates.join("\n"),
    title: `${TITLE} ${d.ref_no ?? ""}`,
  });
}
