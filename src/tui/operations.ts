export class OperationScope {
  private _busy = false;
  private _closing = false;
  private _controller: AbortController | null = null;
  private _settlePromise: Promise<void> | null = null;

  get busy(): boolean {
    return this._busy;
  }

  async run(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this._closing) {
      throw new Error("Operation scope is closing");
    }
    if (this._busy) {
      throw new Error("Operation already running");
    }

    const controller = new AbortController();
    this._controller = controller;
    this._busy = true;

    const { promise: settlePromise, resolve: settleResolve } = Promise.withResolvers<void>();
    this._settlePromise = settlePromise;

    try {
      await operation(controller.signal);
    } finally {
      this._controller = null;
      this._busy = false;
      this._settlePromise = null;
      settleResolve();
    }
  }

  async cancel(): Promise<void> {
    this._closing = true;
    if (this._controller && !this._controller.signal.aborted) {
      this._controller.abort();
    }
    if (this._settlePromise) {
      await this._settlePromise;
    }
  }
}
