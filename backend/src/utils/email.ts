import { Resend } from 'resend';

// Both verification and password-reset emails are "best effort": if Resend
// isn't configured (e.g. local dev without an API key) or the send call
// fails, we log it and let the caller continue rather than blocking
// registration/reset-request on a third-party service being reachable.
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM = process.env.EMAIL_FROM || 'WENET <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function wrapper(title: string, bodyHtml: string) {
  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#0b1418; padding:32px; color:#e9edef;">
    <div style="max-width:480px; margin:0 auto; background:#111b21; border:1px solid #22303a; border-radius:14px; padding:32px;">
      <div style="width:40px; height:40px; border-radius:12px; background:linear-gradient(135deg,#c9873f,#e3a35e); display:flex; align-items:center; justify-content:center; font-weight:700; color:#0b1418; margin-bottom:20px;">W</div>
      <h1 style="font-size:20px; margin:0 0 12px;">${title}</h1>
      ${bodyHtml}
      <p style="font-size:12px; color:#82929b; margin-top:32px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>`;
}

export async function sendVerificationEmail(to: string, token: string, displayName: string) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  if (!resendClient) {
    console.warn(`[email] RESEND_API_KEY not set — verification link for ${to}: ${link}`);
    return;
  }
  try {
    await resendClient.emails.send({
      from: FROM,
      to,
      subject: 'Verify your WENET email',
      html: wrapper(
        `Hi ${displayName}, confirm your email`,
        `<p style="color:#c8d0d4; line-height:1.6;">Tap the button below to verify your email address. This link expires in 24 hours.</p>
         <a href="${link}" style="display:inline-block; margin-top:16px; padding:12px 20px; background:linear-gradient(135deg,#c9873f,#e3a35e); color:#0b1418; font-weight:700; text-decoration:none; border-radius:8px;">Verify email</a>`
      )
    });
  } catch (err) {
    console.error('[email] failed to send verification email', err);
  }
}

export async function sendPasswordResetEmail(to: string, token: string, displayName: string) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  if (!resendClient) {
    console.warn(`[email] RESEND_API_KEY not set — password reset link for ${to}: ${link}`);
    return;
  }
  try {
    await resendClient.emails.send({
      from: FROM,
      to,
      subject: 'Reset your WENET password',
      html: wrapper(
        `Hi ${displayName}, reset your password`,
        `<p style="color:#c8d0d4; line-height:1.6;">Tap the button below to choose a new password. This link expires in 1 hour and can only be used once.</p>
         <a href="${link}" style="display:inline-block; margin-top:16px; padding:12px 20px; background:linear-gradient(135deg,#c9873f,#e3a35e); color:#0b1418; font-weight:700; text-decoration:none; border-radius:8px;">Reset password</a>`
      )
    });
  } catch (err) {
    console.error('[email] failed to send password reset email', err);
  }
}
