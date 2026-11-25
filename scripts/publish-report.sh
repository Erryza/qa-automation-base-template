#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS PUBLISHES, AND WHY YOU MUST THINK BEFORE RUNNING IT
#
# It pushes every suite's HTML report AND its full-page screenshots to another
# git repo. Those screenshots are of a live dashboard: they can contain customer
# names, phone numbers, account numbers and balances. On a GitHub Pages site that
# is a public disclosure, and git history keeps it after you delete the file.
#
# Prefer, in this order:
#   1. CI artifacts (.gitlab-ci.yml already keeps them) — access-controlled, expiring
#   2. GitLab Pages on a PRIVATE project
#   3. This script, only for a genuinely non-sensitive environment
#
# So it refuses to run until you say, per invocation, that you accept the target:
#   REPORTS_PUBLIC_ACK=1
# ─────────────────────────────────────────────────────────────────────────────
REPO_URL="${REPORTS_REPO_URL:?set REPORTS_REPO_URL, e.g. https://gitlab.example.com/<group>/<reports-repo>.git}"
BASE_URL="${REPORTS_BASE_URL:?set REPORTS_BASE_URL, e.g. https://<group>.gitlab.io/<reports-repo>}"
BASE_URL="${BASE_URL%/}"

if [ "${REPORTS_PUBLIC_ACK}" != "1" ]; then
  echo "REFUSING TO PUBLISH."
  echo ""
  echo "  Target : ${REPO_URL}"
  echo "  Served : ${BASE_URL}"
  echo ""
  echo "This uploads full-page screenshots of a live dashboard, which may contain"
  echo "customer data. Confirm the target is access-controlled, then re-run with:"
  echo "  REPORTS_PUBLIC_ACK=1 npm run publish:report"
  echo ""
  echo "Safer alternatives: CI artifacts (see .gitlab-ci.yml) or a PRIVATE GitLab Pages project."
  exit 1
fi
TEMP_DIR=$(mktemp -d)
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)/suites"

trap "rm -rf $TEMP_DIR" EXIT

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN is not set."
  echo ""
  echo "Set it with:"
  echo "  export GITHUB_TOKEN=<token with write access to the reports repo>"
  echo ""
  echo "Or add it permanently to ~/.zshrc:"
  echo "  (prefer a per-shell export or your CI's masked variables over ~/.zshrc)"
  echo ""
  echo "REPORTS_REPO_URL and REPORTS_BASE_URL must be set too — see README 'Publish a report'."
  exit 1
fi

echo "Cloning reports repo..."
# Inject the token into the configured URL (https://<host>/<org>/<repo>.git).
AUTH_URL="${REPO_URL/https:\/\//https://${GITHUB_TOKEN}@}"
git clone "$AUTH_URL" "$TEMP_DIR" --quiet

echo "Syncing suites folder..."
rm -rf "$TEMP_DIR/suites"
mkdir -p "$TEMP_DIR/suites"

# Copy only .html files (preserve directory structure)
find "$SOURCE_DIR" -name "*.html" | while read -r file; do
  rel="${file#$SOURCE_DIR/}"
  dest="$TEMP_DIR/suites/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$file" "$dest"
done

# Copy only screenshots folders (preserve directory structure)
find "$SOURCE_DIR" -type d -name "screenshots" | while read -r dir; do
  rel="${dir#$SOURCE_DIR/}"
  dest="$TEMP_DIR/suites/$rel"
  mkdir -p "$(dirname "$dest")"
  cp -r "$dir" "$(dirname "$dest")/"
done

echo "Generating index.html..."
INDEX="$TEMP_DIR/index.html"
TIMESTAMP=$(date '+%d %B %Y, %H:%M')

# Build report links
LINKS=""
while IFS= read -r -d '' report; do
  rel="${report#$TEMP_DIR/}"
  dir=$(dirname "$rel")
  suite="${dir#suites/}"
  module=$(echo "$suite" | cut -d'/' -f1)
  action=$(echo "$suite" | cut -d'/' -f2)
  encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$rel', safe='/'))")
  LINKS="${LINKS}<li><a href=\"${BASE_URL}/${encoded}\"><strong>${module}</strong> — ${action}</a></li>"
done < <(find "$TEMP_DIR/suites" -name "test_report.html" -print0 | sort -z)

cat > "$INDEX" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QA Automation Test Reports</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: #1565C0; color: white; padding: 24px 32px; }
    .header h1 { font-size: 1.6em; font-weight: 600; }
    .header p { opacity: 0.8; margin-top: 6px; font-size: 0.9em; }
    .content { padding: 32px; max-width: 800px; }
    h2 { font-size: 1em; color: #666; text-transform: uppercase;
         letter-spacing: 0.05em; margin-bottom: 16px; }
    ul { list-style: none; }
    li { background: white; border-radius: 8px; margin-bottom: 10px;
         box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    li a { display: block; padding: 16px 20px; color: #1565C0;
           text-decoration: none; font-size: 0.95em; }
    li a:hover { background: #e3f2fd; border-radius: 8px; }
    li a strong { color: #333; }
  </style>
</head>
<body>
  <div class="header">
    <h1>QA Automation Test Reports</h1>
    <p>Last updated: ${TIMESTAMP}</p>
  </div>
  <div class="content">
    <h2>Available Reports</h2>
    <ul>
      ${LINKS}
    </ul>
  </div>
</body>
</html>
HTML

cd "$TEMP_DIR"
git add .

if git diff --staged --quiet; then
  echo "No changes — report is already up to date."
  exit 0
fi

git commit -m "update test reports ${TIMESTAMP}"

echo "Pushing..."
git -c credential.helper= push origin main

echo ""
echo "Published! View at:"
echo "${BASE_URL}/"
