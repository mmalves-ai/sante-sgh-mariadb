// Publicador das cargas de catálogo (M13) sobre uma porta falsa: janela, lote seguinte ao último confirmado,
// retomada, parada entre lotes, recusa que deixa a carga "falhou" com o motivo e a marca da sessão "como".
import { JANELA_PADRAO } from '@sgh/dominio-catalogo';
import { ErroOperacao, marcaComoAtual } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  type CargaAPublicar,
  cicloPublicacao,
  type DependenciasPublicador,
  itemDaLinha,
  type LinhaDoLote,
  type PortaPublicacaoCatalogo,
  publicarCarga,
} from './publicador.js';

function carga(publicados: number, total = 3, situacao = 'aprovada'): CargaAPublicar {
  return {
    id: 7,
    catalogo: 'cbo',
    situacao,
    edicao: null,
    sha256: 'ab'.repeat(32),
    lotes: { total, publicados },
    versao: 1,
    aprovadorId: 2,
    aprovador: 'sint.b',
    como: null,
  };
}

type AoPublicar = (p: PortaFalsa, lote: number) => Promise<void>;

class PortaFalsa implements PortaPublicacaoCatalogo {
  falhas: string[] = [];
  lotes: number[] = [];
  constructor(
    public atual: CargaAPublicar,
    private readonly aoPublicar: AoPublicar = async (p, lote) => {
      p.atual = { ...p.atual, lotes: { ...p.atual.lotes, publicados: lote } };
    },
  ) {}
  async cargasAPublicar() {
    return [this.atual];
  }
  async carga() {
    return this.atual;
  }
  async itensDoLote(): Promise<LinhaDoLote[]> {
    return [
      {
        entidade: 'cbo',
        chave: 'codigo=999998',
        comparacao: 'novo',
        antes: null,
        depois: { codigo: '999998', nome: 'X' },
      },
    ];
  }
  async publicarLote(_c: CargaAPublicar, e: { lote: number }) {
    this.lotes.push(e.lote);
    await this.aoPublicar(this, e.lote);
  }
  async marcarFalha(_c: CargaAPublicar, motivo: string) {
    this.falhas.push(motivo);
  }
}

const deps = (porta: PortaPublicacaoCatalogo, agora = 23 * 60): DependenciasPublicador => ({
  porta,
  janela: JANELA_PADRAO,
  agoraMinutos: () => agora,
  ignorarJanela: false,
  lotesPorCiclo: 2,
});

describe('publicador de catálogos', () => {
  it('fora da janela não publica', async () => {
    const p = new PortaFalsa(carga(0));
    expect(await publicarCarga(deps(p, 12 * 60), carga(0))).toMatchObject({ situacao: 'aguardando-janela' });
    expect(p.lotes).toEqual([]);
  });

  it('catálogo desconhecido: parada', async () => {
    const p = new PortaFalsa(carga(0));
    expect(await publicarCarga(deps(p), { ...carga(0), catalogo: 'naoexiste' })).toMatchObject({
      situacao: 'parada',
    });
  });

  it('publica o lote seguinte ao último confirmado, até o fim', async () => {
    const p = new PortaFalsa(carga(1));
    const r = await publicarCarga(deps(p), carga(1));
    expect(p.lotes).toEqual([2, 3]);
    expect(r).toMatchObject({ situacao: 'publicada', lotes: 2 });
  });

  it('para no teto de lotes por ciclo e retoma no ciclo seguinte', async () => {
    const p = new PortaFalsa(carga(0, 5));
    const [r] = await cicloPublicacao(deps(p));
    expect(r).toMatchObject({ situacao: 'publicando', lotes: 2 });
    const [r2] = await cicloPublicacao(deps(p));
    expect(r2).toMatchObject({ situacao: 'publicando', lotes: 2 });
    expect(p.lotes).toEqual([1, 2, 3, 4]);
  });

  it('cancelada entre lotes: para', async () => {
    const p = new PortaFalsa(carga(0), async (x) => {
      x.atual = carga(1, 3, 'cancelada');
    });
    expect(await publicarCarga(deps(p), carga(0))).toMatchObject({ situacao: 'parada', lotes: 1 });
  });

  it('lote recusado: a carga fica "falhou" com o motivo', async () => {
    const p = new PortaFalsa(carga(0), async () => {
      throw new ErroOperacao(409, 'sem-contrato', 'Operação recusada', 'sem contrato vigente');
    });
    const r = await publicarCarga(deps(p), carga(0));
    expect(r.situacao).toBe('falhou');
    expect(r.motivo).toContain('sem-contrato');
    expect(p.falhas).toEqual([expect.stringContaining('Lote 1')]);
  });

  it('falha inesperada: motivo genérico, retomável', async () => {
    const p = new PortaFalsa(carga(0), async () => {
      throw new Error('rede');
    });
    const r = await publicarCarga(deps(p), carga(0));
    expect(r.motivo).toContain('retoma');
    expect(r.motivo).not.toContain('rede');
  });

  it('a falha não é marcada quando a carga já saiu de publicação', async () => {
    const p = new PortaFalsa(carga(0), async (x) => {
      x.atual = carga(0, 3, 'cancelada');
      throw new Error('x');
    });
    await publicarCarga(deps(p), carga(0));
    expect(p.falhas).toEqual([]);
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
    ).toMatchObject({ acao: 'incluir', valores: {} });
  });

  it('carga aprovada numa sessão "como": cada lote e a falha rodam marcados (alvo: o aprovador)', async () => {
    const como = { sessao: '81', acao: '82', atorTipo: 'suporte' as const, idConta: '83' };
    const c = { ...carga(0, 2), como };
    const vistas: unknown[] = [];
    const p = new PortaFalsa(c, async (x, lote) => {
      vistas.push(marcaComoAtual());
      if (vistas.length === 2) throw new ErroOperacao(409, 'teste', 'Operação recusada', 'recusa de teste');
      x.atual = { ...c, lotes: { ...c.lotes, publicados: lote } };
    });
    const r = await publicarCarga(deps(p), c);
    expect(r.situacao).toBe('falhou');
    expect(vistas).toEqual([
      { ...como, alvo: 'sint.b' },
      { ...como, alvo: 'sint.b' },
    ]);
    // Fora do "como", nada marcado.
    const p2 = new PortaFalsa(carga(0, 1), async () => {
      vistas.push(marcaComoAtual());
    });
    await publicarCarga(deps(p2), carga(0, 1));
    expect(vistas.at(-1)).toBeNull();
  });
});
