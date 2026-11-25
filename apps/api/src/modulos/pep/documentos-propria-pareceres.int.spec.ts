// Integração da família "pareceres" da porta própria dos documentos contra o MariaDB real (cliente de teste f22_o5).
// Massa SINTÉTICA com o prefixo do lote (l98par), garantida no beforeAll e com as linhas clínicas do lote apagadas no
// início e no fim (a limpeza respeita a cadeia da trilha do SBIS-16); nenhum dado de pessoa real. A porta em si nunca
// apaga. A migração 06_PEP/98_pareceres (idempotente) é aplicada no beforeAll. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaCadastroPropria } from '../cadastro/porta-propria.js';
import { CATEGORIAS_ASSINAVEIS } from './documentos-porta-propria.js';
import { DocumentosPropriaPareceres } from './documentos-propria-pareceres.js';
import { ErroProntuario } from './tipos-pep.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';

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
  usuario: number;
  usuarioOutro: number;
  pacienteB: number;
  atendimentoB: number;
  pacienteC: number;
  atendimentoC: number;
  supervisao2: number;
  resultadoNovo: number;
  resultadoAberto: number;
  resultadoOutroPaciente: number;
  cienciaAberta: number;
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
      // O lote tem o estabelecimento principal (l98par) e o de isolamento (l98parx).
      const est = "(SELECT id FROM estabelecimento WHERE codigo LIKE CONCAT(?, '%'))";
      // A trilha (fecho, cabeça da cadeia, idempotência que aponta para ela e linhas) só do lote (SBIS-16).
      await limparTrilhaDaMassa(e, { prefixo: P });
      // A marca do óbito no cadastro aponta para a declaração (fk_paciente_declaracao_obito_id): sai antes dela.
      await e.executar(
        `UPDATE paciente SET falecido = FALSE, declaracao_obito_id = NULL, data_hora_obito = NULL
          WHERE declaracao_obito_id IN (SELECT id FROM declaracao_obito WHERE estabelecimento_id IN ${est})`,
        [P],
      );
      await e.executar(
        `DELETE ev FROM documento_prontuario_evento ev JOIN documento_prontuario d ON d.id = ev.documento_prontuario_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      for (const t of ['declaracao_obito', 'relatorio_transferencia', 'registro_assistencial'])
        await e.executar(
          `UPDATE ${t} SET documento_prontuario_id = NULL WHERE estabelecimento_id IN ${est}`,
          [P],
        );
      await e.executar(`DELETE FROM documento_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      for (const t of ['declaracao_obito_causa', 'declaracao_obito_evento'])
        await e.executar(
          `DELETE x FROM ${t} x JOIN declaracao_obito d ON d.id = x.declaracao_obito_id
            WHERE d.estabelecimento_id IN ${est}`,
          [P],
        );
      for (const t of [
        'declaracao_obito',
        'relatorio_transferencia',
        'sumario_alta',
        'ciencia_resultado_critico',
      ])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
      // Resultados sintéticos do lote (a ciência que aponta para eles já saiu).
      await e.executar(
        `DELETE r FROM resultado_exame r JOIN exame_item ei ON ei.id = r.exame_item_id
           JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id WHERE rq.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(
        `DELETE ei FROM exame_item ei JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
          WHERE rq.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN ${est}`, [P]);
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
  // 02-CAD linha 13: a marca do óbito no cadastro (falecido, declaração ligada e data copiada da declaração).
  const cadastro = (paciente: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conferencia` }, async (l) => {
      const x = await l.uma(
        'SELECT falecido, declaracao_obito_id, data_hora_obito FROM paciente WHERE id = ?',
        [paciente],
      );
      const d = x?.['data_hora_obito'];
      return {
        falecido: Number(x?.['falecido'] ?? 0) === 1,
        declaracao: x?.['declaracao_obito_id'] == null ? null : Number(x['declaracao_obito_id']),
        em: d instanceof Date ? d.toISOString() : d == null ? null : String(d),
      };
    });
  const vivo = { falecido: false, declaracao: null, em: null };
  // A leitura da ficha do cadastro (a mesma da busca), pela porta própria do cadastro.
  const fichaDoObito = async (paciente: number) => {
    const ctx = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: null,
      correlacao: `${P}-ficha`,
      rede: '',
      hospital: '',
    };
    const [p] = await new PortaCadastroPropria(nucleo, CLIENTE).lerPacientes(ctx, [paciente]);
    return {
      obito: p?.obito ?? null,
      obitoDeclaracao: p?.obitoDeclaracao ?? null,
      obitoCausa: p?.obitoCausa ?? null,
    };
  };

  beforeAll(async () => {
    const banco = `cliente_${CLIENTE}`;
    for (const arq of [
      '98_pareceres_tabelas.sql',
      '98_pareceres_chaves.sql',
      '99_obito_rascunho_tabelas.sql',
    ])
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
      ids.usuario = uPrec;
      ids.usuarioOutro = uOutro;
      const estX = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}x`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}x`, `Hospital sintético ${P}x`, `Hospital sintético ${P}x (fictício)`, agora],
      );
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
      // O preceptor também atende no estabelecimento de isolamento: lá, nada do estabelecimento principal aparece.
      await garantir(
        e,
        'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
        [uPrec, estX],
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
           criado_em) VALUES (?, ?, ?, '2026-01-01', ?)`,
        [uPrec, estX, ids.prof, agora],
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
      await garantir(
        e,
        "SELECT id FROM situacao_documento_prontuario WHERE categoria = 'cancelado' AND ativo = TRUE LIMIT 1",
        [],
        `INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, final, criado_em)
           VALUES (?, ?, 'cancelado', TRUE, ?)`,
        [`${P}-cancelado`, 'Situação sintética cancelado', agora],
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
      const atendimento = (numero: string, paciente: number) =>
        garantir(
          e,
          'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
          [ids.est, numero],
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
          [ids.est, numero, paciente, cat, carater, fonte, ids.prof, new Date('2026-11-20T10:00:00Z'), agora],
        );
      ids.atendimento = await atendimento('L98-1', ids.paciente);
      const outroPaciente = async (sufixo: string, prontuario: number) => {
        const pf = await pessoa(`Pessoa sintética ${P} paciente ${sufixo}`);
        return garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pf],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pf, prontuario, agora],
        );
      };
      ids.pacienteB = await outroPaciente('B', 909_800_402);
      ids.atendimentoB = await atendimento('L98-2', ids.pacienteB);
      ids.pacienteC = await outroPaciente('C', 909_800_403);
      ids.atendimentoC = await atendimento('L98-3', ids.pacienteC);
      // Exames sintéticos: dois resultados liberados do paciente A (um sem comunicação, outro com a comunicação do
      // laboratório aguardando ciência) e um do paciente B.
      const exame = await garantir(
        e,
        'SELECT id FROM exame WHERE codigo = ?',
        [`${P.toUpperCase()}K`],
        "INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES (?, ?, ?, 'laboratorio', ?)",
        [`${P.toUpperCase()}K`, `${P.toUpperCase()}K`, `${P} POTÁSSIO SINTÉTICO`, agora],
      );
      const setor = await garantir(
        e,
        'SELECT id FROM setor_diagnostico WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}lab`],
        "INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'laboratorio', ?)",
        [ids.est, `${P}lab`, 'Laboratório sintético', agora],
      );
      const resultado = async (seq: number, paciente: number, atend: number) => {
        const rq = await e.inserir(
          `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, solicitante_profissional_id,
             fonte_pagadora_id, prioridade, solicitado_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'urgente', ?, ?)`,
          [ids.est, `${P}-${seq}`, paciente, atend, ids.prof, fonte, agora, agora],
        );
        const item = await e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, liberado_em, criado_em)
           VALUES (?, 1, ?, 'liberado', ?, ?)`,
          [rq, exame, agora, agora],
        );
        return e.inserir(
          `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, situacao, resultado_em,
             liberado_em, autoliberado, criado_em) VALUES (?, ?, ?, 'liberado', ?, ?, TRUE, ?)`,
          [item, paciente, setor, agora, agora, agora],
        );
      };
      ids.resultadoNovo = await resultado(1, ids.paciente, ids.atendimento);
      ids.resultadoAberto = await resultado(2, ids.paciente, ids.atendimento);
      ids.resultadoOutroPaciente = await resultado(3, ids.pacienteB, ids.atendimentoB);
      ids.cienciaAberta = await e.inserir(
        `INSERT INTO ciencia_resultado_critico (estabelecimento_id, resultado_exame_id, paciente_id, analito,
           comunicante_usuario_id, comunicado_em, canal_comunicacao, situacao, criado_em)
         VALUES (?, ?, ?, 'K', ?, ?, 'telefone', 'aguardando_ciencia', ?)`,
        [ids.est, ids.resultadoAberto, ids.paciente, uOutro, new Date(agora.getTime() - 3_600_000), agora],
      );
      ids.registro = await e.inserir(
        `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
           autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento, impressao_digital,
           situacao, exige_coassinatura, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_coassinatura', TRUE, ?)`,
        [ids.est, ids.paciente, ids.atendimento, modelo, ids.profResidente, uRes, agora, agora, HASH, agora],
      );
      const supervisao = (registro: number) =>
        e.inserir(
          `INSERT INTO registro_assistencial_supervisao (registro_assistencial_id, sequencia, supervisionado_profissional_id,
             preceptor_profissional_id, tipo_vinculo, solicitado_em, criado_em) VALUES (?, 1, ?, ?, 'residente', ?, ?)`,
          [registro, ids.profResidente, ids.prof, agora, agora],
        );
      ids.supervisao = await supervisao(ids.registro);
      // Segundo registro do residente, para a recusa da coassinatura.
      const registro2 = await e.inserir(
        `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
           autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento, impressao_digital,
           situacao, exige_coassinatura, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_coassinatura', TRUE, ?)`,
        [ids.est, ids.paciente, ids.atendimento, modelo, ids.profResidente, uRes, agora, agora, HASH, agora],
      );
      ids.supervisao2 = await supervisao(registro2);
      const parecer = () =>
        e.inserir(
          `INSERT INTO interconsulta (estabelecimento_id, atendimento_id, paciente_id, solicitante_profissional_id,
             especialidade_medica_id, motivo, solicitado_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ids.est,
            ids.atendimento,
            ids.paciente,
            ids.profResidente,
            ids.especialidade,
            'Pedido sintético',
            agora,
            agora,
          ],
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
    expect(await recusa(porta.aceitarParecer(G(), 999_999_999))).toEqual({
      codigo: 'registro-inexistente',
      status: 404,
    });
    expect(await porta.aceitarParecer(G(), ids.parecer1)).toEqual({ paciente: ids.paciente });
    expect(await recusa(porta.aceitarParecer(G(), ids.parecer1))).toEqual({
      codigo: 'situacao-invalida',
      status: 409,
    });
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
      expect.objectContaining({
        id: ids.supervisao,
        registro: ids.registro,
        residente: RESIDENTE,
        preceptor: LOGIN,
        situacao: 'pendente',
      }),
      expect.objectContaining({ id: ids.supervisao2, situacao: 'pendente' }),
    ]);
    expect(await porta.supervisao(C(), ids.supervisao)).toMatchObject({
      preceptor: LOGIN,
      residente: RESIDENTE,
    });
    expect(
      await recusa(porta.coassinarNoNovo(G(OUTRO), { id: ids.supervisao, decisao: 'coassinado' })),
    ).toEqual({
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
      await contar(
        "SELECT COUNT(*) AS n FROM registro_assistencial WHERE id = ? AND situacao = 'finalizado'",
        [ids.registro],
      ),
    ).toBe(1);
    // Recusa: sem motivo, 422 (o CHECK do banco exige o motivo); com motivo, gravada e o registro não finaliza.
    expect(
      await recusa(porta.coassinarNoNovo(G(), { id: ids.supervisao2, decisao: 'recusado', motivo: ' ' })),
    ).toEqual({ codigo: 'motivo-obrigatorio', status: 422 });
    expect(
      await porta.coassinarNoNovo(G(), {
        id: ids.supervisao2,
        decisao: 'recusado',
        motivo: 'Conduta a revisar',
      }),
    ).toMatchObject({ paciente: ids.paciente });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM registro_assistencial_supervisao s
           JOIN registro_assistencial ra ON ra.id = s.registro_assistencial_id
          WHERE s.id = ? AND s.situacao = 'recusado' AND s.motivo = 'Conduta a revisar' AND s.decidido_em IS NOT NULL
            AND ra.situacao = 'aguardando_coassinatura'`,
        [ids.supervisao2],
      ),
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
    const v2 = await porta.gravarProblema(G(), {
      ...base,
      situacao: 'resolvido',
      fim: '2026-11-10',
      anterior: v1,
    });
    expect(
      await recusa(porta.gravarProblema(G(), { ...base, situacao: 'descartado', anterior: v1 })),
    ).toEqual({
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
    const s = {
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      conteudo: '{"motivo":"x"}',
      hashConteudo: HASH,
    };
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
      id: ob.id,
      em: '2026-11-22T07:00:00',
      numero: null,
      documento: ob.documento,
      atendimento: ids.atendimento,
    });
    expect(await recusa(porta.registrarObito(G(), o))).toEqual({ codigo: 'ja-registrado', status: 409 });
    // O rascunho (sem número) ainda não é a declaração emitida: o cadastro não muda.
    expect(await cadastro(ids.paciente)).toEqual(vivo);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM documento_prontuario d
           JOIN documento_prontuario_evento ev ON ev.documento_prontuario_id = d.id AND ev.acao = 'criacao'
          WHERE d.estabelecimento_id = ? AND d.entidade_origem IN ('relatorio_transferencia','declaracao_obito')`,
        [ids.est],
      ),
    ).toBe(2);
  });

  it('óbito com número: emitido; o mesmo número no estabelecimento é recusado', async () => {
    const o = {
      dataHora: new Date('2026-11-22T11:00:00Z'),
      numero: 'L9800001',
      causas: 'Causa sintética',
      cbo: null,
      hashConteudo: HASH,
    };
    const ob = await porta.registrarObito(G(), {
      ...o,
      paciente: ids.pacienteB,
      atendimento: ids.atendimentoB,
    });
    expect(await porta.obito(C(), ids.pacienteB)).toMatchObject({
      numero: 'L9800001',
      documento: ob.documento,
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM declaracao_obito
          WHERE id = ? AND situacao = 'emitida' AND emitida_em IS NOT NULL AND numero = 'L9800001'`,
        [ob.id],
      ),
    ).toBe(1);
    // 02-CAD linha 13: a emissão marca o óbito no cadastro na mesma transação.
    expect(await cadastro(ids.pacienteB)).toEqual({
      falecido: true,
      declaracao: ob.id,
      em: '2026-11-22T11:00:00.000Z',
    });
    expect(
      await recusa(
        porta.registrarObito(G(), { ...o, paciente: ids.pacienteC, atendimento: ids.atendimentoC }),
      ),
    ).toEqual({ codigo: 'numero-repetido', status: 409 });
    expect(
      await contar('SELECT COUNT(*) AS n FROM declaracao_obito WHERE paciente_id = ?', [ids.pacienteC]),
    ).toBe(0);
    // A recusa desfaz tudo: o cadastro do paciente C segue vivo.
    expect(await cadastro(ids.pacienteC)).toEqual(vivo);
  });

  it('óbito (L126): causas em linhas, evento de emissão; cancelamento com motivo e evento; nova declaração depois', async () => {
    const o = {
      paciente: ids.pacienteC,
      atendimento: ids.atendimentoC,
      dataHora: new Date('2026-11-22T12:00:00Z'),
      numero: 'L9800002',
      causas: 'Causa sintética a | Causa sintética b | Condição sintética',
      causasLinhas: [
        { sequencia: 1, parte: 'I' as const, linha: 'a' as const, descricao: 'Causa sintética a' },
        { sequencia: 2, parte: 'I' as const, linha: 'b' as const, descricao: 'Causa sintética b' },
        { sequencia: 3, parte: 'II' as const, linha: null, descricao: 'Condição sintética' },
      ],
      cbo: null,
      hashConteudo: HASH,
    };
    const ob = await porta.registrarObito(G(), o);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM declaracao_obito_causa
          WHERE declaracao_obito_id = ? AND ((parte = 'I' AND linha IN ('a','b')) OR (parte = 'II' AND linha IS NULL))`,
        [ob.id],
      ),
    ).toBe(3);
    const eventos = (tipo: string) =>
      contar(
        'SELECT COUNT(*) AS n FROM declaracao_obito_evento WHERE declaracao_obito_id = ? AND tipo_evento = ?',
        [ob.id, tipo],
      );
    expect(await eventos('emissao')).toBe(1);
    // Motivo curto: recusa e nada muda.
    expect(
      await recusa(porta.cancelarObito(G(), { paciente: ids.pacienteC, motivo: 'curto', cbo: null })),
    ).toEqual({ codigo: 'motivo-obrigatorio', status: 422 });
    expect(await eventos('cancelamento')).toBe(0);
    const motivo = 'Número do formulário trocado na emissão';
    // Quem não emitiu não cancela (403), e nada muda.
    expect(
      await recusa(porta.cancelarObito(G(RESIDENTE), { paciente: ids.pacienteC, motivo, cbo: null })),
    ).toEqual({
      codigo: 'nao-emissor',
      status: 403,
    });
    expect(await eventos('cancelamento')).toBe(0);
    // Recusado o cancelamento, a marca do óbito continua.
    expect(await cadastro(ids.pacienteC)).toMatchObject({ falecido: true, declaracao: ob.id });
    expect(await porta.cancelarObito(G(), { paciente: ids.pacienteC, motivo, cbo: null })).toEqual({
      id: ob.id,
      documento: ob.documento,
    });
    // 02-CAD linha 13: a declaração cancelada desfaz a marca no cadastro na mesma transação.
    expect(await cadastro(ids.pacienteC)).toEqual(vivo);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM declaracao_obito
          WHERE id = ? AND situacao = 'cancelada' AND cancelada_em IS NOT NULL AND motivo_cancelamento = ?
            AND excluido_em IS NULL`,
        [ob.id, motivo],
      ),
    ).toBe(1);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM declaracao_obito_evento
          WHERE declaracao_obito_id = ? AND tipo_evento = 'cancelamento' AND operacao = 'alteracao'
            AND motivo = ? AND numero = 'L9800002' AND usuario_id IS NOT NULL`,
        [ob.id, motivo],
      ),
    ).toBe(1);
    // A emitida mantém a data de emissão.
    expect(
      await contar('SELECT COUNT(*) AS n FROM declaracao_obito WHERE id = ? AND emitida_em IS NOT NULL', [
        ob.id,
      ]),
    ).toBe(1);
    // O documento do prontuário sai de vigência: situação de categoria "cancelado" e evento de cancelamento com o
    // motivo na cadeia do documento, depois do evento de criação.
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM documento_prontuario dp
           JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
          WHERE dp.id = ? AND s.categoria = 'cancelado' AND dp.excluido_em IS NULL`,
        [ob.documento],
      ),
    ).toBe(1);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM documento_prontuario_evento c
           JOIN documento_prontuario_evento x ON x.documento_prontuario_id = c.documento_prontuario_id
                AND x.acao = 'cancelamento' AND x.justificativa = ? AND x.operacao = 'alteracao' AND x.id > c.id
          WHERE c.documento_prontuario_id = ? AND c.acao = 'criacao'`,
        [motivo, ob.documento],
      ),
    ).toBe(1);
    // Fora da fila de assinatura e não vigente na leitura: "cancelado" não está nas categorias assináveis.
    expect(CATEGORIAS_ASSINAVEIS.includes('cancelado')).toBe(false);
    expect(await porta.obito(C(), ids.pacienteC)).toBeNull();
    expect(await recusa(porta.cancelarObito(G(), { paciente: ids.pacienteC, motivo, cbo: null }))).toEqual({
      codigo: 'registro-inexistente',
      status: 404,
    });
    // Cancelada, a pessoa pode receber nova declaração (com outro número); a cancelada continua no banco.
    const nova = await porta.registrarObito(G(), { ...o, numero: 'L9800003' });
    expect(await porta.obito(C(), ids.pacienteC)).toMatchObject({ id: nova.id, numero: 'L9800003' });
    expect(await cadastro(ids.pacienteC)).toEqual({
      falecido: true,
      declaracao: nova.id,
      em: '2026-11-22T12:00:00.000Z',
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM declaracao_obito WHERE paciente_id = ?', [ids.pacienteC]),
    ).toBe(2);
    // 02-CAD linha 13: a ficha e a busca do cadastro mostram o óbito da declaração emitida: data civil, número e
    // causa básica (a última linha preenchida da parte I).
    expect(await fichaDoObito(ids.pacienteC)).toEqual({
      obito: '2026-11-22',
      obitoDeclaracao: 'L9800003',
      obitoCausa: 'Causa sintética b',
    });
    // Rascunho (sem número) cancelado: sem data de emissão inventada e sem evento de emissão; só o de cancelamento.
    await porta.cancelarObito(G(), { paciente: ids.pacienteC, motivo, cbo: null });
    expect(await cadastro(ids.pacienteC)).toEqual(vivo);
    expect(await fichaDoObito(ids.pacienteC)).toEqual({
      obito: null,
      obitoDeclaracao: null,
      obitoCausa: null,
    });
    const rascunho = await porta.registrarObito(G(), { ...o, numero: null });
    expect(await cadastro(ids.pacienteC)).toEqual(vivo);
    await porta.cancelarObito(G(), {
      paciente: ids.pacienteC,
      motivo: 'Rascunho aberto no paciente errado',
      cbo: null,
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM declaracao_obito
          WHERE id = ? AND situacao = 'cancelada' AND numero IS NULL AND emitida_em IS NULL AND cancelada_em IS NOT NULL`,
        [rascunho.id],
      ),
    ).toBe(1);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM declaracao_obito_evento WHERE declaracao_obito_id = ? AND tipo_evento = 'emissao'`,
        [rascunho.id],
      ),
    ).toBe(0);
    expect(
      await contar('SELECT COUNT(*) AS n FROM declaracao_obito WHERE paciente_id = ?', [ids.pacienteC]),
    ).toBe(3);
  });

  it('óbito (04-INT L74): o responsável técnico cancela a declaração de outro médico, com motivo, evento e trilha de terceiro', async () => {
    const ob = await porta.registrarObito(G(), {
      paciente: ids.pacienteC,
      atendimento: ids.atendimentoC,
      dataHora: new Date('2026-11-22T12:00:00Z'),
      numero: 'L9800004',
      causas: 'Causa sintética a',
      causasLinhas: [
        { sequencia: 1, parte: 'I' as const, linha: 'a' as const, descricao: 'Causa sintética a' },
      ],
      cbo: null,
      hashConteudo: HASH,
    });
    const motivo = 'Causa básica registrada na linha errada pelo emissor';
    const base = { paciente: ids.pacienteC, motivo, cbo: null };
    // Sem a permissão do responsável técnico, quem não emitiu continua recusado (403) e nada muda.
    expect(await recusa(porta.cancelarObito(G(RESIDENTE), { ...base, podeCancelarDeOutro: false }))).toEqual({
      codigo: 'nao-emissor',
      status: 403,
    });
    // Com a permissão, o motivo continua obrigatório.
    expect(
      await recusa(
        porta.cancelarObito(G(RESIDENTE), { ...base, motivo: 'curto', podeCancelarDeOutro: true }),
      ),
    ).toEqual({ codigo: 'motivo-obrigatorio', status: 422 });
    expect(await cadastro(ids.pacienteC)).toMatchObject({ falecido: true, declaracao: ob.id });
    const trilhaTerceiro = () =>
      contar(
        `SELECT COUNT(*) AS n FROM trilha_auditoria
          WHERE estabelecimento_id = ? AND entidade = 'declaracao_obito' AND entidade_id = ? AND motivo = ?
            AND JSON_CONTAINS(dados_depois, 'true', '$.dados.canceladoPorTerceiro') = 1`,
        [ids.est, ob.id, motivo],
      );
    expect(await trilhaTerceiro()).toBe(0);
    expect(await porta.cancelarObito(G(RESIDENTE), { ...base, podeCancelarDeOutro: true })).toMatchObject({
      id: ob.id,
      documento: ob.documento,
      deOutroMedico: true,
    });
    // A declaração fica, cancelada com data e motivo; o evento de cancelamento é do usuário de quem cancelou.
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM declaracao_obito d
           JOIN declaracao_obito_evento e ON e.declaracao_obito_id = d.id AND e.tipo_evento = 'cancelamento'
           JOIN usuario u ON u.id = e.usuario_id AND u.login = ?
          WHERE d.id = ? AND d.situacao = 'cancelada' AND d.cancelada_em IS NOT NULL AND d.motivo_cancelamento = ?
            AND d.excluido_em IS NULL AND e.motivo = ? AND e.numero = 'L9800004'`,
        [RESIDENTE, ob.id, motivo, motivo],
      ),
    ).toBe(1);
    // O documento do prontuário sai de vigência com o evento marcado como cancelamento por terceiro.
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM documento_prontuario_evento
          WHERE documento_prontuario_id = ? AND acao = 'cancelamento' AND justificativa = ?
            AND JSON_CONTAINS(dados, 'true', '$.cancelado_por_terceiro') = 1
            AND JSON_VALUE(dados, '$.profissional_emissor') IS NOT NULL`,
        [ob.documento, motivo],
      ),
    ).toBe(1);
    // A trilha (crítica) registra o cancelamento por terceiro, com o motivo.
    expect(await trilhaTerceiro()).toBe(1);
    expect(await cadastro(ids.pacienteC)).toEqual(vivo);
  });

  it('ciência: inclusão pelo sistema, fechamento da comunicação aberta, exame de outro paciente 404; trilha', async () => {
    const trilha = () =>
      contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'ciencia_resultado_critico'",
        [ids.est],
      );
    const antes = await trilha();
    const x = {
      paciente: ids.paciente,
      chave: 'k',
      resultado: null,
      elemento: null,
      conduta: 'Conduta sintética',
      escalonadoPara: null,
    };
    expect(await recusa(porta.registrarCiencia(G(), { ...x, exame: 999_999_999 }))).toEqual({
      codigo: 'nao-encontrado',
      status: 404,
    });
    // O exame do paciente B não recebe ciência em nome do paciente A.
    expect(await recusa(porta.registrarCiencia(G(), { ...x, exame: ids.resultadoOutroPaciente }))).toEqual({
      codigo: 'nao-encontrado',
      status: 404,
    });
    expect(await porta.ciencias(C(), ids.paciente)).toEqual([]);
    const nova = await porta.registrarCiencia(G(), {
      ...x,
      exame: ids.resultadoNovo,
      elemento: 'K',
      escalonadoPara: 'Plantão sintético',
    });
    expect(await recusa(porta.registrarCiencia(G(), { ...x, exame: ids.resultadoNovo }))).toEqual({
      codigo: 'ja-ciente',
      status: 409,
    });
    expect(await porta.registrarCiencia(G(), { ...x, exame: ids.resultadoAberto })).toBe(ids.cienciaAberta);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM ciencia_resultado_critico
          WHERE estabelecimento_id = ? AND paciente_id = ? AND situacao = 'ciente' AND ciente_usuario_id = ?
            AND ciente_profissional_id = ? AND ciente_em >= comunicado_em AND
            ((id = ? AND resultado_exame_id = ? AND canal_comunicacao = 'sistema' AND comunicante_usuario_id = ?
              AND escalonado_para = 'Plantão sintético') OR
             (id = ? AND resultado_exame_id = ? AND canal_comunicacao = 'telefone' AND comunicante_usuario_id = ?))`,
        [
          ids.est,
          ids.paciente,
          ids.usuario,
          ids.prof,
          nova,
          ids.resultadoNovo,
          ids.usuario,
          ids.cienciaAberta,
          ids.resultadoAberto,
          ids.usuarioOutro,
        ],
      ),
    ).toBe(2);
    expect(
      await contar('SELECT COUNT(*) AS n FROM ciencia_resultado_critico WHERE paciente_id = ?', [
        ids.pacienteB,
      ]),
    ).toBe(0);
    expect((await porta.ciencias(C(), ids.paciente)).map((y) => [y.exame, y.usuario, y.elemento])).toEqual([
      [ids.resultadoNovo, LOGIN, 'K'],
      [ids.resultadoAberto, LOGIN, 'K'],
    ]);
    expect((await trilha()) - antes).toBe(2);
  });

  it('isolamento: no outro estabelecimento, parecer, supervisão, problemas e resultado do principal não aparecem', async () => {
    const GX = { ...G(), hospital: `${P}x` };
    const CX = { ...C(), hospital: `${P}x` };
    expect(await recusa(porta.aceitarParecer(GX, ids.parecer1))).toEqual({
      codigo: 'registro-inexistente',
      status: 404,
    });
    expect(await recusa(porta.coassinarNoNovo(GX, { id: ids.supervisao, decisao: 'coassinado' }))).toEqual({
      codigo: 'nao-encontrado',
      status: 404,
    });
    expect(await porta.supervisao(CX, ids.supervisao)).toBeNull();
    expect(await porta.problemas(CX, ids.paciente)).toEqual([]);
    expect(await porta.ciencias(CX, ids.paciente)).toEqual([]);
    expect(
      await recusa(
        porta.registrarCiencia(GX, {
          ...{ paciente: ids.paciente, chave: 'k', resultado: null },
          elemento: null,
          conduta: 'Conduta sintética',
          escalonadoPara: null,
          exame: ids.resultadoNovo,
        }),
      ),
    ).toEqual({ codigo: 'nao-encontrado', status: 404 });
    expect(await porta.coassinaturas(CX, LOGIN)).toEqual([]);
  });
});
