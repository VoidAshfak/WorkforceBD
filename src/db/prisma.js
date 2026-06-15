import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/index.js";
import { logger } from "../config/logger.js";

const connectionString = process.env.DATABASE_URL.replace("?sslmode=require", "");

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

pool.on("connect", () => logger.debug("DB pool connection established"));
pool.on("error", (err) => logger.error("DB pool error:", err.message));

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

logger.info("Prisma client initialized");

export { prisma };
