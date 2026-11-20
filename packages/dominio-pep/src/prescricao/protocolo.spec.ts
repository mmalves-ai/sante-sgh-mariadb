// Regra 2 do M24: item e protocolo são distintos; aplicar protocolo cria itens próprios com a marca; o protocolo
// vale para idade, peso, sexo e vigência.
import { describe, expect, it } from 'vitest';
import { aplicabilidade, itemDoProtocolo, pertencaValida } from './protocolo.js';

const base = {
  id: 7,
  nome: 'PROTOCOLO SINTETICO',
  ativo: true,
  vigenciaInicio: null,
  vigenciaFim: null,
  idadeMin: null,
  idadeMax: null,
  pesoMin: null,
  pesoMax: null,
  sexo: null,
};
const pac = { idade: 40, peso: 70, sexo: 'F' as const };

describe('protocolo', () => {
  it('aplicável por padrão; recusas por situação, vigência, sexo, idade e peso', () => {
    expect(aplicabilidade(base, pac, '2026-10-21').aplicavel).toBe(true);
    expect(aplicabilidade({ ...base, ativo: false }, pac, '2026-10-21').motivo).toContain('inativo');
    expect(aplicabilidade({ ...base, vigenciaInicio: '2026-11-01' }, pac, '2026-10-21').aplicavel).toBe(
      false,
    );
    expect(aplicabilidade({ ...base, vigenciaFim: '2026-10-20T00:00' }, pac, '2026-10-21').aplicavel).toBe(
      false,
    );
    expect(aplicabilidade({ ...base, sexo: 'M' }, pac, '2026-10-21').aplicavel).toBe(false);
    expect(aplicabilidade({ ...base, idadeMin: 41 }, pac, '2026-10-21').aplicavel).toBe(false);
    expect(aplicabilidade({ ...base, idadeMax: 39 }, pac, '2026-10-21').aplicavel).toBe(false);
    expect(aplicabilidade({ ...base, pesoMin: 71 }, pac, '2026-10-21').aplicavel).toBe(false);
    expect(aplicabilidade({ ...base, pesoMax: 69 }, pac, '2026-10-21').aplicavel).toBe(false);
    expect(
      aplicabilidade(
        { ...base, idadeMin: 41, pesoMin: 71, sexo: 'm' },
        { idade: null, peso: null, sexo: null },
        '2026-10-21',
      ).aplicavel,
    ).toBe(true);
  });
  it('especialidade do prescritor: o protocolo com especialidades só vale para elas', () => {
    const p = { ...base, especialidades: [10, 20] };
    expect(aplicabilidade(p, pac, '2026-10-21', [20]).aplicavel).toBe(true);
    expect(aplicabilidade(p, pac, '2026-10-21', [30]).motivo).toBe('Protocolo de outra especialidade.');
    expect(aplicabilidade(p, pac, '2026-10-21', []).aplicavel).toBe(false);
    // Sem especialidade no protocolo, ou sem a conferência (null): vale.
    expect(aplicabilidade(base, pac, '2026-10-21', [30]).aplicavel).toBe(true);
    expect(aplicabilidade(p, pac, '2026-10-21').aplicavel).toBe(true);
  });
  it('o item do protocolo é item da prescrição com a marca (nunca de prescrição e de protocolo ao mesmo tempo)', () => {
    expect(itemDoProtocolo({ chave: 'x', a: 1 }, 7, 2)).toEqual({
      chave: 'protocolo-7-2',
      a: 1,
      protocolo: 7,
      autopreenchido: ['dose'],
    });
    expect(pertencaValida(10, null)).toBe(true);
    expect(pertencaValida(null, 7)).toBe(true);
    expect(pertencaValida(10, 7)).toBe(false);
  });
});
