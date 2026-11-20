// Eventos periódicos do eSocial (M53-F6; leiaute S-1.3): S-1200 remuneração do trabalhador (um por CPF e período de
// apuração, com um demonstrativo por processamento fixado no fechamento da folha), S-1210 pagamentos de rendimentos (um
// por CPF e mês do pagamento), S-1299 fechamento dos periódicos do empregador e S-1298 reabertura. Os valores vêm das
// linhas do cálculo (M53-F2 a F4) dos processamentos que o fechamento fixou. Regras puras.
//
// D-DMDEV-537 (POL-5): o identificador do demonstrativo (`ideDmDev`) é a letra do tipo e o ID do processamento (M folha
// mensal, F férias, D 13º); a rescisão usa o da S-2299 (R + ID da rescisão), que o S-1210 paga com `tpPgto` 2. O
// identificador é único no empregador e estável entre retificações.
// D-AGNOCIVO-537 (POL-5): o grau de exposição a agentes nocivos (grupo obrigatório para empregado e cooperado) vai como
// 1 (não ensejador de aposentadoria especial) até o SESMT informar outro grau no laudo; insalubridade e periculosidade
// não mudam o grau (são adicionais, não aposentadoria especial).
// D-IRRF-537 (POL-5): `indApurIR` = 0 (apuração normal do IR na fonte), o único que a folha calcula.
import {
  type ApuracaoFolha,
  INDICADOR_APURACAO,
  type LinhaCalculoFolha,
  type PendenciaEsocial,
  type TipoProcessoFolha,
} from '@sgh/contratos';
import {
  type ContextoEventoEsocial,
  type EmpregadorParaEvento,
  envelope,
  idEventoEsocial,
  ideEmpregador,
  pendencia,
  raizCnpj,
  type ResultadoEventoEsocial,
} from './comum.js';
import {
  ehCategoriaEmpregado,
  matriculaEsocial,
  pendenciasTrabalhador,
  type TrabalhadorParaEvento,
} from './eventos-trabalhador.js';
import { decimalDeCentavos, el, type NoXml, obrig } from './xml.js';

/** O identificador do demonstrativo do processamento (a rescisão usa o da S-2299). */
export function ideDmDevDoProcesso(
  tipo: TipoProcessoFolha,
  processo: number,
  rescisao: number | null,
): string {
  switch (tipo) {
    case 'mensal':
      return `M${processo}`;
    case 'ferias':
      return `F${processo}`;
    case 'decimo1':
    case 'decimo2':
      return `D${processo}`;
    case 'rescisao':
      if (rescisao === null) throw new Error('Rescisão sem ID: o demonstrativo é o da S-2299.');
      return `R${rescisao}`;
  }
}

/** Os tipos de processamento que viram demonstrativo do S-1200 (a rescisão vai na S-2299; a 1ª parcela do 13º, não). */
export const TIPOS_NO_S1200: readonly TipoProcessoFolha[] = ['mensal', 'ferias', 'decimo2'];
/** Os tipos de processamento cujo pagamento vai ao S-1210 (D-DECIMO1-537: a 1ª parcela do 13º, não). */
export const TIPOS_NO_S1210: readonly TipoProcessoFolha[] = ['mensal', 'ferias', 'decimo2', 'rescisao'];

export interface ItemRemuneracao {
  readonly codigo: string;
  readonly valor: number;
}

/** Os itens do demonstrativo: proventos e descontos com rubrica, somados por código e com valor positivo. */
export function itensDaRemuneracao(
  linhas: readonly Pick<LinhaCalculoFolha, 'tipo' | 'codigoRubrica' | 'valor'>[],
): ItemRemuneracao[] {
  const por = new Map<string, number>();
  for (const l of linhas) {
    if (l.codigoRubrica === null || (l.tipo !== 'provento' && l.tipo !== 'desconto') || l.valor <= 0)
      continue;
    const c = String(l.codigoRubrica);
    por.set(c, (por.get(c) ?? 0) + l.valor);
  }
  return [...por.entries()]
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
    .map(([codigo, valor]) => ({ codigo, valor }));
}

