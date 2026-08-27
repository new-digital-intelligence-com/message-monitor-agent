import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { appConfigSchema } from "./schema.js";
import type { AppConfig } from "../types.js";

export function loadConfig(path: string): AppConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = yaml.load(raw);
  const result = appConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid config at ${path}:\n${issues}`);
  }
  return result.data;
}

/** Reads an env var the config referenced by name, failing loudly if it's unset. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
