// Consultas dos catálogos oficiais por tela (ficha do M13, seções 4 e 7): cada item do menu mostra as tabelas do
// seu catálogo, em seções, com a busca por código ou trecho e, onde a tabela guarda competência SUS, o filtro
// por competência (AAAAMM). A parte física (tabela, colunas, filtros) mora em @sgh/legado
// (`catalogo/repositorios/catalogos.ts` e `consultas-referencia.ts`); um teste confere que as duas listas são
// as mesmas e que toda tabela do M13 tem consulta. A permissão de leitura é `catalogo.item.ler`, salvo onde a
// entidade declara outra (as posições do leiaute de CEP: `catalogo.leiaute.ler`, a da tela de leiautes).
import type { CodigoCatalogo } from './definicoes.js';

export interface EntidadeConsultaCatalogo {
  readonly codigo: string;
  readonly titulo: string;
  /** Seção do seletor de tabela na tela. */
  readonly secao: string;
  /** A tabela aceita o filtro por competência SUS (AAAAMM). */
  readonly competencia?: boolean;
  /** Permissão de leitura, quando não é `catalogo.item.ler`. */
  readonly permissao?: string;
}

export interface GrupoConsultaCatalogo {
  /** Catálogo do painel de cargas (responsável e edição no banco); null: tela sem carga. */
  readonly catalogo: CodigoCatalogo | null;
  readonly entidades: readonly EntidadeConsultaCatalogo[];
  /** Mapeamentos locais pelo CRUD genérico (recursos do domínio `catalogo`). */
  readonly dominios?: readonly string[];
}

type Linha = readonly [codigo: string, titulo: string, competencia?: 'competencia'];
const secao = (nome: string, ...linhas: readonly Linha[]): EntidadeConsultaCatalogo[] =>
  linhas.map(([codigo, titulo, comp]) => ({
    codigo,
    titulo,
    secao: nome,
    ...(comp ? { competencia: true } : {}),
  }));
const C = 'competencia' as const;

export const PERMISSAO_CONSULTA_CATALOGO = 'catalogo.item.ler';

