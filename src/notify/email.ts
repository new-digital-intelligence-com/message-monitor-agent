import nodemailer, { type Transporter } from "nodemailer";
import { requireEnv } from "../config/load.js";
import type { AppConfig } from "../types.js";

export function createEmailTransport(smtp: NonNullable<AppConfig["smtp"]>): {
  transporter: Transporter;
  from: string;
} {
  const user = requireEnv(smtp.userEnv);
  const pass = requireEnv(smtp.passwordEnv);
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user, pass },
  });
  return { transporter, from: smtp.from };
}

export async function sendEmailNotification(
  transport: { transporter: Transporter; from: string },
  to: string[],
  subject: string,
  text: string,
): Promise<void> {
  await transport.transporter.sendMail({ from: transport.from, to, subject, text });
}
