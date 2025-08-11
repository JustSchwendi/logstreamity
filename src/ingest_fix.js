import { ingestSequential } from "./modules/ingest-sequential.js";
import { normalizeTenantUrl } from "./modules/url-normalizer.js";

/** Drop-in Ersatz, ohne bestehende Dateien zu Ã¤ndern */
export async function runDefaultIngestPatched({
  lines, batchSize, delayMs, baseUrl, token, source, attributes,
  rateLimitPerSecond = 90, debug = false, onDebug = () => {}
}) {
  const normalizedBase = normalizeTenantUrl(baseUrl);
  const url = `${normalizedBase}api/v2/logs/ingest`;
  return ingestSequential({
    lines, batchSize, delayMs, url, token, source, attributes,
    rateLimitPerSecond, debug, onDebug
  });
}
