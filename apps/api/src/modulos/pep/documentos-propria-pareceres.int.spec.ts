// Integração da família "pareceres" da porta própria dos documentos contra o MariaDB real (cliente de teste f22_o5).
// Massa SINTÉTICA com o prefixo do lote (l98par), garantida no beforeAll e com as linhas clínicas do lote apagadas no
// início e no fim (a limpeza respeita a cadeia da trilha do SBIS-16); nenhum dado de pessoa real. A porta em si nunca
// apaga. A migração 06_PEP/98_pareceres (idempotente) é aplicada no beforeAll. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentosPropriaPareceres } from './documentos-propria-pareceres.js';
import { ErroProntuario } from './tipos-pep.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_PARECERES']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const P = 'l98par';
const LOGIN = `${P}.preceptor`;
const RESIDENTE = `${P}.residente`;
const OUTRO = `${P}.outro`;
const SEM_VINCULO = `${P}.semvinculo`;
const HASH = 'e'.repeat(64);
const CBO = '225124';

interface Ids {
  est: number;
  prof: number;
  profResidente: number;
  inscricao: number;
  paciente: number;
  atendimento: number;
  especialidade: number;
  registro: number;
  supervisao: number;
  parecer1: number;
  parecer2: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const x = await e.uma(sel, p);
  if (x) return Number(x['id']);
  return e.inserir(ins, pi);
}

const recusa = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof ErroProntuario)) throw e;
    return { codigo: e.codigo, status: e.status };
  }
  throw new Error('esperava recusa');
};

