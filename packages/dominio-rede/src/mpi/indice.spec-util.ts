// Linhas sintéticas de SGH_REDE_VINCULO para os testes do índice.
import type { VinculoIndice } from './indice.js';

export const PESSOA_1 = 'pessoa-0000-0001';
export const PESSOA_2 = 'pessoa-0000-0002';

export function linha(extra: Partial<VinculoIndice> = {}): VinculoIndice {
  return {
    estabelecimento: 'pc',
    chave: 'hs:909|pc:101',
    pessoa: PESSOA_1,
    idLocal: 101,
    prontuarioLocal: 5001,
    estabelecimentoRemoto: 'hs',
    idRemoto: 909,
    prontuarioRemoto: 77001,
    origem: 'humano',
    situacao: 'ativo',
    criadoPor: 'GESTOR.TESTE',
    criadoEm: '2026-10-24T10:00:00.000Z',
    desfeitoPor: null,
    desfeitoEm: null,
    justificativa: null,
    ...extra,
  };
}
