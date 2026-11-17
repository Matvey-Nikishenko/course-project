import { createWriteStream } from 'node:fs';

export function startLoad(url, file, workers = 32) {
  const stream = createWriteStream(file, { flags: 'a' });
  let stopped = false;
  const loops = Array.from({ length: workers }, async () => {
    while (!stopped) {
      let code = '000';
      try {
        const res = await fetch(url);
        code = String(res.status);
      } catch {
        code = '000';
      }
      if (stopped) return;
      stream.write(`${code}\n`);
    }
  });
  return {
    async stop() {
      stopped = true;
      await Promise.allSettled(loops);
      await new Promise((resolve) => stream.end(resolve));
    },
  };
}