describe.skipIf(SEM_BANCO)('DocumentosPropriaPareceres contra o MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let porta: DocumentosPropriaPareceres;
  const ids = {} as Ids;
  const C = () => ({
    rede: 'rede-sintetica',
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: null,
    correlacao: `${P}-leitura`,
  });
  const G = (login = LOGIN) => ({ ...C(), usuarioLogin: login, traceId: `${P}-grava` });

  const limpar = (e: Escritor) =>
    (async () => {
      const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
      // A cabeça e o fecho diário da cadeia apontam para as linhas da trilha: saem antes delas (SBIS-16).
      await e.executar(`DELETE FROM trilha_auditoria_fecho WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`DELETE FROM trilha_cadeia WHERE estabelecimento_id IN ${est}`, [P]);
      // A idempotência do executor aponta para a linha da trilha: sai antes dela.
      await e.executar(
        `DELETE io FROM idempotencia_operacao io JOIN trilha_auditoria t ON t.id = io.trilha_auditoria_id
          WHERE t.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM trilha_auditoria WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(
        `DELETE ev FROM documento_prontuario_evento ev JOIN documento_prontuario d ON d.id = ev.documento_prontuario_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      for (const t of ['declaracao_obito', 'relatorio_transferencia', 'registro_assistencial'])
        await e.executar(`UPDATE ${t} SET documento_prontuario_id = NULL WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`DELETE FROM documento_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      for (const t of ['declaracao_obito', 'relatorio_transferencia', 'sumario_alta', 'ciencia_resultado_critico'])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(
        `DELETE v FROM problema_paciente_versao v JOIN problema_paciente p ON p.id = v.problema_paciente_id
          WHERE p.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM problema_paciente WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`DELETE FROM interconsulta WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(
        `DELETE s FROM registro_assistencial_supervisao s JOIN registro_assistencial r ON r.id = s.registro_assistencial_id
          WHERE r.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN ${est}`, [P]);
    })();

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conferencia` }, async (l) =>
      Number((await l.uma(sql, p))?.['n'] ?? 0),
    );

  beforeAll(async () => {
    const banco = `cliente_${CLIENTE}`;
    for (const arq of ['98_pareceres_tabelas.sql', '98_pareceres_chaves.sql'])
      execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [banco], {
        input: readFileSync(resolve(RAIZ, 'db/migracoes/06_PEP', arq), 'utf8'),
        encoding: 'utf8',
      });
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(banco);
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
      // CPFs sintéticos do lote (fora de qualquer faixa real usada nos clientes de teste).
      const uPrec = await usuario(LOGIN, '98000000101');
      const uRes = await usuario(RESIDENTE, '98000000102');
      const uOutro = await usuario(OUTRO, '98000000103');
      await usuario(SEM_VINCULO, '98000000104');
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const profissional = async (nome: string) => {
        const pf = await pessoa(nome);
        return garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
          [pf, `massa ${P}`, agora],
        );
      };
      ids.prof = await profissional(`Pessoa sintética ${P} preceptor`);
      ids.profResidente = await profissional(`Pessoa sintética ${P} residente`);
      const profOutro = await profissional(`Pessoa sintética ${P} outro`);
      const ocupacao = await garantir(
        e,
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        [CBO],
        'INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES (?, ?, ?)',
        [CBO, 'Médico sintético', agora],
      );
      const conselho = await garantir(
        e,
        'SELECT id FROM conselho_classe WHERE sigla = ? OR codigo_tiss = ? ORDER BY (sigla = ?) DESC LIMIT 1',
        ['LZPAR', 'Z9', 'LZPAR'],
        'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)',
        ['Z9', 'LZPAR', 'Conselho sintético do lote l98par', agora],
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
      const inscricoes: number[] = [];
      for (const [prof, numero] of [
        [ids.prof, '980001'],
        [ids.profResidente, '980002'],
        [profOutro, '980003'],
      ] as const)
        inscricoes.push(
          await garantir(
            e,
            'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
            [prof],
            `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
               numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, ?, ?, TRUE, ?)`,
            [prof, conselho, uf, numero, ocupacao, agora],
          ),
        );
      ids.inscricao = inscricoes[0]!;
      for (const [u, prof] of [
        [uPrec, ids.prof],
        [uRes, ids.profResidente],
        [uOutro, profOutro],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
          [u, ids.est],
          `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
             criado_em) VALUES (?, ?, ?, '2026-01-01', ?)`,
          [u, ids.est, prof, agora],
        );
      ids.especialidade = await garantir(
        e,
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        [`${P}esp`],
        'INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}esp`, 'Especialidade sintética l98par', agora],
      );
      await garantir(
        e,
        'SELECT id FROM especialidade_ocupacao WHERE especialidade_medica_id = ? AND ocupacao_cbo_id = ?',
        [ids.especialidade, ocupacao],
        'INSERT INTO especialidade_ocupacao (especialidade_medica_id, ocupacao_cbo_id, criado_em) VALUES (?, ?, ?)',
        [ids.especialidade, ocupacao, agora],
      );
      const pac = await pessoa(`Pessoa sintética ${P} paciente`);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pac, 909_800_401, agora],
      );
      for (const [codigo, categoria] of [
        [`${P.toUpperCase()}_EVOL`, 'evolucao'],
        [`${P.toUpperCase()}_REL`, 'relatorio'],
        [`${P.toUpperCase()}_DECL`, 'declaracao'],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM tipo_documento_clinico WHERE codigo = ?',
          [codigo],
          'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Tipo sintético ${categoria}`, categoria, agora],
        );
      await garantir(
        e,
        "SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE LIMIT 1",
        [],
        "INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'lancado', ?)",
        [`${P}-lancado`, 'Situação sintética lançado', agora],
      );
      const tipoEvol = await e.uma('SELECT id FROM tipo_documento_clinico WHERE codigo = ?', [
        `${P.toUpperCase()}_EVOL`,
      ]);
      const modelo = await garantir(
        e,
        'SELECT id FROM modelo_documento_clinico WHERE codigo = ?',
        [`${P.toUpperCase()}_MOD`],
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
         VALUES (?, ?, ?, 'evolucao', ?)`,
        [`${P.toUpperCase()}_MOD`, 'Evolução sintética l98par', Number(tipoEvol!['id']), agora],
      );
      const cat = await garantir(
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
        [ids.est, 'L98-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L98-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [ids.est, ids.paciente, cat, carater, fonte, ids.prof, new Date('2026-11-20T10:00:00Z'), agora],
      );
      ids.registro = await e.inserir(
        `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
           autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento, impressao_digital,
           situacao, exige_coassinatura, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_coassinatura', TRUE, ?)`,
        [ids.est, ids.paciente, ids.atendimento, modelo, ids.profResidente, uRes, agora, agora, HASH, agora],
      );
      ids.supervisao = await e.inserir(
        `INSERT INTO registro_assistencial_supervisao (registro_assistencial_id, sequencia, supervisionado_profissional_id,
           preceptor_profissional_id, tipo_vinculo, solicitado_em, criado_em) VALUES (?, 1, ?, ?, 'residente', ?, ?)`,
        [ids.registro, ids.profResidente, ids.prof, agora, agora],
      );
      const parecer = () =>
        e.inserir(
          `INSERT INTO interconsulta (estabelecimento_id, atendimento_id, paciente_id, solicitante_profissional_id,
             especialidade_medica_id, motivo, solicitado_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [ids.est, ids.atendimento, ids.paciente, ids.profResidente, ids.especialidade, 'Pedido sintético', agora, agora],
        );
      ids.parecer1 = await parecer();
      ids.parecer2 = await parecer();
    });
    porta = new DocumentosPropriaPareceres(nucleo, CLIENTE);
  }, 180_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (ids.est) await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, limpar);
    await nucleo.encerrar();
  });

  it('especialidades, especialidades da ocupação da inscrição e o histórico de pareceres', async () => {
    expect(await porta.especialidades(C())).toContainEqual({
      id: ids.especialidade,
      nome: 'Especialidade sintética l98par',
    });
    expect(await porta.especialidadesDoCbo(C(), [ids.inscricao])).toContain(ids.especialidade);
    expect(await porta.especialidadesDoCbo(C(), [])).toEqual([]);
    expect(await porta.historicoPareceres(C(), ids.paciente)).toEqual({
      pedidos: 2,
      respostas: 0,
      encaminhamentos: 0,
    });
  });

  it('sem profissional da sessão, a gravação é recusada (403) e nada muda', async () => {
    expect(await recusa(porta.aceitarParecer(G(SEM_VINCULO), ids.parecer1))).toEqual({
      codigo: 'sem-profissional',
      status: 403,
    });
  });

  it('parecer: aceite, cancelamento com motivo e recusas de situação; nada apagado', async () => {
    expect(await recusa(porta.aceitarParecer(G(), 999_999_999))).toEqual({ codigo: 'registro-inexistente', status: 404 });
    expect(await porta.aceitarParecer(G(), ids.parecer1)).toEqual({ paciente: ids.paciente });
    expect(await recusa(porta.aceitarParecer(G(), ids.parecer1))).toEqual({ codigo: 'situacao-invalida', status: 409 });
    await porta.cancelarParecer(G(), ids.parecer2, 'Pedido em duplicidade');
    expect(await recusa(porta.cancelarParecer(G(), ids.parecer2, 'de novo'))).toEqual({
      codigo: 'situacao-invalida',
      status: 409,
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM interconsulta WHERE estabelecimento_id = ? AND
           ((id = ? AND situacao = 'aceito' AND aceito_por_profissional_id = ?) OR
            (id = ? AND situacao = 'cancelado' AND motivo_cancelamento = 'Pedido em duplicidade'))`,
        [ids.est, ids.parecer1, ids.prof, ids.parecer2],
      ),
    ).toBe(2);
  });

  it('coassinatura: fila do preceptor, recusa de outro profissional, coassinado finaliza o registro', async () => {
    expect(await porta.registrosSemAssinatura(C(), RESIDENTE)).toContainEqual(
      expect.objectContaining({ registro: ids.registro, hash: HASH, paciente: ids.paciente }),
    );
    const fila = await porta.coassinaturas(C(), LOGIN);
    expect(fila).toEqual([
      expect.objectContaining({ id: ids.supervisao, registro: ids.registro, residente: RESIDENTE, preceptor: LOGIN, situacao: 'pendente' }),
    ]);
    expect(await porta.supervisao(C(), ids.supervisao)).toMatchObject({ preceptor: LOGIN, residente: RESIDENTE });
    expect(await recusa(porta.coassinarNoNovo(G(OUTRO), { id: ids.supervisao, decisao: 'coassinado' }))).toEqual({
      codigo: 'sem-permissao',
      status: 403,
    });
    expect(await porta.coassinarNoNovo(G(), { id: ids.supervisao, decisao: 'coassinado' })).toEqual({
      registro: ids.registro,
      paciente: ids.paciente,
    });
    expect(await recusa(porta.coassinarNoNovo(G(), { id: ids.supervisao, decisao: 'coassinado' }))).toEqual({
      codigo: 'coassinatura-encerrada',
      status: 409,
    });
    expect(
      await contar("SELECT COUNT(*) AS n FROM registro_assistencial WHERE id = ? AND situacao = 'finalizado'", [
        ids.registro,
      ]),
    ).toBe(1);
    expect(await porta.coassinaturas(C(), LOGIN)).toEqual([]);
  });

  it('problemas: inclusão, mudança por nova versão, conflito de versão e descarte com justificativa', async () => {
    const base = {
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      descricao: 'Problema sintético',
      cid: 'Z00',
      idCid: null,
      tipo: 'problema' as const,
      inicio: '2026-11-01',
      fim: null,
    };
    const v1 = await porta.gravarProblema(G(), { ...base, situacao: 'ativo', anterior: null });
    const v2 = await porta.gravarProblema(G(), { ...base, situacao: 'resolvido', fim: '2026-11-10', anterior: v1 });
    expect(await recusa(porta.gravarProblema(G(), { ...base, situacao: 'descartado', anterior: v1 }))).toEqual({
      codigo: 'conflito-versao',
      status: 409,
    });
    const v3 = await porta.gravarProblema(G(), { ...base, situacao: 'descartado', anterior: v2 });
    const ps = await porta.problemas(C(), ids.paciente);
    expect(ps.map((p) => [p.id, p.anterior, p.situacao])).toEqual([
      [v1, null, 'ativo'],
      [v2, v1, 'resolvido'],
      [v3, v2, 'descartado'],
    ]);
    expect(ps[1]).toMatchObject({ fim: '2026-11-10', cid: 'Z00', usuario: LOGIN });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM problema_paciente WHERE estabelecimento_id = ? AND situacao = 'refutado' AND justificativa_inativacao IS NOT NULL",
        [ids.est],
      ),
    ).toBe(1);
  });

  it('sumário de alta: rascunho por versão, conflito na versão já salva', async () => {
    const s = { paciente: ids.paciente, atendimento: ids.atendimento, conteudo: '{"motivo":"x"}', hashConteudo: HASH };
    expect(await porta.salvarRascunhoSumario(G(), { ...s, versao: 1 })).toBe(1);
    expect(await recusa(porta.salvarRascunhoSumario(G(), { ...s, versao: 1 }))).toEqual({
      codigo: 'conflito-versao',
      status: 409,
    });
    expect(await porta.salvarRascunhoSumario(G(), { ...s, versao: 2 })).toBe(2);
    const vs = await porta.sumarios(C(), ids.atendimento);
    expect(vs.map((v) => [v.versao, v.situacao, v.usuario])).toEqual([
      [1, 'rascunho', LOGIN],
      [2, 'rascunho', LOGIN],
    ]);
    expect(JSON.parse(vs[1]!.conteudo!)).toEqual({ motivo: 'x' });
  });

  it('transferência e óbito: registro com o documento do prontuário; óbito repetido recusa', async () => {
    const t = await porta.registrarTransferencia(G(), {
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      destino: 'Hospital sintético de destino',
      motivo: 'Leito de terapia intensiva',
      conteudo: '{"resumo":"x"}',
      cbo: ids.inscricao,
      hashConteudo: HASH,
    });
    expect(await porta.transferencias(C(), ids.atendimento)).toEqual([
      expect.objectContaining({ id: t.id, destino: 'Hospital sintético de destino', documento: t.documento }),
    ]);
    const o = {
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      dataHora: new Date('2026-11-22T10:00:00Z'),
      numero: null,
      causas: 'Causa sintética',
      cbo: null,
      hashConteudo: HASH,
    };
    const ob = await porta.registrarObito(G(), o);
    expect(await porta.obito(C(), ids.paciente)).toEqual({
      em: '2026-11-22T07:00:00',
      numero: null,
      documento: ob.documento,
      atendimento: ids.atendimento,
    });
    expect(await recusa(porta.registrarObito(G(), o))).toEqual({ codigo: 'ja-registrado', status: 409 });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM documento_prontuario d
           JOIN documento_prontuario_evento ev ON ev.documento_prontuario_id = d.id AND ev.acao = 'criacao'
          WHERE d.estabelecimento_id = ? AND d.entidade_origem IN ('relatorio_transferencia','declaracao_obito')`,
        [ids.est],
      ),
    ).toBe(2);
  });

  it('ciência: resultado inexistente recusa (404); sem ciência, lista vazia; trilha gravada', async () => {
    expect(
      await recusa(
        porta.registrarCiencia(G(), {
          paciente: ids.paciente,
          exame: 999_999_999,
          chave: 'k',
          resultado: null,
          elemento: null,
          conduta: 'Conduta sintética',
          escalonadoPara: null,
        }),
      ),
    ).toEqual({ codigo: 'nao-encontrado', status: 404 });
    expect(await porta.ciencias(C(), ids.paciente)).toEqual([]);
    expect(await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est])).toBeGreaterThan(0);
  });
});
