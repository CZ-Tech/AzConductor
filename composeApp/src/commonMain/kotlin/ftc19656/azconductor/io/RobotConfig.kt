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

/**
 * Cross-platform config manager backed by multiplatform-settings.
 *
 * Now also supports asynchronous file/path polling: schedule a watcher that
 * checks a specific key every [intervalMs] and fires [onChanged] when the
 * stored value differs from the last-known snapshot.
 */
class ConfigManager private constructor(
    private val id: String,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
) {
    private val cache = mutableMapOf<String, String>()

    var isInitialized = false
        private set

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

    operator fun set(key: String, value: String) {
        cache[key] = value

        scope.launch {
            val jsonPayload = Json.encodeToString(cache)
            configStorge[id] = jsonPayload
        }
    }

    operator fun get(key: String): String? {
        return cache[key]
    }

    // ---- 异步路径轮询 (Async path polling) ----

    /**
     * Start polling [pathKey] every [intervalMs] milliseconds.
     * When the stored value changes (serialized representation differs),
     * [onChanged] is invoked on the [scope] dispatcher.
     *
     * @return a [Job] that can be cancelled to stop polling.
     */
    fun watchPath(
        pathKey: String,
        intervalMs: Long = 50L,
        onChanged: suspend (newValue: String) -> Unit
    ): Job {
        return scope.launch {
            var lastSnapshot: String? = get(pathKey)
            while (isActive) {
                delay(intervalMs)
                val current = get(pathKey)
                if (current != lastSnapshot) {
                    lastSnapshot = current
                    if (current != null) {
                        onChanged(current)
                    }
                }
            }
        }
    }

    /**
     * Store an arbitrary serialisable value under [key] and
     * persist it to the cross-platform settings storage.
     */
    inline fun <reified T> putSerializable(key: String, value: T) {
        val json = Json.encodeToString(value)
        set(key, json)
    }

    /**
     * Read a previously stored serialisable value.
     */
    inline fun <reified T> getSerializable(key: String): T? {
        val json = get(key) ?: return null
        return try {
            Json.decodeFromString<T>(json)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private val instances = mutableMapOf<String, ConfigManager>()

        suspend fun getOrAwaitCreate(id: String): ConfigManager {
            return instances.getOrPut(id) {
                ConfigManager(id).apply {
                    loadFromSettings()
                }
            }
        }

        fun getOrCreate(id: String): ConfigManager {
            return instances.getOrPut(id) {
                ConfigManager(id).apply {
                    CoroutineScope(Dispatchers.Default).launch { loadFromSettings() }
                }
            }
        }

        fun getExist(): Set<String> {
            return configStorge.keys
        }
    }
}
