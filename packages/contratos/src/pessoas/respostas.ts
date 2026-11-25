// Respostas das telas da gestão de pessoas, fatia F1 (M52; ficha, seções 4 e 7). CPF só mascarado (os 5 últimos
// dígitos, cap-08 §8.13) e nunca em lista; nada de senha, conta bancária ou dado de saúde (o prontuário ocupacional é
// a F5, separado). Os rótulos dos códigos ficam no vocabulário.
import type { EfeitoEsocialSesmt } from './sesmt-respostas.js';
import type {
  ConselhoClasse,
  EstadoVinculo,
  ParentescoDependente,
  SituacaoHabilitacao,
  TipoEventoHistorico,
  TipoVinculo,
} from './vocabulario.js';

export interface OpcaoPessoas {
  readonly codigo: number;
  readonly rotulo: string;
}

/** Lotação lida: centro de custo e unidade com o nome. */
export interface LotacaoLida {
  /** Nulo: vínculo sem centro de custo. */
  readonly centroCusto: number | null;
  readonly centroCustoNome: string | null;
  readonly unidade: number | null;
  readonly unidadeNome: string | null;
  readonly setor: string | null;
}

/** Linha da lista de colaboradores (sem CPF). */
export interface ColaboradorResumo {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly tipo: TipoVinculo;
  readonly cargo: string;
  readonly lotacao: LotacaoLida;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly estado: EstadoVinculo;
  /** Pior situação dos registros de conselho da pessoa (alerta na lista). */
  readonly conselho: SituacaoHabilitacao | null;
}

export interface ListaColaboradores {
  readonly itens: readonly ColaboradorResumo[];
  /** Último ID da página (keyset): null quando acabou. */
  readonly depois: number | null;
}

/** Registro no conselho do lado assistencial (inscrição no conselho) com a validade acompanhada pelo RH. */
export interface RegistroConselhoLido {
  readonly registro: number;
  readonly conselho: ConselhoClasse | string | null;
  readonly numero: number | null;
  readonly uf: string | null;
  readonly cbo: string | null;
  readonly cboDescricao: string | null;
  /** Se a inscrição está ativa: a atividade real do registro (regra 4). */
  readonly ativo: boolean | null;
  readonly validade: string | null;
  readonly situacao: SituacaoHabilitacao;
  readonly diasParaVencer: number | null;
  /** Onde o profissional atende por este registro (unidades assistenciais da inscrição). */
  readonly unidades: readonly UnidadeDoRegistro[];
}

export interface UnidadeDoRegistro {
  readonly codigo: number;
  readonly nome: string | null;
  readonly ativo: boolean;
}

/** Usuário de acesso ligado à pessoa, por hospital da Rede (o mesmo usuário nos dois sistemas). */
export interface UsuarioDaPessoa {
  readonly hospital: string;
  readonly login: string;
  readonly bloqueado: boolean;
  readonly ativo: boolean;
}

export interface DependenteLido {
  readonly id: number;
  readonly nome: string;
  readonly nascimento: string;
  readonly parentesco: ParentescoDependente;
  readonly cpfMascarado: string | null;
  readonly dependenteIr: boolean;
  readonly dependenteSalarioFamilia: boolean;
  /** W0-06: de quando vale esta versão (null: desde a inclusão). */
  readonly desde?: string | null;
}

