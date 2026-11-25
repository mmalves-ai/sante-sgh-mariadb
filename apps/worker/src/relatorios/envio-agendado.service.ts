// Serviço do envio agendado de relatório no worker (M34, regra 5; lote F2.2 05-17 sobre o banco do cliente): consome a
// fila `relatorio-<cliente>` de cada cliente (o "enviar agora" da tela) e, a cada ciclo, os agendamentos vencidos de cada
// estabelecimento de cada cliente (o relógio de parede do fuso), pelo processarEnvio. SMTP por SMTP_URL (fora de
// produção só o Mailpit em loopback). Sem VALKEY_URL, só os vencidos; sem SMTP_URL, cada envio falha com o motivo e
// alerta o dono quando houver como. Desligado por RELATORIO_ENVIO=desligado; os vencidos por RELATORIO_ENVIO_VENCIDOS.
// Melhoria: o worker passa por todos os clientes da plataforma (um banco por cliente), não por uma rede fixa.
// Melhoria: o agendamento cujo relatório saiu do catálogo, ou de estabelecimento com código fora do formato da fila, não
// some calado: fica no log (só o id) e na contagem de ignorados.
// Melhoria: cada envio é reservado antes do e-mail com chave determinística (o vencimento lido ou o id do job da fila):
// duas instâncias do worker, o ciclo seguinte e a nova tentativa do job (attempts da fila) não repetem o e-mail; o
// reservado por outro entra na contagem de repetidos.
import { randomUUID } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { filaEnvioRelatorio, relatorioDoCatalogo } from '@sgh/contratos';
import { linkDoRelatorio } from '@sgh/dominio-relatorio';
import { lerInteiroAmbiente, NucleoProprio } from '@sgh/nucleo';
import { Worker } from 'bullmq';
import { clientesDaLista, clientesDoWorker } from '../clientes-worker.js';
import { logger } from '../logger.js';
import { RegistroRotinasProprio } from '../rotinas-registro-proprio.js';
import { RegistradorRotinas, ROTINAS_WORKER } from '../rotinas-worker.js';
import { conexaoValkey, PREFIXO_FILAS } from '../relay-outbox.js';
import { enviarSmtp } from '../smtp.js';
import { type ConclusaoEnvio, type DependenciasEnvio, processarEnvio } from './envio-agendado.js';
import {
  agoraParede,
  type OrigemEnvio,
  type PortaEnvioRelatorio,
  PortaEnvioRelatorioPropria,
} from './envio-agendado-proprio.js';

/** O nome do cliente no formato da fila e do job (o contrato ainda não aceita "_"; pedido no saida/05-17.json). */
export function redeDaFila(cliente: string): string {
  return cliente.replace(/_/g, '-');
}

/** As dependências do envio de um cliente (sem porta: só a fila, sem banco). */
export function dependenciasDoEnvio(
  porta: PortaEnvioRelatorio | null,
  env: NodeJS.ProcessEnv = process.env,
  agora: () => Date = () => new Date(),
): DependenciasEnvio {
  return {
    ambiente: env['AMBIENTE']?.trim() ?? 'dev',
    smtpUrl: env['SMTP_URL']?.trim() || null,
    remetente: env['EMAIL_REMETENTE']?.trim() || 'relatorios@sgh.invalid',
    produto: env['PRODUTO_NOME']?.trim() || 'SGH',
    nomeEstabelecimento: async (h) =>
      (porta ? await porta.nomeEstabelecimento(h).catch(() => null) : null) ?? h,
    enviar: (m) => enviarSmtp(env['SMTP_URL']!.trim(), m),
    emails: (h, agendamento) =>
      porta
        ? porta.destinatarios(h, Number(agendamento))
        : Promise.resolve({ destinatarios: [], dono: null }),
    alertaPadrao: env['ALERTA_RELATORIO_EMAIL']?.trim() || null,
    ...(porta
      ? {
          falhasAntes: (h: string, agendamento: string) => porta.falhasSeguidas(h, Number(agendamento)),
          reservar: (h: string, agendamento: string, origem: OrigemEnvio) =>
            porta.reservar(h, Number(agendamento), origem, agoraParede(agora())),
          registrar: async (h: string, _agendamento: string, r: ConclusaoEnvio) => {
            await porta.concluir(h, r.envio, r);
          },
        }
      : {}),
  };
}

export interface ResumoVencidos {
  readonly agendamentos: number;
  readonly processados: number;
  readonly ignorados: number;
  /** Já reservados por outro (outra instância ou ciclo): nada enviado. */
  readonly repetidos: number;
}

