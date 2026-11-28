# Adapted from elastic/beats
set -euo pipefail

WORKFLOW="${1:?workflow required}"

buildkite-agent artifact download "artifacts/dra/beats/*/manifest-*.json" . --step "dra-prep-${WORKFLOW}"
manifest=$(find artifacts/dra/beats -name "manifest-*.json" | head -1)
prefix=$(jq -er '.prefix' "${manifest}")
build_id=$(jq -er '.build_id' "${manifest}")
version=$(jq -er '.version' "${manifest}")
url="https://artifacts-${WORKFLOW}.elastic.co/${prefix}/${build_id}/summary-${version}.html"

printf "**%s summary link:** [%s](%s)\n" "${WORKFLOW}" "${url}" "${url}" | buildkite-agent annotate --style=success --append
