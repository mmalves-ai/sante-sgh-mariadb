// Vocabulário da contratualização SUS (F2.2): o código que a tela usa (o do contrato @sgh/contratos) ↔ o código neutro
// gravado em dominio_contratualizacao_sus (palavras em snake_case, nunca o número do sistema de origem). A porta própria
// traduz nas duas direções; a carga padrão das listas sai daqui (pedido ao "criar cliente": docs/obra/fatias/f22/saida/
// 02-03.json), na mesma ordem e com os mesmos rótulos do produto.
// Melhoria: o banco guarda o código de negócio estável da lista; o número da tela é só a tradução do contrato atual.
import {
  AFERICOES_SUS,
  COMPLEXIDADES_SUS,
  ESCORES_SUS,
  ESFERAS_CONTRATO_SUS,
  PERIODICIDADES_META_SUS,
  REDES_ASSISTENCIA_SUS,
  TIPOS_INDICADOR_SUS,
  TIPOS_ORCAMENTO_SUS,
} from '@sgh/contratos';
import type { ListaDominioContratualizacao } from './porta.js';

type Mapa = Readonly<Record<string, number>>;

/** Código neutro (banco) → código da tela, por lista. As listas sem vocabulário da tela usam o id da linha. */
export const CODIGOS_TELA: Readonly<Partial<Record<ListaDominioContratualizacao, Mapa>>> = {
  esfera: { federal: 1, estadual: 2, municipal: 3 },
  rede_assistencial: {
    nao_informada: 0,
    rede_cegonha: 1,
    urgencia_emergencia: 2,
    atencao_psicossocial: 3,
    pessoa_com_deficiencia: 4,
    doencas_cronicas: 5,
  },
  periodicidade: {
    anual: 1,
    bianual: 2,
    bimestral: 3,
    diaria: 4,
    mensal: 5,
    quadrimestral: 6,
    quinzenal: 7,
    semanal: 8,
    semestral: 9,
    trimestral: 10,
    cinco_meses: 11,
    sete_meses: 12,
    oito_meses: 13,
    nove_meses: 14,
    dez_meses: 15,
    onze_meses: 16,
  },
  tipo_indicador: {
    nao_informado: 0,
    condicionantes_remuneracao: 1,
    qualidade_assistencia: 2,
    qualidade_informacao: 3,
    gestao_clinica: 4,
    humanizacao: 5,
    manutencao_conservacao: 6,
    formacao_continuada: 7,
  },
  complexidade: {
    teto_mac: 1,
    alta_ambulatorial: 2,
    media_ambulatorial: 3,
    alta_hospitalar: 4,
    media_hospitalar: 5,
    extra_teto_ambulatorial: 6,
    extra_teto_hospitalar: 7,
  },
  tipo_item_indicador: {
    titulo: 1,
    sim_nao: 2,
    texto: 3,
    texto_fixo: 4,
    respostas: 5,
    valor_decimal: 6,
    valor_inteiro: 7,
  },
  escore: { ruim: 1, regular: 2, bom: 3, otimo: 4 },
  tipo_afericao: { sistema_hospital: 1, sistemas_datasus: 2, sistemas_terceiros: 3, planilhas: 4 },
  componente_orcamento: { pre_fixado: 1, pos_fixado: 2 },
};

/** Código da tela → código neutro (null: o código não existe na lista). */
export function codigoNeutro(lista: ListaDominioContratualizacao, codigoTela: number): string | null {
  const m = CODIGOS_TELA[lista];
  if (!m) return null;
  return Object.entries(m).find(([, n]) => n === codigoTela)?.[0] ?? null;
}

/** Código neutro → código da tela (null: fora do vocabulário). */
export function codigoDaTela(lista: ListaDominioContratualizacao, codigoNeutro: string): number | null {
  return CODIGOS_TELA[lista]?.[codigoNeutro] ?? null;
}

/** Meses da periodicidade da tela; o inverso escolhe o código da tela pelo número de meses. */
export function periodicidadeDosMeses(meses: number): number | null {
  return PERIODICIDADES_META_SUS.find((p) => p.meses === meses)?.codigo ?? null;
}

