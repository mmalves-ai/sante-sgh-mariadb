// Executor (ficha do M04, seção 10): os 7 passos com dublê, cada passo falhando de propósito; regra 2 (em
// produção, operação não liberada não grava), regra 6 (prova pós-escrita desfaz), regra 8 (idempotência).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fonteCatalogo } from './catalogo-operacoes.js';
import { type Comando, depsDuble, escritorDuble, type Respondedor } from './duble-escritor.spec-util.js';
import { ErroOperacao, exigirEfeito, recusa } from './erros-operacao.js';
import {
  chaveDoEvento,
  colunasMudadas,
  Executor,
  hashEntrada,
  jsonCanonico,
  MetricasExecutor,
  txDaOperacao,
} from './executor.js';
import { type ContextoOperacao, definirOperacao, type Receita } from './operacao.js';

const RECEITA: Receita = {
  nome: 'teste.incluirItem',
  modulo: 'teste',
  grupo: 'teste',
  descricao: 'Operação sintética do teste do executor.',
  marco: 'M04',
  origem: 'perfil-passivo',
  arquivoOrigem: null,
  evento: 'teste.item.incluido',
  recurso: 'teste.item',
  passos: [
    {
      ordem: 1,
      tabela: 'TABELA_X',
      acao: 'INSERT',
      retorna: ['ID'],
      colunas: {
        NOME: {
          classe: 'entrada',
          origem: 'entrada',
          valor: { de: 'entrada', campo: 'nome', seAusente: null },
        },
      },
    },
  ],
  efeitos: [{ trigger: 'TRG_X_AI', tabela: 'TABELA_Y', acao: 'INSERT', faz: 'retrato' }],
  naoFaz: ['ID'],
  condicao: 'nome não vazio',
  concorrencia: 'inclusão',
  prova: 'relê pelo ID',
  cenarios: [
    { nome: 'feliz', descricao: 'inclui' },
    { nome: 'recusa', descricao: 'recusa', recusa: true },
  ],
};

interface Entrada {
  nome: string;
  versao?: string | undefined;
}

const opBase = {
  receita: RECEITA,
  entrada: z.object({ nome: z.string().min(1), versao: z.string().optional() }),
  async gravar(tx: Parameters<Parameters<typeof definirOperacao>[0]['gravar']>[0], e: Entrada) {
    const r = await tx.executarRetornando('INSERT INTO TABELA_X (NOME) VALUES (?) RETURNING ID', [e.nome]);
    return { id: Number(r['ID']) };
  },
  async provar(
    tx: Parameters<Parameters<typeof definirOperacao>[0]['provar']>[0],
    _e: Entrada,
    r: { id: number },
  ) {
    const l = await tx.uma('SELECT ID FROM TABELA_Y WHERE ID_X = ?', [r.id]);
    exigirEfeito(l, 'TRG_X_AI: retrato');
  },
  eventos: (_e: Entrada, r: { id: number }) => [{ tipo: 'teste.item.incluido', carga: { id: r.id } }],
  alvo: (_e: Entrada, r: { id: number }) => ({ tabela: 'TABELA_X', id: r.id }),
};

const op = definirOperacao<Entrada, { id: number }>(opBase);

const ctx = (extra: Partial<ContextoOperacao> = {}): ContextoOperacao => ({
  rede: 'rede-teste',
  hospital: 'pc',
  traceId: 'teste',
  usuarioLegado: 'USUARIO.TESTE',
  idempotencyKey: 'chave-teste-0001',
  ...extra,
});

/** Banco feliz: insert devolve ID 7; retrato existe; trilha e outbox gravam. */
function banco(sobre: (c: Comando) => ReturnType<Respondedor> | undefined = () => undefined): Respondedor {
  return (c) => {
    const s = sobre(c);
    if (s !== undefined) return s;
    if (c.sql.includes('FROM SGH_IDEMPOTENCIA')) return [];
    if (c.sql.includes('INSERT INTO TABELA_X')) return { ID: 7 };
    if (c.sql.includes('FROM TABELA_Y')) return [{ ID: 1 }];
    if (c.sql.includes('FROM SGH_TRILHA')) return [];
    if (c.sql.includes('SGH_GEN_TRILHA')) return [{ ID: '10', H: '2026-10-20 12:00:00.0000' }];
    if (c.sql.includes('INSERT INTO SGH_OUTBOX')) return { ID: '55' };
    return [];
  };
}

