// Rotas e respostas da contabilidade, etapa 1 (M54-F1; ficha, seções 2, 4 e 7): plano de contas com o plano
// referencial, regras de contabilização versionadas (simulação e publicação com reautenticação) e o acompanhamento dos
// fatos lidos dos módulos (resumo por fonte, lista e conferência do reprocessamento). A API e a tela usam estes tipos.
// Os textos vistos pelo usuário nunca trazem nome de tabela: a fonte do fato aparece pelo rótulo (ROTULOS_FONTE_FATO).
import { z } from 'zod';
import type { ContaPlano, RegraContabil } from './entradas.js';
import type { LancamentoGerado } from './modelo.js';
import type { GrupoConta, OrigemLancamento, SituacaoFato, TipoFato } from './vocabulario.js';

export const ROTAS_CONTABIL_F1 = {
  apoio: { caminho: 'contabil/apoio', permissao: 'contabil.plano.ler' },
  // O apoio da tela dos fatos (o mesmo conteúdo): quem só acompanha os fatos não tem a permissão do plano.
  apoioFatos: { caminho: 'contabil/fatos/apoio', permissao: 'contabil.fato.ler' },
  plano: { caminho: 'contabil/plano', permissao: 'contabil.plano.ler' },
  incluirConta: { caminho: 'contabil/plano/contas', permissao: 'contabil.plano.editar' },
  alterarConta: { caminho: 'contabil/plano/contas/alterar', permissao: 'contabil.plano.editar' },
  regras: { caminho: 'contabil/regras', permissao: 'contabil.plano.ler' },
  // A simulação devolve os fatos um a um (valores e documentos): exige a leitura dos fatos; o handler confere também a
  // do plano (as regras).
  simular: { caminho: 'contabil/regras/simular', permissao: 'contabil.fato.ler' },
  publicar: { caminho: 'contabil/regras/publicar', permissao: 'contabil.regra.publicar' },
  fatos: { caminho: 'contabil/fatos', permissao: 'contabil.fato.ler' },
  resumoFatos: { caminho: 'contabil/fatos/resumo', permissao: 'contabil.fato.ler' },
  reprocessar: { caminho: 'contabil/periodos/reprocessar', permissao: 'contabil.regra.publicar' },
} as const;

/** Chave de liberação do módulo (SGH_CFG_LIBERACAO; recursos.ts). */
export const CHAVE_CONTABIL = 'contabil' as const;

/** Rótulo de produto de cada fonte de fato (a tela nunca mostra o nome da tabela). */
export const ROTULOS_FONTE_FATO: Readonly<Record<string, string>> = {
  FCCTAEXT: 'Contas dos pacientes (receita)',
  FCLANEXT: 'Itens das contas (glosa e recurso)',
  MFCONPAG: 'Contas a pagar',
  MFCTAREC: 'Contas a receber',
  MFLANCTO: 'Movimento bancário',
  GELANSAI: 'Saídas de estoque',
  GECADNFS: 'Notas fiscais de entrada',
  RPRPA: 'Recibos de autônomo',
  SGH_PES_FOLHA_FATO: 'Folha de pagamento (custo de pessoal)',
  SGH_PAT_DEPRECIACAO: 'Depreciação dos bens patrimoniais',
  SGH_PAT_AJUSTE: 'Perda por impairment dos bens patrimoniais',
};

export const rotuloDaFonte = (tabela: string): string => ROTULOS_FONTE_FATO[tabela] ?? 'Outra fonte';

// ── Entradas que só a API usa (as do motor estão em entradas.ts) ─────────────────────────────────

export const esquemaEmpresaContabil = z.object({
  empresa: z.coerce.number().int().positive().default(1),
});

export const esquemaFiltroRegras = z.object({
  empresa: z.coerce.number().int().positive().default(1),
  origem: z.coerce.number().int().positive().optional(),
  tipoFato: z.string().max(30).optional(),
});

/** Publicação com a senha (reautenticação: a permissão é crítica). */
export const esquemaSenhaReautenticacao = z.object({ senha: z.string().min(1).max(200).optional() });

/** Simulação: a regra (rascunho ou publicada) aplicada aos fatos da competência, sem gravar. */
export const esquemaCompetenciaSimulacao = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────

/**
 * Os cadastros do CRUD genérico embutidos na aba Cadastros de `/contabil/plano` (M54.1; ficha, seção 5: as 4 migrar-crud
 * do grupo `contabil`). O apoio lista só os que o perfil consulta (`<modulo>.<recurso>.ler`).
 */
export const CADASTROS_CONTABIL = [
  'contabil.origemLancamento',
  'contabil.periodoEscrituracao',
  'contabil.nire',
  'contabil.tipoSolicitacaoSenha',
] as const;

export interface ApoioContabil {
  readonly ligada: boolean;
  /** Por que está desligada (a descrição e o pré-requisito da chave; POL-3). */
  readonly motivo: string | null;
  readonly podeEditar: boolean;
  readonly podePublicar: boolean;
  readonly podeVerFatos: boolean;
  /** Os cadastros genéricos da contabilidade que o perfil consulta (CADASTROS_CONTABIL). */
  readonly cadastros: readonly string[];
  readonly empresas: readonly number[];
  readonly mascara: string;
  readonly origens: readonly { readonly id: number; readonly rotulo: string }[];
  readonly tiposFato: readonly {
    readonly codigo: TipoFato;
    readonly origem: OrigemLancamento;
    readonly rotulo: string;
  }[];
  readonly grupos: readonly {
    readonly codigo: GrupoConta;
    readonly rotulo: string;
    readonly natureza: string;
  }[];
  readonly tiposPlanoReferencial: readonly {
    readonly id: number;
    readonly codigo: string;
    readonly descricao: string;
    readonly ecf: boolean;
  }[];
}

