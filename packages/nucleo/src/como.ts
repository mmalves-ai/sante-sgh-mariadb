// Sessão "como" (ADR 0021: suporte técnico e "login como"). A API marca a requisição feita numa sessão "como"
// (guarda e interceptor, por executarComo); o Executor lê a marca e grava a origem (ator real e alvo) na linha da
// trilha da mesma transação. Uma marca única, aqui no núcleo: quem grava e quem marca leem o mesmo contexto.
// Só ids e o login do alvo (nunca nome nem e-mail).
import { AsyncLocalStorage } from 'node:async_hooks';

export interface MarcaComo {
  /** Id da sessão de suporte. */
  readonly sessao: string;
  /** Id da ação de suporte em curso (null fora de uma escrita HTTP). */
  readonly acao: string | null;
  readonly atorTipo: 'plataforma' | 'suporte';
  /** Id da conta do ator real (nunca nome nem e-mail). */
  readonly idConta: string;
  /** Login do alvo. */
  readonly alvo: string;
}

/** O que vai à trilha (dados_depois.origem) quando a gravação ocorre numa sessão "como". */
export interface OrigemComo {
  readonly sessao: string;
  readonly acao: string | null;
  readonly atorTipo: 'plataforma' | 'suporte';
  readonly atorConta: string;
  readonly alvo: string;
}

const contextoComo = new AsyncLocalStorage<MarcaComo>();

/** A marca da requisição em curso, ou null fora de uma sessão "como". */
export function marcaComoAtual(): MarcaComo | null {
  return contextoComo.getStore() ?? null;
}

/** Roda `fn` (e tudo o que ela encadear) marcado como sessão "como". */
export function executarComo<T>(marca: MarcaComo, fn: () => T): T {
  return contextoComo.run(marca, fn);
}

/** A origem a gravar na trilha, ou null fora de uma sessão "como". */
export function origemComoAtual(): OrigemComo | null {
  const m = marcaComoAtual();
  if (!m) return null;
  return { sessao: m.sessao, acao: m.acao, atorTipo: m.atorTipo, atorConta: m.idConta, alvo: m.alvo };
}