/** Um demonstrativo do trabalhador no período (um processamento fixado). */
export interface DemonstrativoRemuneracao {
  readonly ideDmDev: string;
  readonly processo: number;
  readonly tipo: TipoProcessoFolha;
  readonly itens: readonly ItemRemuneracao[];
}

export interface PeriodoApuracao {
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
}

function comPendencias(
  e: EmpregadorParaEvento,
  extras: readonly PendenciaEsocial[],
): { ok: false; pendencias: readonly PendenciaEsocial[] } | null {
  const p = [
    ...(e.cnpj
      ? []
      : [pendencia('empregador-sem-cnpj', 'O cadastro da empresa não tem o CNPJ de 14 posições.')]),
    ...extras,
  ];
  return p.length ? { ok: false, pendencias: p } : null;
}

function montar(
  evento: 'S-1200' | 'S-1210' | 'S-1298' | 'S-1299',
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  filhos: (cnpj: string) => readonly (NoXml | null)[],
  dataReferencia: string,
): ResultadoEventoEsocial {
  const cnpj = e.cnpj!;
  const id = idEventoEsocial(raizCnpj(cnpj), ctx.instante, ctx.sequencia);
  return { ok: true, raiz: envelope(evento, ctx, filhos(cnpj), id), idEsocial: id, dataReferencia };
}

/** A identificação do evento de folha (S-1200): original ou retificação, com a apuração e o período. */
function ideEventoFolha(ctx: ContextoEventoEsocial, p: PeriodoApuracao, recibo: string | null): NoXml {
  return obrig('ideEvento', [
    obrig('indRetif', recibo ? 2 : 1),
    el('nrRecibo', recibo),
    obrig('indApuracao', INDICADOR_APURACAO[p.apuracao]),
    obrig('perApur', p.periodo),
    obrig('tpAmb', ctx.tpAmb),
    obrig('procEmi', 1),
    obrig('verProc', ctx.verProc),
  ]);
}

/** S-1200: a remuneração do trabalhador no período, um demonstrativo por processamento fixado. */
export function montarS1200(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  p: PeriodoApuracao,
  demonstrativos: readonly DemonstrativoRemuneracao[],
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const extras = pendenciasTrabalhador(t);
  const comItens = demonstrativos.filter((d) => d.itens.length > 0);
  if (comItens.length === 0)
    extras.push(pendencia('sem-remuneracao', 'O colaborador não tem rubrica com valor no período.'));
  if (comItens.length > 999) extras.push(pendencia('demonstrativos-demais', 'Mais de 999 demonstrativos.'));
  for (const d of comItens)
    if (d.itens.length > 200)
      extras.push(pendencia('itens-demais', `O demonstrativo ${d.ideDmDev} tem mais de 200 rubricas.`));
  if (new Set(comItens.map((d) => d.ideDmDev)).size !== comItens.length)
    extras.push(pendencia('demonstrativo-repetido', 'Dois demonstrativos com o mesmo identificador.'));
  const pp = comPendencias(e, extras);
  if (pp) return pp;
  const categoria = t.ficha!.categoria;
  const agNocivo = ehCategoriaEmpregado(categoria) || /^(2\d{2}|3\d{2}|731|734|738)$/.test(categoria);
  const matricula = ehCategoriaEmpregado(categoria) || t.matricula ? matriculaEsocial(t) : null;
  return montar(
    'S-1200',
    ctx,
    e,
    (cnpj) => [
      ideEventoFolha(ctx, p, reciboRetificado),
      ideEmpregador(cnpj),
      obrig('ideTrabalhador', [obrig('cpfTrab', t.cpf!)]),
      ...comItens.map((d) =>
        obrig('dmDev', [
          obrig('ideDmDev', d.ideDmDev),
          obrig('codCateg', categoria),
          obrig('infoPerApur', [
            obrig('ideEstabLot', [
              obrig('tpInsc', 1),
              obrig('nrInsc', cnpj),
              obrig('codLotacao', e.codLotacao),
              obrig('remunPerApur', [
                el('matricula', matricula),
                ...d.itens.map((i) =>
                  obrig('itensRemun', [
                    obrig('codRubr', i.codigo),
                    obrig('ideTabRubr', e.ideTabRubr),
                    obrig('vrRubr', decimalDeCentavos(i.valor)),
                    obrig('indApurIR', 0),
                  ]),
                ),
                agNocivo ? obrig('infoAgNocivo', [obrig('grauExp', 1)]) : null,
              ]),
            ]),
          ]),
        ]),
      ),
    ],
    p.periodo,
  );
}

