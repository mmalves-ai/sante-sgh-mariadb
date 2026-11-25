// Contrato de efeito da declaração de saúde, da doença preexistente com a CPT e da portabilidade de carências
// (08-SGO L95, C2-113) contra o MariaDB real (cliente f22_o2). Massa SINTÉTICA pela carteira da F1 (titular e
// dependente) e um questionário de declaração de saúde sintético. Prova o que fica no banco: a declaração com as
// respostas e as doenças em análise (recusas da resposta "sim" sem detalhe e sem CID); a CPT nascida da decisão com o
// fim pela adesão e ligada nos dois lados, o agravo com percentual e a declaração analisada; o cancelamento da CPT com
// motivo (a linha fica); o pedido de portabilidade com número e prazo de 10 dias, a recusa por permanência e por pedido
// em aberto, a aprovação que aproveita as carências já geradas do titular e as geradas depois para o dependente; e a
// visão por beneficiário. SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { PortaBeneficiarioSaudePropria } from './beneficiario-saude-propria.js';
import { PortaCadastroComplementarPropria } from './cadastro-complementar-porta-propria.js';
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

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let porta: PortaBeneficiarioSaudePropria | null = null;
let complementar: PortaCadastroComplementarPropria | null = null;
let titular = 0;
let dependente = 0;
let questionario = 0;
let perguntas: number[] = [];
let cids: number[] = [];
const COD = 'C2113';

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.saude-beneficiario' },
    correlacao: 'teste-c2113',
  });

const q = (sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c2113' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  );

async function limpar(n: NucleoProprio, m: MassaBase) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2113' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const ben =
      'SELECT b.id FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id WHERE cp.estabelecimento_id IN (?, ?)';
    await e.executar(
      `UPDATE doenca_preexistente_declarada SET cobertura_parcial_temporaria_id = NULL WHERE beneficiario_plano_id IN (${ben})`,
      ests,
    );
    await e.executar(
      `DELETE FROM cobertura_parcial_temporaria WHERE beneficiario_plano_id IN (${ben})`,
      ests,
    );
    await e.executar(
      `DELETE FROM doenca_preexistente_declarada WHERE beneficiario_plano_id IN (${ben})`,
      ests,
    );
    await e.executar(
      'DELETE r FROM declaracao_saude_resposta r JOIN declaracao_saude d ON d.id = r.declaracao_saude_id WHERE d.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM declaracao_saude WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(`DELETE FROM carencia_aplicada WHERE beneficiario_plano_id IN (${ben})`, ests);
    await e.executar('DELETE FROM portabilidade_carencia WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      'DELETE p FROM modelo_questionario_saude_pergunta p JOIN modelo_questionario_saude m ON m.id = p.modelo_questionario_saude_id WHERE m.codigo LIKE ?',
      [`${COD}%`],
    );
    await e.executar('DELETE FROM modelo_questionario_saude WHERE codigo LIKE ?', [`${COD}%`]);
    await limparTrilhaDaMassa(e, { ids: ests });
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  const { servico } = servicoNoBanco(nucleo);
  const cart = await montarCarteira(servico, sessao(massa), { registro: '421131', base: '2113' });
  titular = (cart.titular as { id: number }).id;
  dependente = cart.dependente;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-c2113' }, async (e) => {
    await e.executar(
      `INSERT INTO modelo_questionario_saude (codigo, nome, finalidade, vigencia_inicio, criado_em)
       VALUES (?, 'Declaração de saúde sintética', 'declaracao_saude', '2020-01-01', CURRENT_TIMESTAMP(3))`,
      [`${COD}-DS`],
    );
  });
  questionario = Number(
    (await q('SELECT id FROM modelo_questionario_saude WHERE codigo = ?', [`${COD}-DS`]))[0]!['id'],
  );
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-c2113' }, async (e) => {
    for (const [s, t] of [
      [1, 'Tem doença do coração ou pressão alta?'],
      [2, 'Tem diabetes?'],
    ] as const)
      await e.executar(
        `INSERT INTO modelo_questionario_saude_pergunta (modelo_questionario_saude_id, sequencia, enunciado, tipo_resposta, obrigatoria, criado_em)
         VALUES (?, ?, ?, 'sim_nao', TRUE, CURRENT_TIMESTAMP(3))`,
        [questionario, s, t],
      );
  });
  perguntas = (
    await q(
      'SELECT id FROM modelo_questionario_saude_pergunta WHERE modelo_questionario_saude_id = ? ORDER BY sequencia',
      [questionario],
    )
  ).map((r) => Number(r['id']));
  cids = (
    await q(
      `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
        WHERE g.codigo = 'cid10' AND t.ativo = TRUE ORDER BY t.id LIMIT 2`,
    )
  ).map((r) => Number(r['id']));
  porta = new PortaBeneficiarioSaudePropria(nucleo, CLIENTE);
  complementar = new PortaCadastroComplementarPropria(nucleo, CLIENTE);
}, 120_000);

