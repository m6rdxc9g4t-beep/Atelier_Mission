// Erreurs HTTP : un format unique pour toute l'API, celui du contrat de la Suite Atelier (§7.5) :
// { statusCode, code, detail } (+ `message`, identique à `detail`, pour les clients génériques).
import { STATUS_CODES } from 'node:http'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
  }
}

export const notFound = (message: string): HttpError => new HttpError(404, 'NOT_FOUND', message)
export const badRequest = (message: string): HttpError => new HttpError(400, 'VALIDATION', message)
export const conflict = (message: string, code = 'CONFLICT'): HttpError => new HttpError(409, code, message)
export const forbidden = (code: string, message: string): HttpError => new HttpError(403, code, message)
/** Service tiers (Projets, Trésorerie, Brevo) injoignable ou en erreur. */
export const badGateway = (code: string, message: string): HttpError => new HttpError(502, code, message)

export interface ErrorBody {
  statusCode: number
  error: string
  code: string
  detail: string
  message: string
}

export function errorBody(statusCode: number, code: string, detail: string): ErrorBody {
  return { statusCode, error: STATUS_CODES[statusCode] ?? 'Error', code, detail, message: detail }
}

function validationDetail(error: FastifyError): string {
  const first = error.validation?.[0]
  if (!first) return 'Requête invalide'
  const field = (first.instancePath || '').replace(/^\//, '').replaceAll('/', '.') || (first.params as { missingProperty?: string }).missingProperty || 'corps'
  const missing = (first.params as { missingProperty?: string }).missingProperty
  if (first.keyword === 'required' && missing) return `Champ obligatoire manquant : ${missing}`
  if (first.keyword === 'additionalProperties') return `Champ inconnu : ${(first.params as { additionalProperty?: string }).additionalProperty ?? '?'}`
  return `Champ « ${field} » invalide (${first.message ?? 'valeur refusée'})`
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof HttpError) return reply.status(error.statusCode).send(errorBody(error.statusCode, error.code, error.message))
  if (error.validation) return reply.status(400).send(errorBody(400, 'VALIDATION', validationDetail(error)))
  const sqliteCode = (error as { code?: string }).code ?? ''
  if (sqliteCode.startsWith('SQLITE_CONSTRAINT')) {
    return reply.status(409).send(errorBody(409, 'CONFLICT', 'Opération refusée : elle casserait une référence ou une contrainte d’unicité'))
  }
  const statusCode = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
  if (statusCode === 500) {
    request.log.error({ err: error }, 'Erreur interne')
    return reply.status(500).send(errorBody(500, 'INTERNAL_ERROR', 'Erreur interne du serveur'))
  }
  return reply.status(statusCode).send(errorBody(statusCode, error.code ?? 'ERROR', error.message))
}
