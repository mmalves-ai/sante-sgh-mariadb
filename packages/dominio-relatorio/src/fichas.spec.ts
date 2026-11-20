// Regra 11: indicador só com ficha (nome, fórmula, numerador, denominador, fonte, periodicidade, meta por
// parâmetro, polaridade, responsável, versão). O validador recusa ficha incompleta ou incoerente.
import { CODIGOS_INDICADOR, type FichaIndicador, NOME_INDICADOR } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { FICHAS, fichaDe, validarFicha, validarFichas } from './fichas.js';

const base = fichaDe('taxaOcupacao')!;

describe('fichas técnicas', () => {
  it('todo código tem uma ficha válida', () => {
    expect(validarFichas()).toEqual([]);
    expect(FICHAS.map((f) => f.codigo).sort()).toEqual([...CODIGOS_INDICADOR].sort());
  });

  it('recusa ficha incompleta', () => {
    expect(validarFicha({ ...base, nome: '' })[0]).toMatch(/^nome:/);
    expect(validarFicha({})).not.toEqual([]);
  });

  it('recusa incoerências', () => {
    const f = (x: Partial<FichaIndicador>) => validarFicha({ ...base, ...x });
    expect(f({ unidade: 'quantidade' })).toContain('indicador de quantidade não tem denominador');
    expect(f({ denominador: null })).toContain('indicador sem denominador');
    expect(f({ fator: 1 })).toContain('percentual com fator diferente de 100');
    expect(f({ unidade: 'dias' })).toContain('fator só nos percentuais');
    expect(f({ recortes: ['clinica'] })).toContain('o recorte por clínica não tem leito-dia');
    expect(f({ limitacoes: [] })).toContain('indicador de leito sem a limitação do leito-dia declarada');
  });

  it('o conjunto: repetida e faltando', () => {
    const p = validarFichas([base, base]);
    expect(p).toContain('taxaOcupacao: ficha repetida');
    expect(p).toContain('admissoes: indicador sem ficha');
  });

  it('o nome de cada ficha é o do rótulo do parâmetro de meta (contratos)', () => {
    for (const f of FICHAS) expect(f.nome, f.codigo).toBe(NOME_INDICADOR[f.codigo]);
  });
});
