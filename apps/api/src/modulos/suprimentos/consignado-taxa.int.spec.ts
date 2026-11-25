// Integração da taxa de comercialização do consignado por faixa (05-SUP linha 24) contra o MariaDB real (cliente f22_o3).
// Contrato de efeito: a tabela geral gravada (uma linha por faixa em faixa_taxa_consignacao, versão 1, criado_em e
// criado_por, a trilha e a chave em idempotencia_operacao), o reenvio pela chave sem linha nova, a tabela nova do mesmo
// escopo fechando a vigente na véspera (nada apagado, versão 2), a futura não cobrada substituída (inativa), a do fornecedor valendo acima da geral no cálculo, a
// recusa da tabela com buraco e a do outro estabelecimento sem nada. Massa SINTÉTICA (estabelecimentos e fornecedor
// fictícios), limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { OPERACAO_TAXA_CONSIGNACAO, PortaTaxaConsignacaoPropria } from './consignado-taxa.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_DB = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CODIGOS = ['c1014a', 'c1014b'];

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const somaDia = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

describe.skipIf(SEM_DB)('taxa do consignado por faixa contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTaxaConsignacaoPropria;
  let estA = 0;
  let estB = 0;
  let usuario = 0;
  let fornecedor = 0;
  let hoje = '';
  let ctxA: ContextoPortaM18;
  let ctxB: ContextoPortaM18;
  const sufixo = String(Date.now()).slice(-8);
  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1014-conta' }, (l) => l.consultar<T>(sql, p));

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1014-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar('DELETE FROM faixa_taxa_consignacao WHERE estabelecimento_id = ?', [est]);
      }
      await limparTrilhaDaMassa(e, { codigos: CODIGOS });
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1014-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, agora],
        );
      estA = await est(CODIGOS[0]!);
      estB = await est(CODIGOS[1]!);
      usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['c1014.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c1014.teste', 'Usuário fictício da taxa do consignado', agora],
      );
      fornecedor = await garantir(
        e,
        'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
        ['00101401000114'],
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, ?, ?)",
        ['00101401000114', 'DISTRIBUIDORA FICTÍCIA C1014 LTDA', agora],
      );
      const [h] = await e.consultar<{ d: string }>("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS d", []);
      hoje = String(h?.d);
    });
    porta = new PortaTaxaConsignacaoPropria(nucleo);
    const correlacao = `c1014-${sufixo}`;
    ctxA = { cliente: CLIENTE, estabelecimento: estA, usuario, correlacao };
    ctxB = { cliente: CLIENTE, estabelecimento: estB, usuario, correlacao };
    await limpar();
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  const GERAL = [
    { valorInicial: 0, valorFinal: 1000, percentual: 30, teto: null },
    { valorInicial: 1000, valorFinal: null, percentual: 10, teto: 500 },
  ];

  it('grava a tabela geral (uma linha por faixa, auditoria, trilha e chave) e o reenvio não duplica', async () => {
    const chave = `c1014-geral-${sufixo}`;
    const e = { fornecedor: null, inicio: hoje, faixas: GERAL };
    const r = await porta.gravar(ctxA, e, chave);
    expect(r.ids).toHaveLength(2);
    const linhas = await ler(
      `SELECT valor_inicial, valor_final, percentual, teto_cobranca, versao, criado_por, criado_em, vigencia_fim,
              empresa_fornecedora_id
         FROM faixa_taxa_consignacao WHERE estabelecimento_id = ? ORDER BY valor_inicial`,
      [estA],
    );
    expect(linhas).toHaveLength(2);
    expect(linhas.map((x) => Number(x['percentual']))).toEqual([30, 10]);
    expect(Number(linhas[1]!['teto_cobranca'])).toBe(500);
    expect(linhas[1]!['valor_final']).toBeNull();
    for (const x of linhas) {
      expect(Number(x['versao'])).toBe(1);
      expect(Number(x['criado_por'])).toBe(usuario);
      expect(x['criado_em']).not.toBeNull();
      expect(x['vigencia_fim']).toBeNull();
      expect(x['empresa_fornecedora_id']).toBeNull();
    }
    const [t] = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'faixa_taxa_consignacao' AND entidade_id = ?",
      [r.ids[0]],
    );
    expect(Number(t?.['n'])).toBeGreaterThanOrEqual(1);
    const [i] = await ler(
      'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = ? AND estabelecimento_id = ?',
      [OPERACAO_TAXA_CONSIGNACAO, estA],
    );
    expect(Number(i?.['n'])).toBe(1);
    // Reenvio com a mesma chave e a mesma entrada: o mesmo resultado, nenhuma linha nova.
    expect(await porta.gravar(ctxA, e, chave)).toEqual(r);
    const [c] = await ler('SELECT COUNT(*) AS n FROM faixa_taxa_consignacao WHERE estabelecimento_id = ?', [
      estA,
    ]);
    expect(Number(c?.['n'])).toBe(2);
    // O cálculo pela tabela geral, com o teto.
    expect(await porta.calcular(ctxA, fornecedor, 999, null)).toMatchObject({
      origem: 'geral',
      taxa: 299.7,
      total: 1298.7,
    });
    expect(await porta.calcular(ctxA, null, 20000, null)).toMatchObject({ taxaBruta: 2000, taxa: 500 });
  });

  it('a tabela do fornecedor vale acima da geral; a nova do mesmo escopo fecha a vigente na véspera', async () => {
    const inicio = somaDia(hoje, 1);
    await porta.gravar(
      ctxA,
      {
        fornecedor,
        inicio: hoje,
        faixas: [{ valorInicial: 0, valorFinal: null, percentual: 20, teto: null }],
      },
      `c1014-forn1-${sufixo}`,
    );
    expect(await porta.calcular(ctxA, fornecedor, 100, null)).toMatchObject({
      origem: 'fornecedor',
      taxa: 20,
    });
    const nova = await porta.gravar(
      ctxA,
      { fornecedor, inicio, faixas: [{ valorInicial: 0, valorFinal: null, percentual: 12.5, teto: null }] },
      `c1014-forn2-${sufixo}`,
    );
    expect(nova.ids).toHaveLength(1);
    const linhas = await ler(
      `SELECT percentual, versao, vigencia_inicio, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, alterado_por
         FROM faixa_taxa_consignacao WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? ORDER BY id`,
      [estA, fornecedor],
    );
    // Nada apagado: a antiga fica com o fim na véspera (hoje) e versão 2; a nova vale de amanhã em diante.
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ fim: hoje });
    expect(Number(linhas[0]!['versao'])).toBe(2);
    expect(Number(linhas[0]!['alterado_por'])).toBe(usuario);
    expect(linhas[1]!['fim']).toBeNull();
    expect(await porta.calcular(ctxA, fornecedor, 100, hoje)).toMatchObject({ percentual: 20 });
    expect(await porta.calcular(ctxA, fornecedor, 100, inicio)).toMatchObject({
      percentual: 12.5,
      taxa: 12.5,
    });
    const t = await porta.tabelas(ctxA, fornecedor);
    expect(t.origem).toBe('fornecedor');
    expect(t.historico.filter((f) => f.fornecedor === fornecedor)).toHaveLength(2);
    // Outra tabela do mesmo fornecedor na mesma data da futura (agendada errada, sem cobrança): substitui a futura,
    // que fica inativa (versão 2, nada apagado); a de hoje continua fechada na véspera da nova.
    const troca = await porta.gravar(
      ctxA,
      { fornecedor, inicio, faixas: [{ valorInicial: 0, valorFinal: null, percentual: 1, teto: null }] },
      `c1014-forn3-${sufixo}`,
    );
    const depois = await ler(
      `SELECT id, percentual, ativo, versao, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim
         FROM faixa_taxa_consignacao WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? ORDER BY id`,
      [estA, fornecedor],
    );
    expect(depois).toHaveLength(3);
    expect(depois[0]).toMatchObject({ fim: hoje });
    expect(Number(depois[1]!['ativo'])).toBe(0);
    expect(Number(depois[1]!['versao'])).toBe(2);
    expect(Number(depois[2]!['id'])).toBe(troca.ids[0]);
    expect(await porta.calcular(ctxA, fornecedor, 100, inicio)).toMatchObject({ percentual: 1, taxa: 1 });
  });

  it('recusa a tabela com buraco e o fornecedor inexistente; o outro estabelecimento não vê nada', async () => {
    await expect(
      porta.gravar(
        ctxA,
        {
          fornecedor: null,
          inicio: somaDia(hoje, 3),
          faixas: [
            { valorInicial: 0, valorFinal: 100, percentual: 5, teto: null },
            { valorInicial: 200, valorFinal: null, percentual: 4, teto: null },
          ],
        },
        `c1014-buraco-${sufixo}`,
      ),
    ).rejects.toThrow(/faixas-com-buraco/);
    await expect(
      porta.gravar(ctxA, { fornecedor: 999_999_999, inicio: hoje, faixas: GERAL }, `c1014-semforn-${sufixo}`),
    ).rejects.toThrow(/fornecedor-inexistente/);
    const b = await porta.tabelas(ctxB, fornecedor);
    expect(b).toMatchObject({ origem: 'sem-tabela', vigentes: [], historico: [] });
    expect(await porta.calcular(ctxB, fornecedor, 100, null)).toMatchObject({ taxa: 0, total: 100 });
  });
});
