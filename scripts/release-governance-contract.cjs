function normalizeLineEndings(text) {
  return String(text).replace(/\r\n?/g, '\n');
}

function hasReleasePleaseMainScope(workflowText) {
  const normalized = normalizeLineEndings(workflowText);
  return /scopes:[\s\S]*?\n\s+main(?:\n|$)/.test(normalized);
}

module.exports = {
  normalizeLineEndings,
  hasReleasePleaseMainScope,
};
