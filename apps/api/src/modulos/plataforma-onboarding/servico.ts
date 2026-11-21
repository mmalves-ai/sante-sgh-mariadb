// Serviço do painel de onboarding (F4 L3): valida a entrada pelos contratos e orquestra as portas. Fluxo do dono:
// criar cliente -> vincular arquivo (opcional) -> Importar ou Sincronizar -> acompanhar o progresso e a conciliação.
import {
  type ClienteCriado,
  type ClienteOnboarding,
  type ExecucaoConector,
  esquemaCodigoCliente,
  esquemaCriarClienteEntrada,
  esquemaPedirExecucaoEntrada,
  esquemaVincularOrigemEntrada,
  type OrigemDisponivel,
  type OrigemVinculada,
} from '@sgh/contratos';
import { ErroOnboarding, type PonteConector, type RepositorioOnboarding } from './porta.js';

function codigoValido(codigo: string): string {
  const r = esquemaCodigoCliente.safeParse(codigo);
  if (!r.success) throw new ErroOnboarding('invalido', 'Código de cliente inválido.');
  return r.data;
}

export class ServicoOnboarding {
  constructor(
    private readonly repo: RepositorioOnboarding,
    private readonly ponte: PonteConector,
  ) {}

  listarClientes(): Promise<ClienteOnboarding[]> {
    return this.repo.listarClientes();
  }

  listarOrigens(): Promise<OrigemDisponivel[]> {
    return this.ponte.listarOrigens();
  }

  criarCliente(corpo: unknown, admin: number | null): Promise<ClienteCriado> {
    const r = esquemaCriarClienteEntrada.safeParse(corpo);
    if (!r.success) throw new ErroOnboarding('invalido', 'Informe código (minúsculas, dígitos e _) e nome.');
    return this.ponte.criarCliente(r.data.codigo, r.data.nome, r.data.cnpj ?? null, admin);
  }

  vincular(codigo: string, corpo: unknown, admin: number | null): Promise<OrigemVinculada> {
    const r = esquemaVincularOrigemEntrada.safeParse(corpo);
    if (!r.success) throw new ErroOnboarding('invalido', 'Escolha um arquivo .fdb da pasta autorizada.');
    return this.ponte.vincular(codigoValido(codigo), r.data.arquivo, admin);
  }

  pedirExecucao(codigo: string, corpo: unknown, admin: number | null): Promise<number> {
    const r = esquemaPedirExecucaoEntrada.safeParse(corpo);
    if (!r.success) throw new ErroOnboarding('invalido', 'Tipo: importar ou sincronizar.');
    return this.repo.enfileirar(codigoValido(codigo), r.data.tipo, admin);
  }

  async execucao(codigo: string, id: number): Promise<ExecucaoConector> {
    if (!Number.isSafeInteger(id) || id <= 0) throw new ErroOnboarding('invalido', 'Execução inválida.');
    const e = await this.repo.execucao(codigoValido(codigo), id);
    if (!e) throw new ErroOnboarding('inexistente', 'Execução não encontrada.');
    return e;
  }
}
