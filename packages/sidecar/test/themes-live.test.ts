// Live check of the Fontsource API shapes the font catalog relies on. Skipped unless
// SAGE_LIVE_FONTS=1 (the other tests use a recorded slice: tests/themes/fontsource-catalog.json).
import { describe, expect, it } from 'vitest';
import { FontCatalog } from '../src/themes/fonts.ts';
import { tempDir } from './theme-helpers.ts';

describe.skipIf(!process.env.SAGE_LIVE_FONTS)('Fontsource, live', () => {
  it('serves the catalog and a woff2 file at the URLs the catalog uses', async () => {
    const cat = new FontCatalog({ cacheDir: tempDir('sage-fonts-live-') });
    const { fonts, source } = await cat.list();
    expect(source).toBe('network');
    expect(fonts.length).toBeGreaterThan(1500);
    const inter = fonts.find((f) => f.id === 'inter')!;
    expect(inter).toMatchObject({ family: 'Inter', category: 'sans-serif', license: 'OFL-1.1' });
    expect(inter.weights).toContain(400);
    const buf = await cat.file('inter', 'latin', 400, 'normal');
    expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(buf.length).toBeGreaterThan(10_000);
  }, 60_000);
});
