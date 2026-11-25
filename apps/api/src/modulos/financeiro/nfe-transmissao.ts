// F7, 07-FIN linha 114: a porta de transmissão da NF-e 55 à Sefaz (autorização, consulta do protocolo, cancelamento e
// carta de correção), no mesmo desenho das integrações fiscais: a operação de gravação não fala com a rede, pede à
// porta. Dois adaptadores:
//   - o simulador (fora de produção, sem valor fiscal): a regra de retorno é a do domínio (simularSefaz);
//   - a Sefaz, que só existe com o web service do estado configurado no cofre. Enquanto o adaptador do web service
//     não estiver ligado neste ambiente, a porta responde "fora do ar" (null): a nota fica assinada, a operação de
//     transmissão recusa com 'sefaz-indisponivel' e pode ser repetida depois, sem perder nada (contingência).
// O retorno null é sempre "não houve resposta da Sefaz" (nada mudou lá); um código é sempre uma resposta.
import { type RetornoSefaz, simularSefaz } from '@sgh/dominio-financeiro';
import { conferirAssinaturaNfe } from './nfe-assinatura.js';

export interface TransmissorNfe {
  /** Envia a nota assinada para autorização (síncrono, lote de uma nota). */
  autorizar(p: { readonly xml: string; readonly chave: string }): Promise<RetornoSefaz | null>;
  /** Consulta a situação da nota pela chave (evita a duplicidade quando a resposta anterior se perdeu). */
  consultar(p: { readonly chave: string }): Promise<RetornoSefaz | null>;
  /** Evento de cancelamento (110111). */
  cancelar(p: {
    readonly chave: string;
    readonly protocolo: string | null;
    readonly justificativa: string;
  }): Promise<RetornoSefaz | null>;
  /** Evento de carta de correção (110110). */
  cartaCorrecao(p: {
    readonly chave: string;
    readonly sequencia: number;
    readonly texto: string;
  }): Promise<RetornoSefaz | null>;
}

export interface TransmissoresNfe {
  readonly simulador: TransmissorNfe;
  readonly sefaz: TransmissorNfe;
}

/** O simulador guarda o que autorizou, para a consulta responder como a Sefaz responderia. */
export function transmissorSimulador(): TransmissorNfe {
  const autorizadas = new Map<string, RetornoSefaz>();
  return {
    async autorizar({ xml, chave }) {
      const r = simularSefaz({
        tipo: 'autorizacao',
        xml,
        chave,
        assinaturaOk: conferirAssinaturaNfe(xml).ok,
      });
      if (r.codigo === '100') autorizadas.set(chave, r);
      return r;
    },
    async consultar({ chave }) {
      return (
        autorizadas.get(chave) ?? {
          codigo: '217',
          mensagem: 'Rejeição: NF-e não consta na base de dados da Sefaz (simulador)',
          protocolo: null,
        }
      );
    },
    async cancelar({ chave }) {
      return simularSefaz({ tipo: 'cancelamento', chave, sequencia: 1 });
    },
    async cartaCorrecao({ chave, sequencia }) {
      return simularSefaz({ tipo: 'carta_correcao', chave, sequencia });
    },
  };
}

/** A Sefaz sem web service configurado neste ambiente: nenhuma resposta (a nota espera, nada se perde). */
export const transmissorSefazForaDoAr: TransmissorNfe = {
  autorizar: async () => null,
  consultar: async () => null,
  cancelar: async () => null,
  cartaCorrecao: async () => null,
};

const SIMULADOR = transmissorSimulador();

export function transmissoresNfe(): TransmissoresNfe {
  return { simulador: SIMULADOR, sefaz: transmissorSefazForaDoAr };
}
