// Integração contra o MariaDB real (cliente teste_nucleo, criado por tools/db/criar_cliente.py). Grava num domínio
// simples (tipo_combustivel) e confere auditoria, trilha, outbox, idempotência, número de negócio e conflito de
// versão. Dados fictícios de teste, sem pessoa real. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErroLeitura, ErroOperacao } from './erros.js';
import { type ContextoOperacao, MetricasExecutor, definirOperacao } from './executor.js';
import { NucleoProprio } from './nucleo.js';
import { garantirSequencia } from './sequencia.js';

const CLIENTE = 'teste_nucleo';
const TIPO_SEQUENCIA = 'teste_nucleo_combustivel';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

const incluir = definirOperacao({
  nome: 'teste_nucleo.tipo_combustivel.incluir',
  tabelas: ['tipo_combustivel'],
  acao: 'inclusao',
  entrada: z.object({ descricao: z.string().min(1).max(150) }),
  async gravar(tx, e) {
    const n = await tx.proximoNumero(TIPO_SEQUENCIA);
    const id = await tx.incluir('tipo_combustivel', { codigo: n.formatado, descricao: e.descricao });
    return { id, codigo: n.formatado, numero: n.valor };
  },
  eventos: (_e, r) => [{ tipo: 'teste_nucleo.combustivel_incluido', carga: { id: r.id } }],
  alvo: (_e, r) => ({ tabela: 'tipo_combustivel', id: r.id }),
});

const alterar = definirOperacao({
  nome: 'teste_nucleo.tipo_combustivel.alterar',
  tabelas: ['tipo_combustivel'],
  entrada: z.object({
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    descricao: z.string().min(1),
  }),
  travar: (e) => ({ tabela: 'tipo_combustivel', id: e.id, colunas: ['descricao'], versaoEsperada: e.versao }),
  async gravar(tx, e) {
    return {
      id: e.id,
      versao: await tx.alterar('tipo_combustivel', e.id, e.versao, { descricao: e.descricao }),
    };
  },
  alvo: (e) => ({ tabela: 'tipo_combustivel', id: e.id }),
});

