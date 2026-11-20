// Regra 1 da ficha do M53: um só transmissor de eSocial por empregador (a raiz do CNPJ); os recibos de autônomo do
// repasse entram na conciliação do mesmo empregador; as pendências do outro sistema só se contam (regra 2).
import { describe, expect, it } from 'vitest';
import {
  conciliar,
  decidirTransmissor,
  empresasDaMesmaRaiz,
  painelPendenciasLegado,
  transmissorNaCompetencia,
  type VigenciaTransmissor,
} from './transmissor-unico.js';

const vig: VigenciaTransmissor[] = [
  { empresa: 1, inicio: '2026-01', transmissor: 'externo' },
  { empresa: 1, inicio: '2026-11', transmissor: 'sante' },
  { empresa: 2, inicio: '2026-01', transmissor: 'externo' },
];
const cnpjs = new Map<number, string | null>([
  [1, '11222333000181'],
  [2, '11222333000262'],
  [3, '99888777000155'],
  [4, null],
]);

describe('transmissor único por empregador (regra 1)', () => {
  it('a vigência mais recente que já começou decide; antes da primeira, nenhum', () => {
    expect(transmissorNaCompetencia(vig, 1, '2025-12')).toBeNull();
    expect(transmissorNaCompetencia(vig, 1, '2026-10')).toBe('externo');
    expect(transmissorNaCompetencia(vig, 1, '2026-11')).toBe('sante');
  });

  it('empresas com a mesma raiz de CNPJ são o mesmo empregador', () => {
    expect(empresasDaMesmaRaiz(cnpjs, 1)).toEqual([2]);
    expect(empresasDaMesmaRaiz(cnpjs, 3)).toEqual([]);
    expect(empresasDaMesmaRaiz(cnpjs, 4)).toEqual([]);
  });

  it('a mesma raiz com transmissores diferentes é recusada; sem parâmetros, sem transmissor', () => {
    expect(decidirTransmissor(vig, cnpjs, 1, '2026-10')).toEqual({ ok: true, transmissor: 'externo' });
    expect(decidirTransmissor(vig, cnpjs, 1, '2026-11')).toEqual({ ok: false, motivo: 'dois-transmissores' });
    expect(decidirTransmissor(vig, cnpjs, 3, '2026-11')).toEqual({ ok: false, motivo: 'sem-transmissor' });
    const so1 = vig.filter((v) => v.empresa === 1);
    expect(decidirTransmissor(so1, cnpjs, 1, '2026-11')).toEqual({ ok: true, transmissor: 'sante' });
  });
});

describe('conciliação da competência', () => {
  const base = { empresa: 1, competencia: '2026-11', mesmaRaiz: [2] };

  it('Sante SGH transmissor: o repasse vai nos periódicos dele; o externo com eventos é divergência', () => {
    const c = conciliar({
      ...base,
      decisao: { ok: true, transmissor: 'sante' },
      sante: { 'S-2200': 3, 'S-1010': 1 },
      externo: { 'S-2299': 1 },
      repasse: 12,
      pendenciasLegado: { 'S-1200': 40 },
    });
    const por = Object.fromEntries(c.linhas.map((l) => [l.evento, l]));
    expect(por['S-2200']!.situacao).toBe('conciliado');
    expect(por['S-2299']!.situacao).toBe('dois-transmissores');
    expect(por['S-1200']).toMatchObject({
      repasse: 12,
      pendenciaLegado: 40,
      situacao: 'repasse-no-periodico',
    });
    expect(por['S-1210']).toMatchObject({ repasse: 12, situacao: 'repasse-no-periodico', externo: null });
    expect(por['S-1010']!.rotulo).toBe('Rubricas');
    expect(c.situacao).toBe('divergente');
    expect(c.transmissor).toBe('sante');
  });

  it('externo transmissor: Sante SGH com evento é divergência; só pendência do outro sistema é contagem', () => {
    const c = conciliar({
      ...base,
      decisao: { ok: true, transmissor: 'externo' },
      sante: { 'S-2230': 1 },
      externo: { 'S-2200': 2 },
      repasse: 3,
      pendenciasLegado: { 'S-1005': 2 },
    });
    const por = Object.fromEntries(c.linhas.map((l) => [l.evento, l]));
    expect(por['S-2230']!.situacao).toBe('dois-transmissores');
    expect(por['S-2200']!.situacao).toBe('conciliado');
    expect(por['S-1200']!.situacao).toBe('repasse-no-externo');
    expect(por['S-1005']!.situacao).toBe('so-contagem');
    expect(c.situacao).toBe('divergente');
  });

  it('tudo de um lado só é conciliada; sem parâmetros fica sem transmissor; raiz dividida é divergente', () => {
    const ok = conciliar({
      ...base,
      decisao: { ok: true, transmissor: 'externo' },
      sante: {},
      externo: { 'S-2200': 2 },
      repasse: 0,
      pendenciasLegado: {},
    });
    expect(ok.situacao).toBe('conciliada');
    expect(ok.linhas.map((l) => l.evento)).toEqual(['S-2200']);
    const sem = conciliar({
      ...base,
      decisao: { ok: false, motivo: 'sem-transmissor' },
      sante: {},
      externo: {},
      repasse: 1,
      pendenciasLegado: {},
    });
    expect(sem.situacao).toBe('sem-transmissor');
    expect(sem.linhas.every((l) => l.situacao === 'sem-transmissor')).toBe(true);
    const dois = conciliar({
      ...base,
      decisao: { ok: false, motivo: 'dois-transmissores' },
      sante: {},
      externo: {},
      repasse: 0,
      pendenciasLegado: { 'S-9999': 1 },
    });
    expect(dois.situacao).toBe('divergente');
    expect(dois.linhas[0]).toMatchObject({
      evento: 'S-9999',
      rotulo: 'S-9999',
      situacao: 'dois-transmissores',
    });
    expect(dois.transmissor).toBeNull();
  });
});

describe('pendências do outro sistema (regra 2: só contagem)', () => {
  it('agrega por evento e ano, com o grupo; ignora linha sem quantidade', () => {
    const p = painelPendenciasLegado([
      { evento: 'S-1200', ano: 2021, quantidade: 952 },
      { evento: 'S-1200', ano: 2020, quantidade: 122 },
      { evento: 'S-1010', ano: 2020, quantidade: 114 },
      { evento: 'S-2200', ano: 2020, quantidade: 1 },
      { evento: 'S-2200', ano: 2020, quantidade: 1 },
      { evento: 'S-5001', ano: 2020, quantidade: 1 },
      { evento: 'R-2010', ano: 2020, quantidade: 1 },
      { evento: 'S-1005', ano: 2019, quantidade: 0 },
    ]);
    expect(p.total).toBe(1192);
    const por = Object.fromEntries(p.porEvento.map((e) => [e.evento, e]));
    expect(por['S-1200']).toMatchObject({
      grupo: 'periodico',
      quantidade: 1074,
      rotulo: 'Remuneração do trabalhador',
    });
    expect(por['S-1200']!.porAno.map((a) => a.ano)).toEqual([2020, 2021]);
    expect(por['S-1010']!.grupo).toBe('tabela');
    expect(por['S-2200']).toMatchObject({ grupo: 'nao-periodico', quantidade: 2 });
    expect(por['S-5001']!.grupo).toBeNull();
    expect(por['R-2010']!.grupo).toBeNull();
    expect(por['S-1005']).toBeUndefined();
  });
});
