// Exportação das demonstrações contábeis (M54-F3; ficha, seção 7: "específica (PDF/A, XLSX)"; seção 10: "balancete,
// DRE ... em PDF/A"): o balancete, o diário, a DRE e o balanço já calculados pelo serviço viram uma tabela única
// (colunas, linhas, total e a conferência impressa) que sai em PDF/A, pelo conversor do M09 (HTML autocontido, sem
// recurso externo), ou em planilha XLSX (a do M34). Valores em reais com duas casas; no balancete, o saldo vem com o
// sinal devedor (negativo = credor), como na tela, e a legenda diz isso. Toda conta agregada vai com as parcelas (regra
// 5): a conferência sai no rodapé do PDF e nas últimas linhas da planilha.
import type { Balancete, Balanco, ColunaRelatorio, Diario, Dre, TipoDemonstracao } from '@sgh/contratos';
import { TIPOS_DEMONSTRACAO } from '@sgh/contratos';
import type { LinhaRelatorio } from '@sgh/legado';
import { reaisBr } from '@sgh/dominio-contabil';
import { gerarXlsx } from '../relatorio/public-api.js';

export const FORMATOS_EXPORTACAO_DEMONSTRACAO = ['pdf', 'xlsx'] as const;
export type FormatoExportacaoDemonstracao = (typeof FORMATOS_EXPORTACAO_DEMONSTRACAO)[number];

/** O diário exportado sai inteiro ou não sai (as páginas do servidor somadas até este teto de lançamentos). */
export const TETO_LANCAMENTOS_EXPORTACAO_DIARIO = 5_000;

export interface TabelaDemonstracao {
  readonly tipo: TipoDemonstracao;
  readonly titulo: string;
  /** Empresa e período, numa linha. */
  readonly subtitulo: string;
  readonly legenda: string | null;
  readonly colunas: readonly ColunaRelatorio[];
  readonly linhas: readonly LinhaRelatorio[];
  /** Linhas de destaque (totais de grupo), pelo índice. */
  readonly destaques: ReadonlySet<number>;
  readonly totais: Readonly<Record<string, number>>;
  readonly conferencia: readonly string[];
  /** O nome do arquivo sem a extensão. */
  readonly arquivo: string;
}

export type DadoDemonstracao =
  | { readonly tipo: 'balancete'; readonly dado: Balancete }
  | { readonly tipo: 'diario'; readonly dado: Diario }
  | { readonly tipo: 'dre'; readonly dado: Dre }
  | { readonly tipo: 'balanco'; readonly dado: Balanco };

const col = (campo: string, rotulo: string, tipo: ColunaRelatorio['tipo']): ColunaRelatorio => ({
  campo,
  rotulo,
  tipo,
  classe: 'comum',
});
/** Centavos inteiros em reais (número da planilha, sem erro de arredondamento na divisão por 100). */
const r$ = (c: number) => Math.round(c) / 100;
const competenciaBr = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function balancete(b: Balancete): TabelaDemonstracao {
  const linhas = b.linhas.map((l) => ({
    codigo: l.codigo,
    nome: `${'  '.repeat(Math.max(0, l.nivel - 1))}${l.nome}${l.foraDoPlano ? ' (fora do plano)' : ''}`,
    tipo: l.tipo === 'sintetica' ? 'S' : 'A',
    saldoAnterior: r$(l.saldoAnteriorCentavos),
    debitos: r$(l.debitosCentavos),
    creditos: r$(l.creditosCentavos),
    saldoFinal: r$(l.saldoFinalCentavos),
  }));
  const t = b.totais;
  const destaques = new Set(b.linhas.flatMap((l, i) => (l.tipo === 'sintetica' ? [i] : [])));
  return {
    tipo: 'balancete',
    titulo: TIPOS_DEMONSTRACAO.balancete,
    subtitulo: `Empresa ${b.empresa} · ${competenciaBr(b.de)} a ${competenciaBr(b.ate)}${b.nivel ? ` · até o nível ${b.nivel}` : ''}${b.centroCusto ? ` · centro de custo ${b.centroCusto}` : ''}`,
    legenda:
      'Saldos com o sinal devedor: positivo = saldo devedor; negativo = saldo credor. S = conta sintética (agrega); A = analítica. O total soma só as analíticas.',
    colunas: [
      col('codigo', 'Conta', 'texto'),
      col('nome', 'Nome', 'texto'),
      col('tipo', 'S/A', 'texto'),
      col('saldoAnterior', 'Saldo anterior', 'dinheiro'),
      col('debitos', 'Débitos', 'dinheiro'),
      col('creditos', 'Créditos', 'dinheiro'),
      col('saldoFinal', 'Saldo final', 'dinheiro'),
    ],
    linhas,
    destaques,
    totais: {
      saldoAnterior: r$(t.saldoAnteriorDevedorCentavos - t.saldoAnteriorCredorCentavos),
      debitos: r$(t.debitosCentavos),
      creditos: r$(t.creditosCentavos),
      saldoFinal: r$(t.saldoFinalDevedorCentavos - t.saldoFinalCredorCentavos),
    },
    conferencia: [
      ...b.conferencia,
      b.equilibrado === null
        ? 'Com o filtro de centro de custo, as partidas não fecham sozinhas: sem a conferência do equilíbrio.'
        : b.equilibrado
          ? 'Equilibrado.'
          : 'DESEQUILIBRADO: confira os lançamentos do período.',
      ...(b.competenciasAbertas.length
        ? [
            `Competências ainda abertas (podem mudar): ${b.competenciasAbertas.map(competenciaBr).join(', ')}.`,
          ]
        : []),
    ],
    arquivo: `balancete-${b.empresa}-${b.de}-a-${b.ate}`,
  };
}

