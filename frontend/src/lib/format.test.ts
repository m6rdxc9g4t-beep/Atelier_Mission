import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { centsToInput, hours, parseEuros, parseNumber, relativeDays } from './format.ts'

describe('formats', () => {
  it('lit un montant saisi à la française', () => {
    assert.equal(parseEuros('1 234,5'), 123_450)
    assert.equal(parseEuros('550 €'), 55_000)
    assert.equal(parseEuros('12,345'), null)
    assert.equal(parseEuros('abc'), null)
    assert.equal(centsToInput(55_050), '550,5')
  })
  it('lit une quantité et formate les durées', () => {
    assert.equal(parseNumber('2,5'), 2.5)
    assert.equal(hours(630), '10 h 30')
    assert.equal(relativeDays('2026-11-04', '2026-11-03'), 'demain')
    assert.equal(relativeDays('2026-10-31', '2026-11-03'), 'il y a 3 j')
  })
})
