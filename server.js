require('reflect-metadata');
require('typeorm');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const { AppDataSource, initializeDatabase, DEFAULT_AGENTS, DEFAULT_ALLOWED_SITES, DEFAULT_BLOCKED_SITES } = require('./src/database');
const { AgentService } = require('./src/services/AgentService');
const { ScheduleService } = require('./src/services/ScheduleService');
const { AnalyticsService } = require('./src/services/AnalyticsService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const orchestratorState = {
  running: false,
  globalInstructions: '',
  lastHeartbeat: null,
  nextHeartbeat: null,
  activeCronJobs: [
    { name: 'AGENT_REMINDER', schedule: 'Every 30 min', active: true, lastRun: null },
    { name: 'heartbeat-check', schedule: 'Every 30 min', active: true, lastRun: null },
    { name: 'agent-daily-reset', schedule: 'Daily midnight', active: true, lastRun: null }
  ]
};

const activeProcesses = {};
let agentService, scheduleService, analyticsService;

async function initializeServices() {
  await initializeDatabase();
  
  agentService = new AgentService();
  await agentService.seedDefaults();
  
  scheduleService = new ScheduleService(agentService);
  await scheduleService.loadActiveSchedules();
  
  analyticsService = new AnalyticsService();
  
  console.log('[DB] Database initialized');
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  if (agentService) {
    agentService.getAll().then(agents => socket.emit('stateUpdate', agents));
  }
  socket.emit('orchestratorUpdate', orchestratorState);
  
  socket.on('runAgent', async (agentName) => {
    const agent = await agentService.getByName(agentName);
    if (agent && agent.enabled) {
      runAgentOnce(agentName);
    }
  });
  
  socket.on('stopAgent', (agentName) => {
    stopAgent(agentName);
  });
  
  socket.on('setInstructions', async ({ agentName, instructions }) => {
    await agentService.update(agentName, { customInstructions: instructions });
    const agents = await agentService.getAll();
    io.emit('stateUpdate', agents);
  });
  
  socket.on('toggleAgent', async (agentName) => {
    const agent = await agentService.getByName(agentName);
    if (agent) {
      await agentService.update(agentName, { enabled: !agent.enabled });
      if (!agent.enabled && agent.status === 'running') {
        stopAgent(agentName);
      }
      const agents = await agentService.getAll();
      io.emit('stateUpdate', agents);
    }
  });
});

function stopAgent(agentName) {
  if (activeProcesses[agentName]) {
    activeProcesses[agentName].kill();
    delete activeProcesses[agentName];
  }
  agentService.getByName(agentName).then(agent => {
    if (agent) {
      agentService.update(agentName, { 
        status: 'idle', 
        currentActivity: null 
      });
      agentService.addLog(agentName, { 
        time: new Date().toISOString(), 
        message: 'Agent stopped' 
      });
      agentService.getAll().then(agents => io.emit('stateUpdate', agents));
    }
  });
}

