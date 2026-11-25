const fs = require('fs');
const path = require('path');

const ENVIRONMENTS = ['dev', 'sit', 'uat'];
const COUNTRIES = ['all', 'id', 'ph'];
const ROOT_DIR = path.resolve(__dirname, '..');

function readProfile(profilePath) {
  if (!profilePath) throw new Error('readProfile() requires an explicit profile path. Use getEnvProfilePath(env).');
  const fullPath = path.resolve(process.cwd(), profilePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Environment profile not found: ${fullPath}\n` +
      `Create it from the template:  cp environments/example.env ${profilePath}\n` +
      `then fill in url / username / password. environments/*.env is git-ignored.`
    );
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const profile = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    if (key) profile[key] = value;
  }

  if (!profile.url)      throw new Error(`Profile is missing required field: url  (file: ${fullPath})`);
  if (!profile.username) throw new Error(`Profile is missing required field: username  (file: ${fullPath})`);
  if (!profile.password) throw new Error(`Profile is missing required field: password  (file: ${fullPath})`);

  return profile;
}

/**
 * Returns the absolute path to the credentials file for the given environment.
 * @param {string} env - 'sit' or 'uat' (case-insensitive)
 */
function getEnvProfilePath(env) {
  const normalized = (env || '').toLowerCase().trim();
  if (!ENVIRONMENTS.includes(normalized)) {
    throw new Error(`Unknown environment "${env}". Valid values: ${ENVIRONMENTS.join(', ')}`);
  }
  return path.join(ROOT_DIR, 'environments', `${normalized}.env`);
}

/**
 * Reads the selected environment name from .selected-env.json (written by global-setup).
 * Falls back to process.env.ENV if the file does not exist.
 */
function getSelectedEnv() {
  const envVar = (process.env.ENV || '').toLowerCase().trim();
  if (ENVIRONMENTS.includes(envVar)) return envVar;

  const selectedEnvFile = path.join(ROOT_DIR, '.selected-env.json');
  if (fs.existsSync(selectedEnvFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(selectedEnvFile, 'utf-8'));
      const env = (data.env || '').toLowerCase().trim();
      if (ENVIRONMENTS.includes(env)) return env;
    } catch (_) {}
  }

  return null;
}

/**
 * Network-bound wait multiplier for the selected environment. SIT/UAT are reached over VPN +
 * corporate network and are consistently slower than local dev — scale actionTimeout /
 * navigationTimeout / expect.timeout and the until()-family defaults up so that real network
 * latency does not masquerade as a missing element or a stuck response. Unknown/unset env = 1
 * (dev's own behaviour, unchanged).
 */
function getTimeoutScale() {
  return ['sit', 'uat'].includes(getSelectedEnv()) ? 2 : 1;
}

/**
 * Reads the selected country from .selected-country.json (written by global-setup).
 * Falls back to process.env.COUNTRY. Defaults to 'all' (run both ID and PH).
 * @returns {'all'|'id'|'ph'}
 */
function getSelectedCountry() {
  const envVar = (process.env.COUNTRY || '').toLowerCase().trim();
  if (COUNTRIES.includes(envVar)) return envVar;

  const selectedCountryFile = path.join(ROOT_DIR, '.selected-country.json');
  if (fs.existsSync(selectedCountryFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(selectedCountryFile, 'utf-8'));
      const country = (data.country || '').toLowerCase().trim();
      if (COUNTRIES.includes(country)) return country;
    } catch (_) {}
  }

  return 'all';
}

/**
 * Derives a variant's country ('id' | 'ph' | null) from an explicit `country`
 * field, else from its `id` suffix (_id/_ph) or `name` (Indonesia/Philippines).
 */
function variantCountry(variant) {
  if (variant && (variant.country === 'id' || variant.country === 'ph')) return variant.country;
  const hint = `${(variant && variant.id) || ''} ${(variant && variant.name) || ''}`;
  if (/_ph\b|phil/i.test(hint)) return 'ph';
  if (/_id\b|indonesia/i.test(hint)) return 'id';
  return null;
}

/**
 * Filters a VARIANTS array by the selected country. Returns the array unchanged
 * when the selection is 'all'.
 */
function filterVariantsByCountry(variants) {
  const selected = getSelectedCountry();
  if (selected === 'all') return variants;
  const filtered = variants.filter(v => variantCountry(v) === selected);
  // A filter that empties the list is a silent no-op: zero describes, zero tests,
  // no results file — and the PREVIOUS run's test_report.html stays on disk looking
  // current. Say so loudly instead.
  if (filtered.length === 0 && variants.length > 0) {
    console.warn(
      `[profile] COUNTRY=${selected} matched none of ${variants.length} variant(s) — ` +
      `this suite will run 0 tests and will NOT regenerate its report.`
    );
  }
  return filtered;
}

module.exports = {
  readProfile,
  getEnvProfilePath,
  getSelectedEnv,
  getTimeoutScale,
  getSelectedCountry,
  filterVariantsByCountry,
  ENVIRONMENTS,
  COUNTRIES,
};
