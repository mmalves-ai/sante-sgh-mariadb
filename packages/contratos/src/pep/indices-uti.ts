// Índices de gravidade da UTI (M45, etapa 2; ficha, seções 4, 5, 7 e 8, regra 5; cap-05b §5.8; RDC 7/2010, art. 48):
// APACHE II (Knaus et al., 1985) e SOFA (Vincent et al., 1996) calculados com a configuração do estabelecimento (os
// agrupamentos, as variáveis com as faixas de pontuação, os pesos das categorias diagnósticas e os itens de Glasgow, só
// lidos), a mortalidade esperada do APACHE II, a validação pelo médico e a razão de mortalidade padronizada (SMR =
// óbitos observados ÷ esperados, com as parcelas impressas). SAPS 3 e a exportação ao parceiro externo dependem da DP-20.
// Nenhum nome de tabela nem do sistema anterior em texto visto pelo usuário (ADR 0023).
import { z } from 'zod';
import { idBanco } from '../validacao/id-banco.js';

export const INDICES_UTI = ['apache2', 'sofa'] as const;
export type IndiceUti = (typeof INDICES_UTI)[number];
export const ROTULOS_INDICE_UTI: Readonly<Record<IndiceUti, string>> = {
  apache2: 'APACHE II',
  sofa: 'SOFA',
};

/** Tipo de admissão do APACHE II: define a pontuação da doença crônica e o grupo das categorias diagnósticas. */
export const TIPOS_ADMISSAO_UTI = ['eletiva', 'urgencia', 'nao-cirurgico'] as const;
export type TipoAdmissaoUti = (typeof TIPOS_ADMISSAO_UTI)[number];
export const ROTULOS_TIPO_ADMISSAO: Readonly<Record<TipoAdmissaoUti, string>> = {
  eletiva: 'Pós-operatório de cirurgia eletiva',
  urgencia: 'Pós-operatório de cirurgia de urgência',
  'nao-cirurgico': 'Não cirúrgico',
};

// ── Configuração do estabelecimento (lida; cache) ──────────────────────────────────────────────

export interface FaixaVariavelIndice {
  readonly pontuacao: number;
  readonly de: number;
  readonly ate: number;
}
export interface VariavelIndice {
  readonly id: number;
  readonly agrupamento: number;
  readonly sigla: string | null;
  readonly nome: string;
  readonly faixas: readonly FaixaVariavelIndice[];
  /** Categoria diagnóstica do APACHE II: o peso na equação da mortalidade (o grupo vem do agrupamento). */
  readonly pesoCategoria: number | null;
}
export interface AgrupamentoIndice {
  readonly id: number;
  readonly indice: IndiceUti;
  readonly descricao: string;
}
export interface ItemGlasgowIndice {
  readonly id: number;
  readonly variavel: number;
  readonly nome: string;
  readonly pontuacao: number;
}
export interface ConfiguracaoIndicesUti {
  readonly agrupamentos: readonly AgrupamentoIndice[];
  readonly variaveis: readonly VariavelIndice[];
  readonly glasgow: readonly ItemGlasgowIndice[];
  /** Impressão SHA-256 da configuração (guardada com o índice: a conta pode ser refeita com a mesma configuração). */
  readonly impressao: string;
}

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────

const id = idBanco;
const dataHoraLocal = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    'Data e hora no formato AAAA-MM-DDTHH:mm.',
  );

/** Variáveis fisiológicas (pela sigla da configuração): o pior valor das primeiras 24 horas. */
export const esquemaVariaveisIndice = z.record(
  z.string().regex(/^[A-Z_0-9]{2,20}$/),
  z.number().min(-1_000).max(1_000_000).nullable(),
);

