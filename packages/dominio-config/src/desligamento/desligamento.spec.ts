import { INVENTARIO_DESLIGAMENTO, type ItemInventarioDesligamento } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { avaliarInventario, avaliarItem, inventarioResolvido, ultimoRegistroPorItem } from './inventario.js';
import { avaliarPassos, ESTADO_PADRAO_DP6, type EstadoDesligamento } from './passos.js';
import {
  charsetConfere,
  charsetEsperado,
  entradaUtf8Pode,
  funcoesExternas,
  funcoesExternasPendentes,
  restricaoEntrada,
  versaoMaior,
} from './plataforma.js';
import { avaliarSessoes, inicioDaJanela, loginsExcluidos } from './sessoes.js';

describe('regra 3: duas semanas sem sessão de pessoa', () => {
  it('a janela de 14 dias é hoje e os 13 anteriores', () => {
    expect(inicioDaJanela('2026-07-05', 14)).toBe('2026-06-22');
    expect(() => inicioDaJanela('05/07/2026', 14)).toThrow();
    expect(() => inicioDaJanela('2026-07-05', 0)).toThrow();
  });

  it('com sessão dentro da janela não cumpre; a série fica só com os dias da janela', () => {
    const r = avaliarSessoes(
      [
        { dia: '2026-07-03', pessoas: 113 },
        { dia: '2026-07-05', pessoas: 71 },
        { dia: '2026-06-01', pessoas: 9 },
        { dia: '2026-07-03', pessoas: 1 },
      ],
      '2026-07-05',
    );
    expect(r.cumprido).toBe(false);
    expect(r.cumpridoCap14).toBe(false);
    expect(r.porDia).toEqual([
      { dia: '2026-07-03', pessoas: 114 },
      { dia: '2026-07-05', pessoas: 71 },
    ]);
    expect(r.pessoasNaJanela).toBe(185);
    expect(r.diasSemSessao).toBe(0);
  });

  it('a contagem distinta substitui a soma, e não pode contradizer a série', () => {
    const serie = [{ dia: '2026-07-01', pessoas: 3 }];
    expect(avaliarSessoes(serie, '2026-07-05', 14, 2).pessoasNaJanela).toBe(2);
    expect(() => avaliarSessoes(serie, '2026-07-05', 14, 0)).toThrow(/não casa/);
  });

  it('sem sessão há 20 dias: cumpre os 14 do cap-15, não os 30 do cap-14', () => {
    const r = avaliarSessoes([{ dia: '2026-06-15', pessoas: 2 }], '2026-07-05');
    expect(r).toMatchObject({ cumprido: true, cumpridoCap14: false, pessoasNaJanela: 0, diasSemSessao: 20 });
    expect(r.porDia).toEqual([]);
  });

  it('nenhuma sessão lida: cumpre as duas janelas, sem dias desde a última', () => {
    expect(avaliarSessoes([], '2026-07-05')).toMatchObject({
      cumprido: true,
      cumpridoCap14: true,
      diasSemSessao: null,
    });
    expect(avaliarSessoes([{ dia: '2026-07-01', pessoas: 0 }], '2026-07-05').diasSemSessao).toBeNull();
  });

  it('dia depois de hoje conta como dentro da janela (relógio adiantado nunca cumpre por engano)', () => {
    const r = avaliarSessoes([{ dia: '2026-07-07', pessoas: 1 }], '2026-07-05');
    expect(r.cumprido).toBe(false);
    expect(r.diasSemSessao).toBe(0);
  });

  it('linha inválida é recusada', () => {
    expect(() => avaliarSessoes([{ dia: '2026-7-1', pessoas: 1 }], '2026-07-05')).toThrow();
    expect(() => avaliarSessoes([{ dia: '2026-07-01', pessoas: -1 }], '2026-07-05')).toThrow();
  });

  it('a lista de excluídos é normalizada, sem repetição e com teto', () => {
    expect(loginsExcluidos([' painel01 ', 'PAINEL01', '', 'Backup'])).toEqual(['BACKUP', 'PAINEL01']);
    expect(() => loginsExcluidos(Array.from({ length: 201 }, (_, i) => `C${i}`))).toThrow();
  });
});

