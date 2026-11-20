// O cálculo e o fechamento do balanço hídrico (M45, etapa 3; regra 6): ganhos por grupo, perdas por tipo de
// eliminação, perdas insensíveis pela fórmula versionada, o saldo, a diurese e o débito urinário. A conta é feita em
// décimos de mL inteiros (o saldo bate exatamente com as parcelas, como o CHECK do banco confere) e sai impressa. O
// fechamento parcial vai do início da janela até agora; o de 24 horas, a janela inteira, só depois da hora de corte, uma
// vez só. Os ganhos da checagem e a diurese dos sinais ainda não lançados entram no cálculo e no fechamento.
import {
  type CalculoBalanco,
  type DominiosBalanco,
  type FechamentoBalancoLido,
  jcs,
  type LancamentoBalancoLido,
  type PendenteBalanco,
  sha256Hex,
  TIPO_ELIMINACAO_DIURESE,
  type TipoFechamentoBalanco,
} from '@sgh/contratos';
import { diferencaMinutos } from '../tempo.js';
import { debitoUrinario, type FormulaInsensivel, formatarMl, perdaInsensivel } from './insensiveis.js';
import type { RecusaBalanco } from './lancamento.js';

export type ParcelaDeCalculo = Pick<
  LancamentoBalancoLido,
  'sentido' | 'grupo' | 'tipoEliminacao' | 'volumeMl' | 'horaReal'
>;

const decimos = (ml: number) => Math.round(ml * 10);
const ml = (d: number) => d / 10;

export type CalculoSemImpressao = Omit<CalculoBalanco, 'impressao'>;

/** O cálculo do balanço do intervalo [inicio, ate), com as parcelas impressas. */
export function calcularBalanco(e: {
  readonly inicio: string;
  readonly ate: string;
  /** Os lançamentos vigentes (sem estornos e estornados) e os pendentes (checagem e sinais ainda não lançados). */
  readonly parcelas: readonly ParcelaDeCalculo[];
  readonly pesoKg: number | null;
  readonly temperaturaMaxima: number | null;
  readonly formula: FormulaInsensivel;
  readonly dominios: DominiosBalanco;
  /** O parcial (até agora) inclui o minuto de agora; o de 24 horas vai até antes da hora de corte. */
  readonly ateInclusivo?: boolean;
}): CalculoSemImpressao {
  const dentro = (h: string) => h >= e.inicio && (h < e.ate || (e.ateInclusivo === true && h === e.ate));
  const no = e.parcelas.filter((p) => dentro(p.horaReal.slice(0, 16)));
  const horas = Math.max(0, diferencaMinutos(e.inicio, e.ate)) / 60;
  const nomeGrupo = (c: number | null) =>
    e.dominios.grupos.find((g) => g.codigo === c)?.nome ?? `grupo ${String(c)}`;
  const nomeTipo = (c: number | null) =>
    e.dominios.tiposEliminacao.find((t) => t.codigo === c)?.nome ?? `tipo ${String(c)}`;
  const somar = (lista: readonly ParcelaDeCalculo[], chave: (p: ParcelaDeCalculo) => string) => {
    const m = new Map<string, number>();
    for (const p of lista) m.set(chave(p), (m.get(chave(p)) ?? 0) + decimos(p.volumeMl));
    return [...m.entries()].map(([rotulo, d]) => ({ rotulo, d }));
  };
  const ganhos = somar(
    no.filter((p) => p.sentido === 'ganho'),
    (p) => nomeGrupo(p.grupo),
  );
  const perdas = somar(
    no.filter((p) => p.sentido === 'perda'),
    (p) => nomeTipo(p.tipoEliminacao),
  );
  const gD = ganhos.reduce((a, x) => a + x.d, 0);
  const pD = perdas.reduce((a, x) => a + x.d, 0);
  const diuD = no
    .filter((p) => p.sentido === 'perda' && p.tipoEliminacao === TIPO_ELIMINACAO_DIURESE)
    .reduce((a, p) => a + decimos(p.volumeMl), 0);
  const pi = perdaInsensivel(e.formula, e.pesoKg, horas, e.temperaturaMaxima);
  const iD = decimos(pi.ml);
  const sD = gD - pD - iD;
  const deb = debitoUrinario(e.formula, ml(diuD), e.pesoKg, horas);
  const lista = (xs: { rotulo: string; d: number }[]) =>
    xs.length ? xs.map((x) => `${x.rotulo} ${formatarMl(ml(x.d))}`).join(' + ') : 'nenhum';
  return {
    inicio: e.inicio,
    ate: e.ate,
    horas: Math.round(horas * 10) / 10,
    ganhosMl: ml(gD),
    ganhos: ganhos.map((x) => ({ rotulo: x.rotulo, ml: ml(x.d) })),
    perdasMl: ml(pD),
    perdas: perdas.map((x) => ({ rotulo: x.rotulo, ml: ml(x.d) })),
    insensiveisMl: ml(iD),
    insensiveisConta: pi.conta,
    saldoMl: ml(sD),
    saldoConta: `Saldo: ganhos ${formatarMl(ml(gD))} (${lista(ganhos)}) - perdas ${formatarMl(ml(pD))} (${lista(perdas)}) - insensíveis ${formatarMl(ml(iD))} = ${formatarMl(ml(sD))} mL.`,
    diureseMl: ml(diuD),
    pesoKg: e.pesoKg,
    temperaturaMaxima: e.temperaturaMaxima,
    debitoUrinario: deb.valor,
    debitoConta: deb.conta,
    oliguria: deb.oliguria,
    formula: e.formula.versao,
    lancamentos: no.length,
  };
}

