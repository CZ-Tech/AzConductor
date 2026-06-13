
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Scanner;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 本地联调用的模拟机器类，支持多条路径独立保存。
 * 不需要真实机器人/Android 环境，在 PC 上直接运行 main()，
 * 启动 HTTP 服务器（端口 8888）。
 *
 * <p>API 完全对齐 {@code HttpJsonService.java}。</p>
 *
 * <h2>API Endpoints</h2>
 * <table border="1">
 *   <tr><th>Method</th><th>Path</th><th>Request Body</th><th>Response</th><th>Description</th></tr>
 *   <tr><td>OPTIONS</td><td>Any</td><td>None</td><td>204 No Content</td><td>CORS preflight</td></tr>
 *   <tr><td>POST</td><td>/</td><td>JSON string</td><td>{"status":"success"}</td><td>Receive JSON into current memory</td></tr>
 *   <tr><td>GET</td><td>/</td><td>None</td><td>Current JSON</td><td>Returns the JSON currently in memory</td></tr>
 *   <tr><td>POST</td><td>/save/{name}</td><td>None</td><td>{"status":"saved","path":"{name}"}</td><td>Persist current JSON under a named path</td></tr>
 *   <tr><td>GET</td><td>/{name}</td><td>None</td><td>Saved JSON (200) or not_found (404)</td><td>Read saved JSON without changing current</td></tr>
 *   <tr><td>POST</td><td>/load/{name}</td><td>None</td><td>{"status":"loaded","path":"{name}","data":...}</td><td>Load saved JSON into current memory</td></tr>
 *   <tr><td>POST</td><td>/clear/{name}</td><td>None</td><td>{"status":"cleared","path":"{name}"}</td><td>Delete a named path</td></tr>
 *   <tr><td>GET</td><td>/list</td><td>None</td><td>{"status":"ok","paths":[...]}</td><td>List all saved path names</td></tr>
 *   <tr><td>GET</td><td>/commands</td><td>None</td><td>{"status":"ok","commands":[...]}</td><td>List all registered commands with signatures</td></tr>
 *   <tr><td>POST</td><td>/commands/run/{name}</td><td>JSON array of args</td><td>{"status":"ok"}</td><td>Invoke a registered command by name</td></tr>
 * </table>
 *
 * <h2>CORS</h2>
 * All responses include CORS headers (Access-Control-Allow-Origin: *, etc.) so browser-based
 * clients can call the API from any origin without being blocked.
 *
 * <h2>Persistence</h2>
 * Each path is stored as a separate file under {@code mock_robot_data/} directory.
 *
 * <pre>{@code
 *   # 发送 JSON
 *   curl -X POST http://localhost:8888/ -d '{"cmd":"move","speed":0.5}'
 *
 *   # 查看当前 JSON
 *   curl http://localhost:8888/
 *
 *   # 保存到指定路径
 *   curl -X POST http://localhost:8888/save/route1
 *
 *   # 查看指定路径的 JSON
 *   curl http://localhost:8888/route1
 *
 *   # 从指定路径加载到当前
 *   curl -X POST http://localhost:8888/load/route1
 *
 *   # 删除指定路径
 *   curl -X POST http://localhost:8888/clear/route1
 *
 *   # 列出所有路径
 *   curl http://localhost:8888/list
 *
 *   # 获取指令列表
 *   curl http://localhost:8888/commands
 *
 *   # 调用指令
 *   curl -X POST http://localhost:8888/commands/run/myCommand -d '["arg1",123]'
 * }</pre>
 */
public class MockRobot {

    private static final String TAG = "MockRobot";
    private static final int PORT = 8888;
    private static final Path DATA_DIR = Path.of("mock_robot_data");

    /** 当前内存中的 JSON，volatile 保证多线程可见性 */
    private static volatile String currentJson = "{}";
    /** 已保存路径的内存缓存：路径名 → JSON */
    private static final ConcurrentHashMap<String, String> pathCache = new ConcurrentHashMap<>();

