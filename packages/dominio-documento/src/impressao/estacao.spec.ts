import { describe, expect, it } from 'vitest';
import { conferirVinculoEstacao, escolherImpressora, planoReimpressao } from './estacao.js';

describe('impressora por estação e reimpressão (01-ADM L79)', () => {
  it('vínculo: estação, impressora e finalidade do mesmo estabelecimento e ativas', () => {
    const ok = {
      estacaoEstabelecimento: 1,
      impressora: { estabelecimento: 1, ativa: true },
      finalidadeAtiva: true,
    };
    expect(conferirVinculoEstacao(ok)).toBeNull();
    expect(conferirVinculoEstacao({ ...ok, estacaoEstabelecimento: null })).toBe('estacao-inexistente');
    expect(conferirVinculoEstacao({ ...ok, impressora: null })).toBe('impressora-inexistente');
    expect(conferirVinculoEstacao({ ...ok, finalidadeAtiva: null })).toBe('finalidade-inexistente');
    expect(conferirVinculoEstacao({ ...ok, impressora: { estabelecimento: 2, ativa: true } })).toBe(
      'impressora-de-outro-estabelecimento',
    );
    expect(conferirVinculoEstacao({ ...ok, impressora: { estabelecimento: 1, ativa: false } })).toBe(
      'impressora-inativa',
    );
    expect(conferirVinculoEstacao({ ...ok, finalidadeAtiva: false })).toBe('finalidade-inativa');
  });

  it('escolha: usuário na estação > estação > unidade > estabelecimento; inativa não conta', () => {
    const c = [
      { impressora: 10, origem: 'estabelecimento' as const, unidade: null, ativa: true },
      { impressora: 20, origem: 'estabelecimento' as const, unidade: 5, ativa: true },
      { impressora: 30, origem: 'estacao' as const, usuario: null, ativa: true },
      { impressora: 40, origem: 'estacao' as const, usuario: 7, ativa: true },
    ];
    expect(escolherImpressora(c, { usuario: 7, unidade: 5 })).toEqual({ impressora: 40, nivel: 'usuario' });
    expect(escolherImpressora(c, { usuario: 8, unidade: 5 })).toEqual({ impressora: 30, nivel: 'estacao' });
    expect(escolherImpressora(c.slice(0, 2), { usuario: 8, unidade: 5 })).toEqual({
      impressora: 20,
      nivel: 'unidade',
    });
    expect(escolherImpressora(c.slice(0, 2), { usuario: null, unidade: 9 })).toEqual({
      impressora: 10,
      nivel: 'estabelecimento',
    });
    expect(
      escolherImpressora([{ impressora: 30, origem: 'estacao', usuario: null, ativa: false }], {
        usuario: null,
        unidade: null,
      }),
    ).toBeNull();
  });

  it('reimpressão: exige impressão anterior e motivo ativo; complemento quando o motivo pede', () => {
    const m = { ativo: true, exigeComplemento: false };
    expect(planoReimpressao({ viasAnteriores: 0, motivo: m })).toEqual({
      recusa: 'documento-nunca-impresso',
    });
    expect(planoReimpressao({ viasAnteriores: 1, motivo: null })).toEqual({ recusa: 'motivo-inexistente' });
    expect(planoReimpressao({ viasAnteriores: 1, motivo: { ...m, ativo: false } })).toEqual({
      recusa: 'motivo-inativo',
    });
    expect(planoReimpressao({ viasAnteriores: 1, motivo: { ativo: true, exigeComplemento: true } })).toEqual({
      recusa: 'complemento-obrigatorio',
    });
    expect(planoReimpressao({ viasAnteriores: 1, motivo: m })).toEqual({ via: 2, complemento: null });
    expect(
      planoReimpressao({
        viasAnteriores: 3,
        motivo: { ativo: true, exigeComplemento: true },
        complemento: ' Rasgou ',
      }),
    ).toEqual({ via: 4, complemento: 'Rasgou' });
  });
});
