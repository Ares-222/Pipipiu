// №13 QR: обёртка над qrcode-generator (MIT, vendored via npm).
// Возвращает булеву матрицу модулей — рендерим сами (SVG в UI, прямоугольники в PDF),
// чтобы адрес не утекал во внешние QR-сервисы.
import qrcode from 'qrcode-generator';

export function qrMatrix(text: string): { size: number; dark: boolean[][] } | null {
  try {
    const q = (qrcode as unknown as { default?: typeof qrcode }).default ?? qrcode;
    const qr = q(0, 'M');
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    const dark: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
      dark.push(row);
    }
    return { size, dark };
  } catch {
    return null;
  }
}
