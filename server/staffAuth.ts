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
  appId: string;
}

function getSessionSecret() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function createStaffSessionToken(
  staff: Pick<StaffSession, "accountId" | "username" | "displayName"> & {
    role: "nurse" | "supervisor";
    assignedFloorId: number | null;
  },
  options: { expiresInMs?: number } = {}
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
    if (
      !staff ||
      typeof staff.accountId !== "number" ||
      typeof staff.username !== "string" ||
      typeof staff.displayName !== "string" ||
      !["nurse", "supervisor"].includes(String(staff.role))
    ) {
      return null;
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
  if (staff) return staff;
  return GUEST_SESSION;
}

/** Set the staff session cookie on a response (or clear it when staff is null). */
export function setStaffSessionCookie(
  req: Request,
  res: { cookie: (name: string, value: string, opts?: Record<string, unknown>) => unknown } | { cookie: (name: string, value: string, opts?: Record<string, unknown>) => unknown },
  staff: StaffSession | null
) {
  const cookieOptions = getSessionCookieOptions(req);
  if (!staff || staff.role === "guest") {
    res.cookie(STAFF_COOKIE_NAME, "", { ...cookieOptions, maxAge: -1 });
    return;
  }
  if (staff.role !== "nurse" && staff.role !== "supervisor") return;
  void createStaffSessionToken({
    accountId: staff.accountId,
    username: staff.username,
    displayName: staff.displayName,
    role: staff.role,
    assignedFloorId: staff.assignedFloorId,
  }).then(token => {
    res.cookie(STAFF_COOKIE_NAME, token, {
      ...cookieOptions,
      maxAge: ONE_YEAR_MS,
    });
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
