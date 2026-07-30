import { describe, it, expect } from 'vitest'
import { STANDING_ALLOWANCE, approvalAmountFor } from '~/utils/payment'

describe('payment', () => {
  describe('approvalAmountFor', () => {
    it('approves the standing amount for quotes below it', () => {
      expect(approvalAmountFor(1n)).toBe(STANDING_ALLOWANCE)
      expect(approvalAmountFor(STANDING_ALLOWANCE / 2n)).toBe(STANDING_ALLOWANCE)
    })

    it('approves the standing amount for a quote exactly at it', () => {
      expect(approvalAmountFor(STANDING_ALLOWANCE)).toBe(STANDING_ALLOWANCE)
    })

    it('approves the full amount for quotes above the standing amount', () => {
      const large = STANDING_ALLOWANCE * 3n + 7n
      expect(approvalAmountFor(large)).toBe(large)
    })
  })
})
