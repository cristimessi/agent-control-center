const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const REQUIRED_COMMANDS = ['bash', 'curl', 'open', 'osascript', 'peekaboo'];

function commandAvailable(command) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
    stdio: 'ignore',
  });

  return result.status === 0;
}

function inspectRunner(config) {
  const issues = [];

  if (process.platform !== 'darwin') {
    issues.push(`unsupported platform: ${process.platform}`);
  }

  if (!fs.existsSync(config.runnerScriptPath)) {
    issues.push(`runner script missing: ${config.runnerScriptPath}`);
  }

  for (const command of REQUIRED_COMMANDS) {
    if (!commandAvailable(command)) {
      issues.push(`missing dependency: ${command}`);
    }
  }

  return {
    available: issues.length === 0,
    issues,
    platform: process.platform,
    requiredCommands: REQUIRED_COMMANDS,
    runnerScriptPath: config.runnerScriptPath,
    workspaceRoot: config.workspaceRoot,
    browserProfileRoot: config.browserProfileRoot,
  };
}

function spawnAgentRunner(config, agentName, runtimeMinutes) {
  return spawn('bash', [config.runnerScriptPath, agentName, String(runtimeMinutes)], {
    cwd: config.workspaceRoot,
    env: {
      ...process.env,
      AGENT_BROWSER_PROFILE_ROOT: config.browserProfileRoot,
      AGENT_WORKSPACE_ROOT: config.workspaceRoot,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

module.exports = {
  inspectRunner,
  spawnAgentRunner,
};
