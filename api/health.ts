import pkg from "pg";
import dns from "node:dns/promises";
import net from "node:net";

const { Client } = pkg;

export default async function handler(req: any, res: any) {
  try {
    const b64 = process.env.SUPABASE_DATABASE_URL_B64;
    const plain = process.env.DATABASE_URL;

    let url: string | null = null;
    let source: string | null = null;
    let b64Error: string | null = null;

    if (b64) {
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      const roundTrip = Buffer.from(decoded, "utf-8").toString("base64");
      const normalize = (s: string) => s.replace(/\s/g, "").replace(/=+$/, "");
      if (normalize(roundTrip) !== normalize(b64)) {
        b64Error = "base64 decode dropped chars";
      } else if (!/^postgres(ql)?:\/\//.test(decoded)) {
        b64Error = `not a postgres URI (starts with ${decoded.slice(0, 10)})`;
      } else {
        url = decoded;
        source = "SUPABASE_DATABASE_URL_B64";
      }
    }
    if (!url && plain) {
      url = plain;
      source = "DATABASE_URL";
    }

    let parsed: any = null;
    let dnsResult: any = null;
    let tcpMs: any = null;
    let dbResult: any = null;
    let error: string | null = null;

    if (url) {
      try {
        const u = new URL(url);
        parsed = {
          protocol: u.protocol,
          host: u.hostname,
          port: u.port || "5432",
          db: u.pathname.replace(/^\//, ""),
          user: u.username,
          hasPassword: !!u.password,
          passwordLength: u.password ? u.password.length : 0,
        };

        try {
          const addrs = await dns.lookup(u.hostname, { all: true });
          dnsResult = addrs.map((a: any) => a.address);
        } catch (e: any) {
          dnsResult = { error: e.message, code: e.code };
        }

        tcpMs = await new Promise((resolve) => {
          const t0 = performance.now();
          const sock = net.createConnection({ host: u.hostname, port: Number(u.port || 5432) });
          const done = (v: any) => {
            sock.destroy();
            resolve(v);
          };
          sock.setTimeout(5000);
          sock.on("connect", () => done(Math.round(performance.now() - t0)));
          sock.on("timeout", () => done("timeout"));
          sock.on("error", (err: any) => done(`error: ${err.message}`));
        });

        const client = new Client({
          connectionString: url,
          connectionTimeoutMillis: 8000,
          ssl: { rejectUnauthorized: false },
        });

        try {
          await client.connect();
          const r = await client.query("SELECT current_database() as db, version() as v");
          const tbls = await client.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
          );
          dbResult = {
            connected: true,
            currentDb: r.rows[0].db,
            tables: tbls.rows.map((t: any) => t.table_name),
          };
          await client.end();
        } catch (e: any) {
          dbResult = { connected: false, error: e.message, code: e.code };
        }
      } catch (e: any) {
        error = e.message;
      }
    }

    res.status(200).json({
      status: "healthy",
      nodeEnv: process.env.NODE_ENV || "unknown",
      hasDbUrl: !!url,
      source,
      b64Length: b64 ? b64.length : null,
      b64Error,
      plainLength: plain ? plain.length : null,
      parsed,
      dnsResult,
      tcpMs,
      dbResult,
      error,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
