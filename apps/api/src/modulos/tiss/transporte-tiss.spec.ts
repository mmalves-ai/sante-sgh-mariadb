// Transporte TISS pela central de integrações externas (decisão 53; C2-070, C1-108, C3-007): a elegibilidade e a
// comunicação de internação e alta só vão à outbox quando a central e o ambiente deixam o transmissor entregar.
import type { ModoIntegracaoExterna } from '@sgh/contratos';
import { afterEach, describe, expect, it } from 'vitest';
import { ligarCentralIntegracoes } from '../integracao/externas/servico.js';
import { INTEGRACAO_OPERADORA_TISS, transporteTissDaCentral } from './transporte-tiss.js';

function central(modo: ModoIntegracaoExterna, neutralizado: boolean, vistos: string[] = []) {
  ligarCentralIntegracoes({
    modoDaIntegracao: async (integracao: string) => {
      vistos.push(integracao);
      return {
        integracao,
        modo,
        neutralizado,
        parametros: {},
        credencial: async () => null,
        registrarFalha: async () => undefined,
      };
    },
  } as never);
}

describe('transporteTissDaCentral', () => {
  afterEach(() => ligarCentralIntegracoes(null));

  it('sem a central montada: simulador, e fora de produção o transmissor entrega (destino simulado)', async () => {
    expect(await transporteTissDaCentral({ AMBIENTE: 'dev' })).toEqual({
      integracao: INTEGRACAO_OPERADORA_TISS,
      modo: 'simulador',
      neutralizado: false,
      transmite: true,
      dependeDefinicaoFornecedor: true,
    });
  });

  it('pergunta à central pela entrada operadora-tiss-webservice; o real fora de produção fica neutralizado', async () => {
    const vistos: string[] = [];
    central('simulador', true, vistos);
    const e = await transporteTissDaCentral({ AMBIENTE: 'homologacao' });
    expect(vistos).toEqual(['operadora-tiss-webservice']);
    expect(e).toMatchObject({ modo: 'simulador', neutralizado: true, transmite: true });
  });

  it('transmissor desligado: nada sai, registro à mão', async () => {
    central('simulador', false);
    expect((await transporteTissDaCentral({ TRANSMISSOR_TISS: 'desligado' })).transmite).toBe(false);
  });

  it('produção: no simulador nada sai; no real, até a definição do fornecedor virar transporte escrito, também não', async () => {
    central('simulador', false);
    expect((await transporteTissDaCentral({ AMBIENTE: 'producao' })).transmite).toBe(false);
    central('real', false);
    expect(await transporteTissDaCentral({ AMBIENTE: 'producao' })).toMatchObject({
      modo: 'real',
      transmite: false,
      dependeDefinicaoFornecedor: true,
    });
  });
});
