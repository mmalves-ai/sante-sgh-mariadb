// Contrato de efeito do envio mensal da notificação de IRAS ao órgão sanitário (F7, 09-AREA linha 68) contra o MariaDB
// do cliente de teste. Massa SINTÉTICA: o estabelecimento e o usuário da massa do SADT, com duas competências da
// vigilância criadas aqui (uma fechada, outra aberta) num ano passado sorteado. Prova o que fica no banco: o envio
// inicial pendente com o retrato (operação e dados), o andamento com a versão conferida e a anterior na trilha, a
// competência que passa a "enviada" no primeiro formulário transmitido, a retificação com motivo, as recusas da regra
// e a leitura restrita ao estabelecimento. Um componente cirúrgico sintético no cadastro torna a cirurgia devida: sem
// envio, ela aparece com a última situação nula e atrasa a competência vencida; o envio grava o componente.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from '../sadt/aplicacao/copia.spec-util.js';
import { contextoDe } from '../enfermagem/massa-enfermagem.spec-util.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaNotificacaoIrasPropria } from './porta-notificacao-iras-propria.js';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO)('notificação de IRAS ao órgão sanitário (porta própria, MariaDB)', () => {
  const nucleo = new NucleoProprio();
  let m: MassaSadt | null = null;
  let porta: PortaNotificacaoIrasPropria;
  let fechada = 0;
  let aberta = 0;
  let envio = 0;
  let componente = 0;
  const ano = 2001 + Math.floor(Math.random() * 20);
  const mes = 1 + Math.floor(Math.random() * 11);
  const proxima = `${String(ano)}-${String(mes + 1).padStart(2, '0')}-05`;
  const trilha = (id: number): TrilhaDaGravacao => ({
    estabelecimento: m?.base.est ?? null,
    usuario: m?.base.usuario ?? null,
    acao: 'operacao',
    entidade: 'notificacao_iras_envio',
    entidadeId: id,
    correlacao: 'teste-notificacao-iras',
  });
  const t = (r: { id: number }) => trilha(r.id);
  const ctx = () =>
    contextoDe(m!.base) as unknown as Parameters<PortaNotificacaoIrasPropria['competencias']>[0];
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-nir' }, (l) => l.consultar<T>(sql, p, { teto: 50 }));
  const entrada = (extra = {}) => ({
    formulario: 'uti_adulto',
    situacao: 'pendente' as const,
    enviadoEm: null,
    protocolo: null,
    motivoRetificacao: null,
    ...extra,
  });

  beforeAll(async () => {
    m = await montarMassaSadt(nucleo, 'NIR');
    porta = new PortaNotificacaoIrasPropria(nucleo);
    const ids = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-nir' }, async (e) => {
      const agora = new Date();
      const f = await e.inserir(
        `INSERT INTO fechamento_vigilancia_iras (estabelecimento_id, ano, mes, situacao, responsavel_usuario_id, fechado_em,
           fechado_por_usuario_id, origem, criado_em, criado_por, versao) VALUES (?, ?, ?, 'fechada', ?, ?, ?, 'sistema', ?, ?, 1)`,
        [m!.base.est, ano, mes, m!.base.usuario, agora, m!.base.usuario, agora, m!.base.usuario],
      );
      const a = await e.inserir(
        `INSERT INTO fechamento_vigilancia_iras (estabelecimento_id, ano, mes, situacao, origem, criado_em, criado_por, versao)
         VALUES (?, ?, 12, 'aberta', 'sistema', ?, ?, 1)`,
        [m!.base.est, ano, agora, m!.base.usuario],
      );
      const cv = await e.inserir(
        `INSERT INTO componente_vigilancia (codigo, descricao, ativo, tipo_componente, criado_em, criado_por, versao)
         VALUES (?, 'Componente cirúrgico sintético', TRUE, 'cirurgico', ?, ?, 1)`,
        [`SINT-NIR-${String(Date.now()).slice(-10)}`, agora, m!.base.usuario],
      );
      return { f, a, cv };
    });
    fechada = ids.f;
    aberta = ids.a;
    componente = ids.cv;
  }, 120_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-nir' }, async (e) => {
        await e.executar('DELETE FROM notificacao_iras_envio WHERE fechamento_vigilancia_iras_id IN (?, ?)', [
          fechada,
          aberta,
        ]);
        await e.executar('DELETE FROM fechamento_vigilancia_iras WHERE id IN (?, ?)', [fechada, aberta]);
        if (componente) await e.executar('DELETE FROM componente_vigilancia WHERE id = ?', [componente]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 120_000);

  it('registra o envio inicial pendente com o retrato; a competência segue fechada', async () => {
    const r = await porta.registrar(ctx(), m!.base.login, fechada, entrada(), t);
    envio = r.id;
    expect(r).toMatchObject({ tipo: 'inicial', situacao: 'pendente' });
    const [x] = await ler<Record<string, unknown>>(
      'SELECT operacao, tipo_envio, situacao, enviado_em, usuario_id, criado_por, versao, dados FROM notificacao_iras_envio WHERE id = ?',
      [envio],
    );
    expect(x).toMatchObject({
      operacao: 'inclusao',
      tipo_envio: 'inicial',
      situacao: 'pendente',
      enviado_em: null,
    });
    expect(Number(x!['versao'])).toBe(1);
    expect(Number(x!['criado_por'])).toBe(m!.base.usuario);
    const dados = typeof x!['dados'] === 'string' ? JSON.parse(x!['dados']) : x!['dados'];
    expect(dados).toMatchObject({ formulario: 'uti_adulto', tipo: 'inicial', situacao: 'pendente' });
    const [f] = await ler('SELECT situacao FROM fechamento_vigilancia_iras WHERE id = ?', [fechada]);
    expect(f!['situacao']).toBe('fechada');
    // O formulário com envio pendente não aceita outro registro.
    expect(
      await codigo(
        porta.registrar(ctx(), m!.base.login, fechada, entrada({ motivoRetificacao: 'Outro envio' }), t),
      ),
    ).toBe('envio-pendente-aberto');
  });

  it('o andamento transcrito confere a versão e a data, marca a competência enviada e guarda a anterior na trilha', async () => {
    expect(
      await codigo(
        porta.andamento(
          ctx(),
          m!.base.login,
          envio,
          1,
          { situacao: 'transcrita', enviadoEm: null, protocolo: null, mensagemRetorno: null },
          t,
        ),
      ),
    ).toBe('data-envio-obrigatoria');
    expect(
      await codigo(
        porta.andamento(
          ctx(),
          m!.base.login,
          envio,
          1,
          { situacao: 'aceita', enviadoEm: null, protocolo: null, mensagemRetorno: null },
          t,
        ),
      ),
    ).toBe('transicao-invalida');
    const r = await porta.andamento(
      ctx(),
      m!.base.login,
      envio,
      1,
      {
        situacao: 'transcrita',
        enviadoEm: `${proxima}T10:30`,
        protocolo: 'PROT-SINT-1',
        mensagemRetorno: null,
      },
      t,
    );
    expect(r).toEqual({ id: envio, situacao: 'transcrita', versao: 2 });
    const [x] = await ler<Record<string, unknown>>(
      "SELECT operacao, situacao, DATE_FORMAT(enviado_em, '%Y-%m-%d %H:%i') AS em, protocolo, alterado_por, versao FROM notificacao_iras_envio WHERE id = ?",
      [envio],
    );
    expect(x).toMatchObject({
      operacao: 'alteracao',
      situacao: 'transcrita',
      em: `${proxima} 10:30`,
      protocolo: 'PROT-SINT-1',
    });
    expect(Number(x!['versao'])).toBe(2);
    const [f] = await ler('SELECT situacao, versao FROM fechamento_vigilancia_iras WHERE id = ?', [fechada]);
    expect(f!['situacao']).toBe('enviada');
    expect(Number(f!['versao'])).toBe(2);
    const [tr] = await ler<{ q: number }>(
      `SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'notificacao_iras_envio' AND entidade_id = ?
          AND JSON_EXTRACT(dados_depois, '$.dados.versaoAnterior.versao') = 1
          AND JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.dados.competenciaAnterior.situacao')) = 'fechada'`,
      [String(envio)],
    );
    expect(Number(tr!.q)).toBe(1);
    // A versão vista já mudou.
    expect(
      await codigo(
        porta.andamento(
          ctx(),
          m!.base.login,
          envio,
          1,
          { situacao: 'aceita', enviadoEm: null, protocolo: null, mensagemRetorno: null },
          t,
        ),
      ),
    ).toBe('versao-desatualizada');
  });

  it('a rejeição exige a mensagem de retorno; a retificação exige o motivo e é um registro novo', async () => {
    const rej = { situacao: 'rejeitada' as const, enviadoEm: null, protocolo: null, mensagemRetorno: null };
    expect(await codigo(porta.andamento(ctx(), m!.base.login, envio, 2, rej, t))).toBe(
      'retorno-sem-mensagem',
    );
    await porta.andamento(
      ctx(),
      m!.base.login,
      envio,
      2,
      { ...rej, mensagemRetorno: 'Denominador inconsistente' },
      t,
    );
    expect(
      await codigo(
        porta.registrar(
          ctx(),
          m!.base.login,
          fechada,
          entrada({ situacao: 'transcrita', enviadoEm: proxima }),
          t,
        ),
      ),
    ).toBe('motivo-retificacao');
    const r = await porta.registrar(
      ctx(),
      m!.base.login,
      fechada,
      entrada({
        situacao: 'transcrita',
        enviadoEm: proxima,
        protocolo: 'PROT-SINT-2',
        motivoRetificacao: 'Denominador corrigido',
      }),
      t,
    );
    expect(r).toMatchObject({ tipo: 'retificacao', situacao: 'transcrita' });
    const linhas = await ler<Record<string, unknown>>(
      'SELECT tipo_envio, situacao, motivo_retificacao, mensagem_retorno FROM notificacao_iras_envio WHERE fechamento_vigilancia_iras_id = ? ORDER BY id',
      [fechada],
    );
    expect(linhas).toEqual([
      {
        tipo_envio: 'inicial',
        situacao: 'rejeitada',
        motivo_retificacao: null,
        mensagem_retorno: 'Denominador inconsistente',
      },
      {
        tipo_envio: 'retificacao',
        situacao: 'transcrita',
        motivo_retificacao: 'Denominador corrigido',
        mensagem_retorno: null,
      },
    ]);
  });

  it('recusa competência aberta e data futura', async () => {
    expect(await codigo(porta.registrar(ctx(), m!.base.login, aberta, entrada(), t))).toBe(
      'competencia-nao-fechada',
    );
    expect(
      await codigo(
        porta.registrar(
          ctx(),
          m!.base.login,
          fechada,
          entrada({ formulario: 'cirurgia', situacao: 'transcrita', enviadoEm: '2999-01-01' }),
          t,
        ),
      ),
    ).toBe('data-envio-futura');
    const [q] = await ler<{ q: number }>(
      'SELECT COUNT(*) AS q FROM notificacao_iras_envio WHERE fechamento_vigilancia_iras_id IN (?, ?)',
      [fechada, aberta],
    );
    expect(Number(q!.q)).toBe(2);
  });

  it('lê a competência com o prazo e a situação mais recente do formulário, só no estabelecimento da sessão', async () => {
    const cs = await porta.competencias(ctx());
    const c = cs.find((x) => x.id === fechada);
    expect(c).toBeDefined();
    expect(c!.competencia).toBe(`${String(ano)}-${String(mes).padStart(2, '0')}`);
    expect(c!.prazo).toBe(`${String(ano)}-${String(mes + 1).padStart(2, '0')}-15`);
    expect(c!.situacao).toBe('enviada');
    expect(c!.formularios).toContainEqual({
      formulario: 'uti_adulto',
      ultima: 'transcrita',
      atrasado: false,
    });
    // A cirurgia, devida pelo componente vigiado e nunca enviada, atrasa a competência vencida.
    expect(c!.formularios).toContainEqual({ formulario: 'cirurgia', ultima: null, atrasado: true });
    expect(c!.atrasada).toBe(true);
    expect(c!.envios).toHaveLength(2);
    expect(cs.some((x) => x.id === aberta)).toBe(false);
    const outro = { ...ctx(), estabelecimento: m!.base.est + 9_999_999 };
    expect(await porta.envios(outro, fechada)).toEqual([]);
    expect((await porta.competencias(outro)).some((x) => x.id === fechada)).toBe(false);
  });
  it('o envio do formulário devido grava o componente vigiado e tira o formulário do atraso', async () => {
    const r = await porta.registrar(
      ctx(),
      m!.base.login,
      fechada,
      entrada({
        formulario: 'cirurgia',
        situacao: 'transcrita',
        enviadoEm: proxima,
        protocolo: 'PROT-SINT-3',
      }),
      t,
    );
    const [x] = await ler<Record<string, unknown>>(
      `SELECT cv.tipo_componente FROM notificacao_iras_envio ne
         JOIN componente_vigilancia cv ON cv.id = ne.componente_vigilancia_id WHERE ne.id = ?`,
      [r.id],
    );
    expect(x?.['tipo_componente']).toBe('cirurgico');
    const c = (await porta.competencias(ctx())).find((y) => y.id === fechada);
    expect(c!.formularios).toContainEqual({ formulario: 'cirurgia', ultima: 'transcrita', atrasado: false });
    expect(c!.formularios.filter((y) => y.atrasado).every((y) => y.ultima === null)).toBe(true);
  });
});
