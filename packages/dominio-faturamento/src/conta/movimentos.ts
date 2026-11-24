// Movimentos da conta do paciente (F3.7, 06-FAT linhas 14, 15 e 16), como regras puras (sem banco):
// - Linha 15: a equipe do item lançado (participantes com função, grau de participação e sequencial). O valor do ato
//   de cada participante sai do honorário do item pelo percentual da função (ou o informado), com a memória da conta.
// - Linha 16: o kit de cobrança lançado de uma vez na conta: "fechado" entra só o item que representa o kit; "aberto"
//   entra cada componente, na quantidade do kit vezes as vezes lançadas. O kit vale para a fonte e o plano dele.
// - Linha 14: a transferência de itens entre contas (outra conta do paciente, outra fonte pagadora ou outro
//   estabelecimento). O item de origem fica "transferido" (nunca apagado) e nasce o item na conta de destino, com o
//   preço refeito pela tabela do destino.
import { contaEditavel } from './complementos.js';

const r2 = (x: number) => Math.round(x * 100) / 100;

// ── Linha 15: equipe do item ──────────────────────────────────────────────────────────────────────

export type TipoFuncaoEquipe =
  'cirurgiao' | 'auxiliar' | 'anestesista' | 'instrumentador' | 'perfusionista' | 'clinico' | string;

/** Função da equipe na cobrança (cadastro da rede). */
export interface FuncaoEquipe {
  readonly id: number;
  readonly tipo: TipoFuncaoEquipe;
  readonly ativo: boolean;
  /** Percentual padrão do honorário do titular (nulo: 100 para o cirurgião, 0 para os demais). */
  readonly percentual: number | null;
  readonly grau: number | null;
  readonly ordemAuxiliar: number | null;
  readonly ordemApresentacao: number | null;
}

export const FORMAS_PAGAMENTO_PARTICIPANTE = [
  'via_hospital',
  'direto_fonte_pagadora',
  'paciente',
  'sem_cobranca',
] as const;
export type FormaPagamentoParticipante = (typeof FORMAS_PAGAMENTO_PARTICIPANTE)[number];

export interface ParticipanteInformado {
  readonly profissional: number;
  readonly funcao: number;
  /** Grau de participação (terminologia); nulo: o da função. */
  readonly grau?: number | null;
  /** Percentual do honorário; nulo: o da função. */
  readonly percentual?: number | null;
  readonly formaPagamento?: FormaPagamentoParticipante;
}

export interface ParticipanteCalculado {
  readonly sequencia: number;
  readonly profissional: number;
  readonly funcao: number;
  readonly grau: number | null;
  readonly percentual: number;
  readonly formaPagamento: FormaPagamentoParticipante;
  readonly valorAto: number;
}

/** Funções que só admitem uma pessoa por item (o auxiliar, uma por ordem). */
const FUNCOES_UNICAS = new Set(['cirurgiao', 'anestesista']);

/** Confere a equipe informada; erros por campo ("participantes.<i>.<campo>"). Lista vazia retira a equipe. */
export function validarEquipeItem(
  participantes: readonly ParticipanteInformado[],
  funcoes: ReadonlyMap<number, FuncaoEquipe>,
): Record<string, string> {
  const erros: Record<string, string> = {};
  const vistos = new Set<string>();
  const unicas = new Map<string, number>();
  participantes.forEach((p, i) => {
    const f = funcoes.get(p.funcao);
    if (!f || !f.ativo) {
      erros[`participantes.${i}.funcao`] = 'A função da equipe não existe ou está inativa.';
      return;
    }
    const chave = `${p.profissional}:${p.funcao}`;
    if (vistos.has(chave))
      erros[`participantes.${i}.profissional`] = 'O profissional já está na equipe nesta função.';
    vistos.add(chave);
    const unica = FUNCOES_UNICAS.has(f.tipo)
      ? f.tipo
      : f.tipo === 'auxiliar'
        ? `auxiliar:${f.ordemAuxiliar ?? 0}`
        : null;
    if (unica) {
      const ja = unicas.get(unica);
      if (ja !== undefined && ja !== p.profissional)
        erros[`participantes.${i}.funcao`] =
          f.tipo === 'auxiliar'
            ? `O ${f.ordemAuxiliar ?? ''}º auxiliar já está na equipe.`
            : 'Esta função admite uma pessoa só por item.';
      unicas.set(unica, p.profissional);
    }
    if (p.percentual !== undefined && p.percentual !== null && (p.percentual < 0 || p.percentual > 100))
      erros[`participantes.${i}.percentual`] = 'O percentual vai de 0 a 100.';
    if (p.formaPagamento && !FORMAS_PAGAMENTO_PARTICIPANTE.includes(p.formaPagamento))
      erros[`participantes.${i}.formaPagamento`] = 'Forma de pagamento desconhecida.';
  });
  return erros;
}

