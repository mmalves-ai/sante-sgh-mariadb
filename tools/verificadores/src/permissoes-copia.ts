// Acesso de leitura ao retrato do acesso do sistema de origem para o `permissoes:verificar` (M06). No banco próprio,
// o sistema de origem só é lido pelo conector (regra 3; ADR 0001), nunca pelas ferramentas: aqui não há cópia a
// ler, e quem chama usa o retrato versionado em tools/verificadores/dados/. Atualizar o retrato pela cópia fica
// indisponível até o conector exportá-lo (pedido registrado no lote 05-10 da F2.2).
import { ErroIndisponivel } from './indisponivel.ts';
import type { RetratoAcessoOrigem } from './permissoes-dados.ts';

/** Sem cópia do sistema de origem acessível às ferramentas: sempre null (o chamador usa o retrato versionado). */
export function codigosDaCopia(): { codigos: string[]; env: Record<string, string | undefined> } | null {
  return null;
}

/** Releitura do retrato na cópia: indisponível (a leitura do sistema de origem é só do conector). */
export function retratarDaCopia(
  _env: Record<string, string | undefined>,
  codigo: string,
): Promise<RetratoAcessoOrigem> {
  return Promise.reject(
    new ErroIndisponivel(
      `permissoes:verificar --atualizar (${codigo})`,
      'exportação do retrato do menu e dos grupos do sistema de origem pelo conector',
    ),
  );
}