/** W0-06: correção do colaborador ou alteração do dependente, com o valor anterior e o novo. */
export interface CorrecaoColaboradorLida {
  readonly id: number;
  readonly operacao: string;
  /** SGH_PES_VINCULO (o colaborador) ou SGH_PES_DEPENDENTE (a versão nova do dependente). */
  readonly tabela: string;
  readonly registro: number;
  readonly antes: Readonly<Record<string, unknown>>;
  readonly depois: Readonly<Record<string, unknown>>;
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

export interface EventoHistoricoLido {
  readonly id: number;
  readonly tipo: TipoEventoHistorico;
  readonly vigencia: string;
  readonly antes: string | null;
  readonly depois: string | null;
  readonly motivo: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

/** Ficha do colaborador (ficha, seção 4: 1 ficha, p95 < 500 ms). */
export interface FichaColaborador {
  readonly vinculo: number;
  /** VERSAO do vínculo (a mudança funcional manda de volta; outra pessoa gravou antes: 409). */
  readonly versao: number;
  readonly nome: string;
  readonly cpfMascarado: string | null;
  readonly matricula: string | null;
  readonly tipo: TipoVinculo;
  readonly cargo: string;
  /** W0-06: o cargo do quadro de cargos e salários ligado (CBO e situação), ou null. */
  readonly cargoQuadro?: {
    readonly id: number;
    readonly nome: string;
    readonly cbo: string;
    readonly ativo: boolean;
  } | null;
  readonly funcao: string | null;
  readonly cargaSemanalHoras: number;
  readonly lotacao: LotacaoLida;
  readonly admissao: string;
  readonly desligamento: {
    readonly data: string;
    readonly tipoRescisao: number;
    readonly motivo: string;
  } | null;
  readonly estado: EstadoVinculo;
  /** Outros vínculos da mesma pessoa (regra 1: uma pessoa, vários vínculos). */
  readonly outrosVinculos: readonly {
    vinculo: number;
    tipo: TipoVinculo;
    estado: EstadoVinculo;
    cargo: string;
  }[];
  readonly profissional: {
    readonly id: number;
    /** Situação do profissional no cadastro (ex.: ativo, inativo); null quando não informada. */
    readonly situacao: string | null;
    readonly registros: readonly RegistroConselhoLido[];
  } | null;
  readonly usuarios: readonly UsuarioDaPessoa[];
  readonly dependentes: readonly DependenteLido[];
  readonly historico: readonly EventoHistoricoLido[];
  /** W0-06: correções cadastrais e alterações de dependente, com o valor anterior (o mais recente primeiro). */
  readonly correcoes?: readonly CorrecaoColaboradorLida[];
}

/**
 * Prévia da admissão (regra 1): o que já existe com o CPF digitado. A tela mostra "reusar" e nunca cria segunda
 * pessoa; nenhum CPF volta inteiro.
 */
export interface PreviaAdmissao {
  readonly profissional: { readonly id: number; readonly nome: string; readonly registros: number } | null;
  readonly usuarios: readonly { readonly id: number; readonly login: string; readonly bloqueado: boolean }[];
  readonly vinculosAtivos: readonly { vinculo: number; tipo: TipoVinculo; cargo: string }[];
  /** Mais de um profissional com o mesmo CPF: a admissão espera a unificação no cadastro de profissionais. */
  readonly ambigua: boolean;
}

/** Resultado do desligamento (regra 2): o que foi gravado em cada hospital e as sessões derrubadas. */
export interface ResultadoDesligamento {
  readonly vinculo: number;
  readonly data: string;
  readonly usuarios: readonly {
    readonly hospital: string;
    readonly login: string;
    readonly acao: 'bloqueado' | 'jaBloqueado' | 'mantido';
    /** Motivo de "mantido": outro vínculo ativo da pessoa no mesmo hospital. */
    readonly motivo: string | null;
  }[];
  readonly sessoesEncerradas: number;
  /**
   * Logins bloqueados cuja sessão aberta não se conseguiu encerrar agora (falha no armazém das sessões): o acesso já
   * está bloqueado, e a sessão cai quando o armazém voltar (a tela avisa o RH).
   */
  readonly sessoesPendentes: readonly string[];
}

/** Alerta de conselho (ficha, seção 4: agregado diário no worker; lista para o RH). */
export interface AlertaConselho {
  readonly vinculo: number | null;
  readonly profissional: number;
  readonly nome: string;
  readonly registro: number;
  readonly conselho: string | null;
  readonly validade: string | null;
  readonly situacao: SituacaoHabilitacao;
  readonly diasParaVencer: number | null;
}

export interface ApoioColaboradores {
  readonly hoje: string;
  readonly centrosCusto: readonly OpcaoPessoas[];
  readonly unidades: readonly OpcaoPessoas[];
  readonly tiposRescisao: readonly OpcaoPessoas[];
  /** Catálogos da ficha da admissão (C1-111): sexo, categoria do trabalhador e tipo de vínculo de trabalho. */
  readonly sexos?: readonly OpcaoPessoas[];
  readonly categoriasTrabalhador?: readonly OpcaoPessoas[];
  readonly tiposVinculoTrabalho?: readonly OpcaoPessoas[];
  readonly janelaAlertaDias: number;
  /** Liberação da chave `pessoas.colaborador` no estabelecimento e o motivo, se desligada. */
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  /** O que esta sessão pode fazer (permissão e liberação; o servidor confere de novo em cada gravação). */
  readonly acoes: {
    readonly admitir: boolean;
    readonly desligar: boolean;
    readonly motivo: string | null;
  };
}

/** Retrato diário dos alertas do conselho (SGH_PES_CONSELHO_DIA, gravado pelo worker): só contagens. */
export interface RetratoConselho {
  readonly dia: string;
  readonly janelaDias: number;
  readonly registros: number;
  readonly vencidos: number;
  readonly aVencer: number;
  readonly semValidade: number;
}

/** Painel de alertas do conselho para o RH: o retrato do dia e a lista da hora (paginada). */
export interface PainelConselho {
  readonly retrato: RetratoConselho | null;
  readonly itens: readonly AlertaConselho[];
  readonly depois: number | null;
}

/** Resultado de uma gravação simples da gestão de pessoas (o ID do registro gravado). */
export interface ResultadoPessoas {
  readonly id: number;
  readonly mensagem: string;
  /** Revisão W0-06: o efeito na fila do eSocial da correção de matrícula ou admissão (S-2200/S-2300). */
  readonly esocial?: EfeitoEsocialSesmt;
}
