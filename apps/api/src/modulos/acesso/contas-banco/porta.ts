// M59-F1: porta do painel "Contas do banco de dados e privilégios" (só leitura do catálogo de privilégios do banco
// do cliente). A porta própria lê o information_schema do MariaDB pelo @sgh/nucleo; a de memória serve o dev e o CI
// sem banco, com contas técnicas sintéticas e números sintéticos.
import type { ContaBancoLida, PrivilegioReal } from '@sgh/contratos';
import type { ContasSgh } from '@sgh/dominio-acesso';

export const PORTA_CONTAS_BANCO = Symbol('PORTA_CONTAS_BANCO');

export interface ContextoContasBanco {
  readonly rede: string;
  readonly hospital: string;
}

export interface InventarioLido {
  readonly contas: readonly ContaBancoLida[];
  readonly loginsNaoLegiveis: number;
}

export interface PortaContasBanco {
  readonly destino: 'banco' | 'memoria';
  /** As contas do próprio Sante SGH no banco do cliente (da configuração do núcleo; nunca a senha). */
  contasSgh(hospital: string): ContasSgh;
  /** Sufixos dos módulos com conta própria no banco (vazio enquanto a aplicação usa uma conta só). */
  modulosComConta(hospital: string): readonly string[];
  lerInventario(
    c: ContextoContasBanco,
    legiveis: { nomes: string[]; prefixos: string[] },
  ): Promise<InventarioLido>;
  /** Privilégios das contas da aplicação no banco do cliente. */
  lerPrivilegiosSgh(c: ContextoContasBanco): Promise<readonly PrivilegioReal[]>;
  /** M59-F3 (regra 6): quem tem DELETE em tabela do banco (legíveis pelo nome; os demais num agregado sem nome). */
  lerDeleteClinico(
    c: ContextoContasBanco,
    legiveis: { nomes: string[]; prefixos: string[] },
  ): Promise<readonly { readonly titular: string | null; readonly tabelas: number }[]>;
  /** Quantas tabelas o banco do cliente tem (a base da imutabilidade: a exclusão é lógica em todas). */
  contarTabelas(c: ContextoContasBanco): Promise<number>;
}
