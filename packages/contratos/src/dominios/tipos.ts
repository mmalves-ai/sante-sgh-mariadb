// CRUD genérico (M08; cap-09 §9.5; roteiro 4.8 e 6.5): a DECLARAÇÃO de um domínio do legado tem duas
// partes que nascem juntas e um teste confere que casam (packages/dominio-config, declaracao.ts):
//   - a parte PÚBLICA (aqui, em @sgh/contratos): módulo dono, recurso exposto, rótulos, item da árvore,
//     natureza, ações e as opções de menu do legado (menu de origem) que concedem cada ação; dela saem as
//     permissões `<modulo>.<recurso>.<acao>` (permissoes/dominios.ts) e o índice das telas;
//   - a parte FÍSICA (em @sgh/legado, no grupo dono: `<grupo>/cadastros/<recurso>.ts`): tabela, chave,
//     colunas com tipo, tamanho em bytes CP1252, rótulo, estratégia de código, letra de situação, triggers.
// Nenhum nome de tabela do legado aparece aqui (fronteira): a tela e a API falam pelo `recurso`.
import { z } from 'zod';
import { SUBITENS_M54 } from './dominios-m54.gerado.js';
import { SUBITENS_M56 } from './dominios-m56.gerado.js';
import { SUBITENS_M14 } from './subitens-m14.js';

/** Natureza do domínio na declaração (cap-10 §10.8; regra 5 do M08). */
export const NATUREZAS_DOMINIO = [
  /** O legado inclui e altera (e às vezes inativa) por tela: o novo grava pela receita genérica. */
  'editavel',
  /** Dado de sistema do fornecedor: trigger do legado recusa INSERT/UPDATE/DELETE. Só consulta. */
  'sistema',
  /** Catálogo de fonte oficial (carga-referencia): só consulta; quem grava é o importador (M13). */
  'carga-referencia',
  /** Enumeração interna (dia da semana e afins): só consulta. */
  'enumeracao',
  /**
   * M14 (regra 6): domínio TRAVADO — o código do banco (trigger ou procedure) lê os códigos da lista, ou a
   * ficha o declara (situação de agenda, checagem, tipos de lançamento…): só consulta; mudança fica fora do
   * cadastro genérico.
   */
  'travado',
] as const;
export type NaturezaDominio = (typeof NATUREZAS_DOMINIO)[number];

/**
 * W0-02: `excluir` é a exclusão física (só no domínio que a declara, com o verificador de dependências: D-CRUD-ORFAOS).
 * A reativação usa a permissão de `inativar` (quem inativa desfaz a inativação).
 */
export const ACOES_DOMINIO = ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'] as const;
export type AcaoDominio = (typeof ACOES_DOMINIO)[number];

/**
 * W0-02: categoria do domínio na matriz de governança (planejamento/crud/matriz-governanca.md, linha "Tabelas de domínio,
 * parâmetros, regras e formulários" e "Convivência com o legado que apaga"):
 *   - `dominio`: item de domínio; já referenciado, inativa; nunca usado, exclusão física admitida, com log;
 *   - `ligacao`: tabela de ligação ou de vínculo (chave composta): a linha é apagada como o cadastro anterior apaga;
 *   - `cadastro-mestre`: cadastro com histórico (regra 6 do dono): inativa; exclusão só do incluído por engano, sem vínculo;
 *   - `agenda-rascunho`: agenda, rascunho, conta aberta, pedido sem desdobramento: exclusão admitida, com log;
 *   - `regra-apoio-decisao` e `formulario`: só inativação, cada alteração gera nova versão (ECF.14.07 d, ECF.07.35 c):
 *     o motor recusa a ação `excluir` (CATEGORIAS_SEM_EXCLUSAO).
 */
export const CATEGORIAS_MATRIZ = [
  'dominio',
  'ligacao',
  'cadastro-mestre',
  'agenda-rascunho',
  'regra-apoio-decisao',
  'formulario',
] as const;
export type CategoriaMatriz = (typeof CATEGORIAS_MATRIZ)[number];
/** W0-02: categorias em que a exclusão física é proibida pela matriz (só inativação, com nova versão). */
export const CATEGORIAS_SEM_EXCLUSAO: readonly CategoriaMatriz[] = ['regra-apoio-decisao', 'formulario'];
/**
 * W0-02 (D-CRUD-SNAP): categorias protegidas por padrão — antes da exclusão física, a linha inteira vai ao retrato
 * (SGH_HIST_EXCLUSAO) na mesma transação. A parte física da declaração pode marcar outras (`exclusao.protegida`).
 */
export const CATEGORIAS_PROTEGIDAS: readonly CategoriaMatriz[] = ['cadastro-mestre', 'ligacao', 'dominio'];