/** A impressão SHA-256 do cálculo (JCS): o fechamento só passa se o que a tela viu é o que o servidor recalculou. */
export async function impressaoDoCalculo(c: CalculoSemImpressao): Promise<string> {
  return sha256Hex(
    jcs({
      inicio: c.inicio,
      ate: c.ate,
      ganhos: c.ganhos,
      perdas: c.perdas,
      insensiveis: c.insensiveisMl,
      saldo: c.saldoMl,
      diurese: c.diureseMl,
      peso: c.pesoKg,
      formula: c.formula,
      lancamentos: c.lancamentos,
    }),
  );
}

export async function comImpressao(c: CalculoSemImpressao): Promise<CalculoBalanco> {
  return { ...c, impressao: await impressaoDoCalculo(c) };
}

/** As parcelas do cálculo: os lançamentos vigentes e os pendentes. */
export function parcelasDoBalanco(
  vigentes: readonly ParcelaDeCalculo[],
  pendentes: readonly PendenteBalanco[],
): ParcelaDeCalculo[] {
  return [
    ...vigentes,
    ...pendentes.map((p) => ({
      sentido: p.sentido,
      grupo: p.grupo,
      tipoEliminacao: p.tipoEliminacao,
      volumeMl: p.volumeMl,
      horaReal: p.horaReal,
    })),
  ];
}

/** O fechamento pode ser feito? Devolve até onde ele vai. */
export function conferirFechamento(e: {
  readonly tipo: TipoFechamentoBalanco;
  readonly janela: { readonly inicio: string; readonly fim: string };
  readonly agora: string;
  readonly fechamentos: readonly Pick<FechamentoBalancoLido, 'tipo' | 'inicio' | 'fim'>[];
}): { readonly ok: true; readonly ate: string } | RecusaBalanco {
  const agora = e.agora.slice(0, 16);
  if (agora <= e.janela.inicio)
    return { ok: false, codigo: 'janela-futura', mensagem: 'A janela do balanço ainda não começou.' };
  const total = e.fechamentos.some((f) => f.tipo === 'total' && f.inicio === e.janela.inicio);
  if (total)
    return {
      ok: false,
      codigo: 'ja-fechado',
      mensagem: 'O balanço de 24 horas desta janela já foi fechado.',
    };
  if (e.tipo === 'total') {
    if (agora < e.janela.fim)
      return {
        ok: false,
        codigo: 'janela-em-curso',
        mensagem: `O balanço de 24 horas fecha na hora de corte (${e.janela.fim.replace('T', ' ')}): até lá, feche o parcial.`,
      };
    return { ok: true, ate: e.janela.fim };
  }
  const ate = agora < e.janela.fim ? agora : e.janela.fim;
  if (e.fechamentos.some((f) => f.tipo === 'parcial' && f.inicio === e.janela.inicio && f.fim === ate))
    return {
      ok: false,
      codigo: 'ja-fechado',
      mensagem: 'O parcial deste instante já foi fechado: aguarde um minuto ou feche o de 24 horas.',
    };
  return { ok: true, ate };
}

/** O texto das parcelas guardado no fechamento (a conta inteira, sem reticências). */
export function textoDoFechamento(c: CalculoSemImpressao): string {
  return [c.saldoConta, c.insensiveisConta, c.debitoConta ?? 'Débito urinário: sem o peso do paciente.']
    .join(' ')
    .slice(0, 2000);
}
