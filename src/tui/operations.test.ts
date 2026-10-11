import { test, expect } from "bun:test";
import { OperationScope } from "./operations.ts";

test("OperationScope manages cancellation settlement, prohibits duplicate starts, and releases busy on failure", async () => {
  const scope = new OperationScope();
  expect(scope.busy).toBe(false);

  // 1. Duplicate starts prohibited while busy
  const { promise: firstStarted, resolve: markFirstStarted } = Promise.withResolvers<void>();
  const { promise: letFirstFinish, resolve: finishFirst } = Promise.withResolvers<void>();

  let receivedSignal: AbortSignal | null = null;
  const firstOpPromise = scope.run(async (signal) => {
    receivedSignal = signal;
    markFirstStarted();
    await letFirstFinish;
  });

  await firstStarted;
  expect(scope.busy).toBe(true);

  // Attempting a duplicate start while busy must reject immediately
  await expect(scope.run(async () => {})).rejects.toBeInstanceOf(Error);
  expect(scope.busy).toBe(true);

  // 2. Cancellation settlement: aborts active task, waits for settlement, rejects re-entrant work
  let cancelResolved = false;
  const cancelPromise = scope.cancel().then(() => {
    cancelResolved = true;
  });

  // Signal is immediately marked aborted
  expect(receivedSignal!.aborted).toBe(true);
  // But cancel() must await in-flight task settlement
  expect(cancelResolved).toBe(false);

  finishFirst();
  await firstOpPromise;
  await cancelPromise;
  expect(cancelResolved).toBe(true);
  expect(scope.busy).toBe(false);

  // No re-entrant starts permitted after closing
  await expect(scope.run(async () => {})).rejects.toBeInstanceOf(Error);

  // 3. Failure releasing busy (handles both sync throws and async rejections)
  const failureScope = new OperationScope();

  // Sync throw inside operation callback
  await expect(
    failureScope.run(() => {
      expect(failureScope.busy).toBe(true);
      throw new Error("Sync failure");
    }),
  ).rejects.toBeInstanceOf(Error);
  expect(failureScope.busy).toBe(false);

  // Async rejection inside operation callback
  await expect(
    failureScope.run(async () => {
      expect(failureScope.busy).toBe(true);
      throw new Error("Async failure");
    }),
  ).rejects.toBeInstanceOf(Error);
  expect(failureScope.busy).toBe(false);

  // Subsequent non-closing work executes cleanly after failures
  let recoveredRan = false;
  await failureScope.run(async () => {
    recoveredRan = true;
  });
  expect(recoveredRan).toBe(true);
  expect(failureScope.busy).toBe(false);

  // Direct screens initiate shutdown from inside their completion callback.
  const completionScope = new OperationScope();
  let shutdown: Promise<void> | undefined;
  await completionScope.run(async (signal) => {
    shutdown = completionScope.cancel();
    expect(signal.aborted).toBe(true);
  });
  await shutdown;
  expect(completionScope.busy).toBe(false);
});
