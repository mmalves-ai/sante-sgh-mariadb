// W1-01 (parte 3c): a guarda do último gestor de acessos ativo nas telas de Usuários (bloquear, trocar de grupo) e
// de Perfis e permissões (retirar o papel 0, trocar de grupo, revogar a concessão do perfil gestor-acessos). Lê os
// gestores ao vivo pela fonte da gestão; sem conseguir ler, recusa com 503 (falha fechada). A regra é a do
// domínio (conferirUltimoGestor). Sem a fonte montada (testes de unidade de outro assunto), não se aplica.
import {
  type AcaoSobreGestor,
  chaveGrupo,
  conferirUltimoGestor,
  GRUPO_ACESSO_TOTAL,
  mensagemUltimoGestor,
} from '@sgh/dominio-acesso';
import { ErroProblema } from '../../problema.filter.js';

/** Um gestor de acessos ativo do estabelecimento, como a fonte da gestão o entrega (só login e códigos). */
export interface GestorAcesso {
  readonly login: string;
  /** Código do perfil amplo da conta (o de acesso total conta como gestor); null: nenhum. */
  readonly grupo: string | null;
  /** Tem o papel de gestor de acessos. */
  readonly papelGestor: boolean;
  /** Códigos dos perfis concedidos que dão a gestão de acessos. */
  readonly concessoes: readonly string[];
}

export interface LeitorGestores {
  gestoresAcesso(rede: string, hospital: string): Promise<readonly GestorAcesso[]>;
}

export async function exigirGestorRestante(
  fonte: LeitorGestores | null | undefined,
  rede: string,
  hospital: string,
  acao: AcaoSobreGestor,
): Promise<void> {
  if (!fonte) return;
  const lidos = await fonte.gestoresAcesso(rede, hospital).catch(() => {
    throw new ErroProblema(
      'indisponivel',
      503,
      'Não foi possível conferir os gestores de acessos do estabelecimento; tente de novo.',
    );
  });
  const r = conferirUltimoGestor(
    lidos.map((g) => ({
      login: g.login,
      grupoAcessoTotal: chaveGrupo(g.grupo ?? '') === GRUPO_ACESSO_TOTAL,
      papelGestor: g.papelGestor,
      concessoes: g.concessoes,
    })),
    acao,
  );
  if (r)
    throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagemUltimoGestor(acao), {
      codigo: r,
    });
}
