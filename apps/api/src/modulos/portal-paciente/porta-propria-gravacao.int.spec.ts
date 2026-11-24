// Integração da gravação própria do portal do paciente (modulos-proprios-1, portal-b) contra o MariaDB real, cliente
// f22_o3, massa SINTÉTICA criada no beforeAll e apagada no afterAll (nenhum dado de pessoa real). Contrato de efeito
// de cada um dos 22 métodos, pela operação do Executor (trilha, idempotência), com as recusas da porta de memória:
// conta (convite, ativação, entrada, senha, segundo fator, bloqueio, encerramento), troca do e-mail, vínculo do
// responsável (segregação), consentimento (nada apagado), pedido do titular e cópia do prontuário.
// Requer a migração 17_INTG/91_portal_gravacao. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, definirOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GravadorPortal } from './porta.js';
import {
  type EscritaPortal,
  erroDeDominio,
  gravadorGravacaoPropria,
  TABELAS_GRAVACAO_PORTAL,
} from './porta-propria-gravacao.js';
import type { RegistroTrilhaPortal } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'PB0001';
const PRONT = [932_101, 932_102];
const RECEPCAO = 'pb.recepcao';
const CONFERENTE = 'pb.conferente';
const res = (s: string) => s.padEnd(64, '0').slice(0, 64);

type G = Omit<GravadorPortal, 'registrarManifestacao'>;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor, est: number): Promise<void> {
  const sol = 'SELECT id FROM solicitacao_copia_prontuario WHERE estabelecimento_id = ?';
  await e.executar(`DELETE FROM ato_copia_prontuario WHERE solicitacao_copia_prontuario_id IN (${sol})`, [est]);
  await e.executar('DELETE FROM solicitacao_copia_prontuario WHERE estabelecimento_id = ?', [est]);
  await e.executar(
    'DELETE h FROM pedido_titular_historico h JOIN pedido_titular p ON p.id = h.pedido_titular_id WHERE p.estabelecimento_id = ?',
    [est],
  );
  await e.executar('DELETE FROM pedido_titular WHERE estabelecimento_id = ?', [est]);
  await e.executar(
    'DELETE h FROM consentimento_titular_historico h JOIN consentimento_titular c ON c.id = h.consentimento_titular_id WHERE c.estabelecimento_id = ?',
    [est],
  );
  await e.executar('DELETE FROM consentimento_titular WHERE estabelecimento_id = ?', [est]);
  const contas = 'SELECT id FROM conta_portal_paciente WHERE estabelecimento_id = ?';
  await e.executar(`DELETE FROM troca_email_conta_portal WHERE conta_portal_paciente_id IN (${contas})`, [est]);
  await e.executar('DELETE FROM vinculo_responsavel_portal WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM conta_portal_paciente WHERE estabelecimento_id = ?', [est]);
  await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', [est]);
  const pr = PRONT.map(() => '?').join(', ');
  const pfs = await e.consultar(`SELECT pessoa_fisica_id AS id FROM paciente WHERE numero_prontuario IN (${pr})`, PRONT);
  await e.executar(`DELETE FROM paciente WHERE numero_prontuario IN (${pr})`, PRONT);
  for (const x of pfs) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [x['id']]);
}

