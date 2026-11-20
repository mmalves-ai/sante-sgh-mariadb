// W0-10: o canal das mensagens do portal ao médico externo (hoje, o link de confirmação do e-mail novo). Comunicação com
// o médico só pela Hal-AI (regra 15a); a notificação ao médico pela Hal-AI fica DESLIGADA até o dono ligar em produção
// (e o contrato da API de mensagens da Hal-AI é do dono). A trava de saídas:
//   - `CanalMedicoSimulador` (dev/ci e o padrão do serviço): a mensagem fica numa caixa em memória que a tela de dev e o
//     E2E leem; nenhuma rede, nenhum e-mail real;
//   - `CanalMedicoDesligado` (fora de dev/ci): recusa com o motivo, e o pedido da troca não é gravado.

export interface MensagemMedico {
  readonly hospital: string;
  readonly acesso: number;
  /** W0-10 (M5): 'resultado-critico' leva só o link do portal (nenhum dado do paciente). */
  readonly tipo: 'confirmacao-email' | 'resultado-critico';
  /** O e-mail de destino (o NOVO, na confirmação da troca) ou a conta ("conta M<n>": a Hal-AI resolve o contato). */
  readonly destino: string;
  readonly link: string;
  /** A validade do link (troca do e-mail) ou o prazo da ciência (crítico). */
  readonly validoAte: string;
}

export type EnvioMedico = 'simulador' | 'halai';

export interface CanalMedico {
  /** Por onde a mensagem sairia agora (sem enviar): o envio ou o motivo de não poder enviar. */
  disponivel(hospital: string): Promise<{ envio: EnvioMedico | null; motivo: string | null }>;
  enviar(m: MensagemMedico): Promise<EnvioMedico>;
}

export const MOTIVO_HALAI_MEDICO_DESLIGADA =
  'O envio de mensagens ao médico pela Hal-AI está desligado neste ambiente (o hospital liga quando contratar).';

/** A caixa do simulador: as últimas mensagens em memória (nada sai do processo). */
export class CanalMedicoSimulador implements CanalMedico {
  private readonly caixa: (MensagemMedico & { em: string })[] = [];
  constructor(private readonly teto = 200) {}

  disponivel(): Promise<{ envio: EnvioMedico; motivo: null }> {
    return Promise.resolve({ envio: 'simulador', motivo: null });
  }

  enviar(m: MensagemMedico): Promise<EnvioMedico> {
    this.caixa.unshift({ ...m, em: new Date().toISOString() });
    if (this.caixa.length > this.teto) this.caixa.length = this.teto;
    return Promise.resolve('simulador');
  }

  /** As mensagens da conta (a mais nova primeiro), para a tela de dev e o E2E. */
  mensagens(hospital: string, acesso: number | null = null): (MensagemMedico & { em: string })[] {
    return this.caixa.filter((x) => x.hospital === hospital && (acesso === null || x.acesso === acesso));
  }
}

/** Fora de dev/ci, enquanto o dono não liga a Hal-AI para o médico: nada sai, e o motivo vai à tela. */
export class CanalMedicoDesligado implements CanalMedico {
  disponivel(): Promise<{ envio: null; motivo: string }> {
    return Promise.resolve({ envio: null, motivo: MOTIVO_HALAI_MEDICO_DESLIGADA });
  }

  enviar(): Promise<EnvioMedico> {
    return Promise.reject(new Error(MOTIVO_HALAI_MEDICO_DESLIGADA));
  }
}

/** O canal do ambiente: dev e ci, sempre o simulador (a trava de saídas); fora deles, desligado (dono). */
export function canalMedicoDoAmbiente(ambiente: string): CanalMedico {
  return ambiente === 'dev' || ambiente === 'ci' ? new CanalMedicoSimulador() : new CanalMedicoDesligado();
}
