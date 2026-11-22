// Fila `email-<cliente>` (M06, regra 8; lote F2.2 05-15): um consumidor por cliente (a lista do ambiente ou os
// clientes da plataforma, conferida a cada hora) entrega os alertas (quebra de vidro, sessão "como", leitura do
// prontuário, chamado, tabela vazia, divergência de gravação) por SMTP (SMTP_URL; fora de produção só o Mailpit em
// loopback, pela trava de saídas).
// Melhoria: a fila é a do cliente (a mesma em que o relay publica, filaDeEmail), não a de uma rede fixa no ambiente. A
// mensagem leva só identificadores (estabelecimento, número do acesso, ID do usuário, motivo, início e fim): nunca nome
// de paciente, justificativa ou texto clínico. Sem VALKEY_URL ou sem SMTP_URL, desligado (com aviso).
// Melhoria: o destinatário é o da configuração do próprio cliente (parâmetros alerta.email.* no nível da rede, no banco
// do cliente), resolvido por cliente a cada alerta: o alerta de um cliente nunca vai à caixa de outro. As variáveis
// AUDITORIA_EMAIL, ENCARREGADO_EMAIL, PLANTAO_EMAIL, AVISO_TI_EMAIL e AVISO_RT_EMAIL só desviam para a captura fora de
// produção; em produção são ignoradas, e o cliente sem destinatário configurado tem o alerta recusado (falha visível
// na fila, ErroDestinatarioNaoConfigurado), nunca entregue a um endereço comum.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { type AlertaSuporteJob, conferirAlertaSuporte } from '@sgh/contratos';
import { envioExternoPermitido, type Leitor, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker, type NucleoClientes } from './clientes-worker.js';
import { logger } from './logger.js';
import { conexaoValkey, filaDeEmail, PREFIXO_FILAS } from './relay-outbox.js';
import type { NucleoWorker } from './servico-worker.js';
import { enviarSmtp, type MensagemEmail } from './smtp.js';

export interface AlertaEmergenciaJob {
  readonly rede: string;
  readonly hospital: string;
  readonly idEmergencia: string;
  readonly idUsuario: string;
  readonly motivo: string;
  readonly inicio: string;
  readonly fim: string;
}

const CODIGO = /^[A-Za-z0-9._:-]{1,64}$/;

/** Texto do alerta (só códigos; o conteúdo do job é conferido antes). */
export function mensagemDoAlerta(j: AlertaEmergenciaJob, para: string, de: string): MensagemEmail {
  for (const v of [j.rede, j.hospital, j.idEmergencia, j.idUsuario, j.motivo, j.inicio, j.fim])
    if (typeof v !== 'string' || !CODIGO.test(v)) throw new Error('Alerta com campo fora do formato.');
  return {
    de,
    para,
    assunto: `Acesso de emergência nº ${j.idEmergencia} (${j.hospital})`,
    texto: [
      'Um acesso de emergência (quebra de vidro) foi aberto e precisa de revisão.',
      '',
      `Estabelecimento: ${j.hospital}`,
      `Registro: ${j.idEmergencia}`,
      `Usuário (ID): ${j.idUsuario}`,
      `Motivo: ${j.motivo}`,
      `Início: ${j.inicio}`,
      `Fim: ${j.fim}`,
      '',
      'Revise em Administração > Acesso > Revisão de acessos por quebra de vidro.',
    ].join('\n'),
  };
}

/** ADR 0021: aviso ao Auditor da abertura de uma sessão "como" (só identificadores e códigos). */
export type { AlertaSuporteJob };

/**
 * O job vem da SGH_OUTBOX (carga gravada pela API + hospital e rede do relay; o hospital é o banco da
 * plataforma, o estabelecimento da sessão vai na carga) ou direto da fila (dev/ci). Conferido por
 * conferirAlertaSuporte (contratos), o mesmo formato que a API monta.
 */
