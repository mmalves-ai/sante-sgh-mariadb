// Regras puras do calendário de entrega da fatura por fonte pagadora (06-FAT linha 31, F3.7): a janela de entrega
// combinada com cada convênio por competência, o pagamento previsto e o prazo do lote ainda sem protocolo.
// - a próxima entrega é a janela aberta hoje ou, sem ela, a primeira que ainda vai abrir;
// - o pagamento previsto é a data fixa combinada ou, sem ela, o fim da janela mais o prazo em dias;
// - a janela restritiva (decisão do hospital no cadastro) recusa a entrega fora dela para a competência; a janela
//   não restritiva só avisa. Sem banco e sem HTTP; datas em AAAA-MM-DD.

export interface JanelaEntrega {
  readonly competencia: string;
  readonly entregaInicio: string;
  readonly entregaFim: string;
  readonly pagamentoPrevisto: string | null;
  readonly prazoPagamentoDias: number | null;
  readonly restritivo: boolean;
}

export type SituacaoJanela = 'aberta' | 'futura' | 'encerrada';

export interface ProximaEntrega {
  readonly janela: JanelaEntrega;
  readonly situacao: Exclude<SituacaoJanela, 'encerrada'>;
  /** Dias até o início (futura) ou até o fim (aberta) da janela, contados de hoje. */
  readonly dias: number;
  readonly pagamentoPrevisto: string | null;
}

