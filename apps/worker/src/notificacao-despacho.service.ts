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
import { FINALIDADE_AVISO_SISTEMA, valoresDoEnvio } from '@sgh/dominio-acesso';
import { envioExternoPermitido, NucleoProprio } from '@sgh/nucleo';
import { leitorDoCofre } from './cofre-leitura.js';
import { entregarComRegistro } from './email-entrega.js';
import { type AmbienteDoEnvio, prepararSaida } from './email-saida-cadastro.js';
import { type SaidaDoCadastro, saidaDoCliente } from './email-saida-propria.js';
import { logger } from './logger.js';
import {
  type PortaDespachoNotificacao,
  PortaDespachoNotificacaoPropria,
} from './notificacao-despacho-propria.js';
import {
  type AlvoEstabelecimento,
  type NucleoServico,
  type NucleoWorker,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';
import { RegistroEnvioProprio } from './registro-envio-proprio.js';
import { conexaoDoUrl } from './smtp.js';

export const INTERVALO_DESPACHO_MS = 5 * 60_000;
export const LOTE_ENTREGA = 200;

export function despachoNotificacaoLigado(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'NOTIFICACAO_DESPACHO');
}

/** Quem entrega cada tipo de canal externo (só em produção). Sem entregador, o envio fica como falha com o motivo. */
export interface Entregadores {
  readonly email?: (para: string, assunto: string, texto: string, envio?: EnvioDoAviso) => Promise<void>;
}

/** O envio do aviso: o estabelecimento, a chave estável (o mesmo envio, a mesma chave) e a contagem de avisos. */
export interface EnvioDoAviso {
  readonly estabelecimento: AlvoEstabelecimento;
  readonly chave: string;
  readonly quantidade: number;
}

/**
 * 01-ADM L77 (C1-063): o e-mail do aviso pelo cadastro do cliente (servidor_email e modelo_email vigente da finalidade
 * AVISO_SISTEMA, senha pelo cofre; sem servidor cadastrado, o do ambiente), com o registro geral de envio (envio_email)
 * levando finalidade, modelo e servidor. Marcadores do modelo: aviso.quantidade, aviso.assunto e aviso.texto.
 */
export function entregadorPeloCadastro(
  nucleo: NucleoWorker,
  ambiente: AmbienteDoEnvio,
): NonNullable<Entregadores['email']> {
  return async (para, assunto, texto, envio) => {
    if (!envio) throw new Error('Aviso sem o estabelecimento do envio.');
    const cliente = envio.estabelecimento.cliente;
    let cadastro: SaidaDoCadastro | null = null;
    try {
      cadastro = await saidaDoCliente(
        nucleo,
        cliente,
        FINALIDADE_AVISO_SISTEMA,
        envio.estabelecimento.codigo,
      );
    } catch (e) {
      logger.warn(
        { cliente, erro: e instanceof Error ? e.name : 'erro' },
        'aviso por e-mail: cadastro de saída indisponível',
      );
    }
    const saida = await prepararSaida(cadastro, cliente, ambiente);
    const padrao = { de: ambiente.remetentePadrao, para, assunto, texto };
    const mensagem = saida.montar(padrao, valoresDoEnvio('aviso', { quantidade: envio.quantidade }, padrao));
    const falhas = await entregarComRegistro({
      chave: envio.chave,
      dominio: cliente.replace(/_/g, '-'),
      estabelecimento: envio.estabelecimento.codigo,
      destinos: [para],
      montar: () => mensagem,
      enviar: (m) => saida.enviar(m),
      registro: new RegistroEnvioProprio(nucleo, cliente, ambiente.producao),
      origem: saida.origem,
    });
    if (falhas.length > 0) logger.warn({ cliente, erros: falhas }, 'aviso por e-mail sem registro');
  };
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
          await entregar(p.contato, m.assunto, m.texto, {
            estabelecimento: est,
            chave: `aviso.${est.codigo}.${p.id}`,
            quantidade: p.quantidadeAvisos,
          });
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
      const producao =
        (process.env['AMBIENTE'] ?? '').trim() === 'producao' && envioExternoPermitido(process.env);
      const smtp = process.env['SMTP_URL']?.trim();
      const local = smtp ? conexaoDoUrl(smtp) : null;
      // Só em produção há entrega externa; o servidor vem do cadastro do cliente (sem ele, o do ambiente).
      const email = producao
        ? entregadorPeloCadastro(nucleo, {
            producao,
            local: local ? { host: local.host, porta: local.porta } : null,
            remetentePadrao: process.env['EMAIL_REMETENTE']?.trim() || 'nao-responda@sgh.invalid',
            lerSegredo: leitorDoCofre(process.env),
          })
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
