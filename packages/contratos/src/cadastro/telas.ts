// Contratos das telas do M11 (ficha, seção 7): busca e ficha do paciente, linha do tempo, fila de duplicidades,
// consentimentos, pessoas, profissionais e solicitantes. O MASCARAMENTO é do servidor (cap-08 §8.13; regra 9):
// em listas, CPF, telefone e endereço saem mascarados; na ficha, documentos só com
// `cadastro.paciente.verDocumento` e os dados sensíveis (raça/cor, religião, vulnerabilidade, responsável
// legal) só com `cadastro.paciente.verSensivel` — sem a permissão o campo nem vem na resposta. Nenhum nome de
// tabela do legado sai daqui (fronteira).
import { z } from 'zod';
import { esquemaDadosProfissional } from './profissional.js';

// ── Busca de paciente ─────────────────────────────────────────────────────────────────────────────────

export const TIPOS_BUSCA_PACIENTE = [
  'auto',
  'nome',
  'mae',
  'telefone',
  'cpf',
  'prontuario',
  'cns',
  'nascimento',
] as const;
export type TipoBuscaPaciente = (typeof TIPOS_BUSCA_PACIENTE)[number];

export const TETO_BUSCA_PACIENTE = 50;
export const TETO_SUGESTOES_FONETICAS = 5;

export const esquemaConsultaBuscaPaciente = z.object({
  termo: z.string().trim().min(1).max(100),
  tipo: z.enum(TIPOS_BUSCA_PACIENTE).default('auto'),
  /** Inclui cadastros inativos (unificados no legado). */
  inativos: z.enum(['sim', 'nao']).optional(),
});
export type ConsultaBuscaPaciente = z.infer<typeof esquemaConsultaBuscaPaciente>;

export const SITUACOES_CADASTRO = ['ativo', 'inativo', 'unificado'] as const;

export const esquemaPacienteResumo = z.object({
  id: z.number().int().positive(),
  prontuario: z.number().int(),
  nome: z.string(),
  /** Nome social (APELIDO), quando informado: aparece antes do civil. */
  nomeSocial: z.string().nullable(),
  /** AAAA-MM-DD, ou null quando a data do legado é a sentinela. */
  nascimento: z.string().nullable(),
  sexo: z.enum(['F', 'M']).nullable(),
  /** Nome da mãe: iniciais (M*** D*** S***) em lista. */
  maeMascarada: z.string().nullable(),
  cpfMascarado: z.string().nullable(),
  telefoneMascarado: z.string().nullable(),
  situacao: z.enum(SITUACOES_CADASTRO),
  obito: z.boolean(),
  /** Homônimo (mesmo nome normalizado e nascimento) marcado "é outra pessoa" na fila. */
  homonimo: z.boolean(),
});
export type PacienteResumo = z.infer<typeof esquemaPacienteResumo>;

export const esquemaResultadoBuscaPaciente = z.object({
  tipo: z.enum(TIPOS_BUSCA_PACIENTE),
  itens: z.array(esquemaPacienteResumo),
  /** Sugestões pela chave fonética (até 5), só quando a busca por palavra não acha; "confirme e repita". */
  sugestoes: z.array(esquemaPacienteResumo),
  /** Passou do teto: refine a busca (nunca a tabela inteira no cliente). */
  truncado: z.boolean(),
  /** Tempo da consulta no servidor (ms), para a meta de p95. */
  duracaoMs: z.number().int().nonnegative(),
});
export type ResultadoBuscaPaciente = z.infer<typeof esquemaResultadoBuscaPaciente>;

/** Candidatos do "procurar antes de criar" (ref 01 §3.14): nome mascarado e nascimento; escolha pelo ID. */
export const esquemaCandidatosCpf = z.object({
  candidatos: z.array(
    z.object({
      id: z.number().int().positive(),
      prontuario: z.number().int(),
      nomeMascarado: z.string(),
      nascimento: z.string().nullable(),
    }),
  ),
});
export type CandidatosCpf = z.infer<typeof esquemaCandidatosCpf>;

// ── Ficha do paciente ─────────────────────────────────────────────────────────────────────────────────

const opcao = z.object({ codigo: z.number().int(), rotulo: z.string() });

