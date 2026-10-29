import { sanitize } from './sanitize';

describe('sanitize', () => {
  it('keeps plain values as they are', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeUndefined();
    expect(sanitize(42)).toBe(42);
    expect(sanitize(true)).toBe(true);
    expect(sanitize('Ali')).toBe('Ali');
    expect(sanitize({ name: 'Ali', tags: ['a', 'b'] })).toEqual({
      name: 'Ali',
      tags: ['a', 'b'],
    });
  });

  it('drops passwords, tokens and secrets, whatever their case', () => {
    expect(
      sanitize({
        email: 'a@b.dz',
        password: 'x',
        newPassword: 'y',
        refreshToken: 'z',
        clientSecret: 's',
        PASSWORD_HASH: 'h',
        nested: { accessToken: 't', keep: 1 },
      }),
    ).toEqual({ email: 'a@b.dz', nested: { keep: 1 } });
  });

  it('replaces images sent as data URLs', () => {
    expect(sanitize({ logo: 'data:image/png;base64,AAAA' })).toEqual({
      logo: '[image]',
    });
  });

  it('shortens long text', () => {
    const out = sanitize('x'.repeat(500)) as string;
    expect(out).toHaveLength(201);
    expect(out.endsWith('…')).toBe(true);
    expect(sanitize('y'.repeat(200))).toBe('y'.repeat(200));
  });

  it('summarizes long lists', () => {
    expect(sanitize(Array.from({ length: 11 }, (_, i) => i))).toBe(
      '[11 items]',
    );
    expect(sanitize(Array.from({ length: 10 }, (_, i) => i))).toHaveLength(10);
  });

  it('cuts deep nesting', () => {
    expect(sanitize({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({
      a: { b: { c: { d: '[…]' } } },
    });
  });
});
