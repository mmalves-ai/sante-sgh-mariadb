// Integração da regra de anonimato da notificação (F2.2, lote 04-03) contra o MariaDB do cliente de teste da onda 4
// (f22_o4): a notificação anônima gravada pela porta própria não liga a pessoa em nenhuma coluna da notificação, da
// linha do tempo, do envio nem da trilha (nem o id da conta nem o login); a identificada, como controle, liga.
// E o fluxo do NSP pela API inteira (sessões sintéticas, guardas e interceptores) com a porta própria sobre o banco: a
// anônima sem a conta e sem a correlação da requisição na trilha, o reenvio pela mesma chave sem linha nova, a lista, a
// triagem com reclassificação, a distribuição ao gestor da área, a devolutiva lida pelo número e o código, e o gestor
// que vê só a distribuída a ele, sem o notificador e sem o autor de cada passo.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CLIENTE_QUA,
  contasDasSessoes,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import type { ContextoQualidade, PortaQualidade } from './porta.js';
import { PortaQualidadePropria } from './porta-propria.js';
import { criarAppQualidade } from './teste.spec-util.js';
import type { NotificacaoIncidenteNova } from './tipos.js';

const AGORA = '2026-11-20T10:00:00';
const T = (id: number | null = null): TrilhaDaGravacao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'notificacao_incidente',
  entidadeId: id,
  dadosDepois: { evento: 'qualidade.incidente.notificado' },
  correlacao: 'notificacao',
});

describe.skipIf(SEM_BANCO_QUA)('anonimato da notificação no MariaDB (f22_o4)', () => {
  let m: MassaQualidade;
  let porta: PortaQualidadePropria;

  beforeAll(async () => {
    m = await prepararMassaQualidade('N');
    porta = new PortaQualidadePropria(m.nucleo);
  }, 60_000);
  afterAll(() => encerrarMassaQualidade(m));

  const notificar = (anonima: boolean) => {
    const c = ctxBanco(m.est, m.codigoEst, anonima ? null : m.usuario);
    const x: NotificacaoIncidenteNova = {
      agora: AGORA,
      protocoloDe: (a, s) => `NSP-${a}-${String(s).padStart(6, '0')}`,
      codigoResumo: (anonima ? 'b' : 'd').repeat(64),
      chaveResumo: null,
      ocorridoEm: '2026-11-20T06:00',
      atendimento: null,
      paciente: null,
      unidade: m.setor,
      leito: null,
      local: null,
      tipo: 'medicacao',
      tipoOutro: null,
      chegouAoPaciente: false,
      danoPercebido: 'nenhum',
      classificacao: 'quaseErro',
      descricao: 'Dose sintética quase trocada.',
      anonima,
      notificador: m.login,
      origemTela: 'prescricao',
      origemSugestao: null,
    };
    return porta.gravarSgh(
      c,
      (r: { id: number }) => T(r.id),
      (g) => g.notificar(x),
    );
  };

  /** O texto de todas as linhas ligadas à notificação (a notificação, os eventos, os envios e a trilha). */
  const rastro = (id: number) =>
    m.nucleo.lerSomente(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4', correlacao: 't' },
      async (l) => {
        const linhas = [
          ...(await l.consultar('SELECT * FROM notificacao_incidente WHERE id = ?', [id])),
          ...(await l.consultar(
            'SELECT * FROM notificacao_incidente_evento WHERE notificacao_incidente_id = ?',
            [id],
          )),
          ...(await l.consultar(
            'SELECT * FROM notificacao_incidente_envio WHERE notificacao_incidente_id = ?',
            [id],
          )),
          ...(await l.consultar(
            "SELECT * FROM trilha_auditoria WHERE entidade = 'notificacao_incidente' AND entidade_id = ?",
            [id],
          )),
        ];
        return linhas.map((r) =>
          JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
        );
      },
    );

  it('a anônima não guarda a conta nem o login de quem notificou; a identificada guarda', async () => {
    const a = await notificar(true);
    const textoA = (await rastro(a.id)).join('\n');
    expect(textoA).not.toContain(m.login);
    for (const coluna of ['notificador_usuario_id', 'usuario_id', 'criado_por'])
      expect(textoA).not.toMatch(new RegExp(`"${coluna}":${m.usuario}[,}]`));
    const b = await notificar(false);
    const textoB = (await rastro(b.id)).join('\n');
    expect(textoB).toMatch(new RegExp(`"notificador_usuario_id":${m.usuario}[,}]`));
    expect((await porta.notificacao(ctxBanco(m.est, m.codigoEst, m.usuario), a.id))?.notificador).toBeNull();
  });
});

/**
 * A porta própria com o contexto da sessão sintética trocado pelo cliente e o estabelecimento da massa. O id da conta da
 * sessão sintética (a posição no mapa da fonte sintética) não existe no banco do cliente: o autor da trilha vai nulo, e o
 * notificador e os autores dos passos vão pelo login (as contas da massa com os mesmos logins).
 */
