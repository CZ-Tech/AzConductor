package org.firstinspires.ftc.teamcode.common.util;

import android.content.Context;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.util.Log;

import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

import org.firstinspires.ftc.robotcore.internal.opmode.InstanceOpModeManager;
import org.firstinspires.ftc.robotcore.internal.opmode.InstanceOpModeRegistrar;
import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;
import org.firstinspires.ftc.robotcore.internal.opmode.RegisteredOpModes;
import org.firstinspires.ftc.teamcode.common.Robot;
import org.firstinspires.ftc.teamcode.common.TaskLoopFrame;
import org.firstinspires.ftc.teamcode.opmode.auto.JsonPathOpMode;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A simple HTTP service that starts automatically when the RC App launches (via @OpModeRegistrar),
 * allowing external clients to send and retrieve JSON data over HTTP on port 8888.
 * Supports named paths so multiple configs/routes can be stored independently.
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
 *   <tr><td>GET</td><td>/tasks</td><td>None</td><td>{"status":"ok","tasks":[...]}</td><td>List all registered {@link AutoTask} tasks with signatures</td></tr>
 *   <tr><td>POST</td><td>/tasks/run/{name}</td><td>JSON array of args</td><td>{"status":"ok"}</td><td>Invoke a registered task by name</td></tr>
 * </table>
 *
 * <h2>CORS</h2>
 * All responses include CORS headers (Access-Control-Allow-Origin: *, etc.) so browser-based
 * clients can call the API from any origin without being blocked.
 *
 * <h2>Typical Workflow</h2>
 * <pre>
 *   curl -X POST http://&lt;robot-ip&gt;:8888/ -d '{"route":"A","waypoints":[...]}'
 *   curl -X POST http://&lt;robot-ip&gt;:8888/save/routeA
 *   curl -X POST http://&lt;robot-ip&gt;:8888/ -d '{"route":"B","waypoints":[...]}'
 *   curl -X POST http://&lt;robot-ip&gt;:8888/save/routeB
 *   curl http://&lt;robot-ip&gt;:8888/list
 *   curl -X POST http://&lt;robot-ip&gt;:8888/load/routeA
 *   curl -X POST http://&lt;robot-ip&gt;:8888/clear/routeB
 * </pre>
 *
 * <h2>Persistence</h2>
 * Each path is stored as a separate SharedPreferences key ({@code http_saved_json_{pathName}}),
 * surviving app updates. Only a full uninstall or "Clear Data" removes them.
 *
 * <h2>AutoTask System</h2>
 * Classes and methods annotated with {@code @AutoTask} are automatically registered as
 * HTTP-invokable tasks when {@link #scanObjectTree(Object)} is called (triggered internally
 * by {@code TrajectoryLoader.execute()}). Invoked tasks run on independent threads via
 * {@code TaskLoopFrame.runOnce()}.
 *
 * <h2>Thread Safety</h2>
 * {@code currentJson} is volatile; the path cache and task registry use ConcurrentHashMap.
 * Server runs on a daemon min-priority thread.
 */
public class HttpJsonService {
    private static final String TAG = "HttpJsonService";
    private static final int PORT = 8888;
    private static final String PREF_KEY_PREFIX = "http_saved_json_";

    private static final String JSON_OPMODE_GROUP = "JSON Routes";
    private static boolean isStarted = false;
    private static Context appContext;
    private static RegisteredOpModes registeredOpModes;

    /** Current in-memory JSON. volatile for cross-thread visibility. */
    private static volatile String currentJson = "{}";
    /** In-memory cache: pathName → saved JSON. ConcurrentHashMap for thread safety. */
    private static final ConcurrentHashMap<String, String> pathCache = new ConcurrentHashMap<>();

    /** Task registry: taskName → TaskEntry. Populated by scanObjectTree(). */
    private static final ConcurrentHashMap<String, TaskEntry> taskRegistry = new ConcurrentHashMap<>();
    /** Tracks which root objects have already been scanned (by identity hash). */
    private static final Set<Integer> scannedRoots = new HashSet<>();

