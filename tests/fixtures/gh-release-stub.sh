#!/usr/bin/env bash
# Deterministic GitHub CLI test double; never contacts GitHub.
set -euo pipefail
if [[ "${GH_TEST_DENY:-false}" == "true" ]]; then
  echo "simulated GitHub API authorization failure" >&2
  exit 1
fi
case "${1:-}" in
  api)
    case "${2:-}" in
      "repos/${REPOSITORY}/git/ref/tags/${RELEASE_TAG}") cat "$GH_TEST_TAG_JSON" ;;
      "repos/${REPOSITORY}/releases/${RELEASE_ID}")
        count=0
        [[ ! -f "$GH_TEST_COUNT" ]] || count="$(cat "$GH_TEST_COUNT")"
        count=$((count + 1))
        printf '%s\n' "$count" > "$GH_TEST_COUNT"
        if [[ -f "$GH_TEST_PUBLISHED" ]]; then
          jq '.draft=false' "$GH_TEST_RELEASE_JSON"
        elif [[ "$count" -eq 2 && "${GH_TEST_MUTATE:-false}" == "true" ]]; then
          jq '.assets[0].digest="sha256:0000000000000000000000000000000000000000000000000000000000000000"' "$GH_TEST_RELEASE_JSON"
        else
          cat "$GH_TEST_RELEASE_JSON"
        fi ;;
      *) echo "Unexpected GitHub API endpoint" >&2; exit 2 ;;
    esac ;;
  release)
    case "${2:-}" in
      download)
        [[ "${3:-}" == "$RELEASE_TAG" ]]
        shift 3
        dest=""
        while (( $# > 0 )); do
          case "$1" in
            --repo) [[ "$2" == "$REPOSITORY" ]]; shift 2 ;;
            --pattern) [[ "$2" == "SHA256SUMS.txt" ]]; shift 2 ;;
            --dir) dest="$2"; shift 2 ;;
            *) exit 2 ;;
          esac
        done
        [[ -n "$dest" ]]
        cp "$GH_TEST_MANIFEST" "$dest/SHA256SUMS.txt" ;;
      edit)
        [[ "${3:-}" == "$RELEASE_TAG" ]]
        [[ "${4:-}" == "--repo" && "${5:-}" == "$REPOSITORY" ]]
        [[ "${6:-}" == "--draft=false" && "${7:-}" == "--latest" ]]
        touch "$GH_TEST_PUBLISHED" ;;
      *) exit 2 ;;
    esac ;;
  *) exit 2 ;;
esac
