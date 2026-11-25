// Índices de cobrança e portes (06-FAT linha 5): o valor do honorário no modelo CH (AMB) ou PORTE (CBHPM) sai do
// índice do acordo × a quantidade do item, nunca da soma dos componentes da vigência. Aqui ficam as regras puras:
//   - a precedência do índice: o do procedimento (valor do índice por item) vence o do setor executante, que vence o
//     do acordo; cada chave (1 CH, 4 filme, 5 UCO) resolve sozinha, e a origem fica dita no passo;
//   - o total do item: modelo VALOR pela vigência; CH e PORTE pelos índices (com o porte anestésico do acordo no
//     regime do atendimento, em horário especial quando pedido); faltando um índice, o total é nulo e a falta é dita
//     (nunca a soma da vigência em silêncio);
//   - a validação do registro de um valor de índice ou de porte por vigência (nova vigência; nada se apaga).
import {
  centavos,
  type Componentes,
  explicarValor,
  type ItemParaValor,
  totalComponentes,
} from './modelo-valor.js';

/** Nível de onde saiu o valor do índice. */
export type NivelIndice = 'item' | 'setor' | 'acordo';

const ROTULO_NIVEL: Readonly<Record<NivelIndice, string>> = {
  item: 'do procedimento',
  setor: 'do setor executante',
  acordo: 'do acordo',
};

const ROTULO_CHAVE: Readonly<Record<number, string>> = { 1: 'CH', 4: 'filme', 5: 'UCO' };

export interface IndicesPorNivel {
  readonly acordo: ReadonlyMap<number, number>;
  readonly setor?: ReadonlyMap<number, number> | null;
  readonly item?: ReadonlyMap<number, number> | null;
}

export interface IndicesResolvidos {
  readonly valores: ReadonlyMap<number, number>;
  readonly origem: ReadonlyMap<number, NivelIndice>;
}

/** Por chave do índice: o do procedimento, senão o do setor, senão o do acordo. */
export function resolverIndices(n: IndicesPorNivel): IndicesResolvidos {
  const valores = new Map<number, number>();
  const origem = new Map<number, NivelIndice>();
  const niveis: [NivelIndice, ReadonlyMap<number, number> | null | undefined][] = [
    ['acordo', n.acordo],
    ['setor', n.setor],
    ['item', n.item],
  ];
  for (const [nivel, m] of niveis)
    for (const [chave, v] of m ?? []) {
      valores.set(chave, v);
      origem.set(chave, nivel);
    }
  return { valores, origem };
}

/** Os passos que dizem de onde saiu cada índice diferenciado (o do acordo não precisa de nota). */
export function passosDaOrigem(r: IndicesResolvidos): string[] {
  return [...r.origem.entries()]
    .filter(([, nivel]) => nivel !== 'acordo')
    .sort(([a], [b]) => a - b)
    .map(
      ([chave, nivel]) =>
        `Índice ${ROTULO_CHAVE[chave] ?? chave} ${ROTULO_NIVEL[nivel]}: ${r.valores.get(chave)}.`,
    );
}

export interface PorteAnestesicoNaData {
  readonly valor: number;
  readonly valorHorarioEspecial: number | null;
}

export interface EntradaTotalHonorario {
  readonly item: ItemParaValor & { readonly porteAnestesico?: string | null };
  readonly vigente: Componentes | null;
  readonly indices: IndicesResolvidos;
  /** Valor do porte de honorário do item no acordo na data. */
  readonly porte: number | null;
  /** Porte anestésico do acordo no regime e na data do atendimento (null: o item não tem ou o acordo não valora). */
  readonly porteAnestesico?: PorteAnestesicoNaData | null;
  readonly horarioEspecial?: boolean;
  /** Quantidade cobrada (padrão 1). */
  readonly quantidade?: number;
}

export interface TotalHonorario {
  readonly modelo: 'VALOR' | 'PORTE' | 'CH';
  /** De onde saiu o total: dos índices (CH ou PORTE) ou da vigência do valor (VALOR); null quando falta algo. */
  readonly origem: 'indice' | 'vigencia' | null;
  readonly total: number | null;
  readonly passos: readonly string[];
  readonly falta: readonly string[];
}

/**
 * Total do item: modelo VALOR = soma dos componentes da vigência × quantidade; CH e PORTE = a regra do modelo pelos
 * índices × quantidade, mais o porte anestésico do acordo quando o item tem porte anestésico. Faltando índice (ou o
 * valor do porte anestésico do item), o total é nulo e a falta é dita.
 */
