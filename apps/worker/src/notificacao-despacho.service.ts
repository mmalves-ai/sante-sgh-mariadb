// Despachante agendado da notificação por regra no `worker` (01-ADM L76): a cada 5 minutos, por cliente e
// estabelecimento ativo, consolida os avisos da central de cada canal ativo (a mesma regra do domínio da consolidação
// pedida na tela) e entrega os envios pendentes de canal externo. O canal externo só sai em produção (AMBIENTE=producao):
// fora dela a consolidação já grava o envio como "capturado" e nada sai. Em produção, o e-mail sai por SMTP (SMTP_URL),
// com só a contagem dos avisos e o convite para abrir o sistema (nunca nome de paciente nem texto clínico); o
// destinatário sem e-mail, ou o canal sem provedor configurado (mensagem no celular e aplicativo), tem o envio
// registrado como falha com o motivo, visível no histórico da tela. O envio que falhou volta a pendente nos ciclos
// seguintes (evento "repetir" do domínio, até TENTATIVAS_MAXIMAS, com espera crescente) e é entregue de novo. O
// remetente é o EMAIL_REMETENTE, o mesmo dos outros e-mails do worker. Ligado fora de dev/ci; em dev/ci só com
// NOTIFICACAO_DESPACHO=ligado. Log só com contagens.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { NucleoProprio } from '@sgh/nucleo';
import { logger } from './logger.js';
import {
  type PortaDespachoNotificacao,
  PortaDespachoNotificacaoPropria,
} from './notificacao-despacho-propria.js';
import {
  type AlvoEstabelecimento,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';
import { enviarSmtp } from './smtp.js';

export const INTERVALO_DESPACHO_MS = 5 * 60_000;
export const LOTE_ENTREGA = 200;

export function despachoNotificacaoLigado(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'NOTIFICACAO_DESPACHO');
}

/** Quem entrega cada tipo de canal externo (só em produção). Sem entregador, o envio fica como falha com o motivo. */
export interface Entregadores {
  readonly email?: (para: string, assunto: string, texto: string) => Promise<void>;
}

export interface OpcoesDespacho {
  readonly producao: boolean;
  readonly entregadores: Entregadores;
  readonly agora?: Date;
}

export interface ResultadoDespacho {
  readonly envios: number;
  readonly avisos: number;
  readonly aguardando: number;
  readonly retidos: number;
  readonly repetidos: number;
  readonly entregues: number;
  readonly falhas: number;
}

/** Texto do e-mail: só a contagem e o convite para abrir o sistema (nada clínico nem nominal). */
export function textoDoEnvio(quantidade: number): { assunto: string; texto: string } {
  const assunto =
    quantidade === 1 ? 'Você tem 1 aviso no sistema' : `Você tem ${quantidade} avisos no sistema`;
  return {
    assunto,
    texto: `${assunto}. Abra o sistema para ver os detalhes e responder em "Meus avisos".`,
  };
}

/** Um ciclo num estabelecimento: consolida cada canal ativo e, em produção, entrega os pendentes de canal externo. */
export async function cicloDespacho(
  porta: PortaDespachoNotificacao,
  est: AlvoEstabelecimento,
  o: OpcoesDespacho,
): Promise<ResultadoDespacho> {
  const agora = o.agora ?? new Date();
  let envios = 0;
  let avisos = 0;
  let aguardando = 0;
  let retidos = 0;
  for (const c of await porta.canais()) {
    const r = await porta.consolidar(est, c.codigo, o.producao, agora);
    envios += r.envios;
    avisos += r.avisos;
    aguardando += r.aguardando;
    retidos += r.retidos;
  }
  let repetidos = 0;
  let entregues = 0;
  let falhas = 0;
  if (o.producao) {
    repetidos = await porta.repetirFalhas(est, agora, LOTE_ENTREGA);
    for (const p of await porta.pendentes(est, LOTE_ENTREGA)) {
      let erro: string | null = null;
      const entregar = p.tipo === 'email' ? o.entregadores.email : undefined;
      if (!entregar) erro = `Canal ${p.tipo} sem provedor de entrega configurado.`;
      else if (p.contato === null) erro = 'Destinatário sem contato cadastrado para o canal.';
      else {
        const m = textoDoEnvio(p.quantidadeAvisos);
        try {
          await entregar(p.contato, m.assunto, m.texto);
        } catch (e) {
          erro = `Falha na entrega: ${e instanceof Error ? e.name : 'erro'}.`;
        }
      }
      await porta.registrarEntrega(est, p.id, p.versao, erro);
      if (erro === null) entregues++;
      else falhas++;
    }
  }
  return { envios, avisos, aguardando, retidos, repetidos, entregues, falhas };
}

export type FabricaPortaDespacho = (cliente: string) => PortaDespachoNotificacao;

@Injectable()
export class NotificacaoDespachoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaDespacho | null = null;
  private opcoes: OpcoesDespacho = { producao: false, entregadores: {} };
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo, a porta e as opções sem subir o banco. */
  usar(nucleo: NucleoServico, fabrica: FabricaPortaDespacho, opcoes: OpcoesDespacho): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
    this.opcoes = opcoes;
  }

  onApplicationBootstrap(): void {
    if (!despachoNotificacaoLigado(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      const producao = (process.env['AMBIENTE'] ?? '').trim() === 'producao';
      const smtp = process.env['SMTP_URL']?.trim();
      const de = process.env['EMAIL_REMETENTE']?.trim() || 'nao-responda@sgh.invalid';
      const email =
        producao && smtp
          ? (para: string, assunto: string, texto: string) => enviarSmtp(smtp, { de, para, assunto, texto })
          : undefined;
      this.usar(nucleo, (cliente) => new PortaDespachoNotificacaoPropria(nucleo, cliente), {
        producao,
        entregadores: email ? { email } : {},
      });
      this.temporizador = setInterval(() => void this.ciclo(), INTERVALO_DESPACHO_MS);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'despachante de notificação não subiu');
    }
  }

  async ciclo(agora: Date = new Date()): Promise<ResultadoDespacho[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'notificacao-despacho',
        fabrica,
        (porta, est) => cicloDespacho(porta, est, { ...this.opcoes, agora }),
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'despacho de notificação falhou',
          ),
      );
      for (const v of voltas)
        if (v.resultado.envios > 0 || v.resultado.falhas > 0 || v.resultado.repetidos > 0)
          logger.info(
            { cliente: v.cliente, estabelecimento: v.estabelecimento, ...v.resultado },
            'notificação despachada',
          );
      return voltas.map((v) => v.resultado);
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
