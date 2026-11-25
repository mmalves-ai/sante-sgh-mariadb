// Contrato de efeito das rotinas agendadas na Administração (01-SIS L95) no MariaDB:
// - o painel mostra a rotina com a última e a próxima execução, o atraso pela tolerância e o resumo da última execução;
// - acionar deixa a execução "aguardando", disparo manual, com quem pediu e a trilha; o segundo pedido com o primeiro
//   pendente, a rotina que não aceita manual e a suspensa são recusados sem gravar;
// - suspender muda a situação e cancela o pedido pendente (a linha fica, cancelada); retomar volta a ociosa;
// - o histórico traz as execuções (mais recentes primeiro) com as etapas e o login de quem disparou;
// - alcance (dois estabelecimentos): sem config.rotinaCliente.gerir, a rotina do cliente inteiro não se aciona nem se
//   suspende (nada gravado) e o histórico esconde a etapa do outro estabelecimento, com os volumes das que ficaram;
// - a rotina que não aceita suspensão (vigia da plataforma) recusa suspender.
// Massa sintética (prefixo L95A), apagada no fim.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { RotinasAgendadasPropria } from './rotinas-agendadas-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L95A';
const P2 = 'L95B';
const AGORA = new Date('2026-11-25T12:00:00.000Z');

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('rotinas agendadas na administração, no banco próprio', () => {
  const nucleo = new NucleoProprio();
  const porta = new RotinasAgendadasPropria(nucleo, CLIENTE, () => AGORA);
  const ids = { est: 0, est2: 0, usuario: 0, a: 0, b: 0, c: 0, ex: 0, exc: 0 };
  const ctx = (alcanceCliente = true) => ({
    hospital: P,
    login: `${P}.A`,
    alcanceCliente,
    correlacao: 'teste-l95a',
    chaveIdempotencia: `tl95a-${randomUUID()}`,
  });
  const leitura = { hospital: P, login: `${P}.A`, alcanceCliente: true };
  const leituraEst = { ...leitura, alcanceCliente: false };
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l95a' }, (l) => l.consultar(sql, p));

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l95a' }, async (e) => {
      const rot = `SELECT id FROM rotina_agendada WHERE codigo LIKE 'teste.l95a.%'`;
      await e.executar(
        `DELETE FROM execucao_rotina_etapa WHERE execucao_rotina_id IN (SELECT id FROM execucao_rotina WHERE rotina_agendada_id IN (${rot}))`,
      );
      await e.executar(`DELETE FROM execucao_rotina WHERE rotina_agendada_id IN (${rot})`);
      await e.executar(`DELETE FROM rotina_agendada WHERE codigo LIKE 'teste.l95a.%'`);
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l95a' }, async (e) => {
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, AGORA],
      );
      ids.est2 = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P2],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P2, `ESTAB ${P2} SINTETICO`, `ESTAB ${P2} SINTETICO`, AGORA],
      );
      ids.usuario = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.A`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
        [`${P}.A`, AGORA],
      );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l95a' }, async (e) => {
      const rotina = (codigo: string, manual: boolean, proxima: Date, parametros: string | null = null) =>
        e.inserir(
          `INSERT INTO rotina_agendada (estabelecimento_id, codigo, nome, categoria, tipo_agenda, intervalo_segundos,
             tolerancia_atraso_segundos, permite_acionamento_manual, parametros, situacao, ultima_execucao_em, proxima_execucao_em, criado_em)
           VALUES (NULL, ?, ?, 'manutencao', 'intervalo', 60, 600, ?, ?, 'ociosa', ?, ?, ?)`,
          [
            codigo,
            `ROTINA ${codigo}`,
            manual,
            parametros,
            new Date(proxima.getTime() - 60_000),
            proxima,
            AGORA,
          ],
        );
      ids.c = await rotina(
        'teste.l95a.c',
        true,
        new Date(AGORA.getTime() + 60_000),
        JSON.stringify({ suspensivel: false }),
      );
      ids.exc = await e.inserir(
        `INSERT INTO execucao_rotina (rotina_agendada_id, ocorrido_em, disparo, inicio_em, fim_em, situacao,
           registros_lidos, registros_gravados, registros_rejeitados, criado_em)
         VALUES (?, ?, 'agendado', ?, ?, 'concluida_com_avisos', 5, 5, 1, ?)`,
        [ids.c, AGORA, AGORA, AGORA, AGORA],
      );
      for (const [seq, nome, v] of [
        [1, P, 2],
        [2, P2, 3],
      ] as const)
        await e.inserir(
          `INSERT INTO execucao_rotina_etapa (execucao_rotina_id, sequencia, nome, situacao, registros_lidos,
             registros_gravados, registros_rejeitados, criado_em) VALUES (?, ?, ?, 'concluida', ?, ?, ?, ?)`,
          [ids.exc, seq, nome, v, v, seq - 1, AGORA],
        );
      ids.a = await rotina('teste.l95a.a', true, new Date(AGORA.getTime() - 3_600_000));
      ids.b = await rotina('teste.l95a.b', false, new Date(AGORA.getTime() + 60_000));
      ids.ex = await e.inserir(
        `INSERT INTO execucao_rotina (rotina_agendada_id, ocorrido_em, disparo, inicio_em, fim_em, situacao,
           registros_lidos, registros_gravados, registros_rejeitados, criado_em)
         VALUES (?, ?, 'agendado', ?, ?, 'concluida_com_avisos', 5, 4, 1, ?)`,
        [
          ids.a,
          new Date(AGORA.getTime() - 3_700_000),
          new Date(AGORA.getTime() - 3_700_000),
          new Date(AGORA.getTime() - 3_660_000),
          AGORA,
        ],
      );
      await e.inserir(
        `INSERT INTO execucao_rotina_etapa (execucao_rotina_id, sequencia, nome, situacao, registros_lidos,
           registros_gravados, registros_rejeitados, criado_em) VALUES (?, 1, 'EST-SINTETICO', 'concluida_com_avisos', 5, 4, 1, ?)`,
        [ids.ex, AGORA],
      );
    });
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('o painel mostra última e próxima execução, o atraso pela tolerância e a última execução', async () => {
    const { rotinas } = await porta.painel(leitura);
    const a = rotinas.find((r) => r.id === ids.a);
    const b = rotinas.find((r) => r.id === ids.b);
    expect(a).toMatchObject({
      situacao: 'ociosa',
      atrasada: true,
      atrasoSegundos: 3600,
      pedidoPendente: false,
      impedimentoAcionar: null,
      ultima: { id: ids.ex, situacao: 'concluida_com_avisos', lidos: 5, gravados: 4, rejeitados: 1 },
    });
    expect(b).toMatchObject({
      atrasada: false,
      impedimentoAcionar: 'Esta rotina não aceita acionamento manual.',
    });
  });

  it('acionar deixa o pedido aguardando com quem pediu; o segundo pedido e a rotina sem manual são recusados', async () => {
    const r = await porta.acionar(ctx(), { id: ids.a });
    const [x] = await todos('SELECT * FROM execucao_rotina WHERE id = ?', [r.resultado.execucao]);
    expect(x).toMatchObject({
      rotina_agendada_id: ids.a,
      disparo: 'manual',
      situacao: 'aguardando',
      usuario_id: ids.usuario,
      correlacao: 'teste-l95a',
    });
    const [t] = await todos(
      "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'execucao_rotina' AND entidade_id = ?",
      [ids.est, r.resultado.execucao],
    );
    expect(Number(t?.['q'])).toBe(1);
    expect(await codigo(porta.acionar(ctx(), { id: ids.a }))).toBe('execucao-em-curso');
    expect(await codigo(porta.acionar(ctx(), { id: ids.b }))).toBe('sem-acionamento-manual');
    const a = (await porta.painel(leitura)).rotinas.find((y) => y.id === ids.a);
    expect(a).toMatchObject({
      pedidoPendente: true,
      impedimentoAcionar: expect.stringContaining('em curso'),
    });
    const [q] = await todos('SELECT COUNT(*) AS q FROM execucao_rotina WHERE rotina_agendada_id IN (?, ?)', [
      ids.a,
      ids.b,
    ]);
    expect(Number(q?.['q'])).toBe(2);
  });

  it('suspender cancela o pedido pendente (a linha fica) e impede acionar; retomar volta a ociosa', async () => {
    const versao = async () =>
      Number((await todos('SELECT versao FROM rotina_agendada WHERE id = ?', [ids.a]))[0]?.['versao']);
    const s = await porta.suspensao(ctx(), { id: ids.a, versao: await versao(), acao: 'suspender' });
    expect(s.resultado).toMatchObject({ situacao: 'suspensa', cancelados: 1 });
    const ex = await todos('SELECT situacao FROM execucao_rotina WHERE rotina_agendada_id = ? ORDER BY id', [
      ids.a,
    ]);
    expect(ex.map((x) => x['situacao'])).toEqual(['concluida_com_avisos', 'cancelada']);
    expect(await codigo(porta.acionar(ctx(), { id: ids.a }))).toBe('rotina-suspensa');
    expect(
      await codigo(porta.suspensao(ctx(), { id: ids.a, versao: await versao(), acao: 'suspender' })),
    ).toBe('rotina-suspensa');
    const a = (await porta.painel(leitura)).rotinas.find((y) => y.id === ids.a);
    expect(a).toMatchObject({ situacao: 'suspensa', atrasada: false });
    const r = await porta.suspensao(ctx(), { id: ids.a, versao: await versao(), acao: 'retomar' });
    expect(r.resultado).toMatchObject({ situacao: 'ociosa', cancelados: 0 });
    expect(await codigo(porta.suspensao(ctx(), { id: ids.a, versao: await versao(), acao: 'retomar' }))).toBe(
      'rotina-nao-suspensa',
    );
  });

  it('o histórico traz as execuções mais recentes primeiro, com as etapas e quem disparou', async () => {
    const { execucoes } = await porta.historico(leitura, ids.a);
    expect(execucoes.map((x) => [x.situacao, x.disparo, x.usuario])).toEqual([
      ['cancelada', 'manual', `${P}.A`],
      ['concluida_com_avisos', 'agendado', null],
    ]);
    expect(execucoes[1]?.etapas).toEqual([
      expect.objectContaining({ sequencia: 1, nome: 'EST-SINTETICO', lidos: 5, gravados: 4, rejeitados: 1 }),
    ]);
    expect(await codigo(porta.historico(leitura, 999_999_999))).toBe('rotina-desconhecida');
  });

  it('alcance: sem o do cliente, a rotina do cliente não se aciona nem se suspende e o histórico esconde o outro estabelecimento', async () => {
    const versao = async (id: number) =>
      Number((await todos('SELECT versao FROM rotina_agendada WHERE id = ?', [id]))[0]?.['versao']);
    const contar = async () =>
      Number(
        (await todos('SELECT COUNT(*) AS q FROM execucao_rotina WHERE rotina_agendada_id = ?', [ids.c]))[0]?.[
          'q'
        ],
      );
    const antes = await contar();
    expect(await codigo(porta.acionar(ctx(false), { id: ids.c }))).toBe('rotina-do-cliente');
    expect(
      await codigo(
        porta.suspensao(ctx(false), { id: ids.c, versao: await versao(ids.c), acao: 'suspender' }),
      ),
    ).toBe('rotina-do-cliente');
    expect(await contar()).toBe(antes);
    const [r] = await todos('SELECT situacao FROM rotina_agendada WHERE id = ?', [ids.c]);
    expect(r?.['situacao']).toBe('ociosa');

    const estPainel = (await porta.painel(leituraEst)).rotinas.find((y) => y.id === ids.c);
    expect(estPainel).toMatchObject({
      doCliente: true,
      podeGerir: false,
      permiteSuspensao: false,
      impedimentoAcionar: expect.stringContaining('alcance do cliente'),
      ultima: { id: ids.exc, lidos: 2, gravados: 2, rejeitados: 0 },
    });
    const est = await porta.historico(leituraEst, ids.c);
    expect(
      est.execucoes.map((x) => [x.lidos, x.gravados, x.rejeitados, x.etapas.map((y) => y.nome)]),
    ).toEqual([[2, 2, 0, [P]]]);
    // Com o alcance do cliente, tudo aparece.
    const cli = await porta.historico(leitura, ids.c);
    expect(
      cli.execucoes.map((x) => [x.lidos, x.gravados, x.rejeitados, x.etapas.map((y) => y.nome)]),
    ).toEqual([[5, 5, 1, [P, P2]]]);
    expect((await porta.painel(leitura)).rotinas.find((y) => y.id === ids.c)).toMatchObject({
      podeGerir: true,
      impedimentoAcionar: null,
    });
  });

  it('a rotina que não aceita suspensão recusa suspender, sem gravar', async () => {
    const v = Number(
      (await todos('SELECT versao FROM rotina_agendada WHERE id = ?', [ids.c]))[0]?.['versao'],
    );
    expect(await codigo(porta.suspensao(ctx(), { id: ids.c, versao: v, acao: 'suspender' }))).toBe(
      'rotina-nao-suspensivel',
    );
    const [r] = await todos('SELECT situacao, versao FROM rotina_agendada WHERE id = ?', [ids.c]);
    expect(r).toMatchObject({ situacao: 'ociosa', versao: v });
  });
});
