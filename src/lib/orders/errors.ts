export class HttpError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}
