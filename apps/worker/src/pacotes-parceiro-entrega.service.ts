// Agendador das entregas aos parceiros no `worker` (F3.9, linha 08-INTG L134). A cada 15 minutos, por cliente: os
// pacotes agendados com a minimização revisada e em dia e com um período devido pela agenda (regra do domínio, no fuso
// do estabelecimento); para cada um, lê a visão do pacote no período (só as colunas do pacote), monta o arquivo com o
// tratamento de cada campo (pseudônimo HMAC por parceiro, máscara, generalização, agregação), guarda-o na porta de
// arquivos e registra a entrega gerada (volume, tamanho, hash, arquivo). Depois o transporte:
//   - fora de produção, SEMPRE simulado: nada sai da máquina; a entrega anda a confirmada com protocolo SIMULADO-<id>;
//   - em produção, API e webhook por HTTP POST ao endereço do ponto de integração do pacote (o recibo do parceiro
//     confirma; sem recibo fica enviada; erro ou sem ponto, falhou com o motivo);
//   - SFTP, arquivo seguro e e-mail seguro ficam geradas: o operador baixa o arquivo na tela e marca a situação.
// Ligado fora de dev/ci; em dev/ci só com PACOTES_PARCEIRO_ENTREGA=ligado. Log só com contagens e códigos; nunca o
// conteúdo nem a chave do pseudônimo (PACOTES_PARCEIRO_CHAVE_PSEUDONIMO).
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  conferirPacoteNoCatalogo,
  montarArquivoPacote,
  protocoloSimulado,
  transporteDaEntrega,
} from '@sgh/dominio-integracao';
import { criarArmazemLocal, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker } from './clientes-worker.js';
import { logger } from './logger.js';
import {
  type PortaEntregasAgendadas,
  PortaEntregasAgendadasPropria,
} from './pacotes-parceiro-entrega-propria.js';
import { servicoLigado } from './servico-worker.js';

export function entregasParceiroLigadas(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'PACOTES_PARCEIRO_ENTREGA');
}

export interface ConfiguracaoEntregas {
  readonly ambiente: string;
  /** Chave do pseudônimo (mínimo de 16 bytes); sem ela, o pacote com pseudônimo não é gerado. */
  readonly chave: string | null;
  /** Transporte HTTP de produção (os testes trocam). */
  readonly http?: typeof fetch;
}

export interface ResultadoCiclo {
  devidos: number;
  geradas: number;
  confirmadas: number;
  enviadas: number;
  falhas: number;
  aguardandoOperador: number;
  /** Códigos das recusas de montagem (sem valores). */
  recusas: string[];
}

