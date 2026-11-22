// Serviço do publicador das cargas de catálogo no worker (ficha do M13; lote F2.2 05-16): a cada
// CATALOGO_PUBLICADOR_MS (padrão 30 s), por cliente e estabelecimento, o lote seguinte das cargas aprovadas, na janela
// fora do pico (CATALOGO_JANELA_PUBLICACAO, padrão 22:00-06:00), pela porta própria (Executor do banco do cliente).
// Ligado fora de dev/ci; em dev/ci só com CATALOGO_PUBLICADOR=ligado. Fora de produção,
// CATALOGO_PUBLICAR_FORA_DA_JANELA=sim publica a qualquer hora. Log só com códigos e contagens.
// Melhoria: os clientes vêm da plataforma e os estabelecimentos do banco de cada cliente (sem lista fixa de bancos).
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { lerJanela } from '@sgh/dominio-catalogo';
import { lerInteiroAmbiente, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker, codigosDosEstabelecimentos } from './clientes-worker.js';
import { PortaPublicacaoPropria } from './importadores/porta-propria.js';
import { cicloPublicacao } from './importadores/publicador.js';
import { logger } from './logger.js';

/** O publicador roda? Fora de dev/ci, sempre (salvo desligado); em dev/ci, só com CATALOGO_PUBLICADOR=ligado. */
export function publicadorLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['CATALOGO_PUBLICADOR'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/** Minutos desde a meia-noite no fuso civil do Brasil (UTC−3). */
export function minutosCivis(d = new Date()): number {
  return (d.getUTCHours() * 60 + d.getUTCMinutes() - 180 + 1440) % 1440;
}

@Injectable()
export class PublicadorCatalogosService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoProprio | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  onApplicationBootstrap(): void {
    if (!publicadorLigado(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'CATALOGO_PUBLICADOR_MS', 30_000, 1_000, 3_600_000);
      this.nucleo = new NucleoProprio({ env: process.env });
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'publicador de catálogos não subiu');
    }
  }

  async ciclo(): Promise<void> {
    const nucleo = this.nucleo;
    if (this.rodando || !nucleo) return;
    this.rodando = true;
    try {
      const producao = (process.env['AMBIENTE'] ?? '').trim() === 'producao';
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'publicador-catalogos')) {
        let estabelecimentos: string[] = [];
        try {
          estabelecimentos = await nucleo.lerSomente(
            { cliente, correlacao: 'publicador-catalogos' },
            codigosDosEstabelecimentos,
          );
        } catch (e) {
          logger.warn(
            { cliente, erro: e instanceof Error ? e.name : 'erro' },
            'publicador: cliente indisponível',
          );
        }
        for (const cod of estabelecimentos) {
          try {
            const r = await cicloPublicacao({
              porta: new PortaPublicacaoPropria(nucleo, cliente, cod),
              janela: lerJanela(process.env['CATALOGO_JANELA_PUBLICACAO']),
              agoraMinutos: () => minutosCivis(),
              ignorarJanela: !producao && process.env['CATALOGO_PUBLICAR_FORA_DA_JANELA'] === 'sim',
              lotesPorCiclo: lerInteiroAmbiente(process.env, 'CATALOGO_LOTES_POR_CICLO', 20, 1, 1_000),
              log: (m, c) => logger.info({ cliente, estabelecimento: cod, ...c }, m),
            });
            for (const x of r)
              if (x.lotes > 0 || x.situacao === 'falhou')
                logger.info(
                  { cliente, estabelecimento: cod, carga: x.carga, lotes: x.lotes, situacao: x.situacao },
                  'publicador de catálogos',
                );
          } catch (e) {
            logger.warn(
              { cliente, estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
              'publicador de catálogos: ciclo falhou',
            );
          }
        }
      }
    } catch (e) {
      logger.warn(
        { erro: e instanceof Error ? e.name : 'erro' },
        'publicador de catálogos: clientes indisponíveis',
      );
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
