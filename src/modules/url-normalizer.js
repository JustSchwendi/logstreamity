export function normalizeTenantUrl(input) {
  if (!input) return "";
  let urlStr = input.trim();
  if (!/^https?:\/\//i.test(urlStr)) urlStr = "https://" + urlStr;
  let u;
  try { u = new URL(urlStr); } catch { return input; }
  u.hostname = u.hostname.replace(".apps.", ".");
  u.pathname = "/"; u.search = ""; u.hash = "";
  let out = u.toString(); if (!out.endsWith("/")) out += "/";
  return out;
}
