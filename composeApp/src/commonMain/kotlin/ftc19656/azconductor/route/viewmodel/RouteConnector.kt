package ftc19656.azconductor.route.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.russhwolf.settings.Settings
import ftc19656.azconductor.io.ConfigManager
import ftc19656.azconductor.io.RemoteSave
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.OrientedTrajectoryGenerator2D
import ftc19656.azconductor.route.RouteCore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

class RouteConnector(
    private val autoSaveKey: String = "auto_save_waypoints",
    private val autoSaveIntervalMs: Long = 50L
) : ViewModel() {

    private val configManager = ConfigManager.getOrCreate("route")
    private val settingsStorage = Settings()  // direct access for immediate read/write

    // underlying pure-logic instance
    private val routeLogic = RouteCore()

    // JSON serialisation config
    private val jsonConfig = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    // ---- Remote save to robot ----

    /**
     * The robot's IP address for remote persistence.
     * Stored in ConfigManager so it survives app restarts.
     * Defaults to "" (empty → remote save is disabled).
     */
    var robotIp: String
        get() = configManager["robot_ip"] ?: ""
        set(value) {
            configManager["robot_ip"] = value
            // rebuild RemoteSave with new IP
            remoteSave = if (value.isNotBlank()) {
                RemoteSave(value) { status -> connectionStatus = status }
            } else {
                null
            }
        }

    private var remoteSave: RemoteSave? = null

    init {
        // initialise from stored config
        val stored = configManager["robot_ip"] ?: ""
        if (stored.isNotBlank()) {
            remoteSave = RemoteSave(stored) { status -> connectionStatus = status }
        }
    }

    // UI-dedicated version stamp
    var pathVersion by mutableStateOf(0)

    /** Remote save connection status, displayed in the bottom status bar. */
    var connectionStatus by mutableStateOf("")
        private set

    // Observable state list for Compose
    private val _waypoints = mutableStateListOf<ControlNode>()
    val waypoints: List<ControlNode> get() = _waypoints

    val trajectoryList: List<OrientedTrajectoryGenerator2D>
        get() = routeLogic.trajectoryList

    val lastPoint: ControlNode? get() = routeLogic.lastPoint
    val totalLength: Double get() = routeLogic.totalLength

    fun getTotalTime() = routeLogic.totalTime

    // ---- auto-save watcher ----

    private val watcherScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var autoSaveJob: Job? = null

    /**
     * Start (or restart) the async polling watcher.
     * Every [autoSaveIntervalMs] the watcher checks whether the stored
     * serialized waypoints have changed.  When a change is detected the
     * new value is automatically written to the cross-platform
     * [ConfigManager] (and therefore to [com.russhwolf.settings.Settings]).
     *
     * Because the watcher only *reads* the serialized payload from
     * [configManager] and never writes it from the watcher coroutine,
     * the actual persistence happens synchronously in the mutation
     * methods below (see [saveToConfig]), and the watcher is there to
     * catch external modifications that should be reflected back into
     * the live UI list.
     */
    fun startAutoSaveWatcher() {
        stopAutoSaveWatcher()

        // Read directly from the underlying Settings (e.g. localStorage on JS)
        // rather than from ConfigManager.cache, which may not be populated yet
        // because loadFromSettings() runs asynchronously.
        val savedJson = settingsStorage.getString(autoSaveKey, "")
        if (savedJson.isNotBlank()) {
            try {
                val restored = jsonConfig.decodeFromString<List<ControlNode>>(savedJson)
                if (restored.isNotEmpty()) {
                    setWaypointsSilent(restored)
                }
            } catch (_: Exception) {
                // corrupted data ? ignore and start fresh
            }
        }

        autoSaveJob = configManager.watchPath(
            pathKey = autoSaveKey,
            intervalMs = autoSaveIntervalMs
        ) { newValue ->
            val parsed = try {
                jsonConfig.decodeFromString<List<ControlNode>>(newValue)
            } catch (_: Exception) {
                return@watchPath
            }
            if (parsed != _waypoints.toList()) {
                setWaypointsSilent(parsed)
            }
        }
    }

    fun stopAutoSaveWatcher() {
        autoSaveJob?.cancel()
        autoSaveJob = null
    }

    /** Persist current waypoints without bumping pathVersion unnecessarily. */
    private fun saveToConfig() {
        val json = jsonConfig.encodeToString(_waypoints.toList())
        // Write to both: ConfigManager cache (for watchPath polling) AND
        // directly to the underlying key-value store (Settings) for immediate durability.
        configManager[autoSaveKey] = json
        settingsStorage.putString(autoSaveKey, json)

        // Also send to the robot's HTTP service if an IP is configured
        remoteSave?.send(json)
    }

    /** Replace waypoints internally without side-effects (used by watcher). */
    private fun setWaypointsSilent(points: List<ControlNode>) {
        routeLogic.setWaypoints(points)
        _waypoints.clear()
        _waypoints.addAll(points)
        pathVersion++
    }

    // ---- CRUD with auto-persist ----

    fun addPoint(point: ControlNode) {
        routeLogic.addPoint(point)
        _waypoints.add(point)
        pathVersion++
        saveToConfig()
    }

    fun setWaypoints(points: List<ControlNode>) {
        routeLogic.setWaypoints(points)
        _waypoints.clear()
        _waypoints.addAll(points)
        pathVersion++
        saveToConfig()
    }

    fun moveNode(index: Int, newPoint: ControlNode) {
        routeLogic.moveNode(index, newPoint)
        if (index in _waypoints.indices) {
            _waypoints[index] = newPoint
            pathVersion++
            saveToConfig()
        }
    }

    fun moveNodeOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in _waypoints.indices || toIndex !in _waypoints.indices || fromIndex == toIndex) return
        routeLogic.moveNodeOrder(fromIndex, toIndex)
        val node = _waypoints.removeAt(fromIndex)
        _waypoints.add(toIndex, node)
        pathVersion++
        saveToConfig()
    }

    fun removeNode(index: Int) {
        routeLogic.removeNode(index)
        if (index in _waypoints.indices) {
            _waypoints.removeAt(index)
            pathVersion++
            saveToConfig()
        }
    }

    fun moveNode(sourceNode: ControlNode, destinationNode: ControlNode) {
        val index = _waypoints.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode)
    }

    fun removeNode(point2D: ControlNode) {
        val index = _waypoints.indexOfFirst { it isCloseTo point2D }
        if (index != -1) removeNode(index)
    }

    // ---- read-only delegation ----

    fun getNodes(): List<ControlNode> = routeLogic.getNodes()
    fun getPointAtTime(time: Double): ControlNode? = routeLogic.getPointAtTime(time)
    override fun toString(): String = routeLogic.toString()
    fun getNodeAt(index: Int): ControlNode = routeLogic.getNodeAt(index)

    // ---- explicit import / export (still available) ----

    fun exportToJson(): String {
        return jsonConfig.encodeToString(_waypoints.toList())
    }

    fun importFromJson(jsonText: String): Boolean {
        return try {
            val importedWaypoints = jsonConfig.decodeFromString<List<ControlNode>>(jsonText)
            setWaypoints(importedWaypoints)
            true
        } catch (e: Exception) {
            println("Import failed: ${e.message}")
            false
        }
    }
}


