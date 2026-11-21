// Integração da porta PRÓPRIA da classificação de risco contra o MariaDB real (cliente f22_o1), com massa SINTÉTICA:
// a publicação do protocolo desdobrada nas tabelas do modelo, a classificação (níveis, respostas, aferição e marco) e a
// reclassificação com o motivo, os sinais recentes da fila, o vínculo da sessão (regra 1), o protocolo gerenciado, as
// recusas (sucessão única, versão desatualizada, outro estabelecimento) e a trilha na mesma transação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { ConteudoProtocolo } from '@sgh/contratos';
import { linhasDaVersao } from '@sgh/dominio-recepcao';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaClassificacaoPropria } from './classificacao-porta-propria.js';
import { atorDoVinculo, impressaoDoConteudo } from './classificacao-servico.js';
import {
  CLIENTE,
  CODIGO_EST,
  CODIGO_OUTRO,
  garantirCliente,
  limparMovimento,
  LOGIN,
  LOGIN_ENF,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from './massa-recepcao.spec-util.js';
import type { NovaClassificacao, TrilhaGravacao } from './tipos.js';

const c = { rede: 'rede-teste', hospital: CODIGO_EST };
let chaves = 0;
/** O contexto do pedido de gravação (Idempotency-Key única, ou a dada para conferir a repetição). */
const cg = (chave = `rc0101-cls-${++chaves}-${Date.now().toString(36)}`) => ({
  ...c,
  gravacao: {
    login: LOGIN_ENF,
    correlacao: `rc0101-cls-${Date.now().toString(36)}`,
    chaveIdempotencia: chave,
    evento: 'recepcao.classificacao.concluida',
    recurso: 'recepcao.classificacao',
  },
});
const outro = { rede: 'rede-teste', hospital: CODIGO_OUTRO };
const trilha = (tabela: string): TrilhaGravacao => ({
  evento: 'recepcao.classificacao.concluida',
  recurso: 'recepcao.classificacao',
  tabela,
  id: null,
  login: LOGIN_ENF,
  correlacao: `rc0101-cls-${Date.now().toString(36)}`,
});

const CONTEUDO: ConteudoProtocolo = {
  tipo: 'accr',
  nome: 'Protocolo SINTETICO RC',
  cores: [
    { cor: 'vermelho', nome: 'Emergência', tempoAlvoMin: 0, opcaoE08: null, corLegado: null },
    { cor: 'laranja', nome: 'Muito urgente', tempoAlvoMin: 10, opcaoE08: null, corLegado: null },
    { cor: 'amarelo', nome: 'Urgente', tempoAlvoMin: 60, opcaoE08: null, corLegado: null },
    { cor: 'verde', nome: 'Pouco urgente', tempoAlvoMin: 120, opcaoE08: null, corLegado: null },
    { cor: 'azul', nome: 'Não urgente', tempoAlvoMin: 240, opcaoE08: null, corLegado: null },
  ],
  fluxogramas: [{ codigo: 'DOR_TORACICA', titulo: 'Dor torácica' }],
  discriminadores: [
    {
      codigo: 'DT_CHOQUE',
      fluxograma: 'DOR_TORACICA',
      titulo: 'Choque',
      cor: 'vermelho',
      regra: null,
      sugereProtocolo: null,
    },
    {
      codigo: 'DT_DOR_INTENSA',
      fluxograma: 'DOR_TORACICA',
      titulo: 'Dor intensa',
      cor: 'laranja',
      regra: null,
      sugereProtocolo: null,
    },
  ],
  licenca: null,
} as ConteudoProtocolo;

async function codigoDaRecusa(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? '';
    throw e;
  }
  throw new Error('deveria ser recusado');
}

