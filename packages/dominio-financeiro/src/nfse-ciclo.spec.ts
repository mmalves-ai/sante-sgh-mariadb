import { describe, expect, it } from 'vitest';
import {
  calcularNfseComDeducoes,
  conferirCancelamentoNfse,
  conferirDeducoes,
  conferirLoteNfse,
  conferirParametroNfse,
  conferirSubstituicaoNfse,
  type PedidoNfseCompleto,
  xmlNfseCompleta,
} from './nfse-ciclo.js';

const zero = { ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0 };
const nota = (x: Partial<PedidoNfseCompleto> = {}): PedidoNfseCompleto => ({
  tituloReceber: 1,
  conta: null,
  itemServico: '4.03',
  valorServicos: 1000,
  aliquotaIss: 5,
  issRetido: true,
  retencoes: zero,
  momento: 'apresentacao',
  classificacao: '000001',
  deducoes: [],
  ...x,
});
const codigo = (r: { codigo: string } | null) => r?.codigo ?? null;
const MOT = { id: 1, codigo: 'erro-emissao', ativo: true, aplicaNotaServico: true };
const emitida = { situacao: 'autorizada', emitidaEm: '2026-11-01', tituloReceber: 1, conta: null };

describe('NFS-e: deduções da base', () => {
  it('a dedução reduz a base do ISS, do IBS e da CBS, não o valor cobrado', () => {
    const c = calcularNfseComDeducoes(
      nota({ deducoes: [{ tipo: 'material', descricao: 'órtese', documento: 'NF 10', valor: 200 }] }),
    );
    expect(c).toMatchObject({ valorServicos: 1000, valorDeducoes: 200, baseCalculo: 800, valorIss: 40 });
    expect(c.valorCbs).toBe(7.2);
    expect(c.valorIbs).toBe(0.8);
    expect(c.valorLiquido).toBe(960);
    expect(
      xmlNfseCompleta({ ...c, numeroRps: '1', tomador: 't', itemServico: '4.03', substitui: null }),
    ).toContain('<vDR>200.00</vDR>');
  });
  it('recusa dedução sem documento, sem valor ou que chega ao valor dos serviços', () => {
    expect(
      codigo(conferirDeducoes(1000, [{ tipo: 'material', descricao: 'x', documento: null, valor: 1 }])),
    ).toBe('deducao-documento');
    expect(
      codigo(conferirDeducoes(1000, [{ tipo: 'outra', descricao: 'x', documento: null, valor: 0 }])),
    ).toBe('deducao-valor');
    expect(
      codigo(conferirDeducoes(1000, [{ tipo: 'outra', descricao: 'x', documento: null, valor: 1000 }])),
    ).toBe('deducoes-acima');
    expect(
      conferirDeducoes(1000, [{ tipo: 'outra', descricao: 'x', documento: null, valor: 10 }]),
    ).toBeNull();
  });
});

describe('NFS-e: lote', () => {
  it('aceita várias faturas e recusa a repetida, a vazia e a nota inválida com o índice no campo', () => {
    expect(conferirLoteNfse([nota(), nota({ tituloReceber: 2 })], [])).toBeNull();
    expect(codigo(conferirLoteNfse([], []))).toBe('lote-vazio');
    expect(codigo(conferirLoteNfse([nota(), nota()], []))).toBe('fatura-repetida');
    const r = conferirLoteNfse([nota(), nota({ tituloReceber: 3, aliquotaIss: 9 })], []);
    expect(r?.codigo).toBe('aliquota-iss');
    expect(r?.campos).toEqual(['notas.1.aliquotaIss']);
    expect(
      codigo(
        conferirLoteNfse(
          Array.from({ length: 51 }, (_, i) => nota({ tituloReceber: i + 1 })),
          [],
        ),
      ),
    ).toBe('lote-grande');
  });
  it('recusa a fatura que já tem nota ativa, com o índice no campo', () => {
    const r = conferirLoteNfse(
      [nota({ tituloReceber: 5 }), nota({ tituloReceber: 6 })],
      [{ tituloReceber: 6, conta: null }],
    );
    expect(r?.codigo).toBe('fatura-com-nota');
    expect(r?.campos).toEqual(['notas.1.tituloReceber']);
    expect(conferirLoteNfse([nota({ tituloReceber: 5 })], [{ tituloReceber: null, conta: 5 }])).toBeNull();
  });
});

describe('NFS-e: cancelar e substituir', () => {
  const J = 'valor lançado com erro na fatura';
  it('cancela a nota ativa dentro do prazo do município, com justificativa', () => {
    expect(conferirCancelamentoNfse(emitida, MOT, J, '2026-11-20', 30)).toBeNull();
    expect(codigo(conferirCancelamentoNfse(emitida, MOT, 'curta', '2026-11-20', 30))).toBe(
      'justificativa-curta',
    );
    expect(codigo(conferirCancelamentoNfse(emitida, MOT, J, '2026-12-20', 30))).toBe(
      'prazo-cancelamento-vencido',
    );
    expect(
      codigo(conferirCancelamentoNfse({ ...emitida, situacao: 'cancelada' }, MOT, J, '2026-11-02', 30)),
    ).toBe('nota-nao-alteravel');
  });
  it('o motivo vem do catálogo: inativo, de outro documento ou ausente é recusado', () => {
    expect(codigo(conferirCancelamentoNfse(emitida, { ...MOT, ativo: false }, J, '2026-11-20', 30))).toBe(
      'motivo-invalido',
    );
    expect(
      codigo(conferirCancelamentoNfse(emitida, { ...MOT, aplicaNotaServico: false }, J, '2026-11-20', 30)),
    ).toBe('motivo-invalido');
    expect(codigo(conferirSubstituicaoNfse(emitida, null, J, '2026-11-10', 60, nota()))).toBe(
      'motivo-invalido',
    );
  });
  it('substitui pela nota da mesma fatura; outro tomador é recusado', () => {
    expect(
      conferirSubstituicaoNfse(emitida, MOT, J, '2026-11-10', 60, nota({ valorServicos: 900 })),
    ).toBeNull();
    expect(
      codigo(conferirSubstituicaoNfse(emitida, MOT, J, '2026-11-10', 60, nota({ tituloReceber: 2 }))),
    ).toBe('tomador-diferente');
    expect(codigo(conferirSubstituicaoNfse(emitida, MOT, J, '2027-02-10', 60, nota()))).toBe(
      'prazo-substituicao-vencido',
    );
  });
  it('confere a regra do município', () => {
    expect(
      conferirParametroNfse({
        municipioIbge: '3550308',
        prazoCancelamentoDias: 30,
        prazoSubstituicaoDias: 60,
      }),
    ).toBeNull();
    expect(
      codigo(
        conferirParametroNfse({ municipioIbge: '355', prazoCancelamentoDias: 30, prazoSubstituicaoDias: 60 }),
      ),
    ).toBe('municipio-invalido');
    expect(
      codigo(
        conferirParametroNfse({
          municipioIbge: '3550308',
          prazoCancelamentoDias: -1,
          prazoSubstituicaoDias: 60,
        }),
      ),
    ).toBe('prazo-invalido');
  });
});
