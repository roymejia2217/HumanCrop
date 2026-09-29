#!/usr/bin/env bash
set -euo pipefail

APPIMAGE_INPUT="${1:?usage: validate-appimage-artifact.sh APPIMAGE LINTER_DIR}"
LINTER_DIR_INPUT="${2:?usage: validate-appimage-artifact.sh APPIMAGE LINTER_DIR}"

fail() {
  printf 'AppImage contract failed: %s\n' "$*" >&2
  exit 1
}

[[ -f "$APPIMAGE_INPUT" ]] || fail "artifact does not exist: $APPIMAGE_INPUT"
[[ -d "$LINTER_DIR_INPUT" ]] || fail "linter directory does not exist: $LINTER_DIR_INPUT"

APPIMAGE="$(readlink -f "$APPIMAGE_INPUT")"
LINTER_DIR="$(readlink -f "$LINTER_DIR_INPUT")"

[[ -f "$LINTER_DIR/check-name.sh" ]] || fail "AppImageHub check-name.sh is missing"
[[ -f "$LINTER_DIR/appdir-lint.sh" ]] || fail "appdir-lint.sh is missing"
[[ -f "$LINTER_DIR/excludelist" ]] || fail "AppImage excludelist is missing"

BASENAME="$(basename "$APPIMAGE")"
[[ "$BASENAME" =~ ^HumanCrop-[0-9]+\.[0-9]+\.[0-9]+-x86_64\.AppImage$ ]] ||
  fail "unexpected artifact name: $BASENAME"

NAME_OUTPUT="$(bash "$LINTER_DIR/check-name.sh" --appimage "$BASENAME")"
[[ -z "$NAME_OUTPUT" ]] || fail "$NAME_OUTPUT"

MAGIC="$(od -An -tx1 -j 8 -N 3 "$APPIMAGE" | tr -d ' \n')"
[[ "$MAGIC" == "414902" ]] || fail "artifact is not an AppImage type 2"

OFFSET="$("$APPIMAGE" --appimage-offset 2>/dev/null | tail -n 1)"
[[ "$OFFSET" =~ ^[0-9]+$ ]] || fail "could not determine SquashFS offset"
SQUASHFS_INFO="$(unsquashfs -s -o "$OFFSET" "$APPIMAGE")"
printf '%s\n' "$SQUASHFS_INFO"
COMPRESSION="$(printf '%s\n' "$SQUASHFS_INFO" | awk '/^Compression / {print $2}')"
case "$COMPRESSION" in
  gzip|zstd) ;;
  *) fail "unsupported SquashFS compression for AppImageHub: ${COMPRESSION:-unknown}" ;;
esac

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

(
  cd "$WORKDIR"
  "$APPIMAGE" --appimage-extract >/dev/null
)

APPDIR="$WORKDIR/squashfs-root"
[[ -d "$APPDIR" ]] || fail "AppImage extraction did not produce an AppDir"

mapfile -t DESKTOP_FILES < <(find "$APPDIR" -maxdepth 1 -type f -name '*.desktop' -print)
[[ "${#DESKTOP_FILES[@]}" -eq 1 ]] ||
  fail "expected exactly one top-level desktop file, found ${#DESKTOP_FILES[@]}"

desktop-file-validate "${DESKTOP_FILES[0]}"
bash "$LINTER_DIR/appdir-lint.sh" "$APPDIR"
if compgen -G "$APPDIR/usr/share/metainfo/*.xml" >/dev/null; then
  appstreamcli validate-tree "$APPDIR"
fi

printf 'Validated AppImage: %s\n' "$BASENAME"
printf 'SquashFS compression: %s\n' "$COMPRESSION"
sha256sum "$APPIMAGE"
