// Integração da porta PRÓPRIA da notificação de incidentes (F2.2, lote 04-03) contra o MariaDB do cliente de teste da
// onda 4 (f22_o4), com massa SINTÉTICA: o contrato de efeito de cada gravação (as linhas, a versão, a linha do tempo, o
// envio, a sequência do protocolo e a trilha) e as recusas (versão desatualizada, cadastro ausente, unidade e
// notificação de outro estabelecimento), a sequência do ano sob concorrência, a marca do suporte técnico na sessão "como" e
// os feriados pelo endereço do estabelecimento. A mesma bateria básica roda na memória e no banco (describe.each).
import { randomBytes } from 'node:crypto';
import { ErroOperacao, executarComo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import type { ContextoQualidade, PortaQualidade } from './porta.js';
import { PortaQualidadeMemoria } from './porta-memoria.js';
import { PortaQualidadePropria } from './porta-propria.js';
import { ctxTeste } from './teste.spec-util.js';
import type { NotificacaoIncidenteNova } from './tipos.js';

const AGORA = '2026-11-20T10:00:00';
const trilha = (id: number | null = null): TrilhaDaGravacao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'notificacao_incidente',
  entidadeId: id,
  dadosDepois: { evento: 'teste' },
  correlacao: 'teste-l0403',
});
const nova = (o: Partial<NotificacaoIncidenteNova> = {}): NotificacaoIncidenteNova => ({
  agora: AGORA,
  protocoloDe: (ano, seq) => `NSP-${ano}-${String(seq).padStart(6, '0')}`,
  codigoResumo: randomBytes(32).toString('hex'),
  chaveResumo: null,
  ocorridoEm: '2026-11-20T08:30',
  atendimento: null,
  paciente: null,
  unidade: null,
  leito: null,
  local: 'Corredor',
  tipo: 'queda',
  tipoOutro: null,
  chegouAoPaciente: true,
  danoPercebido: 'leve',
  classificacao: 'eventoAdverso',
  descricao: 'Queda sintética no corredor do posto.',
  anonima: false,
  notificador: '',
  origemTela: null,
  origemSugestao: null,
  ...o,
});
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao
      ? String(e.problema.codigo)
      : ((e as { codigo?: string }).codigo ?? String(e));
  }
};

