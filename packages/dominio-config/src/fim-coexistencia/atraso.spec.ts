import { describe, expect, it } from 'vitest';
import { META_FIM_ONDA, setoresAtrasados } from './atraso.js';

describe('regra 9: setor atrasado prolonga a coexistência daquele setor', () => {
  const setores = [
    { codigo: 'farmacia', nome: 'Farmácia', onda: 3, situacao: 'treinamento' },
    { codigo: 'agenda', nome: 'Agenda', onda: 1, situacao: 'migrado' },
    { codigo: 'recepcao', nome: 'Recepção', onda: 1, situacao: 'legado' },
    { codigo: 'faturamento', nome: 'Faturamento', onda: 4, situacao: 'homologacao' },
    { codigo: 'uti', nome: 'UTI', onda: 2, situacao: 'liberado' },
  ];
  it('só os ainda no outro sistema depois da meta da onda; a nova data é o fim do mês seguinte', () => {
    expect(setoresAtrasados(setores, '2027-01-10')).toEqual([
      {
        codigo: 'recepcao',
        nome: 'Recepção',
        onda: 1,
        situacao: 'legado',
        meta: '2026-11-30',
        novaData: '2027-02-28',
      },
      {
        codigo: 'farmacia',
        nome: 'Farmácia',
        onda: 3,
        situacao: 'treinamento',
        meta: '2026-12-31',
        novaData: '2027-02-28',
      },
    ]);
    expect(setoresAtrasados(setores, '2026-11-30')).toEqual([]);
    expect(setoresAtrasados(setores, '2027-12-05').map((s) => s.novaData)).toEqual([
      '2028-01-31',
      '2028-01-31',
      '2028-01-31',
    ]);
  });
  it('as metas cobrem as ondas 0 a 5 e a onda 5 termina em janeiro de 2027', () => {
    expect(Object.keys(META_FIM_ONDA).map(Number)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(META_FIM_ONDA[5]).toBe('2027-01-31');
  });
});
