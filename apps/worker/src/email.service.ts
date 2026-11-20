// Fila `email-<rede>` (M06, regra 8): o consumidor entrega o alerta de quebra de vidro ao Auditor por SMTP
// (SMTP_URL; fora de produção só o Mailpit em loopback, pela trava de saídas). Destinatário em AUDITORIA_EMAIL
// (padrão auditoria@<rede>.invalid). A mensagem leva só identificadores (estabelecimento, número do acesso,
// ID do usuário, motivo, início e fim): nunca nome de paciente, justificativa ou texto clínico. Sem
// VALKEY_URL ou sem SMTP_URL, desligado (com aviso).
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { type AlertaSuporteJob, conferirAlertaSuporte } from '@sgh/contratos';
import { lerRedePadrao } from '@sgh/legado';
import { logger } from './logger.js';
import { conexaoValkey, PREFIXO_FILAS } from './relay-outbox.js';
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
export function mensagemDoAlertaSuporte(d: unknown, para: string, de: string): MensagemEmail {
  const j = conferirAlertaSuporte(d);
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

/** M14 (regra 14): tabela vazia que passou a ter dados no banco do estabelecimento (só o nome da tabela). */
export function mensagemDoAlertaTabelaVazia(d: unknown, para: string, de: string): MensagemEmail {
  const j = d as { tabela?: unknown; hospital?: unknown };
  const tabela = typeof j.tabela === 'string' && /^[A-Z][A-Z0-9_$]{0,30}$/.test(j.tabela) ? j.tabela : null;
  const hospital = typeof j.hospital === 'string' && CODIGO.test(j.hospital) ? j.hospital : null;
  if (!tabela || !hospital) throw new Error('Alerta com campo fora do formato.');
  return {
    de,
    para,
    assunto: `Tabela vazia passou a ter dados (${hospital})`,
    texto: [
      'A vigia diária encontrou dados numa tabela que estava vazia no banco do estabelecimento.',
      '',
      `Estabelecimento: ${hospital}`,
      `Tabela: ${tabela}`,
      '',
      'Registre o destino dela na matriz de cobertura (Administração > Coexistência > Painel da matriz de cobertura).',
    ].join('\n'),
  };
}

/**
 * Correção do M14 (regra 14): o aviso de tabela vazia que passou a ter dados vai à TI e ao responsável técnico
 * (AVISO_TI_EMAIL e AVISO_RT_EMAIL; sem eles, a caixa da auditoria e a do responsável técnico da rede).
 */
export function destinatariosTabelaVazia(env: NodeJS.ProcessEnv, padrao: string, rede: string): string[] {
  const ti = env['AVISO_TI_EMAIL']?.trim() || padrao;
  const rt = env['AVISO_RT_EMAIL']?.trim() || `responsavel-tecnico@${rede}.invalid`;
  return [...new Set([ti, rt])];
}

/**
 * M38 (cap-14 §14.6): divergência na vigilância diária de gravação em produção. Só códigos e contagens: o
 * estabelecimento, o dia, a operação, quantas divergiram e onde (tabela e coluna), nunca valor de linha.
 */
export function mensagemDoAlertaAssinatura(d: unknown, para: string, de: string): MensagemEmail {
  const j = d as Record<string, unknown>;
  const hospital = typeof j['hospital'] === 'string' && CODIGO.test(j['hospital']) ? j['hospital'] : null;
  const dia = typeof j['dia'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j['dia']) ? j['dia'] : null;
  const operacao =
    typeof j['operacao'] === 'string' && /^[a-z]+\.[A-Za-z0-9]+$/.test(j['operacao']) ? j['operacao'] : null;
  const n = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const divergentes = n(j['divergentes']);
  const amostradas = n(j['amostradas']);
  const onde = typeof j['onde'] === 'string' && /^[A-Z0-9_$.,]{0,500}$/.test(j['onde']) ? j['onde'] : null;
  if (!hospital || !dia || !operacao || divergentes === null || amostradas === null || onde === null)
    throw new Error('Alerta com campo fora do formato.');
  return {
    de,
    para,
    assunto: `Divergência de gravação em ${hospital} (${dia})`,
    texto: [
      'A vigilância diária encontrou gravações do Sante SGH diferentes da referência vigente da operação.',
      '',
      `Estabelecimento: ${hospital}`,
      `Dia: ${dia}`,
      `Operação: ${operacao}`,
      `Divergentes: ${divergentes} de ${amostradas} amostrada(s)`,
      `Onde: ${onde.split(',').join(', ') || '—'}`,
      '',
      'Confira em Administração > Coexistência > Testes de assinatura de dados > Vigilância diária e siga o roteiro do plantão.',
    ].join('\n'),
  };
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

/** Destino do aviso do chamado: o encarregado (ENCARREGADO_EMAIL) ou o plantão (PLANTAO_EMAIL); padrão, a auditoria. */
export function destinoAlertaChamado(env: NodeJS.ProcessEnv, padrao: string, motivo: string): string {
  return motivo === 'dado-pessoal'
    ? env['ENCARREGADO_EMAIL']?.trim() || padrao
    : env['PLANTAO_EMAIL']?.trim() || padrao;
}

@Injectable()
export class EmailService implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumidor: Worker | null = null;

  onApplicationBootstrap(): void {
    const valkey = process.env['VALKEY_URL']?.trim();
    const smtp = process.env['SMTP_URL']?.trim();
    const rede = lerRedePadrao(process.env);
    if (!valkey || !smtp || !rede) {
      logger.warn('fila email desligada (sem VALKEY_URL, SMTP_URL ou REDE_PADRAO)');
      return;
    }
    const para = process.env['AUDITORIA_EMAIL']?.trim() || `auditoria@${rede}.invalid`;
    const de = process.env['EMAIL_REMETENTE']?.trim() || `nao-responda@${rede}.invalid`;
    try {
      this.consumidor = new Worker(
        `email-${rede}`,
        async (job) => {
          if (job.name === 'alerta-suporte')
            await enviarSmtp(smtp, mensagemDoAlertaSuporte(job.data, para, de));
          else if (job.name === 'alerta-emergencia')
            await enviarSmtp(smtp, mensagemDoAlerta(job.data as AlertaEmergenciaJob, para, de));
          else if (job.name === 'alerta-leitura')
            await enviarSmtp(smtp, mensagemDoAlertaLeitura(job.data as AlertaLeituraJob, para, de));
          else if (job.name === 'alerta-chamado') {
            const j = job.data as AlertaChamadoJob;
            await enviarSmtp(
              smtp,
              mensagemDoAlertaChamado(j, destinoAlertaChamado(process.env, para, j.motivo), de),
            );
          } else if (job.name === 'alerta-assinatura-divergente')
            for (const destino of destinatariosTabelaVazia(process.env, para, rede))
              await enviarSmtp(smtp, mensagemDoAlertaAssinatura(job.data, destino, de));
          else if (job.name === 'alerta-tabela-vazia')
            for (const destino of destinatariosTabelaVazia(process.env, para, rede))
              await enviarSmtp(smtp, mensagemDoAlertaTabelaVazia(job.data, destino, de));
          else return;
          logger.info(
            { fila: 'email', tipo: job.name, estabelecimento: (job.data as AlertaEmergenciaJob).hospital },
            'e-mail entregue',
          );
        },
        { connection: conexaoValkey(valkey, true), prefix: PREFIXO_FILAS, concurrency: 2 },
      );
      this.consumidor.on('error', () => undefined);
      this.consumidor.on('failed', (job, e) =>
        logger.warn(
          { fila: 'email', tentativa: job?.attemptsMade ?? 0, erro: e.name },
          'e-mail não entregue',
        ),
      );
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'fila email não subiu');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumidor?.close().catch(() => undefined);
  }
}
