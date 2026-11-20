import { esquemaRegistroRetrocompatibilidade, PASSOS_EVOLUCAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarCondicoesExtincao,
  avaliarPassosEvolucao,
  decisaoVigente,
  estadoEsperadoRetiradas,
  type FatosRetrocompatibilidade,
  medirInventarioRetrocompatibilidade,
  tamanhoDoPasso,
} from './retrocompatibilidade.js';

const PADRAO: FatosRetrocompatibilidade = {
  fimRegistradoEm: null,
  desligamentoExecutadoEm: null,
  dp6DecididaEm: null,
  contingenciaLigada: true,
};
const CUMPRIDAS: FatosRetrocompatibilidade = {
  fimRegistradoEm: '2027-01-10',
  desligamentoExecutadoEm: '2027-02-01',
  dp6DecididaEm: '2027-01-15',
  contingenciaLigada: false,
};
const extinta = {
  situacao: 'extinta',
  data: '2027-03-01',
  referencia: 'ESTADO.md Autorizações',
  adr: '0033',
  papel: 'dono-do-projeto',
} as const;
const ref = { data: '2027-03-11', referencia: 'ESTADO.md Autorizações' } as const;
const aprovado = { data: '2027-03-10', relatorio: 'relatório da regressão', resultado: 'aprovado' } as const;
const reg = (x: object = {}) =>
  esquemaRegistroRetrocompatibilidade.parse({ formato: 1, estabelecimento: 'pc', ...x });

describe('M59-F6: condições e decisão', () => {
  it('no padrão da DP-6 nenhuma condição está cumprida', () => {
    const c = avaliarCondicoesExtincao(PADRAO);
    expect(c.map((x) => x.cumprida)).toEqual([false, false, false, false]);
    expect(c.every((x) => x.fonte.length > 0)).toBe(true);
  });

  it('com tudo registrado e a contingência desligada, as quatro se cumprem com as datas', () => {
    const c = avaliarCondicoesExtincao(CUMPRIDAS);
    expect(c.every((x) => x.cumprida)).toBe(true);
    expect(c.find((x) => x.condicao === 'outro-sistema-desligado')?.em).toBe('2027-02-01');
    expect(c.find((x) => x.condicao === 'contingencia-encerrada')?.em).toBeNull();
  });

  it('pendente e mantida valem mantida; extinta sem as condições vale mantida com o que falta (falha fechada)', () => {
    const c0 = avaliarCondicoesExtincao(PADRAO);
    expect(decisaoVigente(reg(), c0)).toEqual({ vigente: 'mantida', extincaoSemCondicoes: [] });
    expect(decisaoVigente(reg({ decisao: extinta }), c0).vigente).toBe('mantida');
    expect(decisaoVigente(reg({ decisao: extinta }), c0).extincaoSemCondicoes).toHaveLength(4);
    const parcial = avaliarCondicoesExtincao({ ...CUMPRIDAS, contingenciaLigada: true });
    expect(decisaoVigente(reg({ decisao: extinta }), parcial)).toEqual({
      vigente: 'mantida',
      extincaoSemCondicoes: ['contingencia-encerrada'],
    });
    expect(decisaoVigente(reg({ decisao: extinta }), avaliarCondicoesExtincao(CUMPRIDAS)).vigente).toBe(
      'extinta',
    );
  });

  it('retiradas: especificadas só com a retrocompatibilidade mantida com contingência longa', () => {
    expect(estadoEsperadoRetiradas(reg()).map((x) => x.estadoEsperado)).toEqual(['verde', 'verde', 'verde']);
    const longa = reg({
      decisao: { situacao: 'mantida', data: '2026-11-01', referencia: 'ata', contingenciaLonga: true },
    });
    expect(estadoEsperadoRetiradas(longa).every((x) => x.estadoEsperado === 'especificada')).toBe(true);
    const curta = reg({ decisao: { situacao: 'mantida', data: '2026-11-01', referencia: 'ata' } });
    expect(estadoEsperadoRetiradas(curta).every((x) => x.estadoEsperado === 'verde')).toBe(true);
  });

  it('retiradas: compara com o estado do catálogo de operações (sem leitura também diverge)', () => {
    const longa = reg({
      decisao: { situacao: 'mantida', data: '2026-11-01', referencia: 'ata', contingenciaLonga: true },
    });
    // contingência longa espera "especificada": o catálogo ainda em verde diverge; bloqueada cumpre (não grava)
    const r = estadoEsperadoRetiradas(longa, (o) =>
      o === 'acesso.retirarSenhaLegado'
        ? 'verde'
        : o === 'acesso.retirarSenhaSecundaria'
          ? 'bloqueada'
          : 'especificada',
    );
    expect(r.map((x) => [x.estadoAtual, x.divergente])).toEqual([
      ['verde', true],
      ['bloqueada', false],
      ['especificada', false],
    ]);
    // sem contingência longa espera "verde": verde ou além cumpre; especificada e referencia divergem
    const v = estadoEsperadoRetiradas(reg(), (o) =>
      o === 'acesso.retirarSenhaLegado'
        ? 'liberada'
        : o === 'acesso.retirarSenhaSecundaria'
          ? 'referencia'
          : 'verde',
    );
    expect(v.map((x) => x.divergente)).toEqual([false, true, false]);
    // sem a fonte, a operação ausente ou a fonte com erro: sem leitura e divergente (falha fechada)
    expect(estadoEsperadoRetiradas(reg()).every((x) => x.estadoAtual === null && x.divergente)).toBe(true);
    expect(
      estadoEsperadoRetiradas(reg(), () => {
        throw new Error('ilegível');
      }).every((x) => x.estadoAtual === null && x.divergente),
    ).toBe(true);
  });
});

