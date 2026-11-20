// Medicamentos controlados (Portaria SVS/MS 344/1998; ficha do M29, regra 4; cap-13 CTRL-01 a CTRL-03): prescritor
// obrigatório na saída, com registro coerente com o conselho (`GELANSAI.ID_TBCBOPRO_MAT_MED_CONTROLADO`); para o
// internado basta a prescrição do prontuário (o prescritor dela). Dupla conferência (quem confere não é quem dispensou;
// reautenticação recente), perda e descarte com testemunha, saldo por substância a partir dos movimentos.
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

/** As listas vistas no cadastro de itens da cópia (`GEITENS.PORTARIA`): A1 8, A2 3, B1 14, C1 32, C5 1. */
export const LISTAS_PORTARIA_344 = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'C5'] as const;
export type ListaPortaria = (typeof LISTAS_PORTARIA_344)[number];

export function listaDoItem(portaria: string | null | undefined): ListaPortaria | null {
  const p = (portaria ?? '').trim().toUpperCase();
  return (LISTAS_PORTARIA_344 as readonly string[]).includes(p) ? (p as ListaPortaria) : null;
}

/** Conselhos que prescrevem controlado, pela lista (A e B: médico, dentista e veterinário; C: também o enfermeiro não). */
const CONSELHOS_PRESCRITORES = ['CRM', 'CRO', 'CRMV'] as const;

export interface PrescritorControlado {
  /** O vínculo profissional (TBCBOPRO.ID). */
  readonly vinculo: number | null;
  /** Sigla do conselho do vínculo (CRM, CRO, CRMV, COREN…). */
  readonly conselho: string | null;
  /** Número do registro no conselho (0 ou vazio: sem registro). */
  readonly registro: number | null;
  readonly uf: string | null;
}

/**
 * Regra 4: a saída de controlado exige prescritor com registro coerente com o conselho. Internado: basta a prescrição
 * do prontuário (o prescritor dela vai à coluna); externo: o prescritor informado na tela.
 */
export function conferirPrescritorControlado(c: {
  lista: ListaPortaria | null;
  internado: boolean;
  /** O prescritor da prescrição do prontuário (internado) ou o informado (externo). */
  prescritor: PrescritorControlado | null;
  /** Internado: a dose vem de prescrição do prontuário. */
  daPrescricao: boolean;
}): RecusaSuprimentos | null {
  if (!c.lista) return null;
  if (c.internado && !c.daPrescricao)
    return recusa('sem-prescricao', 'Controlado para internado só sai da prescrição do prontuário.', [
      'horario',
    ]);
  const p = c.prescritor;
  if (!p || !p.vinculo)
    return recusa('sem-prescritor', 'Medicamento controlado: informe o prescritor.', ['prescritor']);
  const conselho = (p.conselho ?? '').trim().toUpperCase();
  if (!(CONSELHOS_PRESCRITORES as readonly string[]).includes(conselho))
    return recusa(
      'conselho-incoerente',
      `O conselho ${conselho || 'informado'} não prescreve medicamento controlado (Portaria 344).`,
      ['prescritor'],
    );
  if (!p.registro || p.registro <= 0)
    return recusa('sem-registro-conselho', 'O prescritor não tem número de registro no conselho.', [
      'prescritor',
    ]);
  if (!/^[A-Z]{2}$/.test((p.uf ?? '').trim().toUpperCase()))
    return recusa('sem-uf-conselho', 'O registro do prescritor não tem a UF do conselho.', ['prescritor']);
  return null;
}

/** Janela da reautenticação para a conferência dupla e para a perda (ms). */
export const REAUTENTICACAO_CONTROLADO_MS = 5 * 60_000;

/** Dupla conferência (CTRL-03): o conferente não é quem dispensou, reautenticou há pouco, e a contagem bate. */
export function conferirDuplaConferencia(c: {
  responsavel: string;
  conferente: string;
  reautenticadoEm: number | null;
  agora: number;
  quantidadeDocumento: number;
  quantidadeContada: number;
  justificativa: string;
}): RecusaSuprimentos | null {
  if (!c.conferente || c.conferente.trim().toUpperCase() === c.responsavel.trim().toUpperCase())
    return recusa('conferente-igual', 'A segunda conferência é de outra pessoa (não de quem dispensou).', [
      'conferente',
    ]);
  if (c.reautenticadoEm === null || c.agora - c.reautenticadoEm > REAUTENTICACAO_CONTROLADO_MS)
    return recusa('reautenticar', 'Confirme a sua senha para conferir o controlado.', ['senha']);
  if (!(c.quantidadeContada >= 0))
    return recusa('quantidade-invalida', 'Informe a quantidade contada.', ['quantidade']);
  if (qtd3(c.quantidadeContada) !== qtd3(c.quantidadeDocumento) && c.justificativa.trim().length < 10)
    return recusa(
      'divergencia-sem-justificativa',
      'A contagem difere do documento: escreva a justificativa (ao menos 10 caracteres).',
      ['justificativa'],
    );
  return null;
}

/** Perda ou descarte de controlado (P2): testemunha diferente do responsável, motivo e reautenticação. */
export function conferirPerdaControlado(c: {
  responsavel: string;
  testemunha: string;
  motivo: string;
  quantidade: number;
  saldoLote: number;
  reautenticadoEm: number | null;
  agora: number;
}): RecusaSuprimentos | null {
  if (!c.testemunha || c.testemunha.trim().toUpperCase() === c.responsavel.trim().toUpperCase())
    return recusa('sem-testemunha', 'A perda de controlado exige testemunha (outra pessoa).', ['testemunha']);
  if (c.motivo.trim().length < 10)
    return recusa('sem-motivo', 'Escreva o motivo da perda (ao menos 10 caracteres).', ['motivo']);
  if (!(c.quantidade > 0) || qtd3(c.quantidade) > qtd3(c.saldoLote))
    return recusa('saldo-insuficiente', 'A quantidade da perda passa do saldo do lote.', ['quantidade']);
  if (c.reautenticadoEm === null || c.agora - c.reautenticadoEm > REAUTENTICACAO_CONTROLADO_MS)
    return recusa('reautenticar', 'Confirme a sua senha para registrar a perda.', ['senha']);
  return null;
}

export interface MovimentoControlado {
  readonly item: number;
  /** AAAA-MM-DD. */
  readonly data: string;
  readonly tipo:
    'entrada' | 'saida' | 'devolucao' | 'perda' | 'transferencia-entrada' | 'transferencia-saida';
  readonly quantidade: number;
  readonly documento: string;
}

/** Saldo por substância no período: o saldo anterior, as entradas, as saídas e o saldo final (CTRL-01). */
export function saldoPorSubstancia(
  saldoAnterior: number,
  movimentos: readonly MovimentoControlado[],
): { anterior: number; entradas: number; saidas: number; final: number } {
  let entradas = 0;
  let saidas = 0;
  for (const m of movimentos) {
    if (m.tipo === 'entrada' || m.tipo === 'devolucao' || m.tipo === 'transferencia-entrada')
      entradas += m.quantidade;
    else saidas += m.quantidade;
  }
  return {
    anterior: qtd3(saldoAnterior),
    entradas: qtd3(entradas),
    saidas: qtd3(saidas),
    final: qtd3(saldoAnterior + entradas - saidas),
  };
}
