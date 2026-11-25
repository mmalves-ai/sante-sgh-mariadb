import { describe, expect, it } from 'vitest';
import {
  barrasDoIndicadorInicio,
  type BlocoInicioEntrada,
  blocosVisiveisInicio,
  conferirBlocosInicio,
  conferirPerfisInicio,
  conferirPublicacaoInicio,
  enderecoAtalhoValido,
  escolherModeloInicio,
  MAXIMO_BLOCOS_INICIO,
  podeTransitarModeloInicio,
} from './pagina-inicial.js';

const base: BlocoInicioEntrada = {
  tipo: 'texto',
  catalogo: null,
  indicadorId: null,
  titulo: null,
  endereco: null,
  texto: 'Bem-vindo',
  largura: 1,
};
const catalogo = new Set(['medico', 'recepcao']);
const codigos = (b: BlocoInicioEntrada[]) => conferirBlocosInicio(b, catalogo).map((e) => e.codigo);

describe('Página inicial montada: blocos', () => {
  it('aceita os quatro tipos bem preenchidos', () => {
    expect(
      codigos([
        { ...base, tipo: 'lista_trabalho', catalogo: 'medico', texto: null },
        { ...base, tipo: 'indicador', indicadorId: 7, texto: null, largura: 2 },
        { ...base, tipo: 'link', titulo: 'Agenda', endereco: '/agenda', texto: null },
        { ...base, tipo: 'link', titulo: 'Diretrizes', endereco: 'https://exemplo.org/a', texto: null },
        base,
      ]),
    ).toEqual([]);
  });

  it('recusa lista fora do catálogo, lista e indicador repetidos', () => {
    expect(
      codigos([
        { ...base, tipo: 'lista_trabalho', catalogo: 'outra', texto: null },
        { ...base, tipo: 'lista_trabalho', catalogo: 'medico', texto: null },
        { ...base, tipo: 'lista_trabalho', catalogo: 'medico', texto: null },
        { ...base, tipo: 'indicador', indicadorId: 3, texto: null },
        { ...base, tipo: 'indicador', indicadorId: 3, texto: null },
        { ...base, tipo: 'indicador', indicadorId: null, texto: null },
      ]),
    ).toEqual(['lista-desconhecida', 'lista-repetida', 'indicador-repetido', 'indicador-ausente']);
  });

  it('recusa atalho sem título, endereço de outro esquema, texto vazio e largura fora da grade', () => {
    expect(
      codigos([
        { ...base, tipo: 'link', endereco: 'javascript:alert(1)', texto: null },
        { ...base, tipo: 'link', titulo: 'x', endereco: '//outro.site', texto: null },
        { ...base, texto: '   ' },
        { ...base, largura: 4 },
      ]),
    ).toEqual([
      'endereco-invalido',
      'titulo-ausente',
      'endereco-invalido',
      'texto-ausente',
      'largura-invalida',
    ]);
    expect(enderecoAtalhoValido('http://inseguro.org')).toBe(false);
    expect(enderecoAtalhoValido('/relatorios/indicadores?x=1')).toBe(true);
  });

  it('recusa página com blocos demais', () => {
    const muitos = Array.from({ length: MAXIMO_BLOCOS_INICIO + 1 }, () => base);
    expect(codigos(muitos)).toEqual(['blocos-demais']);
  });
});

describe('Página inicial montada: perfis, publicação e ciclo', () => {
  it('perfil repetido e prioridade fora da faixa', () => {
    expect(
      conferirPerfisInicio([
        { perfilId: 1, prioridade: 1 },
        { perfilId: 1, prioridade: 2 },
        { perfilId: 2, prioridade: 0 },
      ]).map((e) => e.codigo),
    ).toEqual(['perfil-repetido', 'prioridade-invalida']);
  });

  it('publicar exige bloco e perfil', () => {
    expect(conferirPublicacaoInicio(0, 0).map((e) => e.codigo)).toEqual(['sem-blocos', 'sem-perfis']);
    expect(conferirPublicacaoInicio(1, 1)).toEqual([]);
  });

  it('ciclo: rascunho, publicado, inativo; nada volta ao mesmo estado', () => {
    expect(podeTransitarModeloInicio('rascunho', 'publicado')).toBe(true);
    expect(podeTransitarModeloInicio('publicado', 'inativo')).toBe(true);
    expect(podeTransitarModeloInicio('inativo', 'publicado')).toBe(true);
    expect(podeTransitarModeloInicio('publicado', 'publicado')).toBe(false);
  });
});

describe('Página inicial montada: escolha e montagem', () => {
  it('menor prioridade vence; no empate, o do estabelecimento; rascunho e outro estabelecimento não contam', () => {
    expect(
      escolherModeloInicio(
        [
          { modeloId: 1, situacao: 'publicado', estabelecimentoId: null, prioridade: 2 },
          { modeloId: 2, situacao: 'publicado', estabelecimentoId: 10, prioridade: 2 },
          { modeloId: 3, situacao: 'rascunho', estabelecimentoId: 10, prioridade: 1 },
          { modeloId: 4, situacao: 'publicado', estabelecimentoId: 11, prioridade: 1 },
        ],
        10,
      ),
    ).toBe(2);
    expect(
      escolherModeloInicio(
        [{ modeloId: 1, situacao: 'inativo', estabelecimentoId: null, prioridade: 1 }],
        10,
      ),
    ).toBeNull();
  });

  it('a lista de trabalho não liberada sai; os outros blocos ficam', () => {
    const blocos = [
      { tipo: 'lista_trabalho' as const, catalogo: 'medico' },
      { tipo: 'lista_trabalho' as const, catalogo: 'recepcao' },
      { tipo: 'texto' as const, catalogo: null },
    ];
    expect(blocosVisiveisInicio(blocos, new Set(['recepcao'])).map((b) => b.catalogo)).toEqual([
      'recepcao',
      null,
    ]);
  });

  it('barras do gráfico relativas ao maior valor ou meta', () => {
    expect(
      barrasDoIndicadorInicio([
        { competencia: '2026-09-01', valor: 50, meta: 100 },
        { competencia: '2026-10-01', valor: 100, meta: 100 },
        { competencia: '2026-11-01', valor: null, meta: 100 },
      ]).map((b) => b.altura),
    ).toEqual([50, 100, 0]);
    expect(barrasDoIndicadorInicio([])).toEqual([]);
  });
});
