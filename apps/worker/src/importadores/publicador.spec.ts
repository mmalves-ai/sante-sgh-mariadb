// Publicador das cargas de catálogo (M13) com o legado simulado: janela, lote seguinte ao último confirmado,
// retomada, parada entre lotes e recusa que deixa a carga "falhou" com o motivo.
import { JANELA_PADRAO } from '@sgh/dominio-catalogo';
import { type CargaCatalogoLida, ErroOperacao, type Executor, marcaComoAtual } from '@sgh/legado';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({
  carga: null as unknown,
  mudancas: [] as { para: string; motivo: string | null }[],
}));

vi.mock('@sgh/legado', async (original) => {
  const m = await original<typeof import('@sgh/legado')>();
  return {
    ...m,
    lerCargaCatalogo: vi.fn(async () => estado.carga),
    cargasAPublicar: vi.fn(async () => [estado.carga]),
    itensDoLoteCatalogo: vi.fn(async () => [
      {
        entidade: 'cbo',
        chave: 'codigo=999998',
        comparacao: 'novo',
        antes: null,
        depois: { codigo: '999998', nome: 'X' },
      },
    ]),
    mudarSituacaoCargaCatalogo: vi.fn(async (_e: unknown, p: { para: string; motivo: string | null }) => {
      estado.mudancas.push({ para: p.para, motivo: p.motivo });
    }),
    operacao: vi.fn((codigo: string) => ({ codigo })),
  };
});

const { cicloPublicacao, itemDaLinha, publicarCarga } = await import('./publicador.js');

function carga(publicados: number, total = 3, situacao = 'aprovada'): CargaCatalogoLida {
  return {
    id: 7,
    hospital: 'pc',
    catalogo: 'cbo',
    arquivo: 'a.csv',
    sha256: 'ab'.repeat(32),
    bytes: 1,
    situacao,
    edicao: null,
    responsavel: 'SGH.A',
    aprovador: 'SGH.B',
    criadaEm: '',
    totais: { linhas: 1, validas: 1, erros: 0, novos: 1, removidos: 0, alterados: 0, iguais: 0 },
    motivo: null,
    versao: 1,
    lotes: { total, publicados, tamanho: 500 },
  } as unknown as CargaCatalogoLida;
}

function deps(executar: Executor['executar'], agora = 23 * 60) {
  return {
    rede: 'r',
    hospital: 'pc',
    executor: { executar } as unknown as Executor,
    ler: <T>(fn: (l: never) => Promise<T>) => fn(undefined as never),
    gravarSgh: <T>(fn: (e: never) => Promise<T>) => fn(undefined as never),
    janela: JANELA_PADRAO,
    agoraMinutos: () => agora,
    ignorarJanela: false,
    lotesPorCiclo: 2,
  };
}

describe('publicador de catálogos', () => {
  beforeEach(() => {
    estado.mudancas = [];
  });

  it('fora da janela não publica', async () => {
    const ex = vi.fn();
    estado.carga = carga(0);
    expect(await publicarCarga(deps(ex as never, 12 * 60), carga(0))).toMatchObject({
      situacao: 'aguardando-janela',
    });
    expect(ex).not.toHaveBeenCalled();
  });

  it('publica o lote seguinte ao último confirmado, até o teto do ciclo', async () => {
    const lotes: number[] = [];
    let c = carga(1);
    estado.carga = c;
    const ex = vi.fn(async (_op: unknown, _h: string, entrada: { lote: number }) => {
      lotes.push(entrada.lote);
      c = carga(entrada.lote);
      estado.carga = c;
    });
    const r = await publicarCarga(deps(ex as never), carga(1));
    expect(lotes).toEqual([2, 3]);
    expect(r).toMatchObject({ situacao: 'publicada', lotes: 2 });
  });

  it('para no teto de lotes por ciclo e retoma no ciclo seguinte', async () => {
    estado.carga = carga(0, 5);
    const ex = vi.fn(async (_op: unknown, _h: string, entrada: { lote: number }) => {
      estado.carga = carga(entrada.lote, 5);
    });
    const [r] = await cicloPublicacao(deps(ex as never));
    expect(r).toMatchObject({ situacao: 'publicando', lotes: 2 });
  });

  it('cancelada entre lotes: para', async () => {
    estado.carga = carga(0);
    const ex = vi.fn(async () => {
      estado.carga = carga(1, 3, 'cancelada');
    });
    expect(await publicarCarga(deps(ex as never), carga(0))).toMatchObject({ situacao: 'parada', lotes: 1 });
  });

  it('lote recusado: a carga fica "falhou" com o motivo', async () => {
    estado.carga = carga(0);
    const ex = vi.fn(async () => {
      throw new ErroOperacao(409, 'responsavel-externo', 'Operação recusada', 'carga externa');
    });
    const r = await publicarCarga(deps(ex as never), carga(0));
    expect(r.situacao).toBe('falhou');
    expect(r.motivo).toContain('responsavel-externo');
    expect(estado.mudancas).toEqual([{ para: 'falhou', motivo: expect.stringContaining('Lote 1') }]);
  });

  it('falha inesperada: motivo genérico, retomável', async () => {
    estado.carga = carga(0);
    const ex = vi.fn(async () => {
      throw new Error('rede');
    });
    const r = await publicarCarga(deps(ex as never), carga(0));
    expect(r.motivo).toContain('retoma');
  });

  it('item do lote a partir da linha', () => {
    expect(
      itemDaLinha({
        entidade: 'cbo',
        chave: 'codigo=1',
        comparacao: 'alterado',
        antes: { nome: 'A', x: 1 },
        depois: { nome: 'B' },
      }),
    ).toEqual({
      entidade: 'cbo',
      acao: 'alterar',
      chave: { codigo: '1' },
      valores: { nome: 'B' },
      antes: { nome: 'A' },
    });
    expect(
      itemDaLinha({ entidade: 'cbo', chave: 'codigo=1', comparacao: 'novo', antes: null, depois: null }),
    ).toMatchObject({
      acao: 'incluir',
      valores: {},
    });
  });

  it('carga aprovada numa sessão "como": cada lote e a falha rodam marcados (imagem e ORIGEM do ator real)', async () => {
    const como = { sessao: '81', acao: '82', atorTipo: 'suporte' as const, idConta: '83' };
    const c = { ...carga(0, 2), como } as CargaCatalogoLida;
    estado.carga = c;
    const vistas: unknown[] = [];
    const ex = vi.fn(async () => {
      vistas.push(marcaComoAtual());
      if (vistas.length === 2) throw new ErroOperacao(409, 'teste', 'Operação recusada', 'recusa de teste');
      estado.carga = { ...c, lotes: { ...c.lotes, publicados: 1 } };
      return {} as never;
    });
    const r = await publicarCarga(deps(ex as never), c);
    expect(r.situacao).toBe('falhou');
    expect(vistas).toEqual([
      { ...como, alvo: 'SGH.B' },
      { ...como, alvo: 'SGH.B' },
    ]);
    // Fora do "como", nada marcado.
    const semComo = carga(0, 1);
    estado.carga = semComo;
    const ex2 = vi.fn(async () => {
      vistas.push(marcaComoAtual());
      return {} as never;
    });
    await publicarCarga(deps(ex2 as never), semComo);
    expect(vistas.at(-1)).toBeNull();
  });
});
