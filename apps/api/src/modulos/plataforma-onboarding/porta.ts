// Portas do painel de onboarding (F4 L3). A API lê a fila, o progresso e os agregados no banco plataforma
// (RepositorioOnboarding); o que toca o arquivo de origem ou cria banco vai pela PonteConector: só o conector/ abre o
// arquivo (regra 3) e só o serviço de criação de cliente (tools/db/criar_cliente.py) cria o banco do cliente.
import type {
  ClienteCriado,
  ClienteOnboarding,
  ExecucaoConector,
  OrigemDisponivel,
  OrigemVinculada,
} from '@sgh/contratos';

export class ErroOnboarding extends Error {
  override readonly name = 'ErroOnboarding';
  constructor(
    readonly tipo: 'conflito' | 'invalido' | 'inexistente' | 'indisponivel',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface RepositorioOnboarding {
  listarClientes(): Promise<ClienteOnboarding[]>;
  execucao(codigo: string, id: number): Promise<ExecucaoConector | null>;
  /** Histórico de execuções do cliente (L9), da mais recente para a mais antiga. */
  historico(codigo: string, limite?: number): Promise<ExecucaoConector[]>;
  /** Enfileira (409/ErroOnboarding 'conflito' se já há execução ativa do cliente). */
  enfileirar(codigo: string, tipo: 'importar' | 'sincronizar', admin: number | null): Promise<number>;
}

export interface PonteConector {
  criarCliente(
    codigo: string,
    nome: string,
    cnpj: string | null,
    admin: number | null,
  ): Promise<ClienteCriado>;
  listarOrigens(): Promise<OrigemDisponivel[]>;
  vincular(codigo: string, arquivo: string, admin: number | null): Promise<OrigemVinculada>;
}

export const SERVICO_ONBOARDING = Symbol('SERVICO_ONBOARDING');
