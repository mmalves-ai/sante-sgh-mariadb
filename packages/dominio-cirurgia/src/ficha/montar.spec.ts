// M46 (etapa 1), regra 3: a montagem da ficha para a tela (descrições, lacunas com as justificativas, responsáveis,
// totais, abertos, anestesistas da cirurgia e pendências da assinatura para a sessão), o de-para para o balanço do M45
// e o conteúdo canônico que a assinatura cobre. Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import { conteudoCanonicoFicha, deParaBalanco, impressaoFicha } from './balanco-assinatura.js';
import { descreverLancamento, type LancamentoParaMontar, montarFicha } from './montar.js';

const l = (
  id: number,
  parte: LancamentoParaMontar['parte'],
  momento: string,
  dados: LancamentoParaMontar['dados'],
  fim: string | null = null,
): LancamentoParaMontar => ({
  id,
  parte,
  momento,
  fim,
  dados,
  profissional: 5002,
  registradoEm: momento,
  balanco: null,
});

describe('descrição dos lançamentos', () => {
  it('cada parte no vocabulário do novo, com o valor e a unidade', () => {
    expect(descreverLancamento({ parte: 'sinal', dados: { tipo: 'pas', valor: 120 } })).toEqual({
      descricao: 'Pressão arterial sistólica',
      valor: 120,
      unidade: 'mmHg',
    });
    expect(descreverLancamento({ parte: 'sinal', dados: { tipo: 'zz', valor: 'x' } })).toMatchObject({
      descricao: 'zz',
      valor: null,
    });
    expect(
      descreverLancamento({
        parte: 'medicamento',
        dados: { descricao: 'PROPOFOL', dose: 150, unidade: 'mg', via: 'ev' },
      }),
    ).toEqual({ descricao: 'PROPOFOL · Endovenosa', valor: 150, unidade: 'mg' });
    expect(
      descreverLancamento({ parte: 'medicamento', dados: { item: 9, dose: 1, unidade: '', via: 'zz' } }),
    ).toMatchObject({
      descricao: 'Item 9 · zz',
      unidade: null,
    });
    expect(descreverLancamento({ parte: 'gas', dados: { gas: 'sevoflurano', valor: 2 } }).unidade).toBe('%');
    expect(descreverLancamento({ parte: 'gas', dados: { gas: 'xx', valor: 2 } })).toMatchObject({
      descricao: 'xx',
      unidade: null,
    });
    expect(
      descreverLancamento({ parte: 'fluido', dados: { fluido: 'plasma', volumeMl: 200 } }).descricao,
    ).toBe('Plasma fresco congelado');
    expect(descreverLancamento({ parte: 'perda', dados: { perda: 'diurese', volumeMl: 100 } }).valor).toBe(
      100,
    );
    expect(
      descreverLancamento({ parte: 'evento', dados: { evento: 'outro', descricao: 'tremor' } }).descricao,
    ).toBe('Outro evento: tremor');
    expect(descreverLancamento({ parte: 'evento', dados: { evento: 'intubacao' } }).descricao).toBe(
      'Intubação',
    );
    const nomes = {
      modos: new Map([[3, 'Controlada']]),
      posicoes: new Map([[1, 'Decúbito dorsal']]),
      funcoes: new Map([[6, 'Anestesista']]),
      profissionais: new Map([[5002, 'ANESTESISTA SINTETICO B']]),
    };
    expect(descreverLancamento({ parte: 'modoRespiratorio', dados: { modo: 3 } }, nomes).descricao).toBe(
      'Controlada',
    );
    expect(descreverLancamento({ parte: 'modoRespiratorio', dados: { modo: 4 } }).descricao).toBe('Modo 4');
    expect(descreverLancamento({ parte: 'posicao', dados: { posicao: 1 } }, nomes).descricao).toBe(
      'Decúbito dorsal',
    );
    expect(descreverLancamento({ parte: 'posicao', dados: { posicao: null } }).descricao).toBe('Posição ');
    expect(
      descreverLancamento({ parte: 'equipe', dados: { profissional: 5002, funcao: 6 } }, nomes).descricao,
    ).toBe('ANESTESISTA SINTETICO B · Anestesista');
    expect(descreverLancamento({ parte: 'equipe', dados: { profissional: 1, funcao: 2 } }).descricao).toBe(
      'Profissional 1 · Função 2',
    );
    expect(
      descreverLancamento({ parte: 'procedimento', dados: { descricao: 'Acesso', observacao: 'central' } })
        .descricao,
    ).toBe('Acesso: central');
    expect(descreverLancamento({ parte: 'procedimento', dados: { descricao: 'Acesso' } }).descricao).toBe(
      'Acesso',
    );
    expect(
      descreverLancamento({ parte: 'exame', dados: { exame: 'Gasometria', resultado: 'pH 7,4' } }).descricao,
    ).toBe('Gasometria: pH 7,4');
    expect(descreverLancamento({ parte: 'exame', dados: { exame: 'Glicemia' } }).descricao).toBe('Glicemia');
    expect(
      descreverLancamento({ parte: 'avulso', dados: { descricao: 'Manta', quantidade: 1 } }),
    ).toMatchObject({ descricao: 'Manta', valor: 1 });
    expect(
      descreverLancamento({ parte: 'bi', dados: { descricao: 'REMIFENTANIL', vazao: 5, unidade: 'mL/h' } }),
    ).toEqual({ descricao: 'REMIFENTANIL', valor: 5, unidade: 'mL/h' });
    expect(descreverLancamento({ parte: 'bi', dados: { item: 9, vazao: 5, unidade: '' } })).toMatchObject({
      descricao: 'Item 9',
      unidade: null,
    });
    expect(descreverLancamento({ parte: 'zz' as never, dados: {} }).descricao).toBe('zz');
  });
});

