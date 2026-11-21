// Correção de uma escrita feita em sessão de suporte (ADR 0021): os erros da prévia e da execução e o resumo do plano.
// A prévia mostra, por passo, a imagem antes/depois, a compensação (excluir, restaurar ou reinserir), as colunas que
// mudam e o conflito com o que o hospital mudou depois; a execução só acontece se o plano refeito sob a trava der o
// MESMO resumo. A regra fica aqui, pura (sem banco): quem relê as imagens é a fonte do "como".
// Melhoria: os avisos falam do modelo próprio (sem gatilho com regra de negócio: a compensação passa pelas mesmas
// receitas do domínio), e os tipos são os do módulo (tipos.ts), sem vocabulário do sistema de origem.
import { createHash } from 'node:crypto';
import type { PassoCorrecao } from './tipos.js';

/** O registro mudou depois da escrita do suporte: a correção pede a confirmação do conflito. */
export class ErroConflitoCorrecao extends Error {
  override readonly name = 'ErroConflitoCorrecao';
  readonly passos: readonly PassoCorrecao[];
  constructor(passos: readonly PassoCorrecao[]) {
    super('O registro mudou depois da escrita do suporte: confirme a correção.');
    this.passos = passos;
  }
}

/** A compensação violaria uma regra das receitas de acesso (PassoCorrecao.bloqueio): nada é feito. */
export class ErroRegraCorrecao extends Error {
  override readonly name = 'ErroRegraCorrecao';
  readonly passos: readonly PassoCorrecao[];
  constructor(passos: readonly PassoCorrecao[]) {
    super(passos.map((p) => p.bloqueio).join(' '));
    this.passos = passos;
  }
}

/** A execução não corresponde à prévia mostrada: nada é feito; quem pediu vê a prévia nova antes de confirmar. */
export class ErroPreviaCorrecao extends Error {
  override readonly name = 'ErroPreviaCorrecao';
  readonly passos: readonly PassoCorrecao[];
  constructor(passos: readonly PassoCorrecao[]) {
    super('A correção mudou depois da prévia: confira a prévia nova antes de executar.');
    this.passos = passos;
  }
}

/**
 * Resumo da prévia (SHA-256 em hexadecimal): as imagens, a compensação, as colunas que mudam (com os valores), os
 * conflitos, o estado conferido e o bloqueio de cada passo. A confirmação de conflito vale para a diferença mostrada.
 */
export function resumoDoPlano(passos: readonly PassoCorrecao[]): string {
  const base = passos.map((p) => [
    p.imagem.id,
    p.compensacao,
    p.jaCorrigido,
    p.mudancas.map((m) => [m.coluna, m.atual, m.corrigido]),
    p.conflito.map((c) => [c.coluna, c.esperado, c.atual]),
    p.estadoConferido,
    p.bloqueio,
  ]);
  return createHash('sha256').update(JSON.stringify(base), 'utf8').digest('hex');
}

/** Avisos fixos da prévia: o que a compensação não devolve ao estado idêntico. */
export const AVISOS_CORRECAO: readonly string[] = [
  'Números de negócio não voltam: um registro reinserido mantém o número original, mas o próximo número gerado continua adiante.',
  'A compensação passa pelas mesmas regras da gravação (versão, restrições do banco e trilha): saldos e registros derivados gravados depois podem não voltar ao estado idêntico; confira na tela.',
  'Registros clínicos não são apagados: a escrita do suporte no prontuário fica listada como não reversível, com a ação corretiva.',
];
