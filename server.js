const { createAgentControlDaemon } = require('./src/daemon');

const daemon = createAgentControlDaemon();

async function boot() {
  try {
    await daemon.start();
  } catch (err) {
    console.error('Failed to initialize:', err);
    process.exit(1);
  }
}

async function handleShutdown(signal) {
  try {
    await daemon.shutdown();
  } finally {
    daemon.server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 2_000).unref();
  }
}

process.on('SIGINT', () => {
  void handleShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void handleShutdown('SIGTERM');
});

void boot();
