#!/usr/bin/env bash
# make-tarball.sh — build the distributable lib-theseus.tar.gz.
#
# The tarball is the primary distribution channel — there's no public
# package registry and no public git remote for end users. Host the
# resulting file from the blog post that introduces lib-theseus.
#
# Output: ./lib-theseus.tar.gz
# Contents: the entire repo minus VCS / OS cruft / the tarball itself.
# Top-level directory inside the tarball: `lib-theseus/`.

set -euo pipefail

cd "$(dirname "$0")"

OUT="$(pwd)/lib-theseus.tar.gz"
PARENT="$(cd .. && pwd)"
NAME="$(basename "$(pwd)")"

# Build from the parent so the archive top-level is the project dir.
# Excludes:
#   - .git, .DS_Store        (VCS / OS metadata)
#   - lib-theseus.tar.gz     (the file we're building)
#   - make-tarball.sh        (build infrastructure, not part of distribution)
#   - any *.tar.gz, *.zip    (any other archive hanging around)
tar \
  --exclude='lib-theseus/.git' \
  --exclude='lib-theseus/.DS_Store' \
  --exclude='lib-theseus/lib-theseus.tar.gz' \
  --exclude='lib-theseus/make-tarball.sh' \
  --exclude='lib-theseus/**/.DS_Store' \
  --exclude='lib-theseus/*.zip' \
  -czf "$OUT" \
  -C "$PARENT" "$NAME"

# Sanity print: contents and size.
echo "Built: $OUT"
ls -lh "$OUT" | awk '{print $5, $9}'
echo
echo "Contents:"
tar -tzf "$OUT" | sort
