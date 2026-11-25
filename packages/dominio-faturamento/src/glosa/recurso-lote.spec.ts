import { describe, expect, it } from 'vitest';
import {
  conferirItemDoRecurso,
  lotesDeRecurso,
  situacaoDaGlosaNoRecurso,
  situacaoDoRecurso,
  valorPadraoDoRecurso,
  type GlosaParaRecurso,
} from './recurso-lote.js';

const g = (x: Partial<GlosaParaRecurso> = {}): GlosaParaRecurso => ({
  decisao: 'recorrer',
  justificativa: 'Procedimento autorizado pela senha da guia',
  valorGlosado: 100,
  valorAceito: 0,
  emRecurso: false,
  prazo: '2026-12-31',
  ...x,
});

describe('lote de recurso de glosa (06-FAT linha 34)', () => {
  it('aceita a glosa decidida como recorrer, com justificativa, no prazo e no valor', () => {
    expect(conferirItemDoRecurso(g(), 100, '2026-11-24')).toBeNull();
    expect(conferirItemDoRecurso(g({ prazo: null }), 0.01, '2027-05-01')).toBeNull();
  });

  it('recusa sem a decisão de recorrer, com glosa aceita, sem justificativa, já recorrida ou fora do prazo', () => {
    expect(conferirItemDoRecurso(g({ decisao: 'pendente' }), 100, '2026-11-24')?.codigo).toBe(
      'sem-decisao-recorrer',
    );
    expect(conferirItemDoRecurso(g({ decisao: 'aceitar' }), 100, '2026-11-24')?.codigo).toBe('glosa-aceita');
    expect(conferirItemDoRecurso(g({ justificativa: '  ' }), 100, '2026-11-24')?.codigo).toBe(
      'sem-justificativa',
    );
    expect(conferirItemDoRecurso(g({ emRecurso: true }), 100, '2026-11-24')?.codigo).toBe('ja-recorrido');
    expect(conferirItemDoRecurso(g({ prazo: '2026-11-01' }), 100, '2026-11-24')?.codigo).toBe(
      'prazo-vencido',
    );
  });

  it('o valor pleiteado fica entre um centavo e o que não foi aceito', () => {
    expect(conferirItemDoRecurso(g(), 0, '2026-11-24')?.codigo).toBe('valor-invalido');
    expect(conferirItemDoRecurso(g({ valorAceito: 30 }), 70.01, '2026-11-24')?.codigo).toBe(
      'valor-acima-da-glosa',
    );
    expect(conferirItemDoRecurso(g({ valorAceito: 30 }), 70, '2026-11-24')).toBeNull();
    expect(valorPadraoDoRecurso({ valorGlosado: 100, valorAceito: 30 })).toBe(70);
  });

  it('reapresentação: o item com recurso retornado (negado ou em parte) volta num recurso novo, até o que não voltou', () => {
    const negado = g({ emRecurso: true, retornoAnterior: { valorAcatado: 0 } });
    expect(conferirItemDoRecurso(negado, 100, '2026-11-24')).toBeNull();
    const parcial = g({ emRecurso: true, valorAceito: 10, retornoAnterior: { valorAcatado: 30 } });
    expect(valorPadraoDoRecurso(parcial)).toBe(60);
    expect(conferirItemDoRecurso(parcial, 60, '2026-11-24')).toBeNull();
    expect(conferirItemDoRecurso(parcial, 60.01, '2026-11-24')?.codigo).toBe('valor-acima-da-glosa');
    // Tudo já voltou: nada a reapresentar.
    const tudo = g({ emRecurso: true, retornoAnterior: { valorAcatado: 100 } });
    expect(conferirItemDoRecurso(tudo, 0.01, '2026-11-24')?.codigo).toBe('nada-a-reapresentar');
    // Sem o retorno do recurso atual, continua recusado; o prazo (contado do retorno) e a decisão valem igual.
    expect(
      conferirItemDoRecurso(g({ emRecurso: true, retornoAnterior: null }), 1, '2026-11-24')?.codigo,
    ).toBe('ja-recorrido');
    expect(conferirItemDoRecurso({ ...negado, prazo: '2026-11-01' }, 1, '2026-11-24')?.codigo).toBe(
      'prazo-vencido',
    );
    expect(conferirItemDoRecurso({ ...negado, decisao: 'aceitar' }, 1, '2026-11-24')?.codigo).toBe(
      'glosa-aceita',
    );
  });

  it('reapresentação: um lote por fonte e por recurso anterior', () => {
    const l = lotesDeRecurso([
      { fontePagadora: 1, recursoAnterior: null, i: 'a' },
      { fontePagadora: 1, recursoAnterior: 7, i: 'b' },
      { fontePagadora: 1, i: 'c' },
      { fontePagadora: 1, recursoAnterior: 7, i: 'd' },
    ]);
    expect(l.map((x) => [x.fontePagadora, x.recursoAnterior, x.itens.map((y) => y.i)])).toEqual([
      [1, null, ['a', 'c']],
      [1, 7, ['b', 'd']],
    ]);
  });

  it('um lote por fonte pagadora, na ordem do pedido', () => {
    const l = lotesDeRecurso([
      { fontePagadora: 2, i: 1 },
      { fontePagadora: 1, i: 2 },
      { fontePagadora: 2, i: 3 },
    ]);
    expect(l.map((x) => [x.fontePagadora, x.itens.map((y) => y.i)])).toEqual([
      [2, [1, 3]],
      [1, [2]],
    ]);
  });

  it('situação do recurso pelos retornos: enviado até o último, depois acatado, parcial ou negado', () => {
    expect(
      situacaoDoRecurso([
        { valorRecursado: 50, valorAcatado: 50 },
        { valorRecursado: 50, valorAcatado: null },
      ]),
    ).toEqual({ situacao: 'enviado', valorAcatado: 50, completo: false });
    expect(situacaoDoRecurso([{ valorRecursado: 50, valorAcatado: 50 }]).situacao).toBe('acatado');
    expect(situacaoDoRecurso([{ valorRecursado: 50, valorAcatado: 20 }]).situacao).toBe('acatado_parcial');
    expect(situacaoDoRecurso([{ valorRecursado: 50, valorAcatado: 0 }]).situacao).toBe('negado');
  });

  it('situação da glosa: em recurso até o último retorno; depois recuperada ou encerrada', () => {
    const it1 = { decisao: 'recorrer', emRecurso: true, retornado: false, valorRecuperado: 0 };
    expect(situacaoDaGlosaNoRecurso('em_analise', [it1]).situacao).toBe('em_recurso');
    expect(
      situacaoDaGlosaNoRecurso('em_recurso', [{ ...it1, retornado: true, valorRecuperado: 40 }]),
    ).toEqual({ situacao: 'recuperada', valorRecuperado: 40, encerrada: true });
    expect(situacaoDaGlosaNoRecurso('em_recurso', [{ ...it1, retornado: true }]).situacao).toBe('encerrada');
    expect(
      situacaoDaGlosaNoRecurso('em_recurso', [
        { ...it1, retornado: true },
        { decisao: 'pendente', emRecurso: false, retornado: false, valorRecuperado: 0 },
      ]).situacao,
    ).toBe('em_recurso');
    // A e B decididos "recorrer"; só A foi ao lote e retornou: B ainda pode ser recorrido, a glosa não encerra.
    const b = { decisao: 'recorrer', emRecurso: false, retornado: false, valorRecuperado: 0 };
    expect(
      situacaoDaGlosaNoRecurso('em_recurso', [{ ...it1, retornado: true, valorRecuperado: 40 }, b]),
    ).toEqual({ situacao: 'em_recurso', valorRecuperado: 40, encerrada: false });
    // Com B no lote e retornado, a glosa encerra.
    expect(
      situacaoDaGlosaNoRecurso('em_recurso', [
        { ...it1, retornado: true, valorRecuperado: 40 },
        { ...b, emRecurso: true, retornado: true },
      ]).encerrada,
    ).toBe(true);
    // Item aceito ao lado do recorrido não segura o encerramento.
    expect(
      situacaoDaGlosaNoRecurso('em_recurso', [
        { ...it1, retornado: true },
        { decisao: 'aceitar', emRecurso: false, retornado: false, valorRecuperado: 0 },
      ]).situacao,
    ).toBe('encerrada');
    expect(situacaoDaGlosaNoRecurso('aceita_total', [{ ...it1, emRecurso: false }]).situacao).toBe(
      'aceita_total',
    );
    expect(situacaoDaGlosaNoRecurso('cancelada', [it1]).situacao).toBe('cancelada');
  });
});
