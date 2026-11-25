// Contrato de efeito da promoção da saúde e gestão de crônicos (08-SGO L115, C2-102) contra o MariaDB real (cliente
// f22_o2). Massa SINTÉTICA pela carteira da F1 (titular adulto e dependente criança). Prova o que fica no banco: o grupo
// de risco, o questionário com as perguntas versionado, o programa (recusa do registro na ANS sem número), os critérios
// e a bonificação; os elegíveis pelo recorte de idade; o participante incluído (recusa da participação em dobro), os
// contatos agendado e realizado, a avaliação de risco com as respostas e o grupo de risco atribuído; o elegível de um
// segundo programa pelo escore; o crônico achado pelas contas recebidas (guia_conta_recebida sintética): CID, grupo de
// patologia, procedimento, internação, urgência pelo caráter TISS e custo, cada um com o motivo, só dentro da janela do
// critério e sem a guia cancelada; a adesão e o direito à bonificação; o custo antes e depois da entrada com a média e a
// variação; a saída com motivo que cancela o agendado e mantém o histórico.
// SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import type { NucleoProprio } from '@sgh/nucleo';
import { cnpjSintetico } from '@sgh/dominio-operadora';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  montarCarteira,
  PODE,
  prepararBase,
  servicoNoBanco,
  sessao,
} from './infra/copia.spec-util.js';
import { PortaProgramaSaudePropria } from './programa-saude-propria.js';

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let porta: PortaProgramaSaudePropria | null = null;
let titular = 0;
let dependente = 0;
const COD = 'C2102';
let termos: number[] = [];
let grupoPatologia = 0;

const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

interface GuiaSintetica {
  ben: number;
  inicio: string;
  apresentado: number;
  glosado?: number;
  liberado?: number | null;
  internacao?: boolean;
  urgencia?: boolean;
  cancelada?: boolean;
  cids?: number[];
  procedimento?: number;
}