export interface RecusaCalendario {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.parse(`${d}T12:00:00Z`);
const diasEntre = (de: string, ate: string): number => Math.round((ms(ate) - ms(de)) / 86_400_000);
const somarDias = (d: string, n: number): string =>
  new Date(ms(d) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Confere a janela antes de gravar: competência no dia 1, entrega a partir da competência, fim depois do início,
 * pagamento depois da entrega e prazo positivo.
 */
export function validarJanelaEntrega(j: JanelaEntrega): RecusaCalendario | null {
  for (const [campo, v] of [
    ['competencia', j.competencia],
    ['entregaInicio', j.entregaInicio],
    ['entregaFim', j.entregaFim],
  ] as const)
    if (!DATA.test(v) || Number.isNaN(ms(v)))
      return { codigo: 'data-invalida', mensagem: 'Informe a data no formato AAAA-MM-DD.', campos: [campo] };
  if (!j.competencia.endsWith('-01'))
    return {
      codigo: 'competencia-invalida',
      mensagem: 'A competência é o primeiro dia do mês.',
      campos: ['competencia'],
    };
  if (j.entregaInicio < j.competencia)
    return {
      codigo: 'entrega-antes-da-competencia',
      mensagem: 'A entrega da fatura começa no mês da competência ou depois dele.',
      campos: ['entregaInicio'],
    };
  if (j.entregaFim < j.entregaInicio)
    return {
      codigo: 'janela-invertida',
      mensagem: 'O fim da entrega não pode ser antes do início.',
      campos: ['entregaFim'],
    };
  if (
    j.pagamentoPrevisto !== null &&
    (!DATA.test(j.pagamentoPrevisto) || j.pagamentoPrevisto < j.entregaInicio)
  )
    return {
      codigo: 'pagamento-antes-da-entrega',
      mensagem: 'O pagamento previsto não pode ser antes da entrega.',
      campos: ['pagamentoPrevisto'],
    };
  if (j.prazoPagamentoDias !== null && (!Number.isInteger(j.prazoPagamentoDias) || j.prazoPagamentoDias <= 0))
    return {
      codigo: 'prazo-invalido',
      mensagem: 'O prazo de pagamento é um número inteiro de dias maior que zero.',
      campos: ['prazoPagamentoDias'],
    };
  return null;
}

export function situacaoDaJanela(j: JanelaEntrega, hoje: string): SituacaoJanela {
  if (hoje < j.entregaInicio) return 'futura';
  return hoje <= j.entregaFim ? 'aberta' : 'encerrada';
}

/** Pagamento previsto da janela: a data fixa ou o fim da entrega mais o prazo em dias; sem os dois, nulo. */
export function pagamentoPrevistoDaJanela(j: JanelaEntrega): string | null {
  if (j.pagamentoPrevisto) return j.pagamentoPrevisto;
  return j.prazoPagamentoDias ? somarDias(j.entregaFim, j.prazoPagamentoDias) : null;
}

/** A janela aberta hoje (a que fecha antes) ou, sem ela, a primeira que vai abrir; nula sem janela à frente. */
export function proximaEntrega(janelas: readonly JanelaEntrega[], hoje: string): ProximaEntrega | null {
  const aFrente = janelas
    .filter((j) => situacaoDaJanela(j, hoje) !== 'encerrada')
    .sort((a, b) => {
      const sa = situacaoDaJanela(a, hoje) === 'aberta' ? 0 : 1;
      const sb = situacaoDaJanela(b, hoje) === 'aberta' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return sa === 0
        ? a.entregaFim.localeCompare(b.entregaFim)
        : a.entregaInicio.localeCompare(b.entregaInicio);
    });
  const j = aFrente[0];
  if (!j) return null;
  const situacao = situacaoDaJanela(j, hoje) as 'aberta' | 'futura';
  return {
    janela: j,
    situacao,
    dias: situacao === 'aberta' ? diasEntre(hoje, j.entregaFim) : diasEntre(hoje, j.entregaInicio),
    pagamentoPrevisto: pagamentoPrevistoDaJanela(j),
  };
}

/** Datas de início das janelas que ainda não encerraram, em ordem e sem repetir. */
export function entregasAFrente(janelas: readonly JanelaEntrega[], hoje: string): string[] {
  return [
    ...new Set(
      janelas
        .filter((j) => situacaoDaJanela(j, hoje) !== 'encerrada')
        .map((j) => j.entregaInicio)
        .sort(),
    ),
  ];
}

/**
 * Entrega do lote (data do protocolo) contra o calendário das competências das contas do lote. Só a competência com
 * janela restritiva recusa: a entrega tem de cair numa das janelas dela. Sem calendário ou só com janela não
 * restritiva, a entrega passa (o painel de prazos avisa).
 */
export function conferirEntregaNoCalendario(
  janelas: readonly JanelaEntrega[],
  competencias: readonly string[],
  dataEntrega: string,
): RecusaCalendario | null {
  for (const comp of [...new Set(competencias)].sort()) {
    const daComp = janelas.filter((j) => j.competencia === comp);
    if (!daComp.some((j) => j.restritivo)) continue;
    if (daComp.some((j) => dataEntrega >= j.entregaInicio && dataEntrega <= j.entregaFim)) continue;
    const faixas = daComp
      .map((j) => `${j.entregaInicio} a ${j.entregaFim}`)
      .sort()
      .join('; ');
    return {
      codigo: 'entrega-fora-da-janela',
      mensagem: `A fonte pagadora só recebe a fatura da competência ${comp.slice(0, 7)} de ${faixas}.`,
      campos: ['data'],
    };
  }
  return null;
}

/**
 * A janela nova (ou alterada) contra as janelas ativas do mesmo convênio: na mesma competência, duas janelas não podem
 * se sobrepor (a entrega ficaria ambígua). `proprio` é o id da janela que está sendo alterada (fica de fora).
 */
export function conferirSobreposicaoJanela(
  nova: Pick<JanelaEntrega, 'competencia' | 'entregaInicio' | 'entregaFim'>,
  ativas: readonly (Pick<JanelaEntrega, 'competencia' | 'entregaInicio' | 'entregaFim'> & {
    readonly id: number;
  })[],
  proprio: number | null = null,
): RecusaCalendario | null {
  const outra = ativas.find(
    (a) =>
      a.id !== proprio &&
      a.competencia === nova.competencia &&
      a.entregaInicio <= nova.entregaFim &&
      nova.entregaInicio <= a.entregaFim,
  );
  return outra
    ? {
        codigo: 'janela-sobreposta',
        mensagem: `Já há uma janela de entrega da competência ${nova.competencia.slice(0, 7)} de ${outra.entregaInicio} a ${outra.entregaFim}.`,
        campos: ['entregaInicio', 'entregaFim'],
      }
    : null;
}
