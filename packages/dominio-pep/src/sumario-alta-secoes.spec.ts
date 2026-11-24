import type { SumarioAltaEstruturado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  type ComponenteSumario,
  janelaDaSecao,
  pendenciasDasSecoes,
  resolverSecoesSumario,
  SECOES_PADRAO,
  validarComponenteSumario,
  validarPeriodoConsulta,
} from './sumario-alta-secoes.js';

const comp = (x: Partial<ComponenteSumario>): ComponenteSumario => ({
  estabelecimento: null,
  codigo: 'diag',
  descricao: 'Diagnósticos',
  tipoConteudo: 'diagnosticos',
  tipoAtendimento: 'todos',
  ordem: 10,
  obrigatorio: false,
  periodo: null,
  ativo: true,
  ...x,
});

const sumario = (x: Partial<SumarioAltaEstruturado> = {}): SumarioAltaEstruturado => ({
  diagnosticos: [],
  procedimentos: [],
  medicamentosAlta: [],
  alergias: [],
  encaminhamentos: [],
  ...x,
});

describe('seções configuráveis do sumário de alta (03-PEP L124)', () => {
  it('sem configuração, vale o conjunto padrão', () => {
    expect(resolverSecoesSumario([], 1, 'internacao')).toEqual(SECOES_PADRAO);
    expect(resolverSecoesSumario([comp({ estabelecimento: 9 })], 1, 'internacao')).toEqual(SECOES_PADRAO);
  });

  it('a linha do estabelecimento e do tipo ganha da do cliente e de "todos"; ordem pela ordem', () => {
    const r = resolverSecoesSumario(
      [
        comp({ codigo: 'diag', descricao: 'Cliente', ordem: 5 }),
        comp({ codigo: 'diag', descricao: 'Do hospital', estabelecimento: 1, ordem: 30, obrigatorio: true }),
        comp({
          codigo: 'diag',
          descricao: 'Do PA',
          estabelecimento: 1,
          tipoAtendimento: 'pronto_atendimento',
        }),
        comp({ codigo: 'orient', descricao: 'Orientações', tipoConteudo: 'orientacoes', ordem: 20 }),
      ],
      1,
      'internacao',
    );
    expect(r.map((x) => [x.codigo, x.descricao, x.origem])).toEqual([
      ['orient', 'Orientações', 'cliente'],
      ['diag', 'Do hospital', 'estabelecimento'],
    ]);
    expect(r[1]!.obrigatorio).toBe(true);
  });

  it('o estabelecimento tira uma seção do cliente com a linha inativa', () => {
    const r = resolverSecoesSumario(
      [comp({ codigo: 'diag' }), comp({ codigo: 'diag', estabelecimento: 1, ativo: false })],
      1,
      'todos',
    );
    expect(r).toEqual([]);
  });

  it('pendências: só as obrigatórias sem conteúdo, texto livre pelo código', () => {
    const secoes = resolverSecoesSumario(
      [
        comp({ codigo: 'diag', obrigatorio: true, ordem: 1 }),
        comp({
          codigo: 'orient',
          tipoConteudo: 'orientacoes',
          obrigatorio: true,
          descricao: 'Orientações',
          ordem: 2,
        }),
        comp({ codigo: 'dispo', tipoConteudo: 'dispositivos', obrigatorio: false, ordem: 3 }),
        comp({
          codigo: 'plano',
          tipoConteudo: 'plano_terapeutico',
          obrigatorio: true,
          descricao: 'Plano terapêutico',
          ordem: 4,
        }),
      ],
      1,
      'internacao',
    );
    const vazio = pendenciasDasSecoes(secoes, sumario());
    expect(vazio.map((p) => p.campo)).toEqual(['diagnosticos', 'secao.orient', 'plano']);
    const cheio = sumario({
      diagnosticos: [{ descricao: 'x' }],
      encaminhamentos: ['Ambulatório'],
      secoes: [{ codigo: 'orient', texto: 'Repouso relativo' }],
    });
    expect(pendenciasDasSecoes(secoes, cheio)).toEqual([]);
    expect(
      pendenciasDasSecoes(secoes, { ...cheio, secoes: [{ codigo: 'orient', texto: '   ' }] }).map(
        (p) => p.motivo,
      ),
    ).toEqual(['Preencha a seção "Orientações".']);
  });

  it('validação do cadastro na hora', () => {
    const base = { ...comp({}), ativo: undefined } as unknown as Omit<ComponenteSumario, 'ativo'>;
    expect(validarComponenteSumario(base)).toEqual([]);
    expect(
      validarComponenteSumario({ ...base, codigo: 'Com Espaço', descricao: ' ', ordem: -1 }).map(
        (e) => e.codigo,
      ),
    ).toEqual(['codigo-invalido', 'descricao-vazia', 'ordem-invalida']);
    expect(
      validarComponenteSumario({ ...base, tipoConteudo: 'condicao_alta', periodo: 'ultimas_24_horas' })[0]
        ?.codigo,
    ).toBe('periodo-sem-dados');
    expect(
      validarPeriodoConsulta({
        codigo: 'h12',
        descricao: '12 h',
        atendimentoInteiro: false,
        horasRetroativas: null,
      })[0]?.codigo,
    ).toBe('horas-invalidas');
    expect(
      validarPeriodoConsulta({
        codigo: 'h12',
        descricao: '12 h',
        atendimentoInteiro: false,
        horasRetroativas: 12,
      }),
    ).toEqual([]);
  });

  it('janela de tempo: recorte em horas sem passar da abertura', () => {
    const abertura = new Date('2026-11-20T10:00:00Z');
    const alta = new Date('2026-11-22T10:00:00Z');
    expect(janelaDaSecao('ultimas_24_horas', abertura, alta).desde.toISOString()).toBe(
      '2026-11-21T10:00:00.000Z',
    );
    expect(janelaDaSecao('ultimas_72_horas', abertura, alta).desde).toEqual(abertura);
    expect(janelaDaSecao('ultimo_registro', abertura, alta)).toEqual({
      desde: abertura,
      ate: alta,
      ultimo: true,
    });
    expect(janelaDaSecao(null, abertura, alta, 6).desde.toISOString()).toBe('2026-11-22T04:00:00.000Z');
  });
});
