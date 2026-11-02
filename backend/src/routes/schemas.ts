// Schémas TypeBox partagés des routes (validation des entrées ; un champ inconnu est refusé).
import { Type, type TProperties } from 'typebox'
import { CHANNELS, PAYMENT_METHODS, SOURCES, STAGES, UNITS } from '../db/schema.ts'

export function Strict<P extends TProperties>(properties: P) {
  return Type.Object(properties, { additionalProperties: false })
}

export const Id = Type.Integer({ minimum: 1, maximum: 2_147_483_647 })
export const IdParams = Strict({ id: Id })
export const IsoDate = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
export const Cents = Type.Integer({ minimum: -1_000_000_000_00, maximum: 1_000_000_000_00 })
export const PositiveCents = Type.Integer({ minimum: 0, maximum: 1_000_000_000_00 })
export const RateBps = Type.Integer({ minimum: 0, maximum: 10_000 })
export const Text = (max = 2000) => Type.String({ maxLength: max })
export const Nullable = <T extends ReturnType<typeof Type.String> | ReturnType<typeof Type.Integer> | ReturnType<typeof Type.Number>>(schema: T) =>
  Type.Union([schema, Type.Null()])

export const ChannelSchema = Type.Union(CHANNELS.map((c) => Type.Literal(c)))
export const SourceSchema = Type.Union(SOURCES.map((s) => Type.Literal(s)))
export const StageSchema = Type.Union(STAGES.map((s) => Type.Literal(s)))
export const UnitSchema = Type.Union(UNITS.map((u) => Type.Literal(u)))
export const PaymentMethodSchema = Type.Union(PAYMENT_METHODS.map((m) => Type.Literal(m)))

export const LineSchema = Strict({
  id: Type.Optional(Id),
  label: Type.String({ minLength: 1, maxLength: 300 }),
  details: Type.Optional(Text(2000)),
  unit: UnitSchema,
  quantity: Type.Number({ minimum: -100_000, maximum: 100_000 }),
  unitPriceCents: Type.Integer({ minimum: 0, maximum: 1_000_000_00 }),
  vatRateBps: RateBps,
})
export const LinesSchema = Type.Array(LineSchema, { maxItems: 200 })
