// W0-03, mercado M4: a foto da lesão vira um PDF de uma página. O anexo do prontuário é gravado em PDF (o formato que o
// prontuário guarda e mostra), então a tela reduz a foto (JPG ou PNG) num canvas, exporta em JPEG e a embute sem
// recompressão (filtro DCTDecode) numa página do tamanho da imagem. Nada sai do navegador além do anexo.

const texto = (s: string) => new TextEncoder().encode(s);

/** Monta o PDF de uma página com o JPEG (largura × altura em pixels; a página tem o mesmo tamanho em pontos). */
export function pdfDeJpeg(jpeg: Uint8Array, largura: number, altura: number): Uint8Array {
  if (jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff)
    throw new Error('A imagem não é JPEG.');
  const w = Math.max(1, Math.round(largura));
  const h = Math.max(1, Math.round(altura));
  const conteudo = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const por = (b: Uint8Array) => {
    partes.push(b);
    tamanho += b.length;
  };
  const objeto = (n: number, corpo: string, fluxo?: Uint8Array) => {
    offsets[n] = tamanho;
    if (!fluxo) {
      por(texto(`${n} 0 obj\n${corpo}\nendobj\n`));
      return;
    }
    por(texto(`${n} 0 obj\n${corpo}\nstream\n`));
    por(fluxo);
    por(texto('\nendstream\nendobj\n'));
  };
  por(texto('%PDF-1.4\n%âãÏÓ\n'));
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objeto(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  objeto(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  objeto(5, `<< /Length ${texto(conteudo).length} >>`, texto(conteudo));
  const xref = tamanho;
  por(
    texto(
      `xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5]
        .map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  const pdf = new Uint8Array(tamanho);
  let i = 0;
  for (const p of partes) {
    pdf.set(p, i);
    i += p.length;
  }
  return pdf;
}

/** Base64 de bytes (sem o prefixo `data:`). */
export function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Lado maior da foto no PDF (pixels): legível no prontuário e longe do teto do anexo. */
export const LADO_MAXIMO_FOTO = 2000;

/** A foto escolhida (JPG ou PNG) reduzida e embutida no PDF de uma página, em base64. Só no navegador. */
export async function fotoEmPdf(arquivo: Blob): Promise<string> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * escala));
  const h = Math.max(1, Math.round(img.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('O navegador não converteu a foto.');
  // Fundo branco da imagem (PNG transparente vira JPEG): dado da foto, não cor de tela.
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  const jpeg = await new Promise<Blob>((ok, falha) =>
    canvas.toBlob(
      (b) => (b ? ok(b) : falha(new Error('O navegador não converteu a foto.'))),
      'image/jpeg',
      0.85,
    ),
  );
  return base64(pdfDeJpeg(new Uint8Array(await jpeg.arrayBuffer()), w, h));
}
