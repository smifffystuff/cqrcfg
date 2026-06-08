import { mkdir, rmdir, stat } from 'fs/promises';
import { dirname } from 'path';

const DEFAULT_TIMEOUT = 30000;
const STALE_THRESHOLD = 60000;

/**
 * Acquire an exclusive inter-process lock using mkdir (atomic on POSIX).
 * Works reliably on ext4, XFS, Ceph RBD — anything WSL2 native or PVC-backed.
 *
 * Includes stale lock detection: if the lock directory is older than STALE_THRESHOLD,
 * it's assumed to be from a crashed process and is forcibly removed.
 */
export async function withFileLock(lockPath, fn, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let delay = 5;

  // Ensure the parent directory exists (handles first-run before .git is created)
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      // Check for stale lock from a crashed process
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_THRESHOLD) {
          await rmdir(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // Lock disappeared between our check — retry acquire
        continue;
      }

      if (Date.now() - start > timeout) {
        throw new Error(`Failed to acquire file lock: ${lockPath} (timeout ${timeout}ms)`);
      }

      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 200);
    }
  }

  try {
    return await fn();
  } finally {
    await rmdir(lockPath).catch(() => {});
  }
}
