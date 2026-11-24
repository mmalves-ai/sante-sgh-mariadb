// F3.0 (motores, conta-admissao) contra o MariaDB real, cliente f22_o3, massa SINTÉTICA (massa-adt.spec-util.ts, marca C).
// Contrato de efeito: internar abre a conta na mesma transação (fonte pagadora, tabela vigente, tipo de conta da
// natureza, acomodação, competência, número do atendimento) e lança a diária do dia uma vez, com a memória do preço e o
// controle do lançamento automático; a apuração repetida não lança de novo; a permanência de dias anteriores gera uma
// diária por dia de corte; a alta fecha a contagem (a diária do dia depois da alta é estornada com o motivo "alta") e a
// apuração depois da alta não muda nada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { dataHoraParaInstante, FUSO_PADRAO, instanteParaDataHora } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apurarLancamentosAutomaticos } from '../faturamento/conta-entrada.js';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
  SEM_BANCO_ADT,
} from './massa-adt.spec-util.js';
import { carimboVersao } from './operacoes.js';
import { PortaAdtPropria } from './porta-propria.js';

const P = 'L0301C';
const PRECO_DIARIA = 150;

describe.skipIf(SEM_BANCO_ADT)(`conta na entrada e diárias automáticas (MariaDB, cliente ${CLIENTE_ADT})`, () => {
  let m: MassaAdt | null = null;
  let porta: PortaAdtPropria;
  const M = () => m!;
  const cfg = { item: 0, taxaItem: 0, tabela: 0, regraLancamento: 0, categoria: 0 };
  const num = async (sql: string, p: unknown[]) =>
    Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
  const escrever = <T>(fn: Parameters<MassaAdt['nucleo']['escrever']>[1]) =>
    M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-0301c-preparo' }, fn) as Promise<T>;
  const executar = (op: string, entrada: unknown) =>
    porta
      .executar(contextoAdt(M()), op, entrada, { ...operacaoAdt(M()), reautenticadoEm: Date.now() })
      .then((r) => r.resultado as Record<string, unknown>);
  const apurar = async (conta: number) =>
    (await M().nucleo.criarExecutor().executar(apurarLancamentosAutomaticos, CLIENTE_ADT, { conta }, operacaoAdt(M())))
      .resultado as Record<string, unknown>;
  const vigentes = (conta: number, prefixo: string) =>
    num(
      "SELECT COUNT(*) AS n FROM lancamento_automatico_conta WHERE conta_hospitalar_id = ? AND situacao = 'lancado' AND chave LIKE ?",
      [conta, `${prefixo}%`],
    );

  beforeAll(async () => {
    m = await prepararMassaAdt('C');
    porta = new PortaAdtPropria(M().nucleo);
    Object.assign(
      cfg,
      await escrever(async (e) => {
        const agora = new Date();
        const id = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        const grupo = Number((await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM grupo_faturamento', []))?.id);
        const categoria = Number(
          (await e.uma<{ id: number }>('SELECT id FROM categoria_acomodacao WHERE codigo = ?', [`${P}-ENF`]))?.id,
        );
        const itemDe = (codigo: string, tipo: string) =>
          id(
            'SELECT id FROM item_faturavel WHERE codigo = ?',
            [codigo],
            "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, situacao, criado_em) VALUES (?, ?, ?, ?, 'ativo', ?)",
            [codigo, `ITEM SINTETICO ${codigo}`, tipo, grupo, agora],
          );
        const item = await itemDe(`${P}-DIA`, 'diaria');
        const taxaItem = await itemDe(`${P}-TXS`, 'taxa');
        const tabela = await id(
          'SELECT id FROM tabela_preco WHERE codigo = ?',
          [`${P}-TAB`],
          "INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, fonte_pagadora_id, situacao, criado_em) VALUES (?, ?, 'TABELA SINTETICA', 'diaria_taxa', 'propria', ?, 'ativa', ?)",
          [M().est, `${P}-TAB`, M().convenio, agora],
        );
        const preco = await id(
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [tabela, item],
          "INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em) VALUES (?, 1, ?, 'valor', ?)",
          [tabela, item, agora],
        );
        await id(
          'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
          [preco],
          "INSERT INTO preco_procedimento_valor (preco_procedimento_id, vigencia_inicio, valor_total, ocorrido_em, criado_em) VALUES (?, '2020-01-01', ?, ?, ?)",
          [preco, PRECO_DIARIA, agora, agora],
        );
        await e.inserir(
          "INSERT INTO regra_diaria (estabelecimento_id, categoria_acomodacao_id, item_faturavel_id, quantidade, hora_virada, vigencia_inicio, ativo, criado_em) VALUES (?, ?, ?, 1, '12:00:00', '2020-01-01', TRUE, ?)",
          [M().est, categoria, item, agora],
        );
        // A taxa de sala da admissão: uma vez por conta, junto da primeira diária (regra de lançamento da rede, ligada
        // só durante o teste e desligada no fim; o controle a referencia, por isso não é apagada).
        const regraLancamento = await id(
          'SELECT id FROM regra_lancamento WHERE codigo = ?',
          [`${P}-TXS`],
          "INSERT INTO regra_lancamento (codigo, descricao, gatilho, acao, lanca_uma_vez_por_conta, vigencia_inicio, ativo, criado_em) VALUES (?, 'TAXA SINTETICA', 'diaria_internacao', 'incluir', TRUE, '2020-01-01', TRUE, ?)",
          [`${P}-TXS`, agora],
        );
        await e.executar('UPDATE regra_lancamento SET ativo = TRUE WHERE id = ?', [regraLancamento]);
        await id(
          'SELECT id FROM regra_lancamento_item WHERE regra_lancamento_id = ? AND sequencia = 1',
          [regraLancamento],
          'INSERT INTO regra_lancamento_item (regra_lancamento_id, sequencia, item_faturavel_id, quantidade, aplica_internacao, aplica_ambulatorial, aplica_externo, aplica_urgencia, aplica_domiciliar, criado_em) VALUES (?, 1, ?, 1, TRUE, FALSE, FALSE, FALSE, FALSE, ?)',
          [regraLancamento, taxaItem, agora],
        );
        return { item, taxaItem, tabela, regraLancamento, categoria };
      }),
    );
  }, 90_000);

  afterAll(async () => {
    if (m && cfg.regraLancamento)
      await escrever((e) => e.executar('UPDATE regra_lancamento SET ativo = FALSE WHERE id = ?', [cfg.regraLancamento])).catch(
        () => undefined,
      );
    await encerrarMassaAdt(m);
  });

  it('internar → conta aberta → diária do dia lançada uma vez; dias anteriores por dia de corte; a alta fecha a contagem', async () => {
    const r = await executar('internacao.internar', {
      paciente: M().pacientes[0]!,
      leito: { bloco: 'B1', acomodacao: 'Q1', leito: '01' },
      convenio: M().convenio,
      acomodacaoPlano: 'ENFERMARIA',
      carater: 'urgencia',
      clinica: 'M',
      especialidade: M().especialidade,
      medicoAssistente: M().medico,
      medicoSolicitante: M().medico,
      cidPrincipal: M().cid,
      procedimento: M().procedimento,
      procedimentoOrigem: 'sigtap',
      centroCusto: 1,
      unidade: 1,
      origem: 'ambulatorio',
      caraterAdmissao: M().carater,
      caraterTiss: M().caraterTiss,
      categoriaAtendimento: M().categoria,
      modalidade: M().modalidade,
    });
    const internacao = Number(r['internacao']);
    const conta = Number(r['conta']);
    expect(conta).toBeGreaterThan(0);
    const c = await lerAdt(
      M(),
      `SELECT c.situacao, c.natureza, c.fonte_pagadora_id AS fonte, c.tabela_preco_id AS tabela, tc.natureza AS tipo,
              c.categoria_acomodacao_id AS categoria, c.numero = CONCAT(a.numero, '-1') AS numero_ok,
              DAYOFMONTH(c.competencia) AS dia_competencia, c.estabelecimento_id AS est, c.valor_total
         FROM conta_hospitalar c JOIN tipo_conta tc ON tc.id = c.tipo_conta_id JOIN atendimento a ON a.id = c.atendimento_id
         JOIN internacao i ON i.atendimento_id = a.id WHERE c.id = ? AND i.id = ?`,
      [conta, internacao],
    );
    expect(c).toMatchObject({
      situacao: 'aberta',
      natureza: 'internacao',
      fonte: M().convenio,
      tabela: cfg.tabela,
      tipo: 'internacao',
      categoria: cfg.categoria,
      numero_ok: 1,
      dia_competencia: 1,
      est: M().est,
    });
    expect(Number(c?.['valor_total'])).toBe(PRECO_DIARIA);
    expect(await vigentes(conta, 'diaria')).toBe(1);
    expect(await vigentes(conta, 'taxa:')).toBe(1);
    // A diária com o preço da tabela e a memória; a taxa sem preço na tabela entra com zero e a memória diz por quê.
    expect(
      await lerAdt(
        M(),
        `SELECT i.valor_unitario AS unitario, i.situacao, JSON_VALUE(m.dados, '$.origemPreco') AS origem, m.tabela_preco_id AS tabela
           FROM lancamento_automatico_conta l JOIN conta_hospitalar_item i ON i.id = l.conta_hospitalar_item_id
           JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
          WHERE l.conta_hospitalar_id = ? AND l.chave = 'diaria'`,
        [conta],
      ),
    ).toMatchObject({ situacao: 'lancado', origem: 'tabela', tabela: cfg.tabela });
    expect(
      await num(
        `SELECT COUNT(*) AS n FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id
          WHERE i.conta_hospitalar_id = ? AND JSON_VALUE(m.dados, '$.origemPreco') = 'sem_preco_vigente' AND i.valor_total = 0`,
        [conta],
      ),
    ).toBe(1);

    // Idempotente: a mesma apuração não lança de novo.
    expect(await apurar(conta)).toMatchObject({ lancados: 0, estornados: 0, apurada: true });
    expect(await vigentes(conta, 'diaria')).toBe(1);

    // Permanência desde três dias antes, às 08:00 (massa sintética: a entrada recua no banco).
    const horaAgora = instanteParaDataHora(new Date().toISOString(), FUSO_PADRAO).hora;
    const depoisDaVirada = horaAgora >= '12:00' ? 1 : 0;
    const hoje = instanteParaDataHora(new Date().toISOString(), FUSO_PADRAO).data;
    const tresAntes = new Date(Date.parse(`${hoje}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
    const t = new Date(dataHoraParaInstante(tresAntes, '08:00', FUSO_PADRAO));
    await escrever(async (e) => {
      await e.executar('UPDATE internacao SET data_hora_entrada = ? WHERE id = ?', [t, internacao]);
      await e.executar('UPDATE ocupacao_leito SET data_hora_inicio = ? WHERE internacao_id = ?', [t, internacao]);
      await e.executar('UPDATE conta_hospitalar SET inicio_em = ? WHERE id = ?', [t, conta]);
    });
    const r2 = await apurar(conta);
    expect(Number(r2['lancados'])).toBeGreaterThan(0);
    expect(await vigentes(conta, 'diaria')).toBe(3 + depoisDaVirada);
    expect(
      await num(
        "SELECT COUNT(*) - COUNT(DISTINCT dia_referencia) AS n FROM lancamento_automatico_conta WHERE conta_hospitalar_id = ? AND situacao = 'lancado' AND chave = 'diaria'",
        [conta],
      ),
    ).toBe(0);
    expect(await vigentes(conta, 'taxa:')).toBe(1);
    expect(await apurar(conta)).toMatchObject({ lancados: 0, estornados: 0 });

    // Alta hoje às 00:01: o dia de hoje não é devido (virada às 12:00); a contagem para em três diárias.
    const versao = carimboVersao(
      (await lerAdt<{ versao: number }>(M(), 'SELECT versao FROM internacao WHERE id = ?', [internacao]))?.versao,
    );
    await executar('internacao.darAlta', {
      internacao,
      motivo: M().motivoSaida,
      medicoAlta: M().medico,
      versao,
      horaSaida: '00:01',
    });
    expect(await vigentes(conta, 'diaria')).toBe(3);
    expect(
      await num(
        "SELECT COUNT(*) AS n FROM lancamento_automatico_conta l JOIN conta_hospitalar_item i ON i.id = l.conta_hospitalar_item_id WHERE l.conta_hospitalar_id = ? AND l.motivo_estorno = 'alta' AND i.situacao = 'estornado'",
        [conta],
      ),
    ).toBe(depoisDaVirada);
    expect(await apurar(conta)).toMatchObject({ lancados: 0, estornados: 0 });
    // O total da conta é a soma dos itens vigentes (3 diárias com preço e a taxa sem preço).
    expect(
      Number((await lerAdt<{ v: number }>(M(), 'SELECT valor_total AS v FROM conta_hospitalar WHERE id = ?', [conta]))?.v),
    ).toBe(3 * PRECO_DIARIA);
  });
});