export function mensagemDoAlertaSuporte(
  d: unknown,
  para: string,
  de: string,
  cliente?: string,
): MensagemEmail {
  // A carga da fila comum não leva a rede: é o cliente dono da fila (o relay publica uma fila por cliente).
  const j = conferirAlertaSuporte(
    cliente && typeof d === 'object' && d !== null ? { rede: cliente, ...d } : d,
  );
  return {
    de,
    para,
    assunto: `Acesso do suporte técnico nº ${j.idSessao} (${j.estabelecimento})`,
    texto: [
      'O suporte técnico entrou no sistema em nome de um usuário (sessão "como"). Tudo o que for feito fica',
      'registrado na auditoria com o autor real e pode ser corrigido.',
      '',
      `Estabelecimento: ${j.estabelecimento}`,
      `Sessão: ${j.idSessao}`,
      `Quem entrou: ${j.atorTipo === 'plataforma' ? 'administração da plataforma' : 'suporte técnico'}`,
      `Usuário (ID) em nome de quem: ${j.idUsuario}`,
      `Motivo ou chamado: ${j.motivo}`,
      `Início: ${j.inicio}`,
      `Fim previsto: ${j.fim}`,
    ].join('\n'),
  };
}

/** M15 (regra 12): alerta de leitura do prontuário (só códigos: estabelecimento, usuário, tipo e instante). */
export interface AlertaLeituraJob {
  readonly rede: string;
  readonly hospital: string;
  readonly idUsuario: string;
  readonly tipo: 'muitos-prontuarios' | 'fora-do-horario';
  readonly criticidade: number;
  readonly em: string;
}

export function mensagemDoAlertaLeitura(j: AlertaLeituraJob, para: string, de: string): MensagemEmail {
  for (const v of [j.rede, j.hospital, j.idUsuario, j.tipo, j.em])
    if (typeof v !== 'string' || !CODIGO.test(v)) throw new Error('Alerta com campo fora do formato.');
  if (!['muitos-prontuarios', 'fora-do-horario'].includes(j.tipo) || ![2, 4, 7].includes(j.criticidade))
    throw new Error('Alerta com tipo ou criticidade fora do formato.');
  return {
    de,
    para,
    assunto: `Alerta de leitura do prontuário (${j.hospital})`,
    texto: [
      j.tipo === 'muitos-prontuarios'
        ? 'Um usuário abriu muitos prontuários diferentes em pouco tempo.'
        : 'Um prontuário foi aberto fora do horário habitual.',
      '',
      `Estabelecimento: ${j.hospital}`,
      `Usuário (ID): ${j.idUsuario}`,
      `Criticidade: ${j.criticidade}`,
      `Quando: ${j.em}`,
      '',
      'Confira em Administração > Auditoria e privacidade > Registro de acesso ao prontuário, com "Só os alertas ao Auditor" marcado.',
    ].join('\n'),
  };
}

/** Os papéis que recebem alertas e a chave do parâmetro (nível rede, no banco do cliente) de cada um. */
export const PARAMETROS_DESTINO = {
  auditoria: 'alerta.email.auditoria',
  encarregado: 'alerta.email.encarregado',
  plantao: 'alerta.email.plantao',
  ti: 'alerta.email.ti',
  responsavelTecnico: 'alerta.email.responsavelTecnico',
} as const;
export type PapelAlerta = keyof typeof PARAMETROS_DESTINO;
/** Os endereços configurados por papel no banco do cliente. */
export type DestinatariosCliente = Partial<Record<PapelAlerta, readonly string[]>>;

/** Variável de desvio para a captura, só fora de produção. */
const DESVIO_CAPTURA: Readonly<Record<PapelAlerta, string>> = {
  auditoria: 'AUDITORIA_EMAIL',
  encarregado: 'ENCARREGADO_EMAIL',
  plantao: 'PLANTAO_EMAIL',
  ti: 'AVISO_TI_EMAIL',
  responsavelTecnico: 'AVISO_RT_EMAIL',
};

const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,189}\.[^\s@,;]{2,}$/;

export class ErroDestinatarioNaoConfigurado extends Error {
  override readonly name = 'ErroDestinatarioNaoConfigurado';
}

/** Os endereços válidos de um valor de parâmetro (separados por vírgula, ponto e vírgula ou espaço). */
export function enderecosDoValor(valor: unknown): string[] {
  return [
    ...new Set(
      String(valor ?? '')
        .split(/[,;\s]+/)
        .filter((x) => EMAIL.test(x)),
    ),
  ];
}

