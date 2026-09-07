import { BadRequestException } from '@nestjs/common';

export function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      id?: unknown;
    };
    if (typeof parsed.id !== 'number' || !Number.isInteger(parsed.id)) throw new Error();
    return parsed.id;
  } catch {
    throw new BadRequestException({
      code: 'bad-cursor',
      detail: 'cursor is opaque and belongs to the server',
    });
  }
}

export function paginate<T extends { id: number }>(
  items: T[],
  limit: number,
  cursorRaw?: string,
): { items: T[]; next_cursor: string | null } {
  const startAfter = cursorRaw ? decodeCursor(cursorRaw) : 0;
  const slice = items.filter((item) => item.id > startAfter).slice(0, limit);
  const last = slice[slice.length - 1];
  const hasMore = last ? items.some((item) => item.id > last.id) : false;
  return {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}
