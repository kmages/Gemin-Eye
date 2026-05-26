import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("exports/Gemin-Eye-FB-Automation-Options.pdf");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const C = {
  ink:    "#1f2937",
  mute:   "#6b7280",
  brand:  "#4338ca",
  brand2: "#6d28d9",
  brandLight: "#eef2ff",
  rule:   "#e5e7eb",
  green:  "#16a34a",
  greenBg:"#f0fdf4",
  red:    "#dc2626",
  redBg:  "#fef2f2",
  amber:  "#d97706",
  amberBg:"#fffbeb",
  blue:   "#2563eb",
  blueBg: "#eff6ff",
  white:  "#ffffff",
  zebra:  "#f9fafb",
  th:     "#4338ca",
};

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 54, bottom: 54, left: 54, right: 54 },
  info: {
    Title: "Gemin-Eye — Facebook Lead Automation: Options Analysis",
    Author: "Gemin-Eye",
    Subject: "Strategic options analysis for Facebook lead monitoring",
  },
});
doc.pipe(fs.createWriteStream(OUT));

const PAGE_W = doc.page.width;
const PAGE_H = doc.page.height;
const M = doc.page.margins;
const CONTENT_W = PAGE_W - M.left - M.right;

function ensureSpace(needed) {
  if (doc.y + needed > PAGE_H - M.bottom) doc.addPage();
}

function h1(text) {
  ensureSpace(40);
  doc.fillColor(C.brand).font("Helvetica-Bold").fontSize(20).text(text, { align: "left" });
  doc.moveDown(0.3);
  doc.strokeColor(C.brandLight).lineWidth(2).moveTo(M.left, doc.y).lineTo(M.left + CONTENT_W, doc.y).stroke();
  doc.moveDown(0.6);
}

function h2(text) {
  ensureSpace(34);
  doc.moveDown(0.4);
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(13).text(text);
  doc.moveDown(0.3);
}

function h3(text) {
  ensureSpace(26);
  doc.moveDown(0.2);
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(11).text(text);
  doc.moveDown(0.2);
}

function p(text, opts = {}) {
  doc.fillColor(C.ink).font("Helvetica").fontSize(10.5).text(text, { align: "left", lineGap: 2, ...opts });
  doc.moveDown(0.4);
}

function bullets(items, opts = {}) {
  doc.fillColor(C.ink).font("Helvetica").fontSize(10.5);
  for (const it of items) {
    ensureSpace(16);
    doc.text("•  ", { continued: true, indent: opts.indent || 8, lineGap: 2 });
    doc.text(it, { lineGap: 2 });
  }
  doc.moveDown(0.3);
}

function calloutBox(title, body, accent, bg) {
  const startY = doc.y;
  ensureSpace(70);
  const x = M.left, w = CONTENT_W;
  const pad = 10;
  const innerW = w - pad * 2 - 4;

  // measure
  doc.font("Helvetica-Bold").fontSize(11);
  const titleH = title ? doc.heightOfString(title, { width: innerW }) + 6 : 0;
  doc.font("Helvetica").fontSize(10);
  let bodyH = 0;
  if (Array.isArray(body)) {
    for (const line of body) {
      bodyH += doc.heightOfString("•  " + line, { width: innerW, lineGap: 2 }) + 2;
    }
  } else if (body) {
    bodyH = doc.heightOfString(body, { width: innerW, lineGap: 2 });
  }
  const boxH = pad * 2 + titleH + bodyH;

  if (doc.y + boxH > PAGE_H - M.bottom) doc.addPage();

  const top = doc.y;
  doc.rect(x, top, w, boxH).fill(bg);
  doc.rect(x, top, 4, boxH).fill(accent);

  doc.fillColor(accent).font("Helvetica-Bold").fontSize(11);
  let cy = top + pad;
  if (title) {
    doc.text(title, x + pad + 4, cy, { width: innerW });
    cy = doc.y + 2;
  }
  doc.fillColor(C.ink).font("Helvetica").fontSize(10);
  if (Array.isArray(body)) {
    for (const line of body) {
      doc.text("•  " + line, x + pad + 4, cy, { width: innerW, lineGap: 2 });
      cy = doc.y + 2;
    }
  } else if (body) {
    doc.text(body, x + pad + 4, cy, { width: innerW, lineGap: 2 });
  }
  doc.y = top + boxH + 10;
  doc.x = M.left;
}

