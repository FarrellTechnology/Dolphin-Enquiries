import nodemailer from "nodemailer";
import { settings } from "../../utils/settings";
import { assets } from "../../utils";

/**
 * Sends an email using the SMTP configuration from settings.
 * 
 * This function uses the `nodemailer` library to send an email. It retrieves the SMTP configuration 
 * from the application's settings, constructs the email, and sends it with the specified subject, 
 * plain text, and HTML content. The email includes an attachment (the logo image) which is embedded 
 * within the HTML content using a CID (Content-ID) reference.
 * 
 * @param {string} subject - The subject line of the email.
 * @param {string} [text] - The plain text content of the email (optional).
 * @param {string} [html] - The HTML content of the email (optional). If provided, any occurrences of `{{logo}}` 
 *                          will be replaced with an embedded image.
 * 
 * @throws {Error} Throws an error if the SMTP settings are not configured.
 * 
 * @returns {Promise<void>} A promise that resolves when the email has been successfully sent.
 */
export async function sendEmail(subject: string, text?: string, html?: string): Promise<void> {
  const config = await settings.getSMTPConfig();

  // Check if SMTP settings are available
  if (!config) {
    throw new Error('SMTP settings not configured. Please set up your email settings in the tray menu.');
  }

  // Create the email transporter with the SMTP configuration
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  // Define the email attachments (e.g., logo image)
  const attachments = [
    {
      filename: 'logo.png',
      path: assets.image("logo.png"),
      cid: 'logo@dolphin', // Content-ID for embedding the logo in the email body
    }
  ];

  // If HTML content is provided, replace the placeholder {{logo}} with the embedded image
  const updatedHtml = html ? html.replace(/{{logo}}/g, '<img src="cid:logo@dolphin" alt="EFR Travel" />') : undefined;

  // Send the email
  const info = await transporter.sendMail({
    from: `"Dolphin Enquiries" <${config.user}>`, // Sender address
    to: config.to, // Recipient address
    subject, // Subject line
    text, // Plain text content (optional)
    html: updatedHtml, // HTML content with embedded logo (optional)
    attachments, // Attachments (in this case, the logo image)
  });

  console.debug("Email sent:", info.messageId); // Log the message ID for reference
}