export const esquemaFichaPaciente = z.object({
  id: z.number().int().positive(),
  prontuario: z.number().int(),
  prontuarioAnterior: z.number().int().nullable(),
  situacao: z.enum(SITUACOES_CADASTRO),
  /** Cadastro absorvido numa unificação: o cadastro que ficou (null quando não está unificado). */
  unificadoEm: z.number().int().nullable(),
  /** Versão para o controle otimista da alteração (opaca). */
  versao: z.string(),
  identificacao: z.object({
    nome: z.string(),
    nomeSocial: z.string().nullable(),
    nascimento: z.string().nullable(),
    sexo: z.enum(['F', 'M']).nullable(),
    estadoCivil: opcao.nullable(),
    naturalidade: z.string().nullable(),
    ufNaturalidade: z.string().nullable(),
    nacionalidade: z.string().nullable(),
    estrangeiro: z.boolean(),
  }),
  filiacao: z.object({
    mae: z.string().nullable(),
    maeDesconhecida: z.boolean(),
    pai: z.string().nullable(),
  }),
  /** Sem `verDocumento`, só os mascarados. */
  documentos: z.object({
    cpf: z.string().nullable(),
    cns: z.string().nullable(),
    identidade: z.string().nullable(),
    mascarados: z.boolean(),
  }),
  endereco: z.object({
    cep: z.string().nullable(),
    logradouro: z.string().nullable(),
    numero: z.number().int().nullable(),
    complemento: z.string().nullable(),
    bairro: z.string().nullable(),
    cidade: z.string().nullable(),
    uf: z.string().nullable(),
  }),
  contatos: z.object({
    telefone: z.string().nullable(),
    celular: z.string().nullable(),
    email: z.string().nullable(),
  }),
  responsavel: z.object({ nome: z.string().nullable(), telefone: z.string().nullable() }),
  /** Só com `verSensivel` (sem a permissão: null e a tela diz "restrito ao seu perfil"). */
  sensiveis: z
    .object({
      racaCor: opcao.nullable(),
      religiao: opcao.nullable(),
      responsavelLegal: z.string().nullable(),
    })
    .nullable(),
  carteirinhas: z.array(z.object({ convenio: z.number().int(), nome: z.string() })),
  /** Texto livre clínico da ficha legada (alergia e medicamentos em uso): visível, nunca editado (regra 8). */
  clinicoLegado: z.object({ alergia: z.string().nullable(), medicamentos: z.string().nullable() }),
  obito: z.object({ data: z.string().nullable() }).nullable(),
  cadastro: z.object({ em: z.string().nullable(), alteradoEm: z.string().nullable() }),
  permissoes: z.object({
    editar: z.boolean(),
    verDocumento: z.boolean(),
    verSensivel: z.boolean(),
    registrarConsentimento: z.boolean(),
    lerHistorico: z.boolean(),
  }),
  /** Estado das operações de gravação neste estabelecimento (a tela desabilita o que não grava). */
  gravacao: z.object({ cadastrar: z.boolean(), alterar: z.boolean(), motivo: z.string().nullable() }),
});
export type FichaPaciente = z.infer<typeof esquemaFichaPaciente>;

/**
 * Pode cadastrar paciente agora? A mesma regra do passo 0 do executor (ambiente, estado da operação no catálogo,
 * chave de liberação da operação `cadastro.cadastrarPaciente` por estabelecimento, setor, grupo e pessoa, e a
 * sessão de dev só consulta sobre a cópia). A busca esconde "Cadastrar paciente" e mostra o motivo.
 */
export const esquemaGravacaoCadastro = z.object({
  cadastrar: z.object({ pode: z.boolean(), motivo: z.string().nullable() }),
});
export type GravacaoCadastro = z.infer<typeof esquemaGravacaoCadastro>;