function verdictPill(label, color) {
  const padX = 5, padY = 2;
  doc.font("Helvetica-Bold").fontSize(8);
  const w = doc.widthOfString(label) + padX * 2;
  const h = 11;
  const y = doc.y - 14;
  const x = M.left + CONTENT_W - w;
  doc.roundedRect(x, y, w, h, 5).fill(color);
  doc.fillColor(C.white).text(label, x + padX, y + padY - 0.5, { lineBreak: false });
  doc.fillColor(C.ink);
}

function optionCard({ title, verdict, verdictColor, accent, bg, desc, pros, cons }) {
  ensureSpace(160);
  const startY = doc.y;
  const x = M.left, w = CONTENT_W;
  const pad = 10;
  const innerW = w - pad * 2 - 4;

  // measure
  doc.font("Helvetica-Bold").fontSize(12);
  const titleH = doc.heightOfString(title, { width: innerW - 70 });
  doc.font("Helvetica-Oblique").fontSize(9.5);
  const descH = doc.heightOfString(desc, { width: innerW }) + 4;
  doc.font("Helvetica-Bold").fontSize(10);
  const labelH = doc.heightOfString("Pros") + 2;
  doc.font("Helvetica").fontSize(10);
  const halfW = innerW / 2 - 6;
  let prosH = 0, consH = 0;
  for (const it of pros) prosH += doc.heightOfString("• " + it, { width: halfW, lineGap: 1 }) + 2;
  for (const it of cons) consH += doc.heightOfString("• " + it, { width: halfW, lineGap: 1 }) + 2;
  const colsH = labelH + Math.max(prosH, consH);
  const boxH = pad * 2 + titleH + descH + colsH + 8;

  if (doc.y + boxH > PAGE_H - M.bottom) doc.addPage();

  const top = doc.y;
  doc.rect(x, top, w, boxH).fill(bg);
  doc.rect(x, top, 4, boxH).fill(accent);

  // title row
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(12);
  doc.text(title, x + pad + 4, top + pad, { width: innerW - 70 });
  // verdict pill (right side)
  const pillPadX = 6, pillPadY = 2.5;
  doc.font("Helvetica-Bold").fontSize(8);
  const pillW = doc.widthOfString(verdict) + pillPadX * 2;
  const pillH = 13;
  const pillX = x + w - pad - pillW;
  const pillY = top + pad + 1;
  doc.roundedRect(pillX, pillY, pillW, pillH, 6).fill(verdictColor);
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(8)
     .text(verdict, pillX + pillPadX, pillY + pillPadY, { lineBreak: false });

  // description
  let cy = top + pad + titleH + 6;
  doc.fillColor(C.mute).font("Helvetica-Oblique").fontSize(9.5);
  doc.text(desc, x + pad + 4, cy, { width: innerW });
  cy = doc.y + 6;

  // Two columns
  const colX1 = x + pad + 4;
  const colX2 = x + pad + 4 + halfW + 12;

  doc.fillColor(C.green).font("Helvetica-Bold").fontSize(10).text("Pros", colX1, cy);
  doc.fillColor(C.red).text("Cons", colX2, cy);
  let listY = cy + labelH + 2;

  doc.font("Helvetica").fontSize(10).fillColor(C.ink);
  let py = listY, cyy = listY;
  for (const it of pros) {
    doc.fillColor(C.green).text("•", colX1, py, { continued: false, lineBreak: false });
    doc.fillColor(C.ink).text(it, colX1 + 8, py, { width: halfW - 8, lineGap: 1 });
    py = doc.y + 2;
  }
  for (const it of cons) {
    doc.fillColor(C.red).text("•", colX2, cyy, { continued: false, lineBreak: false });
    doc.fillColor(C.ink).text(it, colX2 + 8, cyy, { width: halfW - 8, lineGap: 1 });
    cyy = doc.y + 2;
  }

  doc.y = top + boxH + 8;
  doc.x = M.left;
}

