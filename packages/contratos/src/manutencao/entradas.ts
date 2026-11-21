// Entradas das telas e da API da manutenção e engenharia clínica, fatia F1 (M55; ficha, seções 4, 7 e 8): equipamento,
// abertura da OS por qualquer setor (inclusive pelo QR do equipamento no celular), triagem, andamento, conclusão,
// aceite, cancelamento, plano de manutenção com execução e laudo, cobertura por contrato de manutenção, filtros e o
// período dos indicadores. O mesmo Zod vale na tela e no servidor. A tela nunca manda o solicitante nem o técnico: o
// servidor usa o ator da sessão. Toda escrita é em SGH_MAN_* (nenhuma tabela do outro sistema).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_ATIVIDADE_PLANO,
  CODIGOS_CAUSA_FALHA,
  CODIGOS_CLASSE_RISCO,
  CODIGOS_COBERTURA_CONTRATO,
  CODIGOS_CRITICIDADE,
  CODIGOS_NATUREZA_OS,
  CODIGOS_PRIORIDADE_OS,
  CODIGOS_RESULTADO_EXECUCAO,
  CODIGOS_SITUACAO_EQUIPAMENTO,
  CODIGOS_SITUACAO_OS,
  CODIGOS_TIPO_EQUIPAMENTO,
  CODIGOS_TIPO_RECURSO_AGENDA,
  NATUREZAS_ABERTURA,
  TETO_LISTA_OS,
  type AtividadePlano,
  type CausaFalha,
  type ClasseRisco,
  type CoberturaContrato,
  type CriticidadeEquipamento,
  type NaturezaOs,
  type PrioridadeOs,
  type ResultadoExecucao,
  type SituacaoEquipamento,
  type SituacaoOs,
  type TipoEquipamento,
  type TipoRecursoAgenda,
} from './vocabulario.js';

const id = z.number().int().positive();
const smallint = z.number().int().min(0).max(32_767);
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
/** Instante local (America/Sao_Paulo), sem fuso: AAAA-MM-DDTHH:MM. */
const instante = z
  .string({ error: 'Informe a data e a hora.' })
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/, 'Data e hora inválidas.');
const dinheiro = z.number().min(0).max(99_999_999.99);
const motivo = textoCp1252(400).pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));
const descricao = textoCp1252(2000).pipe(z.string().min(10, 'Descreva com pelo menos 10 caracteres.'));
const nota = textoCp1252(2000).nullable().default(null);

const enumDe = <T extends string>(codigos: readonly T[]) => z.enum(codigos as [T, ...T[]]);
const tipoEquipamento = enumDe<TipoEquipamento>(CODIGOS_TIPO_EQUIPAMENTO);
const criticidade = enumDe<CriticidadeEquipamento>(CODIGOS_CRITICIDADE);
const classeRisco = enumDe<ClasseRisco>(CODIGOS_CLASSE_RISCO);
const situacaoEquipamento = enumDe<SituacaoEquipamento>(CODIGOS_SITUACAO_EQUIPAMENTO);
const tipoRecurso = enumDe<TipoRecursoAgenda>(CODIGOS_TIPO_RECURSO_AGENDA);
const natureza = enumDe<NaturezaOs>(CODIGOS_NATUREZA_OS);
const prioridade = enumDe<PrioridadeOs>(CODIGOS_PRIORIDADE_OS);
const situacaoOs = enumDe<SituacaoOs>(CODIGOS_SITUACAO_OS);
const atividade = enumDe<AtividadePlano>(CODIGOS_ATIVIDADE_PLANO);
const resultado = enumDe<ResultadoExecucao>(CODIGOS_RESULTADO_EXECUCAO);
const cobertura = enumDe<CoberturaContrato>(CODIGOS_COBERTURA_CONTRATO);
const causa = enumDe<CausaFalha>(CODIGOS_CAUSA_FALHA);

/** Código de patrimônio ou etiqueta do equipamento (o QR leva só este código; nunca dado de pessoa). */
export const esquemaCodigoEquipamento = textoCp1252(30)
  .transform((v) => v.trim().toUpperCase())
  .pipe(
    z.string().regex(/^[A-Z0-9][A-Z0-9./-]{0,29}$/, 'Código com letras, números, ponto, barra ou hífen.'),
  );

