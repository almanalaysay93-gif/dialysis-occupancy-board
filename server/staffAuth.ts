import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { randomBytes, createHash } from "crypto";
import { staffAccounts } from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";

/** Local staff session cookie name (separate from the OAuth user session). */
export const STAFF_COOKIE_NAME = "staff_session_id";

export type StaffRole = "nurse" | "supervisor" | "guest";

export interface StaffSession {
  accountId: number;
  username: string;
  displayName: string;
  role: StaffRole;
  /** Floor this nurse may access; null for supervisors and guests. */
  assignedFloorId: number | null;
  /** True only when the guest/nurse/supervisor role came from an actual
   *  staff cookie. When false the request simply has no staff session —
   *  OAuth users keep full access in that case. */
  fromCookie?: boolean;
}

/**
 * Guest is a special pseudo-role: the user visits without a staff account.
 * Guests can read the board but cannot start/end sessions or manage lists.
 */
export const GUEST_SESSION: StaffSession = {
  accountId: 0,
  username: "guest",
  displayName: "Guest",
  role: "guest",
  assignedFloorId: null,
};

// ---------------- password hashing ----------------

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(salt + password).digest("hex");
}

export function hashWithSalt(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  return { hash: hashPassword(password, salt), salt };
}

export function verifyPassword(
  password: string,
  salt: string,
  hash: string
): boolean {
  return hashPassword(password, salt) === hash;
}

// ---------------- staff session JWT ----------------

interface StaffJwtPayload {
  [key: string]: unknown;
  staff: {
    accountId: number;
    username: string;
    displayName: string;
    role: StaffRole;
    assignedFloorId: number | null;
  };
  /** Server-side revocation: logout bumps the account's tokenVersion, so
   *  any previously issued token (carrying the old version) is rejected. */
  tokenVersion: number;
  appId: string;
}

/**
 * Read the signing secret at call time, not at module load: ENV is captured
 * when the module is first imported, which is before a test file (or a late
 * dotenv load) can set JWT_SECRET. An empty key makes jose throw
 * "Zero-length key is not supported".
 */
function getSessionSecret() {
  const secret = process.env.JWT_SECRET || ENV.cookieSecret;
  if (!secret) {
    if (ENV.isProduction) {
      throw new Error("JWT_SECRET must be set — staff sessions cannot be signed without it.");
    }
    // ponytail: dev/test fallback only; production throws above.
    return new TextEncoder().encode("dev-only-insecure-staff-session-secret");
  }
  return new TextEncoder().encode(secret);
}

export async function createStaffSessionToken(
  staff: Pick<StaffSession, "accountId" | "username" | "displayName"> & {
    role: StaffRole;
    assignedFloorId: number | null;
  },
  options: { expiresInMs?: number; tokenVersion?: number } = {}
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
  const payload: StaffJwtPayload = {
    staff: {
      accountId: staff.accountId,
      username: staff.username,
      displayName: staff.displayName,
      role: staff.role,
      assignedFloorId: staff.assignedFloorId,
    },
    tokenVersion: options.tokenVersion ?? 1,
    appId: ENV.appId,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSessionSecret());
}

export async function verifyStaffSession(
  cookieValue: string | undefined | null
): Promise<StaffSession | null> {
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    const rec = payload as Record<string, unknown>;
    const staff = rec.staff as Record<string, unknown> | undefined;
    const tokenVersion = rec.tokenVersion;
    if (
      !staff ||
      typeof staff.accountId !== "number" ||
      typeof staff.username !== "string" ||
      typeof staff.displayName !== "string" ||
      !["nurse", "supervisor", "guest"].includes(String(staff.role))
    ) {
      return null;
    }
    const isGuestJwt = String(staff.role) === "guest";
    if (isGuestJwt) {
      // Guest JWTs carry a fixed marker account (id 0) and no tokenVersion
      // revocation row — signing-out the guest simply clears the cookie.
      return {
        accountId: 0,
        username: "guest",
        displayName: "Guest",
        role: "guest",
        assignedFloorId: null,
      };
    }
    // Re-fetch the live account to respect deactivation and floor reassignment.
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(staffAccounts)
      .where(eq(staffAccounts.id, staff.accountId))
      .limit(1);
    const account = rows[0];
    if (!account || !account.active) return null;
    // Revocation gate: a logout (or a re-login on another device) bumps the
    // stored tokenVersion; any token carrying an older version is stale.
    if (typeof tokenVersion !== "number" || tokenVersion !== account.tokenVersion) {
      return null;
    }
    return {
      accountId: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      assignedFloorId: account.assignedFloorId,
    };
  } catch {
    return null;
  }
}