function table(headers, rows, colWidthsPct) {
  const totalW = CONTENT_W;
  const colWidths = colWidthsPct.map(p => totalW * p);
  const rowPadX = 6, rowPadY = 5;

  function measureRow(cells, font, size) {
    doc.font(font).fontSize(size);
    let maxH = 0;
    cells.forEach((cell, i) => {
      const h = doc.heightOfString(String(cell), { width: colWidths[i] - rowPadX * 2 });
      if (h > maxH) maxH = h;
    });
    return maxH + rowPadY * 2;
  }

  // header
  const hH = measureRow(headers, "Helvetica-Bold", 9.5);
  ensureSpace(hH + 24);
  let y = doc.y;
  let x = M.left;
  doc.rect(M.left, y, totalW, hH).fill(C.th);
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(9.5);
  headers.forEach((h, i) => {
    doc.text(h, x + rowPadX, y + rowPadY, { width: colWidths[i] - rowPadX * 2 });
    x += colWidths[i];
  });
  y += hH;

  // rows
  doc.fillColor(C.ink).font("Helvetica").fontSize(9.5);
  rows.forEach((row, idx) => {
    const rH = measureRow(row.map(c => (typeof c === "object" && c.t) ? c.t : c), "Helvetica", 9.5);
    if (y + rH > PAGE_H - M.bottom) {
      doc.addPage();
      y = M.top;
    }
    if (idx % 2 === 1) doc.rect(M.left, y, totalW, rH).fill(C.zebra);
    x = M.left;
    row.forEach((cell, i) => {
      const text = typeof cell === "object" ? cell.t : cell;
      const color = typeof cell === "object" ? (cell.c || C.ink) : C.ink;
      const bold = typeof cell === "object" ? !!cell.b : (i === 0);
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(color);
      doc.text(text, x + rowPadX, y + rowPadY, { width: colWidths[i] - rowPadX * 2 });
      x += colWidths[i];
    });
    // bottom border
    doc.strokeColor(C.rule).lineWidth(0.5).moveTo(M.left, y + rH).lineTo(M.left + totalW, y + rH).stroke();
    y += rH;
  });
  doc.y = y + 8;
  doc.x = M.left;
}

function phaseCard(label, labelColor, title, items, bg = C.brandLight, border = "#c7d2fe") {
  ensureSpace(120);
  const pad = 10;
  const x = M.left, w = CONTENT_W;
  const innerW = w - pad * 2;

  // measure
  doc.font("Helvetica-Bold").fontSize(8);
  const labelW = doc.widthOfString(label) + 14;
  const labelH = 13;
  doc.font("Helvetica-Bold").fontSize(11.5);
  const titleH = doc.heightOfString(title, { width: innerW });
  doc.font("Helvetica").fontSize(10);
  let itemsH = 0;
  for (const it of items) itemsH += doc.heightOfString("• " + it, { width: innerW - 6, lineGap: 1 }) + 3;
  const boxH = pad * 2 + labelH + 6 + titleH + 4 + itemsH;

  if (doc.y + boxH > PAGE_H - M.bottom) doc.addPage();
  const top = doc.y;
  doc.roundedRect(x, top, w, boxH, 5).fillAndStroke(bg, border);

  // label pill
  const px = x + pad, py = top + pad;
  doc.roundedRect(px, py, labelW, labelH, 6).fill(labelColor);
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(8)
     .text(label, px + 7, py + 3, { lineBreak: false });

  // title
  let cy = py + labelH + 6;
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(11.5)
     .text(title, x + pad, cy, { width: innerW });
  cy = doc.y + 4;

  // items
  doc.font("Helvetica").fontSize(10).fillColor(C.ink);
  for (const it of items) {
    doc.fillColor(labelColor).text("•", x + pad, cy, { continued: false, lineBreak: false });
    doc.fillColor(C.ink).text(it, x + pad + 10, cy, { width: innerW - 10, lineGap: 1 });
    cy = doc.y + 3;
  }
  doc.y = top + boxH + 8;
  doc.x = M.left;
}

// ─── COVER PAGE ────────────────────────────────────────────────
doc.fillColor(C.brand).font("Helvetica-Bold").fontSize(42)
   .text("Gemin-Eye", { align: "center" });
doc.moveDown(0.1);
doc.fillColor(C.mute).font("Helvetica").fontSize(12)
   .text("AI-powered customer acquisition", { align: "center" });
doc.moveDown(4);

// gradient-ish title block
const tbTop = doc.y;
const tbX = M.left + 20;
const tbW = CONTENT_W - 40;
const tbH = 100;
doc.roundedRect(tbX, tbTop, tbW, tbH, 8).fill(C.brand);
doc.fillColor(C.white).font("Helvetica-Bold").fontSize(22)
   .text("Facebook Lead Automation", tbX, tbTop + 28, { width: tbW, align: "center" });
