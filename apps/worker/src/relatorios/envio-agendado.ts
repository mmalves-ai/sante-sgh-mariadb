// Envio agendado de relatório (M34; ficha, regra 5; cap-07 §7.5 e §7.5.1): o e-mail leva SÓ o link autenticado do
// relatório (quem abre entra e precisa da permissão; nunca o arquivo nem os dados); os destinatários são os endereços
// do envio e os e-mails dos usuários ativos dos grupos; a falha (de um destinatário que seja) conta as seguidas e
// ALERTA o dono do envio (o editor de origem acumulou 2.600 "não enviado" sem ninguém saber); fora de produção, o
// e-mail só vai ao coletor local (SMTP em loopback; a trava de saídas do M01 garante também no processo). O resultado
// vai ao agendamento (a situação, a falha curta, as seguidas e o próximo envio).
import { esquemaJobEnvioRelatorio, type JobEnvioRelatorio } from '@sgh/contratos';
import { depoisDoEnvio, mensagemDeFalha, mensagemDoEnvio } from '@sgh/dominio-relatorio';
import type { MensagemEmail } from '../smtp.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Fora de produção, só o coletor local (Mailpit em loopback). */
export function smtpPermitido(ambiente: string, smtpUrl: string): boolean {
  try {
    const u = new URL(smtpUrl);
    return u.protocol === 'smtp:' && (ambiente === 'producao' || LOOPBACK.has(u.hostname));
  } catch {
    return false;
  }
}

export interface DependenciasEnvio {
  readonly ambiente: string;
  readonly smtpUrl: string | null;
  readonly remetente: string;
  readonly produto: string;
  readonly nomeEstabelecimento: (hospital: string) => string;
  readonly enviar: (m: MensagemEmail) => Promise<void>;
  /** Os e-mails dos grupos e o do dono (o cadastro de usuários); vazio sem o banco. */
  readonly emails: (
    hospital: string,
    grupos: readonly string[],
    dono: string,
  ) => Promise<{ destinatarios: string[]; dono: string | null }>;
  /** Endereço de alerta quando o dono não tem e-mail (ALERTA_RELATORIO_EMAIL; senão, o do sistema). */
  readonly alertaPadrao: string | null;
  /** Grava o resultado no agendamento (só com o banco). */
  readonly registrar?: (
    hospital: string,
    agendamento: string,
    r: { situacao: 'enviado' | 'falhou'; falha: string | null; falhasSeguidas: number },
  ) => Promise<void>;
  /** As falhas seguidas antes deste envio (do agendamento; 0 sem o banco). */
  readonly falhasAntes?: (hospital: string, agendamento: string) => Promise<number>;
}

export interface ResultadoEnvio {
  readonly destinatarios: number;
  readonly enviados: number;
  readonly situacao: 'enviado' | 'falhou';
  readonly falha: string | null;
  readonly alertouDono: boolean;
}

/** Processa um job de envio: valida, resolve os destinatários, envia o link e registra; a falha alerta o dono. */
export async function processarEnvio(dados: unknown, d: DependenciasEnvio): Promise<ResultadoEnvio> {
  const job: JobEnvioRelatorio = esquemaJobEnvioRelatorio.parse(dados);
  const estabelecimento = d.nomeEstabelecimento(job.hospital);
  let falha: string | null = null;
  let enviados = 0;
  let destinatarios: string[] = [];
  let dono: string | null = null;
  if (!d.smtpUrl) falha = 'SMTP não configurado';
  else if (!smtpPermitido(d.ambiente, d.smtpUrl))
    falha = 'destino de e-mail fora do coletor local (fora de produção)';
  if (!falha) {
    const r = await d
      .emails(job.hospital, job.grupos, job.dono)
      .catch(() => ({ destinatarios: [], dono: null }));
    dono = r.dono;
    destinatarios = [...new Set([...job.enderecos, ...r.destinatarios])].slice(0, 50);
    if (destinatarios.length === 0) falha = 'nenhum destinatário com e-mail';
  }
  if (!falha) {
    const m = mensagemDoEnvio({
      titulo: job.titulo,
      relatorio: job.relatorio,
      link: job.link,
      produto: d.produto,
      estabelecimento,
    });
    for (const para of destinatarios) {
      try {
        await d.enviar({ de: d.remetente, para, assunto: m.assunto, texto: m.texto });
        enviados++;
      } catch (e) {
        falha = `envio recusado (${e instanceof Error ? e.message.slice(0, 120) : 'erro'})`;
      }
    }
  }
  const antes = (await d.falhasAntes?.(job.hospital, job.agendamento).catch(() => 0)) ?? 0;
  const depois = depoisDoEnvio(antes, falha === null);
  let alertouDono = false;
  if (depois.alertarDono) {
    const para = dono ?? d.alertaPadrao;
    if (para && d.smtpUrl && smtpPermitido(d.ambiente, d.smtpUrl)) {
      const a = mensagemDeFalha({
        titulo: job.titulo,
        falhasSeguidas: depois.falhasSeguidas,
        motivo: falha ?? 'falha',
        estabelecimento,
      });
      await d
        .enviar({ de: d.remetente, para, assunto: a.assunto, texto: a.texto })
        .then(() => (alertouDono = true))
        .catch(() => undefined);
    }
  }
  if (job.registrar)
    await d.registrar?.(job.hospital, job.agendamento, {
      situacao: depois.situacao,
      falha,
      falhasSeguidas: depois.falhasSeguidas,
    });
  return { destinatarios: destinatarios.length, enviados, situacao: depois.situacao, falha, alertouDono };
}