function runAgentOnce(agentName) {
  agentService.getByName(agentName).then(agent => {
    if (!agent || !agent.enabled) return;
    
    agentService.update(agentName, { 
      status: 'running', 
      currentActivity: 'Starting...' 
    });
    agentService.addLog(agentName, { 
      time: new Date().toISOString(), 
      message: 'Starting agent run' 
    });
    
    const runtime = agent.runtimeMinutes || 10;
    const proc = spawn('bash', ['/Users/lido/.openclaw/workspace/scripts/run-agent.sh', agentName, runtime.toString()], {
      cwd: '/Users/lido/.openclaw/workspace',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    activeProcesses[agentName] = proc;
    const startTime = new Date();
    
    analyticsService.recordRun({
      agentName,
      startTime,
      status: 'running',
    }).then(run => {
      agent.runId = run.id;
    });
    
    proc.stdout.on('data', async (data) => {
      const output = data.toString();
      const currentAgent = await agentService.getByName(agentName);
      if (!currentAgent) return;
      
      if (output.includes('=== ') || output.includes('Run completed') || output.includes('Commented:') || output.includes('Voting...') || output.includes('IP:')) {
        await agentService.addLog(agentName, { time: new Date().toISOString(), type: 'stdout', message: output.trim() });
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
          await agentService.update(agentName, { commentsToday: currentAgent.commentsToday + 1 });
          const comment = {
            time: new Date().toISOString(),
            text: match[1].substring(0, 200),
            subreddit: currentAgent.currentActivity
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
          lastRun: Date.now()
        });
      }
      
      const agents = await agentService.getAll();
      io.emit('stateUpdate', agents);
    });
    
    proc.stderr.on('data', async (data) => {
      const output = data.toString();
      const currentAgent = await agentService.getByName(agentName);
      if (currentAgent && output.includes('error')) {
        await agentService.addLog(agentName, { time: new Date().toISOString(), type: 'stderr', message: output.substring(0, 200) });
        const agents = await agentService.getAll();
        io.emit('stateUpdate', agents);
      }
    });
    
    proc.on('close', async (code) => {
      const currentAgent = await agentService.getByName(agentName);
      if (currentAgent) {
        await agentService.update(agentName, { 
          status: 'idle', 
          currentActivity: null 
        });
        await agentService.addLog(agentName, { 
          time: new Date().toISOString(), 
          message: `Run completed (code ${code})` 
        });
        
        const endTime = new Date();
        const duration = Math.round((endTime - startTime) / 60000);
        await analyticsService.recordRun({
          agentName,
          endTime,
          durationMinutes: duration,
          status: code === 0 ? 'completed' : 'error',
          runsCount: currentAgent.runsToday,
          commentsCount: currentAgent.commentsToday,
          visitedSubreddits: currentAgent.visitedSubreddits,
        });
        
        const agents = await agentService.getAll();
        io.emit('stateUpdate', agents);
      }
      delete activeProcesses[agentName];
    });
    
    proc.on('error', async (err) => {
      const currentAgent = await agentService.getByName(agentName);
      if (currentAgent) {
        await agentService.update(agentName, { status: 'error' });
        await agentService.addLog(agentName, { 
          time: new Date().toISOString(), 
          type: 'error', 
          message: err.message 
        });
        const agents = await agentService.getAll();
        io.emit('stateUpdate', agents);
      }
    });
  });
}

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
    if (!name) return res.status(400).json({ error: 'Name required' });
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    const existing = await agentService.getByName(cleanName);
    if (existing) {
      return res.status(400).json({ error: 'Agent already exists' });
    }
    
    const agent = await agentService.create(cleanName);
    res.json({ success: true, name: cleanName });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/:name', async (req, res) => {
  try {
    const agent = await agentService.getByName(req.params.name);
    agent ? res.json(agent) : res.status(404).json({ error: 'Agent not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/:name/run', async (req, res) => {
  runAgentOnce(req.params.name);
  res.json({ success: true });
});

app.post('/api/agents/:name/stop', async (req, res) => {
  stopAgent(req.params.name);
  res.json({ success: true });
});

app.post('/api/agents/:name/toggle', async (req, res) => {
  try {
    const agent = await agentService.getByName(req.params.name);
    if (agent) {
      const enabled = !agent.enabled;
      await agentService.update(req.params.name, { enabled });
      if (!enabled && agent.status === 'running') {
        stopAgent(req.params.name);
      }
      res.json({ success: true, enabled });
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/:name/instructions', async (req, res) => {
  try {
    const { instructions } = req.body;
    await agentService.update(req.params.name, { customInstructions: instructions });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/:name/sites', async (req, res) => {
  try {
    const agent = await agentService.getByName(req.params.name);
    if (agent) {
      res.json({ allowed: agent.allowedSites, blocked: agent.blockedSites });
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/:name/sites', async (req, res) => {
  try {
    const { allowed, blocked } = req.body;
    const agent = await agentService.getByName(req.params.name);
    if (agent) {
      const updates = {};
      if (allowed) updates.allowedSites = allowed;
      if (blocked) updates.blockedSites = blocked;
      await agentService.update(req.params.name, updates);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/:name/config', async (req, res) => {
  try {
    const agent = await agentService.getByName(req.params.name);
    if (agent) {
      res.json({
        runtimeMinutes: agent.runtimeMinutes,
        pageTimeSeconds: agent.pageTimeSeconds,
        targetSubreddits: agent.targetSubreddits,
        searchTopics: agent.searchTopics,
        commentFrequency: agent.commentFrequency,
        upvotesPerSession: agent.upvotesPerSession,
        allowedSites: agent.allowedSites,
        blockedSites: agent.blockedSites,
        enabled: agent.enabled
      });
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/:name/config', async (req, res) => {
  try {
    const agent = await agentService.getByName(req.params.name);
    if (agent) {
      const { runtimeMinutes, pageTimeSeconds, targetSubreddits, searchTopics, commentFrequency, upvotesPerSession, allowedSites, blockedSites } = req.body;
      const updates = {};
      if (runtimeMinutes) updates.runtimeMinutes = runtimeMinutes;
      if (pageTimeSeconds) updates.pageTimeSeconds = pageTimeSeconds;
      if (targetSubreddits) updates.targetSubreddits = targetSubreddits;
      if (searchTopics) updates.searchTopics = searchTopics;
      if (commentFrequency) updates.commentFrequency = commentFrequency;
      if (upvotesPerSession) updates.upvotesPerSession = upvotesPerSession;
      if (allowedSites) updates.allowedSites = allowedSites;
      if (blockedSites) updates.blockedSites = blockedSites;
      
      await agentService.update(req.params.name, updates);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orchestrator', (req, res) => res.json(orchestratorState));

app.post('/api/orchestrator/instructions', (req, res) => {
  const { globalInstructions } = req.body;
  orchestratorState.globalInstructions = globalInstructions;
  io.emit('orchestratorUpdate', orchestratorState);
  res.json({ success: true });
});

app.post('/api/orchestrator/toggle', (req, res) => {
  orchestratorState.running = !orchestratorState.running;
  io.emit('orchestratorUpdate', orchestratorState);
  res.json({ success: true, running: orchestratorState.running });
});

app.post('/api/cron/:name/toggle', (req, res) => {
  const job = orchestratorState.activeCronJobs.find(j => j.name === req.params.name);
  if (job) {
    job.active = !job.active;
    io.emit('orchestratorUpdate', orchestratorState);
    res.json({ success: true, active: job.active });
  } else {
    res.status(404).json({ error: 'Cron job not found' });
  }
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
    const schedule = await scheduleService.update(parseInt(req.params.id), req.body);
    schedule ? res.json(schedule) : res.status(404).json({ error: 'Schedule not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/schedules/:id', async (req, res) => {
  try {
    const deleted = await scheduleService.delete(parseInt(req.params.id));
    deleted ? res.json({ success: true }) : res.status(404).json({ error: 'Schedule not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/schedules/:id/toggle', async (req, res) => {
  try {
    const schedule = await scheduleService.toggle(parseInt(req.params.id));
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
    const limit = parseInt(req.query.limit) || 20;
    const stats = await analyticsService.getTopSubreddits(limit);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3002;

initializeServices().then(() => {
  server.listen(PORT, () => {
    console.log(`🤖 Agent Control Center running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize:', err);
  process.exit(1);
});
