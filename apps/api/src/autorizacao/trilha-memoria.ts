// Sessão sintética (M34): a gravação em memória registra a linha da trilha no registrador da API (como o núcleo grava a
// trilha na mesma transação). Sem registrador (testes de unidade), nada.
// Melhoria: a linha é um tipo neutro do próprio módulo (evento do catálogo, rede, estabelecimento, login, recurso e
// alvo), sem depender da forma da trilha de nenhum sistema de origem.
import type { RegistradorTrilha } from './trilha.js';

/** O que a memória sabe da gravação: o evento do catálogo, quem, onde e o alvo (sem dado pessoal). */
export interface LinhaTrilhaMemoria {
  readonly evento: string;
  readonly rede: string;
  readonly hospital: string;
  /** Login de quem gravou. */
  readonly usuario: string;
  readonly estacao?: string | null;
  readonly correlacao: string;
  readonly recurso: string;
  readonly tabelaAlvo?: string | null;
  readonly idAlvo?: string | null;
}

export async function registrarNaTrilha(
  t: RegistradorTrilha | null,
  l: LinhaTrilhaMemoria | null | undefined,
): Promise<void> {
  if (!t || !l || typeof l !== 'object' || !('evento' in l)) return;
  await t.registrar({
    evento: l.evento,
    rede: l.rede,
    hospital: l.hospital,
    usuario: l.usuario,
    estacao: l.estacao ?? 'memoria',
    correlacao: l.correlacao,
    recurso: l.recurso,
    resultado: 'sucesso',
    tabelaAlvo: l.tabelaAlvo ?? 'memoria',
    idAlvo: l.idAlvo ?? '',
  });
}
