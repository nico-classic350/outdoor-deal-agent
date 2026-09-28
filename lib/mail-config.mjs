export function notificationConfig(env = process.env) {
  const provider = env.GMAIL_SMTP_USER ? 'gmail' : 'resend';
  const required = provider === 'gmail'
    ? ['GMAIL_SMTP_USER', 'GMAIL_SMTP_APP_PASSWORD', 'DEAL_NOTIFY_TO', 'DATABASE_URL']
    : ['RESEND_API_KEY', 'DEAL_NOTIFY_TO', 'DEAL_NOTIFY_FROM', 'DATABASE_URL'];
  const missing = required.filter(name => !env[name]);
  return { provider, configured: missing.length === 0, missing };
}