/**
 * O sequencial e o valor do ato de cada participante: ordem de apresentação da função (o cirurgião primeiro), depois a
 * ordem informada; valor = honorário do item × percentual (o informado ou o da função). Sem cobrança: valor zero.
 */
export function calcularEquipeItem(
  participantes: readonly ParticipanteInformado[],
  funcoes: ReadonlyMap<number, FuncaoEquipe>,
  honorarioItem: number,
): ParticipanteCalculado[] {
  const peso = (f: FuncaoEquipe | undefined) =>
    f?.tipo === 'cirurgiao' ? -1 : (f?.ordemApresentacao ?? 1000) + (f?.ordemAuxiliar ?? 0) / 100;
  return participantes
    .map((p, i) => ({ p, i, f: funcoes.get(p.funcao) }))
    .sort((a, b) => peso(a.f) - peso(b.f) || a.i - b.i)
    .map(({ p, f }, k) => {
      const percentual = p.percentual ?? f?.percentual ?? (f?.tipo === 'cirurgiao' ? 100 : 0);
      const forma = p.formaPagamento ?? 'via_hospital';
      return {
        sequencia: k + 1,
        profissional: p.profissional,
        funcao: p.funcao,
        grau: p.grau ?? f?.grau ?? null,
        percentual,
        formaPagamento: forma,
        valorAto: forma === 'sem_cobranca' ? 0 : r2((Math.max(0, honorarioItem) * percentual) / 100),
      };
    });
}

// ── Linha 16: kit de cobrança ─────────────────────────────────────────────────────────────────────

export interface ComponenteKit {
  readonly item: number | null;
  readonly equipamento: number | null;
  readonly quantidade: number;
}

export interface KitCobranca {
  readonly id: number;
  readonly ativo: boolean;
  readonly modo: 'aberto' | 'fechado';
  /** Item que representa o kit (obrigatório no fechado). */
  readonly item: number | null;
  readonly fontePagadora: number | null;
  readonly plano: number | null;
  readonly componentes: readonly ComponenteKit[];
}

export interface LinhaDoKit {
  readonly item: number;
  readonly quantidade: number;
  readonly papel: 'kit' | 'componente';
}

/** O que o kit lança na conta (ou as recusas). Equipamento sem item faturável não é cobrado e volta como aviso. */
export function lancamentoDoKit(
  kit: KitCobranca,
  conta: { readonly fontePagadora: number; readonly plano: number | null },
  vezes: number,
): { erros: Record<string, string>; linhas: LinhaDoKit[]; avisos: string[] } {
  const erros: Record<string, string> = {};
  if (!kit.ativo) erros['kit'] = 'O kit está inativo.';
  if (kit.fontePagadora !== null && kit.fontePagadora !== conta.fontePagadora)
    erros['kit'] = 'O kit não vale para a fonte pagadora da conta.';
  else if (kit.plano !== null && kit.plano !== conta.plano)
    erros['kit'] = 'O kit não vale para o plano da conta.';
  if (!Number.isFinite(vezes) || vezes <= 0) erros['vezes'] = 'Informe quantas vezes o kit foi usado.';
  if (Object.keys(erros).length) return { erros, linhas: [], avisos: [] };
  if (kit.modo === 'fechado') {
    if (kit.item === null)
      return { erros: { kit: 'O kit fechado não tem o item que o representa.' }, linhas: [], avisos: [] };
    return { erros, linhas: [{ item: kit.item, quantidade: vezes, papel: 'kit' }], avisos: [] };
  }
  const avisos: string[] = [];
  const linhas: LinhaDoKit[] = [];
  for (const c of kit.componentes) {
    if (c.item === null) {
      avisos.push('equipamento-sem-item');
      continue;
    }
    linhas.push({ item: c.item, quantidade: r4(c.quantidade * vezes), papel: 'componente' });
  }
  if (!linhas.length) return { erros: { kit: 'O kit não tem componente cobrável.' }, linhas, avisos };
  return { erros, linhas, avisos };
}
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export interface DefinicaoKit {
  readonly codigo: string;
  readonly descricao: string;
  readonly modo: 'aberto' | 'fechado';
  readonly item: number | null;
  readonly componentes: readonly ComponenteKit[];
}

