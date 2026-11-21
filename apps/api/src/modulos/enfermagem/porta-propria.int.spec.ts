// Portas próprias da enfermagem do lote 02-04 contra o MariaDB real (cliente de teste da onda 2, f22_o2): beira-leito
// (internados, horários, checagem, estorno e aprazamento pelo Executor, sinais vitais e passagem de plantão), balanço
// hídrico, agência (bolsas e imuno-hematologia) e escores (NEWS2, contenção e TRR). Contrato de efeito: as linhas, a
// versão, a trilha e o outbox de cada gravação, e as recusas (situação mudada, outro estabelecimento, versão vencida,
// liberação pelo mesmo profissional). Massa SINTÉTICA com o prefixo L0204; a de movimento sai no fim (ficam o
// estabelecimento, as contas e os cadastros que a trilha só-inclusão referencia). SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { programacaoPorMudancaDeQuadro } from '@sgh/dominio-enfermagem';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAgenciaPropria, provaCruzadaDoResultado } from './agencia-porta-propria.js';
import { PortaBalancoPropria } from './balanco-porta-propria.js';
import { PortaEscoresPropria } from './escores-porta-propria.js';
import { comAto } from './gravacao-direta.js';
import { CLIENTE, garantir, garantirCliente, SEM_BANCO } from './massa-enfermagem.spec-util.js';
import { PortaEnfermagemPropria } from './porta-propria.js';

const P = 'L0204';
const UNIDADE = `${P}-UTI`;

interface Massa {
  est: number;
  outroEst: number;
  usuario: number;
  usuario2: number;
  login: string;
  login2: string;
  profissional: number;
  profissional2: number;
  ocupacao: number;
  paciente: number;
  atendimento: number;
  prescricao: number;
  item: number;
  horarios: [number, number];
  local: number;
}

const ctx = (m: Massa, est = m.est, usuario = m.usuario): ContextoNucleo => ({
  cliente: CLIENTE,
  estabelecimento: est,
  usuario,
  correlacao: `t-${P}-${randomUUID().slice(0, 8)}`,
});
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-${P}-${randomUUID()}` });
/** "AAAA-MM-DDTHH:mm" daqui a `min` minutos no fuso de São Paulo (o do estabelecimento sintético). */
const civil = (min: number) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(Date.now() + min * 60_000))
    .replace(' ', 'T');

async function montar(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-preparo` }, async (e: Escritor) => {
    const agora = new Date();
    const g = (tabela: string, chave: string, valor: unknown, extra: Record<string, unknown> = {}) => {
      const cols = [chave, ...Object.keys(extra), 'criado_em'];
      return garantir(
        e,
        `SELECT id FROM ${tabela} WHERE ${chave} = ?`,
        [valor],
        `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        [valor, ...Object.values(extra), agora],
      );
    };
    const est = await g('estabelecimento', 'codigo', P, {
      nome_fantasia: `ESTAB ${P}`,
      razao_social: `ESTAB ${P}`,
    });
    const outroEst = await g('estabelecimento', 'codigo', `${P}B`, {
      nome_fantasia: `ESTAB ${P}B`,
      razao_social: `ESTAB ${P}B`,
    });
    // O turno do plantão é do cadastro (turno_padrao, da rede inteira): garantido, nunca apagado.
    await g('turno_padrao', 'codigo', 'diurno', {
      descricao: 'Diurno',
      hora_inicio: '07:00:00',
      hora_fim: '19:00:00',
    });
    const login = 'l0204.enfermeira';
    const login2 = 'l0204.colega';
    const usuario = await g('usuario', 'login', login, {
      nome: 'USUARIO SINTETICO L0204',
      tipo_conta: 'pessoa',
      dispensa_cpf: true,
    });
    const usuario2 = await g('usuario', 'login', login2, {
      nome: 'COLEGA SINTETICA L0204',
      tipo_conta: 'pessoa',
      dispensa_cpf: true,
    });
    const ocupacao = await g('ocupacao_cbo', 'codigo_cbo', '223505', {
      descricao: 'Enfermeiro',
      area_saude: true,
    });
    const prof = async (nome: string, u: number) => {
      const pf = await g('pessoa_fisica', 'nome', nome);
      const pr = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'assistencial', ?)",
        [pf, agora],
      );
      await garantir(
        e,
        'SELECT id FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?',
        [pr, ocupacao],
        'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, TRUE, ?)',
        [pr, ocupacao, agora],
      );
      for (const x of [est, outroEst])
        await garantir(
          e,
          'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
          [u, x],
          "INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, '2026-01-01', ?)",
          [u, x, pr, agora],
        );
      return pr;
    };
    const profissional = await prof(`ENFERMEIRA ${P}`, usuario);
    const profissional2 = await prof(`COLEGA ${P}`, usuario2);
    const ocupacaoDoProf = Number(
      (
        await e.uma<{ id: number }>(
          'SELECT id FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?',
          [profissional, ocupacao],
        )
      )?.id,
    );
    // Estrutura da internação.
    const ua = await garantir(
      e,
      'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
      [est, `${P}-UA`],
      "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'UTI SINTETICA', 'internacao', ?)",
      [est, `${P}-UA`, agora],
    );
    const setor = await garantir(
      e,
      'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
      [est, `${P}-SET`],
      "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'SETOR UTI SINTETICO', 'assistencial', ?)",
      [est, `${P}-SET`, agora],
    );
    const ui = await garantir(
      e,
      'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
      [est, UNIDADE],
      "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, intensiva, setor_funcional_id, criado_em) VALUES (?, ?, ?, 'UTI SINTETICA', 'uti_adulto', TRUE, ?, ?)",
      [est, ua, UNIDADE, setor, agora],
    );
    const bloco = await garantir(
      e,
      'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
      [est, 'B1'],
      "INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'B1', 'BLOCO SINTETICO', ?)",
      [est, agora],
    );
    const cat = await g('categoria_acomodacao', 'codigo', `${P}-UTI`, {
      descricao: 'UTI L0204',
      tipo: 'terapia_intensiva',
    });
    const acom = await garantir(
      e,
      'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
      [est, 'UTI1'],
      "INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?, 'UTI1', 'BOX 1', ?)",
      [est, bloco, ui, cat, agora],
    );
    const sit = await garantir(
      e,
      "SELECT id FROM situacao_leito WHERE situacao_base = 'ocupado' ORDER BY id LIMIT 1",
      [],
      "INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES ('L0204-OCUP', 'OCUPADO', 'ocupado', ?)",
      [agora],
    );
    const leito = await garantir(
      e,
      'SELECT id FROM leito_hospitalar WHERE unidade_internacao_id = ? AND codigo = ?',
      [ui, '01'],
      "INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id, codigo, situacao_leito_id, criado_em) VALUES (?, ?, ?, ?, '01', ?, ?)",
      [est, ui, acom, bloco, sit, agora],
    );
    // Paciente internado.
    const sexo = await garantir(
      e,
      "SELECT id FROM sexo WHERE sigla = 'F'",
      [],
      "INSERT INTO sexo (sigla, codigo, descricao, criado_em) VALUES ('F', 'feminino', 'Feminino', ?)",
      [agora],
    );
    const pf = await e.inserir(
      'INSERT INTO pessoa_fisica (nome, sexo_id, data_nascimento, criado_em) VALUES (?, ?, ?, ?)',
      [`PACIENTE ${P} SINTETICO`, sexo, '1960-03-01', agora],
    );
    const pront = Number(
      (await e.uma<{ n: number }>('SELECT COALESCE(MAX(numero_prontuario), 980000) + 1 AS n FROM paciente'))
        ?.n,
    );
    const paciente = await e.inserir(
      'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
      [pf, pront, agora],
    );
    const catAt = await g('categoria_atendimento', 'codigo', `${P}-INT`, {
      descricao: 'Internação L0204',
      tipo_base: 'internacao',
    });
    const tiss = await g('carater_atendimento_tiss', 'codigo_tiss', 'L4', {
      descricao: 'CARATER L0204',
      versao_fonte: 'teste',
    });
    const fonte = await g('fonte_pagadora', 'codigo', P, { nome: `CONVENIO ${P}`, tipo: 'particular' });
    const entrada = new Date(Date.now() - 2 * 86_400_000);
    const atendimento = await e.inserir(
      'INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, setor_funcional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [est, `${P}-1`, paciente, catAt, tiss, fonte, profissional, setor, entrada, agora],
    );
    const carater = await g('carater_admissao', 'codigo', `${P}-URG`, {
      descricao: 'URGENCIA L0204',
      urgencia: true,
    });
    const modal = await g('modalidade_internacao', 'codigo', `${P}-CLI`, { descricao: 'CLINICA L0204' });
    const esp = await g('especialidade_medica', 'codigo', `${P}-INT`, { descricao: 'INTENSIVA L0204' });
    const internacao = await e.inserir(
      "INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada, carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id, especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)",
      [
        est,
        `${P}-IN1`,
        atendimento,
        paciente,
        entrada,
        carater,
        modal,
        ui,
        leito,
        acom,
        esp,
        profissional,
        fonte,
        agora,
      ],
    );
    await e.inserir(
      "INSERT INTO ocupacao_leito (estabelecimento_id, internacao_id, leito_hospitalar_id, unidade_internacao_id, acomodacao_id, data_hora_inicio, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'ativa', ?)",
      [est, internacao, leito, ui, acom, entrada, agora],
    );
    await e.inserir(
      "INSERT INTO alergia_paciente (estabelecimento_id, paciente_id, tipo_registro, descricao_livre, registrado_em, criado_em) VALUES (?, ?, 'alergia', 'Alergeno sintético', ?, ?)",
      [est, paciente, agora, agora],
    );
    // Cadastros da checagem e do aprazamento.
    for (const [codigo, categoria] of [
      [`${P}-P`, 'pendente'],
      [`${P}-A`, 'administrado'],
      [`${P}-N`, 'nao_administrado'],
    ] as const)
      await g('situacao_checagem', 'codigo', codigo, { descricao: categoria, categoria });
    await g('situacao_aprazamento', 'codigo', `${P}-APR`, { descricao: 'Aprazado', categoria: 'aprazado' });
    await g('situacao_aprazamento', 'codigo', `${P}-REAP`, {
      descricao: 'Reaprazado',
      categoria: 'reaprazado',
    });
    const pendente = Number(
      (
        await e.uma<{ id: number }>(
          "SELECT id FROM situacao_checagem WHERE categoria = 'pendente' AND ativo ORDER BY ordem IS NULL, ordem, id LIMIT 1",
        )
      )?.id,
    );
    const tipoItem = await g('tipo_item_prescricao', 'codigo', `${P}-SOL`, {
      descricao: 'Solução',
      categoria: 'solucao',
      integra_balanco_hidrico: true,
    });
    const prescricao = await e.inserir(
      "INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em) VALUES (?, 1, ?, ?, ?, 'vigente', ?, ?, ?, ?)",
      [
        est,
        paciente,
        atendimento,
        profissional,
        agora,
        new Date(Date.now() - 3_600_000),
        new Date(Date.now() + 23 * 3_600_000),
        agora,
      ],
    );
    const item = await e.inserir(
      "INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, descricao, quantidade, inicio_em, lancamento_profissional_id, criado_em) VALUES (?, 1, ?, 'SORO SINTETICO 500 ML', 500, ?, ?, ?)",
      [prescricao, tipoItem, agora, profissional, agora],
    );
    const horario = (min: number) =>
      e.inserir(
        'INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id, previsto_em, situacao_checagem_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [est, atendimento, prescricao, item, new Date(Date.now() + min * 60_000), pendente, agora],
      );
    const horarios: [number, number] = [await horario(-30), await horario(90)];
    // Sinais, escalas, balanço e agência (cadastros da rede).
    for (const [codigo, unidade] of [
      ['spo2', '%'],
      ['fr', 'irpm'],
      ['diurese', 'mL'],
      ['temperatura', '°C'],
      ['peso', 'kg'],
      ['glicemia', 'mg/dL'],
    ])
      await g('parametro_vital', 'codigo', codigo, { descricao: `${codigo} sintético`, unidade });
    const news = await g('escala_clinica', 'codigo', 'news2', { descricao: 'NEWS2' });
    await g('escala_clinica', 'codigo', 'braden', { descricao: 'BRADEN' });
    await g('escala_clinica', 'codigo', 'morse', { descricao: 'MORSE' });
    for (const [i, v] of ['fr', 'spo2'].entries())
      await garantir(
        e,
        'SELECT id FROM escala_clinica_variavel WHERE escala_clinica_id = ? AND identificador = ?',
        [news, v],
        "INSERT INTO escala_clinica_variavel (escala_clinica_id, sequencia, identificador, descricao, tipo_resposta, criado_em) VALUES (?, ?, ?, ?, 'numero', ?)",
        [news, i + 1, v, v, agora],
      );
    await g('grupo_balanco_hidrico', 'codigo', `${P}-GANHO`, { descricao: 'Endovenoso', tipo: 'ganho' });
    await g('grupo_balanco_hidrico', 'codigo', `${P}-PERDA`, { descricao: 'Diurese', tipo: 'perda' });
    await g('hemocomponente', 'sigla', 'CH', {
      codigo: 'ch',
      descricao: 'Concentrado de hemácias',
      validade_dias: 42,
    });
    await g('grupo_sanguineo', 'sigla', 'O', { codigo: 'o', descricao: 'Grupo O' });
    await g('fator_rh', 'sinal', '+', { codigo: 'positivo', descricao: 'Rh positivo' });
    for (const [codigo, natureza] of [
      ['entrada', 'entrada'],
      ['liberacao', 'liberacao'],
      ['reserva', 'reserva'],
      ['bloqueio', 'bloqueio'],
      ['descarte', 'descarte'],
    ])
      await garantir(
        e,
        'SELECT id FROM tipo_movimento_bolsa WHERE natureza = ? ORDER BY id LIMIT 1',
        [natureza],
        'INSERT INTO tipo_movimento_bolsa (codigo, descricao, natureza, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}-${codigo}`, natureza, natureza, agora],
      );
    await g('tipo_teste_imuno_hematologico', 'codigo', 'abo_rh', { descricao: 'Tipagem ABO e Rh' });
    const empresa = await garantir(
      e,
      'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
      ['99020400000100'],
      "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', '99020400000100', 'HEMOCENTRO L0204 SINTETICO', ?)",
      [agora],
    );
    await garantir(
      e,
      'SELECT id FROM servico_hemoterapia_fornecedor WHERE estabelecimento_id = ? AND codigo = ?',
      [est, P],
      "INSERT INTO servico_hemoterapia_fornecedor (estabelecimento_id, empresa_fornecedora_id, codigo, nome, criado_em) VALUES (?, ?, ?, 'HEMOCENTRO L0204', ?)",
      [est, empresa, P, agora],
    );
    const local = await g('local_guarda_hemocomponente', 'codigo', `${P}-GEL`, {
      estabelecimento_id: est,
      descricao: 'Geladeira sintética',
      tipo_equipamento: 'refrigerador',
      temperatura_minima: 2,
      temperatura_maxima: 6,
    });
    return {
      est,
      outroEst,
      usuario,
      usuario2,
      login,
      login2,
      profissional,
      profissional2,
      ocupacao: ocupacaoDoProf,
      paciente,
      atendimento,
      prescricao,
      item,
      horarios,
      local,
    };
  });
}

