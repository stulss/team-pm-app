import { env } from './config/env.js';
import { server, ready } from './server.js';
import { logger } from './utils/logger.js';

await ready;
server.listen(env.PORT, () => {
  logger.info(`server listening on http://localhost:${env.PORT}`);
});
