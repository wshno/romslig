export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 428 | 500 | 502

export class HttpError extends Error {
  constructor(
    public status: HttpStatus,
    message: string,
  ) {
    super(message)
  }
}
