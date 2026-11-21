// M60, etapa 3 (entrega 5): o manual de implantação. Regras puras para (a) conferir que o manual tem as 12 seções da
// ficha, as subseções que os testes pós-implantação citam (SE_FALHAR), todo item de `implantacao:verificar`, toda
// variável obrigatória do anexo e os dois anexos; e (b) montar o HTML do PDF (manual + anexos) a partir do Markdown,
// num conversor mínimo do subconjunto que o manual usa (títulos, parágrafos, listas, tabelas, blocos de código,
// código, negrito e links). Nada aqui lê disco nem rede: a CLI (gerar-manual.ts) junta os arquivos.
import { createHash } from 'node:crypto';

/** As 12 seções mínimas da ficha (M60 §4, entrega 5), na ordem; cada uma tem de existir como "## N. <título>". */
export const SECOES_MANUAL: readonly { numero: number; palavra: RegExp; nome: string }[] = [
  { numero: 1, palavra: /vis[aã]o geral/i, nome: 'visão geral e arquitetura' },
  { numero: 2, palavra: /requisitos/i, nome: 'requisitos' },
  { numero: 3, palavra: /prepara[cç][aã]o/i, nome: 'preparação do servidor Ubuntu' },
  { numero: 4, palavra: /instala[cç][aã]o/i, nome: 'instalação passo a passo' },
  { numero: 5, palavra: /configura[cç][aã]o/i, nome: 'configuração' },
  { numero: 6, palavra: /conex[aã]o/i, nome: 'conexão ao banco e conferência' },
  { numero: 7, palavra: /migra[cç][aã]o/i, nome: 'migração' },
  { numero: 8, palavra: /testes/i, nome: 'testes pós-implantação' },
  { numero: 9, palavra: /libera[cç][aã]o/i, nome: 'liberação por onda' },
  { numero: 10, palavra: /opera[cç][aã]o/i, nome: 'operação' },
  { numero: 11, palavra: /problemas/i, nome: 'solução de problemas' },
  { numero: 12, palavra: /lista de verifica[cç][aã]o/i, nome: 'lista de verificação' },
];

export const ANEXOS_MANUAL = [
  'anexos/scripts-sgh.md',
  'anexos/variaveis.md',
  // M60.3: o SQL dos privilégios do papel_aplicacao (seção 7.4); no PDF, como bloco de código. Dois anexos: o do
  // banco de cada cliente e o do banco da plataforma, ambos executados antes de dar o papel à conta da aplicação.
  'anexos/privilegios-papel.sql',
  'anexos/privilegios-plataforma.sql',
] as const;

/** Momentos da lista de verificação imprimível (seção 12), cada um com responsável e assinatura. */
export const MOMENTOS_LISTA = ['Antes', 'Durante', 'Depois'] as const;

/** Palavras que não entram no manual (ADR 0023 e regra do manual: nada de nome de sistema antigo). */
const PROIBIDAS = [/\bspdata\b/i, /\blegado\b/i];

export interface EntradaConferencia {
  readonly manual: string;
  /** Código do item de `implantacao:verificar` → o texto "Manual §x.y: ..." do que fazer se falhar. */
  readonly seFalhar: Readonly<Record<string, string>>;
  /** O anexo de variáveis gerado (de onde saem as obrigatórias). */
  readonly anexoVariaveis: string;
}