/** Os destinatários configurados do cliente (parâmetros vigentes no nível da rede, o mais recente de cada chave). */
export async function lerDestinatariosCliente(l: Leitor, agora: Date): Promise<DestinatariosCliente> {
  const chaves = Object.values(PARAMETROS_DESTINO);
  const linhas = await l.consultar(
    `SELECT d.chave, pv.valor FROM parametro_valor pv JOIN parametro_definicao d ON d.id = pv.parametro_definicao_id
      WHERE d.chave IN (${chaves.map(() => '?').join(', ')}) AND pv.nivel = 'rede'
        AND pv.vigencia_inicio <= ? AND (pv.vigencia_fim IS NULL OR pv.vigencia_fim > ?)
      ORDER BY pv.vigencia_inicio DESC, pv.id DESC`,
    [...chaves, agora, agora],
    { teto: 100 },
  );
  const r: Partial<Record<PapelAlerta, string[]>> = {};
  for (const [papel, chave] of Object.entries(PARAMETROS_DESTINO) as [PapelAlerta, string][]) {
    const vigente = linhas.find((x) => x['chave'] === chave);
    const enderecos = vigente ? enderecosDoValor(vigente['valor']) : [];
    if (enderecos.length > 0) r[papel] = enderecos;
  }
  return r;
}

/**
 * Os endereços de um alerta para os papéis pedidos, sem repetir. O papel sem endereço próprio cai na auditoria do
 * cliente. Fora de produção, a variável de desvio (ou AUDITORIA_EMAIL) manda à captura e, sem nada configurado, vai a
 * `auditoria@<cliente>.invalid` (só a captura recebe). Em produção, sem endereço: ErroDestinatarioNaoConfigurado.
 */
export function resolverDestino(
  cfg: DestinatariosCliente,
  env: NodeJS.ProcessEnv,
  dominio: string,
  papeis: readonly PapelAlerta[],
): string[] {
  const producao = envioExternoPermitido(env);
  const r = new Set<string>();
  for (const papel of papeis) {
    const desvio = producao ? '' : env[DESVIO_CAPTURA[papel]]?.trim() || env['AUDITORIA_EMAIL']?.trim() || '';
    const lista = desvio ? [desvio] : cfg[papel]?.length ? cfg[papel] : (cfg.auditoria ?? []);
    for (const x of lista) r.add(x);
  }
  if (r.size === 0) {
    if (producao)
      throw new ErroDestinatarioNaoConfigurado(
        `sem ${PARAMETROS_DESTINO[papeis[0] ?? 'auditoria']} no cliente`,
      );
    r.add(`auditoria@${dominio}.invalid`);
  }
  return [...r];
}

/** M37 (regra 7): o aviso do chamado (só códigos: estabelecimento, número, severidade e o motivo do aviso). */
export interface AlertaChamadoJob {
  readonly rede: string;
  readonly hospital: string;
  readonly idChamado: string;
  readonly severidade: string;
  readonly motivo: string;
}

export function mensagemDoAlertaChamado(j: AlertaChamadoJob, para: string, de: string): MensagemEmail {
  for (const v of [j.rede, j.hospital, j.idChamado, j.severidade, j.motivo])
    if (typeof v !== 'string' || !CODIGO.test(v)) throw new Error('Alerta com campo fora do formato.');
  const pessoal = j.motivo === 'dado-pessoal';
  return {
    de,
    para,
    assunto: pessoal
      ? `Chamado ${j.idChamado} envolve dado pessoal (${j.hospital})`
      : `Chamado ${j.severidade} aberto (${j.hospital})`,
    texto: [
      pessoal
        ? 'Um chamado foi aberto marcando incidente com dado pessoal: avalie a comunicação preliminar (prazo de 3 dias úteis).'
        : 'Um chamado de severidade crítica foi aberto: designe o comandante e atualize a cada 30 minutos.',
      '',
      `Estabelecimento: ${j.hospital}`,
      `Chamado: ${j.idChamado}`,
      `Severidade: ${j.severidade}`,
      '',
      'Confira em Técnico > Banco de dados > Migração gradual dos usuários, aba Chamados.',
    ].join('\n'),
  };
}

/** Destino do aviso do chamado: o encarregado (dado pessoal) ou o plantão; sem eles, a auditoria do cliente. */
export function destinoAlertaChamado(
  cfg: DestinatariosCliente,
  env: NodeJS.ProcessEnv,
  dominio: string,
  motivo: string,
): string[] {
  return resolverDestino(cfg, env, dominio, [motivo === 'dado-pessoal' ? 'encarregado' : 'plantao']);
}

