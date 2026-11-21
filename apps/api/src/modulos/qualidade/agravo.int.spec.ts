// Integração da porta PRÓPRIA da notificação compulsória contra o MariaDB do cliente de teste do lote, com massa
// SINTÉTICA: o cadastro de agravos (CID, periodicidade, ficha e perguntas), o contrato de efeito de cada gravação (o
// caso aberto, notificado e descartado, a versão conferida, a chave do gatilho única e a trilha), os gatilhos de exame e as
// leituras do prontuário no estabelecimento da sessão (nada de outro estabelecimento).
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { CLIENTE_QUA, ctxBanco, encerrarMassaQualidade, type MassaQualidade, prepararMassaQualidade, SEM_BANCO_QUA } from './massa.spec-util.js';
import { PortaAgravoPropria } from './porta-agravo-propria.js';
import type { CasoAgravoNovo } from './tipos.js';

const AGORA = '2026-11-20T10:00:00';
const T = (id: number | null = null): TrilhaDaGravacao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'notificacao_agravo',
  entidadeId: id,
  correlacao: 'teste-agravo',
});
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO_QUA)('porta própria da notificação compulsória contra o MariaDB', () => {
  let m: MassaQualidade;
  let porta: PortaAgravoPropria;
  let c: ReturnType<typeof ctxBanco>;
  let fora: ReturnType<typeof ctxBanco>;
  let paciente: number;
  let agravo: number;

  const novo = (o: Partial<CasoAgravoNovo> = {}): Omit<CasoAgravoNovo, 'hospital'> => ({
    origem: 'manual',
    chaveGatilho: null,
    atendimento: null,
    exame: null,
    paciente,
    cid: 'A90',
    periodicidade: 'imediata',
    gatilhoEm: '2026-11-20T08:00',
    prazoEm: '2026-11-21T08:00:00',
    fichaModelo: null,
    observacao: 'Caso sintético.',
    agora: AGORA,
    usuario: m.login,
    ...o,
  });

  beforeAll(async () => {
    m = await prepararMassaQualidade('G');
    porta = new PortaAgravoPropria(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    fora = ctxBanco(m.outro, m.codigoOutro, m.usuario);
    const ids = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-agravo' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const term = await g("SELECT id FROM terminologia WHERE codigo = 'cid10'", [], "INSERT INTO terminologia (codigo, nome, tipo, criado_em) VALUES ('cid10', 'CID-10', 'diagnostico', ?)", [agora]);
      for (const [cod, desc] of [['A90', 'DENGUE SINTETICA'], ['A15.0', 'TUBERCULOSE SINTETICA']] as const)
        await g('SELECT id FROM termo_terminologia WHERE terminologia_id = ? AND codigo_termo = ?', [term, cod], 'INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, ?, ?, ?)', [term, cod, desc, agora]);
      const per = await g("SELECT id FROM periodicidade_notificacao WHERE codigo = 'imediata'", [], "INSERT INTO periodicidade_notificacao (codigo, descricao, prazo_horas, criado_em) VALUES ('imediata', 'Imediata', 24, ?)", [agora]);
      const sem = await g("SELECT id FROM periodicidade_notificacao WHERE codigo = 'semanal'", [], "INSERT INTO periodicidade_notificacao (codigo, descricao, prazo_horas, criado_em) VALUES ('semanal', 'Semanal', 168, ?)", [agora]);
      const ag = (cod: string, desc: string, p: number) =>
        g('SELECT id FROM agravo_notificavel WHERE codigo = ?', [cod], 'INSERT INTO agravo_notificavel (codigo, descricao, periodicidade_notificacao_id, criado_em) VALUES (?, ?, ?, ?)', [cod, desc, p, agora]);
      const dengue = await ag('SINT_AGRAVO_DENGUE', 'DENGUE (SINTETICO)', per);
      const tb = await ag('SINT_AGRAVO_TB', 'TUBERCULOSE (SINTETICO)', sem);
      for (const [a, cid] of [[dengue, 'A90'], [tb, 'A15']] as const)
        await g('SELECT id FROM agravo_notificavel_cid WHERE agravo_notificavel_id = ? AND codigo_cid10 = ?', [a, cid], 'INSERT INTO agravo_notificavel_cid (agravo_notificavel_id, codigo_cid10, criado_em) VALUES (?, ?, ?)', [a, cid, agora]);
      await g('SELECT id FROM agravo_pergunta WHERE agravo_notificavel_id = ? AND sequencia = 1', [dengue], "INSERT INTO agravo_pergunta (agravo_notificavel_id, sequencia, codigo_campo, subcodigo, enunciado, tipo_resposta, criado_em) VALUES (?, 1, '7', 0, 'Data dos primeiros sintomas', 'data', ?)", [dengue, agora]);
      const pf = await g('SELECT id FROM pessoa_fisica WHERE nome = ?', ['PACIENTE SINTETICO AGRAVO'], 'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)', ['PACIENTE SINTETICO AGRAVO', '1990-05-01', agora]);
      const pac = await g('SELECT id FROM paciente WHERE pessoa_fisica_id = ?', [pf], "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, '9048001', 'ativo', ?)", [pf, agora]);
      return { pac, dengue };
    });
    paciente = ids.pac;
    agravo = ids.dengue;
  }, 60_000);
  afterAll(() => encerrarMassaQualidade(m));

  const ler = (sql: string, p: unknown[]) => m.nucleo.lerSomente({ cliente: CLIENTE_QUA, correlacao: 't' }, (l) => l.consultar(sql, p));

  it('o cadastro: CID notificável com a periodicidade, a CID-10, as fichas pelos CIDs e as perguntas', async () => {
    const cids = await porta.cidsNotificaveis(c);
    expect(cids).toEqual(expect.arrayContaining([
      { cid: 'A90', nome: 'DENGUE SINTETICA', codigoCadastro: 2 },
      { cid: 'A15', nome: 'TUBERCULOSE (SINTETICO)', codigoCadastro: 1 },
    ]));
    expect(await porta.cidDoCadastro(c, 'A90')).toEqual({ cid: 'A90', nome: 'DENGUE SINTETICA', codigoCadastro: 2 });
    expect(await porta.cidDoCadastro(c, 'A150')).toEqual({ cid: 'A150', nome: 'TUBERCULOSE SINTETICA', codigoCadastro: 0 });
    expect(await porta.cidDoCadastro(c, 'Z9999')).toBeNull();
    expect(await porta.modelosFicha(c)).toEqual(expect.arrayContaining([{ id: agravo, nome: 'A90' }]));
    expect(await porta.perguntasFicha(c, agravo)).toEqual([{ codigo: 7, subcodigo: 0, texto: 'Data dos primeiros sintomas' }]);
  });

  it('abrir, notificar e descartar: a linha, a versão conferida, a fila, a contagem e a trilha', async () => {
    const a = await porta.gravarSgh(c, (x: { id: number }) => T(x.id), (g) => g.abrirCaso(novo()));
    const lido = await porta.caso(c, a.id);
    expect(lido).toMatchObject({ origem: 'manual', paciente, cid: 'A90', situacao: 'aberto', fichaModelo: agravo, gatilhoEm: '2026-11-20T08:00:00', prazoEm: '2026-11-21T08:00:00', abertoPor: m.login, versao: 1 });
    expect(await porta.caso(fora, a.id)).toBeNull();
    expect(await porta.contagem(c, '2026-11-22T00:00:00', '2026-11-01T00:00:00')).toEqual({ abertos: 1, imediatosAbertos: 1, vencidos: 1, notificadosNoMes: 0 });
    const notif = { id: a.id, versao: 1, autoridade: 'SMS' as const, canal: 'telefone', numero: 'SINT-001', notificadoEm: '2026-11-20T09:00', recebidoPor: 'Plantão', observacao: null, agora: AGORA, usuario: m.login };
    const r = await porta.gravarSgh(c, T(a.id), (g) => g.registrarNotificacao(notif));
    expect(r.versao).toBe(2);
    expect(await codigo(porta.gravarSgh(c, T(a.id), (g) => g.registrarNotificacao(notif)))).toBe('versao-desatualizada');
    expect(await porta.caso(c, a.id)).toMatchObject({ situacao: 'notificado', autoridade: 'SMS', numero: 'SINT-001', notificadoEm: '2026-11-20T09:00:00', encerradoPor: m.login, versao: 2 });
    const [linha] = await ler('SELECT situacao, autoridade, data_notificacao, encerrado_por_usuario_id FROM notificacao_agravo WHERE id = ?', [a.id]);
    expect(linha).toMatchObject({ situacao: 'notificada', autoridade: 'sms', encerrado_por_usuario_id: m.usuario });
    const b = await porta.gravarSgh(c, T(), (g) => g.abrirCaso(novo({ cid: 'A150', periodicidade: 'semanal', gatilhoEm: '2026-11-19T08:00' })));
    await porta.gravarSgh(c, T(b.id), (g) => g.descartarCaso({ id: b.id, versao: 1, motivo: 'nao_confirmado', justificativa: 'Exame negativo (sintético).', agora: AGORA, usuario: m.login }));
    expect(await porta.caso(c, b.id)).toMatchObject({ situacao: 'descartado', motivoDescarte: 'nao_confirmado', fichaModelo: expect.any(Number) });
    const fila = await porta.casos(c, { pagina: 1, porPagina: 10 });
    expect(fila.total).toBe(2);
    expect((await porta.casos(c, { situacao: 'descartado', pagina: 1, porPagina: 10 })).itens.map((x) => x.id)).toEqual([b.id]);
    expect((await porta.casosDesde(c, '2026-11-20T00:00:00')).map((x) => x.situacao)).toEqual(['notificado']);
    expect(await porta.contagem(c, '2026-11-22T00:00:00', '2026-11-01T00:00:00')).toEqual({ abertos: 0, imediatosAbertos: 0, vencidos: 0, notificadosNoMes: 1 });
    const tr = await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'notificacao_agravo' AND entidade_id = ?", [a.id]);
    expect(tr.length).toBeGreaterThanOrEqual(1);
  });

  it('a chave do gatilho é única, e CID, paciente e agravo inexistentes são recusados sem gravar', async () => {
    const chave = 'cid:900001:A90';
    await porta.gravarSgh(c, T(), (g) => g.abrirCaso(novo({ origem: 'cid', chaveGatilho: chave })));
    expect(await codigo(porta.gravarSgh(c, T(), (g) => g.abrirCaso(novo({ origem: 'cid', chaveGatilho: chave }))))).toBe('caso-ja-aberto');
    expect(await codigo(porta.gravarSgh(c, T(), (g) => g.abrirCaso(novo({ cid: 'Z9999' }))))).toBe('cid-inexistente');
    expect(await codigo(porta.gravarSgh(c, T(), (g) => g.abrirCaso(novo({ paciente: 999_999_999 }))))).toBe('paciente-inexistente');
    expect(await codigo(porta.gravarSgh(c, T(), (g) => g.abrirCaso(novo({ atendimento: 999_999_999 }))))).toBe('atendimento-inexistente');
    expect(await ler('SELECT id FROM notificacao_agravo WHERE estabelecimento_id = ? AND chave_gatilho = ?', [m.est, chave])).toHaveLength(1);
  });

  it('os gatilhos de exame: inclusão, duplicado, alteração pela versão e versão desatualizada', async () => {
    const um = await porta.gravarSgh(c, T(), (g) => g.configurarGatilhoExame({ id: null, versao: null, padrao: 'VDRL', exceto: null, cid: 'A539', ativo: true, usuario: m.login }));
    expect(um).toMatchObject({ versao: 1, criado: true });
    expect(await codigo(porta.gravarSgh(c, T(), (g) => g.configurarGatilhoExame({ id: null, versao: null, padrao: 'VDRL', exceto: null, cid: 'A539', ativo: true, usuario: m.login })))).toBe('gatilho-duplicado');
    const dois = await porta.gravarSgh(c, T(), (g) => g.configurarGatilhoExame({ id: um.id, versao: 1, padrao: 'VDRL', exceto: 'LIQUOR', cid: 'A539', ativo: false, usuario: m.login }));
    expect(dois).toEqual({ id: um.id, versao: 2, criado: false });
    expect(await codigo(porta.gravarSgh(c, T(), (g) => g.configurarGatilhoExame({ id: um.id, versao: 1, padrao: 'VDRL', exceto: null, cid: 'A539', ativo: true, usuario: m.login })))).toBe('versao-desatualizada');
    expect(await porta.gatilhosExame(c)).toEqual([{ id: um.id, padrao: 'VDRL', exceto: 'LIQUOR', cid: 'A539', ativo: false, versao: 2 }]);
    expect(await porta.gatilhosExame(fora)).toEqual([]);
  });

  it('as leituras do prontuário ficam no estabelecimento da sessão (o sintético não tem atendimento, óbito nem exame)', async () => {
    expect(await porta.atendimentosComCid(c, '2026-01-01T00:00:00')).toEqual({ itens: [], cortado: false });
    expect(await porta.obitos(c, '2026-01-01T00:00:00')).toEqual([]);
    expect(await porta.resultados(c, '2026-01-01T00:00:00', ['VDRL'], ['REAGENTE'])).toEqual({ itens: [], cortado: false });
    expect(await porta.atendimento(c, 999_999_999)).toBeNull();
    expect(await porta.declaracaoObito(c, 999_999_999)).toBeNull();
    expect(await porta.exame(c, 999_999_999)).toBeNull();
    expect((await porta.unidades(c)).get(m.est)).toMatchObject({ codigo: m.est, nome: 'ESTAB SINTETICO QUALIDADE' });
    expect((await porta.pacientes(c, [paciente])).get(paciente)).toMatchObject({ nome: 'PACIENTE SINTETICO AGRAVO', prontuario: 9_048_001, nascimento: '1990-05-01' });
    expect(await porta.relogio(c)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(await codigo(porta.relogio({ ...c, estabelecimento: null }))).toBe('sem-estabelecimento');
  });
});
