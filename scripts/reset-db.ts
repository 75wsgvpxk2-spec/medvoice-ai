import fs from 'node:fs';
import { config } from '../server/src/lib/config.ts';

for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const path = `${config.dbPath}${suffix}`;
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
    console.log(`removed ${path}`);
  }
}
console.log('Database reset. Run `npm run seed` to reload the population.');
