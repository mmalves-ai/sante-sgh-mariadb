import { describe, expect, it } from 'vitest';
import {
  estornosDosFatos,
  FatoInvalido,
  fatoParaPublicar,
  reaisDoFato,
  ultimoDiaDaCompetencia,
  type FatoParaPublicar,
} from './publicacao.js';

const base: FatoParaPublicar = {
  tipo: 'depreciacao',
  entidade: 'cota_depreciacao',
  entidadeId: 7,
  data: '2026-06-30',
  valorCentavos: 12_345,
  centroCusto: 3,
  documento: 'depreciação 2026-06 bem PC000001',
  campos: { grupoBem: 'maquinas', bem: 11 },
};

describe('publicação do fato pelo módulo', () => {
  it('monta a linha com competência, valor decimal e forma canônica estável', () => {
    const l = fatoParaPublicar(base)!;
    expect(l).toMatchObject({
      tipo: 'depreciacao',
      rotuloTipo: 'Depreciação do mês',
      competencia: '2026-06-01',
      valor: '123.45',
      centroCusto: 3,
    });
    const mesmo = fatoParaPublicar({ ...base, campos: { bem: 11, grupoBem: 'maquinas' } })!;
    expect(mesmo.conteudo).toBe(l.conteudo);
    expect(fatoParaPublicar({ ...base, valorCentavos: 12_346 })!.conteudo).not.toBe(l.conteudo);
  });

  it('valor zero não tem efeito contábil: nenhum fato', () => {
    expect(fatoParaPublicar({ ...base, valorCentavos: 0 })).toBeNull();
  });

  it('recusa tipo fora do catálogo, data inválida, valor negativo ou fracionado, centro e entidade inválidos', () => {
    const codigo = (f: Partial<FatoParaPublicar>) => {
      try {
        fatoParaPublicar({ ...base, ...f } as FatoParaPublicar);
        return 'ok';
      } catch (e) {
        return e instanceof FatoInvalido ? e.codigo : 'outro';
      }
    };
    expect(codigo({ tipo: 'inexistente' as never })).toBe('tipo-fato');
    expect(codigo({ data: '2026-02-30' })).toBe('data-fato');
    expect(codigo({ valorCentavos: -1 })).toBe('valor-fato');
    expect(codigo({ valorCentavos: 1.5 })).toBe('valor-fato');
    expect(codigo({ centroCusto: 0 })).toBe('centro-fato');
    expect(codigo({ entidade: 'Tabela Errada' })).toBe('entidade-fato');
    expect(codigo({ entidadeId: 0 })).toBe('entidade-fato');
  });

  it('documento cortado no tamanho da coluna', () => {
    expect(fatoParaPublicar({ ...base, documento: 'x'.repeat(200) })!.documento).toHaveLength(60);
  });

  it('estorno: só do fato original ainda não estornado, na data do estorno, com o mesmo valor e o motivo', () => {
    const lidos = [
      {
        id: 1,
        tipo: 'depreciacao',
        data: '2026-06-30',
        valor: '10.00',
        centroCusto: 3,
        campos: { bem: 1 },
        estorno: false,
        estornado: false,
      },
      {
        id: 2,
        tipo: 'depreciacao',
        data: '2026-06-30',
        valor: '5.00',
        centroCusto: null,
        campos: {},
        estorno: false,
        estornado: true,
      },
      {
        id: 3,
        tipo: 'depreciacao',
        data: '2026-07-02',
        valor: '9.00',
        centroCusto: 3,
        campos: {},
        estorno: true,
        estornado: false,
      },
    ];
    const e = estornosDosFatos(lidos, '2026-07-15', 'Cálculo de teste');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      fatoId: 1,
      data: '2026-07-15',
      competencia: '2026-07-01',
      valor: '10.00',
      centroCusto: 3,
      documento: 'estorno fato 1: Cálculo de teste',
    });
    expect(() => estornosDosFatos(lidos, '15/07/2026', 'x')).toThrow(FatoInvalido);
  });

  it('auxiliares: reais sem ponto flutuante e último dia da competência', () => {
    expect(reaisDoFato(5)).toBe('0.05');
    expect(reaisDoFato(100)).toBe('1.00');
    expect(reaisDoFato(123_456_789)).toBe('1234567.89');
    expect(ultimoDiaDaCompetencia('2024-02')).toBe('2024-02-29');
    expect(ultimoDiaDaCompetencia('2026-06')).toBe('2026-06-30');
    expect(() => ultimoDiaDaCompetencia('2026-13')).toThrow(FatoInvalido);
  });
});