async function limpar(nucleo: NucleoProprio, m: Massa | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, async (e) => {
    const est = [m.est, m.outroEst];
    const em = 'estabelecimento_id IN (?, ?)';
    const x = (sql: string, p: unknown[] = est) => e.executar(sql, p);
    await x(
      `DELETE ev FROM horario_administracao_evento ev JOIN horario_administracao h ON h.id = ev.horario_administracao_id WHERE h.${em}`,
    );
    await x(
      `DELETE d FROM administracao_dupla_checagem d JOIN horario_administracao h ON h.id = d.horario_administracao_id WHERE h.${em}`,
    );
    await x(`DELETE FROM conflito_sincronizacao_checagem WHERE ${em}`);
    await x(`DELETE FROM aparelho_beira_leito WHERE ${em}`);
    await x(`DELETE FROM horario_administracao WHERE ${em}`);
    await x(`DELETE pi FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.${em}`);
    await x(`DELETE FROM prescricao WHERE ${em}`);
    await x(
      `DELETE f FROM balanco_fechamento f JOIN balanco_hidrico_paciente b ON b.id = f.balanco_hidrico_paciente_id WHERE b.${em}`,
    );
    await x(
      `DELETE l FROM balanco_lancamento l JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id WHERE b.${em} AND l.fonte_lancamento = 'estorno'`,
    );
    await x(
      `DELETE l FROM balanco_lancamento l JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id WHERE b.${em}`,
    );
    await x(`DELETE FROM balanco_hidrico_paciente WHERE ${em}`);
    await x(`UPDATE parada_cardiorrespiratoria_ficha SET anterior_ficha_id = NULL WHERE ${em}`);
    await x(`DELETE FROM parada_cardiorrespiratoria_ficha WHERE ${em}`);
    await x(
      `UPDATE acionamento_resposta_rapida_evento ev JOIN acionamento_resposta_rapida t ON t.id = ev.acionamento_resposta_rapida_id
          SET ev.anterior_evento_id = NULL WHERE t.${em}`,
    );
    await x(
      `DELETE ev FROM acionamento_resposta_rapida_evento ev JOIN acionamento_resposta_rapida t ON t.id = ev.acionamento_resposta_rapida_id WHERE t.${em}`,
    );
    await x(`DELETE FROM acionamento_resposta_rapida WHERE ${em}`);
    await x(
      `DELETE d FROM profilaxia_tev_decisao d JOIN profilaxia_tev_avaliacao a ON a.id = d.profilaxia_tev_avaliacao_id WHERE a.${em}`,
    );
    await x(`DELETE FROM profilaxia_tev_avaliacao WHERE ${em}`);
    await x(
      `UPDATE lesao_pele_avaliacao a JOIN lesao_pele_paciente l ON l.id = a.lesao_pele_paciente_id
          SET a.corrigida_lesao_pele_avaliacao_id = NULL WHERE l.${em}`,
    );
    await x(
      `DELETE a FROM lesao_pele_avaliacao a JOIN lesao_pele_paciente l ON l.id = a.lesao_pele_paciente_id WHERE l.${em}`,
    );
    await x(`DELETE FROM lesao_pele_paciente WHERE ${em}`);
    await x(
      `DELETE ev FROM inclusao_protocolo_evento ev JOIN inclusao_protocolo_paciente ip ON ip.id = ev.inclusao_protocolo_paciente_id WHERE ip.${em}`,
    );
    await x(`DELETE FROM inclusao_protocolo_paciente WHERE ${em}`);
    await x(`DELETE FROM protocolo_gerenciado WHERE ${em}`);
    await x(`DELETE FROM reavaliacao_escala WHERE ${em}`);
    await x(`DELETE FROM classificacao_paciente WHERE ${em}`);
    await x(`DELETE FROM indice_gravidade_uti WHERE ${em}`);
    await x(
      `DELETE i FROM aplicacao_escala_item i JOIN aplicacao_escala a ON a.id = i.aplicacao_escala_id WHERE a.${em}`,
    );
    await x(`DELETE FROM aplicacao_escala WHERE ${em}`);
    await x(`DELETE v FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id WHERE a.${em}`);
    await x(`DELETE FROM afericao WHERE ${em}`);
    await x(
      `DELETE d FROM contencao_paciente_avaliacao_adendo d JOIN contencao_paciente_avaliacao a ON a.id = d.contencao_paciente_avaliacao_id
         JOIN contencao_paciente c ON c.id = a.contencao_paciente_id WHERE c.${em}`,
    );
    await x(
      `DELETE a FROM contencao_paciente_avaliacao a JOIN contencao_paciente c ON c.id = a.contencao_paciente_id WHERE c.${em}`,
    );
    await x(`UPDATE contencao_paciente SET anterior_contencao_paciente_id = NULL WHERE ${em}`);
    await x(`DELETE FROM contencao_paciente WHERE ${em}`);
    await x(
      `DELETE pp FROM passagem_turno_paciente pp JOIN passagem_turno pt ON pt.id = pp.passagem_turno_id WHERE pt.${em}`,
    );
    await x(`DELETE FROM passagem_turno WHERE ${em}`);
    await x('DELETE FROM teste_imuno_hematologico WHERE paciente_id = ?', [m.paciente]);
    await x(
      `DELETE mv FROM movimento_bolsa mv JOIN bolsa_hemocomponente b ON b.id = mv.bolsa_hemocomponente_id WHERE b.${em}`,
    );
    await x(`DELETE FROM bolsa_hemocomponente WHERE ${em}`);
    await x(`DELETE FROM ocupacao_leito WHERE ${em}`);
    await x(`DELETE FROM internacao WHERE ${em}`);
    await x(
      `DELETE x FROM registro_assistencial_extensao x JOIN registro_assistencial ra ON ra.id = x.registro_assistencial_id WHERE ra.${em}`,
    );
    await x(`DELETE FROM registro_assistencial WHERE ${em}`);
    await x(`DELETE FROM atendimento WHERE ${em}`);
    await x(`DELETE FROM alergia_paciente WHERE ${em}`);
    const pf = await e.uma<{ pessoa_fisica_id: number }>(
      'SELECT pessoa_fisica_id FROM paciente WHERE id = ?',
      [m.paciente],
    );
    await x('DELETE FROM paciente WHERE id = ?', [m.paciente]);
    if (pf) await x('DELETE FROM pessoa_fisica WHERE id = ?', [pf.pessoa_fisica_id]);
  });
}

