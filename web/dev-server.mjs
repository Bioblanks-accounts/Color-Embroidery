import { createServer } from "vite";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

const port = parseInt(process.env.PORT || "5173", 10);
const server = await createServer({ root: __dirname, server: { host: true, port } });
await server.listen();
server.printUrls();
