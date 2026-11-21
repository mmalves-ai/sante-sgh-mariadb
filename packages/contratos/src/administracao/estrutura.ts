// Contratos de Cadastros › Estrutura (M10, ficha seções 4, 5 e 7; cap-06a §6.1): empresa, hospital (CNES) e
// unidades; blocos, acomodações e leitos num cadastro só, com a conferência contra o registro de conferência que
// o banco mantém (o novo nunca o grava). Credenciais de estabelecimento nunca entram no SELECT.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const esquemaEstrutura = z.object({
  empresa: z
    .object({ codigo: z.number().int(), nome: z.string(), cnpj: z.string().nullable(), ativa: z.boolean() })
    .nullable(),
  hospital: z
    .object({
      codigo: z.number().int(),
      nome: z.string(),
      cnes: z.number().int().nullable(),
      cnpj: z.string().nullable(),
      municipio: z.string().nullable(),
      uf: z.string().nullable(),
      esfera: z.string().nullable(),
      complexidade: z.string().nullable(),
      fusoHorario: z.string().nullable(),
    })
    .nullable(),
  unidades: z.array(
    z.object({
      codigo: z.number().int(),
      nome: z.string(),
      cnes: z.number().int().nullable(),
      ativa: z.boolean(),
      sentinela: z.boolean(),
    }),
  ),
  destino: z.enum(['banco', 'memoria']),
});
export type Estrutura = z.infer<typeof esquemaEstrutura>;

export const esquemaLeitoTela = z.object({
  id: z.number().int(),
  leito: z.string(),
  ativo: z.boolean(),
  ocupado: z.boolean(),
  ramal: z.number().int().nullable(),
  andar: z.number().int().nullable(),
  versao: z.string(),
});
export type LeitoTela = z.infer<typeof esquemaLeitoTela>;

export const esquemaAcomodacaoTela = z.object({
  acomodacao: z.string(),
  nome: z.string(),
  andar: z.number().int().nullable(),
  leitosPrevistos: z.number().int().nullable(),
  sexo: z.string().nullable(),
  tipo: z.number().int().nullable(),
  convenio: z.string().nullable(),
  centroCusto: z.number().int().nullable(),
  localConta: z.number().int().nullable(),
  ativos: z.number().int(),
  ocupados: z.number().int(),
  leitos: z.array(esquemaLeitoTela),
  versao: z.string(),
});
export type AcomodacaoTela = z.infer<typeof esquemaAcomodacaoTela>;

export const esquemaLeitos = z.object({
  blocos: z.array(
    z.object({
      bloco: z.string(),
      nome: z.string(),
      andares: z.number().int().nullable(),
      ativos: z.number().int(),
      ocupados: z.number().int(),
      acomodacoes: z.array(esquemaAcomodacaoTela),
    }),
  ),
  orfaos: z.array(
    z.object({ id: z.number().int(), bloco: z.string(), acomodacao: z.string(), leito: z.string() }),
  ),
  totais: z.object({ leitos: z.number().int(), ativos: z.number().int(), ocupados: z.number().int() }),
  /** Domínios dos campos da acomodação (sem as sentinelas). */
  opcoes: z.object({
    tipos: z.array(z.object({ valor: z.number().int(), rotulo: z.string() })),
    locaisConta: z.array(z.object({ valor: z.number().int(), rotulo: z.string() })),
    centrosCusto: z.array(z.object({ valor: z.number().int(), rotulo: z.string() })),
    /** Tipos de acomodação TISS. */
    tiposTiss: z.array(z.object({ valor: z.number().int(), rotulo: z.string() })),
  }),
  operacoes: z.array(
    z.object({
      operacao: z.string(),
      rotulo: z.string(),
      ligada: z.boolean(),
      motivo: z.string().nullable(),
    }),
  ),
  destino: z.enum(['banco', 'memoria']),
});
export type Leitos = z.infer<typeof esquemaLeitos>;

export const esquemaConferenciaLeitos = z.object({
  divergencias: z.array(z.object({ tipo: z.string(), chave: z.string(), orientacao: z.string() })),
  contagens: z.object({
    leitosCadastro: z.number().int(),
    leitosEspelho: z.number().int(),
    leitosEspelhoExterno: z.number().int(),
    acomodacoesCadastro: z.number().int(),
    acomodacoesEspelho: z.number().int(),
    acomodacoesEspelhoExterno: z.number().int(),
    iguais: z.number().int(),
  }),
  porTipo: z.record(z.string(), z.number().int()),
  /** Retratos do registro de conferência: quantidade, só leitura. */
  retratos: z.number().int(),
  tempoMs: z.number().int(),
});
export type ConferenciaLeitos = z.infer<typeof esquemaConferenciaLeitos>;

