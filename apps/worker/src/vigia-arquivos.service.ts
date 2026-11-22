// Vigia de integridade dos arquivos (ADR 0004): a cada VIGIA_ARQUIVOS_MS (padrão 6 h) confere, para cada cliente, o
// hash de cada arquivo registrado contra o disco (ARQUIVOS_RAIZ, uma pasta por banco de cliente) e alerta no log a
// falta, a divergência e o arquivo que perdeu o somente leitura (só cliente, contagens e ids, nunca nome nem
// conteúdo). Também alerta o espaço livre da raiz abaixo de ARQUIVOS_ALERTA_LIVRE_GB (padrão 20). Sem ARQUIVOS_RAIZ ou
// com VIGIA_ARQUIVOS=desligado, não sobe.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  type ArmazemArquivos,
  NucleoProprio,
  type VerificacaoCliente,
  criarArmazemLocal,
  espacoLivreBytes,
  lerRaizArquivos,
} from '@sgh/nucleo';
import { type NucleoClientes, clientesDoWorker } from './clientes-worker.js';
import { logger } from './logger.js';

const GB = 1024 ** 3;

export interface ConfiguracaoVigiaArquivos {
  readonly raiz: string;
  readonly intervaloMs: number;
  readonly alertaLivreBytes: number;
}

/** Configuração do ambiente; null quando o vigia não deve subir. */
export function lerConfiguracaoVigiaArquivos(env: NodeJS.ProcessEnv): ConfiguracaoVigiaArquivos | null {
  if (env['VIGIA_ARQUIVOS'] === 'desligado') return null;
  const raiz = lerRaizArquivos(env);
  if (!raiz) return null;
  const ms = Number(env['VIGIA_ARQUIVOS_MS'] || 6 * 3_600_000);
  const gb = Number(env['ARQUIVOS_ALERTA_LIVRE_GB'] || 20);
  return {
    raiz,
    intervaloMs: Number.isFinite(ms) && ms >= 60_000 ? ms : 6 * 3_600_000,
    alertaLivreBytes: (Number.isFinite(gb) && gb >= 0 ? gb : 20) * GB,
  };
}

export type TipoAlertaArquivos =
  'arquivo_faltando' | 'arquivo_divergente' | 'arquivo_gravavel' | 'espaco_baixo' | 'falha';

export interface AlertaVigiaArquivos {
  readonly tipo: TipoAlertaArquivos;
  readonly cliente: string | null;
  readonly quantidade: number;
  /** Até 20 ids de registro de `arquivo`. */
  readonly ids: readonly number[];
}

/** Alertas de uma verificação (pura). */
export function alertasDaVerificacao(v: VerificacaoCliente): AlertaVigiaArquivos[] {
  const a: AlertaVigiaArquivos[] = [];
  const add = (tipo: TipoAlertaArquivos, quantidade: number, ids: readonly number[]) => {
    if (quantidade > 0) a.push({ tipo, cliente: v.cliente, quantidade, ids: ids.slice(0, 20) });
  };
  add('arquivo_faltando', v.totalFaltando, v.faltando);
  add('arquivo_divergente', v.totalDivergentes, v.divergentes);
  add('arquivo_gravavel', v.totalGravaveis, v.gravaveis);
  return a;
}

export interface RodadaVigiaArquivos {
  readonly em: Date;
  readonly livreBytes: number | null;
  readonly verificacoes: readonly VerificacaoCliente[];
  readonly alertas: readonly AlertaVigiaArquivos[];
}

type Medidor = (raiz: string) => number;

@Injectable()
export class VigiaArquivosService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: (NucleoClientes & { encerrar?(): Promise<void> }) | null = null;
  private armazem: Pick<ArmazemArquivos, 'verificarCliente'> | null = null;
  private cfg: ConfiguracaoVigiaArquivos | null = null;
  private medir: Medidor = espacoLivreBytes;
  private env: NodeJS.ProcessEnv = process.env;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private ultima: RodadaVigiaArquivos | null = null;

  /** Teste: núcleo, armazém e medidor sem subir o banco. */
  usar(
    nucleo: NucleoClientes,
    armazem: Pick<ArmazemArquivos, 'verificarCliente'>,
    cfg: ConfiguracaoVigiaArquivos,
    opcoes: { readonly medir?: Medidor; readonly env?: NodeJS.ProcessEnv } = {},
  ): void {
    this.nucleo = nucleo;
    this.armazem = armazem;
    this.cfg = cfg;
    if (opcoes.medir) this.medir = opcoes.medir;
    if (opcoes.env) this.env = opcoes.env;
  }

  onApplicationBootstrap(): void {
    try {
      const cfg = lerConfiguracaoVigiaArquivos(process.env);
      if (!cfg) return;
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, criarArmazemLocal(nucleo, { raiz: cfg.raiz }), cfg);
      this.temporizador = setInterval(() => void this.ciclo(), cfg.intervaloMs);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'vigia dos arquivos não subiu');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar?.().catch(() => undefined);
  }

  ultimaRodada(): RodadaVigiaArquivos | null {
    return this.ultima;
  }

  /** Uma rodada: espaço livre e a conferência de cada cliente. */
  async ciclo(): Promise<RodadaVigiaArquivos | null> {
    if (this.rodando || !this.nucleo || !this.armazem || !this.cfg) return null;
    this.rodando = true;
    try {
      const alertas: AlertaVigiaArquivos[] = [];
      let livreBytes: number | null = null;
      try {
        livreBytes = this.medir(this.cfg.raiz);
        if (livreBytes < this.cfg.alertaLivreBytes)
          alertas.push({
            tipo: 'espaco_baixo',
            cliente: null,
            quantidade: Math.floor(livreBytes / GB),
            ids: [],
          });
      } catch {
        alertas.push({ tipo: 'falha', cliente: null, quantidade: 1, ids: [] });
      }
      const verificacoes: VerificacaoCliente[] = [];
      const correlacao = `vigia-arquivos-${Date.now()}`;
      for (const cliente of await clientesDoWorker(this.nucleo, this.env, correlacao)) {
        try {
          const v = await this.armazem.verificarCliente({
            cliente,
            estabelecimento: null,
            usuario: null,
            correlacao,
          });
          verificacoes.push(v);
          alertas.push(...alertasDaVerificacao(v));
        } catch {
          alertas.push({ tipo: 'falha', cliente, quantidade: 1, ids: [] });
        }
      }
      for (const a of alertas)
        logger.warn(
          { alerta: a.tipo, cliente: a.cliente, quantidade: a.quantidade, ids: a.ids },
          'alerta do vigia dos arquivos',
        );
      this.ultima = { em: new Date(), livreBytes, verificacoes, alertas };
      return this.ultima;
    } finally {
      this.rodando = false;
    }
  }
}
