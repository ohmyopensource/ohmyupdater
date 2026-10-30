#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Cross-verifies signatures between the ohmyupdater CLI and the official
# minisign tool. Run from an empty directory with CLI set to cli/dist/cli.js.

set -euo pipefail
cli() { node "$CLI" "$@"; }

echo '::group::ohmyupdater signs, minisign verifies'
cli keygen --out ours --unencrypted
echo 'pretend installer' > app-setup.exe
cli create --component interop-app --version 1.0.0 \
  --install windows-x86_64=app-setup.exe \
  --base-url https://example.com/releases/v1.0.0/ \
  --out latest.json
OHMYUPDATER_SECRET_KEY="$(cat ours.key)" cli sign latest.json
minisign -V -p ours.pub -m latest.json -x latest.json.sig
echo '::endgroup::'

echo '::group::minisign signs, ohmyupdater verifies'
minisign -G -W -p theirs.pub -s theirs.key
minisign -S -s theirs.key -m latest.json -x theirs.sig
cli verify latest.json --public-key theirs.pub --signature theirs.sig \
  --component interop-app --check-file windows-x86_64=app-setup.exe
echo '::endgroup::'

echo '::group::tampered manifests are rejected by both'
sed -i 's/1\.0\.0/1.0.1/' latest.json
if minisign -V -q -p ours.pub -m latest.json -x latest.json.sig; then
  echo 'minisign accepted a tampered manifest' >&2
  exit 1
fi
if cli verify latest.json --public-key ours.pub --component interop-app; then
  echo 'ohmyupdater accepted a tampered manifest' >&2
  exit 1
fi
echo '::endgroup::'

echo 'Interoperability checks passed.'
