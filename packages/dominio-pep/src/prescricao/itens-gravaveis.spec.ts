import { describe, expect, it } from 'vitest';
import { conferirItemGravavel, MENSAGENS_ITEM_GRAVAVEL } from './itens-gravaveis.js';

const sol = (over: Record<string, unknown> = {}) => ({
  tipo: 'solucao' as const,
  componentes: [
    { dose: 500, principal: true, etapa: 1 },
    { dose: 10, principal: false, etapa: 1 },
    { dose: 500, principal: true, etapa: 2 },
  ],
  etapas: [
    { etapa: 1, inicio: '2026-11-24T08:00', fim: '2026-11-24T14:00', velocidade: 83, volume: 500 },
    { etapa: 2, inicio: '2026-11-24T14:00', fim: '2026-11-24T20:00', velocidade: 83, volume: 500 },
  ],
  ...over,
});

describe('conferência do item antes de gravar (03-PEP L105)', () => {
  it('medicamento: dose positiva e condições de "se necessário" sem repetição', () => {
    expect(conferirItemGravavel({ tipo: 'medicamento', dose: 1, seNecessario: [1, 2] })).toBeNull();
    expect(conferirItemGravavel({ tipo: 'medicamento', dose: 0, seNecessario: [] })).toBe('dose-invalida');
    expect(conferirItemGravavel({ tipo: 'medicamento', dose: 1, seNecessario: [3, 3] })).toBe(
      'se-necessario-repetido',
    );
  });

  it('dieta: quantidade, unidade da velocidade e característica única', () => {
    const base = {
      tipo: 'dieta' as const,
      quantidade: 1500,
      velocidade: null,
      unidadeInfusao: null,
      caracteristicas: [],
    };
    expect(conferirItemGravavel(base)).toBeNull();
    expect(conferirItemGravavel({ ...base, quantidade: 0 })).toBe('dieta-quantidade-invalida');
    expect(conferirItemGravavel({ ...base, velocidade: 60 })).toBe('dieta-velocidade-sem-unidade');
    expect(conferirItemGravavel({ ...base, velocidade: 60, unidadeInfusao: 2 })).toBeNull();
    expect(
      conferirItemGravavel({
        ...base,
        caracteristicas: [
          { caracteristica: 4, resposta: '2 g' },
          { caracteristica: 4, resposta: '3 g' },
        ],
      }),
    ).toBe('dieta-caracteristica-repetida');
  });

  it('solução em etapas: principal, etapas únicas, cada componente na sua etapa e fim depois do início', () => {
    expect(conferirItemGravavel(sol())).toBeNull();
    expect(conferirItemGravavel(sol({ componentes: [{ dose: 10, principal: false, etapa: 1 }] }))).toBe(
      'solucao-sem-principal',
    );
    const e1 = sol().etapas[0]!;
    expect(conferirItemGravavel(sol({ etapas: [e1, e1] }))).toBe('solucao-etapa-repetida');
    expect(conferirItemGravavel(sol({ etapas: [e1] }))).toBe('solucao-componente-sem-etapa');
    expect(conferirItemGravavel(sol({ etapas: [...sol().etapas, { ...e1, etapa: 3 }] }))).toBe(
      'solucao-etapa-sem-componente',
    );
    expect(conferirItemGravavel(sol({ etapas: [{ ...e1, fim: '2026-11-24T07:00' }, sol().etapas[1]] }))).toBe(
      'solucao-etapa-fim-antes-inicio',
    );
    expect(conferirItemGravavel(sol({ etapas: [{ ...e1, volume: 0 }, sol().etapas[1]] }))).toBe(
      'solucao-etapa-invalida',
    );
  });

  it('ventilação: FiO2 de 21% a 100% e parâmetros na faixa clínica', () => {
    const vmi = { tipo: 'vmi' as const, frequenciaRespiratoria: 16, peep: 5, volumeCorrente: 450, fio2: 40 };
    expect(conferirItemGravavel(vmi)).toBeNull();
    expect(conferirItemGravavel({ ...vmi, fio2: 15 })).toBe('ventilacao-fio2-fora-da-faixa');
    expect(conferirItemGravavel({ ...vmi, volumeCorrente: 0 })).toBe('ventilacao-parametro-invalido');
    expect(conferirItemGravavel({ tipo: 'vni', fio2: null })).toBeNull();
    expect(conferirItemGravavel({ tipo: 'vni', fio2: 101 })).toBe('ventilacao-fio2-fora-da-faixa');
  });

  it('toda recusa tem mensagem', () => {
    for (const m of Object.values(MENSAGENS_ITEM_GRAVAVEL)) expect(m.length).toBeGreaterThan(10);
  });
});
