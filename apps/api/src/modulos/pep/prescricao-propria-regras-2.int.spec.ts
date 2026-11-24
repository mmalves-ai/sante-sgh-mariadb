// Integração da família pep-resto2 (prescricao-propria-regras-2.ts) contra o MariaDB do cliente de teste: regra de
// alerta (regra_alerta + regra_alerta_versao) e ficha de antimicrobiano (ficha_antimicrobiano) do item prescrito.
// Preparo sintético próprio (prefixo l93rg); a limpeza apaga só as linhas deste teste. Nenhum dado real.
import { ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hojeLocal, periodoDaFicha, RegrasPrescricaoPropria2 } from './prescricao-propria-regras-2.js';
import { fusoValido } from './registro-porta-propria.js';
import type { FichaAvulsa, NovaVersaoRegra } from './tipos-pep.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_DOCS_RESTO']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l93rg';
const P2 = 'l93rg2';
const LOGIN = `${P}.medico`;
const LOGIN_SEM_PROF = `${P}.adm`;
const CBO = '225125';
const R = 'L93RG-';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const x = await e.uma(sel, p);
  if (x) return Number(x['id']);
  return e.inserir(ins, pi);
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem-erro';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
}

describe.skipIf(SEM_BANCO)('prescricao-propria-regras-2 contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let regras: RegrasPrescricaoPropria2;
  let fuso = 'America/Sao_Paulo';
  const ids = {
    est: 0,
    est2: 0,
    usuario: 0,
    adm: 0,
    prof: 0,
    paciente: 0,
    atendimento: 0,
    prescricao: 0,
    cenA: 0,
    cenB: 0,
    prodA: 0,
    prodB: 0,
    prodC: 0,
    prodD: 0,
    itemA: 0,
    itemB: 0,
    itemC: 0,
    amA: 0,
    sitio: 0,
  };
  const C = () => ({
    rede: 'rede-sintetica',
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: null,
    correlacao: `${P}-op`,
  });
  const uma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (l) => l.uma(sql, p));
  const todas = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (l) => l.consultar(sql, p));

  const limpar = (e: Escritor) =>
    (async () => {
      const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
      await e.executar(`DELETE FROM ficha_antimicrobiano WHERE estabelecimento_id IN ${est}`, [P, P2]);
      await e.executar(
        `DELETE i FROM prescricao_item i JOIN prescricao p ON p.id = i.prescricao_id WHERE p.estabelecimento_id IN ${est}`,
        [P, P2],
      );
      await e.executar(`DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`, [P, P2]);
      await e.executar(
        `DELETE v FROM regra_alerta_versao v JOIN regra_alerta r ON r.id = v.regra_alerta_id WHERE r.codigo LIKE ?`,
        [`${R}%`],
      );
      await e.executar('DELETE FROM regra_alerta WHERE codigo LIKE ?', [`${R}%`]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    regras = new RegrasPrescricaoPropria2(nucleo, CLIENTE);
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-preparo` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, agora],
        );
      ids.est = await estab(P);
      ids.est2 = await estab(P2);
      fuso = fusoValido(
        (await e.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [ids.est]))?.['fuso_horario'],
      );
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Conta sintética ${login}`, cpf, agora],
        );
      ids.usuario = await usuario(LOGIN, '24000093201');
      ids.adm = await usuario(LOGIN_SEM_PROF, '24000093202');
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pessoaProf = await pessoa(`PESSOA SINTETICA ${P} PROFISSIONAL`);
      const pessoaPac = await pessoa(`PESSOA SINTETICA ${P} PACIENTE`);
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
        [pessoaProf, `massa ${P}`, agora],
      );
      const ocupacao = await garantir(
        e,
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        [CBO],
        'INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES (?, ?, ?)',
        [CBO, 'Médico clínico (sintético)', agora],
      );
      const conselho = await garantir(
        e,
        'SELECT id FROM conselho_classe WHERE sigla = ? OR codigo_tiss = ? ORDER BY (sigla = ?) DESC LIMIT 1',
        ['LZNOVTRES', 'Z3', 'LZNOVTRES'],
        'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)',
        ['Z3', 'LZNOVTRES', 'Conselho sintético do lote l93pr', agora],
      );
      const pais = await garantir(
        e,
        "SELECT id FROM pais_referencia WHERE codigo_iso = 'BR'",
        [],
        "INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES ('BR', 'Brasil', ?)",
        [agora],
      );
      const uf = await garantir(
        e,
        "SELECT id FROM unidade_federativa WHERE sigla = 'RJ'",
        [],
        "INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES ('33', 'RJ', 'Rio de Janeiro', ?, ?)",
        [pais, agora],
      );
      await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
        [ids.prof],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, '930201', ?, TRUE, ?)`,
        [ids.prof, conselho, uf, ocupacao, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_profissional WHERE usuario_id = ? AND profissional_id = ?',
        [ids.usuario, ids.prof],
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.usuario, ids.prof, '2026-01-01', agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaPac, 902_493_201, agora],
      );
      const categoriaAt = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}amb`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'ambulatorio', ?)",
        [`${P}amb`, 'Categoria sintética', agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        [`${P}c`],
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}fp`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      ids.atendimento = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, 'L93RG-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L93RG-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [ids.est, ids.paciente, categoriaAt, carater, fonte, ids.prof, new Date('2026-11-20T10:00:00Z'), agora],
      );
      const cenario = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM cenario_alerta WHERE codigo = ?',
          [cod],
          'INSERT INTO cenario_alerta (codigo, descricao, verificador, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `Cenário sintético ${cod}`, `verificador.${cod}`, agora],
        );
      ids.cenA = await cenario(`${P}dose`);
      ids.cenB = await cenario(`${P}inter`);
      const tipoItem = await garantir(
        e,
        "SELECT id FROM tipo_item_prescricao WHERE categoria = 'medicamento' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'medicamento', ?)",
        [`${P}med`, 'Medicamento sintético', agora],
      );
      const principio = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM principio_ativo WHERE codigo_dcb = ?',
          [cod],
          'INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `PRINCIPIO SINTETICO ${cod}`, 'teste', agora],
        );
      const produto = (cod: string, pa: number) =>
        garantir(
          e,
          'SELECT id FROM item_prescritivel WHERE codigo = ?',
          [cod],
          'INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, principio_ativo_id, criado_em) VALUES (?, ?, ?, ?, ?)',
          [cod, `PRODUTO SINTETICO ${cod}`, tipoItem, pa, agora],
        );
      const antimicrobiano = (cod: string, pa: number, dias: number | null) =>
        garantir(
          e,
          'SELECT id FROM antimicrobiano WHERE codigo = ?',
          [cod],
          'INSERT INTO antimicrobiano (codigo, descricao, principio_ativo_id, dias_liberados, criado_em) VALUES (?, ?, ?, ?, ?)',
          [cod, `ANTIMICROBIANO SINTETICO ${cod}`, pa, dias, agora],
        );
      const paA = await principio('L93RGA');
      const paB = await principio('L93RGB');
      const paC = await principio('L93RGC');
      ids.prodA = await produto(`${P}A`, paA);
      ids.prodB = await produto(`${P}B`, paB);
      ids.prodC = await produto(`${P}C`, paC);
      ids.prodD = await produto(`${P}D`, paA);
      ids.amA = await antimicrobiano(`${P}A`, paA, 10);
      await antimicrobiano(`${P}B`, paB, null);
      ids.sitio = await garantir(
        e,
        'SELECT id FROM sitio_infeccao WHERE codigo = ?',
        [`${P}pulm`],
        'INSERT INTO sitio_infeccao (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}pulm`, 'Sítio sintético l93rg', 'L93RGP', agora],
      );
      const inicio = new Date(Date.now() - 2 * 3_600_000);
      ids.prescricao = await e.inserir(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
           tipo, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
         VALUES (?, ?, ?, ?, ?, 'medica', 'vigente', ?, ?, ?, ?)`,
        [ids.est, 932_001, ids.paciente, ids.atendimento, ids.prof, inicio, inicio, new Date(Date.now() + 22 * 3_600_000), agora],
      );
      const item = (seq: number, prod: number) =>
        e.inserir(
          `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id, inicio_em,
             lancamento_profissional_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ids.prescricao, seq, tipoItem, prod, inicio, ids.prof, agora],
        );
      ids.itemA = await item(1, ids.prodA);
      ids.itemB = await item(2, ids.prodB);
      ids.itemC = await item(3, ids.prodC);
      // Regras já existentes: a do cliente (vale para todos), a do produto deste estabelecimento e a de outro.
      const regra = (cod: string, est: number | null, editavel: boolean) =>
        e.inserir(
          `INSERT INTO regra_alerta (estabelecimento_id, codigo, nome, cenario_alerta_id, descricao, mensagem, editavel,
             numero_versao_vigente, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 1, '2026-01-01', ?)`,
          [est, cod, `Regra sintética ${cod}`, ids.cenA, 'Regra sintética', 'Regra sintética', editavel, agora],
        );
      await regra(`${R}CLI`, null, true);
      await regra(`${R}PROD`, ids.est, false);
      await regra(`${R}OUT`, ids.est2, true);
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, (e) => limpar(e));
      await nucleo.encerrar();
    }
  });

  const novaRegra = (cod: string, extra: Partial<NovaVersaoRegra> = {}): NovaVersaoRegra => ({
    codigo: `${R}${cod}`,
    tipo: `${P}dose`,
    nivel: 'justificar',
    vigenteDesde: '2026-11-01',
    ativa: true,
    descricao: 'Dose acima do máximo (sintético)',
    justificativa: 'Ajuste sintético',
    ...extra,
  });
  const ficha = (extra: Partial<FichaAvulsa> = {}): FichaAvulsa => ({
    atendimento: ids.atendimento,
    paciente: ids.paciente,
    prescricao: null,
    item: null,
    produto: ids.prodA,
    indicacao: 'Indicação sintética',
    sitio: 'L93RGP',
    tipo: 'empirico',
    culturaColhida: true,
    diaTratamento: 2,
    duracaoDias: 7,
    ...extra,
  });

  it('gravarRegra: código novo cria a regra no estabelecimento (versão 1); de novo, versão 2 com o motivo', async () => {
    const r1 = await regras.gravarRegra(C(), LOGIN_SEM_PROF, novaRegra('N1', { nivel: 'bloqueio' }));
    expect(r1.versao).toBe(1);
    const r2 = await regras.gravarRegra(
      C(),
      LOGIN_SEM_PROF,
      novaRegra('N1', { nivel: 'aviso', tipo: `${P}inter`, ativa: false, descricao: 'Nova descrição sintética' }),
    );
    expect(r2).toEqual({ id: r1.id, versao: 2 });
    const l = await uma(
      `SELECT estabelecimento_id, cenario_alerta_id, descricao, bloqueante, exige_justificativa, gravidade, ativo,
              numero_versao_vigente FROM regra_alerta WHERE id = ?`,
      [r1.id],
    );
    expect({ ...l, bloqueante: Number(l?.['bloqueante']), exige: Number(l?.['exige_justificativa']), ativo: Number(l?.['ativo']) })
      .toMatchObject({
        estabelecimento_id: ids.est,
        cenario_alerta_id: ids.cenB,
        descricao: 'Nova descrição sintética',
        bloqueante: 0,
        exige: 0,
        gravidade: 'informativo',
        ativo: 0,
        numero_versao_vigente: 2,
      });
    const v = await todas(
      'SELECT numero_versao, operacao, motivo_alteracao, usuario_id FROM regra_alerta_versao WHERE regra_alerta_id = ? ORDER BY numero_versao',
      [r1.id],
    );
    expect(v.map((x) => [Number(x['numero_versao']), x['operacao'], Number(x['usuario_id'])])).toEqual([
      [1, 'inclusao', ids.adm],
      [2, 'alteracao', ids.adm],
    ]);
    expect(v[1]?.['motivo_alteracao']).toBe('Ajuste sintético');
  });

  it('gravarRegra: a regra do cliente (vale para todos) e a de outro estabelecimento recusam 409, nada gravado', async () => {
    const antes = await uma(
      "SELECT COUNT(*) AS n FROM regra_alerta_versao v JOIN regra_alerta r ON r.id = v.regra_alerta_id WHERE r.codigo LIKE ?",
      [`${R}%`],
    );
    expect(await codigo(regras.gravarRegra(C(), LOGIN_SEM_PROF, novaRegra('CLI', { ativa: false })))).toBe(
      'regra-do-cliente',
    );
    expect(await codigo(regras.gravarRegra(C(), LOGIN_SEM_PROF, novaRegra('OUT')))).toBe(
      'regra-de-outro-estabelecimento',
    );
    const cli = await uma('SELECT ativo, numero_versao_vigente FROM regra_alerta WHERE codigo = ?', [`${R}CLI`]);
    expect([Number(cli?.['ativo']), Number(cli?.['numero_versao_vigente'])]).toEqual([1, 1]);
    const depois = await uma(
      "SELECT COUNT(*) AS n FROM regra_alerta_versao v JOIN regra_alerta r ON r.id = v.regra_alerta_id WHERE r.codigo LIKE ?",
      [`${R}%`],
    );
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
  });

  it('gravarRegra: a regra do produto só liga, desliga ou muda a vigência; cenário inexistente e usuário inexistente recusam', async () => {
    const atual = await uma('SELECT descricao FROM regra_alerta WHERE codigo = ?', [`${R}PROD`]);
    const r = await regras.gravarRegra(
      C(),
      LOGIN_SEM_PROF,
      novaRegra('PROD', { nivel: 'aviso', descricao: String(atual?.['descricao']), ativa: false, vigenteDesde: '2026-11-20' }),
    );
    expect(r.versao).toBe(2);
    expect(
      await codigo(regras.gravarRegra(C(), LOGIN_SEM_PROF, novaRegra('PROD', { nivel: 'aviso', descricao: 'Outra' }))),
    ).toBe('regra-do-produto');
    expect(await codigo(regras.gravarRegra(C(), LOGIN_SEM_PROF, novaRegra('N2', { tipo: `${P}nada` })))).toBe(
      'cenario-sem-cadastro',
    );
    expect(await codigo(regras.gravarRegra(C(), `${P}.ninguem`, novaRegra('N3')))).toBe('profissional-sem-cbo');
  });

  it('registrarFicha: pelo produto, o último item prescrito; período pelo dia de tratamento; trilha e situação pendente', async () => {
    const id = await regras.registrarFicha(C(), LOGIN, ficha());
    const l = await uma(
      `SELECT prescricao_item_id, antimicrobiano_id, prescritor_profissional_id, sitio_infeccao_id, cultura_coletada,
              DATE_FORMAT(data_inicio, '%Y-%m-%d') AS ini, DATE_FORMAT(data_fim_prevista, '%Y-%m-%d') AS fim,
              dias_previstos, avaliacao_situacao, origem_infeccao,
              (SELECT codigo FROM finalidade_terapeutica f WHERE f.id = finalidade_terapeutica_id) AS finalidade
         FROM ficha_antimicrobiano WHERE id = ?`,
      [id],
    );
    const { inicio, fim } = periodoDaFicha(hojeLocal(fuso), 2, 7);
    expect({ ...l, cultura_coletada: Number(l?.['cultura_coletada']) }).toMatchObject({
      prescricao_item_id: ids.itemA,
      antimicrobiano_id: ids.amA,
      prescritor_profissional_id: ids.prof,
      sitio_infeccao_id: ids.sitio,
      cultura_coletada: 1,
      ini: inicio,
      fim,
      dias_previstos: 7,
      avaliacao_situacao: 'pendente',
      origem_infeccao: 'indeterminada',
      finalidade: 'empirica',
    });
  });

  it('registrarFicha: item informado e duração sugerida pelo cadastro do antimicrobiano; profilático', async () => {
    const id = await regras.registrarFicha(
      C(),
      LOGIN,
      ficha({ item: ids.itemA, prescricao: ids.prescricao, duracaoDias: null, tipo: 'profilatico', diaTratamento: 1 }),
    );
    const l = await uma(
      `SELECT dias_previstos, origem_infeccao, (SELECT codigo FROM finalidade_terapeutica f WHERE f.id = finalidade_terapeutica_id) AS fin
         FROM ficha_antimicrobiano WHERE id = ?`,
      [id],
    );
    expect(l).toMatchObject({ dias_previstos: 10, origem_infeccao: 'profilaxia_clinica', fin: 'profilatica' });
  });

  it('registrarFicha: recusas sem gravar (sem item, produto diferente, não antimicrobiano, sítio, duração, não profissional)', async () => {
    const antes = await uma('SELECT COUNT(*) AS n FROM ficha_antimicrobiano WHERE estabelecimento_id = ?', [ids.est]);
    expect(await codigo(regras.registrarFicha(C(), LOGIN, ficha({ produto: ids.prodD })))).toBe('ficha-sem-item');
    expect(await codigo(regras.registrarFicha(C(), LOGIN, ficha({ item: ids.itemB })))).toBe('produto-diferente-do-item');
    expect(await codigo(regras.registrarFicha(C(), LOGIN, ficha({ item: 999_999_999 })))).toBe('registro-inexistente');
    expect(await codigo(regras.registrarFicha(C(), LOGIN, ficha({ produto: ids.prodC })))).toBe(
      'produto-nao-antimicrobiano',
    );
    expect(await codigo(regras.registrarFicha(C(), LOGIN, ficha({ sitio: 'nada-sintetico' })))).toBe('sitio-sem-cadastro');
    expect(await codigo(regras.registrarFicha(C(), LOGIN, ficha({ produto: ids.prodB, duracaoDias: null })))).toBe(
      'duracao-obrigatoria',
    );
    expect(await codigo(regras.registrarFicha(C(), LOGIN, ficha({ paciente: 999_999_999 })))).toBe('registro-inexistente');
    expect(await codigo(regras.registrarFicha(C(), LOGIN_SEM_PROF, ficha()))).toBe('profissional-sem-cbo');
    const depois = await uma('SELECT COUNT(*) AS n FROM ficha_antimicrobiano WHERE estabelecimento_id = ?', [ids.est]);
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
  });

  it('a mesma requisição (mesma chave) não grava duas vezes', async () => {
    const c = { ...C(), chaveIdempotencia: `${P}:repete:${Date.now()}` };
    const a = await regras.registrarFicha(c, LOGIN, ficha({ duracaoDias: 5 }));
    const b = await regras.registrarFicha(c, LOGIN, ficha({ duracaoDias: 5 }));
    expect(b).toBe(a);
    const n = await uma('SELECT COUNT(*) AS n FROM ficha_antimicrobiano WHERE estabelecimento_id = ? AND dias_previstos = 5', [ids.est]);
    expect(Number(n?.['n'])).toBe(1);
  });
});
