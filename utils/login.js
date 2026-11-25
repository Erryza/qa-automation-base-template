const { authenticator } = require('otplib');
const { gotoResilient } = require('./waits');

function isTOTPSecret(value) {
  if (!value || value.length < 16) return false;
  return /^[A-Z2-7\s]+=*$/i.test(value);
}

function resolveOTP(otpValue) {
  if (!otpValue) return null;
  if (isTOTPSecret(otpValue)) {
    return authenticator.generate(otpValue.replace(/\s/g, '').toUpperCase());
  }
  return otpValue;
}

async function login(page, profile, loginConfig = {}) {
  const { url, username, password, otp } = profile;
  const cfg = loginConfig;

  // WHY domcontentloaded + the field, not `load` / `networkidle`, and a 90s budget: on a slow dev
  // server a SPA's blocking app bundle can take ~10s and sometimes > 40s to download, and every new
  // browser context downloads it again — the default 30s fails whole suites in beforeAll. The form
  // is the signal. Every suite's beforeAll funnels through this navigation, and a raw goto() can
  // throw net::ERR_NAME_NOT_RESOLVED on a transient VPN/DNS blip — hence gotoResilient().
  await gotoResilient(page, url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // Username field — prefer explicit CSS from config, then common fallbacks
  const usernameCss = cfg.username_css || 'input[name="username"]';
  await page.locator(usernameCss).waitFor({ state: 'visible', timeout: 45000 });
  await page.locator(usernameCss).fill(username);

  // Password field
  const passwordCss = cfg.password_css || 'input[type="password"]';
  await page.locator(passwordCss).fill(password);

  // Captcha — only when the profile carries one AND the field is on the page.
  // Some dashboards put a captcha on the login form and
  // keep the submit button disabled until it is filled, so skipping this leaves
  // login silently stuck on the form. The value belongs in
  // environments/<env>.env (`captcha=`), never here.
  if (profile.captcha) {
    const captchaCss = cfg.captcha_css || 'input[name="captcha"]';
    const field = page.locator(captchaCss);
    if (await field.count()) await field.first().fill(profile.captcha);
  }

  // Submit — try explicit CSS first, then common button selectors
  const submitCss  = cfg.submit_css;
  const submitText = cfg.submit_button || 'Login';

  let submitted = false;
  if (submitCss) {
    try {
      await page.locator(submitCss).first().click({ timeout: 5000 });
      submitted = true;
    } catch (_) {}
  }
  if (!submitted) {
    const candidates = [
      page.getByRole('button', { name: submitText, exact: false }),
      page.locator('button[type="submit"]'),
      page.locator(`button:has-text("${submitText}")`),
    ];
    for (const loc of candidates) {
      try {
        if ((await loc.count()) > 0 && await loc.first().isVisible({ timeout: 3000 })) {
          await loc.first().click();
          submitted = true;
          break;
        }
      } catch (_) {}
    }
  }
  if (!submitted) throw new Error(`Login: could not find submit button ("${submitText}")`);

  // Split OTP: one box per digit, #<otp_prefix>1..N, optionally confirmed in a modal.
  // Some environments skip the OTP step and go straight to the dashboard, so race the
  // two instead of assuming either. Configured in utils/login-config.js.
  if (cfg.otp_prefix) {
    const dashboard = cfg.dashboard_url_pattern;
    const outcome = await Promise.race([
      page.waitForSelector(`#${cfg.otp_prefix}1`, { timeout: 30000 }).then(() => 'otp').catch(() => 'none'),
      dashboard
        ? page.waitForURL(`**${dashboard}**`, { timeout: 30000 }).then(() => 'dash').catch(() => 'none')
        : new Promise(() => {}),
    ]);
    if (outcome === 'otp') {
      const code = resolveOTP(otp);
      if (!code) throw new Error('Login: the app asked for an OTP but the profile has no `otp=` value');
      for (let i = 0; i < code.length; i++) {
        await page.locator(`#${cfg.otp_prefix}${i + 1}`).fill(code[i]);
      }
      if (cfg.otp_continue_css) await page.locator(cfg.otp_continue_css).first().click();
    }
    if (dashboard) {
      await page.waitForURL(`**${dashboard}**`, { timeout: 30000 });
    }
    await page.waitForLoadState('domcontentloaded');
    console.log(`[login] OK — ${page.url()}`);
    return;
  }

  // Wait until we leave the login page (URL changes)
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle');

  // Handle OTP if a field appears after login
  if (otp) {
    const otpCode = resolveOTP(otp);
    const otpCandidates = [
      page.locator('input[name="otp"]'),
      page.locator('input[autocomplete="one-time-code"]'),
      page.getByPlaceholder('OTP', { exact: false }),
      page.getByPlaceholder('Verification code', { exact: false }),
    ];
    for (const loc of otpCandidates) {
      try {
        if ((await loc.count()) > 0 && await loc.first().isVisible({ timeout: 1500 })) {
          await loc.first().fill(otpCode);
          await page.locator(submitCss).click();
          await page.waitForLoadState('networkidle');
          break;
        }
      } catch (_) {}
    }
  }

  console.log(`[login] OK — ${page.url()}`);
}

module.exports = { login, resolveOTP };