describe('montagem da ficha', () => {
  const base = {
    situacao: 'aberta' as const,
    marcos: { entradaSala: '2026-10-26T08:00', inicioAnestesia: '2026-10-26T08:05' },
    abertura: 5002,
    abertaEm: '2026-10-26T08:00',
    passagens: [],
    lacunas: [],
  };
  const sinais = (m: string) =>
    ['pas', 'pad', 'fc', 'spo2'].map((tipo, i) =>
      l(100 + i + Number(m.slice(14)), 'sinal', m, { tipo, valor: 80 }),
    );
  it('a grade fecha em "agora" sem o fim da anestesia; o gás aberto e a infusão contínua impedem; os totais', () => {
    const f = montarFicha(
      {
        ...base,
        lancamentos: [
          ...sinais('2026-10-26T08:05'),
          l(1, 'gas', '2026-10-26T08:06', { gas: 'o2', valor: 2 }),
          l(2, 'medicamento', '2026-10-26T08:06', { continua: 1, dose: 5 }),
          l(3, 'medicamento', '2026-10-26T08:06', { continua: 0, dose: 5 }),
          l(6, 'bi', '2026-10-26T08:06', { vazao: 5 }, '2026-10-26T08:10'),
          l(4, 'fluido', '2026-10-26T08:07', { fluido: 'concentrado-hemacias', volumeMl: 300 }),
          l(5, 'perda', '2026-10-26T08:08', { perda: 'sangramento', volumeMl: 150 }),
        ],
      },
      { agora: '2026-10-26T08:15', agendado: null, funcaoAnestesista: 6, sessao: [7777] },
    );
    expect(f.lacunas).toHaveLength(1);
    expect(f.lacunas[0]).toMatchObject({
      inicio: '2026-10-26T08:10',
      fim: '2026-10-26T08:15',
      justificada: false,
    });
    expect(f.abertos).toBe(2);
    expect(f.totais).toEqual({ ganhosMl: 300, perdasMl: 150, hemocomponentesMl: 300 });
    expect(f.assinante).toBeNull();
    expect(f.pendenciasAssinatura).toEqual([
      'ficha-sem-fim-anestesia',
      'ficha-lacuna-sinais',
      'ficha-gas-sem-fim',
      'ficha-nao-e-anestesista',
    ]);
  });
  it('encerrada, com a lacuna justificada e o anestesista da equipe na sessão: pode assinar', () => {
    const f = montarFicha(
      {
        ...base,
        situacao: 'encerrada',
        marcos: { ...base.marcos, fimAnestesia: '2026-10-26T08:15' },
        lacunas: [{ inicio: '2026-10-26T08:10', fim: '2026-10-26T08:15' }],
        passagens: [{ momento: '2026-10-26T08:12', de: 5002, para: 5005 }],
        lancamentos: [
          ...sinais('2026-10-26T08:05'),
          l(9, 'equipe', '2026-10-26T08:00', { profissional: 5010, funcao: 6 }),
        ],
      },
      { agora: '2026-10-26T09:00', agendado: 5020, funcaoAnestesista: 6, sessao: [1, 5010] },
    );
    expect(f.lacunas.every((x) => x.justificada)).toBe(true);
    expect(f.responsaveis.map((r) => r.anestesista)).toEqual([5002, 5005]);
    expect([...f.anestesistas].sort()).toEqual([5002, 5005, 5010, 5020]);
    expect(f.assinante).toBe(5010);
    expect(f.pendenciasAssinatura).toEqual([]);
  });
  it('sem o início da anestesia não há grade', () => {
    const f = montarFicha(
      { ...base, marcos: {}, lancamentos: [] },
      { agora: '2026-10-26T09:00', agendado: null, funcaoAnestesista: null, sessao: [5002] },
    );
    expect(f.lacunas).toEqual([]);
    expect(f.assinante).toBe(5002);
  });
});

