// Regra 13 (escopo por convênio) e as regras de faturabilidade como dados (ficha do M30, campo 6).
import { describe, expect, it } from 'vitest';
import {
  avaliarFaturabilidade,
  conferirEscopoConvenio,
  convenioNoEscopo,
  esquemaRegraFaturabilidade,
  type FatosFaturabilidade,
  filtroConvenios,
  regraVigente,
} from '../index.js';

describe('escopo por convênio (regra 13)', () => {
  it('lista vazia = sem restrição; fora do escopo, recusa', () => {
    expect(convenioNoEscopo([], 7)).toBe(true);
    expect(convenioNoEscopo(['7'], 7)).toBe(true);
    expect(convenioNoEscopo(['7'], 8)).toBe(false);
    expect(convenioNoEscopo(['7'], null)).toBe(false);
    expect(conferirEscopoConvenio(['7'], 8)?.codigo).toBe('fora-do-escopo');
    expect(conferirEscopoConvenio(['7'], 7)).toBeNull();
  });
  it('filtro da lista', () => {
    expect(filtroConvenios([], null)).toBeNull();
    expect(filtroConvenios([], 3)).toEqual([3]);
    expect(filtroConvenios(['3', '4'], null)).toEqual([3, 4]);
    expect(filtroConvenios(['3'], 4)).toEqual([]);
    expect(filtroConvenios(['3'], 3)).toEqual([3]);
  });
});

const regra = (x: Record<string, unknown>) =>
  esquemaRegraFaturabilidade.parse({
    convenio: 7,
    nome: 'Senha SADT',
    exige: 'senha',
    seletor: {},
    inicio: '2026-01-01',
    ...x,
  });
const fatos = (x: Partial<FatosFaturabilidade>): FatosFaturabilidade => ({
  convenio: 7,
  tipoConta: 'E',
  dataBase: '2026-05-01',
  senha: null,
  guia: '123',
  cid: 'I10',
  validadeCarteira: '2026-12-31',
  itens: [{ grupo: 'sadt', codigo: 40302199, autorizacao: null }],
  ...x,
});

describe('faturabilidade como dados', () => {
  it('o esquema valida o seletor e a vigência', () => {
    expect(() => regra({ fim: '2025-01-01' })).toThrow();
    expect(() => regra({ seletor: { grupos: ['outro'] } })).toThrow();
    expect(regra({}).acao).toBe('avisar');
  });
  it('vigência e convênio (0 = todos)', () => {
    expect(regraVigente(regra({}), 7, '2026-05-01')).toBe(true);
    expect(regraVigente(regra({}), 8, '2026-05-01')).toBe(false);
    expect(regraVigente(regra({ convenio: 0 }), 8, '2026-05-01')).toBe(true);
    expect(regraVigente(regra({}), 7, '2025-05-01')).toBe(false);
    expect(regraVigente(regra({ fim: '2026-04-30' }), 7, '2026-05-01')).toBe(false);
  });
  it('cada exigência vira aviso (nunca bloqueio do outro sistema)', () => {
    const v = avaliarFaturabilidade(
      [
        regra({}),
        regra({ nome: 'Guia', exige: 'guia' }),
        regra({ nome: 'CID', exige: 'cid', bloqueiaFechamento: true }),
        regra({ nome: 'Carteira', exige: 'carteira-valida' }),
        regra({ nome: 'Autorização SADT', exige: 'autorizacao', seletor: { grupos: ['sadt'] } }),
      ],
      fatos({ cid: '', validadeCarteira: '2026-04-30' }),
    );
    expect(v.map((x) => x.regra)).toEqual(['Senha SADT', 'CID', 'Carteira', 'Autorização SADT']);
    expect(v.find((x) => x.regra === 'CID')?.bloqueiaFechamento).toBe(true);
    expect(v[0]?.mensagem).toContain('senha de autorização');
  });
  it('seletor por tipo de conta, grupo e código', () => {
    expect(avaliarFaturabilidade([regra({ seletor: { tipoConta: 'I' } })], fatos({}))).toHaveLength(0);
    expect(avaliarFaturabilidade([regra({ seletor: { grupos: ['matmed'] } })], fatos({}))).toHaveLength(0);
    expect(avaliarFaturabilidade([regra({ seletor: { codigos: [40302199] } })], fatos({}))).toHaveLength(1);
    expect(
      avaliarFaturabilidade(
        [regra({ exige: 'autorizacao' })],
        fatos({ itens: [{ grupo: 'sadt', codigo: 1, autorizacao: 'A1' }] }),
      ),
    ).toHaveLength(0);
    expect(avaliarFaturabilidade([regra({})], fatos({ senha: '0000' }))).toHaveLength(1);
    expect(
      avaliarFaturabilidade([regra({ exige: 'carteira-valida' })], fatos({ validadeCarteira: null })),
    ).toHaveLength(1);
  });
});
