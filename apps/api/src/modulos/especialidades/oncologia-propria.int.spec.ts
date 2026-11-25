// Contrato de efeito da oncologia sobre o banco próprio (C2-090, 03-PEP L111; cliente f22_o5). Massa SINTÉTICA com o
// código "C2090Q" (nenhuma pessoa real): um paciente internado, o médico com o vínculo, um farmacêutico (outro
// usuário), duas prescrições vigentes, o diagnóstico oncológico e os cadastros (tipo de protocolo, intenção).
// Prova o que fica no banco: a versão do protocolo (código + versão, hash, conteúdo publicado), o tratamento aberto
// pelo primeiro ciclo do curso, o ciclo com a versão e as doses, a ligação com a prescrição (e o desligamento com o
// motivo), a validação por outra pessoa, o ajuste com a versão anterior no evento, a suspensão e a retomada, a
// revogação da versão (com a recontagem) e a inativação do protocolo; e as recusas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import type { DoseCalculada } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaEspecialidadesPropria } from './porta-propria.js';
import type { ContextoEspecialidades } from './porta.js';
import type { NovoCicloOncologico, NovoProtocoloOncologico } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2090Q';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
async function recusado(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return codigoDe(e);
  }
  throw new Error('era para recusar');
}

describe.skipIf(SEM_BANCO)('oncologia na porta própria (MariaDB, contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEspecialidadesPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    farma: 0,
    paciente: 0,
    profissional: 0,
    atendimento: 0,
    internacao: 0,
    prescricao: 0,
    prescricao2: 0,
    sexoF: 0,
    tipoProtocolo: 0,
    intencao: 0,
    diagnostico: 0,
  };
  let ctx: ContextoEspecialidades;
  let ctxFarma: ContextoEspecialidades;
  const trilha: TrilhaDaGravacao = {
    estabelecimento: null,
    usuario: null,
    acao: 'inclusao',
    entidade: 'ciclo_quimioterapia',
    entidadeId: null,
    correlacao: 'teste-c2090',
    dadosDepois: { tela: 'oncologia' },
  };
  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ ...ctx, correlacao: 'c2090' }, async (l) =>
      Number((await l.uma<{ n: number }>(sql, p))?.['n'] ?? 0),
    );
  const linha = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ ...ctx, correlacao: 'c2090' }, (l) => l.uma(sql, p));

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar('DELETE FROM evento_tratamento_oncologico WHERE estabelecimento_id IN (?, ?)', [
        ids.est,
        ids.outroEst,
      ]);
      await e.executar(
        `DELETE cp FROM ciclo_quimioterapia_prescricao cp JOIN ciclo_quimioterapia c ON c.id = cp.ciclo_quimioterapia_id
           JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id WHERE t.estabelecimento_id = ?`,
        [ids.est],
      );
      await e.executar(
        `DELETE c FROM ciclo_quimioterapia c JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id
          WHERE t.estabelecimento_id = ?`,
        [ids.est],
      );
      await e.executar('DELETE FROM tratamento_oncologico WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar("DELETE FROM protocolo_quimioterapia WHERE codigo LIKE 'C2090%'");
      await e.executar('DELETE FROM diagnostico_oncologico WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM prescricao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id = ?', [ids.est]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-c2090' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.outroEst] });
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['c2090.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c2090.teste', 'USUARIO SINTETICO C2090', agora],
      );
      ids.farma = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['c2090.farma'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c2090.farma', 'FARMACEUTICO SINTETICO C2090', agora],
      );
      const cat = (tabela: string, codigo: string, extra = '', extraValor: unknown[] = []) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao${extra ? `, ${extra}` : ''}, criado_em) VALUES (?, ?${extraValor.map(() => ', ?').join('')}, ?)`,
          [codigo, `${tabela.toUpperCase()} ${P}`, ...extraValor, agora],
        );
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'CENTRO OBSTETRICO SINTETICO', agora],
      );
      const ui = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'enfermaria', ?)",
        [ids.est, ua, `${P}-UI`, 'OBSTETRICIA SINTETICA', agora],
      );
      const bloco = await garantir(
        e,
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'CO'],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'CO', 'BLOCO SINTETICO', agora],
      );
      const catAc = await garantir(
        e,
        'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
        [`${P}-ENF`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'enfermaria', ?)",
        [`${P}-ENF`, 'ENFERMARIA C2090', agora],
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
        ['Q9'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('Q9', 'CARATER C2090', 'teste', ?)",
        [agora],
      );
      const catAt = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO C2090', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_admissao WHERE codigo = ?',
        [`${P}-URG`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'URGENCIA C2090', TRUE, ?)",
        [`${P}-URG`, agora],
      );
      const modal = await cat('modalidade_internacao', `${P}-OBS`);
      const esp = await cat('especialidade_medica', `${P}-GO`);
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA C2090', 'operadora', 'ativa', ?)",
        [`${P}-INT`, agora],
      );
      const sexoF = (ids.sexoF = await garantir(
        e,
        "SELECT id FROM sexo WHERE sigla = 'F'",
        [],
        "INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES ('F', 'FEMININO', 'F', ?)",
        [agora],
      ));
      const pessoa = (nome: string, sexo: number | null) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, sexo_id, data_nascimento, criado_em) VALUES (?, ?, ?, ?)',
          [nome, sexo, '1996-04-12', agora],
        );
      const pp = await pessoa(`PACIENTE ONCO SINTETICA ${P}`, sexoF);
      const pm = await pessoa(`MEDICA SINTETICA ${P}`, null);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 920_090_101, agora],
      );
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const cbo = await garantir(
        e,
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225250'",
        [],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES ('225250', 'MEDICO GINECOLOGISTA E OBSTETRA', TRUE, ?)",
        [agora],
      );
      await garantir(
        e,
        'SELECT id FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?',
        [ids.profissional, cbo],
        'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, FALSE, ?)',
        [ids.profissional, cbo, agora],
      );
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuario, ids.est, ids.profissional, agora],
      );
      const entrada = new Date('2026-11-20T09:00:00Z');
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, ids.profissional, entrada, agora],
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
          entrada,
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
      const prescricao = (numero: number, situacao: string, suspensa: Date | null) =>
        e.inserir(
          `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
             situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, suspensa_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ids.est,
            numero,
            ids.paciente,
            ids.atendimento,
            ids.profissional,
            situacao,
            entrada,
            new Date('2026-11-20T13:00:00Z'),
            new Date('2026-11-21T13:00:00Z'),
            suspensa,
            agora,
          ],
        );
      ids.prescricao = await prescricao(920_090_001, 'vigente', null);
      ids.prescricao2 = await prescricao(920_090_002, 'vigente', null);
      ids.tipoProtocolo = await cat('tipo_protocolo_oncologico', `${P}-QT`);
      ids.intencao = await garantir(
        e,
        'SELECT id FROM intencao_tratamento_oncologico WHERE codigo = ?',
        [`${P}-ADJ`],
        'INSERT INTO intencao_tratamento_oncologico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-ADJ`, 'ADJUVANTE C2090', agora],
      );
      const termo = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM termo_terminologia', []);
      const topo = await garantir(
        e,
        'SELECT id FROM topografia_tumor WHERE codigo_cid_o = ?',
        ['C50.4'],
        "INSERT INTO topografia_tumor (codigo_cid_o, descricao, categoria, versao_fonte, criado_em) VALUES ('C50.4', 'Quadrante superior externo da mama', 'C50', 'teste C2090', ?)",
        [agora],
      );
      ids.diagnostico = await e.inserir(
        `INSERT INTO diagnostico_oncologico (estabelecimento_id, paciente_id, cid_termo_terminologia_id, topografia_tumor_id,
           diagnosticado_em, base_diagnostica, profissional_id, criado_em) VALUES (?, ?, ?, ?, '2026-10-01', 'histologia_primario', ?, ?)`,
        [ids.est, ids.paciente, Number(termo?.id), topo, ids.profissional, agora],
      );
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-c2090' };
    ctxFarma = { ...ctx, usuario: ids.farma };
    porta = new PortaEspecialidadesPropria(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-c2090' }, async (e) => {
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.outroEst] });
      await limpar(e);
    });
    await nucleo.encerrar();
  });

  const protocolo = (x: Partial<NovoProtocoloOncologico> = {}): NovoProtocoloOncologico => ({
    codigo: 'C2090-AC',
    nome: 'DOXORRUBICINA E CICLOFOSFAMIDA',
    tipo: ids.tipoProtocolo,
    intervaloDias: 21,
    ciclos: 4,
    indicacao: null,
    referencia: 'Diretriz sintética C2090',
    farmacos: [
      { nome: 'doxorrubicina', dose: 60, unidade: 'mg/m2', via: 'iv', dias: [1] },
      {
        nome: 'ciclofosfamida',
        dose: 600,
        unidade: 'mg/m2',
        via: 'iv',
        dias: [1],
        administracao: 'SF 250 mL em 30 min',
      },
    ],
    hash: 'a'.repeat(64),
    vinculo: ids.profissional,
    usuario: 'c2090.teste',
    ...x,
  });
  const doses: DoseCalculada[] = [
    {
      farmaco: 'doxorrubicina',
      via: 'iv',
      dias: [1],
      prescrita: 60,
      unidade: 'mg/m2',
      base: 1.8,
      calculada: 108,
      final: 108,
      conta: '60 x 1,8',
    },
  ];
  const ciclo = (protocoloId: number, x: Partial<NovoCicloOncologico> = {}): NovoCicloOncologico => ({
    internacao: ids.internacao,
    prontuario: 920_090_101,
    paciente: ids.paciente,
    protocolo: protocoloId,
    codigoProtocolo: 'C2090-AC',
    numero: 1,
    dataPrevista: '2026-11-20',
    pesoKg: 70,
    alturaCm: 170,
    superficieM2: 1.8,
    creatininaMgDl: null,
    clearanceMlMin: null,
    reducaoPct: 0,
    motivoReducao: null,
    justificativaIntervalo: null,
    doses,
    curso: 1,
    motivoCurso: null,
    intencao: ids.intencao,
    vinculo: ids.profissional,
    usuario: 'c2090.teste',
    ...x,
  });
  const gravar = <T>(c: ContextoEspecialidades, fn: Parameters<PortaEspecialidadesPropria['gravarSgh']>[2]) =>
    porta.gravarSgh(c, trilha, fn) as Promise<T>;

  it('publica as versões do protocolo (código + versão, hash e conteúdo) e lê a vigente', async () => {
    const v1 = await gravar<{ id: number; versao: number }>(ctx, (g) => g.publicarProtocolo(protocolo()));
    expect(v1.versao).toBe(1);
    const v2 = await gravar<{ id: number; versao: number }>(ctx, (g) =>
      g.publicarProtocolo(protocolo({ ciclos: 6, hash: 'b'.repeat(64) })),
    );
    expect(v2.versao).toBe(2);
    expect(await recusado(gravar(ctx, (g) => g.publicarProtocolo(protocolo())))).toBe('registro-duplicado');
    const lido = await porta.protocolo(ctx, v1.id);
    expect(lido).toMatchObject({
      codigo: 'C2090-AC',
      versao: 1,
      vigente: false,
      ciclos: 4,
      por: 'c2090.teste',
    });
    expect(lido?.farmacos).toEqual(protocolo().farmacos);
    expect((await porta.protocolo(ctx, v2.id))?.vigente).toBe(true);
    expect((await porta.protocolos(ctx)).filter((p) => p.codigo === 'C2090-AC').map((p) => p.versao)).toEqual(
      [2, 1],
    );
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM protocolo_quimioterapia WHERE codigo = 'C2090-AC' AND estabelecimento_id = ? AND hash_conteudo IS NOT NULL AND JSON_LENGTH(farmacos_publicados) = 2",
        [ids.est],
      ),
    ).toBe(2);
  });

  it('o ciclo abre o tratamento do curso, liga a prescrição, valida por outra pessoa e ajusta com a versão anterior', async () => {
    const ps = (await porta.protocolos(ctx)).filter((p) => p.codigo === 'C2090-AC');
    const v2 = ps.find((p) => p.versao === 2)!.id;
    expect(await recusado(gravar(ctx, (g) => g.registrarCiclo(ciclo(v2, { intencao: null }))))).toBe(
      'tratamento-sem-diagnostico',
    );
    const c1 = await gravar<number>(ctx, (g) => g.registrarCiclo(ciclo(v2)));
    expect(await recusado(gravar(ctx, (g) => g.registrarCiclo(ciclo(v2))))).toBe('registro-duplicado');
    const t = await linha(
      'SELECT t.diagnostico_oncologico_id AS d, t.intencao_tratamento_oncologico_id AS i, t.situacao, t.protocolo_quimioterapia_id AS p, c.protocolo_quimioterapia_id AS cp, c.situacao AS cs, JSON_LENGTH(c.doses_calculadas) AS nd FROM ciclo_quimioterapia c JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id WHERE c.id = ?',
      [c1],
    );
    expect(t).toMatchObject({
      d: ids.diagnostico,
      i: ids.intencao,
      situacao: 'em_andamento',
      p: v2,
      cp: v2,
      cs: 'previsto',
    });
    expect(Number(t?.['nd'])).toBe(1);
    expect(await porta.ciclo(ctx, c1)).toMatchObject({
      curso: 1,
      situacao: 'prescrito',
      andamento: 'ativo',
      internacao: ids.internacao,
      paciente: ids.paciente,
      codigoProtocolo: 'C2090-AC',
      dataPrevista: '2026-11-20',
      doses,
      prescricoes: [],
    });
    expect((await porta.ciclosAValidar(ctx)).map((c) => c.id)).toContain(c1);
    // Validação: sem a prescrição ligada, pelo próprio autor, recusa; ligada e por outra pessoa, valida uma vez.
    expect(
      await recusado(
        gravar(ctxFarma, (g) =>
          g.validarCiclo({ id: c1, doses: [108], observacao: null, vinculo: 0, usuario: 'c2090.farma' }),
        ),
      ),
    ).toBe('ciclo-nao-validavel');
    expect(
      await recusado(
        gravar(ctx, (g) =>
          g.vincularPrescricao({
            ciclo: c1,
            prescricao: ids.prescricao,
            dataPrevista: '2026-11-21',
            vinculo: 0,
            usuario: 'x',
          }),
        ),
      ),
    ).toBe('ciclo-desatualizado');
    await gravar(ctx, (g) =>
      g.vincularPrescricao({ ciclo: c1, prescricao: ids.prescricao, vinculo: 0, usuario: 'x' }),
    );
    expect(
      await recusado(
        gravar(ctx, (g) =>
          g.validarCiclo({ id: c1, doses: [108], observacao: null, vinculo: 0, usuario: 'x' }),
        ),
      ),
    ).toBe('ciclo-nao-validavel');
    await gravar(ctxFarma, (g) =>
      g.validarCiclo({ id: c1, doses: [108], observacao: 'Conferido', vinculo: 0, usuario: 'c2090.farma' }),
    );
    expect(await porta.ciclo(ctx, c1)).toMatchObject({
      situacao: 'validado',
      validadoPor: 'c2090.farma',
      prescricoes: [ids.prescricao],
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM ciclo_quimioterapia WHERE id = ? AND situacao = 'liberado' AND JSON_EXTRACT(doses_validadas, '$[0]') = 108",
        [c1],
      ),
    ).toBe(1);
    expect(
      await recusado(
        gravar(ctx, (g) =>
          g.ajustarCiclo({
            id: c1,
            dataPrevista: '2026-11-22',
            reducaoPct: 0,
            motivoReducao: null,
            justificativaIntervalo: null,
            doses,
          }),
        ),
      ),
    ).toBe('ciclo-validado');

    // Curso 2 (tratamento novo com o motivo): ajuste travado pela prescrição ligada; desligar com o motivo; ajustar.
    const c2 = await gravar<number>(ctx, (g) =>
      g.registrarCiclo(ciclo(v2, { curso: 2, motivoCurso: 'Recidiva', dataPrevista: '2026-11-22' })),
    );
    expect(await porta.ciclo(ctx, c2)).toMatchObject({ curso: 2, motivoCurso: 'Recidiva' });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM tratamento_oncologico WHERE estabelecimento_id = ? AND paciente_id = ?',
        [ids.est, ids.paciente],
      ),
    ).toBe(2);
    await gravar(ctx, (g) =>
      g.vincularPrescricao({ ciclo: c2, prescricao: ids.prescricao2, vinculo: 0, usuario: 'x' }),
    );
    expect(
      await recusado(
        gravar(ctx, (g) =>
          g.ajustarCiclo({
            id: c2,
            dataPrevista: '2026-11-23',
            reducaoPct: 0,
            motivoReducao: null,
            justificativaIntervalo: null,
            doses,
          }),
        ),
      ),
    ).toBe('ciclo-com-prescricao');
    await gravar(ctx, async (g) => {
      await g.desligarPrescricao({ ciclo: c2, prescricao: ids.prescricao2, motivo: 'Data mudou' });
      return g.registrarEventoOnco({
        evento: 'prescricao-desligada',
        codigoProtocolo: 'C2090-AC',
        protocolo: v2,
        ciclo: c2,
        prescricao: ids.prescricao2,
        categoria: null,
        ciclosAfetados: null,
        antes: null,
        motivo: 'Data mudou',
        vinculo: 0,
        usuario: 'x',
      });
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM ciclo_quimioterapia_prescricao WHERE ciclo_quimioterapia_id = ? AND desligado_em IS NOT NULL AND motivo_desligamento = 'Data mudou'",
        [c2],
      ),
    ).toBe(1);
    const novas = doses.map((d) => ({ ...d, final: 81 }));
    const antes = await gravar<{ dataPrevista: string }>(ctx, async (g) => {
      const a = await g.ajustarCiclo({
        id: c2,
        dataPrevista: '2026-11-23',
        reducaoPct: 25,
        motivoReducao: 'Neutropenia',
        justificativaIntervalo: null,
        doses: novas,
      });
      await g.registrarEventoOnco({
        evento: 'ciclo-ajustado',
        codigoProtocolo: 'C2090-AC',
        protocolo: v2,
        ciclo: c2,
        prescricao: null,
        categoria: 'toxicidade',
        ciclosAfetados: null,
        antes: JSON.stringify(a),
        motivo: 'Toxicidade',
        vinculo: 0,
        usuario: 'x',
      });
      return a;
    });
    expect(antes).toEqual({
      dataPrevista: '2026-11-22',
      reducaoPct: 0,
      motivoReducao: null,
      justificativaIntervalo: null,
      doses: [{ farmaco: 'doxorrubicina', final: 108 }],
    });
    expect(await porta.ciclo(ctx, c2)).toMatchObject({
      dataPrevista: '2026-11-23',
      reducaoPct: 25,
      prescricoes: [],
    });
    const ev = await porta.eventosCiclos(ctx, [c2]);
    expect(ev.map((e) => e.evento)).toEqual(['ciclo-ajustado', 'prescricao-desligada']);
    expect(JSON.parse(ev[0]!.antes!)).toMatchObject({ dataPrevista: '2026-11-22' });
    expect(ev[0]).toMatchObject({ codigoProtocolo: 'C2090-AC', categoria: 'toxicidade', por: 'c2090.teste' });

    // Suspender e retomar (andamento conferido na transação).
    await gravar(ctx, (g) => g.mudarAndamentoCiclo({ id: c2, de: ['ativo'], para: 'suspenso' }));
    expect((await porta.ciclo(ctx, c2))?.andamento).toBe('suspenso');
    expect(
      await recusado(gravar(ctx, (g) => g.mudarAndamentoCiclo({ id: c2, de: ['ativo'], para: 'cancelado' }))),
    ).toBe('ciclo-desatualizado');
    await gravar(ctx, (g) => g.mudarAndamentoCiclo({ id: c2, de: ['suspenso'], para: 'ativo' }));
    expect(await porta.ciclo(ctx, c2)).toMatchObject({ andamento: 'ativo', situacao: 'prescrito' });
    // Outro estabelecimento não vê os ciclos.
    expect(await porta.ciclo({ ...ctx, estabelecimento: ids.outroEst }, c2)).toBeNull();
    expect((await porta.ciclosDoPaciente(ctx, ids.paciente)).map((c) => c.id)).toEqual([c2, c1]);
  });

  it('revoga a versão com a recontagem e inativa o protocolo: nenhum ciclo novo com eles', async () => {
    const ps = (await porta.protocolos(ctx)).filter((p) => p.codigo === 'C2090-AC');
    const v1 = ps.find((p) => p.versao === 1)!.id;
    const v2 = ps.find((p) => p.versao === 2)!.id;
    expect(await porta.ciclosDaVersao(ctx, v2)).toMatchObject({ total: 2, emAndamento: 2, cortada: false });
    const revogar = (ciente: number) =>
      gravar(ctx, (g) =>
        g.revogarVersao({
          codigoProtocolo: 'C2090-AC',
          protocolo: v2,
          emAndamentoCiente: ciente,
          motivo: 'Diretriz nova',
          vinculo: 0,
          usuario: 'x',
        }),
      );
    expect(await recusado(revogar(1))).toBe('versao-com-ciclos');
    await revogar(2);
    expect(await recusado(revogar(2))).toBe('versao-ja-revogada');
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM protocolo_quimioterapia WHERE id = ? AND revogado_em IS NOT NULL AND motivo_revogacao = 'Diretriz nova'",
        [v2],
      ),
    ).toBe(1);
    expect(await recusado(gravar(ctx, (g) => g.registrarCiclo(ciclo(v2, { numero: 2 }))))).toBe(
      'versao-revogada',
    );
    await gravar(ctx, (g) =>
      g.registrarEventoOnco({
        evento: 'protocolo-inativado',
        codigoProtocolo: 'C2090-AC',
        protocolo: null,
        ciclo: null,
        prescricao: null,
        categoria: null,
        ciclosAfetados: null,
        antes: null,
        motivo: 'Fora de uso',
        vinculo: 0,
        usuario: 'x',
      }),
    );
    expect(await recusado(gravar(ctx, (g) => g.registrarCiclo(ciclo(v1, { numero: 2 }))))).toBe(
      'protocolo-inativo',
    );
    const ev = await porta.eventosProtocolos(ctx);
    expect(ev.map((e) => [e.evento, e.ciclosAfetados])).toEqual([
      ['protocolo-inativado', null],
      ['versao-revogada', 2],
    ]);
    expect(ev[1]).toMatchObject({ protocolo: v2, codigoProtocolo: 'C2090-AC' });
    // Nada apagado: os ciclos da versão revogada continuam, e os eventos ficam.
    expect(
      await contar('SELECT COUNT(*) AS n FROM evento_tratamento_oncologico WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toBe(4);
  });
});
