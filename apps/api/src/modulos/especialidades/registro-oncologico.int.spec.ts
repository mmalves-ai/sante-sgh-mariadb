// Contrato de efeito do registro oncológico e da radioterapia (09-AREA linha 69) contra o MariaDB real (cliente f22_o2).
// Massa SINTÉTICA com o código "C2073" (nenhuma pessoa real): paciente internado, médico com vínculo, catálogos mínimos
// (CID, morfologia, topografia, estádio, região irradiada, intenção). Prova o que fica no banco: o tumor com o CID, a
// topografia e a morfologia; o estadiamento como evento (com o usuário e o retrato) e os sítios de metástase numerados
// sem repetir; o plano numerado em planejamento; a aprovação com o físico; as sessões numeradas, a 1ª põe o plano em
// andamento e a última o conclui; as recusas do domínio e do banco não gravam nada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaAcompanhamentoOncologicoPropria } from './acompanhamento-oncologico.js';
import { type Autor, PortaRegistroOncologicoPropria } from './registro-oncologico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2073';
const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const camposDe = (e: unknown) => (e instanceof ErroOperacao ? (e.problema['campos'] as unknown) : null);
async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('registro oncológico e radioterapia (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRegistroOncologicoPropria;
  const ids = {
    est: 0,
    usuario: 0,
    paciente: 0,
    profissional: 0,
    fisico: 0,
    atendimento: 0,
    internacao: 0,
    paciente2: 0,
    tipoProtocolo: 0,
    intencao: 0,
  };
  let c: ContextoPortaM18;
  let autor: Autor;
  let seq = 0;
  const chave = () => `c2073-${Date.now()}-${++seq}`;

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar(
        'DELETE s FROM sessao_radioterapia s JOIN tratamento_radioterapia r ON r.id = s.tratamento_radioterapia_id WHERE r.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM tratamento_radioterapia WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM aparelho_radioterapia WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM reacao_tratamento_oncologico WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE v FROM evento_tratamento_oncologico v JOIN ciclo_quimioterapia q ON q.id = v.ciclo_quimioterapia_id JOIN tratamento_oncologico t ON t.id = q.tratamento_oncologico_id WHERE t.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar(
        'DELETE q FROM ciclo_quimioterapia q JOIN tratamento_oncologico t ON t.id = q.tratamento_oncologico_id WHERE t.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM tratamento_oncologico WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE v FROM acompanhamento_oncologico_evento v JOIN acompanhamento_oncologico a ON a.id = v.acompanhamento_oncologico_id WHERE a.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM acompanhamento_oncologico WHERE estabelecimento_id = ?', [ids.est]);
      for (const t of ['metastase_paciente', 'estadiamento_tumor'])
        await e.executar(
          `DELETE x FROM ${t} x JOIN diagnostico_oncologico d ON d.id = x.diagnostico_oncologico_id WHERE d.estabelecimento_id = ?`,
          [ids.est],
        );
      await e.executar('DELETE FROM diagnostico_oncologico WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM lotacao_profissional WHERE estabelecimento_id = ?', [ids.est]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2073' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['c2073.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c2073.teste', 'USUARIO SINTETICO C2073', agora],
      );
      const cod = (tabela: string, codigo: string, extra = '', vals: unknown[] = []) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao${extra ? `, ${extra}` : ''}, criado_em) VALUES (?, ?${vals.map(() => ', ?').join('')}, ?)`,
          [codigo, `${tabela.toUpperCase()} ${P}`, ...vals, agora],
        );
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'ONCOLOGIA SINTETICA', agora],
      );
      const ui = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'enfermaria', ?)",
        [ids.est, ua, `${P}-UI`, 'ONCOLOGIA SINTETICA', agora],
      );
      const bloco = await garantir(
        e,
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'ON'],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'ON', 'BLOCO SINTETICO', agora],
      );
      const catAc = await garantir(
        e,
        'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
        [`${P}-ENF`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'enfermaria', ?)",
        [`${P}-ENF`, 'ENFERMARIA C2073', agora],
      );
      const acomodacao = await garantir(
        e,
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, '01'],
        `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id,
           codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [ids.est, bloco, ui, catAc, '01', 'SALA 01', agora],
      );
      const sit = await garantir(
        e,
        "SELECT id FROM situacao_leito WHERE situacao_base = 'livre' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES (?, 'LIVRE', 'livre', ?)",
        [`${P}-LIVRE`, agora],
      );
      const leito = await garantir(
        e,
        'SELECT id FROM leito_hospitalar WHERE unidade_internacao_id = ? AND codigo = ?',
        [ui, 'A'],
        `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id,
           codigo, situacao_leito_id, criado_em) VALUES (?, ?, ?, ?, 'A', ?, ?)`,
        [ids.est, ui, acomodacao, bloco, sit, agora],
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['O7'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('O7', 'CARATER C2073', 'teste', ?)",
        [agora],
      );
      const catAt = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO C2073', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_admissao WHERE codigo = ?',
        [`${P}-ELE`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'ELETIVA C2073', FALSE, ?)",
        [`${P}-ELE`, agora],
      );
      const modal = await cod('modalidade_internacao', `${P}-CLI`);
      const esp = await cod('especialidade_medica', `${P}-ONC`);
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA C2073', 'operadora', 'ativa', ?)",
        [`${P}-INT`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)',
          [nome, '1970-03-10', agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICA ${P}`);
      const pm = await pessoa(`MEDICO SINTETICO ${P}`);
      const pf = await pessoa(`FISICO SINTETICO ${P}`);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 920_730_101, agora],
      );
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      // O físico médico (CBO 2131-50) com lotação vigente no estabelecimento; o médico não tem lotação de físico.
      ids.fisico = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      const cboFisico = await garantir(
        e,
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        ['213150'],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, versao_fonte, criado_em) VALUES ('213150', 'FISICO (MEDICINA) C2073', TRUE, 'teste C2073', ?)",
        [agora],
      );
      await e.inserir(
        `INSERT INTO lotacao_profissional (profissional_id, estabelecimento_id, ocupacao_cbo_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.fisico, ids.est, cboFisico, agora],
      );
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, ids.profissional, agora, agora],
      );
      ids.internacao = await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
           carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id,
           especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)`,
        [
          ids.est,
          `${P}-IN1`,
          ids.atendimento,
          ids.paciente,
          agora,
          carater,
          modal,
          ui,
          leito,
          acomodacao,
          esp,
          ids.profissional,
          fonte,
          agora,
        ],
      );
      // Catálogos: os oficiais (CID-10 e CID-O) já carregados no cliente; topografia, estádio, região e intenção
      // garantidos aqui pelo código (como as sementes e o carregador os gravam).
      for (const [c_, d] of [
        ['C50.4', 'Quadrante superior externo da mama'],
        ['C34.1', 'Lobo superior, brônquio ou pulmão'],
        ['C22.0', 'Fígado'],
      ])
        await garantir(
          e,
          'SELECT id FROM topografia_tumor WHERE codigo_cid_o = ?',
          [c_],
          "INSERT INTO topografia_tumor (codigo_cid_o, descricao, categoria, versao_fonte, criado_em) VALUES (?, ?, ?, 'teste C2073', ?)",
          [c_, d, c_!.slice(0, 3), agora],
        );
      for (const [c_, o] of [
        ['IIB', 8],
        ['IV', 14],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM estadio_clinico WHERE codigo = ?',
          [c_],
          "INSERT INTO estadio_clinico (codigo, descricao, sistema, tipo, ordem, criado_em) VALUES (?, ?, 'tnm', 'grupo', ?, ?)",
          [c_, `Estádio ${c_}`, o, agora],
        );
      await cod('regiao_irradiada', 'mama');
      ids.intencao = await cod('intencao_tratamento_oncologico', 'adjuvante');
      ids.tipoProtocolo = await cod('tipo_protocolo_oncologico', `${P}-QT`);
      const pp2 = await pessoa(`PACIENTE SINTETICA 2 ${P}`);
      ids.paciente2 = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp2],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp2, 920_730_102, agora],
      );
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuario, ids.est, ids.profissional, agora],
      );
    });
    porta = new PortaRegistroOncologicoPropria(nucleo);
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'teste-c2073',
    } as ContextoPortaM18;
    autor = { paciente: ids.paciente, internacao: ids.internacao, profissional: ids.profissional };
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2073' }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'c2073' },
      async (l) => Number((await l.uma<{ n: number }>(sql, p))?.n ?? 0),
    );
  const tumor = {
    cid: 'C50.4',
    topografia: 'C50.4',
    morfologia: '8500/3',
    diagnosticadoEm: '2026-10-01',
    baseDiagnostica: 'histologia_primario' as const,
    lateralidade: 'esquerda' as const,
    ecog: 1,
    observacao: null,
  };
  let idTumor = 0;
  let idPlano = 0;

  it('registra o tumor com CID, topografia e morfologia; recusa o repetido e o incoerente sem gravar', async () => {
    const r = await porta.registrarTumor(c, autor, tumor, chave());
    idTumor = r.id;
    const linha = await nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'c' },
      (l) =>
        l.uma<Record<string, unknown>>(
          `SELECT d.paciente_id, d.atendimento_id, d.lateralidade, d.base_diagnostica, d.situacao, d.tumor_primario_multiplo,
                cid.codigo_termo AS cid, tp.codigo_cid_o, mo.codigo_termo AS morfologia, d.criado_por
           FROM diagnostico_oncologico d JOIN termo_terminologia cid ON cid.id = d.cid_termo_terminologia_id
           JOIN topografia_tumor tp ON tp.id = d.topografia_tumor_id
           LEFT JOIN termo_terminologia mo ON mo.id = d.morfologia_termo_terminologia_id WHERE d.id = ?`,
          [idTumor],
        ),
    );
    expect(linha).toMatchObject({
      paciente_id: ids.paciente,
      atendimento_id: ids.atendimento,
      lateralidade: 'esquerda',
      base_diagnostica: 'histologia_primario',
      situacao: 'ativo',
      cid: 'C504',
      codigo_cid_o: 'C50.4',
      morfologia: 'M8500/3',
      criado_por: ids.usuario,
    });
    expect(Number(linha?.['tumor_primario_multiplo'])).toBe(0);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'diagnostico_oncologico' AND entidade_id = ?",
        [String(idTumor)],
      ),
    ).toBeGreaterThan(0);
    await expect(porta.registrarTumor(c, autor, tumor, chave())).rejects.toSatisfy(
      (e) => codigoDe(e) === 'tumor-ja-registrado',
    );
    await expect(
      porta.registrarTumor(c, autor, { ...tumor, cid: 'D05.1', topografia: 'C34.1' }, chave()),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'tumor-invalido');
    // A topografia de outro sítio (pulmão) com o CID da mama é recusada no campo da topografia.
    await expect(
      porta.registrarTumor(c, autor, { ...tumor, topografia: 'C34.1', morfologia: '8140/3' }, chave()),
    ).rejects.toSatisfy(
      (e) => codigoDe(e) === 'tumor-invalido' && JSON.stringify(camposDe(e)) === '["topografia"]',
    );
    expect(
      await contar('SELECT COUNT(*) AS n FROM diagnostico_oncologico WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(1);
  });

  it('estadia como evento (com usuário e retrato) e numera os sítios de metástase sem repetir', async () => {
    await porta.estadiar(
      c,
      autor,
      {
        tumor: idTumor,
        tipo: 'clinico',
        data: '2026-10-05',
        t: 'cT2',
        n: 'N1',
        m: 'M0',
        estadio: 'IIB',
        metastases: [],
      },
      chave(),
    );
    await expect(
      porta.estadiar(
        c,
        autor,
        {
          tumor: idTumor,
          tipo: 'clinico',
          data: '2026-11-01',
          t: 'T2',
          n: 'N1',
          m: 'M1',
          estadio: 'IIB',
          metastases: [],
        },
        chave(),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'estadiamento-invalido');
    await porta.estadiar(
      c,
      autor,
      {
        tumor: idTumor,
        tipo: 'recidiva',
        data: '2026-11-10',
        t: 'T2',
        n: 'N1',
        m: 'M1b',
        estadio: 'IV',
        metastases: ['C34.1', 'C22.0'],
      },
      chave(),
    );
    await porta.estadiar(
      c,
      autor,
      {
        tumor: idTumor,
        tipo: 'recidiva',
        data: '2026-11-12',
        t: 'T2',
        n: 'N1',
        m: 'M1b',
        estadio: 'IV',
        metastases: ['C22.0'],
      },
      chave(),
    );
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM estadiamento_tumor WHERE diagnostico_oncologico_id = ? AND operacao = 'inclusao' AND usuario_id = ? AND edicao_sistema = '8'",
        [idTumor, ids.usuario],
      ),
    ).toBe(3);
    expect(
      await contar('SELECT COUNT(*) AS n FROM metastase_paciente WHERE diagnostico_oncologico_id = ?', [
        idTumor,
      ]),
    ).toBe(2);
    const lido = await porta.doPaciente(c, ids.paciente);
    expect(lido.tumores[0]?.estadiamentos.map((x) => x.tnm)).toEqual(['rT2N1M1b', 'rT2N1M1b', 'cT2N1M0']);
    expect(lido.tumores[0]?.metastases.map((x) => [x.sequencia, x.topografia])).toEqual([
      [1, 'C34.1'],
      [2, 'C22.0'],
    ]);
  });

  it('planeja, aprova com o físico e registra as sessões até concluir; recusa dose além da prescrita', async () => {
    const plano = {
      tumor: idTumor,
      regiao: 'mama',
      aparelho: null,
      intencao: 'adjuvante',
      tecnica: 'conformacional' as const,
      descricaoArea: null,
      doseTotalCgy: 400,
      doseFracaoCgy: 200,
      fracoesPrevistas: 2,
      fracoesPorSemana: 5,
      energia: '6 megavolts',
      concomitanteQuimioterapia: false,
      inicioPrevisto: null,
    };
    await expect(porta.planejar(c, autor, { ...plano, fracoesPrevistas: 3 }, chave())).rejects.toSatisfy(
      (e) => codigoDe(e) === 'plano-radioterapia-invalido',
    );
    const r = await porta.planejar(c, autor, plano, chave());
    idPlano = r.id;
    expect(r.numero).toBeTruthy();
    const sessao = {
      desfecho: 'realizada' as const,
      doseAplicadaCgy: 200,
      numeroCampos: 2,
      motivo: null,
      intercorrencias: null,
    };
    await expect(porta.registrarSessao(c, autor, { ...sessao, plano: idPlano }, chave())).rejects.toSatisfy(
      (e) => codigoDe(e) === 'sessao-radioterapia-invalida',
    );
    // O físico tem de ser físico médico lotado no estabelecimento: o médico e um id inexistente são recusados.
    for (const fisico of [ids.profissional, 999_999_999])
      await expect(porta.aprovar(c, autor, { id: idPlano, fisico, versao: 1 }, chave())).rejects.toSatisfy(
        (e) => codigoDe(e) === 'aprovacao-plano-invalida' && JSON.stringify(camposDe(e)) === '["fisico"]',
      );
    expect((await porta.cadastros(c)).fisicos.map((f) => f.codigo)).toEqual([String(ids.fisico)]);
    await porta.aprovar(c, autor, { id: idPlano, fisico: ids.fisico, versao: 1 }, chave());
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM tratamento_radioterapia WHERE id = ? AND situacao = 'aprovado' AND fisico_profissional_id = ?",
        [idPlano, ids.fisico],
      ),
    ).toBe(1);
    expect((await porta.registrarSessao(c, autor, { ...sessao, plano: idPlano }, chave())).situacao).toBe(
      'em_andamento',
    );
    await porta.registrarSessao(
      c,
      autor,
      {
        desfecho: 'falta',
        doseAplicadaCgy: null,
        numeroCampos: null,
        motivo: 'Paciente não compareceu',
        intercorrencias: null,
        plano: idPlano,
      },
      chave(),
    );
    await expect(
      porta.registrarSessao(c, autor, { ...sessao, doseAplicadaCgy: 230, plano: idPlano }, chave()),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'sessao-radioterapia-invalida');
    expect((await porta.registrarSessao(c, autor, { ...sessao, plano: idPlano }, chave())).situacao).toBe(
      'concluido',
    );
    const lido = (await porta.doPaciente(c, ids.paciente)).planos[0]!;
    expect(lido).toMatchObject({ situacao: 'concluido', fisico: true, realizadas: 2, doseAcumuladaCgy: 400 });
    expect(lido.inicio).toBeTruthy();
    expect(lido.fim).toBeTruthy();
    expect(lido.sessoes.map((s) => [s.sequencia, s.situacao])).toEqual([
      [1, 'realizada'],
      [2, 'falta'],
      [3, 'realizada'],
    ]);
    await expect(
      porta.encerrar(c, autor, { id: idPlano, situacao: 'interrompido', motivo: 'x', versao: 99 }, chave()),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'encerramento-plano-invalido');
  });

  it('a mesma chave de idempotência não grava duas vezes; aparelho incluído por estabelecimento', async () => {
    const k = chave();
    const a = await porta.incluirAparelho(
      c,
      {
        codigo: `${P}-AL1`,
        descricao: 'ACELERADOR SINTETICO',
        modalidade: 'acelerador_linear',
        modelo: null,
        numeroSerie: null,
        energiaMaximaMev: 18,
      },
      k,
    );
    const b = await porta.incluirAparelho(
      c,
      {
        codigo: `${P}-AL1`,
        descricao: 'ACELERADOR SINTETICO',
        modalidade: 'acelerador_linear',
        modelo: null,
        numeroSerie: null,
        energiaMaximaMev: 18,
      },
      k,
    );
    expect(b.id).toBe(a.id);
    expect((await porta.cadastros(c)).aparelhos.map((x) => x.codigo)).toContain(`${P}-AL1`);
  });
  // C2-090 (03-PEP L111): acompanhamento do tumor (linha do tempo por evento) e reações do tratamento (CTCAE).
  it('acompanha o tumor com evento a cada mudança e registra a reação com grau e conduta; recusas não gravam', async () => {
    const acomp = new PortaAcompanhamentoOncologicoPropria(nucleo);
    const tumorId = (await porta.doPaciente(c, ids.paciente)).tumores[0]!.id;
    const base = {
      acompanhamento: null,
      versao: null,
      tumor: tumorId,
      situacaoTumor: 'presente',
      resposta: null,
      primeiroTratamentoEm: null,
      recidivaEm: null,
      obitoEm: null,
      observacao: null,
    };
    const a1 = await acomp.registrarAcompanhamento(
      c,
      autor,
      { ...base, classificacao: 'em_tratamento' },
      chave(),
    );
    expect(a1.tipo).toBe('classificacao');
    await expect(
      acomp.registrarAcompanhamento(c, autor, { ...base, classificacao: 'em_tratamento' }, chave()),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'acompanhamento-existente');
    const recidivaSemData = acomp.registrarAcompanhamento(
      c,
      autor,
      { ...base, acompanhamento: a1.id, versao: 1, classificacao: 'recidiva' },
      chave(),
    );
    await expect(recidivaSemData).rejects.toSatisfy(
      (e) => codigoDe(e) === 'acompanhamento-invalido' && JSON.stringify(camposDe(e)).includes('recidivaEm'),
    );
    const hoje = new Date().toISOString().slice(0, 10);
    const a2 = await acomp.registrarAcompanhamento(
      c,
      autor,
      {
        ...base,
        acompanhamento: a1.id,
        versao: 1,
        classificacao: 'recidiva',
        situacaoTumor: 'metastase',
        recidivaEm: hoje,
        observacao: 'Recidiva em controle de imagem',
      },
      chave(),
    );
    expect(a2).toMatchObject({ id: a1.id, versao: 2, tipo: 'recidiva' });
    await expect(
      acomp.registrarAcompanhamento(
        c,
        autor,
        { ...base, acompanhamento: a1.id, versao: 1, classificacao: 'paliativo' },
        chave(),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'conflito-versao');

    const r1 = await acomp.registrarReacao(
      c,
      autor,
      {
        acompanhamento: a1.id,
        tratamento: null,
        ciclo: null,
        categoria: 'hematologica',
        descricao: 'Neutropenia febril',
        grau: 3,
        evolucao: 'nova',
        avaliadoEm: `${hoje}T08:00`,
        conduta: 'Antibiótico e fator estimulador',
        doseAjustada: false,
        tratamentoSuspenso: false,
      },
      chave(),
    );
    const semConduta = {
      acompanhamento: a1.id,
      tratamento: null,
      ciclo: null,
      categoria: 'gastrointestinal',
      descricao: 'Mucosite',
      grau: 4,
      evolucao: 'nova',
      avaliadoEm: `${hoje}T09:00`,
      conduta: null,
      doseAjustada: true,
      tratamentoSuspenso: false,
    };
    await expect(acomp.registrarReacao(c, autor, semConduta, chave())).rejects.toSatisfy(
      (e) =>
        codigoDe(e) === 'reacao-invalida' &&
        JSON.stringify(camposDe(e)).includes('conduta') &&
        JSON.stringify(camposDe(e)).includes('tratamento'),
    );
    await expect(
      acomp.registrarReacao(c, autor, { ...semConduta, tratamento: 999999999, conduta: 'x' }, chave()),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');

    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'confere-c2090' }, async (e) => {
      const a = await e.uma<Record<string, unknown>>(
        `SELECT classificacao_paciente, situacao_tumor, DATE_FORMAT(recidiva_em, '%Y-%m-%d') AS recidiva_em, versao,
                diagnostico_oncologico_id, responsavel_profissional_id, ativo, criado_por
           FROM acompanhamento_oncologico WHERE id = ?`,
        [a1.id],
      );
      expect(a).toMatchObject({
        classificacao_paciente: 'recidiva',
        situacao_tumor: 'metastase',
        recidiva_em: hoje,
      });
      expect(Number(a!['versao'])).toBe(2);
      expect(Number(a!['diagnostico_oncologico_id'])).toBe(tumorId);
      expect(Number(a!['responsavel_profissional_id'])).toBe(ids.profissional);
      const ev = await e.consultar<Record<string, unknown>>(
        'SELECT operacao, tipo_evento, usuario_id, observacao, JSON_UNQUOTE(JSON_EXTRACT(dados, "$.classificacao_paciente")) AS cl FROM acompanhamento_oncologico_evento WHERE acompanhamento_oncologico_id = ? ORDER BY id',
        [a1.id],
      );
      expect(ev.map((x) => [x['operacao'], x['tipo_evento'], x['cl']])).toEqual([
        ['inclusao', 'classificacao', 'em_tratamento'],
        ['alteracao', 'recidiva', 'recidiva'],
      ]);
      expect(Number(ev[1]!['usuario_id'])).toBe(ids.usuario);
      expect(ev[1]!['observacao']).toBe('Recidiva em controle de imagem');
      const rs = await e.consultar<Record<string, unknown>>(
        'SELECT id, grau, categoria, evolucao, conduta, dose_ajustada, acompanhamento_oncologico_id, profissional_id FROM reacao_tratamento_oncologico WHERE paciente_id = ? AND estabelecimento_id = ?',
        [ids.paciente, ids.est],
      );
      expect(rs).toHaveLength(1);
      expect(Number(rs[0]!['id'])).toBe(r1.id);
      expect(Number(rs[0]!['grau'])).toBe(3);
      expect(rs[0]).toMatchObject({ categoria: 'hematologica', evolucao: 'nova' });
      expect(Number(rs[0]!['acompanhamento_oncologico_id'])).toBe(a1.id);
      expect(Number(rs[0]!['profissional_id'])).toBe(ids.profissional);
    });
    const lido = await acomp.doPaciente(c, ids.paciente);
    expect(lido.acompanhamentos[0]).toMatchObject({ id: a1.id, classificacao: 'recidiva', versao: 2 });
    expect(lido.acompanhamentos[0]!.eventos.map((x) => x.tipo)).toEqual(['recidiva', 'classificacao']);
    expect(lido.reacoes.map((x) => [x.grau, x.categoria])).toEqual([[3, 'hematologica']]);
  });

  // C2-090 rodada 3: a reação ligada ao ciclo herda o tratamento, recusa ciclo de outro tratamento ou de outro paciente,
  // e a reação que suspende o tratamento suspende os ciclos ativos dele (andamento e evento) na mesma transação.
  it('reação ligada ao ciclo: herda o tratamento, recusa ciclo alheio e a suspensão para os ciclos ativos', async () => {
    const acomp = new PortaAcompanhamentoOncologicoPropria(nucleo);
    const lido = await acomp.doPaciente(c, ids.paciente);
    const acompanhamento = lido.acompanhamentos[0]!.id;
    const tumorId = (await porta.doPaciente(c, ids.paciente)).tumores[0]!.id;
    const ciclos: Record<string, number> = {};
    const trat: Record<string, number> = {};
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2090-ciclo' }, async (e) => {
      const agora = new Date();
      for (const [k, pac] of [
        ['T1', ids.paciente],
        ['T2', ids.paciente],
        ['T3', ids.paciente2],
      ] as const)
        trat[k] = await e.inserir(
          `INSERT INTO tratamento_oncologico (estabelecimento_id, numero, paciente_id, diagnostico_oncologico_id,
             tipo_protocolo_oncologico_id, intencao_tratamento_oncologico_id, responsavel_profissional_id, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'em_andamento', ?)`,
          [ids.est, `${P}-${k}`, pac, tumorId, ids.tipoProtocolo, ids.intencao, ids.profissional, agora],
        );
      for (const [k, t, num, sit] of [
        ['C1', 'T1', 1, 'previsto'],
        ['C2', 'T1', 2, 'liberado'],
        ['C3', 'T1', 3, 'concluido'],
        ['C4', 'T2', 1, 'previsto'],
        ['C5', 'T3', 1, 'previsto'],
      ] as const)
        ciclos[k] = await e.inserir(
          `INSERT INTO ciclo_quimioterapia (tratamento_oncologico_id, numero_ciclo, data_prevista, situacao, criado_em)
           VALUES (?, ?, '2026-12-01', ?, ?)`,
          [trat[t], num, sit, agora],
        );
    });
    const hoje = new Date().toISOString().slice(0, 10);
    const reacao = {
      acompanhamento,
      tratamento: null as number | null,
      ciclo: ciclos['C1']! as number | null,
      categoria: 'hematologica',
      descricao: 'Plaquetopenia',
      grau: 3,
      evolucao: 'nova',
      avaliadoEm: `${hoje}T10:00`,
      conduta: 'Reduzir a dose do próximo ciclo',
      doseAjustada: true,
      tratamentoSuspenso: false,
    };
    const rDose = await acomp.registrarReacao(c, autor, reacao, chave());
    await expect(
      acomp.registrarReacao(c, autor, { ...reacao, tratamento: trat['T2']! }, chave()),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'ciclo-de-outro-tratamento');
    await expect(
      acomp.registrarReacao(c, autor, { ...reacao, ciclo: ciclos['C5']! }, chave()),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
    const rSusp = await acomp.registrarReacao(
      c,
      autor,
      {
        ...reacao,
        descricao: 'Neutropenia febril',
        grau: 4,
        conduta: 'Suspender a quimioterapia e internar',
        doseAjustada: false,
        tratamentoSuspenso: true,
      },
      chave(),
    );

    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'confere-c2090-ciclo' }, async (e) => {
      const rs = await e.consultar<Record<string, unknown>>(
        `SELECT id, tratamento_oncologico_id, ciclo_quimioterapia_id, dose_ajustada, tratamento_suspenso
           FROM reacao_tratamento_oncologico WHERE ciclo_quimioterapia_id IS NOT NULL AND estabelecimento_id = ? ORDER BY id`,
        [ids.est],
      );
      expect(
        rs.map((r) => [
          Number(r['id']),
          Number(r['tratamento_oncologico_id']),
          Number(r['ciclo_quimioterapia_id']),
        ]),
      ).toEqual([
        [rDose.id, trat['T1'], ciclos['C1']],
        [rSusp.id, trat['T1'], ciclos['C1']],
      ]);
      expect(rs.map((r) => [Number(r['dose_ajustada']), Number(r['tratamento_suspenso'])])).toEqual([
        [1, 0],
        [0, 1],
      ]);
      const sit = await e.consultar<Record<string, unknown>>(
        'SELECT id, situacao, versao FROM ciclo_quimioterapia WHERE id IN (?, ?, ?, ?, ?) ORDER BY id',
        [ciclos['C1'], ciclos['C2'], ciclos['C3'], ciclos['C4'], ciclos['C5']],
      );
      expect(Object.fromEntries(sit.map((r) => [Number(r['id']), r['situacao']]))).toEqual({
        [ciclos['C1']!]: 'suspenso',
        [ciclos['C2']!]: 'suspenso',
        [ciclos['C3']!]: 'concluido',
        [ciclos['C4']!]: 'previsto',
        [ciclos['C5']!]: 'previsto',
      });
      expect(Number(sit.find((r) => Number(r['id']) === ciclos['C1'])!['versao'])).toBe(2);
      const ev = await e.consultar<Record<string, unknown>>(
        `SELECT ciclo_quimioterapia_id, evento, categoria, motivo, usuario_id FROM evento_tratamento_oncologico
          WHERE ciclo_quimioterapia_id IN (?, ?, ?, ?, ?) ORDER BY ciclo_quimioterapia_id`,
        [ciclos['C1'], ciclos['C2'], ciclos['C3'], ciclos['C4'], ciclos['C5']],
      );
      expect(ev.map((x) => [Number(x['ciclo_quimioterapia_id']), x['evento'], x['categoria']])).toEqual([
        [ciclos['C1'], 'ciclo_suspenso', 'toxicidade'],
        [ciclos['C2'], 'ciclo_suspenso', 'toxicidade'],
      ]);
      expect(String(ev[0]!['motivo'])).toBe('Reação grau 4: Neutropenia febril');
      expect(Number(ev[0]!['usuario_id'])).toBe(ids.usuario);
    });
  });
});
