// QR de validação do documento (cap-09 §9.8): leva só o endereço público com o identificador do documento;
// a página pública mostra existência, data, estabelecimento e hash, nunca conteúdo clínico.
import qrcode from 'qrcode-generator';

/** URL de validação: domínio-base por parâmetro (DP-49), só o identificador opaco do documento. */
export function urlValidacao(baseUrl: string, identificadorQr: string): string {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(identificadorQr)) throw new Error('Identificador do QR inválido.');
  return `${baseUrl.replace(/\/+$/, '')}/api/publico/documentos/${identificadorQr}/validacao`;
}

/** QR em SVG (preto sobre branco, sem dependência externa), para embutir no HTML do PDF/A. */
export function qrSvg(texto: string, modulo = 4, margem = 4): string {
  const qr = qrcode(0, 'M');
  qr.addData(texto, 'Byte');
  qr.make();
  const n = (qr as unknown as { getModuleCount(): number }).getModuleCount();
  const escuro = (l: number, c: number) =>
    (qr as unknown as { isDark(l: number, c: number): boolean }).isDark(l, c);
  const lado = (n + margem * 2) * modulo;
  let caminho = '';
  for (let l = 0; l < n; l++) {
    for (let c = 0; c < n; c++) {
      if (escuro(l, c))
        caminho += `M${(c + margem) * modulo},${(l + margem) * modulo}h${modulo}v${modulo}h-${modulo}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}" role="img" aria-label="QR de validação">` +
    `<rect width="${lado}" height="${lado}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`
  );
}
