// F7, 08-INTG linha 131: o transporte da troca por serviço web com o SUS (rastreamento de câncer e cadastro de
// prestador). Fora de produção, o simulador local responde (regra 6: nenhuma mensagem externa); o serviço do Ministério
// só é chamado com a chave de produção (AMBIENTE=producao) E o endereço do serviço configurado no servidor
// (SUS_SERVICO_WEB_URL_RASTREAMENTO_CANCER, SUS_SERVICO_WEB_URL_CADASTRO_PRESTADOR); sem endereço, a resposta é a
// falha de transporte (o envio fica "erro", com o motivo). A credencial fica no cofre (credencial_integracao), nunca
// aqui. A falha de rede nunca derruba a gravação: vira resposta "não chegou".
import { createHash } from 'node:crypto';
import { tipoCns } from '@sgh/contratos';
import type { CriticaServicoWebSus, RespostaServicoWebSus, ServicoWebSus } from '@sgh/dominio-faturamento';
import { type Ambiente, envioExternoPermitido, exigirEnvioExterno } from '@sgh/nucleo';

export const ENVIADOR_SERVICO_WEB_SUS = Symbol('ENVIADOR_SERVICO_WEB_SUS');

export interface EnviadorServicoWebSus {
  /** "simulador" fora de produção; "producao" só com a chave de produção. */
  readonly modo: 'simulador' | 'producao';
  enviar(servico: ServicoWebSus, conteudo: Readonly<Record<string, unknown>>): Promise<RespostaServicoWebSus>;
}

/**
 * O simulador: determinístico pelo conteúdo. Protocolo local (SIM-...); críticas que o serviço real faz e que o
 * domínio não bloqueia: cartão provisório no rastreamento (aviso) e prestador sem ocupação (erro).
 */
export function enviadorServicoWebSusSimulado(): EnviadorServicoWebSus {
  return {
    modo: 'simulador',
    enviar(servico, conteudo) {
      const hash = createHash('sha256').update(JSON.stringify(conteudo)).digest('hex').slice(0, 12);
      const criticas: CriticaServicoWebSus[] = [];
      const cns = String(conteudo['cnsPaciente'] ?? conteudo['cnsProfissional'] ?? '');
      if (servico === 'rastreamento_cancer' && tipoCns(cns) === 'provisorio')
        criticas.push({
          tipo: 'aviso',
          codigo: 'cns-provisorio',
          campo: 'cnsPaciente',
          mensagem: 'Cartão provisório: atualize o definitivo quando houver.',
        });
      if (servico === 'cadastro_prestador' && !conteudo['cbo'])
        criticas.push({
          tipo: 'erro',
          codigo: 'cbo-ausente',
          campo: 'cbo',
          mensagem: 'O profissional precisa de ocupação (CBO) para o cadastro.',
        });
      const erro = criticas.some((c) => c.tipo === 'erro');
      return Promise.resolve({
        chegou: true,
        protocolo: `SIM-${servico === 'rastreamento_cancer' ? 'RC' : 'CP'}-${hash}`,
        tipoProtocolo: erro ? 'critica' : 'recibo',
        cnsConfirmado: erro ? null : cns,
        criticas,
      });
    },
  };
}

export type TransporteServicoWebSus = (
  url: string,
  corpo: string,
) => Promise<{ status: number; texto: string }>;

const transporteHttps: TransporteServicoWebSus = async (url, corpo) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: corpo,
    signal: AbortSignal.timeout(30_000),
  });
  return { status: r.status, texto: await r.text() };
};

const VARIAVEL_URL: Record<ServicoWebSus, string> = {
  rastreamento_cancer: 'SUS_SERVICO_WEB_URL_RASTREAMENTO_CANCER',
  cadastro_prestador: 'SUS_SERVICO_WEB_URL_CADASTRO_PRESTADOR',
};

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Lê a resposta do serviço (protocolo, cartão gravado e críticas por campo); o que não se entende é falha. */
export function lerRespostaServicoWebSus(status: number, corpo: string): RespostaServicoWebSus {
  if (status >= 500 || status === 401 || status === 403)
    return { chegou: false, mensagem: `O serviço respondeu ${status}.` };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(corpo) as Record<string, unknown>;
  } catch {
    return { chegou: false, mensagem: `Resposta ilegível do serviço (${status}).` };
  }
  const criticas = (Array.isArray(j['criticas']) ? j['criticas'] : []).map(
    (c: Record<string, unknown>): CriticaServicoWebSus => ({
      tipo: c['tipo'] === 'aviso' ? 'aviso' : 'erro',
      codigo: texto(c['codigo']),
      campo: texto(c['campo']),
      mensagem: texto(c['mensagem']) ?? 'Crítica sem mensagem.',
    }),
  );
  return {
    chegou: true,
    protocolo: texto(j['protocolo']),
    tipoProtocolo: texto(j['tipoProtocolo']),
    cnsConfirmado: texto(j['cnsConfirmado']),
    criticas,
  };
}

/** O enviador real: só com a chave de produção; sem endereço configurado, a falha de transporte com o motivo. */
export function enviadorServicoWebSusProducao(
  env: Ambiente,
  transporte: TransporteServicoWebSus = transporteHttps,
): EnviadorServicoWebSus {
  return {
    modo: 'producao',
    async enviar(servico, conteudo) {
      exigirEnvioExterno(env, 'sus-servico-web');
      const url = env[VARIAVEL_URL[servico]]?.trim();
      if (!url)
        return { chegou: false, mensagem: 'Endereço do serviço do SUS não configurado neste servidor.' };
      try {
        const r = await transporte(url, JSON.stringify(conteudo));
        return lerRespostaServicoWebSus(r.status, r.texto);
      } catch (e) {
        return { chegou: false, mensagem: `Falha de comunicação com o serviço: ${(e as Error).name}.` };
      }
    },
  };
}

/** Pelo ambiente: produção só com AMBIENTE=producao; fora disso, sempre o simulador. */
export function enviadorServicoWebSusDoAmbiente(env: Ambiente): EnviadorServicoWebSus {
  return envioExternoPermitido(env) ? enviadorServicoWebSusProducao(env) : enviadorServicoWebSusSimulado();
}
