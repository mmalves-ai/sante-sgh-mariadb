// Executor do núcleo sobre o MariaDB real (cliente f22_o5), em transação desfeita: a gravação, a trilha, a mensagem de
// saída e a idempotência na MESMA transação; a prova que não se confirma desfaz tudo; a escrita fora das tabelas
// declaradas é recusada; a entrada inválida não chega ao banco; o conflito de versão; a linha travada por outra conexão
// devolve "registro em edição" sem gravar; o texto com acentos e caracteres de 4 bytes (utf8mb4) relido igual; e o
// isolamento entre clientes: o gravado no cliente f22_o5 não aparece no f22_o5_b (outro banco), e o contexto de
// outro cliente é recusado. Substitui os testes do executor sobre a cópia do sistema de origem.
// Melhoria: o emoji, antes recusado pelo limite do código de página antigo, agora é gravado e relido igual (utf8mb4).
// Melhoria: o conflito de versão vem da coluna `versao` (trava otimista), não de comparação de retrato do registro.
import { ErroClienteDesconhecido } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alterarEstabelecimento,
  type Ambiente,
  CLIENTE,
  CLIENTE_B,
  codigoDe,
  codigoSintetico,
  contar,
  ctx,
  ctxOperacao,
  desfeito,
  garantirCliente,
  gravarForaDasTabelas,
  incluirEstabelecimento,
  incluirSemEfeito,
  MARCA,
  num,
  prepararAmbiente,
  SEM_BANCO,
} from './escrita.spec-util.js';