/** Recurso de agenda ligado (ID da agenda de consultas, da agenda de exames ou código da sala cirúrgica). */
export const esquemaRecursoAgenda = z.object({ tipo: tipoRecurso, id }).strict();
export type RecursoAgendaEntrada = z.infer<typeof esquemaRecursoAgenda>;

const camposEquipamento = {
  codigo: esquemaCodigoEquipamento,
  nome: textoCp1252(80).pipe(z.string().min(3, 'Informe o nome do equipamento.')),
  tipo: tipoEquipamento,
  criticidade,
  classeRisco: classeRisco.nullable().default(null),
  fabricante: textoCp1252(60).nullable().default(null),
  modelo: textoCp1252(60).nullable().default(null),
  numeroSerie: textoCp1252(40).nullable().default(null),
  registroAnvisa: z
    .string()
    .regex(/^\d{11}$/, 'O registro na Anvisa tem 11 dígitos.')
    .nullable()
    .default(null),
  /** Unidade e setor (centro de custo) onde o equipamento fica. */
  unidade: smallint.nullable().default(null),
  centroCusto: id,
  localizacao: textoCp1252(80).nullable().default(null),
  recurso: esquemaRecursoAgenda.nullable().default(null),
  /** Bem patrimonial (SGH_PAT_BEM, M54-F6) quando existir; até lá, nulo. */
  bemPatrimonial: id.nullable().default(null),
  instalacao: data.nullable().default(null),
  garantiaAte: data.nullable().default(null),
  situacao: situacaoEquipamento.default('ativo'),
};

function conferirEquipamento(
  v: {
    tipo: TipoEquipamento;
    classeRisco: ClasseRisco | null;
    instalacao: string | null;
    garantiaAte: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (v.tipo !== 'medico' && v.classeRisco !== null)
    ctx.addIssue({
      code: 'custom',
      path: ['classeRisco'],
      message: 'A classe de risco é só do equipamento médico-hospitalar.',
    });
  if (v.instalacao && v.garantiaAte && v.garantiaAte < v.instalacao)
    ctx.addIssue({
      code: 'custom',
      path: ['garantiaAte'],
      message: 'A garantia termina antes da instalação.',
    });
}

export const esquemaCadastrarEquipamento = z
  .object(camposEquipamento)
  .strict()
  .superRefine((v, ctx) => {
    conferirEquipamento(v, ctx);
  });
export type CadastrarEquipamentoEntrada = z.infer<typeof esquemaCadastrarEquipamento>;

/** Alteração com a versão lida (o servidor recusa se outra pessoa gravou antes). */
export const esquemaAlterarEquipamento = z
  .object({ ...camposEquipamento, id, versao, motivo: motivo.nullable().default(null) })
  .strict()
  .superRefine((v, ctx) => {
    conferirEquipamento(v, ctx);
    if (v.situacao === 'desativado' && v.motivo === null)
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: 'Explique por que o equipamento foi desativado.',
      });
  });
export type AlterarEquipamentoEntrada = z.infer<typeof esquemaAlterarEquipamento>;

/**
 * Abertura da OS (tela "Abrir e acompanhar OS", qualquer usuário, do seu setor). Corretiva pede o equipamento (pelo
 * ID ou pelo código do QR); predial pede o local. `equipamentoParado` registra o início da parada (regra 1 e 3).
 */
export const esquemaAbrirOs = z
  .object({
    natureza: enumDe<NaturezaOs>(NATUREZAS_ABERTURA),
    equipamento: id.nullable().default(null),
    codigoEquipamento: esquemaCodigoEquipamento.nullable().default(null),
    /** Setor do solicitante (centro de custo); o servidor confere contra os centros de custo do usuário. */
    centroCusto: id,
    local: textoCp1252(80).nullable().default(null),
    descricao,
    prioridadeSugerida: prioridade.default('media'),
    equipamentoParado: z.boolean().default(false),
    /** Ramal ou outro contato do setor (nunca telefone pessoal). */
    contato: textoCp1252(30).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const temEquipamento = v.equipamento !== null || v.codigoEquipamento !== null;
    if (v.equipamento !== null && v.codigoEquipamento !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['codigoEquipamento'],
        message: 'Informe o equipamento pela lista ou pelo código, não pelos dois.',
      });
    if (v.natureza === 'corretiva' && !temEquipamento)
      ctx.addIssue({ code: 'custom', path: ['equipamento'], message: 'Escolha o equipamento com defeito.' });
    if (v.natureza === 'predial' && !temEquipamento && v.local === null)
      ctx.addIssue({ code: 'custom', path: ['local'], message: 'Informe o local do serviço.' });
    if (v.equipamentoParado && !temEquipamento)
      ctx.addIssue({
        code: 'custom',
        path: ['equipamentoParado'],
        message: 'Só um equipamento pode ser marcado como parado.',
      });
  });
