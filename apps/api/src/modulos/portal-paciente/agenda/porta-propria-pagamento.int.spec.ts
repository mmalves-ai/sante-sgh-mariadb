// Integração da confirmação própria do pagamento do portal (modulos-proprios-2, portal-leituras) contra o MariaDB real,
// cliente f22_o3, massa SINTÉTICA (estabelecimento, paciente, conta, caixa do portal e forma de recebimento) criada no
// beforeAll e apagada no afterAll. Contrato de efeito: a baixa no recebimento particular, a repetida sem novo
// recebimento, a recusada, a vencida aprovada (duplicado quando a marcação já estava paga) e o catálogo incompleto.
// Requer a migração 17_INTG/92_portal_pagamento_confirmado. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, definirOperacao, type Escritor, type Linha, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { erroDeDominio } from '../porta-propria-gravacao.js';
import type { ConfirmacaoParaGravar } from './porta.js';
import { CAIXA_PORTAL, confirmarPagamentoProprio, TABELAS_CONFIRMACAO_PAGAMENTO } from './porta-propria-pagamento.js';
import type { PagamentoPortal, ResultadoConfirmacaoPortal } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'PL0003';
const PRONT = 933_201;
const FORMA = 'PL_PIX_SINT';
const SQL = `SELECT p.*, NULL AS natureza FROM intencao_pagamento_portal p WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;
const daLinha = (x: Linha) =>
  ({
    id: Number(x['id']),
    situacao: String(x['situacao']),
    pagamentoCaixa: x['recebimento_particular_id'] == null ? null : Number(x['recebimento_particular_id']),
    confirmadoPor: x['confirmado_por'] == null ? null : String(x['confirmado_por']),
    versao: Number(x['versao']),
  }) as unknown as PagamentoPortal;

async function limpar(e: Escritor, est: number): Promise<void> {
  await e.executar('DELETE FROM intencao_pagamento_portal WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM recebimento_particular WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM caixa WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM conta_portal_paciente WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', [est]);
  const pf = await e.consultar('SELECT pessoa_fisica_id AS id FROM paciente WHERE numero_prontuario = ?', [PRONT]);
  await e.executar('DELETE FROM paciente WHERE numero_prontuario = ?', [PRONT]);
  for (const x of pf) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['id']]);
  await e.executar('DELETE FROM forma_recebimento WHERE codigo = ?', [FORMA]);
}

describe.skipIf(SEM_BANCO)(`confirmação própria do pagamento do portal (MariaDB, cliente ${CLIENTE})`, () => {
  const nucleo = new NucleoProprio();
  let est = 0;
  let pac = 0;
  let conta = 0;
  const um = async (sql: string, p: unknown[]) =>
    (await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-portal-pag' }, (l) => l.consultar(sql, p)))[0]!;

  async function confirmar(x: ConfirmacaoParaGravar): Promise<ResultadoConfirmacaoPortal> {
    const correlacao = `portal-pag-${randomUUID()}`.slice(0, 64);
    const ctx: ContextoOperacao = {
      cliente: CLIENTE,
      estabelecimento: est,
      usuario: null,
      correlacao,
      chaveIdempotencia: correlacao,
    };
    const escrita = { tabela: 'intencao_pagamento_portal', id: null as number | null };
    let r!: ResultadoConfirmacaoPortal;
    let dominio: Error | null = null;
    const op = definirOperacao<{ correlacao: string }, { gravado: boolean }>({
      nome: 'portal-agenda.gravar',
      tabelas: [...TABELAS_CONFIRMACAO_PAGAMENTO],
      entrada: z.object({ correlacao: z.string() }).strict(),
      gravar: async (tx) => {
        try {
          r = await confirmarPagamentoProprio(tx, est, x, {
            sqlPagamento: SQL,
            daLinha,
            marcar: (tabela, id) => Object.assign(escrita, { tabela, id }),
          });
        } catch (e) {
          // Como a porta: o erro de domínio (ErroPortal) volta ao serviço depois do ROLLBACK.
          dominio = erroDeDominio(e);
          throw e;
        }
        return { gravado: true };
      },
      alvo: () => ({ tabela: escrita.tabela, id: escrita.id }),
    });
    try {
      await nucleo.criarExecutor().executar(op, CLIENTE, { correlacao }, ctx);
    } catch (e) {
      throw dominio ?? e;
    }
    return r;
  }
  const intencao = (transacao: string, situacao: string, marcacao: number | null = null) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-pag' }, (e) =>
      e.inserir(
        `INSERT INTO intencao_pagamento_portal (estabelecimento_id, conta_portal_paciente_id, paciente_id, marcacao_horario_id,
           valor, forma, conector, transacao, situacao, expira_em, confirmado_em, criado_em)
         VALUES (?, ?, ?, ?, 150.00, 'pix', 'simulado', ?, ?, ?, ?, ?)`,
        [
          est,
          conta,
          pac,
          marcacao,
          transacao,
          situacao,
          new Date(Date.now() + 3_600_000),
          situacao === 'confirmado' ? new Date() : null,
          new Date(),
        ],
      ),
    );
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const x = e as { codigo?: string; problema?: { codigo?: string } };
      return x.codigo ?? x.problema?.codigo;
    }
    throw new Error('era para recusar');
  };
  const tx = (s: string) => `pl-${s}-${randomUUID()}`.slice(0, 80);

  beforeAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-pag' }, async (e) => {
      const agora = new Date();
      const l = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [EST]);
      est = l
        ? Number(l.id)
        : await e.inserir(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [EST, 'ESTAB SINTETICO PORTAL PAG', 'ESTAB SINTETICO PORTAL PAG', agora],
          );
      await limpar(e, est);
      const pf = await e.inserir(
        "INSERT INTO pessoa_fisica (nome, data_nascimento, falecida, criado_em) VALUES ('FABIO SINTETICO TESTE', '1990-07-01', FALSE, ?)",
        [agora],
      );
      pac = await e.inserir(
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, falecido, criado_em) VALUES (?, ?, 'ativo', FALSE, ?)",
        [pf, PRONT, agora],
      );
      conta = await e.inserir(
        "INSERT INTO conta_portal_paciente (estabelecimento_id, tipo, paciente_id, situacao, criado_em) VALUES (?, 'paciente', ?, 'pendente_ativacao', ?)",
        [est, pac, agora],
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (est)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-portal-pag' }, (e) => limpar(e, est));
    await nucleo.encerrar();
  });

  it('sem o caixa do portal ou sem a forma do meio: 503 catalogo-incompleto e nada gravado', async () => {
    const t = tx('cat');
    await intencao(t, 'pendente');
    expect(await falha(confirmar({ transacao: t, resultado: 'aprovado', comprovante: 'c', por: 'retorno' }))).toBe(
      'catalogo-incompleto',
    );
    expect(await um('SELECT situacao FROM intencao_pagamento_portal WHERE transacao = ?', [t])).toMatchObject({
      situacao: 'pendente',
    });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-pag' }, async (e) => {
      await e.inserir(
        "INSERT INTO caixa (estabelecimento_id, codigo, descricao, permite_recebimento, ativo, criado_em) VALUES (?, ?, 'CAIXA SINTETICO DO PORTAL', TRUE, TRUE, ?)",
        [est, CAIXA_PORTAL, new Date()],
      );
    });
    expect(await falha(confirmar({ transacao: t, resultado: 'aprovado', comprovante: 'c', por: 'retorno' }))).toBe(
      'catalogo-incompleto',
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-pag' }, async (e) => {
      await e.inserir(
        "INSERT INTO forma_recebimento (codigo, descricao, meio, uso, criado_em) VALUES (?, 'PIX SINTETICO', 'pix', 'recebimento', ?)",
        [FORMA, new Date()],
      );
    });
  });

  it('aprovado: baixa no recebimento particular; a repetida não grava outro', async () => {
    const t = tx('ok');
    await intencao(t, 'pendente');
    const r = await confirmar({ transacao: t, resultado: 'aprovado', comprovante: 'c', por: 'conferencia' });
    expect(r.mudou).toBe(true);
    expect(r.pagamento).toMatchObject({ situacao: 'confirmado', confirmadoPor: 'conferencia', versao: 2 });
    expect(r.pagamento.pagamentoCaixa).toBeGreaterThan(0);
    const rec = await um(
      'SELECT finalidade, paciente_id, valor, situacao, numero FROM recebimento_particular WHERE id = ?',
      [r.pagamento.pagamentoCaixa],
    );
    expect(rec).toMatchObject({ finalidade: 'avulso', paciente_id: pac, situacao: 'efetivado' });
    expect(Number(rec['valor'])).toBe(150);
    expect(String(rec['numero'])).toMatch(/^RP-/);
    const de = await confirmar({ transacao: t, resultado: 'aprovado', comprovante: 'c', por: 'retorno' });
    expect(de.mudou).toBe(false);
    expect(de.pagamento.pagamentoCaixa).toBe(r.pagamento.pagamentoCaixa);
    expect(
      await um('SELECT COUNT(*) AS n FROM recebimento_particular WHERE estabelecimento_id = ? AND id = ?', [
        est,
        r.pagamento.pagamentoCaixa,
      ]),
    ).toMatchObject({ n: 1 });
  });

  it('recusado: sem recebimento; a transação desconhecida ou de outro estabelecimento não é encontrada', async () => {
    const t = tx('rec');
    await intencao(t, 'pendente');
    const r = await confirmar({ transacao: t, resultado: 'recusado', comprovante: '', por: 'retorno' });
    expect(r.pagamento).toMatchObject({ situacao: 'recusado', pagamentoCaixa: null, confirmadoPor: 'retorno' });
    expect(
      await falha(confirmar({ transacao: tx('nada'), resultado: 'aprovado', comprovante: '', por: 'retorno' })),
    ).toBe('nao-encontrado');
  });

  it('vencida aprovada: vai ao caixa como duplicado quando a marcação já estava paga', async () => {
    const marcacao = await um('SELECT id FROM marcacao_horario ORDER BY id LIMIT 1', []).catch(() => undefined);
    const m = marcacao ? Number(marcacao['id']) : null;
    const paga = tx('paga');
    const tarde = tx('tarde');
    await intencao(paga, 'confirmado', m);
    await intencao(tarde, 'expirado', m);
    const r = await confirmar({ transacao: tarde, resultado: 'aprovado', comprovante: 'c', por: 'retorno' });
    expect(r.pagamento.situacao).toBe(m === null ? 'confirmado' : 'duplicado');
    expect(r.pagamento.pagamentoCaixa).toBeGreaterThan(0);
    const exp = tx('exp');
    await intencao(exp, 'expirado', m);
    expect(
      (await confirmar({ transacao: exp, resultado: 'recusado', comprovante: '', por: 'retorno' })).mudou,
    ).toBe(false);
  });
});
