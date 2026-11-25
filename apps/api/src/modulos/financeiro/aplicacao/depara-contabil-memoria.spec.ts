// F3.8, 07-FIN linha 100: o de-para contábil da sessão sintética (sem banco do cliente). O controller do
// contábil-fiscal responde pela porta em memória com as mesmas regras da gravação no banco: a conta por evento e lado
// gravada, a duplicada recusada, a versão conferida, desligar mantém a linha; o código externo do credor achado pelo
// nome; o que falta no período sai dos títulos sintéticos e some quando os dois lados têm conta; o lote do período
// leva a conta e o código do credor. Sem porta em memória e sem núcleo, segue 503 (falha fechada). O que fica no banco
// é provado em `contabil-fiscal.int.spec.ts`.
import { dePararFatos, montarLoteContabil } from '@sgh/dominio-financeiro';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { ErroProblema } from '../../../problema.filter.js';
import { sessaoDe } from '../../cadastro/comum.js';
import { ContabilFiscalController } from '../contabil-fiscal.controller.js';
import { DeParaContabilMemoria, fatosDosTitulosMemoria } from '../contabil-fiscal-memoria.js';
import { PortaFinanceiroMemoria } from '../porta-memoria.js';

const req = (hospital = 'pc') =>
  ({
    headers: {},
    sgh: {
      sessao: {
        rede: 'r1',
        estabelecimentoAtivo: hospital,
        usuario: { login: 'SINT.FIN.LANCA' },
        permissoes: [],
      },
    },
  }) as unknown as RequisicaoAutorizada;
const cadastro = {
  naturezas: [{ id: 1, codigo: '216.2.1', descricao: 'SINTETICO MATERIAL DE CONSUMO' }],
  centros: [{ id: 10, codigo: 'CC10', nome: 'SINTETICO ALMOXARIFADO' }],
  fornecedores: { 5001: 'FORNECEDOR SINTETICO A' },
  profissionais: { 70: 'MEDICO SINTETICO' },
};
const conta = (lado: 'debito' | 'credito' | 'ambos', c: string, natureza: number | null = null) => ({
  tipo: 'conta' as const,
  id: null,
  evento: 'fin_despesa_reconhecida',
  lado,
  natureza,
  conta: c,
  ativo: true,
});
const codigoDe = async (p: Promise<unknown> | unknown) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErroProblema ? (e.getStatus?.() ?? 0) : -1;
  }
  return 200;
};

