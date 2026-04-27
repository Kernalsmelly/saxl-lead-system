import { describe, expect, it } from 'vitest';

import {
  decideFollowUpAction,
  type FollowUpRow,
  type LeadSnapshot,
} from './decide';

const fu = (type: FollowUpRow['type']): FollowUpRow => ({
  id: '00000000-0000-0000-0000-000000000001',
  lead_id: '00000000-0000-0000-0000-000000000002',
  type,
});

const lead = (status: LeadSnapshot['status']): LeadSnapshot => ({
  id: '00000000-0000-0000-0000-000000000002',
  status,
});

describe('decideFollowUpAction', () => {
  describe('lead missing', () => {
    it('returns skip_lead_not_found when lead is null', () => {
      expect(decideFollowUpAction(fu('48h_response'), null)).toEqual({
        kind: 'skip_lead_not_found',
      });
    });
  });

  describe('terminal lead status', () => {
    for (const status of ['won', 'lost', 'cold'] as const) {
      it(`returns skip_terminal_status for ${status}`, () => {
        expect(decideFollowUpAction(fu('48h_response'), lead(status))).toEqual({
          kind: 'skip_terminal_status',
          currentStatus: status,
        });
      });
    }
  });

  describe('48h_response', () => {
    it('sends when lead is still new', () => {
      expect(decideFollowUpAction(fu('48h_response'), lead('new'))).toEqual({
        kind: 'send',
      });
    });
    for (const status of ['contacted', 'quoted', 'booked'] as const) {
      it(`skips when lead has moved to ${status}`, () => {
        expect(decideFollowUpAction(fu('48h_response'), lead(status))).toEqual({
          kind: 'skip_status_no_longer_applicable',
          type: '48h_response',
          currentStatus: status,
        });
      });
    }
  });

  describe('7d_quote_followup', () => {
    it('sends when lead is still quoted', () => {
      expect(
        decideFollowUpAction(fu('7d_quote_followup'), lead('quoted')),
      ).toEqual({ kind: 'send' });
    });
    for (const status of ['new', 'contacted', 'booked'] as const) {
      it(`skips when lead is ${status}`, () => {
        expect(
          decideFollowUpAction(fu('7d_quote_followup'), lead(status)),
        ).toEqual({
          kind: 'skip_status_no_longer_applicable',
          type: '7d_quote_followup',
          currentStatus: status,
        });
      });
    }
  });

  describe('14d_cold_check', () => {
    for (const status of ['new', 'contacted'] as const) {
      it(`sends when lead is ${status}`, () => {
        expect(decideFollowUpAction(fu('14d_cold_check'), lead(status))).toEqual({
          kind: 'send',
        });
      });
    }
    for (const status of ['quoted', 'booked'] as const) {
      it(`skips when lead has progressed to ${status}`, () => {
        expect(decideFollowUpAction(fu('14d_cold_check'), lead(status))).toEqual({
          kind: 'skip_status_no_longer_applicable',
          type: '14d_cold_check',
          currentStatus: status,
        });
      });
    }
  });

  describe('custom', () => {
    it('always sends (no v1 preconditions)', () => {
      expect(decideFollowUpAction(fu('custom'), lead('new'))).toEqual({
        kind: 'send',
      });
    });
  });
});
