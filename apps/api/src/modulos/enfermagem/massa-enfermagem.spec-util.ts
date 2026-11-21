// Massa SINTÉTICA dos testes de integração das portas próprias do lote 02-05 (SAE, vacina e agência transfusional) no
// cliente de teste da onda 2 (f22_o2, banco cliente_f22_o2). Domínios compartilhados (sexo, categoria e caráter do
// atendimento, catálogos de enfermagem e de hemoterapia) são garantidos (lê ou inclui) e ficam; a massa do lote leva o
// prefixo L0205 e sai no fim (limpar). Ficam o estabelecimento e os usuários de teste, que a trilha (só inclusão)
// referencia. Nenhum dado de pessoa real.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';

export const CLIENTE = 'f22_o2';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
export const P = 'L0205';
const RAIZ = resolve(import.meta.dirname, '../../../../..');

/** O cliente de teste da onda existe (criado pelo integrador); se faltar, é criado aqui. */
export function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], { cwd: RAIZ, encoding: 'utf8' });
  if (!lista.split('\n').some((l) => l.split('\t')[1] === CLIENTE))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 2'], {
      cwd: RAIZ,
      stdio: 'ignore',
    });
}

export async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  if (l) return Number(l.id);
  try {
    return await e.inserir(ins, pi);
  } catch (x) {
    // Outro arquivo de teste incluiu o mesmo domínio compartilhado ao mesmo tempo: relê.
    const de = await e.uma<{ id: number }>(sel, p);
    if (de) return Number(de.id);
    throw x;
  }
}

export interface MassaEnfermagem {
  readonly marca: string;
  readonly est: number;
  readonly outroEst: number;
  /** Enfermeira (conta e profissional) e o segundo profissional da dupla checagem. */
  readonly usuario: number;
  readonly login: string;
  readonly usuario2: number;
  readonly login2: string;
  readonly profissional: number;
  readonly profissional2: number;
  readonly paciente: number;
  readonly atendimento: number;
  readonly atendimentoOutro: number;
  readonly prescricao: number;
  /** Dois itens de hemoterapia da prescrição vigente (concentrado de hemácias). */
  readonly itens: readonly [number, number];
  /** Bolsas no estoque liberadas (O positivo). */
  readonly bolsas: readonly [string, string];
  readonly horario: number;
}

export const contextoDe = (m: MassaEnfermagem, est = m.est, usuario = m.usuario): ContextoNucleo => ({
  cliente: CLIENTE,
  estabelecimento: est,
  usuario,
  correlacao: `t-${P}`,
});

