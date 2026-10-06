package ftc19656.azconductor.io.network

import ftc19656.azconductor.io.ConfigManager

/**
 * Durable last-common-version store.
 *
 * Baselines are advisory local sync state; robot-side revision preconditions remain the
 * authoritative protection against stale overwrites.
 */
class ConfigRouteSyncBaselineStore(
    private val config: ConfigManager,
) : RouteSyncBaselineStore {

    override fun get(robotKey: String, routeName: String): RouteSyncBaseline? {
        val raw = config[key(robotKey, routeName)] ?: return null
        val split = raw.indexOf('\n')
        if (split <= 0) return null
        val revision = raw.substring(0, split).toLongOrNull() ?: return null
        val fingerprint = raw.substring(split + 1)
        if (fingerprint.isEmpty()) return null
        return RouteSyncBaseline(routeName, fingerprint, revision)
    }

    override fun put(robotKey: String, baseline: RouteSyncBaseline) {
        config[key(robotKey, baseline.routeName)] =
            baseline.remoteRevision.toString() + "\n" + baseline.localFingerprint
    }

    override fun remove(robotKey: String, routeName: String) {
        config[key(robotKey, routeName)] = ""
    }

    override fun clearRobot(robotKey: String) {
        // ConfigManager does not currently expose key enumeration. Old entries are harmless:
        // every baseline key is robot-specific and validated against remote revisions.
    }

    private fun key(robotKey: String, routeName: String): String =
        "v2_sync_baseline:" + escape(robotKey) + ":" + escape(routeName)

    private fun escape(value: String): String =
        value.encodeToByteArray().joinToString("") { byte ->
            val v = byte.toInt() and 0xff
            val c = v.toChar()
            if (
                c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' ||
                c == '-' || c == '_' || c == '.'
            ) {
                c.toString()
            } else {
                "%" + "0123456789ABCDEF"[v ushr 4] + "0123456789ABCDEF"[v and 0x0f]
            }
        }
}