import { eq } from "drizzle-orm";

/**
 * Resolve the staff session from a request. Guests (no staff cookie, and
 * optionally no OAuth session) browse with GUEST_SESSION.
 */
export async function resolveStaffSession(req: Request): Promise<StaffSession> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const token = cookies[STAFF_COOKIE_NAME] ?? null;
  const staff = await verifyStaffSession(token);
  if (staff) return { ...staff, fromCookie: true };
  return { ...GUEST_SESSION, fromCookie: token !== null };
}

/** Set the staff session cookie on a response (or clear it when staff is null). */
export function setStaffSessionCookie(
  req: Request,
  res: { cookie: (name: string, value: string, opts?: Record<string, unknown>) => unknown } | { cookie: (name: string, value: string, opts?: Record<string, unknown>) => unknown },
  staff: StaffSession | null
) {
  const cookieOptions = getSessionCookieOptions(req);
  const headersSent = "headersSent" in res && res.headersSent;
  if (!staff) {
    if (!headersSent) res.cookie(STAFF_COOKIE_NAME, "", { ...cookieOptions, maxAge: -1 });
    return;
  }
  if (staff.role !== "nurse" && staff.role !== "supervisor" && staff.role !== "guest") return;
  if ("headersSent" in res && res.headersSent) return;
  void createStaffSessionToken({
    accountId: staff.accountId,
    username: staff.username,
    displayName: staff.displayName,
    role: staff.role,
    assignedFloorId: staff.assignedFloorId,
  }).then(token => {
    // If the response headers have already been flushed, the cookie cannot
    // be set for this request — guard against ERR_HTTP_HEADERS_SENT.
    if ("headersSent" in res && res.headersSent) return;
    res.cookie(STAFF_COOKIE_NAME, token, {
      ...cookieOptions,
      maxAge: ONE_YEAR_MS,
    });
  });
}

/**
 * Bump the account's tokenVersion so every previously issued token becomes
 * stale. Called on login (defense in depth: single active session per
 * account) and on logout (explicit revocation).
 */
export async function bumpTokenVersion(accountId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select({ tokenVersion: staffAccounts.tokenVersion })
    .from(staffAccounts)
    .where(eq(staffAccounts.id, accountId))
    .limit(1);
  const next = (rows[0]?.tokenVersion ?? 0) + 1;
  await db
    .update(staffAccounts)
    .set({ tokenVersion: next })
    .where(eq(staffAccounts.id, accountId));
}

/**
 * Synchronous (awaitable) variant: builds the JWT first, then sets the
 * cookie BEFORE the tRPC response is written. Use this inside mutation
 * handlers where the cookie must be present on the same response — the
 * fire-and-forget variant above can race the header flush.
 */
export async function setStaffSessionCookieSync(
  req: Request,
  res: { cookie: (name: string, value: string, opts?: Record<string, unknown>) => unknown },
  staff: StaffSession | null,
  tokenVersion?: number
) {
  const cookieOptions = getSessionCookieOptions(req);
  if (!staff) {
    res.cookie(STAFF_COOKIE_NAME, "", { ...cookieOptions, maxAge: -1 });
    return;
  }
  if (staff.role !== "nurse" && staff.role !== "supervisor" && staff.role !== "guest") return;
  const token = await createStaffSessionToken(
    {
      accountId: staff.accountId,
      username: staff.username,
      displayName: staff.displayName,
      role: staff.role,
      assignedFloorId: staff.assignedFloorId,
    },
    { tokenVersion }
  );
  res.cookie(STAFF_COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: ONE_YEAR_MS,
  });
}

/**
 * Which floors this staff session may access:
 *  - supervisor → all floors (null marker)
 *  - nurse → only their assigned floor
 *  - guest → no access to write scopes (read-only everywhere in the UI,
 *    enforced client-side; server-side writes still require logged-in staff)
 */
export function staffAccessedFloors(staff: StaffSession): number[] | null {
  if (staff.role === "supervisor") return null; // all
  if (staff.assignedFloorId) return [staff.assignedFloorId];
  return []; // guest / unassigned nurse sees no floor-scoped data for writes
}

/** Whether the staff session may perform write actions. */
export function staffCanWrite(staff: StaffSession): boolean {
  return staff.role === "nurse" || staff.role === "supervisor";
}
