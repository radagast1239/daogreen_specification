import helmet from "helmet";
import rateLimit from "express-rate-limit";

export function applySecurityMiddleware(app, { isProd }) {
  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              ...helmet.contentSecurityPolicy.getDefaultDirectives(),
              "upgrade-insecure-requests": null,
            },
          }
        : false,
      strictTransportSecurity: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isProd ? 300 : 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  const clientLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isProd ? 120 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  app.use("/api/", apiLimiter);
  app.use("/api/client", clientLimiter);
}
