# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run Commands

This is a Kotlin Multiplatform project using Compose Multiplatform. The Gradle wrapper is at the repo root.

```bash
# Desktop (JVM) - development run
./gradlew :composeApp:run

# Web (Wasm, modern browsers) - development run
./gradlew :composeApp:wasmJsBrowserDevelopmentRun

# Web (JS, legacy browsers) - development run
./gradlew :composeApp:jsBrowserDevelopmentRun

# Run all common tests
./gradlew :composeApp:check

# Desktop native distribution (DMG/MSI/DEB)
./gradlew :composeApp:createDistributable
```

On Windows, replace `./gradlew` with `.\gradlew.bat`.

## File Conventions

- **Encoding**: All files must be **UTF-8 without BOM**.
- **Line endings**: **CRLF** (`\r\n`) for all source files.
- When writing or editing any file, ensure the tool outputs CRLF line endings.

## Troubleshooting

- **File lock errors** (e.g., "file is in use by another process" during build): manually delete the build output directories and retry:
  ```bash
  rm -rf build composeApp/build
  ```
  On Windows CMD:
  ```cmd
  rmdir /s /q build & rmdir /s /q composeApp\build
  ```

## Architecture Overview

AzConductor is an FTC (FIRST Tech Challenge) robot path planning tool. Users create and edit waypoint-based paths on a field map, then send them to the robot over HTTP. The app targets Desktop (JVM) and Web (JS + Wasm) from a single Kotlin codebase.

### Layer Map

```
App.kt (top-level composable, screen navigation)
  ├── ui/screens/
  │     HomeScreen.kt          — Route list management (create/rename/delete/reorder)
  │     PathPlannerScreen.kt   — Main canvas editor with waypoint sidebar, timeline scrubber
  │
  ├── ui/components/
  │     RouteCanvas.kt         — Draws the spline path, handles tap-to-add-waypoint
  │     DraggableNode.kt       — Drag-to-move waypoint circle on canvas
  │     VectorHandle.kt        — Drag handle for velocity vector (dx, dy) at selected node
  │     RobotComponent.kt      — Rounded-rect robot visual with heading rotation + drag-to-rotate
  │
  ├── ui/dialogs/
  │     NodeEditorDialog.kt    — Auto-generated form from ControlNode serialization descriptor
  │     ExportDialog.kt        — JSON export with clipboard copy
  │     ImportDialog.kt        — JSON import textarea
  │
  ├── route/
  │     ControlNode.kt         — Data class: x, dx, y, dy, heading, dHeading, duration, marker, delayAfterArrive
  │     RouteData.kt           — RouteData (name + points list), RobotRoutes (container)
  │     RouteCore.kt           — Waypoint list → trajectory list builder, point-at-time query
  │     Spline.kt              — CubicHermiteSpline1D, TrajectoryGenerator2D, OrientedTrajectoryGenerator2D
  │     viewmodel/RouteConnector.kt — Central ViewModel: CRUD, persistence, remote save, cross-tab sync
  │
  ├── io/
  │     RouteStorage.kt        — expect fun saveRouteData/loadRouteData/removeRouteData
  │     RouteStorage.jvm.kt    — actual: ~/.azconductor/routes.json
  │     RouteStorage.js.kt     — actual: window.localStorage
  │     RouteStorage.wasmJs.kt — actual: window.localStorage
  │     RobotConfig.kt         — ConfigManager (key-value settings with async polling watcher)
  │     RemoteSave.kt          — HTTP POST to robot (port 8888): / then /save/{pathName}
  │
  ├── core/math/
  │     CoordinateMapper.kt    — Logical ↔ screen pixel transforms with rotation & axis mapping
  │
  ├── Constants.kt             — FieldConfig, RobotConfig (dimensions), UIConfig (colors, sizes)
  ├── Platform.kt              — expect Platform, PlatformImageLoader, httpPostJson
  └── Utils.kt                 — Double.toRadians(), Double.toDegrees(), Double.toFixed()
```

### Key Data Flow

1. **Waypoint editing**: User taps canvas → `RouteCanvas` calls `route.addPoint(ControlNode(...))` → ViewModel updates `RouteCore` (rebuilds trajectories) and persists
2. **Spline rendering**: `RouteCanvas` reads `route.getPointAtTime(t)` for 1000 sample points along totalTime → draws path via Compose Canvas
3. **Timeline playback**: `PathPlannerScreen` runs a `LaunchedEffect` loop incrementing `currentTime` every 16ms → `route.getPointAtTime(time)` drives the ghost robot position
4. **Persistence**: Every mutation calls `syncAndSave()` → JSON serialization of `List<RobotRoutes>` → platform `actual` storage (file or localStorage)
5. **Remote save**: After local persist, `RemoteSave.send(json, pathName)` does fire-and-forget HTTP POST to `http://<robotIp>:8888/` then `http://<robotIp>:8888/save/<pathName>`
6. **Cross-tab sync**: `RouteConnector.startAutoSaveWatcher()` polls `ConfigManager.watchPath()` every 50ms to detect external storage changes and reload

### Spline Math

- `CubicHermiteSpline1D` implements the cubic Hermite polynomial: `f(u) = a·u³ + b·u² + c·u + d` where coefficients are precomputed from start/end positions and derivatives
- `OrientedTrajectoryGenerator2D` composes three independent 1D splines (X, Y, heading) to produce full-state waypoints at any time `t`
- Arc length is computed via Simpson's rule integration
- `normalizeRelative()` unwraps heading angles to take the shortest rotation path (e.g., 350°→10° becomes 350°→370°)

### Coordinate System

- Logical field: 144×144 units, origin at center (configurable via `ORIGIN_RATIO_X/Y`)
- X-axis maps to screen-down, Y-axis maps to screen-right (rotated 90° from typical screen coords)
- `CoordinateMapper` handles logical↔screen transforms including rotation, scaling, and axis mapping

### Platform `expect`/`actual` Declarations

| Symbol | Purpose |
|--------|---------|
| `getPlatform(): Platform` | Returns platform name string (JVM/JS/Wasm) |
| `httpPostJson(url, jsonBody): String?` | HTTP POST with JSON, returns response body or null |
| `saveRouteData(json)` / `loadRouteData()` / `removeRouteData()` | Route persistence |
| `PlatformImageLoader.loadFromFile()` | Load image bitmap from local path (JVM only) |

### Dependencies

- **UI**: Compose Multiplatform 1.10.3, Material3 1.10.0-alpha05
- **Lifecycle**: AndroidX ViewModel (multiplatform port)
- **Serialization**: kotlinx-serialization-json 1.6.3
- **Settings**: multiplatform-settings-no-arg 1.3.0 (key-value config persistence)
- **Coroutines**: kotlinx-coroutines 1.10.2
- **Build**: Kotlin 2.3.20, Gradle with version catalog (`gradle/libs.versions.toml`)

### Code Patterns

- `RouteConnector` extends `ViewModel` — Compose screens access it via `remember { RouteConnector() }` or parameter injection
- State observation uses Compose `mutableStateOf`/`mutableStateListOf` — the `pathVersion` counter forces recomposition after mutations
- The `NodeEditorDialog` uses `kotlinx.serialization` descriptors reflectively to auto-generate form fields — adding a property to `ControlNode` requires no UI changes
- Platform-specific code uses Kotlin `expect`/`actual` in `io/` and `Platform.kt`
- `DisposableEffect` manages lifecycle: starts auto-save watcher on composition, cancels on disposal