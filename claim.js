const fs = require("fs");
const { gotScraping } = require("got-scraping");

const BASE_URL = "https://tma-rewards.bynai.com/api/v1";
const CHECKIN_URL = `${BASE_URL}/checkin`;
const CLAIM_URL = `${BASE_URL}/hourly-ticket/claim`;
const CHECKIN_INTERVAL = 24 * 60 * 60 * 1000;
const CLAIM_INTERVAL = 60 * 60 * 1000;

function loadAccounts() {
  const file = fs.readFileSync("tokens.txt", "utf-8");
  return file
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((line) => {
      const parts = line.split("|");
      return {
        bearer: parts[0].trim(),
        cookie: parts[1] ? parts[1].trim() : "",
      };
    });
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timestamp() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

function isCloudflare(data) {
  return typeof data === "string" && data.includes("Just a moment");
}

function formatResponse(data) {
  if (isCloudflare(data)) return "CLOUDFLARE CHALLENGE";
  if (typeof data === "string") return data.substring(0, 200);
  return JSON.stringify(data);
}

function mask(token) {
  return token.length > 20 ? token.substring(0, 20) + "..." : token;
}

async function postWithRetry(url, account, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const headers = {
        "content-type": "application/json",
        authorization: account.bearer,
        origin: "https://tma-rewards.bynai.com",
        referer: "https://tma-rewards.bynai.com/",
      };
      if (account.cookie) {
        headers["cookie"] = account.cookie;
      }

      const res = await gotScraping({
        url,
        method: "POST",
        json: {},
        headers,
        responseType: "json",
        throwHttpErrors: false,
      });

      const status = res.statusCode;
      const data = res.body;

      if (status !== 429) return { status, data };
      const wait = randomDelay(10, 20) * attempt;
      console.log(`  [429] retry ${attempt}/${maxRetries} dalam ${wait / 1000}s...`);
      await sleep(wait);
    } catch (err) {
      throw new Error(`Request gagal: ${err.message}`);
    }
  }
  return { status: 429, data: { error: "rate limit persist" } };
}

function logResult(label, res) {
  const cf = isCloudflare(res.data);
  const ok = res.status >= 200 && res.status < 300;
  const icon = ok ? "+" : res.status === 429 ? "!" : "-";
  const msg = cf ? "CLOUDFLARE CHALLENGE" : formatResponse(res.data).split("\n")[0];
  console.log(`  [${icon}] ${label}: ${res.status} | ${msg}`);
}

async function runAccount(account, index, total) {
  console.log(`\n[${timestamp()}] Account ${index + 1}/${total} (${mask(account.bearer)})`);

  const checkin = await postWithRetry(CHECKIN_URL, account);
  logResult("Checkin", checkin);

  if (isCloudflare(checkin.data)) return { cf: true };

  const claim = await postWithRetry(CLAIM_URL, account);
  logResult("Claim  ", claim);

  return { cf: false };
}

async function runAll() {
  const accounts = loadAccounts();
  console.log(`[${timestamp()}] Running ${accounts.length} account(s)\n`);

  let cfBlocked = 0;

  for (let i = 0; i < accounts.length; i++) {
    const result = await runAccount(accounts[i], i, accounts.length);
    if (result.cf) cfBlocked++;
    if (i < accounts.length - 1) await sleep(randomDelay(3, 8));
  }

  if (cfBlocked > 0) {
    console.log(`\n[!] ${cfBlocked} account(s) kena Cloudflare. Update cookie di tokens.txt`);
  }
}

async function main() {
  console.log("=== Bynai Auto Claim ===");
  console.log("Checkin : setiap 24 jam");
  console.log("Claim   : setiap 1 jam");
  console.log("Ctrl+C untuk stop");

  await runAll();

  setInterval(async () => {
    console.log(`\n[${timestamp()}] --- Hourly Claim ---`);
    const accounts = loadAccounts();
    for (let i = 0; i < accounts.length; i++) {
      const res = await postWithRetry(CLAIM_URL, accounts[i]);
      logResult("Claim", res);
      if (i < accounts.length - 1) await sleep(randomDelay(3, 8));
    }
  }, CLAIM_INTERVAL);

  setInterval(async () => {
    console.log(`\n[${timestamp()}] --- Daily Checkin ---`);
    const accounts = loadAccounts();
    for (let i = 0; i < accounts.length; i++) {
      const res = await postWithRetry(CHECKIN_URL, accounts[i]);
      logResult("Checkin", res);
      if (i < accounts.length - 1) await sleep(randomDelay(3, 8));
    }
  }, CHECKIN_INTERVAL);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
