// F3.6 (05-SUP linha 14): emissão das etiquetas de identificação (o que recusa) e a baixa na movimentação.
import { describe, expect, it } from 'vitest';
import {
  conferirEmissaoEtiquetas,
  identificadorEtiqueta,
  proximaSituacaoEtiqueta,
  sequencialDoIdentificador,
} from '@sgh/contratos/regras-suprimentos';

const base = {
  controlaLote: true,
  itemAtivo: true,
  lote: { validade: '2027-01-31', situacao: 'liberado' },
  quantidadePorEtiqueta: 10,
  etiquetas: 3,
  hoje: '2026-11-25',
};
const codigos = (e: typeof base | Parameters<typeof conferirEmissaoEtiquetas>[0]) =>
  conferirEmissaoEtiquetas(e).map((r) => r.codigo);

describe('emissão das etiquetas', () => {
  it('aceita o item rastreável com o lote liberado e na validade', () => {
    expect(codigos(base)).toEqual([]);
    expect(codigos({ ...base, controlaLote: false, lote: null })).toEqual([]);
  });

  it('recusa sem lote no rastreável, lote vencido ou bloqueado, item inativo e faixas', () => {
    expect(codigos({ ...base, lote: null })).toEqual(['lote-obrigatorio']);
    expect(codigos({ ...base, lote: { validade: '2026-11-24', situacao: 'liberado' } })).toEqual([
      'lote-vencido',
    ]);
    expect(codigos({ ...base, lote: { validade: '2027-01-31', situacao: 'bloqueado' } })).toEqual([
      'lote-bloqueado',
    ]);
    expect(codigos({ ...base, itemAtivo: false })).toEqual(['item-inativo']);
    expect(codigos({ ...base, quantidadePorEtiqueta: 0 })).toEqual(['quantidade-invalida']);
    expect(codigos({ ...base, etiquetas: 0 })).toEqual(['etiquetas-invalidas']);
    expect(codigos({ ...base, etiquetas: 201 })).toEqual(['etiquetas-invalidas']);
    expect(codigos({ ...base, etiquetas: 1.5 })).toEqual(['etiquetas-invalidas']);
  });

  it('o sequencial volta do identificador; o que não é do hospital volta nulo', () => {
    expect(sequencialDoIdentificador(identificadorEtiqueta(1))).toBe(1);
    expect(sequencialDoIdentificador(identificadorEtiqueta(987_654))).toBe(987_654);
    expect(sequencialDoIdentificador('E0000011')).toBeNull();
    expect(sequencialDoIdentificador('7891234567895')).toBeNull();
    expect(sequencialDoIdentificador(null)).toBeNull();
  });
});

describe('baixa da etiqueta', () => {
  it('só a ativa sai, e só a devolvida volta a ativa', () => {
    expect(proximaSituacaoEtiqueta('ativa', 'consumida')).toEqual({ ok: true, situacao: 'consumida' });
    expect(proximaSituacaoEtiqueta('ativa', 'descartada')).toEqual({ ok: true, situacao: 'descartada' });
    const r = proximaSituacaoEtiqueta('consumida', 'consumida');
    expect(r.ok === false && r.recusa.codigo).toBe('etiqueta-inativa');
    expect(proximaSituacaoEtiqueta('devolvida', 'reativar')).toEqual({ ok: true, situacao: 'ativa' });
    const x = proximaSituacaoEtiqueta('ativa', 'reativar');
    expect(x.ok === false && x.recusa.codigo).toBe('etiqueta-nao-devolvida');
  });
});