/** Um ciclo num cliente: as entregas devidas geradas, guardadas, registradas e transportadas. */
export async function cicloEntregas(
  porta: PortaEntregasAgendadas,
  cfg: ConfiguracaoEntregas,
  agora: Date = new Date(),
): Promise<ResultadoCiclo> {
  const r: ResultadoCiclo = {
    devidos: 0,
    geradas: 0,
    confirmadas: 0,
    enviadas: 0,
    falhas: 0,
    aguardandoOperador: 0,
    recusas: [],
  };
  const ref = await porta.referencia(agora);
  if (!ref) return r;
  const devidos = await porta.devidos(ref, agora);
  r.devidos = devidos.length;
  for (const p of devidos) {
    // A regra do catálogo de novo na hora de gerar (LGPD art. 6 III, 11 e 46): o pacote gravado antes da trava, ou
    // mudado por fora, não sai com identificador aberto, sensível sem marca, duas visões ou pseudônimo no anonimizado.
    const conferencia = conferirPacoteNoCatalogo(p, p.campos);
    if (conferencia.length > 0) {
      r.recusas.push(...conferencia.map((e) => e.codigo));
      continue;
    }
    const lidas = await porta.linhas(ref, p);
    if (lidas.acimaDoTeto) {
      r.recusas.push('volume-acima-do-teto');
      continue;
    }
    const a = montarArquivoPacote({
      formato: p.formato,
      anonimizacao: p.anonimizacao,
      campos: p.campos,
      linhas: lidas.linhas,
      cabecalho: {
        pacote: p.codigo,
        periodoInicio: p.devida.inicio,
        periodoFim: p.devida.fim,
        geradoEm: agora,
      },
      tratamento: { chave: cfg.chave, escopo: p.parceiro },
    });
    if (!a.ok) {
      r.recusas.push(...a.erros.map((e) => e.codigo));
      continue;
    }
    const reg = await porta.registrar(ref, p, a, agora);
    if (!reg) continue;
    r.geradas++;
    const t = transporteDaEntrega(p.meioEntrega, cfg.ambiente);
    if (t.modo === 'operador') {
      r.aguardandoOperador++;
      continue;
    }
    if (t.modo === 'simulado') {
      await porta.situacao(
        ref,
        reg.entrega,
        ['enviada', 'confirmada'],
        {
          protocolo: protocoloSimulado(reg.entrega),
          mensagem: 'Simulado fora de produção: nada saiu da máquina.',
        },
        agora,
      );
      r.confirmadas++;
      continue;
    }
    if (!p.endereco) {
      await porta.situacao(
        ref,
        reg.entrega,
        ['falhou'],
        { mensagem: 'Pacote sem ponto de integração ativo: nada enviado.' },
        agora,
      );
      r.falhas++;
      continue;
    }
    try {
      const h = await (cfg.http ?? fetch)(p.endereco, {
        method: 'POST',
        headers: {
          'content-type': a.tipoMime,
          'idempotency-key': `pacote-${p.id}-entrega-${reg.entrega}`,
          'x-conteudo-sha256': a.hashSha256,
        },
        body: a.conteudo,
        signal: AbortSignal.timeout(30_000),
      });
      if (!h.ok) throw new Error(`HTTP ${h.status}`);
      const recibo = (h.headers.get('x-recibo') ?? h.headers.get('location'))?.slice(0, 100) ?? null;
      await porta.situacao(
        ref,
        reg.entrega,
        recibo ? ['enviada', 'confirmada'] : ['enviada'],
        { protocolo: recibo, mensagem: `HTTP ${h.status}` },
        agora,
      );
      if (recibo) r.confirmadas++;
      else r.enviadas++;
    } catch (e) {
      await porta.situacao(
        ref,
        reg.entrega,
        ['falhou'],
        {
          mensagem: `Destino indisponível (${e instanceof Error ? e.message.slice(0, 80) : 'erro'}).`,
        },
        agora,
      );
      r.falhas++;
    }
  }
  return r;
}

export type FabricaPortaEntregas = (cliente: string) => PortaEntregasAgendadas;

@Injectable()
export class PacotesParceiroEntregaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoProprio | null = null;
  private fabrica: FabricaPortaEntregas | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  onApplicationBootstrap(): void {
    if (!entregasParceiroLigadas(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      const armazem = criarArmazemLocal(nucleo);
      this.nucleo = nucleo;
      this.fabrica = (cliente) => new PortaEntregasAgendadasPropria(nucleo, cliente, armazem);
      void this.ciclo();
      this.temporizador = setInterval(() => void this.ciclo(), 15 * 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.name : 'erro' },
        'agendador das entregas aos parceiros não subiu',
      );
    }
  }

  async ciclo(agora: Date = new Date()): Promise<void> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return;
    this.rodando = true;
    const chave = process.env['PACOTES_PARCEIRO_CHAVE_PSEUDONIMO']?.trim() || null;
    const cfg: ConfiguracaoEntregas = { ambiente: (process.env['AMBIENTE'] ?? '').trim(), chave };
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'pacotes-entrega')) {
        try {
          const x = await cicloEntregas(fabrica(cliente), cfg, agora);
          if (x.devidos > 0)
            logger.info(
              {
                cliente,
                devidos: x.devidos,
                geradas: x.geradas,
                confirmadas: x.confirmadas,
                enviadas: x.enviadas,
                falhas: x.falhas,
                aguardandoOperador: x.aguardandoOperador,
                recusas: [...new Set(x.recusas)],
              },
              'entregas aos parceiros',
            );
        } catch (e) {
          logger.warn(
            { cliente, erro: e instanceof Error ? e.name : 'erro' },
            'entregas aos parceiros falharam',
          );
        }
      }
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'entregas aos parceiros sem clientes');
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