/** Subitens da árvore `Cadastros > Domínios e tabelas auxiliares (CRUD genérico)` (ids do menu gerado). */
export const SUBITENS_DOMINIOS = {
  demograficos: 'cadastros.dominios-e-tabelas-auxiliares-crud-generico.demograficos-documentos-e-endereco',
  agenda: 'cadastros.dominios-e-tabelas-auxiliares-crud-generico.agenda-recepcao-e-atendimento',
  internacao: 'cadastros.dominios-e-tabelas-auxiliares-crud-generico.internacao-leitos-e-centro-cirurgico',
  clinicos: 'cadastros.dominios-e-tabelas-auxiliares-crud-generico.clinicos-prescricao-e-pep',
  hotelaria: 'cadastros.dominios-e-tabelas-auxiliares-crud-generico.hotelaria-e-administracao',
  // M11: os domínios do cadastro de profissionais e de especialidades moram nos itens próprios da árvore.
  profissionais: 'cadastros.profissionais.profissionais-registros-cbo-conselho-e-especialidades',
  prestadores: 'cadastros.profissionais.prestadores-de-servico-terceiros',
  especialidades: 'cadastros.especialidades-e-procedimentos-por-especialidade',
  // M12: classificações oncológicas de operadora (CRUD genérico dentro de Convênios e contratos).
  oncologia: 'cadastros.convenios-e-contratos.classificacoes-oncologicas-de-operadora',
  // M10: estrutura (Cadastros › Estrutura), privacidade e dados fiscais (Administração).
  estruturaUnidades: 'cadastros.estrutura.rede-empresa-hospital-e-unidades-cnes',
  estruturaCentrosCusto: 'cadastros.estrutura.centros-de-custo-e-clinicas',
  estruturaLeitos: 'cadastros.estrutura.blocos-acomodacoes-e-leitos',
  estruturaLocais: 'cadastros.estrutura.locais-de-atendimento-guiches-feriados-prioridades',
  estruturaLocaisConta: 'cadastros.estrutura.locais-de-conta-e-unidades-de-consumo',
  privacidade: 'administracao.auditoria-e-privacidade.lgpd-consentimentos-titulares-e-anonimizacao',
  dadosFiscais: 'administracao.organizacao-e-parametros.dados-fiscais-da-empresa',
  // M13: mapeamentos locais dos catálogos oficiais (CRUD genérico dentro das telas dos catálogos) e os
  // leiautes de importação da base de CEP.
  tuss: 'cadastros.catalogos-oficiais-importadores.tiss-tuss-e-terminologias-da-ans',
  sigtap: 'cadastros.catalogos-oficiais-importadores.sus-sigtap-compatibilidades-e-dominios',
  leiautesCep: 'administracao.integracoes.leiautes-de-importacao-cep',
  // M14: os itens dos ramos do marco e os itens das Fases 5 e 6 com domínios de RH (gerados do lote).
  ...SUBITENS_M14,
  // M22: cadastros do PEP (tipos de documento, fluxos de situação e avisos; vínculo modelo × especialidade).
  pepAdmin: 'pep.administracao-do-pep.tipos-de-documento-fluxos-de-situacao-e-avisos',
  // M23: os cadastros de dieta (nutrição clínica e serviço de nutrição e dietética da hotelaria).
  nutricaoClinica: 'multiprofissional.nutricao-clinica.dietas-caracteristicas-e-horarios-de-refeicao',
  nutricaoHotelaria: 'hotelaria-e-apoio.servico-de-nutricao-e-dietetica.dietas-e-tipos-de-dieta',
  // M24: cadastros de prescrição no CRUD genérico (os demais têm tela própria de consulta na prescrição).
  prescricaoLocais: 'cadastros.cadastros-clinicos-e-de-prescricao.locais-de-assistencia',
  prescricaoPerguntas: 'cadastros.cadastros-clinicos-e-de-prescricao.perguntas-enviadas-a-operadora',
  prescricaoHemocomponentes: 'cadastros.cadastros-clinicos-e-de-prescricao.hemocomponentes-prescritiveis',
  // M24 (P-CAD-1): os demais cadastros de prescrição no CRUD genérico, abertos também das telas próprias.
  prescricaoFrequencias:
    'cadastros.cadastros-clinicos-e-de-prescricao.frequencias-horarios-relativos-e-formulas-de-dose',
  prescricaoKits: 'cadastros.cadastros-clinicos-e-de-prescricao.kits-de-medicamentos-e-de-solucoes',
  prescricaoNaoPadronizados: 'cadastros.cadastros-clinicos-e-de-prescricao.itens-nao-padronizados',
  prescricaoParametrosItem:
    'cadastros.cadastros-clinicos-e-de-prescricao.parametros-clinicos-e-fiscais-do-item',
  prescricaoProtocolos: 'cadastros.cadastros-clinicos-e-de-prescricao.protocolos-de-prescricao',
  prescricaoReceitas: 'cadastros.cadastros-clinicos-e-de-prescricao.receitas-padrao',
  prescricaoInteracoes: 'farmacia-clinica.interacoes-medicamentosas-e-validacao-de-dose',
  prescricaoHorarios: 'enfermagem.horarios-padrao-de-medicacao-por-unidade',
  // M19: recepção, senhas, totens e painéis (os cadastros moram nos itens de Recepção › Senhas e filas e no item de
  // painéis de TV de Relatórios e BI).
  recepcaoGeradores: 'recepcao.senhas-e-filas.geradores-de-senha-e-totem-prioridades-legais',
  recepcaoRecepcoes: 'recepcao.senhas-e-filas.recepcoes-e-setores-de-senha',
  recepcaoPaineis: 'recepcao.senhas-e-filas.paineis-de-chamada-tv-com-voz',
  relatorioPaineisTv: 'relatorios-e-bi.paineis-de-tv-e-central-de-comando',
  // M26: os cadastros do SADT e do portal moram nos itens próprios de Diagnóstico e de Portais.
  sadtModalidades: 'diagnostico-sadt.imagem.modalidades-dicom-e-visualizadores',
  sadtMetodosGraficos: 'diagnostico-sadt.metodos-graficos-eco-endoscopia-hemodinamica',
  portalResultados: 'portais.portal-de-resultados-paciente-e-medico-externo',
  portalAutocadastro: 'portais.portal-do-medico-externo.autocadastro-de-medico-solicitante',
  // M21: os cadastros da higienização (áreas, profissionais, vínculos e materiais por tipo de limpeza).
  higienizacaoCadastros: 'hotelaria-e-apoio.higienizacao.areas-profissionais-e-tipos-de-limpeza',
  // M25: os procedimentos, cuidados e kits de enfermagem (o item de Enfermagem da árvore).
  enfermagemProcedimentos: 'enfermagem.procedimentos-cuidados-e-kits-de-enfermagem',
  // M34: o de-para do laboratório de apoio e das interfaces, os domínios das mensagens, da classificação externa e dos
  // webservices moram nos itens próprios (as telas de trabalho os abrem embutidos).
  apoioLaboratorio: 'diagnostico-sadt.laboratorio.laboratorio-de-apoio-envio-e-retorno',
  interfacesEquipamento: 'diagnostico-sadt.laboratorio.interfaces-de-equipamento',
  integracaoMensagens: 'administracao.integracoes.sms-e-whatsapp-confirmacoes',
  classificacaoExterna: 'pronto-atendimento.classificacao-de-risco-externa-transicao',
  integracaoWebservices: 'administracao.integracoes.endpoints-webservices-e-integrador',
  // M34: os itens com só consultas (as telas de trabalho as abrem embutidas): os relatórios e o envio de origem, as tabelas
  // da identificação de paciente e o registro da prescrição digital externa.
  relatoriosOrigem: 'relatorios-e-bi.catalogo-de-relatorios-parametrizados',
  envioAgendadoOrigem: 'relatorios-e-bi.envio-agendado-por-e-mail',
  integracaoFhir: 'administracao.integracoes.fhir-r4-rnds-e-identificacao-de-paciente',
  prescricaoDigital: 'pep.prescricao-medica-cpoe.prescricao-digital-externa',
  // M32: os cadastros e parâmetros financeiros, as naturezas de operação, a NFS-e, a escrituração, as ocorrências da
  // remessa e o de-para contábil moram nos itens próprios do Financeiro e da Controladoria.
  financeiroCadastros: 'financeiro.cadastros-financeiros-bancos-contas-formas-de-pagamento',
  financeiroParametros: 'financeiro.parametros-e-permissoes-financeiras',
  financeiroNaturezas: 'financeiro.fiscal.naturezas-de-operacao-e-orgaos-arrecadadores',
  financeiroNfse: 'financeiro.fiscal.nfs-e-nota-fiscal-de-servico',
  financeiroEscrituracao: 'financeiro.fiscal.escrituracao-de-entradas-sped-cfop-por-item',
  financeiroRemessa: 'financeiro.contas-a-pagar.pagamentos-eletronicos-remessa-e-retorno-bancario',
  financeiroContabil: 'controladoria.contabilidade.integracao-contabil-exportacao-ao-sistema-atual',
  // M33: os cadastros do repasse moram nos itens próprios do Repasse médico (as telas de trabalho os abrem).
  repasseRpa: 'faturamento.repasse-medico.rpa-emissao-inss-irrf-e-eventos',
  repasseIntegracao: 'faturamento.repasse-medico.integracao-contabil-do-repasse',
  repasseConfiguracoes: 'faturamento.repasse-medico.configuracoes-do-repasse',
  repasseCooperativas: 'faturamento.repasse-medico.cooperativas-e-credenciamento-medico',
  // M49 (etapa 3): os cadastros da assinatura digital (OIDs, tipos de OID e de certificado, formas dos provedores) moram
  // no item próprio de Administração › Assinatura digital (a tela de trabalho os abre embutidos).
  assinaturaCadastros: 'administracao.assinatura-digital.oids-tipos-de-certificado-e-formas-de-assinatura',
  // M50 (etapa 5): os domínios da portaria (tipos de visitante e de visitado, formas de identificação, situações de
  // acesso) e os dos terminais (tipos e fabricantes) moram nos itens próprios de Hotelaria e apoio › Portaria e
  // visitantes (as telas de trabalho os abrem embutidos).
  portariaCadastros: 'hotelaria-e-apoio.portaria-e-visitantes.cadastro-de-visitantes-e-cracha',
  portariaTerminais: 'hotelaria-e-apoio.portaria-e-visitantes.terminais-e-catracas',
  // M50 (etapa 6): as agendas de sessões e as cadeiras e salas moram no item próprio de Agenda › Agenda de sessões e
  // recursos (a tela de trabalho os abre embutidos).
  sessoesCadastros: 'agenda.agenda-de-sessoes-e-recursos-cadeiras-salas',
  // M47 (etapa 2): os cadastros da agência transfusional moram no item próprio de Diagnóstico › Agência transfusional
  // (com as consultas dos que ficam só em leitura).
  agenciaCadastros: 'diagnostico-sadt.agencia-transfusional.cadastros-e-parametros-da-agencia',
  // M51 (etapa 2): os médicos solicitantes SUS moram no item próprio de Faturamento › Faturamento SUS (a tela de trabalho
  // os abre embutidos, com a busca no cadastro geral de solicitantes).
  susSolicitantes: 'faturamento.faturamento-sus.medicos-solicitantes-sus',
  // M51 (etapa 4): os leitos de UTI habilitados moram no item AIH de Faturamento › Faturamento SUS (a tela da AIH os abre
  // embutidos, em /faturamento/sus/cadastros/leitos-uti).
  susLeitosUti: 'faturamento.faturamento-sus.aih-internacao-sih',
  // M48 (etapa 5): as autoridades sanitárias moram no item da notificação compulsória; os eixos e os graus da matriz
  // GUT, no item da matriz de riscos e não conformidades.
  qualidadeAgravos:
    'qualidade-e-seguranca.vigilancia-epidemiologica.notificacao-compulsoria-sinan-gatilho-por-cid',
  qualidadeGut: 'qualidade-e-seguranca.gestao-da-qualidade-ona.matriz-de-riscos-gut-e-nao-conformidades',
  // M56 (etapa F0): os domínios da operadora própria nos 7 itens da árvore da operadora (gerados por
  // `pnpm operadora:dominios`).
  // M54 (etapa 4): os cadastros da estrutura de custos moram no item próprio de Controladoria › Custos hospitalares (a
  // tela de trabalho /custos/centros os abre embutidos).
  custosCadastros: 'controladoria.custos-hospitalares.centros-de-custo-e-criterios-de-rateio',
  ...SUBITENS_M56,
  // M54 (etapa F1): os itens da controladoria com os cadastros genéricos (`pnpm contabil:dominios`).
  ...SUBITENS_M54,
} as const;
export type SubitemDominio = keyof typeof SUBITENS_DOMINIOS;

