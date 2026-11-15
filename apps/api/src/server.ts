import { createApp, tick } from './app.js';
import { bootstrapChain, provider } from './chain.js';
import { db, env } from './config.js';
import { refreshBadges, seedBadges } from './portfolio.js';

try {
  await bootstrapChain();
  await seedBadges();
  await refreshBadges();
  const server = createApp().listen(env.API_PORT, '127.0.0.1', () =>
    console.log('ChainTrade API listening at http://127.0.0.1:' + env.API_PORT),
  );
  let busy = false;
  const clock = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (error) {
      console.error('Market tick failed:', error instanceof Error ? error.name : 'Error');
    } finally {
      busy = false;
    }
  }, 30_000);
  function stop() {
    clearInterval(clock);
    server.closeAllConnections();
    server.close(async () => {
      provider.destroy();
      await db.$disconnect();
    });
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(
    'ChainTrade startup failed. Verify PostgreSQL, the migration, and the local deployment.',
    error instanceof Error ? error.message : '',
  );
  provider.destroy();
  await db.$disconnect();
  process.exitCode = 1;
}