describe.skipIf(SEM_BANCO)('porta própria da classificação contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaClassificacaoPropria;
  let m: Massa;
  let versao = 0;
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-rc0101' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );
  const linha = (anterior: number | null, cor: 'laranja' | 'amarelo'): NovaClassificacao => ({
    cabecalho: String(m.atendimento),
    queixa: 'Dor no peito (SINTETICO)',
    reg: m.atendimento,
    paciente: m.paciente,
    versaoProtocolo: versao,
    fluxograma: 'DOR_TORACICA',
    discriminadores: ['DT_DOR_INTENSA'],
    automaticos: [],
    sinais: {
      pas: 130,
      pad: 85,
      fc: 98,
      fr: null,
      temperatura: 36.8,
      saturacao: 97,
      glicemia: null,
      dor: null,
      glasgow: null,
    },
    corProposta: 'laranja',
    corFinal: cor,
    justificativa: cor === 'laranja' ? null : 'Quadro estável após reavaliação (SINTETICO)',
    motivo: anterior === null ? 'inicial' : 'mudanca_quadro',
    descricaoMudanca: anterior === null ? null : 'Dor cedeu (SINTETICO)',
    anterior,
    tempoAlvoMin: cor === 'laranja' ? 10 : 60,
    horaSinais: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium',
    })
      .format(new Date())
      .replace(' ', 'T'),
    e08: { situacao: 'desligado' },
    autor: LOGIN_ENF,
  });

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    await limparMovimento(nucleo, m);
    porta = new PortaClassificacaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
  });
  afterAll(async () => {
    if (m) await limparMovimento(nucleo, m);
    await nucleo?.encerrar();
  });

  it('regra 1: o vínculo profissional da sessão sai do cadastro (pessoa, profissional, CBO)', async () => {
    const v = await porta.vinculo(c, LOGIN_ENF);
    expect(v).toMatchObject({ vinculo: m.profissional, codigoCbo: '223505' });
    expect(atorDoVinculo(v).categoria).toBe('enfermeiro');
    expect(await porta.vinculo(c, LOGIN)).toBeNull();
  });

  it('publica o protocolo: a versão (conteúdo e impressão), os níveis, o fluxograma e os discriminadores', async () => {
    const l = linhasDaVersao(CONTEUDO);
    const r = await porta.gravar(cg(), trilha('protocolo_classificacao_risco_versao'), (g) =>
      g.publicarProtocolo({
        protocolo: null,
        tipo: 'accr',
        nome: CONTEUDO.nome,
        conteudo: CONTEUDO,
        impressao: impressaoDoConteudo(CONTEUDO),
        notas: 'Primeira versão (SINTETICO)',
        autor: LOGIN,
        aprovador: LOGIN_ENF,
        licenca: null,
        cores: l.cores,
        discriminadores: l.discriminadores,
      }),
    );
    versao = r.id;
    expect(r.versao).toBe(1);
    const vs = await porta.versoes(c);
    expect(vs[0]).toMatchObject({
      id: r.id,
      protocolo: r.protocolo,
      versao: 1,
      tipo: 'accr',
      autor: LOGIN,
      aprovador: LOGIN_ENF,
    });
    expect(vs[0]!.impressao).toBe(impressaoDoConteudo(CONTEUDO));
    expect((await porta.versao(c, r.id))?.conteudo).toEqual(CONTEUDO);
    const n = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM nivel_prioridade_protocolo WHERE protocolo_classificacao_risco_versao_id = ?',
      [r.id],
    );
    expect(Number(n[0]!.n)).toBe(5);
    const d = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM discriminador_classificacao_risco d JOIN fluxograma_classificacao_risco f ON f.id = d.fluxograma_classificacao_risco_id
        WHERE f.protocolo_classificacao_risco_versao_id = ?`,
      [r.id],
    );
    expect(Number(d[0]!.n)).toBe(2);
    // O outro estabelecimento não vê a versão; a versão seguinte do mesmo protocolo fecha a vigência da anterior.
    expect((await porta.versoes(outro)).map((x) => x.id)).not.toContain(r.id);
    const r2 = await porta.gravar(cg(), trilha('protocolo_classificacao_risco_versao'), (g) =>
      g.publicarProtocolo({
        protocolo: r.protocolo,
        tipo: 'accr',
        nome: CONTEUDO.nome,
        conteudo: CONTEUDO,
        impressao: impressaoDoConteudo(CONTEUDO),
        notas: 'Segunda versão (SINTETICO)',
        autor: LOGIN,
        aprovador: LOGIN_ENF,
        licenca: null,
        cores: l.cores,
        discriminadores: l.discriminadores,
      }),
    );
    expect(r2.versao).toBe(2);
    versao = r2.id;
    const fim = await ler<{ vigencia_fim: Date | null }>(
      'SELECT vigencia_fim FROM protocolo_classificacao_risco_versao WHERE id = ?',
      [r.id],
    );
    expect(fim[0]!.vigencia_fim).not.toBeNull();
  });

  it('classifica: níveis, resposta do discriminador, aferição ligada e o marco; a segunda inicial é recusada', async () => {
    const r = await porta.gravar(cg(), trilha('classificacao_risco'), (g) =>
      g.classificar(linha(null, 'laranja')),
    );
    expect(r.sinais).toBe(5);
    const cl = await porta.classificacoes(c, [String(m.atendimento)]);
    expect(cl).toHaveLength(1);
    expect(cl[0]).toMatchObject({
      id: r.id,
      reg: m.atendimento,
      fluxograma: 'DOR_TORACICA',
      discriminadores: ['DT_DOR_INTENSA'],
      corProposta: 'laranja',
      corFinal: 'laranja',
      motivo: 'inicial',
      tempoAlvoMin: 10,
      autor: LOGIN_ENF,
      e08: 'desligado',
    });
    expect(cl[0]!.sinais).toMatchObject({ pas: 130, fc: 98, saturacao: 97 });
    const ev = await ler<{ marco: string }>(
      'SELECT marco FROM classificacao_risco_evento WHERE classificacao_risco_id = ?',
      [r.id],
    );
    expect(ev.map((x) => x.marco)).toEqual(['conclusao']);
    const t = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'classificacao_risco' AND correlacao LIKE 'rc0101-cls-%'",
    );
    expect(Number(t[0]!.n)).toBeGreaterThanOrEqual(1);
    // A trilha da operação leva a ação real (inclusão), o evento da sessão; o outbox sai na mesma transação.
    const tr = await ler<{ acao: string; dados_depois: unknown }>(
      "SELECT acao, dados_depois FROM trilha_auditoria WHERE entidade = 'classificacao_risco' AND entidade_id = ?",
      [r.id],
    );
    expect(tr.map((x) => x.acao)).toEqual(['inclusao']);
    const depois = tr[0]!.dados_depois as unknown;
    const dd = (typeof depois === 'string' ? JSON.parse(depois) : depois) as {
      operacao: string;
      dados: { evento: string };
    };
    expect(dd).toMatchObject({
      operacao: 'classificacao.classificar',
      dados: { evento: 'recepcao.classificacao.concluida' },
    });
    const out = await ler<{ ponto: string }>(
      "SELECT ponto FROM integracao_mensagem WHERE entidade = 'classificacao_risco' AND entidade_id = ?",
      [r.id],
    );
    expect(out.map((x) => x.ponto)).toEqual(['classificacao.risco_classificado']);
    expect(
      await codigoDaRecusa(
        porta.gravar(cg(), trilha('classificacao_risco'), (g) => g.classificar(linha(null, 'laranja'))),
      ),
    ).toBe('ja-classificado');
    // Os sinais recentes da fila, por lote.
    const sinais = await porta.sinaisRecentesDosAtendimentos(c, [
      { cabecalho: String(m.atendimento), desde: '2000-01-01T00:00:00' },
    ]);
    expect(sinais.get(String(m.atendimento))?.temperatura).toBe(36.8);
    // Outro estabelecimento não lê a classificação.
    expect(await porta.classificacoes(outro, [String(m.atendimento)])).toEqual([]);
    // O aviso de estouro do tempo-alvo grava uma vez por chave; o segundo consumidor recebe false.
    const chave = `estouro:${r.id}:${Date.now().toString(36)}`;
    const avisar = () =>
      porta.gravar(cg(), trilha('aviso_estouro_classificacao'), (g) =>
        g.avisarEstouro({ chave, classificacao: r.id, reg: m.atendimento, prazoEm: '2026-11-20T08:10:00' }),
      );
    expect(await avisar()).toBe(true);
    expect(await avisar()).toBe(false);
    expect([...(await porta.avisosGravados(c, [chave, 'outra-chave']))]).toEqual([chave]);
    expect((await porta.avisosGravados(outro, [chave])).size).toBe(0);
  });

  it('reclassifica com o motivo: a anterior fica "reclassificada"; reclassificar de novo a mesma é recusado', async () => {
    const [ant] = await porta.classificacoes(c, [String(m.atendimento)]);
    const r = await porta.gravar(cg(), trilha('classificacao_risco'), (g) =>
      g.classificar(linha(ant!.id, 'amarelo')),
    );
    const cl = await porta.classificacoes(c, [String(m.atendimento)]);
    expect(cl.map((x) => x.id)).toEqual([ant!.id, r.id]);
    expect(cl[1]).toMatchObject({
      motivo: 'mudanca_quadro',
      anterior: ant!.id,
      corFinal: 'amarelo',
      justificativa: expect.any(String),
    });
    const s = await ler<{ situacao: string; versao: number }>(
      'SELECT situacao, versao FROM classificacao_risco WHERE id = ?',
      [ant!.id],
    );
    expect(s[0]).toMatchObject({ situacao: 'reclassificada' });
    expect(Number(s[0]!.versao)).toBe(2);
    expect(
      await codigoDaRecusa(
        porta.gravar(cg(), trilha('classificacao_risco'), (g) => g.classificar(linha(ant!.id, 'amarelo'))),
      ),
    ).toBe('anterior-desatualizada');
    expect((await porta.historicoProntuario(c, m.paciente)).map((x) => x.opcao)).toEqual([
      'amarelo',
      'laranja',
    ]);
  });

  it('o mesmo código de discriminador em dois fluxogramas liga a resposta ao do fluxograma escolhido', async () => {
    const dois = {
      ...CONTEUDO,
      fluxogramas: [
        { codigo: 'DOR_TORACICA', titulo: 'Dor torácica' },
        { codigo: 'DISPNEIA', titulo: 'Dispneia' },
      ],
      discriminadores: [
        ...CONTEUDO.discriminadores,
        { ...CONTEUDO.discriminadores[1]!, fluxograma: 'DISPNEIA', titulo: 'Dor intensa na dispneia' },
      ],
    } as ConteudoProtocolo;
    const l = linhasDaVersao(dois);
    const pub = (conteudo: ConteudoProtocolo, ls = linhasDaVersao(conteudo)) =>
      porta.gravar(cg(), trilha('protocolo_classificacao_risco_versao'), (g) =>
        g.publicarProtocolo({
          protocolo: null,
          tipo: 'accr',
          nome: conteudo.nome,
          conteudo,
          impressao: impressaoDoConteudo(conteudo),
          notas: 'Dois fluxogramas (SINTETICO)',
          autor: LOGIN,
          aprovador: LOGIN_ENF,
          licenca: null,
          cores: ls.cores,
          discriminadores: ls.discriminadores,
        }),
      );
    const v = await pub(dois, l);
    const [ant] = (await porta.classificacoes(c, [String(m.atendimento)])).slice(-1);
    const r = await porta.gravar(cg(), trilha('classificacao_risco'), (g) =>
      g.classificar({ ...linha(ant!.id, 'laranja'), versaoProtocolo: v.id, fluxograma: 'DISPNEIA' }),
    );
    const resp = await ler<{ fluxo: string; pergunta: string }>(
      `SELECT f.codigo AS fluxo, d.pergunta FROM classificacao_risco_resposta r
         JOIN discriminador_classificacao_risco d ON d.id = r.discriminador_classificacao_risco_id
         JOIN fluxograma_classificacao_risco f ON f.id = d.fluxograma_classificacao_risco_id
        WHERE r.classificacao_risco_id = ?`,
      [r.id],
    );
    expect(resp).toEqual([{ fluxo: 'DISPNEIA', pergunta: 'Dor intensa na dispneia' }]);
    // O discriminador que não é do fluxograma escolhido é recusado (nunca descartado em silêncio).
    expect(
      await codigoDaRecusa(
        porta.gravar(cg(), trilha('classificacao_risco'), (g) =>
          g.classificar({
            ...linha(r.id, 'laranja'),
            versaoProtocolo: v.id,
            fluxograma: 'DISPNEIA',
            discriminadores: ['DT_CHOQUE'],
          }),
        ),
      ),
    ).toBe('discriminador-inexistente');
    // O fluxograma que não está na versão é recusado; o código maior que o modelo comporta, na publicação.
    expect(
      await codigoDaRecusa(
        porta.gravar(cg(), trilha('classificacao_risco'), (g) =>
          g.classificar({ ...linha(r.id, 'laranja'), versaoProtocolo: v.id, fluxograma: 'INEXISTENTE' }),
        ),
      ),
    ).toBe('fluxograma-inexistente');
    const longo = 'F'.repeat(31);
    const comLongo = {
      ...CONTEUDO,
      fluxogramas: [{ codigo: longo, titulo: 'Longo' }],
      discriminadores: CONTEUDO.discriminadores.map((d) => ({ ...d, fluxograma: longo })),
    } as ConteudoProtocolo;
    expect(await codigoDaRecusa(pub(comLongo))).toBe('codigo-fluxograma-longo');
  });

  it('a falha no meio desfaz tudo (sem classificação nem trilha)', async () => {
    const antes = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM classificacao_risco WHERE estabelecimento_id = ?',
      [m.est],
    );
    await expect(
      porta.gravar(cg(), trilha('classificacao_risco'), async (g) => {
        const cl = await porta.classificacoes(c, [String(m.atendimento)]);
        await g.classificar(linha(cl.at(-1)!.id, 'laranja'));
        throw new Error('falha simulada depois da gravação');
      }),
    ).rejects.toThrow('falha simulada');
    const depois = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM classificacao_risco WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(Number(depois[0]!.n)).toBe(Number(antes[0]!.n));
  });

  it('protocolo gerenciado: publica a versão, inclui o paciente e registra a meta uma vez só', async () => {
    const pub = await porta.gravar(cg(), trilha('protocolo_gerenciado_versao'), (g) =>
      g.publicarGerenciado({
        tipo: 'sepse',
        nome: 'Sepse SINTETICO',
        conteudo: { metas: [] },
        impressao: 'x',
        notas: 'Primeira versão (SINTETICO)',
        autor: LOGIN,
        aprovador: LOGIN_ENF,
      }),
    );
    expect(pub.versao).toBeGreaterThanOrEqual(1);
    expect((await porta.versoesGerenciadas(c)).map((x) => x.id)).toContain(pub.id);
    // O tipo com hífen do contrato ("dor-toracica") grava pelo código do cadastro e volta com o do contrato; a
    // repetição do pedido (mesma Idempotency-Key) devolve a mesma versão sem gravar de novo.
    const pedido = cg();
    const publicarDor = () =>
      porta.gravar(pedido, trilha('protocolo_gerenciado_versao'), (g) =>
        g.publicarGerenciado({
          tipo: 'dor-toracica',
          nome: 'Dor torácica SINTETICO',
          conteudo: { metas: [] },
          impressao: 'x',
          notas: 'Primeira versão (SINTETICO)',
          autor: LOGIN,
          aprovador: LOGIN_ENF,
        }),
      );
    const dor = await publicarDor();
    expect(await publicarDor()).toEqual(dor);
    expect((await porta.versoesGerenciadas(c)).find((x) => x.id === dor.id)?.tipo).toBe('dor-toracica');
    const n = await ler<{ n: number; tipo: string }>(
      `SELECT COUNT(*) AS n, MAX(p.tipo) AS tipo FROM protocolo_gerenciado_versao v
         JOIN protocolo_gerenciado p ON p.id = v.protocolo_gerenciado_id WHERE v.id = ?`,
      [dor.id],
    );
    expect(n[0]).toMatchObject({ tipo: 'dor_toracica' });
    expect(
      Number(
        (
          await ler<{ n: number }>(
            "SELECT COUNT(*) AS n FROM protocolo_gerenciado_versao v JOIN protocolo_gerenciado p ON p.id = v.protocolo_gerenciado_id WHERE p.tipo = 'dor_toracica' AND p.estabelecimento_id = ?",
            [m.est],
          )
        )[0]!.n,
      ),
    ).toBe(1);
    const inc = await porta.gravar(cg(), trilha('inclusao_protocolo_paciente'), (g) =>
      g.incluirProtocolo({
        cabecalho: String(m.atendimento),
        reg: m.atendimento,
        paciente: m.paciente,
        tipo: 'sepse',
        gerenciado: pub.id,
        origem: 'enfermeiro',
        sugeridoPor: null,
        criterios: ['febre', 'taquicardia'],
        chegadaEm: '2026-11-20T08:00:00',
        autor: LOGIN_ENF,
        vinculo: m.profissional,
      }),
    );
    const p = await porta.protocoloDoPaciente(c, inc);
    expect(p).toMatchObject({
      id: inc,
      reg: m.atendimento,
      criterios: ['febre', 'taquicardia'],
      origem: 'enfermeiro',
    });
    const registrarMeta = () =>
      porta.gravar(cg(), trilha('inclusao_protocolo_registro'), (g) =>
        g.registrarEventoProtocolo({
          protocoloPaciente: inc,
          tipoEvento: 'meta',
          codigo: 'lactato',
          situacao: 'cumprida',
          ocorridoEm: '2026-11-20T08:30',
          prazoEm: null,
          motivo: null,
          por: LOGIN_ENF,
        }),
      );
    const meta = await registrarMeta();
    expect(
      await codigoDaRecusa(
        porta.gravar(cg(), trilha('inclusao_protocolo_registro'), (g) =>
          g.registrarEventoProtocolo({
            protocoloPaciente: inc,
            tipoEvento: 'meta',
            codigo: 'lactato',
            situacao: 'cumprida',
            ocorridoEm: null,
            prazoEm: null,
            motivo: null,
            por: LOGIN_ENF,
          }),
        ),
      ),
    ).toBe('ja-registrado');
    const p2 = await porta.protocoloDoPaciente(c, inc);
    expect(p2?.eventos).toEqual([
      expect.objectContaining({
        id: meta,
        tipo: 'meta',
        codigo: 'lactato',
        situacao: 'cumprida',
        quando: '2026-11-20T08:30:00',
        por: LOGIN_ENF,
      }),
    ]);
    await porta.gravar(cg(), trilha('inclusao_protocolo_registro'), (g) =>
      g.registrarEventoProtocolo({
        protocoloPaciente: inc,
        tipoEvento: 'encerramento',
        codigo: 'alta',
        situacao: 'encerrado',
        ocorridoEm: null,
        prazoEm: null,
        motivo: null,
        por: LOGIN_ENF,
      }),
    );
    expect(
      await codigoDaRecusa(
        porta.gravar(cg(), trilha('inclusao_protocolo_registro'), (g) =>
          g.registrarEventoProtocolo({
            protocoloPaciente: inc,
            tipoEvento: 'checklist',
            codigo: 'antibiotico',
            situacao: 'feito',
            ocorridoEm: null,
            prazoEm: null,
            motivo: null,
            por: LOGIN_ENF,
          }),
        ),
      ),
    ).toBe('protocolo-encerrado');
  });
});
