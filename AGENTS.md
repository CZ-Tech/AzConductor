# Repository Guidelines

## Project Structure & Module Organization

```
AzConductor/
├── composeApp/
│   ├── src/
│   │   ├── commonMain/        # Shared Kotlin + Compose UI
│   │   │   └── kotlin/ftc19656/azconductor/
│   │   │       ├── ui/screens/ # Page-level composables
│   │   │       ├── ui/components/ # Reusable widgets
│   │   │       ├── ui/dialogs/ # Dialog composables
│   │   │       ├── route/         # Path planning & networking
│   │   │       └── core/          # Math, config, utilities
│   │   ├── jvmMain/           # Desktop (JVM) entry point
│   │   ├── wasmJsMain/        # Web (Wasm) entry point
│   │   ├── jsMain/            # Web (JS) entry point
│   │   ├── webMain/           # Web resources (index.html)
│   │   └── commonTest/        # Shared tests
│   └── build.gradle.kts
├── web_deploy/                # Built web output
└── build.gradle.kts           # Root build config
```

This is a Kotlin Multiplatform project targeting **Desktop (JVM)** and **Web (Wasm/JS)**. All business logic and UI live in `commonMain`. Platform-specific code goes in `jvmMain`, `wasmJsMain`, etc.

## Build, Test, and Development Commands

| Command | What it does |
|---|---|
| `.\gradlew :composeApp:run` | Build & run desktop app |
| `.\gradlew :composeApp:wasmJsBrowserDevelopmentRun` | Start web dev server (Wasm, modern browsers) |
| `.\gradlew :composeApp:jsBrowserDevelopmentRun` | Start web dev server (JS, older browsers) |

> **Important**: Dev server commands above are long-running and will be killed when the shell session ends. Always launch them as a detached process:
> ```powershell
> Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '<proj>'; .\gradlew :composeApp:wasmJsBrowserDevelopmentRun" -WindowStyle Hidden
> ```
> Access at http://localhost:8080/ once ready.
> To stop: find the PID from netstat and run `Stop-Process -Id <pid> -Force`.
| `.\gradlew :composeApp:wasmJsBrowserDistribution` | Build production web bundle |
| `.\gradlew :composeApp:build` | Full project build |

## Coding Style & Naming

- **Language**: Kotlin with Compose Multiplatform. Follow standard Kotlin conventions.
- **Package**: `ftc19656.azconductor.<module>`
- **UI**: Jetpack Compose APIs via `androidx.compose.*`. Use Material 3 components.
- **Naming**: PascalCase for composables (`PathPlannerScreen`), camelCase for properties/functions (`selectedNodeIndex`).
- **Icons**: Prefer `Icons.Default` (aliased from `Icons.Filled`), already wildcard-imported.

## File Encoding (Critical)

All source files use **UTF-8 without BOM**. When editing via PowerShell:

- **Read**: `Get-Content -Encoding UTF8`
- **Write**: `[System.IO.File]::WriteAllLines($path, $lines, [System.Text.UTF8Encoding]::new($false))`

Never use plain `Set-Content` — it defaults to system encoding and corrupts non-ASCII characters.

## Commit & Pull Request Guidelines

- **Language**: Chinese for feature descriptions, English for conventional prefixes (`feat:`, `fix:`, `refactor:`).
- **Format**: Keep summaries short (one line preferred). Use `feat:` / `fix:` / `refactor:` prefixes for English-style commits.
- **Example**: `fix: use direct Settings read/write to bypass async ConfigManager cache race`

## Architecture Notes

- State is managed via `remember { mutableStateOf() }` at the screen level. No external state management library.
- `RouteConnector` is the central ViewModel-like class for path data and robot communication.
- Coordinate mapping goes through `CoordinateMapper` (logical ↔ screen space with optional rotation).