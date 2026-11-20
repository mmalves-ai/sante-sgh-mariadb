// Arquivos da exportação dos relatórios do catálogo (M34; ficha, seção 7: grade, PDF, XLSX, CSV): o CSV no padrão
// das planilhas em português (ponto e vírgula, vírgula decimal, UTF-8 com BOM), a planilha XLSX mínima (Office Open
// XML, uma aba, células tipadas, sem macro nem fórmula: valor que começa com "=", "+", "-" ou "@" vai como texto) e o
// PDF/A pelo conversor do M09 (HTML autocontido, sem recurso externo). Todo arquivo leva o título, os parâmetros, quem
// emitiu e quando; a coluna de pessoa já chega mascarada quando a sessão não tem a permissão.
import { crc32 } from 'node:zlib';
import type { FormatoExportacao, RelatorioCatalogo } from '@sgh/contratos';
import type { LinhaRelatorio } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';

export type GeradorPdf = (html: string, titulo: string) => Promise<Uint8Array>;

export interface ConteudoExportacao {
  readonly relatorio: RelatorioCatalogo;
  readonly linhas: readonly LinhaRelatorio[];
  readonly totais: Readonly<Record<string, number>>;
  readonly parametros: Readonly<Record<string, string | number>>;
  readonly produto: string;
  readonly estabelecimento: string;
  readonly emitidoPor: string;
  readonly emitidoEm: Date;
  readonly pdf: GeradorPdf | null;
}

/** O que a planilha precisa (o título da aba, as colunas, as linhas e o total): serve também a outras telas (M54.3). */
export interface PlanilhaExportacao {
  readonly relatorio: Pick<RelatorioCatalogo, 'titulo' | 'colunas'>;
  readonly linhas: readonly LinhaRelatorio[];
  readonly totais: Readonly<Record<string, number>>;
}

const numeroBr = (v: number, casas: number | null) =>
  casas === null
    ? String(v).replace('.', ',')
    : v.toLocaleString('pt-BR', {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
        useGrouping: false,
      });

function textoDaCelula(v: unknown, tipo: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return numeroBr(v, tipo === 'dinheiro' ? 2 : tipo === 'percentual' ? 2 : null);
  return String(v);
}

/** Valor que uma planilha leria como fórmula vai protegido (injeção de fórmula em CSV). */
const semFormula = (t: string) => (/^[=+\-@\t\r]/.test(t) ? `'${t}` : t);

