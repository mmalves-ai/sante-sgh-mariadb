// Integração da porta PRÓPRIA do consignado contra o MariaDB real (cliente f22_o3 da onda 3). Contrato de efeito: a
// remessa (cabeçalho pela nota do fornecedor, item, número da sequência, versão 1, trilha e a chave do pedido em
// idempotencia_operacao), o reenvio pela chave sem linha nova, a segunda entrega igual da mesma nota com outra chave
// gravada como linha nova (não descartada), a devolução ao fornecedor com o saldo relido travado, a chave reusada com
// outra entrada ou noutro estabelecimento recusada (idempotencia-divergente), o outro estabelecimento sem nada.
// Massa SINTÉTICA (estabelecimentos, fornecedor, insumo e local fictícios), reaproveitada; os movimentos são limpos.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { CLASSE_OPME } from '@sgh/contratos';
import { type Escritor, garantirSequencia, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import type { LinhaMovimentoConsignado } from './consignado-porta.js';
import { OPERACAO_CHAVE_CONSIGNADO, PortaConsignadoPropria } from './consignado-porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const SEM_DB = SEM_BANCO;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const linha = (x: Partial<LinhaMovimentoConsignado>): LinhaMovimentoConsignado => ({
  tipo: 'remessa',
  quantidade: 3,
  consumo: null,
  nfNumero: '913001',
  nfSerie: '1',
  nfEmissao: '2026-11-01',
  nfEntrada: null,
  lote: 'LT-F2213',
  serie: null,
  validade: '2028-12-31',
  motivo: null,
  ...x,
});

/** As entradas dos pedidos (o corpo validado que o controlador passa; o reenvio tem de repetir o mesmo). */
const PEDIDO_REMESSA = { tipo: 'remessa', quantidade: 3, nfNumero: '913001', lote: 'LT-F2213' } as const;
const PEDIDO_DEVOLUCAO = {
  tipo: 'devolucao',
  quantidade: 1,
  motivo: 'Material com embalagem violada (teste)',
} as const;

