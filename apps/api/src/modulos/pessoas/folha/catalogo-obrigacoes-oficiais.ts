// O catálogo oficial das obrigações acessórias trabalhistas e previdenciárias (fecho-1, família
// folha-ferias-obrigacoes; decisão do orquestrador pela prática de mercado). É o carregador VERSIONADO por edição: cada
// edição lista as obrigações com o ato normativo de origem, a vigência e, para as encerradas, o ato e a data da
// substituição. Dado público de fonte oficial (regra 7): os atos citados (leis, decretos, instruções normativas e
// portarias publicados no Diário Oficial da União); nada vem da cópia de um cliente.
//   - Vigentes: eSocial, EFD-Reinf, DCTFWeb e FGTS Digital.
//   - Encerradas (substituídas): SEFIP/GFIP, CAGED e RAIS. Ficam só para histórico e consulta das obrigações já
//     registradas: o sistema não gera mais o arquivo delas (a geração recusa com 409 `obrigacao-encerrada`).
// Nova edição: acrescente uma entrada em EDICOES_OBRIGACOES_OFICIAIS (nunca altere uma edição publicada); a vigente é a
// mais recente cuja data de publicação alcança a data de referência. Sem catálogo no banco a carregar: a leitura nunca
// fica pendente (o antigo 409 `catalogo-pendente` deixou de existir).
import type { TipoObrigacao } from '@sgh/contratos';
import { recusa } from '@sgh/nucleo';

export type CodigoObrigacaoOficial =
  'esocial' | 'efd-reinf' | 'dctfweb' | 'fgts-digital' | 'sefip' | 'caged' | 'rais';

export interface ObrigacaoAcessoriaOficial {
  readonly codigo: CodigoObrigacaoOficial;
  readonly nome: string;
  /** Órgão gestor. */
  readonly orgao: string;
  /** Ato normativo que institui a obrigação. */
  readonly baseLegal: string;
  /** AAAA-MM-DD: início da obrigatoriedade (primeira fase). */
  readonly vigenciaInicio: string;
  /** AAAA-MM-DD: fim da exigência (substituição); null na vigente. */
  readonly encerradaEm: string | null;
  /** O ato da substituição (só na encerrada). */
  readonly atoEncerramento: string | null;
  /** As obrigações que a substituíram (só na encerrada). */
  readonly substituidaPor: readonly CodigoObrigacaoOficial[];
  /** O tipo de obrigação da folha correspondente (contrato), quando a folha registra a obrigação. */
  readonly tipoNaFolha: TipoObrigacao | null;
  /** O sistema gera a obrigação (o arquivo ou a apuração). Encerrada nunca tem gerador. */
  readonly geradaPeloSistema: boolean;
}

export interface EdicaoObrigacoesOficiais {
  /** AAAA-MM: a edição do catálogo. */
  readonly edicao: string;
  /** AAAA-MM-DD: a partir de quando a edição vale. */
  readonly publicadaEm: string;
  readonly obrigacoes: readonly ObrigacaoAcessoriaOficial[];
}

export type SituacaoObrigacaoOficial = 'vigente' | 'encerrada' | 'futura';

/** O catálogo lido numa data: a edição e cada obrigação com a situação na data. */
export interface CatalogoObrigacoesOficiais {
  readonly edicao: string;
  readonly data: string;
  readonly obrigacoes: readonly (ObrigacaoAcessoriaOficial & {
    readonly situacao: SituacaoObrigacaoOficial;
  })[];
}

