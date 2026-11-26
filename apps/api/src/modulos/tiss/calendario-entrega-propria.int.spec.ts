// Contrato de efeito do cadastro do calendário de entrega por convênio (06-FAT linha 31) contra o MariaDB real. Massa
// SINTÉTICA com códigos "C1130K" (nenhum dado real):
//   - incluir grava a janela em calendario_entrega_fatura (competência no dia 1, entrega, pagamento, prazo, restritiva,
//     ativa, autoria) e a trilha; a lista devolve o pagamento calculado e a situação;
//   - a regra do domínio recusa sem gravar: entrega antes da competência, janela sobreposta na mesma competência,
//     convênio inexistente;
//   - alterar sobe a versão e grava alterado_por; a versão velha é recusada;
//   - inativar nunca apaga (some da lista padrão e fica com `inativas`); incluir de novo a mesma competência e início
//     reativa a mesma linha.
// No fim, a massa e a trilha do estabelecimento sintético são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CalendarioEntregaProprio } from './calendario-entrega-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C1130K';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function codigoDoErro(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const q = (e as { problema?: { codigo?: string } }).problema;
    return String(q?.codigo ?? (e as { codigo?: string }).codigo ?? (e as Error).message);
  }
  throw new Error('a gravação devia ter sido recusada');
}

describe.skipIf(SEM_BANCO)('calendário de entrega por convênio na fonte própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let cal: CalendarioEntregaProprio;
  const ids = { est: 0, usuario: 0, fonte: 0, janela: 0 };
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: ids.usuario,
    correlacao: 'teste-c1130k',
    chaveIdempotencia: `c1130k-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctx = () => ({ cliente: CLIENTE, estabelecimento: ids.est, correlacao: 'teste-c1130k' });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c1130k' }, fn);
  const linhas = () =>
    escrever((e) =>
      e.consultar<Record<string, unknown>>(
        `SELECT id, DATE_FORMAT(competencia, '%Y-%m-%d') AS competencia, DATE_FORMAT(entrega_inicio, '%Y-%m-%d') AS inicio,
                DATE_FORMAT(entrega_fim, '%Y-%m-%d') AS fim, DATE_FORMAT(pagamento_previsto, '%Y-%m-%d') AS pagamento,
                prazo_pagamento_dias AS prazo, restritivo, ativo, observacao, versao, criado_por, alterado_por
           FROM calendario_entrega_fatura WHERE estabelecimento_id = ? ORDER BY id`,
        [ids.est],
      ),
    );
  const base = {
    competencia: '2031-03',
    inicio: '2031-04-05',
    fim: '2031-04-10',
    pagamentoPrevisto: null,
    prazoPagamentoDias: 30,
    restritivo: true,
    observacao: 'Entrega no portal',
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    cal = new CalendarioEntregaProprio(nucleo);
    await escrever(async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [`faturista.${P.toLowerCase()}`],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [`faturista.${P.toLowerCase()}`, `FATURISTA ${P} SINTETICO`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999997', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      await e.executar('DELETE FROM calendario_entrega_fatura WHERE estabelecimento_id = ?', [ids.est]);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await e.executar('DELETE FROM calendario_entrega_fatura WHERE estabelecimento_id = ?', [ids.est]);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('incluir grava a janela com a autoria e a trilha; a lista traz o pagamento calculado', async () => {
    const r = await cal.gravar('incluir', op(), { convenio: ids.fonte, ...base });
    expect(r).toMatchObject({ versao: 1, reativada: false });
    ids.janela = Number(r['id']);
    const ls = await linhas();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({
      id: ids.janela,
      competencia: '2031-03-01',
      inicio: '2031-04-05',
      fim: '2031-04-10',
      pagamento: null,
      prazo: 30,
      restritivo: 1,
      ativo: 1,
      observacao: 'Entrega no portal',
      versao: 1,
      criado_por: ids.usuario,
    });
    const lista = await cal.listar(ctx(), { convenios: [ids.fonte], inativas: false });
    expect(lista).toEqual([
      expect.objectContaining({
        id: ids.janela,
        convenio: ids.fonte,
        convenioNome: `OPERADORA SINTETICA ${P}`,
        competencia: '2031-03-01',
        pagamentoCalculado: '2031-05-10',
        restritivo: true,
        ativo: true,
        situacao: 'futura',
      }),
    ]);
    const trilha = await escrever((e) =>
      e.consultar<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'calendario_entrega_fatura' AND entidade_id = ?",
        [String(ids.janela)],
      ),
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it('a regra do domínio recusa sem gravar: antes da competência, sobreposta e convênio inexistente', async () => {
    expect(
      await codigoDoErro(
        cal.gravar('incluir', op(), {
          convenio: ids.fonte,
          ...base,
          inicio: '2031-02-20',
          fim: '2031-03-02',
        }),
      ),
    ).toBe('entrega-antes-da-competencia');
    expect(
      await codigoDoErro(
        cal.gravar('incluir', op(), {
          convenio: ids.fonte,
          ...base,
          inicio: '2031-04-08',
          fim: '2031-04-12',
        }),
      ),
    ).toBe('janela-sobreposta');
    expect(
      await codigoDoErro(
        cal.gravar('incluir', op(), { convenio: 999_999_999, ...base, competencia: '2031-05' }),
      ),
    ).toBe('convenio-inexistente');
    expect(await linhas()).toHaveLength(1);
  });

  it('alterar sobe a versão com alterado_por; a versão velha é recusada', async () => {
    const r = await cal.gravar('alterar', op(), {
      ...base,
      id: ids.janela,
      versao: 1,
      fim: '2031-04-12',
      pagamentoPrevisto: '2031-05-20',
      restritivo: false,
    });
    expect(r).toMatchObject({ id: ids.janela, versao: 2 });
    expect((await linhas())[0]).toMatchObject({
      fim: '2031-04-12',
      pagamento: '2031-05-20',
      restritivo: 0,
      versao: 2,
      alterado_por: ids.usuario,
    });
    expect(await codigoDoErro(cal.gravar('alterar', op(), { ...base, id: ids.janela, versao: 1 }))).toMatch(
      /conflito|versao/,
    );
    expect((await linhas())[0]).toMatchObject({ versao: 2 });
  });

  it('inativar nunca apaga; incluir de novo a mesma janela reativa a mesma linha', async () => {
    await cal.gravar('inativar', op(), { id: ids.janela, versao: 2 });
    let ls = await linhas();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ ativo: 0, versao: 3 });
    expect(await cal.listar(ctx(), { convenios: [ids.fonte], inativas: false })).toEqual([]);
    expect(await cal.listar(ctx(), { convenios: [ids.fonte], inativas: true })).toHaveLength(1);
    expect(await codigoDoErro(cal.gravar('inativar', op(), { id: ids.janela, versao: 3 }))).toBe(
      'janela-inativa',
    );

    const r = await cal.gravar('incluir', op(), { convenio: ids.fonte, ...base });
    expect(r).toMatchObject({ id: ids.janela, reativada: true, versao: 4 });
    ls = await linhas();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ ativo: 1, fim: '2031-04-10', restritivo: 1, versao: 4 });
    expect(await cal.convenioDaJanela(ctx(), ids.janela)).toBe(ids.fonte);
  });
});