/** Endereço pelo CEP (cadastro de CEPs do estabelecimento): a ficha completa logradouro e bairro antes de salvar. */
export const esquemaEnderecoCep = z.object({
  cep: z.string(),
  logradouro: z.string().nullable(),
  bairro: z.string().nullable(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
});
export type EnderecoCep = z.infer<typeof esquemaEnderecoCep>;

// ── Linha do tempo do cadastro ────────────────────────────────────────────────────────────────────────

export const esquemaHistoricoCadastro = z.object({
  id: z.number().int().positive(),
  nome: z.string(),
  versoes: z.array(
    z.object({
      id: z.number().int(),
      em: z.string(),
      /** Login de quem alterou, quando o legado gravou. */
      usuario: z.string().nullable(),
      mudancas: z.array(
        z.object({
          campo: z.string(),
          rotulo: z.string(),
          antes: z.string().nullable(),
          depois: z.string().nullable(),
        }),
      ),
      telefones: z.array(z.object({ tipo: z.string(), numero: z.string() })),
    }),
  ),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  total: z.number().int(),
  unificacoes: z.array(
    z.object({
      /** A unificação registrada (para desfazer); ausente quando a origem não a registra. */
      id: z.number().int().optional(),
      absorvido: z.number().int(),
      sobrevivente: z.number().int(),
      em: z.string().nullable(),
      /** F3.1: a desfeita continua no histórico, marcada, com data, motivo e responsável (nada se esconde). */
      situacao: z.enum(['efetivada', 'revertida']).optional(),
      /** Falso quando um registro transferido foi alterado depois da unificação (corrige-se registro a registro). */
      reversivel: z.boolean().optional(),
      revertidaEm: z.string().nullable().optional(),
      motivoReversao: z.string().nullable().optional(),
      revertidaPor: z.string().nullable().optional(),
    }),
  ),
});
export type HistoricoCadastro = z.infer<typeof esquemaHistoricoCadastro>;

// ── Fila de duplicidades ──────────────────────────────────────────────────────────────────────────────

export const SITUACOES_DUPLICIDADE = ['aberto', 'outra_pessoa', 'unificado'] as const;
export type SituacaoDuplicidade = (typeof SITUACOES_DUPLICIDADE)[number];

export const CRITERIOS_DUPLICIDADE = ['cpf', 'fonetica', 'nascimento', 'mae', 'telefone'] as const;
export type CriterioDuplicidade = (typeof CRITERIOS_DUPLICIDADE)[number];

const ladoDuplicidade = z.object({
  id: z.number().int().positive(),
  prontuario: z.number().int(),
  nome: z.string(),
  nascimento: z.string().nullable(),
  mae: z.string().nullable(),
  cpfMascarado: z.string().nullable(),
  telefoneMascarado: z.string().nullable(),
  cidade: z.string().nullable(),
  situacao: z.enum(SITUACOES_CADASTRO),
});

export const esquemaParDuplicidade = z.object({
  id: z.number().int().positive(),
  a: ladoDuplicidade,
  b: ladoDuplicidade,
  escore: z.number().int().min(0).max(100),
  criterios: z.array(z.enum(CRITERIOS_DUPLICIDADE)),
  situacao: z.enum(SITUACOES_DUPLICIDADE),
  decididoPor: z.string().nullable(),
  decididoEm: z.string().nullable(),
});
export type ParDuplicidade = z.infer<typeof esquemaParDuplicidade>;

export const esquemaFilaDuplicidades = z.object({
  itens: z.array(esquemaParDuplicidade),
  total: z.number().int(),
  /** Estado da unificação (cadastro.unificarPaciente): "Unificar" só quando `liberada`. */
  unificacao: z.object({ estado: z.string(), disponivel: z.boolean(), motivo: z.string() }),
});
export type FilaDuplicidades = z.infer<typeof esquemaFilaDuplicidades>;

export const esquemaDecisaoDuplicidade = z
  .object({
    decisao: z.literal('outra_pessoa'),
    justificativa: z.string().trim().min(5).max(200),
  })
  .strict();
export type DecisaoDuplicidade = z.infer<typeof esquemaDecisaoDuplicidade>;

export const esquemaAtualizacaoFila = z.object({ novos: z.number().int(), total: z.number().int() });

// ── Consentimento ─────────────────────────────────────────────────────────────────────────────────────

export const esquemaConsentimentos = z.object({
  itens: z.array(
    z.object({
      id: z.number().int(),
      finalidade: z.string(),
      versao: z.string(),
      situacao: opcao,
      signatario: opcao,
      registradoEm: z.string(),
      registradoPor: z.string(),
      revogadoEm: z.string().nullable(),
      motivoRevogacao: opcao.nullable(),
    }),
  ),
  opcoes: z.object({ situacoes: z.array(opcao), signatarios: z.array(opcao), revogacoes: z.array(opcao) }),
});
export type Consentimentos = z.infer<typeof esquemaConsentimentos>;

export const FINALIDADES_CONSENTIMENTO = [
  'atendimento',
  'comunicacao',
  'pesquisa',
  'compartilhamento-rede',
] as const;

export const esquemaPedidoConsentimento = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('registrar'),
      finalidade: z.enum(FINALIDADES_CONSENTIMENTO),
      versao: z.string().trim().min(1).max(20),
      situacao: z.number().int(),
      signatario: z.number().int(),
    })
    .strict(),
  z
    .object({ acao: z.literal('revogar'), id: z.number().int().positive(), motivo: z.number().int() })
    .strict(),
]);
export type PedidoConsentimento = z.infer<typeof esquemaPedidoConsentimento>;

