// Regra 16: os parceiros que leem o banco continuam lendo; o canal novo é oferecido na ordem API do parceiro pela
// outbox, arquivo agendado, API de consulta.
import { PACOTES_CANAL_NOVO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ofertaDeCanal, parceiroDaVisao, podeDesligarLeituraDireta } from './pacotes-parceiros.js';

describe('pacotes aos parceiros que leem o banco (regra 16)', () => {
  it('a ordem é a da regra: API do parceiro, arquivo agendado, API de consulta', () => {
    expect(ofertaDeCanal({ temApi: true, aceitaArquivo: true, consultaApi: true })).toEqual([
      ...PACOTES_CANAL_NOVO,
    ]);
    expect(ofertaDeCanal({ temApi: false, aceitaArquivo: true, consultaApi: true })).toEqual([
      'arquivo-agendado',
      'api-de-consulta',
    ]);
    expect(ofertaDeCanal({ temApi: false, aceitaArquivo: false, consultaApi: false })).toEqual([]);
  });
  it('as visões dos parceiros conhecidos', () => {
    expect(parceiroDaVisao('V_EPIMED_INTERNACAO')).toMatch(/Epimed/);
    expect(parceiroDaVisao('V_FIRST_LEITO')).toMatch(/First/);
    expect(parceiroDaVisao('VW_ZG_OPERADORAS')).toMatch(/ZG/);
    expect(parceiroDaVisao('V_MEDIA_PLUS_AGENDAMENTO')).toMatch(/Media Plus/);
    expect(parceiroDaVisao('V_OUTRA')).toBeNull();
  });
  it('a leitura direta só sai com o canal novo homologado e a concordância do parceiro', () => {
    expect(podeDesligarLeituraDireta({ canalNovoHomologado: true, parceiroConcorda: false })).toBe(false);
    expect(podeDesligarLeituraDireta({ canalNovoHomologado: false, parceiroConcorda: true })).toBe(false);
    expect(podeDesligarLeituraDireta({ canalNovoHomologado: true, parceiroConcorda: true })).toBe(true);
  });
});
