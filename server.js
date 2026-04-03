const http = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { registerSocketHandlers } = require("./server/socket-handlers.js");
const { getGameCount } = require("./server/game-store.js");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    // Structured request logging (single line JSON, easy to grep in Render logs)
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const level = res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
      if (req.url !== "/api/health") {
        console.log(JSON.stringify({ ts: new Date().toISOString(), level, method: req.method, path: req.url, status: res.statusCode, ms }));
      }
    });

    // Lightweight health endpoint for Render probes (no Next.js involvement)
    if (req.method === "GET" && req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: Math.floor(process.uptime()), activeGames: getGameCount() }));
      return;
    }

    handle(req, res);
  });

  const io = new Server(server);

  registerSocketHandlers(io);

  server
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: "INFO", event: "server_start", port }));
    });
});