doc.fillColor(C.white).font("Helvetica").fontSize(12)
   .text("Strategic options analysis & recommendation", tbX, tbTop + 60, { width: tbW, align: "center" });
doc.y = tbTop + tbH;
doc.moveDown(6);
doc.fillColor(C.mute).font("Helvetica").fontSize(10)
   .text("Prepared for client review", { align: "center" })
   .text("Following the meeting on lead-generation automation", { align: "center" });

doc.addPage();

// ─── 1. EXECUTIVE SUMMARY ──────────────────────────────────────
h1("1. Executive Summary");

calloutBox(
  "The question",
  "How should Gemin-Eye deliver Facebook private-group lead monitoring in a way that is reliable, professional, legally safe, and economical — without requiring users to perform a manual ritual every day?",
  C.brand, C.brandLight
);

calloutBox(
  "The answer in one paragraph",
  "Six approaches were evaluated. The recommended path is a phased rollout: keep the existing Chrome extension as the scraping mechanism, reposition it behind a polished web \"Inbox\" experience, and pursue direct partnerships with high-value group admins as the long-term premium tier. A centralized VPS bot farm — even a read-only one with fake accounts — should be avoided due to legal exposure, ongoing infrastructure cost ($15k–40k/yr), and the fact that the most valuable private groups will not admit bot accounts in the first place.",
  C.brand, C.brandLight
);

h3("What ships first");
bullets([
  "Week 1: Fix the Reddit geo-targeting bug (Chicago campaigns currently return Kansas/Tennessee leads).",
  "Weeks 1–2: Ship a polished real-time \"Inbox\" web view at app.gemin-eye.com/inbox. Reframe the product as \"your lead inbox\", with the extension acting as invisible plumbing.",
  "Months 2–3: Begin outreach to admins of 5–10 high-value private Facebook groups, offering free Pro accounts in exchange for monitoring rights. Premium-tier moat.",
  "Optional (Month 2–3): A code-signed desktop helper app for users who want true background operation. Only if user research validates demand.",
]);

// ─── 2. PROBLEM CONTEXT ────────────────────────────────────────
h1("2. Problem Context");
p("The previous meeting identified three issues:");
bullets([
  "Manual UX friction. The current Chrome extension requires the user to keep a browser tab open and remember to run it daily. This conflicts with the platform's positioning as effortless automation.",
  "Reddit lead quality. A \"Chicago roofing\" campaign returned 37 leads from Kansas and Tennessee — making the feature unusable for local businesses.",
  "Facebook is the richest source of high-intent leads, but scraping it is technically and legally difficult. During testing, a personal account used to validate the approach was blocked.",
]);
p("This document focuses on issue #3 (Facebook). The Reddit geo-targeting fix is a clear, low-effort engineering task that should be shipped immediately and is not architecturally controversial.");

// ─── 3. OPTIONS EVALUATED ──────────────────────────────────────
h1("3. Options Evaluated");
p("Six approaches were considered. Each is presented with honest pros, cons, and a verdict.");

optionCard({
  title: "Option A — Centralized VPS bot farm with fake accounts",
  verdict: "AVOID",
  verdictColor: C.red,
  accent: C.red, bg: C.redBg,
  desc: "One VPS hosts 100+ headless browsers. Each user gets a dedicated bot using a fake Facebook account the bot creates from scratch, then joins the user's target groups and scrapes posts.",
  pros: [
    "Runs 24/7, no user device required",
    "Eliminates \"user has to remember\" UX problem entirely",
    "Customer's real Facebook account is never touched",
  ],
  cons: [
    "Legal exposure: Meta has actively sued operations doing exactly this (Octopus Data 2021 — $1B+ default judgment; BrandTotal 2022; Power Ventures 2016)",
    "Fake account survival: 1–4 weeks per account in industry experience; constant churn",
    "The valuable groups won't admit fake accounts. Admin-moderated private groups require profile age, mutual friends, real photos, admission questions",
    "Infrastructure cost: $15,000–40,000/yr for VPS + residential proxies + phone-number provisioning",
    "Engineering cost: a near-full-time job keeping the account farm alive (FB changes selectors monthly)",
    "Reputation risk: if it becomes public, Gemin-Eye is \"the company that runs a bot farm\"",
  ],
});