// ── Entradas das receitas de acomodação e leito ───────────────────────────────────────────────────

const chave = (max: number, rotulo: string) =>
  z
    .string()
    .min(1, `Informe ${rotulo}.`)
    .max(max, `${rotulo} tem no máximo ${max} caracteres.`)
    .regex(/^[A-Za-z0-9._/-]+$/, `Use só letras sem acento, números e . _ / - em ${rotulo}.`);

export const SEXOS_ACOMODACAO = ['A', 'F', 'M'] as const;
export const CONVENIOS_ACOMODACAO = ['C', 'P', 'S', 'T', 'A'] as const;

export const esquemaIncluirAcomodacao = z
  .object({
    bloco: chave(5, 'o bloco'),
    acomodacao: chave(6, 'a acomodação'),
    nome: textoCp1252(40).refine((n) => n.trim().length > 0, { message: 'Informe o nome.' }),
    // Andar, centro de custo, local de conta e tipo TISS: preenchidos em todas as acomodações do banco (perfil
    // da cópia pc: nenhum vazio); a inclusão os exige (nunca grava vazio onde o cadastro nunca tem vazio).
    andar: z.number().int().min(0).max(99),
    leitos: z.number().int().min(1).max(99),
    sexo: z.enum(SEXOS_ACOMODACAO),
    tipo: z.number().int().min(0).max(32767),
    convenio: z.enum(CONVENIOS_ACOMODACAO),
    centroCusto: z.number().int().positive().max(2_147_483_647),
    localConta: z.number().int().positive().max(32767),
    acomodacaoTiss: z.number().int().positive().max(99),
    /** Sem valor: 0 (sem idade mínima), como as acomodações do banco. */
    idadeMinima: z.number().int().min(0).max(999).optional(),
    /** Sem valor: 999 (sem idade máxima), como todas as acomodações do banco. */
    idadeMaxima: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export type IncluirAcomodacaoEntrada = z.infer<typeof esquemaIncluirAcomodacao>;

export const esquemaAlterarAcomodacao = z
  .object({
    bloco: chave(5, 'o bloco'),
    acomodacao: chave(6, 'a acomodação'),
    versao: z.string().min(2).max(2000),
    nome: textoCp1252(40).optional(),
    leitos: z.number().int().min(1).max(99).optional(),
    andar: z.number().int().min(0).max(99).optional(),
  })
  .strict();
export type AlterarAcomodacaoEntrada = z.infer<typeof esquemaAlterarAcomodacao>;

export const esquemaIncluirLeito = z
  .object({
    bloco: chave(5, 'o bloco'),
    acomodacao: chave(6, 'a acomodação'),
    leito: chave(5, 'o leito'),
    /** Preenchido em todos os leitos do banco (perfil): obrigatório. */
    andar: z.number().int().min(0).max(99),
    ramal: z.number().int().min(0).max(32767).optional(),
    /** Código da diária do leito (tabela de diárias e taxas, tabela 1); sem valor: 0, como o banco. */
    diaria: z.number().int().min(0).max(32767).optional(),
    /** Vigência da diária (mês e ano). */
    anoVigente: z.number().int().min(1900).max(9999),
    mesVigente: z.number().int().min(1).max(12),
  })
  .strict();
export type IncluirLeitoEntrada = z.infer<typeof esquemaIncluirLeito>;

export const esquemaAlterarLeito = z
  .object({
    id: z.number().int().positive(),
    versao: z.string().min(2).max(2000),
    ramal: z.number().int().min(0).max(32767).nullable().optional(),
    /** O andar nunca fica vazio (perfil): sem valor, não muda. */
    andar: z.number().int().min(0).max(99).optional(),
  })
  .strict();
export type AlterarLeitoEntrada = z.infer<typeof esquemaAlterarLeito>;

export const esquemaSituacaoLeito = z
  .object({ id: z.number().int().positive(), versao: z.string().min(2).max(2000) })
  .strict();
export type SituacaoLeitoEntrada = z.infer<typeof esquemaSituacaoLeito>;

export const OPERACOES_LEITOS = {
  'organizacao.incluirAcomodacao': 'Incluir acomodação',
  'organizacao.alterarAcomodacao': 'Alterar acomodação',
  'organizacao.incluirLeito': 'Incluir leito',
  'organizacao.alterarLeito': 'Alterar leito',
  'organizacao.inativarLeito': 'Inativar leito',
  'organizacao.reativarLeito': 'Reativar leito',
} as const;
export type OperacaoLeito = keyof typeof OPERACOES_LEITOS;
export const NOMES_OPERACOES_LEITOS = Object.keys(OPERACOES_LEITOS) as OperacaoLeito[];
