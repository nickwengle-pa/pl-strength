import type { ReportSettings } from "./db";

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const pageSizeCss = (settings: ReportSettings): string =>
  settings.pageSize === "a4" ? "A4" : "letter";

export const brandedHeaderHtml = (settings: ReportSettings): string => {
  const school = settings.schoolName
    ? `<div class="brand-school">${escapeHtml(settings.schoolName)}</div>`
    : "";
  const program = settings.programName
    ? `<div class="brand-program">${escapeHtml(settings.programName)}</div>`
    : "";
  const coach = settings.coachName
    ? `<div class="brand-coach">${escapeHtml(settings.coachName)}</div>`
    : "";
  const logo = settings.logoUrl
    ? `<img class="brand-logo" src="${escapeHtml(settings.logoUrl)}" alt="" crossorigin="anonymous" />`
    : "";
  return `
    <div class="brand-header">
      ${logo}
      <div class="brand-text">
        ${school}
        ${program}
        ${coach}
      </div>
    </div>
  `;
};

export const brandedFooterHtml = (settings: ReportSettings): string =>
  settings.footerNote
    ? `<footer class="report-footer">${escapeHtml(settings.footerNote)}</footer>`
    : "";

export const sharedReportStyles = `
  body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
  h1 { margin: 0 0 8px 0; font-size: 22px; }
  h2 { margin: 16px 0 6px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.12em; color: #374151; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
  p { margin: 2px 0; font-size: 13px; }
  .brand-header { display: flex; align-items: center; gap: 16px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 2px solid #111827; }
  .brand-logo { height: 56px; max-width: 120px; object-fit: contain; }
  .brand-text { display: flex; flex-direction: column; gap: 2px; }
  .brand-school { font-size: 18px; font-weight: 700; }
  .brand-program { font-size: 14px; color: #374151; }
  .brand-coach { font-size: 12px; color: #6b7280; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; }
  thead th { background: #f8fafc; }
  .report-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #d1d5db; font-size: 11px; color: #6b7280; text-align: center; }
`;

/**
 * Render an HTML string into a hidden iframe and trigger window.print().
 * Mirrors the AttendanceV2 PDF export pattern. Returns a promise that
 * resolves once the print dialog has been triggered (or rejected on error).
 */
export const printHtmlInIframe = (html: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.opacity = "0";

    const cleanup = () => {
      window.setTimeout(() => frame.remove(), 1200);
    };

    frame.onload = () => {
      const targetWindow = frame.contentWindow;
      if (!targetWindow) {
        cleanup();
        reject(new Error("Could not open print window."));
        return;
      }
      window.setTimeout(() => {
        try {
          targetWindow.focus();
          targetWindow.print();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          cleanup();
        }
      }, 350);
    };

    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
};
