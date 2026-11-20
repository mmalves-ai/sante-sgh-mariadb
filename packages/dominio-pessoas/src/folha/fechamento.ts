// Fechamento do período da folha (M53-F6; ficha do M53, seções 6 a 8, regras 7 e 10): o que o fechamento fixa, o que
// barra fechar e a prova da soma. O período mensal (AAAA-MM) fixa a folha mensal, os recibos de férias e as rescisões
// calculados na competência; o anual (AAAA) fixa as duas parcelas do 13º salário do ano. Fechado, o período não aceita
// novo cálculo, recálculo nem descarte até a reabertura (com motivo). Regras puras: o relógio e os processamentos vêm de
// quem chama.
//
// D-PAGAMENTO-537 (POL-5): a data de pagamento da folha mensal é dado do fechamento (o cálculo não a tem); vale de 1º
// dia da competência ao último do mês seguinte (o salário se paga até o 5º dia útil do mês seguinte, CLT art. 459 §1º,
// e há quem pague no próprio mês). Ela é a `dtPgto` do S-1210 e decide o mês dele.
// D-DECIMO1-537 (POL-5): a 1ª parcela do 13º é fixada pelo anual mas não vira demonstrativo do S-1200 nem pagamento do
// S-1210: o 13º se declara inteiro no S-1200 anual, com a 2ª parcela (que desconta o adiantamento).
import {
  APURACAO_DO_TIPO,
  type ApuracaoFolha,
  type ConferenciaFechamentoFolha,
  type PendenciaFechamentoFolha,
  type ProcessoNoFechamento,
  type TipoProcessoFolha,
  type TotaisCalculoFolha,
  type TotaisFechamentoFolha,
} from '@sgh/contratos';

/** O processamento como o fechamento o lê (só os `calculada` entram). */
export interface ProcessoParaFechamento {
  readonly id: number;
  readonly tipo: TipoProcessoFolha;
  readonly competencia: string;
  readonly numero: number;
  readonly situacao: 'calculada' | 'substituida' | 'descartada';
  readonly pagamento: string | null;
  readonly resumo: string;
  readonly totais: TotaisCalculoFolha;
}

/** O período de apuração do processamento (o 13º é do ano; o resto, da competência). */
export function periodoDoProcesso(
  tipo: TipoProcessoFolha,
  competencia: string,
): { readonly apuracao: ApuracaoFolha; readonly periodo: string } {
  const apuracao = APURACAO_DO_TIPO[tipo];
  return { apuracao, periodo: apuracao === 'anual' ? competencia.slice(0, 4) : competencia };
}

/** Os processamentos em vigor que o fechamento do período fixa, na ordem da competência, do tipo e do ID. */
export function processosDoPeriodo(
  apuracao: ApuracaoFolha,
  periodo: string,
  processos: readonly ProcessoParaFechamento[],
): ProcessoParaFechamento[] {
  const ordemTipo: readonly TipoProcessoFolha[] = ['mensal', 'ferias', 'rescisao', 'decimo1', 'decimo2'];
  return processos
    .filter((p) => p.situacao === 'calculada')
    .filter((p) => {
      const x = periodoDoProcesso(p.tipo, p.competencia);
      return x.apuracao === apuracao && x.periodo === periodo;
    })
    .sort(
      (a, b) =>
        a.competencia.localeCompare(b.competencia) ||
        ordemTipo.indexOf(a.tipo) - ordemTipo.indexOf(b.tipo) ||
        a.id - b.id,
    );
}

const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const p2 = (n: number) => String(n).padStart(2, '0');

/** O intervalo aceito para a data de pagamento da folha mensal (D-PAGAMENTO-537). */
export function janelaPagamentoMensal(periodo: string): { readonly de: string; readonly ate: string } {
  const [a, m] = periodo.split('-').map(Number) as [number, number];
  const an = m === 12 ? a + 1 : a;
  const mn = m === 12 ? 1 : m + 1;
  return { de: `${periodo}-01`, ate: `${an}-${p2(mn)}-${p2(ultimoDia(an, mn))}` };
}

/** O período já terminou na data de hoje (o mensal, no último dia da competência; o anual, em 20 de dezembro). */
export function periodoTerminado(apuracao: ApuracaoFolha, periodo: string, hoje: string): boolean {
  if (apuracao === 'anual') return hoje >= `${periodo}-12-20`;
  return hoje.slice(0, 7) > periodo;
}

export interface EntradaFechamento {
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly hoje: string;
  /** Data de pagamento da folha mensal (o anual ignora). */
  readonly pagamento: string | null;
  /** O período já tem um fechamento em vigor. */
  readonly jaFechado: boolean;
  /** Os processamentos em vigor do período (`processosDoPeriodo`). */
  readonly processos: readonly ProcessoParaFechamento[];
}

const pend = (
  codigo: PendenciaFechamentoFolha['codigo'],
  mensagem: string,
  processo: number | null = null,
): PendenciaFechamentoFolha => ({ codigo, mensagem, processo });

