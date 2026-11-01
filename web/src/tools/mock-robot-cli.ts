/**
 * Mock robot CLI — `npm run mock` (tsx src/tools/mock-robot-cli.ts).
 *
 *   --port <n>       listen port (default 8888)
 *   --host <addr>    bind address (default 0.0.0.0, so a phone / the robot WiFi can reach it)
 *   --pose-hz <n>    pose frames per second on the event stream (default 60)
 *   --lease-ms <n>   session lease length (default 10000)
 *   --run-ms <n>     fixed length of a simulated run (default: derived from the route)
 *   --empty          do not seed sample routes / op modes / commands
 *   --headless       non-interactive: print only the URL line, no per-request log
 *   --help
 */
import { networkInterfaces } from 'node:os';
import { MockRobotServer, seedSampleRobot, type MockRobotOptions } from './mock-robot';

interface CliArgs {
  port: number;
  host: string;
  poseHz: number;
  leaseMs: number | undefined;
  runMs: number | undefined;
  empty: boolean;
  headless: boolean;
  help: boolean;
}

const HELP = `AzConductor mock robot (Network V2)

Usage: npm run mock -- [options]

  --port <n>       listen port (default 8888)
  --host <addr>    bind address (default 0.0.0.0)
  --pose-hz <n>    pose frames per second (default 60)
  --lease-ms <n>   session lease length in ms (default 10000)
  --run-ms <n>     fixed simulated run length in ms (default: from route duration)
  --empty          start without sample routes / op modes / commands
  --headless       print only the URL, no request log
  --help           this text
`;

function fail(message: string): never {
  process.stderr.write(`mock-robot: ${message}\n\n${HELP}`);
  process.exit(2);
}

function numberArg(name: string, value: string | undefined, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
    fail(`${name} expects a number between ${min} and ${max}, got '${value ?? ''}'`);
  }
  return n;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    port: 8888, host: '0.0.0.0', poseHz: 60, leaseMs: undefined, runMs: undefined,
    empty: false, headless: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    const eq = raw.indexOf('=');
    const flag = eq >= 0 ? raw.slice(0, eq) : raw;
    const inline = eq >= 0 ? raw.slice(eq + 1) : undefined;
    const value = (): string | undefined => inline ?? argv[++i];
    switch (flag) {
      case '--port': args.port = numberArg('--port', value(), 0, 65535); break;
      case '--host': args.host = value() ?? fail('--host expects an address'); break;
      case '--pose-hz': args.poseHz = numberArg('--pose-hz', value(), 0.1, 1000); break;
      case '--lease-ms': args.leaseMs = numberArg('--lease-ms', value(), 50, 3_600_000); break;
      case '--run-ms': args.runMs = numberArg('--run-ms', value(), 0, 3_600_000); break;
      case '--empty': args.empty = true; break;
      case '--headless': args.headless = true; break;
      case '--help': case '-h': args.help = true; break;
      default: fail(`unknown option '${raw}'`);
    }
  }
  return args;
}

function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const options: MockRobotOptions = { host: args.host, poseHz: args.poseHz };
  if (args.leaseMs !== undefined) options.sessionTimeoutMs = args.leaseMs;
  if (args.runMs !== undefined) options.runDurationMs = args.runMs;
  if (!args.headless) options.log = (line) => process.stdout.write(`${new Date().toISOString().slice(11, 23)} ${line}\n`);

  const robot = new MockRobotServer(options);
  if (!args.empty) seedSampleRobot(robot);

  try {
    await robot.start(args.port);
  } catch (e) {
    fail(`cannot listen on ${args.host}:${args.port}: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (args.headless) {
    process.stdout.write(`${robot.url}\n`);
  } else {
    process.stdout.write(`Mock robot (Network V2) listening on ${robot.url}\n`);
    if (args.host === '0.0.0.0' || args.host === '::') {
      for (const u of lanUrls(robot.port)) process.stdout.write(`  LAN: ${u}\n`);
    }
    if (!args.empty) {
      process.stdout.write(`  routes: ${robot.routeNames.join(', ')}\n`);
      process.stdout.write(`  op modes: ${robot.opModes.map((o) => (o.route ? `${o.name} -> ${o.route}` : o.name)).join(', ')}\n`);
    }
    process.stdout.write('Ctrl+C to stop.\n');
  }

  const shutdown = (): void => {
    void robot.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run only when executed directly (tsx), not when imported by tests.
const entry = process.argv[1] ?? '';
if (/mock-robot-cli\.[cm]?[jt]s$/.test(entry.replace(/\\/g, '/'))) {
  void main();
}