describe.skipIf(SEM_BANCO)('executor do núcleo no MariaDB (cliente f22_o5, transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('grava; trilha, mensagem de saída e idempotência na mesma transação; nada fica depois do ROLLBACK', async () => {
    const codigo = codigoSintetico();
    const c = ctxOperacao(a);
    const r = await desfeito(a, async (e) => {
      const s = await a.executor.executar(
        incluirEstabelecimento,
        CLIENTE,
        { codigo, nome: `Hospital ${MARCA}` },
        c,
        {
          escritor: e,
        },
      );
      const id = num(s.resultado['id']);
      return {
        id: id > 0,
        repetida: s.repetida,
        linha: await contar(
          e,
          'SELECT COUNT(*) AS n FROM estabelecimento WHERE id = ? AND codigo = ? AND versao = 1',
          [id, codigo],
        ),
        trilha: await contar(
          e,
          `SELECT COUNT(*) AS n FROM trilha_auditoria
            WHERE id = ? AND entidade = 'estabelecimento' AND entidade_id = ? AND correlacao = ? AND estabelecimento_id = ?`,
          [s.trilha, id, c.correlacao, a.estabelecimento],
        ),
        saida: s.eventos.length,
        outbox: await contar(
          e,
          `SELECT COUNT(*) AS n FROM integracao_mensagem WHERE id = ? AND ponto = 'teste.nucleo.incluido' AND entidade_id = ?`,
          [s.eventos[0], id],
        ),
        idem: await contar(
          e,
          'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = ? AND chave = ?',
          [incluirEstabelecimento.nome, c.chaveIdempotencia],
        ),
      };
    });
    expect(r).toEqual({ id: true, repetida: false, linha: 1, trilha: 1, saida: 1, outbox: 1, idem: 1 });
    const restou = await a.nucleo.lerSomente(ctx(a), async (l) => ({
      linha: await contar(l, 'SELECT COUNT(*) AS n FROM estabelecimento WHERE codigo = ?', [codigo]),
      idem: await contar(l, 'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE chave = ?', [
        c.chaveIdempotencia,
      ]),
    }));
    expect(restou).toEqual({ linha: 0, idem: 0 });
  });

  it('prova que não se confirma: a operação inteira volta (0 linha, 0 trilha, 0 idempotência)', async () => {
    const codigo = codigoSintetico();
    const c = ctxOperacao(a);
    const r = await desfeito(a, async (e) => {
      const trilhaAntes = await contar(e, 'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [
        c.correlacao,
      ]);
      let codigoErro = '';
      try {
        await a.executor.executar(incluirSemEfeito, CLIENTE, { codigo, nome: `Hospital ${MARCA}` }, c, {
          escritor: e,
        });
      } catch (x) {
        codigoErro = codigoDe(x);
      }
      return {
        codigoErro,
        linha: await contar(e, 'SELECT COUNT(*) AS n FROM estabelecimento WHERE codigo = ?', [codigo]),
        trilha:
          (await contar(e, 'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [
            c.correlacao,
          ])) - trilhaAntes,
        idem: await contar(e, 'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE chave = ?', [
          c.chaveIdempotencia,
        ]),
      };
    });
    expect(r).toEqual({ codigoErro: 'acao-sem-efeito', linha: 0, trilha: 0, idem: 0 });
  });

  it('escrita fora das tabelas declaradas é recusada antes do banco; nada gravado', async () => {
    const codigo = codigoSintetico();
    const r = await desfeito(a, async (e) => {
      let status = 0;
      try {
        await a.executor.executar(
          gravarForaDasTabelas,
          CLIENTE,
          { codigo, nome: `Hospital ${MARCA}` },
          ctxOperacao(a),
          {
            escritor: e,
          },
        );
      } catch (x) {
        status = (x as { problema?: { status?: number } }).problema?.status ?? -1;
      }
      return {
        status,
        mensagens: await contar(
          e,
          `SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'teste_nucleo'`,
        ),
      };
    });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.mensagens).toBe(0);
  });

  it('entrada inválida: recusada pelo contrato com os campos, sem tocar o banco', async () => {
    let erro: unknown = null;
    try {
      await a.executor.executar(
        incluirEstabelecimento,
        CLIENTE,
        { codigo: 'minúsculo inválido', nome: '' },
        ctxOperacao(a),
        {
          desfazer: true,
        },
      );
    } catch (x) {
      erro = x;
    }
    expect(codigoDe(erro)).toBe('entrada-invalida');
    expect([...((erro as { problema: { campos?: string[] } }).problema.campos ?? [])].sort()).toEqual([
      'codigo',
      'nome',
    ]);
  });

  it('conflito de versão: a segunda alteração com a versão já vencida é recusada com a coluna', async () => {
    const r = await desfeito(a, async (e) => {
      const s = await a.executor.executar(
        incluirEstabelecimento,
        CLIENTE,
        { codigo: codigoSintetico(), nome: `Hospital ${MARCA}` },
        ctxOperacao(a),
        { escritor: e },
      );
      const id = num(s.resultado['id']);
      const primeira = await a.executor.executar(
        alterarEstabelecimento,
        CLIENTE,
        { id, versao: 1, nome: `Hospital ${MARCA} alterado` },
        ctxOperacao(a),
        { escritor: e },
      );
      let segunda = '';
      let colunas: readonly string[] = [];
      try {
        await a.executor.executar(
          alterarEstabelecimento,
          CLIENTE,
          { id, versao: 1, nome: `Hospital ${MARCA} versão velha` },
          ctxOperacao(a),
          { escritor: e },
        );
      } catch (x) {
        segunda = codigoDe(x);
        colunas = (x as { problema?: { colunas?: readonly string[] } }).problema?.colunas ?? [];
      }
      const lida = await e.uma<{ versao: number; nome_fantasia: string }>(
        'SELECT versao, nome_fantasia FROM estabelecimento WHERE id = ?',
        [id],
      );
      return {
        versao: num(primeira.resultado['versao']),
        segunda,
        colunas,
        relida: num(lida?.versao),
        nome: lida?.nome_fantasia,
      };
    });
    expect(r).toEqual({
      versao: 2,
      segunda: 'conflito-versao',
      colunas: ['versao'],
      relida: 2,
      nome: `Hospital ${MARCA} alterado`,
    });
  });

  it('linha travada por outra conexão: "registro em edição", nada gravado', async () => {
    const alvo = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.uma<{ id: number; versao: number }>('SELECT id, versao FROM estabelecimento WHERE id = ?', [
        a.estabelecimento,
      ]),
    );
    expect(alvo).not.toBeNull();
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = desfeito(a, async (e) => {
      await e.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [alvo!.id]);
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    // Se a trava falhar, o teste falha na hora (em vez de esperar o tempo máximo).
    await Promise.race([travada, segurando.then(() => Promise.reject(new Error('A trava não foi segurada.')))]);
    const inicio = Date.now();
    let codigo = '';
    try {
      await a.executor.executar(
        alterarEstabelecimento,
        CLIENTE,
        { id: num(alvo!.id), versao: num(alvo!.versao), nome: `Hospital ${MARCA} travado` },
        ctxOperacao(a),
        { desfazer: true },
      );
    } catch (x) {
      codigo = codigoDe(x);
    } finally {
      soltar();
      await segurando;
    }
    expect(codigo).toBe('registro-em-edicao');
    const depois = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.uma<{ versao: number }>('SELECT versao FROM estabelecimento WHERE id = ?', [a.estabelecimento]),
    );
    expect(num(depois?.versao)).toBe(num(alvo!.versao));
    console.log(
      `[${CLIENTE}] trava: ${codigo} em ${Math.round((Date.now() - inicio) / 100) / 10} s; versão intacta`,
    );
  }, 120_000);

  it('texto com acentos e caracteres de 4 bytes (utf8mb4) grava e relê igual', async () => {
    const nome = `${MARCA} ÁÉÍÓÚ ÂÊÔ ÃÕ ÇÜ àèìòù ação 💊 𝄞`;
    const relido = await desfeito(a, async (e) => {
      const s = await a.executor.executar(
        incluirEstabelecimento,
        CLIENTE,
        { codigo: codigoSintetico(), nome },
        ctxOperacao(a),
        {
          escritor: e,
        },
      );
      const l = await e.uma<{ nome_fantasia: string }>(
        'SELECT nome_fantasia FROM estabelecimento WHERE id = ?',
        [num(s.resultado['id'])],
      );
      return String(l?.nome_fantasia ?? '');
    });
    expect(Buffer.from(relido, 'utf8').equals(Buffer.from(nome, 'utf8'))).toBe(true);
    expect(relido).not.toContain('�');
  });

  it('cada cliente no seu banco: o gravado no cliente A não existe no B; bancos distintos; contexto trocado e cliente desconhecido recusados', async () => {
    garantirCliente(CLIENTE_B, 'Teste F2.2 onda 5 (segundo cliente, isolamento)');
    const ctxB = { cliente: CLIENTE_B, correlacao: 'int-nucleo-isolamento' };
    const bancoA = await a.nucleo.lerSomente(ctx(a), (l) => l.uma<{ b: string }>('SELECT DATABASE() AS b'));
    const bancoB = await a.nucleo.lerSomente(ctxB, (l) => l.uma<{ b: string }>('SELECT DATABASE() AS b'));
    expect(bancoA?.b).toBe(`cliente_${CLIENTE}`);
    expect(bancoB?.b).toBe(`cliente_${CLIENTE_B}`);

    // Grava um estabelecimento sintético no A (transação desfeita) e, com a transação ainda aberta, procura o mesmo
    // código no B pelo mesmo núcleo: 0. A leitura do B vem do banco do B (DATABASE() conferido na mesma conexão).
    const codigo = codigoSintetico();
    const c = ctxOperacao(a, { correlacao: 'int-nucleo-isolamento-a' });
    const r = await desfeito(a, async (e) => {
      const s = await a.executor.executar(
        incluirEstabelecimento,
        CLIENTE,
        { codigo, nome: `Hospital ${MARCA}` },
        c,
        { escritor: e },
      );
      const id = num(s.resultado['id']);
      const noA = await contar(e, 'SELECT COUNT(*) AS n FROM estabelecimento WHERE id = ? AND codigo = ?', [
        id,
        codigo,
      ]);
      const noB = await a.nucleo.lerSomente(ctxB, async (l) => ({
        banco: (await l.uma<{ b: string }>('SELECT DATABASE() AS b'))?.b,
        codigo: await contar(l, 'SELECT COUNT(*) AS n FROM estabelecimento WHERE codigo = ?', [codigo]),
        trilha: await contar(
          l,
          `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'estabelecimento' AND entidade_id = ? AND correlacao = ?`,
          [id, c.correlacao],
        ),
      }));
      return { noA, noB };
    });
    expect(r).toEqual({ noA: 1, noB: { banco: `cliente_${CLIENTE_B}`, codigo: 0, trilha: 0 } });

    // O contexto de outro cliente não grava no banco do executor chamado.
    let outro = '';
    try {
      await a.executor.executar(
        incluirEstabelecimento,
        CLIENTE,
        { codigo: codigoSintetico(), nome: `Hospital ${MARCA}` },
        { ...ctxOperacao(a), cliente: CLIENTE_B },
        { desfazer: true },
      );
    } catch (x) {
      outro = codigoDe(x);
    }
    expect(outro).toBe('contexto-invalido');

    // Cliente sem registro na plataforma: erro próprio, sem abrir conexão.
    let desconhecido: unknown = null;
    try {
      await a.nucleo.lerSomente({ cliente: 'f22_inexistente_zz', correlacao: 'int-nucleo' }, async () => 1);
    } catch (x) {
      desconhecido = x;
    }
    expect(desconhecido).toBeInstanceOf(ErroClienteDesconhecido);
  });
});
