// Serviço do relay da outbox no worker (ficha do M04; lote F2.2 05-16): ciclo periódico por cliente (um banco por
// cliente, NucleoProprio), com o publicador BullMQ e o consumidor idempotente de cada cliente (integrações e
// financeiro). Desligado por OUTBOX_RELAY=desligado (testes). Log só com contagens e códigos.
// Melhoria: as filas são por cliente (eventos-<cliente>), e o consumidor de cada cliente grava só no banco dele.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { lerInteiroAmbiente, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker } from './clientes-worker.js';
import { consumirEventoFinanceiro } from './financeiro/consumidor-financeiro.js';
import { acessoDoNucleo } from './integracao/acesso.js';
import { distribuirEvento } from './integracao/consumidor-idempotente.js';
import { logger } from './logger.js';
import { RegistroRotinasProprio } from './rotinas-registro-proprio.js';
import { RegistradorRotinas, ROTINAS_WORKER, tipoDoErro } from './rotinas-worker.js';
import { cicloRelayOutbox } from './relay-outbox-proprio.js';
import { consumidorNulo, type Fila, filaBullmq } from './relay-outbox.js';

interface DoCliente {
  readonly fila: Fila;
  readonly consumidor: ReturnType<typeof consumidorNulo>;
}

@Injectable()
export class RelayOutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoProprio | null = null;
  private url = '';
  private readonly clientes = new Map<string, DoCliente>();
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  /** 01-SIS L95: a volta registrada como rotina na Administração. */
  private registrador: RegistradorRotinas | null = null;

  onApplicationBootstrap(): void {
    if (process.env['OUTBOX_RELAY'] === 'desligado') return;
    const url = process.env['VALKEY_URL']?.trim();
    if (!url) {
      logger.warn('relay da outbox sem VALKEY_URL: desligado');
      return;
    }
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'OUTBOX_INTERVALO_MS', 1_000, 200, 600_000);
      this.url = url;
      const nucleo = new NucleoProprio({ env: process.env });
      this.nucleo = nucleo;
      this.registrador = new RegistradorRotinas((cliente) => new RegistroRotinasProprio(nucleo, cliente));
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'relay da outbox não subiu');
    }
  }

  private doCliente(nucleo: NucleoProprio, cliente: string): DoCliente {
    const ja = this.clientes.get(cliente);
    if (ja) return ja;
    // M34: os eventos das integrações viram mensagens de saída (uma por parceiro; idempotente pela chave).
    const acesso = acessoDoNucleo(nucleo, cliente, 'integracao-consumidor');
    const financeiro = acessoDoNucleo(nucleo, cliente, 'financeiro-consumidor');
    const c: DoCliente = {
      fila: filaBullmq(this.url, cliente),
      consumidor: consumidorNulo(this.url, cliente, undefined, async (ev) => {
        const r = await distribuirEvento(acesso, ev);
        if (r.parceiros > 0) logger.info({ cliente, tipo: ev.tipo, ...r }, 'integrações: evento distribuído');
        // M32: a glosa aceita no faturamento vira glosa no título; a competência fechada vai à fila de trabalho.
        const f = await consumirEventoFinanceiro(financeiro, cliente, ev);
        if (f)
          logger.info({ cliente, tipo: ev.tipo, resultado: f.resultado }, 'financeiro: evento consumido');
      }),
    };
    this.clientes.set(cliente, c);
    return c;
  }

  async ciclo(): Promise<void> {
    const nucleo = this.nucleo;
    if (this.rodando || !nucleo) return;
    this.rodando = true;
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'relay-outbox')) {
        try {
          const volta = () =>
            cicloRelayOutbox(nucleo, cliente, this.doCliente(nucleo, cliente).fila.publicar);
          // O relay roda a cada segundo: só a volta com falha de publicação vira histórico (com os volumes); a
          // volta sem falha marca a rotina viva.
          const r = this.registrador
            ? await this.registrador.rodar(cliente, ROTINAS_WORKER.relay, 'relay-outbox', async () => {
                const x = await volta();
                return x.falhas > 0
                  ? { resultado: x, lidos: x.lidos, gravados: x.publicados, rejeitados: x.falhas }
                  : { resultado: x };
              })
            : await volta();
          if (r && r.lidos > 0) logger.info({ cliente, ...r }, 'relay da outbox');
        } catch (e) {
          logger.warn({ cliente, erro: tipoDoErro(e) }, 'relay da outbox: ciclo falhou');
        }
      }
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'relay da outbox: clientes indisponíveis');
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    for (const c of this.clientes.values()) {
      await c.consumidor.fechar().catch(() => undefined);
      await c.fila.fechar().catch(() => undefined);
    }
    await this.nucleo?.encerrar();
  }
}
