// O profissional executante da guia nos códigos da TISS 04.03.00 (D-XML-31): o conselho pela família do CBO (o cadastro
// não guarda a sigla do conselho), a UF em código IBGE e o padrão só quando falta o executante. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  conselhoTissDoCbo,
  EXECUTANTE_PADRAO,
  executanteTiss,
  UF_TISS,
} from '@sgh/contratos/regras-faturamento';

describe('executante da guia TISS', () => {
  it('conselho pelo CBO: médico 06, enfermagem 02, nutrição 07, odontologia 08; sentinela e desconhecido, nenhum', () => {
    expect(conselhoTissDoCbo('225125')).toBe('06');
    expect(conselhoTissDoCbo('225270')).toBe('06');
    expect(conselhoTissDoCbo('223505')).toBe('02');
    expect(conselhoTissDoCbo('322205')).toBe('02');
    expect(conselhoTissDoCbo('223710')).toBe('07');
    expect(conselhoTissDoCbo('223208')).toBe('08');
    expect(conselhoTissDoCbo('251510')).toBe('09');
    expect(conselhoTissDoCbo('000000')).toBeNull();
    expect(conselhoTissDoCbo('999999')).toBeNull();
    expect(conselhoTissDoCbo('')).toBeNull();
  });

  it('UF em código da TISS (27 unidades e o estrangeiro)', () => {
    expect(Object.keys(UF_TISS)).toHaveLength(28);
    expect(UF_TISS['RJ']).toBe('33');
    expect(UF_TISS['SP']).toBe('35');
    expect(UF_TISS['DF']).toBe('53');
  });

  it('executante completo; sem número, sem UF ou CBO sentinela: null (a guia usa o padrão, marcada)', () => {
    expect(
      executanteTiss({ numero: ' 5201234 ', uf: 'rj', cbo: '225125', nome: ' MEDICO SINTETICO ' }),
    ).toEqual({
      profissional: { conselho: '06', numeroConselho: '5201234', uf: '33', cbos: '225125' },
      nome: 'MEDICO SINTETICO',
    });
    expect(executanteTiss({ numero: '', uf: 'RJ', cbo: '225125', nome: 'X' })).toBeNull();
    expect(executanteTiss({ numero: '0', uf: 'RJ', cbo: '225125', nome: 'X' })).toBeNull();
    expect(executanteTiss({ numero: '1', uf: 'XX', cbo: '225125', nome: 'X' })).toBeNull();
    expect(executanteTiss({ numero: '1', uf: 'RJ', cbo: '000000', nome: 'X' })).toBeNull();
    expect(EXECUTANTE_PADRAO.profissional).toEqual({
      conselho: '06',
      numeroConselho: '0',
      uf: '33',
      cbos: '225125',
    });
  });
});