// ── Pessoas ───────────────────────────────────────────────────────────────────────────────────────────

export const esquemaListaPessoas = z.object({
  itens: z.array(
    z.object({
      id: z.number().int(),
      tipo: z.enum(['F', 'J']).nullable(),
      documento: z.string().nullable(),
      documentoMascarado: z.boolean(),
      profissionais: z.number().int(),
      pacientes: z.number().int(),
    }),
  ),
  truncado: z.boolean(),
});
export type ListaPessoas = z.infer<typeof esquemaListaPessoas>;

// ── Profissionais e solicitantes ─────────────────────────────────────────────────────────────────────

/** Categoria pelo CBO (regra 10): médico quando o CBO começa em 225; nunca pela sigla do conselho. */
export const CATEGORIAS_PROFISSIONAL = [
  'medico',
  'enfermagem',
  'odontologia',
  'farmacia',
  'outros-saude',
  'outros',
] as const;
export type CategoriaProfissional = (typeof CATEGORIAS_PROFISSIONAL)[number];

export const esquemaRegistroProfissional = z.object({
  id: z.number().int(),
  conselho: z.string().nullable(),
  sigla: z.string().nullable(),
  numero: z.number().int().nullable(),
  uf: z.string().nullable(),
  cbo: z.string().nullable(),
  cboDescricao: z.string().nullable(),
  categoria: z.enum(CATEGORIAS_PROFISSIONAL),
  ativo: z.boolean().nullable(),
  /** D-PROF-39: só na ficha, para a edição do registro (ID da sigla e versão opaca do controle otimista). */
  siglaId: z.number().int().nullable().optional(),
  versao: z.string().optional(),
});

export const esquemaProfissionalResumo = z.object({
  id: z.number().int(),
  nome: z.string(),
  categoria: z.enum(CATEGORIAS_PROFISSIONAL),
  registros: z.array(esquemaRegistroProfissional),
  /** Situação do profissional, baixa confiança (DP-46.1): o código e a legenda "a confirmar". */
  situacaoLegado: z.object({ codigo: z.string().nullable(), aConfirmar: z.literal(true) }),
  /** Atividade real: algum registro ativo (ocupação do profissional ativa). */
  ativo: z.boolean(),
});
export type ProfissionalResumo = z.infer<typeof esquemaProfissionalResumo>;

export const esquemaListaProfissionais = z.object({
  itens: z.array(esquemaProfissionalResumo),
  truncado: z.boolean(),
  sugestoes: z.array(esquemaProfissionalResumo),
});
export type ListaProfissionais = z.infer<typeof esquemaListaProfissionais>;

export const esquemaFichaProfissional = esquemaProfissionalResumo.extend({
  nomeSocial: z.string().nullable(),
  especialidades: z.array(
    z.object({ registro: z.number().int(), codigo: z.number().int(), nome: z.string(), ativo: z.boolean() }),
  ),
  lotacao: z.array(
    z.object({
      registro: z.number().int(),
      unidade: z.number().int(),
      nome: z.string().nullable(),
      horasAmbulatorio: z.number().int(),
      horasHospital: z.number().int(),
      horasOutros: z.number().int(),
      ativo: z.boolean(),
    }),
  ),
  credenciamentos: z.array(
    z.object({ registro: z.number().int(), convenio: z.number().int(), nome: z.string().nullable() }),
  ),
  logins: z.array(z.object({ login: z.string(), origem: z.enum(['complemento', 'papel']) })),
  /** D-PROF-39: os dados editáveis e a versão (sem documentos; sem dados bancários nem de repasse, regra 11). */
  dados: esquemaDadosProfissional.optional(),
  /**
   * Revisão da D-PROF-39: o login ligado a cada registro (a versão do vínculo), só para quem edita o cadastro ou
   * gere acessos (ligar, trocar e desligar exigem a gestão de acessos: o vínculo é a identidade clínica).
   */
  loginsRegistro: z.array(z.object({ registro: z.number().int(), login: z.string() })).optional(),
  /**
   * Revisão da D-PROF-39: se o executor aceita cada gravação da ficha para quem pergunta (como a ficha de Usuários):
   * a tela monta o aviso único e desliga os controles pelo que o servidor aceitaria, não só pelas permissões.
   */
  operacoes: z.array(z.object({ operacao: z.string(), ligada: z.boolean() })).optional(),
});
export type FichaProfissional = z.infer<typeof esquemaFichaProfissional>;

