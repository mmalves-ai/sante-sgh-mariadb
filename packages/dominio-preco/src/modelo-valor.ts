// Três modelos de honorário (ficha do M12, regra 3; cap-06a §6.2; cap-11 §11.3; ref 05 §1.3 e §1.4): o valor
// de um procedimento vem
//   - VALOR: dos cinco componentes datados da vigência de valor do procedimento (honorário, custo operacional,
//     filme, anestesia e outros), que somados dão o total;
//   - PORTE (CBHPM): do valor do porte do convênio vezes a fração do porte do item, mais
//     custo operacional e filme pelos índices;
//   - CH (AMB): do coeficiente CH do item (≠ 0) vezes o valor do CH do convênio (índices do convênio), mais
//     o filme pelo índice de filme (índice × (CH + custo operacional) + índice do filme × filme).
// O coeficiente CH do item muda de sentido conforme a tabela: no modelo VALOR é 0 e o preço está no componente
// de honorário da vigência de valor.
// O novo nunca calcula a conta (o motor é o do legado): a explicação aqui serve à consulta e ao veto do
// reajuste (o reajuste do modelo CH é pelo índice: preco.registrarIndice, especificada para a onda 4).

export type ModeloHonorario = 'VALOR' | 'PORTE' | 'CH';

export interface Componentes {
  readonly ch: number;
  readonly co: number;
  readonly filme: number;
  readonly anes: number;
  readonly outros: number;
}

export const COMPONENTES_ZERO: Componentes = { ch: 0, co: 0, filme: 0, anes: 0, outros: 0 };

/** Os cinco componentes, na ordem da vigência de valor do procedimento. */
export const NOMES_COMPONENTES: readonly (keyof Componentes)[] = ['ch', 'co', 'filme', 'anes', 'outros'];

/** Soma dos cinco componentes (total da vigência de valor), sem arredondar (arredondar é da apresentação). */
export function totalComponentes(c: Componentes): number {
  return c.ch + c.co + c.filme + c.anes + c.outros;
}

/** Arredondamento a centavos para exibir e comparar (nunca na gravação de valor informado). */
export function centavos(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PerfilTabelaHonorario {
  /** Itens da tabela de honorários. */
  readonly itens: number;
  /** Itens com CH ≠ 0 (coeficiente AMB). */
  readonly comCh: number;
  /** Itens com porte CBHPM (PMEDICO preenchido). */
  readonly comPorte: number;
}

/** Modelo predominante da tabela: CH se metade ou mais dos itens tem CH; PORTE se tem porte; senão VALOR. */
export function modeloDaTabela(p: PerfilTabelaHonorario): ModeloHonorario {
  if (p.itens <= 0) return 'VALOR';
  if (p.comCh * 2 >= p.itens) return 'CH';
  if (p.comPorte * 2 >= p.itens) return 'PORTE';
  return 'VALOR';
}

export interface ItemHonorarioModelo {
  readonly ch: number;
  readonly porte?: string | null;
}

/** Modelo do item: CH ≠ 0 é AMB; porte preenchido é CBHPM; senão o valor datado. */
export function modeloDoItem(i: ItemHonorarioModelo): ModeloHonorario {
  if (i.ch !== 0) return 'CH';
  if (i.porte && i.porte.trim() !== '') return 'PORTE';
  return 'VALOR';
}

export interface IndicesConvenio {
  /** Valor do CH (índice do convênio para o CH, ou o índice do ato do item). */
  readonly ch?: number | null;
  /** Valor do m² de filme (índice do convênio para o filme). */
  readonly filme?: number | null;
  /** Valor da UCO (índice do convênio para o custo operacional). */
  readonly uco?: number | null;
  /** Valor do porte do convênio para o porte do item. */
  readonly porte?: number | null;
}

export interface ItemParaValor {
  readonly ch: number;
  readonly porte?: string | null;
  /** Fração do porte do item (0,01 / 0,04 / 0,10…); null = porte inteiro. */
  readonly fracaoPorte?: number | null;
  /** Custo operacional do item em UCO. */
  readonly cope?: number | null;
  /** Filme do item em m². */
  readonly filmeM2?: number | null;
}

export interface ExplicacaoValor {
  readonly modelo: ModeloHonorario;
  /** null: falta um índice para calcular (a explicação diz qual). */
  readonly total: number | null;
  readonly passos: readonly string[];
  readonly falta: readonly string[];
}

const br = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Explica o valor de um item na data (sem calcular conta: só a regra do modelo, passo a passo). */
export function explicarValor(
  item: ItemParaValor,
  vigente: Componentes | null,
  indices: IndicesConvenio = {},
): ExplicacaoValor {
  const modelo = modeloDoItem(item);
  if (modelo === 'VALOR') {
    if (!vigente)
      return {
        modelo,
        total: null,
        passos: ['Modelo VALOR: o preço é a vigência de valor do procedimento na data.'],
        falta: ['vigência na data'],
      };
    const total = totalComponentes(vigente);
    return {
      modelo,
      total,
      passos: [
        'Modelo VALOR: total = CH + custo operacional + filme + anestesia + outros (vigência na data).',
        `${br(vigente.ch)} + ${br(vigente.co)} + ${br(vigente.filme)} + ${br(vigente.anes)} + ${br(vigente.outros)} = ${br(total)}`,
      ],
      falta: [],
    };
  }
  if (modelo === 'CH') {
    const falta: string[] = [];
    if (indices.ch == null) falta.push('valor do CH do convênio na data');
    const filme = item.filmeM2 ?? 0;
    if (filme !== 0 && indices.filme == null) falta.push('valor do filme do convênio na data');
    const passos = [
      'Modelo CH (AMB): total = valor do CH × (CH + custo operacional) + valor do filme × filme.',
    ];
    if (falta.length > 0) return { modelo, total: null, passos, falta };
    const total = (indices.ch ?? 0) * (item.ch + (item.cope ?? 0)) + (indices.filme ?? 0) * filme;
    passos.push(
      `${br(indices.ch ?? 0)} × (${br(item.ch)} + ${br(item.cope ?? 0)}) + ${br(indices.filme ?? 0)} × ${br(filme)} = ${br(total)}`,
    );
    return { modelo, total, passos, falta };
  }
  const falta: string[] = [];
  if (indices.porte == null) falta.push(`valor do porte ${item.porte ?? ''} do convênio na data`.trim());
  const cope = item.cope ?? 0;
  if (cope !== 0 && indices.uco == null) falta.push('valor da UCO do convênio na data');
  const filme = item.filmeM2 ?? 0;
  if (filme !== 0 && indices.filme == null) falta.push('valor do filme do convênio na data');
  const passos = [
    'Modelo PORTE (CBHPM): total = valor do porte × fração do porte + UCO × custo operacional + filme × m².',
  ];
  if (falta.length > 0) return { modelo, total: null, passos, falta };
  const fracao = item.fracaoPorte && item.fracaoPorte > 0 ? item.fracaoPorte : 1;
  const total = (indices.porte ?? 0) * fracao + (indices.uco ?? 0) * cope + (indices.filme ?? 0) * filme;
  passos.push(
    `${br(indices.porte ?? 0)} × ${br(fracao)} + ${br(indices.uco ?? 0)} × ${br(cope)} + ${br(indices.filme ?? 0)} × ${br(filme)} = ${br(total)}`,
  );
  return { modelo, total, passos, falta };
}
