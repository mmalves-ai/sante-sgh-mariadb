// A edição versionada da terminologia de enfermagem licenciada (decisão do fecho-1): chave única por sistema + código +
// edição, o sistema de cada termo pelo pacote (NNN: NANDA-I, NIC, NOC; CIPE) e o termo divergente recusado. Termos
// SINTÉTICOS (nenhum conteúdo licenciado no repositório).
import { describe, expect, it } from 'vitest';
import {
  comporTerminologiaSae,
  edicoesVigentesSae,
  type EdicaoTerminologiaMontada,
  escolherEscalaResultadoSae,
  montarEdicaoTerminologia,
  planejarCatalogoDeUsoSae,
  sistemaDoTermoSae,
} from './processo.js';

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

const montada = montarEdicaoTerminologia({ pacote: 'NNN', termos: base }) as EdicaoTerminologiaMontada;
const escalaUnica = [
  { id: 7, tipoEscala: 'E1', ponto: 2, usos: 0 },
  { id: 6, tipoEscala: 'E1', ponto: 1, usos: 0 },
];

describe('edições vigentes por pacote', () => {
  it('a última de cada pacote; a CIPE não esconde a NNN; o rótulo junta as duas', () => {
    expect(edicoesVigentesSae([])).toBeNull();
    const so = edicoesVigentesSae([
      { pacote: 'NNN', edicao: 'A', licenca: 'L1' },
      { pacote: 'NNN', edicao: 'B', licenca: 'L2' },
    ]);
    expect(so).toMatchObject({ sistema: 'NNN', versao: 'B', licenca: 'L2' });
    const duas = edicoesVigentesSae([
      { pacote: 'CIPE', edicao: 'C1', licenca: 'LC' },
      { pacote: 'NNN', edicao: 'B', licenca: 'L2' },
      { pacote: 'CIPE', edicao: 'C2', licenca: 'LC' },
    ])!;
    expect(duas.vigentes.map((e) => `${e.pacote}/${e.edicao}`)).toEqual(['NNN/B', 'CIPE/C2']);
    expect(duas).toMatchObject({ sistema: 'NNN', versao: 'NNN B + CIPE C2' });
  });
});

describe('terminologia em uso: edição, menos o que o hospital tirou, mais o próprio', () => {
  it('esconde o inativo e a ligação excluída; mantém o item próprio ativo fora da edição', () => {
    const vigentes = edicoesVigentesSae([{ pacote: 'NNN', edicao: 'V', licenca: 'L' }])!;
    const linhas = comporTerminologiaSae({
      vigentes,
      edicao: base.map((x) => ({ ...x, pacote: 'NNN' as const })),
      proprios: [
        { tipo: 'diagnostico', codigo: 'H-D9', pai: null, descricao: 'Próprio do hospital', risco: false },
        { tipo: 'diagnostico', codigo: 'S-D1', pai: null, descricao: 'Enunciado do hospital', risco: false },
        { tipo: 'caracteristica', codigo: 'S-C1', pai: null, descricao: 'Sem ligação', risco: false },
      ],
      inativos: new Set(['intervencao_enfermagem|S-I1']),
      paresExcluidos: new Set(['S-D2|S-F1']),
    });
    const codigos = linhas.map((x) => `${x.tipo}:${x.codigo}`);
    expect(codigos).toContain('diagnostico:H-D9');
    expect(codigos).not.toContain('intervencao:S-I1');
    expect(codigos).not.toContain('fator:S-F1');
    expect(codigos.filter((c) => c === 'diagnostico:S-D1')).toHaveLength(1);
    expect(codigos.filter((c) => c === 'caracteristica:S-C1')).toHaveLength(1);
    expect(linhas.every((x) => x.versao === 'V' && x.licenca === 'L' && x.sistema === 'NNN')).toBe(true);
  });
});

