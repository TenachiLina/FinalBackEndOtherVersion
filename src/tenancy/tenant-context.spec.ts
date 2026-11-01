import {
  currentCompanyId,
  isSystemContext,
  runAsSystem,
  runForCompany,
  setCurrentCompany,
  tenantContextMiddleware,
} from './tenant-context';

describe('tenant context', () => {
  it('knows no company outside a request', () => {
    expect(currentCompanyId()).toBeNull();
    expect(isSystemContext()).toBe(false);
  });

  it('refuses to set a company outside a request', () => {
    expect(() => setCurrentCompany('c1')).toThrow(/tenantContextMiddleware/);
  });

  it('gives each request its own slot, starting empty', (done) => {
    tenantContextMiddleware(null, null, () => {
      expect(currentCompanyId()).toBeNull();
      setCurrentCompany('c1');
      expect(currentCompanyId()).toBe('c1');
      tenantContextMiddleware(null, null, () => {
        // A second request doesn't see the first one's company
        expect(currentCompanyId()).toBeNull();
        done();
      });
    });
  });

  it('keeps the company across awaits', async () => {
    await runForCompany('c2', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentCompanyId()).toBe('c2');
      expect(isSystemContext()).toBe(false);
    });
    expect(currentCompanyId()).toBeNull();
  });

  it('runs trusted code without a company', () => {
    const seen = runAsSystem(() => [currentCompanyId(), isSystemContext()]);
    expect(seen).toEqual([null, true]);
    expect(isSystemContext()).toBe(false);
  });
});
