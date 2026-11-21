// Massa SINTÉTICA dos testes de integração da recepção (lote 01-01) no cliente de teste da onda (f22_o1): estrutura
// idempotente (estabelecimentos "rc0101a" e "rc0101b", recepção, locais, guichês, serviços, catálogos do produto que a
// recepção e a classificação usam, contas e pessoas fictícias) e a limpeza do movimento do estabelecimento ao fim.
// Nenhum dado de pessoa real: nomes "SINTETICO", CPF fictício fora de uso. SGH_NUCLEO_SEM_BANCO=1 pula os testes.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');

/** O cliente de teste da onda existe (criado pelo integrador); se faltar, é criado aqui. */
export function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  if (!lista.split('\n').some((l) => l.split('\t')[1] === CLIENTE))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 1'], {
      cwd: RAIZ,
      stdio: 'ignore',
    });
}

export async function garantir(
  e: Escritor,
  tabela: string,
  chave: Readonly<Record<string, unknown>>,
  valores: Readonly<Record<string, unknown>> = {},
): Promise<number> {
  const onde = Object.keys(chave).map((k) => `${k} <=> ?`);
  const atual = await e.uma(`SELECT id FROM ${tabela} WHERE ${onde.join(' AND ')}`, Object.values(chave));
  if (atual) return Number(atual['id']);
  const todos = { ...chave, ...valores, criado_em: new Date() };
  return e.inserir(
    `INSERT INTO ${tabela} (${Object.keys(todos).join(', ')}) VALUES (${Object.keys(todos)
      .map(() => '?')
      .join(', ')})`,
    Object.values(todos),
  );
}

export interface Massa {
  readonly est: number;
  readonly outroEst: number;
  readonly recepcao: number;
  readonly local: number;
  readonly local2: number;
  readonly guiche1: number;
  readonly gerador: number;
  readonly geradorDiverso: number;
  readonly usuario: number;
  readonly usuario2: number;
  readonly enfermeiro: number;
  readonly paciente: number;
  readonly prontuario: number;
  readonly profissional: number;
  readonly atendimento: number;
  readonly marcacao: number;
  /** Situações da marcação: a inicial (aguardando), a "chegou" e uma cancelada. */
  readonly situacaoMarcada: number;
  readonly situacaoChegou: number;
  readonly situacaoCancelada: number;
  readonly fonteComGuia: number;
}

export const LOGIN = 'rc0101.recepcao';
export const LOGIN2 = 'rc0101.recepcao2';
export const LOGIN_ENF = 'rc0101.enfermeiro';
export const CODIGO_EST = 'rc0101a';
export const CODIGO_OUTRO = 'rc0101b';

