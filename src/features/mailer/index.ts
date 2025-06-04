import nodemailer from "nodemailer";
import { settings } from "../../utils/settings";
import { assets } from "../../utils";

export async function sendEmail(subject: string, text?: string, html?: string): Promise<void> {
  const config = await settings.getSMTPConfig();
  if (!config) {
    throw new Error('SMTP settings not configured. Please set up your email settings in the tray menu.');
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const attachments = [
    {
      filename: 'logo.png',
      path: assets.image("logo.png"),
      cid: 'logo@dolphin'
    }
  ];

  const updatedHtml = html ? html.replace(/{{logo}}/g, '<img src="cid:logo@dolphin" alt="EFR Travel" />') : undefined;

  const info = await transporter.sendMail({
    from: `"Dolphin Enquiries" <${config.user}>`,
    to: config.to,
    subject,
    text,
    html: updatedHtml,
    attachments,
  });

  console.debug("Email sent:", info.messageId);
}