/** Títulos "## " e "### " do Markdown, sem o marcador. */
export function titulos(md: string): { nivel: number; texto: string }[] {
  const r: { nivel: number; texto: string }[] = [];
  let dentroDeCodigo = false;
  for (const l of md.split('\n')) {
    if (l.startsWith('```')) dentroDeCodigo = !dentroDeCodigo;
    if (dentroDeCodigo) continue;
    const m = /^(#{1,6}) (.+)$/.exec(l);
    if (m) r.push({ nivel: m[1]!.length, texto: m[2]!.trim() });
  }
  return r;
}

/** As referências "§N" e "§N.M" de um texto. */
export function referencias(texto: string): string[] {
  return [...texto.matchAll(/§(\d+(?:\.\d+)?)/g)].map((m) => m[1]!);
}

/** Variáveis obrigatórias do anexo (linhas "| `X` | obrigatoria |"); as da série por estabelecimento vêm como campo. */
export function obrigatoriasDoAnexo(anexo: string): { variaveis: string[]; camposEstabelecimento: string[] } {
  const variaveis: string[] = [];
  const campos: string[] = [];
  let naSerie = false;
  for (const l of anexo.split('\n')) {
    if (/^#{2,3} /.test(l)) naSerie = /FB_<C[ÓO]DIGO>/.test(l);
    const m = /^\| `([A-Z0-9_]+)` \| obrigatoria \|/.exec(l);
    if (m) (naSerie ? campos : variaveis).push(m[1]!);
  }
  return { variaveis, camposEstabelecimento: campos };
}

/** Os achados da conferência do manual (vazio = em ordem). */
export function conferirManual(e: EntradaConferencia): string[] {
  const achados: string[] = [];
  const ts = titulos(e.manual);
  const secoes = new Map<number, string>();
  const subsecoes = new Set<string>();
  for (const t of ts) {
    const m = /^(\d+)\. (.+)$/.exec(t.texto);
    if (t.nivel === 2 && m) secoes.set(Number(m[1]), m[2]!);
    const s = /^(\d+\.\d+) /.exec(t.texto);
    if (t.nivel === 3 && s) subsecoes.add(s[1]!);
  }
  for (const s of SECOES_MANUAL) {
    const titulo = secoes.get(s.numero);
    if (!titulo) achados.push(`falta a seção ${s.numero} (${s.nome}) como "## ${s.numero}. ..."`);
    else if (!s.palavra.test(titulo)) achados.push(`a seção ${s.numero} ("${titulo}") não é a de ${s.nome}`);
  }
  // As referências dos testes pós-implantação apontam para seções e subseções que existem.
  for (const [codigo, texto] of Object.entries(e.seFalhar)) {
    const refs = referencias(texto);
    if (refs.length === 0) achados.push(`o "se falhar" de ${codigo} não cita seção do manual`);
    for (const r of refs) {
      const existe = r.includes('.') ? subsecoes.has(r) : secoes.has(Number(r));
      if (!existe) achados.push(`o "se falhar" de ${codigo} cita §${r}, que não existe no manual`);
    }
    if (!e.manual.includes(`\`${codigo}\``)) achados.push(`o item ${codigo} não aparece na seção 8`);
  }
  const { variaveis, camposEstabelecimento } = obrigatoriasDoAnexo(e.anexoVariaveis);
  if (variaveis.length === 0)
    achados.push('o anexo de variáveis não tem nenhuma obrigatória (anexo ilegível?)');
  for (const v of variaveis)
    if (!e.manual.includes(`\`${v}`)) achados.push(`a variável obrigatória ${v} não é explicada no manual`);
  for (const c of camposEstabelecimento)
    if (!e.manual.includes(`\`${c}\``) && !e.manual.includes(`_${c}\``))
      achados.push(`o campo obrigatório FB_<CÓDIGO>_${c} não é explicado no manual`);
  for (const a of ANEXOS_MANUAL)
    if (!e.manual.includes(`(${a})`)) achados.push(`o manual não liga o anexo ${a}`);
  const lista = e.manual.slice(e.manual.search(/^## 12\. /m));
  for (const m of MOMENTOS_LISTA)
    if (!new RegExp(`^### ${m}$`, 'm').test(lista)) achados.push(`a lista de verificação não tem "${m}"`);
  if (!/assinatura/i.test(lista)) achados.push('a lista de verificação não tem espaço para assinatura');
  if (!/backup/i.test(lista) || !/restaurad/i.test(lista))
    achados.push('a lista de verificação não exige o backup verificado (restaurado) antes da migração');
  for (const p of PROIBIDAS) if (p.test(e.manual)) achados.push(`o manual usa termo proibido (${p.source})`);
  return achados;
}

/** Impressão das fontes do PDF (manual e anexos, na ordem): o PDF só está em dia se foi gerado destas fontes. */
export function impressaoDasFontes(textos: readonly string[]): string {
  const h = createHash('sha256');
  for (const t of textos) h.update(createHash('sha256').update(t).digest('hex'));
  return h.digest('hex');
}

const escapar = (t: string) =>
  t.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Código, negrito e links de uma linha (o texto já vem escapado fora do código). */
export function emLinha(t: string): string {
  const partes = t.split(/(`[^`]*`)/);
  return partes
    .map((p) => {
      if (p.startsWith('`') && p.endsWith('`') && p.length >= 2)
        return `<code>${escapar(p.slice(1, -1))}</code>`;
      return escapar(p)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt: string, url: string) =>
          // No PDF os anexos vêm na sequência: o link vira âncora interna.
          /\.(md|sql)$/.test(url) ? `<a href="#${ancora(url)}">${txt}</a>` : `<a href="${url}">${txt}</a>`,
        );
    })
    .join('');
}

export const ancora = (arquivo: string) =>
  arquivo
    .replace(/^.*\//, '')
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9-]/gi, '-');

const celulas = (l: string) =>
  l
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Markdown (subconjunto do manual e dos anexos) para HTML. Comentários HTML somem. */
export function markdownParaHtml(md: string): string {
  const linhas = md.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i]!;
    if (l.startsWith('```')) {
      const bloco: string[] = [];
      i += 1;
      while (i < linhas.length && !linhas[i]!.startsWith('```')) bloco.push(linhas[i++]!);
      i += 1;
      out.push(`<pre><code>${escapar(bloco.join('\n'))}</code></pre>`);
      continue;
    }
    const t = /^(#{1,6}) (.+)$/.exec(l);
    if (t) {
      const n = t[1]!.length;
      const id = /^(\d+(?:\.\d+)?)[. ]/.exec(t[2]!)?.[1];
      out.push(`<h${n}${id ? ` id="s${id}"` : ''}>${emLinha(t[2]!)}</h${n}>`);
      i += 1;
      continue;
    }
    if (l.startsWith('|') && linhas[i + 1]?.startsWith('|') && /^\|[\s:|-]+\|$/.test(linhas[i + 1]!.trim())) {
      const cab = celulas(l);
      const alin = celulas(linhas[i + 1]!).map((c) => (c.endsWith(':') ? ' class="num"' : ''));
      i += 2;
      const corpo: string[][] = [];
      while (i < linhas.length && linhas[i]!.startsWith('|')) corpo.push(celulas(linhas[i++]!));
      out.push(
        '<table><thead><tr>' +
          cab.map((c, k) => `<th${alin[k] ?? ''}>${emLinha(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          corpo
            .map((r) => '<tr>' + r.map((c, k) => `<td${alin[k] ?? ''}>${emLinha(c)}</td>`).join('') + '</tr>')
            .join('') +
          '</tbody></table>',
      );
      continue;
    }
    if (/^\s*(-|\d+\.) /.test(l)) {
      const ordenada = /^\s*\d+\. /.test(l);
      const itens: string[] = [];
      while (i < linhas.length && (/^\s*(-|\d+\.) /.test(linhas[i]!) || /^ {2,}\S/.test(linhas[i]!))) {
        const x = linhas[i]!;
        if (/^\s*(-|\d+\.) /.test(x) && !/^ {3,}/.test(x)) itens.push(x.replace(/^\s*(-|\d+\.) /, ''));
        else itens[itens.length - 1] += ' ' + x.trim().replace(/^(-|\d+\.) /, '');
        i += 1;
      }
      const tag = ordenada ? 'ol' : 'ul';
      out.push(`<${tag}>${itens.map((x) => `<li>${emLinha(x)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (l.trim() === '') {
      i += 1;
      continue;
    }
    const par: string[] = [];
    while (
      i < linhas.length &&
      linhas[i]!.trim() !== '' &&
      !/^(#{1,6} |```|\||\s*(-|\d+\.) )/.test(linhas[i]!)
    )
      par.push(linhas[i++]!.trim());
    out.push(`<p>${emLinha(par.join(' '))}</p>`);
  }
  return out.join('\n');
}

const ESTILO = `
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 10pt; line-height: 1.4; color: #111; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 14pt; margin: 16pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 2pt; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
pre { background: #f3f3f3; border: 1px solid #ddd; padding: 6pt; font-size: 7.5pt; white-space: pre; overflow: hidden; break-inside: avoid; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 8.5pt; }
th, td { border: 1px solid #bbb; padding: 3pt 4pt; text-align: left; vertical-align: top; }
td.num, th.num { text-align: right; }
tr { break-inside: avoid; }
#s12 { break-before: page; }
#s12 ~ table td { height: 18pt; }
#s12 ~ table th:nth-last-child(-n+2), #s12 ~ table td:nth-last-child(-n+2) { width: 21%; }
#s12 ~ table th:first-child, #s12 ~ table td:first-child { width: 4%; }
.anexo { break-before: page; }
.anexo td code { word-break: break-all; }
`;

/** Anexo SQL no PDF: o título do primeiro comentário e o arquivo inteiro num bloco de código. */
export function anexoSqlEmMarkdown(sql: string): string {
  const titulo = /^--\s*(Anexo[^\n]*?)\.?$/m.exec(sql)?.[1] ?? 'Anexo';
  return `# ${titulo.replace(/^Anexo:/, 'Anexo C:')}\n\n\`\`\`\n${sql.trimEnd()}\n\`\`\`\n`;
}

/** O HTML do PDF: o manual e, cada um numa página nova, os anexos. */
export function htmlDoManual(manual: string, anexos: readonly { arquivo: string; texto: string }[]): string {
  return [
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual de implantação</title>',
    `<style>${ESTILO}</style></head><body>`,
    markdownParaHtml(manual),
    ...anexos.map(
      (a) =>
        `<section class="anexo" id="${ancora(a.arquivo)}">${markdownParaHtml(a.arquivo.endsWith('.sql') ? anexoSqlEmMarkdown(a.texto) : a.texto)}</section>`,
    ),
    '</body></html>',
  ].join('\n');
}