/** Um pagamento ao trabalhador no mês (`tpPgto` 1 do S-1200, 2 da S-2299, 3 da S-2399). */
export interface PagamentoTrabalhador {
  readonly dtPgto: string;
  readonly tpPgto: 1 | 2 | 3;
  /** O período do demonstrativo pago (AAAA-MM ou AAAA). */
  readonly perRef: string;
  readonly ideDmDev: string;
  /** O líquido pago (proventos − descontos do demonstrativo), em centavos. */
  readonly vrLiq: number;
}

/** O tipo do pagamento no S-1210 pelo tipo do processamento. */
export const tpPgtoDoTipo = (tipo: TipoProcessoFolha, categoria: string): 1 | 2 | 3 =>
  tipo !== 'rescisao' ? 1 : ehCategoriaEmpregado(categoria) ? 2 : 3;

/** O período do S-1210 de um pagamento: o mês da data de pagamento. */
export const periodoDoPagamento = (dtPgto: string): string => dtPgto.slice(0, 7);

/** S-1210: os pagamentos feitos ao trabalhador no mês (`perApur` = mês do pagamento). */
export function montarS1210(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  periodo: string,
  pagamentos: readonly PagamentoTrabalhador[],
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  // O S-1210 não usa a ficha do eSocial (só o CPF do beneficiário).
  const extras = pendenciasTrabalhador(t).filter((x) => x.codigo !== 'ficha-ausente');
  if (pagamentos.length === 0)
    extras.push(pendencia('sem-pagamento', 'O colaborador não tem pagamento no mês.'));
  if (pagamentos.length > 999) extras.push(pendencia('pagamentos-demais', 'Mais de 999 pagamentos no mês.'));
  const fora = pagamentos.filter((x) => periodoDoPagamento(x.dtPgto) !== periodo);
  if (fora.length)
    extras.push(pendencia('pagamento-fora-do-mes', 'Há pagamento com data fora do mês do evento.'));
  if (pagamentos.some((x) => x.vrLiq < 0))
    extras.push(pendencia('liquido-negativo', 'Há pagamento com líquido negativo.'));
  const pp = comPendencias(e, extras);
  if (pp) return pp;
  const ordenados = [...pagamentos].sort(
    (a, b) => a.dtPgto.localeCompare(b.dtPgto) || a.ideDmDev.localeCompare(b.ideDmDev),
  );
  return montar(
    'S-1210',
    ctx,
    e,
    (cnpj) => [
      obrig('ideEvento', [
        obrig('indRetif', reciboRetificado ? 2 : 1),
        el('nrRecibo', reciboRetificado),
        obrig('perApur', periodo),
        obrig('tpAmb', ctx.tpAmb),
        obrig('procEmi', 1),
        obrig('verProc', ctx.verProc),
      ]),
      ideEmpregador(cnpj),
      obrig('ideBenef', [
        obrig('cpfBenef', t.cpf!),
        ...ordenados.map((x) =>
          obrig('infoPgto', [
            obrig('dtPgto', x.dtPgto),
            obrig('tpPgto', x.tpPgto),
            obrig('perRef', x.perRef),
            obrig('ideDmDev', x.ideDmDev),
            obrig('vrLiq', decimalDeCentavos(x.vrLiq)),
          ]),
        ),
      ]),
    ],
    periodo,
  );
}

