/**
 * Login form selectors for the application under test — read by global-setup.js and by any suite
 * that opens its own session through utils/login.js `login(page, profile, LOGIN)`.
 *
 * ADAPT: probe the real sign-in page once and replace these values. Every key is optional;
 * utils/login.js falls back to common selectors when one is missing.
 *
 *   username_css           input for the username            (fallback: input[name="username"])
 *   password_css           input for the password            (fallback: input[type="password"])
 *   captcha_css            captcha input, only used when the env profile has `captcha=`
 *   submit_css             the sign-in button                (fallback: a button named `submit_button`)
 *   submit_button          visible text of the sign-in button
 *   otp_prefix             SPLIT OTP: one box per digit with ids #<prefix>1..#<prefix>N. Leave empty
 *                          for a single OTP field (or no OTP at all).
 *   otp_continue_css       button that confirms a split OTP (e.g. a modal's Continue)
 *   dashboard_url_pattern  part of the URL you land on after a successful login. Strongly
 *                          recommended: it is the signal login waits for. Without it login only
 *                          waits for the URL to stop containing "/login".
 *
 * URLs and credentials do NOT belong here: they live in environments/<env>.env.
 */
module.exports = {
  username_css: '#username',
  password_css: '#password',
  submit_css: 'button[type="submit"]',
  submit_button: 'Login',
  otp_prefix: '',
  otp_continue_css: '',
  dashboard_url_pattern: '',
};