export const esquemaRegistrarIndiceUti = z
  .object({
    paciente: id,
    atendimento: id.nullable(),
    reg: id.nullable(),
    unidade: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 ._-]{1,5}$/)
      .nullable(),
    indice: z.enum(INDICES_UTI),
    coletadoEm: dataHoraLocal,
    variaveis: esquemaVariaveisIndice,
    /** Os itens de Glasgow escolhidos (IDs da configuração do estabelecimento). */
    glasgow: z.object({ ocular: id, verbal: id, motora: id }).strict(),
    apache: z
      .object({
        idade: z.number().int().min(16).max(120),
        tipoAdmissao: z.enum(TIPOS_ADMISSAO_UTI),
        /** ID da categoria diagnóstica da configuração (do grupo do tipo de admissão). */
        categoria: id,
        insuficienciaCronica: z.boolean(),
        falhaRenalAguda: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((e) => e.indice !== 'apache2' || e.apache !== undefined, {
    message: 'O APACHE II pede a idade, o tipo de admissão e a categoria diagnóstica.',
    path: ['apache'],
  });
export type RegistrarIndiceUtiEntrada = z.infer<typeof esquemaRegistrarIndiceUti>;

export const esquemaValidarIndiceUti = z
  .object({
    /** Reautenticação: a validação médica é como uma assinatura do índice. */
    senha: z.string().min(1).max(128),
  })
  .strict();

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────

export interface PontoVariavel {
  readonly variavel: number | null;
  readonly sigla: string;
  readonly nome: string;
  readonly valor: number | null;
  readonly pontos: number;
  /** Componente do índice (Glasgow, idade, doença crônica, órgão do SOFA). */
  readonly grupo: string;
}

export interface CalculoIndiceUti {
  readonly indice: IndiceUti;
  readonly pontuacao: number;
  readonly parcelas: readonly PontoVariavel[];
  /** APACHE II: a mortalidade esperada (0 a 1) com a equação impressa. */
  readonly mortalidade: number | null;
  readonly equacao: string | null;
  readonly avisos: readonly string[];
}

export interface IndiceUtiLido {
  readonly id: number;
  readonly paciente: number;
  readonly reg: number | null;
  readonly indice: IndiceUti;
  readonly pontuacao: number;
  readonly mortalidade: number | null;
  readonly categoria: number | null;
  readonly tipoAdmissao: TipoAdmissaoUti | null;
  readonly parcelas: readonly PontoVariavel[];
  readonly coletadoEm: string;
  readonly registradoPor: string;
  readonly situacao: 'registrado' | 'validado';
  readonly validadoPor: string | null;
  readonly validadoEm: string | null;
  /** A configuração mudou depois do registro (a impressão guardada não é a atual). */
  readonly configuracaoMudou: boolean;
  /** W0-03: presente quando estornado ou invalidado (inativo e visível; fora da SMR). */
  readonly estorno?: import('../enfermagem/escores.js').EstornoDoRegistro | null;
}

export interface SmrDoPeriodo {
  readonly de: string;
  readonly ate: string;
  readonly indices: number;
  readonly comDesfecho: number;
  readonly obitosObservados: number;
  readonly obitosEsperados: number;
  readonly smr: number | null;
  /** As parcelas impressas (cada índice validado com a mortalidade esperada e o desfecho). */
  readonly parcelas: readonly { id: number; reg: number | null; mortalidade: number; obito: boolean }[];
  readonly conta: string;
  readonly semDesfecho: number;
}

export interface IndicesDoPaciente {
  readonly paciente: number;
  readonly indices: readonly IndiceUtiLido[];
  readonly configuracao: ConfiguracaoIndicesUti;
  readonly gravacao: {
    readonly ligada: boolean;
    readonly motivo: string | null;
    readonly registrar: boolean;
    readonly validar: boolean;
    readonly motivoValidar: string | null;
  };
  /** SAPS 3 e a exportação ao parceiro externo: dependem da DP-20 (a tela diz o motivo). */
  readonly saps3: { readonly disponivel: false; readonly motivo: string };
}
