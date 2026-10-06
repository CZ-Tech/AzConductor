const fs = require('fs')
const path = require('path')

function findEnvFile(startDir) {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, '.env.test')
    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function loadEnvFile(file) {
  if (!file) return

  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator <= 0) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // Explicit CI/user environment always wins over the local test file.
    if (!process.env[key] && value) {
      process.env[key] = value
    }
  }
}

loadEnvFile(findEnvFile(process.cwd()) || findEnvFile(__dirname))
