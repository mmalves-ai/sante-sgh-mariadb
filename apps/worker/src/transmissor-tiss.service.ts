// Transmissor TISS pelo serviço web da operadora (C2-070, 06-FAT linha 26): as mensagens de saída que o relay já tirou
// da outbox (integracao_mensagem 'enviada') nos pontos da consulta de elegibilidade (tiss.elegibilidade) e da
// comunicação de beneficiário (tiss.comunicacao_beneficiario) vão ao destino e o recibo volta para a própria mensagem
// (resposta + 'processada'; falha de transporte vira 'erro' com o código). A API lê esse retorno pela regra do domínio
// (respostaElegibilidadeDoRetorno e retornoDaIntegracao) quando a recepção clica em "Ler o retorno".
// Regra 6: fora de produção o destino é sempre o falso (recibo sintético, sem rede); em produção, só com o transporte
// da operadora configurado — sem ele, nada sai e as mensagens ficam na fila (nunca recibo inventado em produção).
// A marcação é infraestrutura da fila, como no relay: transação curta condicionada à situação 'enviada' (dois
// transmissores não respondem duas vezes), sem trilha própria. Log só com ids, códigos e contagens.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { respostaSimulada } from '@sgh/dominio-integracao';
import { lerInteiroAmbiente, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker } from './clientes-worker.js';
import { logger } from './logger.js';
import type { NucleoRelay } from './relay-outbox-proprio.js';

export const PONTOS_TRANSMISSOR_TISS = ['tiss.elegibilidade', 'tiss.comunicacao_beneficiario'] as const;
export type PontoTransmissorTiss = (typeof PONTOS_TRANSMISSOR_TISS)[number];
export const TETO_TRANSMISSOR_TISS = 50;

export interface MensagemTiss {
  readonly id: number;
  readonly ponto: PontoTransmissorTiss;
  /** Só ids e códigos (a carga que a porta gravou na outbox). */
  readonly carga: Readonly<Record<string, unknown>>;
}

/** O destino devolve o recibo (JSON no formato que o domínio lê) ou lança em falha de transporte. */
export type DestinoTiss = (m: MensagemTiss) => Promise<Record<string, unknown>>;

/** A entrada da central de integrações externas (decisão 53) que este transmissor serve. */
export const INTEGRACAO_OPERADORA_TISS = 'operadora-tiss-webservice';

/** A chave do simulador: a mesma mensagem dá sempre a mesma resposta. */
export const chaveSimuladorTiss = (m: Pick<MensagemTiss, 'id' | 'ponto'>): string => `${m.ponto}:${m.id}`;

/**
 * O recibo do simulador pelo contrato do serviço da operadora (simulador comum do domínio, `respostaSimulada`): aceite
 * (elegível com código de validação; comunicação aceita com protocolo), recusa (inelegível ou recusada, com motivo) e
 * erro de transporte (lança, e a mensagem vira 'erro' com o código).
 */
export function reciboSimuladoTiss(ponto: PontoTransmissorTiss, chave: string): Record<string, unknown> {
  const r = respostaSimulada(INTEGRACAO_OPERADORA_TISS, chave);
  if (r.tipo === 'erro-transporte') {
    const e = new Error(r.mensagem);
    e.name = 'SimuladorSemResposta';
    throw e;
  }
  if (ponto === 'tiss.elegibilidade')
    return r.tipo === 'aceite'
      ? { elegivel: true, codigoValidacao: r.protocolo.slice(0, 20) }
      : { elegivel: false, motivo: `${r.codigo}: ${r.mensagem}` };
  return r.tipo === 'aceite'
    ? { aceita: true, protocolo: r.protocolo.slice(0, 50) }
    : { aceita: false, motivo: `${r.codigo}: ${r.mensagem}` };
}

/**
 * Destino falso (fora de produção): o simulador da central, nenhuma rede. O mesmo caminho da produção, com o recibo
 * previsível.
 */
export const destinoFalsoTiss: DestinoTiss = (m) => {
  try {
    return Promise.resolve(reciboSimuladoTiss(m.ponto, chaveSimuladorTiss(m)));
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error('simulador'));
  }
};

/**
 * O destino do ambiente: o simulador fora de produção; em produção, o transporte real ou nenhum. O real depende da
 * definição do webservice de cada operadora (aviso na central): até ele ser escrito, nenhum, e a API (que pergunta à
 * central por transporteTissDaCentral) também não põe nada na outbox em produção.
 */