afterAll(async () => {
  if (!PODE || !nucleo || !massa) return;
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  await nucleo.encerrar();
});

const hojeIso = () => new Date().toISOString().slice(0, 10);
const declaracaoBase = () => ({
  questionario,
  preenchidaEm: hojeIso(),
  pesoKg: 82,
  alturaM: 1.75,
  entrevistaQualificada: false,
  medicoOrientador: null,
  dispensouOrientacao: true,
  respostas: [
    {
      pergunta: perguntas[0]!,
      afirmativa: true,
      texto: null,
      complemento: 'Pressão alta em tratamento (sintético)',
    },
    { pergunta: perguntas[1]!, afirmativa: true, texto: null, complemento: 'Diabetes (sintético)' },
  ],
  doencas: [
    { termo: cids[0]!, inicio: '2020-01-01', forma: 'declarada' },
    { termo: cids[1]!, inicio: '2021-06-01', forma: 'declarada' },
  ],
});
const decisao = { versao: 1, prazoMeses: null, percentualAgravo: null, observacao: null };

describe.skipIf(!PODE)('C2-113 declaração de saúde, CPT e portabilidade (banco próprio)', () => {
  it('declaração, decisão da doença preexistente com a CPT e o agravo, cancelamento da CPT', async () => {
    expect(cids).toHaveLength(2);
    const c = contexto(massa!);
    const d0 = declaracaoBase();
    // a busca do CID-10 da tela acha o termo pelo código
    const [{ codigo_termo: cod0 }] = (await q('SELECT codigo_termo FROM termo_terminologia WHERE id = ?', [
      cids[0],
    ])) as [{ codigo_termo: string }];
    expect((await porta!.cids(c, cod0)).map((t) => t.id)).toContain(cids[0]);
    expect(
      await codigoDe(
        porta!.registrarDeclaracao(
          c,
          titular,
          { ...d0, respostas: [{ ...d0.respostas[0]!, complemento: ' ' }, d0.respostas[1]!] },
          trilha('dec'),
        ),
      ),
    ).toBe('complemento-obrigatorio');
    expect(
      await codigoDe(porta!.registrarDeclaracao(c, titular, { ...d0, doencas: [] }, trilha('dec'))),
    ).toBe('doenca-nao-informada');
    const dec = await porta!.registrarDeclaracao(c, titular, d0, trilha('dec'));
    const [ds] = await q('SELECT situacao, beneficiario_plano_id AS b FROM declaracao_saude WHERE id = ?', [
      dec.id,
    ]);
    expect([ds!['situacao'], Number(ds!['b'])]).toEqual(['em_analise', titular]);
    expect(
      Number(
        (
          await q('SELECT COUNT(*) AS n FROM declaracao_saude_resposta WHERE declaracao_saude_id = ?', [
            dec.id,
          ])
        )[0]!['n'],
      ),
    ).toBe(2);
    const doencas = await q(
      'SELECT id, decisao_cobertura FROM doenca_preexistente_declarada WHERE declaracao_saude_id = ? ORDER BY sequencia',
      [dec.id],
    );
    expect(doencas.map((r) => r['decisao_cobertura'])).toEqual(['em_analise', 'em_analise']);
    const [d1, d2] = doencas.map((r) => Number(r['id'])) as [number, number];

    // CPT: prazo validado e a cobertura parcial nasce da decisão, ligada nos dois lados, com o fim pela adesão.
    expect(
      await codigoDe(
        porta!.decidirDoenca(
          c,
          d1,
          { ...decisao, decisao: 'cobertura_parcial_temporaria', prazoMeses: null },
          trilha('dlp'),
        ),
      ),
    ).toBe('prazo-invalido');
    const r1 = await porta!.decidirDoenca(
      c,
      d1,
      { ...decisao, decisao: 'cobertura_parcial_temporaria', prazoMeses: 24 },
      trilha('dlp'),
    );
    const [cpt] = await q(
      `SELECT c.id, c.inicio = b.data_adesao AS inicio_ok, c.fim_previsto = DATE_SUB(DATE_ADD(b.data_adesao, INTERVAL 24 MONTH), INTERVAL 1 DAY) AS fim_ok,
              c.situacao, c.doenca_preexistente_declarada_id AS d, c.prazo_meses, c.codigo_cid <> '' AS cid_ok
         FROM cobertura_parcial_temporaria c JOIN beneficiario_plano b ON b.id = c.beneficiario_plano_id WHERE c.id = ?`,
      [r1['cpt']],
    );
    expect([
      Number(cpt!['inicio_ok']),
      Number(cpt!['fim_ok']),
      cpt!['situacao'],
      Number(cpt!['d']),
      Number(cpt!['prazo_meses']),
      Number(cpt!['cid_ok']),
    ]).toEqual([1, 1, 'vigente', d1, 24, 1]);
    const [l1] = await q(
      'SELECT decisao_cobertura, cobertura_parcial_temporaria_id AS c FROM doenca_preexistente_declarada WHERE id = ?',
      [d1],
    );
    expect([l1!['decisao_cobertura'], Number(l1!['c'])]).toEqual([
      'cobertura_parcial_temporaria',
      Number(cpt!['id']),
    ]);
    expect(
      await codigoDe(
        porta!.decidirDoenca(c, d1, { ...decisao, versao: 2, decisao: 'sem_restricao' }, trilha('dlp')),
      ),
    ).toBe('ja-decidida');
    // Agravo na segunda doença: a declaração fica analisada (quem e quando).
    expect(
      await codigoDe(porta!.decidirDoenca(c, d2, { ...decisao, decisao: 'agravo' }, trilha('dlp'))),
    ).toBe('agravo-invalido');
    await porta!.decidirDoenca(
      c,
      d2,
      { ...decisao, decisao: 'agravo', percentualAgravo: 12.5 },
      trilha('dlp'),
    );
    const [l2] = await q(
      'SELECT decisao_cobertura, percentual_agravo FROM doenca_preexistente_declarada WHERE id = ?',
      [d2],
    );
    expect([l2!['decisao_cobertura'], Number(l2!['percentual_agravo'])]).toEqual(['agravo', 12.5]);
    const [ds2] = await q(
      'SELECT situacao, analisada_por_usuario_id AS u, analisada_em IS NOT NULL AS em FROM declaracao_saude WHERE id = ?',
      [dec.id],
    );
    expect([ds2!['situacao'], Number(ds2!['u']), Number(ds2!['em'])]).toEqual([
      'analisada',
      massa!.usuario,
      1,
    ]);

    // Cancelamento da CPT com motivo: a linha fica, com a data e o motivo; não cancela duas vezes.
    const cptId = Number(cpt!['id']);
    expect(
      await codigoDe(
        porta!.encerrarCpt(
          c,
          cptId,
          { versao: 1, situacao: 'cancelada', data: '2000-01-01', motivo: 'x' },
          trilha('cpt'),
        ),
      ),
    ).toBe('data-antes-do-inicio');
    await porta!.encerrarCpt(
      c,
      cptId,
      { versao: 1, situacao: 'cancelada', data: hojeIso(), motivo: 'Perícia afastou a doença' },
      trilha('cpt'),
    );
    const [cpt2] = await q(
      'SELECT situacao, encerrada_em IS NOT NULL AS e, observacao LIKE ? AS m, excluido_em IS NULL AS viva FROM cobertura_parcial_temporaria WHERE id = ?',
      ['%Perícia%', cptId],
    );
    expect([cpt2!['situacao'], Number(cpt2!['e']), Number(cpt2!['m']), Number(cpt2!['viva'])]).toEqual([
      'cancelada',
      1,
      1,
      1,
    ]);
    expect(
      await codigoDe(
        porta!.encerrarCpt(
          c,
          cptId,
          { versao: 2, situacao: 'encerrada', data: hojeIso(), motivo: 'y' },
          trilha('cpt'),
        ),
      ),
    ).toBe('cpt-nao-vigente');
    // Fora do estabelecimento: 404.
    expect(await codigoDe(porta!.painel(contexto(massa!, true), titular))).toBe('nao-encontrado');
  });

  it('portabilidade: pedido com prazo, requisitos, aproveitamento das carências geradas e das geradas depois', async () => {
    const c = contexto(massa!);
    const hoje = hojeIso();
    const vinculo = `${Number(hoje.slice(0, 4)) - 2}${hoje.slice(4, 8)}01`; // 24 meses completos, menos de 36
    const pedido = {
      direcao: 'recebida',
      modalidade: 'ordinaria',
      registroAnsOrigem: '999001',
      nomeOperadoraOrigem: 'Operadora de origem sintética',
      registroProdutoOrigem: null,
      vinculoInicio: vinculo,
      faixaPrecoCompativel: true,
      adimplente: true,
      solicitadoEm: hoje,
      observacao: null,
    };
    // Titular: carências geradas antes, sem aproveitamento.
    await complementar!.gerarCarencias(c, titular, 0, trilha('car'));
    const antes = await q(
      'SELECT COUNT(*) AS n, SUM(dias_aproveitados) AS a FROM carencia_aplicada WHERE beneficiario_plano_id = ?',
      [titular],
    );
    expect(Number(antes[0]!['n'])).toBeGreaterThan(0);
    expect(Number(antes[0]!['a'])).toBe(0);
    expect(
      await codigoDe(
        porta!.registrarPortabilidade(c, titular, { ...pedido, registroAnsOrigem: '12' }, trilha('port')),
      ),
    ).toBe('registro-ans-invalido');
    const p1 = await porta!.registrarPortabilidade(c, titular, pedido, trilha('port'));
    const [pl] = await q(
      'SELECT numero, situacao, DATEDIFF(prazo_resposta, DATE(solicitado_em)) AS prazo, produto_plano_id IS NOT NULL AS prod FROM portabilidade_carencia WHERE id = ?',
      [p1.id],
    );
    expect([
      String(pl!['numero']).length > 0,
      pl!['situacao'],
      Number(pl!['prazo']),
      Number(pl!['prod']),
    ]).toEqual([true, 'recebida', 10, 1]);
    expect(await codigoDe(porta!.registrarPortabilidade(c, titular, pedido, trilha('port')))).toBe(
      'portabilidade-em-aberto',
    );
    const passo = { motivoRecusa: null, cumpriuCptNaOrigem: false, jaPortouAntes: false };
    await porta!.decidirPortabilidade(
      c,
      p1.id,
      { ...passo, versao: 1, situacao: 'em_analise' },
      trilha('port'),
    );
    // Com CPT na origem a permanência mínima é de 36 meses: recusada a aprovação.
    expect(
      await codigoDe(
        porta!.decidirPortabilidade(
          c,
          p1.id,
          { ...passo, versao: 2, situacao: 'aprovada', cumpriuCptNaOrigem: true },
          trilha('port'),
        ),
      ),
    ).toBe('permanencia-insuficiente');
    const ap = await porta!.decidirPortabilidade(
      c,
      p1.id,
      { ...passo, versao: 2, situacao: 'aprovada' },
      trilha('port'),
    );
    expect(ap['aproveitadas']).toBe(Number(antes[0]!['n']));
    const [pa] = await q(
      'SELECT situacao, decidido_em IS NOT NULL AS d, analisado_por_usuario_id AS u, permanencia_meses AS m FROM portabilidade_carencia WHERE id = ?',
      [p1.id],
    );
    expect([pa!['situacao'], Number(pa!['d']), Number(pa!['u'])]).toEqual(['aprovada', 1, massa!.usuario]);
    expect(Number(pa!['m'])).toBeGreaterThanOrEqual(24);
    const depois = await q(
      `SELECT SUM(dias_aproveitados = dias_carencia) AS todas, SUM(cumprida_em = inicio_contagem) AS liberadas,
              SUM(portabilidade_carencia_id = ?) AS ligadas, COUNT(*) AS n FROM carencia_aplicada WHERE beneficiario_plano_id = ?`,
      [p1.id, titular],
    );
    const n = Number(depois[0]!['n']);
    expect([
      Number(depois[0]!['todas']),
      Number(depois[0]!['liberadas']),
      Number(depois[0]!['ligadas']),
    ]).toEqual([n, n, n]);

    // Dependente: portabilidade aprovada antes; as carências geradas depois já nascem aproveitadas e ligadas.
    const p2 = await porta!.registrarPortabilidade(
      c,
      dependente,
      { ...pedido, modalidade: 'extraordinaria', vinculoInicio: null },
      trilha('port'),
    );
    await porta!.decidirPortabilidade(
      c,
      p2.id,
      { ...passo, versao: 1, situacao: 'aprovada' },
      trilha('port'),
    );
    await complementar!.gerarCarencias(c, dependente, 0, trilha('car'));
    const dep = await q(
      `SELECT COUNT(*) AS n, SUM(dias_aproveitados = dias_carencia) AS todas, SUM(portabilidade_carencia_id = ?) AS ligadas
         FROM carencia_aplicada WHERE beneficiario_plano_id = ?`,
      [p2.id, dependente],
    );
    expect(Number(dep[0]!['n'])).toBeGreaterThan(0);
    expect([Number(dep[0]!['todas']), Number(dep[0]!['ligadas'])]).toEqual([
      Number(dep[0]!['n']),
      Number(dep[0]!['n']),
    ]);
    const [bp] = await q('SELECT dias_aproveitamento_carencia AS d FROM beneficiario_plano WHERE id = ?', [
      dependente,
    ]);
    expect(Number(bp!['d'])).toBeGreaterThan(0);
    // Recusa sem motivo e passo de decidida: recusados.
    const p3 = await porta!.registrarPortabilidade(
      c,
      titular,
      { ...pedido, direcao: 'concedida' },
      trilha('port'),
    );
    expect(
      await codigoDe(
        porta!.decidirPortabilidade(c, p3.id, { ...passo, versao: 1, situacao: 'recusada' }, trilha('port')),
      ),
    ).toBe('motivo-obrigatorio');
    await porta!.decidirPortabilidade(
      c,
      p3.id,
      { ...passo, versao: 1, situacao: 'recusada', motivoRecusa: 'Pedido do beneficiário retirado' },
      trilha('port'),
    );
    expect(
      await codigoDe(
        porta!.decidirPortabilidade(c, p3.id, { ...passo, versao: 2, situacao: 'aprovada' }, trilha('port')),
      ),
    ).toBe('passo-invalido');

    // Visão por beneficiário e trilha na mesma transação.
    const painel = await porta!.painel(c, titular);
    expect(painel.declaracoes).toHaveLength(1);
    expect(painel.declaracoes[0]!.respostasSim).toBe(2);
    expect(painel.doencas.map((d) => d.decisao)).toEqual(['cobertura_parcial_temporaria', 'agravo']);
    expect(painel.cpts.map((x) => x.situacao)).toEqual(['cancelada']);
    expect(painel.portabilidades.map((x) => x.situacao).sort()).toEqual(['aprovada', 'recusada']);
    expect(painel.carencias.every((x) => x.cumprida && x.portabilidade === p1.id)).toBe(true);
    const ops = await q(
      `SELECT entidade, COUNT(*) AS n FROM trilha_auditoria
        WHERE estabelecimento_id = ? AND entidade IN ('declaracao_saude', 'doenca_preexistente_declarada',
              'cobertura_parcial_temporaria', 'portabilidade_carencia') GROUP BY entidade ORDER BY entidade`,
      [massa!.est],
    );
    // declaração 1; doenças 2 decisões; CPT 1 cancelamento; portabilidade 3 pedidos + 4 passos.
    expect(ops.map((r) => [r['entidade'], Number(r['n'])])).toEqual([
      ['cobertura_parcial_temporaria', 1],
      ['declaracao_saude', 1],
      ['doenca_preexistente_declarada', 2],
      ['portabilidade_carencia', 7],
    ]);
  });
});