function portaNaMassa(p: PortaQualidadePropria, est: number): PortaQualidade {
  return new Proxy(p, {
    get(alvo, k, r) {
      const v = Reflect.get(alvo, k, r) as unknown;
      if (typeof v !== 'function') return v;
      return (c: ContextoQualidade, ...resto: unknown[]) =>
        (v as (...a: unknown[]) => unknown).call(
          alvo,
          { ...c, cliente: CLIENTE_QUA, estabelecimento: est, usuario: null },
          ...resto,
        );
    },
  }) as unknown as PortaQualidade;
}

interface Sessao {
  cookie: string;
  csrf: string;
}
const ANONIMO = 'SINT.ENFERMEIRO';
const IDENTIFICADO = 'SINT.MEDICO';
const GESTOR = 'SINT.ESCALA';
const CORRELACAO_DA_REQUISICAO = 'corr-rastreavel-0403';

describe.skipIf(SEM_BANCO_QUA)('o fluxo do NSP pela API sobre o MariaDB (f22_o4)', () => {
  let m: MassaQualidade;
  let app: NestFastifyApplication;
  let contas: Map<string, number>;
  let seq = 0;

  beforeAll(async () => {
    m = await prepararMassaQualidade('F');
    contas = await contasDasSessoes(m, [ANONIMO, IDENTIFICADO, 'SINT.NSP', GESTOR]);
    app = await criarAppQualidade(
      { ...envTeste, AMBIENTE: 'dev' },
      {
        trilha: new RegistradorTrilhaMemoria(),
        qualidade: portaNaMassa(new PortaQualidadePropria(m.nucleo), m.est),
      },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await encerrarMassaQualidade(m);
  });

  const entrar = async (login: string): Promise<Sessao> => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    expect(r.statusCode, r.body).toBe(201);
    const set = r.headers['set-cookie'] as string[];
    return {
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  };
  const get = (s: Sessao, url: string) =>
    app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
  const post = (
    s: Sessao,
    url: string,
    payload: unknown = {},
    chave?: string,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url: `/api${url}`,
      headers: {
        cookie: s.cookie,
        'x-csrf': s.csrf,
        'idempotency-key': chave ?? `int-0403-${String(++seq)}-${String(Date.now())}`,
        ...extra,
      },
      payload: payload as object,
    });
  const ok = (r: { statusCode: number; body: string }) => expect(r.statusCode, r.body).toBeLessThan(300);
  const ler = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE_QUA, correlacao: 't' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
    );

  it('anônima sem conta nem correlação; reenvio sem trilha nova; triagem, distribuição, devolutiva e o gestor da área', async () => {
    const anon = await entrar(ANONIMO);
    const ident = await entrar(IDENTIFICADO);
    const nsp = await entrar('SINT.NSP');
    const f = await get(anon, '/qualidade/notificacoes/formulario');
    expect(f.statusCode, f.body).toBe(200);
    const agora = String((f.json() as { agora: string }).agora);
    const ocorrido = new Date(Date.parse(`${agora.slice(0, 19)}Z`) - 2 * 3_600_000)
      .toISOString()
      .slice(0, 16);
    const corpo = (x: Record<string, unknown>) => ({
      atendimento: null,
      unidade: m.setor,
      local: null,
      ocorridoEm: ocorrido,
      tipo: 'queda',
      tipoOutro: null,
      chegouAoPaciente: true,
      danoPercebido: 'leve',
      descricao: 'SINTETICO 04-03: queda ao sair do leito (texto de teste).',
      anonima: false,
      origem: { tela: '/pep/prontuario' },
      ...x,
    });

    // A anônima: nem a conta, nem o login, nem a correlação do cabeçalho da requisição ficam no rastro.
    const rAnon = await post(anon, '/qualidade/notificacoes', corpo({ anonima: true }), undefined, {
      'x-correlacao': CORRELACAO_DA_REQUISICAO,
    });
    ok(rAnon);
    const anonima = rAnon.json() as { protocolo: string; codigoAcompanhamento: string };
    const [la] = await ler(
      'SELECT id, notificador_usuario_id FROM notificacao_incidente WHERE estabelecimento_id = ? AND numero = ?',
      [m.est, anonima.protocolo],
    );
    const idAnon = Number(la?.['id']);
    expect(la?.['notificador_usuario_id']).toBeNull();
    const trAnon = await ler(
      "SELECT usuario_id, correlacao FROM trilha_auditoria WHERE entidade = 'notificacao_incidente' AND entidade_id = ?",
      [idAnon],
    );
    expect(trAnon.length).toBeGreaterThanOrEqual(1);
    expect(trAnon.every((t) => t['usuario_id'] === null && t['correlacao'] === 'notificacao')).toBe(true);
    expect(JSON.stringify(trAnon)).not.toContain(CORRELACAO_DA_REQUISICAO);

    // A identificada e o reenvio pela mesma chave: o mesmo protocolo, nenhuma linha nova (nem notificação, nem trilha).
    const chave = `int-0403-reenvio-${String(Date.now())}`;
    const rIdent = await post(ident, '/qualidade/notificacoes', corpo({}), chave);
    ok(rIdent);
    const identificada = rIdent.json() as { protocolo: string };
    const [li] = await ler(
      'SELECT id, notificador_usuario_id FROM notificacao_incidente WHERE estabelecimento_id = ? AND numero = ?',
      [m.est, identificada.protocolo],
    );
    const idIdent = Number(li?.['id']);
    expect(Number(li?.['notificador_usuario_id'])).toBe(contas.get(IDENTIFICADO));
    const trilhaDaIdent = () =>
      ler("SELECT id FROM trilha_auditoria WHERE entidade = 'notificacao_incidente' AND entidade_id = ?", [
        idIdent,
      ]);
    const linhasAntes = (await trilhaDaIdent()).length;
    expect(linhasAntes).toBeGreaterThanOrEqual(1);
    const rep = await post(ident, '/qualidade/notificacoes', corpo({}), chave);
    ok(rep);
    expect(rep.json()).toMatchObject({ protocolo: identificada.protocolo });
    expect(await trilhaDaIdent()).toHaveLength(linhasAntes);
    expect(
      await ler('SELECT id FROM notificacao_incidente WHERE estabelecimento_id = ?', [m.est]),
    ).toHaveLength(2);

    // O NSP: a lista, o detalhe sem o notificador da anônima, a triagem com reclassificação, a distribuição e a devolutiva.
    const l = await get(nsp, '/qualidade/nsp/notificacoes');
    expect(l.statusCode, l.body).toBe(200);
    expect((l.json() as { itens: { id: number }[] }).itens.map((x) => x.id).sort()).toEqual(
      [idAnon, idIdent].sort(),
    );
    const d = await get(nsp, `/qualidade/nsp/notificacoes/${String(idAnon)}`);
    expect(d.statusCode, d.body).toBe(200);
    const det = (d.json() as { notificacao: { versao: number; notificador: string | null } }).notificacao;
    expect(det.notificador).toBeNull();
    const t = await post(nsp, `/qualidade/nsp/notificacoes/${String(idAnon)}/triar`, {
      versao: det.versao,
      tipo: 'queda',
      tipoOutro: null,
      classificacao: 'eventoAdverso',
      dano: 'moderado',
      neverEvent: false,
      justificativa: 'SINTETICO 04-03: o dano foi maior que o percebido.',
    });
    ok(t);
    const v1 = (t.json() as { versao: number }).versao;
    const g = await get(nsp, `/qualidade/nsp/gestores?busca=${encodeURIComponent(GESTOR.slice(0, 7))}`);
    expect(g.statusCode, g.body).toBe(200);
    expect((g.json() as { itens: { login: string }[] }).itens.map((x) => x.login)).toContain(GESTOR);
    const dist = await post(nsp, `/qualidade/nsp/notificacoes/${String(idAnon)}/distribuir`, {
      versao: v1,
      gestor: GESTOR,
      unidade: m.setor,
      prazoAnalise: `${agora.slice(0, 4)}-12-31`,
      orientacao: null,
    });
    ok(dist);
    const v2 = (dist.json() as { versao: number }).versao;
    const dev = await post(nsp, `/qualidade/nsp/notificacoes/${String(idAnon)}/devolutiva`, {
      versao: v2,
      texto: 'SINTETICO 04-03: revisamos a grade do leito.',
    });
    ok(dev);
    const tipos = (
      await ler(
        "SELECT JSON_VALUE(dados, '$.tipo') AS tipo FROM notificacao_incidente_evento WHERE notificacao_incidente_id = ? ORDER BY id",
        [idAnon],
      )
    ).map((x) => x['tipo']);
    expect(tipos[0]).toBe('recebida');
    expect(tipos).toEqual(expect.arrayContaining(['triada', 'distribuida', 'devolutiva']));
    const acomp = await post(anon, '/qualidade/notificacoes/acompanhar', {
      protocolo: anonima.protocolo,
      codigo: anonima.codigoAcompanhamento,
    });
    expect(acomp.statusCode, acomp.body).toBe(200);
    expect((acomp.json() as { devolutivas: unknown[] }).devolutivas).toHaveLength(1);

    // O gestor da área: só a distribuída a ele, sem o notificador nem o autor dos passos; a outra responde 404.
    const ges = await entrar(GESTOR);
    const lg = await get(ges, '/qualidade/gestor/notificacoes');
    expect(lg.statusCode, lg.body).toBe(200);
    expect((lg.json() as { itens: { id: number }[] }).itens.map((x) => x.id)).toEqual([idAnon]);
    const dg = await get(ges, `/qualidade/gestor/notificacoes/${String(idAnon)}`);
    expect(dg.statusCode, dg.body).toBe(200);
    const detG = (
      dg.json() as { notificacao: { notificador: string | null; eventos: { por: string | null }[] } }
    ).notificacao;
    expect(detG.notificador).toBeNull();
    expect(detG.eventos.length).toBeGreaterThan(0);
    expect(detG.eventos.every((x) => x.por === null)).toBe(true);
    expect(dg.body.toUpperCase()).not.toContain('SINT.NSP');
    expect((await get(ges, `/qualidade/gestor/notificacoes/${String(idIdent)}`)).statusCode).toBe(404);
  });
});