/** Hoje (data civil) no fuso padrão dos estabelecimentos de teste. */
export function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export async function montarMassa(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-rc0101' }, async (e) => {
    const est = await garantir(
      e,
      'estabelecimento',
      { codigo: CODIGO_EST },
      {
        nome_fantasia: 'Hospital SINTETICO rc0101a',
        razao_social: 'Hospital SINTETICO rc0101a (ficticio)',
      },
    );
    const outroEst = await garantir(
      e,
      'estabelecimento',
      { codigo: CODIGO_OUTRO },
      {
        nome_fantasia: 'Hospital SINTETICO rc0101b',
        razao_social: 'Hospital SINTETICO rc0101b (ficticio)',
      },
    );
    // Catálogos do produto que a recepção usa (códigos estáveis: banco.ts e operacoes.ts).
    for (const [codigo, descricao] of [
      ['chamar', 'Chamar'],
      ['liberar', 'Liberar'],
      ['suspender', 'Suspender'],
      ['nao_localizado', 'Não localizado'],
      ['cancelar_chamada', 'Cancelar chamada'],
      ['encaminhar', 'Encaminhar'],
    ] as const)
      await garantir(e, 'acao_fluxo_senha', { codigo }, { descricao });
    await garantir(e, 'grupo_prioridade_legal', { codigo: 'gestante' }, { descricao: 'Gestante', peso: 2 });
    await garantir(
      e,
      'grupo_prioridade_legal',
      { codigo: 'idoso_80' },
      { descricao: 'Acima de 80 anos', peso: 1 },
    );
    await garantir(
      e,
      'grupo_prioridade_legal',
      { codigo: 'prioridade_legal' },
      { descricao: 'Demais', peso: 3 },
    );
    const recepcao = await garantir(
      e,
      'ponto_recepcao',
      { estabelecimento_id: est, codigo: 'REC1' },
      {
        descricao: 'Recepção SINTETICA',
      },
    );
    const outraRecepcao = await garantir(
      e,
      'ponto_recepcao',
      { estabelecimento_id: outroEst, codigo: 'REC1' },
      {
        descricao: 'Recepção SINTETICA b',
      },
    );
    const local = await garantir(
      e,
      'local_atendimento',
      { estabelecimento_id: est, codigo: 'L1' },
      {
        ponto_recepcao_id: recepcao,
        descricao: 'Guichês SINTETICOS',
        permite_encaminhamento: true,
      },
    );
    const local2 = await garantir(
      e,
      'local_atendimento',
      { estabelecimento_id: est, codigo: 'L2' },
      {
        ponto_recepcao_id: recepcao,
        descricao: 'Consultório SINTETICO',
      },
    );
    await garantir(
      e,
      'local_atendimento',
      { estabelecimento_id: outroEst, codigo: 'L1' },
      {
        ponto_recepcao_id: outraRecepcao,
        descricao: 'Guichês b',
      },
    );
    const guiche1 = await garantir(
      e,
      'guiche_recepcao',
      { ponto_recepcao_id: recepcao, numero: 1 },
      {
        local_atendimento_id: local,
      },
    );
    await garantir(
      e,
      'guiche_recepcao',
      { ponto_recepcao_id: recepcao, numero: 2 },
      { local_atendimento_id: local },
    );
    const gerador = await garantir(
      e,
      'gerador_senha',
      { ponto_recepcao_id: recepcao, prefixo: 'RC' },
      {
        descricao: 'Recepção geral SINTETICA',
        gera_prioritaria: true,
        limite_dia: 50,
      },
    );
    // A fila deste serviço chama as prioritárias primeiro (a estrutura converge a cada execução).
    await e.executar("UPDATE gerador_senha SET ordem_lista = 'prioridade' WHERE id = ?", [gerador]);
    const geradorDiverso = await garantir(
      e,
      'gerador_senha',
      { ponto_recepcao_id: recepcao, prefixo: 'DV' },
      {
        descricao: 'Serviços diversos SINTETICOS',
        tipo: 'diverso',
      },
    );
    await garantir(
      e,
      'gerador_senha',
      { ponto_recepcao_id: outraRecepcao, prefixo: 'RB' },
      {
        descricao: 'Recepção b',
      },
    );
    // Pessoas e contas fictícias (CPF fictício reservado ao teste).
    const pfEnf = await garantir(
      e,
      'pessoa_fisica',
      { cpf: '00000101011' },
      { nome: 'ENFERMEIRO SINTETICO RC' },
    );
    const pfPac = await garantir(
      e,
      'pessoa_fisica',
      { cpf: '00000101022' },
      { nome: 'PACIENTE SINTETICO RC' },
    );
    const usuario = await garantir(
      e,
      'usuario',
      { login: LOGIN },
      {
        nome: 'RECEPCAO SINTETICA',
        tipo_conta: 'servico',
      },
    );
    const usuario2 = await garantir(
      e,
      'usuario',
      { login: LOGIN2 },
      {
        nome: 'RECEPCAO SINTETICA 2',
        tipo_conta: 'servico',
      },
    );
    const cbo = await garantir(e, 'ocupacao_cbo', { codigo_cbo: '223505' }, { descricao: 'Enfermeiro' });
    const enfermeiro = await garantir(
      e,
      'usuario',
      { login: LOGIN_ENF },
      {
        nome: 'ENFERMEIRO SINTETICO',
        cpf: '00000101011',
        ocupacao_cbo_id: cbo,
      },
    );
    const profissional = await garantir(
      e,
      'profissional',
      { pessoa_fisica_id: pfEnf },
      { tipo: 'assistencial' },
    );
    // Inscrição no conselho, quando os catálogos públicos (conselhos e UF) estão carregados no cliente de teste.
    const conselho = await e.uma("SELECT id FROM conselho_classe WHERE sigla = 'COREN'");
    const uf = await e.uma('SELECT id FROM unidade_federativa ORDER BY id LIMIT 1');
    if (conselho && uf) {
      await garantir(
        e,
        'inscricao_conselho',
        { profissional_id: profissional, sequencia: 1 },
        {
          conselho_classe_id: Number(conselho['id']),
          unidade_federativa_id: Number(uf['id']),
          numero_inscricao: 'RC0101',
          ocupacao_cbo_id: cbo,
          principal: true,
        },
      );
    }
    const paciente = await garantir(
      e,
      'paciente',
      { pessoa_fisica_id: pfPac },
      { numero_prontuario: 90_101_001 },
    );
    const pront = await e.uma('SELECT numero_prontuario FROM paciente WHERE id = ?', [paciente]);
    // Agenda do dia com uma marcação (chegada do agendado).
    const catAgenda = await garantir(
      e,
      'categoria_agenda',
      { codigo: 'rc0101_consulta' },
      { descricao: 'Consulta' },
    );
    const agenda = await garantir(
      e,
      'agenda_servico',
      { estabelecimento_id: est, nome: 'Agenda SINTETICA RC' },
      {
        categoria_agenda_id: catAgenda,
        profissional_id: profissional,
        duracao_horario_minutos: 15,
      },
    );
    const tipoMarc = await garantir(
      e,
      'tipo_marcacao',
      { codigo: 'rc0101_primeira' },
      {
        descricao: 'Primeira vez',
        natureza: 'primeira_vez',
      },
    );
    const sitMarc = await garantir(
      e,
      'situacao_marcacao',
      { codigo: 'rc0101_marcada' },
      {
        descricao: 'Marcada',
        significado: 'aguardando',
      },
    );
    const sitChegou = await garantir(
      e,
      'situacao_marcacao',
      { codigo: 'rc0101_chegou' },
      { descricao: 'Chegou', significado: 'chegou' },
    );
    const sitCancelada = await garantir(
      e,
      'situacao_marcacao',
      { codigo: 'rc0101_cancelada' },
      { descricao: 'Cancelada', significado: 'cancelada' },
    );
    const canal = await garantir(
      e,
      'canal_marcacao',
      { codigo: 'rc0101_presencial' },
      { descricao: 'Presencial' },
    );
    const fonte = await garantir(
      e,
      'fonte_pagadora',
      { codigo: 'rc0101_part' },
      {
        nome: 'Particular SINTETICO',
        tipo: 'particular',
      },
    );
    const fonteComGuia = await garantir(
      e,
      'fonte_pagadora',
      { codigo: 'rc0101_conv' },
      {
        nome: 'Convênio SINTETICO',
        tipo: 'operadora',
        exige_guia: true,
      },
    );
    const hoje = hojeSP();
    const inicio = new Date(`${hoje}T13:00:00Z`);
    const horario = await garantir(
      e,
      'horario_agenda',
      { agenda_servico_id: agenda, inicio_em: inicio, encaixe_ordem: 0 },
      {
        estabelecimento_id: est,
        data_referencia: hoje,
        fim_em: new Date(inicio.getTime() + 15 * 60_000),
        situacao: 'ocupado',
        vagas_ocupadas: 1,
      },
    );
    const marcacao = await garantir(
      e,
      'marcacao_horario',
      { estabelecimento_id: est, numero: `RC-${hoje}` },
      {
        horario_agenda_id: horario,
        paciente_id: paciente,
        tipo_marcacao_id: tipoMarc,
        situacao_marcacao_id: sitMarc,
        canal_marcacao_id: canal,
        fonte_pagadora_id: fonte,
        duracao_minutos: 15,
        marcado_em: new Date(),
        responsavel_usuario_id: usuario,
      },
    );
    // Atendimento do dia (classificação de risco e guia pendente).
    const cat = await garantir(
      e,
      'categoria_atendimento',
      { codigo: 'rc0101_pa' },
      {
        descricao: 'Pronto atendimento',
        tipo_base: 'pronto_atendimento',
      },
    );
    const carater = await garantir(
      e,
      'carater_atendimento_tiss',
      { codigo_tiss: 'U' },
      {
        descricao: 'Urgência',
        versao_fonte: 'teste',
        urgencia: true,
      },
    );
    const atendimento = await garantir(
      e,
      'atendimento',
      { estabelecimento_id: est, numero: `RC-${hoje}` },
      {
        paciente_id: paciente,
        categoria_atendimento_id: cat,
        carater_atendimento_tiss_id: carater,
        fonte_pagadora_id: fonteComGuia,
        profissional_id: profissional,
        entrada_em: new Date(),
      },
    );
    await garantir(
      e,
      'cobertura_atendimento',
      { atendimento_id: atendimento, ordem: 1 },
      {
        fonte_pagadora_id: fonteComGuia,
      },
    );
    // Classificação de risco: níveis, parâmetros vitais e motivos (catálogo do produto).
    const cores = [
      ['vermelho', '#FF0000'],
      ['laranja', '#FF8800'],
      ['amarelo', '#FFDD00'],
      ['verde', '#00AA00'],
      ['azul', '#0055FF'],
    ] as const;
    for (const [i, [codigo, cor]] of cores.entries())
      await garantir(
        e,
        'nivel_prioridade',
        { codigo },
        {
          descricao: codigo,
          nome_cor: codigo,
          cor_hexadecimal: cor,
          ordem: 900 + i,
        },
      );
    for (const codigo of [
      'pressao_sistolica',
      'pressao_diastolica',
      'frequencia_cardiaca',
      'temperatura',
      'saturacao_oxigenio',
    ])
      await garantir(e, 'parametro_vital', { codigo }, { descricao: codigo });
    await garantir(
      e,
      'motivo_reclassificacao',
      { codigo: 'rc0101_piora' },
      { descricao: 'Piora', tipo: 'piora_clinica' },
    );
    return {
      est,
      outroEst,
      recepcao,
      local,
      local2,
      guiche1,
      gerador,
      geradorDiverso,
      usuario,
      usuario2,
      enfermeiro,
      paciente,
      prontuario: Number(pront?.['numero_prontuario']),
      profissional,
      atendimento,
      marcacao,
      situacaoMarcada: sitMarc,
      situacaoChegou: sitChegou,
      situacaoCancelada: sitCancelada,
      fonteComGuia,
    };
  });
}

