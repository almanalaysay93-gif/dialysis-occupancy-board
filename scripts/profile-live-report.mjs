// Profiles the live production /report page:
// 1. fetches the page HTML (measures TTFB)
// 2. finds the JS bundle URLs and measures each bundle fetch time
// 3. simulates the tRPC queries the /report page fires and times each one
import { readFileSync } from "fs";

const LIVE = "https://dialysisdash-dn9aztnn.manus.space";

function time(label, fn) {
  return fn().then(res => {
    console.log(`${label}: ${res}ms`);
    return res;
  });
}

async function measure(name, url, { timeout = 15000 } = {}) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    const body = await r.text();
    return { name, status: r.status, ms: Math.round(performance.now() - t0), bytes: body.length };
  } catch (e) {
    return { name, status: -1, ms: Math.round(performance.now() - t0), error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  console.log(`=== Profiling live ${LIVE} ===\n`);

  // 1. Page HTML TTFB
  const page = await measure("GET / (page html)", `${LIVE}/`);
  console.log(page);

  // 2. bundle timings
  const html = readFileSync("/dev/stdin", "utf8");
  const matches = [...html.matchAll(/src="([^"]+\.js)"/g)];
  for (const m of matches) {
    const r = await measure(`bundle ${m[1]}`, `${LIVE}${m[1]}`);
    console.log(r);
  }

  // 3. tRPC endpoints the /report page uses
  const endpoints = [
    "staff.me?input=%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%7D%7D",
    "machines.listFloors?input=%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%7D%7D",
    "endOfDay.summary?input=%7B%22json%22%3A%7B%22date%22%3A%222026-08-16%22%2C%22floorId%22%3A%22all%22%7D%2C%22meta%22%3A%7B%22values%22%3A%5B%7B%7D%5D%7D%7D",
    "narratives.list?input=%7B%22json%22%3A%7B%22reportDate%22%3A%222026-08-16%22%2C%22floorId%22%3A%22all%22%7D%2C%22meta%22%3A%7B%22values%22%3A%5B%7B%7D%5D%7D%7D",
  ];
  console.log("\n=== tRPC endpoints (sequential, one-at-a-time) ===");
  for (const ep of endpoints) {
    const r = await measure(`trpc ${ep.split("?")[0]}`, `${LIVE}/api/trpc/${ep}`);
    console.log(r);
  }
  console.log("\n=== tRPC endpoints (parallel, as browser does) ===");
  const t0 = performance.now();
  const results = await Promise.all(endpoints.map(ep => measure(`trpc ${ep.split("?")[0]}`, `${LIVE}/api/trpc/${ep}`)));
  console.log(`parallel wall time: ${Math.round(performance.now() - t0)}ms`);
  for (const r of results) console.log(r);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
