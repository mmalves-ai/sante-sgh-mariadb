// Envio agendado de relatório (M34; ficha, regra 5; cap-07 §7.5 e §7.5.1): o e-mail leva SÓ o link autenticado do
// relatório (quem abre entra e precisa da permissão; nunca o arquivo nem os dados); os destinatários são os endereços
// do envio e os e-mails dos usuários ativos dos grupos; a falha (de um destinatário que seja) conta as seguidas e
// ALERTA o dono do envio (o editor de origem acumulou 2.600 "não enviado" sem ninguém saber); fora de produção, o
// e-mail só vai ao coletor local (SMTP em loopback; a trava de saídas do M01 garante também no processo). O resultado
// vai ao agendamento (a situação, a falha curta, as seguidas e o próximo envio).
// Lote F2.2 05-17: os destinatários vêm do cadastro do agendamento no banco do cliente (usuário, lista de distribuição
// ou endereço), não de grupos do sistema de origem; os campos `grupos` e `dono` do job ficam ignorados (pedido de
// ajuste do contrato no saida/05-17.json). O nome do estabelecimento vem do cadastro.
// Melhoria: o registro leva a quantidade de destinatários do envio.
// Melhoria: o envio é RESERVADO antes do e-mail (reservar) e o resultado vai à mesma linha depois (registrar). Sem a
// reserva (outra instância, o ciclo seguinte ou a nova tentativa do job já a fizeram) nada é enviado: no máximo um
// e-mail por vencimento ou por job, mesmo com falha ao gravar o resultado.
// Melhoria: o alerta ao dono respeita o avisar_falha do agendamento.
import { esquemaJobEnvioRelatorio, type JobEnvioRelatorio } from '@sgh/contratos';
import { depoisDoEnvio, mensagemDeFalha, mensagemDoEnvio } from '@sgh/dominio-relatorio';
import type { MensagemEmail } from '../smtp.js';
import type { DestinatariosEnvio, FormaEnvio, OrigemEnvio } from './envio-agendado-proprio.js';

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
  readonly nomeEstabelecimento: (hospital: string) => string | Promise<string>;
  readonly enviar: (m: MensagemEmail) => Promise<void>;
  /** Os e-mails dos destinatários do agendamento e o do dono (cadastro); vazio sem o banco. */
  readonly emails: (hospital: string, agendamento: string) => Promise<DestinatariosEnvio>;
  /** Endereço de alerta quando o dono não tem e-mail (ALERTA_RELATORIO_EMAIL; senão, o do sistema). */
  readonly alertaPadrao: string | null;
  /** Reserva o envio antes do e-mail (só com o banco); null: outro já reservou, não envia. */
  readonly reservar?: (
    hospital: string,
    agendamento: string,
    origem: OrigemEnvio,
  ) => Promise<{ envio: number } | null>;
  /** Grava o resultado na linha reservada (só com o banco). */
  readonly registrar?: (hospital: string, agendamento: string, r: ConclusaoEnvio) => Promise<void>;
  /** As falhas seguidas antes deste envio (do agendamento; 0 sem o banco). */
  readonly falhasAntes?: (hospital: string, agendamento: string) => Promise<number>;
}

export interface ConclusaoEnvio {
  readonly envio: number;
  readonly situacao: 'enviado' | 'falhou';
  readonly falha: string | null;
  readonly falhasSeguidas: number;
  readonly destinatarios: number;
  readonly enderecos: readonly string[];
  readonly formas?: Readonly<Record<FormaEnvio, number>>;
}

export interface ResultadoEnvio {
  /** Verdadeiro quando outro já reservou este envio: nada foi enviado nem gravado. */
  readonly repetido: boolean;
  readonly destinatarios: number;
  readonly enviados: number;
  readonly situacao: 'enviado' | 'falhou';
  readonly falha: string | null;
  readonly alertouDono: boolean;
}

/** Processa um job de envio: valida, resolve os destinatários, envia o link e registra; a falha alerta o dono. */
export async function processarEnvio(
  dados: unknown,
  d: DependenciasEnvio,
  origem?: OrigemEnvio,
): Promise<ResultadoEnvio> {
  const job: JobEnvioRelatorio = esquemaJobEnvioRelatorio.parse(dados);
  let reserva: { envio: number } | null = null;
  if (job.registrar && d.reservar && d.registrar) {
    if (!origem) throw new Error('Envio com registro sem a origem (vencimento ou job da fila).');
    reserva = await d.reservar(job.hospital, job.agendamento, origem);
    if (!reserva)
      return {
        repetido: true,
        destinatarios: 0,
        enviados: 0,
        situacao: 'enviado',
        falha: null,
        alertouDono: false,
      };
  }
  const estabelecimento = await d.nomeEstabelecimento(job.hospital);
  let falha: string | null = null;
  let enviados = 0;
  let destinatarios: string[] = [];
  let dono: string | null = null;
  let avisarFalha = true;
  let formas: Readonly<Record<FormaEnvio, number>> | undefined;
  if (!d.smtpUrl) falha = 'SMTP não configurado';
  else if (!smtpPermitido(d.ambiente, d.smtpUrl))
    falha = 'destino de e-mail fora do coletor local (fora de produção)';
  if (!falha) {
    const r = await d
      .emails(job.hospital, job.agendamento)
      .catch((): DestinatariosEnvio => ({ destinatarios: [], dono: null }));
    dono = r.dono;
    avisarFalha = r.avisarFalha !== false;
    formas = r.formas;
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
  if (depois.alertarDono && avisarFalha) {
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
  if (reserva)
    await d.registrar?.(job.hospital, job.agendamento, {
      envio: reserva.envio,
      situacao: depois.situacao,
      falha,
      falhasSeguidas: depois.falhasSeguidas,
      destinatarios: destinatarios.length,
      enderecos: destinatarios,
      ...(formas ? { formas } : {}),
    });
  return {
    repetido: false,
    destinatarios: destinatarios.length,
    enviados,
    situacao: depois.situacao,
    falha,
    alertouDono,
  };
}
