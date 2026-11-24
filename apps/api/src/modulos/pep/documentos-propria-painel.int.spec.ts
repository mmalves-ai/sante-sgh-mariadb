// Integração da família "painel" da porta própria dos documentos contra o MariaDB real (cliente de teste f22_o2).
// Massa SINTÉTICA do lote l96pai: cadastros reaproveitáveis garantidos no beforeAll; receitas, atestados, pareceres,
// tempos, alergias e preferências do lote apagados no início e no fim (só a massa de teste; a porta nunca apaga). A
// trilha do executor não é apagada (cadeia do SBIS-16). Nenhum dado de pessoa real. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as F from './documentos-propria-painel.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_DOCS_PAINEL']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l96pai';
const LOGIN = `${P}.medico`;
const SEM_VINCULO = `${P}.semvinculo`;
const CBO = '225125';
const DOC = 'x'.repeat(60);

interface Ids {
  est: number;
  usuario: number;
  semVinculo: number;
  prof: number;
  inscricao: number;
  paciente: number;
  atendimento: number;
  receita: number;
  atestado: number;
  parecer: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const x = await e.uma(sel, p);
  if (x) return Number(x['id']);
  return e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('documentos-propria-painel contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  const ids = {} as Ids;
  const C = () => ({
    rede: 'rede-sintetica',
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: ids.usuario,
    correlacao: `${P}-leitura`,
  });

  const limpar = (e: Escritor) =>
    (async () => {
      const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
      await e.executar(
        `DELETE v FROM documento_emitido_versao v JOIN documento_emitido d ON d.id = v.documento_emitido_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      for (const t of [
        'documento_emitido',
        'receita_medica',
        'interconsulta',
        'registro_tempo_evento',
        'alergia_paciente',
      ])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(
        `DELETE c FROM painel_coluna_usuario c JOIN usuario u ON u.id = c.usuario_id WHERE u.login = ?`,
        [LOGIN],
      );
      await e.executar(
        `DELETE f FROM painel_filtro_usuario f JOIN usuario u ON u.id = f.usuario_id WHERE u.login = ?`,
        [LOGIN],
      );
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-preparo` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Conta sintética ${login}`, cpf, agora],
        );
      ids.usuario = await usuario(LOGIN, '24000096101');
      ids.semVinculo = await usuario(SEM_VINCULO, '24000096102');
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
        ['LZPAI', 'Z6', 'LZPAI'],
        'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)',
        ['Z6', 'LZPAI', 'Conselho sintético do lote l96pai', agora],
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
      ids.inscricao = await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
        [ids.prof],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, '960001', ?, TRUE, ?)`,
        [ids.prof, conselho, uf, ocupacao, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
        [ids.usuario, ids.est],
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
           criado_em) VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuario, ids.est, ids.prof, agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaPac, 902_496_001, agora],
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
        [ids.est, 'L96-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L96-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [
          ids.est,
          ids.paciente,
          categoriaAt,
          carater,
          fonte,
          ids.prof,
          new Date('2026-11-20T10:00:00Z'),
          agora,
        ],
      );
      const tipoReceita = await garantir(
        e,
        'SELECT id FROM tipo_receita WHERE codigo = ?',
        [`${P}ce`],
        `INSERT INTO tipo_receita (codigo, descricao, controle_especial, criado_em) VALUES (?, ?, TRUE, ?)`,
        [`${P}ce`, 'Receita sintética de controle especial', agora],
      );
      const emitida = new Date('2026-11-20T12:00:00Z');
      ids.receita = await e.inserir(
        `INSERT INTO receita_medica (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
           tipo_receita_id, emitida_em, registrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          `${P}-${randomUUID().slice(0, 8)}`,
          ids.paciente,
          ids.atendimento,
          ids.prof,
          tipoReceita,
          emitida,
          emitida,
          agora,
        ],
      );
      ids.atestado = await e.inserir(
        `INSERT INTO documento_emitido (estabelecimento_id, paciente_id, atendimento_id, tipo, profissional_id, emitido_em,
           lancado_em, texto, dias_afastamento, criado_em) VALUES (?, ?, ?, 'atestado', ?, ?, ?, ?, 2, ?)`,
        [ids.est, ids.paciente, ids.atendimento, ids.prof, emitida, emitida, '<atestado sintetico/>', agora],
      );
      ids.parecer = await e.inserir(
        `INSERT INTO interconsulta (estabelecimento_id, atendimento_id, paciente_id, solicitante_profissional_id,
           categoria_assistencial, motivo, prioridade, solicitado_em, criado_em, criado_por)
         VALUES (?, ?, ?, ?, 'medico', 'Motivo sintético', 'urgente', ?, ?, ?)`,
        [ids.est, ids.atendimento, ids.paciente, ids.prof, emitida, agora, ids.usuario],
      );
      await e.inserir(
        `INSERT INTO alergia_paciente (estabelecimento_id, paciente_id, tipo_registro, descricao_livre, registrado_em,
           criado_em) VALUES (?, ?, 'alergia', 'Agente sintético', ?, ?)`,
        [ids.est, ids.paciente, emitida, agora],
      );
      const tipoTempo = await garantir(
        e,
        'SELECT id FROM tipo_evento_tempo WHERE codigo = ?',
        [`${P}cheg`],
        "INSERT INTO tipo_evento_tempo (codigo, descricao, etapa, criado_em) VALUES (?, 'Chegada sintética', 'chegada', ?)",
        [`${P}cheg`, agora],
      );
      await e.inserir(
        `INSERT INTO registro_tempo_evento (estabelecimento_id, paciente_id, atendimento_id, tipo_evento_tempo_id,
           ocorrido_em, registrado_em, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, ids.paciente, ids.atendimento, tipoTempo, emitida, emitida, ids.usuario, agora],
      );
      const filtro = await e.inserir(
        `INSERT INTO painel_filtro_usuario (estabelecimento_id, usuario_id, nome, padrao, criado_em)
         VALUES (?, ?, 'Padrão sintético', TRUE, ?)`,
        [ids.est, ids.usuario, agora],
      );
      await e.inserir(
        `INSERT INTO painel_coluna_usuario (usuario_id, painel_filtro_usuario_id, coluna, ordem, exibir, criado_em)
         VALUES (?, ?, 'leito', 1, FALSE, ?)`,
        [ids.usuario, filtro, agora],
      );
    });
  }, 180_000);

  afterAll(async () => {
    if (nucleo) await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, limpar);
  }, 60_000);

  it('painel: o paciente com atendimento aberto, busca e alergia ativa', async () => {
    const r = await F.painel(nucleo, CLIENTE, C(), { unidade: null, busca: `${P} pac` });
    expect(r.limitado).toBe(false);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      registro: 961,
      alergiasAtivas: 1,
      entrada: '2026-11-20T07:00:00',
    });
    expect((await F.painel(nucleo, CLIENTE, C(), { unidade: null, busca: 'NINGUEM-L96' })).linhas).toEqual(
      [],
    );
  });

  it('completude, preferências, tempos e fila/fluxo', async () => {
    const comp = await F.completudePainel(
      nucleo,
      CLIENTE,
      C(),
      [ids.paciente],
      [ids.atendimento],
      new Date(),
    );
    expect(comp.alergiasInformadas).toHaveLength(1);
    expect(comp.pareceres).toEqual([{ paciente: ids.paciente, situacao: 'solicitado', prazo: null }]);
    expect(await F.preferenciasPainel(nucleo, CLIENTE, C(), LOGIN)).toEqual({
      unidade: null,
      campos: [{ campo: 'leito', exibir: false, ordem: 1 }],
    });
    const ts = await F.tempos(nucleo, CLIENTE, C(), ids.paciente);
    expect(ts.map((t) => t.situacao)).toEqual(['Chegada sintética']);
    const fl = await F.fila(nucleo, CLIENTE, C(), { paciente: ids.paciente, situacao: 'solicitado' });
    expect(fl.map((x) => x.id)).toEqual([ids.parecer]);
    expect(await F.fluxo(nucleo, CLIENTE, C(), ids.parecer)).toMatchObject({
      solicitante: LOGIN,
      prioridade: 'urgente',
      origem: 'novo',
    });
    expect(await F.episodio(nucleo, CLIENTE, C(), ids.atendimento)).toEqual({
      motivoInternacao: null,
      procedimentos: [],
      exames: [],
    });
  });

  it('receita e atestado: leitura, lista, cabeçalho', async () => {
    expect(await F.lerReceita(nucleo, CLIENTE, C(), ids.receita)).toMatchObject({
      titulo: 'Receita de controle especial',
      paciente: ids.paciente,
      cbo: CBO,
      suspensoEm: null,
    });
    expect(await F.lerAtestado(nucleo, CLIENTE, C(), ids.atestado)).toMatchObject({
      titulo: 'Atestado',
      xml: '<atestado sintetico/>',
    });
    expect(
      (await F.documentos(nucleo, CLIENTE, C(), ids.paciente, 'receita')).map((d) => d.tpPadrao),
    ).toEqual([F.TP_PADRAO_CONTROLADA]);
    const cab = await F.cabecalhoDocumento(
      nucleo,
      CLIENTE,
      C(),
      { htPaciente: ids.paciente, htAtendimento: ids.atendimento },
      ids.inscricao,
      1,
      2,
    );
    expect(cab.hospital).toEqual([['nome', `Hospital sintético ${P}`]]);
    expect(cab.profissional[0]).toEqual(['id_tbcbopro', ids.inscricao]);
    expect(Array.isArray(await F.fichas(nucleo, CLIENTE, C()))).toBe(true);
    expect(Array.isArray(await F.modelosEmUso(nucleo, CLIENTE, C(), '2026-01-01'))).toBe(true);
    expect(await F.lerExameExterno(nucleo, CLIENTE, C(), 999_999_999)).toBeNull();
  });

  it('podeGravar: com vínculo e conselho pode; sem vínculo não', async () => {
    expect((await F.podeGravar(nucleo, CLIENTE, C(), 'pep.suspenderDocumento', LOGIN)).pode).toBe(true);
    expect((await F.podeGravar(nucleo, CLIENTE, C(), 'pep.suspenderDocumento', SEM_VINCULO)).codigo).toBe(
      'sem-profissional',
    );
  });

  it('suspensão do atestado e da receita pelo executor: nova versão, motivo e nada apagado', async () => {
    const ctx = (n: string) => ({
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: `${P}-${n}`,
      chaveIdempotencia: `${P}:${randomUUID()}`,
    });
    const executor = nucleo.criarExecutor();
    const entrada = {
      paciente: ids.paciente,
      cbo: ids.inscricao,
      justificativa: 'Emitido por engano no lote',
      documento: DOC,
    };
    await F.executar(
      nucleo,
      CLIENTE,
      executor,
      C(),
      'pep.suspenderDocumento',
      { ...entrada, familia: 'atestado', origem: ids.atestado },
      ctx('a'),
    );
    await F.executar(
      nucleo,
      CLIENTE,
      executor,
      C(),
      'pep.suspenderDocumento',
      { ...entrada, familia: 'receita', origem: ids.receita },
      ctx('r'),
    );
    expect((await F.lerAtestado(nucleo, CLIENTE, C(), ids.atestado))?.suspensoEm).not.toBeNull();
    expect((await F.lerReceita(nucleo, CLIENTE, C(), ids.receita))?.justificativaSuspensao).toBe(
      'Emitido por engano no lote',
    );
    const n = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (l) =>
      l.uma(
        `SELECT (SELECT COUNT(*) FROM documento_emitido_versao WHERE documento_emitido_id = ? AND acao = 'suspensao') AS v,
                (SELECT COUNT(*) FROM documento_emitido WHERE id = ? AND excluido_em IS NULL) AS d`,
        [ids.atestado, ids.atestado],
      ),
    );
    expect([Number(n?.['v']), Number(n?.['d'])]).toEqual([1, 1]);
    await expect(
      F.executar(
        nucleo,
        CLIENTE,
        executor,
        C(),
        'pep.suspenderDocumento',
        { ...entrada, familia: 'receita', origem: ids.receita },
        ctx('r2'),
      ),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'ja-suspenso' } });
    await expect(
      F.executar(nucleo, CLIENTE, executor, C(), 'pep.registrarObito', {}, ctx('o')),
    ).rejects.toMatchObject({ problema: { status: 501 } });
  });
});
