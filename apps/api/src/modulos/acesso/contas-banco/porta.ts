// M59-F1: porta do painel "Contas do banco de dados e privilégios" (só leitura do catálogo de segurança do banco do
// estabelecimento). A porta do adaptador lê pelo @sgh/legado; a de memória serve o dev e o CI sem banco, com contas
// técnicas do catálogo do cap-08 §8.10 e números sintéticos.
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
  readonly destino: 'legado' | 'memoria';
  /** As contas do próprio Sante SGH no estabelecimento (do arquivo de ambiente; nunca a senha). */
  contasSgh(hospital: string): ContasSgh;
  /** Sufixos dos módulos com conta própria no arquivo de ambiente (FB_<COD>_MOD_<MODULO>_USUARIO). */
  modulosComConta(hospital: string): readonly string[];
  lerInventario(
    c: ContextoContasBanco,
    legiveis: { nomes: string[]; prefixos: string[] },
  ): Promise<InventarioLido>;
  /** Privilégios dos titulares SGH_ (papéis e contas por módulo, o papel único e a conta da aplicação). */
  lerPrivilegiosSgh(c: ContextoContasBanco): Promise<readonly PrivilegioReal[]>;
  /** M59-F3 (regra 6): quem tem DELETE em tabela clínica (legíveis pelo nome; os demais num agregado sem nome). */
  lerDeleteClinico(
    c: ContextoContasBanco,
    legiveis: { nomes: string[]; prefixos: string[] },
  ): Promise<readonly { readonly titular: string | null; readonly tabelas: number }[]>;
}
