import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

describe('Git Storage - promote', async () => {
  let storage;
  let bareRepoDir;
  let testDir;

  before(async () => {
    const { GitStorage } = await import('../src/storage/git.js');

    bareRepoDir = join(tmpdir(), `cqrcfg-git-promote-bare-${randomUUID()}`);
    await mkdir(bareRepoDir, { recursive: true });
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], { cwd: bareRepoDir });

    const initDir = join(tmpdir(), `cqrcfg-git-promote-init-${randomUUID()}`);
    await execFileAsync('git', ['clone', bareRepoDir, initDir]);
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: initDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: initDir });
    await execFileAsync('git', ['checkout', '-b', 'main'], { cwd: initDir });
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: initDir });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: initDir });
    // Create the promotion target branch
    await execFileAsync('git', ['checkout', '-b', 'production'], { cwd: initDir });
    await execFileAsync('git', ['push', '-u', 'origin', 'production'], { cwd: initDir });
    await rm(initDir, { recursive: true, force: true });

    testDir = join(tmpdir(), `cqrcfg-git-promote-${randomUUID()}`);
    storage = new GitStorage({
      remoteUrl: bareRepoDir,
      localPath: testDir,
      branch: 'main',
      pullInterval: 0,
    });
    await storage.connect();
  });

  after(async () => {
    await storage.close();
    await rm(bareRepoDir, { recursive: true, force: true });
    await rm(testDir, { recursive: true, force: true });
  });

  it('should promote a config to the target branch', async () => {
    await storage.upsert('/config/app/settings', { env: 'dev', debug: true });

    await storage.promote('/config/app/settings', 'production');

    // Verify the config exists on the target branch by checking bare repo
    const verifyDir = join(tmpdir(), `cqrcfg-git-verify-${randomUUID()}`);
    await execFileAsync('git', ['clone', '--branch', 'production', bareRepoDir, verifyDir]);
    const { readFile } = await import('fs/promises');
    const content = JSON.parse(await readFile(join(verifyDir, 'config/app/settings.json'), 'utf8'));
    assert.deepStrictEqual(content.data, { env: 'dev', debug: true });
    await rm(verifyDir, { recursive: true, force: true });
  });

  it('should throw NOT_FOUND when source path does not exist', async () => {
    await assert.rejects(
      () => storage.promote('/config/nonexistent/path', 'production'),
      (err) => {
        assert.strictEqual(err.code, 'NOT_FOUND');
        return true;
      }
    );
  });

  it('should throw TARGET_BRANCH_NOT_FOUND when target branch does not exist', async () => {
    await storage.upsert('/config/app/other', { value: 1 });

    await assert.rejects(
      () => storage.promote('/config/app/other', 'nonexistent-branch'),
      (err) => {
        assert.strictEqual(err.code, 'TARGET_BRANCH_NOT_FOUND');
        return true;
      }
    );
  });

  it('should remain on the source branch after promotion', async () => {
    await storage.upsert('/config/app/check', { test: true });
    await storage.promote('/config/app/check', 'production');

    // Storage should still work on the source branch
    const result = await storage.getByPath('/config/app/check');
    assert.ok(result);
    assert.deepStrictEqual(result.data, { test: true });
  });
});

describe('Git Storage - promote (local mode)', async () => {
  let storage;
  let testDir;

  before(async () => {
    const { GitStorage } = await import('../src/storage/git.js');
    testDir = join(tmpdir(), `cqrcfg-git-promote-local-${randomUUID()}`);
    storage = new GitStorage({
      localPath: testDir,
      branch: 'main',
    });
    await storage.connect();

    // Need at least one commit before we can create a branch
    await storage.upsert('/config/init', { init: true });

    // Create the target branch locally
    await storage._git(['branch', 'staging']);
  });

  after(async () => {
    await storage.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should promote to a local branch without remote', async () => {
    await storage.upsert('/config/local/test', { value: 'local-promote' });

    await storage.promote('/config/local/test', 'staging');

    // Verify by checking out the target branch and reading the file
    const { readFile } = await import('fs/promises');
    const hash = await storage._git(['rev-parse', 'staging']);
    const content = await storage._git(['show', `${hash}:config/local/test.json`]);
    const parsed = JSON.parse(content);
    assert.deepStrictEqual(parsed.data, { value: 'local-promote' });
  });
});
