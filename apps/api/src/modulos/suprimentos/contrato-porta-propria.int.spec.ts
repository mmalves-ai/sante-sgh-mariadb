// Integração da porta PRÓPRIA dos contratos com fornecedores contra o MariaDB real (cliente f22_o3 da onda 3). Contrato
// de efeito: o cadastro (contrato_fornecedor vigente, versão 1, gestor e fiscal em gestor_contrato, a garantia, o
// registro do cadastro no histórico, a trilha e a chave em idempotencia_operacao), o reenvio pela chave e a chave
// reusada com outra entrada (idempotencia-divergente), o número repetido, a alteração com a versão (conflito e versão
// 2), o aditivo (ocorrencia_contrato + aditivo_contrato, o valor total e a versão), a avaliação, o vínculo do pedido de
// compra (pedido_compra.contrato_fornecedor_id e o saldo), o encerramento e o outro estabelecimento sem nada.
// Massa SINTÉTICA (estabelecimentos, usuários, fornecedor, centro de custo, índice e pedido fictícios), reaproveitada;
// os contratos são limpos. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { CriarContratoEntrada } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { OPERACAO_CHAVE_CONTRATO, PortaContratoPropria } from './contrato-porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_DB = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const HOJE = '2026-11-21';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_DB)('porta própria dos contratos contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaContratoPropria;
  let estA = 0;
  let estB = 0;
  let usuario = 0;
  let fornecedor = 0;
  let pedido = 0;
  let ctxA: ContextoPortaM18;
  let ctxB: ContextoPortaM18;
  let contrato = 0;
  const correlacao = `f22-0313-ct-${Date.now()}`;
  const sufixo = String(Date.now()).slice(-6);

  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0313-ct-conta' }, (l) => l.uma<T>(sql, p));
  const trilha = (r: unknown): TrilhaDaGravacao => ({
    estabelecimento: estA,
    usuario,
    acao: 'operacao',
    entidade: 'contrato_fornecedor',
    entidadeId: Number(
      (r as { id?: number; contrato?: number }).id ?? (r as { contrato?: number }).contrato ?? 0,
    ),
    dadosDepois: { evento: 'teste' },
    correlacao,
  });
  const entrada = (x: Partial<CriarContratoEntrada> = {}): CriarContratoEntrada => ({
    chave: `f22-0313-ct-${sufixo}`,
    numero: `CT-${sufixo}`,
    fornecedor,
    tipo: 'fornecimento',
    objeto: 'Fornecimento fictício de material de teste',
    critico: true,
    inicio: '2026-01-01',
    fim: '2027-12-31',
    valor: 10_000,
    indiceReajuste: 'ipca',
    dataBase: '2026-01-01',
    garantia: 'seguro',
    garantiaValor: 500,
    garantiaValidade: '2027-12-31',
    gestor: 'f22.0313.gestor',
    fiscal: 'f22.0313.fiscal',
    centroCusto: null,
    observacao: 'Observação fictícia',
    ...x,
  });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0313-ct-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        const sub = 'SELECT id FROM contrato_fornecedor WHERE estabelecimento_id = ?';
        await e.executar(
          `UPDATE pedido_compra SET contrato_fornecedor_id = NULL WHERE contrato_fornecedor_id IN (${sub})`,
          [est],
        );
        for (const t of [
          'ocorrencia_contrato',
          'aditivo_contrato',
          'reajuste_contrato',
          'anexo_contrato',
          'garantia_contrato',
          'gestor_contrato',
        ])
          await e.executar(`DELETE FROM ${t} WHERE contrato_fornecedor_id IN (${sub})`, [est]);
        await e.executar('DELETE FROM contrato_fornecedor WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          "DELETE FROM idempotencia_operacao WHERE operacao LIKE 'contrato.%' AND estabelecimento_id = ?",
          [est],
        );
      }
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0313-ct-massa' }, async (e) => {
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
      const pessoa = (login: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
          [login, nome, agora],
        );
      usuario = await pessoa('f22.0313.gestor', 'GESTOR FICTÍCIO 0313');
      await pessoa('f22.0313.fiscal', 'FISCAL FICTÍCIO 0313');
      await pessoa('f22.0313.fiscal2', 'FISCAL FICTÍCIO 0313 DOIS');
      fornecedor = await garantir(
        e,
        'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
        ['00913013000113'],
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, ?, ?)",
        ['00913013000113', 'DISTRIBUIDORA FICTÍCIA 0313 LTDA', agora],
      );
      await garantir(
        e,
        "SELECT id FROM indice_reajuste WHERE codigo = 'IPCA'",
        [],
        "INSERT INTO indice_reajuste (codigo, descricao, criado_em) VALUES ('IPCA', 'IPCA (teste)', ?)",
        [agora],
      );
      const centro = await garantir(
        e,
        "SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = 'F2213-CC'",
        [estA],
        "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, 'F2213-CC', 'SETOR FICTÍCIO', '2026-01-01', ?)",
        [estA, agora],
      );
      pedido = await garantir(
        e,
        'SELECT id FROM pedido_compra WHERE estabelecimento_id = ? AND ano = 2026 AND numero = 913013',
        [estA],
        `INSERT INTO pedido_compra (estabelecimento_id, ano, numero, empresa_fornecedora_id, centro_custo_id, data_pedido,
                                    valor_total, criado_em) VALUES (?, 2026, 913013, ?, ?, '2026-10-01', 1200, ?)`,
        [estA, fornecedor, centro, agora],
      );
    });
    porta = new PortaContratoPropria(nucleo, undefined, () => HOJE);
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

  it('o cadastro: contrato vigente, gestor e fiscal, garantia, histórico, trilha e chave; o reenvio e a chave divergente', async () => {
    const x = entrada();
    const r = await porta.gravarSgh(ctxA, trilha, (g) => g.criar({ entrada: x, usuario: 'teste' }));
    expect(r.repetido).toBe(false);
    contrato = r.id;
    const c = await ler(
      `SELECT situacao, versao, valor_global, vigencia_fim, indice_reajuste_id IS NOT NULL AS com_indice,
              (SELECT COUNT(*) FROM gestor_contrato g WHERE g.contrato_fornecedor_id = c.id) AS papeis,
              (SELECT modalidade FROM garantia_contrato g WHERE g.contrato_fornecedor_id = c.id) AS garantia,
              (SELECT COUNT(*) FROM ocorrencia_contrato o WHERE o.contrato_fornecedor_id = c.id) AS historico
         FROM contrato_fornecedor c WHERE c.id = ?`,
      [contrato],
    );
    expect(c).toMatchObject({ situacao: 'vigente', garantia: 'seguro_garantia' });
    expect(Number(c?.['versao'])).toBe(1);
    expect(Number(c?.['valor_global'])).toBe(10_000);
    expect(Number(c?.['papeis'])).toBe(2);
    expect(Number(c?.['historico'])).toBe(1);
    expect(Number(c?.['com_indice'])).toBe(1);
    const t = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'contrato_fornecedor' AND entidade_id = ? AND correlacao = ?",
      [contrato, correlacao],
    );
    expect(Number(t?.['n'])).toBe(1);
    const i = await ler('SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = ? AND chave = ?', [
      OPERACAO_CHAVE_CONTRATO,
      x.chave,
    ]);
    expect(Number(i?.['n'])).toBe(1);
    expect(await porta.gravarSgh(ctxA, trilha, (g) => g.criar({ entrada: x, usuario: 'teste' }))).toEqual({
      id: contrato,
      repetido: true,
    });
    await expect(
      porta.gravarSgh(ctxA, trilha, (g) => g.criar({ entrada: { ...x, valor: 11_000 }, usuario: 'teste' })),
    ).rejects.toThrow(/idempotencia-divergente/);
    await expect(
      porta.gravarSgh(ctxA, trilha, (g) =>
        g.criar({ entrada: entrada({ chave: `f22-0313-ct2-${sufixo}` }), usuario: 'teste' }),
      ),
    ).rejects.toThrow(/numero-repetido/);
  });

  it('a leitura devolve o cadastro no vocabulário da tela', async () => {
    const d = await porta.detalhar(ctxA, contrato);
    expect(d).toMatchObject({
      id: contrato,
      situacao: 'ativo',
      critico: true,
      observacao: 'Observação fictícia',
      gestor: 'f22.0313.gestor',
      fiscal: 'f22.0313.fiscal',
      indiceReajuste: 'ipca',
      garantia: 'seguro',
      garantiaValor: 500,
      valorInicial: 10_000,
      fornecedorNome: 'DISTRIBUIDORA FICTÍCIA 0313 LTDA',
      versao: 1,
    });
    const l = await porta.listar(ctxA, {
      situacao: 'ativo',
      faixa: null,
      fornecedor: null,
      termo: null,
      pagina: 1,
    });
    expect(l.itens.map((x) => x.id)).toContain(contrato);
    expect((await porta.painel(ctxA)).ativos).toBeGreaterThanOrEqual(1);
    expect((await porta.usuarios(ctxA, 'f22.0313')).map((u) => u.login)).toContain('f22.0313.fiscal2');
    expect((await porta.fornecedores(ctxA, 'FICTÍCIA 0313')).itens.map((f) => f.codigo)).toContain(
      fornecedor,
    );
  });

  it('a alteração: a versão antiga recusa; o fiscal troca no papel e a versão sobe', async () => {
    const d = (await porta.detalhar(ctxA, contrato))!;
    const alt = {
      versao: d.versao,
      objeto: d.objeto,
      critico: false,
      indiceReajuste: 'ipca' as const,
      dataBase: '2026-01-01',
      garantia: 'seguro' as const,
      garantiaValor: 600,
      garantiaValidade: '2027-12-31',
      gestor: 'f22.0313.gestor',
      fiscal: 'f22.0313.fiscal2',
      centroCusto: null,
      observacao: null,
    };
    await expect(
      porta.gravarSgh(ctxA, trilha, (g) =>
        g.alterar({ id: contrato, entrada: { ...alt, versao: 99 }, usuario: 't' }),
      ),
    ).rejects.toThrow(/conflito-versao/);
    const r = await porta.gravarSgh(ctxA, trilha, (g) =>
      g.alterar({ id: contrato, entrada: alt, usuario: 't' }),
    );
    expect(r.versao).toBe(2);
    expect(await porta.detalhar(ctxA, contrato)).toMatchObject({
      fiscal: 'f22.0313.fiscal2',
      critico: false,
      observacao: null,
      garantiaValor: 600,
      versao: 2,
    });
  });

  it('o aditivo e a avaliação: histórico, aditivo_contrato, o valor total e a versão', async () => {
    const v = (await porta.detalhar(ctxA, contrato))!.versao;
    const r = await porta.gravarSgh(ctxA, trilha, (g) =>
      g.evento({
        contrato,
        usuario: 't',
        entrada: {
          chave: `f22-0313-ad-${sufixo}`,
          versao: v,
          tipo: 'aditivo',
          valor: 2_000,
          novoFim: null,
          numeroTermo: 'TA-1',
          descricao: 'Acréscimo fictício de quantidade',
          documento: null,
        },
      }),
    );
    expect(r).toMatchObject({ contrato, tipo: 'aditivo', valor: 2_000, repetido: false });
    const a = await ler(
      'SELECT tipo, valor_anterior, valor_novo, (SELECT quantidade_aditivos FROM contrato_fornecedor WHERE id = ?) AS qtd FROM aditivo_contrato WHERE contrato_fornecedor_id = ?',
      [contrato, contrato],
    );
    expect(a).toMatchObject({ tipo: 'valor' });
    expect(Number(a?.['valor_novo'])).toBe(12_000);
    expect(Number(a?.['qtd'])).toBe(1);
    const d = (await porta.detalhar(ctxA, contrato))!;
    expect(d.versao).toBe(v + 1);
    expect(d.valorTotal).toBe(12_000);
    expect(d.eventos.map((e) => e.tipo)).toEqual(['aditivo']);
    const av = await porta.gravarSgh(ctxA, trilha, (g) =>
      g.evento({
        contrato,
        usuario: 't',
        entrada: {
          chave: `f22-0313-av-${sufixo}`,
          versao: d.versao,
          tipo: 'avaliacao',
          data: HOJE,
          notas: { qualidade: 5, prazo: 4, atendimento: 4, documentacao: 5 },
          descricao: '',
        },
      }),
    );
    expect(av.repetido).toBe(false);
    expect((await porta.detalhar(ctxA, contrato))!.ultimaAvaliacao).toMatchObject({ data: HOJE });
  });

  it('o vínculo do pedido: a coluna do pedido, o saldo e o pedido já ligado recusado', async () => {
    const cand = await porta.candidatos(ctxA, contrato);
    expect(cand?.some((x) => x.tipo === 'pedido' && x.ids[0] === pedido)).toBe(true);
    const r = await porta.gravarSgh(ctxA, trilha, (g) =>
      g.vincular({
        contrato: { contrato, excecao: null, pedidoDeOrigem: null },
        tipo: 'pedido',
        ids: [pedido],
        usuario: 'f22.0313.gestor',
        chave: `f22-0313-vi-${sufixo}`,
      }),
    );
    expect(r).toMatchObject({ contrato, vinculos: [pedido], repetido: false });
    const p = await ler('SELECT contrato_fornecedor_id FROM pedido_compra WHERE id = ?', [pedido]);
    expect(Number(p?.['contrato_fornecedor_id'])).toBe(contrato);
    const d = (await porta.detalhar(ctxA, contrato))!;
    expect(d.vinculos).toHaveLength(1);
    expect(d.saldo).toBe(12_000 - 1_200);
    await expect(
      porta.gravarSgh(ctxA, trilha, (g) =>
        g.vincular({
          contrato: { contrato, excecao: null, pedidoDeOrigem: null },
          tipo: 'pedido',
          ids: [pedido],
          usuario: 'f22.0313.gestor',
          chave: `f22-0313-vi2-${sufixo}`,
        }),
      ),
    ).rejects.toThrow();
  });

  it('o encerramento muda a situação; o outro estabelecimento não lê nada', async () => {
    const v = (await porta.detalhar(ctxA, contrato))!.versao;
    await porta.gravarSgh(ctxA, trilha, (g) =>
      g.evento({
        contrato,
        usuario: 't',
        entrada: {
          chave: `f22-0313-en-${sufixo}`,
          versao: v,
          tipo: 'encerramento',
          data: HOJE,
          descricao: '',
        },
      }),
    );
    const s = await ler('SELECT situacao FROM contrato_fornecedor WHERE id = ?', [contrato]);
    expect(s).toMatchObject({ situacao: 'encerrado' });
    expect((await porta.detalhar(ctxA, contrato))!.situacao).toBe('encerrado');
    expect(await porta.detalhar(ctxB, contrato)).toBeNull();
    expect(
      (await porta.listar(ctxB, { situacao: 'todos', faixa: null, fornecedor: null, termo: null, pagina: 1 }))
        .itens,
    ).toEqual([]);
    expect(await porta.candidatos(ctxB, contrato)).toBeNull();
  });
});