describe.skipIf(SEM_BANCO)('núcleo contra o MariaDB (cliente teste_nucleo)', () => {
  let nucleo: NucleoProprio;
  let estabelecimento = 0;
  let usuario = 0;
  const metricas = new MetricasExecutor();
  const ctx = (chave = `t-${randomUUID()}`): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento,
    usuario,
    correlacao: `teste-${randomUUID()}`.slice(0, 64),
    chaveIdempotencia: chave,
  });
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_teste_nucleo');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste' }, async (e) => {
      const agora = new Date();
      estabelecimento =
        (await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', ['tnucleo']))?.id ??
        (await e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em, versao) VALUES (?, ?, ?, ?, 1)',
          ['tnucleo', 'Estabelecimento de teste', 'Estabelecimento de teste do núcleo', agora],
        ));
      usuario =
        (await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', ['teste.nucleo']))?.id ??
        (await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em, versao) VALUES (?, ?, 'servico', ?, 1)",
          ['teste.nucleo', 'Conta de serviço do teste do núcleo', agora],
        ));
      await garantirSequencia(
        e,
        { tipo: TIPO_SEQUENCIA, estabelecimento, prefixo: 'TN-' },
        { usuario: null, agora },
      );
    });
  });

  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('a plataforma responde e o ambiente é neutralizado (dev)', async () => {
    const s = await nucleo.saude();
    expect(s.plataforma).toBe(true);
    expect(s.ambiente).not.toBe('producao');
  });

  it('grava com auditoria, trilha, outbox, idempotência e número de negócio; a repetição não grava de novo', async () => {
    const ex = nucleo.criarExecutor({ metricas });
    const c = ctx();
    const s = await ex.executar(incluir, CLIENTE, { descricao: 'Combustível de teste' }, c);
    expect(s.repetida).toBe(false);
    expect(s.resultado.codigo).toBe(`TN-${s.resultado.numero}`);
    const [reg] = await ler<{
      codigo: string;
      criado_em: Date;
      criado_por: number;
      alterado_em: Date | null;
      versao: number;
    }>('SELECT codigo, criado_em, criado_por, alterado_em, versao FROM tipo_combustivel WHERE id = ?', [
      s.resultado.id,
    ]);
    expect(reg).toMatchObject({
      codigo: s.resultado.codigo,
      criado_por: usuario,
      alterado_em: null,
      versao: 1,
    });
    expect(reg?.criado_em).toBeInstanceOf(Date);
    expect(Math.abs((reg?.criado_em.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);

    const [trilha] = await ler<{
      acao: string;
      entidade: string;
      entidade_id: number;
      usuario_id: number;
      estabelecimento_id: number;
      correlacao: string;
      dados_depois: unknown;
    }>(
      'SELECT acao, entidade, entidade_id, usuario_id, estabelecimento_id, correlacao, dados_depois FROM trilha_auditoria WHERE id = ?',
      [s.trilha],
    );
    expect(trilha).toMatchObject({
      acao: 'inclusao',
      entidade: 'tipo_combustivel',
      entidade_id: s.resultado.id,
      usuario_id: usuario,
      estabelecimento_id: estabelecimento,
      correlacao: c.correlacao,
    });
    const depois = trilha?.dados_depois;
    expect((typeof depois === 'string' ? JSON.parse(depois) : depois).operacao).toBe(incluir.nome);

    const saidas = await ler<{ ponto: string; situacao: string; direcao: string }>(
      'SELECT ponto, situacao, direcao FROM integracao_mensagem WHERE id = ?',
      [s.eventos[0]],
    );
    expect(saidas).toEqual([
      { ponto: 'teste_nucleo.combustivel_incluido', situacao: 'pendente', direcao: 'saida' },
    ]);
    const idem = await ler<{ trilha_auditoria_id: number }>(
      'SELECT trilha_auditoria_id FROM idempotencia_operacao WHERE operacao = ? AND chave = ?',
      [incluir.nome, c.chaveIdempotencia],
    );
    expect(idem).toEqual([{ trilha_auditoria_id: s.trilha }]);

    const total = async () => (await ler<{ n: number }>('SELECT COUNT(*) n FROM tipo_combustivel'))[0]?.n;
    const antes = await total();
    const r = await ex.executar(incluir, CLIENTE, { descricao: 'Combustível de teste' }, c);
    expect(r).toMatchObject({ repetida: true, resultado: s.resultado, trilha: s.trilha });
    expect(await total()).toBe(antes);
    await expect(ex.executar(incluir, CLIENTE, { descricao: 'Outra entrada' }, c)).rejects.toMatchObject({
      problema: { status: 422, codigo: 'idempotencia-divergente' },
    });
  });

  it('números de negócio sem repetição em gravações simultâneas', async () => {
    const ex = nucleo.criarExecutor();
    const saidas = await Promise.all(
      Array.from({ length: 6 }, () =>
        ex.executar(incluir, CLIENTE, { descricao: 'Combustível concorrente' }, ctx()),
      ),
    );
    const numeros = saidas.map((s) => s.resultado.numero).sort((a, b) => a - b);
    expect(new Set(numeros).size).toBe(6);
    expect(numeros.at(-1)! - numeros[0]!).toBe(5);
  });

  it('sequência do cliente inteiro (estabelecimento null): uma só linha, mesmo em criações simultâneas', async () => {
    const tipo = `teste_nucleo_cliente_${randomUUID().slice(0, 8)}`;
    try {
      const r = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          nucleo.escrever({ cliente: CLIENTE, correlacao: 'seq-concorrente' }, (e) =>
            garantirSequencia(e, { tipo, estabelecimento: null }, { usuario: null, agora: new Date() }),
          ),
        ),
      );
      const ids = r.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(1);
      // Carga direta (sem a trava do REPEATABLE READ): o banco recusa a segunda linha com estabelecimento null.
      await expect(
        nucleo.escrever({ cliente: CLIENTE, correlacao: 'seq-duplicada' }, (e) =>
          e.inserir(
            'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em, versao) VALUES (NULL, ?, 1, 1, TRUE, ?, 1)',
            [tipo, new Date()],
          ),
        ),
      ).rejects.toThrow();
      const linhas = await ler<{ n: number }>(
        'SELECT COUNT(*) AS n FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id IS NULL',
        [tipo],
      );
      expect(Number(linhas[0]?.n)).toBe(1);
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'seq-limpeza' }, (e) =>
        e.executar('DELETE FROM sequencia_negocio WHERE tipo = ?', [tipo]),
      );
    }
  });

  it('trava otimista: altera na versão lida; com versão velha, 409 e nada gravado', async () => {
    const ex = nucleo.criarExecutor();
    const { resultado } = await ex.executar(incluir, CLIENTE, { descricao: 'Antes' }, ctx());
    const a = await ex.executar(
      alterar,
      CLIENTE,
      { id: resultado.id, versao: 1, descricao: 'Depois' },
      ctx(),
    );
    expect(a.resultado.versao).toBe(2);
    const [reg] = await ler<{ descricao: string; versao: number; alterado_por: number; alterado_em: Date }>(
      'SELECT descricao, versao, alterado_por, alterado_em FROM tipo_combustivel WHERE id = ?',
      [resultado.id],
    );
    expect(reg).toMatchObject({ descricao: 'Depois', versao: 2, alterado_por: usuario });
    expect(reg?.alterado_em).toBeInstanceOf(Date);
    const trilhas = async () =>
      (
        await ler<{ n: number }>(
          "SELECT COUNT(*) n FROM trilha_auditoria WHERE entidade = 'tipo_combustivel' AND entidade_id = ?",
          [resultado.id],
        )
      )[0]?.n;
    const antes = await trilhas();
    const erro = await ex
      .executar(alterar, CLIENTE, { id: resultado.id, versao: 1, descricao: 'Perdida' }, ctx())
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroOperacao);
    expect((erro as ErroOperacao).problema).toMatchObject({ status: 409, codigo: 'conflito-versao' });
    expect(await trilhas()).toBe(antes);
    expect(
      (
        await ler<{ descricao: string }>('SELECT descricao FROM tipo_combustivel WHERE id = ?', [
          resultado.id,
        ])
      )[0]?.descricao,
    ).toBe('Depois');
  });

  it('desfazer não deixa rastro, nem o número de negócio', async () => {
    const ex = nucleo.criarExecutor();
    const prox = async () =>
      (
        await ler<{ v: number }>(
          'SELECT proximo_valor v FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?',
          [TIPO_SEQUENCIA, estabelecimento],
        )
      )[0]?.v;
    const antes = await prox();
    const s = await ex.executar(incluir, CLIENTE, { descricao: 'Simulação' }, ctx(), { desfazer: true });
    expect(await prox()).toBe(antes);
    expect(await ler('SELECT id FROM tipo_combustivel WHERE id = ?', [s.resultado.id])).toEqual([]);
    expect(await ler('SELECT id FROM trilha_auditoria WHERE id = ?', [s.trilha])).toEqual([]);
  });

  it('a leitura recusa escrita e o tempo máximo da consulta funciona no servidor', async () => {
    await expect(
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'x' }, (l) =>
        l.consultar('UPDATE tipo_combustivel SET ativo = 0'),
      ),
    ).rejects.toThrow(ErroLeitura);
    const r = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'x' }, (l) =>
      l.consultar<{ n: number }>('SELECT COUNT(*) n FROM tipo_combustivel', [], { tempoMaximoMs: 5_000 }),
    );
    expect(r[0]?.n).toBeGreaterThan(0);
  });

  it('cliente desconhecido é recusado', async () => {
    await expect(
      nucleo.lerSomente({ cliente: 'nao_existe_x', correlacao: 'x' }, async () => 1),
    ).rejects.toThrow(/não registrado/);
  });
});
