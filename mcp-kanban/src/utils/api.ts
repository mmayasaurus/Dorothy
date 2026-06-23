import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mirrors mcp-vault/src/utils/api.ts — the Electron main process owns all state
// (here, the SQLite kanban board); MCP servers reach it over the local Agent API.
const API_PORT = 31415;
const API_HOST = "127.0.0.1";
const API_TOKEN_FILE = path.join(os.homedir(), ".dorothy", "api-token");

function readApiToken(): string | null {
  try {
    if (fs.existsSync(API_TOKEN_FILE)) {
      return fs.readFileSync(API_TOKEN_FILE, "utf-8").trim();
    }
  } catch (err) {
    // A read error (vs. a missing file) means requests go out unauthenticated and 401 —
    // log it so that failure mode is debuggable instead of silent (Aikido, PR #1).
    console.error("Failed to read API token:", err);
  }
  return null;
}

export async function apiRequest(
  method: string,
  path_: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = readApiToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const options: http.RequestOptions = {
      hostname: API_HOST,
      port: API_PORT,
      path: path_,
      method,
      headers,
      timeout: 30000, // 30s — a stalled/unresponsive local API must not hang the MCP tool/agent indefinitely (CodeRabbit + Copilot, PR #1)
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(parsed.error || `HTTP ${res.statusCode}: ${data}`)
            );
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`API request failed: ${err.message}`));
    });

    // The socket-timeout event does not abort the request on its own — destroy it so the
    // pending request rejects (via the "error" handler above) instead of hanging forever.
    req.on("timeout", () => {
      req.destroy(new Error(`API request timed out after 30s: ${method} ${path_}`));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}