/** Os vencidos de um cliente: cada estabelecimento, cada agendamento vencido, um envio. */
export async function enviarVencidos(
  porta: PortaEnvioRelatorio,
  cliente: string,
  d: DependenciasEnvio,
  opcoes: { readonly agora?: Date; readonly baseWeb?: string; readonly teto?: number } = {},
): Promise<ResumoVencidos> {
  const base = opcoes.baseWeb ?? 'http://127.0.0.1:5300';
  let agendamentos = 0;
  let processados = 0;
  let ignorados = 0;
  let repetidos = 0;
  for (const h of await porta.estabelecimentos()) {
    const lista = await porta.vencidos(h, agoraParede(opcoes.agora ?? new Date()), opcoes.teto ?? 20);
    agendamentos += lista.length;
    for (const a of lista) {
      const r = relatorioDoCatalogo(a.relatorio);
      if (!r || !/^[a-z0-9]{1,10}$/.test(h)) {
        ignorados++;
        logger.warn(
          {
            cliente,
            agendamento: a.id,
            motivo: r ? 'estabelecimento-fora-do-formato' : 'relatorio-fora-do-catalogo',
          },
          'envio agendado ignorado',
        );
        continue;
      }
      try {
        const x = await processarEnvio(
          {
            rede: redeDaFila(cliente),
            hospital: h,
            agendamento: String(a.id),
            titulo: a.titulo.slice(0, 120),
            relatorio: r.titulo.slice(0, 120),
            link: linkDoRelatorio(base, r.codigo, a.parametros),
            enderecos: [],
            grupos: [],
            dono: String(a.dono),
            registrar: true,
          },
          d,
          { tipo: 'vencido', previsto: a.proximoEnvioEm },
        );
        if (x.repetido) repetidos++;
        else processados++;
      } catch (e) {
        logger.warn(
          { cliente, agendamento: a.id, erro: e instanceof Error ? e.name : 'erro' },
          'envio agendado falhou',
        );
      }
    }
  }
  return { agendamentos, processados, ignorados, repetidos };
}

export type NucleoEnvio = Pick<NucleoProprio, 'lerPlataforma' | 'encerrar'>;
export type FabricaPortaEnvio = (cliente: string) => PortaEnvioRelatorio;

@Injectable()
export class EnvioRelatorioService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoEnvio | null = null;
  private fabrica: FabricaPortaEnvio | null = null;
  private readonly workers: Worker[] = [];
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  /** 01-SIS L95: a volta dos vencidos registrada como rotina na Administração. */
  private registrador: RegistradorRotinas | null = null;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoEnvio, fabrica: FabricaPortaEnvio): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (process.env['RELATORIO_ENVIO'] === 'desligado') return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaEnvioRelatorioPropria(nucleo, cliente));
      this.registrador = new RegistradorRotinas((cliente) => new RegistroRotinasProprio(nucleo, cliente));
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'envio agendado: sem o banco, só a fila');
    }
    void this.ligarFilas();
    if (process.env['RELATORIO_ENVIO_VENCIDOS'] === 'desligado' || !this.nucleo) return;
    try {
      const intervalo = lerInteiroAmbiente(
        process.env,
        'RELATORIO_ENVIO_INTERVALO_MS',
        60_000,
        5_000,
        3_600_000,
      );
      this.temporizador = setInterval(() => void this.vencidos(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'envio agendado: intervalo inválido');
    }
  }

  /** Uma fila por cliente (o "enviar agora"); sem o banco, os clientes de WORKER_CLIENTES. */
  private async ligarFilas(): Promise<void> {
    const url = process.env['VALKEY_URL']?.trim();
    if (!url) return;
    const nucleo = this.nucleo;
    const clientes = nucleo
      ? await clientesDoWorker(nucleo, process.env, 'relatorio-envio').catch(() => [] as string[])
      : clientesDaLista(process.env['WORKER_CLIENTES']);
    for (const cliente of clientes) {
      const w = new Worker(
        filaEnvioRelatorio(redeDaFila(cliente)),
        async (job) => {
          const dados = job.data as { registrar?: boolean };
          const porta = dados.registrar === true && this.fabrica ? this.fabrica(cliente) : null;
          // A chave da reserva é o id do job: a nova tentativa (attempts da fila) não manda o e-mail de novo.
          const r = await processarEnvio(job.data, dependenciasDoEnvio(porta), {
            tipo: 'fila',
            job: `${filaEnvioRelatorio(redeDaFila(cliente))}:${job.id ?? randomUUID()}`,
          });
          logger.info(
            {
              cliente,
              repetido: r.repetido,
              destinatarios: r.destinatarios,
              enviados: r.enviados,
              situacao: r.situacao,
              alertouDono: r.alertouDono,
            },
            'envio de relatório',
          );
        },
        { connection: conexaoValkey(url, true), prefix: PREFIXO_FILAS, autorun: true },
      );
      w.on('error', () => undefined);
      this.workers.push(w);
    }
  }

  async vencidos(agora: Date = new Date()): Promise<ResumoVencidos[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    const base = process.env['WEB_ENDERECO']?.trim() || 'http://127.0.0.1:5300';
    const r: ResumoVencidos[] = [];
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'relatorio-envio')) {
        try {
          const volta = () => {
            const porta = fabrica(cliente);
            return enviarVencidos(porta, cliente, dependenciasDoEnvio(porta), { agora, baseWeb: base });
          };
          const x = this.registrador
            ? await this.registrador.rodar(
                cliente,
                ROTINAS_WORKER.envioRelatorios,
                'relatorio-envio',
                async () => {
                  const y = await volta();
                  return { resultado: y, lidos: y.agendamentos, gravados: y.processados, rejeitados: 0 };
                },
              )
            : await volta();
          if (!x) continue;
          r.push(x);
          if (x.agendamentos > 0) logger.info({ cliente, ...x }, 'envio agendado: vencidos');
        } catch (e) {
          logger.warn(
            { cliente, erro: e instanceof Error ? e.name : 'erro' },
            'envio agendado: cliente falhou',
          );
        }
      }
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'envio agendado: clientes indisponíveis');
    } finally {
      this.rodando = false;
    }
    return r;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await this.nucleo?.encerrar().catch(() => undefined);
  }
}
