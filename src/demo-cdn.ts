import { report } from './broker/demo-setup';
import { startEdge } from './storage/edge';
import {
  createStorageClient,
  ensureBucket,
  objectUrl,
  putVersionedAsset,
  resetPrefix,
  storageConfig,
} from './storage/s3';

async function main(): Promise<void> {
  const storage = storageConfig();
  if (!storage?.endpoint) throw new Error('STORAGE_ENDPOINT is required');
  const client = createStorageClient(storage);
  await ensureBucket(client, storage.bucket);
  await resetPrefix(client, storage.bucket, 'assets/');
  const edge = await startEdge(client, storage.bucket);
  try {
    const first = await putVersionedAsset(client, storage.bucket, 'v1 { color: red }\n');
    const direct = await fetch(objectUrl(storage.endpoint, storage.bucket, first.key));
    const miss = await fetch(`http://127.0.0.1:${edge.port}/${first.key}`);
    const missBody = await miss.text();
    const hit = await fetch(`http://127.0.0.1:${edge.port}/${first.key}`);
    const second = await putVersionedAsset(client, storage.bucket, 'v2 { color: blue }\n');
    const next = await fetch(`http://127.0.0.1:${edge.port}/${second.key}`);
    const nextBody = await next.text();

    const rows = {
      direct: direct.status,
      'edge-miss': miss.status,
      'edge-hit': hit.status,
      'cache-hit': hit.headers.get('x-cache') === 'HIT' ? 1 : 0,
      'new-name': first.key !== second.key ? 1 : 0,
      'new-url': next.status,
      'content-changed': nextBody !== missBody && nextBody.length > 0 ? 1 : 0,
    };
    const ok =
      rows.direct === 403 &&
      rows['edge-miss'] === 200 &&
      rows['edge-hit'] === 200 &&
      rows['cache-hit'] === 1 &&
      rows['new-name'] === 1 &&
      rows['new-url'] === 200 &&
      rows['content-changed'] === 1;
    await resetPrefix(client, storage.bucket, 'assets/');
    client.destroy();
    await edge.close();
    report(rows, ok);
    process.exit(0);
  } finally {
    await edge.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
