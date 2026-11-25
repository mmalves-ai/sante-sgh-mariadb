// Massa SINTÉTICA comum aos testes de integração das portas próprias da operadora (lote 02-09) no cliente f22_o2
// (banco cliente_f22_o2, criado pela obra da onda 2). Códigos "L0209" (nenhuma pessoa real). A massa de cadastro
// (estabelecimento, usuário, operadora, produto, contrato, beneficiário, domínios e numerações) é criada uma vez e
// reaproveitada (garantir); a massa de negócio de cada teste é apagada por `limparNegocio`.
import { randomUUID } from 'node:crypto';
import { cnpjSintetico } from '@sgh/dominio-operadora';
import { type ContextoNucleo, type Escritor, garantirSequencia, type NucleoProprio } from '@sgh/nucleo';
import type { ContextoPorta } from '../../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../../cadastro/tipos.js';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
export const P = 'L0209';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

export interface MassaOperadora {
  est: number;
  outroEst: number;
  usuario: number;
  operadora: number;
  produto: number;
  contrato: number;
  contratante: number;
  beneficiario: number;
  dependente: number;
  prestador: number;
  tipoGuia: number;
  origemGuia: number;
  critica: number;
  origemProtocolo: number;
  motivoContato: number;
  profissional: number;
  termo: number;
  motivoGlosa: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const dominio = (e: Escritor, tabela: string, codigo: string, extra: Record<string, unknown> = {}) => {
  const cols = ['codigo', 'descricao', ...Object.keys(extra), 'criado_em'];
  return garantir(
    e,
    `SELECT id FROM ${tabela} WHERE codigo = ?`,
    [codigo],
    `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    [codigo, `${codigo} SINTETICO`, ...Object.values(extra), new Date()],
  );
};

/** Cria (se faltar) a massa de cadastro do lote e devolve os ids. */
export async function prepararMassa(nucleo: NucleoProprio): Promise<MassaOperadora> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-09' }, async (e) => {
    const agora = new Date();
    const est = (codigo: string) =>
      garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [codigo],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
      );
    const m = {} as MassaOperadora;
    m.est = await est(P);
    m.outroEst = await est(`${P}B`);
    m.usuario = await garantir(
      e,
      'SELECT id FROM usuario WHERE login = ?',
      ['l0209.teste'],
      "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
      ['l0209.teste', 'USUARIO SINTETICO L0209', agora],
    );
    const cnpj = cnpjSintetico('020902090001');
    const pj = await garantir(
      e,
      'SELECT id FROM pessoa_juridica WHERE cnpj = ?',
      [cnpj],
      'INSERT INTO pessoa_juridica (cnpj, razao_social, nome_fantasia, criado_em) VALUES (?, ?, ?, ?)',
      [cnpj, 'OPERADORA SINTETICA L0209', 'OPERADORA L0209', agora],
    );
    m.operadora = await garantir(
      e,
      'SELECT id FROM operadora_saude WHERE registro_ans = ?',
      ['902090'],
      `INSERT INTO operadora_saude (pessoa_juridica_id, nome, registro_ans, modalidade, segmentacao, criado_em)
       VALUES (?, ?, '902090', 'medicina_grupo', 'medico_hospitalar', ?)`,
      [pj, 'OPERADORA SINTETICA L0209', agora],
    );
    await garantir(
      e,
      'SELECT id FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ?',
      [m.operadora, m.est],
      `INSERT INTO operadora_saude_estabelecimento (operadora_saude_id, estabelecimento_id, principal, vigencia_inicio,
         criado_em) VALUES (?, ?, TRUE, '2020-01-01', ?)`,
      [m.operadora, m.est, agora],
    );
    m.produto = await garantir(
      e,
      'SELECT id FROM produto_plano WHERE estabelecimento_id = ? AND codigo = ?',
      [m.est, `${P}-PROD`],
      `INSERT INTO produto_plano (estabelecimento_id, codigo, nome, numero_registro_ans, tipo_contratacao,
         abrangencia_geografica, vigencia_inicio, criado_em)
       VALUES (?, ?, 'PLANO SINTETICO L0209', '902090001', 'individual_familiar', 'nacional', '2020-01-01', ?)`,
      [m.est, `${P}-PROD`, agora],
    );
    const classif = await dominio(e, 'classificacao_plano', `${P}-CLA`, {
      tipo_contratacao: 'individual_familiar',
    });
    const titular = await garantir(
      e,
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      ['TITULAR SINTETICO L0209'],
      "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, '1980-05-10', ?)",
      ['TITULAR SINTETICO L0209', agora],
    );
    const dep = await garantir(
      e,
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      ['DEPENDENTE SINTETICO L0209'],
      "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, '2010-03-01', ?)",
      ['DEPENDENTE SINTETICO L0209', agora],
    );
    m.contratante = await garantir(
      e,
      'SELECT id FROM contratante_plano WHERE operadora_saude_id = ? AND codigo = ?',
      [m.operadora, `${P}-CT`],
      `INSERT INTO contratante_plano (operadora_saude_id, codigo, tipo_pessoa, pessoa_fisica_id, natureza, criado_em)
       VALUES (?, ?, 'fisica', ?, 'pessoa_fisica', ?)`,
      [m.operadora, `${P}-CT`, titular, agora],
    );
    m.contrato = await garantir(
      e,
      'SELECT id FROM contrato_plano WHERE estabelecimento_id = ? AND numero = ?',
      [m.est, `${P}-K1`],
      `INSERT INTO contrato_plano (estabelecimento_id, operadora_saude_id, numero, contratante_plano_id,
         classificacao_plano_id, produto_plano_id, inicio_vigencia, dia_vencimento, forma_reajuste, mes_reajuste, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, '2024-01-01', 10, 'ipca', 5, ?)`,
      [m.est, m.operadora, `${P}-K1`, m.contratante, classif, m.produto, agora],
    );
    const plano = await garantir(
      e,
      'SELECT id FROM plano_comercializado WHERE estabelecimento_id = ? AND codigo = ?',
      [m.est, `${P}-PC`],
      `INSERT INTO plano_comercializado (estabelecimento_id, produto_plano_id, codigo, nome_comercial, vigencia_inicio,
         criado_em) VALUES (?, ?, ?, 'PLANO COMERCIAL L0209', '2020-01-01', ?)`,
      [m.est, m.produto, `${P}-PC`, agora],
    );
    m.beneficiario = await garantir(
      e,
      'SELECT id FROM beneficiario_plano WHERE matricula = ?',
      [`${P}0001`],
      `INSERT INTO beneficiario_plano (contrato_plano_id, plano_comercializado_id, pessoa_fisica_id, tipo, matricula,
         data_adesao, inicio_vigencia, criado_em) VALUES (?, ?, ?, 'titular', ?, '2024-01-01', '2024-01-01', ?)`,
      [m.contrato, plano, titular, `${P}0001`, agora],
    );
    const grau = await dominio(e, 'grau_parentesco_dependente', `${P}-FIL`, {
      tipo_beneficiario: 'dependente',
    }).catch(() => null);
    m.dependente = grau
      ? await garantir(
          e,
          'SELECT id FROM beneficiario_plano WHERE matricula = ?',
          [`${P}0002`],
          `INSERT INTO beneficiario_plano (contrato_plano_id, plano_comercializado_id, pessoa_fisica_id, tipo,
             titular_beneficiario_plano_id, grau_parentesco_dependente_id, matricula, data_adesao, inicio_vigencia, criado_em)
           VALUES (?, ?, ?, 'dependente', ?, ?, ?, '2024-01-01', '2024-01-01', ?)`,
          [m.contrato, plano, dep, m.beneficiario, grau, `${P}0002`, agora],
        )
      : 0;
    const forma = await dominio(e, 'forma_cobranca_plano', `${P}-BOL`, { meio: 'boleto' });
    await garantir(
      e,
      'SELECT id FROM contrato_forma_cobranca WHERE contrato_plano_id = ?',
      [m.contrato],
      `INSERT INTO contrato_forma_cobranca (contrato_plano_id, forma_cobranca_plano_id, dia_vencimento, vigencia_inicio,
         criado_em) VALUES (?, ?, 10, '2024-01-01', ?)`,
      [m.contrato, forma, agora],
    );
    for (const t of ['mensalidade', 'avulsa', 'coparticipacao'])
      await garantir(
        e,
        'SELECT id FROM tipo_lancamento_fatura WHERE codigo = ?',
        [t],
        "INSERT INTO tipo_lancamento_fatura (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'debito', ?)",
        [t, `${t} sintetico`, agora],
      );
    const tipoPrest = await dominio(e, 'tipo_prestador_rede', `${P}-TP`);
    const natPrest = await dominio(e, 'natureza_prestador_rede', `${P}-NP`);
    const cnpjPrest = cnpjSintetico('020902090002');
    // Endereço do prestador: o catálogo do IBGE do cliente de teste pode estar vazio; país, UF e município sintéticos.
    const pais = await garantir(
      e,
      'SELECT id FROM pais_referencia WHERE codigo_iso = ?',
      ['BR'],
      'INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES (?, ?, ?)',
      ['BR', 'Brasil', agora],
    );
    const ufSp = await garantir(
      e,
      'SELECT id FROM unidade_federativa WHERE sigla = ?',
      ['SP'],
      'INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES (?, ?, ?, ?, ?)',
      ['35', 'SP', 'São Paulo', pais, agora],
    );
    const munSp = await garantir(
      e,
      'SELECT id FROM municipio_ibge WHERE codigo_ibge = ?',
      ['3550308'],
      'INSERT INTO municipio_ibge (codigo_ibge, nome, unidade_federativa_id, criado_em) VALUES (?, ?, ?, ?)',
      ['3550308', 'SAO PAULO', ufSp, agora],
    );
    m.prestador = await garantir(
      e,
      'SELECT id FROM prestador_rede WHERE estabelecimento_id = ? AND codigo = ?',
      [m.est, `${P}-PR`],
      `INSERT INTO prestador_rede (estabelecimento_id, codigo, pessoa, cnpj, nome, tipo_prestador_rede_id,
         natureza_prestador_rede_id, classificacao, municipio_ibge_id, unidade_federativa_id, credenciado_em, situacao_em,
         criado_em)
       VALUES (?, ?, 'juridica', ?, 'CLINICA SINTETICA L0209', ?, ?, 'clinica_ambulatorial',
         ?, ?, '2024-01-01', '2024-01-01', ?)`,
      [m.est, `${P}-PR`, cnpjPrest, tipoPrest, natPrest, munSp, ufSp, agora],
    );
    m.tipoGuia = await dominio(e, 'tipo_guia_plano', 'sp_sadt');
    m.origemGuia = await dominio(e, 'origem_guia_plano', `${P}-OG`, { canal: 'portal' });
    m.critica = await dominio(e, 'motivo_decisao_autorizacao', `${P}-MD`, { aplica_a: 'todos' });
    await dominio(e, 'motivo_cancelamento_guia_plano', 'outros', { aplica_a: 'todos' });
    m.origemProtocolo = await dominio(e, 'origem_protocolo', `${P}-OP`);
    m.motivoContato = await dominio(e, 'motivo_contato_beneficiario', `${P}-MC`, {
      tipo_contato: 'solicitacao',
    });
    await dominio(e, 'motivo_movimento_cadastral', `${P}-MOV`, {
      tipo_movimento: 'inclusao',
      codigo_ans: '1',
    });
    const pfAud = await garantir(
      e,
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      ['AUDITOR SINTETICO L0209'],
      'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
      ['AUDITOR SINTETICO L0209', agora],
    );
    m.profissional = await garantir(
      e,
      'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
      [pfAud],
      "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'assistencial', ?)",
      [pfAud, agora],
    );
    // Conselho da terminologia TISS (o cliente de teste novo não tem a carga da terminologia).
    await garantir(
      e,
      'SELECT id FROM conselho_classe ORDER BY id LIMIT 1',
      [],
      "INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES ('06', 'CRM', 'CONSELHO REGIONAL DE MEDICINA', ?)",
      [agora],
    );
    const crm = await e.uma<{ id: number }>('SELECT id FROM conselho_classe ORDER BY id LIMIT 1');
    const uf = await e.uma<{ id: number }>('SELECT id FROM unidade_federativa ORDER BY id LIMIT 1');
    if (crm && uf)
      await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ?',
        [m.profissional],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, criado_em) VALUES (?, 1, ?, ?, '902090', ?)`,
        [m.profissional, crm.id, uf.id, agora],
      );
    const term = await garantir(
      e,
      'SELECT id FROM terminologia WHERE codigo = ?',
      [`${P}-TUSS`],
      "INSERT INTO terminologia (codigo, nome, tipo, criado_em) VALUES (?, 'TERMINOLOGIA SINTETICA', 'procedimento', ?)",
      [`${P}-TUSS`, agora],
    );
    m.termo = await garantir(
      e,
      'SELECT id FROM termo_terminologia WHERE terminologia_id = ? AND codigo_termo = ?',
      [term, '90209001'],
      "INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, '90209001', 'PROCEDIMENTO SINTETICO', ?)",
      [term, agora],
    );
    // Caráter "eletivo" da terminologia TISS (o cliente de teste novo não tem a carga da terminologia).
    await garantir(
      e,
      "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = '1'",
      [],
      "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('1', 'ELETIVO', 'sintetico', ?)",
      [agora],
    );
    m.motivoGlosa = await garantir(
      e,
      'SELECT id FROM motivo_glosa WHERE codigo_tuss = ?',
      ['L209'],
      `INSERT INTO motivo_glosa (codigo_tuss, descricao, vigencia_inicio, versao_fonte, criado_em)
       VALUES ('L209', 'MOTIVO SINTETICO', '2020-01-01', 'sintetico', ?)`,
      [agora],
    );
    const carimbo = { usuario: m.usuario, agora };
    for (const tipo of [
      'fatura_plano',
      'protocolo_autorizacao',
      'senha_autorizacao',
      'guia_autorizacao',
      'junta',
      'protocolo_conta',
      'recurso_glosa',
      'protocolo_atendimento',
    ])
      await garantirSequencia(e, { tipo, estabelecimento: m.est, prefixo: `${P}-` }, carimbo);
    return m;
  });
}

