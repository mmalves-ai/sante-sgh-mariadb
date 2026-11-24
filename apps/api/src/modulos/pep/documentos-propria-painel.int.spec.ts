// Integração da família "painel" da porta própria dos documentos contra o MariaDB real (cliente de teste f22_o2).
// Massa SINTÉTICA do lote l96pai: cadastros reaproveitáveis garantidos no beforeAll (dois estabelecimentos; no
// primeiro, um paciente de ambulatório e um internado com CID, cirurgia e exame liberado; no segundo, um paciente que
// nunca pode aparecer no primeiro); receitas, atestados, pareceres, tempos, alergias, registros, cirurgias, exames e
// preferências do lote apagados no início e no fim (só a massa de teste; a porta nunca apaga). A trilha do executor não
// é apagada (cadeia do SBIS-16). Nenhum dado de pessoa real. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as F from './documentos-propria-painel.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_DOCS_PAINEL']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l96pai';
const PB = `${P}b`;
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
  espAtend: number;
  espInt: number;
  pacienteInt: number;
  atendInt: number;
  resultado: number;
  pacienteB: number;
  atendB: number;
  atestadoOutroPac: number;
  atestadoOutroEst: number;
  ficha: number;
  unidadeAssist: number;
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
      const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
      const ests = [P, PB];
      await e.executar(`DELETE FROM ciencia_resultado_critico WHERE estabelecimento_id IN ${est}`, ests);
      const req = `(SELECT r.id FROM requisicao_exame r WHERE r.estabelecimento_id IN ${est})`;
      await e.executar(
        `DELETE re FROM resultado_exame re JOIN exame_item it ON it.id = re.exame_item_id
          WHERE it.requisicao_exame_id IN ${req}`,
        ests,
      );
      await e.executar(`DELETE FROM exame_item WHERE requisicao_exame_id IN ${req}`, ests);
      await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN ${est}`, ests);
      await e.executar(
        `DELETE ap FROM ato_cirurgico_procedimento ap JOIN ato_cirurgico ac ON ac.id = ap.ato_cirurgico_id
          WHERE ac.estabelecimento_id IN ${est}`,
        ests,
      );
      await e.executar(`DELETE FROM ato_cirurgico WHERE estabelecimento_id IN ${est}`, ests);
      await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN ${est}`, ests);
      await e.executar(
        `DELETE v FROM documento_emitido_versao v JOIN documento_emitido d ON d.id = v.documento_emitido_id
          WHERE d.estabelecimento_id IN ${est}`,
        ests,
      );
      for (const t of [
        'documento_emitido',
        'receita_medica',
        'interconsulta',
        'registro_tempo_evento',
        'alergia_paciente',
      ])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, ests);
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

      // ── Recorte da equipe, episódio, completude, fichas e isolamento ──
      const esp = (codigo: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM especialidade_medica WHERE codigo = ?',
          [codigo],
          'INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [codigo, nome, agora],
        );
      ids.espAtend = await esp(`${P}ESPA`, 'Especialidade sintética do ambulatório');
      ids.espInt = await esp(`${P}ESPI`, 'Especialidade sintética da internação');
      // O atendimento de ambulatório (sem internação) é da especialidade A: entra no recorte da equipe A.
      await e.executar('UPDATE atendimento SET especialidade_medica_id = ? WHERE id = ?', [
        ids.espAtend,
        ids.atendimento,
      ]);
      const pessoaInt = await pessoa(`PESSOA SINTETICA ${P} INTERNADA`);
      ids.pacienteInt = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaInt],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaInt, 902_496_002, agora],
      );
      const categoriaInt = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}int`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [`${P}int`, 'Categoria sintética de internação', agora],
      );
      const entradaInt = new Date('2026-11-19T10:00:00Z');
      ids.atendInt = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, 'L96-2'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, especialidade_medica_id, entrada_em,
           criado_em, situacao)
         VALUES (?, 'L96-2', ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [ids.est, ids.pacienteInt, categoriaInt, carater, fonte, ids.prof, ids.espAtend, entradaInt, agora],
      );
      const unidadeInt = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}UI`],
        `INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em)
         VALUES (?, ?, 'Unidade sintética de internação', 'internacao', ?)`,
        [ids.est, `${P}UI`, agora],
      );
      const catAcomodacao = await garantir(
        e,
        'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
        [`${P}ENF`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, 'Enfermaria sintética', 'enfermaria', ?)",
        [`${P}ENF`, agora],
      );
      const unidadeIntEsp = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}UI`],
        `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em)
         VALUES (?, ?, ?, 'Enfermaria sintética', 'enfermaria', ?)`,
        [ids.est, unidadeInt, `${P}UI`, agora],
      );
      ids.unidadeAssist = unidadeInt;
      const acomodacao = await garantir(
        e,
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}Q1`],
        `INSERT INTO acomodacao (estabelecimento_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome, criado_em)
         VALUES (?, ?, ?, ?, 'Quarto sintético', ?)`,
        [ids.est, unidadeIntEsp, catAcomodacao, `${P}Q1`, agora],
      );
      const caraterAdm = await garantir(
        e,
        'SELECT id FROM carater_admissao WHERE codigo = ?',
        [`${P}URG`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'Urgência sintética', TRUE, ?)",
        [`${P}URG`, agora],
      );
      const modalidade = await garantir(
        e,
        'SELECT id FROM modalidade_internacao WHERE codigo = ?',
        [`${P}CLI`],
        "INSERT INTO modalidade_internacao (codigo, descricao, criado_em) VALUES (?, 'Clínica sintética', ?)",
        [`${P}CLI`, agora],
      );
      const terminologia = await garantir(
        e,
        'SELECT id FROM terminologia WHERE codigo = ?',
        [`${P}CID`],
        "INSERT INTO terminologia (codigo, nome, tipo, criado_em) VALUES (?, 'Diagnósticos sintéticos', 'diagnostico', ?)",
        [`${P}CID`, agora],
      );
      const cid = await garantir(
        e,
        'SELECT id FROM termo_terminologia WHERE terminologia_id = ? AND codigo_termo = ?',
        [terminologia, 'I20'],
        "INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, 'I20', ?, ?)",
        [terminologia, `Angina sintética ${P}`, agora],
      );
      await garantir(
        e,
        'SELECT id FROM internacao WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, `${P}IN1`],
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
           carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id,
           medico_assistente_profissional_id, fonte_pagadora_id, cid_principal_termo_terminologia_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          `${P}IN1`,
          ids.atendInt,
          ids.pacienteInt,
          entradaInt,
          caraterAdm,
          modalidade,
          unidadeIntEsp,
          acomodacao,
          ids.espInt,
          ids.prof,
          fonte,
          cid,
          agora,
        ],
      );
      // Cirurgia: um ato realizado (entra) e um em andamento (não entra).
      const unidadeCc = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}CC`],
        `INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em)
         VALUES (?, ?, 'Centro cirúrgico sintético', 'centro_cirurgico', ?)`,
        [ids.est, `${P}CC`, agora],
      );
      const unidadeCir = await garantir(
        e,
        'SELECT id FROM unidade_cirurgica WHERE estabelecimento_id = ? AND unidade_assistencial_id = ?',
        [ids.est, unidadeCc],
        `INSERT INTO unidade_cirurgica (estabelecimento_id, unidade_assistencial_id, funciona_24_horas, criado_em)
         VALUES (?, ?, TRUE, ?)`,
        [ids.est, unidadeCc, agora],
      );
      const sala = await garantir(
        e,
        'SELECT id FROM sala_cirurgica WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}S1`],
        `INSERT INTO sala_cirurgica (estabelecimento_id, unidade_cirurgica_id, codigo, descricao, criado_em)
         VALUES (?, ?, ?, 'Sala sintética', ?)`,
        [ids.est, unidadeCir, `${P}S1`, agora],
      );
      const caraterCir = await garantir(
        e,
        'SELECT id FROM carater_cirurgia WHERE codigo = ?',
        [`${P}ELE`],
        "INSERT INTO carater_cirurgia (codigo, descricao, criado_em) VALUES (?, 'Eletiva sintética', ?)",
        [`${P}ELE`, agora],
      );
      const proc = (codigo: string, descricao: string) =>
        garantir(
          e,
          'SELECT id FROM procedimento_cirurgico WHERE codigo = ?',
          [codigo],
          'INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [codigo, descricao, agora],
        );
      const procFeito = await proc(`${P}HER`, `Herniorrafia sintética ${P}`);
      const procAberto = await proc(`${P}BIO`, `Biópsia em andamento ${P}`);
      const ato = (numero: string, situacao: string, procedimento: number, tempos: (Date | null)[]) =>
        (async () => {
          const id = await e.inserir(
            `INSERT INTO ato_cirurgico (estabelecimento_id, numero, atendimento_id, paciente_id, sala_cirurgica_id,
               carater_cirurgia_id, entrada_sala_em, inicio_cirurgia_em, fim_cirurgia_em, saida_sala_em, situacao,
               criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ids.est, numero, ids.atendInt, ids.pacienteInt, sala, caraterCir, ...tempos, situacao, agora],
          );
          await e.inserir(
            `INSERT INTO ato_cirurgico_procedimento (ato_cirurgico_id, sequencia, procedimento_cirurgico_id, principal,
               codigo_cid10, criado_em) VALUES (?, 1, ?, TRUE, 'K40', ?)`,
            [id, procedimento, agora],
          );
        })();
      await ato(`${P}-C1`, 'realizado', procFeito, [
        new Date('2026-11-20T14:00:00Z'),
        new Date('2026-11-20T14:20:00Z'),
        new Date('2026-11-20T15:30:00Z'),
        new Date('2026-11-20T15:50:00Z'),
      ]);
      await ato(`${P}-C2`, 'em_andamento', procAberto, [new Date('2026-11-21T14:00:00Z'), null, null, null]);
      // Exames: um resultado liberado (entra) e um em digitação (não entra); a ciência do crítico do liberado.
      const setor = await garantir(
        e,
        'SELECT id FROM setor_diagnostico WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}lab`],
        "INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'laboratorio', ?)",
        [ids.est, `${P}lab`, 'Laboratório sintético', agora],
      );
      const exame = (codigo: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM exame WHERE codigo = ?',
          [codigo],
          "INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES (?, ?, ?, 'laboratorio', ?)",
          [codigo, codigo.slice(-10), nome, agora],
        );
      const exameLib = await exame(`${P}HB`, `HEMOGRAMA SINTETICO ${P}`);
      const exameDig = await exame(`${P}K`, `POTASSIO EM DIGITACAO ${P}`);
      const requisicao = await e.inserir(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
           solicitante_profissional_id, fonte_pagadora_id, prioridade, solicitado_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'rotina', ?, ?)`,
        [ids.est, `${P}-R1`, ids.pacienteInt, ids.atendInt, setor, ids.prof, fonte, entradaInt, agora],
      );
      const liberadoEm = new Date('2026-11-20T09:00:00Z');
      const itemLib = await e.inserir(
        `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, liberado_em, criado_em)
         VALUES (?, 1, ?, 'liberado', ?, ?)`,
        [requisicao, exameLib, liberadoEm, agora],
      );
      const itemDig = await e.inserir(
        `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, criado_em)
         VALUES (?, 2, ?, 'solicitado', ?)`,
        [requisicao, exameDig, agora],
      );
      ids.resultado = await e.inserir(
        `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, situacao, resultado_em,
           liberado_em, autoliberado, critico, criado_em) VALUES (?, ?, ?, 'liberado', ?, ?, TRUE, TRUE, ?)`,
        [itemLib, ids.pacienteInt, setor, liberadoEm, liberadoEm, agora],
      );
      await e.inserir(
        `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, situacao, resultado_em,
           criado_em) VALUES (?, ?, ?, 'em_digitacao', ?, ?)`,
        [itemDig, ids.pacienteInt, setor, liberadoEm, agora],
      );
      await e.inserir(
        `INSERT INTO ciencia_resultado_critico (estabelecimento_id, resultado_exame_id, paciente_id,
           comunicante_usuario_id, comunicado_em, situacao, ciente_profissional_id, ciente_em, criado_em)
         VALUES (?, ?, ?, ?, ?, 'ciente', ?, ?, ?)`,
        [ids.est, ids.resultado, ids.pacienteInt, ids.usuario, liberadoEm, ids.prof, liberadoEm, agora],
      );
      // "Nega alergias" do internado.
      await e.inserir(
        `INSERT INTO alergia_paciente (estabelecimento_id, paciente_id, tipo_registro, registrado_em, criado_em)
         VALUES (?, ?, 'nega_alergias', ?, ?)`,
        [ids.est, ids.pacienteInt, emitida, agora],
      );
      // Evolução médica (CBO 225) no ambulatório, com modelo: completude e modelos em uso.
      const tipoDoc = await garantir(
        e,
        'SELECT id FROM tipo_documento_clinico WHERE codigo = ?',
        ['L96PAI_EVOL'],
        "INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, 'Evolução sintética', 'evolucao', ?)",
        ['L96PAI_EVOL', agora],
      );
      const modeloDoc = await garantir(
        e,
        'SELECT id FROM modelo_documento_clinico WHERE codigo = ?',
        ['L96PAI_EVO'],
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
         VALUES (?, ?, ?, 'evolucao', ?)`,
        ['L96PAI_EVO', `Evolução sintética ${P}`, tipoDoc, agora],
      );
      const registro = (est: number, paciente: number, atendimento: number) =>
        e.inserir(
          `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
             tipo_documento_clinico_id, autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento,
             impressao_digital, situacao, criado_em, ocupacao_cbo_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalizado', ?, ?)`,
          [
            est,
            paciente,
            atendimento,
            modeloDoc,
            tipoDoc,
            ids.prof,
            ids.usuario,
            new Date('2026-11-20T12:30:00Z'),
            new Date('2026-11-20T12:30:00Z'),
            '0'.repeat(64),
            agora,
            ocupacao,
          ],
        );
      await registro(ids.est, ids.paciente, ids.atendimento);
      // Ficha de impressão ativa com componentes.
      const tipoImpressao = await garantir(
        e,
        'SELECT id FROM tipo_modelo_impressao WHERE codigo = ?',
        [`${P}FI`],
        "INSERT INTO tipo_modelo_impressao (codigo, descricao, criado_em) VALUES (?, 'Ficha sintética', ?)",
        [`${P}FI`, agora],
      );
      ids.ficha = await garantir(
        e,
        'SELECT id FROM modelo_impressao_clinica WHERE codigo = ?',
        [`${P}F1`],
        `INSERT INTO modelo_impressao_clinica (codigo, nome, tipo_modelo_impressao_id, conteudo, criado_em)
         VALUES (?, ?, ?, ?, ?)`,
        [
          `${P}F1`,
          `Ficha sintética ${P}`,
          tipoImpressao,
          JSON.stringify({
            componentes: [
              { nome: 'Cabeçalho sintético' },
              { nome: 'Evolução', modelo: `Evolução sintética ${P}` },
              { nome: '' },
            ],
          }),
          agora,
        ],
      );
      // Atestado de OUTRO paciente no mesmo estabelecimento (suspensão cruzada 404).
      ids.atestadoOutroPac = await e.inserir(
        `INSERT INTO documento_emitido (estabelecimento_id, paciente_id, atendimento_id, tipo, profissional_id, emitido_em,
           lancado_em, texto, dias_afastamento, criado_em) VALUES (?, ?, ?, 'atestado', ?, ?, ?, ?, 1, ?)`,
        [ids.est, ids.pacienteInt, ids.atendInt, ids.prof, emitida, emitida, '<atestado internado/>', agora],
      );
      // Segundo estabelecimento: paciente, atendimento aberto, registro, atestado e parecer que nunca vazam.
      const estB = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [PB],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [PB, `Hospital sintético ${PB}`, `Hospital sintético ${PB} (fictício)`, agora],
      );
      const pessoaB = await pessoa(`PESSOA SINTETICA ${P} OUTRO HOSPITAL`);
      ids.pacienteB = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaB],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaB, 902_496_003, agora],
      );
      ids.atendB = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [estB, 'L96-3'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, especialidade_medica_id, entrada_em,
           criado_em, situacao)
         VALUES (?, 'L96-3', ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [estB, ids.pacienteB, categoriaAt, carater, fonte, ids.prof, ids.espAtend, emitida, agora],
      );
      await registro(estB, ids.pacienteB, ids.atendB);
      ids.atestadoOutroEst = await e.inserir(
        `INSERT INTO documento_emitido (estabelecimento_id, paciente_id, atendimento_id, tipo, profissional_id, emitido_em,
           lancado_em, texto, dias_afastamento, criado_em) VALUES (?, ?, ?, 'atestado', ?, ?, ?, ?, 1, ?)`,
        [estB, ids.pacienteB, ids.atendB, ids.prof, emitida, emitida, '<atestado outro hospital/>', agora],
      );
      await e.inserir(
        `INSERT INTO interconsulta (estabelecimento_id, atendimento_id, paciente_id, solicitante_profissional_id,
           categoria_assistencial, motivo, prioridade, solicitado_em, criado_em, criado_por)
         VALUES (?, ?, ?, ?, 'medico', 'Motivo sintético B', 'rotina', ?, ?, ?)`,
        [estB, ids.atendB, ids.pacienteB, ids.prof, emitida, agora, ids.usuario],
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
    expect(comp.alergiasInformadas.map((x) => x.paciente)).toEqual([ids.paciente]);
    expect(comp.evolucoesMedicas).toEqual([{ atendimento: ids.atendimento, em: '2026-11-20T09:30:00' }]);
    expect(comp.negas).toEqual([]);
    expect(comp.ciencias).toEqual([]);
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
    // Atendimento de ambulatório (sem internação): episódio vazio, como a memória.
    expect(await F.episodio(nucleo, CLIENTE, C(), ids.atendimento)).toEqual({
      motivoInternacao: null,
      procedimentos: [],
      exames: [],
    });
  });

  it('episódio da internação: CID principal, só a cirurgia realizada e só o exame liberado', async () => {
    expect(await F.episodio(nucleo, CLIENTE, C(), ids.atendInt)).toEqual({
      motivoInternacao: `I20 - Angina sintética ${P}`,
      procedimentos: [`Herniorrafia sintética ${P} (K40)`],
      exames: [`HEMOGRAMA SINTETICO ${P}`],
    });
    // O atendimento de outro estabelecimento não é lido no da sessão.
    expect(await F.episodio(nucleo, CLIENTE, C(), ids.atendB)).toEqual({
      motivoInternacao: null,
      procedimentos: [],
      exames: [],
    });
  });

  it('equipe: a especialidade da internação ou, sem internação, a do atendimento', async () => {
    const equipe = async (esp: number[]) =>
      (
        await F.painel(nucleo, CLIENTE, C(), { unidade: null, busca: null, equipe: { especialidades: esp } })
      ).linhas.map((x) => [x.atendimento, x.tipo]);
    // O internado tem atendimento da especialidade A, mas a internação (B) prevalece.
    expect(await equipe([ids.espAtend])).toEqual([[ids.atendimento, 'externo']]);
    expect(await equipe([ids.espInt])).toEqual([[ids.atendInt, 'internacao']]);
    expect(await equipe([])).toEqual([]);
    // Unidade: a assistencial que a unidade de internação especializa (id e nome na linha; filtro pelo mesmo id).
    const porUnidade = await F.painel(nucleo, CLIENTE, C(), { unidade: ids.unidadeAssist, busca: null });
    expect(porUnidade.linhas.map((x) => [x.atendimento, x.idUnidade, x.unidade])).toEqual([
      [ids.atendInt, ids.unidadeAssist, 'Unidade sintética de internação'],
    ]);
  });

  it('completude do internado: "nega alergias" e ciência do crítico; nada do outro estabelecimento', async () => {
    const comp = await F.completudePainel(
      nucleo,
      CLIENTE,
      C(),
      [ids.pacienteInt, ids.pacienteB],
      [ids.atendInt, ids.atendB],
      new Date(),
    );
    expect(comp.negas).toEqual([{ paciente: ids.pacienteInt, em: '2026-11-20T09:00:00' }]);
    expect(comp.alergiasInformadas).toEqual([]);
    expect(comp.ciencias).toEqual([{ paciente: ids.pacienteInt, exame: ids.resultado }]);
    // A evolução e o parecer do outro estabelecimento não entram.
    expect(comp.evolucoesMedicas).toEqual([]);
    expect(comp.pareceres).toEqual([]);
  });

  it('isolamento: o paciente do outro estabelecimento não aparece no painel, na fila nem nos documentos', async () => {
    const r = await F.painel(nucleo, CLIENTE, C(), { unidade: null, busca: null });
    const pacs = r.linhas.map((x) => x.paciente);
    expect(pacs).toEqual(expect.arrayContaining([ids.paciente, ids.pacienteInt]));
    expect(pacs).not.toContain(ids.pacienteB);
    expect((await F.painel(nucleo, CLIENTE, C(), { unidade: null, busca: 'OUTRO HOSPITAL' })).linhas).toEqual(
      [],
    );
    expect(await F.fila(nucleo, CLIENTE, C(), { paciente: ids.pacienteB })).toEqual([]);
    expect(await F.documentos(nucleo, CLIENTE, C(), ids.pacienteB, 'atestado')).toEqual([]);
    expect(await F.lerAtestado(nucleo, CLIENTE, C(), ids.atestadoOutroEst)).toBeNull();
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
    expect((await F.fichas(nucleo, CLIENTE, C())).find((f) => f.codigo === ids.ficha)).toMatchObject({
      nome: `Ficha sintética ${P}`,
      componentes: [
        { nome: 'Cabeçalho sintético', modelo: null },
        { nome: 'Evolução', modelo: `Evolução sintética ${P}` },
      ],
    });
    // Só o registro deste estabelecimento conta (o do outro hospital, com o mesmo modelo, não).
    expect(
      (await F.modelosEmUso(nucleo, CLIENTE, C(), '2026-01-01')).filter(
        (m) => m.nome === `Evolução sintética ${P}`,
      ),
    ).toEqual([{ nome: `Evolução sintética ${P}`, usos: 1 }]);
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
    // A trilha do executor: uma alteração de cada documento suspenso.
    const trilha = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-trilha` }, (l) =>
      l.consultar(
        `SELECT entidade, COUNT(*) AS n FROM trilha_auditoria
          WHERE acao = 'alteracao' AND ((entidade = 'documento_emitido' AND entidade_id = ?)
                OR (entidade = 'receita_medica' AND entidade_id = ?))
          GROUP BY entidade ORDER BY entidade`,
        [ids.atestado, ids.receita],
      ),
    );
    expect(trilha.map((t) => [t['entidade'], Number(t['n'])])).toEqual([
      ['documento_emitido', 1],
      ['receita_medica', 1],
    ]);
    // Documento de outro paciente ou de outro estabelecimento: 404, nada muda.
    await expect(
      F.executar(
        nucleo,
        CLIENTE,
        executor,
        C(),
        'pep.suspenderDocumento',
        { ...entrada, familia: 'atestado', origem: ids.atestadoOutroPac },
        ctx('x1'),
      ),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      F.executar(
        nucleo,
        CLIENTE,
        executor,
        C(),
        'pep.suspenderDocumento',
        { ...entrada, paciente: ids.pacienteB, familia: 'atestado', origem: ids.atestadoOutroEst },
        ctx('x2'),
      ),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    const intactos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-intactos` }, (l) =>
      l.uma(
        `SELECT COUNT(*) AS n FROM documento_emitido WHERE id IN (?, ?) AND suspenso_em IS NULL AND excluido_em IS NULL`,
        [ids.atestadoOutroPac, ids.atestadoOutroEst],
      ),
    );
    expect(Number(intactos?.['n'])).toBe(2);
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