export function gerarCsv(c: Pick<ConteudoExportacao, 'relatorio' | 'linhas' | 'totais'>): string {
  const q = (t: string) => (/[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  const cols = c.relatorio.colunas;
  const linhas = [
    cols.map((x) => q(x.rotulo)).join(';'),
    ...c.linhas.map((l) => cols.map((x) => q(semFormula(textoDaCelula(l[x.campo], x.tipo)))).join(';')),
  ];
  if (Object.keys(c.totais).length)
    linhas.push(
      cols
        .map((x, i) =>
          i === 0 ? 'Total' : x.campo in c.totais ? q(textoDaCelula(c.totais[x.campo], x.tipo)) : '',
        )
        .join(';'),
    );
  return `\uFEFF${linhas.join('\r\n')}\r\n`;
}

const xml = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caracteres de controle não são válidos em XML 1.0.
    .replace(/[\p{Cc}]/gu, (c) => (c === '\t' || c === '\n' || c === '\r' ? c : ''));

function coluna(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function celula(ref: string, v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  if (v === null || v === undefined || v === '') return '';
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
}

/** Planilha da exportação: cabeçalho, linhas e o total (as colunas na ordem do relatório). */
export function folhaXlsx(c: PlanilhaExportacao): string {
  const cols = c.relatorio.colunas;
  const linhas: string[] = [];
  const linha = (n: number, valores: unknown[]) =>
    `<row r="${n}">${valores.map((v, i) => celula(`${coluna(i)}${n}`, v)).join('')}</row>`;
  linhas.push(
    linha(
      1,
      cols.map((x) => x.rotulo),
    ),
  );
  c.linhas.forEach((l, i) =>
    linhas.push(
      linha(
        i + 2,
        cols.map((x) => l[x.campo] ?? null),
      ),
    ),
  );
  if (Object.keys(c.totais).length)
    linhas.push(
      linha(
        c.linhas.length + 2,
        cols.map((x, i) => (i === 0 ? 'Total' : x.campo in c.totais ? c.totais[x.campo] : null)),
      ),
    );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${linhas.join('')}</sheetData></worksheet>`;
}

/** ZIP sem compressão (método 0), suficiente para o pacote Office Open XML. */
export function zipArmazenado(arquivos: readonly { nome: string; dados: Uint8Array }[]): Uint8Array {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const dados = Buffer.from(a.dados);
    const crc = crc32(dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    partes.push(local, nome, dados);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0x00210000, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(dados.length, 20);
    c.writeUInt32LE(dados.length, 24);
    c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(deslocamento, 42);
    central.push(c, nome);
    deslocamento += 30 + nome.length + dados.length;
  }
  const tamanhoCentral = central.reduce((a, b) => a + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return new Uint8Array(Buffer.concat([...partes, ...central, fim]));
}

export function gerarXlsx(c: PlanilhaExportacao): Uint8Array {
  const t = (s: string) => new TextEncoder().encode(s);
  const nomeAba = xml(c.relatorio.titulo.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zipArmazenado([
    {
      nome: '[Content_Types].xml',
      dados: t(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
    },
    {
      nome: '_rels/.rels',
      dados: t(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      nome: 'xl/workbook.xml',
      dados: t(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nomeAba}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      dados: t(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
    },
    { nome: 'xl/worksheets/sheet1.xml', dados: t(folhaXlsx(c)) },
  ]);
}

/** O HTML do PDF (autocontido: sem fonte, imagem nem script externos). */
export function htmlDoRelatorio(c: ConteudoExportacao): string {
  const cols = c.relatorio.colunas;
  const p = Object.entries(c.parametros)
    .map(([k, v]) => {
      const rot = c.relatorio.parametros.find((x) => x.campo === k)?.rotulo ?? k;
      return `${xml(rot)}: ${xml(String(v))}`;
    })
    .join(' · ');
  const corpo = c.linhas
    .map(
      (l) =>
        `<tr>${cols.map((x) => `<td class="${x.tipo === 'texto' ? '' : 'n'}">${xml(textoDaCelula(l[x.campo], x.tipo))}</td>`).join('')}</tr>`,
    )
    .join('');
  const total = Object.keys(c.totais).length
    ? `<tr class="t">${cols.map((x, i) => `<td class="${i ? 'n' : ''}">${i === 0 ? 'Total' : x.campo in c.totais ? xml(textoDaCelula(c.totais[x.campo], x.tipo)) : ''}</td>`).join('')}</tr>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${xml(c.relatorio.titulo)}</title>
<style>@page{size:A4 landscape;margin:12mm}body{font:10pt sans-serif;color:#111}h1{font-size:14pt;margin:0 0 4px}
p{margin:0 0 8px;color:#333}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px}
th{background:#eee;text-align:left}.n{text-align:right}.t td{font-weight:bold}</style></head><body>
<h1>${xml(c.relatorio.titulo)}</h1><p>${xml(c.produto)} · ${xml(c.estabelecimento)} · ${p}</p>
<p>Emitido por ${xml(c.emitidoPor)} em ${xml(c.emitidoEm.toISOString().slice(0, 16).replace('T', ' '))} · ${c.linhas.length} linha(s)</p>
<table><thead><tr>${cols.map((x) => `<th>${xml(x.rotulo)}</th>`).join('')}</tr></thead><tbody>${corpo}${total}</tbody></table>
</body></html>`;
}

export async function gerarArquivo(
  formato: FormatoExportacao,
  c: ConteudoExportacao,
): Promise<{ conteudo: Uint8Array; tipo: string }> {
  if (formato === 'csv')
    return { conteudo: new TextEncoder().encode(gerarCsv(c)), tipo: 'text/csv; charset=utf-8' };
  if (formato === 'xlsx')
    return {
      conteudo: gerarXlsx(c),
      tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  const indisponivel = () =>
    new ErroProblema(
      'indisponivel',
      503,
      'Conversor de PDF indisponível',
      'O PDF não pôde ser gerado agora: exporte em planilha ou CSV, ou tente de novo em instantes.',
    );
  if (!c.pdf) throw indisponivel();
  try {
    return { conteudo: await c.pdf(htmlDoRelatorio(c), c.relatorio.titulo), tipo: 'application/pdf' };
  } catch {
    throw indisponivel();
  }
}
