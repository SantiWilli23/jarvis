import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const loadProConfig = () => JSON.parse(readFileSync(fileURLToPath(new URL("../../config/pro.json", import.meta.url)), "utf8"));