describe.skipIf(SEM_BANCO)(`gravação própria do portal do paciente (MariaDB, cliente ${CLIENTE})`, () => {
  const nucleo = new NucleoProprio();
  let est = 0;
  let pac: number[] = [];
  const trilhas: RegistroTrilhaPortal[] = [];
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-portal-b' }, (l) => l.consultar(sql, p));
  const um = async (sql: string, p: unknown[]) => (await ler(sql, p))[0]!;

  /** Como a porta própria: uma operação do Executor por gravação, com a trilha na tabela gravada de fato. */
  async function gravar<T>(fn: (g: G) => Promise<T>): Promise<T> {
    const correlacao = `portal-b-${randomUUID()}`.slice(0, 64);
    const ctx: ContextoOperacao = {
      cliente: CLIENTE,
      estabelecimento: est,
      usuario: null,
      correlacao,
      chaveIdempotencia: correlacao,
    };
    const escrita: EscritaPortal = { tabela: 'conta_portal_paciente', id: null };
    let r!: T;
    const op = definirOperacao<{ correlacao: string }, { gravado: boolean }>({
      nome: 'portal-paciente.gravar',
      tabelas: [...TABELAS_GRAVACAO_PORTAL],
      entrada: z.object({ correlacao: z.string() }).strict(),
      gravar: async (tx) => {
        try {
          r = await fn(gravadorGravacaoPropria(tx, est, escrita, (t) => trilhas.push(t)));
        } catch (e) {
          dominio = erroDeDominio(e);
          throw e;
        }
        return { gravado: true };
      },
      alvo: () => ({ tabela: escrita.tabela, id: escrita.id }),
    });
    let dominio: Error | null = null;
    try {
      await nucleo.criarExecutor().executar(op, CLIENTE, { correlacao }, ctx);
    } catch (e) {
      // O executor traduz o erro desconhecido em 500; o erro de domínio (ErroPortal, ErroPedido) volta ao serviço.
      throw dominio ?? e;
    }
    return r;
  }
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const x = e as { codigo?: string; problema?: { codigo?: string } };
      return { codigo: x.codigo ?? x.problema?.codigo, code: x.problema?.codigo };
    }
    throw new Error('era para recusar');
  };
  const conta = (id: number) =>
    um(
      `SELECT situacao, versao, email, login, convite_erradas, tentativas_falhas, senha_resumo, segundo_fator_envelope,
              motivo_bloqueio, encerrada_em IS NOT NULL AS encerrada, convite_usado_em IS NOT NULL AS usado, tipo
         FROM conta_portal_paciente WHERE id = ?`,
      [id],
    );
  const nova = (g: G, paciente: number | null, convite: string) =>
    g.criarConta({
      tipo: paciente === null ? 'responsavel' : 'paciente',
      paciente,
      prontuario: null,
      nome: paciente === null ? 'RESPONSAVEL SINTETICO' : null,
      nascimento: paciente === null ? '1980-01-01' : null,
      conviteResumo: res(convite),
      conviteValidoAte: new Date(Date.now() + 86_400_000),
      origem: 'recepcao',
      por: RECEPCAO,
    });
  const ativacao = (email: string) => ({
    email,
    emailResumo: res(`e${email.length}${email.charCodeAt(0)}`),
    senhaResumo: 'resumo-senha-sintetico',
    segundoFator: 'envelope-sintetico',
    termoUso: 'v1',
    politica: 'v1',
  });

  beforeAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-portal-b' }, async (e) => {
      const agora = new Date();
      est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, 'ESTAB SINTETICO PORTAL B', 'ESTAB SINTETICO PORTAL B', agora],
      );
      await limpar(e, est);
      for (const login of [RECEPCAO, CONFERENTE])
        await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, 'USUARIO SINTETICO PORTAL B', 'pessoa', TRUE, ?)",
          [login, agora],
        );
      await garantir(
        e,
        'SELECT id FROM tipo_termo_lgpd WHERE codigo = ?',
        ['portal_paciente'],
        "INSERT INTO tipo_termo_lgpd (codigo, descricao, ativo, finalidade, criado_em) VALUES ('portal_paciente', 'CONSENTIMENTO PELO PORTAL', TRUE, 'consentimento', ?)",
        [agora],
      );
      pac = [];
      for (const [i, nome] of ['CARLA SINTETICA TESTE', 'BRUNO SINTETICO TESTE'].entries()) {
        const pf = await e.inserir(
          'INSERT INTO pessoa_fisica (nome, data_nascimento, falecida, criado_em) VALUES (?, ?, FALSE, ?)',
          [nome, '1990-07-01', agora],
        );
        pac.push(
          await e.inserir(
            "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, falecido, criado_em) VALUES (?, ?, 'ativo', FALSE, ?)",
            [pf, PRONT[i], agora],
          ),
        );
      }
    });
  }, 60_000);

  afterAll(async () => {
    if (est) await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-portal-b' }, (e) => limpar(e, est));
    await nucleo.encerrar();
  });

  it('conta: convite, erro do convite sem versão, ativação, entrada, senha, segundo fator, bloqueio, refazer e encerramento', async () => {
    const { id } = await gravar((g) => nova(g, pac[0]!, 'conv-a'));
    expect(await conta(id)).toMatchObject({ situacao: 'pendente_ativacao', versao: 1, tipo: 'paciente', email: null });
    expect((await falha(gravar((g) => nova(g, pac[1]!, 'conv-a')))).codigo).toBe('convite-repetido');
    await gravar((g) => g.registrarErroConvite(id));
    expect(await conta(id)).toMatchObject({ convite_erradas: 1, versao: 1 });
    expect((await falha(gravar((g) => g.ativar(id, 9, ativacao('a@x.test'))))).codigo).toBe('versao-desatualizada');
    await gravar((g) => g.ativar(id, 1, ativacao('a@x.test')));
    expect(await conta(id)).toMatchObject({ situacao: 'ativa', versao: 2, login: 'a@x.test', usado: 1 });
    await gravar((g) => g.registrarEntrada(id, { acertou: false, tentativas: 3, bloqueadoAte: new Date() }));
    expect(await conta(id)).toMatchObject({ tentativas_falhas: 3, versao: 2, motivo_bloqueio: 'tentativas' });
    await gravar((g) => g.registrarEntrada(id, { acertou: true, tentativas: 0, bloqueadoAte: null }));
    expect(await conta(id)).toMatchObject({ tentativas_falhas: 0, versao: 2 });
    await gravar((g) => g.trocarSenha(id, 2, 'resumo-novo'));
    await gravar((g) => g.trocarSegundoFator(id, 3, 'envelope-novo'));
    expect(await conta(id)).toMatchObject({ senha_resumo: 'resumo-novo', segundo_fator_envelope: 'envelope-novo', versao: 4 });
    await gravar((g) => g.bloquear(id, 4, { motivo: 'suspeita', por: RECEPCAO }));
    expect(await conta(id)).toMatchObject({ situacao: 'bloqueada', motivo_bloqueio: 'suspeita' });
    expect((await falha(gravar((g) => g.trocarSenha(id, 5, 'x')))).codigo).toBe('versao-desatualizada');
    await gravar((g) => g.desbloquear(id, 5, RECEPCAO));
    expect(await conta(id)).toMatchObject({ situacao: 'ativa', motivo_bloqueio: null, versao: 6 });
    await gravar((g) =>
      g.reemitirConvite(id, 6, {
        conviteResumo: res('conv-a2'),
        conviteValidoAte: new Date(Date.now() + 86_400_000),
        origem: 'recepcao',
        por: RECEPCAO,
        refazer: true,
      }),
    );
    expect(await conta(id)).toMatchObject({ situacao: 'pendente_ativacao', email: null, senha_resumo: null, usado: 0 });
    await gravar((g) => g.encerrar(id, null, { motivo: 'pedido do titular', por: RECEPCAO }));
    expect(await conta(id)).toMatchObject({ situacao: 'encerrada', encerrada: 1 });
    expect((await falha(gravar((g) => g.encerrar(id, null, { motivo: 'x', por: RECEPCAO })))).codigo).toBe(
      'versao-desatualizada',
    );
    // A conta encerrada libera o paciente para uma conta nova.
    const nova2 = await gravar((g) => nova(g, pac[0]!, 'conv-a3'));
    expect(nova2.id).toBeGreaterThan(id);
    const t = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'conta_portal_paciente' AND entidade_id = ?",
      [id],
    );
    expect(Number(t['n'])).toBeGreaterThanOrEqual(10);
  });

  it('troca do e-mail: o pedido novo cancela o pendente; confirmação passa a conta; e-mail em uso recusa', async () => {
    const { id } = await gravar((g) => nova(g, pac[1]!, 'conv-b'));
    await gravar((g) => g.ativar(id, 1, ativacao('b@x.test')));
    const outra = (await um('SELECT id FROM conta_portal_paciente WHERE convite_resumo = ?', [res('conv-a3')]))['id'];
    expect((await falha(gravar((g) => g.ativar(Number(outra), 1, ativacao('b@x.test'))))).codigo).toBe('email-em-uso');
    const pedido = (tok: string) =>
      gravar((g) =>
        g.pedirTrocaEmail({
          conta: id,
          emailNovo: 'b2@x.test',
          emailNovoResumo: res('b2'),
          tokenResumo: res(tok),
          validoAte: new Date(Date.now() + 3_600_000),
          origem: 'portal',
          motivo: 'troca pedida pelo titular',
          pedidoPor: 'SGH.PORTAL.C1',
          envio: 'simulador',
        }),
      );
    const t1 = await pedido('tok-1');
    expect((await falha(pedido('tok-1'))).codigo).toBe('convite-repetido');
    const t2 = await pedido('tok-2');
    expect((await um('SELECT situacao FROM troca_email_conta_portal WHERE id = ?', [t1.id]))['situacao']).toBe('cancelada');
    await gravar((g) => g.confirmarTrocaEmail(t2.id, id, 2, { email: 'b2@x.test', resumo: res('b2') }));
    expect(await conta(id)).toMatchObject({ email: 'b2@x.test', login: 'b2@x.test', versao: 3 });
    expect((await um('SELECT situacao FROM troca_email_conta_portal WHERE id = ?', [t2.id]))['situacao']).toBe('confirmada');
    expect((await falha(gravar((g) => g.cancelarTrocaEmail(t2.id)))).codigo).toBe('situacao');
    const t3 = await pedido('tok-3');
    await gravar((g) => g.cancelarTrocaEmail(t3.id));
    expect((await um('SELECT situacao FROM troca_email_conta_portal WHERE id = ?', [t3.id]))['situacao']).toBe('cancelada');
  });

  it('vínculo do responsável: liberado no balcão, segregação, recusa com motivo e encerramento do pendente', async () => {
    const base = (conta: number, por: string, decididoPor: string | null) => ({
      conta,
      titular: pac[0]!,
      prontuarioTitular: PRONT[0]!,
      tipo: 'procurador',
      prova: 'procuracao',
      arquivoChave: null,
      arquivoHash: null,
      validade: '2099-12-31',
      escopos: ['resultados'],
      canal: 'balcao' as const,
      por,
      decididoPor,
    });
    const k = await gravar(async (g) => {
      const c = await nova(g, null, 'conv-r');
      await g.pedirVinculo(base(c.id, 'SGH.PORTAL.C9', RECEPCAO));
      return c.id;
    });
    expect(await conta(k)).toMatchObject({ tipo: 'responsavel' });
    const v1 = await um('SELECT situacao, decidido_por_usuario_id IS NOT NULL AS u, validade FROM vinculo_responsavel_portal WHERE conta_portal_paciente_id = ?', [k]);
    expect(v1).toMatchObject({ situacao: 'ativo', u: 1 });
    expect((await falha(gravar((g) => g.pedirVinculo(base(k, RECEPCAO, RECEPCAO))))).codigo).toBe('segregacao-decisao');
    const p = await gravar((g) => g.pedirVinculo({ ...base(k, 'SGH.PORTAL.C9', null), canal: 'portal' }));
    expect((await falha(gravar((g) => g.decidirVinculo(p.id, 1, { aprovar: false, motivo: 'x', por: 'SGH.PORTAL.C9' })))).codigo).toBe('segregacao-decisao');
    expect((await falha(gravar((g) => g.decidirVinculo(p.id, 7, { aprovar: false, motivo: 'x', por: CONFERENTE })))).codigo).toBe('versao-desatualizada');
    await gravar((g) => g.decidirVinculo(p.id, 1, { aprovar: false, motivo: 'prova ilegível', por: CONFERENTE }));
    expect(await um('SELECT situacao, motivo_recusa FROM vinculo_responsavel_portal WHERE id = ?', [p.id])).toMatchObject({ situacao: 'recusado', motivo_recusa: 'prova ilegível' });
    const q = await gravar((g) => g.pedirVinculo({ ...base(k, 'SGH.PORTAL.C9', null), canal: 'portal' }));
    await gravar((g) => g.encerrarVinculo(q.id, null, { motivo: 'desistencia', por: 'SGH.PORTAL.C9' }));
    expect(await um('SELECT situacao, decidido_por, decidido_em IS NOT NULL AS d FROM vinculo_responsavel_portal WHERE id = ?', [q.id])).toMatchObject({ situacao: 'encerrado', decidido_por: 'SGH.PORTAL.C9', d: 1 });
    expect((await falha(gravar((g) => g.encerrarVinculo(q.id, null, { motivo: 'x', por: RECEPCAO })))).codigo).toBe('versao-desatualizada');
  });

  it('consentimento: registra autorizado pelo portal, revoga (nada apagado) e recusa domínio desconhecido', async () => {
    const k = Number((await um('SELECT id FROM conta_portal_paciente WHERE convite_resumo = ?', [res('conv-b')]))['id']);
    const reg = (situacao: number) =>
      gravar((g) =>
        g.registrarConsentimento({ idPaciente: pac[1]!, pront: PRONT[1]!, finalidade: 'pesquisa', versao: '2', situacao, signatario: 1, usuario: 'SGH.PORTAL', conta: k, vinculo: null }),
      );
    const { id } = await reg(3);
    expect(await um('SELECT situacao, canal_registro, versao_termo, numero FROM consentimento_titular WHERE id = ?', [id])).toMatchObject({ situacao: 'autorizado', canal_registro: 'portal', versao_termo: '2' });
    expect((await falha(reg(99))).codigo).toBe('situacao-invalida');
    await gravar((g) => g.revogarConsentimento({ idPaciente: pac[1]!, id, motivo: 2, usuario: 'SGH.PORTAL' }));
    expect(await um('SELECT situacao, revogado_em IS NOT NULL AS r FROM consentimento_titular WHERE id = ?', [id])).toMatchObject({ situacao: 'revogado', r: 1 });
    const n = await um('SELECT COUNT(*) AS n FROM consentimento_titular_historico WHERE consentimento_titular_id = ?', [id]);
    expect(Number(n['n'])).toBe(2);
    expect((await falha(gravar((g) => g.revogarConsentimento({ idPaciente: pac[1]!, id, motivo: 2, usuario: 'SGH.PORTAL' })))).codigo).toBe('consentimento-revogado');
  });

  it('pedido do titular e cópia do prontuário: protocolo, cancelamento conferido, atos com o pedido travado', async () => {
    const k = Number((await um('SELECT id FROM conta_portal_paciente WHERE convite_resumo = ?', [res('conv-b')]))['id']);
    const trilha = { rede: CLIENTE, hospital: EST, usuario: 'SGH.PORTAL.C1', evento: 'E', recurso: 'R', operacao: 'portal.x', resultado: 'sucesso', estacao: null, correlacao: 'c' };
    const p = await gravar((g) =>
      g.registrarPedido({ idPaciente: pac[1]!, tipo: 'correcao', descricao: null, por: 'SGH.PORTAL', prazoDias: 15, conta: k, identidadeVerificada: true }, trilha),
    );
    expect(p.protocolo).toMatch(/^LGPD-/);
    expect(trilhas.at(-1)).toMatchObject({ tabelaAlvo: 'pedido_titular', idAlvo: p.id, chaveNaturalAlvo: p.protocolo });
    const cancelar = (conferir: (s: string) => string | null) =>
      gravar((g) => g.cancelarPedido({ protocolo: p.protocolo, idPaciente: pac[1]!, conta: k, motivo: 'desistencia', observacao: null, por: 'SGH.PORTAL', conferir }, trilha));
    const vistas: string[] = [];
    await cancelar((s) => (vistas.push(s), null));
    expect(vistas).toEqual(['identidade-verificada']);
    expect((await falha(cancelar((s) => `não cancela ${s}`))).codigo).toBe('transicao');
    const c = await gravar((g) =>
      g.pedirCopia(
        { idPaciente: pac[1]!, canal: 'portal', conta: k, identidadeVerificada: false, descricao: null, por: 'SGH.PORTAL', prazoDias: 15, solicitante: 'titular', vinculo: null, prova: null },
        { pedido: trilha, copia: trilha },
      ),
    );
    const sol = await um('SELECT s.situacao, s.formato_entrega, a.ato, a.usuario_id, a.conta_portal_paciente_id AS conta FROM solicitacao_copia_prontuario s JOIN ato_copia_prontuario a ON a.solicitacao_copia_prontuario_id = s.id WHERE s.pedido_titular_id = ?', [c.id]);
    expect(sol).toMatchObject({ situacao: 'solicitada', formato_entrega: 'digital', ato: 'solicitacao', usuario_id: null, conta: k });
    const ato = (a: 'legitimidade' | 'geracao' | 'entrega', por = CONFERENTE, extra = {}) =>
      gravar((g) => g.registrarAtoCopia({ protocolo: c.protocolo, idPaciente: null, ato: a, por, conferir: () => null, ...extra }, trilha));
    expect((await falha(ato('legitimidade', 'nao.usuario'))).codigo).toBe('usuario-inexistente');
    expect(await ato('legitimidade', CONFERENTE, { solicitante: 'titular', prova: 'documento' })).toMatchObject({ situacao: 'identidade-verificada', idPedido: c.id });
    await ato('geracao', CONFERENTE, { hash: 'f'.repeat(64), paginas: 3 });
    expect(await ato('entrega', CONFERENTE, { meio: 'digital', recebedor: null })).toMatchObject({ situacao: 'atendido' });
    expect(await um('SELECT s.situacao AS s, p.situacao AS p FROM solicitacao_copia_prontuario s JOIN pedido_titular p ON p.id = s.pedido_titular_id WHERE p.id = ?', [c.id])).toMatchObject({ s: 'entregue', p: 'atendido' });
    const outroTipo = (await falha(gravar((g) => g.registrarAtoCopia({ protocolo: p.protocolo, idPaciente: null, ato: 'geracao', por: CONFERENTE, conferir: () => null }, trilha)))).codigo;
    expect(outroTipo).toBe('transicao');
  });
});
