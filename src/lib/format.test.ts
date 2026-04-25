import { describe, expect, it } from 'vitest';
import { formatEnum } from './format';

describe('formatEnum', () => {
  it('title-cases a single-word value', () => {
    expect(formatEnum('new')).toBe('New');
  });

  it('de-underscores and title-cases a multi-word value', () => {
    expect(formatEnum('website_form')).toBe('Website Form');
    expect(formatEnum('junk_removal')).toBe('Junk Removal');
    expect(formatEnum('in_progress')).toBe('In Progress');
  });

  it('lowercases interior all-caps before title-casing', () => {
    expect(formatEnum('STATUS_CHANGED')).toBe('Status Changed');
  });

  it('returns em-dash for null, undefined, and empty string', () => {
    expect(formatEnum(null)).toBe('—');
    expect(formatEnum(undefined)).toBe('—');
    expect(formatEnum('')).toBe('—');
  });

  it('skips empty segments from leading/trailing/double underscores', () => {
    expect(formatEnum('_foo__bar_')).toBe('Foo Bar');
  });
});
