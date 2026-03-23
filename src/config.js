const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
);

function resolvePath(value, fallback) {
  if (!value) {
    return fallback;
  }

  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const dataDir = resolvePath(
  process.env.AGENT_CONTROL_DATA_DIR,
  path.join(rootDir, 'data'),
);

const config = {
  appName: packageJson.name,
  version: packageJson.version,
  host: process.env.HOST || '0.0.0.0',
  port: readNumber(process.env.PORT, 3002),
  rootDir,
  dataDir,
  databasePath: resolvePath(
    process.env.AGENT_CONTROL_DB_PATH,
    path.join(dataDir, 'agent_control.db'),
  ),
  workspaceRoot: resolvePath(
    process.env.AGENT_WORKSPACE_ROOT,
    rootDir,
  ),
  runnerScriptPath: resolvePath(
    process.env.AGENT_RUNNER_SCRIPT,
    path.join(rootDir, 'run-agent.sh'),
  ),
  browserProfileRoot: resolvePath(
    process.env.AGENT_BROWSER_PROFILE_ROOT,
    path.join(os.homedir(), '.agent-control-center', 'browser'),
  ),
  launchAgentLabel:
    process.env.AGENT_CONTROL_LAUNCHD_LABEL || 'com.emusoi.agent-control-center',
};

module.exports = { config };
