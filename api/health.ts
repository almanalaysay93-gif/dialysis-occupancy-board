export default function handler(req: any, res: any) {
  try {
    res.status(200).json({
      status: "healthy",
      nodeEnv: process.env.NODE_ENV || "unknown",
      hasDbUrl: !!(process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL_B64),
      hasJwtSecret: !!process.env.JWT_SECRET,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