describe('regra 2: inventário de desligamento', () => {
  const t = '2026-10-24T10:00:00.000Z';
  const item = (id: string) => INVENTARIO_DESLIGAMENTO.find((i) => i.id === id)!;

  it('sem registro, tudo pendente; o inventário não está resolvido', () => {
    const r = avaliarInventario([]);
    expect(r).toHaveLength(INVENTARIO_DESLIGAMENTO.length);
    expect(r.every((i) => i.situacao === 'pendente' && i.pendencias.includes('sem-registro'))).toBe(true);
    expect(inventarioResolvido(r)).toBe(false);
    expect(inventarioResolvido([])).toBe(false);
  });

  it('substituto em uso com contingência resolve; o último registro vale', () => {
    const regs = [
      { item: 'paineis-tv', situacao: 'aceito-como-perdido', contingencia: 'nenhuma', registradoEm: t },
      {
        item: 'paineis-tv',
        situacao: 'substituto-em-uso',
        contingencia: 'reinstalavel-no-periodo',
        registradoEm: '2026-10-25T10:00:00.000Z',
      },
    ] as const;
    expect(ultimoRegistroPorItem(regs).get('paineis-tv')?.situacao).toBe('substituto-em-uso');
    const a = avaliarItem(item('paineis-tv'), ultimoRegistroPorItem(regs).get('paineis-tv'));
    expect(a).toMatchObject({ resolvido: true, pendencias: [], contingencia: 'reinstalavel-no-periodo' });
  });

  it('substituto a confirmar só se resolve pelo aceite; sem substituto, "em uso" é pendência', () => {
    const emUso = { situacao: 'substituto-em-uso', contingencia: 'nenhuma', registradoEm: t } as const;
    expect(
      avaliarItem(item('servico-autorizador'), { item: 'servico-autorizador', ...emUso }).pendencias,
    ).toEqual(['substituto-a-confirmar']);
    expect(
      avaliarItem(item('servico-sac-movel'), { item: 'servico-sac-movel', ...emUso }).pendencias,
    ).toEqual(['sem-substituto-e-sem-aceite']);
    const aceito = avaliarItem(item('servico-sac-movel'), {
      item: 'servico-sac-movel',
      situacao: 'aceito-como-perdido',
      contingencia: 'nenhuma',
      registradoEm: t,
    });
    expect(aceito.resolvido).toBe(true);
    expect(aceito.substituto).toBeNull();
  });

  it('registro sem contingência é pendência; registro de item fora do inventário é ignorado', () => {
    const a = avaliarItem(item('envio-agendado-relatorios'), {
      item: 'envio-agendado-relatorios',
      situacao: 'aceito-como-perdido',
      contingencia: null,
      registradoEm: t,
    });
    expect(a.pendencias).toEqual(['sem-contingencia']);
    const so: ItemInventarioDesligamento[] = [item('paineis-tv')];
    const r = avaliarInventario(
      [
        { item: 'paineis-tv', situacao: 'substituto-em-uso', contingencia: 'nenhuma', registradoEm: t },
        { item: 'fora', situacao: 'substituto-em-uso', contingencia: 'nenhuma', registradoEm: t },
      ],
      so,
    );
    expect(r.map((x) => x.item)).toEqual(['paineis-tv']);
    expect(inventarioResolvido(r)).toBe(true);
  });
});

