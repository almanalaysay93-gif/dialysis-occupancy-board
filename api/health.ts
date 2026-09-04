import pkg from "pg";

const { Client } = pkg;

export default async function handler(req: any, res: any) {
  try {
    const raw = process.env.DATABASE_URL || "";
    let parsed: any = null;
    let probes: Record<string, any> = {};

    if (raw) {
      const u = new URL(raw);
      const pwd = u.password;

      parsed = {
        host: u.hostname,
        port: u.port,
        user: u.username,
        db: u.pathname.replace(/^\//, ""),
        length: pwd.length,
        hasBracketPrefix: pwd.startsWith("["),
        hasBracketSuffix: pwd.endsWith("]"),
        hasQuotes: /^["'].*["']$/.test(pwd),
        hasPercent: pwd.includes("%"),
        hasAt: pwd.includes("@"),
        hasColon: pwd.includes(":"),
        hasSlash: pwd.includes("/"),
        hasHash: pwd.includes("#"),
        hasSpace: /\s/.test(pwd),
        isAlphaNumericOnly: /^[a-zA-Z0-9]+$/.test(pwd),
      };

      const testPassword = async (testPwd: string) => {
        const testUrl = `postgresql://${encodeURIComponent(u.username)}:${encodeURIComponent(testPwd)}@${u.hostname}:${u.port || 6543}/${u.pathname.replace(/^\//, "")}`;
        const client = new Client({
          connectionString: testUrl,
          connectionTimeoutMillis: 5000,
          ssl: { rejectUnauthorized: false },
        });
        try {
          await client.connect();
          const r = await client.query("SELECT current_database(), version()");
          await client.end();
          return { ok: true, db: r.rows[0].current_database };
        } catch (e: any) {
          return { ok: false, error: e.message, code: e.code };
        }
      };

      const candidates: Record<string, string> = {
        asParsed: pwd,
      };
      if (pwd.startsWith("[") && pwd.endsWith("]")) {
        candidates.withoutBrackets = pwd.slice(1, -1);
      }
      if (/^["'].*["']$/.test(pwd)) {
        candidates.withoutQuotes = pwd.slice(1, -1);
      }
      if (pwd.includes("%")) {
        try {
          candidates.decoded = decodeURIComponent(pwd);
        } catch {}
      }

      for (const [key, cand] of Object.entries(candidates)) {
        probes[key] = await testPassword(cand);
      }
    }

    res.status(200).json({
      status: "healthy",
      nodeEnv: process.env.NODE_ENV || "unknown",
      hasDbUrl: !!raw,
      parsed,
      probes,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