describe('M59-F6: passos do plano de evolução', () => {
  it('mantida: todos bloqueados pela retrocompatibilidade; o primeiro com a ficha não pede a Hal-AI', () => {
    const p = avaliarPassosEvolucao(
      reg({ passos: { 'imutabilidade-por-linha': { ficha: 'docs/adr/x.md' } } }),
      'mantida',
      null,
    );
    expect(p.map((x) => x.passo)).toEqual([...PASSOS_EVOLUCAO]);
    expect(p.every((x) => x.situacao === 'bloqueado')).toBe(true);
    expect(p[0]?.motivos).toEqual(['retrocompatibilidade-nao-extinta', 'regressao-nao-aprovada']);
    expect(p[1]?.motivos).toEqual([
      'retrocompatibilidade-nao-extinta',
      'passo-anterior-pendente',
      'sem-ficha',
      'sem-combinado-hal-ai',
      'regressao-nao-aprovada',
    ]);
    expect(p[0]?.tamanho).toBeNull();
  });

  it('extinta: o primeiro fica pronto para autorizar, depois autorizado, depois executado; o segundo destrava', () => {
    const ficha = 'docs/adr/x.md';
    const pronto = avaliarPassosEvolucao(
      reg({ decisao: extinta, passos: { 'imutabilidade-por-linha': { ficha, regressao: aprovado } } }),
      'extinta',
      null,
    );
    expect(pronto[0]?.situacao).toBe('pronto-para-autorizar');
    const autorizado = avaliarPassosEvolucao(
      reg({
        decisao: extinta,
        passos: { 'imutabilidade-por-linha': { ficha, regressao: aprovado, autorizacao: ref } },
      }),
      'extinta',
      null,
    );
    expect(autorizado[0]?.situacao).toBe('autorizado');
    const segundo = avaliarPassosEvolucao(
      reg({
        decisao: extinta,
        passos: {
          'imutabilidade-por-linha': { ficha, regressao: aprovado, autorizacao: ref, execucao: ref },
          'regras-dos-gatilhos': { ficha, regressao: aprovado, combinadoHalAi: ref },
        },
      }),
      'extinta',
      null,
    );
    expect(segundo[0]?.situacao).toBe('executado');
    expect(segundo[1]?.situacao).toBe('pronto-para-autorizar');
    expect(segundo[2]?.motivos).toContain('passo-anterior-pendente');
  });

  it('extinta registrada que não vale (vigente mantida) segura os passos', () => {
    const p = avaliarPassosEvolucao(
      reg({
        decisao: extinta,
        passos: { 'imutabilidade-por-linha': { ficha: 'docs/adr/x.md', regressao: aprovado } },
      }),
      'mantida',
      null,
    );
    expect(p[0]?.motivos).toEqual(['retrocompatibilidade-nao-extinta']);
  });
});

