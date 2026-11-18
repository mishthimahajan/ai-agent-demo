
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  GOOGLE_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  GITHUB_TOKEN: z.string().optional().default(""),
  GITHUB_OWNER: z.string().optional().default(""),
  GITHUB_REPO: z.string().optional().default(""),

  FRONTEND_ORIGIN: z.string().default("http://localhost:5173")
});

export const config = envSchema.parse(process.env);