export type AbrirOsEntrada = z.infer<typeof esquemaAbrirOs>;

/** Triagem: a manutenção define a prioridade final (o SLA conta do registro) e assume a OS. */
export const esquemaAssumirOs = z
  .object({
    os: id,
    versao,
    prioridade,
    executor: z.enum(['interno', 'contrato']).default('interno'),
    /** Cobertura acionada quando o executor é a empresa contratada. */
    cobertura: id.nullable().default(null),
    nota,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.executor === 'contrato' && v.cobertura === null)
      ctx.addIssue({
        code: 'custom',
        path: ['cobertura'],
        message: 'Escolha o contrato de manutenção acionado.',
      });
  });
export type AssumirOsEntrada = z.infer<typeof esquemaAssumirOs>;

/** Andamento: troca entre em atendimento e as esperas (peça, fornecedor), com nota. */
export const esquemaAndamentoOs = z
  .object({
    os: id,
    versao,
    situacao: z.enum(['emAtendimento', 'aguardandoPeca', 'aguardandoTerceiro']),
    nota: textoCp1252(2000).pipe(z.string().min(3, 'Escreva o que aconteceu.')),
  })
  .strict();
export type AndamentoOsEntrada = z.infer<typeof esquemaAndamentoOs>;

/**
 * Conclusão pelo técnico: causa, solução, o tempo de reparo (início e fim do trabalho) e, se o equipamento parou, a
 * volta ao uso. Os custos ficam na OS (custo de manutenção por equipamento, que o M54 lê no custeio).
 */
export const esquemaConcluirOs = z
  .object({
    os: id,
    versao,
    causa,
    solucao: descricao,
    inicioReparo: instante,
    fimReparo: instante,
    /** Fim da parada (volta ao uso). Obrigatório quando a OS registrou parada. */
    voltaAoUso: instante.nullable().default(null),
    custoPecas: dinheiro.default(0),
    custoMaoDeObra: dinheiro.default(0),
    custoTerceiros: dinheiro.default(0),
    /** Laudo ou relatório técnico anexado (documento do M09). */
    laudo: id.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fimReparo < v.inicioReparo)
      ctx.addIssue({ code: 'custom', path: ['fimReparo'], message: 'O fim do reparo vem antes do início.' });
    if (v.voltaAoUso !== null && v.voltaAoUso < v.inicioReparo)
      ctx.addIssue({ code: 'custom', path: ['voltaAoUso'], message: 'A volta ao uso vem antes do reparo.' });
  });
export type ConcluirOsEntrada = z.infer<typeof esquemaConcluirOs>;

/** Aceite do solicitante (ou encerramento pela manutenção depois do prazo do aceite). Recusa reabre a OS. */
export const esquemaEncerrarOs = z
  .object({
    os: id,
    versao,
    aceite: z.boolean(),
    nota,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.aceite && (v.nota === null || v.nota.trim().length < 10))
      ctx.addIssue({ code: 'custom', path: ['nota'], message: 'Explique o que não ficou resolvido.' });
  });
export type EncerrarOsEntrada = z.infer<typeof esquemaEncerrarOs>;

export const esquemaCancelarOs = z.object({ os: id, versao, motivo }).strict();
export type CancelarOsEntrada = z.infer<typeof esquemaCancelarOs>;

/**
 * W0-08: corrigir a abertura da OS enquanto ninguém a assumiu (descrição, prioridade sugerida, setor, equipamento e
 * local do serviço), sempre com o motivo. Depois de assumida, o servidor recusa (409).
 */
export const esquemaCorrigirOs = z
  .object({
    os: id,
    versao,
    equipamento: id.nullable().default(null),
    centroCusto: id,
    local: textoCp1252(80).nullable().default(null),
    descricao,
    prioridadeSugerida: prioridade,
    motivo,
  })
  .strict();