describe('regras 5 a 7: plataforma do banco', () => {
  it('versão maior do motor', () => {
    expect(versaoMaior('3.0.14')).toBe(3);
    expect(versaoMaior(' 5.0.1.1469 ')).toBe(5);
    expect(() => versaoMaior('LI-V3')).toThrow();
  });

  it('o parâmetro do charset casa com o catálogo; a entrada livre só em UTF8 dos dois lados', () => {
    expect(charsetEsperado('NONE')).toBe('CP1252');
    expect(charsetEsperado('win1252')).toBe('CP1252');
    expect(charsetEsperado('UTF8')).toBe('UTF8');
    expect(charsetEsperado('ISO8859_1')).toBeNull();
    expect(charsetConfere('NONE', 'CP1252')).toBe(true);
    expect(charsetConfere('NONE', 'UTF8')).toBe(false);
    expect(entradaUtf8Pode('UTF8', 'UTF8')).toBe(true);
    expect(entradaUtf8Pode('NONE', 'UTF8')).toBe(false);
    expect(entradaUtf8Pode('UTF8', 'CP1252')).toBe(false);
    expect(restricaoEntrada('UTF8', true)).toBe('livre');
    expect(restricaoEntrada('UTF8', false)).toBe('cp1252');
    expect(restricaoEntrada('CP1252', true)).toBe('cp1252');
  });

  it('funções externas: só as com biblioteca, marcadas contra a lista; pendentes só com alvo 4 ou mais', () => {
    const f = funcoesExternas([
      { nome: 'VLR_MED', modulo: 'vlr_med', dependentes: 1 },
      { nome: 'FN_INTEGRATOR_ITEM', modulo: null, dependentes: 4 },
      { nome: 'SUBSTR', modulo: 'ib_udf', dependentes: 45 },
      { nome: 'NOVA', modulo: 'outra', dependentes: 0 },
    ]);
    expect(f.map((x) => [x.nome, x.esperada])).toEqual([
      ['NOVA', false],
      ['SUBSTR', true],
      ['VLR_MED', true],
    ]);
    expect(funcoesExternasPendentes(f, {}, 3)).toEqual([]);
    expect(
      funcoesExternasPendentes(f, { SUBSTR: 'habilitada-por-configuracao', NOVA: 'pendente' }, 5),
    ).toEqual(['NOVA', 'VLR_MED']);
  });
});

describe('ordem dos passos (seções 2 e 12)', () => {
  const pronto: EstadoDesligamento = {
    fimDaCoexistencia: true,
    dp6Decidida: true,
    sessoesCumprido: true,
    inventarioResolvido: true,
    funcoesPendentes: [],
    parceirosAvisados: true,
    contratosHalAi: true,
    passos: {
      desligamento: { autorizado: false, executado: false, ensaioAprovado: true },
      firebird5: { autorizado: false, executado: false, ensaioAprovado: true },
      utf8: { autorizado: false, executado: false, ensaioAprovado: true },
    },
  };

  it('o padrão da DP-6 bloqueia os três, cada um com os seus motivos', () => {
    const r = avaliarPassos(ESTADO_PADRAO_DP6);
    expect(r.map((p) => p.situacao)).toEqual(['bloqueado', 'bloqueado', 'bloqueado']);
    expect(r[0]!.motivos).toEqual([
      'fim-da-coexistencia-nao-registrado',
      'dp6-sem-data',
      'sessoes-na-janela',
      'inventario-pendente',
      'ensaio-nao-aprovado',
    ]);
    expect(r[1]!.motivos).toEqual([
      'passo-anterior-pendente',
      'parceiros-nao-avisados',
      'sante-api-sem-contrato',
      'ensaio-nao-aprovado',
    ]);
  });

  it('com tudo pronto, só o primeiro pode ser autorizado; os outros esperam o anterior', () => {
    const r = avaliarPassos(pronto);
    expect(r.map((p) => [p.passo, p.fatia, p.situacao])).toEqual([
      ['desligamento', 'M58-F1', 'pronto-para-autorizar'],
      ['firebird5', 'M58-F2', 'bloqueado'],
      ['utf8', 'M58-F3', 'bloqueado'],
    ]);
  });

  it('autorizado, executado e as funções externas que bloqueiam o Firebird 5', () => {
    const e: EstadoDesligamento = {
      ...pronto,
      funcoesPendentes: ['VLR_MED'],
      passos: {
        ...pronto.passos,
        desligamento: { autorizado: true, executado: true, ensaioAprovado: true },
        utf8: { autorizado: true, executado: false, ensaioAprovado: true },
      },
    };
    const r = avaliarPassos(e);
    expect(r[0]!.situacao).toBe('executado');
    expect(r[1]).toMatchObject({ situacao: 'bloqueado', motivos: ['funcoes-externas-pendentes'] });
    const sem = avaliarPassos({ ...e, funcoesPendentes: [] });
    expect(sem[1]!.situacao).toBe('pronto-para-autorizar');
    const fb5 = avaliarPassos({
      ...e,
      funcoesPendentes: [],
      passos: { ...e.passos, firebird5: { autorizado: true, executado: true, ensaioAprovado: true } },
    });
    expect(fb5[2]!.situacao).toBe('autorizado');
  });
});