export const GRUPOS_CONSULTA_CATALOGO: Readonly<Record<string, GrupoConsultaCatalogo>> = {
  tuss: {
    catalogo: 'tuss',
    dominios: ['tussTipoLancamento'],
    entidades: [
      ...secao(
        'Terminologias TUSS',
        ['motivoGlosa', 'Motivos de glosa (TUSS 38)'],
        ['cboAns', 'CBO da ANS (TUSS 24)'],
        ['materialTuss', 'Materiais e medicamentos TUSS'],
        ['procedimentoTuss', 'Procedimentos TUSS'],
        ['termoTiss', 'Terminologias TISS'],
        ['termoTipoLancamento', 'Terminologias por tipo de lançamento'],
        ['referenciaMatMedTuss', 'Referência de materiais e medicamentos × TUSS'],
        ['referenciaIndividualTuss', 'Códigos TUSS de referência individual'],
        ['formaEnvioTuss', 'Formas de envio por procedimento TUSS'],
      ),
      ...secao(
        'Versões TISS',
        ['versaoTiss', 'Versões TISS'],
        ['versaoTissPadrao', 'Versões do padrão TISS'],
        ['versaoTissMonitoramento', 'Versões TISS do monitoramento'],
        ['cboAnsVersao', 'CBO da ANS por versão TISS'],
      ),
      ...secao(
        'Domínios TISS',
        ['tissCapacidadeFuncional', 'Capacidade funcional'],
        ['tissCaraterAtendimento', 'Caráter do atendimento'],
        ['tissCategoriaDespesa', 'Categorias de despesa'],
        ['tissCoberturaEspecial', 'Coberturas especiais'],
        ['tissConselhoProfissional', 'Conselhos profissionais'],
        ['tissDiagnosticoImagem', 'Diagnóstico por imagem'],
        ['tissEstadiamentoTumor', 'Estadiamento do tumor'],
        ['tissEtapaAutorizacao', 'Etapas da autorização'],
        ['tissFinalidadeTratamento', 'Finalidades do tratamento'],
        ['tissFormaEnvioPadrao', 'Formas de envio (padrão)'],
        ['tissFormaPagamento', 'Formas de pagamento'],
        ['tissGrauParticipacao', 'Graus de participação'],
        ['tissGrupoProcedimento', 'Grupos de procedimento'],
        ['tissIdentificacaoBeneficiario', 'Identificação do beneficiário'],
        ['tissIndicadorAcidente', 'Indicador de acidente'],
        ['tissLocalEvento', 'Local do evento'],
        ['tissMetastase', 'Metástase'],
        ['tissMotivoAusenciaValidacao', 'Motivos de ausência do código de validação'],
        ['tissNodulo', 'Nódulo'],
        ['tissOpcaoFabricante', 'Opção de fabricante'],
        ['tissPosicaoProfissional', 'Posição do profissional'],
        ['tissRegimeAtendimento', 'Regimes de atendimento'],
        ['tissRegimeInternacao', 'Regimes de internação'],
        ['tissSaudeOcupacional', 'Saúde ocupacional'],
        ['tissSituacaoCancelamento', 'Situações de cancelamento'],
        ['tissSituacaoProtocolo', 'Situações do protocolo'],
        ['tissSituacaoSolicitacao', 'Situações da solicitação'],
        ['tissTipoAcomodacao', 'Tipos de acomodação'],
        ['tissTipoAtendimento', 'Tipos de atendimento por versão TISS'],
        ['tissTipoConsulta', 'Tipos de consulta'],
        ['tissTipoDebitoCredito', 'Tipos de débito e crédito'],
        ['tissTipoDemonstrativo', 'Tipos de demonstrativo'],
        ['tissTipoFaturamento', 'Tipos de faturamento'],
        ['tissTipoGuia', 'Tipos de guia'],
        ['tissTipoInternacao', 'Tipos de internação'],
        ['tissTipoQuimioterapia', 'Tipos de quimioterapia'],
        ['tissTumor', 'Tumor'],
        ['tissUnidadeMedida', 'Unidades de medida'],
        ['tissViaAcesso', 'Vias de acesso'],
        ['tissViaAdministracao', 'Vias de administração'],
      ),
    ],
  },
  sigtap: {
    catalogo: 'sigtap',
    dominios: ['regionalSaude', 'fabricanteOpm'],
    entidades: [
      ...secao(
        'Procedimentos e valores',
        ['procedimento', 'Procedimentos SIGTAP', C],
        ['valorSigtap', 'Valores por competência', C],
        ['retratoSigtap', 'Retratos por competência', C],
      ),
      ...secao(
        'Compatibilidades e relações',
        ['procedimentoCid', 'Procedimento × CID', C],
        ['procedimentoCbo', 'Procedimento × CBO', C],
        ['cidSecundario', 'Procedimento × CID secundário', C],
        ['apacSecundario', 'Procedimento principal × secundário (APAC)', C],
        ['atributoProcedimento', 'Procedimento × atributo complementar', C],
        ['classificacaoProcedimento', 'Procedimento × classificação do serviço', C],
        ['compatibilidadeRegistro', 'Compatibilidade entre procedimentos', C],
        ['modalidadeProcedimento', 'Procedimento × modalidade', C],
        ['origemProcedimento', 'Procedimento × origem'],
        ['servicoProcedimento', 'Procedimento × serviço'],
        ['habilitacaoProcedimento', 'Procedimento × habilitação', C],
        ['leitoProcedimento', 'Procedimento × especialidade de leito', C],
        ['localProcedimento', 'Procedimento × local'],
        ['nivelProcedimento', 'Procedimento × nível de hierarquia'],
        ['registroProcedimento', 'Procedimento × instrumento de registro', C],
        ['registroCompetencia', 'Instrumento de registro por competência', C],
        ['opmProcedimento', 'Procedimento × órteses, próteses e materiais', C],
      ),
      ...secao(
        'Domínios SUS',
        ['alteracaoSus', 'Tipos de alteração'],
        ['atributoComplementar', 'Atributos complementares', C],
        ['caraterAtendimento', 'Caráter de atendimento'],
        ['classificacaoServico', 'Classificações de serviço', C],
        ['complexidadeSus', 'Complexidades'],
        ['fonteOrcamentaria', 'Fontes orçamentárias'],
        ['formaOrganizacao', 'Formas de organização', C],
        ['grupoHabilitacao', 'Grupos de habilitação'],
        ['grupoSus', 'Grupos', C],
        ['habilitacaoSus', 'Habilitações', C],
        ['localSus', 'Locais'],
        ['localPrioritario', 'Locais prioritários'],
        ['modalidade', 'Modalidades de atendimento', C],
        ['motivoCobranca', 'Motivos de cobrança'],
        ['nivelSus', 'Níveis de hierarquia'],
        ['registroSus', 'Instrumentos de registro', C],
        ['servicoSus', 'Serviços'],
        ['servicoClassificacao', 'Serviços especializados', C],
        ['servicoPrestado', 'Serviços prestados'],
        ['subgrupoSus', 'Subgrupos', C],
        ['subtipoFinanciamento', 'Subtipos de financiamento', C],
        ['tipoApac', 'Tipos de APAC'],
        ['tipoAtendimento', 'Tipos de atendimento'],
        ['tipoFinanciamento', 'Tipos de financiamento', C],
        ['tipoLeito', 'Tipos de leito', C],
        ['drs', 'Regionais de saúde (DRS)'],
        ['fabricanteOpm', 'Fabricantes de OPM'],
      ),
      ...secao(
        'Tabelas anteriores à tabela unificada',
        ['cidProcedimentoAnterior', 'CID por procedimento'],
        ['cidCompativelAnterior', 'CID compatível'],
        ['habilitacaoCompativelAnterior', 'Habilitação compatível'],
        ['materialCompativelAnterior', 'Material compatível'],
        ['servicoProcedimentoAnterior', 'Serviço e classificação por procedimento'],
        ['servicoFaturamentoAnterior', 'Serviço e classificação no faturamento'],
        ['faixaEtariaProcedimentoAnterior', 'Faixa etária por procedimento'],
        ['grupoProcedimentoAnterior', 'Grupo por procedimento'],
        ['motivoCobrancaProcedimentoAnterior', 'Motivo de cobrança por procedimento'],
        ['incrementoProcedimento', 'Incremento por habilitação'],
        ['grupoAihAnterior', 'Grupos de AIH'],
        ['habilitacaoAnterior', 'Habilitações'],
        ['classificacaoServicoAnterior', 'Classificações de serviço'],
        ['codigoServicoAnterior', 'Serviços'],
        ['itemProcedimentoAnterior', 'Itens de procedimento'],
        ['grupoAtendimentoAnterior', 'Grupos de atendimento'],
        ['faixaEtariaAnterior', 'Faixas etárias'],
        ['nivelAnterior', 'Níveis'],
      ),
      ...secao(
        'Tabelas descontinuadas',
        ['apacPrincipalDescontinuada', 'APAC: principal × secundário'],
        ['procedimentoPreDescontinuada', 'Procedimento × pré-requisito'],
        ['procedimentoAihDescontinuada', 'Procedimentos de AIH'],
        ['procedimentoSiaDescontinuada', 'Procedimentos ambulatoriais'],
        ['valorAihDescontinuada', 'Valores de AIH'],
        ['valorSiaDescontinuada', 'Valores ambulatoriais'],
        ['sipacDescontinuada', 'Tabela SIPAC'],
        ['siphosDescontinuada', 'Tabela SIPAC por hospital'],
        ['atoAihDescontinuada', 'Atos de AIH'],
        ['associacaoDescontinuada', 'Associações'],
      ),
    ],
  },
  cid: {
    catalogo: 'cid',
    entidades: [
      ...secao(
        'CID-10, CIAP e CID-O',
        ['cid10', 'CID-10'],
        ['ciap', 'CIAP-2'],
        ['cidMorfologia', 'CID-O (morfologia)'],
        ['retratoCid', 'Retratos do CID-10'],
        ['retratoCiap', 'Retratos da CIAP-2'],
        ['versaoCid', 'Versões da CID-10'],
        ['versaoCiap', 'Versões da CIAP'],
      ),
      ...secao(
        'CBARA (reações adversas)',
        ['cbara', 'CBARA: agentes'],
        ['cbaraCategoria', 'CBARA: categorias'],
        ['cbaraClassificacao', 'CBARA: classificação da reação'],
        ['cbaraReacao', 'CBARA: reações adversas'],
        ['cbaraOrigem', 'CBARA: origem da informação'],
        ['cbaraSeveridade', 'CBARA: severidade'],
        ['cbaraNotificacao', 'CBARA: notificação por severidade'],
        ['versaoCbara', 'Versões da CBARA'],
      ),
    ],
  },
  enderecos: {
    catalogo: 'cep',
    entidades: secao(
      'Endereços',
      ['cep', 'CEP'],
      ['cepSus', 'CEP (cópia SUS)'],
      ['municipio', 'Municípios (IBGE)'],
      ['uf', 'Unidades da federação'],
      ['pais', 'Países'],
      ['nacionalidade', 'Nacionalidades'],
      ['nacionalidadeSped', 'Nacionalidades (SPED)'],
      ['ddd', 'DDD'],
      ['tipoLogradouro', 'Tipos de logradouro'],
    ),
  },
  cbo: {
    catalogo: 'cbo',
    entidades: secao('Ocupações', ['cbo', 'CBO'], ['ocupacao', 'Ocupações'], ['emissora', 'Emissoras']),
  },
  dcb: {
    catalogo: 'listas',
    entidades: secao(
      'Listas oficiais',
      ['dcb', 'DCB'],
      ['fabricante', 'Fabricantes'],
      ['banco', 'Bancos'],
      ['atividade', 'Atividades econômicas'],
    ),
  },
  fiscal: {
    catalogo: 'fiscal',
    entidades: secao(
      'Tabelas fiscais e SPED',
      ['cfop', 'CFOP'],
      ['itemServico', 'Itens da lista de serviços'],
      ['genero', 'Gêneros do item'],
      ['tipoDocumento', 'Tipos de documento fiscal'],
      ['cstCofins', 'CST da COFINS'],
      ['cstPis', 'CST do PIS'],
      ['naturezaCredito', 'Natureza do crédito'],
      ['indicadorOperacao', 'Indicador do tipo de operação'],
      ['naturezaRetencao', 'Natureza da retenção na fonte'],
      ['condicaoPj', 'Condição da pessoa jurídica'],
      ['naturezaReceita', 'Natureza da receita'],
      ['imunidadeIssqn', 'Imunidades do ISSQN'],
      ['codigoReceita', 'Códigos de receita'],
      ['codigoRecolhimento', 'Códigos de recolhimento'],
      ['indicadorOperacaoNf', 'Indicador de operação da nota fiscal'],
      ['indicadorNif', 'Indicador do NIF'],
      ['tipoCredor', 'Tipos de credor'],
    ),
  },
  // M51 (etapa 4): os domínios dos leiautes do SIH e do SIA.
  dominiosSus: {
    catalogo: 'dominiosSus',
    entidades: secao(
      'Domínios do SIH e do SIA',
      ['tipoUtiSih', 'Tipos de UTI'],
      ['classificacaoDiagnostico', 'Classificação do diagnóstico'],
      ['justificativaSemIdentificacao', 'Justificativa do paciente sem identificação'],
      ['caracteristicaTratamentoSia', 'Característica do tratamento'],
      ['contraindicacaoTransplanteSia', 'Contraindicação a transplante'],
      ['situacaoTransplanteSia', 'Situação de transplante'],
      ['acessoVascularSia', 'Acesso vascular'],
    ),
  },
  // M54.3: as tabelas de código e nome do SPED contábil.
  spedContabil: {
    catalogo: 'spedContabil',
    entidades: secao(
      'Tabelas do SPED contábil',
      ['tipoItemSped', 'Tipos de item'],
      ['naturezaPjSped', 'Natureza da pessoa jurídica'],
      ['situacaoEspecialSped', 'Situação especial'],
      ['atividadePreponderanteSped', 'Atividade preponderante'],
    ),
  },
  leiautes: {
    catalogo: null,
    dominios: ['leiauteCep'],
    entidades: [
      {
        codigo: 'leiautePosicao',
        titulo: 'Posições do leiaute de CEP',
        secao: 'Leiaute de CEP',
        permissao: 'catalogo.leiaute.ler',
      },
    ],
  },
};

const PORCODIGO: ReadonlyMap<string, EntidadeConsultaCatalogo> = new Map(
  Object.values(GRUPOS_CONSULTA_CATALOGO).flatMap((g) => g.entidades.map((e) => [e.codigo, e] as const)),
);

/** Todas as entidades consultáveis (nomes públicos da rota GET /api/catalogos/consulta/:entidade). */
export const ENTIDADES_CONSULTA_CATALOGO: readonly string[] = [...PORCODIGO.keys()];

/** A entidade declarada (null para nome desconhecido, inclusive os herdados de Object). */
export function entidadeConsultaCatalogo(codigo: string): EntidadeConsultaCatalogo | null {
  return PORCODIGO.get(codigo) ?? null;
}

/** Permissão de leitura da entidade (a tela e a API usam a mesma). */
export function permissaoConsultaCatalogo(codigo: string): string {
  return entidadeConsultaCatalogo(codigo)?.permissao ?? PERMISSAO_CONSULTA_CATALOGO;
}
