import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  // SameSite=None is only accepted by browsers when the cookie is also
  // marked Secure. Production (manus.space) is always HTTPS, so fall back to
  // secure=true when the host is a known production domain — this protects
  // against proxies that strip x-forwarded-proto on the live site.
  const host = (req.headers.host ?? "").toLowerCase();
  const isKnownProductionHost = host.endsWith(".manus.space") || host.endsWith(".manus.im");
  const isHttpsSite = isSecureRequest(req) || isKnownProductionHost;
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isHttpsSite,
  };
}