    /** Holds a registered task's invocation metadata. */
    static class TaskEntry {
        final String name;
        final String matchKey;
        volatile Object instance;
        final Method method;
        final Class<?>[] paramTypes;
        volatile boolean ready;

        TaskEntry(String name, String matchKey, Object instance, Method method,
                  Class<?>[] paramTypes, boolean ready) {
            this.name = name;
            this.matchKey = matchKey;
            this.instance = instance;
            this.method = method;
            this.paramTypes = paramTypes;
            this.ready = ready;
        }
    }

    @OpModeRegistrar
    public static void initService(Context context, OpModeManager manager) {
        if (!isStarted) {
            appContext = context.getApplicationContext();
            loadAllPathsFromDisk();

            // Store reference to RegisteredOpModes for dynamic updates
            registeredOpModes = RegisteredOpModes.getInstance();

            // Register a registrar that provides JsonPathOpMode instances for each saved path.
            // Called once at startup, and again whenever registerInstanceOpModes() is invoked.
            registeredOpModes.addInstanceOpModeRegistrar(new InstanceOpModeRegistrar() {
                @Override
                public void register(InstanceOpModeManager manager) {
                    for (String pathName : pathCache.keySet()) {
                        String opModeName = "Json:" + pathName;
                        OpModeMeta meta = new OpModeMeta.Builder()
                                .setName(opModeName)
                                .setFlavor(OpModeMeta.Flavor.AUTONOMOUS)
                                .setGroup(JSON_OPMODE_GROUP)
                                .build();
                        manager.register(meta, new JsonPathOpMode(pathName));
                        Log.d(TAG, "Registered dynamic OpMode: " + opModeName);
                    }
                }
            });

            // Trigger initial registration: the SDK has already passed the point
            // where InstanceOpModeRegistrars are called, so we must call it ourselves.
            registeredOpModes.registerInstanceOpModes();

            scanClassTree(Robot.class);

            Thread serverThread = new Thread(HttpJsonService::runServer);
            serverThread.setPriority(Thread.MIN_PRIORITY);
            serverThread.setDaemon(true);
            serverThread.start();
            isStarted = true;
            Log.i(TAG, "--- HTTP JSON Service started, listening on port: " + PORT + " ---");
        }
    }

