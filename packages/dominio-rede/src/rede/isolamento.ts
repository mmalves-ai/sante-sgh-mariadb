// Funções da Rede ficam dentro da própria rede (M57, regra 12; ARQ-1, ARQ-2): o MPI opera só sobre os estabelecimentos
// da rede da sessão (resolvida pelo endereço de acesso), lidos da lista configurada, nunca de uma lista fixa; consulta
// sem o código da rede falha, e nenhum par sai da rede.
import { ladosDaChave } from '../mpi/chave.js';

export class ErroIsolamentoRede extends Error {
  override readonly name = 'ErroIsolamentoRede';
  readonly codigo: 'rede-ausente' | 'rede-diferente' | 'fora-da-rede';
  constructor(codigo: 'rede-ausente' | 'rede-diferente' | 'fora-da-rede', mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export interface ContextoRede {
  /** Rede da sessão (null quando o endereço não resolveu rede). */
  readonly redeSessao: string | null | undefined;
  /** Rede do núcleo (a configurada nesta hospedagem). */
  readonly redeConfigurada: string | null | undefined;
  /** Estabelecimentos configurados (ESTABELECIMENTOS, ARQ-1). */
  readonly estabelecimentos: readonly string[];
}

/** Os estabelecimentos da rede da sessão; falha sem rede ou com rede de outra hospedagem. */
export function estabelecimentosDaRede(c: ContextoRede): readonly string[] {
  const rede = c.redeSessao?.trim();
  if (!rede) throw new ErroIsolamentoRede('rede-ausente', 'Consulta da Rede sem o código da rede.');
  if (rede !== c.redeConfigurada?.trim())
    throw new ErroIsolamentoRede('rede-diferente', 'A rede da sessão não é a desta configuração.');
  return [...new Set(c.estabelecimentos)].sort();
}

/** Confere que os dois lados do par são estabelecimentos da rede (nenhum par cruza redes). */
export function conferirParNaRede(chave: string, estabelecimentos: readonly string[]): void {
  const s = new Set(estabelecimentos);
  for (const l of ladosDaChave(chave))
    if (!s.has(l.estabelecimento))
      throw new ErroIsolamentoRede('fora-da-rede', 'O par tem cadastro de estabelecimento fora da rede.');
}