export type CorrigirOsEntrada = z.infer<typeof esquemaCorrigirOs>;

/** Periodicidade do plano: a cada N dias ou meses. */
export const esquemaPeriodicidade = z
  .object({ quantidade: z.number().int().min(1).max(120), unidade: z.enum(['dias', 'meses']) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.unidade === 'dias' && v.quantidade > 730)
      ctx.addIssue({ code: 'custom', path: ['quantidade'], message: 'Use meses para períodos longos.' });
  });
export type PeriodicidadeEntrada = z.infer<typeof esquemaPeriodicidade>;

/** Plano de manutenção (regra 2): preventiva, calibração, segurança elétrica ou inspeção por equipamento. */
export const esquemaPlanejarManutencao = z
  .object({
    equipamento: id,
    atividade,
    periodicidade: esquemaPeriodicidade,
    /** Data de referência da primeira execução (a última feita, se houver histórico fora do sistema). */
    dataBase: data,
    /** Antecedência do "a vencer" no painel, em dias (sem valor: o parâmetro do estabelecimento). */
    antecedenciaDias: z.number().int().min(0).max(180).nullable().default(null),
    procedimento: textoCp1252(2000).nullable().default(null),
    executor: z.enum(['interno', 'contrato']).default('interno'),
    cobertura: id.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.executor === 'contrato' && v.cobertura === null)
      ctx.addIssue({ code: 'custom', path: ['cobertura'], message: 'Escolha o contrato de manutenção.' });
  });
export type PlanejarManutencaoEntrada = z.infer<typeof esquemaPlanejarManutencao>;

/**
 * W0-08: alterar o plano pela versão lida (o equipamento e a atividade não mudam: trocar um deles é outro plano). A
 * versão anterior fica guardada com o motivo; as execuções já registradas não mudam. Versão velha: 409.
 */
export const esquemaAlterarPlano = z
  .object({
    plano: id,
    versao,
    periodicidade: esquemaPeriodicidade,
    dataBase: data,
    antecedenciaDias: z.number().int().min(0).max(180).nullable().default(null),
    procedimento: textoCp1252(2000).nullable().default(null),
    executor: z.enum(['interno', 'contrato']).default('interno'),
    cobertura: id.nullable().default(null),
    motivo,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.executor === 'contrato' && v.cobertura === null)
      ctx.addIssue({ code: 'custom', path: ['cobertura'], message: 'Escolha o contrato de manutenção.' });
  });
export type AlterarPlanoEntrada = z.infer<typeof esquemaAlterarPlano>;

/** Execução do plano com o laudo (obrigatório na calibração e na segurança elétrica; o domínio confere). */
export const esquemaRegistrarExecucao = z
  .object({
    plano: id,
    versao,
    data,
    resultado,
    laudo: id.nullable().default(null),
    /** Certificado do padrão usado na calibração (rastreabilidade metrológica), quando houver. */
    certificadoPadrao: textoCp1252(60).nullable().default(null),
    observacao: nota,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.resultado !== 'aprovado' && (v.observacao === null || v.observacao.trim().length < 10))
      ctx.addIssue({
        code: 'custom',
        path: ['observacao'],
        message: 'Descreva a restrição ou a reprovação (pelo menos 10 caracteres).',
      });
  });
export type RegistrarExecucaoEntrada = z.infer<typeof esquemaRegistrarExecucao>;

/**
 * Cobertura por contrato de manutenção (F1). O fornecedor é o do cadastro de compras (M28) pelo código; a cobertura
 * pode apontar o contrato de fornecedor de suprimentos (`contrato`), do mesmo fornecedor.
 */
export const esquemaCoberturaContrato = z
  .object({
    fornecedor: id,
    numero: textoCp1252(30).pipe(z.string().min(1, 'Informe o número do contrato.')),
    cobertura,
    inicio: data,
    fim: data,
    equipamentos: z.array(id).min(1, 'Escolha ao menos um equipamento.').max(500),
    /** SLA de atendimento do contrato, em horas (sem valor: o da prioridade). */
    slaHoras: z.number().int().min(1).max(720).nullable().default(null),
    valorMensal: dinheiro.nullable().default(null),
    /** Contrato de fornecedor (SGH_SUP_CONTRATO, M55-F3), quando existir. */
    contrato: id.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fim < v.inicio)
      ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O fim da vigência vem antes do início.' });
    if (new Set(v.equipamentos).size !== v.equipamentos.length)
      ctx.addIssue({ code: 'custom', path: ['equipamentos'], message: 'Equipamento repetido na lista.' });
  });
