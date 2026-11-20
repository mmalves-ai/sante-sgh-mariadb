// Serviço do envio agendado de relatório no worker (M34, regra 5): consome a fila `relatorio-<rede>` (o "enviar agora"
// da tela) e, a cada ciclo, os envios vencidos de cada estabelecimento (o relógio do banco), pelo processarEnvio.
// SMTP por SMTP_URL (fora de produção só o Mailpit em loopback). Sem VALKEY_URL, só os vencidos; sem SMTP_URL, cada
// envio falha com o motivo e alerta o dono quando houver como. Desligado por RELATORIO_ENVIO=desligado.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { filaEnvioRelatorio, relatorioDoCatalogo } from '@sgh/contratos';
import { linkDoRelatorio, proximoEnvio } from '@sgh/dominio-relatorio';
import {
  agendamentosVencidos,
  emailsDoEnvio,
  lerAgendamentoRelatorio,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerInteiroAmbiente,
  lerRedePadrao,
  NucleoLegado,
  registrarResultadoEnvio,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { Worker } from 'bullmq';
import { logger } from '../logger.js';
import { conexaoValkey, PREFIXO_FILAS } from '../relay-outbox.js';
import { enviarSmtp } from '../smtp.js';
import { type DependenciasEnvio, processarEnvio } from './envio-agendado.js';

@Injectable()
export class EnvioRelatorioService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private worker: Worker | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  private dependencias(comBanco: boolean): DependenciasEnvio {
    const env = process.env;
    const nucleo = comBanco ? this.nucleo : null;
    const ctx = (h: string) => ({ rede: nucleo?.rede ?? '', hospital: h, traceId: 'relatorio-envio' });
    return {
      ambiente: env['AMBIENTE']?.trim() ?? 'dev',
      smtpUrl: env['SMTP_URL']?.trim() || null,
      remetente: env['EMAIL_REMETENTE']?.trim() || 'relatorios@sgh.invalid',
      produto: env['PRODUTO_NOME']?.trim() || 'SGH',
      nomeEstabelecimento: (h) => env[`FB_${h.toUpperCase()}_NOME`]?.trim() || h,
      enviar: (m) => enviarSmtp(env['SMTP_URL']!.trim(), m),
      emails: (h, grupos, dono) =>
        nucleo
          ? nucleo.lerSomente(ctx(h), (l) => emailsDoEnvio(l, grupos, dono))
          : Promise.resolve({ destinatarios: [], dono: null }),
      alertaPadrao: env['ALERTA_RELATORIO_EMAIL']?.trim() || null,
      ...(nucleo
        ? {
            falhasAntes: async (h: string, id: string) =>
              (await nucleo.lerSomente(ctx(h), (l) => lerAgendamentoRelatorio(l, h, id)))?.falhasSeguidas ??
              0,
            registrar: async (
              h: string,
              id: string,
              r: { situacao: 'enviado' | 'falhou'; falha: string | null; falhasSeguidas: number },
            ) => {
              const a = await nucleo.lerSomente(ctx(h), (l) => lerAgendamentoRelatorio(l, h, id));
              if (!a) return;
              const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
              const proximo =
                !a.proximoEnvio || a.proximoEnvio.getTime() <= agora.getTime()
                  ? proximoEnvio(
                      {
                        periodicidade: a.periodicidade as 'diaria' | 'semanal' | 'mensal',
                        hora: a.hora,
                        diaSemana: a.diaSemana,
                        diaMes: a.diaMes,
                      },
                      agora,
                    )
                  : a.proximoEnvio;
              await nucleo.gravarSgh(ctx(h), (e) =>
                registrarResultadoEnvio(e, h, id, { ...r, proximoEnvio: proximo }),
              );
            },
          }
        : {}),
    };
  }

  onApplicationBootstrap(): void {
    if (process.env['RELATORIO_ENVIO'] === 'desligado') return;
    const url = process.env['VALKEY_URL']?.trim();
    let rede: string;
    try {
      rede = lerRedePadrao(process.env) ?? 'rede-sintetica';
    } catch {
      rede = 'rede-sintetica';
    }
    if (url) {
      this.worker = new Worker(
        filaEnvioRelatorio(rede),
        async (job) => {
          const dados = job.data as { registrar?: boolean };
          const r = await processarEnvio(job.data, this.dependencias(dados.registrar === true));
          logger.info(
            {
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
      this.worker.on('error', () => undefined);
    }
    // Os vencidos pelo banco (só com o núcleo configurado; na sessão sintética do E2E, só a fila).
    if (process.env['RELATORIO_ENVIO_VENCIDOS'] === 'desligado') return;
    try {
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
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'envio agendado: sem o banco, só a fila');
    }
  }

  async vencidos(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    const nucleo = this.nucleo;
    const base = process.env['WEB_ENDERECO']?.trim() || 'http://127.0.0.1:5300';
    try {
      for (const h of lerCodigos(process.env)) {
        const ctx = { rede: nucleo.rede, hospital: h, traceId: 'relatorio-envio' };
        const lista = await nucleo.lerSomente(ctx, (l) => agendamentosVencidos(l, h, 20)).catch(() => []);
        for (const a of lista) {
          const r = relatorioDoCatalogo(a.relatorio);
          if (!r) continue;
          await processarEnvio(
            {
              rede: nucleo.rede,
              hospital: h,
              agendamento: a.id,
              titulo: a.titulo.slice(0, 120),
              relatorio: r.titulo,
              link: linkDoRelatorio(base, r.codigo, a.parametros),
              enderecos: [...a.enderecos],
              grupos: [...a.grupos],
              dono: a.dono.slice(0, 31),
              registrar: true,
            },
            this.dependencias(true),
          ).catch((e: unknown) =>
            logger.warn(
              { estabelecimento: h, erro: e instanceof Error ? e.name : 'erro' },
              'envio agendado falhou',
            ),
          );
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.worker?.close().catch(() => undefined);
    await this.nucleo?.encerrar();
  }
}
