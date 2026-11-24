// Integração da confirmação própria do pagamento do portal (modulos-proprios-2, portal-leituras) contra o MariaDB real,
// cliente f22_o3, massa SINTÉTICA (estabelecimento, paciente, conta, caixa do portal e forma de recebimento) criada no
// beforeAll e apagada no afterAll, com uma marcação sintética própria e um segundo estabelecimento sintético. Contrato de
// efeito: a baixa no recebimento particular, a repetida sem novo recebimento, a recusada, o isolamento entre
// estabelecimentos, a vencida aprovada (duplicado quando a marcação já estava paga; senão confirmada e as outras
// pendentes da marcação vencem) e o catálogo incompleto. O SELECT e o mapa da linha são os da porta real
// (SQL_PAGAMENTO e pagamentoDaLinha, que lê o confirmado_por).
// Requer a migração 17_INTG/92_portal_pagamento_confirmado. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, definirOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { erroDeDominio } from '../porta-propria-gravacao.js';
import type { ConfirmacaoParaGravar } from './porta.js';
import { pagamentoDaLinha, SQL_PAGAMENTO } from './porta-propria.js';
import {
  CAIXA_PORTAL,
  confirmarPagamentoProprio,
  TABELAS_CONFIRMACAO_PAGAMENTO,
} from './porta-propria-pagamento.js';
import type { ResultadoConfirmacaoPortal } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'PL0003';
const EST2 = 'PL0004';
const PROF = 'PROFISSIONAL SINTETICO PLPAG';
const LOGIN = 'plpag.sint';
const PRONT = 933_201;
const FORMA = 'PL_PIX_SINT';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor, ests: readonly number[]): Promise<void> {
  for (const est of ests) {
    await e.executar('DELETE FROM intencao_pagamento_portal WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM recebimento_particular WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM caixa WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM conta_portal_paciente WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM agenda_servico WHERE estabelecimento_id = ?', [est]);
  }
  const profs = await e.consultar(
    'SELECT p.id, p.pessoa_fisica_id FROM profissional p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome = ?',
    [PROF],
  );
  for (const x of profs) {
    await e.executar('DELETE FROM profissional WHERE id = ?', [x['id']]);
    await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['pessoa_fisica_id']]);
  }
  const pf = await e.consultar('SELECT pessoa_fisica_id AS id FROM paciente WHERE numero_prontuario = ?', [
    PRONT,
  ]);
  await e.executar('DELETE FROM paciente WHERE numero_prontuario = ?', [PRONT]);
  for (const x of pf) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['id']]);
  await e.executar('DELETE FROM forma_recebimento WHERE codigo = ?', [FORMA]);
}