optionCard({
  title: "Option B — Same as A, but read-only scraping",
  verdict: "AVOID",
  verdictColor: C.red,
  accent: C.red, bg: C.redBg,
  desc: "Same architecture as Option A, but the bots only read posts (no posting, liking, or commenting). Users themselves open Facebook in their real account to engage with leads.",
  pros: [
    "Slightly improved bot account survival (~3–4 weeks per fake account vs. ~1 week)",
    "Lower operational complexity than read+write automation",
    "Customer's real Facebook account is still safe",
  ],
  cons: [
    "Legal exposure is identical. Meta's lawsuits explicitly include read-only scrapers. Their ToS §3.2.3 makes no read-vs-write distinction",
    "Account creation is the #1 ban trigger, not behavior. Most fake accounts die at signup before any scraping happens",
    "Joining a group is itself a write action. Doing so at scale across many accounts is one of FB's most-flagged patterns",
    "Group admission problem unchanged. Same private groups still reject empty profiles",
    "Same infrastructure cost as Option A — $15,000–35,000/yr",
  ],
});

optionCard({
  title: "Option C — Status quo: current Chrome extension",
  verdict: "ACCEPTABLE",
  verdictColor: C.amber,
  accent: C.amber, bg: C.amberBg,
  desc: "Users install the Spy Glass Chrome extension and run it manually when browsing Facebook. The extension uses their real account, real IP, real browser fingerprint, and real group memberships.",
  pros: [
    "Zero ban risk: Facebook sees the user themselves browsing their own groups",
    "Zero legal exposure: ToS-compliant browsing automation on the user's own machine",
    "Already works: v1.1.0 ships today, no new build cost",
    "Access to all the valuable groups the user is already a member of",
    "$0 marginal infrastructure cost",
  ],
  cons: [
    "User must remember to open Facebook and run the extension — the core UX complaint",
    "Does not run overnight",
    "Feels manual and \"scrappy\" if marketed as \"run our Chrome extension every day\"",
  ],
});

optionCard({
  title: "Option D — Desktop helper app",
  verdict: "GOOD FIT (PHASE 4)",
  verdictColor: C.blue,
  accent: C.blue, bg: C.blueBg,
  desc: "A small menu-bar app (Electron, ~2–3 weeks of work) that auto-launches with the OS, spawns a hidden Chrome window using the user's existing profile + home IP, and runs the existing extension inside it. The user installs once and never thinks about it again.",
  pros: [
    "Solves the \"user has to remember\" problem without inheriting any new risk",
    "Uses the user's real IP, real browser fingerprint, real session — Facebook sees a normal user",
    "Zero ban risk beyond what's already present from manual use",
    "Zero legal exposure — no fake accounts, no ToS violation",
    "Professional perception equivalent to Slack, Loom, 1Password, Linear, Notion",
  ],
  cons: [
    "Doesn't run when the user's laptop is closed at night (workday-hours coverage only)",
    "Requires a real install, which is friction for some users",
    "Requires code-signing investments (~$400/yr) to avoid OS install warnings on a new-brand app",
    "2–3 weeks of build time",
  ],
});

optionCard({
  title: "Option E — Polished Web Inbox + extension repositioning",
  verdict: "RECOMMENDED (PHASE 1)",
  verdictColor: C.green,
  accent: C.green, bg: C.greenBg,
  desc: "Keep the Chrome extension as the scraping mechanism. Build a beautiful real-time web inbox at app.gemin-eye.com/inbox where leads stream in. Reframe marketing so the inbox becomes the product and the extension becomes invisible plumbing.",
  pros: [
    "Zero new install required — users already have the extension",
    "Zero ban risk, zero legal exposure",
    "Premium feel — same positioning as Superhuman (\"an inbox for X\"), Front, Linear",
    "User's mental model becomes \"I check my Gemin-Eye inbox\" — never thinks about the extension after install day",
    "Shippable in ~1 week — fastest time to market",
    "Generates real user-feedback data to inform Option D vs. F decision later",
  ],
  cons: [
    "Still requires the extension to be running while user browses (so still no overnight coverage)",
    "Some users may still want true 24/7 — addressed via Option D or F as upgrade tiers",
  ],
});

