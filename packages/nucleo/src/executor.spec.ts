import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { executarComo, marcaComoAtual } from './como.js';
import { BancoDuble, CONFIG_TESTE, erroDoBanco } from './duble-banco.spec-util.js';
import { ErroOperacao, erroNaoLiberada } from './erros.js';
import {
  type ContextoOperacao,
  Executor,
  MetricasExecutor,
  alvoDaEscrita,
  definirOperacao,
} from './executor.js';
import { hashEntrada, jsonCanonico } from './idempotencia.js';
import { escreverTransacao } from './transacao.js';

const CTX: ContextoOperacao = {
  cliente: 'teste_duble',
  estabelecimento: 7,
  usuario: 3,
  correlacao: 'corr-1',
  chaveIdempotencia: 'chave-0001',
};

const incluir = definirOperacao({
  nome: 'teste.tipo_x.incluir',
  tabelas: ['tipo_x'],
  entrada: z.object({ descricao: z.string().min(1) }),
  async gravar(tx, e) {
    const n = await tx.proximoNumero('tipo_x');
    const id = await tx.incluir('tipo_x', { codigo: n.formatado, descricao: e.descricao });
    return { id, codigo: n.formatado };
  },
  eventos: (_e, r) => [{ tipo: 'tipo_x.incluido', carga: { id: r.id } }],
  alvo: (_e, r) => ({ tabela: 'tipo_x', id: r.id }),
});

const alterar = definirOperacao({
  nome: 'teste.tipo_x.alterar',
  tabelas: ['tipo_x'],
  entrada: z.object({
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    descricao: z.string(),
  }),
  travar: (e) => ({ tabela: 'tipo_x', id: e.id, colunas: ['descricao'], versaoEsperada: e.versao }),
  async gravar(tx, e) {
    return { id: e.id, versao: await tx.alterar('tipo_x', e.id, e.versao, { descricao: e.descricao }) };
  },
  alvo: (e) => ({ tabela: 'tipo_x', id: e.id }),
});

const SEQUENCIA = [{ id: 1, prefixo: 'X-', proximo_valor: 10, incremento: 1, valor_maximo: null, ativo: 1 }];

function banco(): BancoDuble {
  return new BancoDuble().quando(/FROM sequencia_negocio/, SEQUENCIA);
}

async function problema(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema;
    throw e;
  }
  throw new Error('esperava erro');
}

