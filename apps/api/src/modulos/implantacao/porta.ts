// Porta da conferência da instalação e da fumaça do servidor (M60): o que elas leem do banco do cliente, sem SQL fora
// da porta (fronteira Nx):
//   - `banco`: a porta própria sobre o MariaDB do cliente, pelo @sgh/nucleo (conexão corrente, migrações registradas,
//     relógio e a impressão da estrutura), só leitura;
//   - `memoria`: a instalação sintética de dev/ci (E2E), correta por construção;
//   - indisponível: fora de dev/ci sem o núcleo, 503 (falha fechada).
// Melhoria: tipos de negócio neutros (nome do charset e da autenticação como o servidor informa, booleanos), sem id de
// catálogo do motor antigo; a impressão da estrutura vem do próprio banco do cliente, sem fonte de convivência.
import { portaIndisponivel } from '../exames/public-api.js';

export const PORTA_IMPLANTACAO = Symbol('PORTA_IMPLANTACAO');

export interface ContextoImplantacao {
  readonly rede: string;
  readonly hospital: string;
}

/** A conexão corrente da aplicação ao banco, como o servidor a informa (nada de senha nem endereço). */
export interface ConexaoBanco {
  /** Versão do servidor (ex.: "12.3.1-MariaDB"). */
  readonly versaoMotor: string;
  /** Charset padrão do banco do cliente (ex.: "utf8mb4"). */
  readonly charsetBanco: string;
  /** Charset da conexão; nulo se o servidor não informou. */
  readonly charsetConexao: string | null;
  /** Método de autenticação da conta (plugin); nulo se a conta não pode ler o próprio cadastro. */
  readonly autenticacao: string | null;
  readonly canalCifrado: boolean | null;
  readonly canalComprimido: boolean | null;
  readonly protocolo: string | null;
  /** A conta técnica da conexão (conta de serviço, nunca de pessoa), sem o host. */
  readonly conta: string;
  /** O papel em uso na sessão; nulo sem papel. */
  readonly papel: string | null;
}

/** Uma migração registrada no banco do cliente: o número de ordem no pacote e o hash do arquivo. */
export interface MigracaoRegistrada {
  readonly numero: number;
  readonly hash: string;
}

/** A impressão da estrutura do banco do cliente (tabelas e colunas), para comparar com a homologada. */
export interface EstruturaBanco {
  /** SHA-256 em hexadecimal das tabelas e colunas, em ordem. */
  readonly resumo: string;
  readonly tabelas: number;
}

export interface PortaImplantacao {
  readonly destino: 'banco' | 'memoria';
  conexao(c: ContextoImplantacao): Promise<ConexaoBanco>;
  /** Nulo: o banco do cliente ainda não registra as migrações aplicadas. */
  migracoesRegistradas(c: ContextoImplantacao): Promise<MigracaoRegistrada[] | null>;
  /** M60.3: a hora de parede do servidor do banco (AAAA-MM-DDTHH:mm:ss.sss, sem fuso); nula se não veio. */
  relogioBanco(c: ContextoImplantacao): Promise<string | null>;
  /** A impressão da estrutura atual do banco do cliente. */
  estrutura(c: ContextoImplantacao): Promise<EstruturaBanco>;
}

export const METODOS_PORTA_IMPLANTACAO: ReadonlySet<string> = new Set([
  'conexao',
  'migracoesRegistradas',
  'relogioBanco',
  'estrutura',
]);

export function portaImplantacaoIndisponivel(): PortaImplantacao {
  return portaIndisponivel<PortaImplantacao>(METODOS_PORTA_IMPLANTACAO);
}
