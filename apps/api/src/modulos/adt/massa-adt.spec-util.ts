// Massa SINTÉTICA da integração da internação e do NIR (lote 03-01) no cliente f22_o3 (onda 3): códigos "L0301"
// (nenhuma pessoa real). Um par de estabelecimentos por arquivo (os arquivos rodam em paralelo): o da sessão, com
// bloco, acomodação e três leitos, e outro com um leito (recusa por outro estabelecimento). Os cadastros da rede
// (situações, motivos, caráter, modalidade, tipos de limpeza) são garantidos pelo código e ficam para a próxima rodada.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { ContextoAdt } from './porta.js';

export const CLIENTE_ADT = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
export const SEM_BANCO_ADT = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

export interface MassaAdt {
  readonly nucleo: NucleoProprio;
  readonly marca: string;
  readonly est: number;
  readonly outro: number;
  readonly usuario: number;
  readonly login: string;
  readonly leitos: readonly string[];
  readonly leitoOutro: string;
  readonly pacientes: readonly number[];
  readonly medico: number;
  readonly convenio: number;
  readonly especialidade: number;
  readonly carater: number;
  readonly caraterTiss: number;
  readonly categoria: number;
  readonly modalidade: number;
  readonly motivoSaida: number;
  readonly motivoCancelamentoAlta: number;
  readonly motivoExclusao: number;
  readonly motivoTroca: number;
  readonly cid: number;
  readonly procedimento: number;
  readonly tipoLimpeza: number;
  readonly setor: number;
  readonly setorNome: string;
  readonly central: string;
  readonly situacaoSolicitado: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

/** Apaga o que a integração gravou nos estabelecimentos da massa (ordem das chaves). */
export async function limparGravacoesAdt(e: Escritor, ests: readonly number[]): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  const leitos = `SELECT id FROM leito_hospitalar WHERE estabelecimento_id IN (${em})`;
  const internacoes = `SELECT id FROM internacao WHERE estabelecimento_id IN (${em})`;
  await e.executar(`DELETE FROM periodo_situacao_leito WHERE leito_hospitalar_id IN (${leitos})`, ests);
  await e.executar(`DELETE FROM inspecao_limpeza WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE l FROM solicitacao_limpeza_local l JOIN solicitacao_limpeza s ON s.id = l.solicitacao_limpeza_id WHERE s.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM solicitacao_limpeza WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM cancelamento_alta WHERE internacao_id IN (${internacoes})`, ests);
  await e.executar(`DELETE FROM alta_hospitalar WHERE internacao_id IN (${internacoes})`, ests);
  await e.executar(`DELETE FROM alta_medica WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM transferencia_leito WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM cancelamento_internacao WHERE internacao_id IN (${internacoes})`, ests);
  await e.executar(`DELETE FROM barreira_alta WHERE internacao_id IN (${internacoes})`, ests);
  await e.executar(`DELETE FROM previsao_alta WHERE internacao_id IN (${internacoes})`, ests);
  await e.executar(`UPDATE solicitacao_regulacao SET solicitacao_anterior_id = NULL WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM solicitacao_regulacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM reserva_leito WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`UPDATE internacao SET pedido_leito_id = NULL WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`UPDATE pedido_leito SET internacao_id = NULL, reserva_leito_id = NULL WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM pedido_leito WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`UPDATE ocupacao_leito SET anterior_ocupacao_leito_id = NULL WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM ocupacao_leito WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM ocorrencia_arquivo_prontuario WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM movimento_prontuario WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM volume_prontuario WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM atributo_categoria_acomodacao WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM integracao_mensagem WHERE estabelecimento_id IN (${em})`, ests);
}

export async function prepararMassaAdt(marca: string): Promise<MassaAdt> {
  const nucleo = new NucleoProprio();
  const P = `L0301${marca}`;
  const ids = await nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: `preparo-teste-03-01-${marca}` }, async (e) => {
    const agora = new Date();
    const g = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
    const cad = (tabela: string, codigo: string, colunas: Record<string, unknown>) => {
      if (!/^[a-z_]+$/.test(tabela) || !Object.keys(colunas).every((k) => /^[a-z_]+$/.test(k))) throw new Error('nome inválido');
      const ks = Object.keys(colunas);
      return g(
        `SELECT id FROM ${tabela} WHERE codigo = ?`,
        [codigo],
        `INSERT INTO ${tabela} (codigo, ${ks.join(', ')}, criado_em) VALUES (?, ${ks.map(() => '?').join(', ')}, ?)`,
        [codigo, ...ks.map((k) => colunas[k]), agora],
      );
    };
    const estab = (cod: string) =>
      g('SELECT id FROM estabelecimento WHERE codigo = ?', [cod], 'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)', [
        cod,
        'ESTAB SINTETICO INTERNACAO',
        'ESTAB SINTETICO INTERNACAO',
        agora,
      ]);
    const est = await estab(P);
    const outro = await estab(`${P}X`);
    const login = `l0301${marca.toLowerCase()}.teste`;
    const usuario = await g('SELECT id FROM usuario WHERE login = ?', [login], "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)", [
      login,
      `USUARIO SINTETICO ${P}`,
      agora,
    ]);
    const sit = async (base: string, permite: boolean) => cad('situacao_leito', `${P}-${base}`.slice(0, 30), { descricao: `${base.toUpperCase()} ${P}`, situacao_base: base, permite_ocupacao: permite });
    const livre = await sit('livre', true);
    await sit('ocupado', false);
    await sit('higienizacao', false);
    await sit('bloqueado', false);
    await sit('interditado', true);
    const categoriaAcomodacao = await cad('categoria_acomodacao', `${P}-ENF`, { descricao: `ENFERMARIA ${P}`, tipo: 'enfermaria' });
    const mapa = async (estId: number, codigos: readonly string[]) => {
      const ua = await g(
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [estId, 'UA1'],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'UA1', 'INTERNACAO SINTETICA', 'internacao', ?)",
        [estId, agora],
      );
      const ui = await g(
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [estId, 'UI1'],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, 'UI1', 'ENFERMARIA SINTETICA', 'enfermaria', ?)",
        [estId, ua, agora],
      );
      const bloco = await g(
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [estId, 'B1'],
        "INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'B1', 'BLOCO SINTETICO', ?)",
        [estId, agora],
      );
      const ac = await g(
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [estId, 'Q1'],
        "INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, 'Q1', 'QUARTO 1', 3, ?)",
        [estId, bloco, ui, categoriaAcomodacao, agora],
      );
      for (const c of codigos)
        await g(
          'SELECT id FROM leito_hospitalar WHERE unidade_internacao_id = ? AND codigo = ?',
          [ui, c],
          'INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id, codigo, situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)',
          [estId, ui, ac, bloco, c, livre, agora],
        );
      await e.executar('UPDATE leito_hospitalar SET situacao_leito_id = ? WHERE estabelecimento_id = ?', [livre, estId]);
    };
    await limparGravacoesAdt(e, [est, outro]);
    await mapa(est, ['01', '02', '03']);
    await mapa(outro, ['01']);
    const pessoa = (nome: string) => g('SELECT id FROM pessoa_fisica WHERE nome = ?', [nome], 'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [nome, agora]);
    const pacientes: number[] = [];
    for (const [k, base] of [1, 2, 3].map((k) => [k, marca === 'A' ? 930_100 : 930_200] as const)) {
      const pf = await pessoa(`PACIENTE SINTETICO ${P} ${k}`);
      pacientes.push(
        await g('SELECT id FROM paciente WHERE pessoa_fisica_id = ?', [pf], "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)", [
          pf,
          base + k,
          agora,
        ]),
      );
    }
    const pm = await pessoa(`MEDICO SINTETICO ${P}`);
    const medico = await g('SELECT id FROM profissional WHERE pessoa_fisica_id = ?', [pm], "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)", [pm, agora]);
    const convenio = await g('SELECT id FROM fonte_pagadora WHERE codigo = ?', [P], "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)", [
      P,
      `OPERADORA ${P}`,
      agora,
    ]);
    const desfecho = await cad('desfecho_internacao', `${P}-ALTA`, { descricao: `ALTA ${P}` });
    const terminologia = await cad('terminologia', `${P}-CID`, { nome: `CID SINTETICO ${P}`, tipo: 'diagnostico' });
    const cid = await g(
      'SELECT id FROM termo_terminologia WHERE terminologia_id = ? AND codigo_termo = ?',
      [terminologia, 'Z999'],
      "INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, 'Z999', 'TERMO SINTETICO', ?)",
      [terminologia, agora],
    );
    const proc = await e.uma<{ id: number }>('SELECT id FROM procedimento_sigtap WHERE ativo = TRUE ORDER BY id LIMIT 1', []);
    if (!proc) throw new Error('O cliente de teste não tem procedimento do SIGTAP carregado.');
    const tiss = await g('SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?', [`Z${marca}`], "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES (?, ?, 'teste', TRUE, ?)", [
      `Z${marca}`,
      `URGENCIA ${P}`,
      agora,
    ]);
    const etapas = ['solicitada', 'aguardando', 'em_higienizacao', 'pos_higienizacao', 'liberada', 'cancelada'];
    for (const [k, etapa] of etapas.entries()) await cad('situacao_limpeza', `${P}-${etapa}`.slice(0, 30), { descricao: `${etapa} ${P}`, ordem: (marca === 'A' ? 3010 : 3020) + k, cor: '#336699', etapa });
    for (const estado of ['solicitado', 'em_analise', 'reservado', 'internado', 'cancelado'])
      await cad('situacao_pedido_leito', `${P}-${estado}`.slice(0, 30), { descricao: `${estado} ${P}`, estado });
    await cad('motivo_bloqueio_leito', 'manutencao', { descricao: 'Manutenção' });
    await cad('tipo_barreira_alta', 'exame', { descricao: 'Aguardando exame', categoria: 'exame' });
    const central = `${P}C`;
    await g('SELECT id FROM central_reguladora WHERE sigla = ?', [central], "INSERT INTO central_reguladora (sigla, nome, esfera, forma_conexao, criado_em) VALUES (?, ?, 'estadual', 'manual', ?)", [
      central,
      `CENTRAL SINTETICA ${P}`,
      agora,
    ]);
    const setorNome = `NUTRICAO SINTETICA ${marca}`;
    const setor = await g(
      'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
      [est, 'S1'],
      "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'S1', ?, 'apoio_tecnico', ?)",
      [est, setorNome, agora],
    );
    for (const tipo of ['atendimento', 'internacao', 'solicitacao_limpeza', 'pedido_leito'])
      await g('SELECT id FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = ?', [est, tipo], 'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, criado_em) VALUES (?, ?, 1, ?)', [
        est,
        tipo,
        agora,
      ]);
    const situacaoSolicitado = await cad('situacao_pedido_leito', `${P}-solicitado`.slice(0, 30), { descricao: `solicitado ${P}`, estado: 'solicitado' });
    return {
      est,
      outro,
      usuario,
      login,
      pacientes,
      medico,
      convenio,
      especialidade: await cad('especialidade_medica', `${P}-CLM`, { descricao: `CLINICA MEDICA ${P}` }),
      carater: await cad('carater_admissao', `${P}-URG`, { descricao: `URGENCIA ${P}`, urgencia: true }),
      caraterTiss: tiss,
      categoria: await cad('categoria_atendimento', `${P}-INT`, { descricao: `INTERNACAO ${P}`, tipo_base: 'internacao' }),
      modalidade: await cad('modalidade_internacao', `${P}-CLI`, { descricao: `CLINICA ${P}`, classificacao: 'clinica' }),
      motivoSaida: await cad('motivo_saida_hospitalar', `${P}-ALTA`, { descricao: `ALTA MELHORADO ${P}`, tipo_saida: 'alta', desfecho_internacao_id: desfecho }),
      motivoCancelamentoAlta: await cad('motivo_cancelamento_alta', `${P}-ERRO`, { descricao: `ALTA POR ENGANO ${P}` }),
      motivoExclusao: await cad('motivo_cancelamento_internacao', `${P}-ERRO`, { descricao: `INTERNACAO POR ENGANO ${P}` }),
      motivoTroca: await cad('motivo_troca_leito', `${P}-CONF`, { descricao: `CONFORTO ${P}`, aplica_a: 'internacao' }),
      cid,
      procedimento: Number(proc.id),
      tipoLimpeza: await cad('modalidade_limpeza', `${P}-TERM`, { descricao: `TERMINAL ${P}`, tipo: 'terminal', tempo_previsto_minutos: 90, padrao: true }),
      setor,
      setorNome,
      central,
      situacaoSolicitado,
    };
  });
  return { nucleo, marca, leitos: ['01', '02', '03'], leitoOutro: '01', ...ids };
}

export async function encerrarMassaAdt(m: MassaAdt | null): Promise<void> {
  if (!m) return;
  await m.nucleo
    .escrever({ cliente: CLIENTE_ADT, correlacao: `limpeza-teste-03-01-${m.marca}` }, (e) => limparGravacoesAdt(e, [m.est, m.outro]))
    .catch(() => undefined);
  await m.nucleo.encerrar();
}

/** O contexto da sessão sintética (estabelecimento da massa ou outro). */
export function contextoAdt(m: MassaAdt, est = m.est): ContextoAdt & { idempotencia?: string } {
  return { cliente: CLIENTE_ADT, estabelecimento: est, usuario: m.usuario, correlacao: `int-0301-${randomUUID().slice(0, 8)}`, rede: 'teste', hospital: `L0301${m.marca}` };
}

export function operacaoAdt(m: MassaAdt, est = m.est): ContextoOperacao {
  return { ...contextoAdt(m, est), chaveIdempotencia: `int-0301-${randomUUID()}` };
}

/** A linha da trilha da tela para as gravações diretas (o Executor a leva à trilha de auditoria). */
export function trilhaAdt(m: MassaAdt, tabela: string, id: number | null = null): TrilhaDaGravacao {
  return { estabelecimento: m.est, usuario: m.usuario, acao: 'operacao', entidade: tabela, entidadeId: id, dadosDepois: { recurso: 'adt' }, correlacao: 'int-0301' };
}

/** Leitura de conferência no banco do cliente de teste. */
export function lerAdt<T extends Record<string, unknown>>(m: MassaAdt, sql: string, p: unknown[]): Promise<T | null> {
  return m.nucleo.lerSomente({ cliente: CLIENTE_ADT, correlacao: 'int-0301-conferir' }, (l) => l.uma<T>(sql, p));
}
