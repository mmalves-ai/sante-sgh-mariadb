// Complementos do laudo de imagem e de métodos gráficos (F3.5, 05-SADT linha 16): as palavras-chave do laudo (para a
// busca de casos e o ensino), o que a assinatura faz com o exame, o aviso do achado crítico e o que a retificação faz
// com o laudo que já tinha sido emitido. Regra pura, sem banco.
import { RecusaLaudo } from './redacao.js';

/** Teto de palavras-chave por laudo (a busca de casos perde o sentido com o laudo marcado com tudo). */
export const MAXIMO_PALAVRAS_CHAVE = 20;

/** As palavras-chave pedidas, sem repetição, todas do cadastro ativo; senão a recusa em português. */
export function conferirPalavrasChave(pedidas: readonly number[], ativas: ReadonlySet<number>): number[] {
  const unicas = [...new Set(pedidas)];
  if (unicas.length > MAXIMO_PALAVRAS_CHAVE)
    throw new RecusaLaudo(
      'palavras-chave-demais',
      `O laudo aceita até ${MAXIMO_PALAVRAS_CHAVE} palavras-chave.`,
    );
  const fora = unicas.filter((p) => !ativas.has(p));
  if (fora.length > 0)
    throw new RecusaLaudo(
      'palavra-chave-inexistente',
      'Uma das palavras-chave não existe ou está inativa no cadastro.',
    );
  return unicas;
}

export interface PalavraGravada {
  readonly id: number;
  readonly palavra: number;
  readonly excluida: boolean;
}

/**
 * O que muda nas palavras-chave gravadas do laudo: a nova entra, a que voltou é reativada (a linha é a mesma) e a
 * retirada fica marcada como excluída. Nada é apagado.
 */
export function mudancaDePalavras(
  gravadas: readonly PalavraGravada[],
  pedidas: readonly number[],
): { incluir: number[]; reativar: number[]; retirar: number[] } {
  const quer = new Set(pedidas);
  const por = new Map(gravadas.map((g) => [g.palavra, g]));
  return {
    incluir: [...quer].filter((p) => !por.has(p)),
    reativar: gravadas.filter((g) => g.excluida && quer.has(g.palavra)).map((g) => g.id),
    retirar: gravadas.filter((g) => !g.excluida && !quer.has(g.palavra)).map((g) => g.id),
  };
}

/** Situações do exame em que o laudo assinado já está liberado (a assinatura não mexe no exame). */
const JA_LIBERADO: ReadonlySet<string> = new Set(['liberado', 'entregue']);

/**
 * A assinatura do laudo libera o exame: o exame realizado que ainda não estava liberado passa a liberado (é o que o
 * leva à emissão e ao prontuário). O já liberado ou entregue fica como está; devolve `null` quando nada muda.
 */
export function exameAposAssinatura(situacao: string): 'liberado' | null {
  return JA_LIBERADO.has(situacao) ? null : 'liberado';
}

export type AcaoAvisoCritico = 'abrir' | 'cancelar' | 'nada';

/**
 * O aviso do achado crítico do laudo assinado ou retificado. O achado crítico sem aviso em aberto abre um (uma vez
 * só: a retificação que mantém o achado não repete o aviso); a retificação que retira o achado cancela o aviso que
 * ainda não foi comunicado (o comunicado fica no histórico, nunca é apagado).
 */
export function avisoDoAchadoCritico(
  achadoCritico: boolean,
  avisos: readonly { situacao: string }[],
): AcaoAvisoCritico {
  const vivos = avisos.filter((a) => a.situacao !== 'cancelado');
  const pendentes = vivos.filter((a) => ['pendente', 'em_contato', 'escalonado'].includes(a.situacao));
  if (achadoCritico) return vivos.length === 0 ? 'abrir' : 'nada';
  return pendentes.length > 0 ? 'cancelar' : 'nada';
}

/** Prazo padrão para comunicar o achado crítico do laudo quando o exame não tem regra própria (minutos). */
export const PRAZO_ACHADO_CRITICO_MINUTOS = 60;

/**
 * Quem é avisado quando o laudo que já tinha sido emitido é retificado: quem emitiu cada via e quem pediu o exame,
 * menos quem retifica, sem repetir. A via impressa antes da retificação deixa de valer como a atual.
 */
export function destinatariosDaRetificacaoDoLaudo(
  emissores: readonly (number | null)[],
  solicitantes: readonly (number | null)[],
  quemRetifica: number | null,
): number[] {
  return [...new Set([...emissores, ...solicitantes])].filter(
    (u): u is number => u !== null && u !== quemRetifica,
  );
}

/**
 * A emissão está superada quando o laudo foi retificado depois dela: o código de autenticação continua achando a
 * emissão, mas a validação diz que há versão mais nova e pede a via atual.
 */
export function emissaoSuperada(emitidaEm: Date, retificacoes: readonly Date[]): boolean {
  return retificacoes.some((r) => r.getTime() > emitidaEm.getTime());
}
