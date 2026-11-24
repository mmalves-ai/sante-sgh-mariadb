// F3.0 (motores, conta-admissao) contra o MariaDB real, cliente f22_o3, massa SINTÉTICA (massa-adt.spec-util.ts, marca C).
// Contrato de efeito: internar abre a conta na mesma transação (fonte pagadora, tabela vigente, tipo de conta da
// natureza, acomodação, competência, número do atendimento, vínculo atendimento_conta) e lança a diária do dia uma vez,
// com a memória do preço e o controle do lançamento automático, mais as taxas (por diária e de abertura; a regra com
// exceção "nao_aplicar" no estabelecimento não entra); a apuração repetida não lança de novo; a rotina diária, sem evento
// do ADT, lança uma diária por dia de corte da permanência; a alta fecha a contagem (diária depois da alta estornada com
// o motivo "alta", sempre exercitada: a alta é recuada para antes da virada de ontem); cancelar a alta devolve as
// diárias; excluir a internação estorna tudo (inclusive a taxa de abertura) com o motivo "cancelamento" e cancela a
// conta; a troca de acomodação estorna a diária do dia ("troca_acomodacao") e lança a da nova; internar sem tipo de
// conta da natureza não é barrado (a pendência volta) e a rotina diária abre a conta depois. SGH_NUCLEO_SEM_BANCO=1 pula.
import { dataHoraParaInstante, FUSO_PADRAO, instanteParaDataHora } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apurarLancamentosAutomaticos, apurarLancamentosDoDia } from '../faturamento/conta-entrada.js';
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
  const cfg = { item: 0, itemUti: 0, taxaItem: 0, tabela: 0, regraLancamento: 0, regraAbertura: 0, regraExcecao: 0, riExcecao: 0, categoria: 0, uti: 0 };
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
  const rotina = async () =>
    (await M().nucleo.criarExecutor().executar(apurarLancamentosDoDia, CLIENTE_ADT, {}, operacaoAdt(M())))
      .resultado as Record<string, unknown>;
  const leito = (l: string) => ({ bloco: 'B1', acomodacao: 'Q1', leito: l });
  const internar = (paciente: number, l: string) =>
    executar('internacao.internar', {
      paciente,
      leito: leito(l),
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
  const versaoDe = async (internacao: number) =>
    carimboVersao(
      (await lerAdt<{ versao: number }>(M(), 'SELECT versao FROM internacao WHERE id = ?', [internacao]))?.versao,
    );
  const estornos = (conta: number, motivo: string) =>
    num(
      "SELECT COUNT(*) AS n FROM lancamento_automatico_conta l JOIN conta_hospitalar_item i ON i.id = l.conta_hospitalar_item_id WHERE l.conta_hospitalar_id = ? AND l.motivo_estorno = ? AND i.situacao = 'estornado'",
      [conta, motivo],
    );
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
        // A segunda acomodação (UTI sintética) e a sua diária, para a troca de acomodação.
        const uti = await id(
          'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
          [`${P}-UTI`],
          "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'enfermaria', ?)",
          [`${P}-UTI`, `UTI ${P}`, agora],
        );
        const itemUti = await itemDe(`${P}-DIU`, 'diaria');
        await e.inserir(
          "INSERT INTO regra_diaria (estabelecimento_id, categoria_acomodacao_id, item_faturavel_id, quantidade, hora_virada, vigencia_inicio, ativo, criado_em) VALUES (?, ?, ?, 1, '12:00:00', '2020-01-01', TRUE, ?)",
          [M().est, uti, itemUti, agora],
        );
        // Taxa de abertura (vale para a internação) e outra com exceção "nao_aplicar" no estabelecimento da massa.
        const regraDe = async (codigo: string, gatilho: string) => {
          const r = await id(
            'SELECT id FROM regra_lancamento WHERE codigo = ?',
            [codigo],
            "INSERT INTO regra_lancamento (codigo, descricao, gatilho, acao, vigencia_inicio, ativo, criado_em) VALUES (?, 'TAXA SINTETICA', ?, 'incluir', '2020-01-01', TRUE, ?)",
            [codigo, gatilho, agora],
          );
          await e.executar('UPDATE regra_lancamento SET ativo = TRUE WHERE id = ?', [r]);
          const ri = await id(
            'SELECT id FROM regra_lancamento_item WHERE regra_lancamento_id = ? AND sequencia = 1',
            [r],
            'INSERT INTO regra_lancamento_item (regra_lancamento_id, sequencia, item_faturavel_id, quantidade, aplica_internacao, aplica_ambulatorial, aplica_externo, aplica_urgencia, aplica_domiciliar, criado_em) VALUES (?, 1, ?, 1, TRUE, FALSE, FALSE, FALSE, FALSE, ?)',
            [r, taxaItem, agora],
          );
          return { r, ri };
        };
        const regraAbertura = (await regraDe(`${P}-TXA`, 'abertura_atendimento')).r;
        const excecao = await regraDe(`${P}-TXX`, 'abertura_atendimento');
        await id(
          'SELECT id FROM regra_lancamento_excecao WHERE regra_lancamento_id = ? AND estabelecimento_id = ?',
          [excecao.r, M().est],
          "INSERT INTO regra_lancamento_excecao (estabelecimento_id, regra_lancamento_id, efeito, criado_em) VALUES (?, ?, 'nao_aplicar', ?)",
          [M().est, excecao.r, agora],
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
        return {
          item,
          itemUti,
          taxaItem,
          tabela,
          regraLancamento,
          regraAbertura,
          regraExcecao: excecao.r,
          riExcecao: excecao.ri,
          categoria,
          uti,
        };
      }),
    );
  }, 90_000);

  afterAll(async () => {
    if (m && cfg.regraLancamento)
      await escrever(async (e) => {
        await e.executar('UPDATE regra_lancamento SET ativo = FALSE WHERE id IN (?, ?, ?)', [
          cfg.regraLancamento,
          cfg.regraAbertura,
          cfg.regraExcecao,
        ]);
        await e.executar('DELETE FROM regra_lancamento_excecao WHERE estabelecimento_id = ?', [M().est]);
      }).catch(() => undefined);
    await encerrarMassaAdt(m);
  });

  it('internar → conta, vínculo e taxas; rotina diária sem evento; alta fecha; cancelar a alta devolve; excluir cancela', async () => {
    const r = await internar(M().pacientes[0]!, '01');
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
    // O vínculo do atendimento com a conta (por ele a recepção e o prontuário acham a conta).
    expect(
      await num(
        'SELECT COUNT(*) AS n FROM atendimento_conta ac JOIN internacao i ON i.atendimento_id = ac.atendimento_id WHERE i.id = ? AND ac.conta_hospitalar_id = ? AND ac.excluido_em IS NULL',
        [internacao, conta],
      ),
    ).toBe(1);
    expect(Number(c?.['valor_total'])).toBe(PRECO_DIARIA);
    expect(await vigentes(conta, 'diaria')).toBe(1);
    // A taxa por diária e a de abertura; a regra com exceção "nao_aplicar" no estabelecimento não entra.
    expect(await vigentes(conta, 'taxa:')).toBe(2);
    expect(await vigentes(conta, `taxa:${cfg.riExcecao}`)).toBe(0);
    expect(
      await lerAdt(
        M(),
        `SELECT i.valor_unitario AS unitario, i.situacao, i.tipo_valorizacao AS valorizacao, i.grupo_faturamento_id IS NOT NULL AS com_grupo,
                JSON_VALUE(m.dados, '$.origemPreco') AS origem, m.tabela_preco_id AS tabela
           FROM lancamento_automatico_conta l JOIN conta_hospitalar_item i ON i.id = l.conta_hospitalar_item_id
           JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
          WHERE l.conta_hospitalar_id = ? AND l.chave = 'diaria'`,
        [conta],
      ),
    ).toMatchObject({ situacao: 'lancado', origem: 'tabela', tabela: cfg.tabela, valorizacao: 'tabela', com_grupo: 1 });
    // Sem preço: valor zero, valorização atribuída (não "tabela"), a memória diz por quê; o grupo vem do catálogo.
    expect(
      await num(
        `SELECT COUNT(*) AS n FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id
          WHERE i.conta_hospitalar_id = ? AND JSON_VALUE(m.dados, '$.origemPreco') = 'sem_preco_vigente' AND i.valor_total = 0
            AND i.tipo_valorizacao = 'manual' AND i.grupo_faturamento_id IS NOT NULL`,
        [conta],
      ),
    ).toBe(2);

    expect(await apurar(conta)).toMatchObject({ lancados: 0, estornados: 0, apurada: true });
    expect(await vigentes(conta, 'diaria')).toBe(1);

    // Permanência desde quatro dias antes, às 08:00 (massa sintética: a entrada recua no banco). A rotina diária, sem
    // nenhum evento do ADT, lança uma diária por dia de corte (D-4 a D-1, mais hoje depois da virada).
    const agoraLocal = instanteParaDataHora(new Date().toISOString(), FUSO_PADRAO);
    const depoisDaVirada = agoraLocal.hora >= '12:00' ? 1 : 0;
    const dia = (k: number) => new Date(Date.parse(`${agoraLocal.data}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);
    const t = new Date(dataHoraParaInstante(dia(4), '08:00', FUSO_PADRAO));
    await escrever(async (e) => {
      await e.executar('UPDATE internacao SET data_hora_entrada = ? WHERE id = ?', [t, internacao]);
      await e.executar('UPDATE ocupacao_leito SET data_hora_inicio = ? WHERE internacao_id = ?', [t, internacao]);
      await e.executar('UPDATE conta_hospitalar SET inicio_em = ? WHERE id = ?', [t, conta]);
    });
    const r2 = await rotina();
    expect(Number(r2['lancados'])).toBeGreaterThan(0);
    const diarias = 4 + depoisDaVirada;
    expect(await vigentes(conta, 'diaria')).toBe(diarias);
    expect(
      await num(
        "SELECT COUNT(*) - COUNT(DISTINCT dia_referencia) AS n FROM lancamento_automatico_conta WHERE conta_hospitalar_id = ? AND situacao = 'lancado' AND chave = 'diaria'",
        [conta],
      ),
    ).toBe(0);
    expect(await vigentes(conta, 'taxa:')).toBe(2);
    expect(await apurar(conta)).toMatchObject({ lancados: 0, estornados: 0 });

    // Alta (hoje às 00:01) recuada para ontem às 11:00, antes da virada: a diária de ontem (e a de hoje, se houver)
    // deixa de ser devida e é estornada com o motivo "alta"; ficam três diárias.
    await executar('internacao.darAlta', {
      internacao,
      motivo: M().motivoSaida,
      medicoAlta: M().medico,
      versao: await versaoDe(internacao),
      horaSaida: '00:01',
    });
    await escrever((e) =>
      e.executar('UPDATE internacao SET data_hora_alta = ? WHERE id = ?', [
        new Date(dataHoraParaInstante(dia(1), '11:00', FUSO_PADRAO)),
        internacao,
      ]),
    );
    expect(Number((await apurar(conta))['estornados'])).toBe(1);
    expect(await vigentes(conta, 'diaria')).toBe(3);
    expect(await estornos(conta, 'alta')).toBe(diarias - 3);
    expect(await apurar(conta)).toMatchObject({ lancados: 0, estornados: 0 });
    expect(
      Number((await lerAdt<{ v: number }>(M(), 'SELECT valor_total AS v FROM conta_hospitalar WHERE id = ?', [conta]))?.v),
    ).toBe(3 * PRECO_DIARIA);

    // Cancelar a alta: a contagem reabre e as diárias voltam (lançamentos novos; os estornados ficam na história).
    await executar('internacao.cancelarAlta', {
      internacao,
      justificativa: 'Alta dada no paciente errado',
      motivoCancelamento: M().motivoCancelamentoAlta,
    });
    expect(await vigentes(conta, 'diaria')).toBe(diarias);

    // Excluir a internação: nada é devido (nem a taxa de abertura); tudo estornado com "cancelamento"; conta cancelada.
    const antes = (await vigentes(conta, 'diaria')) + (await vigentes(conta, 'taxa:'));
    await executar('internacao.excluirInternacao', {
      internacao,
      motivo: M().motivoExclusao,
      justificativa: 'Internação aberta por engano',
      confirmaApagarConta: true,
      confirmaApagarPeriodos: true,
    });
    expect(await vigentes(conta, '')).toBe(0);
    expect(await estornos(conta, 'cancelamento')).toBe(antes);
    expect(
      await lerAdt(
        M(),
        `SELECT c.situacao, c.valor_total + 0 AS total, mc.codigo FROM conta_hospitalar c
           JOIN motivo_cancelamento_conta mc ON mc.id = c.motivo_cancelamento_conta_id WHERE c.id = ?`,
        [conta],
      ),
    ).toMatchObject({ situacao: 'cancelada', total: 0, codigo: 'ENTRADA_EXCLUIDA' });
  });

  it('transferir mantém a diária do dia; a troca de acomodação estorna ("troca_acomodacao") e lança a da nova', async () => {
    const r = await internar(M().pacientes[1]!, '02');
    const internacao = Number(r['internacao']);
    const conta = Number(r['conta']);
    await executar('internacao.transferirLeito', {
      internacao,
      destino: leito('03'),
      versao: await versaoDe(internacao),
      motivoTroca: M().motivoTroca,
    });
    expect(await vigentes(conta, 'diaria')).toBe(1);
    expect(await estornos(conta, 'troca_acomodacao')).toBe(0);
    // A acomodação ocupada na entrada passa a ser a UTI (massa sintética): a diária do dia troca de item.
    await escrever((e) =>
      e.executar(
        'UPDATE ocupacao_leito SET categoria_acomodacao_id = ? WHERE internacao_id = ? ORDER BY data_hora_inicio, id LIMIT 1',
        [cfg.uti, internacao],
      ),
    );
    expect(await apurar(conta)).toMatchObject({ lancados: 1, estornados: 1 });
    expect(await estornos(conta, 'troca_acomodacao')).toBe(1);
    expect(
      await num(
        "SELECT COUNT(*) AS n FROM lancamento_automatico_conta l JOIN conta_hospitalar_item i ON i.id = l.conta_hospitalar_item_id WHERE l.conta_hospitalar_id = ? AND l.situacao = 'lancado' AND l.chave = 'diaria' AND i.item_faturavel_id = ? AND l.categoria_acomodacao_id = ?",
        [conta, cfg.itemUti, cfg.uti],
      ),
    ).toBe(1);
  });

  it('sem tipo de conta da natureza a internação acontece (pendência no resultado); a rotina diária abre a conta depois', async () => {
    const desligados = await lerAdt<{ ids: string | null }>(
      M(),
      "SELECT GROUP_CONCAT(id) AS ids FROM tipo_conta WHERE natureza = 'internacao' AND ativo = TRUE",
      [],
    );
    const ids = String(desligados?.ids ?? '').split(',').filter(Boolean).map(Number);
    expect(ids.length).toBeGreaterThan(0);
    const religar = () =>
      escrever((e) => e.executar(`UPDATE tipo_conta SET ativo = TRUE WHERE id IN (${ids.map(() => '?').join(',')})`, ids));
    let internacao: number;
    try {
      await escrever((e) => e.executar(`UPDATE tipo_conta SET ativo = FALSE WHERE id IN (${ids.map(() => '?').join(',')})`, ids));
      const r = await internar(M().pacientes[2]!, '02');
      internacao = Number(r['internacao']);
      expect(internacao).toBeGreaterThan(0);
      expect(r['conta']).toBeUndefined();
      expect(r['alertaConta']).toBe('tipo-conta-inexistente');
    } finally {
      await religar();
    }
    expect(
      await num(
        'SELECT COUNT(*) AS n FROM conta_hospitalar c JOIN internacao i ON i.atendimento_id = c.atendimento_id WHERE i.id = ?',
        [internacao],
      ),
    ).toBe(0);
    expect(Number((await rotina())['abertas'])).toBeGreaterThanOrEqual(1);
    expect(
      await num(
        `SELECT COUNT(*) AS n FROM conta_hospitalar c JOIN internacao i ON i.atendimento_id = c.atendimento_id
           JOIN lancamento_automatico_conta l ON l.conta_hospitalar_id = c.id AND l.chave = 'diaria' AND l.situacao = 'lancado'
          WHERE i.id = ? AND c.situacao = 'aberta'`,
        [internacao],
      ),
    ).toBe(1);
  });
});
