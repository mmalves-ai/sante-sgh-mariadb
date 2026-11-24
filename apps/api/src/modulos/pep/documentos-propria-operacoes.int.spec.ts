// Integração da família "pep-resto" (gravações próprias do executar de documentos) contra o MariaDB real (cliente de
// teste f22_o4, com a migração 06_PEP/93_receita_conteudo). Massa SINTÉTICA do lote l93pr: cadastros reaproveitáveis
// garantidos no beforeAll; alergias, receitas, atestados, exames externos, sumários e documentos do prontuário do lote
// apagados no início e no fim (só a massa de teste; a porta nunca apaga). A trilha do executor não é apagada (cadeia do
// SBIS-16). Nenhum dado de pessoa real. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operacoesDocumentosPropria } from './documentos-propria-operacoes.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_DOCS_RESTO']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l93pr';
const LOGIN = `${P}.medico`;
const CBO = '225125';
const HASH = 'b'.repeat(64);
const DOC = 'x'.repeat(60);

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

describe.skipIf(SEM_BANCO)('documentos-propria-operacoes contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  const ids = { est: 0, usuario: 0, prof: 0, inscricao: 0, paciente: 0, atendimento: 0, alergeno: 0, principio: 0 };
  let fuso = 'America/Sao_Paulo';
  const C = () => ({
    rede: 'rede-sintetica',
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: ids.usuario,
    correlacao: `${P}-op`,
  });
  const ctx = (n: string) => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: ids.usuario,
    correlacao: `${P}-${n}`,
    chaveIdempotencia: `${P}:${randomUUID()}`,
  });
  const ops = () => operacoesDocumentosPropria(nucleo, CLIENTE);
  const agoraLocal = (minutos = 0) =>
    (dataHora(new Date(Date.now() + minutos * 60_000), fuso) ?? '').slice(0, 16);
  const uma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (l) => l.uma(sql, p));
  const versao = async () => {
    const r = await uma(
      `SELECT COALESCE(GROUP_CONCAT(id ORDER BY id), '') AS v FROM alergia_paciente
        WHERE paciente_id = ? AND ativa = TRUE AND excluido_em IS NULL AND tipo_registro IN ('alergia','intolerancia')
          AND situacao_registro = 'confirmado'`,
      [ids.paciente],
    );
    return String(r?.['v'] ?? '');
  };

  const limpar = (e: Escritor) =>
    (async () => {
      const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
      await e.executar(
        `DELETE ev FROM documento_prontuario_evento ev JOIN documento_prontuario d ON d.id = ev.documento_prontuario_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`UPDATE documento_emitido SET documento_prontuario_id = NULL WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`UPDATE sumario_alta SET documento_prontuario_id = NULL WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`DELETE FROM documento_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(
        `DELETE pp FROM alergia_paciente_principio pp JOIN alergia_paciente a ON a.id = pp.alergia_paciente_id
          WHERE a.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(
        `DELETE v FROM documento_emitido_versao v JOIN documento_emitido d ON d.id = v.documento_emitido_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      for (const t of ['alergia_paciente', 'documento_emitido', 'receita_medica', 'exame_lancado_prontuario', 'sumario_alta'])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
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
      fuso = fusoValido((await e.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [ids.est]))?.['fuso_horario']);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
        [LOGIN, `Conta sintética ${LOGIN}`, '24000093101', agora],
      );
      const pessoa = (nome: string) =>
        garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [nome], 'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          nome,
          agora,
        ]);
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
      ids.inscricao = await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
        [ids.prof],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, '930001', ?, TRUE, ?)`,
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
        [pessoaPac, 902_493_001, agora],
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
        [ids.est, 'L93-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L93-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [ids.est, ids.paciente, categoriaAt, carater, fonte, ids.prof, new Date('2026-11-20T10:00:00Z'), agora],
      );
      await garantir(
        e,
        'SELECT id FROM tipo_receita WHERE codigo = ?',
        [`${P}simples`],
        'INSERT INTO tipo_receita (codigo, descricao, padrao, validade_dias, criado_em) VALUES (?, ?, TRUE, 30, ?)',
        [`${P}simples`, 'Receita simples sintética', agora],
      );
      await garantir(
        e,
        "SELECT id FROM sequencia_negocio WHERE tipo = 'receita_medica' AND estabelecimento_id = ?",
        [ids.est],
        "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, criado_em) VALUES (?, 'receita_medica', 'RX-', 1, ?)",
        [ids.est, agora],
      );
      for (const cat of ['outro', 'receita', 'atestado', 'declaracao', 'sumario', 'laudo'])
        await garantir(
          e,
          'SELECT id FROM tipo_documento_clinico WHERE codigo = ?',
          [`${P}${cat}`],
          'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}${cat}`, `Tipo sintético ${cat}`, cat, agora],
        );
      await garantir(
        e,
        "SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE LIMIT 1",
        [],
        'INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}lanc`, 'Lançado (sintético)', 'lancado', agora],
      );
      ids.alergeno = await garantir(
        e,
        'SELECT id FROM alergeno WHERE codigo = ?',
        [`${P}ag`],
        "INSERT INTO alergeno (codigo, descricao, natureza, criado_em) VALUES (?, 'Agente sintético', 'medicamento', ?)",
        [`${P}ag`, agora],
      );
      ids.principio = await garantir(
        e,
        'SELECT id FROM principio_ativo WHERE codigo_dcb = ?',
        [`${P}pa`],
        "INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES (?, 'Princípio sintético', 'teste', ?)",
        [`${P}pa`, agora],
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, (e) => limpar(e));
      await nucleo.encerrar();
    }
  });

  const baseAlergia = () => ({
    paciente: ids.paciente,
    atendimento: ids.atendimento,
    cbo: ids.inscricao,
    registro: 1,
    nega: false,
    principios: [] as number[],
    hashConteudo: HASH,
  });

  it('alergia do catálogo com princípio; duplicada recusa; versão velha é conflito', async () => {
    const r = await ops()['pep.registrarAlergia']!(
      C(),
      { ...baseAlergia(), agente: ids.alergeno, principios: [ids.principio], gravidade: 'grave', origem: 'relato-paciente', versao: await versao() },
      ctx('ag'),
    );
    expect(Number(r['alergia'])).toBeGreaterThan(0);
    expect(Number(r['documento'])).toBeGreaterThan(0);
    const l = await uma(
      `SELECT a.fonte_informacao, a.registrado_profissional_id, (SELECT COUNT(*) FROM alergia_paciente_principio p
          WHERE p.alergia_paciente_id = a.id) AS princ FROM alergia_paciente a WHERE a.id = ?`,
      [r['alergia']],
    );
    expect(l?.['fonte_informacao']).toBe('relato_paciente');
    expect(Number(l?.['registrado_profissional_id'])).toBe(ids.prof);
    expect(Number(l?.['princ'])).toBe(1);
    expect(
      await codigo(ops()['pep.registrarAlergia']!(C(), { ...baseAlergia(), agente: ids.alergeno, versao: await versao() }, ctx('ag2'))),
    ).toBe('duplicada');
    expect(await codigo(ops()['pep.registrarAlergia']!(C(), { ...baseAlergia(), agente: ids.alergeno, versao: '' }, ctx('ag3')))).toBe(
      'conflito-versao',
    );
  });

  it('alergia livre: duplicidade pela descrição normalizada', async () => {
    const r = await ops()['pep.registrarAlergia']!(
      C(),
      { ...baseAlergia(), descricaoLivre: 'Dipirona Sódica', versao: await versao() },
      ctx('lv'),
    );
    const l = await uma('SELECT alergeno_id, descricao_livre FROM alergia_paciente WHERE id = ?', [r['alergia']]);
    expect(l?.['alergeno_id']).toBeNull();
    expect(
      await codigo(
        ops()['pep.registrarAlergia']!(C(), { ...baseAlergia(), descricaoLivre: '  dipirona   SODICA ', versao: await versao() }, ctx('lv2')),
      ),
    ).toBe('duplicada');
  });

  it('inativar: nova versão com motivo, nada apagado; a segunda vez é conflito', async () => {
    const v = await versao();
    const alvo = Number(v.split(',')[0]);
    const r = await ops()['pep.inativarAlergia']!(
      C(),
      { paciente: ids.paciente, alergia: alvo, motivo: 'Informação corrigida pelo paciente', versao: v },
      ctx('in'),
    );
    expect(r['alergia']).toBe(alvo);
    const l = await uma('SELECT ativa, motivo_inativacao, inativado_por_usuario_id, versao FROM alergia_paciente WHERE id = ?', [alvo]);
    expect(Number(l?.['ativa'])).toBe(0);
    expect(Number(l?.['inativado_por_usuario_id'])).toBe(ids.usuario);
    expect(Number(l?.['versao'])).toBe(2);
    expect(
      await codigo(
        ops()['pep.inativarAlergia']!(
          C(),
          { paciente: ids.paciente, alergia: alvo, motivo: 'Informação corrigida pelo paciente', versao: await versao() },
          ctx('in2'),
        ),
      ),
    ).toBe('conflito-versao');
  });

  it('nega alergias: grava a declaração; repetida sem alergia depois recusa', async () => {
    const r = await ops()['pep.registrarAlergia']!(C(), { ...baseAlergia(), nega: true, versao: await versao() }, ctx('ng'));
    expect(r['alergia']).toBe(0);
    expect(await codigo(ops()['pep.registrarAlergia']!(C(), { ...baseAlergia(), nega: true, versao: await versao() }, ctx('ng2')))).toBe(
      'nega-repetida',
    );
  });

  const baseDoc = () => ({
    paciente: ids.paciente,
    atendimento: ids.atendimento,
    cbo: ids.inscricao,
    retratos: { htAtendimento: ids.atendimento, htPaciente: ids.paciente },
    dataHoraClinica: agoraLocal(),
    documento: DOC,
    hashConteudo: HASH,
  });

  it('receita: número da sequência, conteúdo na linha e documento do prontuário', async () => {
    const r = await ops()['pep.emitirDocumento']!(
      C(),
      { ...baseDoc(), familia: 'receita', tipo: 'receita', tpPadrao: 1, rtf: '{\\rtf1 receita sintetica}' },
      ctx('rx'),
    );
    const l = await uma(
      `SELECT r.numero, r.conteudo, r.hash_conteudo, r.situacao, r.validade_ate IS NOT NULL AS validade,
              d.entidade_origem FROM receita_medica r JOIN documento_prontuario d ON d.id = ? WHERE r.id = ?`,
      [r['documento'], r['origem']],
    );
    expect(String(l?.['numero'])).toMatch(/^RX-\d+$/);
    expect(l?.['conteudo']).toBe('{\\rtf1 receita sintetica}');
    expect(l?.['hash_conteudo']).toBe(HASH);
    expect(l?.['situacao']).toBe('emitida');
    expect(Number(l?.['validade'])).toBe(1);
    expect(l?.['entidade_origem']).toBe('receita_medica');
  });

  it('atestado: exige os dias; emite com a versão "emissao" e o vínculo ao documento', async () => {
    const at = { ...baseDoc(), familia: 'atestado', tipo: 'atestado', modeloNome: 'Atestado médico', conteudoXml: '<atestado>sintetico</atestado>' };
    expect(await codigo(ops()['pep.emitirDocumento']!(C(), at, ctx('at0')))).toBe('dias-afastamento-obrigatorio');
    const r = await ops()['pep.emitirDocumento']!(C(), { ...at, diasAfastamento: 2 }, ctx('at'));
    const l = await uma(
      `SELECT d.dias_afastamento, d.documento_prontuario_id, d.situacao,
              (SELECT COUNT(*) FROM documento_emitido_versao v WHERE v.documento_emitido_id = d.id AND v.acao = 'emissao') AS v
         FROM documento_emitido d WHERE d.id = ?`,
      [r['origem']],
    );
    expect(Number(l?.['dias_afastamento'])).toBe(2);
    expect(Number(l?.['documento_prontuario_id'])).toBe(Number(r['documento']));
    expect(l?.['situacao']).toBe('valido');
    expect(Number(l?.['v'])).toBe(1);
  });

  it('exame externo: lança com o resultado; feito no futuro recusa', async () => {
    const ex = {
      ...baseDoc(),
      realizadoEm: agoraLocal(-60),
      dataHoraClinica: agoraLocal(),
      nomeExame: 'Hemograma sintético',
      rtf: '{\\rtf1 resultado sintetico}',
      itens: [],
    };
    const r = await ops()['pep.lancarExameExterno']!(C(), ex, ctx('ex'));
    const l = await uma('SELECT nome_exame, resultado, situacao, profissional_id FROM exame_lancado_prontuario WHERE id = ?', [r['origem']]);
    expect(l?.['nome_exame']).toBe('Hemograma sintético');
    expect(l?.['situacao']).toBe('ativo');
    expect(Number(l?.['profissional_id'])).toBe(ids.prof);
    expect(await codigo(ops()['pep.lancarExameExterno']!(C(), { ...ex, realizadoEm: agoraLocal(120), dataHoraClinica: agoraLocal(180) }, ctx('ex2')))).toBe(
      'horario-futuro',
    );
  });

  it('sumário de alta: finaliza a versão seguinte; de novo é "sumario-finalizado"', async () => {
    const s = {
      ...baseDoc(),
      modeloNome: 'Sumário de alta',
      conteudoXml: '<sumario>sintetico</sumario>',
      versao: 1,
      sumario: '{"motivo":"sintetico"}',
      fhir: '{"resourceType":"Bundle"}',
      perfilFhir: 'sumario-alta',
    };
    expect(await codigo(ops()['pep.finalizarSumarioAlta']!(C(), { ...s, versao: 2 }, ctx('sa0')))).toBe('conflito-versao');
    const r = await ops()['pep.finalizarSumarioAlta']!(C(), s, ctx('sa'));
    const l = await uma('SELECT situacao, finalizado_em IS NOT NULL AS f, documento_prontuario_id FROM sumario_alta WHERE id = ?', [r['origem']]);
    expect(l?.['situacao']).toBe('finalizado');
    expect(Number(l?.['f'])).toBe(1);
    expect(Number(l?.['documento_prontuario_id'])).toBe(Number(r['documento']));
    expect(await codigo(ops()['pep.finalizarSumarioAlta']!(C(), { ...s, versao: 2 }, ctx('sa2')))).toBe('sumario-finalizado');
  });
});
