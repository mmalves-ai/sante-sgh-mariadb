import {
  ENSAIOS_CONTINGENCIA,
  ESTADOS_OPERACAO,
  ITENS_FIM_CAP14,
  ITENS_FIM_CAP15,
  SITUACOES_ITEM_FIM,
  SITUACOES_LOGIN_PAINEL,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensFimCoexistencia as m } from './i18n-fim.js';

describe('textos do fim da coexistência', () => {
  it('todo item, situação e ensaio do contrato tem texto', () => {
    for (const i of [...ITENS_FIM_CAP15, ...ITENS_FIM_CAP14]) expect(m.itens[i]).toBeTruthy();
    for (const s of SITUACOES_ITEM_FIM) expect(m.situacoes[s]).toBeTruthy();
    for (const e of ENSAIOS_CONTINGENCIA) expect(m.ensaios[e]).toBeTruthy();
    for (const i of [...ITENS_FIM_CAP15, ...ITENS_FIM_CAP14]) expect(m.fontes[i]).toBeTruthy();
    for (const s of SITUACOES_LOGIN_PAINEL) expect(m.revisao.situacoesPainel[s]).toBeTruthy();
    for (const e of ESTADOS_OPERACAO) expect(m.operacoes.estados[e]).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior pelo nome nem manda fazer lá (ADR 0023)', () => {
    expect(JSON.stringify(m)).not.toMatch(/SPDATA|legado|sistema atual|faça no/i);
  });
});
