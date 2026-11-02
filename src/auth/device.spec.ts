import { describeDevice } from './device';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  operaMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  firefoxLinux:
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  firefoxIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  edgeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
};

describe('describeDevice', () => {
  it.each([
    [UA.chromeWindows, 'Chrome on Windows'],
    [UA.edgeWindows, 'Edge on Windows'],
    [UA.operaMac, 'Opera on macOS'],
    [UA.firefoxLinux, 'Firefox on Linux'],
    [UA.safariMac, 'Safari on macOS'],
    [UA.safariIphone, 'Safari on iOS'],
    [UA.chromeAndroid, 'Chrome on Android'],
    ['curl/8.4.0', 'API client'],
    ['PostmanRuntime/7.39.0', 'API client'],
    ['SomethingElse/1.0', 'Browser'],
  ])('%s → %s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it('says so when there is no User-Agent', () => {
    expect(describeDevice(undefined)).toBe('Unknown device');
    expect(describeDevice('')).toBe('Unknown device');
  });

  // BUG-101: Chrome, Firefox and Edge on phones are listed as another browser
  it.each([
    [UA.chromeIphone, 'Chrome on iOS'],
    [UA.firefoxIphone, 'Firefox on iOS'],
    [UA.edgeAndroid, 'Edge on Android'],
  ])('%s → %s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });
});