describe.skipIf(SEM_BANCO_QUA)('porta própria da notificação contra o MariaDB (f22_o4)', () => {
  let m: MassaQualidade;
  let porta: PortaQualidadePropria;
  let c: ContextoQualidade;
  let fora: ContextoQualidade;

  beforeAll(async () => {
    m = await prepararMassaQualidade('P');
    porta = new PortaQualidadePropria(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    fora = ctxBanco(m.outro, m.codigoOutro, m.usuario);
  }, 60_000);
  afterAll(() => encerrarMassaQualidade(m));

  const ler = <T>(sql: string, p: unknown[]) =>
    m.nucleo.lerSomente(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4', correlacao: 't' },
      (l) => l.consultar<Record<string, unknown> & T>(sql, p),
    );

  it('notificar: a linha, o protocolo pela sequência do ano, a linha do tempo e a trilha com o notificador', async () => {
    const r = await porta.gravarSgh(
      c,
      (x: { id: number }) => trilha(x.id),
      (g) => g.notificar(nova({ unidade: m.setor, notificador: m.login, chaveResumo: 'c'.repeat(64) })),
    );
    expect(r.repetida).toBe(false);
    expect(r.protocolo).toBe('NSP-2026-000001');
    const [n] = await ler(
      'SELECT situacao, versao, notificador_usuario_id, anonima FROM notificacao_incidente WHERE id = ?',
      [r.id],
    );
    expect(n).toMatchObject({ situacao: 'recebida', versao: 1, notificador_usuario_id: m.usuario });
    const ev = await ler(
      'SELECT situacao_nova, usuario_id FROM notificacao_incidente_evento WHERE notificacao_incidente_id = ?',
      [r.id],
    );
    expect(ev).toHaveLength(1);
    const tr = await ler(
      "SELECT usuario_id FROM trilha_auditoria WHERE entidade = 'notificacao_incidente' AND entidade_id = ?",
      [r.id],
    );
    expect(tr.length).toBeGreaterThanOrEqual(1);
    expect(tr.every((t) => Number(t['usuario_id']) === m.usuario)).toBe(true);
    const lida = await porta.notificacao(c, r.id);
    expect(lida).toMatchObject({
      protocolo: r.protocolo,
      tipo: 'queda',
      unidade: m.setor,
      notificador: m.login,
      triada: false,
    });
    // O reenvio do mesmo pedido devolve a mesma notificação, sem outra linha.
    const de2 = await porta.gravarSgh(c, trilha(), (g) =>
      g.notificar(nova({ unidade: m.setor, notificador: m.login, chaveResumo: 'c'.repeat(64) })),
    );
    expect(de2).toEqual({ id: r.id, protocolo: r.protocolo, repetida: true });
    expect(
      await ler('SELECT id FROM notificacao_incidente WHERE estabelecimento_id = ?', [m.est]),
    ).toHaveLength(1);
  });

  it('a anônima: sem notificador na linha, no evento e na trilha', async () => {
    const anonimo = { ...c, usuario: null };
    const r = await porta.gravarSgh(
      anonimo,
      (x: { id: number }) => trilha(x.id),
      (g) => g.notificar(nova({ unidade: m.setor, anonima: true, notificador: m.login })),
    );
    const [n] = await ler('SELECT notificador_usuario_id, anonima FROM notificacao_incidente WHERE id = ?', [
      r.id,
    ]);
    expect(n?.['notificador_usuario_id']).toBeNull();
    const ev = await ler(
      'SELECT usuario_id FROM notificacao_incidente_evento WHERE notificacao_incidente_id = ?',
      [r.id],
    );
    expect(ev.every((e) => e['usuario_id'] === null)).toBe(true);
    const tr = await ler(
      "SELECT usuario_id FROM trilha_auditoria WHERE entidade = 'notificacao_incidente' AND entidade_id = ?",
      [r.id],
    );
    expect(tr.length).toBeGreaterThanOrEqual(1);
    expect(tr.every((t) => t['usuario_id'] === null)).toBe(true);
    expect((await porta.eventos(c, r.id))[0]?.por).toBe('anonimo');
  });

  it('triar, distribuir, Notivisa e descartar: versão, eventos e envio; a versão vista antiga é recusada', async () => {
    const { id } = await porta.gravarSgh(c, trilha(), (g) =>
      g.notificar(nova({ unidade: m.setor, notificador: m.login })),
    );
    const base = { id, usuario: m.login, agora: AGORA };
    const t = await porta.gravarSgh(c, trilha(id), (g) =>
      g.triar({
        ...base,
        versao: 1,
        tipo: 'queda',
        tipoOutro: null,
        classificacao: 'eventoAdverso',
        dano: 'moderado',
        neverEvent: false,
        justificativa: null,
        eventos: ['triada'],
        antes: {},
      }),
    );
    expect(t.versao).toBe(2);
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(id), (g) =>
          g.triar({
            ...base,
            versao: 1,
            tipo: 'queda',
            tipoOutro: null,
            classificacao: 'eventoAdverso',
            dano: 'leve',
            neverEvent: false,
            justificativa: null,
            eventos: ['triada'],
            antes: {},
          }),
        ),
      ),
    ).toBe('versao-desatualizada');
    const d = await porta.gravarSgh(c, trilha(id), (g) =>
      g.distribuir({
        ...base,
        versao: 2,
        gestor: m.loginGestor,
        unidade: m.setor,
        prazoAnalise: '2026-12-20',
        orientacao: 'Analisar.',
      }),
    );
    expect(d.versao).toBe(3);
    const lida = await porta.notificacao(c, id);
    expect(lida).toMatchObject({
      situacao: 'distribuida',
      dano: 'moderado',
      triada: true,
      gestor: m.loginGestor,
      prazoAnalise: '2026-12-20',
    });
    expect(
      (await porta.lista(c, { gestor: m.loginGestor, pagina: 1, porPagina: 10 })).itens.map((x) => x.id),
    ).toEqual([id]);
    expect((await porta.comPrazo(c)).itens.some((x) => x.id === id)).toBe(true);
    expect(
      await porta.gravarSgh(c, trilha(id), (g) =>
        g.notivisaExportada({ id, usuario: m.login, agora: AGORA }),
      ),
    ).toEqual({ marcou: true });
    expect(
      await porta.gravarSgh(c, trilha(id), (g) =>
        g.notivisaExportada({ id, usuario: m.login, agora: AGORA }),
      ),
    ).toEqual({ marcou: false });
    await porta.gravarSgh(c, trilha(id), (g) =>
      g.transcricao({
        ...base,
        versao: 3,
        numeroNotivisa: '2026.11.000123',
        transcritaEm: '2026-11-20T11:00',
      }),
    );
    const depois = await porta.notificacao(c, id);
    expect(depois).toMatchObject({
      notivisaNumero: '2026.11.000123',
      notivisaTranscritaEm: '2026-11-20T11:00:00',
      versao: 4,
    });
    expect(depois?.notivisaExportadaEm).not.toBeNull();
    const envios = await ler(
      'SELECT situacao FROM notificacao_incidente_envio WHERE notificacao_incidente_id = ? ORDER BY id',
      [id],
    );
    expect(envios.map((e) => e['situacao'])).toEqual(['pendente', 'transcrita']);
    await porta.gravarSgh(c, trilha(id), (g) =>
      g.descartar({
        ...base,
        versao: 4,
        motivo: 'duplicada',
        justificativa: 'Mesmo incidente já notificado.',
        duplicadaDe: 'NSP-2026-000001',
      }),
    );
    expect(await porta.notificacao(c, id)).toMatchObject({
      situacao: 'descartada',
      motivoDescarte: 'duplicada',
      duplicadaDe: 'NSP-2026-000001',
    });
    const tipos = (await porta.eventos(c, id)).map((e) => e.tipo);
    expect(tipos).toEqual([
      'recebida',
      'triada',
      'distribuida',
      'notivisaExportada',
      'notivisaTranscrita',
      'descartada',
    ]);
  });

  it('recusas: cadastro ausente, unidade e notificação de outro estabelecimento (nada gravado)', async () => {
    const antes = (
      await ler('SELECT COUNT(*) AS q FROM notificacao_incidente WHERE estabelecimento_id IN (?, ?)', [
        m.est,
        m.outro,
      ])
    )[0]?.['q'];
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) =>
          g.notificar(nova({ unidade: m.setor, notificador: m.login, tipo: 'inexistenteSintetico' })),
        ),
      ),
    ).toBe('cadastro-pendente');
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) =>
          g.notificar(nova({ unidade: m.setorOutro, notificador: m.login })),
        ),
      ),
    ).toBe('unidade-invalida');
    const depois = (
      await ler('SELECT COUNT(*) AS q FROM notificacao_incidente WHERE estabelecimento_id IN (?, ?)', [
        m.est,
        m.outro,
      ])
    )[0]?.['q'];
    expect(depois).toEqual(antes);
    const { id } = await porta.gravarSgh(c, trilha(), (g) =>
      g.notificar(nova({ unidade: m.setor, notificador: m.login })),
    );
    expect(await porta.notificacao(fora, id)).toBeNull();
    expect(await codigo(porta.gravarSgh(fora, trilha(), (g) => g.travar(id)))).toBe('nao-encontrado');
    // A etapa 2 (porta-propria-etapa2.int.spec.ts) também não enxerga a notificação de outro estabelecimento.
    expect(
      await codigo(
        porta.gravarSgh(fora, trilha(), (g) => g.registrarAnalise({ notificacao: id, usuario: m.login } as never)),
      ),
    ).toBe('nao-encontrado');
  });

  it('leituras de apoio: relógio, unidades, feriados, conta ativa e gestores do estabelecimento', async () => {
    expect(await porta.relogio(c)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect((await porta.unidades(c)).map((u) => u.codigo)).toContain(m.setor);
    expect((await porta.unidades(c)).map((u) => u.codigo)).not.toContain(m.setorOutro);
    expect(await porta.feriados(c, '2026-11-01', '2026-11-30')).toContainEqual({
      data: '2026-11-02',
      nome: 'FERIADO SINTETICO',
    });
    expect(await porta.feriados(fora, '2026-11-01', '2026-11-30')).not.toContainEqual({
      data: '2026-11-02',
      nome: 'FERIADO SINTETICO',
    });
    expect(await porta.usuarioAtivo(c, m.loginGestor)).toBe(true);
    expect(await porta.usuarioAtivo(fora, m.loginGestor)).toBe(false);
    expect((await porta.gestores(c, 'l0403qp.gest')).map((g) => g.login)).toEqual([m.loginGestor]);
    expect(await porta.contexto(c, 999_999_999)).toBeNull();
  });
});

