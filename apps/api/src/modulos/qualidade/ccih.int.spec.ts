// Integração da porta PRÓPRIA da CCIH (comissão de controle de infecção hospitalar) contra o MariaDB do cliente de teste
// (SGH_CLIENTE_TESTE; o do lote é f24p_qualidadeccih). Massa SINTÉTICA: o estabelecimento da massa da qualidade, uma
// unidade de internação com bloco, acomodação e três leitos, uma internação, os cadastros da CCIH (tipo de dispositivo,
// sítio, bundle, categoria profissional, tipo de surto), a numeração do surto e um dia de censo fechado. Confere as
// leituras restritas ao estabelecimento, as gravações pelo Executor com a trilha (versão anterior, estorno, conflito de
// versão) e as partes que aguardam estrutura falhando fechadas.
import { ErroOperacao, type Escritor } from '@sgh/nucleo';
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
import { PortaCcihPropria } from './porta-ccih-propria.js';

const P = 'F24CC';
const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'ccih',
  entidadeId: null,
  correlacao: 'teste-f24-ccih',
};
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};
const hoje = () => new Date().toISOString().slice(0, 10);
const competencia = () => hoje().slice(0, 7);

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limparCcih(e: Escritor, ests: readonly number[]): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  const q = (sql: string) => e.executar(sql, ests);
  await q(
    `DELETE i FROM verificacao_bundle_item i JOIN verificacao_bundle v ON v.id = i.verificacao_bundle_id WHERE v.estabelecimento_id IN (${em})`,
  );
  await q(`DELETE FROM verificacao_bundle WHERE estabelecimento_id IN (${em})`);
  await q(
    `DELETE ev FROM dispositivo_invasivo_evento ev JOIN dispositivo_invasivo_paciente d ON d.id = ev.dispositivo_invasivo_paciente_id WHERE d.estabelecimento_id IN (${em})`,
  );
  await q(`DELETE FROM dispositivo_invasivo_paciente WHERE estabelecimento_id IN (${em})`);
  await q(
    `DELETE i FROM observacao_higiene_maos_item i JOIN observacao_higiene_maos o ON o.id = i.observacao_higiene_maos_id WHERE o.estabelecimento_id IN (${em})`,
  );
  await q(`DELETE FROM observacao_higiene_maos WHERE estabelecimento_id IN (${em})`);
  await q(`DELETE FROM consumo_preparacao_alcoolica WHERE estabelecimento_id IN (${em})`);
  await q(`DELETE FROM surto_infeccao WHERE estabelecimento_id IN (${em})`);
  await q(`DELETE FROM fechamento_vigilancia_iras WHERE estabelecimento_id IN (${em})`);
  await q(`DELETE FROM fechamento_censo WHERE estabelecimento_id IN (${em})`);
  await q(
    `DELETE pi FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.estabelecimento_id IN (${em})`,
  );
  await q(`DELETE FROM prescricao WHERE estabelecimento_id IN (${em})`);
  await q(`DELETE FROM internacao WHERE estabelecimento_id IN (${em})`);
  await q(`DELETE FROM atendimento WHERE estabelecimento_id IN (${em})`);
  await q(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (${em}) AND tipo = 'surto_infeccao'`);
}

describe.skipIf(SEM_BANCO_QUA)('porta própria da CCIH contra o MariaDB', () => {
  let m: MassaQualidade;
  let porta: PortaCcihPropria;
  let c: ReturnType<typeof ctxBanco>;
  let outro: ReturnType<typeof ctxBanco>;
  const ids = { reg: 0, paciente: 0, prof: 0, tipoSurto: 0, atendimento: 0 };

  beforeAll(async () => {
    m = await prepararMassaQualidade('CC');
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-f24-ccih' }, async (e) => {
      const agora = new Date();
      await limparCcih(e, [m.est, m.outro]);
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [m.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'UTI SINTETICA', 'internacao', ?)",
        [m.est, `${P}-UA`, agora],
      );
      const bloco = await garantir(
        e,
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [m.est, 'UTI'],
        "INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'UTI', 'BLOCO SINTETICO', ?)",
        [m.est, agora],
      );
      const ui = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [m.est, `${P}-UI`],
        `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, bloco_internacao_id,
           setor_funcional_id, criado_em) VALUES (?, ?, ?, 'UTI SINTETICA', 'uti_adulto', ?, ?, ?)`,
        [m.est, ua, `${P}-UI`, bloco, m.setor, agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
        [`${P}-UTI`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, 'UTI SINTETICA', 'terapia_intensiva', ?)",
        [`${P}-UTI`, agora],
      );
      const acom = await garantir(
        e,
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [m.est, '01'],
        `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome,
           quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, '01', 'BOX SINTETICO', 3, ?)`,
        [m.est, bloco, ui, cat, agora],
      );
      const sit = await garantir(
        e,
        "SELECT id FROM situacao_leito WHERE situacao_base = 'livre' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES (?, 'LIVRE', 'livre', ?)",
        [`${P}-LIVRE`, agora],
      );
      const leitos: number[] = [];
      for (const l of ['A', 'B', 'C'])
        leitos.push(
          await garantir(
            e,
            'SELECT id FROM leito_hospitalar WHERE acomodacao_id = ? AND codigo = ?',
            [acom, l],
            `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id, codigo,
             situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)`,
            [m.est, ui, acom, bloco, l, sit, agora],
          ),
        );
      const cat2 = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
      const tiss = await cat2(
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['M2'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('M2', 'CARATER SINTETICO', 'teste', ?)",
        [agora],
      );
      const catAt = await cat2(
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO SINTETICA', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const carater = await cat2(
        'SELECT id FROM carater_admissao WHERE codigo = ?',
        [`${P}-ELE`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'ELETIVA SINTETICA', FALSE, ?)",
        [`${P}-ELE`, agora],
      );
      const modal = await cat2(
        'SELECT id FROM modalidade_internacao WHERE codigo = ?',
        [`${P}-CLI`],
        "INSERT INTO modalidade_internacao (codigo, descricao, criado_em) VALUES (?, 'CLINICA SINTETICA', ?)",
        [`${P}-CLI`, agora],
      );
      const esp = await cat2(
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        [`${P}-CLM`],
        "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, 'CLINICA SINTETICA', ?)",
        [`${P}-CLM`, agora],
      );
      const fonte = await cat2(
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA SINTETICA', 'operadora', 'ativa', ?)",
        [`${P}-INT`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
      const pm = await pessoa(`MEDICO SINTETICO ${P}`);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 924001, 'ativo', ?)",
        [pp, agora],
      );
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const entrada = new Date(Date.now() - 3 * 86_400_000);
      const at = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, ids.prof, entrada, agora],
      );
      ids.atendimento = at;
      ids.reg = await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada, carater_admissao_id,
           modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id, especialidade_medica_id,
           medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)`,
        [
          m.est,
          `${P}-IN1`,
          at,
          ids.paciente,
          entrada,
          carater,
          modal,
          ui,
          leitos[0],
          acom,
          esp,
          ids.prof,
          fonte,
          agora,
        ],
      );
      // Cadastros da CCIH (configuração do cliente, códigos do contrato em snake_case).
      const tipo = await garantir(
        e,
        "SELECT id FROM tipo_dispositivo_invasivo WHERE codigo = 'cvc'",
        [],
        "INSERT INTO tipo_dispositivo_invasivo (codigo, descricao, conta_vigilancia_infeccao, criado_em) VALUES ('cvc', 'CATETER VENOSO CENTRAL', TRUE, ?)",
        [agora],
      );
      await garantir(
        e,
        "SELECT id FROM local_acesso_invasivo WHERE codigo = 'subclavia'",
        [],
        "INSERT INTO local_acesso_invasivo (codigo, descricao, criado_em) VALUES ('subclavia', 'SUBCLAVIA', ?)",
        [agora],
      );
      await garantir(
        e,
        "SELECT id FROM categoria_profissional WHERE codigo = 'medico'",
        [],
        "INSERT INTO categoria_profissional (codigo, descricao, grupo, criado_em) VALUES ('medico', 'MEDICO', 'medico', ?)",
        [agora],
      );
      const bundle = await garantir(
        e,
        'SELECT id FROM bundle_prevencao WHERE estabelecimento_id = ? AND codigo = ?',
        [m.est, `${P}-CVC`],
        "INSERT INTO bundle_prevencao (estabelecimento_id, codigo, descricao, tipo_dispositivo_invasivo_id, vigencia_inicio, criado_em) VALUES (?, ?, 'BUNDLE CVC', ?, '2020-01-01', ?)",
        [m.est, `${P}-CVC`, tipo, agora],
      );
      for (const [i, cod] of ['curativo_integro', 'indicacao_revisada', 'indicacao'].entries())
        await garantir(
          e,
          'SELECT id FROM bundle_prevencao_item WHERE bundle_prevencao_id = ? AND codigo = ?',
          [bundle, cod],
          'INSERT INTO bundle_prevencao_item (bundle_prevencao_id, codigo, descricao, ordem, criado_em) VALUES (?, ?, ?, ?, ?)',
          [bundle, cod, cod.toUpperCase(), i + 1, agora],
        );
      ids.tipoSurto = await garantir(
        e,
        'SELECT id FROM tipo_surto_infeccao WHERE codigo = ?',
        [`${P}-MR`],
        "INSERT INTO tipo_surto_infeccao (codigo, descricao, categoria, criado_em) VALUES (?, 'SURTO SINTETICO', 'microrganismo_resistente', ?)",
        [`${P}-MR`, agora],
      );
      await e.executar(
        "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, criado_em) VALUES (?, 'surto_infeccao', 'S', 1, ?)",
        [m.est, agora],
      );
      await e.executar(
        "INSERT INTO fechamento_censo (estabelecimento_id, unidade_internacao_id, data_referencia, corte_em, situacao, fechado_em, pacientes_dia, criado_em) VALUES (?, ?, ?, ?, 'fechado', ?, 5, ?)",
        [m.est, ui, `${competencia()}-01`, agora, agora, agora],
      );
    });
    porta = new PortaCcihPropria(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
    outro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
  }, 60_000);

  afterAll(async () => {
    if (!m) return;
    await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-f24-ccih' }, (e) =>
      limparCcih(e, [m.est, m.outro]),
    );
    await encerrarMassaQualidade(m);
  });

  it('lê o internado, o leito, os vizinhos e o censo só no estabelecimento da sessão', async () => {
    const { itens } = await porta.internados(c);
    expect(itens.map((i) => [i.reg, i.bloco, i.acomodacao, i.leito, i.aberta])).toEqual([
      [ids.reg, 'UTI', '01', 'A', true],
    ]);
    expect((await porta.internados(outro)).itens).toEqual([]);
    expect(await porta.internacao(outro, ids.reg)).toBeNull();
    expect(await porta.altasDas(c, [ids.reg])).toEqual([{ reg: ids.reg, alta: null }]);
    const viz = await porta.vizinhos(c, { bloco: 'UTI', acomodacao: '01', leito: 'A' });
    expect(viz.map((v) => [v.leito, v.ocupado])).toEqual([
      ['B', false],
      ['C', false],
    ]);
    const censo = await porta.censo(c, `${competencia()}-01`, hoje());
    expect(censo).toEqual({ porSetor: [{ setor: 'UTI', pacientesDia: 5 }], diasFechados: 1 });
    expect(await porta.unidades(c)).toContainEqual({ codigo: m.setor, nome: 'POSTO SINTETICO' });
    // As leituras assistenciais rodam no modelo (sem prescrição, cultura nem cirurgia na massa: listas vazias de verdade).
    expect((await porta.antimicrobianos(c, [ids.reg], null)).itens).toEqual([]);
    expect(await porta.culturas(c, [ids.reg], '2020-01-01')).toEqual([]);
    expect(await porta.cirurgias(c, [ids.reg], '2020-01-01')).toEqual([]);
    expect(await porta.temperaturas(c, [ids.paciente], '2020-01-01')).toEqual([]);
    expect((await porta.vigencias(c, '2020-01-01', hoje())).cortada).toBe(false);
    expect(await porta.consumoDispensado(c, 2026, 1)).toEqual([]);
    expect(await porta.fichas(c, [1])).toEqual(new Map());
    expect(await porta.tiposSurto(c)).toContainEqual({ codigo: ids.tipoSurto, nome: 'SURTO SINTETICO' });
    expect((await porta.buscarProfissionais(c, `MEDICO SINTETICO ${P}`)).map((p) => p.id)).toEqual([
      ids.prof,
    ]);
  });

  it('o antimicrobiano em curso (sem fim) segue nas leituras; o suspenso sai a partir da suspensão', async () => {
    const dia = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const itens = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-f24-ccih-atm' }, async (e) => {
      const agora = new Date();
      const g = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
      const tipoItem = await g(
        'SELECT id FROM tipo_item_prescricao WHERE codigo = ?',
        [`${P}-ATM`],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'MEDICAMENTO SINTETICO', 'medicamento', ?)",
        [`${P}-ATM`, agora],
      );
      const grupo = await g(
        'SELECT id FROM grupo_insumo WHERE codigo = ?',
        [`${P}-ATM`],
        "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'ANTIMICROBIANOS SINTETICOS', 'medicamento', ?)",
        [`${P}-ATM`, agora],
      );
      const um = await g(
        'SELECT id FROM unidade_medida WHERE codigo = ?',
        [`${P}-FA`],
        "INSERT INTO unidade_medida (codigo, descricao, sigla, uso_estoque, criado_em) VALUES (?, 'FRASCO SINTETICO', ?, TRUE, ?)",
        [`${P}-FA`, `${P}FA`.slice(0, 10), agora],
      );
      const ins = await g(
        'SELECT id FROM insumo WHERE codigo = ?',
        [`${P}-ATM`],
        "INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, antimicrobiano, criado_em) VALUES (?, 'ANTIMICROBIANO SINTETICO', 'medicamento', ?, ?, TRUE, ?)",
        [`${P}-ATM`, grupo, um, agora],
      );
      const ip = await g(
        'SELECT id FROM item_prescritivel WHERE codigo = ?',
        [`${P}-ATM`],
        "INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, insumo_id, criado_em) VALUES (?, 'ANTIMICROBIANO SINTETICO', ?, ?, ?)",
        [`${P}-ATM`, tipoItem, ins, agora],
      );
      // Prescrição vigente de 10 dias atrás a 10 dias à frente; dois itens começados antes de "desde", sem fim:
      // um em curso e um suspenso 5 dias atrás.
      const pr = await e.inserir(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id, situacao,
           prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em) VALUES (?, 924101, ?, ?, ?, 'vigente', ?, ?, ?, ?)`,
        [m.est, ids.paciente, ids.atendimento, ids.prof, `${dia(-10)} 08:00:00`, `${dia(-10)} 08:00:00`, `${dia(10)} 08:00:00`, agora],
      );
      const item = (seq: number, suspenso: string | null) =>
        e.inserir(
          `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id, inicio_em,
             situacao, suspenso_em, lancamento_profissional_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pr, seq, tipoItem, ip, `${dia(-10)} 08:00:00`, suspenso ? 'suspenso' : 'ativo', suspenso, ids.prof, agora],
        );
      return { emCurso: await item(1, null), suspenso: await item(2, `${dia(-5)} 08:00:00`) };
    });
    const desde = dia(-2);
    const lidos = (await porta.antimicrobianos(c, [ids.reg], desde)).itens.map((x) => x.itemPrescricao);
    expect(lidos).toEqual([itens.emCurso]);
    expect((await porta.vigencias(c, desde, hoje())).itens.map((x) => x.itemPrescricao)).toEqual([itens.emCurso]);
    // Antes da suspensão, os dois valem.
    expect(
      (await porta.vigencias(c, dia(-7), dia(-6))).itens.map((x) => x.itemPrescricao).sort((a, b) => a - b),
    ).toEqual([itens.emCurso, itens.suspenso].sort((a, b) => a - b));
    expect((await porta.antimicrobianoPrescrito(c, itens.suspenso))?.suspensoEm).toBe(`${dia(-5)}T08:00:00`);
  });

  it('o dispositivo invasivo: registra, corrige com a versão anterior na trilha, retira e cancela', async () => {
    const { id } = await porta.gravarSgh(c, T, (g) =>
      g.registrarDispositivo({
        reg: ids.reg,
        paciente: ids.paciente,
        leito: { bloco: 'UTI', acomodacao: '01', leito: 'A' },
        tipo: 'cvc',
        sitio: 'subclavia',
        inseridoEm: `${hoje()}T08:00`,
        itemPrescricao: null,
        observacao: null,
        responsavel: { registro: ids.prof, nome: '' },
        usuario: m.login,
      }),
    );
    const d = await porta.dispositivo(c, id);
    expect(d).toMatchObject({
      reg: ids.reg,
      setor: 'UTI',
      leito: 'A',
      tipo: 'cvc',
      sitio: 'SUBCLAVIA',
      inseridoEm: `${hoje()}T08:00:00`,
      registradoPor: m.login,
      versao: 1,
    });
    expect(d?.responsavel?.registro).toBe(ids.prof);
    expect(await porta.dispositivo(outro, id)).toBeNull();
    expect((await porta.dispositivosDas(c, [ids.reg])).map((x) => x.id)).toEqual([id]);
    expect((await porta.dispositivosNoPeriodo(c, hoje(), hoje())).itens.map((x) => x.id)).toEqual([id]);
    const versaoNova = await porta.gravarSgh(c, T, (g) =>
      g.corrigirDispositivo({
        id,
        versao: 1,
        agora: `${hoje()}T09:00:00`,
        usuario: m.login,
        justificativa: 'Horário lançado errado na passagem.',
        tipo: 'cvc',
        sitio: null,
        inseridoEm: `${hoje()}T07:30`,
        retiradoEm: null,
      }),
    );
    expect(versaoNova).toEqual({ versao: 2 });
    // Em uso: a retirada não entra pela correção (vai pela retirada, com motivo e situação).
    expect(
      await codigo(
        porta.gravarSgh(c, T, (g) =>
          g.corrigirDispositivo({
            id,
            versao: 2,
            agora: `${hoje()}T09:10:00`,
            usuario: m.login,
            justificativa: 'Retirada pela correção.',
            tipo: 'cvc',
            sitio: null,
            inseridoEm: `${hoje()}T07:30`,
            retiradoEm: `${hoje()}T09:05`,
          }),
        ),
      ),
    ).toBe('retirada-pela-correcao');
    expect(await porta.dispositivo(c, id)).toMatchObject({ retiradoEm: null, versao: 2 });
    const v = await porta.versoes(c, 'dispositivo_invasivo_paciente', id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      versao: 1,
      acao: 'correcao',
      motivo: 'Horário lançado errado na passagem.',
      alteradoPor: m.login,
    });
    expect(v[0]?.dados['inserido_em']).toBe(`${hoje()}T08:00:00`);
    // Versão vista desatualizada: recusa sem gravar.
    expect(
      await codigo(
        porta.gravarSgh(c, T, (g) =>
          g.retirarDispositivo({
            id,
            versao: 1,
            agora: '',
            usuario: m.login,
            retiradoEm: `${hoje()}T10:00`,
            motivo: 'eletiva',
            observacao: null,
          }),
        ),
      ),
    ).toBe('versao-desatualizada');
    await porta.gravarSgh(c, T, (g) =>
      g.retirarDispositivo({
        id,
        versao: 2,
        agora: '',
        usuario: m.login,
        retiradoEm: `${hoje()}T10:00`,
        motivo: 'eletiva',
        observacao: null,
      }),
    );
    expect(await porta.dispositivo(c, id)).toMatchObject({
      retiradoEm: `${hoje()}T10:00:00`,
      motivoRetirada: 'eletiva',
      versao: 3,
    });
    // Retirada corrigida para antes da inserção: recusa sem gravar.
    expect(
      await codigo(
        porta.gravarSgh(c, T, (g) =>
          g.corrigirDispositivo({
            id,
            versao: 3,
            agora: `${hoje()}T10:30:00`,
            usuario: m.login,
            justificativa: 'Retirada lançada com hora errada.',
            tipo: 'cvc',
            sitio: null,
            inseridoEm: `${hoje()}T07:30`,
            retiradoEm: `${hoje()}T07:00`,
          }),
        ),
      ),
    ).toBe('antes-da-insercao');
    expect(await porta.dependentes(c, 'dispositivo_invasivo_paciente', id)).toEqual([]);
    await porta.gravarSgh(c, T, (g) =>
      g.cancelarDispositivo({
        id,
        versao: 3,
        agora: `${hoje()}T11:00:00`,
        usuario: m.login,
        justificativa: 'Lançado no paciente errado.',
      }),
    );
    expect(await porta.dispositivo(c, id)).toMatchObject({
      canceladoEm: `${hoje()}T11:00:00`,
      motivoCancelamento: 'Lançado no paciente errado.',
    });
    expect((await porta.dispositivosNoPeriodo(c, hoje(), hoje())).itens).toEqual([]);
  });

  it('o checklist do bundle: registra, corrige e estorna com o motivo', async () => {
    const { id: disp } = await porta.gravarSgh(c, T, (g) =>
      g.registrarDispositivo({
        reg: ids.reg,
        paciente: null,
        leito: { bloco: 'UTI', acomodacao: null, leito: null },
        tipo: 'cvc',
        sitio: null,
        inseridoEm: `${hoje()}T06:00`,
        itemPrescricao: null,
        observacao: null,
        usuario: m.login,
      }),
    );
    const base = {
      dispositivo: disp,
      data: hoje(),
      turno: 'manha' as const,
      conforme: false,
      indicacaoRevisada: false,
      observacao: null,
      agora: `${hoje()}T09:00:00`,
      usuario: m.login,
    };
    const { id } = await porta.gravarSgh(c, T, (g) =>
      g.registrarBundle({ ...base, itens: { curativoIntegro: false, indicacaoRevisada: true } }),
    );
    expect(await codigo(porta.gravarSgh(c, T, (g) => g.registrarBundle({ ...base, itens: {} })))).toBe(
      'bundle-ja-registrado',
    );
    expect(
      await codigo(
        porta.gravarSgh(c, T, (g) =>
          g.registrarBundle({ ...base, turno: 'tarde', itens: { inexistente: true } }),
        ),
      ),
    ).toBe('item-bundle-nao-cadastrado');
    await porta.gravarSgh(c, T, (g) =>
      g.corrigirBundle({
        id,
        versao: 1,
        agora: base.agora,
        usuario: m.login,
        justificativa: 'Curativo conferido de novo.',
        itens: { curativoIntegro: true, indicacaoRevisada: true },
        conforme: true,
        indicacaoRevisada: true,
        observacao: null,
      }),
    );
    expect(await porta.bundle(c, id)).toMatchObject({
      itens: { curativoIntegro: true, indicacaoRevisada: true },
      conforme: true,
      versao: 2,
      estornadoEm: null,
    });
    await porta.gravarSgh(c, T, (g) =>
      g.estornarBundle({
        id,
        versao: 2,
        agora: `${hoje()}T12:00:00`,
        usuario: m.login,
        justificativa: 'Checklist do dispositivo errado.',
      }),
    );
    const [b] = await porta.bundles(c, [disp]);
    expect(b).toMatchObject({
      id,
      estornadoEm: `${hoje()}T12:00:00`,
      estornadoPor: m.login,
      motivoEstorno: 'Checklist do dispositivo errado.',
      versao: 3,
    });
    expect((await porta.versoes(c, 'verificacao_bundle', id)).map((x) => x.acao)).toEqual([
      'estorno',
      'correcao',
    ]);
    // O turno estornado se lança de novo: a mesma linha volta a valer e o estornado vai à trilha.
    const novo = await porta.gravarSgh(c, T, (g) =>
      g.registrarBundle({
        ...base,
        agora: `${hoje()}T13:00:00`,
        conforme: true,
        indicacaoRevisada: true,
        itens: { curativoIntegro: true, indicacao: true },
      }),
    );
    expect(novo).toEqual({ id });
    expect(await porta.bundle(c, id)).toMatchObject({
      itens: { curativoIntegro: true, indicacao: true },
      conforme: true,
      indicacaoRevisada: true,
      estornadoEm: null,
      motivoEstorno: null,
      versao: 4,
    });
    expect((await porta.versoes(c, 'verificacao_bundle', id)).map((x) => x.acao)).toEqual([
      'correcao',
      'estorno',
      'correcao',
    ]);
    expect(await codigo(porta.gravarSgh(c, T, (g) => g.registrarBundle({ ...base, itens: {} })))).toBe(
      'bundle-ja-registrado',
    );
    // A revisão da indicação não vira decisão de manter o dispositivo no banco.
    const linha = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'confere-f24-ccih-bundle' }, (e) =>
      e.uma<{ manter: unknown }>('SELECT manter_dispositivo AS manter FROM verificacao_bundle WHERE id = ?', [id]),
    );
    expect(linha?.manter ?? null).toBeNull();
  });

  it('a higiene das mãos e o consumo de preparação alcoólica por setor e competência', async () => {
    const inicioTeste = new Date(Date.now() - 2000);
    const detalhe = [
      { momento: 'antesContato', acao: 'friccao', luvas: false },
      { momento: 'aposContato', acao: 'naoRealizada', luvas: true },
    ];
    const { id } = await porta.gravarSgh(c, T, (g) =>
      g.registrarObservacaoMaos({
        unidade: m.setor,
        setor: null,
        observadoEm: `${hoje()}T10:00`,
        categoria: 'medico',
        oportunidades: 2,
        conformes: 1,
        detalhe,
        observacao: null,
        usuario: m.login,
      }),
    );
    expect(await porta.observacaoMaos(c, id)).toMatchObject({
      unidade: m.setor,
      setor: 'UTI',
      categoria: 'medico',
      oportunidades: 2,
      conformes: 1,
      detalhe,
      versao: 1,
    });
    await porta.gravarSgh(c, T, (g) =>
      g.corrigirObservacaoMaos({
        id,
        versao: 1,
        agora: '',
        usuario: m.login,
        justificativa: 'Segunda oportunidade foi fricção.',
        observadoEm: `${hoje()}T10:00`,
        categoria: 'medico',
        oportunidades: 2,
        conformes: 2,
        detalhe: [detalhe[0]!, { momento: 'aposContato', acao: 'friccao', luvas: false }],
        observacao: 'ok',
      }),
    );
    expect((await porta.observacoesMaos(c, hoje(), hoje())).itens[0]).toMatchObject({
      conformes: 2,
      versao: 2,
      observacao: 'ok',
    });
    await porta.gravarSgh(c, T, (g) =>
      g.estornarObservacaoMaos({
        id,
        versao: 2,
        agora: `${hoje()}T13:00:00`,
        usuario: m.login,
        justificativa: 'Sessão lançada em duplicidade.',
      }),
    );
    expect((await porta.observacoesMaos(c, hoje(), hoje())).itens).toEqual([]);
    expect((await porta.sessoesMaos(c, hoje(), hoje())).itens[0]).toMatchObject({
      estornadoEm: `${hoje()}T13:00:00`,
      motivoEstorno: 'Sessão lançada em duplicidade.',
    });
    expect(
      await porta.gravarSgh(c, T, (g) =>
        g.registrarConsumoAlcool({
          unidade: m.setor,
          setor: null,
          competencia: competencia(),
          mililitros: 500,
          usuario: m.login,
        }),
      ),
    ).toMatchObject({ criado: true });
    expect(
      await porta.gravarSgh(c, T, (g) =>
        g.registrarConsumoAlcool({
          unidade: m.setor,
          setor: null,
          competencia: competencia(),
          mililitros: 750,
          usuario: m.login,
        }),
      ),
    ).toEqual({ id: null, criado: false });
    expect(await porta.consumoAlcool(c, competencia())).toEqual([
      { unidade: m.setor, setor: 'UTI', mililitros: 750 },
    ]);
    expect(
      await porta.gravarSgh(c, T, (g) =>
        g.registrarConsumoAlcool({
          unidade: m.setor,
          setor: null,
          competencia: '2020-01',
          mililitros: 300,
          usuario: m.login,
        }),
      ),
    ).toMatchObject({ criado: true });
    const consumo = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'confere-f24-ccih-consumo' }, async (e) => ({
      linhas: await e.consultar<{ competencia: unknown; taxa: unknown; calculo: string }>(
        `SELECT DATE_FORMAT(competencia, '%Y-%m') AS competencia, ml_por_paciente_dia AS taxa, calculo
           FROM consumo_preparacao_alcoolica WHERE estabelecimento_id = ? ORDER BY competencia`,
        [m.est],
      ),
      anterior: await e.uma<{ q: unknown }>(
        `SELECT COUNT(*) AS q FROM trilha_auditoria WHERE estabelecimento_id = ?
            AND JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.dados.versaoAnterior.tabela')) = 'consumo_preparacao_alcoolica'
            AND JSON_EXTRACT(dados_depois, '$.dados.versaoAnterior.dados.quantidade_ml') = 500 AND ocorrido_em >= ?`,
        [m.est, inicioTeste],
      ),
    }));
    expect(consumo.linhas.map((l) => [l.competencia, l.taxa === null ? null : Number(l.taxa)])).toEqual([
      ['2020-01', null],
      [competencia(), 150],
    ]);
    expect(consumo.linhas[0]?.calculo).toContain('sem denominador');
    expect(Number(consumo.anterior?.q)).toBe(1);
    expect(
      await codigo(
        porta.gravarSgh(c, T, (g) =>
          g.registrarConsumoAlcool({
            unidade: m.setorOutro,
            setor: null,
            competencia: competencia(),
            mililitros: 1,
            usuario: m.login,
          }),
        ),
      ),
    ).toBe('unidade-inexistente');
  });

  it('o surto e o fechamento da competência da vigilância', async () => {
    const { id } = await porta.gravarSgh(c, T, (g) =>
      g.registrarSurto({
        titulo: 'SURTO SINTETICO',
        tipoSurto: ids.tipoSurto,
        agente: null,
        unidade: m.setor,
        setor: null,
        inicio: hoje(),
        casos: 2,
        medidas: null,
        usuario: m.login,
      }),
    );
    expect(await porta.surto(c, id)).toMatchObject({
      situacao: 'investigacao',
      casos: 2,
      setor: 'UTI',
      registradoPor: m.login,
      versao: 1,
    });
    await porta.gravarSgh(c, T, (g) =>
      g.atualizarSurto({
        id,
        versao: 1,
        agora: `${hoje()}T15:00:00`,
        usuario: m.login,
        situacao: 'encerrado',
        casos: 3,
        medidas: 'Coorte e reforço de precauções.',
        encerradoEm: hoje(),
      }),
    );
    expect((await porta.surtos(c, hoje())).map((s) => [s.id, s.situacao, s.encerradoEm])).toEqual([
      [id, 'encerrado', hoje()],
    ]);
    expect(await porta.surto(outro, id)).toBeNull();
    const f = await porta.gravarSgh(c, T, (g) =>
      g.fecharCompetencia({ competencia: '2026-01', agora: `${hoje()}T16:00:00`, usuario: m.login }),
    );
    expect(
      await codigo(
        porta.gravarSgh(c, T, (g) =>
          g.fecharCompetencia({ competencia: '2026-01', agora: `${hoje()}T16:00:00`, usuario: m.login }),
        ),
      ),
    ).toBe('competencia-fechada');
    await porta.gravarSgh(c, T, (g) =>
      g.reabrirCompetencia({
        id: f.id,
        versao: 1,
        agora: `${hoje()}T17:00:00`,
        usuario: m.login,
        justificativa: 'Ficha de IRAS chegou atrasada.',
      }),
    );
    expect(await porta.competencias(c, ['2026-01'])).toEqual([
      expect.objectContaining({
        competencia: '2026-01',
        situacao: 'reaberta',
        reabertaPor: m.login,
        motivoReabertura: 'Ficha de IRAS chegou atrasada.',
        versao: 2,
      }),
    ]);
    await porta.gravarSgh(c, T, (g) =>
      g.fecharCompetencia({ competencia: '2026-01', agora: `${hoje()}T18:00:00`, usuario: m.login }),
    );
    expect((await porta.versoes(c, 'fechamento_vigilancia_iras', f.id)).map((x) => x.acao)).toEqual([
      'fechamento',
      'reabertura',
    ]);
  });

  it('o que aguarda estrutura (IRAS, liberação, configuração e precaução) falha fechado e não grava nada', async () => {
    for (const leitura of [
      porta.iras(c, 1),
      porta.irasDas(c, [ids.reg]),
      porta.irasNoPeriodo(c, hoje(), hoje()),
      porta.itensConfigurados(c),
      porta.liberacao(c, 1),
      porta.liberacoesDos(c, [1]),
      porta.precaucao(c, 1),
      porta.precaucoesAbertas(c),
      porta.precaucoesDa(c, ids.reg),
    ])
      await expect(leitura).rejects.toMatchObject({ problema: { status: 503, codigo: 'modelo-pendente' } });
    const antes = (await porta.dispositivosDas(c, [ids.reg])).length;
    expect(
      await codigo(
        porta.gravarSgh(c, T, async (g) => {
          await g.registrarDispositivo({
            reg: ids.reg,
            paciente: null,
            leito: { bloco: 'UTI', acomodacao: null, leito: null },
            tipo: 'cvc',
            sitio: null,
            inseridoEm: `${hoje()}T05:00`,
            itemPrescricao: null,
            observacao: null,
            usuario: m.login,
          });
          return g.definirPrecaucao({} as never);
        }),
      ),
    ).toBe('modelo-pendente');
    expect((await porta.dispositivosDas(c, [ids.reg])).length).toBe(antes);
    expect(await codigo(porta.relogio({ ...c, estabelecimento: null }))).toBe('sem-estabelecimento');
  });
});
