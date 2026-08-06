import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname, "../assets/semcme_logo.png");
const LOGO_CID = "semcme-logo@virtual-library";

let transporter;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTransporter() {
  if (!config.smtp.host) return null;
  if (transporter) return transporter;

  const options = {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure
  };

  if (config.smtp.user && config.smtp.pass) {
    options.auth = {
      user: config.smtp.user,
      pass: config.smtp.pass
    };
  }

  transporter = nodemailer.createTransport(options);
  return transporter;
}

export function buildMagicLinkEmail({ magicLink }) {
  const safeMagicLink = escapeHtml(magicLink);
  const subject = "Your SEMCME Virtual Library Sign-In Link";
  const text = [
    "Use this secure Sign-In Link to access the SEMCME Virtual Library:",
    "",
    magicLink,
    "",
    "This Sign-In Link expires in 15 minutes and can only be used once.",
    "",
    "If you did not request this Sign-In Link, you can ignore this email.",
    "",
    "Southeast Michigan Center for Medical Education",
    "https://semcme.org"
  ].join("\n");

  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>SEMCME Virtual Library Sign-In Link</title>
      </head>
      <body style="margin:0;padding:0;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
          Your secure SEMCME Virtual Library Sign-In Link expires in 15 minutes.
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:52px 18px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border-collapse:collapse;">
                <tr>
                  <td align="center" style="padding:0 0 38px;">
                    <img src="cid:${LOGO_CID}" width="292" alt="Southeast Michigan Center for Medical Education" style="display:block;width:292px;max-width:100%;height:auto;border:0;">
                  </td>
                </tr>
                <tr>
                  <td style="height:6px;background:#13549b;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:64px 36px 0;">
                    <h1 style="margin:0;color:#13549b;font-size:34px;line-height:1.2;font-weight:700;">Access the SEMCME Virtual Library</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 36px 0;">
                    <p style="margin:0 0 24px;color:#000000;font-size:20px;line-height:1.5;">
                      Use the secure Sign-In Link below to view SEMCME virtual lectures, recordings, and program resources.
                    </p>
                    <p style="margin:0;color:#626265;font-size:18px;line-height:1.5;">
                      This Sign-In Link expires in 15 minutes and can only be used once.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:48px 36px 44px;">
                    <a href="${safeMagicLink}" style="display:inline-block;min-width:260px;padding:18px 28px;border-radius:8px;background:#13549b;color:#ffffff;font-size:20px;line-height:1.2;text-align:center;text-decoration:none;font-weight:700;">
                      Open Virtual Library
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 36px 18px;">
                    <p style="margin:0;color:#626265;font-size:17px;line-height:1.5;">
                      If you did not request this Sign-In Link, you can ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return {
    subject,
    text,
    html,
    attachments: [{ filename: "semcme_logo.png", path: LOGO_PATH, cid: LOGO_CID }]
  };
}

export async function sendMagicLinkEmail({ to, magicLink }) {
  const email = buildMagicLinkEmail({ magicLink });
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    console.log(`Virtual Library magic link for ${to}: ${magicLink}`);
    return;
  }

  await activeTransporter.sendMail({
    from: config.smtp.from,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: email.attachments,
    headers: {
      "X-Auto-Response-Suppress": "All"
    }
  });
}
