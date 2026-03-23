function isErrorLog(log) {
  if (!log) {
    return false;
  }

  if (log.type === 'error' || log.type === 'stderr') {
    return true;
  }

  return typeof log.message === 'string' && log.message.toLowerCase().includes('error');
}

function findRecentError(agents) {
  const entries = [];

  for (const agent of agents) {
    for (const log of agent.logs || []) {
      if (!isErrorLog(log)) {
        continue;
      }

      entries.push({
        agentName: agent.name,
        time: log.time || null,
        message: log.message || 'Unknown error',
      });
    }
  }

  entries.sort((left, right) => {
    const leftTime = left.time ? Date.parse(left.time) : 0;
    const rightTime = right.time ? Date.parse(right.time) : 0;
    return rightTime - leftTime;
  });

  return entries[0] || null;
}

async function buildDaemonHealth({
  config,
  orchestratorState,
  runnerState,
  startedAt,
  agentService,
  scheduleService,
}) {
  const agents = await agentService.getAll();
  const runningAgents = agents.filter((agent) => agent.status === 'running').length;
  const enabledAgents = agents.filter((agent) => agent.enabled).length;
  const errorAgents = agents.filter((agent) => agent.status === 'error').length;

  return {
    status: runnerState.available ? 'ok' : 'degraded',
    appName: config.appName,
    version: config.version,
    platform: process.platform,
    host: config.host,
    port: config.port,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    runnerAvailable: runnerState.available,
    runnerIssues: runnerState.issues,
    runner: {
      scriptPath: runnerState.runnerScriptPath,
      workspaceRoot: runnerState.workspaceRoot,
      browserProfileRoot: runnerState.browserProfileRoot,
      requiredCommands: runnerState.requiredCommands,
      optionalCommands: runnerState.optionalCommands,
      optionalIssues: runnerState.optionalIssues,
    },
    orchestrator: {
      running: orchestratorState.running,
      activeCronJobs: orchestratorState.activeCronJobs.filter((job) => job.active).length,
      registeredScheduleJobs: scheduleService.activeJobs.size,
    },
    agents: {
      total: agents.length,
      running: runningAgents,
      enabled: enabledAgents,
      error: errorAgents,
    },
  };
}

async function buildDaemonSummary({
  config,
  orchestratorState,
  runnerState,
  startedAt,
  agentService,
  scheduleService,
  analyticsService,
}) {
  const [agents, schedules, overview] = await Promise.all([
    agentService.getAll(),
    scheduleService.getAll(),
    analyticsService.getOverview(),
  ]);

  const roster = agents.map((agent) => ({
    name: agent.name,
    status: agent.status,
    enabled: agent.enabled,
    currentActivity: agent.currentActivity,
    lastRun: agent.lastRun,
    runsToday: agent.runsToday,
    commentsToday: agent.commentsToday,
    hasRecentError: (agent.logs || []).slice(-20).some(isErrorLog),
  }));

  return {
    fetchedAt: new Date().toISOString(),
    daemon: {
      appName: config.appName,
      version: config.version,
      platform: process.platform,
      port: config.port,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      runnerAvailable: runnerState.available,
      runnerIssues: runnerState.issues,
      optionalRunnerIssues: runnerState.optionalIssues,
      localUiUrl: `http://127.0.0.1:${config.port}/`,
    },
    orchestrator: {
      running: orchestratorState.running,
      globalInstructions: orchestratorState.globalInstructions,
      activeCronJobs: orchestratorState.activeCronJobs,
    },
    agents: {
      total: agents.length,
      running: roster.filter((agent) => agent.status === 'running').length,
      enabled: roster.filter((agent) => agent.enabled).length,
      roster,
    },
    schedules: {
      total: schedules.length,
      active: schedules.filter((schedule) => schedule.active).length,
    },
    analytics: overview,
    recentError: findRecentError(agents),
  };
}

module.exports = {
  buildDaemonHealth,
  buildDaemonSummary,
};
