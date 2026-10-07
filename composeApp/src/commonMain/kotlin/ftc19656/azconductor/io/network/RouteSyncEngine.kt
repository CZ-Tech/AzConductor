package ftc19656.azconductor.io.network

/**
 * Local route storage adapter used by the network sync engine.
 *
 * This deliberately deals in opaque route JSON so the HTTP layer does not depend on
 * ControlNode, RouteRepository, Compose state, or any UI/core model.
 */
interface LocalRouteAdapter {
    fun list(): List<LocalRouteRecord>
    fun get(name: String): LocalRouteRecord?
    fun put(name: String, json: String)
    fun delete(name: String)
}

data class LocalRouteRecord(
    val name: String,
    val json: String,
) {
    val fingerprint: String get() = stableFingerprint(json)
}

data class RouteSyncBaseline(
    val routeName: String,
    val localFingerprint: String,
    val remoteRevision: Long,
)

interface RouteSyncBaselineStore {
    fun get(robotKey: String, routeName: String): RouteSyncBaseline?
    fun put(robotKey: String, baseline: RouteSyncBaseline)
    fun remove(robotKey: String, routeName: String)
    fun clearRobot(robotKey: String)
}

class InMemoryRouteSyncBaselineStore : RouteSyncBaselineStore {
    private val values = mutableMapOf<String, RouteSyncBaseline>()

    override fun get(robotKey: String, routeName: String): RouteSyncBaseline? =
        values[key(robotKey, routeName)]

    override fun put(robotKey: String, baseline: RouteSyncBaseline) {
        values[key(robotKey, baseline.routeName)] = baseline
    }

    override fun remove(robotKey: String, routeName: String) {
        values.remove(key(robotKey, routeName))
    }

    override fun clearRobot(robotKey: String) {
        val prefix = robotKey + "\u0000"
        values.keys.filter { it.startsWith(prefix) }.forEach(values::remove)
    }

    private fun key(robotKey: String, routeName: String) =
        robotKey + "\u0000" + routeName
}

enum class RouteConflictReason {
    /** No common baseline exists and local/remote bodies differ. */
    FIRST_SYNC_DIFFERENT,
    /** Both sides changed since the last common baseline. */
    BOTH_CHANGED,
    /** Robot deleted a route while the local copy still exists/changed. */
    REMOTE_DELETED,
    /** Local deleted a route while the robot copy changed. */
    LOCAL_DELETED_REMOTE_CHANGED,
}

data class RouteSyncConflict(
    val routeName: String,
    val reason: RouteConflictReason,
    val localJson: String?,
    val remoteJson: String?,
    val remoteRevision: Long?,
)

data class RouteSyncReport(
    val pushed: List<String> = emptyList(),
    val pulled: List<String> = emptyList(),
    val deletedRemote: List<String> = emptyList(),
    val conflicts: List<RouteSyncConflict> = emptyList(),
    val failures: List<String> = emptyList(),
)

/**
 * Revision-based bidirectional synchronizer for Network V2.
 *
 * There is no timer here. Call [syncOnce] when the initial session opens or when the
 * SSE "routes" revision changes. This keeps scheduling policy out of the sync algorithm.
 */
