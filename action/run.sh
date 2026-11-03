#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Creates, signs and verifies an OhMyUpdater! manifest. Called by action.yml.
# Every input arrives through an environment variable and is passed to the CLI
# as a separate, quoted argument: inputs are never evaluated as shell code.

set -euo pipefail

fail() {
  echo "::error title=OhMyUpdater!::$1"
  exit 1
}

# Prints the non-empty lines of a multiline input, trimmed, skipping # comments.
lines() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [[ -n "$line" && "$line" != \#* ]]; then printf '%s\n' "$line"; fi
  done <<< "$1"
}

# --- Checks -----------------------------------------------------------------

[[ -n "${INPUT_COMPONENT:-}" ]] || fail 'The "component" input is required.'
[[ -n "${INPUT_VERSION:-}" ]] || fail 'The "version" input is required.'
[[ -n "${INPUT_PUBLIC_KEY:-}" ]] || fail 'The "public-key" input is required.'
[[ -n "${OHMYUPDATER_SECRET_KEY:-}" ]] ||
  fail 'Set the OHMYUPDATER_SECRET_KEY environment variable from a secret (see the action README).'
[[ "${INPUT_RELOAD:-false}" == 'true' || "${INPUT_RELOAD:-false}" == 'false' ]] ||
  fail 'The "reload" input must be "true" or "false".'

node_major="$(node -p 'process.versions.node.split(".")[0]' 2> /dev/null || echo 0)"
((node_major >= 22)) || fail 'Node.js 22 or later is required. Add actions/setup-node before this step.'

# Accept tag names such as v1.2.3, since github.ref_name is the usual source.
version="$INPUT_VERSION"
if [[ "$version" =~ ^v[0-9] ]]; then version="${version#v}"; fi

out_dir="${INPUT_OUTPUT_DIR:-}"
if [[ -z "$out_dir" ]]; then out_dir="$RUNNER_TEMP/ohmyupdater"; fi
mkdir -p "$out_dir"
manifest="$out_dir/latest.json"
signature="$manifest.sig"
public_key="$RUNNER_TEMP/ohmyupdater-trusted.pub"
printf '%s\n' "$INPUT_PUBLIC_KEY" > "$public_key"

# --- CLI --------------------------------------------------------------------

if [[ -n "${OHMYUPDATER_ACTION_CLI:-}" ]]; then
  # Testing only: the CI of this repository runs the action with the local build.
  cli=(node "$OHMYUPDATER_ACTION_CLI")
else
  cli_version="${INPUT_CLI_VERSION:-}"
  [[ "$cli_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ||
    fail "\"cli-version\" must be an exact version such as 1.2.3, got \"$cli_version\"."
  tool_dir="$RUNNER_TEMP/ohmyupdater-cli"
  mkdir -p "$tool_dir"
  echo '{ "private": true }' > "$tool_dir/package.json"
  echo "::group::Install @ohmyopensource/ohmyupdater-cli@$cli_version"
  npm install --prefix "$tool_dir" --ignore-scripts --no-audit --no-fund --no-update-notifier \
    "@ohmyopensource/ohmyupdater-cli@$cli_version"
  # Checks registry signatures and provenance attestations of the installed packages.
  (cd "$tool_dir" && npm audit signatures)
  echo '::endgroup::'
  cli=(node "$tool_dir/node_modules/@ohmyopensource/ohmyupdater-cli/dist/cli.js")
fi

# --- Create -----------------------------------------------------------------

args=(create --component "$INPUT_COMPONENT" --version "$version" --out "$manifest")
check_files=()

if [[ -n "${INPUT_MINIMUM_VERSION:-}" ]]; then
  args+=(--minimum-version "${INPUT_MINIMUM_VERSION#v}")
fi
if [[ -n "${INPUT_NOTES_FILE:-}" ]]; then args+=(--notes-file "$INPUT_NOTES_FILE"); fi
if [[ -n "${INPUT_EXPIRES_IN:-}" ]]; then args+=(--expires-in "$INPUT_EXPIRES_IN"); fi
if [[ -n "${INPUT_BASE_URL:-}" ]]; then args+=(--base-url "$INPUT_BASE_URL"); fi
if [[ "${INPUT_RELOAD:-false}" == 'true' ]]; then args+=(--reload); fi

while IFS= read -r value; do
  args+=(--install "$value")
  check_files+=(--check-file "$value")
done < <(lines "${INPUT_INSTALL:-}")
while IFS= read -r value; do args+=(--store "$value"); done < <(lines "${INPUT_STORE:-}")
while IFS= read -r value; do args+=(--notify "$value"); done < <(lines "${INPUT_NOTIFY:-}")
while IFS= read -r value; do args+=(--requires "$value"); done < <(lines "${INPUT_REQUIRES:-}")

"${cli[@]}" "${args[@]}"

# --- Sign and verify --------------------------------------------------------

"${cli[@]}" sign "$manifest" --out "$signature"

# Never hand over a manifest that clients would reject.
if ! "${cli[@]}" verify "$manifest" --signature "$signature" --public-key "$public_key" \
  --component "$INPUT_COMPONENT" "${check_files[@]}"; then
  rm -f "$manifest" "$signature"
  fail 'The signed manifest does not verify. Check that "public-key" matches OHMYUPDATER_SECRET_KEY.'
fi

{
  echo "manifest=$manifest"
  echo "signature=$signature"
} >> "$GITHUB_OUTPUT"

{
  echo "### OhMyUpdater! manifest"
  echo
  echo "Signed and verified \`$INPUT_COMPONENT\` **$version**."
  echo
  echo '```json'
  cat "$manifest"
  echo '```'
} >> "$GITHUB_STEP_SUMMARY"
