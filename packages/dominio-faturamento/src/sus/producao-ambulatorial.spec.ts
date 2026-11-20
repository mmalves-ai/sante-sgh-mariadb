// Regra 4 do M51: requisição de laboratório (LAB='S', ESPEC=0) não é atendimento.
import { describe, expect, it } from 'vitest';
import { ehAtendimentoAmbulatorial, ehRequisicaoDeLaboratorio } from './producao-ambulatorial.js';

describe('produção ambulatorial (regra 4)', () => {
  it('requisição de laboratório fica fora', () => {
    expect(ehRequisicaoDeLaboratorio({ lab: 'S', especialidade: 0 })).toBe(true);
    expect(ehRequisicaoDeLaboratorio({ lab: 's ', especialidade: null })).toBe(true);
    expect(ehAtendimentoAmbulatorial({ lab: 'S', especialidade: 0 })).toBe(false);
  });

  it('atendimento precisa de especialidade', () => {
    expect(ehAtendimentoAmbulatorial({ lab: 'N', especialidade: 12 })).toBe(true);
    expect(ehAtendimentoAmbulatorial({ lab: 'S', especialidade: 12 })).toBe(true);
    expect(ehAtendimentoAmbulatorial({ lab: null, especialidade: 0 })).toBe(false);
    expect(ehAtendimentoAmbulatorial({ lab: null, especialidade: null })).toBe(false);
  });
});