function diario(d: Diario): TabelaDemonstracao {
  const linhas: LinhaRelatorio[] = [];
  const destaques = new Set<number>();
  for (const l of d.lancamentos) {
    destaques.add(linhas.length);
    linhas.push({
      data: dataBr(l.data),
      lancamento: l.id,
      conta: '',
      nome: `${l.tipoRotulo}: ${l.historico}${l.estornaId ? ` (estorna o ${l.estornaId})` : ''}`,
      centro: null,
      debito: r$(l.debitosCentavos),
      credito: r$(l.creditosCentavos),
    });
    for (const p of l.partidas)
      linhas.push({
        data: '',
        lancamento: null,
        conta: p.conta,
        nome: `${p.contaNome}${p.historico && p.historico !== l.historico ? ` · ${p.historico}` : ''}`,
        centro: p.centroCusto,
        debito: p.lado === 'D' ? r$(p.valorCentavos) : null,
        credito: p.lado === 'C' ? r$(p.valorCentavos) : null,
      });
  }
  return {
    tipo: 'diario',
    titulo: TIPOS_DEMONSTRACAO.diario,
    subtitulo: `Empresa ${d.empresa} · ${dataBr(d.de)} a ${dataBr(d.ate)} · ${d.totais.lancamentos} lançamento(s)`,
    legenda: 'Cada lançamento com as suas partidas logo abaixo (D = débito; C = crédito).',
    colunas: [
      col('data', 'Data', 'texto'),
      col('lancamento', 'Lançamento', 'inteiro'),
      col('conta', 'Conta', 'texto'),
      col('nome', 'Histórico / conta', 'texto'),
      col('centro', 'Centro de custo', 'inteiro'),
      col('debito', 'Débito', 'dinheiro'),
      col('credito', 'Crédito', 'dinheiro'),
    ],
    linhas,
    destaques,
    totais: { debito: r$(d.totais.debitosCentavos), credito: r$(d.totais.creditosCentavos) },
    conferencia: [
      ...d.parcelas.map(
        (p) => `${p.tipo}: ${p.lancamentos} lançamento(s), ${reaisBr(p.debitosCentavos)} a débito`,
      ),
      d.conferencia,
    ],
    arquivo: `diario-${d.empresa}-${d.de}-a-${d.ate}`,
  };
}

function dre(d: Dre): TabelaDemonstracao {
  const linhas: LinhaRelatorio[] = [];
  const destaques = new Set<number>();
  for (const l of d.linhas) {
    if (l.total) destaques.add(linhas.length);
    linhas.push({ codigo: '', descricao: l.rotulo, valor: r$(l.valorCentavos) });
    for (const p of l.parcelas)
      linhas.push({ codigo: p.codigo, descricao: `  ${p.nome}`, valor: r$(p.valorCentavos) });
  }
  return {
    tipo: 'dre',
    titulo: TIPOS_DEMONSTRACAO.dre,
    subtitulo: `Empresa ${d.empresa} · ${competenciaBr(d.de)} a ${competenciaBr(d.ate)}`,
    legenda:
      'Receitas positivas; deduções, custos e despesas negativos. Sem o lançamento de apuração do resultado (nem o estorno dele).',
    colunas: [
      col('codigo', 'Conta', 'texto'),
      col('descricao', 'Descrição', 'texto'),
      col('valor', 'Valor', 'dinheiro'),
    ],
    linhas,
    destaques,
    totais: {},
    conferencia: [`${d.rotuloResultado}: ${reaisBr(d.resultadoCentavos)}.`, d.conferencia],
    arquivo: `dre-${d.empresa}-${d.de}-a-${d.ate}`,
  };
}

