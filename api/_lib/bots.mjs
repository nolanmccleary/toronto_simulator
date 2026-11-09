// Server-side user-agent classification. Runs when an event is ingested, so every
// recorded visit is tagged human vs bot (crawlers, scrapers, link-unfurlers, scanners,
// headless automation). Not perfect, but catches the overwhelming majority.
const BOT_RE = new RegExp([
  'bot', 'crawl', 'spider', 'spyder', 'slurp', 'mediapartners', 'adsbot',
  'facebookexternalhit', 'facebot', 'ia_archiver', 'embedly', 'quora link',
  'outbrain', 'pinterest', 'vkshare', 'w3c_validator', 'redditbot', 'applebot',
  'whatsapp', 'flipboard', 'tumblr', 'bitlybot', 'skypeuripreview', 'nuzzel',
  'discordbot', 'telegrambot', 'slackbot', 'twitterbot', 'linkedinbot', 'googlebot',
  'baidu', 'bingpreview', 'yandex', 'duckduck', 'preview', 'headless', 'phantom',
  'puppeteer', 'playwright', 'selenium', 'webdriver', 'chrome-lighthouse', 'pagespeed',
  'curl', 'wget', 'python-requests', 'python-urllib', 'go-http', 'libwww', 'java/',
  'okhttp', 'axios', 'node-fetch', 'got\\(', 'scrapy', 'httpclient', 'dataprovider',
  'semrush', 'ahrefs', 'mj12', 'dotbot', 'petalbot', 'bytespider', 'gptbot', 'ccbot',
  'anthropic', 'claudebot', 'perplexity', 'amazonbot', 'censys', 'masscan', 'zgrab',
  'nmap', 'nikto', 'sqlmap', 'monitor', 'uptime', 'pingdom', 'statuscake', 'site24x7',
  'newrelic', 'datadog', 'archive.org', 'feedfetcher', 'proximic', 'scan',
].join('|'), 'i');

// A genuine browser UA almost always names an engine.
const BROWSER_RE = /mozilla|applewebkit|gecko|chrome|safari|firefox|edg|opr|opera/i;

export function classifyUA(ua) {
  if (!ua || ua.length < 10) return true;      // missing / stub UA → bot
  if (BOT_RE.test(ua)) return true;
  if (!BROWSER_RE.test(ua)) return true;        // doesn't look like any browser
  return false;
}

// Very coarse device bucket for human-facing stats.
export function deviceOf(ua = '') {
  if (/mobile|iphone|android.*mobile|ipod/i.test(ua)) return 'mobile';
  if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) return 'tablet';
  return 'desktop';
}
