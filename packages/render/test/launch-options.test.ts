// Which browser the renderer launches: Playwright's Chromium unless the environment says otherwise.
import { describe, expect, it } from 'vitest';
import { browserLaunchOptions } from '../src/index.ts';

describe('browserLaunchOptions', () => {
  it("defaults to Playwright's own Chromium", () => {
    expect(browserLaunchOptions({})).toEqual({});
  });
  it('takes a channel or an executable from the environment; the executable wins', () => {
    expect(browserLaunchOptions({ SAGE_RENDER_CHANNEL: 'chrome' })).toEqual({ channel: 'chrome' });
    expect(browserLaunchOptions({ SAGE_RENDER_EXECUTABLE: '/x/chrome' })).toEqual({ executablePath: '/x/chrome' });
    expect(browserLaunchOptions({ SAGE_RENDER_CHANNEL: 'chrome', SAGE_RENDER_EXECUTABLE: '/x/chrome' })).toEqual({ executablePath: '/x/chrome' });
  });
});
