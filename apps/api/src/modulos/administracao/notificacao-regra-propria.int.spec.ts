// Contrato de efeito da notificação por regra (01-ADM L76) no MariaDB:
// - a regra de consolidação e a regra de alerta gravadas pela tela (a regra com versão 1 e linha em
//   regra_alerta_versao; a alteração sobe a versão, grava outra linha de versão e o destinatário que sai fica inativo,
//   sem apagar); regra do produto só ativa ou desativa; recusas do domínio sem gravar;
// - a consolidação junta os avisos da mesma janela num envio (quantidade e ids em avisos_consolidados), deixa a
//   janela aberta aguardando, respeita o limite por usuário e não reenvia o que já foi consolidado;
// - o canal externo fora de produção fica capturado; o resultado da entrega segue as transições do domínio;
// - a resposta do destinatário marca o envio lido e os avisos lidos e resolvidos; outra conta é recusada;
// - o histórico mede a resposta por canal;
// - a regra global (sem estabelecimento) com dois estabelecimentos: cada um ativa ou desativa só para si e escolhe só
//   os próprios destinatários; o conteúdo só muda pela plataforma. Massa sintética (prefixo L76N).
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { NotificacaoRegraPropria } from './notificacao-regra-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L76N';
const T0 = new Date('2026-11-20T08:00:00.000');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('notificação por regra no banco próprio', () => {
  const nucleo = new NucleoProprio();
  let agora = min(0);
  let porta: NotificacaoRegraPropria;
  let portaProducao: NotificacaoRegraPropria;
  const ids = { est: 0, est2: 0, a: 0, b: 0, cenario: 0, central: 0, email: 0 };
  const ctx = (login = `${P}.A`, hospital = P) => ({
    hospital,
    login,
    correlacao: 'teste-l76n',
    chaveIdempotencia: `tl76n-${randomUUID()}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l76n' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l76n' }, (l) => l.consultar(sql, p));

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l76n' }, async (e) => {
      if (ids.est) {
        await e.executar(
          'DELETE ea FROM envio_notificacao_aviso ea JOIN envio_notificacao en ON en.id = ea.envio_notificacao_id WHERE en.estabelecimento_id = ?',
          [ids.est],
        );
        await e.executar('DELETE FROM envio_notificacao WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar('DELETE FROM notificacao_usuario WHERE estabelecimento_id = ?', [ids.est]);
      }
      const regras = `SELECT id FROM regra_alerta WHERE codigo LIKE '${P}%'`;
      await e.executar(`DELETE FROM regra_alerta_destinatario WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta_versao WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta_estabelecimento WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM regra_consolidacao_notificacao WHERE codigo LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  async function aviso(usuario: number, regra: number, minuto: number, assunto: string | null = null) {
    return nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l76n' }, (e) =>
      e.inserir(
        `INSERT INTO notificacao_usuario (estabelecimento_id, usuario_id, regra_alerta_id, titulo, texto, gravidade,
            chave_agrupamento, gerada_em, criado_em) VALUES (?, ?, ?, 'AVISO SINTETICO', 'TEXTO SINTETICO', 'atencao', ?, ?, ?)`,
        [ids.est, usuario, regra, assunto, min(minuto), min(minuto)],
      ),
    );
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l76n' }, async (e) => {
      const hoje = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, hoje],
      );
      ids.est2 = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}2`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}2`, `ESTAB ${P}2 SINTETICO`, `ESTAB ${P}2 SINTETICO`, hoje],
      );
      for (const k of ['a', 'b'] as const) {
        ids[k] = await g(
          'SELECT id FROM usuario WHERE login = ?',
          [`${P}.${k.toUpperCase()}`],
          "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
          [`${P}.${k.toUpperCase()}`, hoje],
        );
      }
      ids.cenario = await g(
        'SELECT id FROM cenario_alerta WHERE codigo = ?',
        [P],
        "INSERT INTO cenario_alerta (codigo, descricao, verificador, criado_em) VALUES (?, 'CENARIO SINTETICO', 'sintetico', ?)",
        [P, hoje],
      );
      ids.central = await g(
        'SELECT id FROM canal_notificacao WHERE codigo = ?',
        [`${P}C`],
        "INSERT INTO canal_notificacao (codigo, descricao, tipo_canal, externo, criado_em) VALUES (?, 'CENTRAL SINTETICA', 'central', FALSE, ?)",
        [`${P}C`, hoje],
      );
      ids.email = await g(
        'SELECT id FROM canal_notificacao WHERE codigo = ?',
        [`${P}E`],
        "INSERT INTO canal_notificacao (codigo, descricao, tipo_canal, externo, exige_contato, criado_em) VALUES (?, 'EMAIL SINTETICO', 'email', TRUE, TRUE, ?)",
        [`${P}E`, hoje],
      );
    });
    await limpar();
    porta = new NotificacaoRegraPropria(nucleo, CLIENTE, false, () => agora);
    portaProducao = new NotificacaoRegraPropria(nucleo, CLIENTE, true, () => agora);
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  const regraBase = {
    codigo: `${P}R1`,
    nome: 'REGRA SINTETICA',
    cenario: P,
    mensagem: 'MENSAGEM SINTETICA',
    vigenciaInicio: '2026-11-01',
    notificaTela: true,
    notificaEmail: true,
    consolidacao: `${P}J`,
    destinatarios: [
      { tipo: 'usuario' as const, codigo: `${P}.A` },
      { tipo: 'usuario' as const, codigo: `${P}.B` },
    ],
  };
  let regra = 0;

  it('grava a consolidação e a regra de alerta com versão e destinatários', async () => {
    expect(
      await codigo(
        porta.gravarRegraConsolidacao(ctx(), {
          codigo: `${P}X`,
          nome: 'X',
          janelaMinutos: 15,
          campos: ['regra'],
          limitePorUsuario: 2,
        }),
      ),
    ).toBe('limite-sem-periodo');
    const c = await porta.gravarRegraConsolidacao(ctx(), {
      codigo: `${P}J`,
      nome: 'JANELA SINTETICA',
      janelaMinutos: 15,
      campos: ['regra', 'assunto'],
      limitePorUsuario: 2,
      periodoLimiteMinutos: 60,
    });
    const linhaC = await um(
      'SELECT chave_agrupamento, janela_minutos, limite_por_usuario FROM regra_consolidacao_notificacao WHERE id = ?',
      [c.resultado.consolidacao],
    );
    expect(linhaC).toMatchObject({
      chave_agrupamento: 'regra,assunto',
      janela_minutos: 15,
      limite_por_usuario: 2,
    });

    expect(await codigo(porta.gravarRegraAlerta(ctx(), { ...regraBase, destinatarios: [] }))).toBe(
      'regra-sem-destinatario',
    );
    expect(await codigo(porta.gravarRegraAlerta(ctx(), { ...regraBase, cenario: 'NAOEXISTE' }))).toBe(
      'cenario-inexistente',
    );
    const r = await porta.gravarRegraAlerta(ctx(), regraBase);
    regra = r.resultado.regra;
    expect(r.resultado.numeroVersao).toBe(1);
    expect(
      await um(
        'SELECT numero_versao_vigente, editavel, regra_consolidacao_notificacao_id FROM regra_alerta WHERE id = ?',
        [regra],
      ),
    ).toMatchObject({
      numero_versao_vigente: 1,
      regra_consolidacao_notificacao_id: c.resultado.consolidacao,
    });
    const v1 = await todos(
      'SELECT numero_versao, operacao FROM regra_alerta_versao WHERE regra_alerta_id = ?',
      [regra],
    );
    expect(v1).toEqual([{ numero_versao: 1, operacao: 'inclusao' }]);

    // Alteração: tira B (fica inativo, não apagado), nova versão.
    const lida = await um('SELECT versao FROM regra_alerta WHERE id = ?', [regra]);
    await porta.gravarRegraAlerta(ctx(), {
      ...regraBase,
      id: regra,
      versao: Number(lida!['versao']),
      mensagem: 'MENSAGEM SINTETICA 2',
      destinatarios: [regraBase.destinatarios[0]],
      motivo: 'ajuste sintetico',
    });
    const ds = await todos(
      'SELECT usuario_id, ativo FROM regra_alerta_destinatario WHERE regra_alerta_id = ? ORDER BY usuario_id',
      [regra],
    );
    expect(ds.map((d) => [Number(d['usuario_id']), Boolean(Number(d['ativo']))])).toEqual([
      [ids.a, true],
      [ids.b, false],
    ]);
    const v2 = await todos(
      'SELECT numero_versao, operacao, motivo_alteracao FROM regra_alerta_versao WHERE regra_alerta_id = ? ORDER BY numero_versao',
      [regra],
    );
    expect(v2.map((x) => [x['numero_versao'], x['operacao']])).toEqual([
      [1, 'inclusao'],
      [2, 'alteracao'],
    ]);
    // Volta B (reativado na mesma linha).
    const lida2 = await um('SELECT versao FROM regra_alerta WHERE id = ?', [regra]);
    await porta.gravarRegraAlerta(ctx(), { ...regraBase, id: regra, versao: Number(lida2!['versao']) });
    expect(
      await um(
        'SELECT COUNT(*) AS n, SUM(ativo) AS ativos FROM regra_alerta_destinatario WHERE regra_alerta_id = ?',
        [regra],
      ),
    ).toMatchObject({ n: 2 });
  });

  it('regra do produto só ativa ou desativa', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l76n' }, (e) =>
      e.executar('UPDATE regra_alerta SET editavel = FALSE WHERE id = ?', [regra]),
    );
    const v = Number((await um('SELECT versao FROM regra_alerta WHERE id = ?', [regra]))!['versao']);
    expect(
      await codigo(porta.gravarRegraAlerta(ctx(), { ...regraBase, id: regra, versao: v, mensagem: 'OUTRA' })),
    ).toBe('regra-do-produto');
    await porta.gravarRegraAlerta(ctx(), { ...regraBase, id: regra, versao: v, ativo: false });
    expect(await um('SELECT ativo, mensagem FROM regra_alerta WHERE id = ?', [regra])).toMatchObject({
      ativo: 0,
      mensagem: 'MENSAGEM SINTETICA',
    });
    const v2 = Number((await um('SELECT versao FROM regra_alerta WHERE id = ?', [regra]))!['versao']);
    await porta.gravarRegraAlerta(ctx(), { ...regraBase, id: regra, versao: v2, ativo: true });
  });

  let envioA = 0;
  it('consolida por janela e limite, sem reenviar, e mede a resposta', async () => {
    const a1 = await aviso(ids.a, regra, 0);
    const a2 = await aviso(ids.a, regra, 5);
    const a3 = await aviso(ids.a, regra, 10);
    await aviso(ids.a, regra, 30); // janela aberta em t=40
    const b1 = await aviso(ids.b, regra, 2);
    agora = min(40);
    const r = await porta.consolidarAgora(ctx(), { canal: `${P}C` });
    expect(r.resultado).toMatchObject({ envios: 2, avisos: 4, aguardando: 1, retidos: 0 });
    const envios = await todos(
      `SELECT id, usuario_id, quantidade_avisos, avisos_consolidados, situacao, notificacao_usuario_id
         FROM envio_notificacao WHERE estabelecimento_id = ? AND canal_notificacao_id = ? ORDER BY usuario_id`,
      [ids.est, ids.central],
    );
    const lista = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    expect(
      envios.map((x) => [
        Number(x['usuario_id']),
        x['quantidade_avisos'],
        lista(x['avisos_consolidados']),
        x['situacao'],
      ]),
    ).toEqual([
      [ids.a, 3, [a1, a2, a3], 'entregue'],
      [ids.b, 1, [b1], 'entregue'],
    ]);
    expect(Number(envios[1]!['notificacao_usuario_id'])).toBe(b1);
    envioA = Number(envios[0]!['id']);
    // Um item por aviso, ligado ao envio e ao canal (o "não reenviar" é por este índice).
    expect(
      await um(
        `SELECT COUNT(*) AS n FROM envio_notificacao_aviso ea JOIN envio_notificacao en ON en.id = ea.envio_notificacao_id
          WHERE en.estabelecimento_id = ? AND ea.canal_notificacao_id = ?`,
        [ids.est, ids.central],
      ),
    ).toMatchObject({ n: 4 });

    // Rodar de novo não reenvia; a janela de t=30 fecha em t=45 e passa a sair.
    agora = min(41);
    expect((await porta.consolidarAgora(ctx(), { canal: `${P}C` })).resultado).toMatchObject({ envios: 0 });
    // Limite 2 por usuário em 60 min: A já tem 1; um assunto diferente faz outro grupo; o 3º fica retido.
    await aviso(ids.a, regra, 31, 'OUTRO');
    agora = min(50);
    const r2 = await porta.consolidarAgora(ctx(), { canal: `${P}C` });
    expect(r2.resultado).toMatchObject({ envios: 1, retidos: 1 });

    // E-mail fora de produção: capturado (nada sai); em produção: pendente para o despachante.
    const e1 = await porta.consolidarAgora(ctx(), { canal: `${P}E` });
    expect(e1.resultado.envios).toBeGreaterThan(0);
    expect(
      await um(
        "SELECT COUNT(*) AS n FROM envio_notificacao WHERE canal_notificacao_id = ? AND situacao <> 'capturado'",
        [ids.email],
      ),
    ).toMatchObject({ n: 0 });
    await aviso(ids.b, regra, 60);
    agora = min(90);
    await portaProducao.consolidarAgora(ctx(), { canal: `${P}E` });
    const pend = await um(
      "SELECT id, versao, tentativas FROM envio_notificacao WHERE canal_notificacao_id = ? AND situacao = 'pendente'",
      [ids.email],
    );
    expect(pend).toMatchObject({ tentativas: 0 });

    // Resultado da entrega: falha (conta a tentativa), nova tentativa, envio (2ª tentativa); "ler" não é do despachante.
    const idP = Number(pend!['id']);
    await porta.registrarSituacao(ctx(), {
      envio: idP,
      versao: Number(pend!['versao']),
      evento: 'falhar',
      erro: 'SINTETICO',
    });
    expect(
      await codigo(
        porta.registrarSituacao(ctx(), {
          envio: idP,
          versao: Number(pend!['versao']) + 1,
          evento: 'entregar',
        }),
      ),
    ).toBe('transicao-invalida');
    await porta.registrarSituacao(ctx(), {
      envio: idP,
      versao: Number(pend!['versao']) + 1,
      evento: 'repetir',
    });
    await porta.registrarSituacao(ctx(), {
      envio: idP,
      versao: Number(pend!['versao']) + 2,
      evento: 'enviar',
    });
    expect(
      await um('SELECT situacao, tentativas, erro FROM envio_notificacao WHERE id = ?', [idP]),
    ).toMatchObject({
      situacao: 'enviado',
      tentativas: 2,
      erro: 'SINTETICO',
    });
  });

  it('a resposta do destinatário marca lido e resolve os avisos; outra conta é recusada', async () => {
    const v = Number((await um('SELECT versao FROM envio_notificacao WHERE id = ?', [envioA]))!['versao']);
    expect(
      await codigo(porta.responderEnvio(ctx(`${P}.B`), { envio: envioA, versao: v, resolver: true })),
    ).toBe('envio-de-outra-conta');
    agora = min(52);
    const r = await porta.responderEnvio(ctx(), { envio: envioA, versao: v, resolver: true });
    expect(r.resultado).toEqual({ situacao: 'lido', avisos: 3, resolvidos: 3 });
    expect(
      await um('SELECT situacao, lido_em IS NOT NULL AS lido FROM envio_notificacao WHERE id = ?', [envioA]),
    ).toMatchObject({
      situacao: 'lido',
      lido: 1,
    });
    const avisos = await todos(
      `SELECT lida, resolvida, resolvida_por_usuario_id FROM notificacao_usuario
        WHERE JSON_CONTAINS((SELECT avisos_consolidados FROM envio_notificacao WHERE id = ?), CAST(id AS CHAR))`,
      [envioA],
    );
    expect(avisos).toHaveLength(3);
    expect(
      avisos.every(
        (x) =>
          Number(x['lida']) === 1 &&
          Number(x['resolvida']) === 1 &&
          Number(x['resolvida_por_usuario_id']) === ids.a,
      ),
    ).toBe(true);
    expect(await codigo(porta.responderEnvio(ctx(), { envio: envioA, versao: v + 1 }))).toBe(
      'transicao-invalida',
    );

    // Histórico com a medição por canal (com as parcelas) e os envios da própria conta.
    agora = new Date();
    const h = await porta.historico(ctx());
    const central = h.medicao.find((m) => m.canal === `${P}C`);
    expect(central).toMatchObject({
      envios: 3,
      lidos: 1,
      falhas: 0,
      taxaLeituraPercentual: 33,
      medianaMinutosAteLeitura: 12,
    });
    expect((await porta.meusEnvios(ctx())).some((e) => e.id === envioA && e.situacao === 'lido')).toBe(true);
    const painel = await porta.painel(ctx());
    expect(painel.regras.find((x) => x.id === regra)).toMatchObject({
      consolidacao: `${P}J`,
      numeroVersao: 5,
    });
  });
  it('regra global com dois estabelecimentos: cada um só o próprio registro; o conteúdo só pela plataforma', async () => {
    const g = await porta.gravarRegraAlerta(ctx(), {
      ...regraBase,
      codigo: `${P}G`,
      consolidacao: null,
      destinatarios: [{ tipo: 'usuario' as const, codigo: `${P}.A` }],
    });
    const rg = g.resultado.regra;
    // Torna global (como vêm as regras do produto e as do cliente inteiro); o destinatário de A fica no escopo de A.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l76n' }, async (e) => {
      await e.executar('UPDATE regra_alerta SET estabelecimento_id = NULL WHERE id = ?', [rg]);
    });
    const ver = async () =>
      Number((await um('SELECT versao FROM regra_alerta WHERE id = ?', [rg]))!['versao']);
    const base = {
      ...regraBase,
      codigo: `${P}G`,
      consolidacao: null,
      id: rg,
      destinatarios: [{ tipo: 'usuario' as const, codigo: `${P}.A` }],
    };
    const v0 = await ver();
    // O estabelecimento A não muda o conteúdo da regra global.
    expect(
      await codigo(porta.gravarRegraAlerta(ctx(), { ...base, versao: v0, mensagem: 'MUDADA POR A' })),
    ).toBe('regra-global');
    // A desativa só para si: a regra continua ativa e intacta.
    await porta.gravarRegraAlerta(ctx(), { ...base, versao: v0, ativo: false });
    expect(await um('SELECT ativo, mensagem, versao FROM regra_alerta WHERE id = ?', [rg])).toMatchObject({
      ativo: 1,
      mensagem: 'MENSAGEM SINTETICA',
      versao: v0,
    });
    expect(
      await todos(
        'SELECT estabelecimento_id, ativo FROM regra_alerta_estabelecimento WHERE regra_alerta_id = ?',
        [rg],
      ),
    ).toEqual([{ estabelecimento_id: ids.est, ativo: 0 }]);
    // B escolhe só o próprio destinatário: o de A continua ativo, no escopo de A.
    await porta.gravarRegraAlerta(ctx(`${P}.B`, `${P}2`), {
      ...base,
      versao: v0,
      destinatarios: [{ tipo: 'usuario' as const, codigo: `${P}.B` }],
    });
    const ds = await todos(
      'SELECT estabelecimento_id, usuario_id, ativo FROM regra_alerta_destinatario WHERE regra_alerta_id = ? ORDER BY usuario_id',
      [rg],
    );
    expect(
      ds.map((d) => [Number(d['estabelecimento_id']), Number(d['usuario_id']), Number(d['ativo'])]),
    ).toEqual([
      [ids.est, ids.a, 1],
      [ids.est2, ids.b, 1],
    ]);
    // Cada painel vê a própria situação e só os próprios destinatários.
    const pa = (await porta.painel(ctx())).regras.find((x) => x.id === rg);
    const pb = (await porta.painel(ctx(`${P}.B`, `${P}2`))).regras.find((x) => x.id === rg);
    expect(pa).toMatchObject({ ativo: false });
    expect(pb).toMatchObject({ ativo: true });
    expect(JSON.stringify(pa?.destinatarios)).toContain(`${P}.A`);
    expect(JSON.stringify(pa?.destinatarios)).not.toContain(`${P}.B`);
    expect(JSON.stringify(pb?.destinatarios)).not.toContain(`${P}.A`);
    // A plataforma altera o conteúdo (nova versão).
    const r = await porta
      .gravarRegraAlerta(
        { ...ctx(), plataforma: true },
        { ...base, versao: v0, mensagem: 'MUDADA PELA PLATAFORMA', destinatarios: [], ativo: true },
      )
      .catch((x: unknown) => x);
    expect(r).toBeInstanceOf(ErroOperacao); // sem destinatário próprio nem global: recusa do domínio
    const r2 = await porta.gravarRegraAlerta(
      { ...ctx(), plataforma: true },
      { ...base, versao: v0, mensagem: 'MUDADA PELA PLATAFORMA' },
    );
    expect(r2.resultado.numeroVersao).toBe(2);
    expect(await um('SELECT mensagem FROM regra_alerta WHERE id = ?', [rg])).toMatchObject({
      mensagem: 'MUDADA PELA PLATAFORMA',
    });
    // O destinatário da plataforma fica no escopo de todos; os dos estabelecimentos não mudam.
    expect(
      await um(
        'SELECT COUNT(*) AS n FROM regra_alerta_destinatario WHERE regra_alerta_id = ? AND estabelecimento_id IS NULL AND ativo',
        [rg],
      ),
    ).toMatchObject({ n: 1 });
    expect(
      await um(
        'SELECT COUNT(*) AS n FROM regra_alerta_destinatario WHERE regra_alerta_id = ? AND estabelecimento_id IS NOT NULL AND ativo',
        [rg],
      ),
    ).toMatchObject({ n: 2 });
  });
});