export function totalDoHonorario(e: EntradaTotalHonorario): TotalHonorario {
  const qtd = e.quantidade ?? 1;
  const ind = e.indices.valores;
  const ex = explicarValor(e.item, e.vigente, {
    ch: ind.get(1) ?? null,
    filme: ind.get(4) ?? null,
    uco: ind.get(5) ?? null,
    porte: e.porte,
  });
  if (ex.modelo === 'VALOR') {
    const total = e.vigente ? centavos(totalComponentes(e.vigente) * qtd) : null;
    return {
      modelo: 'VALOR',
      origem: total === null ? null : 'vigencia',
      total,
      passos: qtd === 1 ? ex.passos : [...ex.passos, `× quantidade ${qtd} = ${total}`],
      falta: ex.falta,
    };
  }
  const passos = [...passosDaOrigem(e.indices), ...ex.passos];
  const falta = [...ex.falta];
  const pa = e.item.porteAnestesico?.trim() ? e.item.porteAnestesico.trim() : null;
  let anestesia = 0;
  if (pa !== null) {
    if (!e.porteAnestesico) falta.push(`valor do porte anestésico ${pa} do acordo na data`);
    else {
      const especial = e.horarioEspecial === true && e.porteAnestesico.valorHorarioEspecial !== null;
      anestesia = especial ? (e.porteAnestesico.valorHorarioEspecial ?? 0) : e.porteAnestesico.valor;
      passos.push(
        `Porte anestésico ${pa}${especial ? ' em horário especial' : ''}: ${anestesia} (tabela do acordo no regime e na data).`,
      );
    }
  }
  if (falta.length > 0 || ex.total === null)
    return { modelo: ex.modelo, origem: null, total: null, passos, falta };
  const total = centavos((ex.total + anestesia) * qtd);
  passos.push(
    `Total pelo índice = (${centavos(ex.total)}${anestesia ? ` + ${anestesia}` : ''})${qtd === 1 ? '' : ` × ${qtd}`} = ${total}.`,
  );
  return { modelo: ex.modelo, origem: 'indice', total, passos, falta: [] };
}

// ── Registro do valor do índice ou do porte por vigência ─────────────────────────────────────────────────────

export const TIPOS_REGISTRO_INDICE = ['indice', 'porte', 'porte-anestesico'] as const;
export type TipoRegistroIndice = (typeof TIPOS_REGISTRO_INDICE)[number];

export interface EntradaRegistroIndice {
  readonly tipo: TipoRegistroIndice;
  readonly vigenciaInicio: string;
  readonly valor: number;
  readonly valorHorarioEspecial?: number | null;
  /** Inícios de vigência já gravados para o mesmo índice ou porte no mesmo escopo (fora as linhas de exclusão). */
  readonly vigenciasExistentes: readonly string[];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const casas = (v: number) => (String(v).split('.')[1] ?? '').length;

/**
 * O valor é um número não negativo (até 6 casas no índice, 2 no porte de honorário e 4 no porte anestésico, como nas
 * tabelas oficiais); o início é uma data e ainda não tem vigência gravada (a mudança de valor é sempre uma vigência
 * nova; a anterior continua no histórico). O valor em horário especial é só do porte anestésico e não fica abaixo do
 * valor comum.
 */
export function validarRegistroIndice(e: EntradaRegistroIndice): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!(TIPOS_REGISTRO_INDICE as readonly string[]).includes(e.tipo))
    erros['tipo'] = 'Tipo de valor desconhecido.';
  if (!DATA.test(e.vigenciaInicio ?? '') || Number.isNaN(Date.parse(e.vigenciaInicio)))
    erros['vigenciaInicio'] = 'Informe o início da vigência.';
  else if (e.vigenciasExistentes.includes(e.vigenciaInicio))
    erros['vigenciaInicio'] =
      'Já existe valor com início nesta data: a mudança de valor é uma vigência nova, com outra data de início.';
  const maxCasas = e.tipo === 'indice' ? 6 : e.tipo === 'porte' ? 2 : 4;
  if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor < 0)
    erros['valor'] = 'Informe um valor maior ou igual a zero.';
  else if (casas(e.valor) > maxCasas) erros['valor'] = `O valor aceita até ${maxCasas} casas decimais.`;
  const he = e.valorHorarioEspecial;
  if (he !== null && he !== undefined) {
    if (e.tipo !== 'porte-anestesico')
      erros['valorHorarioEspecial'] = 'O valor em horário especial é só do porte anestésico.';
    else if (!Number.isFinite(he) || he < 0)
      erros['valorHorarioEspecial'] = 'Informe um valor maior ou igual a zero.';
    else if (casas(he) > 4) erros['valorHorarioEspecial'] = 'O valor aceita até 4 casas decimais.';
    else if (typeof e.valor === 'number' && he < e.valor)
      erros['valorHorarioEspecial'] = 'O valor em horário especial não fica abaixo do valor comum.';
  }
  return erros;
}
