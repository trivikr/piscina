'use strict';
import Piscina from '..';
import { test } from 'tap';
import { resolve } from 'path';

test('will put items into a task queue until they can run', async ({ is }) => {
  const pool = new Piscina({
    filename: resolve(__dirname, 'fixtures/wait-for-notify.ts'),
    minThreads: 2,
    maxThreads: 3
  });

  is(pool.threads.length, 2);
  is(pool.queueSize, 0);

  const buffers = [
    new Int32Array(new SharedArrayBuffer(4)),
    new Int32Array(new SharedArrayBuffer(4)),
    new Int32Array(new SharedArrayBuffer(4)),
    new Int32Array(new SharedArrayBuffer(4))
  ];

  const results = [];

  results.push(pool.runTask(buffers[0]));
  is(pool.threads.length, 2);
  is(pool.queueSize, 0);

  results.push(pool.runTask(buffers[1]));
  is(pool.threads.length, 2);
  is(pool.queueSize, 0);

  results.push(pool.runTask(buffers[2]));
  is(pool.threads.length, 3);
  is(pool.queueSize, 0);

  results.push(pool.runTask(buffers[3]));
  is(pool.threads.length, 3);
  is(pool.queueSize, 1);

  for (const buffer of buffers) {
    Atomics.store(buffer, 0, 1);
    Atomics.notify(buffer, 0, 1);
  }

  await results[0];
  is(pool.queueSize, 0);

  await Promise.all(results);
});

test('will reject items over task queue limit', async ({ is, rejects }) => {
  const pool = new Piscina({
    filename: resolve(__dirname, 'fixtures/eval.ts'),
    minThreads: 0,
    maxThreads: 1,
    maxQueue: 2
  });

  is(pool.threads.length, 0);
  is(pool.queueSize, 0);

  rejects(pool.runTask('while (true) {}'), /Terminating worker thread/);
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  rejects(pool.runTask('while (true) {}'), /Terminating worker thread/);
  is(pool.threads.length, 1);
  is(pool.queueSize, 1);

  rejects(pool.runTask('while (true) {}'), /Terminating worker thread/);
  is(pool.threads.length, 1);
  is(pool.queueSize, 2);

  rejects(pool.runTask('while (true) {}'), /Task queue is at limit/);
  await pool.destroy();
});

test('will reject items when task queue is unavailable', async ({ is, rejects }) => {
  const pool = new Piscina({
    filename: resolve(__dirname, 'fixtures/eval.ts'),
    minThreads: 0,
    maxThreads: 1,
    maxQueue: 0
  });

  is(pool.threads.length, 0);
  is(pool.queueSize, 0);

  rejects(pool.runTask('while (true) {}'), /Terminating worker thread/);
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  rejects(pool.runTask('while (true) {}'), /No task queue available and all Workers are busy/);
  await pool.destroy();
});

test('tasks can share a Worker if requested (both tests blocking)', async ({ is, rejects }) => {
  const pool = new Piscina({
    filename: resolve(__dirname, 'fixtures/wait-for-notify.ts'),
    minThreads: 0,
    maxThreads: 1,
    maxQueue: 0,
    concurrentTasksPerWorker: 2
  });

  is(pool.threads.length, 0);
  is(pool.queueSize, 0);

  rejects(pool.runTask(new Int32Array(new SharedArrayBuffer(4))));
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  rejects(pool.runTask(new Int32Array(new SharedArrayBuffer(4))));
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  await pool.destroy();
});

test('tasks can share a Worker if requested (one test finishes)', async ({ is, rejects }) => {
  const pool = new Piscina({
    filename: resolve(__dirname, 'fixtures/wait-for-notify.ts'),
    minThreads: 0,
    maxThreads: 1,
    maxQueue: 0,
    concurrentTasksPerWorker: 2
  });

  const buffers = [
    new Int32Array(new SharedArrayBuffer(4)),
    new Int32Array(new SharedArrayBuffer(4))
  ];

  is(pool.threads.length, 0);
  is(pool.queueSize, 0);

  const firstTask = pool.runTask(buffers[0]);
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  rejects(pool.runTask(
    'new Promise((resolve) => setTimeout(resolve, 1000000))',
    resolve(__dirname, 'fixtures/eval.js')), /Terminating worker thread/);
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  Atomics.store(buffers[0], 0, 1);
  Atomics.notify(buffers[0], 0, 1);

  await firstTask;
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  await pool.destroy();
});

test('tasks can share a Worker if requested (both tests finish)', async ({ is }) => {
  const pool = new Piscina({
    filename: resolve(__dirname, 'fixtures/wait-for-notify.ts'),
    minThreads: 0,
    maxThreads: 1,
    maxQueue: 0,
    concurrentTasksPerWorker: 2
  });

  const buffers = [
    new Int32Array(new SharedArrayBuffer(4)),
    new Int32Array(new SharedArrayBuffer(4))
  ];

  is(pool.threads.length, 0);
  is(pool.queueSize, 0);

  const firstTask = pool.runTask(buffers[0]);
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  const secondTask = pool.runTask(buffers[1]);
  is(pool.threads.length, 1);
  is(pool.queueSize, 0);

  Atomics.store(buffers[0], 0, 1);
  Atomics.store(buffers[1], 0, 1);
  Atomics.notify(buffers[0], 0, 1);
  Atomics.notify(buffers[1], 0, 1);
  Atomics.wait(buffers[0], 0, 1);
  Atomics.wait(buffers[1], 0, 1);

  await firstTask;
  is(buffers[0][0], -1);
  await secondTask;
  is(buffers[1][0], -1);

  is(pool.threads.length, 1);
  is(pool.queueSize, 0);
});