/** O domínio dos endereços padrão do cliente (o código do cliente sem o sublinhado, que não vale em nome de host). */
export function dominioDoCliente(cliente: string): string {
  return cliente.replace(/_/g, '-');
}

@Injectable()
export class EmailService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: (NucleoClientes & Pick<NucleoWorker, 'lerSomente'> & { encerrar(): Promise<void> }) | null =
    null;
  private readonly consumidores = new Map<string, Worker>();
  private temporizador: NodeJS.Timeout | undefined;

  async onApplicationBootstrap(): Promise<void> {
    const valkey = process.env['VALKEY_URL']?.trim();
    const smtp = process.env['SMTP_URL']?.trim();
    if (!valkey || !smtp) {
      logger.warn('fila email desligada (sem VALKEY_URL ou SMTP_URL)');
      return;
    }
    try {
      this.nucleo = new NucleoProprio({ env: process.env });
      await this.assinar(valkey, smtp);
      this.temporizador = setInterval(() => void this.assinar(valkey, smtp), 3_600_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'fila email não subiu');
    }
  }

  /** Um consumidor para cada cliente ainda sem consumidor (o cliente novo entra na volta seguinte). */
  async assinar(valkey: string, smtp: string): Promise<number> {
    if (!this.nucleo) return 0;
    let novos = 0;
    try {
      for (const cliente of await clientesDoWorker(this.nucleo, process.env, 'email')) {
        if (this.consumidores.has(cliente)) continue;
        this.consumidores.set(cliente, this.consumidor(cliente, valkey, smtp));
        novos++;
      }
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'fila email: clientes indisponíveis');
    }
    return novos;
  }

  /** Os destinatários do cliente, lidos do banco dele a cada alerta (alertas são raros; a mudança vale na hora). */
  private destinatarios(cliente: string): Promise<DestinatariosCliente> {
    const nucleo = this.nucleo;
    if (!nucleo) return Promise.resolve({});
    return nucleo.lerSomente({ cliente, estabelecimento: null, correlacao: 'email' }, (l) =>
      lerDestinatariosCliente(l, new Date()),
    );
  }

  private consumidor(cliente: string, valkey: string, smtp: string): Worker {
    const dominio = dominioDoCliente(cliente);
    const de = process.env['EMAIL_REMETENTE']?.trim() || `nao-responda@${dominio}.invalid`;
    const enviar = async (destinos: readonly string[], m: (para: string) => MensagemEmail) => {
      for (const para of destinos) await enviarSmtp(smtp, m(para));
    };
    const w = new Worker(
      filaDeEmail(cliente),
      async (job) => {
        const tipos = ['alerta-suporte', 'alerta-emergencia', 'alerta-leitura', 'alerta-chamado'];
        if (!tipos.includes(job.name)) return;
        const cfg = await this.destinatarios(cliente);
        const auditoria = resolverDestino(cfg, process.env, dominio, ['auditoria']);
        if (job.name === 'alerta-suporte')
          await enviar(auditoria, (para) => mensagemDoAlertaSuporte(job.data, para, de, cliente));
        else if (job.name === 'alerta-emergencia')
          await enviar(auditoria, (para) => mensagemDoAlerta(job.data as AlertaEmergenciaJob, para, de));
        else if (job.name === 'alerta-leitura')
          await enviar(auditoria, (para) => mensagemDoAlertaLeitura(job.data as AlertaLeituraJob, para, de));
        else if (job.name === 'alerta-chamado') {
          const j = job.data as AlertaChamadoJob;
          await enviar(destinoAlertaChamado(cfg, process.env, dominio, j.motivo), (para) =>
            mensagemDoAlertaChamado(j, para, de),
          );
        }
        logger.info(
          {
            fila: 'email',
            cliente,
            tipo: job.name,
            estabelecimento: (job.data as AlertaEmergenciaJob).hospital,
          },
          'e-mail entregue',
        );
      },
      { connection: conexaoValkey(valkey, true), prefix: PREFIXO_FILAS, concurrency: 2 },
    );
    w.on('error', () => undefined);
    w.on('failed', (job, e) =>
      logger.warn(
        { fila: 'email', cliente, tentativa: job?.attemptsMade ?? 0, erro: e.name },
        'e-mail não entregue',
      ),
    );
    return w;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    for (const w of this.consumidores.values()) await w.close().catch(() => undefined);
    this.consumidores.clear();
    await this.nucleo?.encerrar();
  }
}
