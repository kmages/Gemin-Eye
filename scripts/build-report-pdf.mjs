import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve("scripts/report.html"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.pdf({
  path: "exports/Gemin-Eye-FB-Automation-Options.pdf",
  format: "Letter",
  printBackground: true,
  margin: { top: "0.7in", bottom: "0.7in", left: "0.7in", right: "0.7in" },
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:9px;color:#6b7280;width:100%;text-align:right;padding-right:0.7in;">Gemin-Eye — Facebook Automation Options</div>`,
  footerTemplate: `<div style="font-size:9px;color:#6b7280;width:100%;text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
});
await browser.close();
console.log("PDF written to exports/Gemin-Eye-FB-Automation-Options.pdf");
