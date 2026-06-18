package ftc19656.azconductor.io

import com.russhwolf.settings.Settings
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.RobotRoutes
import ftc19656.azconductor.route.RouteData
import kotlinx.coroutines.Job
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 路径数据访问层，封装 JSON 序列化、平台存储、旧版兼容、跨标签页同步检测。
 *
 * 最小操作单位是一条路径（[ftc19656.azconductor.route.RouteData]）。
 * [ftc19656.azconductor.route.RobotRoutes] 是内部序列化包装，外界不可见。
 * 写入自动更新哈希信号，[watchExternalChanges] 可监听外部变更。
 */
class RouteRepository(
    private val jsonConfig: Json,
    private val configManager: ConfigManager
) {
    companion object {
        /** 跨标签页同步用的 storage key，写入时自动更新哈希值 */
        internal const val STORAGE_KEY = "robot_routes"

        private const val LEGACY_KEY = "auto_save_waypoints"
    }

    private val settingsStorage = Settings()

    private var lastPersistedHash = 0

    init {
        // 清理旧版大体积数据（Preferences 单 key 限制约 8KB）
        configManager[LEGACY_KEY] = ""
        configManager[STORAGE_KEY] = "0"
    }

    // ---- 单条路径操作 ----

    /** 加载单条路径，不存在返回 null */
    fun load(name: String): RouteData? {
        return loadAll().find { it.name == name }
    }

    /** 保存单条路径（新增或覆盖）。内部全量读取 → 替换/追加 → 全量写回 */
    fun save(route: RouteData) {
        val all = loadAll().toMutableList()
        val index = all.indexOfFirst { it.name == route.name }
        if (index >= 0) {
            all[index] = route
        } else {
            all.add(route)
        }
        writeAll(all)
    }

    /** 删除单条路径，返回是否成功 */
    fun delete(name: String): Boolean {
        val all = loadAll()
        if (all.none { it.name == name }) return false
        writeAll(all.filter { it.name != name })
        return true
    }

    /** 列出所有路径名 */
    fun listNames(): List<String> = loadAll().map { it.name }

    // ---- 批量操作 ----

    /** 加载全部路径（用于初始化） */
    fun loadAll(): List<RouteData> {
        val json = loadRouteData()
        if (!json.isNullOrBlank()) {
            return try {
                jsonConfig.decodeFromString<List<RobotRoutes>>(json)
                    .flatMap { it.routes }
            } catch (_: Exception) {
                emptyList()
            }
        }
        // 旧版兼容：从 Settings 读取旧格式
        val legacyJson = settingsStorage.getString(LEGACY_KEY, "")
        if (legacyJson.isNotBlank()) {
            return try {
                val points = jsonConfig.decodeFromString<List<ControlNode>>(legacyJson)
                listOf(RouteData(name = "默认路径", points = points))
            } catch (_: Exception) {
                emptyList()
            }
        }
        return emptyList()
    }

    /** 覆盖写入全部路径（用于导入等场景） */
fun saveAll(routes: List<RouteData>) {
        writeAll(routes)
    }

    /**
     * 仅当路由列表哈希与上次持久化值不同时才写入存储。
     * @return true 表示实际写入了存储，false 表示跳过（无变化）。
     */
    fun saveIfChanged(routes: List<RouteData>): Boolean {
        if (routes.hashCode() == lastPersistedHash) return false
        writeAll(routes)
        return true
    }

    // ---- 导入导出 ----

    /** 导出全部路径为 JSON 字符串 */
    fun exportJson(routes: List<RouteData>): String {
        return jsonConfig.encodeToString(listOf(RobotRoutes(routes = routes)))
    }

    /** 从 JSON 字符串解析路径列表，失败返回 null。兼容新旧两种格式 */
    fun importJson(jsonText: String): List<RouteData>? {
        return try {
            val robots = jsonConfig.decodeFromString<List<RobotRoutes>>(jsonText)
            robots.flatMap { it.routes }
        } catch (_: Exception) {
            // 旧版格式回退：直接是 List<ControlNode>
            try {
                val points = jsonConfig.decodeFromString<List<ControlNode>>(jsonText)
                listOf(RouteData(name = "导入路径", points = points))
            } catch (e2: Exception) {
                println("RouteRepository: import failed: ${e2.message}")
                null
            }
        }
    }

    // ---- 内部实现 ----

    private fun writeAll(routes: List<RouteData>) {
        val robots = listOf(RobotRoutes(routes = routes))
        val json = jsonConfig.encodeToString(robots)
        saveRouteData(json)
        lastPersistedHash = routes.hashCode()
        configManager[STORAGE_KEY] = lastPersistedHash.toString()
    }

    // ---- 跨标签页监听 ----

    /**
     * [ConfigManager.watchPath] 并内部维护 [lastPersistedHash]，只在外部变更时回调。
     * 同一实例通过 [writeAll] 写入不会触发回调。
     *
     * @return 可用于取消监听的 [Job]。
     */
    fun watchExternalChanges(
        intervalMs: Long = 50L,
        onChanged: (List<RouteData>) -> Unit
    ): Job {
        return configManager.watchPath(STORAGE_KEY, intervalMs) { newValue ->
            val remoteHash = newValue.toIntOrNull() ?: return@watchPath
            if (remoteHash != lastPersistedHash) {
                val routes = loadAll()
                if (routes.isNotEmpty()) {
                    lastPersistedHash = remoteHash
                    onChanged(routes)
                }
            }
        }
    }
}