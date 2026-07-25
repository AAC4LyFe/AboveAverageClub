const ADMIN_EMAIL = process.env.ASSESSMENT_ADMIN_EMAIL || 'info@profitablefellows.com';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hasAssessmentResults(payload) {
  return clean(payload.source) === 'assessment_result' && clean(payload.score) !== 'N/A';
}

function buildAdminText(payload) {
  return [
    `Subject: ${clean(payload._subject)}`,
    `Name: ${clean(payload.first_name)} ${clean(payload.last_name)}`.trim(),
    `Email: ${clean(payload.email)}`,
    `Source: ${clean(payload.source)}`,
    `Score: ${clean(payload.score)}/20`,
    `Rank: ${clean(payload.rank)}`,
    `Weakest Dimension: ${clean(payload.weakest_dimension)}`,
    `Strongest Dimension: ${clean(payload.strongest_dimension)}`,
    `Spiritual: ${clean(payload.spiritual_score)}`,
    `Physical: ${clean(payload.physical_score)}`,
    `Intellectual: ${clean(payload.intellectual_score)}`,
    `Social: ${clean(payload.social_score)}`,
    `Emotional: ${clean(payload.emotional_score)}`,
  ].join('\n');
}

function buildResultEmailHtml(payload) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:640px;margin:0 auto;">
      <h1 style="font-family:Georgia,serif;color:#8a6d28;">Your Above Average Assessment Results</h1>
      <p>Your score: <strong>${escapeHtml(payload.score)}/20 — ${escapeHtml(payload.rank)}</strong></p>
      <p><strong>Strongest dimension:</strong> ${escapeHtml(payload.strongest_dimension)}</p>
      <p><strong>Weakest dimension:</strong> ${escapeHtml(payload.weakest_dimension)}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;" />
      <ul>
        <li>Spiritual: ${escapeHtml(payload.spiritual_score)}/4</li>
        <li>Physical: ${escapeHtml(payload.physical_score)}/4</li>
        <li>Intellectual: ${escapeHtml(payload.intellectual_score)}/4</li>
        <li>Social: ${escapeHtml(payload.social_score)}/4</li>
        <li>Emotional: ${escapeHtml(payload.emotional_score)}/4</li>
      </ul>
      <p>Average is the new mediocre. Do one above average thing today.</p>
    </div>
  `;
}

async function sendViaResend({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESULT_EMAIL_FROM;

  if (!apiKey || !from) {
    return { skipped: true, reason: 'Resend is not configured' };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: process.env.RESULT_EMAIL_REPLY_TO || ADMIN_EMAIL,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Resend email failed: ${message}`);
  }

  return { sent: true };
}

async function sendViaWeb3Forms(payload) {
  const accessKey = process.env.WEB3FORMS_ACCESS_KEY;

  if (!accessKey) {
    return { skipped: true, reason: 'Web3Forms is not configured' };
  }

  const response = await fetch(WEB3FORMS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      access_key: accessKey,
      subject: clean(payload._subject),
      from_name: 'Above Average Club',
      ...payload,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    throw new Error(result.message || 'Web3Forms submission failed');
  }

  return { sent: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { success: false, message: 'Method not allowed' });
  }

  const payload = req.body || {};
  const email = clean(payload.email);

  if (!email || !email.includes('@')) {
    return sendJson(res, 400, { success: false, message: 'A valid email address is required.' });
  }

  const requiredKeys = [
    '_subject',
    'first_name',
    'last_name',
    'email',
    'source',
    'score',
    'rank',
    'weakest_dimension',
    'strongest_dimension',
    'spiritual_score',
    'physical_score',
    'intellectual_score',
    'social_score',
    'emotional_score',
  ];
  const missingKeys = requiredKeys.filter((key) => typeof payload[key] !== 'string');
  if (missingKeys.length) {
    return sendJson(res, 400, { success: false, message: `Missing fields: ${missingKeys.join(', ')}` });
  }

  const assessmentResults = hasAssessmentResults(payload);
  const adminConfigured = Boolean(process.env.WEB3FORMS_ACCESS_KEY || (process.env.RESEND_API_KEY && process.env.RESULT_EMAIL_FROM));
  const participantConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESULT_EMAIL_FROM);

  if (!adminConfigured) {
    return sendJson(res, 500, {
      success: false,
      message: 'Email delivery is not configured. Add WEB3FORMS_ACCESS_KEY or RESEND_API_KEY plus RESULT_EMAIL_FROM.',
    });
  }

  if (assessmentResults && !participantConfigured) {
    return sendJson(res, 500, {
      success: false,
      message: 'Result email delivery is not configured. Add RESEND_API_KEY and RESULT_EMAIL_FROM.',
    });
  }

  try {
    const adminText = buildAdminText(payload);
    const deliveries = [];

    if (process.env.RESEND_API_KEY && process.env.RESULT_EMAIL_FROM) {
      deliveries.push(await sendViaResend({
        to: ADMIN_EMAIL,
        subject: clean(payload._subject) || 'AAC Assessment Submission',
        text: adminText,
        html: `<pre style="font-family:monospace;white-space:pre-wrap;">${escapeHtml(adminText)}</pre>`,
      }));
    } else {
      deliveries.push(await sendViaWeb3Forms(payload));
    }

    if (assessmentResults) {
      deliveries.push(await sendViaResend({
        to: email,
        subject: 'Your Above Average Assessment Results',
        text: adminText,
        html: buildResultEmailHtml(payload),
      }));
    }

    return sendJson(res, 200, { success: true, deliveries });
  } catch (error) {
    console.error('Assessment email delivery failed:', error.message);
    return sendJson(res, 502, { success: false, message: 'Email delivery failed. Please try again.' });
  }
};
