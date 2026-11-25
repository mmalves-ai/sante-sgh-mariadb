import { describe, expect, it } from 'vitest';
import {
  conferirCultura,
  exibidosNoLaudo,
  interpretar,
  interpretarAntibiograma,
  laudoDaCultura,
  multirresistente,
  notificaControleInfeccao,
  type PontoCorte,
  pontoDeCorteVigente,
} from './antibiograma.js';

const ponto = (p: Partial<PontoCorte>): PontoCorte => ({
  id: 1,
  microrganismo: 10,
  antimicrobiano: 20,
  material: null,
  metodo: 'concentracao_inibitoria',
  norma: 'BrCAST',
  sensivelAte: 1,
  resistenteAcima: 4,
  haloSensivelMinimo: null,
  haloResistenteMaximo: null,
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  ativo: true,
  ...p,
});
const marcadoresNao = {
  betalactamaseEspectroEstendido: false,
  carbapenemase: false,
  resistenteMeticilina: false,
  resistenteVancomicina: false,
};

describe('interpretação pelo ponto de corte', () => {
  it('CIM: sensível até o limite, resistente acima, faixa média pela norma', () => {
    const p = ponto({});
    expect(interpretar(p, { cim: 1, halo: null })).toBe('sensivel');
    expect(interpretar(p, { cim: 8, halo: null })).toBe('resistente');
    expect(interpretar(p, { cim: 2, halo: null })).toBe('sensivel_dose_dependente');
    expect(interpretar(ponto({ norma: 'CLSI' }), { cim: 2, halo: null })).toBe('intermediario');
    expect(interpretar(p, { cim: null, halo: 20 })).toBeNull();
  });
  it('halo: sensível a partir do mínimo, resistente até o máximo', () => {
    const p = ponto({ metodo: 'disco_difusao', haloSensivelMinimo: 20, haloResistenteMaximo: 15 });
    expect(interpretar(p, { cim: null, halo: 22 })).toBe('sensivel');
    expect(interpretar(p, { cim: null, halo: 15 })).toBe('resistente');
    expect(interpretar(p, { cim: null, halo: 17 })).toBe('sensivel_dose_dependente');
  });
  it('o ponto do material vence o geral; fora da vigência ou inativo não vale', () => {
    const geral = ponto({ id: 1 });
    const liquor = ponto({ id: 2, material: 7, sensivelAte: 0.25 });
    const velho = ponto({ id: 3, vigenciaFim: '2021-01-01' });
    const alvo = { microrganismo: 10, antimicrobiano: 20, metodo: 'cim' as const, data: '2026-11-24' };
    expect(pontoDeCorteVigente([geral, liquor, velho], { ...alvo, material: 7 })?.id).toBe(2);
    expect(pontoDeCorteVigente([geral, liquor], { ...alvo, material: 8 })?.id).toBe(1);
    expect(
      pontoDeCorteVigente([velho, ponto({ id: 4, ativo: false })], { ...alvo, material: null }),
    ).toBeNull();
    expect(pontoDeCorteVigente([geral], { ...alvo, material: null, metodo: 'disco_difusao' })).toBeNull();
  });

  it('BrCAST e CLSI vigentes juntos: vale a norma do painel, na versão mais recente; sem painel, recusa', () => {
    const brcast = ponto({
      id: 1,
      norma: 'BrCAST',
      sensivelAte: 1,
      resistenteAcima: 4,
      vigenciaInicio: '2024-01-01',
    });
    const brcastNovo = ponto({
      id: 5,
      norma: 'BrCAST',
      sensivelAte: 0.5,
      resistenteAcima: 2,
      vigenciaInicio: '2026-01-01',
    });
    const clsi = ponto({
      id: 2,
      norma: 'CLSI',
      sensivelAte: 2,
      resistenteAcima: 8,
      vigenciaInicio: '2026-06-01',
    });
    const todos = [brcast, brcastNovo, clsi];
    const alvo = {
      microrganismo: 10,
      antimicrobiano: 20,
      metodo: 'cim' as const,
      data: '2026-11-24',
      material: null,
    };
    expect(pontoDeCorteVigente(todos, { ...alvo, norma: 'brcast' })?.id).toBe(5);
    expect(pontoDeCorteVigente(todos, { ...alvo, norma: 'CLSI' })?.id).toBe(2);
    expect(pontoDeCorteVigente(todos, { ...alvo, norma: 'EUCAST' })).toBeNull();
    expect(() => pontoDeCorteVigente(todos, alvo)).toThrowError(/painel/);
    expect(pontoDeCorteVigente([brcast, brcastNovo], alvo)?.id).toBe(5);
    // A mesma CIM 1 no painel BrCAST: acima do novo limite de sensível (0,5) e até 2 = sensível aumentando a exposição;
    // no painel CLSI: sensível (até 2).
    const teste = [{ antimicrobiano: 20, metodo: 'cim' as const, cim: 1, halo: null, interpretacao: null }];
    const base = { microrganismo: 10, material: null, data: '2026-11-24' };
    expect(interpretarAntibiograma(teste, todos, { ...base, norma: 'BrCAST' })[0]).toMatchObject({
      interpretacao: 'sensivel_dose_dependente',
      ponto: 5,
    });
    expect(interpretarAntibiograma(teste, todos, { ...base, norma: 'CLSI' })[0]).toMatchObject({
      interpretacao: 'sensivel',
      ponto: 2,
    });
  });
});