describe.skipIf(SEM_BANCO)('portas próprias da enfermagem do lote 02-04 (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let m: Massa | null = null;
  let enf: PortaEnfermagemPropria;
  let bal: PortaBalancoPropria;
  let ag: PortaAgenciaPropria;
  let esc: PortaEscoresPropria;
  const uma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-confere` }, (l) => l.uma(sql, p));
  const trilhaDe = async (correlacao: string) =>
    Number(
      (await uma('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [correlacao]))?.['n'],
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await limpar(
      nucleo,
      await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-sobra` }, async (l) => {
        // Sobra de uma execução interrompida: a massa de movimento do estabelecimento sai antes de montar de novo.
        const e = await l.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [P]);
        const o = await l.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [`${P}B`]);
        const pac = await l.uma<{ id: number }>(
          "SELECT p.id FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE f.nome = 'PACIENTE L0204 SINTETICO' LIMIT 1",
        );
        return e && o && pac
          ? ({ est: Number(e.id), outroEst: Number(o.id), paciente: Number(pac.id) } as Massa)
          : null;
      }),
    );
    m = await montar(nucleo);
    enf = new PortaEnfermagemPropria(nucleo);
    bal = new PortaBalancoPropria(nucleo, enf);
    ag = new PortaAgenciaPropria(nucleo);
    esc = new PortaEscoresPropria(nucleo);
  });

  afterAll(async () => {
    await limpar(nucleo, m);
    await nucleo?.encerrar();
  });

  describe('beira-leito', () => {
    it('lê a unidade, o internado com a alergia, os horários pendentes e o vínculo de enfermagem', async () => {
      const c = ctx(m!);
      expect((await enf.unidades(c)).find((u) => u.unidade === UNIDADE)).toMatchObject({ internados: 1 });
      const [i] = await enf.internados(c, UNIDADE);
      expect(i).toMatchObject({
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        leito: '01',
        alergia: true,
      });
      const h = await enf.horarios(c, {
        atendimentos: [m!.atendimento],
        inicio: civil(-120),
        fim: civil(180),
        teto: 10,
      });
      expect(h.itens.map((x) => [x.id, x.situacao, x.tipo])).toEqual([
        [m!.horarios[0], 'P', 'solucao'],
        [m!.horarios[1], 'P', 'solucao'],
      ]);
      expect(await enf.vinculos(c, m!.login)).toEqual([{ cbo: m!.ocupacao, codigo: '223505' }]);
      // Outro estabelecimento: nada do internado nem do horário.
      expect(await enf.internado(ctx(m!, m!.outroEst), m!.atendimento)).toBeNull();
      expect(await enf.horario(ctx(m!, m!.outroEst), m!.horarios[0])).toBeNull();
    });

    it('checa pelo Executor: o horário administrado (versão 2), o evento, a trilha e o outbox; repetir não grava de novo', async () => {
      const c = ctx(m!);
      const entrada = {
        prescricao: m!.prescricao,
        atendimento: m!.atendimento,
        paciente: m!.paciente,
        cbo: m!.ocupacao,
        marcacoes: [
          {
            horario: m!.horarios[0],
            item: m!.item,
            situacaoLida: 'P',
            situacao: 'A',
            quantidade: 500,
            justificativa: null,
            papel: 'principal',
          },
        ],
        sgh: {
          horaReal: civil(-5),
          pulseiraLida: true,
          motivoSemPulseira: null,
          gtin: null,
          lote: null,
          validade: null,
          conferente: m!.login2,
          dispositivo: null,
          origemOffline: false,
          avisos: [],
          motivo: null,
          observacao: null,
        },
        glicemia: null,
      };
      const o = op(c);
      const r = await enf.executar(c, 'enfermagem.checarAdministracao', entrada, o);
      expect(r.repetida).toBe(false);
      const h = await uma(
        'SELECT h.versao, sc.categoria, h.administrado_por_profissional_id AS p, h.quantidade_administrada AS q FROM horario_administracao h JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id WHERE h.id = ?',
        [m!.horarios[0]],
      );
      expect(h).toMatchObject({ versao: 2, categoria: 'administrado', p: m!.profissional });
      expect(Number(h?.['q'])).toBe(500);
      expect(
        await uma(
          "SELECT COUNT(*) AS n FROM horario_administracao_evento WHERE horario_administracao_id = ? AND evento = 'checagem'",
          [m!.horarios[0]],
        ),
      ).toMatchObject({ n: 1 });
      expect(
        await uma(
          'SELECT conferente_usuario_id AS u FROM administracao_dupla_checagem WHERE horario_administracao_id = ?',
          [m!.horarios[0]],
        ),
      ).toMatchObject({ u: m!.usuario2 });
      expect(await trilhaDe(o.correlacao)).toBe(1);
      expect(
        Number(
          (
            await uma(
              "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'enfermagem.checagem.registrada' AND estabelecimento_id = ?",
              [m!.est],
            )
          )?.['n'],
        ),
      ).toBeGreaterThanOrEqual(1);
      // A mesma chave: o resultado original, sem gravar de novo.
      const de2 = await enf.executar(c, 'enfermagem.checarAdministracao', entrada, o);
      expect(de2.repetida).toBe(true);
      expect(
        await uma('SELECT versao FROM horario_administracao WHERE id = ?', [m!.horarios[0]]),
      ).toMatchObject({ versao: 2 });
      // Outra chave com a situação lida antiga: o horário já foi checado (vira conflito na tela).
      await expect(enf.executar(c, 'enfermagem.checarAdministracao', entrada, op(c))).rejects.toMatchObject({
        problema: { codigo: 'horario-ja-checado' },
      });
      // Outro estabelecimento: o horário não existe lá.
      const c2 = ctx(m!, m!.outroEst);
      await expect(enf.executar(c2, 'enfermagem.checarAdministracao', entrada, op(c2))).rejects.toMatchObject(
        {
          problema: { codigo: 'horario-inexistente' },
        },
      );
      const atos = await enf.atos(c, [m!.horarios[0]]);
      expect(atos).toEqual([
        expect.objectContaining({
          tipo: 'checagem',
          situacao: 'A',
          pulseiraLida: true,
          conferente: m!.login2,
          usuario: m!.login,
        }),
      ]);
      expect((await enf.situacoes(c, [m!.horarios[0]])).get(m!.horarios[0])).toBe('A');
    });

    it('estorna (volta a pendente, evento com o motivo) e apraza o outro horário (previsto novo, histórico)', async () => {
      const c = ctx(m!);
      await enf.executar(
        c,
        'enfermagem.estornarChecagem',
        {
          horario: m!.horarios[0],
          paciente: m!.paciente,
          cbo: m!.ocupacao,
          motivo: 'checado-por-engano',
          justificativa: 'Checado no paciente errado (teste sintético).',
        },
        op(c),
      );
      expect((await enf.horario(c, m!.horarios[0]))?.situacao).toBe('P');
      expect(
        await uma(
          "SELECT motivo FROM horario_administracao_evento WHERE horario_administracao_id = ? AND evento = 'estorno'",
          [m!.horarios[0]],
        ),
      ).toMatchObject({
        motivo: expect.stringContaining('Estorno: checado por engano'),
      });
      const novo = civil(120);
      await enf.executar(
        c,
        'enfermagem.aprazarHorario',
        {
          horario: m!.horarios[1],
          item: m!.item,
          prescricao: m!.prescricao,
          paciente: m!.paciente,
          cbo: m!.ocupacao,
          acao: 'reaprazar',
          confirmado: novo,
          motivo: 'Paciente em exame (sintético)',
        },
        op(c),
      );
      expect((await enf.horario(c, m!.horarios[1]))?.previsto.slice(0, 16)).toBe(novo);
      expect((await enf.aprazamentos(c, [m!.horarios[1]])).get(m!.horarios[1])).toMatchObject({
        acao: 'reaprazar',
        confirmado: `${novo}:00`,
      });
      const hist = await enf.historico(c, m!.horarios[1]);
      expect(hist.eventos.map((e) => e.origem)).toEqual(['extrato']);
      // A entrada inválida não grava (Zod da operação).
      await expect(
        enf.executar(c, 'enfermagem.aprazarHorario', { horario: m!.horarios[1] }, op(c)),
      ).rejects.toMatchObject({
        problema: { status: 400 },
      });
    });

    it('sinal vital (aferição) e a retificação auditada; passagem de plantão aceita pela colega', async () => {
      const c = ctx(m!);
      const id = await enf.gravarSgh(
        c,
        {
          estabelecimento: m!.est,
          usuario: m!.usuario,
          acao: 'inclusao',
          entidade: 'afericao_valor',
          entidadeId: null,
          correlacao: c.correlacao,
        },
        (g) =>
          g.gravarSinal({
            paciente: m!.paciente,
            atendimento: m!.atendimento,
            horario: null,
            tipo: 'spo2',
            valor: 88,
            unidade: '%',
            metodo: null,
            foraDaFaixa: true,
            horaReal: civil(-10),
            origemOffline: false,
            observacao: null,
            usuario: m!.login,
          }),
      );
      const s = await enf.sinais(c, { paciente: m!.paciente, de: civil(-60), ate: civil(1) });
      expect(s.itens).toEqual([
        expect.objectContaining({
          id,
          tipo: 'spo2',
          valor: 88,
          foraDaFaixa: true,
          versao: 1,
          anterior: null,
        }),
      ]);
      // O ato repetido (a mesma chave do aparelho, o mesmo conteúdo) devolve o sinal da primeira vez, sem gravar.
      const sinalNovo = {
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        horario: null,
        tipo: 'fr',
        valor: 20,
        unidade: 'irpm',
        metodo: null,
        foraDaFaixa: false,
        horaReal: civil(-9),
        origemOffline: true,
        observacao: null,
        usuario: m!.login,
      };
      const trilhaSinal = (r: number) => ({
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'afericao_valor',
        entidadeId: r,
        correlacao: c.correlacao,
      });
      const ca = comAto(c, `t-${P}-${randomUUID()}`, sinalNovo);
      const s1 = await enf.gravarSgh(ca, trilhaSinal, (g) => g.gravarSinal(sinalNovo));
      expect(ca.ato.repetida).toBe(false);
      const s2 = await enf.gravarSgh(ca, trilhaSinal, (g) => g.gravarSinal(sinalNovo));
      expect([s2, ca.ato.repetida]).toEqual([s1, true]);
      expect(
        await uma(
          'SELECT COUNT(*) AS n FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id WHERE a.paciente_id = ?',
          [m!.paciente],
        ),
      ).toMatchObject({ n: 2 });
      // A mesma chave com outro conteúdo é recusada.
      await expect(
        enf.gravarSgh(comAto(c, ca.ato.chave, { ...sinalNovo, valor: 21 }), trilhaSinal, (g) =>
          g.gravarSinal({ ...sinalNovo, valor: 21 }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'idempotencia-divergente' } });
      // O atendimento de outro estabelecimento (ou de outro paciente) não recebe o sinal.
      await expect(
        enf.gravarSgh(ctx(m!, m!.outroEst), trilhaSinal, (g) => g.gravarSinal(sinalNovo)),
      ).rejects.toMatchObject({ problema: { codigo: 'atendimento-inexistente' } });
      await expect(
        enf.gravarSgh(c, trilhaSinal, (g) =>
          g.gravarSinal({ ...sinalNovo, paciente: m!.paciente + 999_999 }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'atendimento-de-outro-paciente' } });
      // A retificação: linha nova; a anterior fica guardada com o valor original; a justificativa na trilha.
      const trilhaRetificacao = (r: number) => ({ ...trilhaSinal(r), acao: 'alteracao' as const });
      const retificar = (alvo: number, versao: number) =>
        enf.gravarSgh(c, trilhaRetificacao, (g) =>
          g.retificarSinal({
            id: alvo,
            versao,
            valor: 95,
            foraDaFaixa: false,
            justificativa: 'Oxímetro mal posicionado',
            usuario: m!.login,
          }),
        );
      await expect(retificar(id, 2)).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
      const novo = await retificar(id, 1);
      expect(novo).not.toBe(id);
      expect(await enf.sinalPorId(c, id)).toMatchObject({ versao: 1, substituido: true });
      expect(await enf.sinalPorId(c, novo)).toMatchObject({ versao: 2, tipo: 'spo2', substituido: false });
      const vigentes = await enf.sinais(c, { paciente: m!.paciente, de: civil(-60), ate: civil(1) });
      expect(vigentes.itens.find((x) => x.tipo === 'spo2')).toMatchObject({
        id: novo,
        valor: 95,
        versao: 2,
        anterior: id,
        justificativa: 'Oxímetro mal posicionado',
      });
      expect(
        await uma(
          'SELECT valor_numerico, nivel_alerta, excluido_em IS NOT NULL AS substituido FROM afericao_valor WHERE id = ?',
          [id],
        ),
      ).toMatchObject({ valor_numerico: '88.0000', nivel_alerta: 'atencao', substituido: 1 });
      expect(
        await uma(
          "SELECT motivo FROM trilha_auditoria WHERE entidade = 'afericao_valor' AND entidade_id = ?",
          [novo],
        ),
      ).toMatchObject({ motivo: 'Oxímetro mal posicionado' });
      await expect(retificar(id, 1)).rejects.toMatchObject({ problema: { codigo: 'sinal-ja-retificado' } });
      // O sinal, o ato da chave (o reenvio não grava) e a retificação: três linhas na trilha.
      expect(await trilhaDe(c.correlacao)).toBe(3);
      // Passagem de plantão: a colega aceita; quem passou não responde a própria.
      const pid = await enf.gravarSgh(
        c,
        {
          estabelecimento: m!.est,
          usuario: m!.usuario,
          acao: 'inclusao',
          entidade: 'passagem_turno',
          entidadeId: null,
          correlacao: c.correlacao,
        },
        (g) =>
          g.passarPlantao({
            unidade: UNIDADE,
            turno: 'diurno',
            data: civil(0).slice(0, 10),
            passadoPor: m!.login,
            recebedor: m!.login2,
            notas: [
              {
                atendimento: m!.atendimento,
                paciente: m!.paciente,
                situacao: 'Estável',
                historia: null,
                avaliacao: null,
                recomendacao: 'Reavaliar SpO2',
                pendencias: [],
              },
            ],
          }),
      );
      await expect(
        enf.gravarSgh(
          c,
          {
            estabelecimento: m!.est,
            usuario: m!.usuario,
            acao: 'alteracao',
            entidade: 'passagem_turno',
            entidadeId: pid,
            correlacao: c.correlacao,
          },
          (g) => g.responderPlantao({ id: pid, aceite: true, observacao: null, usuario: m!.login }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'nao-recebedor' } });
      const c2 = ctx(m!, m!.est, m!.usuario2);
      await enf.gravarSgh(
        c2,
        {
          estabelecimento: m!.est,
          usuario: m!.usuario2,
          acao: 'alteracao',
          entidade: 'passagem_turno',
          entidadeId: pid,
          correlacao: c2.correlacao,
        },
        (g) => g.responderPlantao({ id: pid, aceite: true, observacao: null, usuario: m!.login2 }),
      );
      const [pp] = await enf.passagens(c, { id: pid });
      expect(pp).toMatchObject({
        situacao: 'aceita',
        unidade: UNIDADE,
        passadoPor: m!.login,
        recebedor: m!.login2,
      });
      expect(pp!.notas[0]).toMatchObject({ situacao: 'Estável', recomendacao: 'Reavaliar SpO2' });
      expect(pp).toMatchObject({ turno: 'diurno' });
      expect(
        await uma(
          'SELECT tp.codigo, pt.observacao_geral FROM passagem_turno pt JOIN turno_padrao tp ON tp.id = pt.turno_padrao_id WHERE pt.id = ?',
          [pid],
        ),
      ).toMatchObject({ codigo: 'diurno', observacao_geral: null });
      // A nota de plantão com o atendimento de outro paciente é recusada (nada gravado).
      await expect(
        enf.gravarSgh(
          c,
          {
            estabelecimento: m!.est,
            usuario: m!.usuario,
            acao: 'inclusao',
            entidade: 'passagem_turno',
            entidadeId: null,
            correlacao: c.correlacao,
          },
          (g) =>
            g.passarPlantao({
              unidade: UNIDADE,
              turno: 'diurno',
              data: civil(0).slice(0, 10),
              passadoPor: m!.login,
              recebedor: m!.login2,
              notas: [
                {
                  atendimento: m!.atendimento,
                  paciente: m!.paciente + 999_999,
                  situacao: null,
                  historia: null,
                  avaliacao: null,
                  recomendacao: null,
                  pendencias: [],
                },
              ],
            }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'atendimento-de-outro-paciente' } });
      expect(await uma('SELECT versao FROM passagem_turno WHERE id = ?', [pid])).toMatchObject({ versao: 2 });
    });

    it('autoriza o aparelho da beira do leito (só o resumo do identificador) e registra e resolve o conflito', async () => {
      const c = ctx(m!);
      const trilha = (entidade: string) => ({
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade,
        entidadeId: null,
        correlacao: c.correlacao,
      });
      const ident = `TABLET-SINTETICO-${Date.now()}`;
      const gravar = () =>
        enf.gravarSgh(c, trilha('aparelho_beira_leito'), (g) =>
          g.gravarDispositivo({
            nome: 'Tablet do posto',
            unidade: UNIDADE,
            tipo: 'tablet',
            identificador: ident,
            usuario: m!.login,
          }),
        );
      const id = await gravar();
      await expect(gravar()).rejects.toMatchObject({ problema: { codigo: 'dispositivo-existente' } });
      expect(
        await uma('SELECT identificador_hash FROM aparelho_beira_leito WHERE id = ?', [id]),
      ).not.toMatchObject({ identificador_hash: ident });
      expect(await enf.dispositivoAutorizado(c, ident)).toMatchObject({
        id,
        nome: 'Tablet do posto',
        unidade: UNIDADE,
        ativo: true,
        cadastradoPor: m!.login,
      });
      expect(await enf.dispositivoAutorizado(ctx(m!, m!.outroEst), ident)).toBeNull();
      expect(
        await enf.gravarSgh(c, trilha('aparelho_beira_leito'), (g) =>
          g.marcarSincronismo({ identificador: ident }),
        ),
      ).toBe(true);
      expect((await enf.dispositivos(c)).find((d) => d.id === id)?.ultimoSincronismo).not.toBeNull();
      // O conflito do ato feito sem conexão: uma vez por chave; resolvido uma vez.
      const chave = `conflito-${Date.now()}`;
      const conflito = () =>
        enf.gravarSgh(c, trilha('conflito_sincronizacao_checagem'), (g) =>
          g.registrarConflito({
            horario: m!.horarios[1],
            paciente: m!.paciente,
            chave,
            tipo: 'jaChecado',
            situacaoEncontrada: 'A',
            desfechoTentado: 'A',
            horaReal: civil(-5),
            dispositivo: ident,
            aparelhoExigido: true,
            usuario: m!.login,
          }),
        );
      const k = await conflito();
      expect(k.novo).toBe(true);
      expect(await conflito()).toEqual({ id: k.id, novo: false });
      expect((await enf.conflitos(c, { abertos: true })).find((x) => x.id === k.id)).toMatchObject({
        tipo: 'jaChecado',
        situacaoEncontrada: 'A',
        dispositivo: 'Tablet do posto',
        usuario: m!.login,
        resolucao: null,
      });
      const resolver = () =>
        enf.gravarSgh(c, trilha('conflito_sincronizacao_checagem'), (g) =>
          g.resolverConflito({
            id: k.id,
            resolucao: 'mantido',
            observacao: 'Conferido com a equipe',
            usuario: m!.login,
          }),
        );
      await resolver();
      await expect(resolver()).rejects.toMatchObject({ problema: { codigo: 'conflito-resolvido' } });
      expect((await enf.conflitos(c, { abertos: true })).some((x) => x.id === k.id)).toBe(false);
      // Com leitura vinculada, o aparelho não se exclui: inativa-se com o motivo.
      await expect(
        enf.gravarSgh(c, trilha('aparelho_beira_leito'), (g) =>
          g.excluirDispositivo({ id, motivo: 'Aparelho trocado', usuario: m!.login }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'dispositivo-com-leituras' } });
      await enf.gravarSgh(c, trilha('aparelho_beira_leito'), (g) =>
        g.alterarDispositivo({
          id,
          ativo: false,
          motivo: 'Aparelho recolhido para manutenção',
          usuario: m!.login,
        }),
      );
      expect(await enf.dispositivoAutorizado(c, ident)).toBeNull();
      // O evento da infusão contínua vai ao evento do horário, com a velocidade.
      const infusao = (evento: string) =>
        enf.gravarSgh(c, trilha('horario_administracao_evento'), (g) =>
          g.gravarEventoInfusao({
            horario: m!.horarios[1],
            solucao: null,
            paciente: m!.paciente,
            evento,
            velocidadeMlH: 42,
            volumeMl: null,
            observacao: null,
            horaReal: civil(-3),
            usuario: m!.login,
          }),
        );
      const ev = await infusao('inicio');
      expect(await enf.eventosInfusao(c, [m!.horarios[1]])).toMatchObject([
        { id: ev, evento: 'inicio', velocidadeMlH: 42, usuario: m!.login },
      ]);
      // A pausa, a retomada e a troca de bolsa também vão ao evento do horário; evento desconhecido é recusado.
      await infusao('pausa');
      const retomada = await infusao('retomada');
      const troca = await infusao('trocaBolsa');
      const eventos = await enf.eventosInfusao(c, [m!.horarios[1]]);
      expect(eventos.find((x) => x.id === retomada)).toMatchObject({ evento: 'retomada' });
      expect(eventos.find((x) => x.id === troca)).toMatchObject({ evento: 'trocaBolsa' });
      await expect(infusao('desconhecido')).rejects.toMatchObject({
        problema: { codigo: 'evento-infusao-invalido' },
      });
      // A resposta de extensão do formulário exige um registro assistencial deste paciente e estabelecimento.
      await expect(
        enf.gravarSgh(c, trilha('registro_assistencial_extensao'), (g) =>
          g.gravarRespostaExt({
            registro: 0,
            paciente: m!.paciente,
            componente: 'anexo',
            chave: 'anotacao:teste',
            valor: '{"texto":"sintético"}',
            referencia: null,
            usuario: m!.login,
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'registro-inexistente' } });
    });

    it('a anotação offline grava o registro assistencial do atendimento e a extensão na mesma transação; o reenvio não duplica', async () => {
      const c = ctx(m!);
      // O modelo de documento da anotação de enfermagem (cadastro sintético do cliente de teste), publicado.
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-modelo-anotacao` }, async (e) => {
        const agora = new Date();
        const tipo = await garantir(
          e,
          "SELECT id FROM tipo_documento_clinico WHERE codigo = 'ANOT_ENF_SINT'",
          [],
          "INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES ('ANOT_ENF_SINT', 'ANOTACAO DE ENFERMAGEM SINTETICA', 'evolucao', ?)",
          [agora],
        );
        const modelo = await garantir(
          e,
          "SELECT id FROM modelo_documento_clinico WHERE codigo = 'ANOTACAO_ENFERMAGEM'",
          [],
          `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
             VALUES ('ANOTACAO_ENFERMAGEM', 'Anotação de enfermagem', ?, 'evolucao', ?)`,
          [tipo, agora],
        );
        const versao = await garantir(
          e,
          'SELECT id FROM modelo_documento_versao WHERE modelo_documento_clinico_id = ? AND numero_versao = 1',
          [modelo],
          `INSERT INTO modelo_documento_versao (modelo_documento_clinico_id, numero_versao, situacao, publicada_em,
              publicacao_usuario_id, hash_definicao, operacao, dados, ocorrido_em, criado_em)
             VALUES (?, 1, 'publicada', ?, ?, ?, 'inclusao', '{}', ?, ?)`,
          [modelo, agora, m!.usuario, '0'.repeat(64), agora, agora],
        );
        await e.executar(
          `UPDATE modelo_documento_clinico SET situacao = 'publicado', publicada_modelo_documento_versao_id = ?
            WHERE id = ? AND situacao <> 'publicado'`,
          [versao, modelo],
        );
      });
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'registro_assistencial',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      const chave = `${P}-anotacao-${randomUUID().slice(0, 8)}`;
      const anotar = (cx = c, atendimento = m!.atendimento) =>
        enf.gravarSgh(cx, trilha, (g) =>
          g.registrarAnotacaoOffline({
            paciente: m!.paciente,
            atendimento,
            chave,
            texto: 'Paciente  dormindo, sem queixas',
            horaReal: civil(-15),
            usuario: m!.login,
          }),
        );
      const registro = await anotar();
      expect(
        await uma(
          `SELECT ra.paciente_id, ra.atendimento_id, ra.situacao, ra.texto_consolidado, ra.autor_usuario_id,
                  m.codigo AS modelo
             FROM registro_assistencial ra JOIN modelo_documento_clinico m ON m.id = ra.modelo_documento_clinico_id
            WHERE ra.id = ? AND ra.estabelecimento_id = ?`,
          [registro, m!.est],
        ),
      ).toMatchObject({
        paciente_id: m!.paciente,
        atendimento_id: m!.atendimento,
        situacao: 'finalizado',
        texto_consolidado: 'Paciente dormindo, sem queixas',
        autor_usuario_id: m!.usuario,
        modelo: 'ANOTACAO_ENFERMAGEM',
      });
      expect(
        await uma(
          'SELECT componente, chave FROM registro_assistencial_extensao WHERE registro_assistencial_id = ?',
          [registro],
        ),
      ).toMatchObject({ componente: 'anexo', chave: `anotacao:${chave}` });
      // O reenvio do mesmo ato devolve o mesmo registro, sem gravar outro.
      expect(await anotar()).toBe(registro);
      expect(
        Number(
          (
            await uma('SELECT COUNT(*) AS n FROM registro_assistencial_extensao WHERE chave = ?', [
              `anotacao:${chave}`,
            ])
          )?.['n'],
        ),
      ).toBe(1);
      // O atendimento de outro estabelecimento é recusado (nada gravado).
      await expect(anotar(ctx(m!, m!.outroEst))).rejects.toMatchObject({
        problema: { codigo: 'atendimento-inexistente' },
      });
    });
  });

  describe('balanço hídrico', () => {
    it('lança, estorna (o original não muda) e fecha conferindo os lançamentos vistos', async () => {
      const c = ctx(m!);
      const dom = await bal.dominios(c);
      const ganho = dom.grupos.find((x) => x.nome === 'Endovenoso')!.codigo;
      const janela = civil(-120);
      const lancarEm = (
        cx: ContextoNucleo,
        vol: number,
        jan = janela,
        hora = civil(-20),
        chave: string | null = null,
      ) =>
        bal.gravarSgh(
          cx,
          {
            estabelecimento: m!.est,
            usuario: m!.usuario,
            acao: 'inclusao',
            entidade: 'balanco_lancamento',
            entidadeId: null,
            correlacao: c.correlacao,
          },
          (g) =>
            g.lancar({
              paciente: m!.paciente,
              atendimento: m!.atendimento,
              sentido: 'ganho',
              grupo: ganho,
              via: null,
              tipoEliminacao: null,
              intensidade: null,
              aspecto: null,
              estimado: false,
              volumeMl: vol,
              horaReal: hora,
              descricao: 'Soro sintético',
              origemOffline: false,
              usuario: m!.login,
              chave,
              janelaInicio: jan,
            }),
        );
      const lancar = (vol: number) => lancarEm(c, vol);
      const a = await lancar(250);
      const b = await lancar(100);
      // A chave do ato: o reenvio do mesmo pedido devolve o lançamento já gravado (numa janela antiga, fora do fechamento).
      const antiga = civil(-3 * 1440);
      const k = `chave-ato-${Date.now()}`;
      const k1 = await lancarEm(c, 40, antiga, civil(-3 * 1440 + 30), k);
      expect(k1.repetida).toBe(false);
      expect(await lancarEm(c, 40, antiga, civil(-3 * 1440 + 30), k)).toEqual({ id: k1.id, repetida: true });
      const est = await bal.gravarSgh(
        c,
        {
          estabelecimento: m!.est,
          usuario: m!.usuario,
          acao: 'inclusao',
          entidade: 'balanco_lancamento',
          entidadeId: b.id,
          correlacao: c.correlacao,
        },
        (g) =>
          g.estornar({
            atendimento: m!.atendimento,
            id: b.id,
            motivo: 'Lançado em dobro',
            usuario: m!.login,
            janelaInicio: () => janela,
          }),
      );
      const l = await bal.lancamentos(c, { atendimento: m!.atendimento, de: civil(-60), ate: civil(1) });
      expect(l.itens.find((x) => x.id === b.id)).toMatchObject({ estornadoPor: est, volumeMl: 100 });
      expect(l.itens.find((x) => x.id === est)).toMatchObject({ origem: 'estorno', estornado: b.id });
      expect(await bal.lancamento(c, a.id)).toMatchObject({ volumeMl: 250, atendimento: m!.atendimento });
      const fechar = (vistos: number[], tipo: 'parcial' | 'total' = 'parcial') =>
        bal.gravarSgh(
          c,
          {
            estabelecimento: m!.est,
            usuario: m!.usuario,
            acao: 'inclusao',
            entidade: 'balanco_fechamento',
            entidadeId: null,
            correlacao: c.correlacao,
          },
          (g) =>
            g.fechar({
              paciente: m!.paciente,
              atendimento: m!.atendimento,
              unidade: UNIDADE,
              horaCorte: janela.slice(11, 16),
              tipo,
              inicio: janela,
              fim: civil(1),
              fimInclusivo: true,
              lancamentosVistos: vistos,
              pendentes: [],
              ganhosMl: 250,
              perdasMl: 0,
              insensiveisMl: 0,
              saldoMl: 250,
              diureseMl: 0,
              pesoKg: null,
              temperaturaMaxima: null,
              debitoUrinario: null,
              oliguria: false,
              formula: 'nenhuma',
              lancamentos: 1,
              parcelas: '',
              usuario: m!.login,
            }),
        );
      // A tela viu outros lançamentos: recusa sem gravar.
      await expect(fechar([a.id, b.id])).rejects.toMatchObject({ problema: { codigo: 'balanco-mudou' } });
      const f = await fechar([a.id]);
      expect(f.importados).toEqual([]);
      expect((await bal.fechamentos(c, m!.atendimento))[0]).toMatchObject({
        id: f.id,
        tipo: 'parcial',
        saldoMl: 250,
        ganhosMl: 250,
      });
      // As recusas do estorno com os códigos da porta em memória.
      const estornar = (id: number) =>
        bal.gravarSgh(
          c,
          {
            estabelecimento: m!.est,
            usuario: m!.usuario,
            acao: 'inclusao',
            entidade: 'balanco_lancamento',
            entidadeId: id,
            correlacao: c.correlacao,
          },
          (g) =>
            g.estornar({
              atendimento: m!.atendimento,
              id,
              motivo: 'Teste',
              usuario: m!.login,
              janelaInicio: () => janela,
            }),
        );
      await expect(estornar(b.id)).rejects.toMatchObject({ problema: { codigo: 'ja-estornado' } });
      await expect(estornar(est)).rejects.toMatchObject({ problema: { codigo: 'estorno-de-estorno' } });
      await expect(estornar(999_999_999)).rejects.toMatchObject({ problema: { codigo: 'nao-encontrado' } });
      // O balanço de 24 horas fechado é retrato: nem segundo fechamento, nem lançamento, nem estorno na janela.
      const total = await fechar([a.id], 'total');
      await expect(fechar([a.id], 'total')).rejects.toMatchObject({ problema: { codigo: 'ja-fechado' } });
      await expect(lancar(10)).rejects.toMatchObject({ problema: { codigo: 'janela-fechada' } });
      await expect(estornar(a.id)).rejects.toMatchObject({ problema: { codigo: 'janela-fechada' } });
      expect(
        await uma(
          "SELECT COUNT(*) AS n FROM balanco_fechamento WHERE balanco_hidrico_paciente_id = (SELECT balanco_hidrico_paciente_id FROM balanco_fechamento WHERE id = ?) AND tipo = 'total'",
          [total.id],
        ),
      ).toMatchObject({ n: 1 });
      // O reenvio do mesmo pedido (outra janela) devolve o lançamento da primeira vez; outro conteúdo é recusado.
      const outra = civil(-3000);
      const ca = comAto(c, `t-${P}-${randomUUID()}`, { volume: 30 });
      const r1 = await lancarEm(ca, 30, outra, civil(-2990));
      const r2 = await lancarEm(ca, 30, outra, civil(-2990));
      expect([r2.id, ca.ato.repetida]).toEqual([r1.id, true]);
      await expect(
        lancarEm(comAto(c, ca.ato.chave, { volume: 31 }), 31, outra, civil(-2990)),
      ).rejects.toMatchObject({ problema: { codigo: 'idempotencia-divergente' } });
      // Outro estabelecimento não vê o balanço.
      expect(await bal.fechamentos(ctx(m!, m!.outroEst), m!.atendimento)).toEqual([]);
    });
  });

  describe('agência transfusional', () => {
    it('recebe a bolsa (movimento de entrada), libera com a versão e recusa a versão vencida', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'bolsa_hemocomponente',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      const r = await ag.gravarSgh(c, trilha, (g) =>
        g.receberBolsa({
          numero: `${P}-B9`,
          hemocomponente: 'CH',
          tipagem: { abo: 'O', rh: 'positivo' },
          volumeMl: 280,
          validade: civil(20 * 1440),
          origem: 'HEMOCENTRO L0204',
          local: m!.local,
          irradiada: false,
          leucorreduzida: true,
          temperaturaC: 4,
          inspecaoOk: true,
          situacao: 'quarentena',
          usuario: m!.login,
          chave: null,
        }),
      );
      const b = await ag.bolsa(c, { id: r.id }, civil(0));
      expect(b).toMatchObject({
        numero: `${P}-B9`,
        situacao: 'quarentena',
        tipagem: { abo: 'O', rh: 'positivo' },
        versao: 1,
        origem: 'HEMOCENTRO L0204',
      });
      await expect(
        ag.gravarSgh(c, trilha, (g) =>
          g.receberBolsa({
            numero: `${P}-B9`,
            hemocomponente: 'CH',
            tipagem: { abo: 'O', rh: 'positivo' },
            volumeMl: 280,
            validade: civil(20 * 1440),
            origem: 'HEMOCENTRO L0204',
            local: m!.local,
            irradiada: false,
            leucorreduzida: true,
            temperaturaC: 4,
            inspecaoOk: true,
            situacao: 'quarentena',
            usuario: m!.login,
            chave: null,
          }),
        ),
      ).rejects.toMatchObject({
        problema: { codigo: 'bolsa-repetida' },
      });
      const mov = (versao: number) =>
        ag.gravarSgh(c, trilha, (g) =>
          g.movimentarBolsa({
            bolsa: r.id,
            acao: 'liberar',
            requisicao: null,
            motivoCadastro: null,
            motivo: null,
            versao,
            agora: civil(0),
            usuario: m!.login,
            chave: null,
          }),
        );
      expect(await mov(1)).toMatchObject({ situacao: 'liberada' });
      await expect(mov(1)).rejects.toMatchObject({ problema: { codigo: 'situacao-bolsa' } });
      expect((await ag.movimentos(c, r.id)).map((x) => [x.tipo, x.situacaoDepois])).toEqual([
        ['recebimento', 'quarentena'],
        ['liberacao', 'liberada'],
      ]);
      expect((await ag.estoque(c, { agora: civil(0), numero: `${P}-B9` })).itens).toHaveLength(1);
      // A correção guarda a versão anterior num movimento de alteração; a observação da bolsa não muda.
      const corr = await ag.gravarSgh(c, trilha, (g) =>
        g.corrigirBolsa({
          bolsa: r.id,
          versao: 2,
          volumeMl: 300,
          motivo: 'Volume digitado errado',
          usuario: m!.login,
        } as never),
      );
      expect(corr).toMatchObject({ id: r.id, versao: 3 });
      expect(await ag.versoesBolsa(c, r.id)).toEqual([
        expect.objectContaining({
          versao: 1,
          numero: `${P}-B9`,
          volumeMl: 280,
          tipagem: { abo: 'O', rh: 'positivo' },
          motivo: 'Volume digitado errado',
          corrigidaPor: m!.login,
        }),
      ]);
      expect(
        await uma('SELECT observacao, volume_ml FROM bolsa_hemocomponente WHERE id = ?', [r.id]),
      ).toMatchObject({
        observacao: null,
        volume_ml: 300,
      });
      expect((await ag.movimentos(c, r.id)).map((x) => x.tipo)).toEqual(['recebimento', 'liberacao']);
      expect(
        (await ag.estoque(ctx(m!, m!.outroEst), { agora: civil(0), numero: `${P}-B9` })).itens,
      ).toHaveLength(0);
    });

    it('a tipagem registrada é liberada por outro profissional (o mesmo é recusado)', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'teste_imuno_hematologico',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      // A prova cruzada só é compatível com o resultado negativo: sem resultado ou inconclusiva, nunca.
      expect(['negativo', 'positivo', 'inconclusivo', null].map(provaCruzadaDoResultado)).toEqual([
        'compativel',
        'incompativel',
        null,
        null,
      ]);
      const r = await ag.gravarSgh(
        c,
        (x: { id: number }) => ({ ...trilha, entidadeId: x.id }),
        (g) =>
          g.registrarImuno({
            tipo: 'aboRh',
            paciente: m!.paciente,
            requisicao: null,
            metodo: 'gelTeste',
            origem: 'digitado',
            exameLancado: null,
            observacao: null,
            direta: { antiA: 0, antiB: 0, antiD: 4, controle: 0 },
            reversa: { hemaciaA1: 4, hemaciaB: 4 },
            tipagem: { abo: 'O', rh: 'positivo' },
            usuario: m!.login,
            chave: null,
          }),
      );
      expect((await ag.imunos(c, { id: r.id })).itens[0]).toMatchObject({
        tipo: 'aboRh',
        estado: 'registrado',
        tipagem: { abo: 'O', rh: 'positivo' },
        direta: { antiD: 4 },
      });
      await expect(
        ag.gravarSgh(c, trilha, (g) => g.liberarImuno({ id: r.id, usuario: m!.login })),
      ).rejects.toMatchObject({ problema: { codigo: 'mesmo-profissional' } });
      const c2 = ctx(m!, m!.est, m!.usuario2);
      await ag.gravarSgh(c2, { ...trilha, usuario: m!.usuario2, correlacao: c2.correlacao }, (g) =>
        g.liberarImuno({ id: r.id, usuario: m!.login2 }),
      );
      expect(await ag.resultadosDoPaciente(c, m!.paciente)).toEqual([
        expect.objectContaining({ tipo: 'aboRh', estado: 'liberado' }),
      ]);
      // Outro estabelecimento lê a tipagem do paciente (dado da rede), mas não a invalida: é de quem registrou.
      await expect(
        ag.gravarSgh(ctx(m!, m!.outroEst), trilha, (g) =>
          g.invalidarImuno({ id: r.id, usuario: m!.login, motivo: 'Teste de outro estabelecimento' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'exame-inexistente' } });
      await ag.gravarSgh(c, { ...trilha, entidadeId: r.id }, (g) =>
        g.invalidarImuno({ id: r.id, usuario: m!.login, motivo: 'Amostra hemolisada' }),
      );
      expect((await ag.imunos(c, { id: r.id })).itens[0]).toMatchObject({
        estado: 'invalidado',
        motivoInvalidacao: 'Amostra hemolisada',
      });
      // A requisição de outro estabelecimento não recebe exame.
      await expect(
        ag.gravarSgh(c, trilha, (g) =>
          g.registrarImuno({
            tipo: 'pai',
            paciente: m!.paciente,
            requisicao: 999_999_999,
            metodo: 'gelTeste',
            origem: 'digitado',
            exameLancado: null,
            observacao: null,
            resultado: 'negativo',
            anticorpos: null,
            usuario: m!.login,
            chave: null,
          } as never),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'requisicao-inexistente' } });
    });
  });

  describe('escores, contenção e TRR', () => {
    it('o NEWS2 com os sinais e os itens pelas variáveis da escala; o aviso vai ao outbox; o TRR acionado pelo escore', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'aplicacao_escala',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      const r = await esc.gravarSgh(c, trilha, (g) =>
        g.registrarEscore({
          sinais: [
            {
              paciente: m!.paciente,
              atendimento: m!.atendimento,
              horario: null,
              tipo: 'fr',
              valor: 26,
              unidade: 'irpm',
              metodo: null,
              foraDaFaixa: true,
              horaReal: civil(-3),
              origemOffline: false,
              observacao: null,
              usuario: m!.login,
            },
          ],
          escore: {
            paciente: m!.paciente,
            reg: null,
            atendimento: m!.atendimento,
            unidade: UNIDADE,
            escala: 'news2',
            versaoRegra: 1,
            itens: { fr: 3, spo2: 2 },
            total: 5,
            faixa: 'media',
            gatilho: 'medico',
            suspeitaInfeccao: false,
            origem: 'afericao',
            aferidoEm: civil(-3),
            usuario: m!.login,
          },
          cuidados: [],
          cumprir: null,
          // A saída do serviço para o NEWS2 de 5: a reavaliação de Braden e Morse por mudança de quadro.
          programar: programacaoPorMudancaDeQuadro(5, 0, civil(-3), 6).map((x) => ({
            paciente: m!.paciente,
            reg: null,
            unidade: UNIDADE,
            escala: x.escala,
            motivo: x.motivo,
            devidaEm: x.devidaEm,
            prazoEm: x.prazoEm,
            observacao: 'NEWS2 5',
            usuario: m!.login,
            chave: (escore: number) => `quadro:news2:${escore}`,
          })),
          avisos: [
            (id) => ({
              login: m!.login2,
              tipo: 'news2',
              gravidade: 'atencao',
              modulo: 'enfermagem',
              evento: 'news2.alerta',
              titulo: 'NEWS2 5',
              link: null,
              objetoTabela: 'aplicacao_escala',
              objetoChave: String(id),
            }),
          ],
        }),
      );
      expect(r).toMatchObject({ avisos: 1 });
      expect(r.sinais).toHaveLength(1);
      const [e] = await esc.escores(c, [m!.paciente], civil(-60));
      expect(e).toMatchObject({
        id: r.id,
        escala: 'news2',
        total: 5,
        faixa: 'media',
        gatilho: 'medico',
        itens: { fr: 3, spo2: 2 },
        origem: 'afericao',
        unidade: UNIDADE,
      });
      expect(
        await uma(
          "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'enfermagem.aviso.central' AND estabelecimento_id = ? AND referencia_externa = ?",
          [m!.est, `aviso:news2.alerta:${r.id}:${m!.login2}`],
        ),
      ).toMatchObject({ n: 1 });
      // O NEWS2 de 5 grava o escore e as reavaliações programadas (uma por escala, pendentes).
      expect(
        await uma(
          "SELECT COUNT(*) AS n FROM reavaliacao_escala WHERE estabelecimento_id = ? AND situacao = 'pendente' AND motivo = 'mudanca_quadro' AND chave LIKE ?",
          [m!.est, `${m!.paciente}:%:quadro:news2:${r.id}`],
        ),
      ).toMatchObject({ n: 2 });
      expect(
        (await esc.reavaliacoes(c, [m!.paciente], civil(-60)))
          .map((x) => [x.escala, x.motivo, x.situacao])
          .sort(),
      ).toEqual([
        ['braden', 'mudanca-quadro', 'pendente'],
        ['morse', 'mudanca-quadro', 'pendente'],
      ]);
      expect(
        await uma('SELECT interpretacao FROM aplicacao_escala WHERE id = ?', [r.id]).then((x) =>
          JSON.parse(String(x?.['interpretacao'])),
        ),
      ).toEqual({ faixa: 'media', gatilho: 'medico', versaoRegra: 1, suspeitaInfeccao: false });
      // O atendimento deste estabelecimento não recebe escore pela sessão de outro.
      await expect(
        esc.gravarSgh(ctx(m!, m!.outroEst), trilha, (g) =>
          g.registrarEscore({
            sinais: [],
            escore: { ...e!, reg: null, sinalVital: null } as never,
            cuidados: [],
            cumprir: null,
            programar: [],
            avisos: [],
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'atendimento-inexistente' } });
      // A variável que a escala não tem é recusada (nada gravado).
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.registrarEscore({
            sinais: [],
            escore: { ...e!, reg: null, sinalVital: null, itens: { inexistente: 1 } } as never,
            cuidados: [],
            cumprir: null,
            programar: [],
            avisos: [],
          }),
        ),
      ).rejects.toMatchObject({
        problema: { codigo: 'cadastro-incompleto' },
      });
      const t = await esc.gravarSgh(c, { ...trilha, entidade: 'acionamento_resposta_rapida' }, (g) =>
        g.acionarTrr({
          paciente: m!.paciente,
          atendimento: m!.atendimento,
          unidade: UNIDADE,
          uti: true,
          escore: r.id,
          acionadoEm: civil(-1),
          motivo: null,
          usuario: m!.login,
        }),
      );
      expect(t.alertaEm).toBe(civil(-3));
      await esc.gravarSgh(c, { ...trilha, entidade: 'acionamento_resposta_rapida' }, (g) =>
        g.eventoTrr({ trr: t.id, tipo: 'chegada', em: civil(0), desfecho: null, usuario: m!.login }),
      );
      expect((await esc.acionamentosTrr(c, { desde: civil(-60) }))[0]).toMatchObject({
        id: t.id,
        origem: 'escore',
        escore: r.id,
        chegadaEm: civil(0),
        uti: true,
      });
      expect(await esc.escoresComTrr(c, [r.id])).toEqual(new Set([r.id]));
      // A ficha da PCR do acionamento: a versão 1 (rascunho), a 2 finalizada, a correção com a justificativa e a inativação.
      const ficha = {
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        unidade: null,
        uti: false,
        trr: t.id,
        anterior: null,
        situacao: 'rascunho' as const,
        colapsoEm: civil(-2),
        dados: JSON.stringify({ ritmoInicial: 'fv' }),
        autor: m!.login,
      };
      const pcrTrilha = { ...trilha, entidade: 'parada_cardiorrespiratoria_ficha' };
      const v1 = await esc.gravarSgh(c, pcrTrilha, (g) => g.gravarFichaPcr(ficha));
      expect(v1.versao).toBe(1);
      await expect(esc.gravarSgh(c, pcrTrilha, (g) => g.gravarFichaPcr(ficha))).rejects.toMatchObject({
        problema: { codigo: 'pcr-ja-aberta' },
      });
      const v2 = await esc.gravarSgh(c, pcrTrilha, (g) =>
        g.gravarFichaPcr({
          ...ficha,
          anterior: v1.id,
          situacao: 'finalizada',
          dados: JSON.stringify({ ritmoInicial: 'fv', rosc: true }),
        }),
      );
      expect(v2.versao).toBe(2);
      await expect(
        esc.gravarSgh(c, pcrTrilha, (g) => g.gravarFichaPcr({ ...ficha, anterior: v1.id })),
      ).rejects.toMatchObject({ problema: { codigo: 'versao-desatualizada' } });
      await expect(
        esc.gravarSgh(c, pcrTrilha, (g) =>
          g.gravarFichaPcr({ ...ficha, anterior: v2.id, situacao: 'finalizada', motivo: 'curto' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'motivo-obrigatorio' } });
      await expect(
        esc.gravarSgh(ctx(m!, m!.est, m!.usuario2), pcrTrilha, (g) =>
          g.gravarFichaPcr({
            ...ficha,
            anterior: v2.id,
            situacao: 'finalizada',
            motivo: 'Correção do horário do colapso',
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'so-o-autor' } });
      const v3 = await esc.gravarSgh(c, pcrTrilha, (g) =>
        g.gravarFichaPcr({
          ...ficha,
          anterior: v2.id,
          situacao: 'finalizada',
          motivo: 'Correção do horário do colapso',
        }),
      );
      expect(
        (await esc.versoesPcr(c, { atendimentos: [m!.atendimento] })).map((x) => [
          x.versao,
          x.situacao,
          x.trr,
        ]),
      ).toEqual([
        [3, 'finalizada', t.id],
        [2, 'finalizada', t.id],
        [1, 'rascunho', t.id],
      ]);
      await esc.gravarSgh(c, pcrTrilha, (g) =>
        g.inativarTrr({ origem: 'pcr', id: v3.id, motivo: 'Ficha do paciente errado', usuario: m!.login }),
      );
      expect((await esc.versoesPcr(c, { id: v3.id }))[0]).toMatchObject({
        motivo: 'Correção do horário do colapso',
        inativacao: { motivo: 'Ficha do paciente errado', usuario: m!.login },
        dados: JSON.stringify({ ritmoInicial: 'fv' }),
      });
      await expect(
        esc.gravarSgh(c, pcrTrilha, (g) =>
          g.inativarTrr({ origem: 'pcr', id: v3.id, motivo: 'De novo', usuario: m!.login }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-inativado' } });
      expect(await esc.versoesPcr(ctx(m!, m!.outroEst), { atendimentos: [m!.atendimento] })).toEqual([]);
      // O estorno guarda o motivo (na trilha, até a coluna do pedido) e o original fica inativado.
      await esc.gravarSgh(c, { ...trilha, acao: 'alteracao' as const, entidadeId: r.id }, (g) =>
        g.estornarRegistro({
          origem: 'escore',
          id: r.id,
          paciente: m!.paciente,
          tipo: 'estorno',
          motivo: 'Registrado no paciente errado',
          alerta: null,
          escoreMantem: null,
          usuario: m!.login,
        }),
      );
      expect(
        (await esc.escores(c, [m!.paciente], civil(-60))).find((x) => x.id === r.id)?.estorno,
      ).toMatchObject({
        motivo: 'Registrado no paciente errado',
      });
    });

    it('a ordem de contenção com a checagem aprazada, a checagem e a retirada (encerrada não aceita outra)', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'contencao_paciente',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      const inicio = civil(-30);
      const horarios = [civil(0), civil(30)];
      const id = await esc.gravarSgh(c, trilha, (g) =>
        g.prescreverContencao({
          paciente: m!.paciente,
          atendimento: m!.atendimento,
          unidade: UNIDADE,
          motivo: 'riscoDispositivo',
          justificativa: 'Retirada de cateter (sintético)',
          tipo: 'leito',
          membros: ['msd', 'mse'],
          prazoHoras: 4,
          intervaloMinutos: 30,
          inicio,
          horarios,
          anterior: null,
          prescritor: m!.login,
        }),
      );
      await esc.gravarSgh(c, trilha, (g) =>
        g.checarContencao({
          contencao: id,
          previsto: horarios[0]!,
          achados: { perfusao: 'normal', pele: 'alterado', posicao: 'normal', necessidades: 'normal' },
          observacao: 'Hiperemia leve no punho',
          usuario: m!.login,
        }),
      );
      const [o] = await esc.contencoes(c, { atendimentos: [m!.atendimento], desde: civil(-60) });
      expect(o).toMatchObject({
        id,
        motivo: 'riscoDispositivo',
        membros: ['msd', 'mse'],
        prazoHoras: 4,
        unidade: UNIDADE,
        encerramento: null,
      });
      expect(o!.horarios.map((h) => [h.previsto, h.checagem?.alterado ?? null])).toEqual([
        [horarios[0], true],
        [horarios[1], null],
      ]);
      // O adendo é do autor da checagem; a checagem original não muda e o adendo é lido junto.
      const adendo = {
        contencao: id,
        previsto: horarios[0]!,
        achados: { perfusao: 'normal', pele: 'normal', posicao: 'normal', necessidades: 'normal' } as const,
        observacao: 'Hiperemia era do esparadrapo',
        motivo: 'Achado da pele corrigido',
        usuario: m!.login,
      };
      await esc.gravarSgh(c, trilha, (g) => g.adendoChecagemContencao(adendo));
      const [o2] = await esc.contencoes(c, { atendimentos: [m!.atendimento], desde: civil(-60) });
      expect(o2!.horarios[0]!.checagem).toMatchObject({
        alterado: true,
        adendos: [{ alterado: false, motivo: 'Achado da pele corrigido', usuario: m!.login }],
      });
      await expect(
        esc.gravarSgh(ctx(m!, m!.est, m!.usuario2), trilha, (g) =>
          g.adendoChecagemContencao({ ...adendo, usuario: m!.login2 }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'so-o-autor' } });
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.adendoChecagemContencao({ ...adendo, previsto: horarios[1]! })),
      ).rejects.toMatchObject({ problema: { codigo: 'checagem-inexistente' } });
      await esc.gravarSgh(c, trilha, (g) =>
        g.encerrarContencao({
          contencao: id,
          tipo: 'retirada',
          motivo: 'Paciente colaborativo',
          usuario: m!.login,
        }),
      );
      expect(await esc.contencao(c, id)).toMatchObject({ encerramento: { tipo: 'retirada' } });
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.checarContencao({
            contencao: id,
            previsto: horarios[1]!,
            achados: { perfusao: 'normal', pele: 'normal', posicao: 'normal', necessidades: 'normal' },
            observacao: null,
            usuario: m!.login,
          }),
        ),
      ).rejects.toMatchObject({
        problema: { codigo: 'contencao-encerrada' },
      });
      expect(await esc.contencao(ctx(m!, m!.outroEst), id)).toBeNull();
    });

    it('a reavaliação programada e dispensada, a classificação de pacientes e o índice da UTI com validação e estorno', async () => {
      const c = ctx(m!);
      const trilha = (entidade: string) => ({
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade,
        entidadeId: null,
        correlacao: c.correlacao,
      });
      const reg = Number(
        (await uma('SELECT id FROM internacao WHERE atendimento_id = ?', [m!.atendimento]))?.['id'],
      );
      const nova = {
        paciente: m!.paciente,
        reg,
        unidade: UNIDADE,
        escala: 'braden' as const,
        motivo: 'diaria' as const,
        chave: `diaria:${civil(0).slice(0, 10)}`,
        devidaEm: civil(-10),
        prazoEm: civil(120),
        observacao: null,
        usuario: m!.login,
      };
      const rid = await esc.gravarSgh(c, trilha('reavaliacao_escala'), (g) => g.programarReavaliacao(nova));
      await expect(
        esc.gravarSgh(c, trilha('reavaliacao_escala'), (g) => g.programarReavaliacao(nova)),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-programada' } });
      expect((await esc.reavaliacoes(c, [m!.paciente], civil(-60))).find((x) => x.id === rid)).toMatchObject({
        reg,
        escala: 'braden',
        motivo: 'diaria',
        situacao: 'pendente',
        devidaEm: `${civil(-10)}:00`,
      });
      expect(
        await esc.gravarSgh(c, trilha('reavaliacao_escala'), (g) =>
          g.dispensarReavaliacao({
            id: rid,
            motivo: 'Paciente em alta',
            quando: civil(0),
            usuario: m!.login,
          }),
        ),
      ).toEqual({ paciente: m!.paciente });
      await expect(
        esc.gravarSgh(c, trilha('reavaliacao_escala'), (g) =>
          g.dispensarReavaliacao({ id: rid, motivo: 'De novo', quando: civil(0), usuario: m!.login }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'reavaliacao-encerrada' } });
      expect((await esc.reavaliacoes(c, [m!.paciente], civil(-60))).find((x) => x.id === rid)?.situacao).toBe(
        'dispensada',
      );

      // Classificação de pacientes: uma por instrumento, turno e internação; o estorno libera o turno.
      const dia = civil(0).slice(0, 10);
      const cl = {
        paciente: m!.paciente,
        reg,
        atendimento: m!.atendimento,
        unidade: UNIDADE,
        data: dia,
        turno: 'diurno' as const,
        instrumento: 'fugulin' as const,
        versao: 1,
        itens: { estadoMental: 2, oxigenacao: 3 },
        total: 21,
        categoria: 'intermediario',
        horas24h: 5.6,
        usuario: m!.login,
      };
      const cid = await esc.gravarSgh(c, trilha('classificacao_paciente'), (g) => g.classificar(cl));
      await expect(
        esc.gravarSgh(c, trilha('classificacao_paciente'), (g) => g.classificar(cl)),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-classificado' } });
      expect(await esc.classificacoes(c, UNIDADE, dia, 'diurno')).toMatchObject([
        {
          id: cid,
          reg,
          instrumento: 'fugulin',
          itens: { estadoMental: 2, oxigenacao: 3 },
          total: 21,
          horas24h: 5.6,
          data: dia,
          estorno: null,
        },
      ]);
      await esc.gravarSgh(
        c,
        { ...trilha('classificacao_paciente'), acao: 'alteracao' as const, entidadeId: cid },
        (g) =>
          g.estornarRegistro({
            origem: 'classificacao',
            id: cid,
            paciente: m!.paciente,
            tipo: 'invalidacao',
            motivo: 'Itens trocados',
            alerta: null,
            escoreMantem: null,
            usuario: m!.login,
          }),
      );
      expect((await esc.classificacoes(c, UNIDADE, dia, 'diurno'))[0]?.estorno).toMatchObject({
        tipo: 'invalidacao',
        motivo: 'Itens trocados',
        usuario: m!.login,
      });
      expect(await esc.registroParaEstorno(c, 'classificacao', cid)).toMatchObject({
        estornado: true,
        escala: 'fugulin',
      });
      await esc.gravarSgh(c, trilha('classificacao_paciente'), (g) => g.classificar(cl));

      // Índice da UTI: registrado, validado e estornado (a validação some do período do APACHE II).
      const ix = {
        paciente: m!.paciente,
        reg,
        atendimento: m!.atendimento,
        unidade: UNIDADE,
        indice: 'apache2' as const,
        variaveis: { idade: 60, temperatura: 38.5 },
        pontuacao: 18,
        categoria: 3,
        tipoAdmissao: 'clinica',
        mortalidade: 0.2537,
        impressaoConfig: 'cfg-1',
        coletadoEm: civil(-5),
        usuario: m!.login,
      };
      const iid = await esc.gravarSgh(c, trilha('indice_gravidade_uti'), (g) => g.registrarIndice(ix));
      expect((await esc.indicesDoPaciente(c, m!.paciente))[0]).toMatchObject({
        id: iid,
        reg,
        variaveis: { idade: 60, temperatura: 38.5 },
        mortalidade: 0.2537,
        impressaoConfig: 'cfg-1',
        situacao: 'registrado',
        registradoPor: m!.login,
        estorno: null,
      });
      await esc.gravarSgh(c, trilha('indice_gravidade_uti'), (g) =>
        g.validarIndice({ id: iid, validadoPor: m!.login, vinculo: 0, quando: civil(0) }),
      );
      await expect(
        esc.gravarSgh(c, trilha('indice_gravidade_uti'), (g) =>
          g.validarIndice({ id: iid, validadoPor: m!.login, vinculo: 0, quando: civil(0) }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-validado' } });
      expect((await esc.apachesDoPeriodo(c, dia, dia)).map((x) => x.id)).toEqual([iid]);
      await esc.gravarSgh(
        c,
        { ...trilha('indice_gravidade_uti'), acao: 'alteracao' as const, entidadeId: iid },
        (g) =>
          g.estornarRegistro({
            origem: 'indiceUti',
            id: iid,
            paciente: m!.paciente,
            tipo: 'estorno',
            motivo: 'Coleta do paciente errado',
            alerta: null,
            escoreMantem: null,
            usuario: m!.login,
          }),
      );
      expect((await esc.indicesDoPaciente(c, m!.paciente))[0]).toMatchObject({
        situacao: 'validado',
        estorno: { tipo: 'estorno', motivo: 'Coleta do paciente errado' },
      });
      expect(await esc.apachesDoPeriodo(c, dia, dia)).toEqual([]);
      await expect(
        esc.gravarSgh(c, trilha('indice_gravidade_uti'), (g) =>
          g.validarIndice({ id: iid, validadoPor: m!.login, vinculo: 0, quando: civil(0) }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'indice-estornado' } });
      expect(await esc.indicesDoPaciente(ctx(m!, m!.outroEst), m!.paciente)).toEqual([]);
    });

    it('o protocolo gerenciado do internado: inclusão, uma aberta por tipo, encerramento e inativação por engano', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'inclusao_protocolo_paciente',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      const gerenciado = await uma(
        'SELECT id FROM protocolo_gerenciado WHERE estabelecimento_id = ? AND codigo = ?',
        [m!.est, `${P}-SEPSE`],
      ).then(async (x) =>
        x
          ? Number(x['id'])
          : await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-protocolo` }, (e) =>
              e.inserir(
                "INSERT INTO protocolo_gerenciado (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'SEPSE SINTETICO', 'sepse', ?)",
                [m!.est, `${P}-SEPSE`, new Date()],
              ),
            ),
      );
      const inclusao = {
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        unidade: UNIDADE,
        local: 'uti' as const,
        tipo: 'sepse' as const,
        gerenciado,
        origem: 'suspeita' as const,
        escore: null,
        criterios: ['febre', 'taquicardia'],
        observacao: 'Suspeita clínica',
        reconhecidoEm: civil(-20),
        autor: m!.login,
        vinculo: 0,
      };
      const id = await esc.gravarSgh(c, trilha, (g) => g.incluirProtocoloInternado(inclusao));
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.incluirProtocoloInternado(inclusao)),
      ).rejects.toMatchObject({
        problema: { codigo: 'protocolo-ja-aberto' },
      });
      expect(await esc.protocoloInternado(c, id)).toMatchObject({
        id,
        tipo: 'sepse',
        gerenciado,
        origem: 'suspeita',
        criterios: ['febre', 'taquicardia'],
        reconhecidoEm: civil(-20),
        incluidoPor: m!.login,
        eventos: [],
      });
      const evento = {
        protocolo: id,
        codigo: '',
        situacao: '',
        ocorridoEm: civil(0),
        prazoEm: null,
        motivo: null,
        por: m!.login,
      };
      await esc.gravarSgh(c, trilha, (g) =>
        g.eventoProtocoloInternado({
          ...evento,
          tipoEvento: 'meta',
          codigo: 'lactato',
          situacao: 'cumprida',
        }),
      );
      await esc.gravarSgh(c, trilha, (g) =>
        g.eventoProtocoloInternado({
          ...evento,
          tipoEvento: 'checklist',
          codigo: 'hemocultura',
          situacao: 'sim',
        }),
      );
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.eventoProtocoloInternado({ ...evento, tipoEvento: 'meta', codigo: 'lactato' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-registrado' } });
      await esc.gravarSgh(c, trilha, (g) =>
        g.eventoProtocoloInternado({ ...evento, tipoEvento: 'encerramento', situacao: 'alta' }),
      );
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.eventoProtocoloInternado({ ...evento, tipoEvento: 'encerramento' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-encerrado' } });
      // Encerrado, o atendimento pode abrir outra inclusão do mesmo tipo; a lançada por engano é inativada e fica visível.
      const id2 = await esc.gravarSgh(c, trilha, (g) => g.incluirProtocoloInternado(inclusao));
      await esc.gravarSgh(c, trilha, (g) =>
        g.eventoProtocoloInternado({
          ...evento,
          protocolo: id2,
          tipoEvento: 'inativacao',
          motivo: 'Paciente errado',
        }),
      );
      expect((await esc.protocoloInternado(c, id2))?.eventos).toMatchObject([
        { tipo: 'inativacao', motivo: 'Paciente errado', por: m!.login },
      ]);
      expect((await esc.protocoloInternado(c, id))?.eventos).toMatchObject([
        { tipo: 'meta', codigo: 'lactato', situacao: 'cumprida' },
        { tipo: 'checklist', codigo: 'hemocultura', situacao: 'sim' },
        { tipo: 'encerramento', situacao: 'alta', quando: `${civil(0)}:00` },
      ]);
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.eventoProtocoloInternado({ ...evento, tipoEvento: 'checklist', codigo: 'antibiotico' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'protocolo-encerrado' } });
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.eventoProtocoloInternado({
            ...evento,
            protocolo: id2,
            tipoEvento: 'inativacao',
            motivo: 'De novo',
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-inativado' } });
      expect(await esc.protocoloInternado(ctx(m!, m!.outroEst), id)).toBeNull();
    });

    it('a decisão da profilaxia de TEV sobre o escore (avaliação criada), a anulação e a nova decisão como retificação', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'aplicacao_escala',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      const escore = await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-caprini` }, async (e) => {
        const caprini = await garantir(
          e,
          "SELECT id FROM escala_clinica WHERE codigo = 'caprini'",
          [],
          "INSERT INTO escala_clinica (codigo, descricao, criado_em) VALUES ('caprini', 'CAPRINI', ?)",
          [new Date()],
        );
        return e.inserir(
          `INSERT INTO aplicacao_escala (estabelecimento_id, paciente_id, atendimento_id, escala_clinica_id, aplicado_em,
              pontuacao_total, interpretacao, situacao, criado_em) VALUES (?, ?, ?, ?, ?, 6, ?, 'finalizada', ?)`,
          [
            m!.est,
            m!.paciente,
            m!.atendimento,
            caprini,
            new Date(),
            JSON.stringify({ faixa: 'alto', gatilho: 'profilaxia', versaoRegra: 1 }),
            new Date(),
          ],
        );
      });
      const decisao = { escore, paciente: m!.paciente, motivo: null, usuario: m!.login };
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.decidirProfilaxia({ ...decisao, decisao: 'nao-prescrita' })),
      ).rejects.toMatchObject({ problema: { codigo: 'motivo-obrigatorio' } });
      await esc.gravarSgh(c, trilha, (g) => g.decidirProfilaxia({ ...decisao, decisao: 'prescrita' }));
      expect(
        await uma(
          'SELECT risco_tev, perfil, profilaxia_indicada FROM profilaxia_tev_avaliacao WHERE aplicacao_escala_id = ?',
          [escore],
        ),
      ).toMatchObject({
        risco_tev: 'alto',
        perfil: 'cirurgico',
        profilaxia_indicada: 'farmacologica_mecanica',
      });
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.decidirProfilaxia({ ...decisao, decisao: 'prescrita' })),
      ).rejects.toMatchObject({ problema: { codigo: 'profilaxia-ja-decidida' } });
      const ret = { escore, paciente: m!.paciente, motivo: null, usuario: m!.login };
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.retificarProfilaxia({ ...ret, decisao: 'prescrita', justificativa: 'Sem mudança' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'sem-mudanca' } });
      await esc.gravarSgh(c, trilha, (g) =>
        g.retificarProfilaxia({
          ...ret,
          decisao: 'anulada',
          justificativa: 'Decisão lançada no escore errado',
        }),
      );
      expect((await esc.decisoesProfilaxia(c, [escore]))[0]).toMatchObject({
        escore,
        decisao: 'prescrita',
        anulada: true,
      });
      await esc.gravarSgh(c, trilha, (g) =>
        g.decidirProfilaxia({ ...decisao, decisao: 'nao-prescrita', motivo: 'Sangramento ativo' }),
      );
      const [d] = await esc.decisoesProfilaxia(c, [escore]);
      expect(d).toMatchObject({ decisao: 'nao-prescrita', motivo: 'Sangramento ativo', anulada: false });
      expect(d?.historico?.map((h) => h.decisao)).toEqual(['prescrita', 'anulada', 'nao-prescrita']);
      expect(await esc.decisoesProfilaxia(ctx(m!, m!.outroEst), [escore])).toEqual([]);
      // A faixa que a regra não conhece é recusada: a avaliação de risco não nasce com risco presumido.
      const semFaixa = await nucleo.escrever(
        { cliente: CLIENTE, correlacao: `${P}-caprini-faixa` },
        async (e) =>
          e.inserir(
            `INSERT INTO aplicacao_escala (estabelecimento_id, paciente_id, atendimento_id, escala_clinica_id, aplicado_em,
              pontuacao_total, interpretacao, situacao, criado_em)
           SELECT ?, ?, ?, id, ?, 6, ?, 'finalizada', ? FROM escala_clinica WHERE codigo = 'caprini'`,
            [
              m!.est,
              m!.paciente,
              m!.atendimento,
              new Date(),
              JSON.stringify({ faixa: 'altissimo', gatilho: 'profilaxia', versaoRegra: 9 }),
              new Date(),
            ],
          ),
      );
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.decidirProfilaxia({ ...decisao, escore: semFaixa, decisao: 'prescrita' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'faixa-desconhecida' } });
      expect(
        await uma('SELECT id FROM profilaxia_tev_avaliacao WHERE aplicacao_escala_id = ?', [semFaixa]),
      ).toBeFalsy();
    });

    it('o TRR com a chegada como evento versionado: a retificação do autor e a inativação, espelhadas no acionamento', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'acionamento_resposta_rapida',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      const t = await esc.gravarSgh(c, trilha, (g) =>
        g.acionarTrr({
          paciente: m!.paciente,
          atendimento: m!.atendimento,
          unidade: UNIDADE,
          uti: true,
          escore: null,
          acionadoEm: civil(-30),
          motivo: 'Queda de saturação',
          usuario: m!.login,
        }),
      );
      const evento = { trr: t.id, tipo: 'chegada' as const, desfecho: null, usuario: m!.login };
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.eventoTrr({ ...evento, em: civil(-40) })),
      ).rejects.toMatchObject({ problema: { codigo: 'antes-do-acionamento' } });
      const ev = await esc.gravarSgh(c, trilha, (g) => g.eventoTrr({ ...evento, em: civil(-25) }));
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.eventoTrr({ ...evento, em: civil(-24) })),
      ).rejects.toMatchObject({ problema: { codigo: 'evento-ja-registrado' } });
      const corr = {
        evento: ev,
        desfecho: null,
        motivo: 'Hora lançada errada',
        usuario: m!.login,
        agora: civil(0),
      };
      await expect(
        esc.gravarSgh(ctx(m!, m!.est, m!.usuario2), trilha, (g) =>
          g.retificarEventoTrr({ ...corr, em: civil(-20) }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'so-o-autor' } });
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.retificarEventoTrr({ ...corr, em: civil(30) })),
      ).rejects.toMatchObject({ problema: { codigo: 'hora-no-futuro' } });
      const r = await esc.gravarSgh(c, trilha, (g) => g.retificarEventoTrr({ ...corr, em: civil(-20) }));
      expect(r).toMatchObject({ trr: t.id, tipo: 'chegada' });
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.inativarTrr({ origem: 'evento', id: ev, motivo: 'x', usuario: m!.login }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'evento-nao-vigente' } });
      let lido = (await esc.acionamentosTrr(c, { desde: civil(-60) })).find((x) => x.id === t.id);
      expect(lido).toMatchObject({ chegadaEm: civil(-20) });
      expect(lido?.eventos).toMatchObject([
        { id: ev, seq: 1, em: civil(-25), vigente: false },
        { id: r.id, seq: 2, em: civil(-20), anterior: ev, motivo: 'Hora lançada errada', vigente: true },
      ]);
      await esc.gravarSgh(c, trilha, (g) =>
        g.inativarTrr({ origem: 'evento', id: r.id, motivo: 'Time não veio', usuario: m!.login }),
      );
      lido = (await esc.acionamentosTrr(c, { desde: civil(-60) })).find((x) => x.id === t.id);
      expect(lido).toMatchObject({ chegadaEm: null });
      expect(lido?.eventos?.[1]).toMatchObject({ vigente: false, inativacao: { motivo: 'Time não veio' } });
      await esc.gravarSgh(c, trilha, (g) =>
        g.eventoTrr({ ...evento, tipo: 'desfecho', desfecho: 'permanece', em: civil(-5) }),
      );
      expect(
        await uma('SELECT situacao, desfecho FROM acionamento_resposta_rapida WHERE id = ?', [t.id]),
      ).toMatchObject({ situacao: 'encerrado', desfecho: 'permanece' });
    });

    it('a lesão de pele: ficha por versão, curativo e correção, encerramento e inativação do lançado errado', async () => {
      const c = ctx(m!);
      const trilha = {
        estabelecimento: m!.est,
        usuario: m!.usuario,
        acao: 'inclusao' as const,
        entidade: 'lesao_pele_paciente',
        entidadeId: null,
        correlacao: c.correlacao,
      };
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-cadastro-lesao` }, async (e) => {
        await garantir(
          e,
          'SELECT id FROM tipo_lesao_pele WHERE codigo = ?',
          [`${P}-LPP`],
          "INSERT INTO tipo_lesao_pele (codigo, descricao, categoria, criado_em) VALUES (?, 'LPP SINTETICA', 'lesao_pressao', ?)",
          [`${P}-LPP`, new Date()],
        );
        await garantir(
          e,
          'SELECT id FROM regiao_corporal WHERE codigo = ?',
          [`${P}-SACRO`],
          "INSERT INTO regiao_corporal (codigo, descricao, nivel, criado_em) VALUES (?, 'SACRO SINTETICO', 'parte', ?)",
          [`${P}-SACRO`, new Date()],
        );
        await garantir(
          e,
          'SELECT id FROM estagio_lesao_pele WHERE codigo = ?',
          [`${P}-E2`],
          "INSERT INTO estagio_lesao_pele (codigo, descricao, criado_em) VALUES (?, 'ESTAGIO 2 SINTETICO', ?)",
          [`${P}-E2`, new Date()],
        );
        await garantir(
          e,
          'SELECT id FROM estagio_lesao_pele WHERE codigo = ?',
          [`${P}-E3`],
          "INSERT INTO estagio_lesao_pele (codigo, descricao, criado_em) VALUES (?, 'ESTAGIO 3 SINTETICO', ?)",
          [`${P}-E3`, new Date()],
        );
      });
      const estagioDa = async (lesao: number) =>
        (
          await uma(
            `SELECT e.codigo FROM lesao_pele_paciente l LEFT JOIN estagio_lesao_pele e ON e.id = l.estagio_lesao_pele_id
              WHERE l.id = ?`,
            [lesao],
          )
        )?.['codigo'] ?? null;
      const colunas = {
        tipo: `${P}-LPP`,
        regiao: `${P}-SACRO`,
        estagio: `${P}-E2`,
        presenteNaAdmissao: false,
        identificadaEm: civil(-120),
      };
      const nova = {
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        unidade: UNIDADE,
        uti: true,
        situacao: 'rascunho' as const,
        colunas,
        dados: JSON.stringify({ identificadaEm: civil(-120) }),
        autor: m!.login,
      };
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.registrarLesao({ ...nova, colunas: { ...colunas, tipo: 'NAO-EXISTE' } }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'cadastro-incompleto' } });
      const l = await esc.gravarSgh(c, trilha, (g) => g.registrarLesao(nova));
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.encerrarLesao({
            lesao: l.id,
            desfecho: 'alta',
            em: civil(0),
            observacao: null,
            usuario: m!.login,
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'lesao-em-rascunho' } });
      const v2 = await esc.gravarSgh(c, trilha, (g) =>
        g.versaoLesao({
          lesao: l.id,
          anterior: l.idVersao,
          situacao: 'finalizada',
          colunas,
          dados: '{"v":2}',
          motivo: null,
          autor: m!.login,
        }),
      );
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.versaoLesao({
            lesao: l.id,
            anterior: l.idVersao,
            situacao: 'finalizada',
            colunas,
            dados: '{}',
            motivo: 'Correção qualquer',
            autor: m!.login,
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'versao-desatualizada' } });
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.versaoLesao({
            lesao: l.id,
            anterior: v2.id,
            situacao: 'finalizada',
            colunas,
            dados: '{}',
            motivo: 'curta',
            autor: m!.login,
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'motivo-obrigatorio' } });
      const curativo = {
        lesao: l.id,
        realizadoEm: civil(-60),
        estagio: null,
        dados: '{"cobertura":"espuma"}',
        autor: m!.login,
      };
      await expect(
        esc.gravarSgh(c, trilha, (g) => g.curativoLesao({ ...curativo, realizadoEm: civil(-180) })),
      ).rejects.toMatchObject({ problema: { codigo: 'curativo-antes-da-lesao' } });
      // O curativo lançado com o estágio 3 por engano muda o estágio da lesão; a correção sem estágio o devolve ao 2.
      expect(await estagioDa(l.id)).toBe(`${P}-E2`);
      const k1 = await esc.gravarSgh(c, trilha, (g) => g.curativoLesao({ ...curativo, estagio: `${P}-E3` }));
      expect(await estagioDa(l.id)).toBe(`${P}-E3`);
      const k2 = await esc.gravarSgh(c, trilha, (g) =>
        g.corrigirCurativoLesao({ ...curativo, anterior: k1.id, motivo: 'Cobertura lançada errada' }),
      );
      expect(await estagioDa(l.id)).toBe(`${P}-E2`);
      // A inativação do curativo com estágio também devolve o estágio da última linha vigente.
      const kx = await esc.gravarSgh(c, trilha, (g) =>
        g.curativoLesao({ ...curativo, realizadoEm: civil(-40), estagio: `${P}-E3` }),
      );
      expect(await estagioDa(l.id)).toBe(`${P}-E3`);
      await esc.gravarSgh(c, trilha, (g) =>
        g.inativarLesao({
          origem: 'curativo',
          id: kx.id,
          motivo: 'Curativo lançado na lesão errada',
          usuario: m!.login,
        }),
      );
      expect(await estagioDa(l.id)).toBe(`${P}-E2`);
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.corrigirCurativoLesao({ ...curativo, anterior: k1.id, motivo: 'Outra correção qualquer' }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'curativo-desatualizado' } });
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.fotoLesao({
            lesao: l.id,
            curativo: k2.id,
            anexo: 999_999_999,
            tiradaEm: civil(-50),
            usuario: m!.login,
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'anexo-inexistente' } });
      await expect(
        esc.gravarSgh(c, trilha, (g) =>
          g.inativarLesao({
            origem: 'lesao',
            id: l.id,
            motivo: 'Lesão do paciente errado',
            usuario: m!.login,
          }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'lesao-com-registros' } });
      await esc.gravarSgh(c, trilha, (g) =>
        g.inativarLesao({
          origem: 'curativo',
          id: k2.id,
          motivo: 'Curativo do paciente errado',
          usuario: m!.login,
        }),
      );
      await esc.gravarSgh(c, trilha, (g) =>
        g.encerrarLesao({
          lesao: l.id,
          desfecho: 'cicatrizada',
          em: civil(0),
          observacao: 'Epitelizada',
          usuario: m!.login,
        }),
      );
      await expect(esc.gravarSgh(c, trilha, (g) => g.curativoLesao(curativo))).rejects.toMatchObject({
        problema: { codigo: 'lesao-encerrada' },
      });
      const [lida] = await esc.lesoes(c, { id: l.id });
      expect(lida?.versoes).toMatchObject([
        { id: v2.id, versao: 2, anterior: l.idVersao, situacao: 'finalizada', dados: '{"v":2}' },
        { id: l.idVersao, versao: 1, anterior: null, situacao: 'rascunho' },
      ]);
      expect(lida?.curativos?.filter((x) => x.id !== kx.id)).toMatchObject([
        { id: k1.id, anterior: null, realizadoEm: civil(-60) },
        { id: k2.id, anterior: k1.id, motivo: 'Cobertura lançada errada' },
      ]);
      expect(lida?.eventos?.filter((x) => x.registro !== kx.id)).toMatchObject([
        { origem: 'lesao', tipo: 'encerramento', desfecho: 'cicatrizada', motivo: 'Epitelizada' },
        { origem: 'curativo', registro: k2.id, tipo: 'inativacao', motivo: 'Curativo do paciente errado' },
      ]);
      expect(await esc.lesoes(ctx(m!, m!.outroEst), { id: l.id })).toEqual([]);
    });
  });
});