optionCard({
  title: "Option F — Group admin partnerships",
  verdict: "RECOMMENDED (PHASE 2)",
  verdictColor: C.green,
  accent: C.green, bg: C.greenBg,
  desc: "Reach out to admins of 5–10 high-value private Facebook groups. Offer them free Pro accounts in exchange for permission to monitor the group via an admin-installed app or bot account. Frame as a partnership, not a scrape.",
  pros: [
    "True 24/7 coverage of the highest-value groups",
    "Zero ban risk — explicit permission, admin-sanctioned",
    "Zero legal exposure",
    "Builds a moat competitors cannot replicate — relationships compound",
    "Premium positioning: \"we have direct partnerships with these high-value groups\"",
    "Zero install required for the end user",
  ],
  cons: [
    "Slow to scale — sales-driven, one partnership at a time",
    "Only covers a few groups initially (~5–10 in the first year is realistic)",
    "Requires founder/business-development time, not just engineering",
  ],
});

// ─── 4. COMPARISON ─────────────────────────────────────────────
h1("4. Side-by-Side Comparison");

const GR = { t: "✓", c: C.green, b: true };
const RD = { t: "✗", c: C.red,   b: true };
const AM = { t: "~", c: C.amber, b: true };

table(
  ["Dimension", "A: VPS R/W", "B: VPS R/O", "C: Extension", "D: Desktop", "E: Web Inbox", "F: Partners"],
  [
    ["Customer account ban risk",      "None",        "None",        "None",        "None",        "None",        "None"],
    ["Fake-account ban risk",          {t:"High",c:C.red,b:true}, {t:"Med-high",c:C.amber,b:true}, "N/A",         "N/A",         "N/A",         "N/A"],
    ["Legal / Meta lawsuit risk",      {t:"High",c:C.red,b:true}, {t:"High",c:C.red,b:true}, {t:"Low",c:C.green,b:true}, {t:"Low",c:C.green,b:true}, {t:"Low",c:C.green,b:true}, {t:"None",c:C.green,b:true}],
    ["Access to valuable groups",      {t:"Fails",c:C.red,b:true}, {t:"Fails",c:C.red,b:true}, {t:"Already in",c:C.green,b:true}, {t:"Already in",c:C.green,b:true}, {t:"Already in",c:C.green,b:true}, {t:"Sanctioned",c:C.green,b:true}],
    ["24/7 coverage",                  {t:"Yes",c:C.green,b:true}, {t:"Yes",c:C.green,b:true}, {t:"No",c:C.red,b:true}, {t:"Workday",c:C.amber,b:true}, {t:"Workday",c:C.amber,b:true}, {t:"Yes",c:C.green,b:true}],
    ["User install required",          "None",        "None",        "Extension",   "App + ext",   "Existing ext","None"],
    ["Build cost",                     {t:"FTE + $15-40k/yr",c:C.red,b:true}, {t:"FTE + $15-35k/yr",c:C.red,b:true}, {t:"$0 shipped",c:C.green,b:true}, "~3 wks + $400/yr", "~1 wk",       "BD time only"],
    ["Lead quality",                   {t:"Low",c:C.red,b:true}, {t:"Low",c:C.red,b:true}, {t:"High",c:C.green,b:true}, {t:"High",c:C.green,b:true}, {t:"High",c:C.green,b:true}, {t:"Very high",c:C.green,b:true}],
    ["Brand perception risk",          {t:"High",c:C.red,b:true}, {t:"High",c:C.red,b:true}, {t:"Medium",c:C.amber,b:true}, {t:"Low",c:C.green,b:true}, {t:"Low",c:C.green,b:true}, {t:"Premium",c:C.green,b:true}],
  ],
  [0.22, 0.13, 0.13, 0.13, 0.13, 0.13, 0.13]
);

// ─── 5. CONCERNS ───────────────────────────────────────────────
h1("5. Concerns Raised & How to Address Them");
p("Over the course of the analysis, several legitimate concerns were raised about the recommended path. Each is addressed directly below.");