/** O que o S-1299 declara: houve remuneração e pagamento no período (os demais grupos do leiaute, não). */
export interface InfoFechamentoPeriodicos {
  readonly remuneracao: boolean;
  readonly pagamentos: boolean;
}

const ideEventoSemRetificacao = (ctx: ContextoEventoEsocial, p: PeriodoApuracao): NoXml =>
  obrig('ideEvento', [
    obrig('indApuracao', INDICADOR_APURACAO[p.apuracao]),
    obrig('perApur', p.periodo),
    obrig('tpAmb', ctx.tpAmb),
    obrig('procEmi', 1),
    obrig('verProc', ctx.verProc),
  ]);

/** S-1299: o fechamento dos eventos periódicos do empregador no período. */
export function montarS1299(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  p: PeriodoApuracao,
  info: InfoFechamentoPeriodicos,
  pendenciasDoPeriodo: readonly PendenciaEsocial[],
): ResultadoEventoEsocial {
  const pp = comPendencias(e, pendenciasDoPeriodo);
  if (pp) return pp;
  const sn = (b: boolean) => (b ? 'S' : 'N');
  return montar(
    'S-1299',
    ctx,
    e,
    (cnpj) => [
      ideEventoSemRetificacao(ctx, p),
      ideEmpregador(cnpj),
      obrig('infoFech', [
        obrig('evtRemun', sn(info.remuneracao)),
        // O S-1210 do anual não existe (o pagamento do 13º vai no S-1210 do mês dele).
        obrig('evtPgtos', sn(p.apuracao === 'mensal' && info.pagamentos)),
        obrig('evtComProd', 'N'),
        obrig('evtContratAvNP', 'N'),
        obrig('evtInfoComplPer', 'N'),
      ]),
    ],
    p.periodo,
  );
}

/** S-1298: a reabertura dos periódicos do empregador no período (para retificar depois do S-1299 aceito). */
export function montarS1298(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  p: PeriodoApuracao,
  pendenciasDoPeriodo: readonly PendenciaEsocial[],
): ResultadoEventoEsocial {
  const pp = comPendencias(e, pendenciasDoPeriodo);
  if (pp) return pp;
  return montar(
    'S-1298',
    ctx,
    e,
    (cnpj) => [ideEventoSemRetificacao(ctx, p), ideEmpregador(cnpj)],
    p.periodo,
  );
}

// ── Situação dos periódicos no período ────────────────────────────────────────────────────────────────────────

/** Um evento periódico do período como o painel o lê. */
export interface EventoPeriodicoLido {
  readonly id: number;
  readonly evento: string;
  readonly vinculo: number | null;
  readonly situacao: string;
  readonly criadoEm: string;
}

const EM_ANDAMENTO = ['gerado', 'validado', 'em-lote', 'enviado'];

/**
 * A situação do período no eSocial pelos S-1299 e S-1298 em vigor (o último que conta):
 * - `aberto`: nenhum S-1299 aceito (ou o último S-1298 aceito depois dele);
 * - `fechando`: um S-1299 em andamento; `fechado`: o S-1299 aceito; `reabrindo`: um S-1298 em andamento.
 */
export function situacaoDoPeriodo(eventos: readonly EventoPeriodicoLido[]): {
  readonly situacao: 'aberto' | 'fechando' | 'fechado' | 'reabrindo';
  readonly evento: number | null;
} {
  const relevantes = eventos
    .filter(
      (x) =>
        (x.evento === 'S-1299' || x.evento === 'S-1298') && [...EM_ANDAMENTO, 'aceito'].includes(x.situacao),
    )
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id - b.id);
  const ultimo = relevantes.at(-1);
  if (!ultimo) return { situacao: 'aberto', evento: null };
  if (ultimo.evento === 'S-1299')
    return { situacao: ultimo.situacao === 'aceito' ? 'fechado' : 'fechando', evento: ultimo.id };
  return { situacao: ultimo.situacao === 'aceito' ? 'aberto' : 'reabrindo', evento: ultimo.id };
}

