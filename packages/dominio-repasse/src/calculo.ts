// Motor do repasse por item (M33; regras 1, 4, 5 e 6): escolhe a regra, apura a base, aplica percentual ou valor fixo
// e o adicional do dia e devolve a memória de cálculo (SGH_REP_MEMORIA_CALCULO) com as parcelas, as regras ignoradas e
// a pendência quando o item não vira repasse. Nada é gravado aqui.
import type { BaseCalculoRepasse, DimensaoRegra, PendenciaApuracao } from '@sgh/contratos';
import { type Adicional, adicionalDoDia, aplicarAdicional, type ModoAdicional } from './adicionais.js';
import { baseDoItem } from './base-calculo.js';
import { aplicarPercentual, centavos } from './dinheiro.js';
import type { ItemProducao, RegraRepasse } from './regra.js';
import { type RegraRepasseParticularIntegral, repasseIntegralVale } from './particular-integral.js';
import { type RegraIgnorada, resolverRegra } from './resolver-regra.js';

export interface OpcoesCalculo {
  readonly basePadrao: BaseCalculoRepasse;
  readonly modoAdicional: ModoAdicional;
  readonly feriados: ReadonlySet<string>;
  /**
   * ADR 0009: a marca da origem "consulta particular vai inteira ao médico" (regra de repasse 100%). Quando vale para
   * o item, o repasse é o valor COBRADO inteiro, antes das regras comuns e sem adicional.
   */
  readonly integrais?: readonly RegraRepasseParticularIntegral[];
  /** As fontes pagadoras do tipo particular: só nelas a regra integral vale (ADR 0009). */
  readonly fontesParticulares?: ReadonlySet<number>;
  /** O grupo de faturamento de cada procedimento (para a regra integral por grupo). */
  readonly grupoDoProcedimento?: ReadonlyMap<number, number>;
}

export interface MemoriaCalculo {
  readonly item: number;
  readonly beneficiario: number | null;
  readonly regra: number | null;
  readonly dimensoes: readonly DimensaoRegra[];
  readonly ignoradas: readonly RegraIgnorada[];
  readonly base: BaseCalculoRepasse | null;
  readonly origemBase: 'cobrado' | 'recebido' | null;
  readonly baseCentavos: number;
  readonly percentual: number;
  readonly valorFixoCentavos: number;
  /** Valor antes do adicional. */
  readonly valorSemAdicionalCentavos: number;
  readonly adicional: Adicional | null;
  readonly valorCentavos: number;
  readonly pendencia: PendenciaApuracao | null;
}

function pendente(
  item: ItemProducao,
  pendencia: PendenciaApuracao,
  parcial: Partial<MemoriaCalculo> = {},
): MemoriaCalculo {
  return {
    item: item.id,
    beneficiario: item.executante,
    regra: null,
    dimensoes: [],
    ignoradas: [],
    base: null,
    origemBase: null,
    baseCentavos: 0,
    percentual: 0,
    valorFixoCentavos: 0,
    valorSemAdicionalCentavos: 0,
    adicional: null,
    valorCentavos: 0,
    ...parcial,
    pendencia,
  };
}

export function calcularItem(
  item: ItemProducao,
  regras: readonly RegraRepasse[],
  o: OpcoesCalculo,
): MemoriaCalculo {
  if (item.executante === null) return pendente(item, 'sem-executante');
  const executante = item.executante;
  const integral = (o.integrais ?? []).find((x) =>
    repasseIntegralVale(x, {
      fontePagadoraId: item.convenio,
      fonteParticular: o.fontesParticulares?.has(item.convenio) ?? false,
      profissionalId: executante,
      itemFaturavelId: item.procedimento,
      grupoFaturamentoId: o.grupoDoProcedimento?.get(item.procedimento) ?? null,
    }),
  );
  if (integral) {
    const base = centavos(item.cobrado);
    const valor = aplicarPercentual(base, integral.percentual);
    const dimensoes: DimensaoRegra[] = ['convenio', 'procedimento'];
    if (integral.profissionalId !== null) dimensoes.unshift('profissional');
    return {
      item: item.id,
      beneficiario: executante,
      regra: null,
      dimensoes,
      ignoradas: [],
      base: 'cobrado',
      origemBase: 'cobrado',
      baseCentavos: base,
      percentual: integral.percentual,
      valorFixoCentavos: 0,
      valorSemAdicionalCentavos: valor,
      adicional: null,
      valorCentavos: valor,
      pendencia: null,
    };
  }
  const r = resolverRegra(item, regras);
  if (!r.regra) return pendente(item, 'sem-regra', { ignoradas: r.ignoradas });
  const regra = r.regra;
  const comum = { regra: regra.id, dimensoes: r.dimensoes, ignoradas: r.ignoradas };
  // Sem percentual e sem valor fixo só existe na regra migrada (o banco recusa nas demais): o item fica pendente para
  // a regra receber o valor, em vez de virar repasse de R$ 0,00 calado.
  if (!(regra.percentual > 0) && !(regra.valorFixo > 0))
    return pendente(item, 'regra-migrada-sem-valor', comum);
  const b = baseDoItem(item, regra.base, o.basePadrao);
  if (!b.ok) return pendente(item, b.pendencia, comum);
  const fixo = regra.percentual > 0 ? 0 : centavos(regra.valorFixo);
  const sem = regra.percentual > 0 ? aplicarPercentual(b.valor.centavos, regra.percentual) : fixo;
  const adicional = adicionalDoDia(regra, item.data, o.feriados);
  const valor = aplicarAdicional(
    { baseCentavos: b.valor.centavos, percentual: regra.percentual, valorCentavos: sem },
    adicional,
    o.modoAdicional,
  );
  return {
    item: item.id,
    beneficiario: item.executante,
    ...comum,
    base: b.valor.base,
    origemBase: b.valor.origem,
    baseCentavos: b.valor.centavos,
    percentual: regra.percentual,
    valorFixoCentavos: fixo,
    valorSemAdicionalCentavos: sem,
    adicional,
    valorCentavos: valor,
    pendencia: null,
  };
}

/** Itens já integrados à apuração não entram de novo (ficha, seção 5, repasse.integrarItens). */
export function calcularPeriodo(
  itens: readonly ItemProducao[],
  regras: readonly RegraRepasse[],
  jaIntegrados: ReadonlySet<number>,
  o: OpcoesCalculo,
): MemoriaCalculo[] {
  return itens.map((i) =>
    jaIntegrados.has(i.id) ? pendente(i, 'ja-integrado') : calcularItem(i, regras, o),
  );
}