/** Contas recebidas sintéticas: lote, guias, diagnósticos e itens gravados direto (a massa do contrato). */
async function montarContas(n: NucleoProprio, m: MassaBase, guias: readonly GuiaSintetica[]) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2102' }, async (e) => {
    const agora = new Date();
    const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
      const l = await e.uma<{ id: unknown }>(sel, p);
      return l ? Number(l['id']) : e.inserir(ins, pi);
    };
    const op = await e.uma<{ id: unknown }>(
      'SELECT operadora_saude_id AS id FROM operadora_saude_estabelecimento WHERE estabelecimento_id = ? ORDER BY id LIMIT 1',
      [m.est],
    );
    const mun = await e.uma<{ id: unknown; uf: unknown }>(
      "SELECT id, unidade_federativa_id AS uf FROM municipio_ibge WHERE codigo_ibge = '3550308'",
      [],
    );
    const tipoP = await e.uma<{ id: unknown }>("SELECT id FROM tipo_prestador_rede WHERE codigo = '3'", []);
    const natP = await e.uma<{ id: unknown }>(
      "SELECT id FROM natureza_prestador_rede WHERE codigo = '1'",
      [],
    );
    const prest = await um(
      'SELECT id FROM prestador_rede WHERE estabelecimento_id = ? AND codigo = ?',
      [m.est, `${COD}-PR`],
      `INSERT INTO prestador_rede (estabelecimento_id, codigo, pessoa, cnpj, nome, tipo_prestador_rede_id,
         natureza_prestador_rede_id, classificacao, municipio_ibge_id, unidade_federativa_id, credenciado_em, situacao_em,
         criado_em)
       VALUES (?, ?, 'juridica', ?, 'HOSPITAL SINTETICO C2102', ?, ?, 'assistencia_hospitalar', ?, ?, '2024-01-01',
         '2024-01-01', ?)`,
      [
        m.est,
        `${COD}-PR`,
        cnpjSintetico('021020210201'),
        tipoP!['id'],
        natP!['id'],
        mun!['id'],
        mun!['uf'],
        agora,
      ],
    );
    const tipoGuia = await um(
      "SELECT id FROM tipo_guia_plano WHERE codigo = 'sp_sadt'",
      [],
      "INSERT INTO tipo_guia_plano (codigo, descricao, criado_em) VALUES ('sp_sadt', 'SP/SADT', ?)",
      [agora],
    );
    const regime = await um(
      'SELECT id FROM regime_atendimento_internacao WHERE codigo = ?',
      [`${COD}-RI`],
      'INSERT INTO regime_atendimento_internacao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
      [`${COD}-RI`, 'Internação sintética', agora],
    );
    const urg = await um(
      "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = '2'",
      [],
      "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('2', 'URGENCIA', 'sintetico', ?)",
      [agora],
    );
    const lote = await e.inserir(
      `INSERT INTO lote_conta_recebida (estabelecimento_id, operadora_saude_id, prestador_rede_id, numero_protocolo,
         numero_lote_prestador, tipo_guia, competencia, canal_envio, recebido_em, criado_em)
       VALUES (?, ?, ?, ?, '2102', 'sp_sadt', '2026-01-01', 'digitacao', ?, ?)`,
      [m.est, op!['id'], prest, `${COD}-${Date.now() % 1_000_000}`, agora, agora],
    );
    let ordem = 0;
    for (const g of guias) {
      ordem += 1;
      const gid = await e.inserir(
        `INSERT INTO guia_conta_recebida (estabelecimento_id, lote_conta_recebida_id, ordem_lote, tipo_guia_plano_id,
           numero_guia_prestador, numero_carteira, prestador_rede_id, beneficiario_plano_id, inicio_atendimento,
           carater_atendimento_tiss_id, regime_atendimento_internacao_id, valor_apresentado, valor_glosado, valor_liberado,
           situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, 'C21020000', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.est,
          lote,
          ordem,
          tipoGuia,
          `${COD}G${ordem}`,
          prest,
          g.ben,
          `${g.inicio} 10:00:00`,
          g.urgencia ? urg : null,
          g.internacao ? regime : null,
          g.apresentado,
          g.glosado ?? 0,
          g.liberado ?? null,
          g.cancelada ? 'cancelada' : 'recebida',
          agora,
        ],
      );
      let seq = 0;
      for (const cid of g.cids ?? []) {
        seq += 1;
        await e.inserir(
          `INSERT INTO guia_conta_recebida_diagnostico (guia_conta_recebida_id, sequencia, cid_termo_terminologia_id, papel,
             criado_em) VALUES (?, ?, ?, ?, ?)`,
          [gid, seq, cid, seq === 1 ? 'principal' : 'secundario', agora],
        );
      }
      if (g.procedimento)
        await e.inserir(
          `INSERT INTO guia_conta_recebida_item (guia_conta_recebida_id, sequencia, grupo, procedimento_termo_terminologia_id,
             codigo_tabela_tiss, descricao, data_execucao, quantidade_apresentada, valor_apresentado, criado_em)
           VALUES (?, 1, 'procedimento', ?, '22', 'PROCEDIMENTO SINTETICO', ?, 1, ?, ?)`,
          [gid, g.procedimento, g.inicio, g.apresentado, agora],
        );
    }
  });
}

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.programa-saude' },
    correlacao: 'teste-c2102',
  });

const q = (sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c2102' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  );

async function limpar(n: NucleoProprio, m: MassaBase) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2102' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const prog = 'SELECT id FROM programa_saude WHERE estabelecimento_id IN (?, ?)';
    const guias = `SELECT g.id FROM guia_conta_recebida g JOIN lote_conta_recebida l ON l.id = g.lote_conta_recebida_id
                    WHERE l.estabelecimento_id IN (?, ?) AND l.numero_protocolo LIKE ?`;
    const pg = [...ests, `${COD}-%`];
    await e.executar(
      `DELETE FROM guia_conta_recebida_item WHERE guia_conta_recebida_id IN (SELECT id FROM (${guias}) x)`,
      pg,
    );
    await e.executar(
      `DELETE FROM guia_conta_recebida_diagnostico WHERE guia_conta_recebida_id IN (SELECT id FROM (${guias}) x)`,
      pg,
    );
    await e.executar(`DELETE FROM guia_conta_recebida WHERE id IN (SELECT id FROM (${guias}) x)`, pg);
    await e.executar(
      'DELETE FROM lote_conta_recebida WHERE estabelecimento_id IN (?, ?) AND numero_protocolo LIKE ?',
      pg,
    );
    await e.executar('DELETE FROM prestador_rede WHERE estabelecimento_id IN (?, ?) AND codigo = ?', [
      ...ests,
      `${COD}-PR`,
    ]);
    await e.executar(
      `DELETE r FROM avaliacao_risco_participante_resposta r JOIN avaliacao_risco_participante a ON a.id = r.avaliacao_risco_participante_id WHERE a.estabelecimento_id IN (?, ?)`,
      ests,
    );
    await e.executar('DELETE FROM avaliacao_risco_participante WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar('DELETE FROM acompanhamento_programa WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(`DELETE FROM participante_programa WHERE programa_saude_id IN (${prog})`, ests);
    await e.executar(
      `DELETE FROM criterio_elegibilidade_programa WHERE programa_saude_id IN (${prog})`,
      ests,
    );
    await e.executar(`DELETE FROM bonificacao_programa WHERE programa_saude_id IN (${prog})`, ests);
    await e.executar('DELETE FROM programa_saude WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      `DELETE p FROM modelo_questionario_saude_pergunta p JOIN modelo_questionario_saude m ON m.id = p.modelo_questionario_saude_id WHERE m.codigo LIKE ?`,
      [`${COD}%`],
    );
    await e.executar('DELETE FROM modelo_questionario_saude WHERE codigo LIKE ?', [`${COD}%`]);
    await e.executar('DELETE FROM grupo_risco_saude WHERE codigo LIKE ?', [`${COD}%`]);
    await e.executar(
      'DELETE c FROM grupo_patologia_cid c JOIN grupo_patologia g ON g.id = c.grupo_patologia_id WHERE g.codigo LIKE ?',
      [`${COD}%`],
    );
    await e.executar('DELETE FROM grupo_patologia WHERE codigo LIKE ?', [`${COD}%`]);
    await e.executar('DELETE FROM regime_atendimento_internacao WHERE codigo = ?', [`${COD}-RI`]);
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  const { servico } = servicoNoBanco(nucleo);
  const cart = await montarCarteira(servico, sessao(massa), { registro: '421021', base: '2102' });
  titular = (cart.titular as { id: number }).id;
  dependente = cart.dependente;
  porta = new PortaProgramaSaudePropria(nucleo, CLIENTE);
  // Três termos distintos da terminologia do cliente (só os ids): CID 1, CID 2 (do grupo de patologia) e procedimento.
  termos = (await q('SELECT id FROM termo_terminologia ORDER BY id LIMIT 3')).map((r) => Number(r['id']));
  grupoPatologia = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2102' }, async (e) => {
    const g = await e.inserir('INSERT INTO grupo_patologia (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
      `${COD}-GP`,
      'Grupo sintético',
      new Date(),
    ]);
    await e.inserir(
      'INSERT INTO grupo_patologia_cid (grupo_patologia_id, cid_termo_terminologia_id, criado_em) VALUES (?, ?, ?)',
      [g, termos[1], new Date()],
    );
    return g;
  });
  const [cid1, cid2, proc] = termos as [number, number, number];
  await montarContas(nucleo, massa, [
    // Titular (participante do programa A, entrada 2026-02-01): custo antes (2025-02 a 2026-01) e depois.
    { ben: titular, inicio: '2024-06-10', apresentado: 100, liberado: 100 },
    { ben: titular, inicio: '2025-12-10', apresentado: 300, liberado: 300 },
    { ben: titular, inicio: '2026-01-15', apresentado: 500, glosado: 50, liberado: 450 },
    { ben: titular, inicio: '2026-03-10', apresentado: 200, glosado: 20 },
    // Dependente: o crônico achado pelas contas, com datas relativas a hoje.
    {
      ben: dependente,
      inicio: dias(30),
      apresentado: 500,
      glosado: 100,
      internacao: true,
      cids: [cid1, cid2],
    },
    {
      ben: dependente,
      inicio: dias(60),
      apresentado: 300,
      liberado: 250,
      internacao: true,
      cids: [cid2],
      procedimento: proc,
    },
    {
      ben: dependente,
      inicio: dias(90),
      apresentado: 200,
      liberado: 200,
      urgencia: true,
      procedimento: proc,
    },
    { ben: dependente, inicio: dias(120), apresentado: 350, liberado: 350, urgencia: true },
    { ben: dependente, inicio: dias(250), apresentado: 0, urgencia: true },
    {
      ben: dependente,
      inicio: dias(500),
      apresentado: 5000,
      liberado: 5000,
      internacao: true,
      cids: [cid1],
      procedimento: proc,
    },
    { ben: dependente, inicio: dias(20), apresentado: 9000, internacao: true, cancelada: true, cids: [cid1] },
  ]);
}, 120_000);

afterAll(async () => {
  if (!PODE || !nucleo || !massa) return;
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  await nucleo.encerrar();
});

const programaBase = {
  objetivo: 'Controle glicêmico sintético',
  publicoAlvo: 'Adultos',
  metas: null,
  isentaCoparticipacao: true,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  situacao: 'ativo',
};
const criterio = {
  termo: null,
  grupoPatologia: null,
  ocorrenciasMinimas: null,
  periodoMeses: null,
  idadeMinima: null,
  idadeMaxima: null,
  custoMensalMinimo: null,
  custoPeriodoMinimo: null,
  escoreMinimo: null,
  formaAlerta: 'sugerir',
};

describe.skipIf(!PODE)('C2-102 promoção da saúde e gestão de crônicos (contrato de efeito)', () => {
  it('programa, questionário, elegível pela idade, participante, contatos, avaliação e saída ficam no banco', async () => {
    const c = contexto(massa!);
    const grupo = await porta!.gravarGrupoRisco(
      c,
      { codigo: `${COD}-DM`, descricao: 'Diabetes sintético', prioridade: 1 },
      trilha('grupo'),
    );
    const quest = await porta!.gravarQuestionario(
      c,
      {
        codigo: `${COD}-Q`,
        nome: 'Risco sintético',
        vigenciaInicio: '2026-01-01',
        exigeTodas: false,
        perguntas: [
          {
            enunciado: 'Fuma?',
            tipoResposta: 'sim_nao',
            obrigatoria: true,
            opcoes: null,
            respostaIndicativa: 'sim',
          },
          {
            enunciado: 'Atividade física',
            tipoResposta: 'escolha_unica',
            obrigatoria: true,
            opcoes: [
              { codigo: 'regular', descricao: 'Regular', pontos: 0 },
              { codigo: 'nenhuma', descricao: 'Nenhuma', pontos: 3 },
            ],
            respostaIndicativa: null,
          },
        ],
      },
      trilha('questionario'),
    );
    expect(quest['numeroVersao']).toBe(1);
    const [pq] = await q(
      'SELECT COUNT(*) AS n, MAX(finalidade) AS f FROM modelo_questionario_saude_pergunta p JOIN modelo_questionario_saude m ON m.id = p.modelo_questionario_saude_id WHERE m.id = ?',
      [quest.id],
    );
    expect([Number(pq!['n']), pq!['f']]).toEqual([2, 'programa_saude']);

    expect(
      await codigoDe(
        porta!.gravarPrograma(
          c,
          null,
          null,
          {
            ...programaBase,
            codigo: `${COD}-A`,
            nome: 'Cuidado do diabético',
            tipo: 'gestao_cronicos',
            grupoRisco: grupo.id,
            registradoAns: true,
            numeroRegistroAns: null,
          },
          trilha('programa'),
        ),
      ),
    ).toBe('programa-registro-ans');
    const progA = await porta!.gravarPrograma(
      c,
      null,
      null,
      {
        ...programaBase,
        codigo: `${COD}-A`,
        nome: 'Cuidado do diabético',
        tipo: 'gestao_cronicos',
        grupoRisco: grupo.id,
        registradoAns: true,
        numeroRegistroAns: 'RA-SINT-1',
      },
      trilha('programa'),
    );
    await porta!.incluirCriterio(
      c,
      progA.id,
      { ...criterio, tipo: 'idade', idadeMinima: 18 },
      trilha('criterio'),
    );
    await porta!.incluirBonificacao(
      c,
      progA.id,
      {
        codigo: 'DESC5',
        descricao: 'Desconto pela participação',
        tipoBeneficio: 'desconto_mensalidade',
        percentualDesconto: 5,
        valorBonus: null,
        adesaoMinimaPercentual: 50,
        validadeMeses: 12,
        criterio: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      },
      trilha('bonificacao'),
    );

    const eleA = await porta!.elegiveis(c, progA.id);
    expect(eleA.map((x) => x.beneficiario)).toContain(titular);
    expect(eleA.map((x) => x.beneficiario)).not.toContain(dependente);

    const part = await porta!.incluirParticipante(
      c,
      progA.id,
      { beneficiario: titular, entrada: '2026-02-01', grupoRisco: null, responsavel: null, observacao: null },
      trilha('participante'),
    );
    expect(
      await codigoDe(
        porta!.incluirParticipante(
          c,
          progA.id,
          {
            beneficiario: titular,
            entrada: '2026-02-02',
            grupoRisco: null,
            responsavel: null,
            observacao: null,
          },
          trilha('participante'),
        ),
      ),
    ).toBe('participacao-aberta');
    expect((await porta!.elegiveis(c, progA.id)).map((x) => x.beneficiario)).not.toContain(titular);

    const agendado = await porta!.registrarContato(
      c,
      part.id,
      {
        tipo: 'visita_domiciliar',
        situacao: 'agendado',
        agendadoPara: '2099-01-10T09:00',
        realizadoEm: null,
        resultado: null,
        proximoContato: null,
      },
      trilha('contato'),
    );
    const feito = await porta!.registrarContato(
      c,
      part.id,
      {
        tipo: 'telefone',
        situacao: 'agendado',
        agendadoPara: '2099-01-05T09:00',
        realizadoEm: null,
        resultado: null,
        proximoContato: null,
      },
      trilha('contato'),
    );
    await porta!.baixarContato(
      c,
      feito.id,
      1,
      {
        situacao: 'realizado',
        realizadoEm: '2026-02-10T10:00',
        resultado: 'Orientação feita',
        proximoContato: null,
      },
      trilha('contato'),
    );
    const agenda = await porta!.agenda(c, { programa: progA.id });
    expect(agenda.proximos.map((x) => x.id)).toEqual([agendado.id]);

    const perguntas = (await porta!.questionarios(c)).find((x) => x.id === quest.id)!.perguntas;
    const aval = await porta!.aplicarQuestionario(
      c,
      part.id,
      {
        questionario: quest.id,
        canal: 'telefone',
        respostas: [
          { pergunta: perguntas[0]!.id, opcao: 'sim' },
          { pergunta: perguntas[1]!.id, opcao: 'nenhuma' },
        ],
        observacao: null,
      },
      trilha('avaliacao'),
    );
    expect([aval['escore'], aval['classificacao']]).toEqual([4, 'muito_alto']);
    const [av] = await q(
      `SELECT a.escore, a.classificacao_risco, a.situacao, a.grupo_risco_saude_id,
              (SELECT COUNT(*) FROM avaliacao_risco_participante_resposta r WHERE r.avaliacao_risco_participante_id = a.id) AS respostas,
              (SELECT SUM(r.pontos) FROM avaliacao_risco_participante_resposta r WHERE r.avaliacao_risco_participante_id = a.id) AS pontos
         FROM avaliacao_risco_participante a WHERE a.id = ?`,
      [aval.id],
    );
    expect([
      Number(av!['escore']),
      av!['classificacao_risco'],
      av!['situacao'],
      Number(av!['grupo_risco_saude_id']),
    ]).toEqual([4, 'muito_alto', 'concluida', grupo.id]);
    expect([Number(av!['respostas']), Number(av!['pontos'])]).toEqual([2, 4]);

    // Segundo programa: o escore da avaliação elege; CID, procedimento, internação, urgência e custo apurados das contas.
    const progB = await porta!.gravarPrograma(
      c,
      null,
      null,
      {
        ...programaBase,
        codigo: `${COD}-B`,
        nome: 'Prevenção de risco',
        tipo: 'prevencao_risco',
        grupoRisco: null,
        registradoAns: false,
        numeroRegistroAns: null,
      },
      trilha('programa'),
    );
    for (const k of [
      { ...criterio, tipo: 'escore', escoreMinimo: 3 },
      { ...criterio, tipo: 'cid', termo: termos[0]!, periodoMeses: 12 },
      { ...criterio, tipo: 'cid', grupoPatologia, ocorrenciasMinimas: 2, periodoMeses: 12 },
      { ...criterio, tipo: 'procedimento', termo: termos[2]!, ocorrenciasMinimas: 2, periodoMeses: 12 },
      { ...criterio, tipo: 'internacao', ocorrenciasMinimas: 2, periodoMeses: 12 },
      { ...criterio, tipo: 'pronto_socorro', ocorrenciasMinimas: 2, periodoMeses: 6 },
      { ...criterio, tipo: 'custo', custoPeriodoMinimo: 1000, periodoMeses: 12 },
    ])
      await porta!.incluirCriterio(c, progB.id, k, trilha('criterio'));
    expect(
      await codigoDe(porta!.incluirCriterio(c, progB.id, { ...criterio, tipo: 'cid' }, trilha('criterio'))),
    ).toBe('criterio-termo');
    const eleB = await porta!.elegiveis(c, progB.id);
    const tB = eleB.find((x) => x.beneficiario === titular);
    expect(tB?.motivos).toEqual(['escore 4']);
    // Dependente pelas contas: CID 1 em 1 conta (a de 500 dias e a cancelada não contam), grupo de patologia em 2,
    // procedimento em 2, 2 internações, 2 urgências nos 6 meses (a de 250 dias fica fora) e o custo de 12 meses
    // (400 + 250 + 200 + 350 + 0; sem a de 500 dias nem a cancelada).
    expect(eleB.find((x) => x.beneficiario === dependente)?.motivos).toEqual([
      'diagnóstico em 1 conta(s)',
      'diagnóstico em 2 conta(s)',
      'procedimento em 2 conta(s)',
      '2 internação(ões)',
      '2 atendimento(s) de urgência',
      'custo de 1200.00 no período',
    ]);

    const bon = await porta!.bonificacao(c, progA.id);
    const bt = bon.find((x) => x.participante === part.id)!;
    expect(bt.adesao).toEqual({ realizados: 1, devidos: 1, percentual: 100 });
    expect(bt.bonificacoes[0]?.direito).toBe(true);
    const custo = await porta!.custo(c, progA.id, 12);
    expect(custo.participantes).toHaveLength(1);
    // Antes (2025-02 a 2026-01): 300 + 450; a de 2024-06 fica fora. Depois: 200 - 20 (sem valor liberado).
    const cp = custo.participantes[0]!;
    expect(cp.antes).toEqual({ total: 750, meses: 12, media: 62.5 });
    expect(cp.depois.total).toBe(180);
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const mediaDepois = r2(180 / cp.depois.meses);
    expect(cp.depois.media).toBe(mediaDepois);
    expect(cp.variacaoPercentual).toBe(r2(((mediaDepois - 62.5) / 62.5) * 100));
    expect([custo.antes, custo.depois, custo.variacaoPercentual]).toEqual([
      62.5,
      mediaDepois,
      r2(((mediaDepois - 62.5) / 62.5) * 100),
    ]);

    const saida = await porta!.encerrarParticipante(
      c,
      part.id,
      (await q('SELECT versao FROM participante_programa WHERE id = ?', [part.id]))[0]!['versao'] as number,
      { saida: '2026-03-01', motivo: 'alta_programa', observacao: null },
      trilha('saida'),
    );
    expect(saida.id).toBe(part.id);
    const [pp] = await q(
      'SELECT situacao, saida_em, motivo_saida, excluido_em, grupo_risco_saude_id FROM participante_programa WHERE id = ?',
      [part.id],
    );
    expect([
      pp!['situacao'],
      pp!['motivo_saida'],
      pp!['excluido_em'],
      Number(pp!['grupo_risco_saude_id']),
    ]).toEqual(['encerrado', 'alta_programa', null, grupo.id]);
    const contatos = await q(
      'SELECT id, situacao FROM acompanhamento_programa WHERE participante_programa_id = ? ORDER BY id',
      [part.id],
    );
    expect(contatos.map((x) => x['situacao'])).toEqual(['cancelado', 'realizado']);
    expect(
      await codigoDe(
        porta!.registrarContato(
          c,
          part.id,
          {
            tipo: 'telefone',
            situacao: 'agendado',
            agendadoPara: '2099-02-01T09:00',
            realizadoEm: null,
            resultado: null,
            proximoContato: null,
          },
          trilha('contato'),
        ),
      ),
    ).toBe('participante-inativo');

    const visao = await porta!.doBeneficiario(c, titular);
    expect(visao.participacoes.map((x) => [x.programa, x.situacao, x.ultimaClassificacao])).toEqual([
      [progA.id, 'encerrado', 'muito_alto'],
    ]);
    expect(visao.contatos).toHaveLength(2);
    expect(visao.avaliacoes).toHaveLength(1);

    // Outro estabelecimento não enxerga o programa.
    expect(await codigoDe(porta!.programa(contexto(massa!, true), progA.id))).toBe('nao-encontrado');
  }, 120_000);
});