describe('balanço e assinatura', () => {
  const d = {
    grupos: [
      { codigo: 1, nome: 'Dieta' },
      { codigo: 2, nome: 'Soroterapia' },
      { codigo: 3, nome: 'Hemoderivados' },
    ],
    tiposEliminacao: [
      { codigo: 10, nome: 'Vômito', ativo: true },
      { codigo: 11, nome: 'Diurese', ativo: true },
      { codigo: 12, nome: 'Sangramento', ativo: true },
      { codigo: 13, nome: 'Aspiração', ativo: false },
    ],
  };
  it('o de-para pelo nome; sem correspondência, o primeiro; domínio vazio fica fora', () => {
    expect(deParaBalanco({ parte: 'fluido', tipo: 'cristaloide' }, d)).toEqual({
      grupo: 2,
      tipoEliminacao: null,
    });
    expect(deParaBalanco({ parte: 'fluido', tipo: 'plasma' }, d)).toEqual({ grupo: 3, tipoEliminacao: null });
    expect(
      deParaBalanco({ parte: 'fluido', tipo: 'outro' }, { ...d, grupos: [{ codigo: 9, nome: 'Oral' }] })
        ?.grupo,
    ).toBe(9);
    expect(deParaBalanco({ parte: 'perda', tipo: 'diurese' }, d)).toEqual({
      grupo: null,
      tipoEliminacao: 11,
    });
    expect(deParaBalanco({ parte: 'perda', tipo: 'sangramento' }, d)?.tipoEliminacao).toBe(12);
    expect(deParaBalanco({ parte: 'perda', tipo: 'aspiracao' }, d)?.tipoEliminacao).toBe(10);
    expect(deParaBalanco({ parte: 'perda', tipo: 'zz' }, d)?.tipoEliminacao).toBe(10);
    expect(
      deParaBalanco({ parte: 'fluido', tipo: 'cristaloide' }, { grupos: [], tiposEliminacao: [] }),
    ).toBeNull();
    expect(
      deParaBalanco({ parte: 'perda', tipo: 'diurese' }, { grupos: [], tiposEliminacao: [] }),
    ).toBeNull();
  });
  it('o conteúdo canônico não depende da ordem nem das chaves; o hash muda com o conteúdo', async () => {
    const c = {
      agendamento: 1,
      marcos: { inicioAnestesia: '2026-10-26T08:05', entradaSala: '2026-10-26T08:00' },
      lancamentos: [
        { id: 2, parte: 'sinal', momento: '2026-10-26T08:10', fim: null, dados: { valor: 80, tipo: 'fc' } },
        { id: 1, parte: 'sinal', momento: '2026-10-26T08:10', fim: null, dados: { tipo: 'pas', valor: 120 } },
        { id: 3, parte: 'gas', momento: '2026-10-26T08:05', fim: null, dados: { gas: 'o2', valor: 2 } },
      ],
      passagens: [],
      lacunas: [],
    };
    const outra = {
      ...c,
      lancamentos: [...c.lancamentos].reverse(),
      marcos: { entradaSala: '2026-10-26T08:00', inicioAnestesia: '2026-10-26T08:05' },
    };
    expect(conteudoCanonicoFicha(outra)).toBe(conteudoCanonicoFicha(c));
    expect(await impressaoFicha(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(await impressaoFicha({ ...c, agendamento: 2 })).not.toBe(await impressaoFicha(c));
    expect(JSON.parse(conteudoCanonicoFicha(c)).lancamentos.map((x: { id: number }) => x.id)).toEqual([
      3, 1, 2,
    ]);
  });
});
