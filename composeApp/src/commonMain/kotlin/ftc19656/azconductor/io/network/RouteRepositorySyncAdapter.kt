package ftc19656.azconductor.io.network

import ftc19656.azconductor.io.RouteRepository
import ftc19656.azconductor.route.RouteData
import ftc19656.azconductor.route.SplineRouteContract
import kotlinx.serialization.json.Json

/** Bridges local route persistence to the opaque-JSON sync engine. */
class RouteRepositorySyncAdapter(
    private val repository: RouteRepository,
    private val json: Json,
) : LocalRouteAdapter {

    override fun list(): List<LocalRouteRecord> =
        repository.loadAll().map { route ->
            LocalRouteRecord(
                name = route.name,
                json = SplineRouteContract.encodeRobotRoute(route.points, json),
            )
        }

    override fun get(name: String): LocalRouteRecord? {
        val route = repository.load(name) ?: return null
        return LocalRouteRecord(
            name = route.name,
            json = SplineRouteContract.encodeRobotRoute(route.points, json),
        )
    }

    override fun put(name: String, json: String) {
        val points = SplineRouteContract.decodeRobotRoute(json, this.json)
        val existing = repository.load(name)
        repository.save(
            existing?.copy(points = points)
                ?: RouteData(name = name, points = points)
        )
    }

    override fun delete(name: String) {
        repository.delete(name)
    }
}