/** Confere o cadastro do kit: código, descrição, o item do fechado e os componentes (sem repetição). */
export function validarDefinicaoKit(d: DefinicaoKit): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!d.codigo.trim()) erros['codigo'] = 'Informe o código do kit.';
  if (d.descricao.trim().length < 3) erros['descricao'] = 'Informe a descrição do kit.';
  if (d.modo === 'fechado' && d.item === null)
    erros['item'] = 'O kit fechado é cobrado por um item: informe-o.';
  if (!d.componentes.length) erros['componentes'] = 'Informe ao menos um componente.';
  const vistos = new Set<string>();
  d.componentes.forEach((c, i) => {
    if (c.item === null && c.equipamento === null)
      erros[`componentes.${i}.item`] = 'Informe o item ou o equipamento.';
    if (!(c.quantidade > 0)) erros[`componentes.${i}.quantidade`] = 'A quantidade é maior que zero.';
    const k = `${c.item ?? ''}:${c.equipamento ?? ''}`;
    if (vistos.has(k)) erros[`componentes.${i}.item`] = 'Componente repetido.';
    vistos.add(k);
  });
  return erros;
}

// ── Linha 14: transferência de itens entre contas ─────────────────────────────────────────────────

export interface ContaDaTransferencia {
  readonly id: number;
  readonly situacao: string;
  readonly estabelecimento: number;
  readonly fontePagadora: number;
  readonly paciente: number;
}

export interface ItemDaTransferencia {
  readonly id: number;
  readonly conta: number;
  readonly situacao: string;
}

export type TipoTransferencia = 'conta' | 'fonte_pagadora' | 'estabelecimento';

/** Situações do item que podem mudar de conta (o glosado, o estornado e o já transferido, não). */
export const SITUACOES_ITEM_TRANSFERIVEL = ['lancado', 'conferido'] as const;

/** Confere a transferência e diz o tipo dela (estabelecimento, depois fonte pagadora, depois conta). */
export function validarTransferencia(
  origem: ContaDaTransferencia,
  destino: ContaDaTransferencia,
  itens: readonly ItemDaTransferencia[],
  pedidos: readonly number[],
  motivo: string,
): { erros: Record<string, string>; tipo: TipoTransferencia } {
  const erros: Record<string, string> = {};
  const tipo: TipoTransferencia =
    origem.estabelecimento !== destino.estabelecimento
      ? 'estabelecimento'
      : origem.fontePagadora !== destino.fontePagadora
        ? 'fonte_pagadora'
        : 'conta';
  if (origem.id === destino.id) erros['destino'] = 'Escolha uma conta diferente da de origem.';
  if (origem.paciente !== destino.paciente) erros['destino'] = 'A conta de destino é de outro paciente.';
  if (!contaEditavel(origem.situacao))
    erros['origem'] = 'A conta de origem não está aberta: reabra-a para tirar itens dela.';
  if (!contaEditavel(destino.situacao))
    erros['destino'] = 'A conta de destino não está aberta: reabra-a ou escolha outra.';
  if (!pedidos.length) erros['itens'] = 'Escolha ao menos um item.';
  if (new Set(pedidos).size !== pedidos.length) erros['itens'] = 'Item repetido na transferência.';
  for (const id of pedidos) {
    const it = itens.find((x) => x.id === id);
    if (!it || it.conta !== origem.id) {
      erros['itens'] = 'Há item que não é da conta de origem.';
      break;
    }
    if (!(SITUACOES_ITEM_TRANSFERIVEL as readonly string[]).includes(it.situacao)) {
      erros['itens'] =
        'Só o item lançado ou conferido muda de conta (glosado, estornado e transferido, não).';
      break;
    }
  }
  if (motivo.trim().length < 5) erros['motivo'] = 'Informe o motivo (ao menos 5 letras).';
  return { erros, tipo };
}
