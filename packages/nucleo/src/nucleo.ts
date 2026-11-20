// Fachada NucleoProprio: o ponto único de entrada da API e do worker para o banco do cliente (no lugar do
// NucleoLegado). Lê a configuração do ambiente, mantém um pool por banco de cliente, abre leituras e escritas,
// cria o Executor e informa a saúde e a neutralização. Nada do banco legado nem do sistema de origem.
import { type Ambiente, ambienteEfetivo } from './ambiente.js';
import { type ConfiguracaoNucleo, lerConfiguracaoNucleo } from './configuracao.js';
import type { ContextoNucleo } from './contexto.js';
import { type DependenciasExecutor, Executor, MetricasExecutor } from './executor.js';
import {
  type NomeAmbiente,
  type ResultadoNeutralizacao,
  ambienteDe,
  exigirNeutralizacao,
  verificarNeutralizacao,
} from './neutralizacao.js';
import { type CriarPool, type EstadoPool, type InfoCliente, PoolsPorCliente } from './pool.js';
import { type Escritor, type Leitor, escreverTransacao, lerSomente } from './transacao.js';

export interface OpcoesNucleo {
  /** Ambiente (padrão: o do processo sobre o .env da raiz). */
  readonly env?: Ambiente;
  readonly configuracao?: ConfiguracaoNucleo;
  /** Fábrica de pool (testes). */
  readonly criarPool?: CriarPool;
}

export type OpcoesExecutorNucleo = Pick<
  DependenciasExecutor,
  'liberacao' | 'aoConfirmar' | 'metricas' | 'agora' | 'reautenticacaoMs' | 'log'
>;

export interface SaudeNucleo {
  readonly ambiente: NomeAmbiente;
  readonly plataforma: boolean;
  readonly neutralizacao: boolean;
  readonly pools: readonly EstadoPool[];
}

export class NucleoProprio {
  readonly configuracao: ConfiguracaoNucleo;
  readonly ambiente: NomeAmbiente;
  private readonly env: Ambiente;
  private readonly pools: PoolsPorCliente;

  constructor(opcoes: OpcoesNucleo = {}) {
    this.env = opcoes.env ?? ambienteEfetivo().env;
    this.ambiente = ambienteDe(this.env);
    // Regra 6: fora de produção o processo não sobe com destino externo, SMTP real ou canal de mensagem ligado.
    exigirNeutralizacao(this.env);
    this.configuracao = opcoes.configuracao ?? lerConfiguracaoNucleo(this.env);
    this.pools = new PoolsPorCliente(this.configuracao, opcoes.criarPool);
  }

  /** O banco do cliente, pela plataforma. */
  cliente(codigo: string): Promise<InfoCliente> {
    return this.pools.resolverCliente(codigo);
  }

  /** Leitura somente leitura no banco do cliente do contexto. */
  async lerSomente<T>(contexto: Partial<ContextoNucleo>, fn: (l: Leitor) => Promise<T>): Promise<T> {
    const fonte = await this.pools.fonte(String(contexto.cliente ?? ''));
    return lerSomente(fonte, this.configuracao, contexto, fn);
  }

  /**
   * Escrita direta numa transação (manutenção, cargas e preparo de testes). Gravação de negócio passa pelo
   * Executor, que põe trilha, idempotência e outbox na mesma transação.
   */
  async escrever<T>(
    contexto: Partial<ContextoNucleo>,
    fn: (e: Escritor) => Promise<T>,
    confirmar = true,
  ): Promise<T> {
    const fonte = await this.pools.fonte(String(contexto.cliente ?? ''));
    return escreverTransacao(fonte, this.configuracao, contexto, fn, confirmar);
  }

  criarExecutor(opcoes: OpcoesExecutorNucleo = {}): Executor {
    return new Executor({
      metricas: opcoes.metricas ?? new MetricasExecutor(),
      ...opcoes,
      ler: (ctx, fn) => this.lerSomente(ctx, fn),
      escrever: (ctx, fn, confirmar) => this.escrever(ctx, fn, confirmar),
    });
  }

  neutralizacao(): ResultadoNeutralizacao {
    return verificarNeutralizacao(this.env);
  }

  async saude(): Promise<SaudeNucleo> {
    return {
      ambiente: this.ambiente,
      plataforma: await this.pools.plataformaResponde(),
      neutralizacao: this.neutralizacao().ok,
      pools: this.pools.estados(),
    };
  }

  /** Esquece o cliente em cache (mudou de banco ou de situação). */
  esquecerCliente(codigo: string): void {
    this.pools.esquecer(codigo);
  }

  estadosDosPools(): EstadoPool[] {
    return this.pools.estados();
  }

  encerrar(): Promise<void> {
    return this.pools.encerrar();
  }
}
