// Composição da dieta por refeição na tela da prescrição (03-PEP L112): a linha como a tela a edita (texto), a
// conversão para o contrato do item e a conferência na hora pela mesma regra do domínio que o servidor repete
// (conferirRefeicoesDieta). Só a dieta oral e a livre têm refeições.
import {
  type ClasseDieta,
  conferirRefeicoesDieta,
  MENSAGENS_ITEM_GRAVAVEL,
  type RefeicaoDietaGravavel,
} from '@sgh/dominio-pep';

export interface LinhaRefeicao {
  refeicao: string;
  alimento: string;
  quantidade: string;
  medidaCaseira: string;
  quantidadeMedidaCaseira: string;
  /** Posição (1..n) do titular que este alimento pode trocar; nulo no titular. */
  substitui: number | null;
  percentualDiario: string;
}

export const CLASSE_COM_REFEICOES: Readonly<Record<string, ClasseDieta>> = {
  'dieta-livre': 'livre',
  'dieta-oral': 'oral',
};

const numero = (x: string): number | null => (x.trim() === '' ? null : Number(x.replace(',', '.')));
const ident = (x: string): number | null => (x === '' ? null : Number(x));

export function linhaVazia(refeicao = '', substitui: number | null = null): LinhaRefeicao {
  return {
    refeicao,
    alimento: '',
    quantidade: '',
    medidaCaseira: '',
    quantidadeMedidaCaseira: '',
    substitui,
    percentualDiario: '',
  };
}

/** As linhas no formato do contrato (o esquema do item confere o que faltar). */
export function refeicoesDoContrato(linhas: readonly LinhaRefeicao[]) {
  return linhas.map((l) => ({
    refeicao: ident(l.refeicao),
    alimento: ident(l.alimento),
    quantidade: numero(l.quantidade),
    unidade: null,
    medidaCaseira: ident(l.medidaCaseira),
    quantidadeMedidaCaseira: numero(l.quantidadeMedidaCaseira),
    substitui: l.substitui,
    // O substituto troca o titular: a parte das calorias é a do titular.
    percentualDiario: l.substitui === null ? numero(l.percentualDiario) : null,
    calorias: null,
  }));
}

/** A soma da parte das calorias do dia nos titulares (os substitutos não somam). */
export function percentualDaComposicao(linhas: readonly LinhaRefeicao[]): number {
  return linhas
    .filter((l) => l.substitui === null)
    .reduce((s, l) => s + (numero(l.percentualDiario) ?? 0), 0);
}

/**
 * A recusa do domínio para a composição, em texto, ou nulo. Só confere quando toda linha tem refeição, alimento e
 * quantidade (linha incompleta é o esquema do item que aponta ao incluir).
 */
export function recusaDaComposicao(classe: ClasseDieta, linhas: readonly LinhaRefeicao[]): string | null {
  if (linhas.length === 0) return null;
  const r = refeicoesDoContrato(linhas);
  if (r.some((x) => x.refeicao === null || x.alimento === null || x.quantidade === null)) return null;
  const codigo = conferirRefeicoesDieta(classe, r as RefeicaoDietaGravavel[]);
  return codigo === null ? null : MENSAGENS_ITEM_GRAVAVEL[codigo];
}

/** Tira a linha `i` (base 0) com os substitutos dela e renumera os que apontam para depois dela. */
export function removerLinha(linhas: readonly LinhaRefeicao[], i: number): LinhaRefeicao[] {
  const pos = i + 1;
  const fica: LinhaRefeicao[] = [];
  const nova = new Map<number, number>();
  linhas.forEach((l, j) => {
    if (j === i || l.substitui === pos) return;
    nova.set(j + 1, fica.length + 1);
    fica.push(l);
  });
  return fica.map((l) => (l.substitui === null ? l : { ...l, substitui: nova.get(l.substitui) ?? null }));
}

/** Acrescenta o substituto logo depois do titular `i` (e dos substitutos dele), na mesma refeição. */
export function acrescentarSubstituto(linhas: readonly LinhaRefeicao[], i: number): LinhaRefeicao[] {
  let fim = i + 1;
  while (fim < linhas.length && linhas[fim]!.substitui === i + 1) fim++;
  const renum = (l: LinhaRefeicao) =>
    l.substitui !== null && l.substitui > fim ? { ...l, substitui: l.substitui + 1 } : l;
  return [
    ...linhas.slice(0, fim).map(renum),
    linhaVazia(linhas[i]!.refeicao, i + 1),
    ...linhas.slice(fim).map(renum),
  ];
}
