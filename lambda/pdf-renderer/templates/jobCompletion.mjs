// Job Completion Report, built to "SKSC Job Completion Report Template Spec
// v1.1": black text, greys for structure, nothing shrunk to fit.
//
// Input: the object sksbus-api queues (buildJobReportData in lambda/index.mjs),
// with each photo's `src` already turned into a data: URI by the handler.

import {
  DASH, escapeHtml, val, fmtDate, fmtDateTime, fmtGenerated, fmtShortDateTime,
  fmtElapsed, fmtDuration, fmtOdometer, fmtPercent, fmtQty, fmtFigRange, workDoneLines,
} from "../lib/format.mjs";
import { documentHtml, headerHtml, footerHtml, item, template } from "../lib/layout.mjs";

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
.ev .total td { border-top: 1.5px solid #000; border-bottom: 0; font-weight: 700; background: #fff; }
.box { border: 1px solid #000; }
.box-h { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
         background: #D9D9D9; padding: 5px 12px; border-bottom: 1px solid #000; }
.box-h .name { font-size: 12px; font-weight: 700; }
.box-h .name .cat { font-weight: 400; margin-left: 10px; }
.box-h .meta { font-size: 11px; text-align: right; }
.box-row { display: flex; border-bottom: 1px solid #BDBDBD; }
.box-row:last-child { border-bottom: 0; }
.box-row .k { flex: 0 0 120px; padding: 6px 12px; border-right: 1px solid #BDBDBD;
              font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.box-row .v { flex: 1 1 auto; min-width: 0; padding: 6px 12px; font-size: 12px; overflow-wrap: anywhere; }
.box-row .v.b { font-weight: 700; }
.box-row.hl { background: #E3E3E3; }
.box-row.hl .v { font-weight: 700; }
.work { margin: 0; padding-left: 20px; }
.work li { margin: 0 0 1px; }
.parts th { background: none; border-bottom: 1.5px solid #000; padding: 2px 6px 3px; font-size: 8.5px; }
.parts td { padding: 3px 6px; font-size: 11px; }
.parts td.num { text-align: right; }
.record { display: flex; gap: 32px; flex-wrap: wrap; }
.record .k { font-size: 11px; }
.overview td { font-size: 11px; }
.photo-group { display: flex; align-items: baseline; gap: 8px; font-size: 9.5px; }
.photo-group .g { font-size: 11px; font-weight: 700; }
.photo-row { display: flex; gap: 14px; }
.photo { width: 345px; }
.photo .frame { width: 345px; height: 259px; background: #F2F2F2; overflow: hidden; }
.photo img { width: 345px; height: 259px; object-fit: cover; display: block; }
.photo .missing { width: 345px; height: 259px; display: flex; align-items: center; justify-content: center;
                  font-size: 11px; font-weight: 700; background: #F2F2F2; }
.photo .fig { text-align: right; font-size: 9.5px; margin-top: 4px; }
`;

const COLS_EVENT = `<colgroup><col style="width:30px"><col><col style="width:150px"><col style="width:130px"><col style="width:70px"></colgroup>`;

const jobTypeLabel = (jt) => (jt === "maintenance" ? "Maintenance" : jt === "repair" ? "Repair" : DASH);
/** "13 · Low-Voltage Electrical & Control System" */
const categoryText = (c) => (c && c.name ? escapeHtml(`${c.no} · ${c.name}`) : DASH);

function sectionHeading(title, note = "") {
  return `<div class="sec"><h2>${title}</h2>${note ? `<span class="note">${note}</span>` : ""}</div>`;
}

/** Spec 11: turnaround, awaiting approval (+%), response, on-site repair. */
export function jobTimes(d) {
  const t = (x) => (x ? new Date(x).getTime() : null);
  const diff = (a, b) => (a != null && b != null ? b - a : null);
  const turnaround = diff(t(d.report_date), t(d.completed_at));
  const approval = d.is_job_order ? null : diff(t(d.report_date), t(d.approved_at));
  return {
    turnaround,
    approval,
    approvalPct: fmtPercent(approval, turnaround),
    response: d.is_job_order ? null : diff(t(d.accepted_at), t(d.arrived_at)),
    onSite: diff(t(d.arrived_at), t(d.completed_at)),
  };
}

/** Event rows with elapsed time and the longest wait marked (first on a tie). */
export function eventRows(events) {
  const sorted = [...events].filter((e) => e.at).sort((a, b) => new Date(a.at) - new Date(b.at));
  // Events with no time (an old job with no arrival time) keep their place
  // in the order the API gave, with no elapsed value.
  const withTime = new Set(sorted);
  const rows = [];
  let prev = null;
  for (const e of events) {
    const elapsed = withTime.has(e) && prev ? new Date(e.at) - new Date(prev.at) : null;
    rows.push({ ...e, elapsed });
    if (withTime.has(e)) prev = e;
  }
  let longest = -1;
  let longestIdx = -1;
  rows.forEach((r, i) => {
    if (r.elapsed != null && r.elapsed > longest) { longest = r.elapsed; longestIdx = i; }
  });
  return rows.map((r, i) => ({ ...r, longest: i === longestIdx && longest > 0 }));
}

function eventText(e) {
  if (e.text === "Technician on site" && e.odometer != null) return `Technician on site · ODO ${fmtOdometer(e.odometer)}`;
  return e.text;
}

/** Photo groups (3a, 3b ...) with running figure numbers across the report. */
export function photoGroups(d) {
  const groups = [];
  if (d.report_photos?.length) {
    groups.push({
      title: "As reported",
      indexTitle: `As reported${d.reporter_role ? ` (${d.reporter_role})` : ""}`,
      by: d.reporter_role || d.reporter_name || d.reported_by,
      at: d.report_date,
      photos: d.report_photos,
    });
  }
  for (const t of d.tasks ?? []) {
    if (!t.photos?.length) continue;
    groups.push({
      task: t.no,
      title: `Task ${t.no} work`,
      indexTitle: `Task ${t.no} work`,
      by: d.technician,
      at: t.completed_at,
      photos: t.photos,
    });
  }
  if (d.after_photos?.length) {
    groups.push({
      title: "After repair",
      indexTitle: "After repair (bus after rectification)",
      by: d.technician,
      at: d.after_photos[d.after_photos.length - 1].at,
      photos: d.after_photos,
    });
  }
  let fig = 1;
  groups.forEach((g, i) => {
    g.letter = `3${String.fromCharCode(97 + i)}`;
    g.first = fig;
    g.last = fig + g.photos.length - 1;
    fig = g.last + 1;
  });
  return groups;
}

export function buildJobCompletionHtml(d, { logoHtml, fontCss = "", generatedAt = new Date() }) {
  const plate = d.vehicle?.plate ?? DASH;
  const fleet = d.vehicle?.fleet_no ? String(d.vehicle.fleet_no).trim() : "";
  const times = jobTimes(d);
  const groups = photoGroups(d);
  const totalPhotos = groups.reduce((s, g) => s + g.photos.length, 0);
  const tasks = d.tasks ?? [];
  const tasksDone = tasks.filter((t) => t.status === "DONE").length;
  const tasksLabel = `${tasksDone} of ${tasks.length} done`;
  const groupForTask = (n) => groups.find((g) => g.task === n);
  const reportedGroup = groups.find((g) => g.title === "As reported");

  const ref = escapeHtml(d.ref_no ?? "");
  const headers = {
    first: headerHtml({ logoHtml, title: "Job Completion Report", refValue: ref, sub: `Issued ${fmtDate(d.issued_at)}` }),
    body: headerHtml({ logoHtml, title: "Job Completion Report", refValue: ref, sub: `${escapeHtml(plate)} · continued` }),
    photo: headerHtml({ logoHtml, title: "Job Completion Report", refValue: ref, sub: `${escapeHtml(plate)} · Photo evidence` }),
  };

  const items = [];
  const templates = [];

  // ── Vehicle, details and Job Summary ──────────────────────────────────
  const detailRows = [
    ["Odometer", fmtOdometer(d.odometer), "Location", val(d.location)],
    ["Reported by", val(d.reported_by), "Approved by", val(d.approved_by)],
    ["Technician", val(d.technician), "Tasks", tasksLabel],
    ["Report date", fmtDateTime(d.report_date), "Completed", fmtDateTime(d.completed_at)],
  ];
  const summaryRows = [
    ["Reference", ref || DASH],
    ["Status", escapeHtml(d.status || "CLOSED")],
    ["Priority", d.priority ? escapeHtml(d.priority) : DASH],
    ["Turnaround", fmtDuration(times.turnaround)],
    ["Awaiting approval", times.approval == null ? DASH
      : `${fmtDuration(times.approval, { compact: true })}${times.approvalPct ? ` · ${times.approvalPct}` : ""}`],
    ["Response", fmtDuration(times.response)],
    ["On-site repair", fmtDuration(times.onSite)],
  ];
  items.push(item(`<div class="top">
  <div class="top-left">
    <div class="veh-lbl">Vehicle</div>
    <div class="plate">${escapeHtml(plate)}${fleet ? ` <span class="fleet">(${escapeHtml(fleet)})</span>` : ""}</div>
    <div class="model">${val(d.vehicle?.model)}</div>
    <table class="details"><colgroup><col style="width:82px"><col><col style="width:82px"><col></colgroup>
      ${detailRows.map((r, i) => `<tr class="${i % 2 === 0 ? "stripe" : ""}">
        <td>${r[0]}</td><td class="v">${r[1]}</td><td>${r[2]}</td><td class="v">${r[3]}</td></tr>`).join("")}
    </table>
  </div>
  <div class="summary"><div class="t">Job Summary</div>
    ${summaryRows.map(([k, v]) => `<div class="r"><span>${k}</span><span class="v">${v}</span></div>`).join("")}
  </div>
</div>`));

  // ── 1 Event log ────────────────────────────────────────────────────────
  const evHead = `<table class="ev">${COLS_EVENT}<tr><th>#</th><th>Event</th><th>By</th><th>Date · Time</th><th class="num">Elapsed</th></tr></table>`;
  templates.push(template("cont-ev", item(sectionHeading("1&nbsp;&nbsp;Event log (continued)", "Longest wait highlighted"), { tight: true }) + item(evHead, { tight: true })));
  items.push(item(sectionHeading("1&nbsp;&nbsp;Event log", "Longest wait highlighted"), { keepNext: true, tight: true }));
  items.push(item(evHead, { keepNext: true, tight: true }));
  const evRows = eventRows(d.events ?? []);
  evRows.forEach((e, i) => {
    const cls = e.longest ? "hl" : i % 2 === 1 ? "stripe" : "";
    items.push(item(`<table class="ev">${COLS_EVENT}<tr class="${cls}">
      <td>${i + 1}</td><td>${escapeHtml(eventText(e))}</td><td>${val(e.by)}</td>
      <td>${fmtDateTime(e.at)}</td><td class="num${e.longest ? " b" : ""}">${i === 0 ? DASH : fmtElapsed(e.elapsed)}</td></tr></table>`,
      { tight: true, cont: "cont-ev", keepNext: i === evRows.length - 1 }));
  });
  items.push(item(`<table class="ev">${COLS_EVENT}<tr class="total"><td colspan="4">Total turnaround (report → completion)</td>
    <td class="num">${fmtDuration(times.turnaround)}</td></tr></table>`, { cont: "cont-ev" }));

  // ── 2 Reported issue and work performed ───────────────────────────────
  const sec2 = `${tasksDone} of ${tasks.length} tasks done`;
  const contSec2 = sectionHeading("2&nbsp;&nbsp;Reported issue and work performed (continued)", sec2);
  const contTasks = `<div class="sub">Tasks completed to solve this issue (continued)</div>`;
  templates.push(template("cont-s2", item(contSec2)));
  templates.push(template("cont-tasks", item(contSec2) + item(contTasks)));

  items.push(item(sectionHeading("2&nbsp;&nbsp;Reported issue and work performed", sec2), { keepNext: true }));
  const reportedMeta = d.is_job_order
    ? `Job order by <b>${val(d.technician)}</b> · ${fmtDateTime(d.report_date)}`
    : `Reported by <b>${val(d.reporter_name)}${d.reporter_role ? ` (${escapeHtml(d.reporter_role)})` : ""}</b> · ${fmtDateTime(d.report_date)}${
        reportedGroup ? ` · Photos ${reportedGroup.letter} · ${fmtFigRange(reportedGroup.first, reportedGroup.last)}` : ""}`;
  items.push(item(`<div class="box">
  <div class="box-h"><span class="name">${d.is_job_order ? "Job order" : "Reported issue"}</span><span class="meta">${reportedMeta}</span></div>
  <div class="box-row"><div class="k">Issue</div><div class="v b">${val(d.issue)}</div></div>
</div>`, { cont: "cont-s2" }));

  items.push(item(`<div class="sub">Tasks completed to solve this issue (${tasks.length})</div>`, { keepNext: true, cont: "cont-s2" }));

  if (tasks.length >= 2) {
    items.push(item(`<table class="overview"><colgroup><col style="width:26px"><col style="width:88px"><col><col style="width:52px"><col style="width:116px"><col style="width:44px"><col style="width:52px"></colgroup>
      <tr><th>#</th><th>Type</th><th>Issue found</th><th>Status</th><th>Completed</th><th>Parts</th><th>Photos</th></tr>
      ${tasks.map((t, i) => `<tr class="${i % 2 === 1 ? "stripe" : ""}"><td>${t.no}</td><td>${jobTypeLabel(t.job_type)}</td><td>${
        t.job_type === "maintenance" ? `Scheduled maintenance · ${categoryText(t.category)}` : val(t.name)}</td>
        <td class="b">${t.status === "DONE" ? "Done" : escapeHtml(t.status)}</td><td>${fmtDateTime(t.completed_at)}</td>
        <td>${t.parts?.length ?? 0}</td><td>${t.photos?.length ?? 0}</td></tr>`).join("")}
    </table>`, { cont: "cont-tasks" }));
  }

  tasks.forEach((t) => {
    const g = groupForTask(t.no);
    // Job type and category ride on the header line, so the task block keeps
    // the spec's rows (and its height).
    const typeSuffix = t.job_type ? ` · ${jobTypeLabel(t.job_type)}` : "";
    const catSuffix = t.category ? `<span class="cat">${categoryText(t.category)}</span>` : "";
    const head = `<div class="box-h"><span class="name">Task ${t.no}${typeSuffix}${catSuffix}</span><span class="meta"><b>${escapeHtml(t.status)}</b> · ${fmtDateTime(t.completed_at)}</span></div>`;
    const headCont = `<div class="box-h"><span class="name">Task ${t.no}${typeSuffix} (continued)${catSuffix}</span><span class="meta"><b>${escapeHtml(t.status)}</b> · ${fmtDateTime(t.completed_at)}</span></div>`;
    const lines = workDoneLines(t.work_done);
    const work = lines.length === 0 ? DASH
      : lines.length === 1 ? escapeHtml(lines[0])
      : `<ol class="work">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ol>`;
    const parts = !t.parts?.length ? "None recorded" : `<table class="parts">
      <colgroup><col style="width:22px"><col style="width:130px"><col><col style="width:44px"><col style="width:40px"></colgroup>
      <tr><th>#</th><th>Part no.</th><th>Description</th><th class="num">Qty</th><th>Unit</th></tr>
      ${t.parts.map((p, i) => `<tr><td>${i + 1}</td><td>${val(p.code)}</td><td>${val(p.name)}</td>
        <td class="num">${fmtQty(p.qty)}</td><td>${val(p.unit)}</td></tr>`).join("")}
    </table>`;
    const rows = [
      t.job_type === "maintenance"
        ? `<div class="box-row"><div class="k">Issue found</div><div class="v">Scheduled maintenance</div></div>`
        : `<div class="box-row"><div class="k">Issue found</div><div class="v b">${val(t.name)}</div></div>`,
      `<div class="box-row"><div class="k">Work done</div><div class="v">${work}</div></div>`,
      `<div class="box-row"><div class="k">Parts used</div><div class="v">${parts}</div></div>`,
      ...(t.remark && String(t.remark).trim()
        ? [`<div class="box-row hl"><div class="k">Follow-up / remark</div><div class="v">${escapeHtml(t.remark)}</div></div>`]
        : []),
      `<div class="box-row"><div class="k">Record</div><div class="v"><div class="record">
        <span>Technician&nbsp;&nbsp;<b>${val(d.technician)}</b></span>
        <span>Photos&nbsp;&nbsp;<b>${g ? `${g.letter} · ${fmtFigRange(g.first, g.last)} (${g.photos.length})` : DASH}</b></span>
      </div></div></div>`,
    ];
    // A task taller than a page is cut between its rows (spec 14.3).
    const splitId = `split-task-${t.no}`;
    const contId = `cont-task-${t.no}`;
    templates.push(template(contId, item(contSec2) + item(contTasks)));
    templates.push(template(`cont-taskrow-${t.no}`, item(contSec2) + item(contTasks) + item(`<div class="box">${headCont}</div>`, { tight: true })));
    templates.push(template(splitId, [
      item(`<div class="box">${head}${rows[0]}</div>`, { tight: true, cont: contId }),
      ...rows.slice(1).map((r) => item(`<div class="box" style="border-top:0">${r}</div>`, { tight: true, cont: `cont-taskrow-${t.no}` })),
    ].join("")));
    items.push(item(`<div class="box">${head}${rows.join("")}</div>`, { cont: contId, split: splitId }));
  });

  // ── 3 Photo evidence: index ───────────────────────────────────────────
  if (groups.length) {
    items.push(item(sectionHeading("3&nbsp;&nbsp;Photo evidence",
      `${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} on <span data-fill="photo-pages"></span>, in the order taken`), { keepNext: true }));
    items.push(item(`<table><colgroup><col><col style="width:90px"><col style="width:60px"><col style="width:90px"></colgroup>
      <tr><th>Group</th><th>Figures</th><th>Photos</th><th>Taken</th></tr>
      ${groups.map((g, i) => `<tr class="${i % 2 === 1 ? "stripe" : ""}"><td>${g.letter} · ${escapeHtml(g.indexTitle)}</td>
        <td>${fmtFigRange(g.first, g.last)}</td><td>${g.photos.length}</td><td>${fmtShortDateTime(g.at)}</td></tr>`).join("")}
    </table>`));

    // ── 3a, 3b ... photo pages ──────────────────────────────────────────
    const photoSec = sectionHeading("3&nbsp;&nbsp;Photo evidence");
    items.push(item(photoSec, { breakBefore: true, pageKind: "photo", keepNext: true }));
    groups.forEach((g) => {
      const groupLine = (cont) => `<div class="photo-group"><span class="g">${g.letter}&nbsp;&nbsp;${escapeHtml(g.title)}${cont ? " (continued)" : ""}</span>
        <span>${val(g.by)} · ${fmtDateTime(g.at)}</span></div>`;
      templates.push(template(`cont-ph-${g.letter}`, item(photoSec) + item(groupLine(true))));
      templates.push(template(`cont-phg-${g.letter}`, item(photoSec)));
      items.push(item(groupLine(false), { keepNext: true, pageKind: "photo", cont: `cont-phg-${g.letter}` }));
      for (let i = 0; i < g.photos.length; i += 2) {
        const pair = g.photos.slice(i, i + 2);
        const cells = pair.map((p, k) => {
          const fig = g.first + i + k;
          const img = p.src
            ? `<div class="frame"><img src="${p.src}" alt=""></div>`
            : `<div class="missing">${escapeHtml(g.title)} photo ${i + k + 1}</div>`;
          return `<div class="photo">${img}<div class="fig">${fig}</div></div>`;
        }).join("");
        items.push(item(`<div class="photo-row">${cells}</div>`, { pageKind: "photo", cont: `cont-ph-${g.letter}` }));
      }
    });
  }

  return documentHtml({
    title: escapeHtml(d.ref_no ?? "Job Completion Report"),
    css: CSS,
    fontCss,
    headers,
    footer: footerHtml(fmtGenerated(generatedAt)),
    items: items.join("\n"),
    templates: templates.join("\n"),
  });
}
