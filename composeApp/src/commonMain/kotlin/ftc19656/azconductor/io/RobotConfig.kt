package ftc19656.azconductor.io

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json


class RobotConfig {
    private val config: ConfigManager

    var teamNumber: String

    constructor(robotName: String, teamNumber: String) {
        config = ConfigManager.getOrCreate(robotName)
        this.teamNumber = config["teamNumber"] ?: teamNumber
    }





}

private val configStorge = Settings()

class ConfigManager private constructor(
    private val id: String,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
) {
    // 内存中的数据快照 (使用 Map 存储当前实例的所有键值对)
    private val cache = mutableMapOf<String, String>()


    // 标记是否加载完成
    var isInitialized = false
        private set


    /**
     * 内部初始化函数：读取 JSON 并同步到内存
     */
    private suspend fun loadFromSettings() {
        withContext(Dispatchers.Default) {
            val jsonString = configStorge.getString(id, "{}")
            val map = try {
                Json.decodeFromString<Map<String, String>>(jsonString)
            } catch (e: Exception) {
                emptyMap()
            }
            cache.putAll(map)
            isInitialized = true
        }
    }

    /**
     * 同步写入内存
     */
    operator fun set(key: String, value: String) {
        // 同步写入内存
        cache[key] = value

        // 异步序列化并持久化到 globalSettings
        scope.launch {
            val jsonPayload = Json.encodeToString(cache)
            // 将 id 为键存入顶级变量
            configStorge[id] = jsonPayload
        }
    }

    /**
     * 同步读取
     */
    operator fun get(key: String): String? {
        return cache[key]
    }

    companion object {
        private val instances = mutableMapOf<String, ConfigManager>()

        /**
         * 异步初始化实例的工厂方法
         */
        suspend fun getOrAwaitCreate(id: String): ConfigManager {
            return instances.getOrPut(id) {
                ConfigManager(id).apply {
                    loadFromSettings() // 确保返回前完成读取
                }
            }
        }

        /**
         * 如果你不想写 suspend，可以使用这个“先上车后补票”的方法
         */
        fun getOrCreate(id: String): ConfigManager {
            return instances.getOrPut(id) {
                ConfigManager(id).apply {
                    // 后台加载
                    CoroutineScope(Dispatchers.Default).launch { loadFromSettings() }
                }
            }
        }

        fun getExist(): Set<String> {
            return configStorge.keys
        }
    }
}
