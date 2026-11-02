// qr.ts — talk.qr: QR codes for the paper, the slides and the replication package as SVG files
// in the talk's assets/ (publishing.md: shown as .qrtile rows on the summary pane and the end
// card). Generated with the `qrcode` package (pure JS), margin 0 and error correction M, as the
// skill's recipe does; written as app writes so the watcher reports them with source 'app'.
import QRCode from 'qrcode';
import { QR_NAMES, type QrParams, type QrResult } from '../protocol.ts';

export const qrFile = (name: (typeof QR_NAMES)[number]) => `assets/qr-${name}.svg`;

export async function qrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  return svg.endsWith('\n') ? svg : svg + '\n';
}

export async function writeQrCodes(p: QrParams, write: (rel: string, content: string) => void): Promise<QrResult> {
  const files: string[] = [];
  for (const name of QR_NAMES) {
    const url = p[name];
    if (!url) continue;
    write(qrFile(name), await qrSvg(url));
    files.push(qrFile(name));
  }
  return { files };
}