export const esquemaHistoricoProfissional = z.object({
  id: z.number().int(),
  nome: z.string(),
  versoes: z.array(
    z.object({
      id: z.number().int(),
      em: z.string(),
      usuario: z.string().nullable(),
      mudancas: z.array(
        z.object({
          campo: z.string(),
          rotulo: z.string(),
          antes: z.string().nullable(),
          depois: z.string().nullable(),
        }),
      ),
      telefones: z.array(z.object({ tipo: z.string(), numero: z.string() })),
    }),
  ),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  total: z.number().int(),
});
export type HistoricoProfissional = z.infer<typeof esquemaHistoricoProfissional>;

export const esquemaListaSolicitantes = z.object({
  itens: z.array(
    z.object({
      id: z.number().int(),
      nome: z.string(),
      conselho: z.string().nullable(),
      numero: z.number().int().nullable(),
      uf: z.string().nullable(),
      cbo: z.string().nullable(),
      ativo: z.boolean().nullable(),
      codigosConvenio: z.number().int(),
      /** Mesmo conselho + UF + número de outro solicitante (regra 12): candidato a duplicidade. */
      duplicado: z.boolean(),
      /** Faltam conselho, número, UF ou CBO (a guia TISS exige). */
      incompleto: z.boolean(),
    }),
  ),
  truncado: z.boolean(),
});
export type ListaSolicitantes = z.infer<typeof esquemaListaSolicitantes>;

// ── Especialidades: procedimentos por especialidade (paginado no servidor) e siglas por conselho ─────────

export const esquemaProcedimentosEspecialidade = z.object({
  especialidade: z.number().int(),
  itens: z.array(z.object({ procedimento: z.number().int(), descricao: z.string().nullable() })),
  pagina: z.number().int(),
  porPagina: z.number().int(),
  total: z.number().int(),
});
export type ProcedimentosEspecialidade = z.infer<typeof esquemaProcedimentosEspecialidade>;

export const esquemaSiglasConselho = z.object({
  itens: z.array(z.object({ conselho: z.number().int(), sigla: z.string(), nome: z.string().nullable() })),
});
export type SiglasConselho = z.infer<typeof esquemaSiglasConselho>;

/**
 * Revisão do M39 (onda 1, tela "Profissionais e solicitantes"): a inclusão do médico solicitante externo pela tela do
 * cadastro (`cadastro.cadastrarSolicitante`, receita do M26). O conselho vai pela sigla (CRM, CRO…), que o servidor
 * resolve no cadastro de conselhos; a deduplicação por conselho + UF + número é da receita (regra 12 do M11).
 */
export const esquemaIncluirSolicitante = z
  .object({
    nome: z
      .string()
      .trim()
      .transform((x) => x.toUpperCase())
      .pipe(z.string().min(5).max(70)),
    conselho: z
      .string()
      .trim()
      .transform((x) => x.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2,8}$/, 'Sigla do conselho (CRM, CRO…).')),
    uf: z
      .string()
      .trim()
      .transform((x) => x.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}$/, 'UF com duas letras.')),
    numero: z.number().int().positive().max(2_147_483_647),
  })
  .strict();
export type IncluirSolicitante = z.infer<typeof esquemaIncluirSolicitante>;
export const esquemaSolicitanteIncluido = z.object({ solicitante: z.number().int() });
export type SolicitanteIncluido = z.infer<typeof esquemaSolicitanteIncluido>;