export async function montarMassa(nucleo: NucleoProprio, marca: string = P, hemoterapia = true): Promise<MassaEnfermagem> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `${marca}-preparo` }, async (e) => {
    const agora = new Date();
    const g = (tabela: string, codigo: string, extra: Record<string, unknown> = {}, chave = 'codigo') => {
      const cols = [chave, ...Object.keys(extra), 'criado_em'];
      return garantir(
        e,
        `SELECT id FROM ${tabela} WHERE ${chave} = ?`,
        [codigo],
        `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        [codigo, ...Object.values(extra), agora],
      );
    };
    const est = (codigo: string) =>
      g('estabelecimento', codigo, { nome_fantasia: `ESTAB ${codigo} SINTETICO`, razao_social: `ESTAB ${codigo} SINTETICO` });
    const estId = await est(marca);
    const outroEst = await est(`${marca}B`);
    const sexo = await g('sexo', 'F', { codigo: 'feminino', descricao: 'Feminino' }, 'sigla');
    const usuarioDe = (login: string) =>
      g('usuario', login, { nome: `USUARIO SINTETICO ${login}`, tipo_conta: 'pessoa', dispensa_cpf: true }, 'login');
    const profDe = async (nome: string, usuario: number) => {
      const pf = await g('pessoa_fisica', nome, {}, 'nome');
      const pr = await garantir(e, 'SELECT id FROM profissional WHERE pessoa_fisica_id = ?', [pf], "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'assistencial', ?)", [pf, agora]);
      for (const x of [estId, outroEst])
        await garantir(e, 'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?', [usuario, x], "INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, '2026-01-01', ?)", [usuario, x, pr, agora]);
      return pr;
    };
    const login = `${marca.toLowerCase()}.enfermeira`;
    const login2 = `${marca.toLowerCase()}.conferente`;
    const usuario = await usuarioDe(login);
    const usuario2 = await usuarioDe(login2);
    const profissional = await profDe(`ENFERMEIRA ${marca}`, usuario);
    const profissional2 = await profDe(`CONFERENTE ${marca}`, usuario2);
    // Paciente e atendimentos (o do outro estabelecimento para as recusas).
    const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, sexo_id, data_nascimento, criado_em) VALUES (?, ?, ?, ?)', [`PACIENTE ${marca} SINTETICO`, sexo, '1970-05-01', agora]);
    const pront = Number((await e.uma<{ n: number }>('SELECT COALESCE(MAX(numero_prontuario), 970000) + 1 AS n FROM paciente'))?.n);
    const paciente = await e.inserir("INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, tipo_sanguineo, fator_rh, criado_em) VALUES (?, ?, 'O', 'positivo', ?)", [pf, pront, agora]);
    const categoria = await g('categoria_atendimento', `${marca}-INT`, { descricao: 'Internação sintética', tipo_base: 'internacao' });
    const carater = await g('carater_atendimento_tiss', '1', { descricao: 'Eletivo', versao_fonte: 'teste' }, 'codigo_tiss');
    const fonte = await g('fonte_pagadora', marca, { nome: `CONVENIO ${marca}`, tipo: 'particular' });
    // O setor do atendimento (o balanço hídrico da janela é aberto nele).
    const setor = await garantir(e, 'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?', [estId, `${marca}-SET`], "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'SETOR SINTETICO', 'assistencial', ?)", [estId, `${marca}-SET`, agora]);
    const atend = (x: number, numero: string) =>
      e.inserir("INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, setor_funcional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [x, numero, paciente, categoria, carater, fonte, profissional, x === estId ? setor : null, agora, agora]);
    const atendimento = await atend(estId, `${marca}-1`);
    const atendimentoOutro = await atend(outroEst, `${marca}-2`);
    // Catálogos de enfermagem e de vacina (rede).
    const escala = await g('escala_resultado_enfermagem', `${marca}-E1`, { descricao: 'Ponto 1', tipo_escala: `${marca}`, ponto: 1 });
    await g('diagnostico_enfermagem', `${marca}-D1`, { descricao: 'Diagnóstico sintético' });
    await g('caracteristica_diagnostico_enfermagem', `${marca}-C1`, { descricao: 'Característica sintética', tipo: 'caracteristica_definidora' });
    await g('caracteristica_diagnostico_enfermagem', `${marca}-F1`, { descricao: 'Fator sintético', tipo: 'fator_relacionado' });
    await g('resultado_enfermagem', `${marca}-R1`, { descricao: 'Resultado sintético', escala_resultado_enfermagem_id: escala });
    await g('intervencao_enfermagem', `${marca}-I1`, { descricao: 'Intervenção sintética' });
    await g('imunobiologico', `${marca}-VAC`, { descricao: 'Vacina sintética' });
    await g('via_de_uso', `${marca}-IM`, { descricao: 'Intramuscular sintética' });
    await g('regiao_corporal', `${marca}-DELT`, { descricao: 'Deltoide sintético', nivel: 'parte' });
    // Hemoterapia: catálogos da rede (só quando pedidos: os da rede são compartilhados).
    let prescricao = 0;
    let horario = 0;
    const itens: number[] = [];
    const bolsas: [string, string] = [`${marca}-B1`, `${marca}-B2`];
    if (hemoterapia) {
      const hemo = await g('hemocomponente', 'CH', { codigo: 'ch', descricao: 'Concentrado de hemácias', validade_dias: 42, faturavel: false }, 'sigla');
      for (const [c, d, h, prog] of [['programada', 'Programada', null, true], ['rotina', 'Rotina', 24, false], ['urgente', 'Urgente', 3, false], ['extrema_urgencia', 'Extrema urgência', 0, false]] as const)
        await g('tipo_transfusao', c, { descricao: d, prazo_atendimento_horas: h, exige_data_programada: prog });
      await g('tipo_reacao_transfusional', 'febril_nao_hemolitica', { descricao: 'Febril não hemolítica' });
      await g('motivo_cancelamento_requisicao_transfusao', 'outro', { descricao: 'Outro motivo' });
      const grupo = await g('grupo_sanguineo', 'O', { codigo: 'o', descricao: 'Grupo O' }, 'sigla');
      const rh = await g('fator_rh', '+', { codigo: 'positivo', descricao: 'Rh positivo' }, 'sinal');
      const empresa = await garantir(e, 'SELECT id FROM empresa_fornecedora WHERE cnpj = ?', ['99020500000100'], "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, ?, ?)", ['99020500000100', `HEMOCENTRO ${marca} SINTETICO`, agora]);
      const fornecedor = await garantir(e, 'SELECT id FROM servico_hemoterapia_fornecedor WHERE estabelecimento_id = ? AND codigo = ?', [estId, marca], 'INSERT INTO servico_hemoterapia_fornecedor (estabelecimento_id, empresa_fornecedora_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?, ?)', [estId, empresa, marca, `HEMOCENTRO ${marca}`, agora]);
      for (const numero of bolsas)
        await e.inserir("INSERT INTO bolsa_hemocomponente (estabelecimento_id, numero, hemocomponente_id, grupo_sanguineo_id, fator_rh_id, volume_ml, validade_em, recebida_em, servico_hemoterapia_fornecedor_id, situacao, criado_em) VALUES (?, ?, ?, ?, ?, 280, ?, ?, ?, 'liberada', ?)", [estId, numero, hemo, grupo, rh, new Date(Date.now() + 20 * 86_400_000), agora, fornecedor, agora]);
      // Prescrição vigente com dois itens de hemoterapia.
      const tipoItem = await g('tipo_item_prescricao', `${marca}-HEMO`, { descricao: 'Hemocomponente', categoria: 'hemocomponente' });
      const unidade = await g('unidade_prescricao', `${marca}-BOLSA`, { descricao: 'Bolsa', sigla: 'BOLS' });
      prescricao = await e.inserir("INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em) VALUES (?, ?, ?, ?, ?, 'vigente', ?, ?, ?, ?)", [estId, 1, paciente, atendimento, profissional, agora, new Date(Date.now() - 3_600_000), new Date(Date.now() + 23 * 3_600_000), agora]);
      for (const seq of [1, 2]) {
        const pi = await e.inserir('INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, inicio_em, lancamento_profissional_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)', [prescricao, seq, tipoItem, agora, profissional, agora]);
        await e.inserir('INSERT INTO prescricao_item_hemocomponente (prescricao_item_id, hemocomponente_id, quantidade, unidade_prescricao_id, indicacao_clinica, criado_em) VALUES (?, ?, 1, ?, ?, ?)', [pi, hemo, unidade, `Hemoglobina baixa sintética ${marca}`, agora]);
        itens.push(pi);
      }
      const situacao = await g('situacao_checagem', `${marca}-PEND`, { descricao: 'Pendente', categoria: 'pendente' });
      await g('situacao_checagem', `${marca}-ADM`, { descricao: 'Administrado', categoria: 'administrado' });
      // O grupo de ganho do hemocomponente no balanço hídrico (catálogo da rede).
      await g('grupo_balanco_hidrico', 'hemocomponente', { descricao: 'Hemocomponente', tipo: 'ganho' });
      horario = await e.inserir('INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id, previsto_em, situacao_checagem_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)', [estId, atendimento, prescricao, itens[0], new Date(Date.now() + 3_600_000), situacao, agora]);
      // Numerações de negócio do estabelecimento.
      for (const tipo of ['requisicao_transfusao', 'reacao_transfusional'])
        await garantir(e, 'SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [tipo, estId], 'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, ativo, criado_em, versao) VALUES (?, ?, ?, 1, 1, TRUE, ?, 1)', [estId, tipo, `${marca}-`, agora]);
    }
    return {
      marca,
      est: estId,
      outroEst,
      usuario,
      login,
      usuario2,
      login2,
      profissional,
      profissional2,
      paciente,
      atendimento,
      atendimentoOutro,
      prescricao,
      itens: [itens[0] ?? 0, itens[1] ?? 0],
      bolsas,
      horario,
    };
  });
}

/** Apaga a massa de movimento do lote (pacientes, atendimentos, prescrição, bolsas e o que as gravações deixaram). */
export async function limparMassa(nucleo: NucleoProprio, m: MassaEnfermagem | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `${m.marca}-limpeza` }, async (e) => {
    const ests = [m.est, m.outroEst];
    const emEst = 'estabelecimento_id IN (?, ?)';
    await e.executar(`DELETE FROM reacao_transfusional WHERE ${emEst}`, ests);
    await e.executar(`DELETE mt FROM monitoramento_transfusao mt JOIN ato_transfusional a ON a.id = mt.ato_transfusional_id WHERE a.${emEst}`, ests);
    await e.executar(`DELETE FROM ato_transfusional WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM amostra_pre_transfusional WHERE ${emEst}`, ests);
    await e.executar(`DELETE ri FROM requisicao_transfusao_item ri JOIN requisicao_transfusao r ON r.id = ri.requisicao_transfusao_id WHERE r.${emEst}`, ests);
    await e.executar(`DELETE FROM requisicao_transfusao WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM bolsa_hemocomponente WHERE ${emEst}`, ests);
    await e.executar(`DELETE l FROM balanco_lancamento l JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id WHERE b.${emEst}`, ests);
    await e.executar(`DELETE FROM balanco_hidrico_paciente WHERE ${emEst}`, ests);
    await e.executar(`DELETE x FROM horario_administracao_evento x JOIN horario_administracao h ON h.id = x.horario_administracao_id WHERE h.${emEst}`, ests);
    await e.executar(`DELETE FROM horario_administracao WHERE ${emEst}`, ests);
    await e.executar(`DELETE pih FROM prescricao_item_hemocomponente pih JOIN prescricao_item pi ON pi.id = pih.prescricao_item_id JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.${emEst}`, ests);
    await e.executar(`DELETE pi FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.${emEst}`, ests);
    await e.executar(`DELETE FROM prescricao WHERE ${emEst}`, ests);
    await e.executar(`DELETE x FROM diagnostico_enfermagem_paciente_caracteristica x JOIN diagnostico_enfermagem_paciente d ON d.id = x.diagnostico_enfermagem_paciente_id WHERE d.${emEst}`, ests);
    await e.executar(`DELETE x FROM avaliacao_resultado_enfermagem x JOIN diagnostico_enfermagem_paciente d ON d.id = x.diagnostico_enfermagem_paciente_id WHERE d.${emEst}`, ests);
    await e.executar(`DELETE x FROM plano_intervencao_enfermagem x JOIN diagnostico_enfermagem_paciente d ON d.id = x.diagnostico_enfermagem_paciente_id WHERE d.${emEst}`, ests);
    await e.executar(`DELETE FROM diagnostico_enfermagem_paciente WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM processo_enfermagem WHERE ${emEst}`, ests);
    await e.executar(`UPDATE vacina_aplicada SET vacina_aplicada_original_id = NULL WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM vacina_aplicada WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM atendimento WHERE ${emEst}`, ests);
    await e.executar('DELETE FROM paciente WHERE id = ?', [m.paciente]);
    await e.executar("DELETE FROM pessoa_fisica WHERE nome = ?", [`PACIENTE ${m.marca} SINTETICO`]);
    await e.executar(`DELETE FROM integracao_mensagem WHERE ${emEst}`, ests);
    await e.executar(`DELETE FROM idempotencia_operacao WHERE ${emEst}`, ests);
  });
}