function balanco(b: Balanco): TabelaDemonstracao {
  const linhas: LinhaRelatorio[] = [];
  const destaques = new Set<number>();
  const secao = (s: { rotulo: string; totalCentavos: number; parcelas: Balanco['ativo']['parcelas'] }) => {
    destaques.add(linhas.length);
    linhas.push({ codigo: '', descricao: s.rotulo, valor: r$(s.totalCentavos) });
    for (const p of s.parcelas)
      linhas.push({ codigo: p.codigo, descricao: `  ${p.nome}`, valor: r$(p.valorCentavos) });
  };
  secao(b.ativo);
  destaques.add(linhas.length);
  linhas.push({ codigo: '', descricao: 'Total do ativo', valor: r$(b.totalAtivoCentavos) });
  secao(b.passivo);
  secao(b.patrimonioLiquido);
  if (b.resultadoExercicioCentavos !== 0)
    linhas.push({
      codigo: '',
      descricao: '  Resultado do exercício (não apurado)',
      valor: r$(b.resultadoExercicioCentavos),
    });
  if (b.resultadoAnterioresCentavos !== 0)
    linhas.push({
      codigo: '',
      descricao: '  Resultado de exercícios anteriores (não apurado)',
      valor: r$(b.resultadoAnterioresCentavos),
    });
  destaques.add(linhas.length);
  linhas.push({
    codigo: '',
    descricao: 'Total do passivo e do patrimônio líquido',
    valor: r$(b.totalPassivoPlCentavos),
  });
  if (b.compensacao) secao(b.compensacao);
  return {
    tipo: 'balanco',
    titulo: TIPOS_DEMONSTRACAO.balanco,
    subtitulo: `Empresa ${b.empresa} · em ${dataBr(b.data)}`,
    legenda:
      'Valores na natureza de cada grupo; o resultado ainda não apurado aparece no patrimônio líquido.',
    colunas: [
      col('codigo', 'Conta', 'texto'),
      col('descricao', 'Descrição', 'texto'),
      col('valor', 'Valor', 'dinheiro'),
    ],
    linhas,
    destaques,
    totais: {},
    conferencia: [
      b.conferencia,
      b.equilibrado ? 'Equilibrado.' : 'DESEQUILIBRADO: ativo diferente do passivo + PL.',
    ],
    arquivo: `balanco-${b.empresa}-${b.competencia}`,
  };
}

export function tabelaDaDemonstracao(d: DadoDemonstracao): TabelaDemonstracao {
  switch (d.tipo) {
    case 'balancete':
      return balancete(d.dado);
    case 'diario':
      return diario(d.dado);
    case 'dre':
      return dre(d.dado);
    case 'balanco':
      return balanco(d.dado);
  }
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function celulaHtml(v: unknown, tipo: ColunaRelatorio['tipo']): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && tipo === 'dinheiro') return esc(reaisBr(Math.round(v * 100)));
  return esc(String(v));
}

/** O HTML do PDF/A (autocontido: sem fonte, imagem nem script externos). */
export function htmlDaDemonstracao(
  t: TabelaDemonstracao,
  meta: { readonly emitidoPor: string; readonly emitidoEm: Date },
): string {
  const corpo = t.linhas
    .map(
      (l, i) =>
        `<tr${t.destaques.has(i) ? ' class="g"' : ''}>${t.colunas
          .map(
            (c) =>
              `<td class="${c.tipo === 'texto' ? 'x' : 'n'}">${celulaHtml(l[c.campo], c.tipo).replace(/^( +)/, (s) => '&nbsp;'.repeat(s.length))}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  const total = Object.keys(t.totais).length
    ? `<tr class="t">${t.colunas.map((c, i) => `<td class="${i ? 'n' : 'x'}">${i === 0 ? 'Total' : c.campo in t.totais ? celulaHtml(t.totais[c.campo], c.tipo) : ''}</td>`).join('')}</tr>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(t.titulo)}</title>
<style>@page{size:A4 portrait;margin:12mm}body{font:9pt sans-serif;color:#111}h1{font-size:13pt;margin:0 0 4px}
p{margin:0 0 6px;color:#333}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:2px 4px}
th{background:#eee;text-align:left}.n{text-align:right;white-space:nowrap}.g td{font-weight:bold;background:#f5f5f5}
.t td{font-weight:bold;border-top:2px solid #333}ul{margin:8px 0 0;padding-left:16px}</style></head><body>
<h1>${esc(t.titulo)}</h1><p>${esc(t.subtitulo)}</p>${t.legenda ? `<p>${esc(t.legenda)}</p>` : ''}
<p>Emitido por ${esc(meta.emitidoPor)} em ${esc(meta.emitidoEm.toISOString().slice(0, 16).replace('T', ' '))}</p>
<table><thead><tr>${t.colunas.map((c) => `<th>${esc(c.rotulo)}</th>`).join('')}</tr></thead><tbody>${corpo}${total}</tbody></table>
<ul>${t.conferencia.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</body></html>`;
}

/** A planilha: as linhas, o total e, depois de uma linha em branco, a legenda e a conferência na primeira coluna. */
export function xlsxDaDemonstracao(t: TabelaDemonstracao): Uint8Array {
  const primeira = t.colunas[0]!.campo;
  const notas: LinhaRelatorio[] = [
    {},
    ...(t.legenda ? [{ [primeira]: t.legenda }] : []),
    ...t.conferencia.map((c) => ({ [primeira]: c })),
  ];
  // O total vai antes das notas (o gerador põe o total depois da última linha).
  const total: LinhaRelatorio[] = Object.keys(t.totais).length
    ? [
        Object.fromEntries(
          t.colunas.map((c, i) => [c.campo, i === 0 ? 'Total' : (t.totais[c.campo] ?? null)]),
        ),
      ]
    : [];
  return gerarXlsx({
    relatorio: { titulo: t.titulo, colunas: t.colunas },
    linhas: [...t.linhas, ...total, ...notas],
    totais: {},
  });
}
