import { clientInfo } from './client-info';

describe('clientInfo', () => {
  it('reads the IP and User-Agent', () => {
    expect(
      clientInfo({ ip: '203.0.113.5', headers: { 'user-agent': 'Chrome' } }),
    ).toEqual({
      ip: '203.0.113.5',
      userAgent: 'Chrome',
    });
  });

  it('shows IPv4 addresses without the IPv6 prefix', () => {
    expect(clientInfo({ ip: '::ffff:203.0.113.5' }).ip).toBe('203.0.113.5');
    expect(clientInfo({ ip: '2001:db8::1' }).ip).toBe('2001:db8::1');
  });

  it('keeps at most 300 characters of User-Agent', () => {
    expect(
      clientInfo({ headers: { 'user-agent': 'x'.repeat(1000) } }).userAgent,
    ).toHaveLength(300);
  });

  it('copes with missing or odd values', () => {
    expect(clientInfo(undefined)).toEqual({
      ip: undefined,
      userAgent: undefined,
    });
    expect(
      clientInfo({ ip: 5, headers: { 'user-agent': ['a', 'b'] } }),
    ).toEqual({
      ip: undefined,
      userAgent: undefined,
    });
  });
});