const EDICAO_2026_11: EdicaoObrigacoesOficiais = {
  edicao: '2026-11',
  publicadaEm: '2026-11-01',
  obrigacoes: [
    {
      codigo: 'esocial',
      nome: 'eSocial (Sistema de Escrituração Digital das Obrigações Fiscais, Previdenciárias e Trabalhistas)',
      orgao: 'Governo Federal (Receita Federal, MTE, INSS e Caixa)',
      baseLegal: 'Decreto 8.373/2014',
      vigenciaInicio: '2018-01-08',
      encerradaEm: null,
      atoEncerramento: null,
      substituidaPor: [],
      tipoNaFolha: null,
      geradaPeloSistema: true,
    },
    {
      codigo: 'efd-reinf',
      nome: 'EFD-Reinf (Escrituração Fiscal Digital de Retenções e Outras Informações Fiscais)',
      orgao: 'Receita Federal',
      baseLegal: 'IN RFB 2.043/2021',
      vigenciaInicio: '2018-05-01',
      encerradaEm: null,
      atoEncerramento: null,
      substituidaPor: [],
      tipoNaFolha: null,
      geradaPeloSistema: false,
    },
    {
      codigo: 'dctfweb',
      nome: 'DCTFWeb (Declaração de Débitos e Créditos Tributários Federais Previdenciários e de Outras Entidades e Fundos)',
      orgao: 'Receita Federal',
      baseLegal: 'IN RFB 2.005/2021',
      vigenciaInicio: '2018-08-01',
      encerradaEm: null,
      atoEncerramento: null,
      substituidaPor: [],
      tipoNaFolha: null,
      geradaPeloSistema: false,
    },
    {
      codigo: 'fgts-digital',
      nome: 'FGTS Digital (apuração e guia do FGTS)',
      orgao: 'Ministério do Trabalho e Emprego',
      baseLegal: 'Lei 8.036/1990, art. 17-A, na redação da Lei 14.438/2022',
      vigenciaInicio: '2024-03-01',
      encerradaEm: null,
      atoEncerramento: null,
      substituidaPor: [],
      tipoNaFolha: 'fgts-digital',
      geradaPeloSistema: true,
    },
    {
      codigo: 'sefip',
      nome: 'SEFIP/GFIP (Sistema Empresa de Recolhimento do FGTS e Informações à Previdência Social)',
      orgao: 'Caixa e Receita Federal',
      baseLegal: 'Lei 8.212/1991, art. 32, IV; Lei 8.036/1990',
      vigenciaInicio: '1999-01-01',
      encerradaEm: '2024-03-01',
      atoEncerramento:
        'Lei 14.438/2022 e Portaria MTE 240/2024 (FGTS pelo FGTS Digital); IN RFB 2.005/2021 (previdência pela DCTFWeb)',
      substituidaPor: ['fgts-digital', 'dctfweb', 'esocial'],
      tipoNaFolha: 'sefip',
      geradaPeloSistema: false,
    },
    {
      codigo: 'caged',
      nome: 'CAGED (Cadastro Geral de Empregados e Desempregados)',
      orgao: 'Ministério do Trabalho e Emprego',
      baseLegal: 'Lei 4.923/1965',
      vigenciaInicio: '1965-12-23',
      encerradaEm: '2020-01-01',
      atoEncerramento: 'Portaria SEPRT 1.127/2019 (substituído pelo eSocial)',
      substituidaPor: ['esocial'],
      tipoNaFolha: 'caged',
      geradaPeloSistema: false,
    },
    {
      codigo: 'rais',
      nome: 'RAIS (Relação Anual de Informações Sociais)',
      orgao: 'Ministério do Trabalho e Emprego',
      baseLegal: 'Decreto 76.900/1975',
      vigenciaInicio: '1976-01-01',
      encerradaEm: '2019-01-01',
      atoEncerramento: 'Portaria SEPRT 1.127/2019 (substituída pelo eSocial a partir do ano-base 2019)',
      substituidaPor: ['esocial'],
      tipoNaFolha: 'rais',
      geradaPeloSistema: false,
    },
  ],
};

/** As edições publicadas, da mais antiga para a mais recente (só se acrescenta). */
export const EDICOES_OBRIGACOES_OFICIAIS: readonly EdicaoObrigacoesOficiais[] = Object.freeze([
  EDICAO_2026_11,
]);

/** A edição vigente na data (a mais recente publicada até ela; antes da primeira, a primeira). */
export function edicaoObrigacoesNa(
  data: string,
  edicoes: readonly EdicaoObrigacoesOficiais[] = EDICOES_OBRIGACOES_OFICIAIS,
): EdicaoObrigacoesOficiais {
  const publicadas = edicoes.filter((e) => e.publicadaEm <= data);
  return publicadas[publicadas.length - 1] ?? edicoes[0]!;
}

/** A situação da obrigação na data: futura antes do início, encerrada a partir da substituição, vigente entre os dois. */
export function situacaoObrigacaoNa(o: ObrigacaoAcessoriaOficial, data: string): SituacaoObrigacaoOficial {
  if (o.encerradaEm !== null && data >= o.encerradaEm) return 'encerrada';
  if (data < o.vigenciaInicio) return 'futura';
  return 'vigente';
}

/** O catálogo da edição vigente na data, com a situação de cada obrigação. */
export function catalogoObrigacoesNa(
  data: string,
  edicoes: readonly EdicaoObrigacoesOficiais[] = EDICOES_OBRIGACOES_OFICIAIS,
): CatalogoObrigacoesOficiais {
  const e = edicaoObrigacoesNa(data, edicoes);
  return {
    edicao: e.edicao,
    data,
    obrigacoes: e.obrigacoes.map((o) => ({ ...o, situacao: situacaoObrigacaoNa(o, data) })),
  };
}

/**
 * Exige que o tipo da folha tenha gerador no catálogo da data: a obrigação encerrada (SEFIP, CAGED e RAIS) recusa com
 * 409 `obrigacao-encerrada` (só histórico e consulta), dizendo o que a substituiu.
 */
export function exigirObrigacaoComGerador(catalogo: CatalogoObrigacoesOficiais, tipo: TipoObrigacao): void {
  const o = catalogo.obrigacoes.find((x) => x.tipoNaFolha === tipo);
  if (o && o.geradaPeloSistema && o.situacao !== 'encerrada') return;
  const nomes = (o?.substituidaPor ?? []).join(', ');
  throw recusa(
    'obrigacao-encerrada',
    o
      ? `A obrigação ${o.codigo} está encerrada desde ${o.encerradaEm ?? o.vigenciaInicio} (${o.atoEncerramento ?? 'sem gerador no sistema'}): fica só para histórico e consulta${nomes ? `; use ${nomes}` : ''}.`
      : `O tipo de obrigação ${tipo} não está no catálogo oficial da edição ${catalogo.edicao}.`,
    { campos: ['tipo'] },
  );
}
