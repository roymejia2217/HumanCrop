#!/usr/bin/env bats
# Behavioral tests execute the exact production recovery run block, parsed from YAML.
setup() {
  root="$(mktemp -d)"
  export GH_TEST_ROOT="$root"
  mkdir -p "$root/bin" "$root/pkgs" "$root/runner"
  cp "$BATS_TEST_DIRNAME/fixtures/gh-release-stub.sh" "$root/bin/gh"
  chmod +x "$root/bin/gh"
  export PATH="$root/bin:$PATH"
  export GH_TEST_TAG_JSON="$root/tag.json"
  export GH_TEST_RELEASE_JSON="$root/release.json"
  export GH_TEST_MANIFEST="$root/SHA256SUMS.txt"
  export GH_TEST_PUBLISHED="$root/published"
  export GH_TEST_COUNT="$root/count"
  export RELEASE_VERSION="1.0.1"
  export RELEASE_TAG="v1.0.1"
  export RELEASE_ID="411112154"
  export RELEASE_SHA="34a54a31f0b501dbd04c3f44703ae2e60c24802e"
  export REPOSITORY="roymejia2217/HumanCrop"
  export RUNNER_TEMP="$root/runner"
  export GH_TOKEN="fixture-only-not-a-real-token"
  script="${RECOVERY_SCRIPT:?RECOVERY_SCRIPT must point to extracted production step}"

  names=(
    "HumanCrop-1.0.1-win-x64.exe"
    "HumanCrop-1.0.1-win-x64.exe.blockmap"
    "HumanCrop-1.0.1-x86_64.AppImage"
    "HumanCrop-1.0.1-linux-amd64.deb"
  )
  for name in "${names[@]}"; do
    printf 'fixture bytes for %s\n' "$name" > "$root/pkgs/$name"
  done
  ( cd "$root/pkgs" && sha256sum "${names[@]}" ) > "$GH_TEST_MANIFEST"

  assets='[]'
  for name in "${names[@]}"; do
    sha="$(sha256sum "$root/pkgs/$name" | awk '{print $1}')"
    assets="$(jq -cn --argjson assets "$assets" --arg name "$name" --arg digest "sha256:$sha" \
      '$assets + [{id: (($assets | length) + 1), name:$name, digest:$digest, state:"uploaded", size:100}]')"
  done
  manifest_sha="$(sha256sum "$GH_TEST_MANIFEST" | awk '{print $1}')"
  assets="$(jq -cn --argjson assets "$assets" --arg digest "sha256:$manifest_sha" \
    '$assets + [{id:5, name:"SHA256SUMS.txt", digest:$digest, state:"uploaded", size:395}]')"
  jq -n --arg sha "$RELEASE_SHA" '{object:{type:"commit", sha:$sha}}' > "$GH_TEST_TAG_JSON"
  jq -n --arg sha "$RELEASE_SHA" --arg tag "$RELEASE_TAG" --argjson assets "$assets" \
    '{id:411112154, tag_name:$tag, target_commitish:$sha, draft:true, assets:$assets}' > "$GH_TEST_RELEASE_JSON"
}
teardown() {
  rm -rf -- "$GH_TEST_ROOT"
}

@test "publishes only after matching tag and all original digests" {
  run bash "$script"
  [ "$status" -eq 0 ]
  [ -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses mismatched tag commit and identifies failing gate" {
  jq '.object.sha="different"' "$GH_TEST_TAG_JSON" > "$GH_TEST_ROOT/tmp"
  mv "$GH_TEST_ROOT/tmp" "$GH_TEST_TAG_JSON"
  run bash "$script"
  [ "$status" -ne 0 ]
  [[ "$output" == *"::error::Draft recovery failed at stage tag_identity"* ]]
  [[ "$output" != *"$GH_TOKEN"* ]]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses already published release" {
  jq '.draft=false' "$GH_TEST_RELEASE_JSON" > "$GH_TEST_ROOT/tmp"
  mv "$GH_TEST_ROOT/tmp" "$GH_TEST_RELEASE_JSON"
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses wrong governed release SHA" {
  jq '.target_commitish="incorrect"' "$GH_TEST_RELEASE_JSON" > "$GH_TEST_ROOT/tmp"
  mv "$GH_TEST_ROOT/tmp" "$GH_TEST_RELEASE_JSON"
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses missing release assets" {
  jq '.assets |= .[:-1]' "$GH_TEST_RELEASE_JSON" > "$GH_TEST_ROOT/tmp"
  mv "$GH_TEST_ROOT/tmp" "$GH_TEST_RELEASE_JSON"
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses duplicate release asset names" {
  jq '.assets[1].name=.assets[0].name' "$GH_TEST_RELEASE_JSON" > "$GH_TEST_ROOT/tmp"
  mv "$GH_TEST_ROOT/tmp" "$GH_TEST_RELEASE_JSON"
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses server-side digest mismatch and identifies failing gate" {
  jq '.assets[0].digest="sha256:bad"' "$GH_TEST_RELEASE_JSON" > "$GH_TEST_ROOT/tmp"
  mv "$GH_TEST_ROOT/tmp" "$GH_TEST_RELEASE_JSON"
  run bash "$script"
  [ "$status" -ne 0 ]
  [[ "$output" == *"::error::Draft recovery failed at stage asset_digests"* ]]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses altered downloaded checksum manifest" {
  printf 'tampered\n' >> "$GH_TEST_MANIFEST"
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses denied GitHub API permission" {
  export GH_TEST_DENY=true
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses concurrent mutation during re-verification" {
  export GH_TEST_MUTATE=true
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
@test "refuses malformed release ID before external mutation" {
  export RELEASE_ID="invalid-id"
  run bash "$script"
  [ "$status" -ne 0 ]
  [ ! -f "$GH_TEST_PUBLISHED" ]
}
