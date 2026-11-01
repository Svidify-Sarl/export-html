// Match the existing BE web.config request-filter ceiling, rather than the
// parser's unrelated 1MiB default. This does not raise the public BE limit.
const maximumJsonRequestBytes = 100 * 1024 * 1024;

function jsonRequestBudgetBytes(value) {
  if (value === undefined || value === "") return maximumJsonRequestBytes;
  const parsed = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(parsed) ||
      parsed < 1 || parsed > maximumJsonRequestBytes) {
    throw new Error("EXPORT_HTML_JSON_MAX_BYTES must be a positive integer within the BE request-filter ceiling");
  }
  return parsed;
}

module.exports = { jsonRequestBudgetBytes, maximumJsonRequestBytes };
