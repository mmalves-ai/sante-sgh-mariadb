// Contrato de efeito da promoção da saúde e gestão de crônicos (08-SGO L115, C2-102) contra o MariaDB real (cliente
// f22_o2). Massa SINTÉTICA pela carteira da F1 (titular adulto e dependente criança). Prova o que fica no banco: o grupo
// de risco, o questionário com as perguntas versionado, o programa (recusa do registro na ANS sem número), os critérios
// e a bonificação; os elegíveis pelo recorte de idade; o participante incluído (recusa da participação em dobro), os
// contatos agendado e realizado, a avaliação de risco com as respostas e o grupo de risco atribuído; o elegível de um
// segundo programa pelo escore (com os critérios de CID, procedimento, internação, urgência e custo apurados das contas);
// a adesão e o direito à bonificação; o custo; a saída com motivo que cancela o agendado e mantém o histórico.
// SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import type { NucleoProprio } from '@sgh/nucleo';
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
    const termo = (await q('SELECT MIN(id) AS id FROM termo_terminologia'))[0]!['id'];
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
      { ...criterio, tipo: 'cid', termo: Number(termo), periodoMeses: 12 },
      { ...criterio, tipo: 'procedimento', termo: Number(termo), periodoMeses: 12 },
      { ...criterio, tipo: 'internacao', ocorrenciasMinimas: 2, periodoMeses: 12 },
      { ...criterio, tipo: 'pronto_socorro', ocorrenciasMinimas: 3, periodoMeses: 6 },
      { ...criterio, tipo: 'custo', custoPeriodoMinimo: 50000, periodoMeses: 12 },
    ])
      await porta!.incluirCriterio(c, progB.id, k, trilha('criterio'));
    expect(
      await codigoDe(porta!.incluirCriterio(c, progB.id, { ...criterio, tipo: 'cid' }, trilha('criterio'))),
    ).toBe('criterio-termo');
    const eleB = await porta!.elegiveis(c, progB.id);
    const tB = eleB.find((x) => x.beneficiario === titular);
    expect(tB?.motivos).toEqual(['escore 4']);
    expect(eleB.map((x) => x.beneficiario)).not.toContain(dependente);

    const bon = await porta!.bonificacao(c, progA.id);
    const bt = bon.find((x) => x.participante === part.id)!;
    expect(bt.adesao).toEqual({ realizados: 1, devidos: 1, percentual: 100 });
    expect(bt.bonificacoes[0]?.direito).toBe(true);
    const custo = await porta!.custo(c, progA.id, 12);
    expect(custo.participantes).toHaveLength(1);
    expect(custo.participantes[0]?.antes.total).toBe(0);

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
