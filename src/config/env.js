import "dotenv/config";

export const env = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  socketTicketExpiresIn: process.env.SOCKET_TICKET_EXPIRES_IN || "60s",
  otpExpiresInMinutes: parseInt(process.env.OTP_EXPIRES_IN_MINUTES || "5", 10),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  // Gmail SMTP for transactional mail (admin 2FA codes). Use a Google
  // "App Password" (Account → Security → 2-Step Verification → App passwords),
  // not the account password. Missing creds → mail is logged instead of sent.
  gmail: {
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
  },
};
