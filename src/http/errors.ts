import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { DomainError, ProviderUnavailableError, RejectedFixError, ValidationError } from "../domain/errors.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function statusFor(err: unknown): number {
  if (err instanceof ValidationError) return 400;
  if (err instanceof RejectedFixError) return 422;
  if (err instanceof ProviderUnavailableError) return 503;
  if (err instanceof ZodError) return 400;
  const sc = (err as FastifyError).statusCode;
  return typeof sc === "number" && sc >= 400 && sc < 600 ? sc : 500;
}

/**
 * Single place that maps errors to HTTP. Internal errors are logged with the
 * request id and returned as an opaque 500 so no stack traces or SQL leak.
 */
export function errorHandler(err: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const status = statusFor(err);
  let body: ErrorBody;

  if (err instanceof ZodError) {
    body = {
      error: {
        code: "VALIDATION_ERROR",
        message: "invalid request",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  } else if (err instanceof DomainError) {
    body = { error: { code: err.code, message: err.message } };
  } else if (status < 500) {
    const fe = err as FastifyError;
    body = { error: { code: fe.code ?? "REQUEST_ERROR", message: fe.message } };
  } else {
    request.log.error({ err, requestId: request.id }, "unhandled error");
    body = { error: { code: "INTERNAL_ERROR", message: "internal error" } };
  }

  void reply.status(status).send(body);
}
