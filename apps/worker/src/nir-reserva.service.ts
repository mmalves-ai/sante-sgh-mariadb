// Expiração das reservas de leito do NIR no `worker` (M44, etapa 2; ficha, regra 11 e seção 5,
// `internacao.expirarReserva`; lote F2.2 05-15): a cada minuto, por cliente e estabelecimento, lê as reservas vigentes
// com a validade passada no relógio (o do processo ou o injetado, nos testes) e expira cada uma numa operação própria
// pela porta própria: a reserva sai da vigência (o leito volta a livre no mapa), a solicitação reservada ou a caminho
// volta à análise, com a trilha na mesma transação. Com dois consumidores, a condição relida com trava faz o segundo
// não alterar nada: nunca expiração duplicada. Vale com a chave `nir` ligada ou não (a reserva feita antes de recolher
// a funcionalidade também vence). Ligado fora de dev/ci; em dev/ci só com NIR_EXPIRACAO=ligado. Log só com contagens.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { NucleoProprio } from '@sgh/nucleo';
import { logger } from './logger.js';
import { type PortaNir, PortaNirPropria, type ReservaVencida } from './nir-reserva-propria.js';
import {
  type AlvoEstabelecimento,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';

export function expiracaoLigada(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'NIR_EXPIRACAO');
}

/** As vencidas ainda vigentes (só leitura) no relógio dado. */
export async function reservasAExpirar(
  porta: PortaNir,
  est: AlvoEstabelecimento,
  agora: Date,
): Promise<{ agora: string; vencidas: ReservaVencida[] }> {
  return { agora: agora.toISOString(), vencidas: await porta.vencidas(est, agora) };
}

/** Um ciclo num estabelecimento: as reservas expiradas por este consumidor e as solicitações de volta à análise. */
export async function cicloExpiracao(
  porta: PortaNir,
  est: AlvoEstabelecimento,
  agora: Date = new Date(),
): Promise<{ vencidas: number; expiradas: number; voltaramAnalise: number }> {
  const p = await reservasAExpirar(porta, est, agora);
  let expiradas = 0;
  let voltaramAnalise = 0;
  for (const r of p.vencidas) {
    const x = await porta.expirar(est, r.id, agora);
    if (x.expirou) expiradas++;
    if (x.voltouAnalise) voltaramAnalise++;
  }
  return { vencidas: p.vencidas.length, expiradas, voltaramAnalise };
}

export type FabricaPortaNir = (cliente: string) => PortaNir;

@Injectable()
export class NirReservaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaNir | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoServico, fabrica: FabricaPortaNir): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!expiracaoLigada(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaNirPropria(nucleo, cliente));
      this.temporizador = setInterval(() => void this.ciclo(), 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'expiração das reservas do NIR não subiu',
      );
    }
  }

  async ciclo(
    agora: Date = new Date(),
  ): Promise<{ cliente: string; estabelecimento: string; expiradas: number }[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'nir-expiracao',
        fabrica,
        (porta, est) => cicloExpiracao(porta, est, agora),
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'expiração das reservas falhou',
          ),
      );
      for (const v of voltas)
        if (v.resultado.expiradas > 0)
          logger.info(
            { cliente: v.cliente, estabelecimento: v.estabelecimento, expiradas: v.resultado.expiradas },
            'reservas expiradas',
          );
      return voltas.map((v) => ({
        cliente: v.cliente,
        estabelecimento: v.estabelecimento,
        expiradas: v.resultado.expiradas,
      }));
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
