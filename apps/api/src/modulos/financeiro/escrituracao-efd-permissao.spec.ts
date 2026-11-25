// F3.8, 07-FIN linha 108 (C2-007): a prova das rotas da escrituração fiscal e da EFD-Contribuições, lida do próprio
// controlador (o guarda global recusa com 403 quem não tem o código declarado). A leitura do painel e o download do
// arquivo pedem financeiro.escrituracao.ler; classificar pede financeiro.escrituracao.classificar; gerar e registrar
// a entrega pedem financeiro.efdContribuicoes.gerar. Toda gravação declara a trilha no handler (o executor grava a
// trilha na mesma transação). Sem banco e fora da fonte sintética, toda rota falha fechada com 503.
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { ErroProblema } from '../../problema.filter.js';
import { armazemFinanceiroMemoria } from './armazem.js';
import { EscrituracaoEfdController } from './escrituracao-efd.controller.js';

const proto = EscrituracaoEfdController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};
const req = () =>
  ({
    headers: {},
    sgh: {
      sessao: {
        rede: 'r1',
        estabelecimentoAtivo: 'pc',
        usuario: { login: 'SINT.FIN.LANCA' },
        permissoes: [],
      },
    },
  }) as unknown as RequisicaoAutorizada;
const statusDe = async (f: () => unknown): Promise<number> => {
  try {
    await f();
  } catch (e) {
    return e instanceof ErroProblema ? e.getStatus() : -1;
  }
  return 200;
};

describe('escrituração fiscal e EFD-Contribuições: permissão, trilha e falha fechada (07-FIN linha 108)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('cada rota declara a sua permissão', () => {
    expect(meta(CHAVE_PERMISSAO, 'painel')).toBe('financeiro.escrituracao.ler');
    expect(meta(CHAVE_PERMISSAO, 'arquivo')).toBe('financeiro.escrituracao.ler');
    expect(meta(CHAVE_PERMISSAO, 'classificar')).toBe('financeiro.escrituracao.classificar');
    expect(meta(CHAVE_PERMISSAO, 'gerar')).toBe('financeiro.efdContribuicoes.gerar');
    expect(meta(CHAVE_PERMISSAO, 'entrega')).toBe('financeiro.efdContribuicoes.gerar');
  });

  it('as gravações declaram a trilha no handler; as leituras não gravam', () => {
    for (const m of ['classificar', 'gerar', 'entrega'])
      expect(String(meta(CHAVE_AUDITADO_NO_HANDLER, m) ?? '')).toMatch(
        /pelo executor, com a trilha na mesma transação$/,
      );
    for (const m of ['painel', 'arquivo']) expect(meta(CHAVE_AUDITADO_NO_HANDLER, m)).toBeUndefined();
  });

  it('sem banco do cliente e fora da fonte sintética, toda rota responde 503', async () => {
    vi.stubEnv('AMBIENTE', 'producao');
    vi.stubEnv('ACESSO_FONTE_DEV', '');
    const c = new EscrituracaoEfdController(armazemFinanceiroMemoria(), null);
    expect(await statusDe(() => c.painel('2026-10', req()))).toBe(503);
    expect(await statusDe(() => c.arquivo('1', req()))).toBe(503);
    expect(await statusDe(() => c.classificar('1', { versao: 1, itens: [] }, req()))).toBe(503);
    expect(await statusDe(() => c.gerar({ periodo: '2026-10', regime: 'nao_cumulativo' }, req()))).toBe(503);
    expect(await statusDe(() => c.entrega('1', { recibo: 'REC-SINT-1' }, req()))).toBe(503);
    // A entrada inválida é recusada antes (400), sem chegar ao banco.
    expect(await statusDe(() => c.painel('10/2026', req()))).toBe(400);
    expect(await statusDe(() => c.arquivo('x', req()))).toBe(400);
  });

  it('na fonte sintética, sem banco, a competência responde pela memória com a receita zerada', async () => {
    vi.stubEnv('AMBIENTE', 'dev');
    vi.stubEnv('ACESSO_FONTE_DEV', 'sintetica');
    const c = new EscrituracaoEfdController(armazemFinanceiroMemoria(), null);
    const p = (await c.painel('2026-10', req())) as { receitas: { naoCumulativo: { notas: number } } };
    expect(p.receitas.naoCumulativo.notas).toBe(0);
  });
});