describe('escala do resultado novo', () => {
  it('um tipo: o primeiro ponto; vários: o predominante; empate ou nada: recusa', () => {
    expect(escolherEscalaResultadoSae(escalaUnica)).toBe(6);
    expect(escolherEscalaResultadoSae([])).toMatchObject({ codigo: 'escala-ausente' });
    expect(
      escolherEscalaResultadoSae([
        { id: 1, tipoEscala: 'A', ponto: 1, usos: 1 },
        { id: 2, tipoEscala: 'B', ponto: 1, usos: 1 },
      ]),
    ).toMatchObject({ codigo: 'escala-ambigua' });
    expect(
      escolherEscalaResultadoSae([
        { id: 1, tipoEscala: 'A', ponto: 1, usos: 1 },
        { id: 2, tipoEscala: 'B', ponto: 1, usos: 3 },
      ]),
    ).toBe(2);
  });
});

describe('plano da edição sobre o catálogo de uso', () => {
  it('catálogo vazio: inclui tudo (fator de risco pelo diagnóstico), liga com o papel, escala escolhida', () => {
    const p = planejarCatalogoDeUsoSae(montada, [], [], escalaUnica);
    if (!p.ok) throw new Error(p.codigo);
    expect(p.incluir.map((x) => [x.tabela, x.codigo, x.tipo, x.escala])).toEqual([
      ['diagnostico_enfermagem', 'S-D1', 'real', null],
      ['diagnostico_enfermagem', 'S-D2', 'risco', null],
      ['caracteristica_diagnostico_enfermagem', 'S-C1', 'caracteristica_definidora', null],
      ['caracteristica_diagnostico_enfermagem', 'S-F1', 'fator_risco', null],
      ['resultado_enfermagem', 'S-R1', null, 6],
      ['intervencao_enfermagem', 'S-I1', null, null],
    ]);
    expect(p.ligar).toEqual([
      { diagnostico: 'S-D1', caracteristica: 'S-C1', papel: 'definidora' },
      { diagnostico: 'S-D2', caracteristica: 'S-F1', papel: 'fator_risco' },
    ]);
  });

  it('o inativo fica inativo, a ligação excluída fica excluída, o enunciado em uso não entra no plano', () => {
    const p = planejarCatalogoDeUsoSae(
      montada,
      [
        { tabela: 'diagnostico_enfermagem', codigo: 'S-D1', id: 1, ativo: true, tipo: 'promocao_saude' },
        { tabela: 'intervencao_enfermagem', codigo: 'S-I1', id: 2, ativo: false, tipo: null },
        {
          tabela: 'caracteristica_diagnostico_enfermagem',
          codigo: 'S-F1',
          id: 3,
          ativo: true,
          tipo: 'condicao_associada',
        },
      ],
      [{ diagnostico: 'S-D1', caracteristica: 'S-C1', excluido: true }],
      escalaUnica,
    );
    if (!p.ok) throw new Error(p.codigo);
    expect(p.incluir.map((x) => x.codigo)).toEqual(['S-D2', 'S-C1', 'S-R1']);
    expect(p).toMatchObject({ mantidosInativos: 1, paresExcluidos: 1 });
    expect(p.ligar).toEqual([{ diagnostico: 'S-D2', caracteristica: 'S-F1', papel: 'condicao_associada' }]);
  });

  it('código já cadastrado com outro tipo: recusa catalogo-tipo-divergente', () => {
    const real = { tabela: 'diagnostico_enfermagem', codigo: 'S-D2', id: 1, ativo: true, tipo: 'real' };
    expect(planejarCatalogoDeUsoSae(montada, [real], [], escalaUnica)).toMatchObject({
      codigo: 'catalogo-tipo-divergente',
    });
    const comoFator = {
      tabela: 'caracteristica_diagnostico_enfermagem',
      codigo: 'S-C1',
      id: 2,
      ativo: true,
      tipo: 'fator_relacionado',
    };
    expect(planejarCatalogoDeUsoSae(montada, [comoFator], [], escalaUnica)).toMatchObject({
      codigo: 'catalogo-tipo-divergente',
    });
    expect(planejarCatalogoDeUsoSae(montada, [], [], [])).toMatchObject({ codigo: 'escala-ausente' });
  });
});