class RouteSyncEngine(
    private val robotKey: String,
    private val api: RobotApiClient,
    private val local: LocalRouteAdapter,
    private val baselines: RouteSyncBaselineStore = InMemoryRouteSyncBaselineStore(),
) {
    suspend fun syncOnce(): RouteSyncReport {
        val manifestResult = api.listRoutes()
        if (manifestResult !is ApiResult.Ok) {
            return RouteSyncReport(failures = listOf("Failed to fetch robot route manifest"))
        }

        val remoteByName = manifestResult.value.routes.associateBy { it.name }
        val localByName = local.list().associateBy { it.name }
        val names: List<String> =
            (remoteByName.keys.toList() + localByName.keys.toList())
                .distinct()
                .sorted()

        val pushed = mutableListOf<String>()
        val pulled = mutableListOf<String>()
        val deletedRemote = mutableListOf<String>()
        val conflicts = mutableListOf<RouteSyncConflict>()
        val failures = mutableListOf<String>()

        for (name in names) {
            val localRoute = localByName[name]
            val remoteMeta = remoteByName[name]
            val baseline = baselines.get(robotKey, name)

            when {
                localRoute != null && remoteMeta == null -> {
                    // Absence is not a deletion tombstone. A missing remote route can
                    // equally mean a fresh robot, reset storage, or a different route
                    // set. Treat local-only names as independent routes and create them.
                    when (val put = api.putRoute(name, localRoute.json, expectedRevision = 0)) {
                        is ApiResult.Ok -> {
                            pushed += name
                            remember(name, localRoute.json, put.value.revision)
                        }
                        else -> failures += "Failed to create remote route '" + name + "'"
                    }
                }

                localRoute == null && remoteMeta != null -> {
                    // Likewise, a remote-only name is simply another route. We cannot
                    // infer that the local user deleted it without an explicit tombstone.
                    when (val remote = api.getRoute(name)) {
                        is ApiResult.Ok -> {
                            local.put(name, remote.value.json)
                            pulled += name
                            remember(name, remote.value.json, remote.value.revision)
                        }
                        else -> failures += "Failed to pull new remote route '" + name + "'"
                    }
                }

                localRoute != null && remoteMeta != null -> {
                    if (baseline == null) {
                        val remote = (api.getRoute(name) as? ApiResult.Ok)?.value
                        if (remote == null) {
                            failures += "Failed to establish initial baseline for '" + name + "'"
                        } else if (remote.json == localRoute.json) {
                            remember(name, localRoute.json, remote.revision)
                        } else {
                            conflicts += RouteSyncConflict(
                                routeName = name,
                                reason = RouteConflictReason.FIRST_SYNC_DIFFERENT,
                                localJson = localRoute.json,
                                remoteJson = remote.json,
                                remoteRevision = remote.revision,
                            )
                        }
                        continue
                    }

                    val localChanged = localRoute.fingerprint != baseline.localFingerprint
                    val remoteChanged = remoteMeta.revision != baseline.remoteRevision

                    when {
                        !localChanged && !remoteChanged -> Unit

                        localChanged && !remoteChanged -> {
                            when (
                                val put = api.putRoute(
                                    name,
                                    localRoute.json,
                                    expectedRevision = remoteMeta.revision,
                                )
                            ) {
                                is ApiResult.Ok -> {
                                    pushed += name
                                    remember(name, localRoute.json, put.value.revision)
                                }
                                is ApiResult.HttpError -> {
                                    if (put.status == 412) {
                                        val remote = (api.getRoute(name) as? ApiResult.Ok)?.value
                                        conflicts += RouteSyncConflict(
                                            name,
                                            RouteConflictReason.BOTH_CHANGED,
                                            localRoute.json,
                                            remote?.json,
                                            remote?.revision,
                                        )
                                    } else {
                                        failures += "Failed to push '" + name + "'"
                                    }
                                }
                                is ApiResult.NetworkError -> failures += "Failed to push '" + name + "'"
                            }
                        }

                        !localChanged && remoteChanged -> {
                            when (val remote = api.getRoute(name)) {
                                is ApiResult.Ok -> {
                                    local.put(name, remote.value.json)
                                    pulled += name
                                    remember(name, remote.value.json, remote.value.revision)
                                }
                                else -> failures += "Failed to pull changed route '" + name + "'"
                            }
                        }

                        else -> {
                            val remote = (api.getRoute(name) as? ApiResult.Ok)?.value
                            conflicts += RouteSyncConflict(
                                routeName = name,
                                reason = RouteConflictReason.BOTH_CHANGED,
                                localJson = localRoute.json,
                                remoteJson = remote?.json,
                                remoteRevision = remote?.revision ?: remoteMeta.revision,
                            )
                        }
                    }
                }
            }
        }

        return RouteSyncReport(
            pushed = pushed,
            pulled = pulled,
            deletedRemote = deletedRemote,
            conflicts = conflicts,
            failures = failures,
        )
    }

    suspend fun resolveKeepLocal(conflict: RouteSyncConflict): ApiResult<Unit> {
        val localJson = conflict.localJson
            ?: return ApiResult.NetworkError("No local route to keep")
        val expected = conflict.remoteRevision ?: 0
        return when (val result = api.putRoute(conflict.routeName, localJson, expected)) {
            is ApiResult.Ok -> {
                remember(conflict.routeName, localJson, result.value.revision)
                ApiResult.Ok(Unit, result.status)
            }
            is ApiResult.HttpError -> result
            is ApiResult.NetworkError -> result
        }
    }

    suspend fun resolveKeepRemote(conflict: RouteSyncConflict): ApiResult<Unit> {
        val remoteJson = conflict.remoteJson
        val remoteRevision = conflict.remoteRevision
        if (remoteJson == null || remoteRevision == null) {
            local.delete(conflict.routeName)
            baselines.remove(robotKey, conflict.routeName)
            return ApiResult.Ok(Unit, 200)
        }
        local.put(conflict.routeName, remoteJson)
        remember(conflict.routeName, remoteJson, remoteRevision)
        return ApiResult.Ok(Unit, 200)
    }

    private fun remember(name: String, localJson: String, remoteRevision: Long) {
        baselines.put(
            robotKey,
            RouteSyncBaseline(
                routeName = name,
                localFingerprint = stableFingerprint(localJson),
                remoteRevision = remoteRevision,
            ),
        )
    }
}

/**
 * Stable non-cryptographic content fingerprint. Revision preconditions on the robot are
 * the actual overwrite protection; this fingerprint only detects local modifications.
 */
private fun stableFingerprint(value: String): String {
    var hash = 0xcbf29ce484222325UL
    val prime = 0x100000001b3UL
    value.encodeToByteArray().forEach { byte ->
        hash = hash xor byte.toUByte().toULong()
        hash *= prime
    }
    return hash.toString(16)
}