async function falha(p: Promise<unknown>): Promise<ErroOperacao['problema']> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroOperacao);
    return (e as ErroOperacao).problema;
  }
  throw new Error('esperava falha');
}

describe('executor: caminho feliz (passos 0 a 7)', () => {
  it('grava, prova, escreve trilha, outbox e idempotência na mesma transação e só então avisa', async () => {
    const e = escritorDuble(banco());
    const aoConfirmar = vi.fn();
    const metricas = new MetricasExecutor();
    const { deps, registro } = depsDuble(e, { aoConfirmar, metricas });
    const r = await new Executor(deps).executar(op, 'pc', { nome: 'ITEM' }, ctx());
    expect(r).toEqual({ resultado: { id: 7 }, repetida: false, eventos: ['55'], trilha: '10' });
    expect(registro.confirmadas).toBe(1);
    const ordem = e.comandos.map((c) => /INSERT INTO (\w+)|FROM (\w+)/.exec(c.sql)?.slice(1).find(Boolean));
    expect(ordem.indexOf('TABELA_X')).toBeLessThan(ordem.indexOf('SGH_OUTBOX'));
    expect(ordem.filter((t) => t === 'SGH_TRILHA').length).toBeGreaterThanOrEqual(2);
    expect(ordem).toContain('SGH_IDEMPOTENCIA');
    expect(aoConfirmar).toHaveBeenCalledWith('pc', ['55']);
    expect(metricas.resumo()[0]).toMatchObject({ operacao: 'teste.incluirItem', desfechos: { sucesso: 1 } });
    // a carga do evento leva só IDs e o estabelecimento
    const outbox = e.comandos.find((c) => c.sql.includes('INSERT INTO SGH_OUTBOX'));
    expect(JSON.parse(String(outbox?.parametros[4]))).toEqual({ id: 7, hospital: 'pc' });
    // o usuário da trilha é o TBUSERS.NOME da sessão
    const trilha = e.comandos.find((c) => c.sql.includes('INSERT INTO SGH_TRILHA'));
    expect(trilha?.parametros[4]).toBe('USUARIO.TESTE');
  });

  it('desfazer: tudo desfeito no fim e nenhum evento segue', async () => {
    const e = escritorDuble(banco());
    const aoConfirmar = vi.fn();
    const { deps, registro } = depsDuble(e, { aoConfirmar });
    await new Executor(deps).executar(op, 'pc', { nome: 'ITEM' }, ctx(), { desfazer: true });
    expect(registro).toMatchObject({ confirmadas: 0, desfeitas: 1 });
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it('escritor de quem chama (captura): não abre transação própria', async () => {
    const e = escritorDuble(banco());
    const { deps, registro } = depsDuble(escritorDuble(), {});
    await new Executor(deps).executar(op, 'pc', { nome: 'ITEM' }, ctx(), { escritor: e });
    expect(registro).toMatchObject({ confirmadas: 0, desfeitas: 0, leituras: 0 });
    expect(e.comandos.some((c) => c.sql.includes('INSERT INTO TABELA_X'))).toBe(true);
  });
});

describe('passo 0: contexto, entrada, catálogo, liberação, schema, reautenticação e idempotência', () => {
  const exec = (deps: ReturnType<typeof depsDuble>['deps'], entrada: unknown = { nome: 'X' }, c = ctx()) =>
    new Executor(deps).executar(op, 'pc', entrada, c);

  it('sem TBUSERS.NOME, sem Idempotency-Key, outro estabelecimento ou contexto inválido: 400', async () => {
    const { deps } = depsDuble(escritorDuble(banco()));
    expect((await falha(exec(deps, { nome: 'X' }, ctx({ usuarioLegado: '' })))).codigo).toBe(
      'contexto-invalido',
    );
    expect((await falha(exec(deps, { nome: 'X' }, ctx({ idempotencyKey: 'x' })))).codigo).toBe(
      'contexto-invalido',
    );
    expect((await falha(exec(deps, { nome: 'X' }, ctx({ hospital: 'hs' })))).codigo).toBe(
      'contexto-invalido',
    );
    expect((await falha(exec(deps, { nome: 'X' }, ctx({ traceId: '' })))).codigo).toBe('contexto-invalido');
  });

  it('entrada inválida: 400 com os campos (sem valores)', async () => {
    const { deps } = depsDuble(escritorDuble(banco()));
    const p = await falha(exec(deps, { nome: '' }));
    expect(p).toMatchObject({ status: 400, codigo: 'entrada-invalida', campos: ['nome'] });
  });

  it('fora do catálogo ou bloqueada: 423, nada gravado', async () => {
    for (const estado of [null, 'bloqueada'] as const) {
      const e = escritorDuble(banco());
      const { deps } = depsDuble(e, { catalogo: { estado: () => estado } });
      expect((await falha(exec(deps))).status).toBe(423);
      expect(e.comandos).toHaveLength(0);
    }
  });

  it('M36, regra 6: liberada com divergência (ou relatório ilegível) na última reexecução é recusada com o motivo', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'executor-regra6-'));
    try {
      const cat = {
        formato: 1,
        operacoes: [{ nome: 'teste.incluirItem', estado: { pc: 'liberada' } }],
      } as never;
      const relatorio = (data: string, conteudo: string) => {
        mkdirSync(join(pasta, data), { recursive: true });
        writeFileSync(join(pasta, data, 'teste.incluirItem.pc.json'), conteudo);
      };
      const ligada = () =>
        escritorDuble(
          banco((c) =>
            c.sql.includes('FROM SGH_CFG_LIBERACAO')
              ? [{ ESCOPO: 'hospital', VALOR: '*', LIGADA: true }]
              : undefined,
          ),
        );
      const comPasta = () => fonteCatalogo(cat, { pastaResultados: pasta });
      const base = {
        formato: 1,
        operacao: 'teste.incluirItem',
        hospital: 'pc',
        executadoEm: '2026-11-01T10:00:00Z',
      };
      relatorio(
        '2026-11-01',
        JSON.stringify({ ...base, cenarios: [{ cenario: 'basico', resultado: 'verde', diferencas: [] }] }),
      );
      const ok = depsDuble(ligada(), { ambiente: 'producao', catalogo: comPasta() });
      await expect(exec(ok.deps)).resolves.toMatchObject({ repetida: false });
      relatorio(
        '2026-11-02',
        JSON.stringify({
          ...base,
          cenarios: [{ cenario: 'basico', resultado: 'diferencas', diferencas: [] }],
        }),
      );
      const e = ligada();
      const div = depsDuble(e, { ambiente: 'producao', catalogo: comPasta() });
      const p = await falha(exec(div.deps));
      expect(p).toMatchObject({ status: 423, codigo: 'operacao-bloqueada' });
      expect(p.detail).toMatch(/divergência na última reexecução/);
      expect(e.comandos.some((c) => c.sql.includes('INSERT INTO TABELA_X'))).toBe(false);
      relatorio('2026-11-03', '{"formato": 1, "operacao": "teste.inc'); // gravação interrompida
      const p2 = await falha(exec(depsDuble(ligada(), { ambiente: 'producao', catalogo: comPasta() }).deps));
      expect(p2.detail).toMatch(/ilegível/);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('regra 2: em produção, catálogo verde não grava; liberada exige a chave ligada', async () => {
    const e = escritorDuble(
      banco((c) =>
        c.sql.includes('FROM SGH_CFG_LIBERACAO')
          ? [{ ESCOPO: 'hospital', VALOR: '*', LIGADA: false }]
          : undefined,
      ),
    );
    const verde = depsDuble(e, { ambiente: 'producao', catalogo: { estado: () => 'verde' } });
    expect((await falha(exec(verde.deps))).codigo).toBe('operacao-nao-liberada');
    const desligada = depsDuble(e, { ambiente: 'producao', catalogo: { estado: () => 'liberada' } });
    expect((await falha(exec(desligada.deps))).codigo).toBe('operacao-nao-liberada');
    expect(e.comandos.some((c) => c.sql.includes('INSERT'))).toBe(false);
    const ligada = escritorDuble(
      banco((c) =>
        c.sql.includes('FROM SGH_CFG_LIBERACAO')
          ? [{ ESCOPO: 'setor', VALOR: 'REC', LIGADA: true }]
          : undefined,
      ),
    );
    const ok = depsDuble(ligada, { ambiente: 'producao', catalogo: { estado: () => 'liberada' } });
    await expect(exec(ok.deps, { nome: 'X' }, ctx({ setor: 'REC' }))).resolves.toMatchObject({
      repetida: false,
    });
  });

  it('marca de schema bloqueada: 503', async () => {
    const { deps } = depsDuble(escritorDuble(banco()), { schema: { bloqueada: () => true } });
    expect((await falha(exec(deps))).codigo).toBe('schema-divergente');
  });

  it('operação crítica: sem reautenticação recente, 401; com ela, grava', async () => {
    const critica = definirOperacao<Entrada, { id: number }>({
      ...opBase,
      receita: { ...RECEITA, critica: true },
    });
    const { deps } = depsDuble(escritorDuble(banco()), { agora: () => 1_000_000 });
    const x = new Executor(deps);
    expect((await falha(x.executar(critica, 'pc', { nome: 'X' }, ctx()))).codigo).toBe(
      'reautenticacao-necessaria',
    );
    expect((await falha(x.executar(critica, 'pc', { nome: 'X' }, ctx({ reautenticadoEm: 0 })))).status).toBe(
      401,
    );
    await expect(
      x.executar(critica, 'pc', { nome: 'X' }, ctx({ reautenticadoEm: 999_000 })),
    ).resolves.toBeTruthy();
  });

  it('regra 8: a mesma chave com a mesma entrada devolve o resultado da primeira; com entrada diferente, 422', async () => {
    const hash = hashEntrada('teste.incluirItem', { nome: 'X' });
    const e = escritorDuble(
      banco((c) =>
        c.sql.includes('FROM SGH_IDEMPOTENCIA') ? [{ HASH_ENTRADA: hash, RESULTADO: '{"id":7}' }] : undefined,
      ),
    );
    const { deps, registro } = depsDuble(e);
    await expect(exec(deps)).resolves.toEqual({
      resultado: { id: 7 },
      repetida: true,
      eventos: [],
      trilha: null,
    });
    expect(registro.confirmadas).toBe(0);
    expect((await falha(exec(deps, { nome: 'OUTRO' }))).codigo).toBe('idempotencia-divergente');
  });
});

describe('passos 2 e 3: trava, releitura e condição', () => {
  const comTrava = definirOperacao<Entrada, { id: number }>({
    ...opBase,
    travar: (e) => ({
      tabela: 'TABELA_X',
      chave: { ID: 7 },
      colunas: ['DATA_HORA_ULTIMA_ATUALIZACAO', 'NOME'],
      ...(e.versao ? { esperado: { DATA_HORA_ULTIMA_ATUALIZACAO: e.versao } } : {}),
    }),
  });

  it('relê com WITH LOCK numa tabela física única', async () => {
    const e = escritorDuble(
      banco((c) =>
        c.sql.includes('WITH LOCK') ? [{ DATA_HORA_ULTIMA_ATUALIZACAO: 'v1', NOME: 'A' }] : undefined,
      ),
    );
    const { deps } = depsDuble(e);
    await new Executor(deps).executar(comTrava, 'pc', { nome: 'X', versao: 'v1' }, ctx());
    expect(e.comandos.find((c) => c.sql.includes('WITH LOCK'))?.sql).toBe(
      'SELECT DATA_HORA_ULTIMA_ATUALIZACAO, NOME FROM TABELA_X WHERE ID = ? WITH LOCK',
    );
  });

  it('linha sumiu: 404; versão mudou: 409 com as colunas que mudaram', async () => {
    const some = escritorDuble(banco((c) => (c.sql.includes('WITH LOCK') ? [] : undefined)));
    expect(
      (await falha(new Executor(depsDuble(some).deps).executar(comTrava, 'pc', { nome: 'X' }, ctx()))).status,
    ).toBe(404);
    const mudou = escritorDuble(
      banco((c) =>
        c.sql.includes('WITH LOCK') ? [{ DATA_HORA_ULTIMA_ATUALIZACAO: 'v2', NOME: 'A' }] : undefined,
      ),
    );
    const metricas = new MetricasExecutor();
    const p = await falha(
      new Executor(depsDuble(mudou, { metricas }).deps).executar(
        comTrava,
        'pc',
        { nome: 'X', versao: 'v1' },
        ctx(),
      ),
    );
    expect(p).toMatchObject({
      status: 409,
      codigo: 'conflito-versao',
      colunas: ['DATA_HORA_ULTIMA_ATUALIZACAO'],
    });
    expect(Object.values(metricas.resumo()[0]?.colisoesPorHora ?? {})).toEqual([1]);
  });

  it('trava ocupada além do LOCK TIMEOUT: 409 "registro em edição em outro terminal"', async () => {
    const e = escritorDuble(
      banco((c) => {
        if (c.sql.includes('WITH LOCK')) throw new Error('lock time-out on wait transaction\n-deadlock');
        return undefined;
      }),
    );
    const p = await falha(new Executor(depsDuble(e).deps).executar(comTrava, 'pc', { nome: 'X' }, ctx()));
    expect(p).toMatchObject({ status: 409, codigo: 'registro-em-edicao' });
  });

  it('condição recusada no estado relido: 409 com o código da operação, nada gravado', async () => {
    const com = definirOperacao<Entrada, { id: number }>({
      ...opBase,
      async conferir() {
        throw recusa('ja-existe', 'Já existe.');
      },
    });
    const e = escritorDuble(banco());
    const p = await falha(new Executor(depsDuble(e).deps).executar(com, 'pc', { nome: 'X' }, ctx()));
    expect(p).toMatchObject({ status: 409, codigo: 'ja-existe' });
    expect(e.comandos.some((c) => c.sql.includes('INSERT INTO TABELA_X'))).toBe(false);
  });

  it('recusa contada por código (indicadores de disputa da onda 1, M39)', async () => {
    const ocupado = definirOperacao<Entrada, { id: number }>({
      ...opBase,
      async conferir() {
        throw recusa('horario-ocupado', 'Já há uma marcação neste horário.');
      },
    });
    const metricas = new MetricasExecutor();
    const ex = new Executor(depsDuble(escritorDuble(banco()), { metricas }).deps);
    await falha(ex.executar(ocupado, 'pc', { nome: 'X' }, ctx()));
    await falha(ex.executar(ocupado, 'pc', { nome: 'Y' }, ctx()));
    const r = metricas.resumo()[0];
    expect(r?.desfechos).toMatchObject({ recusa: 2 });
    expect(r?.recusasPorCodigo).toEqual({ 'horario-ocupado': 2 });
    expect(r?.colisoesPorHora).toEqual({});
  });
});

describe('passo 4: só as tabelas da receita', () => {
  it('tabela de efeito de trigger, outra tabela ou procedimento: recusado (500), desfeito', async () => {
    for (const sql of [
      'INSERT INTO TABELA_Y (A) VALUES (?)',
      'UPDATE TBGERSEQ SET SEQ = 1',
      'EXECUTE PROCEDURE SP_X',
    ]) {
      const fora = definirOperacao<Entrada, { id: number }>({
        ...opBase,
        async gravar(tx) {
          await tx.executar(sql);
          return { id: 1 };
        },
      });
      const e = escritorDuble(banco());
      const { deps, registro } = depsDuble(e);
      expect((await falha(new Executor(deps).executar(fora, 'pc', { nome: 'X' }, ctx()))).status).toBe(500);
      expect(registro.desfeitas).toBe(1);
    }
  });

  it('exceção de CHECK do legado: 409 em português', async () => {
    const e = escritorDuble(
      banco((c) => {
        if (c.sql.includes('INSERT INTO TABELA_X'))
          throw new Error('Operation violates CHECK constraint "INTEG_9" on view or table "TABELA_X"');
        return undefined;
      }),
    );
    expect(
      (await falha(new Executor(depsDuble(e).deps).executar(op, 'pc', { nome: 'X' }, ctx()))).codigo,
    ).toBe('legado-regra');
  });
});

describe('passo 5: prova pós-escrita (regra 6)', () => {
  it('efeito do trigger ausente: 409 acao_sem_efeito, transação desfeita, nenhum evento', async () => {
    const e = escritorDuble(banco((c) => (c.sql.includes('FROM TABELA_Y') ? [] : undefined)));
    const aoConfirmar = vi.fn();
    const metricas = new MetricasExecutor();
    const { deps, registro } = depsDuble(e, { aoConfirmar, metricas, log: vi.fn() });
    const p = await falha(new Executor(deps).executar(op, 'pc', { nome: 'X' }, ctx()));
    expect(p).toMatchObject({ status: 409, codigo: 'acao_sem_efeito' });
    expect(registro).toMatchObject({ confirmadas: 0, desfeitas: 1 });
    expect(aoConfirmar).not.toHaveBeenCalled();
    expect(e.comandos.some((c) => c.sql.includes('SGH_OUTBOX'))).toBe(false);
    expect(metricas.resumo()[0]?.desfechos).toEqual({ desfeita: 1 });
  });
});

describe('passo 6: SGH_TRILHA, SGH_OUTBOX e SGH_IDEMPOTENCIA', () => {
  it('trilha refaz o encadeamento quando outra transação incluiu o elo antes', async () => {
    let tentativas = 0;
    const e = escritorDuble(
      banco((c) => {
        if (c.sql.includes('INSERT INTO SGH_TRILHA') && tentativas++ === 0) {
          throw new Error(
            'violation of PRIMARY or UNIQUE KEY constraint "SGH_UQ_TRILHA_ELO" on table "SGH_TRILHA"',
          );
        }
        return undefined;
      }),
    );
    await new Executor(depsDuble(e).deps).executar(op, 'pc', { nome: 'X' }, ctx());
    expect(tentativas).toBe(2);
  });

  it('elo da trilha preso por outra transação além do teto: 503 trilha-indisponivel, tudo desfeito (SBIS)', async () => {
    const e = escritorDuble(
      banco((c) => {
        if (c.sql.includes('INSERT INTO SGH_TRILHA'))
          throw new Error(
            'lock time-out on wait transaction; deadlock; update conflicts with concurrent update',
          );
        return undefined;
      }),
    );
    const { deps, registro } = depsDuble(e);
    const p = await falha(new Executor(deps).executar(op, 'pc', { nome: 'X' }, ctx()));
    expect(p).toMatchObject({ status: 503, codigo: 'trilha-indisponivel' });
    expect(registro).toMatchObject({ confirmadas: 0, desfeitas: 1 });
  });

  it('a mesma chave gravada por outra transação ao mesmo tempo: 409 requisicao-em-andamento', async () => {
    const e = escritorDuble(
      banco((c) => {
        if (c.sql.includes('INSERT INTO SGH_IDEMPOTENCIA'))
          throw new Error(
            'violation of PRIMARY or UNIQUE KEY constraint "SGH_PK_IDEMPOTENCIA" on table "SGH_IDEMPOTENCIA"',
          );
        return undefined;
      }),
    );
    expect(
      (await falha(new Executor(depsDuble(e).deps).executar(op, 'pc', { nome: 'X' }, ctx()))).codigo,
    ).toBe('requisicao-em-andamento');
  });

  it('colisão numa chave única do novo e recusa com código do registro SGH_: 409/4xx, tudo desfeito', async () => {
    const com = (erro: Error) =>
      escritorDuble(
        banco((c) => {
          if (c.sql.includes('INSERT INTO SGH_OUTBOX')) throw erro;
          return undefined;
        }),
      );
    const unica = depsDuble(
      com(
        new Error(
          'violation of PRIMARY or UNIQUE KEY constraint "SGH_UQ_PEP_SUMARIO_VERSAO" on table "SGH_PEP_SUMARIO_ALTA"',
        ),
      ),
    );
    expect(await falha(new Executor(unica.deps).executar(op, 'pc', { nome: 'X' }, ctx()))).toMatchObject({
      status: 409,
      codigo: 'conflito-versao',
    });
    expect(unica.registro.desfeitas).toBe(1);
    const recusada = Object.assign(new Error('O parecer já foi respondido ou cancelado.'), {
      codigo: 'parecer-encerrado',
      status: 409,
    });
    const r = depsDuble(com(recusada));
    expect(await falha(new Executor(r.deps).executar(op, 'pc', { nome: 'X' }, ctx()))).toMatchObject({
      status: 409,
      codigo: 'parecer-encerrado',
    });
  });

  it('outra falha no passo 6 desfaz tudo (erro interno sem mensagem do banco)', async () => {
    const e = escritorDuble(
      banco((c) => {
        if (c.sql.includes('INSERT INTO SGH_OUTBOX')) throw new Error('connection lost');
        return undefined;
      }),
    );
    const { deps, registro } = depsDuble(e);
    const p = await falha(new Executor(deps).executar(op, 'pc', { nome: 'X' }, ctx()));
    expect(p).toMatchObject({ status: 500, codigo: 'erro-interno' });
    expect(registro.desfeitas).toBe(1);
  });
});

describe('peças do executor', () => {
  it('JSON canônico e hash da entrada não dependem da ordem das chaves', () => {
    expect(jsonCanonico({ b: 1, a: [new Date(0), { d: undefined, c: 'x' }] })).toBe(
      '{"a":["1970-01-01T00:00:00.000Z",{"c":"x"}],"b":1}',
    );
    expect(hashEntrada('op', { a: 1, b: 2 })).toBe(hashEntrada('op', { b: 2, a: 1 }));
    expect(hashEntrada('op', { a: 1 })).not.toBe(hashEntrada('outra', { a: 1 }));
  });

  it('colunas mudadas comparam data, texto com espaço à direita e NULL', () => {
    const d = new Date(0);
    expect(colunasMudadas({ A: d, B: 'X  ', C: null }, { A: new Date(0), B: 'X', C: null })).toEqual([]);
    expect(colunasMudadas({ A: d, B: 'Y', C: 1 }, { A: new Date(1), B: 'X', C: null })).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('txDaOperacao: lê e escreve só nas tabelas da receita; procedimento recusado', async () => {
    const e = escritorDuble(() => [{ N: 1 }]);
    const tx = txDaOperacao(e, new Set(['TABELA_X']));
    expect(tx.hospital).toBe('pc');
    expect(await tx.uma('SELECT 1 N FROM RDB$DATABASE')).toEqual({ N: 1 });
    await tx.lerBlob(null);
    await expect(tx.executar('UPDATE TABELA_X SET A = 1')).resolves.toBe(1);
    await expect(tx.executarRetornando('INSERT INTO TABELA_X (A) VALUES (1) RETURNING ID')).resolves.toEqual({
      N: 1,
    });
    await expect(tx.executar('DELETE FROM TABELA_Z')).rejects.toThrow(/fora da receita \(TABELA_Z\)/);
    await expect(tx.executar('EXECUTE BLOCK AS BEGIN END')).rejects.toThrow(/procedimento/);
    await expect(tx.executar('SET GENERATOR X TO 1')).rejects.toThrow(/fora da receita/);
    const vazio = escritorDuble(() => []);
    expect(await txDaOperacao(vazio, new Set()).uma('SELECT 1 FROM RDB$DATABASE')).toBeNull();
  });

  it('nome inválido na trava é recusado antes do banco', async () => {
    const ruim = definirOperacao<Entrada, { id: number }>({
      ...opBase,
      travar: () => ({ tabela: 'X; DROP', chave: { ID: 1 }, colunas: ['A'] }),
    });
    expect(
      (
        await falha(
          new Executor(depsDuble(escritorDuble(banco())).deps).executar(ruim, 'pc', { nome: 'X' }, ctx()),
        )
      ).status,
    ).toBe(500);
    const semChave = definirOperacao<Entrada, { id: number }>({
      ...opBase,
      travar: () => ({ tabela: 'TABELA_X', chave: {}, colunas: ['A'] }),
    });
    expect(
      (
        await falha(
          new Executor(depsDuble(escritorDuble(banco())).deps).executar(semChave, 'pc', { nome: 'X' }, ctx()),
        )
      ).status,
    ).toBe(500);
  });
});

describe('revisão do M04: guardas da transação, ambiente, idempotência por pessoa e savepoint', () => {
  it('a leitura da operação recusa escrita, procedimento executável e generator com passo', async () => {
    const e = escritorDuble(() => [{ N: 1 }]);
    const tx = txDaOperacao(e, new Set(['TABELA_X']));
    await expect(tx.uma('UPDATE TBGERSEQ SET SEQ = SEQ + 1 WHERE TIPO = 1 RETURNING SEQ')).rejects.toThrow(
      /escrita pela leitura/,
    );
    await expect(
      tx.consultar('INSERT INTO TABELA_X (NOME) VALUES (?) RETURNING ID', ['A']),
    ).rejects.toThrow();
    await expect(tx.uma('EXECUTE PROCEDURE SP_X')).rejects.toThrow();
    await expect(tx.uma('SELECT GEN_ID(GEN_X, 1) N FROM RDB$DATABASE')).rejects.toThrow();
    await expect(tx.consultar('SELECT NOME FROM SPFONETICA_2(?)', ['A'])).resolves.toEqual([{ N: 1 }]);
    expect(e.comandos).toHaveLength(1);
  });

  it('fora de dev e ci (homolog, treino), só operação verde ou além grava', async () => {
    for (const ambiente of ['homolog', 'treino']) {
      const e = escritorDuble(banco());
      const especificada = depsDuble(e, { ambiente, catalogo: { estado: () => 'especificada' } });
      expect(
        (await falha(new Executor(especificada.deps).executar(op, 'pc', { nome: 'X' }, ctx()))).codigo,
      ).toBe('operacao-nao-liberada');
      const verde = depsDuble(escritorDuble(banco()), { ambiente, catalogo: { estado: () => 'verde' } });
      await expect(new Executor(verde.deps).executar(op, 'pc', { nome: 'X' }, ctx())).resolves.toBeTruthy();
    }
    const dev = depsDuble(escritorDuble(banco()), {
      ambiente: 'dev',
      catalogo: { estado: () => 'especificada' },
    });
    await expect(new Executor(dev.deps).executar(op, 'pc', { nome: 'X' }, ctx())).resolves.toBeTruthy();
  });

  it('a mesma Idempotency-Key usada por outra pessoa: 422, sem devolver o resultado de quem gravou', async () => {
    const hash = hashEntrada('teste.incluirItem', { nome: 'X' });
    const e = escritorDuble(
      banco((c) =>
        c.sql.includes('FROM SGH_IDEMPOTENCIA')
          ? [{ HASH_ENTRADA: hash, RESULTADO: '{"id":7}', USUARIO: 'OUTRA.PESSOA' }]
          : undefined,
      ),
    );
    const x = new Executor(depsDuble(e).deps);
    expect((await falha(x.executar(op, 'pc', { nome: 'X' }, ctx()))).codigo).toBe('idempotencia-divergente');
    await expect(
      x.executar(op, 'pc', { nome: 'X' }, ctx({ usuarioLegado: 'OUTRA.PESSOA' })),
    ).resolves.toMatchObject({ repetida: true, resultado: { id: 7 } });
  });

  it('escritor de quem chama: a operação roda sob SAVEPOINT; na falha volta a ele (nada parcial)', async () => {
    const ok = escritorDuble(banco());
    await new Executor(depsDuble(escritorDuble()).deps).executar(op, 'pc', { nome: 'X' }, ctx(), {
      escritor: ok,
    });
    const sqls = ok.comandos.map((c) => c.sql);
    expect(sqls).toContain('SAVEPOINT SGH_OP');
    expect(sqls.at(-1)).toBe('RELEASE SAVEPOINT SGH_OP');
    const ruim = escritorDuble(banco((c) => (c.sql.includes('FROM TABELA_Y') ? [] : undefined)));
    const metricas = new MetricasExecutor();
    const p = await falha(
      new Executor(depsDuble(escritorDuble(), { metricas, log: vi.fn() }).deps).executar(
        op,
        'pc',
        { nome: 'X' },
        ctx(),
        { escritor: ruim },
      ),
    );
    expect(p.codigo).toBe('acao_sem_efeito');
    const r = ruim.comandos.map((c) => c.sql);
    expect(r.indexOf('SAVEPOINT SGH_OP')).toBeLessThan(
      r.findIndex((s) => s.includes('INSERT INTO TABELA_X')),
    );
    expect(r.at(-1)).toBe('ROLLBACK TO SAVEPOINT SGH_OP');
    // reprodução e escritor de quem chama não entram nas contagens das telas
    expect(metricas.resumo()).toEqual([]);
  });

  it('desfazer (reprodução) não conta como sucesso', async () => {
    const metricas = new MetricasExecutor();
    const { deps } = depsDuble(escritorDuble(banco()), { metricas });
    await new Executor(deps).executar(op, 'pc', { nome: 'X' }, ctx(), { desfazer: true });
    expect(metricas.resumo()).toEqual([]);
  });
});

describe('revisão do M04: chave do evento', () => {
  it('a chave gravada na outbox é a de chaveDoEvento (64 hex, sem hash duplo)', async () => {
    const e = escritorDuble(banco());
    await new Executor(depsDuble(e).deps).executar(op, 'pc', { nome: 'X' }, ctx());
    const ins = e.comandos.find((c) => c.sql.includes('INSERT INTO SGH_OUTBOX'));
    expect(ins?.parametros[3]).toBe(chaveDoEvento('pc', 'teste.incluirItem', 'chave-teste-0001', 0));
    expect(String(ins?.parametros[3])).toMatch(/^[0-9a-f]{64}$/);
  });
});
