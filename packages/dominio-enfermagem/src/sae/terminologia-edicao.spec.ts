// A edição versionada da terminologia de enfermagem licenciada (decisão do fecho-1): chave única por sistema + código +
// edição, o sistema de cada termo pelo pacote (NNN: NANDA-I, NIC, NOC; CIPE) e o termo divergente recusado. Termos
// SINTÉTICOS (nenhum conteúdo licenciado no repositório).
import { describe, expect, it } from 'vitest';
import { montarEdicaoTerminologia, sistemaDoTermoSae } from './processo.js';

const base = [
  { tipo: 'diagnostico', codigo: 'S-D1', pai: null, descricao: 'Diagnóstico sintético 1', risco: false },
  { tipo: 'diagnostico', codigo: 'S-D2', pai: null, descricao: 'Diagnóstico sintético 2', risco: true },
  {
    tipo: 'caracteristica',
    codigo: 'S-C1',
    pai: 'S-D1',
    descricao: 'Característica sintética',
    risco: false,
  },
  { tipo: 'fator', codigo: 'S-F1', pai: 'S-D2', descricao: 'Fator sintético', risco: false },
  { tipo: 'resultado', codigo: 'S-R1', pai: null, descricao: 'Resultado sintético', risco: false },
  { tipo: 'intervencao', codigo: 'S-I1', pai: null, descricao: 'Intervenção sintética', risco: false },
  { tipo: 'atividade', codigo: 'S-A1', pai: 'S-I1', descricao: 'Atividade sintética', risco: false },
];

describe('sistema do termo pelo pacote', () => {
  it('NNN separa NANDA-I, NOC e NIC; CIPE é um sistema só', () => {
    expect(['diagnostico', 'caracteristica', 'fator'].map((t) => sistemaDoTermoSae('NNN', t))).toEqual([
      'NANDA-I',
      'NANDA-I',
      'NANDA-I',
    ]);
    expect(sistemaDoTermoSae('NNN', 'resultado')).toBe('NOC');
    expect([sistemaDoTermoSae('NNN', 'intervencao'), sistemaDoTermoSae('NNN', 'atividade')]).toEqual([
      'NIC',
      'NIC',
    ]);
    expect(sistemaDoTermoSae('CIPE', 'resultado')).toBe('CIPE');
  });
});

describe('montar a edição da terminologia', () => {
  it('NNN: três edições, um termo por sistema + código e as ligações ao superior', () => {
    const r = montarEdicaoTerminologia({ pacote: 'NNN', termos: base });
    if (!r.ok) throw new Error(r.codigo);
    expect(r.edicoes).toEqual([
      { sistema: 'NANDA-I', termos: 4 },
      { sistema: 'NOC', termos: 1 },
      { sistema: 'NIC', termos: 2 },
    ]);
    expect(r.ligacoes).toEqual([
      { sistema: 'NANDA-I', codigo: 'S-C1', superior: 'S-D1' },
      { sistema: 'NANDA-I', codigo: 'S-F1', superior: 'S-D2' },
      { sistema: 'NIC', codigo: 'S-A1', superior: 'S-I1' },
    ]);
  });

  it('a mesma característica em dois diagnósticos é um termo só, com duas ligações', () => {
    const r = montarEdicaoTerminologia({
      pacote: 'NNN',
      termos: [...base, { ...base[2]!, pai: 'S-D2' }],
    });
    if (!r.ok) throw new Error(r.codigo);
    expect(r.termos.filter((t) => t.codigo === 'S-C1')).toHaveLength(1);
    expect(r.ligacoes.filter((l) => l.codigo === 'S-C1').map((l) => l.superior)).toEqual(['S-D1', 'S-D2']);
  });

  it('o mesmo código em sistemas diferentes do NNN convive; no CIPE, diverge', () => {
    const mesmo = [
      ...base,
      { tipo: 'resultado', codigo: 'S-D1', pai: null, descricao: 'Outro', risco: false },
    ];
    const nnn = montarEdicaoTerminologia({ pacote: 'NNN', termos: mesmo });
    expect(nnn.ok).toBe(true);
    const cipe = montarEdicaoTerminologia({ pacote: 'CIPE', termos: mesmo });
    expect(cipe).toMatchObject({ ok: false, codigo: 'termo-divergente', campo: 'termos.7' });
  });

  it('a mesma característica com outra descrição é recusada; a carga incompleta, também', () => {
    const r = montarEdicaoTerminologia({
      pacote: 'NNN',
      termos: [...base, { ...base[2]!, pai: 'S-D2', descricao: 'Outra descrição' }],
    });
    expect(r).toMatchObject({ ok: false, codigo: 'termo-divergente' });
    expect(montarEdicaoTerminologia({ pacote: 'CIPE', termos: base.slice(0, 3) })).toMatchObject({
      ok: false,
      codigo: 'terminologia-incompleta',
    });
  });
});