calloutBox(
  "Concern 1: \"Asking users to run a Chrome extension every day is not professional.\"",
  "The current Spy Glass requires the user to keep a browser tab open and remember to run the extension daily. This feels manual and may damage the brand perception of effortless automation.",
  C.amber, C.amberBg
);
calloutBox(
  "How it's addressed",
  "Valid concern, but the issue is the manual ritual, not the extension itself. Apollo.io ($99/mo), Grammarly ($30/mo), Clay, Clearbit, and ZoomInfo all ship browser extensions and are perceived as premium B2B tools. The fix is repositioning: instead of \"run our Chrome extension every day\" (feels like a hack), the message becomes \"Your Gemin-Eye Inbox — leads stream in while you work\" (feels like a product). The Web Inbox in Option E makes the extension invisible. Users open app.gemin-eye.com/inbox, see leads in real-time, and never think about the underlying mechanism — exactly like Slack users don't think about WebSockets.",
  C.green, C.greenBg
);

calloutBox(
  "Concern 2: \"Nobody wants to install a desktop app — they suspect it of being a money stealer or account stealer.\"",
  "End users may be reluctant to install unfamiliar desktop software due to security concerns.",
  C.amber, C.amberBg
);
calloutBox(
  "How it's addressed",
  "Partially valid for consumer software downloaded from unknown websites. Significantly overstated for B2B SaaS in 2026. Install bases of apps with permissions equal to or greater than what Gemin-Eye would request: Slack 35M+ daily users (reads all work conversations), Zoom 300M+ daily users, 1Password 100k+ business customers (holds every password), Notion/Linear/Figma/Loom each tens of millions. Importantly, the Web Inbox (Option E, the Phase 1 recommendation) requires NO desktop install at all. This concern only applies to Option D (desktop helper), which is positioned as a later, optional upgrade — not the first ship.",
  C.green, C.greenBg
);

calloutBox(
  "Concern 3: \"Those apps are verified — Gemin-Eye is new, users don't trust us yet.\"",
  "Slack, Zoom, and others have brand recognition that a new SaaS does not. New apps face a trust gap.",
  C.amber, C.amberBg
);
calloutBox(
  "How it's addressed",
  "The cold-start trust problem is real, but it is solved with standard trust signals (~$400/yr + a few days of work), not by avoiding installs. Many SaaS startups launched desktop apps with no prior brand: Raycast, Linear, Arc, Cron, Superhuman, Cursor. Trust investments: Apple Developer ID + macOS notarization ($99/yr) removes \"unidentified developer\" warning. Windows EV code-signing cert (~$300/yr) removes SmartScreen warning. Public /security page explains exactly what the app does and does not access. Privacy policy reassures on data handling. Free trial without credit card lowers commitment. Open-sourcing the client maximizes transparency. 1-2 customer testimonials are the single biggest trust signal in SaaS. Also: users already trust Gemin-Eye enough to have installed the Chrome extension, which has equivalent or greater permissions than a sandboxed desktop app. The trust ask is not new — it's an upgrade.",
  C.green, C.greenBg
);

calloutBox(
  "Concern 4: \"What about the 24/7 coverage problem? Desktop helper only runs when the laptop is on.\"",
  "For users who want truly always-on monitoring, even a desktop helper has gaps.",
  C.amber, C.amberBg
);
calloutBox(
  "How it's addressed",
  "This is exactly what Option F (group admin partnerships) solves, and it's the only path that provides true 24/7 coverage without legal or ban risk. Partner with admins of 5–10 high-value groups per year in exchange for free Pro tier. The user benefits from continuous monitoring of the most important groups in their niche, without installing anything or relying on their own device being on. This becomes the Enterprise tier offering — priced higher than Pro, with a real and defensible value proposition competitors cannot copy.",
  C.green, C.greenBg
);

calloutBox(
  "Concern 5: \"The VPS bot will only scrape (read-only), not post. Users log in themselves. Isn't that safe?\"",
  "If the bot only reads and the user does all interaction from their real account, surely the risk is much lower?",
  C.amber, C.amberBg
);
calloutBox(
  "How it's addressed",
  "Read-only is genuinely lower-risk than read-write, but the savings are smaller than they appear. Fake account creation — Facebook's #1 enforcement target — still happens, with the same datacenter-IP and fingerprint problems. Most fake accounts die before they ever scrape anything. Joining a group is itself a write action; the bot must perform writes (join group, answer admission questions) just to gain read access. Legal exposure is identical: Meta's biggest scraping lawsuits (Octopus Data 2021, BrandTotal 2022, Power Ventures 2016) were all against read-only operations. The valuable groups still reject fake accounts regardless of what the bot plans to do once inside. The read-only choice changes Options A and B from a 9/10 risk to a 6/10 risk. The recommended Options C/D/E/F are all 1–2/10 risk. The comparison is not \"read-only VPS vs read-write VPS\" — it is \"read-only VPS vs the non-VPS options,\" and the non-VPS options still win on every dimension that determines business viability.",
  C.green, C.greenBg
);