export function destinoDoAmbiente(
  env: NodeJS.ProcessEnv,
  transporteProducao: DestinoTiss | null = null,
): DestinoTiss | null {
  const producao = (env['AMBIENTE'] ?? '').trim() === 'producao';
  return producao ? transporteProducao : destinoFalsoTiss;
}

export interface ResultadoTransmissorTiss {
  readonly lidas: number;
  readonly processadas: number;
  readonly falhas: number;
}

function carga(conteudo: unknown): Record<string, unknown> {
  try {
    const v = typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Um ciclo no cliente (`estabelecimento`: só as dele, para os testes isolarem a massa). */
export async function cicloTransmissorTiss(
  nucleo: NucleoRelay,
  cliente: string,
  destino: DestinoTiss,
  opcoes: { readonly agora?: () => Date; readonly estabelecimento?: number } = {},
): Promise<ResultadoTransmissorTiss> {
  const agora = opcoes.agora ?? (() => new Date());
  const ctx = { cliente, correlacao: 'transmissor-tiss' };
  const filtro = opcoes.estabelecimento === undefined ? '' : ' AND estabelecimento_id = ?';
  const linhas = await nucleo.lerSomente(ctx, (l) =>
    l.consultar(
      `SELECT id, ponto, conteudo FROM integracao_mensagem
        WHERE direcao = 'saida' AND situacao = 'enviada' AND resposta IS NULL
          AND ponto IN ('tiss.elegibilidade', 'tiss.comunicacao_beneficiario')${filtro}
        ORDER BY id LIMIT ${TETO_TRANSMISSOR_TISS}`,
      opcoes.estabelecimento === undefined ? [] : [opcoes.estabelecimento],
    ),
  );
  let processadas = 0;
  let falhas = 0;
  for (const x of linhas) {
    const m: MensagemTiss = {
      id: Number(x['id']),
      ponto: String(x['ponto']) as PontoTransmissorTiss,
      carga: carga(x['conteudo']),
    };
    let recibo: Record<string, unknown> | null = null;
    let erro: string | null = null;
    try {
      recibo = await destino(m);
    } catch (e) {
      erro = `transporte-falhou:${e instanceof Error ? e.name : 'erro'}`.slice(0, 200);
    }
    const t = agora();
    await nucleo.escrever(ctx, (w) =>
      w.executar(
        `UPDATE integracao_mensagem SET situacao = ?, resposta = ?, erro = ?, processada_em = ?, alterado_em = ?,
                versao = versao + 1
          WHERE id = ? AND situacao = 'enviada' AND resposta IS NULL`,
        [recibo ? 'processada' : 'erro', recibo ? JSON.stringify(recibo) : null, erro, t, t, m.id],
      ),
    );
    if (recibo) processadas++;
    else falhas++;
  }
  return { lidas: linhas.length, processadas, falhas };
}

@Injectable()
export class TransmissorTissService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoProprio | null = null;
  private destino: DestinoTiss | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  onApplicationBootstrap(): void {
    if (process.env['TRANSMISSOR_TISS'] === 'desligado') return;
    const destino = destinoDoAmbiente(process.env);
    if (!destino) {
      logger.warn('transmissor TISS sem transporte de produção configurado: as mensagens ficam na fila');
      return;
    }
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'TRANSMISSOR_TISS_INTERVALO_MS', 5_000, 500, 600_000);
      this.nucleo = new NucleoProprio({ env: process.env });
      this.destino = destino;
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'transmissor TISS não subiu');
    }
  }

  async ciclo(): Promise<void> {
    const nucleo = this.nucleo;
    const destino = this.destino;
    if (this.rodando || !nucleo || !destino) return;
    this.rodando = true;
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'transmissor-tiss')) {
        try {
          const r = await cicloTransmissorTiss(nucleo, cliente, destino);
          if (r.lidas > 0) logger.info({ cliente, ...r }, 'transmissor TISS');
        } catch (e) {
          logger.warn(
            { cliente, erro: e instanceof Error ? e.name : 'erro' },
            'transmissor TISS: ciclo falhou',
          );
        }
      }
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'transmissor TISS: clientes indisponíveis');
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
