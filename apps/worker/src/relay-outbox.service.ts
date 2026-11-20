// Serviço do relay da outbox no worker (ficha do M04): ciclo periódico por estabelecimento configurado, com
// o publicador BullMQ e o consumidor nulo idempotente. Desligado por OUTBOX_RELAY=desligado (testes). Log só
// com contagens e códigos.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { lerCodigos, lerConfiguracaoNucleo, lerInteiroAmbiente, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { consumirEventoFinanceiro } from './financeiro/consumidor-financeiro.js';
import { logger } from './logger.js';
import { acessoDoNucleo } from './integracao/acesso.js';
import { distribuirEvento } from './integracao/consumidor-idempotente.js';
import { consumidorNulo, type Fila, filaBullmq } from './relay-outbox.js';

@Injectable()
export class RelayOutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private fila: Fila | null = null;
  private consumidor: ReturnType<typeof consumidorNulo> | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  onApplicationBootstrap(): void {
    if (process.env['OUTBOX_RELAY'] === 'desligado') return;
    const url = process.env['VALKEY_URL']?.trim();
    if (!url) {
      logger.warn('relay da outbox sem VALKEY_URL: desligado');
      return;
    }
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'OUTBOX_INTERVALO_MS', 1_000, 200, 600_000);
      process.env['SGH_PROCESSO'] ??= 'worker';
      this.nucleo = new NucleoLegado({
        env: process.env,
        driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(process.env).bibliotecaCliente }),
        pastaHomologada: resolve(
          process.cwd(),
          process.env['SCHEMA_HOMOLOGADO_DIR'] ?? 'tools/schema-check/homologado',
        ),
        aviso: (m, c) => logger.warn(c, m),
      });
      this.fila = filaBullmq(url, this.nucleo.rede);
      // M34: os eventos das integrações novas viram mensagens de saída (uma por parceiro; idempotente pela chave).
      const acesso = acessoDoNucleo(this.nucleo, 'integracao-consumidor');
      const financeiro = acessoDoNucleo(this.nucleo, 'financeiro-consumidor');
      this.consumidor = consumidorNulo(url, this.nucleo.rede, undefined, async (ev) => {
        const r = await distribuirEvento(acesso, ev);
        if (r.parceiros > 0) logger.info({ tipo: ev.tipo, ...r }, 'integrações: evento distribuído');
        // M32: a glosa aceita no faturamento vira glosa no título; a competência fechada vai à fila de trabalho.
        const f = await consumirEventoFinanceiro(financeiro, this.nucleo!.rede, ev);
        if (f) logger.info({ tipo: ev.tipo, resultado: f.resultado }, 'financeiro: evento consumido');
      });
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'relay da outbox não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo || !this.fila) return;
    this.rodando = true;
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const r = await this.nucleo.cicloRelayOutbox(cod, this.fila.publicar);
          if (r.lidos > 0) logger.info({ estabelecimento: cod, ...r }, 'relay da outbox');
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'relay da outbox: ciclo falhou',
          );
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.consumidor?.fechar().catch(() => undefined);
    await this.fila?.fechar().catch(() => undefined);
    await this.nucleo?.encerrar();
  }
}