describe.skipIf(SEM_DB)('porta própria do consignado contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaConsignadoPropria;
  let estA = 0;
  let estB = 0;
  let usuario = 0;
  let fornecedor = 0;
  let item = 0;
  let ctxA: ContextoPortaM18;
  let ctxB: ContextoPortaM18;
  let remessa = 0;
  const correlacao = `f22-0313-${Date.now()}`;
  const sufixo = String(Date.now()).slice(-6);

  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0313-conta' }, (l) => l.uma<T>(sql, p));
  const trilha =
    (entidade: string): ((r: { grupo: number }) => TrilhaDaGravacao) =>
    (r) => ({
      estabelecimento: estA,
      usuario,
      acao: 'operacao',
      entidade,
      entidadeId: r.grupo,
      dadosDepois: { evento: 'teste' },
      correlacao,
    });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0313-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar('DELETE FROM reposicao_consignada WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          `DELETE i FROM remessa_consignada_item i JOIN remessa_consignada r ON r.id = i.remessa_consignada_id
            WHERE r.estabelecimento_id = ?`,
          [est],
        );
        await e.executar('DELETE FROM remessa_consignada WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          "DELETE FROM idempotencia_operacao WHERE operacao LIKE 'consignado.%' AND estabelecimento_id = ?",
          [est],
        );
      }
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0313-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, agora],
        );
      estA = await est('f2213a');
      estB = await est('f2213b');
      usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f22.0313.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f22.0313.teste', 'Usuário fictício do lote 03-13', agora],
      );
      fornecedor = await garantir(
        e,
        'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
        ['00913013000113'],
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, ?, ?)",
        ['00913013000113', 'DISTRIBUIDORA FICTÍCIA 0313 LTDA', agora],
      );
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_insumo WHERE codigo = ?',
        ['F2213-OPME'],
        "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'opme', ?)",
        ['F2213-OPME', 'OPME fictício do lote 03-13', agora],
      );
      const unidade = await garantir(
        e,
        'SELECT id FROM unidade_medida WHERE codigo = ?',
        ['F2213-UN'],
        'INSERT INTO unidade_medida (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
        ['F2213-UN', 'Unidade fictícia', 'UNF', agora],
      );
      item = await garantir(
        e,
        'SELECT id FROM insumo WHERE codigo = ?',
        ['F2213-PLACA'],
        `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, opme, consignado, criado_em)
         VALUES (?, ?, 'opme', ?, ?, TRUE, TRUE, ?)`,
        ['F2213-PLACA', 'PLACA FICTÍCIA F2213', grupo, unidade, agora],
      );
      await garantir(
        e,
        "SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = 'F2213-CONSIG'",
        [estA],
        "INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'F2213-CONSIG', ?, 'consignado', ?)",
        [estA, 'Consignado fictício', agora],
      );
      for (const tipo of ['remessa_consignada', 'reposicao_consignada'])
        await garantirSequencia(e, { tipo, estabelecimento: estA }, { usuario: null, agora });
    });
    porta = new PortaConsignadoPropria(nucleo);
    ctxA = { cliente: CLIENTE, estabelecimento: estA, usuario, correlacao };
    ctxB = { cliente: CLIENTE, estabelecimento: estB, usuario, correlacao };
    await limpar();
  });
  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('o cadastro: fornecedor ativo, item OPME consignado, a busca e os nomes', async () => {
    expect(await porta.fornecedorExiste(ctxA, fornecedor)).toBe(true);
    expect(await porta.fornecedorExiste(ctxA, 2_000_000_000)).toBe(false);
    expect(await porta.classeDoItem(ctxA, item)).toBe(CLASSE_OPME);
    expect(await porta.classeDoItem(ctxA, 2_000_000_000)).toBeNull();
    expect(await porta.referenciaConsignada(ctxA, item)).toBe(true);
    const b = await porta.buscarItens(ctxA, 'PLACA FICTÍCIA F2213');
    expect(b.find((x) => x.codigo === item)).toMatchObject({ unidade: 'UNF', consignado: true, ativo: true });
    const n = await porta.nomes(ctxA, [fornecedor], [item]);
    expect(n.fornecedores.get(fornecedor)).toBe('DISTRIBUIDORA FICTÍCIA 0313 LTDA');
    expect(n.itens.get(item)).toBe('PLACA FICTÍCIA F2213');
    expect(await porta.notasEntrada(ctxA, fornecedor, item)).toEqual([]);
    expect(await porta.notaEntrada(ctxA, { ano: 2026, mes: 11, doc: 2_000_000_000 }, item)).toBeNull();
    expect((await porta.consumos(ctxA, fornecedor)).itens).toEqual([]);
    expect(Array.isArray(await porta.saldoCadastro(ctxA))).toBe(true);
  });

  it('a remessa: cabeçalho pela nota, item, número, versão 1, trilha e a chave guardada; o reenvio não duplica', async () => {
    const chave = `f22-0313-rem-${sufixo}`;
    const r = await porta.gravarSgh(ctxA, trilha('remessa_consignada'), (g) =>
      g.gravar({ fornecedor, item, usuario: 'teste', chave, pedido: PEDIDO_REMESSA, linhas: [linha({})] }),
    );
    expect(r.repetido).toBe(false);
    remessa = r.grupo;
    const cab = await ler(
      `SELECT r.versao, r.numero, r.situacao, l.tipo AS tipo_local, COUNT(i.id) AS itens, SUM(i.quantidade) AS qtd
         FROM remessa_consignada r JOIN local_estoque l ON l.id = r.local_estoque_id
         JOIN remessa_consignada_item i ON i.remessa_consignada_id = r.id
        WHERE r.id = ? GROUP BY r.id`,
      [remessa],
    );
    expect(cab).toMatchObject({ situacao: 'aberta', tipo_local: 'consignado' });
    expect(Number(cab?.['versao'])).toBe(1);
    expect(Number(cab?.['numero'])).toBeGreaterThan(0);
    expect(Number(cab?.['itens'])).toBe(1);
    expect(Number(cab?.['qtd'])).toBe(3);
    const t = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'remessa_consignada' AND entidade_id = ? AND correlacao = ?",
      [remessa, correlacao],
    );
    expect(Number(t?.['n'])).toBe(1);
    const i = await ler('SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = ? AND chave = ?', [
      OPERACAO_CHAVE_CONSIGNADO,
      chave,
    ]);
    expect(Number(i?.['n'])).toBe(1);
    // O reenvio pela chave (o fluxo do controlador): o grupo gravado, sem linha nova.
    const de = await porta.gravarSgh(ctxA, trilha('remessa_consignada'), async (g) => {
      const ja = await g.movimentosPelaChave(chave, PEDIDO_REMESSA);
      expect(ja?.map((x) => x.tipo)).toEqual(['remessa']);
      return g.gravar({ fornecedor, item, usuario: 'teste', chave, pedido: PEDIDO_REMESSA, linhas: [] });
    });
    expect(de).toMatchObject({ grupo: remessa, repetido: true });
    // A mesma chave com outra entrada (outra quantidade): recusada, nunca a repetição da remessa antiga.
    await expect(
      porta.gravarSgh(ctxA, trilha('remessa_consignada'), (g) =>
        g.gravar({
          fornecedor,
          item,
          usuario: 'teste',
          chave,
          pedido: { ...PEDIDO_REMESSA, quantidade: 4 },
          linhas: [linha({ quantidade: 4 })],
        }),
      ),
    ).rejects.toThrow(/idempotencia-divergente/);
    // A segunda entrega igual da mesma nota (outra chave): outra linha da remessa, nada descartado.
    const outra = await porta.gravarSgh(ctxA, trilha('remessa_consignada'), (g) =>
      g.gravar({
        fornecedor,
        item,
        usuario: 'teste',
        chave: `${chave}-b`,
        pedido: PEDIDO_REMESSA,
        linhas: [linha({})],
      }),
    );
    expect(outra).toMatchObject({ grupo: remessa, repetido: false });
    const n = await ler(
      'SELECT COUNT(*) AS n, SUM(quantidade) AS q FROM remessa_consignada_item WHERE remessa_consignada_id = ?',
      [remessa],
    );
    expect(Number(n?.['n'])).toBe(2);
    expect(Number(n?.['q'])).toBe(6);
    const ms = await porta.movimentos(ctxA, fornecedor);
    expect(ms.itens.filter((x) => x.tipo === 'remessa')).toHaveLength(2);
    expect(ms.itens[0]).toMatchObject({
      tipo: 'remessa',
      item,
      quantidade: 3,
      nfNumero: '913001',
      usuario: 'f22.0313.teste',
    });
  });

  it('a devolução: o saldo relido travado, a linha gravada e o saldo novo; a chave de outro par é recusada', async () => {
    const chave = `f22-0313-dev-${sufixo}`;
    const r = await porta.gravarSgh(ctxA, trilha('reposicao_consignada'), async (g) => {
      expect(await g.saldoTravado(fornecedor, item, 'teste')).toBe(6);
      return g.gravar({
        fornecedor,
        item,
        usuario: 'teste',
        chave,
        pedido: PEDIDO_DEVOLUCAO,
        linhas: [
          linha({
            tipo: 'devolucao',
            quantidade: 1,
            nfNumero: null,
            nfSerie: null,
            nfEmissao: null,
            motivo: 'Material com embalagem violada (teste)',
          }),
        ],
      });
    });
    expect(r.repetido).toBe(false);
    const d = await ler(
      'SELECT tipo, quantidade, motivo, versao, situacao FROM reposicao_consignada WHERE id = ?',
      [r.movimentos[0]],
    );
    expect(d).toMatchObject({ tipo: 'devolucao', situacao: 'registrada' });
    expect(Number(d?.['quantidade'])).toBe(1);
    expect(Number(d?.['versao'])).toBe(1);
    const s = (await porta.saldos(ctxA, fornecedor)).itens.find((x) => x.item === item);
    expect(s).toMatchObject({ remessas: 6, devolvidos: 1, saldo: 5 });
    await expect(
      porta.gravarSgh(ctxA, trilha('reposicao_consignada'), (g) =>
        g.gravar({
          fornecedor,
          item: item + 1,
          usuario: 'teste',
          chave,
          pedido: { ...PEDIDO_DEVOLUCAO, item: item + 1 },
          linhas: [linha({ tipo: 'devolucao' })],
        }),
      ),
    ).rejects.toThrow(/idempotencia-divergente/);
    // A mesma chave e a mesma entrada noutro estabelecimento: recusada (a chave é do estabelecimento).
    await expect(
      porta.gravarSgh(ctxB, trilha('reposicao_consignada'), async (g) => {
        await g.movimentosPelaChave(chave, PEDIDO_DEVOLUCAO);
        return { grupo: 0 };
      }),
    ).rejects.toThrow(/idempotencia-divergente/);
  });

  it('o outro estabelecimento: nada lido e a remessa recusada sem local consignado', async () => {
    expect((await porta.movimentos(ctxB, fornecedor)).itens).toEqual([]);
    expect((await porta.saldos(ctxB, null)).itens.find((x) => x.item === item)).toBeUndefined();
    await expect(
      porta.gravarSgh(ctxB, trilha('remessa_consignada'), (g) =>
        g.gravar({
          fornecedor,
          item,
          usuario: 'teste',
          chave: `f22-0313-b-${sufixo}`,
          pedido: { ...PEDIDO_REMESSA, nfNumero: '913002' },
          linhas: [linha({ nfNumero: '913002' })],
        }),
      ),
    ).rejects.toThrow(/sem-local-consignado/);
  });
});
