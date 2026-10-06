package ftc19656.azconductor

import ftc19656.azconductor.io.ConfigManager
import ftc19656.azconductor.io.RouteRepository
import ftc19656.azconductor.io.SyncManager
import ftc19656.azconductor.io.network.RobotConnection
import kotlinx.serialization.json.Json

/**
 * Composition root — creates and wires shared service dependencies so that
 * individual classes don't need to instantiate their own.
 *
 * Every dependency has a single source of truth here; [RouteConnector]
 * accepts them as constructor parameters (defaulting to these instances).
 */
object AppContext {

    val jsonConfig = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    val configManager = ConfigManager.getOrCreate("route")

    val routeRepo = RouteRepository(jsonConfig, configManager)

    val robotConnection = RobotConnection(
        robotIp = configManager["robot_ip"] ?: "192.168.43.1",
        json = jsonConfig,
    )

    val syncManager = SyncManager(
        jsonConfig = jsonConfig,
        configManager = configManager,
        routeRepo = routeRepo,
        connection = robotConnection,
    )
}
