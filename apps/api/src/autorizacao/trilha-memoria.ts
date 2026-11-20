// Sessão sintética (M34): a gravação SGH_ em memória registra a linha da SGH_TRILHA no registrador da API (como o
// núcleo grava a trilha na mesma transação). Sem registrador (testes de unidade), nada.
import type { LinhaTrilha } from '@sgh/legado';
import type { RegistradorTrilha } from './trilha.js';

export async function registrarNaTrilha(
  t: RegistradorTrilha | null,
  l: LinhaTrilha | null | undefined,
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
    tabelaAlvo: l.tabelaAlvo ?? 'MEMORIA',
    idAlvo: l.idAlvo ?? '',
  });
}