/** O que barra fechar o período. */
export function pendenciasFechamento(e: EntradaFechamento): PendenciaFechamentoFolha[] {
  const p: PendenciaFechamentoFolha[] = [];
  if (e.jaFechado) p.push(pend('ja-fechado', 'O período já está fechado: reabra antes de fechar de novo.'));
  if (!periodoTerminado(e.apuracao, e.periodo, e.hoje))
    p.push(pend('periodo-em-curso', 'O período ainda não terminou.'));
  if (e.apuracao === 'mensal') {
    if (!e.processos.some((x) => x.tipo === 'mensal'))
      p.push(pend('sem-folha-mensal', 'Calcule a folha mensal da competência antes de fechar.'));
    if (!e.pagamento) p.push(pend('pagamento-obrigatorio', 'Informe a data de pagamento da folha mensal.'));
    else {
      const j = janelaPagamentoMensal(e.periodo);
      if (e.pagamento < j.de || e.pagamento > j.ate)
        p.push(
          pend('pagamento-fora-do-periodo', `A data de pagamento da folha mensal vai de ${j.de} a ${j.ate}.`),
        );
    }
  } else if (!e.processos.some((x) => x.tipo === 'decimo2'))
    p.push(pend('sem-decimo-final', 'Calcule a 2ª parcela do 13º salário antes de fechar o ano.'));
  for (const x of e.processos)
    if (x.tipo !== 'mensal' && !x.pagamento)
      p.push(pend('sem-pagamento', `O processamento ${x.id} não tem a data de pagamento.`, x.id));
  return p;
}

/** Os processamentos fixados, como o fechamento os guarda (a folha mensal com a data de pagamento do fechamento). */
export function processosNoFechamento(
  processos: readonly ProcessoParaFechamento[],
  pagamentoMensal: string | null,
): ProcessoNoFechamento[] {
  return processos.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    competencia: p.competencia,
    numero: p.numero,
    resumo: p.resumo,
    pagamento: p.tipo === 'mensal' ? pagamentoMensal : p.pagamento,
    colaboradores: p.totais.colaboradores,
    liquido: p.totais.liquido,
  }));
}

/** Os totais do período: a soma dos processamentos fixados. */
export function totaisFechamento(processos: readonly ProcessoParaFechamento[]): TotaisFechamentoFolha {
  const s = (f: (t: TotaisCalculoFolha) => number) => processos.reduce((a, p) => a + f(p.totais), 0);
  return {
    processos: processos.length,
    proventos: s((t) => t.proventos),
    descontos: s((t) => t.descontos),
    liquido: s((t) => t.liquido),
    inss: s((t) => t.inss),
    irrf: s((t) => t.irrf),
    fgts: s((t) => t.fgts),
    encargos: s((t) => t.inssPatronal + t.rat + t.terceiros),
  };
}

const ROTULO_TIPO: Readonly<Record<TipoProcessoFolha, string>> = {
  mensal: 'Folha mensal',
  ferias: 'Recibo de férias',
  rescisao: 'Rescisão',
  decimo1: '13º salário, 1ª parcela',
  decimo2: '13º salário, 2ª parcela',
};

/**
 * A prova da soma (toda conta agregada com as parcelas): o líquido de cada processamento, a soma deles e
 * proventos − descontos = líquido no total; cada processamento também precisa fechar a própria conta.
 */
export function conferirFechamentoFolha(
  processos: readonly ProcessoParaFechamento[],
  totais: TotaisFechamentoFolha,
): ConferenciaFechamentoFolha {
  const parcelas = processos.map((p) => ({
    rotulo: `${ROTULO_TIPO[p.tipo]} ${p.competencia} (processamento ${p.id})`,
    valor: p.totais.liquido,
  }));
  const somaLiquidos = parcelas.reduce((a, x) => a + x.valor, 0);
  const divergencias: string[] = [];
  for (const p of processos)
    if (p.totais.proventos - p.totais.descontos !== p.totais.liquido)
      divergencias.push(`O processamento ${p.id} não fecha: proventos − descontos ≠ líquido.`);
  if (somaLiquidos !== totais.liquido)
    divergencias.push('A soma dos líquidos dos processamentos não confere com o total.');
  if (totais.proventos - totais.descontos !== totais.liquido)
    divergencias.push('Proventos − descontos ≠ líquido no total do período.');
  return {
    ok: divergencias.length === 0,
    parcelas: [
      ...parcelas,
      { rotulo: 'Soma dos líquidos', valor: somaLiquidos },
      { rotulo: 'Proventos', valor: totais.proventos },
      { rotulo: 'Descontos', valor: totais.descontos },
      { rotulo: 'Líquido (proventos − descontos)', valor: totais.liquido },
    ],
    divergencias,
  };
}

/** O texto canônico do que o fechamento fixa (o chamador tira o SHA-256 dele): ID e resumo de cada processamento. */
export const textoResumoFechamento = (processos: readonly ProcessoNoFechamento[]): string =>
  processos.map((p) => `${p.id}:${p.tipo}:${p.competencia}:${p.resumo}:${p.pagamento ?? ''}`).join('\n');
