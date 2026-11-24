// Integração da porta PRÓPRIA da segurança do paciente, etapa 2 (modulos-proprios-1, família qualidade-a), contra o
// MariaDB do cliente de teste (f22_o4), com massa SINTÉTICA: o contrato de efeito da análise (linha, fatores com a
// exclusão marcada, conclusão na notificação e linha do tempo), do plano 5W2H (plano nascido na primeira ação,
// sequência, prorrogação, conclusão e eficácia), da vigilância de produto (queixa, andamento e linha do tempo) e da
// sugestão resolvida, com as recusas (versão desatualizada, registro de outro estabelecimento, item fora do cadastro).
import { randomBytes } from 'node:crypto';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import type { ContextoQualidade } from './porta.js';
import { PortaQualidadePropria } from './porta-propria.js';
import type { Acao5w2h, NotificacaoIncidenteNova, QueixaTecnicaNova } from './tipos.js';

const AGORA = '2026-11-20T10:00:00';
const CODIGO_ITEM = 987650001;
const CODIGO_GRUPO = 'QSINTE2';
const trilha: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'notificacao_incidente',
  entidadeId: null,
  dadosDepois: { evento: 'teste' },
  correlacao: 'teste-qualidade-etapa2',
};
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

describe.skipIf(SEM_BANCO_QUA)('porta própria da segurança do paciente, etapa 2, contra o MariaDB', () => {
  let m: MassaQualidade;
  let porta: PortaQualidadePropria;
  let c: ContextoQualidade;
  let fora: ContextoQualidade;

  const ler = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE_QUA, correlacao: 't' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
    );
  const notificar = async () =>
    (
      await porta.gravarSgh(c, trilha, (g) =>
        g.notificar({
          agora: AGORA,
          protocoloDe: (ano, seq) => `NSP-${ano}-${String(seq).padStart(6, '0')}`,
          codigoResumo: randomBytes(32).toString('hex'),
          chaveResumo: null,
          ocorridoEm: '2026-11-20T08:30',
          atendimento: null,
          paciente: null,
          unidade: m.setor,
          leito: null,
          local: 'Corredor',
          tipo: 'queda',
          tipoOutro: null,
          chegouAoPaciente: true,
          danoPercebido: 'leve',
          classificacao: 'eventoAdverso',
          descricao: 'Queda sintética no corredor do posto.',
          anonima: false,
          notificador: m.login,
          origemTela: null,
          origemSugestao: null,
        } as Omit<NotificacaoIncidenteNova, 'hospital'>),
      )
    ).id;

  async function limparEtapa2(): Promise<void> {
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-etapa2' }, async (e) => {
      const ests = [m.est, m.outro];
      await e.executar(
        'DELETE v FROM queixa_tecnica_produto_evento v JOIN queixa_tecnica_produto q ON q.id = v.queixa_tecnica_produto_id WHERE q.estabelecimento_id IN (?, ?)',
        ests,
      );
      await e.executar('DELETE FROM queixa_tecnica_produto WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM sugestao_notificacao_resolvida WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (?, ?) AND tipo LIKE 'queixa_tecnica_produto_%'",
        ests,
      );
      await e.executar('DELETE FROM insumo WHERE codigo = ?', [String(CODIGO_ITEM)]);
      await e.executar('DELETE FROM grupo_insumo WHERE codigo = ?', [CODIGO_GRUPO]);
      await e.executar('DELETE FROM unidade_medida WHERE codigo = ?', [CODIGO_GRUPO]);
    });
  }

  beforeAll(async () => {
    m = await prepararMassaQualidade('Q2');
    porta = new PortaQualidadePropria(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    fora = ctxBanco(m.outro, m.codigoOutro, m.usuario);
    await limparEtapa2();
  }, 60_000);
  afterAll(async () => {
    if (m) await limparEtapa2();
    await encerrarMassaQualidade(m);
  });

  it('análise: inclusão, fatores, conclusão na notificação, linha do tempo e versão desatualizada', async () => {
    const id = await notificar();
    // A análise começa na notificação distribuída (o banco exige a unidade e o prazo da análise).
    await porta.gravarSgh(c, trilha, (g) =>
      g.distribuir({
        id,
        versao: 1,
        usuario: m.login,
        agora: '2026-11-20T10:30:00',
        gestor: m.loginGestor,
        unidade: m.setor,
        prazoAnalise: '2026-12-10',
        orientacao: null,
      }),
    );
    const r1 = await porta.gravarSgh(c, trilha, (g) =>
      g.registrarAnalise({
        notificacao: id,
        versaoNotificacao: 2,
        atual: null,
        metodo: 'cincoPorques',
        conteudo: JSON.stringify({ porques: ['a', 'b'] }),
        causaRaiz: null,
        fatores: ['individuo', 'equipe'],
        licoes: null,
        semAcaoJustificativa: null,
        concluir: false,
        eventos: ['analiseIniciada'],
        situacaoNotificacao: 'emAnalise',
        usuario: m.login,
        agora: '2026-11-20T11:00:00',
      }),
    );
    expect(r1).toMatchObject({ versao: 1, versaoNotificacao: 3 });
    const a1 = await porta.analise(c, id);
    expect(a1).toMatchObject({
      id: r1.id,
      metodo: 'cincoPorques',
      situacao: 'rascunho',
      fatores: ['equipe', 'individuo'],
      registradaPor: m.login,
    });
    expect(JSON.parse(a1!.conteudo)).toEqual({ porques: ['a', 'b'] });
    expect(await porta.gravarSgh(c, trilha, (g) => g.travarAnalise(id))).toMatchObject({ id: r1.id });
    // A segunda inclusão (a tela abriu sem a análise) é recusada.
    expect(
      await codigo(
        porta.gravarSgh(c, trilha, (g) =>
          g.registrarAnalise({ ...base(id), atual: null, versaoNotificacao: 3 }),
        ),
      ),
    ).toBe('versao-desatualizada');
    const r2 = await porta.gravarSgh(c, trilha, (g) =>
      g.registrarAnalise({
        ...base(id),
        versaoNotificacao: 3,
        atual: { id: r1.id, versao: 1 },
        causaRaiz: 'Piso molhado sem sinalização.',
        fatores: ['equipe'],
        concluir: true,
        eventos: ['analiseConcluida'],
        situacaoNotificacao: 'concluida',
      }),
    );
    expect(r2).toMatchObject({ id: r1.id, versao: 2, versaoNotificacao: 4 });
    const a2 = await porta.analise(c, id);
    expect(a2).toMatchObject({ situacao: 'concluida', fatores: ['equipe'], concluidaPor: m.login });
    expect(a2?.concluidaEm).toBe('2026-11-20T12:00:00');
    const causas = await ler(
      'SELECT COUNT(*) AS total, SUM(excluido_em IS NOT NULL) AS excluidas FROM analise_incidente_causa WHERE analise_incidente_id = ?',
      [r1.id],
    );
    expect(causas[0]).toMatchObject({ total: 2 });
    expect(Number(causas[0]?.['excluidas'])).toBe(1);
    const n = await porta.notificacao(c, id);
    expect(n).toMatchObject({ situacao: 'concluida', versao: 4, analiseConcluidaEm: '2026-11-20T12:00:00' });
    const ev = (await porta.eventos(c, id)).map((e) => e.tipo);
    expect(ev).toEqual(expect.arrayContaining(['analiseIniciada', 'analiseConcluida']));
    // A concluída não muda mais; a de outro estabelecimento não existe.
    expect(
      await codigo(
        porta.gravarSgh(c, trilha, (g) =>
          g.registrarAnalise({ ...base(id), versaoNotificacao: 4, atual: { id: r1.id, versao: 2 } }),
        ),
      ),
    ).toBe('versao-desatualizada');
    expect(await porta.analise(fora, id)).toBeNull();
    expect(await codigo(porta.gravarSgh(fora, trilha, (g) => g.registrarAnalise(base(id))))).toBe('nao-encontrado');
  });

  it('análise: a primeira gravação já concluída registra quem a concluiu', async () => {
    const id = await notificar();
    await porta.gravarSgh(c, trilha, (g) =>
      g.distribuir({
        id,
        versao: 1,
        usuario: m.login,
        agora: '2026-11-20T10:30:00',
        gestor: m.loginGestor,
        unidade: m.setor,
        prazoAnalise: '2026-12-10',
        orientacao: null,
      }),
    );
    const r = await porta.gravarSgh(c, trilha, (g) =>
      g.registrarAnalise({
        ...base(id),
        versaoNotificacao: 2,
        atual: null,
        causaRaiz: 'Causa sintética.',
        fatores: ['equipe'],
        concluir: true,
        eventos: ['analiseIniciada', 'analiseConcluida'],
        situacaoNotificacao: 'concluida',
      }),
    );
    expect(r).toMatchObject({ versao: 1, versaoNotificacao: 3 });
    const a = await porta.analise(c, id);
    expect(a).toMatchObject({ situacao: 'concluida', registradaPor: m.login, concluidaPor: m.login });
    expect(a?.concluidaEm).not.toBeNull();
  });

  function base(id: number) {
    return {
      notificacao: id,
      versaoNotificacao: 1,
      atual: null,
      metodo: 'ishikawa',
      conteudo: '{}',
      causaRaiz: null,
      fatores: [] as string[],
      licoes: null,
      semAcaoJustificativa: null,
      concluir: false,
      eventos: [] as ('analiseIniciada' | 'analiseConcluida')[],
      situacaoNotificacao: null,
      usuario: m.login,
      agora: '2026-11-20T12:00:00',
    };
  }

  it('plano 5W2H: plano na primeira ação, sequência, prorrogação, conclusão, eficácia e painel', async () => {
    const id = await notificar();
    const acao = (o: Partial<Acao5w2h> = {}): Acao5w2h => ({
      oQue: 'Sinalizar piso molhado',
      porQue: 'Evitar queda',
      onde: 'Corredor',
      quando: '2026-12-01',
      quem: m.loginGestor,
      como: 'Placas',
      quanto: 'Sem custo',
      ...o,
    });
    const a1 = await porta.gravarSgh(c, trilha, (g) =>
      g.incluirAcao({ notificacao: id, usuario: m.login, agora: AGORA, acao: acao() }),
    );
    const a2 = await porta.gravarSgh(c, trilha, (g) =>
      g.incluirAcao({ notificacao: id, usuario: m.login, agora: AGORA, acao: acao({ oQue: 'Treinar equipe' }) }),
    );
    expect([a1.sequencia, a2.sequencia, a1.versao]).toEqual([1, 2, 1]);
    const planos = await ler(
      "SELECT numero, tipo_origem, prazo FROM plano_acao_qualidade WHERE notificacao_incidente_id = ? AND numero LIKE 'PA-2026-%'",
      [id],
    );
    expect(planos).toHaveLength(1);
    expect(planos[0]).toMatchObject({ tipo_origem: 'incidente' });
    const lidas = await porta.acoes(c, id);
    expect(lidas.map((a) => [a.sequencia, a.oQue, a.quem, a.situacao, a.quando])).toEqual([
      [1, 'Sinalizar piso molhado', m.loginGestor, 'planejada', '2026-12-01'],
      [2, 'Treinar equipe', m.loginGestor, 'planejada', '2026-12-01'],
    ]);
    expect((await porta.acoesDoResponsavel(c, m.loginGestor)).map((a) => a.id)).toEqual(
      expect.arrayContaining([a1.id, a2.id]),
    );
    const v2 = await porta.gravarSgh(c, trilha, (g) =>
      g.alterarAcao({ id: a1.id, versao: 1, usuario: m.login, agora: AGORA, acao: acao({ quando: '2026-12-15' }) }),
    );
    expect(v2.versao).toBe(2);
    const [pr] = await ler(
      'SELECT quantidade_prorrogacoes, prazo_original FROM acao_plano_qualidade WHERE id = ?',
      [a1.id],
    );
    expect(Number(pr?.['quantidade_prorrogacoes'])).toBe(1);
    expect(
      await codigo(
        porta.gravarSgh(c, trilha, (g) =>
          g.alterarAcao({ id: a1.id, versao: 1, usuario: m.login, agora: AGORA, acao: acao() }),
        ),
      ),
    ).toBe('versao-desatualizada');
    const v3 = await porta.gravarSgh(c, trilha, (g) =>
      g.situacaoAcao({
        id: a1.id,
        versao: 2,
        usuario: m.login,
        agora: '2026-11-21T09:00:00',
        situacao: 'concluida',
        encerra: true,
        texto: 'Placas instaladas.',
      }),
    );
    await porta.gravarSgh(c, trilha, (g) =>
      g.eficaciaAcao({
        id: a1.id,
        versao: v3.versao,
        usuario: m.login,
        agora: '2026-11-22T09:00:00',
        eficacia: 'eficaz',
        texto: 'Sem quedas no mês.',
      }),
    );
    const feita = await porta.gravarSgh(c, trilha, (g) => g.travarAcao(id, a1.id));
    expect(feita).toMatchObject({
      situacao: 'concluida',
      texto: 'Placas instaladas.',
      concluidaEm: '2026-11-21T09:00:00',
      eficacia: 'eficaz',
      eficaciaPor: m.login,
      versao: 4,
    });
    expect(await porta.gravarSgh(c, trilha, (g) => g.acoesNaTransacao(id))).toHaveLength(2);
    const painel = await porta.painelAcoes(c, '2026-11-20');
    expect(painel).toContainEqual({ situacao: 'concluida', eficacia: 'eficaz', vencida: false, quantidade: 1 });
    expect(await codigo(porta.gravarSgh(fora, trilha, (g) => g.travarAcao(id, a1.id)))).toBe('nao-encontrado');
  });

  it('vigilância de produto: abertura, andamento, encerramento, linha do tempo, filtros e recusas', async () => {
    const id = await notificar();
    const nova = (o: Partial<QueixaTecnicaNova> = {}): Omit<QueixaTecnicaNova, 'hospital'> => ({
      area: 'farmacovigilancia',
      tipo: 'reacaoAdversa',
      item: null,
      produto: 'PRODUTO SINTETICO',
      lote: 'L-SINT-1',
      serie: null,
      fabricante: 'FABRICANTE SINTETICO',
      registroAnvisa: '1000000000001',
      descricao: 'Reação sintética após a dose.',
      notificacao: id,
      alerta: null,
      conduta: 'segregado',
      usuario: m.login,
      agora: AGORA,
      ...o,
    });
    const q = await porta.gravarSgh(c, trilha, (g) => g.abrirQueixa(nova()));
    expect(q.versao).toBe(1);
    expect(await porta.queixa(c, q.id)).toMatchObject({
      area: 'farmacovigilancia',
      tipo: 'reacaoAdversa',
      produto: 'PRODUTO SINTETICO',
      lote: 'L-SINT-1',
      fabricante: 'FABRICANTE SINTETICO',
      registroAnvisa: '1000000000001',
      notificacao: id,
      conduta: 'segregado',
      situacao: 'aberta',
      registradaPor: m.login,
      encerradaEm: null,
    });
    const [linha] = await ler('SELECT numero, lote_segregado, natureza FROM queixa_tecnica_produto WHERE id = ?', [
      q.id,
    ]);
    expect(String(linha?.['numero'])).toMatch(/^QT-2026-\d{6}$/);
    expect(linha).toMatchObject({ lote_segregado: 1, natureza: 'evento_adverso' });
    const t = await porta.gravarSgh(c, trilha, (g) =>
      g.abrirQueixa(nova({ area: 'tecnovigilancia', tipo: 'alertaSanitario', alerta: 'ALERTA 0001', conduta: 'nenhuma' })),
    );
    const v2 = await porta.gravarSgh(c, trilha, (g) =>
      g.andamentoQueixa({
        id: q.id,
        versao: 1,
        situacao: 'notificada',
        conduta: 'recolhido',
        notivisaNumero: 'NV-SINT-1',
        encerra: false,
        texto: 'Transcrita.',
        usuario: m.login,
        agora: '2026-11-21T10:00:00',
      }),
    );
    expect(await porta.queixa(c, q.id)).toMatchObject({ situacao: 'notificada', notivisaNumero: 'NV-SINT-1' });
    const pagina = await porta.queixas(c, { situacao: 'notificada', pagina: 1, porPagina: 10 });
    expect(pagina.itens.map((x) => x.id)).toEqual([q.id]);
    const tecno = await porta.queixas(c, { area: 'tecnovigilancia', pagina: 1, porPagina: 1 });
    expect(tecno.itens.map((x) => [x.id, x.tipo, x.alerta])).toEqual([[t.id, 'alertaSanitario', 'ALERTA 0001']]);
    expect((await porta.queixas(c, { pagina: 1, porPagina: 1 })).temMais).toBe(true);
    await porta.gravarSgh(c, trilha, (g) =>
      g.andamentoQueixa({
        id: q.id,
        versao: v2.versao,
        situacao: 'encerrada',
        conduta: 'recolhido',
        notivisaNumero: 'NV-SINT-1',
        encerra: true,
        texto: 'Encerrada.',
        usuario: m.login,
        agora: '2026-11-22T10:00:00',
      }),
    );
    expect(await porta.queixa(c, q.id)).toMatchObject({ situacao: 'encerrada', encerradaEm: '2026-11-22T10:00:00' });
    expect((await porta.eventosQueixa(c, q.id)).map((e) => [e.situacao, e.conduta, e.texto, e.por])).toEqual([
      ['aberta', 'segregado', null, m.login],
      ['notificada', 'recolhido', 'Transcrita.', m.login],
      ['encerrada', 'recolhido', 'Encerrada.', m.login],
    ]);
    expect(
      await codigo(
        porta.gravarSgh(c, trilha, (g) =>
          g.andamentoQueixa({
            id: q.id,
            versao: 3,
            situacao: 'aberta',
            conduta: 'nenhuma',
            notivisaNumero: null,
            encerra: false,
            texto: 'x',
            usuario: m.login,
            agora: AGORA,
          }),
        ),
      ),
    ).toBe('versao-desatualizada');
    expect(await codigo(porta.gravarSgh(c, trilha, (g) => g.abrirQueixa(nova({ item: 987654321 }))))).toBe(
      'item-inexistente',
    );
    expect(await porta.queixa(fora, q.id)).toBeNull();
    expect(await porta.eventosQueixa(fora, q.id)).toEqual([]);
    expect(await codigo(porta.gravarSgh(fora, trilha, (g) => g.travarQueixa(q.id)))).toBe('nao-encontrado');
  });

  it('produtos do cadastro: busca por código e por nome, nomes pelos códigos e a queixa ligada ao item', async () => {
    const insumo = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-etapa2' }, async (e) => {
      const agora = new Date();
      const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const grupo = await um(
        'SELECT id FROM grupo_insumo WHERE codigo = ?',
        [CODIGO_GRUPO],
        "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'GRUPO SINTETICO', 'medicamento', ?)",
        [CODIGO_GRUPO, agora],
      );
      const unidade = await um(
        'SELECT id FROM unidade_medida WHERE codigo = ?',
        [CODIGO_GRUPO],
        "INSERT INTO unidade_medida (codigo, descricao, sigla, uso_estoque, criado_em) VALUES (?, 'UNIDADE SINTETICA', 'US', TRUE, ?)",
        [CODIGO_GRUPO, agora],
      );
      return um(
        'SELECT id FROM insumo WHERE codigo = ?',
        [String(CODIGO_ITEM)],
        "INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em) VALUES (?, 'PRODUTO SINTETICO QUALIDADE ETAPA2', 'medicamento', ?, ?, ?)",
        [String(CODIGO_ITEM), grupo, unidade, agora],
      );
    });
    expect(insumo).toBeGreaterThan(0);
    expect(await porta.itens(c, String(CODIGO_ITEM))).toEqual([
      { codigo: CODIGO_ITEM, nome: 'PRODUTO SINTETICO QUALIDADE ETAPA2' },
    ]);
    expect(await porta.itens(c, 'sintetico qualidade etapa2')).toContainEqual({
      codigo: CODIGO_ITEM,
      nome: 'PRODUTO SINTETICO QUALIDADE ETAPA2',
    });
    expect(await porta.itens(c, '%')).not.toContainEqual(expect.objectContaining({ codigo: CODIGO_ITEM }));
    const nomes = await porta.nomesDosItens(c, [CODIGO_ITEM, 1]);
    expect([...nomes]).toEqual([[CODIGO_ITEM, 'PRODUTO SINTETICO QUALIDADE ETAPA2']]);
    expect((await porta.nomesDosItens(c, [])).size).toBe(0);
    const q = await porta.gravarSgh(c, trilha, (g) =>
      g.abrirQueixa({
        area: 'farmacovigilancia',
        tipo: 'queixaTecnica',
        item: CODIGO_ITEM,
        produto: null,
        lote: null,
        serie: null,
        fabricante: null,
        registroAnvisa: null,
        descricao: 'Desvio sintético de qualidade.',
        notificacao: null,
        alerta: null,
        conduta: 'nenhuma',
        usuario: m.login,
        agora: AGORA,
      }),
    );
    expect(await porta.queixa(c, q.id)).toMatchObject({
      item: CODIGO_ITEM,
      produto: 'PRODUTO SINTETICO QUALIDADE ETAPA2',
      tipo: 'queixaTecnica',
    });
  });

  it('sugestão resolvida: grava uma vez por resumo e lê só no estabelecimento', async () => {
    const r = randomBytes(32).toString('hex');
    const outro = randomBytes(32).toString('hex');
    expect(await porta.gravarSgh(c, trilha, (g) => g.resolverSugestao({ resumo: r, dia: '2026-11-20' }))).toEqual({
      gravou: true,
    });
    expect(await porta.gravarSgh(c, trilha, (g) => g.resolverSugestao({ resumo: r, dia: '2026-11-21' }))).toEqual({
      gravou: false,
    });
    expect([...(await porta.resolvidas(c, [r, outro]))]).toEqual([r]);
    expect([...(await porta.resolvidas(fora, [r]))]).toEqual([]);
    expect([...(await porta.resolvidas(c, []))]).toEqual([]);
  });
});