describe('Executor: protocolo da operação', () => {
  it('grava com auditoria, número de negócio, trilha, outbox e idempotência na mesma transação', async () => {
    const b = banco();
    const aoConfirmar = vi.fn();
    const metricas = new MetricasExecutor();
    const ex = new Executor(b.dependencias({ aoConfirmar, metricas }));
    const s = await ex.executar(incluir, 'teste_duble', { descricao: 'Gasolina' }, CTX);
    expect(s).toEqual({
      resultado: { id: 100, codigo: 'X-10' },
      repetida: false,
      eventos: [102],
      trilha: 101,
    });
    // leitura da idempotência e depois uma única transação de escrita, confirmada.
    expect(b.estados).toEqual([
      'somente-leitura',
      'desfazer',
      'devolver',
      'iniciar',
      'confirmar',
      'devolver',
    ]);
    const ordem = b.comandos.map((c) =>
      /^SELECT/.test(c.sql)
        ? `SELECT FROM ${/FROM (\w+)/.exec(c.sql)?.[1]}`
        : /^(\w+)\s+(?:INTO\s+)?(\w+)/.exec(c.sql)?.slice(1).join(' '),
    );
    expect(ordem).toEqual([
      'SELECT FROM idempotencia_operacao',
      'SELECT FROM sequencia_negocio',
      'UPDATE sequencia_negocio',
      'INSERT tipo_x',
      'INSERT trilha_auditoria',
      'INSERT integracao_mensagem',
      'INSERT idempotencia_operacao',
    ]);
    const agora = new Date(Date.UTC(2026, 10, 20, 12, 0, 0));
    expect(b.que(/^INSERT INTO tipo_x/)[0]?.parametros).toEqual(['X-10', 'Gasolina', agora, 3, 1]);
    const trilha = b.que(/^INSERT INTO trilha_auditoria/)[0]?.parametros ?? [];
    expect(trilha.slice(0, 6)).toEqual([7, 3, agora, 'inclusao', 'tipo_x', 100]);
    expect(trilha[6]).toBeNull();
    expect(JSON.parse(String(trilha[7]))).toEqual({
      operacao: 'teste.tipo_x.incluir',
      resultado: { id: 100, codigo: 'X-10' },
      escritas: [{ acao: 'inclusao', tabela: 'tipo_x', id: 100, colunas: ['codigo', 'descricao'] }],
    });
    expect(trilha[10]).toBe('corr-1');
    const outbox = b.que(/^INSERT INTO integracao_mensagem/)[0]?.parametros ?? [];
    expect(outbox[1]).toBe('tipo_x.incluido');
    expect(String(outbox[4])).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(String(outbox[5]))).toEqual({ id: 100, cliente: 'teste_duble' });
    const idem = b.que(/^INSERT INTO idempotencia_operacao/)[0]?.parametros ?? [];
    expect(idem.slice(0, 5)).toEqual([
      'teste.tipo_x.incluir',
      'chave-0001',
      7,
      3,
      hashEntrada('teste.tipo_x.incluir', { descricao: 'Gasolina' }),
    ]);
    expect(idem[6]).toBe(101);
    expect(aoConfirmar).toHaveBeenCalledWith('teste_duble', [102]);
    expect(metricas.contagem('teste.tipo_x.incluir', 'sucesso')).toBe(1);
  });

  it('sessão "como" (ADR 0021): a trilha da mesma transação guarda o ator real e o alvo', async () => {
    const b = banco();
    const ex = new Executor(b.dependencias());
    const marca = {
      sessao: '41',
      acao: '9',
      atorTipo: 'plataforma' as const,
      idConta: '5',
      alvo: 'alvo.teste',
    };
    expect(marcaComoAtual()).toBeNull();
    await executarComo(marca, () => ex.executar(incluir, 'teste_duble', { descricao: 'Alcool' }, CTX));
    expect(marcaComoAtual()).toBeNull();
    const trilha = b.que(/^INSERT INTO trilha_auditoria/)[0]?.parametros ?? [];
    // usuario_id é o alvo (o usuário do contexto); a origem leva o ator real.
    expect(trilha[1]).toBe(3);
    expect(JSON.parse(String(trilha[7])).origem).toEqual({
      sessao: '41',
      acao: '9',
      atorTipo: 'plataforma',
      atorConta: '5',
      alvo: 'alvo.teste',
    });
    // Fora do "como", nada de origem.
    const b2 = banco();
    await new Executor(b2.dependencias()).executar(
      incluir,
      'teste_duble',
      { descricao: 'Alcool' },
      {
        ...CTX,
        chaveIdempotencia: 'chave-0002',
      },
    );
    const t2 = b2.que(/^INSERT INTO trilha_auditoria/)[0]?.parametros ?? [];
    expect(JSON.parse(String(t2[7]))).not.toHaveProperty('origem');
  });

  it('desfazer: tudo é desfeito e nada segue ao relay', async () => {
    const b = banco();
    const aoConfirmar = vi.fn();
    await new Executor(b.dependencias({ aoConfirmar })).executar(
      incluir,
      'teste_duble',
      { descricao: 'A' },
      CTX,
      { desfazer: true },
    );
    expect(b.estados.slice(3)).toEqual(['iniciar', 'desfazer', 'devolver']);
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it('entrada inválida e contexto incompleto: 400 sem abrir transação', async () => {
    const b = banco();
    const ex = new Executor(b.dependencias());
    expect(await problema(ex.executar(incluir, 'teste_duble', { descricao: '' }, CTX))).toMatchObject({
      status: 400,
      codigo: 'entrada-invalida',
      campos: ['descricao'],
    });
    expect(
      await problema(
        ex.executar(incluir, 'teste_duble', { descricao: 'A' }, { ...CTX, chaveIdempotencia: 'curta' }),
      ),
    ).toMatchObject({
      codigo: 'contexto-invalido',
    });
    expect(await problema(ex.executar(incluir, 'outro_cliente', { descricao: 'A' }, CTX))).toMatchObject({
      codigo: 'contexto-invalido',
    });
    expect(
      await problema(ex.executar(incluir, 'teste_duble', { descricao: 'A' }, { ...CTX, usuario: -1 })),
    ).toMatchObject({
      codigo: 'contexto-invalido',
    });
    expect(b.estados).toEqual([]);
  });

  it('gravação fora das tabelas declaradas é recusada e desfeita', async () => {
    const b = banco();
    const fora = definirOperacao({
      nome: 'teste.fora',
      tabelas: ['tipo_x'],
      entrada: z.object({}),
      async gravar(tx) {
        await tx.executar('DELETE FROM usuario WHERE id = 1');
        return {};
      },
      alvo: () => ({ tabela: 'tipo_x', id: null }),
    });
    const ex = new Executor(b.dependencias());
    expect(await problema(ex.executar(fora, 'teste_duble', {}, CTX))).toMatchObject({ status: 500 });
    expect(b.estados).toContain('desfazer');
    expect(b.estados).not.toContain('confirmar');
    expect(b.que(/DELETE/)).toHaveLength(0);
  });

  it('UPDATE ou DELETE de várias tabelas, ou com esquema, é recusado mesmo começando por tabela declarada', async () => {
    const comandos = [
      'UPDATE permitida p JOIN usuario u ON u.id = p.usuario_id SET u.ativo = 0',
      'UPDATE permitida, usuario SET usuario.ativo = 0 WHERE usuario.id = permitida.usuario_id',
      'DELETE FROM permitida, usuario USING permitida JOIN usuario ON usuario.id = permitida.usuario_id',
      'UPDATE outro_banco.permitida SET x = 1',
      'INSERT INTO `outro_banco`.`permitida` (x) VALUES (1)',
      'DELETE permitida, usuario FROM permitida JOIN usuario ON usuario.id = permitida.usuario_id',
    ];
    for (const sql of comandos) expect(alvoDaEscrita(sql), sql).toBeNull();
    // As formas simples continuam aceitas.
    expect(alvoDaEscrita('UPDATE permitida SET x = 1 WHERE id = ?')).toBe('permitida');
    expect(alvoDaEscrita('UPDATE `permitida` AS p SET p.x = 1')).toBe('permitida');
    expect(alvoDaEscrita('DELETE FROM permitida WHERE id = ?')).toBe('permitida');
    expect(alvoDaEscrita('DELETE FROM permitida')).toBe('permitida');
    expect(alvoDaEscrita('INSERT IGNORE INTO permitida(x) SELECT id FROM usuario')).toBe('permitida');
    for (const sql of comandos.slice(0, 3)) {
      const b = banco();
      const op = definirOperacao({
        nome: 'teste.varias',
        tabelas: ['permitida'],
        entrada: z.object({}),
        async gravar(tx) {
          await tx.executar(sql);
          return {};
        },
        alvo: () => ({ tabela: 'permitida', id: null }),
      });
      const ex = new Executor(b.dependencias());
      expect(await problema(ex.executar(op, 'teste_duble', {}, CTX))).toMatchObject({ status: 500 });
      expect(b.estados).not.toContain('confirmar');
      expect(b.que(/^\s*(?:UPDATE|DELETE)/)).toHaveLength(0);
    }
  });

  it('trava ocupada vira 409 registro-em-edicao (métrica "trava")', async () => {
    const b = banco().quando(/^INSERT INTO tipo_x/, () => {
      throw erroDoBanco(1205, 'ER_LOCK_WAIT_TIMEOUT', 'Lock wait timeout exceeded');
    });
    const metricas = new MetricasExecutor();
    const log = vi.fn();
    const ex = new Executor(b.dependencias({ metricas, log }));
    expect(await problema(ex.executar(incluir, 'teste_duble', { descricao: 'A' }, CTX))).toMatchObject({
      codigo: 'registro-em-edicao',
    });
    expect(metricas.contagem('teste.tipo_x.incluir', 'trava')).toBe(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('VALOR-SECRETO');
  });

  it('operação crítica exige reautenticação recente', async () => {
    const critica = definirOperacao({ ...incluir, nome: 'teste.critica', critica: true });
    const b = banco();
    const ex = new Executor(b.dependencias({ reautenticacaoMs: 60_000 }));
    expect(await problema(ex.executar(critica, 'teste_duble', { descricao: 'A' }, CTX))).toMatchObject({
      status: 401,
    });
    const agora = Date.UTC(2026, 10, 20, 12, 0, 0);
    const s = await ex.executar(
      critica,
      'teste_duble',
      { descricao: 'A' },
      { ...CTX, reautenticadoEm: agora - 1_000 },
    );
    expect(s.repetida).toBe(false);
  });

  it('porta de liberação recusa antes de gravar; a consulta de liberação devolve o motivo', async () => {
    const b = banco();
    const ex = new Executor(
      b.dependencias({
        liberacao: async (op) => {
          if (op.nome === 'teste.tipo_x.incluir') throw erroNaoLiberada('Falta a chave.');
        },
      }),
    );
    expect(await problema(ex.executar(incluir, 'teste_duble', { descricao: 'A' }, CTX))).toMatchObject({
      status: 403,
    });
    expect(b.estados).not.toContain('iniciar');
    expect(await ex.liberacao(incluir, CTX)).toMatchObject({ pode: false, codigo: 'operacao-nao-liberada' });
    expect(await ex.liberacao(alterar, CTX)).toEqual({ pode: true, codigo: null, motivo: null });
  });

  it('no escritor de quem chama, roda sob SAVEPOINT e volta a ele no erro', async () => {
    const b = banco().quando(/^INSERT INTO trilha_auditoria/, () => {
      throw new Error('falhou');
    });
    const ex = new Executor(b.dependencias());
    await escreverTransacao(b.fonte(), CONFIG_TESTE, CTX, async (e) => {
      await expect(
        ex.executar(incluir, 'teste_duble', { descricao: 'A' }, CTX, { escritor: e }),
      ).rejects.toThrow(ErroOperacao);
    });
    expect(b.que(/SAVEPOINT/).map((c) => c.sql)).toEqual([
      'SAVEPOINT sgh_operacao',
      'ROLLBACK TO SAVEPOINT sgh_operacao',
    ]);
  });
  it('escritor de quem chama aberto no banco de outro cliente: recusado sem gravar', async () => {
    const b = banco();
    const ex = new Executor(b.dependencias());
    await escreverTransacao(
      b.fonte('outro_cliente'),
      CONFIG_TESTE,
      { ...CTX, cliente: 'outro_cliente' },
      async (e) => {
        expect(e.cliente).toBe('outro_cliente');
        expect(
          await problema(ex.executar(incluir, 'teste_duble', { descricao: 'A' }, CTX, { escritor: e })),
        ).toMatchObject({ status: 400, codigo: 'contexto-invalido' });
      },
    );
    expect(b.que(/SAVEPOINT|INSERT/)).toHaveLength(0);
  });
});

describe('Executor: idempotência', () => {
  const anterior = (x: Record<string, unknown> = {}) => [
    {
      hash_entrada: hashEntrada('teste.tipo_x.incluir', { descricao: 'Gasolina' }),
      usuario_id: 3,
      resultado: '{"id":55,"codigo":"X-3"}',
      trilha_auditoria_id: 9,
      ...x,
    },
  ];

  it('mesma chave e mesma entrada: devolve o resultado anterior sem abrir escrita', async () => {
    const b = banco().quando(/FROM idempotencia_operacao/, anterior());
    const metricas = new MetricasExecutor();
    const s = await new Executor(b.dependencias({ metricas })).executar(
      incluir,
      'teste_duble',
      { descricao: 'Gasolina' },
      CTX,
    );
    expect(s).toEqual({ resultado: { id: 55, codigo: 'X-3' }, repetida: true, eventos: [], trilha: 9 });
    expect(b.estados).not.toContain('iniciar');
    expect(metricas.contagem('teste.tipo_x.incluir', 'repetida')).toBe(1);
  });

  it('mesma chave com outra entrada, ou de outro usuário: 422', async () => {
    const outra = banco().quando(/FROM idempotencia_operacao/, anterior());
    expect(
      await problema(
        new Executor(outra.dependencias()).executar(incluir, 'teste_duble', { descricao: 'Diesel' }, CTX),
      ),
    ).toMatchObject({ status: 422, codigo: 'idempotencia-divergente' });
    const outroUsuario = banco().quando(/FROM idempotencia_operacao/, anterior({ usuario_id: 99 }));
    expect(
      await problema(
        new Executor(outroUsuario.dependencias()).executar(
          incluir,
          'teste_duble',
          { descricao: 'Gasolina' },
          CTX,
        ),
      ),
    ).toMatchObject({ status: 422 });
  });

  it('a chave gravada por outra transação ao mesmo tempo: 409 requisicao-em-andamento, desfeito', async () => {
    const b = banco().quando(/^INSERT INTO idempotencia_operacao/, () => {
      throw erroDoBanco(
        1062,
        'ER_DUP_ENTRY',
        "Duplicate entry 'x-chave' for key 'uq_idempotencia_operacao_chave'",
      );
    });
    expect(
      await problema(
        new Executor(b.dependencias()).executar(incluir, 'teste_duble', { descricao: 'A' }, CTX),
      ),
    ).toMatchObject({
      codigo: 'requisicao-em-andamento',
    });
    expect(b.estados).toContain('desfazer');
    expect(b.estados).not.toContain('confirmar');
  });

  it('o hash não depende da ordem das chaves', () => {
    expect(jsonCanonico({ b: 1, a: [new Date(0), { d: undefined, c: 2 }] })).toBe(
      '{"a":["1970-01-01T00:00:00.000Z",{"c":2}],"b":1}',
    );
    expect(hashEntrada('op', { a: 1, b: 2 })).toBe(hashEntrada('op', { b: 2, a: 1 }));
    expect(hashEntrada('op', { a: 1 })).not.toBe(hashEntrada('op2', { a: 1 }));
  });
});

describe('Executor: trava otimista', () => {
  it('versão relida diferente da esperada: 409 conflito-versao sem gravar', async () => {
    const b = banco().quando(/FROM tipo_x WHERE id = \? FOR UPDATE/, [{ id: 5, versao: 3, descricao: 'A' }]);
    const ex = new Executor(b.dependencias());
    expect(
      await problema(ex.executar(alterar, 'teste_duble', { id: 5, versao: 2, descricao: 'B' }, CTX)),
    ).toMatchObject({
      codigo: 'conflito-versao',
      colunas: ['versao'],
    });
    expect(b.que(/^UPDATE tipo_x/)).toHaveLength(0);
  });

  it('registro sumiu: 404', async () => {
    const ex = new Executor(banco().dependencias());
    expect(
      await problema(ex.executar(alterar, 'teste_duble', { id: 5, versao: 2, descricao: 'B' }, CTX)),
    ).toMatchObject({ status: 404 });
  });

  it('versão certa: altera, grava a trilha com o estado anterior e a nova versão', async () => {
    const b = banco().quando(/FROM tipo_x WHERE id = \? FOR UPDATE/, [{ id: 5, versao: 2, descricao: 'A' }]);
    const s = await new Executor(b.dependencias()).executar(
      alterar,
      'teste_duble',
      { id: 5, versao: 2, descricao: 'B' },
      CTX,
    );
    expect(s.resultado).toEqual({ id: 5, versao: 3 });
    const trilha = b.que(/^INSERT INTO trilha_auditoria/)[0]?.parametros ?? [];
    expect(trilha[3]).toBe('alteracao');
    expect(JSON.parse(String(trilha[6]))).toEqual({ id: 5, versao: 2, descricao: 'A' });
  });

  it('esperado por colunas: lista as que mudaram', async () => {
    const porColuna = definirOperacao({
      ...alterar,
      nome: 'teste.por_coluna',
      travar: (e) => ({ tabela: 'tipo_x', id: e.id, esperado: { descricao: 'Lida' } }),
    });
    const b = banco().quando(/FROM tipo_x WHERE id = \? FOR UPDATE/, [
      { id: 5, versao: 2, descricao: 'Mudou' },
    ]);
    expect(
      await problema(
        new Executor(b.dependencias()).executar(
          porColuna,
          'teste_duble',
          { id: 5, versao: 2, descricao: 'B' },
          CTX,
        ),
      ),
    ).toMatchObject({ codigo: 'conflito-versao', colunas: ['descricao'] });
  });

  it('definirOperacao recusa nome e tabela inválidos', () => {
    expect(() => definirOperacao({ ...incluir, nome: 'X' })).toThrow(/Nome/);
    expect(() => definirOperacao({ ...incluir, tabelas: [] })).toThrow(/sem tabelas/);
    expect(() => definirOperacao({ ...incluir, tabelas: ['Tabela-Ruim'] })).toThrow(/inválido/);
  });
});
