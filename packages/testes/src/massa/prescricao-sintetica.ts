// Massa mínima de prescrição para os testes de integração (prescrição, enfermagem e a concorrência da massa): um
// estabelecimento sintético, paciente e profissional fictícios, um atendimento aberto, uma prescrição vigente com um
// item ativo e três horários (um pendente e vencido, um pendente futuro e um já administrado), e o mínimo de
// estoque (insumo, local e tipo de movimento) para conferir que a prescrição não mexe no estoque. Os catálogos são
// criados com códigos do teste. Tudo é massa de teste: roda na transação do teste, de preferência DESFEITA; nada é
// impresso. Os nomes levam a MARCA_SINTETICA; nenhum dado de pessoa real.
// Melhoria: a massa obedece às chaves e aos CHECK do modelo (nada de desligar chave estrangeira para "caber").
import type { Escritor } from '@sgh/nucleo';
import { MARCA_SINTETICA } from './sintetica.js';

export interface PrescricaoSintetica {
  readonly estabelecimento: number;
  readonly usuario: number;
  readonly paciente: number;
  readonly profissional: number;
  readonly atendimento: number;
  readonly prescricao: number;
  readonly item: number;
  /** Horário pendente e vencido (o que horarioPendente devolve). */
  readonly horarioVencido: number;
  /** Horário pendente ainda no futuro. */
  readonly horarioFuturo: number;
  /** Horário já administrado. */
  readonly horarioAdministrado: number;
  readonly situacaoPendente: number;
  readonly situacaoAdministrado: number;
  readonly insumo: number;
  readonly localEstoque: number;
  readonly tipoMovimento: number;
  readonly unidadeMedida: number;
}

/**
 * Monta a massa com o código `c` (até 20 caracteres, único no teste) e a semente numérica `n` (prontuário e números
 * de negócio fictícios). Devolve só identificadores.
 */
export async function prescricaoSintetica(e: Escritor, c: string, n: number): Promise<PrescricaoSintetica> {
  const nome = (x: string) => `${x} ${MARCA_SINTETICA}`;
  const estabelecimento = await e.inserir(
    'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, NOW(3))',
    [c, nome('Hospital'), `${nome('Hospital')} (fictício)`],
  );
  const usuario = await e.inserir(
    `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'integracao', NOW(3))`,
    [`${c}u`, nome('USUARIO')],
  );
  const pfPaciente = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, NOW(3))', [
    nome('PACIENTE'),
  ]);
  const pfProfissional = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, NOW(3))', [
    nome('PROFISSIONAL'),
  ]);
  const paciente = await e.inserir(
    'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, NOW(3))',
    [pfPaciente, 900_000_000 + n],
  );
  const profissional = await e.inserir(
    `INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'assistencial', NOW(3))`,
    [pfProfissional],
  );
  const categoria = await e.inserir(
    `INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', NOW(3))`,
    [c, nome('Categoria')],
  );
  const carater = await e.inserir(
    'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, NOW(3))',
    [c.slice(0, 10), nome('Caráter'), 'teste'],
  );
  const fonte = await e.inserir(
    `INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', NOW(3))`,
    [c, nome('Fonte')],
  );
  const atendimento = await e.inserir(
    `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
            carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3) - INTERVAL 1 DAY, NOW(3))`,
    [estabelecimento, String(n), paciente, categoria, carater, fonte, profissional],
  );
  const prescricao = await e.inserir(
    `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
            situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
     VALUES (?, ?, ?, ?, ?, 'vigente', NOW(3) - INTERVAL 3 HOUR, NOW(3) - INTERVAL 3 HOUR,
             NOW(3) + INTERVAL 21 HOUR, NOW(3))`,
    [estabelecimento, n, paciente, atendimento, profissional],
  );
  const tipoItem = await e.inserir(
    `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'medicamento', NOW(3))`,
    [c, nome('Tipo de item')],
  );
  const item = await e.inserir(
    `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, inicio_em,
            lancamento_profissional_id, criado_em)
     VALUES (?, 1, ?, NOW(3) - INTERVAL 3 HOUR, ?, NOW(3))`,
    [prescricao, tipoItem, profissional],
  );
  const situacao = (codigo: string, categoria: string) =>
    e.inserir('INSERT INTO situacao_checagem (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, NOW(3))', [
      `${c}${codigo}`,
      nome(categoria),
      categoria,
    ]);
  const situacaoPendente = await situacao('p', 'pendente');
  const situacaoAdministrado = await situacao('a', 'administrado');
  const horario = (previsto: string, administrado: boolean) =>
    e.inserir(
      `INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id,
              previsto_em, situacao_checagem_id, administrado_em, administrado_por_profissional_id, criado_em)
       VALUES (?, ?, ?, ?, ${previsto}, ?, ?, ?, NOW(3))`,
      [
        estabelecimento,
        atendimento,
        prescricao,
        item,
        administrado ? situacaoAdministrado : situacaoPendente,
        administrado ? new Date(Date.now() - 2 * 3_600_000) : null,
        administrado ? profissional : null,
      ],
    );
  const horarioAdministrado = await horario('NOW(3) - INTERVAL 2 HOUR', true);
  const horarioVencido = await horario('NOW(3) - INTERVAL 30 MINUTE', false);
  const horarioFuturo = await horario('NOW(3) + INTERVAL 1 HOUR', false);
  const unidadeMedida = await e.inserir(
    'INSERT INTO unidade_medida (codigo, descricao, sigla, uso_estoque, criado_em) VALUES (?, ?, ?, TRUE, NOW(3))',
    [c, nome('Unidade'), 'un'],
  );
  const grupo = await e.inserir(
    `INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'medicamento', NOW(3))`,
    [c, nome('Grupo')],
  );
  const insumo = await e.inserir(
    `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em)
     VALUES (?, ?, 'medicamento', ?, ?, NOW(3))`,
    [c, nome('Insumo'), grupo, unidadeMedida],
  );
  const localEstoque = await e.inserir(
    `INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em)
     VALUES (?, ?, ?, 'farmacia_central', NOW(3))`,
    [estabelecimento, c, nome('Farmácia')],
  );
  const tipoMovimento = await e.inserir(
    `INSERT INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, criado_em)
     VALUES (?, ?, 'entrada', 'entrada', NOW(3))`,
    [c, nome('Entrada')],
  );
  return {
    estabelecimento,
    usuario,
    paciente,
    profissional,
    atendimento,
    prescricao,
    item,
    horarioVencido,
    horarioFuturo,
    horarioAdministrado,
    situacaoPendente,
    situacaoAdministrado,
    insumo,
    localEstoque,
    tipoMovimento,
    unidadeMedida,
  };
}

/** Uma entrada de estoque do insumo da massa no mês corrente (para provar que a conferência acusa o movimento). */
export async function entradaSintetica(e: Escritor, m: PrescricaoSintetica, quantidade = 1): Promise<number> {
  return e.inserir(
    `INSERT INTO movimento_estoque (estabelecimento_id, local_estoque_id, ocorrido_em, competencia,
            tipo_movimento_estoque_id, natureza, insumo_id, unidade_medida_id, quantidade, quantidade_estoque,
            usuario_id, criado_em)
     VALUES (?, ?, NOW(3), DATE_FORMAT(CURRENT_DATE, '%Y-%m-01'), ?, 'entrada', ?, ?, ?, ?, ?, NOW(3))`,
    [m.estabelecimento, m.localEstoque, m.tipoMovimento, m.insumo, m.unidadeMedida, quantidade, quantidade, m.usuario],
  );
}
