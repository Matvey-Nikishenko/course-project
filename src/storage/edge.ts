import { createServer, Server } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { readObject } from './s3';

type Cached = { body: Buffer; cacheControl: string };

/**
 * Local stand-in for CloudFront + OAC. Callers hit this process.
 * This process is the only one that talks to the bucket, and it uses its own
 * credentials. A response is stored only when the object itself carried a
 * public Cache-Control. The edge does not invent that header.
 */
export function startEdge(client: S3Client, bucket: string): Promise<{ port: number; close: () => Promise<void> }> {
  const cache = new Map<string, Cached>();
  const server: Server = createServer(async (req, res) => {
    const key = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//, ''));
    const hit = cache.get(key);
    if (hit) {
      res.statusCode = 200;
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', hit.cacheControl);
      res.setHeader('Content-Type', 'text/css');
      res.end(hit.body);
      return;
    }
    try {
      const object = await readObject(client, bucket, key);
      const cacheable = /public/i.test(object.cacheControl) && /max-age=\d+/.test(object.cacheControl);
      if (cacheable) cache.set(key, object);
      res.statusCode = 200;
      res.setHeader('X-Cache', 'MISS');
      if (object.cacheControl) res.setHeader('Cache-Control', object.cacheControl);
      res.setHeader('Content-Type', 'text/css');
      res.end(object.body);
    } catch {
      res.statusCode = 404;
      res.setHeader('X-Cache', 'MISS');
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('edge has no port'));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
