// Massa SINTÉTICA da manutenção para a integração com o MariaDB (cliente f22_o3, onda 3): um par de estabelecimentos
// "L0303M<marca>" (o segundo para a recusa de outro estabelecimento) por arquivo de teste, dois usuários, a unidade, o
// setor funcional com o centro de custo, um centro sem setor, o recurso de agenda, o fornecedor e o curso. Nenhuma
// pessoa real. A limpeza apaga o que a integração gravou nos estabelecimentos da massa (a trilha de auditoria fica: é só
// de inclusão).
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';

export const CLIENTE_MAN = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
export const SEM_BANCO_MAN = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
export const P_MAN = 'L0303M';

export interface MassaManutencao {
  readonly nucleo: NucleoProprio;
  readonly marca: string;
  readonly est: number;
  readonly outro: number;
  readonly usuario: number;
  readonly loginUsuario: string;
  readonly avisado: number;
  readonly loginAvisado: string;
  /** Usuário desligado da unidade (usuario_unidade excluído): não pode receber o aviso do setor. */
  readonly desligado: number;
  readonly unidade: number;
  readonly setor: number;
  readonly centro: number;
  readonly centroSemSetor: number;
  readonly recurso: number;
  readonly fornecedor: number;
  readonly curso: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

/** Apaga o que a integração gravou nos estabelecimentos da massa. */
export async function limparGravacoes(e: Escritor, ests: readonly number[]): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  // Tecnovigilância, curso por modelo e ciclo de vida (dependem da OS e do equipamento): apagados antes deles.
  await e.executar(
    `DELETE v FROM queixa_tecnica_produto_evento v JOIN queixa_tecnica_produto k ON k.id = v.queixa_tecnica_produto_id WHERE k.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM queixa_tecnica_produto WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE q FROM alerta_sanitario_equipamento q JOIN alerta_sanitario a ON a.id = q.alerta_sanitario_id WHERE a.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM alerta_sanitario WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM modelo_equipamento_curso WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE v FROM evento_ciclo_equipamento v JOIN equipamento_saude q ON q.id = v.equipamento_saude_id WHERE q.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM notificacao_usuario WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM execucao_preventiva WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id IN (${em}) AND chave_armazenamento LIKE 'teste-l0303m/%'`, ests);
  await e.executar(
    `DELETE i FROM ordem_servico_manutencao_item i JOIN ordem_servico_manutencao o ON o.id = i.ordem_servico_manutencao_id WHERE o.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE v FROM ordem_servico_manutencao_evento v JOIN ordem_servico_manutencao o ON o.id = v.ordem_servico_manutencao_id WHERE o.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM ordem_servico_manutencao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE pe FROM plano_preventivo_equipamento pe JOIN plano_preventivo p ON p.id = pe.plano_preventivo_id WHERE p.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM plano_preventivo WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE i FROM contrato_servico_terceirizado_item i JOIN contrato_servico_terceirizado c ON c.id = i.contrato_servico_terceirizado_id WHERE c.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM contrato_servico_terceirizado WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM contrato_fornecedor WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM oficina_manutencao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM equipamento_saude WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar("DELETE FROM fabricante WHERE nome LIKE 'L0303M%'", []);
}

/** `marca`: um par de estabelecimentos por arquivo de teste (os arquivos rodam em paralelo). */
export async function prepararMassaManutencao(marca: string): Promise<MassaManutencao> {
  const nucleo = new NucleoProprio();
  const ids = await nucleo.escrever({ cliente: CLIENTE_MAN, correlacao: `preparo-teste-03-03-${marca}` }, async (e) => {
    const agora = new Date();
    const estab = (cod: string) =>
      garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [cod],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [cod, 'ESTAB SINTETICO MANUTENCAO', 'ESTAB SINTETICO MANUTENCAO', agora],
      );
    const est = await estab(`${P_MAN}${marca}`);
    const outro = await estab(`${P_MAN}${marca}X`);
    const usuario = (login: string) =>
      garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [login],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
      );
    const loginUsuario = `l0303m${marca.toLowerCase()}.tecnico`;
    const loginAvisado = `l0303m${marca.toLowerCase()}.setor`;
    const u = await usuario(loginUsuario);
    const avisado = await usuario(loginAvisado);
    const unidade = await garantir(
      e,
      'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
      [est, 'U1'],
      "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'U1', 'UNIDADE SINTETICA', 'internacao', ?)",
      [est, agora],
    );
    await garantir(
      e,
      'SELECT id FROM usuario_unidade WHERE usuario_id = ? AND unidade_assistencial_id = ?',
      [avisado, unidade],
      'INSERT INTO usuario_unidade (usuario_id, unidade_assistencial_id, criado_em) VALUES (?, ?, ?)',
      [avisado, unidade, agora],
    );
    const desligado = await usuario(`l0303m${marca.toLowerCase()}.desligado`);
    await garantir(
      e,
      'SELECT id FROM usuario_unidade WHERE usuario_id = ? AND unidade_assistencial_id = ?',
      [desligado, unidade],
      'INSERT INTO usuario_unidade (usuario_id, unidade_assistencial_id, criado_em, excluido_em) VALUES (?, ?, ?, ?)',
      [desligado, unidade, agora, agora],
    );
    const setor = await garantir(
      e,
      'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
      [est, 'S1'],
      "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, unidade_assistencial_id, criado_em) VALUES (?, 'S1', 'UTI SINTETICA', 'assistencial', ?, ?)",
      [est, unidade, agora],
    );
    const centro = (cod: string, setorId: number | null) =>
      garantir(
        e,
        'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
        [est, cod],
        'INSERT INTO centro_custo (estabelecimento_id, codigo, nome, setor_funcional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [est, cod, `CENTRO SINTETICO ${cod}`, setorId, '2020-01-01', agora],
      );
    const c1 = await centro('930301', setor);
    await e.executar('UPDATE setor_funcional SET centro_custo_id = ? WHERE id = ?', [c1, setor]);
    const recurso = await garantir(
      e,
      'SELECT id FROM recurso_agendavel WHERE estabelecimento_id = ? AND codigo = ?',
      [est, 'R1'],
      "INSERT INTO recurso_agendavel (estabelecimento_id, codigo, descricao, tipo, setor_funcional_id, criado_em) VALUES (?, 'R1', 'TOMOGRAFO SINTETICO', 'equipamento', ?, ?)",
      [est, setor, agora],
    );
    const fornecedor = await garantir(
      e,
      'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
      ['99030300000100'],
      "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, nome_fantasia, criado_em) VALUES ('juridica', ?, 'ENGENHARIA CLINICA SINTETICA L0303', 'ENG SINT L0303', ?)",
      ['99030300000100', agora],
    );
    const curso = await garantir(
      e,
      'SELECT id FROM curso WHERE codigo = ?',
      ['L0303M-OPER'],
      "INSERT INTO curso (codigo, nome, tipo, carga_minutos, validade_meses, criado_em) VALUES ('L0303M-OPER', 'OPERACAO SINTETICA DO MONITOR', 'capacitacao', 120, 24, ?)",
      [agora],
    );
    const r = {
      est,
      outro,
      usuario: u,
      loginUsuario,
      avisado,
      loginAvisado,
      desligado,
      unidade,
      setor,
      centro: c1,
      centroSemSetor: await centro('930302', null),
      recurso,
      fornecedor,
      curso,
    };
    await limparGravacoes(e, [est, outro]);
    return r;
  });
  return { nucleo, marca, ...ids };
}

export async function encerrarMassaManutencao(m: MassaManutencao | null): Promise<void> {
  if (!m) return;
  await m.nucleo
    .escrever({ cliente: CLIENTE_MAN, correlacao: `limpeza-teste-03-03-${m.marca}` }, (e) => limparGravacoes(e, [m.est, m.outro]))
    .catch(() => undefined);
  await m.nucleo.encerrar();
}

/** O contexto da sessão no estabelecimento da massa (ou no outro). */
export function contextoMan(m: MassaManutencao, est = m.est): ContextoNucleo {
  return { cliente: CLIENTE_MAN, estabelecimento: est, usuario: m.usuario, correlacao: `int-0303-${randomUUID().slice(0, 8)}` };
}

/** A linha da trilha da tela (o Executor a leva para a trilha de auditoria). */
export function trilhaMan(m: MassaManutencao, tabela: string, id: number | null = null): TrilhaDaGravacao {
  return {
    estabelecimento: m.est,
    usuario: m.usuario,
    acao: 'operacao',
    entidade: tabela,
    entidadeId: id,
    dadosDepois: { recurso: 'manutencao' },
    correlacao: 'int-0303-man',
  };
}

/** Escrita direta de massa no banco do cliente de teste (o que a tela não grava, como o 2º alvo de um plano). */
export function escreverBanco(m: MassaManutencao, sql: string, p: unknown[]): Promise<number> {
  return m.nucleo.escrever({ cliente: CLIENTE_MAN, correlacao: 'int-0303-massa' }, (e) => e.inserir(sql, p));
}

/** Um arquivo sintético (laudo) no estabelecimento dado; a limpeza o apaga pela chave `teste-l0303m/`. */
export function criarArquivoSintetico(m: MassaManutencao, est: number): Promise<number> {
  return escreverBanco(
    m,
    `INSERT INTO arquivo (estabelecimento_id, entidade, finalidade, nome_original, tipo_mime, tamanho_bytes, hash_sha256,
       chave_armazenamento, criado_em) VALUES (?, 'execucao_preventiva', 'laudo', 'laudo-sintetico.pdf', 'application/pdf', 10, ?, ?, ?)`,
    [est, '0'.repeat(64), `teste-l0303m/${randomUUID()}`, new Date()],
  );
}

/** Leitura de conferência no banco do cliente de teste. */
export function lerBanco<T extends Record<string, unknown>>(m: MassaManutencao, sql: string, p: unknown[]): Promise<T | null> {
  return m.nucleo.lerSomente({ cliente: CLIENTE_MAN, correlacao: 'int-0303-conferir' }, (l) => l.uma<T>(sql, p));
}