    private static void runServer() {
        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            while (!Thread.currentThread().isInterrupted()) {
                try (Socket socket = serverSocket.accept()) {
                    socket.setSoTimeout(5000);
                    try (BufferedReader reader = new BufferedReader(
                            new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                         OutputStream output = socket.getOutputStream()) {

                        try {
                            String requestLine = reader.readLine();
                            if (requestLine == null) continue;

                            boolean isPost    = requestLine.startsWith("POST");
                            boolean isGet     = requestLine.startsWith("GET");
                            boolean isOptions = requestLine.startsWith("OPTIONS");
                            String fullPath = parseRequestPath(requestLine);

                            int contentLength = 0;
                            String headerLine;
                            while ((headerLine = reader.readLine()) != null && !headerLine.isEmpty()) {
                                if (headerLine.toLowerCase().startsWith("content-length:")) {
                                    try {
                                        contentLength = Integer.parseInt(headerLine.substring(15).trim());
                                    } catch (Exception ignored) {}
                                }
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
                                currentJson = readBody(reader, contentLength);
                                Log.d(TAG, "Received JSON: " + currentJson);
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
                                refreshDynamicOpModes();
                                Log.i(TAG, "Saved path '" + pathName + "': " + currentJson);
                                sendResponse(output, 200, "application/json",
                                        "{\"status\":\"saved\",\"path\":\"" + pathName + "\"}");
                                continue;
                            }

                            // --- GET /{pathName} — read saved JSON for a path
                            // pathName may be in action (e.g. GET /myPath) or pathName (e.g. GET //myPath)
                            if (isGet && !action.isEmpty() && pathName.isEmpty()
                                    && !"list".equals(action) && !"tasks".equals(action)) {
                                String saved = pathCache.get(action);
                                if (saved != null) {
                                    sendResponse(output, 200, "application/json", saved);
                                } else {
                                    sendResponse(output, 404, "application/json",
                                            "{\"status\":\"not_found\",\"path\":\"" + action + "\"}");
                                }
                                continue;
                            }

                            // --- POST /load/{pathName} ---
                            if (isPost && "load".equals(action) && !pathName.isEmpty()) {
                                String saved = pathCache.get(pathName);
                                if (saved != null) {
                                    currentJson = saved;
                                    Log.i(TAG, "Loaded path '" + pathName + "': " + currentJson);
                                    sendResponse(output, 200, "application/json",
                                            "{\"status\":\"loaded\",\"path\":\"" + pathName + "\",\"data\":" + currentJson + "}");
                                } else {
                                    sendResponse(output, 404, "application/json",
                                            "{\"status\":\"not_found\",\"path\":\"" + pathName + "\"}");
                                }
                                continue;
                            }

                            // --- POST /clear/{pathName} ---
                            if (isPost && "clear".equals(action) && !pathName.isEmpty()) {
                                pathCache.remove(pathName);
                                deleteFromDisk(pathName);
                                refreshDynamicOpModes();
                                Log.i(TAG, "Cleared path '" + pathName + "'");
                                sendResponse(output, 200, "application/json",
                                        "{\"status\":\"cleared\",\"path\":\"" + pathName + "\"}");
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

                            // --- GET /tasks ---
                            if (isGet && "tasks".equals(action) && pathName.isEmpty()) {
                                StringBuilder sb = new StringBuilder("{\"status\":\"ok\",\"tasks\":[");
                                boolean first = true;
                                for (TaskEntry entry : taskRegistry.values()) {
                                    if (!first) sb.append(",");
                                    first = false;
                                    sb.append("{\"name\":\"").append(escapeJson(entry.name))
                                      .append("\",\"params\":[");
                                    for (int i = 0; i < entry.paramTypes.length; i++) {
                                        if (i > 0) sb.append(",");
                                        sb.append("\"").append(typeName(entry.paramTypes[i])).append("\"");
                                    }
                                    sb.append("],\"ready\":").append(entry.ready).append("}");
                                }
                                sb.append("]}");
                                sendResponse(output, 200, "application/json", sb.toString());
                                continue;
                            }

                            // --- POST /tasks/run/{taskName} ---
                            if (isPost && "tasks".equals(action) && pathName.startsWith("run/")) {
                                String taskName = pathName.substring(4);
                                TaskEntry entry = taskRegistry.get(taskName);
                                if (entry == null) {
                                    sendResponse(output, 404, "application/json",
                                            "{\"status\":\"error\",\"message\":\"Task not found: " + escapeJson(taskName) + "\"}");
                                    continue;
                                }
                                if (!entry.ready || entry.instance == null) {
                                    sendResponse(output, 503, "application/json",
                                            "{\"status\":\"error\",\"message\":\"Task not ready: " + escapeJson(taskName) + " (no active OpMode)\"}");
                                    continue;
                                }
                                try {
                                    String body = (contentLength > 0) ? readBody(reader, contentLength) : "[]";
                                    JSONArray jsonArgs = new JSONArray(body);
                                    Object[] args = convertArgs(jsonArgs, entry.paramTypes);
                                    TaskLoopFrame.runOnce(() -> {
                                        try {
                                            entry.method.invoke(entry.instance, args);
                                        } catch (Exception e) {
                                            Log.e(TAG, "Task invocation failed: " + entry.name, e);
                                        }
                                    });
                                    sendResponse(output, 200, "application/json", "{\"status\":\"ok\"}");
                                } catch (Exception e) {
                                    sendResponse(output, 400, "application/json",
                                            "{\"status\":\"error\",\"message\":\"" + escapeJson(e.getMessage()) + "\"}");
                                }
                                continue;
                            }

                            sendResponse(output, 405, "text/plain", "Method Not Allowed");
                        } catch (Exception e) {
                            Log.e(TAG, "Request handling error: " + e.getMessage());
                            try {
                                sendResponse(output, 500, "application/json",
                                        "{\"status\":\"error\",\"message\":\"Internal Server Error\"}");
                            } catch (Exception ignored2) {}
                        }
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error handling connection: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Server main loop crashed: " + e.getMessage());
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

    /** Read the request body for a given Content-Length */
    private static String readBody(BufferedReader reader, int contentLength) throws Exception {
        char[] buffer = new char[contentLength];
        int totalRead = 0;
        while (totalRead < contentLength) {
            int read = reader.read(buffer, totalRead, contentLength - totalRead);
            if (read == -1) break;
            totalRead += read;
        }
        return new String(buffer);
    }

    // ---- Persistence: each path saved as a separate SharedPreferences key ----

    private static String prefKey(String pathName) {
        return PREF_KEY_PREFIX + pathName;
    }

    private static void saveToDisk(String pathName, String json) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(appContext);
        prefs.edit().putString(prefKey(pathName), json).apply();
    }

    private static void deleteFromDisk(String pathName) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(appContext);
        prefs.edit().remove(prefKey(pathName)).apply();
    }

    /** Load all previously saved paths from SharedPreferences into the in-memory cache */
    private static void loadAllPathsFromDisk() {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(appContext);
        for (String key : prefs.getAll().keySet()) {
            if (key.startsWith(PREF_KEY_PREFIX)) {
                String pathName = key.substring(PREF_KEY_PREFIX.length());
                String json = prefs.getString(key, null);
                if (json != null) {
                    pathCache.put(pathName, json);
                    Log.d(TAG, "Loaded path '" + pathName + "' from disk");
                }
            }
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

    // ---- Task registration and invocation ----

    /**
     * Type-level scan: traverses the class hierarchy starting from {@code rootClass},
     * following field types (not values) to discover {@link AutoTask} annotations.
     * Registers task signatures without instances ({@code ready = false}).
     * Called at app startup so task names are visible even before any OpMode runs.
     */
    public static void scanClassTree(Class<?> rootClass) {
        if (rootClass == null) return;
        Log.i(TAG, "Scanning class tree from root: " + rootClass.getSimpleName());

        Deque<Class<?>> stack = new ArrayDeque<>();
        Set<Class<?>> visited = new HashSet<>();
        stack.push(rootClass);

        while (!stack.isEmpty()) {
            Class<?> clazz = stack.pop();
            if (clazz == null || !visited.add(clazz)) continue;

            registerTaskSignatures(clazz);

            if (!isUserClass(clazz)) continue;

            for (Field field : getAllFields(clazz)) {
                if (Modifier.isStatic(field.getModifiers())) continue;
                Class<?> fieldType = field.getType();
                if (fieldType.isPrimitive() || fieldType == String.class
                        || fieldType.isEnum() || Number.class.isAssignableFrom(fieldType)
                        || Boolean.class == fieldType || Character.class == fieldType) {
                    continue;
                }
                stack.push(fieldType);
            }
        }
        Log.i(TAG, "Class scan complete. Pre-registered " + taskRegistry.size() + " task signatures.");
    }

    /** Registers task signatures (name + param types) from a class without an instance. */
    private static void registerTaskSignatures(Class<?> clazz) {
        boolean classAnnotated = clazz.isAnnotationPresent(AutoTask.class);

        for (Method method : clazz.getDeclaredMethods()) {
            AutoTask annot = method.getAnnotation(AutoTask.class);
            if (annot == null && !classAnnotated) continue;
            if (!Modifier.isPublic(method.getModifiers())) continue;

            String taskName = (annot != null && !annot.value().isEmpty())
                    ? annot.value() : method.getName();
            String matchKey = buildMatchKey(clazz, method);

            if (!taskRegistry.containsKey(taskName)) {
                method.setAccessible(true);
                Class<?>[] paramTypes = method.getParameterTypes();
                taskRegistry.put(taskName,
                        new TaskEntry(taskName, matchKey, null, method, paramTypes, false));
                Log.d(TAG, "Pre-registered task: " + taskName + " (" + clazz.getSimpleName() + ") [not ready]");
            }
        }
    }

    /**
     * Instance-level scan: traverses the object graph starting from {@code root},
     * matching each discovered {@link AutoTask} method against pre-registered entries
     * and populating their instance reference so they become invokable.
     * <p>
     * When a new root is detected (different from previously scanned roots),
     * all existing instances are invalidated first to prevent stale references
     * after an OpMode restart.
     */
    public static void scanObjectTree(Object root) {
        if (root == null) return;
        int rootId = System.identityHashCode(root);
        synchronized (scannedRoots) {
            if (scannedRoots.contains(rootId)) return;
            // New root -> new OpMode, invalidate all old instances
            for (TaskEntry entry : taskRegistry.values()) {
                entry.instance = null;
                entry.ready = false;
            }
            scannedRoots.clear();
            scannedRoots.add(rootId);
        }
        Log.i(TAG, "Scanning object tree from root: " + root.getClass().getSimpleName());

        Deque<Object> stack = new ArrayDeque<>();
        Set<Integer> visited = new HashSet<>();
        stack.push(root);

        while (!stack.isEmpty()) {
            Object obj = stack.pop();
            if (obj == null) continue;
            int id = System.identityHashCode(obj);
            if (!visited.add(id)) continue;

            Class<?> clazz = obj.getClass();
            matchTaskInstances(clazz, obj);

            if (!isUserClass(clazz)) continue;

            for (Field field : getAllFields(clazz)) {
                if (Modifier.isStatic(field.getModifiers())) continue;
                field.setAccessible(true);
                try {
                    Object value = field.get(obj);
                    if (value == null) continue;
                    Class<?> valueClass = value.getClass();
                    if (valueClass.isPrimitive() || valueClass == String.class
                            || valueClass.isEnum() || Number.class.isAssignableFrom(valueClass)
                            || Boolean.class == valueClass || Character.class == valueClass) {
                        continue;
                    }
                    stack.push(value);
                } catch (Exception ignored) {
                }
            }
        }
        Log.i(TAG, "Instance scan complete. " + countReady() + " tasks ready.");
    }

    /** Matches a discovered object's methods against pre-registered TaskEntry by matchKey. */
    private static void matchTaskInstances(Class<?> clazz, Object instance) {
        boolean classAnnotated = clazz.isAnnotationPresent(AutoTask.class);

        for (Method method : clazz.getDeclaredMethods()) {
            AutoTask annot = method.getAnnotation(AutoTask.class);
            if (annot == null && !classAnnotated) continue;
            if (!Modifier.isPublic(method.getModifiers())) continue;

            String matchKey = buildMatchKey(clazz, method);
            for (TaskEntry entry : taskRegistry.values()) {
                if (matchKey.equals(entry.matchKey) && entry.instance == null) {
                    entry.method.setAccessible(true);
                    entry.instance = instance;
                    entry.ready = true;
                    Log.d(TAG, "Task ready: " + entry.name + " (" + clazz.getSimpleName() + ")");
                    break;
                }
            }
        }
    }

    /** Builds a unique match key: "fully.qualified.ClassName:methodName:paramType1,paramType2". */
    private static String buildMatchKey(Class<?> clazz, Method method) {
        StringBuilder sb = new StringBuilder(clazz.getName())
                .append(":").append(method.getName()).append(":");
        Class<?>[] params = method.getParameterTypes();
        for (int i = 0; i < params.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(params[i].getName());
        }
        return sb.toString();
    }

    /** Returns the count of ready tasks. */
    private static int countReady() {
        int count = 0;
        for (TaskEntry entry : taskRegistry.values()) {
            if (entry.ready) count++;
        }
        return count;
    }

    /** Returns all declared fields of a class, including inherited ones (up to but not including Object). */
    private static List<Field> getAllFields(Class<?> clazz) {
        List<Field> fields = new ArrayList<>();
        while (clazz != null && clazz != Object.class) {
            for (Field f : clazz.getDeclaredFields()) {
                fields.add(f);
            }
            clazz = clazz.getSuperclass();
        }
        return fields;
    }

    /** Returns true if the class belongs to our own codebase (should be recursively traversed). */
    private static boolean isUserClass(Class<?> clazz) {
        String name = clazz.getName();
        return name.startsWith("org.firstinspires.ftc.teamcode");
    }

    /** Returns a human-readable name for a parameter type. */
    private static String typeName(Class<?> type) {
        if (type == int.class) return "int";
        if (type == long.class) return "long";
        if (type == float.class) return "float";
        if (type == double.class) return "double";
        if (type == boolean.class) return "boolean";
        if (type == byte.class) return "byte";
        if (type == short.class) return "short";
        if (type == char.class) return "char";
        if (type == String.class) return "String";
        if (type == Integer.class) return "int";
        if (type == Long.class) return "long";
        if (type == Float.class) return "float";
        if (type == Double.class) return "double";
        if (type == Boolean.class) return "boolean";
        if (type == Byte.class) return "byte";
        if (type == Short.class) return "short";
        if (type == Character.class) return "char";
        return type.getSimpleName();
    }

    /** Converts a JSONArray to an Object[] matching the target parameter types. */
    private static Object[] convertArgs(JSONArray jsonArgs, Class<?>[] paramTypes) throws Exception {
        if (jsonArgs.length() != paramTypes.length) {
            throw new IllegalArgumentException("Expected " + paramTypes.length
                    + " arguments, got " + jsonArgs.length());
        }
        Object[] result = new Object[paramTypes.length];
        for (int i = 0; i < paramTypes.length; i++) {
            result[i] = convertArg(jsonArgs.get(i), paramTypes[i]);
        }
        return result;
    }

    /** Converts a single JSON value to the target Java type. */
    private static Object convertArg(Object jsonValue, Class<?> targetType) throws Exception {
        if (jsonValue == JSONObject.NULL || jsonValue == null) {
            if (targetType.isPrimitive()) {
                throw new IllegalArgumentException("Cannot pass null for primitive parameter " + typeName(targetType));
            }
            return null;
        }

        if (targetType == String.class) {
            return jsonValue.toString();
        }
        if (targetType == char.class || targetType == Character.class) {
            String s = jsonValue.toString();
            if (s.isEmpty()) throw new IllegalArgumentException("Empty string for char parameter");
            return s.charAt(0);
        }

        // Numeric conversions
        if (jsonValue instanceof Number) {
            Number num = (Number) jsonValue;
            if (targetType == int.class || targetType == Integer.class) return num.intValue();
            if (targetType == long.class || targetType == Long.class) return num.longValue();
            if (targetType == float.class || targetType == Float.class) return num.floatValue();
            if (targetType == double.class || targetType == Double.class) return num.doubleValue();
            if (targetType == byte.class || targetType == Byte.class) return num.byteValue();
            if (targetType == short.class || targetType == Short.class) return num.shortValue();
        }

        if (jsonValue instanceof Boolean) {
            if (targetType == boolean.class || targetType == Boolean.class) return jsonValue;
        }

        // String-to-number fallback
        if (jsonValue instanceof String) {
            String s = (String) jsonValue;
            if (targetType == int.class || targetType == Integer.class) return Integer.parseInt(s);
            if (targetType == long.class || targetType == Long.class) return Long.parseLong(s);
            if (targetType == float.class || targetType == Float.class) return Float.parseFloat(s);
            if (targetType == double.class || targetType == Double.class) return Double.parseDouble(s);
            if (targetType == byte.class || targetType == Byte.class) return Byte.parseByte(s);
            if (targetType == short.class || targetType == Short.class) return Short.parseShort(s);
            if (targetType == boolean.class || targetType == Boolean.class) return Boolean.parseBoolean(s);
            if (targetType == char.class || targetType == Character.class) return s.charAt(0);
        }

        throw new IllegalArgumentException("Cannot convert " + jsonValue.getClass().getSimpleName()
                + " to " + typeName(targetType));
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

    /**
     * Triggers the FTC SDK to unregister then re-register all instance OpModes.
     * Called after any save or clear to keep the Driver Station OpMode list
     * in sync with the current path list.
     */
    public static void refreshDynamicOpModes() {
        if (registeredOpModes != null) {
            registeredOpModes.registerInstanceOpModes();
        }
    }
}
