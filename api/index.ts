import "dotenv/config";
import type { Request, Response } from "express";

let appPromise: Promise<any> | null = null;

async function getApp() {
  const express = (await import("express")).default;
  const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
  const { registerOAuthRoutes } = await import("../server/_core/oauth");
  const { registerStorageProxy } = await import("../server/_core/storageProxy");
  const { appRouter } = await import("../server/routers");
  const { createContext } = await import("../server/_core/context");

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return app;
}

export default async function handler(req: Request, res: Response) {
  try {
    if (!appPromise) {
      appPromise = getApp();
    }
    const app = await appPromise;
    return app(req, res);
  } catch (error: any) {
    console.error("[Vercel Serverless Error]:", error);
    res.status(500).json({
      error: error?.message || "Internal Server Error",
      stack: error?.stack,
    });
  }
}
