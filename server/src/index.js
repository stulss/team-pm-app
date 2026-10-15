import { env } from './config/env.js';
import { server, ready } from './server.js';

await ready;
server.listen(env.PORT, () => {
  console.log(`server listening on http://localhost:${env.PORT}`);
});