    public static void main(String[] args) {
        System.out.println("==============================================");
        System.out.println("  MockRobot 本地联调模拟机器");
        System.out.println("  监听端口: " + PORT);
        System.out.println("  CORS: 已启用 (允许所有源)");
        System.out.println("==============================================");
        System.out.println("  API 端点:");
        System.out.println("    POST /                  — 接收 JSON 存入内存");
        System.out.println("    GET  /                  — 返回当前 JSON");
        System.out.println("    POST /save/{name}       — 持久化到指定路径");
        System.out.println("    GET  /{name}            — 查看指定路径的 JSON");
        System.out.println("    POST /load/{name}       — 加载到当前内存");
        System.out.println("    POST /clear/{name}      — 删除指定路径");
        System.out.println("    GET  /list              — 列出所有路径");
        System.out.println("    GET  /commands             — 连接检查 + 指令列表");
        System.out.println("    POST /commands/run/{name}  — 调用指令");
        System.out.println("==============================================");
        System.out.println();
        System.out.println("  键入 'q' 并回车可停止服务。");
        System.out.println("  键入 'p' 查看当前 JSON。");
        System.out.println();

        loadAllFromDisk();

        Thread serverThread = new Thread(MockRobot::runServer, "mock-http-server");
        serverThread.setPriority(Thread.MIN_PRIORITY);
        serverThread.setDaemon(true);
        serverThread.start();

        try (Scanner scanner = new Scanner(System.in)) {
            while (true) {
                try {
                    if (!scanner.hasNextLine()) {
                        // stdin closed (e.g. running in IDE), keep server alive
                        Thread.sleep(Long.MAX_VALUE);
                    }
                    String line = scanner.nextLine().trim();
                    if ("q".equalsIgnoreCase(line)) {
                        System.out.println("MockRobot 已停止。");
                        break;
                    }
                    if ("p".equalsIgnoreCase(line)) {
                        System.out.println("当前 JSON: " + currentJson);
                    } else if (!line.isEmpty()) {
                        System.out.println("未知命令。'q' 退出, 'p' 查看当前 JSON。");
                    }
                } catch (NoSuchElementException e) {
                    // stdin exhausted, keep server alive
                    Thread.sleep(Long.MAX_VALUE);
                }
            }
        } catch (InterruptedException e) {
            System.out.println("MockRobot 被中断。");
        }
        System.exit(0);
    }

