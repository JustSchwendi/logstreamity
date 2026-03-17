// src/modules/ecommerce-email-generator.js
// Generates synthetic ecommerce application log lines based on
// ecommerce_unmasked_emails_reference.yaml

const USERNAMES = [
  "william_shakespeare", "leonardo_davinci", "galileo_galilei", "johannes_kepler",
  "isaac_newton", "benjamin_franklin", "samuel_johnson", "wolfgang_mozart",
  "jane_austen", "charles_dickens"
];

export const SAMPLE_EMAILS = USERNAMES.map(u => `${u}@example.com`);

export const GENERATOR_INFO = {
  label: "Ecommerce Logs (Unmasked Emails)",
  description: "Simulates a Java-based ecommerce platform running on Kubernetes with user authentication, checkout, loyalty, and account management flows. Log lines contain unmasked user email addresses using the @example.com domain — useful for testing PII detection, log masking, and data privacy workflows in Dynatrace.",
  badge: "PII / Security",
  badgeColor: "bg-red-100 text-red-700"
};

const HTTP_METHODS  = ["GET", "POST"];
const HTTP_STATUSES = ["200", "200", "200", "401", "403", "404"];
const USER_AGENTS   = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
];
const REFERRERS = [
  "https://www.example.com/order/details",
  "https://www.example.com/account",
  "https://www.example.com/checkout",
  "https://www.example.com/"
];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

function randIp(prefix) { return `${prefix}${randInt(1, 254)}`; }

function randCorrelation() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 40; i++) s += chars[randInt(0, chars.length - 1)];
  return s;
}

function randCartCode() { return String(randInt(100000000, 999999999)); }

function fmtTs(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// All 8 templates from the YAML — equal weight (1 each)
const TEMPLATES = [
  ({ ts, srcIp, corrId, email }) =>
    `${ts} [ERROR|[${srcIp}] |${corrId} |com.example.exmplstore.security.examplePersistentTokenRepository] Can't find credentials for series ${email}`,

  ({ ts, srcIp, corrId, email, cartCode }) =>
    `${ts} [INFO |[${srcIp}] |${corrId} |class com.example.exmplfacades.order.exampleCheckoutLogger Checkout ABC] Receive API Request:method=placePayOrder, cartCode=${cartCode}, customerID=${email}|com.example.exmplstore.checkout.request.PayPlaceOrderRequestDto@3d3a53d5|]`,

  ({ ts, email, epochMs }) =>
    `${ts} [INFO |||com.example.exmpl.BusinessProcessLoggingAspect] Finish Action: [ PerformSubscriptionAction ], BusinessProcessCode: [ customerRegistrationProcess-${email}-${epochMs}], OrderCode:[ n/a ]`,

  ({ ts, email, epochMs }) =>
    `${ts} [INFO |||com.example.exmplmarketing.action.exampleSendCustomerNotificationAction] Successfully sent email forgottenPassword message for process forgottenPasswordProcess-${email}-${epochMs}`,

  ({ ts, srcIp, corrId, email }) =>
    `${ts} [INFO |[${srcIp}] |${corrId}|com.example.exmpl.UserDeleteInterceptor] Deleting userId: ${email}, actioned by userId: anonymous`,

  ({ ts, srcIp, corrId, email }) =>
    `${ts} [INFO |[${srcIp}] |${corrId}|com.example.exmpl.AdvantageApiClient] Loyalty: Check loyalty account exist for email: ${email} , wodCorrelationId 2fee137d-915e-46fb-b390-c69aae3f150`,

  ({ ts, email, epochMs }) =>
    `${ts} [INFO |||com.example.exmplbusproc.aop.BusinessProcessLoggingAspect] Begin Action: [ exampleAdvantageLinkEmailAction ], BusinessProcessCode: [ advantageLinkEmailProcess-${email}-${epochMs}], OrderCode:[ n/a ]`,

  ({ ts, srcIp, corrId, serverIp, httpMethod, httpStatus, referrer, userAgent, email }) =>
    `${serverIp} - - [${ts} +1000] "${httpMethod} /reminder/${email}/1 HTTP/1.1" ${httpStatus} 90 "${referrer}" "${userAgent}" ${srcIp} - ${corrId} 100`,
];

export function generateEcommerceEmailLines(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const epochMs  = Date.now() - randInt(0, 3_600_000);
    const ctx = {
      ts:         fmtTs(epochMs),
      epochMs,
      email:      `${pick(USERNAMES)}@example.com`,
      srcIp:      randIp("203.0.113."),
      serverIp:   randIp("198.51.100."),
      corrId:     randCorrelation(),
      cartCode:   randCartCode(),
      httpMethod: pick(HTTP_METHODS),
      httpStatus: pick(HTTP_STATUSES),
      referrer:   pick(REFERRERS),
      userAgent:  pick(USER_AGENTS),
    };
    lines.push(TEMPLATES[randInt(0, TEMPLATES.length - 1)](ctx));
  }
  return lines;
}
