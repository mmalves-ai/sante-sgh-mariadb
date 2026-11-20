// Regra 10 da ficha do M46 (etapa 4): o consignado por fornecedor e item no novo (o controle do estoque não é ligado):
// o saldo pelas remessas, reposições, consumos líquidos em sala e devoluções ao fornecedor; a remessa rastreável; a
// reposição e o faturamento ligados a consumos do mesmo fornecedor e item, uma vez cada; a devolução até o saldo; o
// indicador do consumo sem faturamento com o numerador e o denominador.
import { describe, expect, it } from 'vitest';
import {
  CLASSE_OPME,
  type ConsumoConsignado,
  esquemaRegistrarRemessaConsignado,
  esquemaReporConsignado,
} from '@sgh/contratos';
import {
  avisoReferenciaConsignado,
  conferirRemessaConsignado,
  conferirReposicaoConsignado,
  consumoConsignadoAtrasado,
  indicadorConsignado,
  type RemessaParaConferir,
  type ReposicaoParaConferir,
  saldoConsignado,
} from '../index.js';

describe('saldo do consignado (regra 10)', () => {
  it('remessas + reposições − consumos líquidos − devoluções, por fornecedor e item; consumo sem fornecedor fora', () => {
    const s = saldoConsignado(
      [
        { fornecedor: 7, item: 950003, tipo: 'remessa', quantidade: 3 },
        { fornecedor: 7, item: 950003, tipo: 'reposicao', quantidade: 1 },
        { fornecedor: 7, item: 950003, tipo: 'faturamento', quantidade: 1 },
        { fornecedor: 7, item: 950003, tipo: 'devolucao', quantidade: 0.5 },
        { fornecedor: 8, item: 950003, tipo: 'remessa', quantidade: 2 },
      ],
      [
        { fornecedor: 7, item: 950003, quantidade: 1, reposto: true, faturado: true },
        { fornecedor: 7, item: 950003, quantidade: 1, reposto: false, faturado: false },
        { fornecedor: 7, item: 950003, quantidade: 0, reposto: false, faturado: false },
        { fornecedor: null, item: 950003, quantidade: 1, reposto: false, faturado: false },
      ],
    );
    expect(s).toEqual([
      {
        fornecedor: 7,
        item: 950003,
        remessas: 3,
        reposicoes: 1,
        consumidos: 2,
        devolvidos: 0.5,
        aRepor: 1,
        aFaturar: 1,
        saldo: 1.5,
      },
      {
        fornecedor: 8,
        item: 950003,
        remessas: 2,
        reposicoes: 0,
        consumidos: 0,
        devolvidos: 0,
        aRepor: 0,
        aFaturar: 0,
        saldo: 2,
      },
    ]);
  });
});

describe('remessa em consignação', () => {
  const r: RemessaParaConferir = {
    classeItem: CLASSE_OPME,
    referenciaConsignada: false,
    fornecedorExiste: true,
    quantidade: 2,
    lote: 'L1',
    serie: null,
    validade: '2027-01-01',
    emissao: '2026-10-26',
    hoje: '2026-10-26',
  };
  const c = (x: Partial<RemessaParaConferir>) =>
    conferirRemessaConsignado({ ...r, ...x }).map((y) => y.codigo);
  it('o material de OPME ou de referência consignada, do fornecedor do cadastro, com lote ou série', () => {
    expect(c({})).toEqual([]);
    expect(c({ classeItem: 12, referenciaConsignada: true })).toEqual([]);
    expect(c({ classeItem: 12 })).toEqual(['item-nao-consignavel']);
    expect(c({ classeItem: null })).toEqual(['item-inexistente']);
    expect(c({ fornecedorExiste: false })).toEqual(['fornecedor-inexistente']);
    expect(c({ lote: null })).toEqual(['sem-rastreio']);
    expect(c({ lote: null, serie: 'S-1' })).toEqual([]);
    expect(c({ validade: '2026-10-25' })).toEqual(['validade-no-passado']);
    expect(c({ emissao: '2026-10-27' })).toEqual(['emissao-futura']);
  });
  it('o aviso de que a saída acima do saldo é só a do item de referência consignada (a regra do gatilho)', () => {
    expect(avisoReferenciaConsignado(true)).toBeNull();
    expect(avisoReferenciaConsignado(false)).toMatch(/precisa de saldo/);
  });
  it('o esquema exige o lote ou a série e a nota só com dígitos', () => {
    const ok = {
      chave: 'consig-remessa-0001',
      fornecedor: 7,
      item: 950003,
      quantidade: 2,
      nfNumero: '12345',
      nfEmissao: '2026-10-26',
      lote: 'L1',
    };
    expect(esquemaRegistrarRemessaConsignado.safeParse(ok).success).toBe(true);
    expect(esquemaRegistrarRemessaConsignado.safeParse({ ...ok, lote: null }).success).toBe(false);
    expect(esquemaRegistrarRemessaConsignado.safeParse({ ...ok, nfNumero: '12A' }).success).toBe(false);
  });
});