    private static void runServer() {
        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            log("--- HTTP JSON Service started, listening on port: " + PORT + " ---");
            while (!Thread.currentThread().isInterrupted()) {
                try (Socket socket = serverSocket.accept()) {
                    socket.setSoTimeout(5000);
                    try (InputStream in = socket.getInputStream();
                         OutputStream output = socket.getOutputStream()) {

                        try {
                            String requestLine = readLineFromStream(in);
                            if (requestLine == null || requestLine.isEmpty()) continue;

                            boolean isPost    = requestLine.startsWith("POST");
                            boolean isGet     = requestLine.startsWith("GET");
                            boolean isOptions = requestLine.startsWith("OPTIONS");
                            String fullPath = parseRequestPath(requestLine);

                            int contentLength = 0;
                            String headerLine;
                            while (!(headerLine = readLineFromStream(in)).isEmpty()) {
                                if (headerLine.toLowerCase().startsWith("content-length:")) {
                                    try {
                                        contentLength = Integer.parseInt(headerLine.substring(15).trim());
                                    } catch (Exception ignored) {}
                                }
                            }

                            // Read body as BYTES (not chars) so Content-Length works correctly for UTF-8
                            String body = "";
                            if (contentLength > 0) {
                                byte[] bodyBytes = readBodyBytes(in, contentLength);
                                body = new String(bodyBytes, StandardCharsets.UTF_8);
                            }

                            // --- OPTIONS preflight — CORS ---
                            if (isOptions) {
                                sendResponse(output, 204, null, null);
                                continue;
                            }

                            // --- GET / — return current JSON ---
                            if (isGet && "/".equals(fullPath)) {
                                sendResponse(output, 200, "application/json", currentJson);
                                continue;
                            }

                            // --- POST / (with body) — receive JSON into current memory ---
                            if (isPost && "/".equals(fullPath) && contentLength > 0) {
                                currentJson = body;
                                log("Received JSON: " + currentJson);
                                sendResponse(output, 200, "application/json", "{\"status\":\"success\"}");
                                continue;
                            }

                            // --- Parse /action/pathName ---
                            String[] parts = fullPath.split("/", 3);
                            String action   = parts.length >= 2 ? parts[1] : "";
                            String pathName = parts.length >= 3 ? parts[2] : "";

                            // --- POST /save/{pathName} ---
                            if (isPost && "save".equals(action) && !pathName.isEmpty()) {
                                pathCache.put(pathName, currentJson);
                                saveToDisk(pathName, currentJson);
                                log("Saved path '" + pathName + "': " + currentJson);
                                sendResponse(output, 200, "application/json",
                                        "{\"status\":\"saved\",\"path\":\"" + escapeJson(pathName) + "\"}");
                                continue;
                            }

                            // --- GET /{pathName} — read saved JSON for a path
                            // pathName may be in action (e.g. GET /myPath) or pathName (e.g. GET //myPath)
                            if (isGet && !action.isEmpty() && pathName.isEmpty()
                                    && !"list".equals(action) && !"commands".equals(action)) {
                                String saved = pathCache.get(action);
                                if (saved != null) {
                                    sendResponse(output, 200, "application/json", saved);
                                } else {
                                    sendResponse(output, 404, "application/json",
                                            "{\"status\":\"not_found\",\"path\":\"" + escapeJson(action) + "\"}");
                                }
                                continue;
                            }

                            // --- POST /load/{pathName} ---
                            if (isPost && "load".equals(action) && !pathName.isEmpty()) {
                                String saved = pathCache.get(pathName);
                                if (saved != null) {
                                    currentJson = saved;
                                    log("Loaded path '" + pathName + "': " + currentJson);
                                    sendResponse(output, 200, "application/json",
                                            "{\"status\":\"loaded\",\"path\":\"" + escapeJson(pathName) + "\",\"data\":" + currentJson + "}");
                                } else {
                                    sendResponse(output, 404, "application/json",
                                            "{\"status\":\"not_found\",\"path\":\"" + escapeJson(pathName) + "\"}");
                                }
                                continue;
                            }

                            // --- POST /clear/{pathName} ---
                            if (isPost && "clear".equals(action) && !pathName.isEmpty()) {
                                pathCache.remove(pathName);
                                deleteFromDisk(pathName);
                                log("Cleared path '" + pathName + "'");
                                sendResponse(output, 200, "application/json",
                                        "{\"status\":\"cleared\",\"path\":\"" + escapeJson(pathName) + "\"}");
                                continue;
                            }

                            // --- GET /list ---
                            if (isGet && "list".equals(action)) {
                                List<String> list = new ArrayList<>(pathCache.keySet());
                                StringBuilder sb = new StringBuilder("{\"status\":\"ok\",\"paths\":[");
                                for (int i = 0; i < list.size(); i++) {
                                    if (i > 0) sb.append(",");
                                    sb.append("\"").append(escapeJson(list.get(i))).append("\"");
                                }
                                sb.append("]}");
                                sendResponse(output, 200, "application/json", sb.toString());
                                continue;
                            }

                            // --- GET /commands ---
                            if (isGet && "commands".equals(action) && pathName.isEmpty()) {
                                sendResponse(output, 200, "application/json",
                                        "{\"status\":\"ok\",\"commands\":["
                                        + "{\"name\":\"moveForward\",\"params\":[\"double\"],\"ready\":true},"
                                        + "{\"name\":\"turn\",\"params\":[\"double\"],\"ready\":true},"
                                        + "{\"name\":\"moveToPosition\",\"params\":[\"double\",\"double\"],\"ready\":true},"
                                        + "{\"name\":\"setLiftHeight\",\"params\":[\"int\"],\"ready\":true},"
                                        + "{\"name\":\"grabCone\",\"params\":[],\"ready\":true},"
                                        + "{\"name\":\"releaseCone\",\"params\":[],\"ready\":true},"
                                        + "{\"name\":\"wait\",\"params\":[\"long\"],\"ready\":true},"
                                        + "{\"name\":\"calibrateGyro\",\"params\":[],\"ready\":true}"
                                        + "]}");
                                continue;
                            }

                            // --- POST /commands/run/{commandName} ---
                            if (isPost && "commands".equals(action) && pathName.startsWith("run/")) {
                                String commandName = pathName.substring(4);
                                String commandBody = (contentLength > 0) ? body : "[]";
                                log("Command invoked: " + commandName + ", args: " + commandBody);
                                sendResponse(output, 200, "application/json", "{\"status\":\"ok\"}");
                                continue;
                            }

                            sendResponse(output, 405, "text/plain", "Method Not Allowed");
                        } catch (Exception e) {
                            System.err.println("[" + TAG + "] Request handling error: " + e.getMessage());
                            try {
                                sendResponse(output, 500, "application/json",
                                        "{\"status\":\"error\",\"message\":\"Internal Server Error\"}");
                            } catch (Exception ignored2) {}
                        }
                    }
                } catch (Exception e) {
                    System.err.println("[" + TAG + "] Error handling connection: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            System.err.println("[" + TAG + "] Server main loop crashed: " + e.getMessage());
        }
    }

    /** Parse request path, e.g. "POST /save/routeA HTTP/1.1" → "/save/routeA"
     *  URL-decodes percent-encoded UTF-8 characters so Chinese path names work. */
    private static String parseRequestPath(String requestLine) {
        String[] parts = requestLine.split(" ");
        String path = parts.length >= 2 ? parts[1] : "/";
        try {
            path = java.net.URLDecoder.decode(path, StandardCharsets.UTF_8);
        } catch (Exception ignored) {}
        return path;
    }

    /**
     * Read one line (terminated by \r\n) from the raw InputStream,
     * decoding as UTF-8. Returns "" for an empty line (just \r\n),
     * or null if the stream ends before any data.
     */
    private static String readLineFromStream(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int prev = -1;
        int ch;
        while ((ch = in.read()) != -1) {
            if (prev == '\r' && ch == '\n') {
                // Strip the trailing \r from the accumulated bytes
                byte[] bytes = line.toByteArray();
                int len = bytes.length;
                if (len > 0 && bytes[len - 1] == '\r') {
                    return new String(bytes, 0, len - 1, StandardCharsets.UTF_8);
                }
                return new String(bytes, StandardCharsets.UTF_8);
            }
            line.write(ch);
            prev = ch;
        }
        // EOF reached — return whatever was accumulated, or null if nothing
        byte[] bytes = line.toByteArray();
        return bytes.length > 0 ? new String(bytes, StandardCharsets.UTF_8) : null;
    }

    /**
     * Read exactly {@code contentLength} bytes from the stream.
     * Content-Length is a byte count, not a character count — this is critical
     * for correct UTF-8 handling when the body contains multi-byte characters.
     */
    private static byte[] readBodyBytes(InputStream in, int contentLength) throws IOException {
        byte[] buffer = new byte[contentLength];
        int totalRead = 0;
        while (totalRead < contentLength) {
            int read = in.read(buffer, totalRead, contentLength - totalRead);
            if (read == -1) break;
            totalRead += read;
        }
        return buffer;
    }

    // ---- Persistence: each path saved as a separate file ----

    private static void saveToDisk(String pathName, String json) {
        try {
            Files.createDirectories(DATA_DIR);
            Files.writeString(DATA_DIR.resolve(pathName + ".json"), json, StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.err.println("[" + TAG + "] Disk save failed '" + pathName + "': " + e.getMessage());
        }
    }

    private static void deleteFromDisk(String pathName) {
        try {
            Files.deleteIfExists(DATA_DIR.resolve(pathName + ".json"));
        } catch (Exception e) {
            System.err.println("[" + TAG + "] Disk delete failed '" + pathName + "': " + e.getMessage());
        }
    }

    /** Load all previously saved paths from disk into the in-memory cache */
    private static void loadAllFromDisk() {
        try {
            if (!Files.isDirectory(DATA_DIR)) {
                log("No local data directory, skipping load.");
                return;
            }
            try (java.util.stream.Stream<Path> files = Files.list(DATA_DIR)) {
                files.filter(f -> f.toString().endsWith(".json")).forEach(f -> {
                    try {
                        String name = f.getFileName().toString();
                        name = name.substring(0, name.length() - 5); // remove ".json"
                        String json = Files.readString(f, StandardCharsets.UTF_8);
                        pathCache.put(name, json);
                        log("Loaded path '" + name + "' from disk");
                    } catch (Exception e) {
                        System.err.println("[" + TAG + "] Load file failed: " + e.getMessage());
                    }
                });
            }
        } catch (Exception e) {
            System.err.println("[" + TAG + "] Disk load failed: " + e.getMessage());
        }
    }

    // ---- HTTP helpers ----

    /**
     * Send an HTTP response with CORS headers.
     * @param contentType may be null (e.g. for 204 No Content)
     * @param body may be null
     */
    private static void sendResponse(OutputStream out, int statusCode,
                                      String contentType, String body) throws Exception {
        byte[] bodyBytes = (body != null) ? body.getBytes(StandardCharsets.UTF_8) : null;
        StringBuilder header = new StringBuilder();
        String statusText = statusCode == 200 ? "OK"
                : statusCode == 204 ? "No Content"
                : statusCode == 404 ? "Not Found" : "ERROR";
        header.append("HTTP/1.1 ").append(statusCode).append(" ").append(statusText).append("\r\n");
        if (contentType != null) {
            header.append("Content-Type: ").append(contentType).append("\r\n");
        }
        header.append("Access-Control-Allow-Origin: *\r\n");
        header.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        header.append("Access-Control-Allow-Headers: Content-Type\r\n");
        header.append("Access-Control-Max-Age: 86400\r\n");
        if (bodyBytes != null) {
            header.append("Content-Length: ").append(bodyBytes.length).append("\r\n");
        }
        header.append("Connection: close\r\n");
        header.append("\r\n");
        out.write(header.toString().getBytes(StandardCharsets.UTF_8));
        if (bodyBytes != null) {
            out.write(bodyBytes);
        }
        out.flush();
    }

    /** Minimal JSON string escaping. */
    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    // ---- Logging ----

    private static void log(String message) {
        System.out.println("[" + TAG + "] " + message);
    }

    // ---- Public accessors ----

    /** Returns the current in-memory JSON. */
    public static String getCurrentJson() {
        return currentJson;
    }

    /** Returns the saved JSON for a named path, or null. */
    public static String getSavedJson(String pathName) {
        return pathCache.get(pathName);
    }

    /** Returns all saved path names. */
    public static List<String> getPathNames() {
        return new ArrayList<>(pathCache.keySet());
    }
}