/** Rota de cada subitem no menu (índice filtrado pelo subitem). */
export const ROTA_INDICE_DOMINIOS = '/cadastros/dominios';
export function rotaDoSubitem(s: SubitemDominio): string {
  return `${ROTA_INDICE_DOMINIOS}/grupo/${s}`;
}
export function rotaDoDominio(modulo: string, recurso: string): string {
  return `${ROTA_INDICE_DOMINIOS}/${modulo}/${recurso}`;
}

/**
 * De onde vêm as opções de menu do legado: lidas na árvore do menu de origem
 * ou inferidas (POL-1b): a área genérica "Geral A–L"/"Geral M–Z" do módulo Tabelas, quando a árvore não
 * tem item próprio para a tabela. Inferida é conferida na validação humana.
 */
export type OrigemOpcoes = 'tbopcoes' | 'inferida';

export interface DominioPublico {
  /** Módulo dono (convencoes.md §4): prefixo das permissões e das operações. */
  readonly modulo: string;
  /** Recurso exposto em camelCase (nunca o nome da tabela). */
  readonly recurso: string;
  readonly rotulo: { readonly singular: string; readonly plural: string };
  readonly subitem: SubitemDominio;
  readonly natureza: NaturezaDominio;
  /** Ações que a tela oferece; `ler` sempre. Só `editavel` grava. */
  readonly acoes: readonly AcaoDominio[];
  /** Opções do menu de origem que concedem cada ação (cap-08 §8.6). */
  readonly opcoesLegado: Readonly<Partial<Record<AcaoDominio, readonly number[]>>> & {
    readonly ler: readonly number[];
  };
  readonly origemOpcoes: OrigemOpcoes;
  /** Motivo da natureza não editável (trigger que recusa, fonte oficial). */
  readonly motivoSomenteLeitura?: string;
  /**
   * M11: domínio editável que o legado não deixa incluir pelo cadastro (todos os códigos do CHECK usados; a
   * linha nasce de outro cadastro): só altera e inativa, e a tela diz por quê.
   */
  readonly semInclusao?: string;
  /**
   * W0-02: domínio editável sem inativação nem exclusão pelo cadastro, com o motivo (lei ou regra da matriz). Sem ele, o
   * portão do I/A/E (declaracoes.spec.ts) aponta o domínio na lista dos que não têm I/A/E completo.
   */
  readonly semExclusao?: string;
  /** W0-02: categoria da matriz de governança (obrigatória para o domínio que declara `excluir`). */
  readonly categoria?: CategoriaMatriz;
  /** Marco que declarou (M08 pilotos; M14 em massa). */
  readonly marco: string;
  /**
   * M56 (D-PERM-56): recurso também concedido por perfil próprio do novo (a opção do outro sistema não tem concessão):
   * os perfis que leem (ler, exportar) e os que gravam (criar, editar, inativar).
   */
  readonly perfis?: { readonly ler: readonly string[]; readonly gravar: readonly string[] };
  /**
   * M47 (etapa 2): chave de recurso (SGH_CFG_LIBERACAO) sem a qual a gravação do domínio fica desligada (POL-3), além
   * da liberação da operação: os cadastros da agência só se editam com a agência própria (`agencia.completa`, DP-21).
   */
  readonly chaveRecurso?: string;
  /**
   * M47 (etapa 2): permissão do grupo de cadastros exigida também, além da do domínio, nas ações que gravam (criar,
   * editar, inativar): os cadastros da agência pedem a `sadt.agenciaCadastro.editar` da ficha (§7).
   */
  readonly permissaoGravacaoGrupo?: string;
}

