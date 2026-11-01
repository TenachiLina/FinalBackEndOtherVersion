import { AppLogger } from './app-logger';
import { type ErrorReport, setErrorWriter } from './error-reporter';

let reports: ErrorReport[];
beforeEach(() => {
  reports = [];
  setErrorWriter(async (r) => {
    reports.push(r);
  });
  // The console output itself isn't under test
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

const STACK =
  'Error: boom\n    at Sync.run (src/zkteco/zkteco.service.ts:40:9)';

describe('AppLogger', () => {
  it('saves logger.error(message, stack, context) as a background error', () => {
    new AppLogger().error('Sync failed', STACK, 'ZktecoService');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      level: 'error',
      source: 'background',
      context: 'ZktecoService',
      name: 'ZktecoService error',
      message: 'Sync failed',
      stack: STACK,
    });
  });

  it('understands (message, stack) and (message, context)', () => {
    const logger = new AppLogger();
    logger.error('With stack', STACK);
    logger.error('With context', 'PlanningService');
    expect(reports[0]).toMatchObject({
      message: 'With stack',
      stack: STACK,
      name: 'Error',
    });
    expect(reports[1]).toMatchObject({
      message: 'With context',
      context: 'PlanningService',
      stack: undefined,
    });
  });

  it("uses the logger's own context when none is given", () => {
    new AppLogger('AttendanceService').error('Lost connection');
    expect(reports[0]).toMatchObject({
      context: 'AttendanceService',
      name: 'AttendanceService error',
    });
  });

  it('keeps an Error object as it is', () => {
    const err = new RangeError('Out of range');
    new AppLogger().error(err);
    expect(reports[0]).toMatchObject({
      name: 'RangeError',
      message: 'Out of range',
    });
  });

  it("doesn't save errors that are reported elsewhere (or would loop)", () => {
    const logger = new AppLogger();
    logger.error('x', undefined, 'Errors');
    logger.error('x', 'Process');
    new AppLogger('ErrorLogService').error('Could not save');
    expect(reports).toHaveLength(0);
  });
});
