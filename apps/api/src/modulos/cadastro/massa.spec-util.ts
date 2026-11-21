// Massa SINTÉTICA dos testes de integração do lote 01-02 (cadastro e atendimento) no cliente de teste da onda 1
// (f22_o1, banco cliente_f22_o1). Domínios básicos compartilhados (sexo, tipos de telefone, endereço e documento, UF,
// município, CEP, conselho, categoria e caráter do atendimento) são garantidos (lê ou inclui) e ficam: outros lotes da
// onda usam o mesmo cliente. A massa do lote leva o prefixo F22L0102 e sai no fim (limpar). Nenhum dado de pessoa real.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import type { ContextoPorta } from './porta.js';
import type { ContextoGravacao } from './tipos.js';

export const CLIENTE_F22 = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
export const MARCA = 'F22L0102';
export const CODIGO_ESTAB = 'f22l0102';
export const CODIGO_ESTAB_OUTRO = 'f22l0102b';
export const CEP_TESTE = '30130010';

export interface Massa {
  readonly estabelecimento: number;
  readonly outroEstabelecimento: number;
  readonly usuario: number;
  readonly login: string;
  readonly conselho: number;
  readonly uf: number;
  readonly fonte: number;
  readonly profissional: number;
  readonly especialidade: number;
  readonly unidade: number;
  readonly centroCusto: number;
  readonly procedimento: number;
  readonly motivoCancelamento: number;
  readonly leitos: readonly number[];
  readonly cid: number;
  /** Profissional de enfermagem (COREN): não registra ato médico. */
  readonly enfermeira: number;
  /** Locais de atendimento do estabelecimento e do outro estabelecimento. */
  readonly local: number;
  readonly localOutro: number;
}

export async function garantir(
  e: Escritor,
  sel: string,
  p: readonly unknown[],
  ins: string,
  pi: readonly unknown[],
): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

