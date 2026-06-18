package ftc19656.azconductor.route.viewmodel

import androidx.lifecycle.ViewModel
import ftc19656.azconductor.io.SyncManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class CommandsViewModel(
    private val syncManager: SyncManager,
    private val refreshIntervalMs: Long = 5000L
) : ViewModel() {

    private val _robotPaths = MutableStateFlow<List<String>>(emptyList())
    val robotPaths: StateFlow<List<String>> = _robotPaths.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    init {
        scope.launch {
            while (isActive) {
                try {
                    _robotPaths.value = syncManager.listRobotPaths()
                } catch (_: Exception) {
                    _robotPaths.value = emptyList()
                }
                delay(refreshIntervalMs)
            }
        }
    }

    /**
     * Manually refresh the robot path list immediately.
     */
    suspend fun refresh() {
        try {
            _robotPaths.value = syncManager.listRobotPaths()
        } catch (_: Exception) {
            _robotPaths.value = emptyList()
        }
    }
}