describe('reposição, faturamento e devolução ao fornecedor', () => {
  const consumo = { consumo: 1, fornecedor: 7, item: 950003, quantidade: 1, reposto: false, faturado: false };
  const base: ReposicaoParaConferir = {
    tipo: 'reposicao',
    fornecedor: 7,
    item: 950003,
    consumos: [consumo],
    quantidade: null,
    saldo: 2,
    nf: null,
    motivo: null,
  };
  const c = (x: Partial<ReposicaoParaConferir>) =>
    conferirReposicaoConsignado({ ...base, ...x }).map((y) => y.codigo);
  it('a reposição liga consumos do mesmo fornecedor e item, uma vez cada', () => {
    expect(c({})).toEqual([]);
    expect(c({ consumos: [] })).toEqual(['sem-consumo']);
    expect(c({ consumos: [null] })).toEqual(['consumo-inexistente']);
    expect(c({ consumos: [consumo, consumo] })).toEqual(['consumo-repetido']);
    expect(c({ consumos: [{ ...consumo, fornecedor: 8 }] })).toEqual(['consumo-de-outro-fornecedor']);
    expect(c({ consumos: [{ ...consumo, item: 1 }] })).toEqual(['consumo-de-outro-fornecedor']);
    expect(c({ consumos: [{ ...consumo, reposto: true }] })).toEqual(['consumo-ja-reposto']);
    expect(c({ consumos: [{ ...consumo, quantidade: 0 }] })).toEqual(['consumo-devolvido']);
  });
  it('o faturamento exige a nota da entrada do estoque, do fornecedor e com o item', () => {
    const f = { tipo: 'faturamento' as const };
    expect(c({ ...f, nf: { fornecedor: 7, temItem: true } })).toEqual([]);
    expect(c({ ...f, nf: null })).toEqual(['nf-inexistente']);
    expect(c({ ...f, nf: { fornecedor: 8, temItem: true } })).toEqual(['nf-de-outro-fornecedor']);
    expect(c({ ...f, nf: { fornecedor: 7, temItem: false } })).toEqual(['nf-sem-item']);
    expect(
      c({ ...f, nf: { fornecedor: 7, temItem: true }, consumos: [{ ...consumo, faturado: true }] }),
    ).toEqual(['consumo-ja-faturado']);
    // O consumo já reposto ainda pode ser faturado (são movimentos diferentes).
    expect(
      c({ ...f, nf: { fornecedor: 7, temItem: true }, consumos: [{ ...consumo, reposto: true }] }),
    ).toEqual([]);
  });
  it('a devolução ao fornecedor vai até o saldo e leva o motivo', () => {
    const d = { tipo: 'devolucao' as const, consumos: [], motivo: 'Material não usado no mês' };
    expect(c({ ...d, quantidade: 2 })).toEqual([]);
    expect(c({ ...d, quantidade: 2.5 })).toEqual(['acima-do-saldo']);
    expect(c({ ...d, quantidade: null })).toEqual(['quantidade-invalida']);
    expect(c({ ...d, quantidade: 1, motivo: 'curto' })).toEqual(['sem-motivo']);
  });
  it('o esquema: o faturamento leva a nota da entrada; a devolução, a quantidade e o motivo sem consumos', () => {
    const b = { chave: 'consig-repor-0001', fornecedor: 7, item: 950003 };
    expect(esquemaReporConsignado.safeParse({ ...b, tipo: 'reposicao', consumos: [1] }).success).toBe(true);
    expect(esquemaReporConsignado.safeParse({ ...b, tipo: 'reposicao', consumos: [] }).success).toBe(false);
    expect(esquemaReporConsignado.safeParse({ ...b, tipo: 'faturamento', consumos: [1] }).success).toBe(
      false,
    );
    expect(
      esquemaReporConsignado.safeParse({
        ...b,
        tipo: 'faturamento',
        consumos: [1],
        nfEntrada: { ano: 2026, mes: 10, doc: 55 },
      }).success,
    ).toBe(true);
    expect(
      esquemaReporConsignado.safeParse({
        ...b,
        tipo: 'devolucao',
        quantidade: 1,
        motivo: 'Material não usado',
      }).success,
    ).toBe(true);
    expect(esquemaReporConsignado.safeParse({ ...b, tipo: 'devolucao', quantidade: 1 }).success).toBe(false);
  });
});

describe('indicador do consumo consignado sem faturamento', () => {
  const c = (x: Partial<ConsumoConsignado>): ConsumoConsignado => ({
    consumo: 1,
    agendamento: 1,
    atendimento: 1,
    fornecedor: 7,
    item: 950003,
    itemNome: null,
    quantidade: 1,
    lote: 'L1',
    serie: null,
    em: '2026-10-10T10:00',
    reposicao: null,
    faturamento: null,
    ...x,
  });
  it('numerador e denominador impressos; o atraso depois dos dias do alerta', () => {
    const fat = { movimento: 9, em: '2026-10-20T10:00', nf: { ano: 2026, mes: 10, doc: 55 } };
    const rep = { movimento: 8, em: '2026-10-20T10:00' };
    const xs = [
      c({}),
      c({ consumo: 2, reposicao: rep, faturamento: fat }),
      c({ consumo: 3, em: '2026-10-25T10:00' }),
      c({ consumo: 4, quantidade: 0 }),
    ];
    expect(indicadorConsignado(xs, '2026-10-26', 7)).toEqual({
      consumos: 3,
      semReposicao: 2,
      semFaturamento: 2,
      atrasados: 1,
      diasAlerta: 7,
    });
    expect(consumoConsignadoAtrasado(c({}), '2026-10-17', 7)).toBe(false);
    expect(consumoConsignadoAtrasado(c({}), '2026-10-18', 7)).toBe(true);
  });
});
