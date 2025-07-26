import * as fs from "node:fs/promises";
import { myLibStorage } from "../db";

const schema = myLibStorage.generateSchema("1.0.0").code;

// re-generate schema after install
await fs.mkdir("models", { recursive: true });
await fs.writeFile("models/lib.prisma", schema);