// ─── 6. RECOMMENDED PATH ──────────────────────────────────────
h1("6. Recommended Path Forward");
p("A phased rollout that ships value immediately, gathers real user data to inform later decisions, and avoids irreversible commitments.");

phaseCard("PHASE 1 — THIS WEEK", C.brand, "Ship the foundation", [
  "Fix the Reddit geo-targeting bug. This is the most damaging known issue. Adding a service-area field to businesses, auto-routing to city-specific subreddits, and post-filtering by location mention is ~2–3 hours of work. Restores trust with local-business customers immediately.",
  "Validate user demand with a 1-question survey to 5–10 current users about their preferred FB workflow.",
]);

phaseCard("PHASE 2 — WEEKS 1–2", C.brand, "Reframe and polish", [
  "Build the Web Inbox at app.gemin-eye.com/inbox — real-time lead feed, filters, mark-as-read, \"open post in Facebook\" button, intent-score visualization.",
  "Reframe all marketing from \"run our extension\" to \"your Gemin-Eye inbox.\" Update the landing page, onboarding flow, Telegram messages, and dashboard copy.",
  "Add a polished onboarding wizard that installs the extension behind the scenes.",
]);

phaseCard("PHASE 3 — MONTHS 2–3 (PARALLEL)", C.brand, "Build the long-term moat", [
  "Start group admin outreach. Aim for 1 partnership per month in the first 6 months. Focus on the verticals already represented in the customer base.",
  "Build a simple \"admin app\" — an installable bot the partnering group admins can add to their groups, with explicit permission flow and a Gemin-Eye admin dashboard.",
  "Introduce a new Enterprise tier ($299–499/mo) that includes access to partnered groups.",
]);

phaseCard("PHASE 4 — CONDITIONAL, MONTH 3+", C.blue, "Desktop helper (only if validated)", [
  "If user feedback after Phase 2 indicates strong demand for true background operation, build the desktop helper (Electron, ~2–3 weeks).",
  "Code-sign for both macOS (Apple Developer ID + notarization) and Windows (EV cert).",
  "Position as a Pro-tier perk, not a requirement.",
]);

phaseCard("DO NOT PURSUE", C.red, "VPS bot farm (Options A and B)", [
  "The legal exposure (Meta has actively sued operations doing exactly this) is not worth the small operational upside.",
  "The valuable groups will not admit fake accounts, so the leads obtained would be low-quality regardless.",
  "Infrastructure cost ($15–40k/yr) plus engineering attention to keep accounts alive would consume Pro-tier margin and engineering capacity that should go into Phases 2 and 3.",
], C.redBg, "#fecaca");

// ─── 7. DECISIONS NEEDED ──────────────────────────────────────
h1("7. Decisions Needed From the Client");
bullets([
  "Sign-off on Phase 1 and 2. These are non-controversial: a critical bug fix and a UX polish pass.",
  "Approval to begin group admin outreach (Phase 3). Requires founder/BD time, not just engineering.",
  "Confirmation that the VPS bot farm path is not pursued. Removes a distraction and lets engineering focus on the recommended path.",
  "Decision on user survey approach — whether to run the 1-question survey internally or have Gemin-Eye coordinate it.",
]);

calloutBox(
  "Closing note",
  "The Facebook lead automation problem has no perfect solution — every option carries some tradeoff. The recommended phased path is chosen because each phase is independently valuable, none requires irreversible architectural commitment, and the riskier options (Phase 4 desktop helper, Phase 3 partnerships) are only pursued after real user data confirms demand. This minimizes regret risk while shipping useful product to users quickly.",
  C.green, C.greenBg
);

doc.moveDown(0.5);
doc.fillColor(C.mute).font("Helvetica-Oblique").fontSize(8.5)
   .text("Prepared in response to the lead-generation automation discussion. All cost figures are industry-typical estimates as of 2026; legal references reflect publicly available court records of Meta enforcement actions against scraping operations.",
         { align: "left" });

doc.end();

await new Promise(res => doc.on("end", res));
console.log("Wrote:", OUT, "(" + fs.statSync(OUT).size + " bytes)");