describe('antibiograma do isolado', () => {
  const alvo = { microrganismo: 10, material: null, data: '2026-11-24' };
  it('o ponto decide; sem ponto, a leitura informada é obrigatória', () => {
    const r = interpretarAntibiograma(
      [
        { antimicrobiano: 20, metodo: 'cim', cim: 8, halo: null, interpretacao: 'sensivel' },
        { antimicrobiano: 21, metodo: 'disco_difusao', cim: null, halo: 25, interpretacao: 'resistente' },
      ],
      [ponto({})],
      alvo,
    );
    expect(r.map((x) => [x.interpretacao, x.ponto, x.pelaRegra])).toEqual([
      ['resistente', 1, true],
      ['resistente', null, false],
    ]);
    expect(() =>
      interpretarAntibiograma(
        [{ antimicrobiano: 21, metodo: 'cim', cim: 1, halo: null, interpretacao: null }],
        [],
        alvo,
      ),
    ).toThrow(/interpretação/);
  });
  it('recusa antimicrobiano repetido, medida negativa e medida do método errado', () => {
    const t = { antimicrobiano: 20, metodo: 'cim' as const, cim: 1, halo: null, interpretacao: null };
    expect(() => interpretarAntibiograma([t, t], [ponto({})], alvo)).toThrow(/duas vezes/);
    expect(() => interpretarAntibiograma([{ ...t, cim: -1 }], [ponto({})], alvo)).toThrow(/negativa/);
    expect(() => interpretarAntibiograma([{ ...t, halo: 10 }], [ponto({})], alvo)).toThrow(/halo/);
  });
  it('cascata: o restrito só aparece com resistência a um de primeira linha; o não testado nunca', () => {
    const painel = [
      { antimicrobiano: 1, exibeNoLaudo: true, liberacaoRestrita: false, indicaMultirresistencia: false },
      { antimicrobiano: 2, exibeNoLaudo: true, liberacaoRestrita: true, indicaMultirresistencia: true },
      { antimicrobiano: 3, exibeNoLaudo: false, liberacaoRestrita: false, indicaMultirresistencia: false },
    ];
    const sens = [
      { antimicrobiano: 1, interpretacao: 'sensivel' as const },
      { antimicrobiano: 2, interpretacao: 'sensivel' as const },
      { antimicrobiano: 3, interpretacao: 'sensivel' as const },
      { antimicrobiano: 4, interpretacao: 'nao_testado' as const },
    ];
    expect([...exibidosNoLaudo(sens, painel)]).toEqual([1]);
    const res = [{ antimicrobiano: 1, interpretacao: 'resistente' as const }, sens[1]!];
    expect([...exibidosNoLaudo(res, painel)].sort()).toEqual([1, 2]);
    expect(multirresistente(res, painel, marcadoresNao)).toBe(false);
    expect(
      multirresistente([{ antimicrobiano: 2, interpretacao: 'resistente' }], painel, marcadoresNao),
    ).toBe(true);
    expect(multirresistente([], painel, { ...marcadoresNao, carbapenemase: true })).toBe(true);
  });
});

describe('cultura', () => {
  const base = {
    crescimento: 'com_crescimento' as const,
    isolados: 1,
    final: true,
    conclusao: 'ok',
    sequencias: [1],
  };
  it('confere crescimento, isolados e conclusão', () => {
    expect(() => conferirCultura(base)).not.toThrow();
    expect(() => conferirCultura({ ...base, crescimento: 'sem_crescimento' })).toThrow(/sem crescimento/);
    expect(() => conferirCultura({ ...base, isolados: 0, sequencias: [] })).toThrow(/ao menos um isolado/);
    expect(() => conferirCultura({ ...base, conclusao: ' ' })).toThrow(/conclusão/);
    expect(() => conferirCultura({ ...base, isolados: 2, sequencias: [1, 1] })).toThrow(/mesma ordem/);
    expect(() =>
      conferirCultura({ ...base, crescimento: 'em_andamento', isolados: 0, sequencias: [] }),
    ).toThrow(/andamento/);
    expect(() => conferirCultura({ ...base, isolados: 0, sequencias: [], final: false })).not.toThrow();
  });
  it('laudo com o antibiograma liberado e o aviso de multirresistente', () => {
    const t = laudoDaCultura({
      material: 'Urina',
      crescimento: 'com_crescimento',
      contagemColonias: '> 100.000 UFC/mL',
      conclusao: 'Infecção urinária',
      situacao: 'final',
      isolados: [
        {
          sequencia: 1,
          microrganismo: 'Germe A',
          contagem: null,
          multirresistente: true,
          testes: [
            { antimicrobiano: 'Droga 1', medida: '8', interpretacao: 'resistente', exibeNoLaudo: true },
            { antimicrobiano: 'Droga 2', medida: null, interpretacao: 'sensivel', exibeNoLaudo: false },
          ],
        },
      ],
    });
    expect(t).toContain('Droga 1: Resistente (8)');
    expect(t).not.toContain('Droga 2');
    expect(t).toContain('multirresistente');
    expect(t).not.toContain('parcial');
  });
});

describe('notificação à CCIH', () => {
  it('cultura final com multirresistente notifica sozinha; contaminante e cultura parcial não', () => {
    const b = {
      culturaFinal: true,
      multirresistente: true,
      marcadoManual: false,
      contaminanteProvavel: false,
    };
    expect(notificaControleInfeccao(b)).toBe(true);
    expect(notificaControleInfeccao({ ...b, multirresistente: false })).toBe(false);
    expect(notificaControleInfeccao({ ...b, multirresistente: false, marcadoManual: true })).toBe(true);
    expect(notificaControleInfeccao({ ...b, contaminanteProvavel: true })).toBe(false);
    expect(notificaControleInfeccao({ ...b, culturaFinal: false })).toBe(false);
  });
});
