import { welcomeEmailHtml } from './welcomeEmail.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

// `yearly` for a yearly subscription, replaced by a yearly one; `creditText` says what credit their unused payment gives.
export function subscriptionReplacementEmail({ names = [], link, testOnly = true, yearly = false, creditText = '' }) {
  const heading = 'Update your Forth Canoe Club subscription';
  const subject = `${testOnly ? '[TEST ONLY] ' : ''}${heading}`;
  const intro = 'We are moving subscription payments to the Forth Canoe Club website. Please use the link below to review your subscription and set up your payments on the new system.';
  const instructions = `Select your replacement items, choose ${yearly ? 'yearly' : 'monthly'} payments and enter your details at checkout. The website will show the current prices and payment dates before you confirm.`;
  const existing = 'Your existing subscription remains in place unless a replacement has been confirmed and its cancellation has been verified. Please do not cancel it yourself or make a second payment if you are unsure whether checkout has completed.';
  const help = 'If you need assistance, please contact treasurer@forthcanoeclub.co.uk.';
  const action = link ? `Review your subscription: ${link}` : 'Your personal subscription link will be included in your invitation.';
  const htmlAction = link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#002147;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">Review your subscription</a></p>
<p style="font-size:13px;overflow-wrap:anywhere">If the button does not work, copy this address into your browser:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
    : `<p>${escapeHtml(action)}</p>`;
  const body = [
    'Dear subscriber,', intro,
    ...(names.length ? ['Your current subscription includes:', ...names.map(name => `- ${name}`)] : []),
    instructions, ...(creditText ? [creditText] : []), action, existing, help, 'Kind regards,\nForth Canoe Club'
  ].join('\n\n');
  const content = `<h1 style="font-size:24px;line-height:1.3;margin:0 0 24px">${heading}</h1>
<p>Dear subscriber,</p><p>${intro}</p>
${names.length ? `<p>Your current subscription includes:</p><ul>${names.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul>` : ''}
<p>${instructions}</p>${creditText ? `<p>${escapeHtml(creditText)}</p>` : ''}${htmlAction}<p>${existing}</p>
<p>If you need assistance, please contact <a href="mailto:treasurer@forthcanoeclub.co.uk">treasurer@forthcanoeclub.co.uk</a>.</p>
<p>Kind regards,<br><strong>Forth Canoe Club</strong></p>`;
  return { subject, body, html: welcomeEmailHtml(content, subject) };
}