/** A contagem de um periódico (S-1200 ou S-1210) no período: por situação e os vínculos esperados sem evento. */
export function contarPeriodico(
  evento: 'S-1200' | 'S-1210',
  esperados: readonly number[],
  eventos: readonly EventoPeriodicoLido[],
): {
  readonly esperados: number;
  readonly porSituacao: Record<string, number>;
  readonly semEvento: number[];
  readonly aceitos: number;
} {
  const doEvento = eventos.filter((x) => x.evento === evento && x.situacao !== 'descartado');
  const porSituacao: Record<string, number> = {};
  for (const x of doEvento) porSituacao[x.situacao] = (porSituacao[x.situacao] ?? 0) + 1;
  const comEvento = new Set(
    doEvento
      .filter((x) => [...EM_ANDAMENTO, 'aceito', 'invalido', 'rejeitado'].includes(x.situacao))
      .map((x) => x.vinculo),
  );
  const aceitosV = new Set(doEvento.filter((x) => x.situacao === 'aceito').map((x) => x.vinculo));
  const unicos = [...new Set(esperados)].sort((a, b) => a - b);
  return {
    esperados: unicos.length,
    porSituacao,
    semEvento: unicos.filter((v) => !comEvento.has(v)).slice(0, 50),
    aceitos: unicos.filter((v) => aceitosV.has(v)).length,
  };
}

export interface EntradaPendenciasPeriodo {
  readonly apuracao: ApuracaoFolha;
  /** O período está fechado na folha. */
  readonly folhaFechada: boolean;
  readonly remuneracao: { readonly esperados: number; readonly aceitos: number };
  readonly pagamentos: { readonly esperados: number; readonly aceitos: number } | null;
  /** Eventos periódicos do período ainda em andamento (gerado, validado, em lote, enviado). */
  readonly emAndamento: number;
  /** Recibos de autônomo do repasse no período, com o Sante SGH como transmissor. */
  readonly repasse: number;
  /** S-1200 de autônomo gerados pelo Sante SGH no período (D-RPA-PER-537: ainda não geramos). */
  readonly remuneracaoAutonomo: number;
}

/**
 * O que barra o S-1299 (regra 1: o empregador fecha o período com todos os periódicos dele, do mesmo transmissor):
 * a folha do período fechada, todos os S-1200 (e no mensal os S-1210) esperados aceitos, nada em andamento e os
 * recibos de autônomo do repasse declarados (D-RPA-PER-537: enquanto o Sante SGH não gerar o S-1200 do autônomo, o
 * período com recibo de autônomo não fecha por ele).
 */
export function pendenciasFechamentoEsocial(e: EntradaPendenciasPeriodo): PendenciaEsocial[] {
  const p: PendenciaEsocial[] = [];
  if (!e.folhaFechada)
    p.push(pendencia('folha-nao-fechada', 'Feche o período na folha antes de fechar os periódicos.'));
  const faltaR = e.remuneracao.esperados - e.remuneracao.aceitos;
  if (faltaR > 0)
    p.push(
      pendencia('remuneracao-pendente', `${faltaR} remuneração(ões) (S-1200) ainda sem aceite no período.`),
    );
  if (e.pagamentos) {
    const faltaP = e.pagamentos.esperados - e.pagamentos.aceitos;
    if (faltaP > 0)
      p.push(pendencia('pagamento-pendente', `${faltaP} pagamento(s) (S-1210) ainda sem aceite no mês.`));
  }
  if (e.emAndamento > 0)
    p.push(pendencia('eventos-em-andamento', `${e.emAndamento} evento(s) periódico(s) ainda em andamento.`));
  if (e.repasse > e.remuneracaoAutonomo)
    p.push(
      pendencia(
        'repasse-sem-remuneracao',
        `${e.repasse} recibo(s) de autônomo do repasse no período sem a remuneração (S-1200) do autônomo.`,
      ),
    );
  return p;
}