describe('de-para contábil em memória (sessão sintética)', () => {
  it('grava a conta por evento e lado, recusa a duplicada, confere a versão e desliga sem apagar', () => {
    const d = new DeParaContabilMemoria(cadastro);
    const r = d.manter(conta('debito', '3.1.01'));
    expect(r).toMatchObject({ tabela: 'depara_conta_externa', tipo: 'conta' });
    expect(() => d.manter(conta('debito', '3.1.02'))).toThrow(/Já há conta ativa/);
    expect(() => d.manter(conta('ambos', '3.1.02'))).toThrow(/Já há conta ativa/);
    expect(() => d.manter(conta('credito', 'conta inválida'))).toThrow(/letras, números/);
    expect(() => d.manter(conta('credito', '2.1.01', 99))).toThrow(/natureza financeira não existe/);
    d.manter(conta('credito', '2.1.01'));
    d.manter(conta('debito', '3.1.09', 1));
    const id = Number(r['linha']);
    expect(() => d.manter({ ...conta('debito', '3.1.05'), id, versao: 7 })).toThrow();
    expect(d.manter({ ...conta('debito', '3.1.05'), id, versao: 1 })).toMatchObject({ antes: '3.1.01' });
    d.manter({ ...conta('debito', '3.1.05'), id, versao: 2, ativo: false });
    const regra = d.regras().find((x) => x.id === id);
    expect(regra).toMatchObject({ conta: '3.1.05', ativo: false, versao: 3 });
    expect(d.regras()).toHaveLength(3);
    expect(() => d.manter({ ...conta('credito', '9'), ativo: false })).toThrow(/entra ativa/);
  });

  it('código externo do centro, do credor e do médico: só do cadastro; vazio desliga e mantém o código', () => {
    const d = new DeParaContabilMemoria(cadastro);
    expect(() => d.manter({ tipo: 'credor', fornecedor: 1, codigo: 'X', ativo: true })).toThrow(/não existe/);
    expect(() => d.manter({ tipo: 'centro', centro: 99, codigo: 'X', ativo: true })).toThrow(
      /centro de custo/,
    );
    expect(() => d.manter({ tipo: 'credor', fornecedor: 5001, codigo: 'X', ativo: false })).toThrow(
      /Não há código externo/,
    );
    d.manter({ tipo: 'credor', fornecedor: 5001, codigo: 'F-77', ativo: true });
    d.manter({ tipo: 'centro', centro: 10, codigo: 'E10', ativo: true });
    d.manter({ tipo: 'profissional', profissional: 70, codigo: 'M-70', ativo: true });
    expect(d.completo()).toMatchObject({
      credores: [{ id: 5001, nome: 'FORNECEDOR SINTETICO A', externo: 'F-77' }],
      centros: [{ id: 10, externo: 'E10' }],
      profissionais: [{ id: 70, externo: 'M-70' }],
    });
    expect(d.fornecedores('sintetico a')).toEqual([
      { id: 5001, nome: 'FORNECEDOR SINTETICO A', documento: null },
    ]);
    expect(d.fornecedores('s')).toEqual([]);
    d.manter({ tipo: 'credor', fornecedor: 5001, codigo: 'F-77', ativo: false });
    expect(d.completo().credores).toEqual([]);
    expect(d.paraLote().credores.size).toBe(0);
    expect(d.paraLote().centros.get(10)).toBe('E10');
  });

  it('os fatos do período saem dos títulos: despesa na emissão e pagamento (competência); despesa paga (caixa)', () => {
    const t = {
      emissao: '2026-10-05',
      valor: 1500,
      pago: 1500,
      dataPagamento: '2026-11-03',
      documento: 800001,
      parcela: 1,
      natureza: 1,
      fornecedor: 5001,
      profissional: null,
    };
    const fora = { ...t, documento: 800002, emissao: '2026-09-30', pago: 0, dataPagamento: null };
    const out = fatosDosTitulosMemoria([t, fora], {
      de: '2026-10-01',
      ate: '2026-10-31',
      regua: 'competencia',
    });
    expect(out.map((f) => [f.evento, f.valor, f.credor])).toEqual([['fin_despesa_reconhecida', 1500, 5001]]);
    const nov = fatosDosTitulosMemoria([t, fora], {
      de: '2026-11-01',
      ate: '2026-11-30',
      regua: 'competencia',
    });
    expect(nov.map((f) => f.evento)).toEqual(['fin_pagamento_titulo']);
    const caixa = fatosDosTitulosMemoria([t, fora], { de: '2026-11-01', ate: '2026-11-30', regua: 'caixa' });
    expect(caixa.map((f) => [f.evento, f.valor])).toEqual([['fin_despesa_paga', 1500]]);
    // Com a conta dos dois lados e o código do credor, o fato entra no lote com débito igual a crédito.
    const d = new DeParaContabilMemoria(cadastro);
    d.manter(conta('debito', '3.1.01'));
    d.manter(conta('credito', '2.1.01'));
    d.manter({ tipo: 'credor', fornecedor: 5001, codigo: 'F-77', ativo: true });
    const dp = d.paraLote();
    const { eventos, depara } = dePararFatos(out, dp.regras, dp.centros, dp.credores, dp.profissionais);
    const lote = montarLoteContabil(eventos, depara);
    expect([lote.lancamentos, lote.somaDebitos, lote.somaCreditos, lote.semDePara.length]).toEqual([
      1, 1500, 1500, 0,
    ]);
    expect(lote.conteudo).toContain('F-77');
  });

  it('o controller responde pela porta em memória; as retenções e a falta da porta seguem 503', async () => {
    const porta = new PortaFinanceiroMemoria(null);
    const c = new ContabilFiscalController(null, porta);
    const r = await c.manterDePara(conta('debito', '3.1.01'), req());
    expect(r.mensagem).toBe('De-para contábil gravado.');
    const lido = (await c.dePara(req())) as {
      regras: { conta: string; ativo: boolean }[];
      eventos: unknown[];
    };
    expect(lido.regras).toMatchObject([{ conta: '3.1.01', ativo: true }]);
    expect(lido.eventos.length).toBeGreaterThan(0);
    // A duplicada sai como recusa da API (409), e a entrada fora do esquema como 400.
    expect(await codigoDe(c.manterDePara(conta('debito', '3.1.02'), req()))).toBe(409);
    expect(await codigoDe(c.manterDePara({ tipo: 'conta', evento: 'x' }, req()))).toBe(400);
    expect(await c.fornecedores('SINTETICO B', req())).toMatchObject([{ id: 5002 }]);
    expect(await c.semDePara('2020-01', 'competencia', req())).toEqual([]);
    // O título sintético emitido há cinco dias: falta o crédito da despesa; gravado o crédito, não falta mais.
    const ctx = sessaoDe(req()).porta;
    const emitido = new Date(`${await porta.hoje(ctx)}T12:00:00Z`);
    emitido.setUTCDate(emitido.getUTCDate() - 5);
    const mes = emitido.toISOString().slice(0, 7);
    const despesa = (f: { evento: string; natureza: number | null }) =>
      f.evento === 'fin_despesa_reconhecida' && f.natureza === 2;
    expect((await c.semDePara(mes, 'competencia', req())).filter(despesa)).toMatchObject([
      { lado: 'credito', natureza: 2, fatos: 1 },
    ]);
    await c.manterDePara(conta('credito', '2.1.01'), req());
    expect((await c.semDePara(mes, 'competencia', req())).filter(despesa)).toEqual([]);
    expect(await codigoDe((async () => c.semDePara('10/2026', undefined, req()))())).toBe(400);
    // As retenções seguem só no banco; e sem porta em memória tudo é 503.
    expect(await codigoDe((async () => c.regras(req()))())).toBe(503);
    const semNada = new ContabilFiscalController(null, null);
    expect(await codigoDe((async () => semNada.dePara(req()))())).toBe(503);
    expect(await codigoDe(semNada.manterDePara(conta('debito', '3.1.01'), req()))).toBe(503);
    // O lote da porta usa o de-para gravado.
    const dp = await porta.deParaContabil(ctx, { de: `${mes}-01`, ate: `${mes}-28`, regua: 'competencia' });
    expect(dp.regras).toHaveLength(2);
  });
});
