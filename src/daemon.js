require('reflect-metadata');
require('typeorm');

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const {
  initializeDatabase,
  DEFAULT_AGENTS,
} = require('./database');
const { config } = require('./config');
const { AgentService } = require('./services/AgentService');
const { ScheduleService } = require('./services/ScheduleService');
const { AnalyticsService } = require('./services/AnalyticsService');
const { inspectRunner, spawnAgentRunner } = require('./runtime');
const { buildDaemonHealth, buildDaemonSummary } = require('./summary');

function createOrchestratorState() {
  return {
    running: true,
    globalInstructions: '',
    lastHeartbeat: null,
    nextHeartbeat: null,
    activeCronJobs: [
      { name: 'AGENT_REMINDER', schedule: 'Every 30 min', active: true, lastRun: null },
      { name: 'heartbeat-check', schedule: 'Every 30 min', active: true, lastRun: null },
      { name: 'agent-daily-reset', schedule: 'Daily midnight', active: true, lastRun: null },
    ],
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createAgentControlDaemon(customConfig = config) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const orchestratorState = createOrchestratorState();
  const activeProcesses = {};
  const startedAt = new Date();

  let agentService;
  let scheduleService;
  let analyticsService;

  app.use(cors());
  app.use(express.json());
  app.use(express.static(customConfig.rootDir));

  function getRunnerState() {
    return inspectRunner(customConfig);
  }

  async function emitState() {
    if (!agentService) {
      return;
    }

    const agents = await agentService.getAll();
    io.emit('stateUpdate', agents);
  }

  function emitOrchestrator() {
    io.emit('orchestratorUpdate', orchestratorState);
  }

  async function initializeServices() {
    await initializeDatabase();

    agentService = new AgentService();
    await agentService.seedDefaults();

    scheduleService = new ScheduleService(agentService);
    analyticsService = new AnalyticsService();

    scheduleService.setRunner((agentName, options) => runAgentOnce(agentName, options));
    await scheduleService.loadActiveSchedules();

    console.log('[DB] Database initialized');
  }

  async function markAgentFailure(agentName, message) {
    const agent = await agentService.getByName(agentName);
    if (!agent) {
      return;
    }

    await agentService.update(agentName, {
      status: 'error',
      currentActivity: null,
    });
    await agentService.addLog(agentName, {
      time: new Date().toISOString(),
      type: 'error',
      message,
    });
    await emitState();
  }

  async function stopAgent(agentName, reason = 'Agent stopped') {
    const entry = activeProcesses[agentName];
    if (entry) {
      entry.stopRequested = true;
      entry.proc.kill();
      delete activeProcesses[agentName];
    }

    const agent = await agentService.getByName(agentName);
    if (agent) {
      await agentService.update(agentName, {
        status: 'idle',
        currentActivity: null,
      });
      await agentService.addLog(agentName, {
        time: new Date().toISOString(),
        message: reason,
      });
      await emitState();
    }
  }

  async function runAgentOnce(agentName, options = {}) {
    const source = options.source || 'manual';
    const agent = await agentService.getByName(agentName);

    if (!agent || !agent.enabled) {
      return { ok: false, error: 'Agent is disabled or missing.' };
    }

    if (activeProcesses[agentName]) {
      return { ok: false, error: 'Agent is already running.' };
    }

    if (source === 'schedule' && !orchestratorState.running) {
      await agentService.addLog(agentName, {
        time: new Date().toISOString(),
        message: 'Skipped scheduled run because orchestrator is paused',
      });
      await emitState();
      return { ok: false, error: 'Orchestrator is paused.' };
    }

    const runnerState = getRunnerState();
    if (!runnerState.available) {
      const message = `Runner unavailable: ${runnerState.issues.join('; ')}`;
      await markAgentFailure(agentName, message);
      return { ok: false, error: message };
    }

    await agentService.update(agentName, {
      status: 'running',
      currentActivity: source === 'schedule' ? 'Starting scheduled run...' : 'Starting...',
    });
    await agentService.addLog(agentName, {
      time: new Date().toISOString(),
      message: source === 'schedule' ? 'Starting scheduled agent run' : 'Starting agent run',
    });

    const runtime = agent.runtimeMinutes || 10;
    const proc = spawnAgentRunner(customConfig, agentName, runtime);
    const runMeta = {
      proc,
      stopRequested: false,
      runId: null,
      startedAt: new Date(),
    };
    activeProcesses[agentName] = runMeta;

    const runRecord = await analyticsService.startRun({
      agentName,
      startTime: runMeta.startedAt,
      status: 'running',
    });
    runMeta.runId = runRecord.id;

    proc.stdout.on('data', async (data) => {
      const output = data.toString();
      const currentAgent = await agentService.getByName(agentName);
      if (!currentAgent) {
        return;
      }

      if (
        output.includes('=== ') ||
        output.includes('Run completed') ||
        output.includes('Commented:') ||
        output.includes('Voting...') ||
        output.includes('IP:')
      ) {
        await agentService.addLog(agentName, {
          time: new Date().toISOString(),
          type: 'stdout',
          message: output.trim(),
        });
      }

      if (output.includes('Reddit:')) {
        const match = output.match(/Reddit: (r\/\w+)/);
        if (match) {
          const subreddit = match[1];
          await agentService.update(agentName, { currentActivity: `Browsing ${subreddit}` });
          await agentService.addVisitedSubreddit(agentName, subreddit);
        }
      }

      if (output.includes('Commented:')) {
        const match = output.match(/Commented: (.+)/);
        if (match) {
          const comment = {
            time: new Date().toISOString(),
            text: match[1].substring(0, 200),
            subreddit: currentAgent.currentActivity,
          };
          await agentService.addPostedComment(agentName, comment);
          await analyticsService.recordComment({
            agentName,
            text: comment.text,
            subreddit: comment.subreddit,
            success: true,
          });
        }
      }

      if (output.includes('IP:')) {
        const match = output.match(/IP: ([\d.]+)/);
        if (match) {
          await agentService.update(agentName, { ip: match[1] });
        }
      }

      if (output.includes('Scroll completed') || output.includes('Click successful')) {
        await agentService.update(agentName, {
          runsToday: currentAgent.runsToday + 1,
          lastRun: Date.now(),
        });
      }

      await emitState();
    });

    proc.stderr.on('data', async (data) => {
      const output = data.toString().trim();
      if (!output) {
        return;
      }

      await agentService.addLog(agentName, {
        time: new Date().toISOString(),
        type: 'stderr',
        message: output.substring(0, 400),
      });
      await emitState();
    });

    proc.on('close', async (code) => {
      const currentAgent = await agentService.getByName(agentName);
      const activeProcess = activeProcesses[agentName] || runMeta;
      const stopRequested = Boolean(activeProcess.stopRequested);

      if (currentAgent) {
        const endTime = new Date();
        const durationMinutes = Math.max(
          0,
          Math.round((endTime.getTime() - runMeta.startedAt.getTime()) / 60000),
        );
        const nextStatus = stopRequested ? 'idle' : code === 0 ? 'idle' : 'error';
        const completionMessage = stopRequested
          ? 'Run stopped'
          : `Run completed (code ${code})`;

        await agentService.update(agentName, {
          status: nextStatus,
          currentActivity: null,
          lastRun: endTime.toISOString(),
        });
        await agentService.addLog(agentName, {
          time: endTime.toISOString(),
          message: completionMessage,
        });
        await analyticsService.finishRun(runMeta.runId, {
          agentName,
          endTime,
          durationMinutes,
          status: stopRequested ? 'stopped' : code === 0 ? 'completed' : 'error',
          runsCount: currentAgent.runsToday,
          commentsCount: currentAgent.commentsToday,
          visitedSubreddits: currentAgent.visitedSubreddits,
          errorMessage: code === 0 || stopRequested ? null : `Process exited with code ${code}`,
        });
        await emitState();
      }

      delete activeProcesses[agentName];
    });

    proc.on('error', async (err) => {
      await markAgentFailure(agentName, err.message);
      await analyticsService.finishRun(runMeta.runId, {
        agentName,
        endTime: new Date(),
        status: 'error',
        errorMessage: err.message,
      });
      delete activeProcesses[agentName];
    });

    return { ok: true };
  }

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    if (agentService) {
      agentService.getAll().then((agents) => socket.emit('stateUpdate', agents));
    }
    socket.emit('orchestratorUpdate', orchestratorState);

    socket.on('runAgent', async (agentName) => {
      await runAgentOnce(agentName);
    });

    socket.on('stopAgent', async (agentName) => {
      await stopAgent(agentName);
    });

    socket.on('setInstructions', async ({ agentName, instructions }) => {
      await agentService.update(agentName, { customInstructions: instructions });
      await emitState();
    });

    socket.on('toggleAgent', async (agentName) => {
      const agent = await agentService.getByName(agentName);
      if (!agent) {
        return;
      }

      const enabled = !agent.enabled;
      await agentService.update(agentName, { enabled });
      if (!enabled && agent.status === 'running') {
        await stopAgent(agentName);
      }
      await emitState();
    });
  });

  app.get('/api/health', async (req, res) => {
    try {
      res.json(
        await buildDaemonHealth({
          config: customConfig,
          orchestratorState,
          runnerState: getRunnerState(),
          startedAt,
          agentService,
          scheduleService,
        }),
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/summary', async (req, res) => {
    try {
      res.json(
        await buildDaemonSummary({
          config: customConfig,
          orchestratorState,
          runnerState: getRunnerState(),
          startedAt,
          agentService,
          scheduleService,
          analyticsService,
        }),
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents', async (req, res) => {
    try {
      const agents = await agentService.getAll();
      res.json(agents);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents', async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Name required' });
      }

      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = await agentService.getByName(cleanName);
      if (existing) {
        return res.status(400).json({ error: 'Agent already exists' });
      }

      await agentService.create(cleanName);
      await emitState();
      return res.json({ success: true, name: cleanName });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/agents/:name', async (req, res) => {
    try {
      const name = req.params.name;
      if (DEFAULT_AGENTS.includes(name)) {
        return res.status(400).json({ error: 'Cannot delete default agents' });
      }

      const deleted = await agentService.delete(name);
      if (deleted) {
        await emitState();
        return res.json({ success: true });
      }

      return res.status(404).json({ error: 'Agent not found' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents/:name', async (req, res) => {
    try {
      const agent = await agentService.getByName(req.params.name);
      return agent
        ? res.json(agent)
        : res.status(404).json({ error: 'Agent not found' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents/:name/run', async (req, res) => {
    const result = await runAgentOnce(req.params.name);
    return result.ok ? res.json({ success: true }) : res.status(400).json({ error: result.error });
  });

  app.post('/api/agents/:name/stop', async (req, res) => {
    await stopAgent(req.params.name);
    return res.json({ success: true });
  });

  app.post('/api/agents/:name/toggle', async (req, res) => {
    try {
      const agent = await agentService.getByName(req.params.name);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const enabled = !agent.enabled;
      await agentService.update(req.params.name, { enabled });
      if (!enabled && agent.status === 'running') {
        await stopAgent(req.params.name);
      }
      await emitState();
      return res.json({ success: true, enabled });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents/:name/instructions', async (req, res) => {
    try {
      const instructions = typeof req.body.instructions === 'string' ? req.body.instructions : '';
      await agentService.update(req.params.name, { customInstructions: instructions });
      await emitState();
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents/:name/sites', async (req, res) => {
    try {
      const agent = await agentService.getByName(req.params.name);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      return res.json({ allowed: agent.allowedSites, blocked: agent.blockedSites });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents/:name/sites', async (req, res) => {
    try {
      const { allowed, blocked } = req.body;
      const agent = await agentService.getByName(req.params.name);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const updates = {};
      if (Array.isArray(allowed)) {
        updates.allowedSites = allowed;
      }
      if (Array.isArray(blocked)) {
        updates.blockedSites = blocked;
      }

      await agentService.update(req.params.name, updates);
      await emitState();
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/agents/:name/config', async (req, res) => {
    try {
      const agent = await agentService.getByName(req.params.name);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      return res.json({
        runtimeMinutes: agent.runtimeMinutes,
        pageTimeSeconds: agent.pageTimeSeconds,
        targetSubreddits: agent.targetSubreddits,
        searchTopics: agent.searchTopics,
        commentFrequency: agent.commentFrequency,
        upvotesPerSession: agent.upvotesPerSession,
        allowedSites: agent.allowedSites,
        blockedSites: agent.blockedSites,
        enabled: agent.enabled,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agents/:name/config', async (req, res) => {
    try {
      const agent = await agentService.getByName(req.params.name);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const {
        runtimeMinutes,
        pageTimeSeconds,
        targetSubreddits,
        searchTopics,
        commentFrequency,
        upvotesPerSession,
        allowedSites,
        blockedSites,
      } = req.body;
      const updates = {};

      if (typeof runtimeMinutes === 'number') {
        updates.runtimeMinutes = runtimeMinutes;
      }
      if (typeof pageTimeSeconds === 'number') {
        updates.pageTimeSeconds = pageTimeSeconds;
      }
      if (Array.isArray(targetSubreddits)) {
        updates.targetSubreddits = targetSubreddits;
      }
      if (Array.isArray(searchTopics)) {
        updates.searchTopics = searchTopics;
      }
      if (isNonEmptyString(commentFrequency)) {
        updates.commentFrequency = commentFrequency;
      }
      if (typeof upvotesPerSession === 'number') {
        updates.upvotesPerSession = upvotesPerSession;
      }
      if (Array.isArray(allowedSites)) {
        updates.allowedSites = allowedSites;
      }
      if (Array.isArray(blockedSites)) {
        updates.blockedSites = blockedSites;
      }

      await agentService.update(req.params.name, updates);
      await emitState();
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/orchestrator', (req, res) => res.json(orchestratorState));

  app.post('/api/orchestrator/instructions', (req, res) => {
    orchestratorState.globalInstructions =
      typeof req.body.globalInstructions === 'string' ? req.body.globalInstructions : '';
    emitOrchestrator();
    res.json({ success: true });
  });

  app.post('/api/orchestrator/toggle', (req, res) => {
    orchestratorState.running = !orchestratorState.running;
    emitOrchestrator();
    res.json({ success: true, running: orchestratorState.running });
  });

  app.post('/api/cron/:name/toggle', (req, res) => {
    const job = orchestratorState.activeCronJobs.find((entry) => entry.name === req.params.name);
    if (!job) {
      return res.status(404).json({ error: 'Cron job not found' });
    }

    job.active = !job.active;
    emitOrchestrator();
    return res.json({ success: true, active: job.active });
  });

  app.get('/api/schedules', async (req, res) => {
    try {
      const schedules = await scheduleService.getAll();
      res.json(schedules);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/schedules', async (req, res) => {
    try {
      const schedule = await scheduleService.create(req.body);
      res.json(schedule);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/schedules/:id', async (req, res) => {
    try {
      const schedule = await scheduleService.update(parseInt(req.params.id, 10), req.body);
      schedule ? res.json(schedule) : res.status(404).json({ error: 'Schedule not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/schedules/:id', async (req, res) => {
    try {
      const deleted = await scheduleService.delete(parseInt(req.params.id, 10));
      deleted ? res.json({ success: true }) : res.status(404).json({ error: 'Schedule not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/schedules/:id/toggle', async (req, res) => {
    try {
      const schedule = await scheduleService.toggle(parseInt(req.params.id, 10));
      schedule ? res.json(schedule) : res.status(404).json({ error: 'Schedule not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analytics/overview', async (req, res) => {
    try {
      const stats = await analyticsService.getOverview();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analytics/agent/:name', async (req, res) => {
    try {
      const stats = await analyticsService.getAgentStats(req.params.name);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analytics/top-subreddits', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const stats = await analyticsService.getTopSubreddits(limit);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  async function shutdown() {
    if (scheduleService) {
      await scheduleService.cancelAll();
    }

    await Promise.all(
      Object.keys(activeProcesses).map((agentName) => stopAgent(agentName, 'Agent stopped during shutdown')),
    );
  }

  async function start() {
    await initializeServices();

    return new Promise((resolve) => {
      server.listen(customConfig.port, customConfig.host, () => {
        console.log(
          `Agent Control Center running on http://${customConfig.host}:${customConfig.port}`,
        );
        resolve();
      });
    });
  }

  return {
    app,
    server,
    io,
    start,
    shutdown,
    config: customConfig,
  };
}

module.exports = {
  createAgentControlDaemon,
};