/** CPF sintético válido (dígitos verificadores calculados) a partir de 9 dígitos. */
export function cpfSintetico(base9: string): string {
  const d = base9.split('').map(Number);
  const dv = (n: number[]) => {
    const s = n.reduce((t, x, i) => t + x * (n.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d);
  const d2 = dv([...d, d1]);
  return `${base9}${d1}${d2}`;
}

export function contextoPorta(m: Massa, correlacao = 'f22-0102'): ContextoPorta {
  return {
    cliente: CLIENTE_F22,
    estabelecimento: m.estabelecimento,
    usuario: m.usuario,
    correlacao,
    rede: 'rede-f22',
    hospital: CODIGO_ESTAB,
  };
}

let chave = 0;
export function contextoGravacao(m: Massa, extra: Partial<ContextoGravacao> = {}): ContextoGravacao {
  return {
    ...contextoPorta(m),
    chaveIdempotencia: `f22-0102-${Date.now()}-${++chave}`,
    login: m.login,
    estacao: 'TESTE',
    ...extra,
  };
}

/** Prepara os domínios e a massa do lote (idempotente). */
export async function prepararMassa(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-preparo' }, async (e) => {
    const agora = new Date();
    const est = (codigo: string) =>
      garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [codigo],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [codigo, `Hospital de teste ${codigo}`, `Hospital de teste ${codigo} (fictício)`, agora],
      );
    const estabelecimento = await est(CODIGO_ESTAB);
    const outroEstabelecimento = await est(CODIGO_ESTAB_OUTRO);
    const dominio = async (tabela: string, codigo: string, extra: Record<string, unknown> = {}) => {
      const cols = ['codigo', 'descricao', ...Object.keys(extra), 'criado_em'];
      return garantir(
        e,
        `SELECT id FROM ${tabela} WHERE codigo = ?`,
        [codigo],
        `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        [codigo, `${codigo} (teste)`, ...Object.values(extra), agora],
      );
    };
    await garantir(e, 'SELECT id FROM sexo WHERE sigla = ?', ['F'], 'INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)', ['feminino', 'Feminino', 'F', agora]);
    await garantir(e, 'SELECT id FROM sexo WHERE sigla = ?', ['M'], 'INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)', ['masculino', 'Masculino', 'M', agora]);
    for (const t of ['fixo', 'celular', 'recado']) await dominio('tipo_telefone', t);
    await dominio('tipo_endereco', 'residencial');
    await dominio('tipo_documento_identificacao', 'rg');
    const pais = await garantir(e, 'SELECT id FROM pais_referencia WHERE codigo_iso = ?', ['BR'], 'INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES (?, ?, ?)', ['BR', 'Brasil', agora]);
    const uf = await garantir(e, 'SELECT id FROM unidade_federativa WHERE sigla = ?', ['MG'], 'INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES (?, ?, ?, ?, ?)', ['31', 'MG', 'Minas Gerais', pais, agora]);
    const municipio = await garantir(e, 'SELECT id FROM municipio_ibge WHERE codigo_ibge = ?', ['3106200'], 'INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES (?, ?, ?, ?)', ['3106200', 'BELO HORIZONTE', uf, agora]);
    await garantir(e, 'SELECT id FROM logradouro_cep WHERE codigo_cep = ?', [CEP_TESTE], 'INSERT INTO logradouro_cep (codigo_cep, logradouro, municipio_ibge_id, unidade_federativa_id, criado_em) VALUES (?, ?, ?, ?, ?)', [CEP_TESTE, 'AVENIDA SINTETICA', municipio, uf, agora]);
    const conselho = await garantir(e, 'SELECT id FROM conselho_classe WHERE sigla = ?', ['CRM'], 'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)', ['06', 'CRM', 'Conselho Regional de Medicina', agora]);
    await garantir(e, "SELECT id FROM sequencia_negocio WHERE tipo = 'prontuario' AND estabelecimento_id IS NULL", [], "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em, versao) VALUES (NULL, 'prontuario', 900000, 1, TRUE, ?, 1)", [agora]);
    await garantir(e, "SELECT id FROM sequencia_negocio WHERE tipo = 'atendimento' AND estabelecimento_id = ?", [estabelecimento], "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, ativo, criado_em, versao) VALUES (?, 'atendimento', 'AT-', 1, 1, TRUE, ?, 1)", [estabelecimento, agora]);
    const login = 'f22.l0102.teste';
    const usuario = await garantir(e, 'SELECT id FROM usuario WHERE login = ?', [login], "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)", [login, `USUARIO ${MARCA}`, agora]);
    // Atendimento: domínios do produto e cadastros do estabelecimento de teste.
    await garantir(e, 'SELECT id FROM categoria_atendimento WHERE codigo = ?', ['consulta'], 'INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, ?, ?)', ['consulta', 'Consulta ambulatorial', 'ambulatorio', agora]);
    await garantir(e, 'SELECT id FROM categoria_atendimento WHERE codigo = ?', ['pa'], 'INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, ?, ?)', ['pa', 'Pronto atendimento', 'pronto_atendimento', agora]);
    for (const [c, d] of [['1', 'Eletivo'], ['2', 'Urgência ou emergência']] as const)
      await garantir(e, 'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?', [c], 'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)', [c, d, 'teste', agora]);
    const fonte = await garantir(e, 'SELECT id FROM fonte_pagadora WHERE codigo = ?', [MARCA], "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)", [MARCA, `CONVENIO ${MARCA}`, agora]);
    const especialidade = await garantir(e, 'SELECT id FROM especialidade_medica WHERE codigo = ?', [MARCA], 'INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, ?, ?)', [MARCA, `CLINICA ${MARCA}`, agora]);
    const unidade = await garantir(e, 'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?', [estabelecimento, 'AMB'], "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'AMB', ?, 'ambulatorio', ?)", [estabelecimento, `AMBULATORIO ${MARCA}`, agora]);
    const centroCusto = await garantir(e, 'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?', [estabelecimento, 'CC1'], "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, 'CC1', ?, '2026-01-01', ?)", [estabelecimento, `CENTRO ${MARCA}`, agora]);
    const grupo = await garantir(e, 'SELECT id FROM grupo_faturamento WHERE codigo = ?', [MARCA], "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'honorario', ?)", [MARCA, `GRUPO ${MARCA}`, agora]);
    const procedimento = await garantir(e, 'SELECT id FROM item_faturavel WHERE codigo = ?', [MARCA], "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)", [MARCA, `CONSULTA ${MARCA}`, grupo, agora]);
    const motivoCancelamento = await garantir(e, 'SELECT id FROM motivo_cancelamento_operacao WHERE codigo = ?', [MARCA], 'INSERT INTO motivo_cancelamento_operacao (codigo, descricao, criado_em) VALUES (?, ?, ?)', [MARCA, `ABERTO POR ENGANO ${MARCA}`, agora]);
    const pessoaProf = await garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [`MEDICA ${MARCA}`], 'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`MEDICA ${MARCA}`, agora]);
    const profissional = await garantir(e, 'SELECT id FROM profissional WHERE pessoa_fisica_id = ?', [pessoaProf], "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)", [pessoaProf, agora]);
    await garantir(e, 'SELECT id FROM inscricao_conselho WHERE profissional_id = ?', [profissional], "INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id, numero_inscricao, principal, criado_em) VALUES (?, 1, ?, ?, '990102', TRUE, ?)", [profissional, conselho, uf, agora]);
    await garantir(e, 'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?', [usuario, estabelecimento], "INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, '2026-01-01', ?)", [usuario, estabelecimento, profissional, agora]);
    const tipoLeito = await garantir(e, 'SELECT id FROM tipo_leito_observacao WHERE codigo = ?', ['maca'], "INSERT INTO tipo_leito_observacao (codigo, descricao, categoria, criado_em) VALUES ('maca', 'Maca', 'maca', ?)", [agora]);
    const localObs = await garantir(e, 'SELECT id FROM local_observacao WHERE estabelecimento_id = ? AND codigo = ?', [estabelecimento, 'OBS'], "INSERT INTO local_observacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'OBS', ?, ?)", [estabelecimento, `OBSERVACAO ${MARCA}`, agora]);
    const leitos: number[] = [];
    for (const c of ['M1', 'M2'])
      leitos.push(await garantir(e, 'SELECT id FROM leito_observacao WHERE local_observacao_id = ? AND codigo = ?', [localObs, c], 'INSERT INTO leito_observacao (estabelecimento_id, local_observacao_id, tipo_leito_observacao_id, codigo, criado_em) VALUES (?, ?, ?, ?, ?)', [estabelecimento, localObs, tipoLeito, c, agora]));
    const terminologia = await garantir(e, "SELECT id FROM terminologia WHERE codigo = 'cid10'", [], "INSERT INTO terminologia (codigo, nome, tipo, criado_em) VALUES ('cid10', 'CID-10', 'diagnostico', ?)", [agora]);
    const cid = await garantir(e, "SELECT id FROM termo_terminologia WHERE terminologia_id = ? AND codigo_termo = 'Z000'", [terminologia], "INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, 'Z000', 'Exame médico geral', ?)", [terminologia, agora]);
    const coren = await garantir(e, 'SELECT id FROM conselho_classe WHERE sigla = ?', ['COREN'], 'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)', ['07', 'COREN', 'Conselho Regional de Enfermagem', agora]);
    const pessoaEnf = await garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [`ENFERMEIRA ${MARCA}`], 'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`ENFERMEIRA ${MARCA}`, agora]);
    const enfermeira = await garantir(e, 'SELECT id FROM profissional WHERE pessoa_fisica_id = ?', [pessoaEnf], "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)", [pessoaEnf, agora]);
    await garantir(e, 'SELECT id FROM inscricao_conselho WHERE profissional_id = ?', [enfermeira], "INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id, numero_inscricao, principal, criado_em) VALUES (?, 1, ?, ?, '880102', TRUE, ?)", [enfermeira, coren, uf, agora]);
    const localDe = async (estab: number) => {
      const ponto = await garantir(e, 'SELECT id FROM ponto_recepcao WHERE estabelecimento_id = ? AND codigo = ?', [estab, MARCA], 'INSERT INTO ponto_recepcao (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)', [estab, MARCA, `RECEPCAO ${MARCA}`, agora]);
      return garantir(e, 'SELECT id FROM local_atendimento WHERE estabelecimento_id = ? AND codigo = ?', [estab, MARCA], 'INSERT INTO local_atendimento (estabelecimento_id, ponto_recepcao_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?, ?)', [estab, ponto, MARCA, `CONSULTORIO ${MARCA}`, agora]);
    };
    const local = await localDe(estabelecimento);
    const localOutro = await localDe(outroEstabelecimento);
    return { enfermeira, local, localOutro, cid, estabelecimento, outroEstabelecimento, usuario, login, conselho, uf, fonte, profissional, especialidade, unidade, centroCusto, procedimento, motivoCancelamento, leitos };
  });
}

/** Apaga a massa de pacientes e atendimentos do lote (os domínios compartilhados ficam). */
export async function limparMassa(nucleo: NucleoProprio, m: Massa | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-limpeza' }, async (e) => {
    const atend = 'SELECT id FROM atendimento WHERE estabelecimento_id IN (?, ?)';
    const ests = [m.estabelecimento, m.outroEstabelecimento];
    for (const t of ['atendimento_situacao_historico', 'atendimento_procedimento', 'cobertura_atendimento', 'atendimento_senha', 'cancelamento_atendimento', 'ocupacao_leito_observacao', 'chamada_painel', 'unificacao_cadastro_item'])
      await e.executar(
        t === 'unificacao_cadastro_item'
          ? `DELETE FROM ${t} WHERE tabela = 'atendimento' AND registro_id IN (${atend})`
          : `DELETE FROM ${t} WHERE atendimento_id IN (${atend})`,
        ests,
      );
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id IN (?, ?)', ests);
    const pessoas = `SELECT pf.id FROM pessoa_fisica pf WHERE pf.nome LIKE '%${MARCA}%' AND NOT EXISTS (SELECT 1 FROM profissional pr WHERE pr.pessoa_fisica_id = pf.id)`;
    const pacientes = `SELECT p.id FROM paciente p WHERE p.pessoa_fisica_id IN (${pessoas})`;
    await e.executar(`UPDATE suspeita_duplicidade SET situacao = 'aberto', decidido_por_usuario_id = NULL, decidido_em = NULL, unificacao_cadastro_id = NULL WHERE primeiro_paciente_id IN (${pacientes}) OR segundo_paciente_id IN (${pacientes})`);
    await e.executar(`DELETE i FROM unificacao_cadastro_item i JOIN unificacao_cadastro u ON u.id = i.unificacao_cadastro_id WHERE u.mantido_paciente_id IN (${pacientes}) OR u.absorvido_paciente_id IN (${pacientes})`);
    await e.executar(`DELETE FROM unificacao_cadastro WHERE mantido_paciente_id IN (${pacientes}) OR absorvido_paciente_id IN (${pacientes})`);
    await e.executar(`DELETE FROM suspeita_duplicidade WHERE primeiro_paciente_id IN (${pacientes}) OR segundo_paciente_id IN (${pacientes})`);
    await e.executar(`DELETE FROM paciente_versao WHERE paciente_id IN (${pacientes})`);
    for (const t of ['alergia_paciente', 'cobertura_paciente'])
      await e.executar(`DELETE FROM ${t} WHERE paciente_id IN (${pacientes})`);
    await e.executar(`UPDATE paciente SET sobrevivente_paciente_id = NULL, situacao = 'inativo' WHERE id IN (SELECT id FROM (${pacientes}) x)`);
    await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pessoas})`);
    for (const t of ['endereco_pessoa', 'telefone_pessoa', 'email_pessoa', 'documento_pessoa'])
      await e.executar(`DELETE FROM ${t} WHERE pessoa_fisica_id IN (${pessoas})`);
    await e.executar(`DELETE FROM pessoa_fisica WHERE id IN (SELECT id FROM (${pessoas}) x)`);
    await e.executar(`DELETE FROM solicitante_externo WHERE nome LIKE '%${MARCA}%'`);
    await e.executar("DELETE FROM idempotencia_operacao WHERE chave LIKE 'f22-0102-%'");
  });
}
