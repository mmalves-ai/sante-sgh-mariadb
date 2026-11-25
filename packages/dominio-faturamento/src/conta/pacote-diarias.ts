// F3.4 (04-INT linha 81): pacote de diárias por acomodação. O pacote aplicado à conta (e não descaracterizado) traz as
// diárias que já estão no preço fechado, por acomodação (pacote_diaria_acomodacao) ou, sem linha da acomodação, pelo total
// do pacote. Regras puras (sem banco), sobre as diárias principais devidas da apuração:
// - em ordem de dia, cada diária principal (cheia ou parcial) na acomodação conta uma diária do pacote; enquanto houver
//   diária incluída, ela vira o lançamento "pacote-diaria:<pacote da conta>" sem cobrança (o mesmo item, para a conferência
//   e a guia), mais o item complementar da acomodação quando houver;
// - passadas as incluídas, a diária é cobrada: com o item da diária excedente da acomodação (e o valor da diária adicional,
//   quando o pacote o fixa) ou, sem ele, pela regra de diária de sempre; o item adicional da acomodação entra junto;
// - as diárias adicionais por faixa etária, a do acompanhante e as taxas não mudam (o pacote não as inclui);
// - chaves por dia: a apuração continua idempotente, e a troca (pacote aplicado ou descaracterizado) estorna e relança.
import type { LancamentoDesejado } from './admissao.js';

export interface DiariaDoPacoteNaAcomodacao {
  readonly categoriaAcomodacao: number;
  readonly incluidas: number;
  /** Item da diária cobrada além das incluídas (nulo: a diária da regra de sempre). */
  readonly itemExcedente: number | null;
  /** Valor fixo da diária além das incluídas (nulo: o preço da tabela). */
  readonly valorExcedente: number | null;
  readonly itemComplementar: number | null;
  readonly quantidadeComplementar: number | null;
  readonly itemAdicional: number | null;
  readonly quantidadeAdicional: number | null;
}

export interface PacoteDeDiarias {
  /** O pacote aplicado à conta (conta_hospitalar_pacote). */
  readonly contaPacote: number;
  /** Diárias do pacote sem linha da acomodação (nulo: o pacote não inclui diária fora das acomodações listadas). */
  readonly incluidasGeral: number | null;
  readonly acomodacoes: readonly DiariaDoPacoteNaAcomodacao[];
}

/** Recusa na hora a composição incoerente (quantidade negativa, item adicional sem quantidade). */
export function validarDiariaDoPacote(d: DiariaDoPacoteNaAcomodacao): string | null {
  if (!(d.incluidas >= 0)) return 'A quantidade de diárias incluídas não pode ser negativa.';
  if (d.valorExcedente !== null && !(d.valorExcedente >= 0))
    return 'O valor da diária adicional não pode ser negativo.';
  if (d.itemComplementar !== null && !((d.quantidadeComplementar ?? 0) > 0))
    return 'Informe a quantidade do item complementar.';
  if (d.itemAdicional !== null && !((d.quantidadeAdicional ?? 0) > 0))
    return 'Informe a quantidade do item adicional.';
  return null;
}

const principal = (x: LancamentoDesejado) => x.chave === 'diaria' || x.chave === 'diaria-parcial';

/** Os devidos com o pacote aplicado às diárias principais (o primeiro pacote da lista vale; os outros não somam). */
export function aplicarPacoteNasDiarias(
  devidos: readonly LancamentoDesejado[],
  pacotes: readonly PacoteDeDiarias[],
): LancamentoDesejado[] {
  const p = pacotes[0];
  if (!p) return [...devidos];
  const usadas = new Map<number | 'geral', number>();
  const fora = devidos.filter((x) => !principal(x));
  const dias = devidos.filter(principal).sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
  const out: LancamentoDesejado[] = [];
  const extra = (
    x: LancamentoDesejado,
    chave: string,
    item: number,
    quantidade: number,
  ): LancamentoDesejado => ({
    ...x,
    chave: `${chave}:${p.contaPacote}`,
    item,
    grupo: null,
    quantidade,
    valorFixo: null,
    regraDiaria: null,
    regraLancamento: null,
    regraItem: null,
    tabelaPreco: null,
    contaPacote: p.contaPacote,
  });
  for (const x of dias) {
    const acom = p.acomodacoes.find((a) => a.categoriaAcomodacao === x.categoriaAcomodacao) ?? null;
    if (acom && validarDiariaDoPacote(acom)) {
      out.push(x);
      continue;
    }
    const balde = acom ? acom.categoriaAcomodacao : 'geral';
    const limite = acom ? acom.incluidas : (p.incluidasGeral ?? 0);
    const ja = usadas.get(balde) ?? 0;
    if (ja < limite) {
      usadas.set(balde, ja + 1);
      out.push({ ...extra(x, 'pacote-diaria', x.item, x.quantidade), semCobranca: true });
      if (acom?.itemComplementar)
        out.push(extra(x, 'pacote-complementar', acom.itemComplementar, acom.quantidadeComplementar ?? 1));
      continue;
    }
    out.push(
      acom?.itemExcedente
        ? { ...x, item: acom.itemExcedente, valorFixo: acom.valorExcedente ?? null }
        : acom && acom.valorExcedente !== null
          ? { ...x, valorFixo: acom.valorExcedente }
          : x,
    );
    if (acom?.itemAdicional)
      out.push(extra(x, 'pacote-adicional', acom.itemAdicional, acom.quantidadeAdicional ?? 1));
  }
  return [...out, ...fora];
}