describe('M59-F6: inventário pelo catálogo', () => {
  const catalogo = {
    tabelas: ['TBPAC', 'TBATEND', 'PRCONTEVOL', 'SGH_TRILHA', 'TBVAZIA'],
    colunas: [
      { tabela: 'TBPAC', coluna: 'ATIVO', classe: 'letra' as const },
      { tabela: 'TBPAC', coluna: 'SEXO', classe: 'letra' as const },
      { tabela: 'TBATEND', coluna: 'URGENTE', classe: 'letra' as const },
      { tabela: 'SGH_TRILHA', coluna: 'X', classe: 'letra' as const },
      { tabela: 'TBATEND', coluna: 'DATA', classe: 'data' as const },
      { tabela: 'TBATEND', coluna: 'HORA', classe: 'hora' as const },
      { tabela: 'TBATEND', coluna: 'DATAALTA', classe: 'data' as const },
      { tabela: 'TBPAC', coluna: 'NASC', classe: 'data' as const },
    ],
    gatilhos: [
      { nome: 'TRG_TBPAC_BI', tabela: 'TBPAC', ativo: true },
      { nome: 'TRG_TBPAC_AU', tabela: 'TBPAC', ativo: false },
      { nome: 'TRG_TBATEND_BI', tabela: 'TBATEND', ativo: true },
      { nome: 'SGH_TRILHA_BI', tabela: 'SGH_TRILHA', ativo: true },
    ],
    chaves: [
      { restricao: 'FK1', tabela: 'TBATEND', texto: false },
      { restricao: 'FK2', tabela: 'TBATEND', texto: false },
      { restricao: 'FK2', tabela: 'TBATEND', texto: true },
      { restricao: 'FK3', tabela: 'PRCONTEVOL', texto: true },
      { restricao: 'FK9', tabela: 'SGH_TRILHA', texto: true },
    ],
  };

  it('conta só as tabelas do outro sistema (as SGH_ ficam fora) e agrega por restrição e por tabela', () => {
    const inv = medirInventarioRetrocompatibilidade(catalogo, ['PRCONTEVOL', 'TBNAOEXISTE']);
    expect(inv).toEqual({
      tabelas: 4,
      gatilhos: { total: 3, ativos: 2, tabelas: 2 },
      colunasDeUmaLetra: { colunas: 3, tabelas: 2 },
      paresDataHora: { pares: 1, tabelas: 1 },
      chavesEmTexto: { chaves: 2, deTotal: 3, tabelas: 2 },
      tabelasClinicas: { matriz: 2, presentes: 1 },
      gatilhosSghEmTabelaLegada: 0,
    });
    expect(tamanhoDoPasso('gatilhos', inv)).toBe(2);
    expect(tamanhoDoPasso('tabelas-clinicas', inv)).toBe(1);
    expect(tamanhoDoPasso('colunas-de-uma-letra', inv)).toBe(3);
    expect(tamanhoDoPasso('pares-data-hora', inv)).toBe(1);
    expect(tamanhoDoPasso('chaves-em-texto', inv)).toBe(2);
    expect(tamanhoDoPasso('gatilhos', null)).toBeNull();
  });

  it('um gatilho SGH_ em tabela do outro sistema aparece (tem de ser 0 enquanto durar a retrocompatibilidade)', () => {
    const inv = medirInventarioRetrocompatibilidade(
      {
        ...catalogo,
        gatilhos: [...catalogo.gatilhos, { nome: 'SGH_IMUT_TBPAC', tabela: 'tbpac', ativo: true }],
      },
      [],
    );
    expect(inv.gatilhosSghEmTabelaLegada).toBe(1);
    expect(inv.gatilhos.tabelas).toBe(2);
  });
});