/** Apaga a massa de negócio dos testes do lote (fica o cadastro, que a trilha referencia). */
export async function limparNegocio(nucleo: NucleoProprio, m: MassaOperadora): Promise<void> {
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-09' }, async (e) => {
    const est = [m.est, m.outroEst];
    await e.executar(
      'DELETE i FROM fatura_plano_item i JOIN fatura_plano f ON f.id = i.fatura_plano_id WHERE f.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM fatura_plano WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar('DELETE FROM reajuste_contrato_plano WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar(
      'DELETE k FROM complemento_sib_beneficiario k JOIN beneficiario_plano b ON b.id = k.beneficiario_plano_id JOIN contrato_plano c ON c.id = b.contrato_plano_id WHERE c.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar(
      'DELETE r FROM envio_ans_retorno r JOIN envio_ans x ON x.id = r.envio_ans_id WHERE x.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar(
      'DELETE i FROM envio_ans_item i JOIN envio_ans x ON x.id = i.envio_ans_id WHERE x.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM envio_ans WHERE estabelecimento_id IN (?, ?) ORDER BY id DESC', est);
    await e.executar('DELETE FROM junta_divergencia_tecnica WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar(
      'DELETE h FROM pedido_autorizacao_plano_historico h JOIN pedido_autorizacao_plano p ON p.id = h.pedido_autorizacao_plano_id WHERE p.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar(
      'DELETE i FROM pedido_autorizacao_plano_item i JOIN pedido_autorizacao_plano p ON p.id = i.pedido_autorizacao_plano_id WHERE p.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM pedido_autorizacao_plano WHERE estabelecimento_id IN (?, ?)', est);
    // C1-100: críticas, pareceres da auditoria, demonstrativos emitidos e regras de crítica (filhos do lote e do auditor).
    await e.executar(
      'DELETE c FROM critica_conta_recebida c JOIN guia_conta_recebida x ON x.id = c.guia_conta_recebida_id WHERE x.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar(
      'DELETE a FROM auditoria_conta_recebida a JOIN guia_conta_recebida x ON x.id = a.guia_conta_recebida_id WHERE x.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM demonstrativo_analise_emitido WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar('DELETE FROM regra_critica_conta WHERE operadora_saude_id = ?', [m.operadora]);
    await e.executar('DELETE FROM auditor_plano WHERE operadora_saude_id = ?', [m.operadora]);
    await e.executar(
      'DELETE i FROM recurso_glosa_recebido_item i JOIN recurso_glosa_recebido r ON r.id = i.recurso_glosa_recebido_id WHERE r.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM recurso_glosa_recebido WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar(
      'DELETE g FROM glosa_conta_recebida g JOIN guia_conta_recebida x ON x.id = g.guia_conta_recebida_id WHERE x.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar(
      'DELETE i FROM guia_conta_recebida_item i JOIN guia_conta_recebida x ON x.id = i.guia_conta_recebida_id WHERE x.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM guia_conta_recebida WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar('DELETE FROM lote_conta_recebida WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar(
      'DELETE r FROM protocolo_beneficiario_resposta r JOIN protocolo_beneficiario p ON p.id = r.protocolo_beneficiario_id WHERE p.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar(
      'DELETE a FROM protocolo_beneficiario_andamento a JOIN protocolo_beneficiario p ON p.id = a.protocolo_beneficiario_id WHERE p.estabelecimento_id IN (?, ?)',
      est,
    );
    await e.executar('DELETE FROM protocolo_beneficiario WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar('DELETE FROM consulta_elegibilidade_recebida WHERE estabelecimento_id IN (?, ?)', est);
    await e.executar('DELETE FROM conta_portal_prestador WHERE operadora_saude_id = ?', [m.operadora]);
    await e.executar('UPDATE beneficiario_plano SET codigo_controle_ans = NULL WHERE contrato_plano_id = ?', [
      m.contrato,
    ]);
  });
}

/** O contexto da porta (sessão) no estabelecimento dado. */
export function contexto(
  m: MassaOperadora,
  est = m.est,
): ContextoPorta & ContextoNucleo & { readonly chaveIdempotencia: string } {
  return {
    chaveIdempotencia: `t0209:${randomUUID()}`,
    cliente: CLIENTE,
    estabelecimento: est,
    usuario: m.usuario,
    correlacao: `t0209-${Date.now()}`,
    rede: 'rede-teste',
    hospital: est === m.est ? P : `${P}B`,
  };
}

/** A linha da trilha da tela (como o controller monta). */
export function trilhaTela(m: MassaOperadora, tabela: string, evento: string, est = m.est) {
  return (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: est,
    usuario: m.usuario,
    acao: 'operacao',
    entidade: tabela,
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.teste', operacao: evento, estacao: 'teste-02-09' },
    correlacao: `t0209-${evento}`.slice(0, 64),
  });
}

/** O código do problema de um erro de operação (ou null). */
export function codigoDe(e: unknown): string | null {
  const p = (e as { problema?: { codigo?: unknown } } | null)?.problema;
  return p ? String(p.codigo ?? '') : null;
}
