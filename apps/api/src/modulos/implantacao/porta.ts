// Porta da conferência da instalação (M60, etapa 2): o que a conferência lê do banco do estabelecimento ativo, sem
// SQL na API (fronteira Nx):
//   - `legado`: as leituras READ ONLY do núcleo (conexão corrente e SGH_VERSAO_SCRIPT);
//   - `memoria`: a sessão sintética de dev/ci (E2E): uma instalação correta, com todos os scripts do pacote;
//   - indisponível: fora de dev/ci sem o núcleo, 503 (falha fechada).
import type { ConexaoAtualLida, ScriptRegistradoLido } from '@sgh/legado';

export const PORTA_IMPLANTACAO = Symbol('PORTA_IMPLANTACAO');

export interface ContextoImplantacao {
  readonly rede: string;
  readonly hospital: string;
}

export interface PortaImplantacao {
  readonly destino: 'legado' | 'memoria';
  conexao(c: ContextoImplantacao): Promise<ConexaoAtualLida>;
  /** Nulo: a conta da aplicação não lê o registro dos scripts (sem o papel). */
  scriptsRegistrados(c: ContextoImplantacao): Promise<ScriptRegistradoLido[] | null>;
  /** M60.3: a hora de parede do servidor do banco (AAAA-MM-DDTHH:mm:ss.sss, sem fuso); nula se não veio. */
  relogioBanco(c: ContextoImplantacao): Promise<string | null>;
}

export const METODOS_PORTA_IMPLANTACAO: ReadonlySet<string> = new Set([
  'conexao',
  'scriptsRegistrados',
  'relogioBanco',
]);