describe.skipIf(SEM_BANCO_QUA)(
  'porta própria da notificação: concorrência, suporte e feriados (f22_o4)',
  () => {
    let m: MassaQualidade;
    let porta: PortaQualidadePropria;
    let c: ContextoQualidade;

    beforeAll(async () => {
      m = await prepararMassaQualidade('C');
      porta = new PortaQualidadePropria(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
    }, 60_000);
    afterAll(() => encerrarMassaQualidade(m));

    const ler = (sql: string, p: unknown[]) =>
      m.nucleo.lerSomente(
        { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4', correlacao: 't' },
        (l) => l.consultar<Record<string, unknown>>(sql, p),
      );

    it('a primeira notificação do ano, duas ao mesmo tempo: as duas gravam, com números seguidos e uma sequência só', async () => {
      const ano = 2031;
      const uma = () =>
        porta.gravarSgh(c, trilha(), (g) =>
          g.notificar(
            nova({
              agora: `${ano}-01-01T00:05:00`,
              ocorridoEm: `${ano}-01-01T00:00`,
              unidade: m.setor,
              notificador: m.login,
            }),
          ),
        );
      const [a, b] = await Promise.all([uma(), uma()]);
      expect([a.protocolo, b.protocolo].sort()).toEqual([`NSP-${ano}-000001`, `NSP-${ano}-000002`]);
      expect(
        await ler('SELECT id FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = ?', [
          m.est,
          `notificacao_incidente_${ano}`,
        ]),
      ).toHaveLength(1);
    });

    it('na sessão "como", cada evento leva a marca do suporte técnico; fora dela, não', async () => {
      const marca = {
        sessao: 'sessao-sintetica',
        acao: null,
        atorTipo: 'suporte' as const,
        idConta: '1',
        alvo: m.login,
      };
      const { id } = await executarComo(marca, () =>
        porta.gravarSgh(c, trilha(), (g) => g.notificar(nova({ unidade: m.setor, notificador: m.login }))),
      );
      await executarComo(marca, () =>
        porta.gravarSgh(c, trilha(id), (g) =>
          g.triar({
            id,
            versao: 1,
            usuario: m.login,
            agora: AGORA,
            tipo: 'queda',
            tipoOutro: null,
            classificacao: 'eventoAdverso',
            dano: 'leve',
            neverEvent: false,
            justificativa: null,
            eventos: ['triada'],
            antes: {},
          }),
        ),
      );
      const ev = await porta.eventos(c, id);
      expect(ev.map((e) => e.tipo)).toEqual(['recebida', 'triada']);
      expect(ev.every((e) => (JSON.parse(e.dados ?? '{}') as { suporte?: boolean }).suporte === true)).toBe(
        true,
      );
      const fora = await porta.gravarSgh(c, trilha(), (g) =>
        g.notificar(nova({ unidade: m.setor, notificador: m.login })),
      );
      expect((await porta.eventos(c, fora.id)).every((e) => !(e.dados ?? '').includes('suporte'))).toBe(true);
    });

    it('os feriados pelo endereço: nacional, o estadual da UF e o municipal do município; nem outro estado nem ponto facultativo', async () => {
      const ids = await m.nucleo.escrever(
        {
          cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4',
          correlacao: 'preparo-feriados-0403',
        },
        async (e) => {
          const agora = new Date();
          const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
            const r = await e.uma<{ id: number }>(sel, p);
            return r ? Number(r.id) : e.inserir(ins, pi);
          };
          const pais = await um(
            'SELECT id FROM pais_referencia WHERE codigo_iso = ?',
            ['BR'],
            'INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES (?, ?, ?)',
            ['BR', 'BRASIL', agora],
          );
          const uf = (cod: string, sigla: string) =>
            um(
              'SELECT id FROM unidade_federativa WHERE sigla = ?',
              [sigla],
              'INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES (?, ?, ?, ?, ?)',
              [cod, sigla, `UF ${sigla}`, pais, agora],
            );
          const sp = await uf('35', 'SP');
          const rj = await uf('33', 'RJ');
          const mun = (cod: string, ufId: number) =>
            um(
              'SELECT id FROM municipio_ibge WHERE codigo_ibge = ?',
              [cod],
              'INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES (?, ?, ?, ?)',
              [cod, `MUNICIPIO ${cod}`, ufId, agora],
            );
          const munSp = await mun('3550308', sp);
          const munRj = await mun('3304557', rj);
          await e.executar('UPDATE estabelecimento SET municipio_ibge_id = ? WHERE id = ?', [munSp, m.est]);
          await e.executar('UPDATE estabelecimento SET municipio_ibge_id = ? WHERE id = ?', [munRj, m.outro]);
          await e.executar("DELETE FROM feriado WHERE nome LIKE 'FERIADO SINTETICO 0403%'", []);
          const f = (
            data: string,
            nome: string,
            abr: string,
            ufS: string | null,
            munI: number | null,
            pf = false,
          ) =>
            e.executar(
              'INSERT INTO feriado (data, nome, abrangencia, uf, municipio_ibge_id, ponto_facultativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [data, nome, abr, ufS, munI, pf, agora],
            );
          await f('2031-03-01', 'FERIADO SINTETICO 0403 NACIONAL', 'nacional', null, null);
          await f('2031-03-02', 'FERIADO SINTETICO 0403 SP', 'estadual', 'SP', null);
          await f('2031-03-03', 'FERIADO SINTETICO 0403 RJ', 'estadual', 'RJ', null);
          await f('2031-03-04', 'FERIADO SINTETICO 0403 MUN SP', 'municipal', null, munSp);
          await f('2031-03-05', 'FERIADO SINTETICO 0403 MUN RJ', 'municipal', null, munRj);
          await f('2031-03-06', 'FERIADO SINTETICO 0403 FACULTATIVO', 'nacional', null, null, true);
          return { munSp, munRj };
        },
      );
      try {
        const datas = async (cx: ContextoQualidade) =>
          (await porta.feriados(cx, '2031-03-01', '2031-03-31')).map((x) => x.data);
        expect(await datas(c)).toEqual(['2031-03-01', '2031-03-02', '2031-03-04']);
        expect(await datas(ctxBanco(m.outro, m.codigoOutro, m.usuario))).toEqual([
          '2031-03-01',
          '2031-03-03',
          '2031-03-05',
        ]);
        expect(ids.munSp).not.toBe(ids.munRj);
      } finally {
        await m.nucleo.escrever(
          {
            cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4',
            correlacao: 'limpeza-feriados-0403',
          },
          async (e) => {
            await e.executar("DELETE FROM feriado WHERE nome LIKE 'FERIADO SINTETICO 0403%'", []);
            await e.executar('UPDATE estabelecimento SET municipio_ibge_id = NULL WHERE id IN (?, ?)', [
              m.est,
              m.outro,
            ]);
          },
        );
      }
    });
  },
);

describe.skipIf(SEM_BANCO_QUA).each([
  [
    'memória',
    () =>
      Promise.resolve({
        porta: new PortaQualidadeMemoria() as PortaQualidade,
        c: ctxTeste('aa'),
        unidade: 1,
        login: 'SINT.NSP',
        fim: () => Promise.resolve(),
      }),
  ],
  [
    'banco',
    async () => {
      const m = await prepararMassaQualidade('E');
      return {
        porta: new PortaQualidadePropria(m.nucleo) as PortaQualidade,
        c: ctxBanco(m.est, m.codigoEst, m.usuario),
        unidade: m.setor,
        login: m.login,
        fim: () => encerrarMassaQualidade(m),
      };
    },
  ],
] as const)('a mesma bateria na porta (%s)', (_nome, fabrica) => {
  let x: Awaited<ReturnType<typeof fabrica>>;
  beforeAll(async () => {
    x = await fabrica();
  }, 60_000);
  afterAll(() => x?.fim());

  it('notifica, lê pelo protocolo, tria com a versão vista e recusa a versão antiga', async () => {
    const r = await x.porta.gravarSgh(x.c, trilha(), (g) =>
      g.notificar(nova({ unidade: x.unidade, notificador: x.login })),
    );
    const n = await x.porta.porProtocolo(x.c, r.protocolo);
    expect(n).toMatchObject({
      id: r.id,
      situacao: 'recebida',
      versao: 1,
      anonima: false,
      chegouAoPaciente: true,
    });
    const t = await x.porta.gravarSgh(x.c, trilha(), (g) =>
      g.triar({
        id: r.id,
        versao: 1,
        usuario: x.login,
        agora: AGORA,
        tipo: 'queda',
        tipoOutro: null,
        classificacao: 'eventoAdverso',
        dano: 'leve',
        neverEvent: false,
        justificativa: null,
        eventos: ['triada'],
        antes: {},
      }),
    );
    expect(t.versao).toBe(2);
    expect(
      await codigo(
        x.porta.gravarSgh(x.c, trilha(), (g) =>
          g.descartar({
            id: r.id,
            versao: 1,
            usuario: x.login,
            agora: AGORA,
            motivo: 'naoEIncidente',
            justificativa: 'Não é incidente.',
            duplicadaDe: null,
          }),
        ),
      ),
    ).toBe('versao-desatualizada');
    expect((await x.porta.eventos(x.c, r.id)).map((e) => e.tipo)).toEqual(['recebida', 'triada']);
  });
});
