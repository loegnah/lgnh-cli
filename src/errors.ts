export class StepError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export function formatError(error: unknown): string {
  if (error instanceof StepError) {
    return error.detail ? `${error.message}\n${error.detail}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
