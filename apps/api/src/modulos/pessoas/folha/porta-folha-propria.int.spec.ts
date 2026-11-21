// Lotes trocados com a folha externa sobre o MariaDB real (lote_folha_intercambio e o resumo), no cliente de teste do
// lote (SGH_CLIENTE_TESTE; padrão f24p_folha, criado por tools/db/criar_cliente.py se faltar). Massa sintética: só a
// competência 2099-0x, apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../../exames/public-api.js';
import { PortaFolhaPropria } from './porta-folha-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f24p_folha';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../../..');
const COMPETENCIA = '2099-03';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO)('lotes da folha externa sobre o MariaDB', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFolhaPropria;
  let c: ContextoPortaM18;
  let est = 0;
  let usuario = 0;
  const trilha = (id: number): TrilhaDaGravacao => ({
    estabelecimento: est,
    usuario,
    acao: 'inclusao',
    entidade: 'lote_folha_intercambio',
    entidadeId: id,
    correlacao: 'int-lote-folha',
  });

  async function limpar() {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-lote-folha' }, async (e) => {
      await e.executar(
        `DELETE r FROM lote_folha_intercambio_resumo r
           JOIN lote_folha_intercambio l ON l.id = r.lote_folha_intercambio_id WHERE l.competencia >= '2099-01-01'`,
      );
      await e.executar(
        "UPDATE lote_folha_intercambio SET lote_exportado_id = NULL WHERE competencia >= '2099-01-01'",
      );
      await e.executar("DELETE FROM lote_folha_intercambio WHERE competencia >= '2099-01-01'");
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE tipo = 'lote_folha_intercambio' AND estabelecimento_id = ?",
        [est],
      );
    });
  }

  beforeAll(async () => {
    const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
      cwd: RAIZ,
      encoding: 'utf8',
    });
    if (!lista.split('\n').some((l) => l.split('\t').includes(CLIENTE)))
      execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.4 folha'], {
        cwd: RAIZ,
      });
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-lote-folha' }, async (e) => {
      const r = await e.uma<{ id: number }>("SELECT id FROM estabelecimento WHERE codigo = 'f24pf'");
      est = r
        ? Number(r.id)
        : await e.inserir(
            "INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES ('f24pf', 'ESTAB SINTETICO FOLHA', 'ESTAB SINTETICO FOLHA', NOW(3))",
            [],
          );
      const u = await e.uma<{ id: number }>("SELECT id FROM usuario WHERE login = 'f24p-folha-teste'");
      usuario = u
        ? Number(u.id)
        : await e.inserir(
            "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES ('f24p-folha-teste', 'Teste da folha', 'servico', NOW(3))",
            [],
          );
    });
    expect(est).toBeGreaterThan(0);
    c = { cliente: CLIENTE, estabelecimento: est, usuario, correlacao: 'int-lote-folha' };
    porta = new PortaFolhaPropria(nucleo, { cifrar: (x) => `cifrado:${x.length}` });
    await limpar();
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  const novo = (id: number, sentido: 'exportado' | 'recebido', loteExportado: number | null) => ({
    id,
    empresa: est,
    competencia: COMPETENCIA,
    sentido,
    loteExportado,
    leiaute: 'v1',
    situacao: sentido === 'exportado' ? 'gerado' : 'conferido',
    colaboradores: 2,
    // Exportado: minutos (ponto mais plantão); recebido: centavos (líquido mais encargos), gravados em reais.
    soma: sentido === 'exportado' ? 1234 : 123_450,
    totais: JSON.stringify({ colaboradores: 2 }),
    vinculos: sentido === 'exportado' ? JSON.stringify([[1, null]]) : null,
    divergencias: sentido === 'recebido' ? '[]' : null,
    resumo: 'a'.repeat(64),
    geradoEm: '2099-03-05T10:20:30',
    por: 'teste',
  });

  /** Linhas cruas do banco (para conferir a unidade gravada, não só a ida e volta pela porta). */
  const cru = (sql: string, p: unknown[]) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'leitura-crua-lote-folha' }, (e) => e.consultar(sql, p));
  const trilhas = async () =>
    Number(
      (await cru('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [est]))[0]?.['n'],
    );

  it('número do lote pela sequência, inclusão do exportado e do retorno, resumo e releitura', async () => {
    const trilhas0 = await trilhas();
    const r = await porta.gravarSgh(
      c,
      (x: { exp: number }) => trilha(x.exp),
      async (g) => {
        const exp = await g.proximoIdLote();
        await g.incluirLote(novo(exp, 'exportado', null));
        const ret = await g.proximoIdLote();
        expect(ret).toBeGreaterThan(exp);
        await g.incluirLote(novo(ret, 'recebido', exp));
        const linhas = await g.incluirResumo({
          interface: ret,
          empresa: est,
          competencia: COMPETENCIA,
          linhas: [
            { vinculo: null, centroCusto: null, rubrica: 'inss', valor: 10_025, vencimento: '2099-04-20' },
            { vinculo: null, centroCusto: null, rubrica: 'fgts', valor: 8_000, vencimento: '2099-04-07' },
          ],
        });
        expect(linhas).toBe(2);
        expect(await g.resumo(ret)).toEqual([
          { vinculo: null, centroCusto: null, rubrica: 'inss', valor: 10_025 },
          { vinculo: null, centroCusto: null, rubrica: 'fgts', valor: 8_000 },
        ]);
        expect(await g.lotesDaCompetencia(est, COMPETENCIA)).toHaveLength(2);
        return { exp, ret };
      },
    );
    const exp = await porta.lote(c, r.exp);
    expect(exp).toMatchObject({
      id: r.exp,
      empresa: est,
      competencia: COMPETENCIA,
      sentido: 'exportado',
      loteExportado: null,
      situacao: 'gerado',
      soma: 1234,
      geradoEm: '2099-03-05T10:20:30',
      vinculos: '[[1, null]]'.replace(' ', ''),
    });
    expect(JSON.parse(exp!.totais)).toEqual({ colaboradores: 2 });
    const ret = await porta.lote(c, r.ret);
    expect(ret).toMatchObject({
      soma: 123_450,
      sentido: 'recebido',
      loteExportado: r.exp,
      situacao: 'conferido',
      vinculos: null,
    });
    const lotes = await porta.lotes(c, { empresa: est, competencia: COMPETENCIA });
    expect(lotes.map((l) => l.id)).toEqual([r.ret, r.exp]);
    expect(lotes[0]).not.toHaveProperty('vinculos');
    // No banco: valores em reais (DECIMAL), como os títulos e os fatos; a soma do exportado em minutos. Uma trilha.
    const somas = await cru(
      'SELECT numero, sentido, soma FROM lote_folha_intercambio WHERE estabelecimento_id = ? AND numero IN (?, ?) ORDER BY numero',
      [est, r.exp, r.ret],
    );
    expect(somas.map((x) => [x['sentido'], Number(x['soma'])])).toEqual([
      ['exportado', 1234],
      ['recebido', 1234.5],
    ]);
    const resumo = await cru(
      `SELECT r.sequencia, r.rubrica, r.valor, r.vencimento FROM lote_folha_intercambio_resumo r
         JOIN lote_folha_intercambio l ON l.id = r.lote_folha_intercambio_id
        WHERE l.estabelecimento_id = ? AND l.numero = ? ORDER BY r.sequencia`,
      [est, r.ret],
    );
    expect(resumo.map((x) => [Number(x['sequencia']), x['rubrica'], Number(x['valor'])])).toEqual([
      [1, 'inss', 100.25],
      [2, 'fgts', 80],
    ]);
    expect(await trilhas()).toBe(trilhas0 + 1);
    expect(await porta.lotes(c, { empresa: est + 100_000 })).toEqual([]);
    expect(await porta.competenciaLancada(c, est, COMPETENCIA)).toBe(false);

    // Troca de situação com a esperada; a esperada errada é recusada; o lançado marca a competência.
    await porta.gravarSgh(c, trilha(r.exp), (g) =>
      g.situacaoLote({ id: r.exp, de: ['gerado'], para: 'substituido', por: 'teste' }),
    );
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(r.exp), (g) =>
          g.situacaoLote({ id: r.exp, de: ['gerado'], para: 'cancelado', por: 'teste' }),
        ),
      ),
    ).toBe('desatualizado');
    await porta.gravarSgh(c, trilha(r.ret), (g) =>
      g.situacaoLote({ id: r.ret, de: ['conferido'], para: 'lancado', por: 'teste' }),
    );
    expect(await porta.competenciaLancada(c, est, COMPETENCIA)).toBe(true);
    expect((await porta.lote(c, r.exp))?.situacao).toBe('substituido');
  });

  it('recusas: número repetido, retorno de exportado inexistente e empresa de fora', async () => {
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(0), async (g) => {
          const id = await g.proximoIdLote();
          await g.incluirLote(novo(id, 'exportado', null));
          await g.incluirLote(novo(id, 'exportado', null));
        }),
      ),
    ).toBe('lote-repetido');
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(0), async (g) => {
          const id = await g.proximoIdLote();
          await g.incluirLote(novo(id, 'recebido', 999_999_999));
        }),
      ),
    ).toBe('lote-inexistente');
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(0), async (g) => {
          const id = await g.proximoIdLote();
          await g.incluirLote({ ...novo(id, 'exportado', null), empresa: est + 100_000 });
        }),
      ),
    ).toBe('empresa-fora-da-sessao');
  });
});
