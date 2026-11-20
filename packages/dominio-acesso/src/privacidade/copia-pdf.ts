// W0-10 (M2): o PDF da cópia do prontuário com marca d'água em todas as páginas. Gerador puro e mínimo (PDF 1.4,
// Helvetica com WinAnsiEncoding, A4), sem serviço externo: a mesma entrada dá os mesmos bytes (o hash da geração vai
// para a trilha). A marca é diagonal, cinza-clara, e repete no rodapé; o caractere fora do Latin-1 vira '?'.

export interface SecaoCopia {
  readonly titulo: string;
  readonly linhas: readonly string[];
}

export interface EntradaPdfCopia {
  readonly titulo: string;
  readonly secoes: readonly SecaoCopia[];
  readonly marca: string;
}

const LARGURA = 595;
const ALTURA = 842;
const MARGEM = 50;
const ENTRELINHA = 13;
const CORPO = 10;
const MAX_COLUNAS = 95;
// Todo texto passa por literal() (só Latin-1): o comprimento em caracteres é o comprimento em bytes.

/** Texto para dentro de ( ) no PDF: Latin-1, com \ ( ) escapados. */
function literal(t: string): string {
  let r = '';
  for (const ch of t) {
    const c = ch.codePointAt(0) ?? 63;
    const b = c === 0x2014 || c === 0x2013 ? '-' : c === 0xb7 || c < 256 ? ch : '?';
    r += b === '\\' || b === '(' || b === ')' ? `\\${b}` : b;
  }
  return r;
}

/** Quebra a linha em pedaços de até MAX_COLUNAS, nos espaços quando houver. */
function quebrar(linha: string): string[] {
  const r: string[] = [];
  let resto = linha;
  while (resto.length > MAX_COLUNAS) {
    const corte = resto.lastIndexOf(' ', MAX_COLUNAS);
    const i = corte > 20 ? corte : MAX_COLUNAS;
    r.push(resto.slice(0, i));
    resto = resto.slice(i).trimStart();
  }
  r.push(resto);
  return r;
}

type Linha = { readonly texto: string; readonly negrito: boolean };

function paginar(e: EntradaPdfCopia): Linha[][] {
  const cabem = Math.floor((ALTURA - 2 * MARGEM - 40) / ENTRELINHA);
  const todas: Linha[] = [
    { texto: e.titulo, negrito: true },
    { texto: '', negrito: false },
  ];
  for (const s of e.secoes) {
    todas.push({ texto: s.titulo, negrito: true });
    for (const l of s.linhas) for (const q of quebrar(l)) todas.push({ texto: q, negrito: false });
    todas.push({ texto: '', negrito: false });
  }
  const paginas: Linha[][] = [];
  for (let i = 0; i < todas.length; i += cabem) paginas.push(todas.slice(i, i + cabem));
  return paginas.length > 0 ? paginas : [[]];
}

function conteudoDaPagina(linhas: readonly Linha[], marca: string, n: number, total: number): string {
  const partes: string[] = [];
  // A marca d'água: diagonal (45°), cinza-clara, por baixo do texto.
  partes.push(`q 0.85 g BT /F1 22 Tf 0.7071 0.7071 -0.7071 0.7071 110 220 Tm (${literal(marca)}) Tj ET Q`);
  let y = ALTURA - MARGEM;
  for (const l of linhas) {
    if (l.texto !== '')
      partes.push(`BT /${l.negrito ? 'F2' : 'F1'} ${CORPO} Tf ${MARGEM} ${y} Td (${literal(l.texto)}) Tj ET`);
    y -= ENTRELINHA;
  }
  partes.push(`BT /F1 8 Tf ${MARGEM} 30 Td (${literal(`${marca} - página ${n} de ${total}`)}) Tj ET`);
  return partes.join('\n');
}

/** Gera o PDF; devolve os bytes e o número de páginas. */
export function gerarPdfCopia(e: EntradaPdfCopia): { readonly pdf: Uint8Array; readonly paginas: number } {
  const paginas = paginar(e);
  const objetos: string[] = [];
  // 1 catálogo, 2 páginas, 3 e 4 fontes; depois, por página: a página e o conteúdo.
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = paginas.map((_, i) => `${5 + 2 * i} 0 R`).join(' ');
  objetos[2] = `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  paginas.forEach((linhas, i) => {
    const conteudo = conteudoDaPagina(linhas, e.marca, i + 1, paginas.length);
    const bytes = conteudo.length;
    objetos[5 + 2 * i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`;
    objetos[6 + 2 * i] = `<< /Length ${bytes} >>\nstream\n${conteudo}\nendstream`;
  });
  let saida = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const deslocamentos: number[] = [];
  for (let n = 1; n < objetos.length; n++) {
    deslocamentos[n] = saida.length;
    saida += `${n} 0 obj\n${objetos[n]}\nendobj\n`;
  }
  const xref = saida.length;
  saida += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objetos.length; n++)
    saida += `${String(deslocamentos[n]).padStart(10, '0')} 00000 n \n`;
  saida += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { pdf: Uint8Array.from(saida, (c) => c.charCodeAt(0) & 0xff), paginas: paginas.length };
}