/** As ações do CRUD genérico que gravam (pedem também a permissão do grupo, quando o domínio a declara). */
export const ACOES_DOMINIO_QUE_GRAVAM: readonly AcaoDominio[] = ['criar', 'editar', 'inativar', 'excluir'];

/** As permissões que a ação do domínio exige: a do domínio e, nas que gravam, a do grupo (quando houver). */
export function permissoesExigidasDoDominio(
  d: Pick<DominioPublico, 'modulo' | 'recurso' | 'permissaoGravacaoGrupo'>,
  acao: AcaoDominio,
): readonly string[] {
  const propria = permissaoDoDominio(d, acao);
  return d.permissaoGravacaoGrupo && ACOES_DOMINIO_QUE_GRAVAM.includes(acao)
    ? [propria, d.permissaoGravacaoGrupo]
    : [propria];
}

/** Código da permissão de uma ação do domínio. */
export function permissaoDoDominio(d: Pick<DominioPublico, 'modulo' | 'recurso'>, acao: AcaoDominio): string {
  return `${d.modulo}.${d.recurso}.${acao}`;
}

/**
 * Verbos das operações de gravação do CRUD genérico. W0-02: `excluir` (exclusão física com verificador de dependências
 * e retrato) e `reativar` (volta a letra de ativo na coluna de situação, como o cadastro anterior grava).
 */
export const VERBOS_DOMINIO = ['incluir', 'alterar', 'inativar', 'reativar', 'excluir'] as const;
export type VerboDominio = (typeof VERBOS_DOMINIO)[number];

/** Nome da operação de gravação do catálogo (`<modulo>.<verbo><Recurso>`). */
export function operacaoDoDominio(
  d: Pick<DominioPublico, 'modulo' | 'recurso'>,
  verbo: VerboDominio,
): string {
  return `${d.modulo}.${verbo}${d.recurso.charAt(0).toUpperCase()}${d.recurso.slice(1)}`;
}

// ── Contratos da API do CRUD genérico ─────────────────────────────────────────────────────────────

// M10: `data` (AAAA-MM-DD; o feriado com ano 9999 é recorrente e continua gravado com 9999, regra 15).
// M14: `decimal` (NUMERIC com escala, DOUBLE PRECISION: faixas de referência, limites), com as casas da coluna.
export const TIPOS_CAMPO_DOMINIO = [
  'texto',
  'inteiro',
  'letra',
  'hora',
  'referencia',
  'data',
  'decimal',
] as const;
export type TipoCampoDominio = (typeof TIPOS_CAMPO_DOMINIO)[number];

export const esquemaCampoDescrito = z.object({
  campo: z.string(),
  rotulo: z.string(),
  tipo: z.enum(TIPOS_CAMPO_DOMINIO),
  /** Texto: tamanho máximo em bytes CP1252; inteiro: limites. */
  maxBytes: z.number().int().optional(),
  /** Decimal: casas depois da vírgula (escala da coluna). */
  casas: z.number().int().optional(),
  minimo: z.number().optional(),
  maximo: z.number().optional(),
  obrigatorio: z.boolean(),
  /** Campo de código: digitado (manual) ou gerado pelo legado (generator; a tela não pede). */
  codigo: z.enum(['manual', 'generator']).optional(),
  /** Editável depois de incluído (o legado recusa mudar o que é chave: e_geral_valor_chave). */
  editavel: z.boolean(),
  /** Pedido na inclusão. */
  naInclusao: z.boolean(),
  naLista: z.boolean(),
  /** Valores aceitos (letra, sexo): só os já vistos no legado. */
  valores: z.array(z.object({ valor: z.string(), rotulo: z.string() })).optional(),
  /** Referência a outro domínio (lista de opções pelo servidor). */
  referencia: z.string().optional(),
  /** Legenda de baixa confiança (DP-46): "a confirmar". */
  aConfirmar: z.boolean().optional(),
});
export type CampoDescrito = z.infer<typeof esquemaCampoDescrito>;

