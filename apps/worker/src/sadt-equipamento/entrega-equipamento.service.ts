// Serviço do worker da interface com os equipamentos do laboratório (C3-004): a cada intervalo entrega os pedidos da
// fila pelo modo da central (simulador ou real) e, em produção com o real, recolhe o resultado da pasta de retorno e
// mantém o ouvinte TCP das interfaces com caminho de retorno "tcp:<porta>". Desligável por ENTREGA_EQUIPAMENTO=desligado.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { lerInteiroAmbiente, NucleoProprio } from '@sgh/nucleo';
import type { Server } from 'node:net';
import { clientesDoWorker } from '../clientes-worker.js';
import { logger } from '../logger.js';
import {
  cicloEntregaEquipamento,
  gravarResultadoRecebido,
  lerPastaRetorno,
  modoDoEquipamento,
  moverArquivo,
  ouvinteEquipamento,
  portaDoOuvinte,
  transporteReal,
  transporteSimulado,
} from './entrega-equipamento.js';

@Injectable()
export class EntregaEquipamentoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoProprio | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private readonly ouvintes = new Map<string, Server>();
  private readonly ambiente = (process.env['AMBIENTE'] ?? '').trim();

  onApplicationBootstrap(): void {
    if (process.env['ENTREGA_EQUIPAMENTO'] === 'desligado') return;
    try {
      const intervalo = lerInteiroAmbiente(
        process.env,
        'ENTREGA_EQUIPAMENTO_INTERVALO_MS',
        5_000,
        500,
        600_000,
      );
      this.nucleo = new NucleoProprio({ env: process.env });
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'entrega aos equipamentos não subiu');
    }
  }

  async ciclo(): Promise<void> {
    const nucleo = this.nucleo;
    if (this.rodando || !nucleo) return;
    this.rodando = true;
    const producao = this.ambiente === 'producao';
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'entrega-equipamento')) {
        try {
          const ctx = { cliente, correlacao: 'entrega-equipamento' };
          const modo = await nucleo.lerSomente(ctx, (l) => modoDoEquipamento(l, producao));
          const r = await cicloEntregaEquipamento(
            nucleo,
            cliente,
            modo === 'real' ? transporteReal(this.ambiente) : transporteSimulado,
          );
          if (r.lidas > 0) logger.info({ cliente, modo, ...r }, 'entrega aos equipamentos');
          if (modo === 'real') await this.recolher(nucleo, cliente);
        } catch (e) {
          logger.warn(
            { cliente, erro: e instanceof Error ? e.name : 'erro' },
            'entrega aos equipamentos: ciclo falhou',
          );
        }
      }
    } catch (e) {
      logger.warn(
        { erro: e instanceof Error ? e.name : 'erro' },
        'entrega aos equipamentos: clientes indisponíveis',
      );
    } finally {
      this.rodando = false;
    }
  }

  /** Pasta de retorno e ouvintes TCP das interfaces que recebem resultado (só em produção com o real). */
  private async recolher(nucleo: NucleoProprio, cliente: string): Promise<void> {
    const ctx = { cliente, correlacao: 'entrega-equipamento' };
    const interfaces = await nucleo.lerSomente(ctx, (l) =>
      l.consultar(
        `SELECT id, estabelecimento_id, protocolo, caminho_retorno, caminho_processado, caminho_erro
           FROM interface_equipamento
          WHERE ativo = TRUE AND recebe_resultado = TRUE AND laboratorio_apoio_id IS NULL
            AND caminho_retorno IS NOT NULL`,
      ),
    );
    for (const i of interfaces) {
      const interfaceId = Number(i['id']);
      const estabelecimento = Number(i['estabelecimento_id']);
      const gravar = (chave: string, amostras: Parameters<typeof gravarResultadoRecebido>[1]['amostras']) =>
        nucleo.escrever(ctx, (w) =>
          gravarResultadoRecebido(w, { estabelecimento, interfaceId, chave, amostras, agora: new Date() }),
        );
      const caminho = String(i['caminho_retorno']);
      const porta = portaDoOuvinte(caminho);
      if (porta !== null) {
        const chave = `${cliente}:${interfaceId}`;
        if (this.ouvintes.has(chave)) continue;
        const s = ouvinteEquipamento(String(i['protocolo']), async (r) => {
          await gravar(r.chave, r.amostras).catch(() =>
            logger.warn({ cliente, interfaceId }, 'equipamento: resultado não gravado'),
          );
        });
        s.on('error', () => logger.warn({ cliente, interfaceId, porta }, 'equipamento: ouvinte não subiu'));
        s.listen(porta);
        this.ouvintes.set(chave, s);
        continue;
      }
      for (const a of await lerPastaRetorno(caminho).catch(() => [])) {
        const ok = a.amostras.some((x) => x.leituras.length > 0);
        if (ok) await gravar(a.chave, a.amostras);
        const destino = ok ? i['caminho_processado'] : i['caminho_erro'];
        if (destino) await moverArquivo(a.arquivo, String(destino)).catch(() => undefined);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    for (const s of this.ouvintes.values()) s.close();
    await this.nucleo?.encerrar();
  }
}
