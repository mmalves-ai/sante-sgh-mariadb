// Despacho por e-mail do aviso clínico (F3.3, 03-PEP L133) no `worker`: a cada minuto, por cliente e estabelecimento
// ativo, os destinatários do canal 'email' pendentes (gravados pela central de regras de aviso clínico na transação do
// evento) recebem o e-mail pelo SMTP do ambiente (SMTP_URL; fora de produção só a captura local, regra 6) e a linha
// fica 'enviado' (com a hora) ou 'falha' (com o motivo curto). A conta sem endereço fica em falha ("sem e-mail").
// Melhoria (LGPD): o e-mail leva só o número do aviso e a prioridade, com o convite para abrir a central de avisos;
// nunca o paciente, o título nem o texto clínico. Log só com contagens. Ligado fora de dev/ci; em dev/ci só com
// AVISO_CLINICO_EMAIL=ligado.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { NucleoProprio } from '@sgh/nucleo';
import {
  type DestinoEmailAviso,
  type PortaAvisoClinicoEmail,
  PortaAvisoClinicoEmailPropria,
} from './aviso-clinico-email-propria.js';
import { logger } from './logger.js';
import {
  type AlvoEstabelecimento,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';
import { enviarSmtp, type MensagemEmail } from './smtp.js';

export function avisoClinicoEmailLigado(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'AVISO_CLINICO_EMAIL');
}

const PRIORIDADE: Readonly<Record<string, string>> = {
  baixa: 'baixa',
  normal: 'normal',
  alta: 'alta',
  critica: 'crítica',
};

/** A mensagem do aviso: só o número e a prioridade (nada do paciente nem do texto clínico). */
export function mensagemDoAvisoClinico(d: DestinoEmailAviso & { para: string }, de: string): MensagemEmail {
  const prioridade = PRIORIDADE[d.prioridade] ?? d.prioridade;
  return {
    de,
    para: d.para,
    assunto: `SGH: aviso clínico de prioridade ${prioridade}`,
    texto: [
      `Você recebeu o aviso clínico nº ${d.aviso}, de prioridade ${prioridade}.`,
      'Abra a central de avisos do SGH para ver o aviso e registrar a ciência.',
      'Este e-mail não traz dados do paciente: o conteúdo fica só no sistema.',
    ].join('\n'),
    idMensagem: `<aviso-clinico-${d.id}@sgh.invalid>`,
  };
}

export type EnviarEmail = (m: MensagemEmail) => Promise<void>;

/** Um ciclo num estabelecimento: envia os pendentes e marca cada um (enviado ou falha). */
export async function cicloAvisoClinicoEmail(
  porta: PortaAvisoClinicoEmail,
  est: AlvoEstabelecimento,
  enviar: EnviarEmail,
  de: string,
  limite = 200,
): Promise<{ enviados: number; falhas: number }> {
  let enviados = 0;
  let falhas = 0;
  for (const d of await porta.pendentes(est, limite)) {
    if (!d.para) {
      if (await porta.marcar(est, d, { enviado: false, erro: 'Conta sem e-mail cadastrado.' })) falhas++;
      continue;
    }
    try {
      await enviar(mensagemDoAvisoClinico({ ...d, para: d.para }, de));
    } catch (e) {
      const codigo = e instanceof Error ? e.name : 'erro';
      if (await porta.marcar(est, d, { enviado: false, erro: `Falha na entrega SMTP (${codigo}).` }))
        falhas++;
      continue;
    }
    if (await porta.marcar(est, d, { enviado: true })) enviados++;
  }
  return { enviados, falhas };
}

export type FabricaPortaAvisoEmail = (cliente: string) => PortaAvisoClinicoEmail;

@Injectable()
export class AvisoClinicoEmailService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaAvisoEmail | null = null;
  private enviar: EnviarEmail | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo, a porta e o envio sem subir o banco nem o SMTP. */
  usar(nucleo: NucleoServico, fabrica: FabricaPortaAvisoEmail, enviar: EnviarEmail): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
    this.enviar = enviar;
  }

  onApplicationBootstrap(): void {
    if (!avisoClinicoEmailLigado(process.env)) return;
    const smtp = process.env['SMTP_URL']?.trim();
    if (!smtp) {
      logger.warn('despacho de e-mail do aviso clínico desligado (sem SMTP_URL)');
      return;
    }
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(
        nucleo,
        (cliente) => new PortaAvisoClinicoEmailPropria(nucleo, cliente),
        (m) => enviarSmtp(smtp, m),
      );
      void this.ciclo();
      this.temporizador = setInterval(() => void this.ciclo(), 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'despacho de e-mail do aviso clínico não subiu',
      );
    }
  }

  async ciclo(): Promise<{ cliente: string; estabelecimento: string; enviados: number; falhas: number }[]> {
    const { nucleo, fabrica, enviar } = this;
    if (this.rodando || !nucleo || !fabrica || !enviar) return [];
    this.rodando = true;
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'aviso-clinico-email',
        fabrica,
        (porta, est) =>
          cicloAvisoClinicoEmail(
            porta,
            est,
            enviar,
            process.env['EMAIL_REMETENTE']?.trim() || `nao-responda@${est.cliente}.invalid`,
          ),
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'despacho de e-mail do aviso clínico falhou',
          ),
      );
      for (const v of voltas)
        if (v.resultado.enviados + v.resultado.falhas > 0)
          logger.info(
            { cliente: v.cliente, estabelecimento: v.estabelecimento, ...v.resultado },
            'e-mails de aviso clínico despachados',
          );
      return voltas.map((v) => ({ cliente: v.cliente, estabelecimento: v.estabelecimento, ...v.resultado }));
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