export const esquemaDominioDescrito = z.object({
  modulo: z.string(),
  recurso: z.string(),
  rotulo: z.object({ singular: z.string(), plural: z.string() }),
  subitem: z.string(),
  rota: z.string(),
  natureza: z.enum(NATUREZAS_DOMINIO),
  motivoSomenteLeitura: z.string().optional(),
  /** M11: editável sem inclusão (o motivo aparece na tela). */
  semInclusao: z.string().optional(),
  /** W0-02: editável sem inativação nem exclusão (o motivo aparece na tela). */
  semExclusao: z.string().optional(),
  /** W0-02: a reativação grava a letra de ativo na coluna de situação (como o cadastro anterior grava). */
  reativaNaSituacao: z.boolean().optional(),
  /**
   * Revisão do W0-02: a exclusão guarda o retrato da linha inteira no histórico de exclusões (D-CRUD-SNAP: categoria
   * protegida ou marca da declaração). Sem ela, a tela não promete histórico.
   */
  exclusaoProtegida: z.boolean().optional(),
  acoes: z.array(z.enum(ACOES_DOMINIO)),
  /** Ações que a sessão pode fazer (as demais ficam ocultas na tela; o servidor confere de novo). */
  permitidas: z.array(z.enum(ACOES_DOMINIO)),
  campos: z.array(esquemaCampoDescrito),
  /** Campo de código (chave exposta) e de descrição (busca e duplicidade). */
  campoCodigo: z.string(),
  campoDescricao: z.string(),
  /** Campo da situação (ativo/inativo), quando o legado tem a coluna. */
  campoSituacao: z.string().optional(),
  /** Exportar exige justificativa (campo de dado pessoal; regra 6). */
  exportarExigeJustificativa: z.boolean(),
  /** Estado da operação de gravação por ação neste estabelecimento (catálogo). */
  estados: z.record(z.string(), z.string()),
  /**
   * M38 (campo 7): ações de escrita permitidas pela permissão que o executor recusaria agora para quem pergunta
   * (operação não liberada no estabelecimento), com o motivo. A tela mostra a ação desabilitada e o aviso. Revisão do
   * W0-02: também `reativar` (a operação reativar<Recurso> tem a liberação dela, separada da de inativar).
   */
  recusadas: z.record(z.string(), z.string()).optional(),
  /** M14: a inativação vale só no novo (a tabela não tem coluna de situação com letra de inativo provada). */
  inativacaoSoNoNovo: z.boolean().optional(),
  /** Marco que declarou (M08 pilotos; M14 lote gerado). */
  marco: z.string().optional(),
  /** M14: textos longos mostrados em leitura ao abrir o item (rótulos; o conteúdo vem por item). */
  textosLongos: z
    .array(
      z.object({
        campo: z.string(),
        rotulo: z.string(),
        /** W0-02 (D-CRUD-30): o texto se edita na alteração (BLOB de texto, em segmentos). */
        editavel: z.boolean().optional(),
        maxBytes: z.number().int().optional(),
        /** W1-04: o texto é obrigatório na inclusão (o cadastro anterior o preenche sempre). */
        obrigatorio: z.boolean().optional(),
      }),
    )
    .optional(),
  /** M14: rótulo da coluna de legenda do novo (situação de agenda, grupo do motivo de alta). */
  legenda: z.string().optional(),
});
export type DominioDescrito = z.infer<typeof esquemaDominioDescrito>;

export const esquemaIndiceDominios = z.object({
  dominios: z.array(
    esquemaDominioDescrito
      .pick({
        modulo: true,
        recurso: true,
        rotulo: true,
        subitem: true,
        rota: true,
        natureza: true,
        permitidas: true,
      })
      .extend({
        /** M14: o motivo de só consulta (sistema, travado, oficial, enumeração). */
        motivoSomenteLeitura: z.string().optional(),
        marco: z.string().optional(),
      }),
  ),
});
export type IndiceDominios = z.infer<typeof esquemaIndiceDominios>;

/** Valor de campo como a tela o vê (texto, número, letra, hora HH:MM). */
export const esquemaValorCampo = z.union([z.string(), z.number(), z.null()]);
export type ValorCampo = z.infer<typeof esquemaValorCampo>;

export const esquemaItemDominio = z.object({
  /** Código exposto (texto, para a rota). */
  codigo: z.string(),
  ativo: z.boolean(),
  valores: z.record(z.string(), esquemaValorCampo),
  /** Versão para o controle otimista: as colunas mostradas, como a tela leu. */
  versao: z.string(),
  /** M14 (regras 7 e 13): legenda do novo para o código (situação de agenda, grupo do motivo de alta). */
  legenda: z.string().optional(),
  /** M14 (regra 9): código em uso sem linha no domínio (só leitura: nada é gravado; "a confirmar"). */
  aConfirmar: z.boolean().optional(),
});
export type ItemDominio = z.infer<typeof esquemaItemDominio>;

export const TETO_LISTA_DOMINIO = 500;

