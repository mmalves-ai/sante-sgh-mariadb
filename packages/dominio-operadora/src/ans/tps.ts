// TPS, a taxa de saúde suplementar por plano (M56, etapa 7, F6; Lei 9.961/2000, art. 20, I): a média de beneficiários
// de cada plano no trimestre (os ativos no último dia de cada um dos três meses) vezes o valor trimestral por
// beneficiário vigente no fim do trimestre (PSTPSVIGENCIA do banco: hoje R$ 5,39 ao ano, R$ 1,3475 por trimestre, desde
// 01/09/2015), menos o desconto do plano informado pelo responsável (as tabelas de desconto da lei são conferidas por
// ele: D-TPS-567). Cada plano é uma parcela impressa com a conta; o total é a soma das parcelas arredondadas.
import type { DescontoTps, ParcelaAns, ProblemaAns, QuadroAns } from '@sgh/contratos';
import { emCentavos, documentoXml, el, problema, deCentavos, valorNoArquivo } from './comum.js';
import { type CabecalhoAns, cabecalhoXml } from './sib.js';

export interface VigenciaTps {
  readonly vigencia: string;
  readonly valorAnual: number;
  readonly valorTrimestral: number;
}

export interface PlanoTps {
  readonly produto: number;
  readonly nome: string;
  readonly registroAns: string | null;
  /** Ativos no último dia de cada mês do trimestre. */
  readonly beneficiariosPorMes: readonly number[];
}

/** O valor vigente na data (a vigência mais recente que começou até a data). */
export function valorTpsVigente(vigencias: readonly VigenciaTps[], data: string): VigenciaTps | null {
  return (
    [...vigencias]
      .filter((v) => v.vigencia <= data)
      .sort((a, b) => b.vigencia.localeCompare(a.vigencia))[0] ?? null
  );
}

export interface LinhaTps {
  readonly produto: number;
  readonly nome: string;
  readonly registroAns: string | null;
  readonly beneficiariosPorMes: readonly number[];
  /** Média com duas casas (mostrada); a conta usa a soma dos meses, sem arredondar a média. */
  readonly media: number;
  readonly desconto: number;
  readonly valorCentavos: number;
}

export interface ResultadoTps {
  readonly vigencia: VigenciaTps | null;
  readonly linhas: readonly LinhaTps[];
  readonly totalCentavos: number;
  readonly problemas: readonly ProblemaAns[];
}

export function calcularTps(
  planos: readonly PlanoTps[],
  vigencias: readonly VigenciaTps[],
  fimDoTrimestre: string,
  descontos: readonly DescontoTps[] = [],
): ResultadoTps {
  const vigencia = valorTpsVigente(vigencias, fimDoTrimestre);
  const problemas: ProblemaAns[] = [];
  if (!vigencia) problemas.push(problema('sem-valor-tps'));
  const ids = new Set(planos.map((p) => p.produto));
  for (const d of descontos)
    if (!ids.has(d.produto))
      problemas.push(problema('desconto-de-outro-plano', 'arquivo', String(d.produto)));
  const linhas = planos.map((p) => {
    const meses = p.beneficiariosPorMes.length || 1;
    const soma = p.beneficiariosPorMes.reduce((a, n) => a + n, 0);
    const desconto = descontos.find((d) => d.produto === p.produto)?.percentual ?? 0;
    const valor = vigencia
      ? Math.round((((soma / meses) * vigencia.valorTrimestral * (100 - desconto)) / 100) * 100)
      : 0;
    return {
      produto: p.produto,
      nome: p.nome,
      registroAns: p.registroAns,
      beneficiariosPorMes: p.beneficiariosPorMes,
      media: Math.round((soma / meses) * 100) / 100,
      desconto,
      valorCentavos: valor,
    };
  });
  for (const l of linhas)
    if (!l.registroAns) problemas.push(problema('sem-registro-plano', 'arquivo', String(l.produto)));
  return { vigencia, linhas, totalCentavos: linhas.reduce((a, l) => a + l.valorCentavos, 0), problemas };
}

const br = (v: number, casas = 2) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function quadrosTps(r: ResultadoTps): QuadroAns[] {
  const vt = r.vigencia?.valorTrimestral ?? 0;
  const parcelas: ParcelaAns[] = r.linhas.map((l) => ({
    rotulo: `${l.nome}: média ${br(l.media)} (${l.beneficiariosPorMes.join(' + ')} ÷ ${l.beneficiariosPorMes.length}) × R$ ${br(vt, 4)}${l.desconto ? ` − ${br(l.desconto)}%` : ''}`,
    valor: deCentavos(l.valorCentavos),
    quantidade: Math.round(l.media),
  }));
  return [
    {
      titulo: 'Taxa de saúde suplementar por plano',
      parcelas,
      total: { rotulo: 'Total do trimestre', valor: deCentavos(r.totalCentavos) },
    },
  ];
}

export function arquivoTps(cab: CabecalhoAns, r: ResultadoTps): string {
  return documentoXml(
    el('demonstrativoTPS', [
      cabecalhoXml(cab, r.linhas.length, [
        el('valorTrimestral', r.vigencia ? r.vigencia.valorTrimestral.toFixed(4) : ''),
        el('vigencia', r.vigencia?.vigencia ?? ''),
      ]),
      el(
        'planos',
        r.linhas.map((l) =>
          el(
            'plano',
            [
              ...l.beneficiariosPorMes.map((n, i) => el('beneficiarios', n, { mes: i + 1 })),
              el('media', l.media.toFixed(2)),
              el('desconto', l.desconto.toFixed(2)),
              el('valor', valorNoArquivo(deCentavos(l.valorCentavos))),
            ],
            { registroANS: l.registroAns ?? '' },
          ),
        ),
      ),
      el('total', valorNoArquivo(deCentavos(r.totalCentavos))),
    ]),
  );
}

/** Confere que o total é a soma das parcelas (o e-mail e a tela imprimem as parcelas). */
export const totalConfere = (q: QuadroAns): boolean =>
  q.parcelas.reduce((a, p) => a + emCentavos(p.valor), 0) === emCentavos(q.total.valor);