describe.skipIf(SEM_BANCO)(`confirmação própria do pagamento do portal (MariaDB, cliente ${CLIENTE})`, () => {
  const nucleo = new NucleoProprio();
  let est = 0;
  let est2 = 0;
  let pac = 0;
  let conta = 0;
  let conta2 = 0;
  let marcacao = 0;
  let marcacao2 = 0;
  const um = async (sql: string, p: unknown[]) =>
    (
      await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-portal-pag' }, (l) =>
        l.consultar(sql, p),
      )
    )[0]!;

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
            sqlPagamento: SQL_PAGAMENTO,
            daLinha: pagamentoDaLinha,
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
  const intencao = (transacao: string, situacao: string, m: number | null = null, noEst = 0) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-pag' }, (e) =>
      e.inserir(
        `INSERT INTO intencao_pagamento_portal (estabelecimento_id, conta_portal_paciente_id, paciente_id, marcacao_horario_id,
           valor, forma, conector, transacao, situacao, expira_em, confirmado_em, criado_em)
         VALUES (?, ?, ?, ?, 150.00, 'pix', 'simulado', ?, ?, ?, ?, ?)`,
        [
          noEst || est,
          noEst === est2 && noEst ? conta2 : conta,
          pac,
          m,
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
  const coluna = async (t: string) =>
    um('SELECT situacao, confirmado_por FROM intencao_pagamento_portal WHERE transacao = ?', [t]);

  beforeAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-pag' }, async (e) => {
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO PORTAL PAG', 'ESTAB SINTETICO PORTAL PAG', agora],
        );
      est = await estab(EST);
      est2 = await estab(EST2);
      await limpar(e, [est, est2]);
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
      conta2 = await e.inserir(
        "INSERT INTO conta_portal_paciente (estabelecimento_id, tipo, paciente_id, situacao, criado_em) VALUES (?, 'paciente', ?, 'pendente_ativacao', ?)",
        [est2, pac, agora],
      );
      // A marcação sintética própria (agenda, horário e cadastros de apoio com códigos do teste).
      const u = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, 'USUARIO SINTETICO PLPAG', 'pessoa', TRUE, ?)",
        [LOGIN, agora],
      );
      const cadastro = (tabela: string, ins: string) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, ['plpag'], ins, [agora]);
      const cat = await cadastro(
        'categoria_agenda',
        "INSERT INTO categoria_agenda (codigo, descricao, natureza, criado_em) VALUES ('plpag', 'CONSULTA SINTETICA', 'consulta', ?)",
      );
      const tipo = await cadastro(
        'tipo_marcacao',
        "INSERT INTO tipo_marcacao (codigo, descricao, natureza, criado_em) VALUES ('plpag', 'CONSULTA', 'primeira_vez', ?)",
      );
      const canal = await cadastro(
        'canal_marcacao',
        "INSERT INTO canal_marcacao (codigo, descricao, criado_em) VALUES ('plpag', 'PORTAL SINTETICO', ?)",
      );
      const fonte = await cadastro(
        'fonte_pagadora',
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES ('plpag', 'FONTE SINTETICA PLPAG', 'operadora', 'ativa', ?)",
      );
      const sit = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM situacao_marcacao', []);
      const pfProf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        PROF,
        agora,
      ]);
      const prof = await e.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pfProf, agora],
      );
      const agenda = await e.inserir(
        'INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em) VALUES (?, ?, ?, ?, 20, ?)',
        [est, 'AGENDA SINTETICA PLPAG', cat, prof, agora],
      );
      const hoje = agora.toISOString().slice(0, 10);
      const inicio = new Date(`${hoje}T13:00:00.000Z`);
      const horario = await e.inserir(
        'INSERT INTO horario_agenda (estabelecimento_id, agenda_servico_id, data_referencia, inicio_em, fim_em, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [est, agenda, hoje, inicio, new Date(inicio.getTime() + 20 * 60_000), agora],
      );
      const novaMarcacao = (numero: string) =>
        e.inserir(
          `INSERT INTO marcacao_horario (estabelecimento_id, numero, horario_agenda_id, paciente_id, tipo_marcacao_id,
             situacao_marcacao_id, canal_marcacao_id, fonte_pagadora_id, duracao_minutos, marcado_em, responsavel_usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 20, ?, ?, ?)`,
          [est, numero, horario, pac, tipo, Number(sit?.id), canal, fonte, agora, u, agora],
        );
      marcacao = await novaMarcacao('PLPAG-1');
      marcacao2 = await novaMarcacao('PLPAG-2');
    });
  }, 60_000);

  afterAll(async () => {
    if (est)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-portal-pag' }, (e) =>
        limpar(e, [est, est2]),
      );
    await nucleo.encerrar();
  });

  it('sem o caixa do portal ou sem a forma do meio: 503 catalogo-incompleto e nada gravado', async () => {
    const t = tx('cat');
    await intencao(t, 'pendente');
    expect(
      await falha(confirmar({ transacao: t, resultado: 'aprovado', comprovante: 'c', por: 'retorno' })),
    ).toBe('catalogo-incompleto');
    expect(await um('SELECT situacao FROM intencao_pagamento_portal WHERE transacao = ?', [t])).toMatchObject(
      {
        situacao: 'pendente',
      },
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-pag' }, async (e) => {
      await e.inserir(
        "INSERT INTO caixa (estabelecimento_id, codigo, descricao, permite_recebimento, ativo, criado_em) VALUES (?, ?, 'CAIXA SINTETICO DO PORTAL', TRUE, TRUE, ?)",
        [est, CAIXA_PORTAL, new Date()],
      );
    });
    expect(
      await falha(confirmar({ transacao: t, resultado: 'aprovado', comprovante: 'c', por: 'retorno' })),
    ).toBe('catalogo-incompleto');
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
    expect(r.pagamento).toMatchObject({ situacao: 'confirmado', versao: 2 });
    expect(await coluna(t)).toMatchObject({ situacao: 'confirmado', confirmado_por: 'conferencia' });
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
    expect(r.pagamento).toMatchObject({ situacao: 'recusado', pagamentoCaixa: null });
    expect(await coluna(t)).toMatchObject({ situacao: 'recusado', confirmado_por: 'retorno' });
    expect(
      await falha(
        confirmar({ transacao: tx('nada'), resultado: 'aprovado', comprovante: '', por: 'retorno' }),
      ),
    ).toBe('nao-encontrado');
    // A intenção pendente de outro estabelecimento não é encontrada a partir deste, e fica intocada.
    const alheia = tx('outro');
    await intencao(alheia, 'pendente', null, est2);
    expect(
      await falha(confirmar({ transacao: alheia, resultado: 'aprovado', comprovante: 'c', por: 'retorno' })),
    ).toBe('nao-encontrado');
    expect(await coluna(alheia)).toMatchObject({ situacao: 'pendente', confirmado_por: null });
    expect(
      await um('SELECT COUNT(*) AS n FROM recebimento_particular WHERE estabelecimento_id = ?', [est2]),
    ).toMatchObject({ n: 0 });
  });

  it('vencida aprovada: vai ao caixa como duplicado quando a marcação já estava paga', async () => {
    const paga = tx('paga');
    const tarde = tx('tarde');
    await intencao(paga, 'confirmado', marcacao);
    await intencao(tarde, 'expirado', marcacao);
    const r = await confirmar({ transacao: tarde, resultado: 'aprovado', comprovante: 'c', por: 'retorno' });
    expect(r.pagamento.situacao).toBe('duplicado');
    expect(r.pagamento.pagamentoCaixa).toBeGreaterThan(0);
    expect(await coluna(paga)).toMatchObject({ situacao: 'confirmado' });
    const exp = tx('exp');
    await intencao(exp, 'expirado', marcacao);
    expect(
      (await confirmar({ transacao: exp, resultado: 'recusado', comprovante: '', por: 'retorno' })).mudou,
    ).toBe(false);
  });

  it('vencida aprovada sem pagamento anterior: confirmada, e as outras pendentes da marcação vencem', async () => {
    const tarde = tx('tard2');
    const irma = tx('irma');
    await intencao(tarde, 'expirado', marcacao2);
    await intencao(irma, 'pendente', marcacao2);
    const r = await confirmar({
      transacao: tarde,
      resultado: 'aprovado',
      comprovante: 'c',
      por: 'conferencia',
    });
    expect(r.mudou).toBe(true);
    expect(r.pagamento.situacao).toBe('confirmado');
    expect(r.pagamento.pagamentoCaixa).toBeGreaterThan(0);
    expect(await coluna(tarde)).toMatchObject({ situacao: 'confirmado', confirmado_por: 'conferencia' });
    expect(await coluna(irma)).toMatchObject({ situacao: 'expirado' });
  });
});