export interface ContaDoPlano extends ContaPlano {
  readonly versao: number;
  readonly nivel: number;
  readonly pai: string | null;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface PlanoContabil {
  readonly empresa: number;
  /** As contas na ordem da árvore (pai antes dos filhos, níveis comparados numericamente). */
  readonly contas: readonly ContaDoPlano[];
  readonly problemas: readonly {
    readonly codigo: string;
    readonly regra: string;
    readonly gravidade: 'erro' | 'aviso';
    readonly detalhe: string;
  }[];
}

export interface ResultadoContaPlano {
  readonly ok: true;
  readonly codigo: string;
  readonly versao: number;
  readonly mensagem: string;
  /** Problemas do plano depois da gravação (o plano pode ficar incompleto enquanto se monta). */
  readonly problemas: number;
}

export interface VersaoRegra {
  readonly id: number;
  readonly regra: RegraContabil;
  readonly impressao: string;
  readonly justificativa: string;
  readonly publicadaPor: string;
  readonly publicadaEm: string;
  /** `publicada` (a última da mesma chave) ou `substituida`. */
  readonly situacao: 'publicada' | 'substituida';
}

export interface RegrasContabeis {
  readonly empresa: number;
  readonly itens: readonly VersaoRegra[];
}

export interface SimulacaoRegra {
  readonly competencia: string;
  readonly fatos: number;
  /** Os fatos da competência passaram do teto da simulação (a conta é parcial). */
  readonly parcial: boolean;
  readonly porSituacao: Readonly<Record<SituacaoFato, number>>;
  readonly lancamentos: readonly LancamentoGerado[];
  readonly recusas: readonly {
    readonly fato: string;
    readonly situacao: SituacaoFato;
    readonly motivo: string;
  }[];
  readonly totais: {
    readonly debitos: number;
    readonly creditos: number;
    readonly equilibrado: boolean;
    readonly parcelas: readonly {
      readonly lado: 'D' | 'C';
      readonly conta: string;
      readonly valorCentavos: number;
    }[];
  };
  /** Problemas que impediriam publicar a regra simulada (vazio: pode publicar). */
  readonly problemasDaPublicacao: readonly string[];
}

export interface ResultadoPublicacaoRegra {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly impressao: string;
  readonly mensagem: string;
}

export interface FatoListado {
  readonly id: number;
  readonly fonte: string;
  readonly tipo: TipoFato;
  readonly tipoRotulo: string;
  readonly origem: OrigemLancamento;
  readonly empresa: number;
  readonly data: string;
  readonly competencia: string;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly documento: string;
  readonly estorno: boolean;
  readonly situacao: SituacaoFato;
  readonly situacaoRotulo: string;
  readonly motivo: string | null;
  readonly lidoEm: string;
}

export interface FatosContabeis {
  readonly itens: readonly FatoListado[];
  readonly total: number;
  readonly pagina: number;
  readonly tamanho: number;
}

export interface ResumoFonteFatos {
  readonly fonte: string;
  /** Rótulo dos tipos de fato da fonte. */
  readonly tipos: readonly string[];
  readonly marca: number;
  readonly ultimaLeitura: string | null;
  readonly lidosNovos: number;
  readonly lidosAlterados: number;
  readonly porSituacao: Readonly<Partial<Record<SituacaoFato, number>>>;
}

export interface ResumoFatosContabeis {
  readonly fontes: readonly ResumoFonteFatos[];
  /** Soma das situações de todas as fontes (com as parcelas acima). */
  readonly totais: Readonly<Partial<Record<SituacaoFato, number>>>;
}

export interface ResultadoReprocessamento {
  readonly empresa: number;
  readonly competencia: string;
  readonly somenteConferir: boolean;
  readonly fatos: number;
  readonly parcial: boolean;
  /** As duas aplicações das regras sobre os mesmos fatos deram o mesmo resultado (regra 2). */
  readonly identico: boolean;
  readonly iguais: number;
  readonly diferentes: number;
  /** Fatos cuja situação gravada difere da recalculada (o que a gravação muda quando não é só conferência). */
  readonly situacoesAlteradas: number;
  /** Fatos que outra gravação mudou durante o reprocessamento: ficaram como estavam (D-CORRIDA-542). */
  readonly mudaramDurante: number;
  /**
   * A derivação de hoje frente aos lançamentos GRAVADOS dos fatos contabilizados da competência (desde a F2 a primeira
   * execução grava): iguais, diferentes (regra republicada depois) e sem lançamento.
   */
  readonly gravado: {
    readonly comparados: number;
    readonly iguais: number;
    readonly diferentes: number;
    readonly semLancamento: number;
  };
  readonly porSituacao: Readonly<Record<SituacaoFato, number>>;
  readonly totais: { readonly debitos: number; readonly creditos: number };
  readonly mensagem: string;
}