/** Formato da resposta do indicador (meta_contratual_sus.formato_resposta) ↔ o código da tela. */
export const FORMATO_DA_TELA: Readonly<Record<number, 'sim_nao' | 'numero' | 'inteiro'>> = {
  2: 'sim_nao',
  6: 'numero',
  7: 'inteiro',
};
export const FORMATO_DO_BANCO: Readonly<Record<string, number>> = { sim_nao: 2, numero: 6, inteiro: 7 };

/** A origem do realizado da apuração (afericao_meta_sus.origem_realizado) ↔ o código do contrato. */
export const ORIGEM_REALIZADO_DO_CONTRATO = {
  'faturamento-sus': 'faturamento_sus',
  'contas-sus': 'contas_sus',
  informado: 'informado',
} as const;
export const ORIGEM_REALIZADO_DO_BANCO: Readonly<Record<string, keyof typeof ORIGEM_REALIZADO_DO_CONTRATO>> =
  {
    faturamento_sus: 'faturamento-sus',
    contas_sus: 'contas-sus',
    informado: 'informado',
  };

/** A fonte da aferição gravada na meta (meta_contratual_sus.fonte_afericao) a partir da escolha da tela. */
export const FONTE_AFERICAO_DA_TELA: Readonly<Record<number, string>> = {
  1: 'indicador',
  2: 'sistema_externo',
  3: 'sistema_externo',
  4: 'manual',
};

/** Nível da SIGTAP da tela ↔ meta_contratual_sus.nivel_sigtap. */
export const NIVEL_DO_BANCO: Readonly<Record<string, 'grupo' | 'subgrupo' | 'forma' | 'procedimento'>> = {
  grupo: 'grupo',
  subgrupo: 'subgrupo',
  forma_organizacao: 'forma',
  procedimento: 'procedimento',
};
export const NIVEL_DA_TELA: Readonly<Record<string, string>> = {
  grupo: 'grupo',
  subgrupo: 'subgrupo',
  forma: 'forma_organizacao',
  procedimento: 'procedimento',
};

/** Modalidade da tela ↔ código da lista "modalidade" da tabela unificada (dominio_sigtap). */
export const MODALIDADE_SIGTAP: Readonly<Record<'ambulatorial' | 'hospitalar', string>> = {
  ambulatorial: '01',
  hospitalar: '02',
};

/** Situação do contrato no banco ↔ na tela (o rascunho e o cancelado do modelo não vêm da tela). */
export const SITUACAO_DA_TELA = { ativo: 'vigente', encerrado: 'encerrado' } as const;

export interface ItemCargaContratualizacao {
  readonly lista: ListaDominioContratualizacao;
  readonly codigo: string;
  readonly descricao: string;
  readonly mesesPeriodo: number | null;
  readonly ordem: number;
}

const rotulos = <T extends { readonly codigo: number; readonly rotulo: string }>(
  lista: ListaDominioContratualizacao,
  itens: readonly T[],
  meses?: (x: T) => number | null,
): ItemCargaContratualizacao[] =>
  itens.flatMap((x, i) => {
    const codigo = codigoNeutro(lista, x.codigo);
    return codigo
      ? [{ lista, codigo, descricao: x.rotulo, mesesPeriodo: meses?.(x) ?? null, ordem: i + 1 }]
      : [];
  });

/**
 * A carga padrão das listas (as que a tela usa), com o rótulo do produto. Pedido ao "criar cliente"; o teste de
 * integração garante as mesmas linhas no cliente de teste.
 */
export const CARGA_DOMINIOS_CONTRATUALIZACAO: readonly ItemCargaContratualizacao[] = [
  ...rotulos('esfera', ESFERAS_CONTRATO_SUS),
  ...rotulos('rede_assistencial', REDES_ASSISTENCIA_SUS),
  ...rotulos('periodicidade', PERIODICIDADES_META_SUS, (p) => p.meses),
  ...rotulos('tipo_indicador', TIPOS_INDICADOR_SUS),
  ...rotulos('complexidade', COMPLEXIDADES_SUS),
  ...rotulos('escore', ESCORES_SUS),
  ...rotulos('tipo_afericao', AFERICOES_SUS),
  ...rotulos('componente_orcamento', TIPOS_ORCAMENTO_SUS),
  ...rotulos('tipo_item_indicador', [
    { codigo: 2, rotulo: 'Sim ou não' },
    { codigo: 6, rotulo: 'Valor decimal' },
    { codigo: 7, rotulo: 'Valor inteiro' },
  ]),
];