export type CoberturaContratoEntrada = z.infer<typeof esquemaCoberturaContrato>;

/**
 * W0-08: alterar o contrato de manutenção pela versão lida (vigência, SLA, valor mensal e equipamentos cobertos; o
 * fornecedor, o número e o tipo de cobertura não mudam: trocar um deles é outro contrato). A versão anterior fica
 * guardada com o motivo. Versão velha ou contrato encerrado: 409.
 */
export const esquemaAlterarContratoManutencao = z
  .object({
    id,
    versao,
    inicio: data,
    fim: data,
    equipamentos: z.array(id).min(1, 'Escolha ao menos um equipamento.').max(500),
    slaHoras: z.number().int().min(1).max(720).nullable().default(null),
    valorMensal: dinheiro.nullable().default(null),
    motivo,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fim < v.inicio)
      ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O fim da vigência vem antes do início.' });
    if (new Set(v.equipamentos).size !== v.equipamentos.length)
      ctx.addIssue({ code: 'custom', path: ['equipamentos'], message: 'Equipamento repetido na lista.' });
  });
export type AlterarContratoManutencaoEntrada = z.infer<typeof esquemaAlterarContratoManutencao>;

/** W0-08: encerrar o contrato com motivo e a data em que deixa de valer (nada se apaga). */
export const esquemaEncerrarContratoManutencao = z.object({ id, versao, data, motivo }).strict();
export type EncerrarContratoManutencaoEntrada = z.infer<typeof esquemaEncerrarContratoManutencao>;

/** W0-08: excluir o contrato registrado por engano (só sem OS, plano ou versão de plano ligados), com motivo. */
export const esquemaExcluirContratoManutencao = z.object({ id, versao, motivo }).strict();
export type ExcluirContratoManutencaoEntrada = z.infer<typeof esquemaExcluirContratoManutencao>;

/** Lista de OS por setor, equipamento e situação (ficha, seção 4; paginado 200, pela chave). */
export const esquemaFiltroOs = z
  .object({
    centroCusto: id.nullable().default(null),
    equipamento: id.nullable().default(null),
    situacoes: z.array(situacaoOs).max(7).default([]),
    natureza: natureza.nullable().default(null),
    prioridade: prioridade.nullable().default(null),
    /** Só as OS que eu abri (a tela do solicitante). */
    minhas: z.boolean().default(false),
    /** Paginação pela chave: as OS com ID menor que este. */
    antesDe: id.nullable().default(null),
    limite: z.number().int().min(1).max(TETO_LISTA_OS).default(50),
  })
  .strict();
export type FiltroOsEntrada = z.infer<typeof esquemaFiltroOs>;

export const esquemaFiltroEquipamentos = z
  .object({
    termo: textoCp1252(80).nullable().default(null),
    centroCusto: id.nullable().default(null),
    tipo: tipoEquipamento.nullable().default(null),
    criticidade: criticidade.nullable().default(null),
    situacao: situacaoEquipamento.nullable().default(null),
    antesDe: id.nullable().default(null),
    limite: z.number().int().min(1).max(TETO_LISTA_OS).default(50),
  })
  .strict();
export type FiltroEquipamentosEntrada = z.infer<typeof esquemaFiltroEquipamentos>;

/** Período dos indicadores (regra 3): até 366 dias, com recorte opcional. */
export const esquemaPeriodoIndicadores = z
  .object({
    inicio: data,
    fim: data,
    equipamento: id.nullable().default(null),
    centroCusto: id.nullable().default(null),
    criticidade: criticidade.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fim < v.inicio)
      ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O fim do período vem antes do início.' });
    const dias = (Date.parse(`${v.fim}T00:00:00Z`) - Date.parse(`${v.inicio}T00:00:00Z`)) / 86_400_000;
    if (dias > 366) ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O período vai até 366 dias.' });
  });
export type PeriodoIndicadoresEntrada = z.infer<typeof esquemaPeriodoIndicadores>;