/** Apaga o movimento dos estabelecimentos de teste (a estrutura fica, para a próxima execução). */
export async function limparMovimento(nucleo: NucleoProprio, m: Massa): Promise<void> {
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-rc0101' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const em = ests.map(() => '?').join(', ');
    const senhas = `SELECT id FROM senha_emitida WHERE estabelecimento_id IN (${em})`;
    await e.executar(`DELETE FROM evento_senha WHERE senha_emitida_id IN (${senhas})`, ests);
    await e.executar(`DELETE FROM senha_emitida_marcacao WHERE senha_emitida_id IN (${senhas})`, ests);
    await e.executar(`DELETE FROM atendimento_senha WHERE senha_emitida_id IN (${senhas})`, ests);
    await e.executar(`DELETE FROM senha_emitida WHERE estabelecimento_id IN (${em})`, ests);
    await e.executar(
      `DELETE FROM ocupacao_guiche WHERE guiche_recepcao_id IN (SELECT gr.id FROM guiche_recepcao gr
         JOIN ponto_recepcao p ON p.id = gr.ponto_recepcao_id WHERE p.estabelecimento_id IN (${em}))`,
      ests,
    );
    await e.executar('DELETE FROM marcacao_horario_historico WHERE marcacao_horario_id = ?', [m.marcacao]);
    await e.executar('UPDATE marcacao_horario SET chegada_em = NULL, situacao_marcacao_id = ? WHERE id = ?', [
      m.situacaoMarcada,
      m.marcacao,
    ]);
    const cls = `SELECT id FROM classificacao_risco WHERE estabelecimento_id IN (${em})`;
    await e.executar(
      `DELETE FROM afericao_valor WHERE afericao_id IN (SELECT id FROM afericao WHERE estabelecimento_id IN (${em}))`,
      ests,
    );
    await e.executar(`DELETE FROM afericao WHERE estabelecimento_id IN (${em})`, ests);
    await e.executar(
      `DELETE FROM classificacao_risco_resposta WHERE classificacao_risco_id IN (${cls})`,
      ests,
    );
    await e.executar(`DELETE FROM classificacao_risco_evento WHERE classificacao_risco_id IN (${cls})`, ests);
    await e.executar(
      `UPDATE classificacao_risco SET anterior_classificacao_risco_id = NULL, motivo_reclassificacao_id = NULL
        WHERE estabelecimento_id IN (${em})`,
      ests,
    );
    await e.executar(`DELETE FROM classificacao_risco WHERE estabelecimento_id IN (${em})`, ests);
    const inc = `SELECT id FROM inclusao_protocolo_paciente WHERE estabelecimento_id IN (${em})`;
    await e.executar(
      `DELETE FROM inclusao_protocolo_criterio WHERE inclusao_protocolo_paciente_id IN (${inc})`,
      ests,
    );
    await e.executar(`DELETE FROM inclusao_protocolo_paciente WHERE estabelecimento_id IN (${em})`, ests);
    // Protocolos publicados pelos testes (ligados só aos estabelecimentos de teste).
    const prots = (
      await e.consultar(
        `SELECT protocolo_classificacao_risco_id AS id FROM protocolo_classificacao_estabelecimento WHERE estabelecimento_id IN (${em})`,
        ests,
      )
    ).map((x) => Number(x['id']));
    for (const p of prots) {
      const vs = `SELECT id FROM protocolo_classificacao_risco_versao WHERE protocolo_classificacao_risco_id = ?`;
      await e.executar(
        `DELETE FROM discriminador_classificacao_risco WHERE fluxograma_classificacao_risco_id IN
           (SELECT id FROM fluxograma_classificacao_risco WHERE protocolo_classificacao_risco_versao_id IN (${vs}))`,
        [p],
      );
      await e.executar(
        `DELETE FROM fluxograma_classificacao_risco WHERE protocolo_classificacao_risco_versao_id IN (${vs})`,
        [p],
      );
      await e.executar(
        `DELETE FROM nivel_prioridade_protocolo WHERE protocolo_classificacao_risco_versao_id IN (${vs})`,
        [p],
      );
      await e.executar(
        'DELETE FROM protocolo_classificacao_risco_versao WHERE protocolo_classificacao_risco_id = ?',
        [p],
      );
      await e.executar(
        'DELETE FROM protocolo_classificacao_estabelecimento WHERE protocolo_classificacao_risco_id = ?',
        [p],
      );
      await e.executar('DELETE FROM protocolo_classificacao_risco WHERE id = ?', [p]);
    }
    await e.executar(
      `DELETE FROM protocolo_gerenciado_versao WHERE protocolo_gerenciado_id IN (SELECT id FROM protocolo_gerenciado WHERE estabelecimento_id IN (${em}))`,
      ests,
    );
    await e.executar(`DELETE FROM protocolo_gerenciado WHERE estabelecimento_id IN (${em})`, ests);
  });
}
