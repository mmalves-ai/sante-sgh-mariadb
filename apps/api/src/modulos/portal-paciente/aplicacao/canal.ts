// W0-10: o canal das mensagens do portal ao paciente (hoje, o link de confirmação do e-mail novo). Regra 15a (DP-44 b):
// toda mensagem ao paciente sai pela Hal-AI; o Sante não tem canal próprio. A trava de saídas vale aqui também:
//   - `CanalSimulador` (dev/ci e o padrão do serviço): a mensagem fica numa caixa em memória que a tela de dev e o E2E
//     leem; nenhuma rede, nenhum e-mail real;
//   - `CanalHalai` (homologação e produção): só envia com a comunicação com o paciente ligada, o endereço da Hal-AI
//     configurado e, fora de produção, só a endereço local (`podeEnviarAoPaciente`); senão, recusa com o motivo, e o
//     pedido não é gravado. O cliente HTTP do envio é injetado (o contrato da API de mensagens da Hal-AI é do dono).
import { podeEnviarAoPaciente } from '@sgh/dominio-integracao';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { ligadaNoEstabelecimento, parametroTexto } from './liberacao.js';

export interface MensagemPaciente {
  readonly rede: string;
  readonly hospital: string;
  readonly conta: number;
  readonly tipo: 'confirmacao-email';
  /** O e-mail de destino (o NOVO, na confirmação da troca). */
  readonly destino: string;
  readonly link: string;
  readonly validoAte: string;
}

export type Envio = 'simulador' | 'halai';

export interface CanalPaciente {
  /** Por onde a mensagem sairia agora (sem enviar): o envio ou o motivo de não poder enviar. */
  disponivel(hospital: string): Promise<{ envio: Envio | null; motivo: string | null }>;
  enviar(m: MensagemPaciente): Promise<Envio>;
}

/** A caixa do simulador: guarda as últimas mensagens em memória (nada sai do processo). */
export class CanalSimulador implements CanalPaciente {
  private readonly caixa: (MensagemPaciente & { em: string })[] = [];
  constructor(private readonly teto = 200) {}

  disponivel(): Promise<{ envio: Envio; motivo: null }> {
    return Promise.resolve({ envio: 'simulador', motivo: null });
  }

  enviar(m: MensagemPaciente): Promise<Envio> {
    this.caixa.unshift({ ...m, em: new Date().toISOString() });
    if (this.caixa.length > this.teto) this.caixa.length = this.teto;
    return Promise.resolve('simulador');
  }

  /** As mensagens da conta (a mais nova primeiro), para a tela de dev e o E2E. */
  mensagens(hospital: string, conta: number | null = null): (MensagemPaciente & { em: string })[] {
    return this.caixa.filter((x) => x.hospital === hospital && (conta === null || x.conta === conta));
  }
}

export interface ConfigCanalHalai {
  readonly producao: boolean;
  /** A comunicação com o paciente ligada (DP-44 a), o endereço da API da Hal-AI do estabelecimento. */
  estado(hospital: string): Promise<{ ligado: boolean; endereco: string | null }>;
  /** O cliente do envio; null até o dono fornecer o contrato da API de mensagens da Hal-AI. */
  readonly cliente: ((endereco: string, m: MensagemPaciente) => Promise<void>) | null;
}

export class CanalHalai implements CanalPaciente {
  constructor(private readonly cfg: ConfigCanalHalai) {}

  async disponivel(hospital: string): Promise<{ envio: Envio | null; motivo: string | null }> {
    const e = await this.cfg.estado(hospital);
    const p = podeEnviarAoPaciente({ ligado: e.ligado, endereco: e.endereco, producao: this.cfg.producao });
    if (!p.pode) return { envio: null, motivo: p.motivo };
    if (!this.cfg.cliente)
      return { envio: null, motivo: 'O envio pela Hal-AI aguarda o contrato da API de mensagens (dono).' };
    return { envio: 'halai', motivo: null };
  }

  async enviar(m: MensagemPaciente): Promise<Envio> {
    const e = await this.cfg.estado(m.hospital);
    const p = podeEnviarAoPaciente({ ligado: e.ligado, endereco: e.endereco, producao: this.cfg.producao });
    if (!p.pode || !this.cfg.cliente || !e.endereco)
      throw new Error(p.motivo ?? 'Envio pela Hal-AI indisponível.');
    await this.cfg.cliente(e.endereco, m);
    return 'halai';
  }
}

/**
 * O canal do ambiente: dev e ci, sempre o simulador (a trava de saídas); fora deles, a Hal-AI com a comunicação com o
 * paciente (`integracao.mensagensPaciente`) e o endereço (`integracao.halaiEndereco`) do estabelecimento.
 */
export function canalDoAmbiente(
  ambiente: string,
  configuracao: FonteConfiguracao | null,
  rede: string,
  cliente: ConfigCanalHalai['cliente'] = null,
): CanalPaciente {
  if (ambiente === 'dev' || ambiente === 'ci') return new CanalSimulador();
  return new CanalHalai({
    producao: ambiente === 'producao',
    cliente,
    estado: async (hospital) => {
      const [ligado, endereco] = await Promise.all([
        ligadaNoEstabelecimento(configuracao, rede, hospital, 'integracao.mensagensPaciente', 'SGH.PORTAL'),
        parametroTexto(configuracao, rede, hospital, 'integracao.halaiEndereco').catch(() => ''),
      ]);
      return { ligado, endereco: endereco === '' ? null : endereco };
    },
  });
}