export const esquemaListaDominio = z.object({
  itens: z.array(esquemaItemDominio),
  total: z.number().int(),
  /** A tabela passou do teto (nunca a tabela inteira no cliente). */
  truncada: z.boolean(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
});
export type ListaDominio = z.infer<typeof esquemaListaDominio>;

export const esquemaConsultaLista = z.object({
  busca: z.string().max(100).optional(),
  ordem: z.string().max(40).optional(),
  direcao: z.enum(['asc', 'desc']).optional(),
  pagina: z.coerce.number().int().min(1).max(1000).optional(),
  porPagina: z.coerce.number().int().min(1).max(100).optional(),
  /** Inclui inativos (consulta de registros antigos). */
  inativos: z.enum(['sim', 'nao']).optional(),
});
export type ConsultaLista = z.infer<typeof esquemaConsultaLista>;

export const esquemaPedidoInclusao = z.object({ valores: z.record(z.string(), esquemaValorCampo) });
export const esquemaPedidoAlteracao = z.object({
  valores: z.record(z.string(), esquemaValorCampo),
  versao: z.string().min(1).max(4000),
});
/** W0-02: o motivo da reativação e da exclusão (obrigatório; vai ao registro do evento junto com o valor anterior). */
export const esquemaMotivoCrud = z
  .string()
  .trim()
  .min(5, 'Informe o motivo (ao menos 5 caracteres).')
  .max(200, 'O motivo tem no máximo 200 caracteres.');
/** Revisão do W0-02: a inativação também pede o motivo (vai ao registro do evento com o valor anterior). */
export const esquemaPedidoInativacao = z.object({
  versao: z.string().min(1).max(4000),
  motivo: esquemaMotivoCrud,
  /** Item em uso (FK que permite): a tela mostra o aviso e o usuário confirma. */
  confirmarEmUso: z.boolean().optional(),
});
/**
 * M14 (correção): desfaz a inativação só no novo (o item volta às telas de digitação; nada no legado). W0-02: também nos
 * domínios que inativam pela coluna de situação (grava a letra de ativo, como o cadastro anterior grava), com motivo.
 */
export const esquemaPedidoReativacao = z.object({
  versao: z.string().min(1).max(4000),
  motivo: esquemaMotivoCrud,
});
/** W0-02: exclusão física do item (só no domínio que declara `excluir`; recusa com os dependentes quando há vínculo). */
export const esquemaPedidoExclusao = z.object({
  versao: z.string().min(1).max(4000),
  motivo: esquemaMotivoCrud,
});
/**
 * Revisão do W0-02 (D-CRUD-SEM-GATILHO): o relatório "exclusões feitas fora do sistema" da vigia de reconciliação dos
 * cadastros (rótulo de produto, nunca o nome da tabela), com o estado da vigia no estabelecimento.
 */
export const esquemaRelatorioVigiaReconciliacao = z.object({
  /** O parâmetro `crud.vigiaReconciliacao` está ligado no estabelecimento (ou na rede). */
  ligada: z.boolean(),
  /** A vigia roda neste ambiente (fonte do banco); na fonte em memória, não há rodada. */
  disponivel: z.boolean(),
  /** Intervalo do despertar, em minutos. */
  intervaloMinutos: z.number().int(),
  /** A última rodada neste estabelecimento desde que a API subiu (ou null). */
  ultimaRodada: z
    .object({
      em: z.string(),
      tabelas: z.number().int(),
      achados: z.number().int(),
      erro: z.string().optional(),
    })
    .nullable(),
  linhas: z.array(
    z.object({
      rotulo: z.string(),
      detectadoEm: z.string(),
      contagemAntes: z.number().int(),
      contagemDepois: z.number().int(),
      foraDoSistema: z.number().int(),
      chaves: z.array(z.string()),
    }),
  ),
});
export type RelatorioVigiaReconciliacao = z.infer<typeof esquemaRelatorioVigiaReconciliacao>;
/** W0-02 (D-CRUD-ORFAOS): um grupo de registros dependentes que impede a exclusão (sem nome de tabela). */
export const esquemaDependenteItem = z.object({
  /** Rótulo de produto do grupo (o domínio declarado que depende, ou a área do sistema). */
  rotulo: z.string(),
  quantidade: z.number().int().nonnegative(),
  /** Amostra das chaves dependentes (até 5), para a pessoa achar os registros. */
  amostra: z.array(z.string()),
  /** `fk`: ligação declarada no banco; `logica`: vínculo só por código. */
  origem: z.enum(['fk', 'logica']),
});
export type DependenteItem = z.infer<typeof esquemaDependenteItem>;
/** W0-02: corpo extra do 409 `com-dependentes` (a tela mostra a lista e oferece a inativação, quando há). */
export const esquemaRecusaDependentes = z.object({
  codigo: z.literal('com-dependentes'),
  dependentes: z.array(esquemaDependenteItem),
  total: z.number().int(),
  podeInativar: z.boolean(),
});
export type RecusaDependentes = z.infer<typeof esquemaRecusaDependentes>;
/** M14 (correção): textos longos de um item, em leitura (campo → texto, ou null quando vazio). */
export const esquemaTextosItem = z.object({
  textos: z.record(z.string(), z.string().nullable()),
});
export type TextosItem = z.infer<typeof esquemaTextosItem>;
export const esquemaPedidoExportacao = z.object({
  formato: z.enum(['csv']).default('csv'),
  /** Código de tipo de justificativa de exportação (domínio de auditoria), quando o domínio tem dado pessoal. */
  justificativa: z.number().int().positive().optional(),
});

export const esquemaUsoItem = z.object({
  emUso: z.boolean(),
  /** Referências por FK do catálogo RDB$ (tabela que usa vira só a contagem por módulo, sem nome). */
  referencias: z.array(
    z.object({ regra: z.enum(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']), usos: z.boolean() }),
  ),
  /** O legado proibiria (FK RESTRICT na exclusão); a inativação só avisa. */
  aviso: z.string().nullable(),
});
export type UsoItem = z.infer<typeof esquemaUsoItem>;

export const esquemaResultadoGravacao = z.object({
  codigo: z.string(),
  operacao: z.string(),
  /** Gravação real (núcleo) ou em memória (sessão sintética em dev/ci: nada vai à cópia). */
  destino: z.enum(['legado', 'memoria']),
});
export type ResultadoGravacao = z.infer<typeof esquemaResultadoGravacao>;

// ── Parte física da declaração (o TIPO; os objetos moram em @sgh/legado, no grupo dono) ─────────────

/** Fonte das opções de um campo de referência: outro domínio declarado ou tabela de opções do legado. */
export type ReferenciaCampo =
  | { readonly dominio: string }
  | {
      readonly tabela: string;
      readonly chave: string;
      readonly descricao: string;
      /**
       * M24: teto das opções acima do padrão de 501 (o item de estoque dos kits e dos parâmetros do item: até
       * 10.000). A coluna de referência de texto (unidade, via) é declarada `texto` com esta referência: a tela
       * oferece as opções e a FK do legado confere.
       */
      readonly teto?: number;
    };

/** W1-04: o que o gerador do leiaute padrão da inclusão recebe (a transação da operação, só leitura). */
export interface ContextoPadraoTexto {
  consultar(sql: string, parametros?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  lerBlob(blob: unknown): Promise<Uint8Array>;
  /** Os valores da inclusão (campos da tela). */
  readonly entrada: Readonly<Record<string, unknown>>;
  /** Login de quem inclui. */
  readonly usuario: string;
}

export interface ColunaDeclarada {
  readonly coluna: string;
  /** Nome exposto (camelCase). */
  readonly campo: string;
  readonly rotulo: string;
  readonly tipo: TipoCampoDominio;
  /** Texto: tamanho em bytes CP1252 (o do catálogo RDB$, ou menor). */
  readonly maxBytes?: number;
  /**
   * M23: texto com formato fixo: `hora` é a hora do dia em `HH:MM` (esquemaHora de @sgh/contratos). M54.1: `digitos`, texto só com
   * algarismos (a ordem de 4 dígitos da conta de receita da apuração de custos).
   */
  readonly formatoTexto?: 'hora' | 'digitos';
  /** M14: decimal — casas depois da vírgula (escala da coluna). */
  readonly casas?: number;
  readonly minimo?: number;
  readonly maximo?: number;
  readonly obrigatorio: boolean;
  /** Pode mudar depois de incluído (o trigger *_BU do legado recusa mudar chave: e_geral_valor_chave). */
  readonly editavel: boolean;
  /** A tela pede na inclusão (as demais: generator, constante ou vazio, pela receita). */
  readonly naInclusao: boolean;
  readonly naLista: boolean;
  /** Na chave: código digitado (manual) ou gerado pelo trigger (generator). */
  readonly codigo?: 'manual' | 'generator';
  /** Valores aceitos: só os já vistos no perfil (codec: valor nunca visto é recusado). */
  readonly valores?: readonly { readonly valor: string; readonly rotulo: string }[];
  readonly referencia?: ReferenciaCampo;
  /** Dado pessoal (exportação exige justificativa). */
  readonly pessoal?: boolean;
  /** M51: documento conferido pelo dígito na inclusão e na alteração (CPF ou CNS; o banco guarda número). */
  readonly documento?: 'cpf' | 'cns';
  /** Valor gravado na inclusão quando a tela não pede (constante vista no perfil). */
  readonly constanteNaInclusao?: string | number;
  /**
   * M14: valor da inclusão quando a pessoa deixa o campo vazio e a coluna é NOT NULL com DEFAULT (o INSERT
   * com NULL explícito não aplica o DEFAULT do Firebird): o DEFAULT do catálogo.
   */
  readonly padraoNaInclusao?: string | number;
  /**
   * M24: o valor que o legado grava para "vazio" numa coluna sem NULL no perfil (ex.: a data 1899-12-30 da vigência
   * final "sem fim"; ou o 0 do número não informado, como o CNS e o CRM do médico solicitante SUS): a tela mostra vazio e o vazio
   * da tela grava a sentinela, na inclusão e na alteração.
   */
  readonly sentinelaVazio?: string | number;
  /**
   * Classe do valor na assinatura quando não é `entrada` (domínio ou constante que o perfil mostra, ex.:
   * `dominio:F|M`); a receita genérica usa esta classe e o teste confere contra o perfil.
   */
  readonly classe?: string;
}

/**
 * W0-02 (D-CRUD-ORFAOS): coluna que guarda o código do item SEM FK no banco (o programa lê por código). `colunas`: as
 * colunas da tabela dependente, na ordem da chave do domínio (chave composta: uma por coluna da chave).
 */
export interface ReferenciaLogica {
  readonly tabela: string;
  readonly colunas: readonly string[];
  /** Onde o vínculo foi levantado (unidade do código, consulta aos dados). */
  readonly evidencia: string;
  /** Rótulo de produto dos registros dependentes (a tela mostra este, nunca a tabela). */
  readonly rotulo?: string;
}

/**
 * W1-04 (D-CRUD-ORFAOS): vínculo SEM igualdade simples de coluna (o código dentro de uma lista em texto, o nome do item
 * gravado no começo de uma justificativa): contado por uma condição fixa do mapa, com os `?` tirados da linha do item
 * (colunas `de`, na ordem). A condição nunca vem do usuário. Conta como vínculo (impede a exclusão física).
 */
export interface ReferenciaDerivada {
  readonly tabela: string;
  /** Condição sobre a tabela dependente, com um `?` por coluna de `de` (sem `;` nem comentário). */
  readonly onde: string;
  /** Colunas da linha do item que alimentam os `?`. */
  readonly de: readonly string[];
  /** Colunas mostradas na amostra (até 5 linhas). */
  readonly amostra: readonly string[];
  readonly evidencia: string;
  readonly rotulo?: string;
}

export interface SituacaoDeclarada {
  readonly coluna: string;
  readonly ativo: string;
  readonly inativo: string;
  /** Evidência da letra de inativo (CHECK do catálogo, perfil). */
  readonly evidencia: string;
  /**
   * Itens de sistema que o novo não inativa (o legado os protege, ex.: trigger BD; o fluxo do SPDATA depende
   * deles): inativar responde 409 `item-de-sistema`.
   */
  readonly protegidas?: { readonly codigos: readonly number[]; readonly evidencia: string };
}

export interface DeclaracaoDominio {
  readonly publico: DominioPublico;
  /** Grupo dono em packages/legado/src/<grupo> (convencoes.md §4). */
  readonly grupo: string;
  readonly tabela: string;
  /** Coluna da chave primária (a primeira, quando a chave é composta). */
  readonly chave: string;
  /**
   * M14: chave primária composta (todas as colunas, na ordem do catálogo; a primeira é `chave`). O código
   * exposto junta os valores com `|` (cada um sem `|`), e a inclusão pede todos (nunca gerados).
   */
  readonly chaveComposta?: readonly string[];
  readonly colunas: readonly ColunaDeclarada[];
  /** Campo da descrição (busca, ordenação padrão e duplicidade). */
  readonly descricao: string;
  readonly situacao?: SituacaoDeclarada;
  /**
   * M14 (regra 11): a tabela não tem coluna de situação com letra de inativo provada: a inativação vale só no
   * novo, em SGH_CFG_DOMINIO_SITUACAO (nenhuma tabela do legado é tocada; o item some das telas do novo).
   */
  readonly situacaoSoNoNovo?: { readonly motivo: string; readonly protegidas?: readonly number[] };
  /** Conjuntos de campos únicos entre ativos, depois de normalizar (regra 3). */
  readonly unico: readonly (readonly string[])[];
  /** Triggers do catálogo RDB$ da tabela e o que fazem (o novo não duplica). */
  readonly triggers: readonly { readonly nome: string; readonly faz: string }[];
  /**
   * Regras da referência de perfil para a inclusão (coluna → classe, com o motivo medido), quando o estado
   * atual das linhas não é o da inclusão (ex.: ID_DIGITAL preenchido depois pela integração do fornecedor).
   * M54.4: `formato` troca o formato que o perfil mediu (ex.: ordem 0001 a 0004 parece hora de quatro dígitos e não é).
   */
  readonly referenciaPerfil?: Readonly<
    Record<string, { readonly classe: string; readonly motivo: string; readonly formato?: string }>
  >;
  /**
   * M53.2: colunas que o gatilho da PRÓPRIA tabela carimba também na alteração (ex.: a data da última alteração do
   * eSocial da rubrica). A alteração genérica só compara as colunas do passo; estas entram na referência de perfil
   * do cenário principal da alteração, com a regra de `referenciaPerfil` (classe `carimbo-banco`).
   */
  readonly carimbosNaAlteracao?: readonly string[];
  /**
   * M11: itens de sistema que o novo não altera (o trigger *_BU do legado os protege, ex.: conselho profissional 1 a 12
   * com e_geral_sistema): alterar responde 409 `item-de-sistema` antes de chegar ao banco.
   */
  readonly protegidasNaAlteracao?: { readonly codigos: readonly number[]; readonly evidencia: string };
  /**
   * Colunas de escopo do legado (cap-08 §8.4; M06, regra 6): o filtro de escopo da sessão vira WHERE nesta
   * coluna em toda lista e item. Os domínios do M08 não têm escopo (tabela da rede inteira).
   */
  readonly escopos?: Readonly<Partial<Record<'unidade' | 'local' | 'convenio' | 'centroCusto', string>>>;
  /**
   * M14: gravações dos triggers em outras tabelas (efeitos que o novo não duplica e a assinatura espera), com as
   * ações da tabela do domínio que os disparam.
   */
  readonly efeitosTrigger?: readonly {
    readonly trigger: string;
    readonly tabela: string;
    readonly acao: 'INSERT' | 'UPDATE' | 'DELETE';
    readonly quando: readonly ('INSERT' | 'UPDATE' | 'DELETE')[];
    readonly faz: string;
    /**
     * M20: linhas que o efeito grava no cenário de assinatura do verbo (medidas na cópia): com elas, o cenário da
     * receita genérica espera o efeito (sem elas, o efeito fica só descrito).
     */
    readonly linhas?: number;
    /** M20: colunas que o efeito copia da linha do domínio (coluna do efeito → coluna da tabela do domínio). */
    readonly copias?: Readonly<Record<string, string>>;
    /** M20: tabela onde o gatilho mora, quando é um efeito em cadeia (o gatilho da tabela do efeito anterior). */
    readonly tabelaDoTrigger?: string;
    /** M20: regras da referência de perfil para colunas da tabela do efeito (coluna → classe, com o motivo medido). */
    readonly regras?: Readonly<Record<string, { readonly classe: string; readonly motivo: string }>>;
  }[];
  /**
   * M14: teto da leitura da tabela inteira (lista, duplicidade, códigos livres), acima do padrão de 501, nas
   * tabelas de domínio maiores (itens de kit, exames: até 2.100 linhas).
   */
  readonly tetoLeitura?: number;
  /**
   * M14: trilha do legado que o Delphi grava para a tabela (perfil do cabeçalho × lançamentos da trilha): tipo
   * (tipo de ação de auditoria: 2 inclusão, 3 alteração), criticidade e opção por verbo, e a coluna do alvo.
   */
  readonly trilhaLegado?: Readonly<
    Partial<
      Record<
        'incluir' | 'alterar',
        { readonly tipo: number; readonly criticidade: number; readonly opcao: number }
      >
    >
  > & { readonly alvo: string };
  /**
   * M14 (POL-3): verbos cuja receita sai completa e DESLIGADA, com o que falta provar (ex.: a linha de histórico
   * que o Delphi grava junto da alteração, sem trigger no banco). A operação fica `especificada` (a promoção a
   * verde a pula) e o motivo aparece a quem tenta gravar fora de desenvolvimento.
   */
  readonly pendenteDeProva?: {
    readonly verbos: readonly ('incluir' | 'alterar' | 'inativar')[];
    readonly motivo: string;
  };
  /**
   * M14 (correção): colunas de texto longo (BLOB de texto: fórmula, valores de referência, preparo, observação,
   * modelo de laudo) mostradas EM LEITURA ao abrir o item (o conteúdo, decodificado como a coluna guarda, sem
   * conversão). A gravação delas fica fora do CRUD genérico até a assinatura do formato (D-BLOB-14).
   */
  readonly textosLongos?: readonly {
    readonly coluna: string;
    readonly campo: string;
    readonly rotulo: string;
    /**
     * W0-02 (D-CRUD-30): o texto longo se grava pelo CRUD genérico (editor na tela): BLOB de texto (sub_type 1) em
     * CP1252/WIN1252, em quantos segmentos precisar; a prova relê os bytes. Sem esta marca, fica em leitura.
     */
    readonly editavel?: boolean;
    /** W0-02: teto do texto em bytes CP1252 (padrão 1 MiB). */
    readonly maxBytes?: number;
    /**
     * W1-04: obrigatório na inclusão (o perfil mediu a coluna sempre preenchida, ex.: o texto impresso da recepção, o texto
     * impresso na senha). Sem a marca, vazio grava NULL. Na alteração, o texto pedido também não pode ir vazio.
     */
    readonly obrigatorio?: boolean;
    /**
     * W1-04 (D-W104-8): o leiaute que a INCLUSÃO grava nesta coluna (não editável na tela), como o cadastro anterior
     * o cria: o arquivo de configuração que o executável do painel lê (a configuração do painel de chamada copiada do painel de
     * atendimento modelo; a configuração do painel de TV do modelo vazio capturado). `gerar` devolve os bytes do BLOB
     * (lidos na mesma transação; recusa legível quando não há modelo) e a prova relê os bytes gravados.
     */
    readonly padraoNaInclusao?: {
      /** Origem do leiaute, para a receita (ex.: "cópia do primeiro painel de atendimento"). */
      readonly origem: string;
      readonly gerar: (c: ContextoPadraoTexto) => Promise<Uint8Array>;
    };
  }[];
  /**
   * W0-02: exclusão física declarada (o domínio público traz a ação `excluir` e a `categoria`). D-CRUD-ORFAOS: além das
   * FKs que o catálogo do banco declara (lidas na hora), as REFERÊNCIAS LÓGICAS — colunas que o cadastro anterior ou o
   * Sante leem só por código, sem FK — entram no verificador de dependências; a lista é obrigatória, mesmo vazia (com a
   * justificativa). D-CRUD-SNAP: `protegida` (padrão: a categoria em CATEGORIAS_PROTEGIDAS) retrata a linha inteira
   * antes do DELETE, na mesma transação.
   */
  readonly exclusao?: {
    readonly protegida?: boolean;
    readonly referenciasLogicas: readonly ReferenciaLogica[];
    /** W1-04: vínculos derivados (sem igualdade de coluna), contados pelo mesmo verificador (fail-closed). */
    readonly derivadas?: readonly ReferenciaDerivada[];
    /** Por que a lista de referências lógicas está vazia (levantamento feito no código e nos dados). */
    readonly semReferenciasLogicas?: string;
    /**
     * W0-02: a tabela não tem dependente possível (nenhuma FK de entrada nem referência lógica: a ligação de oferta,
     * por exemplo), com a evidência. O verificador corre do mesmo jeito (fail-closed); só o cenário de assinatura da
     * recusa por dependentes não existe (não há o que reproduzir).
     */
    readonly semDependentes?: string;
    /**
     * FKs de entrada que são linhas do PRÓPRIO item (filhas em CASCADE que a exclusão leva junto, retratadas antes, na
     * mesma transação, na SGH_HIST_EXCLUSAO): `TABELA.COLUNA[+COLUNA]`. Só vale a FK que o catálogo do banco diz
     * CASCADE: a "própria" de outra regra conta como vínculo (a exclusão é recusada com a lista). Toda outra FK é
     * vínculo.
     */
    readonly proprias?: readonly string[];
  };
  /**
   * M14 (regras 7, 9 e 13): legenda do novo aplicada aos itens do domínio — situação de agenda (a oficial: C
   * Confirmado, X Cancelado), grupo do motivo de alta, ou os códigos em uso sem linha ("a confirmar", uma linha
   * só de leitura na lista, nada gravado).
   */
  readonly legenda?:
    | { readonly tipo: 'situacao-agenda' }
    | { readonly tipo: 'motivo-alta' }
    | { readonly tipo: 'codigos-sem-linha'; readonly dominio: string };
}
