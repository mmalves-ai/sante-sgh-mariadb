// Consumidor do financeiro (unidade): a glosa aceita no faturamento vira glosa no título UMA vez (a chave do evento);
// a competência fechada não grava no banco do estabelecimento pelo worker (vai à fila de trabalho); evento de outro
// tipo, sem estabelecimento válido ou com carga inválida não faz nada. A regra do valor (aplicarGlosaAceita) é pura.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcessoIntegracao, OpcoesGravacao } from '../integracao/acesso.js';
import { consumirEventoFinanceiro } from './consumidor-financeiro.js';
import { aplicarGlosaAceita, valorAindaNaoLancado } from './glosa-propria.js';

const banco = vi.hoisted(() => ({
  glosas: new Map<string, number>(),
  titulos: new Map<number, number>(),
  chamadas: [] as unknown[],
}));

vi.mock('./glosa-propria.js', async (original) => ({
  ...(await original<typeof import('./glosa-propria.js')>()),
  registrarGlosaAceitaDoEvento: async (_tx: unknown, d: { item: number; chaveEvento: string }) => {
    banco.chamadas.push(d);
    if (!banco.titulos.has(d.item)) return { resultado: 'sem-titulo', id: null };
    const j = banco.glosas.get(d.chaveEvento);
    if (j) return { resultado: 'repetida', id: j };
    const id = banco.glosas.size + 1;
    banco.glosas.set(d.chaveEvento, id);
    return { resultado: 'registrada', id };
  },
}));

const gravacoes: string[] = [];
const opcoes: (OpcoesGravacao | undefined)[] = [];
const acesso: AcessoIntegracao = {
  ler: async (_h, fn) => fn({} as never),
  gravar: async (h, fn, o) => {
    gravacoes.push(h);
    opcoes.push(o);
    return fn({} as never);
  },
};

beforeEach(() => {
  banco.glosas.clear();
  banco.titulos.clear();
  banco.chamadas.length = 0;
  gravacoes.length = 0;
  opcoes.length = 0;
});

describe('consumidor do financeiro', () => {
  it('a glosa aceita do item vira glosa no título uma vez (a mesma entrega não duplica)', async () => {
    banco.titulos.set(91011, 9001);
    const ev = {
      chave: 'a'.repeat(64),
      tipo: 'faturamento.glosa.aceita',
      dados: { hospital: 'pc', item: 91011, conta: 9101 },
    };
    expect(await consumirEventoFinanceiro(acesso, 'cliente', ev)).toEqual({ resultado: 'registrada', id: 1 });
    expect(await consumirEventoFinanceiro(acesso, 'cliente', ev)).toEqual({ resultado: 'repetida', id: 1 });
    expect(banco.glosas.size).toBe(1);
    expect(gravacoes).toEqual(['pc', 'pc']);
    expect(opcoes[0]).toEqual({
      operacao: 'financeiro.glosa.aceita-do-evento',
      tabelas: ['glosa_titulo_receber', 'titulo_receber'],
    });
  });

  it('a conta ainda sem título fica de fora (a glosa entra pela tela quando o título nascer)', async () => {
    const ev = {
      chave: 'b'.repeat(64),
      tipo: 'faturamento.glosa.aceita',
      dados: { hospital: 'pc', item: 5 },
    };
    expect(await consumirEventoFinanceiro(acesso, 'cliente', ev)).toEqual({
      resultado: 'sem-titulo',
      id: null,
    });
    expect(banco.glosas.size).toBe(0);
  });

  it('a competência fechada vai à fila de trabalho: o worker não grava título em nome de ninguém', async () => {
    const r = await consumirEventoFinanceiro(acesso, 'cliente', {
      chave: 'c'.repeat(64),
      tipo: 'faturamento.competencia.fechada',
      dados: { hospital: 'pc', convenio: 92, ano: 2026, mes: 9 },
    });
    expect(r).toEqual({ resultado: 'fila-de-trabalho', convenio: 92, competencia: '2026-09' });
    expect(gravacoes).toEqual([]);
  });

  it('outro tipo, estabelecimento inválido ou carga inválida: nada', async () => {
    const nada = [
      { chave: 'd', tipo: 'faturamento.lote.gerado', dados: { hospital: 'pc', lote: 1 } },
      { chave: 'e', tipo: 'faturamento.glosa.aceita', dados: { hospital: "pc'; --", item: 1 } },
      { chave: 'f', tipo: 'faturamento.glosa.aceita', dados: { hospital: 'pc', item: 'x' } },
      {
        chave: 'g',
        tipo: 'faturamento.competencia.fechada',
        dados: { hospital: 'pc', convenio: 1, ano: 2026, mes: 13 },
      },
    ];
    for (const ev of nada) expect(await consumirEventoFinanceiro(acesso, 'cliente', ev)).toBeNull();
    expect(banco.chamadas).toEqual([]);
  });
});

describe('regra da glosa aceita no título', () => {
  it('soma a aceita em centavos e mantém a glosa total ≥ aceita', () => {
    expect(aplicarGlosaAceita({ glosa: 0, glosaAceita: 0 }, 30.1)).toEqual({
      glosa: 30.1,
      glosaAceita: 30.1,
    });
    expect(aplicarGlosaAceita({ glosa: 100, glosaAceita: 10.2 }, 0.1)).toEqual({
      glosa: 100,
      glosaAceita: 10.3,
    });
    expect(() => aplicarGlosaAceita({ glosa: 0, glosaAceita: 0 }, 0)).toThrow(RangeError);
    expect(() => aplicarGlosaAceita({ glosa: 0, glosaAceita: 0 }, Number.NaN)).toThrow(RangeError);
  });

  it('só o que ainda não foi lançado entra (nunca negativo)', () => {
    expect(valorAindaNaoLancado(50, 20)).toBe(30);
    expect(valorAindaNaoLancado(20, 50)).toBe(0);
    expect(valorAindaNaoLancado(0.3, 0.1)).toBe(0.2);
  });
});
