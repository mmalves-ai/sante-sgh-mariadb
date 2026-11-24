// Integração das leituras próprias do cálculo da folha (folha-porta-propria-calculo.ts) contra o MariaDB real (cliente de
// teste da onda 3, SGH_CLIENTE_TESTE), com a migração 15_RH/93_folha_calculo: processamentos, linhas, resumo, histórico,
// itens por rubrica, férias (com o recibo), rescisões e parâmetros das obrigações; o estabelecimento da sessão isola.
// Massa SINTÉTICA (massa.spec-util e as linhas abaixo); os catálogos sintéticos ficam (configuração), o resto é apagado
// no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_O3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../avaliacao/massa.spec-util.js';
import {
  exigirFeriasAlteravel,
  exigirRescisaoAlteravel,
  LeiturasCalculoFolhaPropria,
} from './folha-porta-propria-calculo.js';

const T = 'F24LSINT';
/** Parâmetros das obrigações válidos pelo esquema do contrato (sem empresa e início, que são colunas). */
const dadosObrigacoes = (razaoSocial: string, codigoPagamentoGps: string) => ({
  razaoSocial,
  endereco: {
    logradouro: 'Rua Um',
    bairro: 'Centro',
    cep: '01001000',
    cidade: 'Cidade',
    uf: 'SP',
    municipio: '3550308',
  },
  contato: { nome: 'Contato', telefone: '1130000000', email: 'contato@exemplo.test' },
  naturezaJuridica: '3999',
  codigoRecolhimentoSefip: '115',
  codigoPagamentoGps,
  regimes: {
    'fgts-digital': { exigidaDe: '2024-03', exigidaAte: null, leiaute: '1.0', leiauteConferido: true },
    sefip: { exigidaDe: null, exigidaAte: '2024-02', leiaute: '8.4', leiauteConferido: true },
    caged: { exigidaDe: null, exigidaAte: '2019-12', leiaute: '1.0', leiauteConferido: false },
    rais: { exigidaDe: null, exigidaAte: null, leiaute: '2024', leiauteConferido: false },
  },
});
const REDE = `${T} rede`;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO_O3)(`leituras próprias do cálculo da folha (cliente ${CLIENTE_O3})`, () => {
  let m: MassaPessoasO3;
  let porta: LeiturasCalculoFolhaPropria;
  const ids: Record<string, number> = {};
  const c = (est = m.est) => ({
    cliente: CLIENTE_O3,
    estabelecimento: est,
    usuario: m.usuario,
    correlacao: 't-f24l',
  });

  async function limpar(e: Escritor) {
    const est = [m.est];
    await e.executar('DELETE FROM rescisao WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM desligamento WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM recibo_ferias WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM programacao_ferias WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM periodo_aquisitivo WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE l FROM processamento_folha_linha l JOIN processamento_folha p ON p.id = l.processamento_folha_id WHERE p.estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM processamento_folha WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM parametro_obrigacao WHERE estabelecimento_id = ?', est);
    await e.executar(
      "DELETE FROM parametro_obrigacao WHERE estabelecimento_id IS NULL AND JSON_VALUE(dados, '$.razaoSocial') = ?",
      [REDE],
    );
    await e.executar('DELETE FROM rubrica WHERE estabelecimento_id = ?', est);
  }

  beforeAll(async () => {
    m = await prepararMassaO3('F24L');
    porta = new LeiturasCalculoFolhaPropria(m.nucleo);
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'preparo-f24l' }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const u = m.usuario;
      const cat = (tabela: string, cols: string, vals: unknown[]) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [T],
          `INSERT INTO ${tabela} (codigo, ${cols}, criado_em) VALUES (?, ${vals.map(() => '?').join(', ')}, ?)`,
          [T, ...vals, agora],
        );
      const tipoRubrica = await cat('tipo_rubrica', 'descricao, natureza', ['Tipo sintético', 'provento']);
      const tipoRef = await cat('tipo_referencia_rubrica', 'descricao, unidade', [
        'Referência sintética',
        'valor',
      ]);
      const natureza = await garantir(
        e,
        'SELECT id FROM natureza_rubrica WHERE codigo_esocial = ?',
        ['Z924'],
        'INSERT INTO natureza_rubrica (codigo_esocial, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES (?, ?, ?, ?, ?)',
        ['Z924', 'Natureza sintética', '2020-01-01', 'teste', agora],
      );
      const rubrica = (codigo: string) =>
        e.inserir(
          'INSERT INTO rubrica (estabelecimento_id, codigo, descricao, tipo_rubrica_id, natureza_rubrica_id, tipo_referencia_rubrica_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [m.est, codigo, `Rubrica sintética ${codigo}`, tipoRubrica, natureza, tipoRef, '2020-01-01', agora],
        );
      ids['r101'] = await rubrica('101');
      ids['r201'] = await rubrica('201');
      ids['r0010'] = await rubrica('0010');
      ids['rAlfa'] = await rubrica('A1X');
      const proc = (comp: string, tipo: string, numero: number, situacao: string, extra: unknown[] = []) =>
        e.inserir(
          `INSERT INTO processamento_folha (estabelecimento_id, competencia, tipo, numero, situacao, pagamento_em, totais,
             quantidade_fora_da_folha, tabela_legal_inicio, parametros_inicio, resumo, motivo, criado_em, criado_por,
             alterado_em, alterado_por) VALUES (?, ?, ?, ?, ?, ?, ?, 2, '2026-01-01', '2026-02-01', 'Resumo sintético', ?, ?, ?, ?, ?)`,
          [
            m.est,
            comp,
            tipo,
            numero,
            situacao,
            ...extra,
            agora,
            u,
            situacao === 'calculada' ? null : agora,
            situacao === 'calculada' ? null : u,
          ],
        );
      ids['p0'] = await proc('2026-08-01', 'mensal', 1, 'substituida', [
        null,
        '{"colaboradores":1}',
        'recálculo',
      ]);
      ids['p1'] = await proc('2026-08-01', 'mensal', 2, 'calculada', [null, '{"colaboradores":1}', null]);
      ids['p2'] = await proc('2026-09-01', 'mensal', 1, 'calculada', [null, '{"colaboradores":1}', null]);
      ids['p3'] = await proc('2026-10-01', 'ferias', 1, 'calculada', [
        '2026-10-03',
        '{"colaboradores":1}',
        null,
      ]);
      ids['p4'] = await proc('2026-11-01', 'rescisao', 1, 'calculada', [
        '2026-11-20',
        '{"colaboradores":1}',
        null,
      ]);
      ids['p5'] = await proc('2026-12-01', 'decimo_terceiro_2', 1, 'calculada', [
        '2026-12-20',
        '{"colaboradores":1}',
        null,
      ]);
      const linha = (
        p: number,
        papel: string,
        tipo: string,
        rub: number | null,
        qt: number,
        un: string,
        valor: number,
      ) =>
        e.executar(
          `INSERT INTO processamento_folha_linha (processamento_folha_id, vinculo_trabalho_id, papel, tipo, rubrica_id,
             quantidade, unidade, valor, memoria_calculo, centro_custo_id, dias_pagos, criado_em, criado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 30, ?, ?)`,
          [p, m.vinculo, papel, tipo, rub, qt, un, valor, `memória ${papel}`, agora, u],
        );
      for (const p of [ids['p0']!, ids['p1']!, ids['p2']!]) {
        await linha(p, 'salario', 'provento', ids['r101']!, 30, 'dias', 1000);
        await linha(p, 'horaExtra50', 'provento', ids['r101']!, 120, 'minutos', 50.1);
        await linha(p, 'inss', 'desconto', ids['r201']!, 0, 'valor', 80.25);
        await linha(p, 'baseInss', 'base', null, 0, 'valor', 1050.1);
      }
      await linha(ids['p3']!, 'baseInss', 'base', null, 0, 'valor', 500);
      await linha(ids['p3']!, 'inssFerias', 'desconto', ids['r201']!, 0, 'valor', 40);
      await linha(ids['p4']!, 'salario', 'provento', ids['r101']!, 10, 'dias', 333.33);

      // Férias: período aquisitivo, a calculada com o recibo (processamento p3) e a programada.
      const tipoFerias = await cat('tipo_ferias', 'descricao, categoria', [
        'Férias sintéticas',
        'individual',
      ]);
      const aq = await e.inserir(
        'INSERT INTO periodo_aquisitivo (estabelecimento_id, colaborador_id, vinculo_trabalho_id, inicio, fim, limite_concessivo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [m.est, m.colaborador, m.vinculo, '2025-09-01', '2026-08-31', '2027-07-31', agora],
      );
      const prog = (parcela: number, ini: string, fim: string, dias: number, situacao: string) =>
        e.inserir(
          `INSERT INTO programacao_ferias (estabelecimento_id, colaborador_id, vinculo_trabalho_id, periodo_aquisitivo_id,
             tipo_ferias_id, numero_parcela, inicio_gozo, fim_gozo, dias_gozo, dias_abono, dias_dobra,
             adianta_decimo_terceiro, pagamento_previsto_em, situacao, criado_em, criado_por, alterado_em, alterado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.est,
            m.colaborador,
            m.vinculo,
            aq,
            tipoFerias,
            parcela,
            ini,
            fim,
            dias,
            parcela === 1,
            ini,
            situacao,
            agora,
            u,
            situacao === 'programada' ? null : agora,
            situacao === 'programada' ? null : u,
          ],
        );
      ids['f1'] = await prog(1, '2026-10-05', '2026-10-24', 20, 'calculada');
      ids['f2'] = await prog(2, '2027-01-10', '2027-01-19', 10, 'aprovada');
      await e.executar(
        `INSERT INTO recibo_ferias (estabelecimento_id, numero, colaborador_id, programacao_ferias_id, periodo_aquisitivo_id,
           processamento_folha_id, aviso_em, inicio_gozo, fim_gozo, dias_gozo, base_calculo, pagamento_previsto_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, '2026-09-05', '2026-10-05', '2026-10-24', 20, 3000, '2026-10-03', ?)`,
        [m.est, `${T}-1`, m.colaborador, ids['f1'], aq, ids['p3'], agora],
      );

      // Rescisão do cálculo (processamento p4).
      const tabela = await garantir(
        e,
        'SELECT id FROM tabela_esocial WHERE codigo_oficial = ?',
        [T],
        "INSERT INTO tabela_esocial (fonte, codigo_oficial, descricao, versao_fonte, criado_em) VALUES ('esocial', ?, 'Tabela sintética', 'teste', ?)",
        [T, agora],
      );
      const motivo = await garantir(
        e,
        'SELECT id FROM codigo_esocial WHERE tabela_esocial_id = ? AND codigo_esocial = ?',
        [tabela, 'Z1'],
        "INSERT INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, criado_em) VALUES (?, 'Z1', 'Motivo sintético', ?)",
        [tabela, agora],
      );
      const tipoRescisao = await cat('tipo_rescisao', 'descricao, iniciativa', [
        'Rescisão sintética',
        'empregador',
      ]);
      const deslig = await e.inserir(
        `INSERT INTO desligamento (estabelecimento_id, vinculo_trabalho_id, motivo_codigo_esocial_id, iniciativa,
           data_comunicacao, data_desligamento, aviso_previo, criado_em)
         VALUES (?, ?, ?, 'empregador', '2026-11-01', '2026-11-10', 'indenizado', ?)`,
        [m.est, m.vinculo, motivo, agora],
      );
      ids['res'] = await e.inserir(
        `INSERT INTO rescisao (estabelecimento_id, colaborador_id, desligamento_id, tipo_rescisao_id, data_desligamento,
           data_projetada_aviso, pagamento_limite_em, situacao, processamento_folha_id, modalidade, aviso_previo, dias_aviso,
           dias_aviso_indenizados, saldo_fgts, saldo_fgts_informado, valor_multa_fgts, criado_em, criado_por)
         VALUES (?, ?, ?, ?, '2026-11-10', '2026-12-13', '2026-11-20', 'calculada', ?, 'sem_justa_causa', 'nao_cumprido',
           33, 33, 5000, TRUE, 2000, ?, ?)`,
        [m.est, m.colaborador, deslig, tipoRescisao, ids['p4'], agora, u],
      );
      ids['tipoRescisao'] = tipoRescisao;

      await e.executar(
        'INSERT INTO parametro_obrigacao (estabelecimento_id, vigencia_inicio, dados, criado_em, criado_por) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (NULL, ?, ?, ?, ?)',
        [
          m.est,
          '2026-01-01',
          JSON.stringify(dadosObrigacoes('Empresa sintética', '2100')),
          agora,
          u,
          m.est,
          '2026-06-01',
          JSON.stringify(dadosObrigacoes('Empresa sintética', '2200')),
          agora,
          u,
          '2026-09-01',
          JSON.stringify(dadosObrigacoes(REDE, '2300')),
          agora,
          u,
        ],
      );
    });
  });

  afterAll(async () => {
    if (!m) return;
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'limpeza-f24l' }, (e) => limpar(e));
    await encerrarMassaO3(m);
  });

  it('processamentos: filtros, ordem (competência e número, do mais recente), tipo do contrato e situação por/em', async () => {
    const todos = await porta.processos(c(), {});
    expect(todos.map((p) => p.id)).toEqual(['p5', 'p4', 'p3', 'p2', 'p1', 'p0'].map((k) => ids[k]));
    expect(todos[0]).toMatchObject({ tipo: 'decimo2', competencia: '2026-12', pagamento: '2026-12-20' });
    const p0 = todos.find((p) => p.id === ids['p0'])!;
    expect(p0).toMatchObject({
      empresa: m.est,
      situacao: 'substituida',
      foraDaFolha: 2,
      tabelaLegal: '2026-01-01',
      parametros: '2026-02-01',
      resumo: 'Resumo sintético',
      calculadoPor: m.login,
      situacaoPor: m.login,
      motivo: 'recálculo',
      versao: 1,
      totais: { colaboradores: 1 },
    });
    expect(todos.find((p) => p.id === ids['p1'])).toMatchObject({ situacaoPor: null, situacaoEm: null });
    expect(
      (await porta.processos(c(), { competencia: '2026-08', situacao: 'calculada' })).map((p) => p.id),
    ).toEqual([ids['p1']]);
    expect((await porta.processos(c(), { tipo: 'mensal' })).length).toBe(3);
    expect(
      (await porta.processos(c(), { semTipo: 'ferias', semTipos: ['rescisao', 'decimo2'] })).length,
    ).toBe(3);
    expect(
      (await porta.processos(c(), { competenciaDe: '2026-09', competenciaAte: '2026-11' })).map((p) => p.id),
    ).toEqual([ids['p4'], ids['p3'], ids['p2']]);
    expect(await porta.processos(c(), { empresa: m.outro })).toEqual([]);
    expect(await porta.processos(c(m.outro), {})).toEqual([]);
    expect((await porta.processo(c(), ids['p3']!))?.tipo).toBe('ferias');
    expect(await porta.processo(c(m.outro), ids['p3']!)).toBeNull();
  });

  it('linhas do vínculo, resumo por vínculo, itens por rubrica e histórico das mensais calculadas', async () => {
    const ls = await porta.linhasDoVinculo(c(), ids['p2']!, m.vinculo);
    expect(ls).toHaveLength(4);
    expect(ls[1]).toEqual({
      papel: 'horaExtra50',
      tipo: 'provento',
      rubrica: ids['r101'],
      codigoRubrica: 101,
      quantidade: 120,
      unidade: 'minutos',
      valor: 50.1,
      memoria: 'memória horaExtra50',
      vinculo: m.vinculo,
      centroCusto: 0,
      diasPagos: 30,
    });
    expect(await porta.linhasDoVinculo(c(m.outro), ids['p2']!, m.vinculo)).toEqual([]);
    const [r] = await porta.resumoVinculos(c(), ids['p2']!);
    expect(r).toMatchObject({ vinculo: m.vinculo, diasPagos: 30, proventos: 1050.1, descontos: 80.25 });
    expect(r!.porPapel).toMatchObject({ inss: 80.25, baseInss: 1050.1, fgts: 0 });
    expect(await porta.itensRubricaDoProcesso(c(), ids['p2']!)).toEqual([
      { vinculo: m.vinculo, tipo: 'provento', codigoRubrica: 101, valor: 1050.1 },
      { vinculo: m.vinculo, tipo: 'desconto', codigoRubrica: 201, valor: 80.25 },
    ]);
    const h = await porta.historico(c(), [m.vinculo], '2026-08', '2026-09');
    expect(h.filter((x) => x.papel === 'salario')).toEqual([
      { vinculo: m.vinculo, competencia: '2026-08', papel: 'salario', quantidade: 30, valor: 1000 },
      { vinculo: m.vinculo, competencia: '2026-09', papel: 'salario', quantidade: 30, valor: 1000 },
    ]);
    expect(h.some((x) => x.papel === 'inss' || x.papel === 'baseInss')).toBe(false);
    expect(await porta.historico(c(), [], '2026-01', '2026-12')).toEqual([]);
    expect(await porta.processosDoVinculo(c(), m.vinculo, 'mensal', '2026-01', '2026-12')).toEqual([
      { processo: ids['p1'], competencia: '2026-08' },
      { processo: ids['p2'], competencia: '2026-09' },
    ]);
    expect(await porta.processosDoVinculo(c(), m.vinculo, 'rescisao', '2026-11', '2026-11')).toEqual([
      { processo: ids['p4'], competencia: '2026-11' },
    ]);
  });

  it('férias: filtros, ordem, situação do contrato, processo do recibo e férias com recibo na competência', async () => {
    const doVinculo = await porta.ferias(c(), { vinculo: m.vinculo });
    expect(doVinculo.map((f) => f.id)).toEqual([ids['f2'], ids['f1']]);
    expect(doVinculo[1]).toMatchObject({
      empresa: m.est,
      aquisitivoInicio: '2025-09-01',
      aquisitivoFim: '2026-08-31',
      inicio: '2026-10-05',
      fim: '2026-10-24',
      dias: 20,
      abono: 0,
      dobra: 0,
      adiantarDecimo: true,
      pagamento: '2026-10-05',
      situacao: 'calculada',
      processo: ids['p3'],
      registradoPor: m.login,
      situacaoPor: m.login,
    });
    expect(doVinculo[0]).toMatchObject({ situacao: 'programada', processo: null, situacaoPor: null });
    expect((await porta.ferias(c(), {})).map((f) => f.id)).toEqual([ids['f1'], ids['f2']]);
    expect((await porta.ferias(c(), { situacao: 'programada' })).map((f) => f.id)).toEqual([ids['f2']]);
    expect((await porta.ferias(c(), { de: '2026-10-20', ate: '2026-11-30' })).map((f) => f.id)).toEqual([
      ids['f1'],
    ]);
    expect(await porta.ferias(c(), { empresa: m.outro })).toEqual([]);
    expect((await porta.feriasPorId(c(), ids['f2']!))?.id).toBe(ids['f2']);
    expect(await porta.feriasPorId(c(m.outro), ids['f2']!)).toBeNull();
    expect(await porta.feriasNaCompetencia(c(), '2026-10-01', '2026-10-31')).toEqual([
      {
        ferias: ids['f1'],
        vinculo: m.vinculo,
        inicio: '2026-10-05',
        fim: '2026-10-24',
        processo: ids['p3'],
        competencia: '2026-10',
        baseInss: 500,
        inss: 40,
      },
    ]);
    expect(await porta.feriasNaCompetencia(c(), '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('rescisões do cálculo: modalidade e aviso do contrato, filtros e isolamento do estabelecimento', async () => {
    const [r] = await porta.rescisoes(c(), { vinculo: m.vinculo });
    expect(r).toMatchObject({
      id: ids['res'],
      vinculo: m.vinculo,
      empresa: m.est,
      desligamento: '2026-11-10',
      tipoRescisao: ids['tipoRescisao'],
      modalidade: 'sem-justa-causa',
      aviso: 'nao-cumprido',
      diasAviso: 33,
      diasIndenizados: 33,
      projecao: '2026-12-13',
      termo: null,
      saldoFgts: 5000,
      saldoFgtsInformado: true,
      multaFgts: 2000,
      pagamento: '2026-11-20',
      situacao: 'calculada',
      processo: ids['p4'],
      registradoPor: m.login,
      situacaoPor: null,
    });
    expect(await porta.rescisoes(c(), { situacao: 'cancelada' })).toEqual([]);
    expect(await porta.rescisoes(c(), { de: '2026-11-11' })).toEqual([]);
    expect(await porta.rescisoes(c(), { empresa: m.outro })).toEqual([]);
    expect((await porta.rescisaoPorId(c(), ids['res']!))?.id).toBe(ids['res']);
    expect(await porta.rescisaoPorId(c(m.outro), ids['res']!)).toBeNull();
  });

  it('parâmetros das obrigações: da vigência mais recente, pelo esquema do contrato; a rede inteira e outra empresa não entram', async () => {
    const ps = await porta.parametrosObrigacoes(c(), null);
    expect(ps.map((p) => p.inicio)).toEqual(['2026-06', '2026-01']);
    expect(ps[0]).toEqual({
      ...dadosObrigacoes('Empresa sintética', '2200'),
      empresa: m.est,
      inicio: '2026-06',
      id: expect.any(Number),
      criadoPor: m.login,
      criadoEm: expect.any(String),
    });
    expect(ps.some((p) => p.razaoSocial === REDE)).toBe(false);
    expect(await porta.parametrosObrigacoes(c(), m.est)).toHaveLength(2);
    expect(await porta.parametrosObrigacoes(c(), m.outro)).toEqual([]);
  });

  it('parâmetros das obrigações fora do esquema recusam (nunca objeto vazio)', async () => {
    const id = await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'f24l-param' }, (e) =>
      e.inserir(
        'INSERT INTO parametro_obrigacao (estabelecimento_id, vigencia_inicio, dados, criado_em, criado_por) VALUES (?, ?, ?, ?, ?)',
        [m.est, '2026-03-01', '{"codigoGps":"2100"}', new Date(), m.usuario],
      ),
    );
    try {
      await expect(porta.parametrosObrigacoes(c(), null)).rejects.toMatchObject({
        problema: { codigo: 'parametros-obrigacoes-invalidos' },
      });
    } finally {
      await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'f24l-param' }, (e) =>
        e.executar('DELETE FROM parametro_obrigacao WHERE id = ?', [id]),
      );
    }
  });

  it('rubrica com zero à esquerda ou alfanumérica recusa a leitura das linhas (não some dos itens por rubrica)', async () => {
    for (const rub of [ids['r0010']!, ids['rAlfa']!]) {
      await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'f24l-rub' }, (e) =>
        e.executar(
          `INSERT INTO processamento_folha_linha (processamento_folha_id, vinculo_trabalho_id, papel, tipo, rubrica_id,
             quantidade, unidade, valor, memoria_calculo, centro_custo_id, dias_pagos, criado_em, criado_por)
           VALUES (?, ?, 'salario', 'provento', ?, 0, 'valor', 10, 'memória', NULL, 30, ?, ?)`,
          [ids['p5'], m.vinculo, rub, new Date(), m.usuario],
        ),
      );
      try {
        await expect(porta.itensRubricaDoProcesso(c(), ids['p5']!)).rejects.toMatchObject({
          problema: { codigo: 'rubrica-codigo-invalido' },
        });
        await expect(porta.linhasDoVinculo(c(), ids['p5']!, m.vinculo)).rejects.toMatchObject({
          problema: { codigo: 'rubrica-codigo-invalido' },
        });
      } finally {
        await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'f24l-rub' }, (e) =>
          e.executar('DELETE FROM processamento_folha_linha WHERE processamento_folha_id = ?', [ids['p5']]),
        );
      }
    }
    expect(await porta.itensRubricaDoProcesso(c(), ids['p5']!)).toEqual([]);
  });

  it('rescisão paga e férias gozadas: leem como calculada com quem as encerrou, e recusam cancelar e recalcular', async () => {
    const ctx = { cliente: CLIENTE_O3, estabelecimento: m.est, usuario: m.usuario, correlacao: 't-f24l' };
    const alteravel = () =>
      m.nucleo.lerSomente(ctx, async (l) => {
        await exigirRescisaoAlteravel(l, m.est, ids['res']!);
        await exigirFeriasAlteravel(l, m.est, ids['f1']!);
      });
    await expect(alteravel()).resolves.toBeUndefined();
    const situar = (rescisao: string, ferias: string) =>
      m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'f24l-enc' }, async (e) => {
        await e.executar('UPDATE rescisao SET situacao = ?, alterado_em = ?, alterado_por = ? WHERE id = ?', [
          rescisao,
          new Date(),
          m.usuario,
          ids['res'],
        ]);
        await e.executar('UPDATE programacao_ferias SET situacao = ? WHERE id = ?', [ferias, ids['f1']]);
      });
    await situar('paga', 'gozada');
    try {
      expect(await porta.rescisaoPorId(c(), ids['res']!)).toMatchObject({
        situacao: 'calculada',
        situacaoPor: m.login,
      });
      expect(await porta.feriasPorId(c(), ids['f1']!)).toMatchObject({
        situacao: 'calculada',
        situacaoPor: m.login,
      });
      await expect(
        m.nucleo.lerSomente(ctx, (l) => exigirRescisaoAlteravel(l, m.est, ids['res']!)),
      ).rejects.toMatchObject({ problema: { codigo: 'rescisao-encerrada' } });
      await expect(
        m.nucleo.lerSomente(ctx, (l) => exigirFeriasAlteravel(l, m.est, ids['f1']!)),
      ).rejects.toMatchObject({
        problema: { codigo: 'ferias-encerradas' },
      });
    } finally {
      await situar('calculada', 'calculada');
    }
  });

  it('sem estabelecimento na sessão: recusa', async () => {
    await expect(porta.processos({ ...c(), estabelecimento: null }, {})).rejects.toMatchObject({
      problema: { codigo: 'sem-estabelecimento' },
    });
  });
});
