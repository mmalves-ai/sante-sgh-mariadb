// Gestão da qualidade (ONA) e envios regulatórios, etapa 5 do M48 (ficha, seções 5 a 8, regras 9, 10 e 11; cap-05b
// §5.11; cap-07 §7.5.3; cap-13 §13.3.10 e §13.3.12; manual m17 "Indicadores e gestão da qualidade (ONA)" e m26
// "Envios regulatórios e BI da Rede"; DP-47.8 e DP-47.9):
//   - gestão documental: POP, protocolo, manual, política, regimento, formulário e instrução, com código, revisão,
//     elaboração e aprovação por pessoas diferentes, vigência e ciência por usuário;
//   - indicadores com ficha técnica (os do censo do M16 e os da qualidade), meta, análise crítica e plano quando fora
//     da meta, por competência;
//   - auditorias internas por checklist configurável (DP-47.9: sem o conteúdo do Manual OPSS até a compra), comissões
//     obrigatórias com reuniões (pauta, ata, presença e quórum), matriz de riscos GUT e não conformidades com eficácia;
//   - ouvidoria e SAC com protocolo e prazo, e o NPS das respostas da pesquisa de satisfação do portal (M50);
//   - envios regulatórios por competência (PM-QUALISS, IRAS e Notivisa): arquivo gerado com resumo SHA-256, transmissão
//     manual registrada (nenhum envio automático: cap-12 §12.4; regra 10).
// Tudo só no novo (SGH_QUA_*; 0485 e 0486). Nenhum nome de tabela do outro sistema sai daqui para a tela (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

const rotuloDe =
  <T extends { readonly codigo: string; readonly rotulo: string }>(lista: readonly T[]) =>
  (c: T['codigo']): string =>
    lista.find((x) => x.codigo === c)?.rotulo ?? c;
const codigos = <T extends { readonly codigo: string }>(lista: readonly T[]) =>
  lista.map((x) => x.codigo) as [T['codigo'], ...T['codigo'][]];

// ── Vocabulário: gestão documental ───────────────────────────────────────────────────────────────────────────────

export const TIPOS_DOCUMENTO_QUALIDADE = [
  { codigo: 'pop', rotulo: 'Procedimento operacional padrão (POP)', sigla: 'POP' },
  { codigo: 'protocolo', rotulo: 'Protocolo', sigla: 'PRT' },
  { codigo: 'manual', rotulo: 'Manual', sigla: 'MAN' },
  { codigo: 'politica', rotulo: 'Política institucional', sigla: 'POL' },
  { codigo: 'regimento', rotulo: 'Regimento', sigla: 'REG' },
  { codigo: 'formulario', rotulo: 'Formulário', sigla: 'FOR' },
  { codigo: 'instrucao', rotulo: 'Instrução de trabalho', sigla: 'IT' },
] as const;
export type TipoDocumentoQualidade = (typeof TIPOS_DOCUMENTO_QUALIDADE)[number]['codigo'];
export const CODIGOS_TIPO_DOCUMENTO_QUALIDADE = codigos(TIPOS_DOCUMENTO_QUALIDADE);
export const rotuloTipoDocumentoQualidade = rotuloDe(TIPOS_DOCUMENTO_QUALIDADE);

export const SITUACOES_DOCUMENTO_QUALIDADE = [
  { codigo: 'vigente', rotulo: 'Vigente' },
  { codigo: 'obsoleto', rotulo: 'Obsoleto (substituído por revisão)' },
  { codigo: 'retirado', rotulo: 'Retirado de uso' },
] as const;
export type SituacaoDocumentoQualidade = (typeof SITUACOES_DOCUMENTO_QUALIDADE)[number]['codigo'];
export const CODIGOS_SITUACAO_DOCUMENTO_QUALIDADE = codigos(SITUACOES_DOCUMENTO_QUALIDADE);
export const rotuloSituacaoDocumentoQualidade = rotuloDe(SITUACOES_DOCUMENTO_QUALIDADE);

/** Revisão periódica padrão do documento (ONA: revisão ao menos a cada dois anos). */
export const MESES_REVISAO_DOCUMENTO_PADRAO = 24;

// ── Vocabulário: indicadores da qualidade ───────────────────────────────────────────────────────────────────────

/**
 * Os indicadores da qualidade com ficha técnica (a ficha inteira em @sgh/dominio-qualidade; aqui o código e o nome,
 * para os parâmetros de meta `qualidade.meta.<codigo>`). Os do censo diário são os do M16 (`relatorio.meta.<codigo>`).
 */
export const INDICADORES_QUALIDADE = [
  { codigo: 'densidadeIpcsCvc', nome: 'Densidade de IPCS associada a cateter venoso central' },
  { codigo: 'densidadeItuSvd', nome: 'Densidade de ITU associada a sonda vesical de demora' },
  { codigo: 'densidadePavVm', nome: 'Densidade de pneumonia associada à ventilação mecânica' },
  { codigo: 'utilizacaoCvc', nome: 'Taxa de utilização de cateter venoso central' },
  { codigo: 'utilizacaoSvd', nome: 'Taxa de utilização de sonda vesical de demora' },
  { codigo: 'utilizacaoVm', nome: 'Taxa de utilização de ventilação mecânica' },
  { codigo: 'adesaoHigieneMaos', nome: 'Taxa de adesão à higiene das mãos' },
  // W0-04 (M2): segurança do paciente (RDC 36/2013 e protocolos do PNSP), por 1.000 pacientes-dia do censo.
  { codigo: 'taxaQueda', nome: 'Taxa de queda por 1.000 pacientes-dia' },
  { codigo: 'incidenciaLpp', nome: 'Incidência de lesão por pressão por 1.000 pacientes-dia' },
  { codigo: 'taxaErroMedicacao', nome: 'Taxa de erro de medicação por 1.000 pacientes-dia' },
  { codigo: 'taxaFlebite', nome: 'Taxa de flebite por 1.000 pacientes-dia' },
  { codigo: 'taxaExtubacaoNaoPlanejada', nome: 'Taxa de extubação não planejada por 1.000 pacientes-dia' },
  // W0-04 (M3): linhas de cuidado (protocolos gerenciados), o percentual no alvo e a mediana do tempo da meta-chave.
  { codigo: 'sepseNoAlvo', nome: 'Sepse: pacientes com a meta-chave no alvo' },
  { codigo: 'sepseMediana', nome: 'Sepse: mediana do tempo até a meta-chave' },
  { codigo: 'avcNoAlvo', nome: 'AVC: pacientes com a meta-chave no alvo' },
  { codigo: 'avcMediana', nome: 'AVC: mediana do tempo até a meta-chave' },
  { codigo: 'dorToracicaNoAlvo', nome: 'Dor torácica: pacientes com a meta-chave no alvo' },
  { codigo: 'dorToracicaMediana', nome: 'Dor torácica: mediana do tempo até a meta-chave' },
  // W0-07 (M3): higienização e giro de leito, sobre as etapas da limpeza (@sgh/dominio-hotelaria).
  { codigo: 'tempoGiroLeito', nome: 'Tempo médio de giro do leito' },
  { codigo: 'higienizacaoNoPrazo', nome: 'Higienizações liberadas dentro do prazo' },
  { codigo: 'tempoExecucaoLimpeza', nome: 'Tempo médio de execução da limpeza' },
  // W0-07 (M2): o pronto atendimento, sobre as fichas do PA (@sgh/dominio-atendimento, o mesmo da tela do atendimento).
  { codigo: 'retornoPa72h', nome: 'Retorno ao pronto atendimento em 72 horas' },
  { codigo: 'internacaoViaPa', nome: 'Taxa de internação via pronto atendimento' },
] as const;
export type CodigoIndicadorQualidade = (typeof INDICADORES_QUALIDADE)[number]['codigo'];

/**
 * W0-04 (M3): as linhas de cuidado com indicador (os protocolos gerenciados do PA; o trauma fica fora do pacote) e a
 * meta-chave padrão de cada uma (o código da meta na definição publicada pela diretoria clínica; o parâmetro
 * `qualidade.linhaCuidado.metaChave.<tipo>` troca). Sepse: antibiótico na primeira hora; dor torácica: ECG em até
 * 10 minutos da chegada; AVC: tomografia de crânio em até 25 minutos da chegada.
 */
export const LINHAS_DE_CUIDADO = [
  { tipo: 'sepse', prefixo: 'sepse', rotulo: 'Sepse', metaChave: 'antibiotico' },
  { tipo: 'avc', prefixo: 'avc', rotulo: 'AVC', metaChave: 'tomografia' },
  { tipo: 'dor-toracica', prefixo: 'dorToracica', rotulo: 'Dor torácica', metaChave: 'ecg' },
] as const;
export type LinhaDeCuidado = (typeof LINHAS_DE_CUIDADO)[number]['tipo'];
export const parametroMetaChaveLinha = (tipo: LinhaDeCuidado): string =>
  `qualidade.linhaCuidado.metaChave.${tipo}`;

// ── Vocabulário: auditorias, comissões, riscos e não conformidades ───────────────────────────────────────────────

export const REFERENCIAIS_AUDITORIA = [
  { codigo: 'ona', rotulo: 'Acreditação (Manual OPSS)' },
  { codigo: 'rdc', rotulo: 'Norma sanitária (RDC)' },
  { codigo: 'interno', rotulo: 'Padrão interno' },
  { codigo: 'outro', rotulo: 'Outro referencial' },
] as const;
export type ReferencialAuditoria = (typeof REFERENCIAIS_AUDITORIA)[number]['codigo'];
export const CODIGOS_REFERENCIAL_AUDITORIA = codigos(REFERENCIAIS_AUDITORIA);
export const rotuloReferencialAuditoria = rotuloDe(REFERENCIAIS_AUDITORIA);

export const RESULTADOS_ITEM_AUDITORIA = [
  { codigo: 'conforme', rotulo: 'Conforme' },
  { codigo: 'parcial', rotulo: 'Parcialmente conforme' },
  { codigo: 'naoConforme', rotulo: 'Não conforme' },
  { codigo: 'naoAplicavel', rotulo: 'Não se aplica' },
] as const;
export type ResultadoItemAuditoria = (typeof RESULTADOS_ITEM_AUDITORIA)[number]['codigo'];
export const CODIGOS_RESULTADO_ITEM_AUDITORIA = codigos(RESULTADOS_ITEM_AUDITORIA);
export const rotuloResultadoItemAuditoria = rotuloDe(RESULTADOS_ITEM_AUDITORIA);

/** Comissões obrigatórias do hospital (cap-13 §13.3.10) e a "outra" para as próprias do estabelecimento. */
export const TIPOS_COMISSAO = [
  { codigo: 'ccih', rotulo: 'Controle de infecção hospitalar (Portaria 2.616/1998)' },
  { codigo: 'nsp', rotulo: 'Núcleo de segurança do paciente (RDC 36/2013)' },
  { codigo: 'prontuario', rotulo: 'Revisão de prontuários (CFM 1.638/2002)' },
  { codigo: 'obitos', rotulo: 'Revisão de óbitos (CFM 2.171/2017)' },
  { codigo: 'eticaMedica', rotulo: 'Ética médica (CFM 2.152/2016)' },
  { codigo: 'eticaEnfermagem', rotulo: 'Ética de enfermagem (Cofen 593/2018)' },
  { codigo: 'farmacia', rotulo: 'Farmácia e terapêutica' },
  { codigo: 'transfusional', rotulo: 'Transfusional (RDC 34/2014)' },
  { codigo: 'residuos', rotulo: 'Gerenciamento de resíduos (RDC 222/2018)' },
  { codigo: 'cipa', rotulo: 'Prevenção de acidentes (CIPA, NR-5)' },
  { codigo: 'outra', rotulo: 'Outra comissão do estabelecimento' },
] as const;
export type TipoComissao = (typeof TIPOS_COMISSAO)[number]['codigo'];
export const CODIGOS_TIPO_COMISSAO = codigos(TIPOS_COMISSAO);
export const rotuloTipoComissao = rotuloDe(TIPOS_COMISSAO);

export const PERIODICIDADES_COMISSAO = [
  { codigo: 'mensal', rotulo: 'Mensal', meses: 1 },
  { codigo: 'bimestral', rotulo: 'Bimestral', meses: 2 },
  { codigo: 'trimestral', rotulo: 'Trimestral', meses: 3 },
  { codigo: 'semestral', rotulo: 'Semestral', meses: 6 },
] as const;
export type PeriodicidadeComissao = (typeof PERIODICIDADES_COMISSAO)[number]['codigo'];
export const CODIGOS_PERIODICIDADE_COMISSAO = codigos(PERIODICIDADES_COMISSAO);
export const rotuloPeriodicidadeComissao = rotuloDe(PERIODICIDADES_COMISSAO);
export function mesesDaPeriodicidadeComissao(p: PeriodicidadeComissao): number {
  return PERIODICIDADES_COMISSAO.find((x) => x.codigo === p)?.meses ?? 1;
}

export const TIPOS_REUNIAO_COMISSAO = [
  { codigo: 'ordinaria', rotulo: 'Ordinária' },
  { codigo: 'extraordinaria', rotulo: 'Extraordinária' },
] as const;
export type TipoReuniaoComissao = (typeof TIPOS_REUNIAO_COMISSAO)[number]['codigo'];
export const CODIGOS_TIPO_REUNIAO_COMISSAO = codigos(TIPOS_REUNIAO_COMISSAO);

export const CATEGORIAS_RISCO = [
  { codigo: 'assistencial', rotulo: 'Assistencial' },
  { codigo: 'ocupacional', rotulo: 'Ocupacional' },
  { codigo: 'ambiental', rotulo: 'Ambiental e predial' },
  { codigo: 'tecnologico', rotulo: 'Tecnologia e equipamentos' },
  { codigo: 'financeiro', rotulo: 'Financeiro' },
  { codigo: 'legal', rotulo: 'Legal e regulatório' },
  { codigo: 'imagem', rotulo: 'Imagem institucional' },
] as const;
export type CategoriaRisco = (typeof CATEGORIAS_RISCO)[number]['codigo'];
export const CODIGOS_CATEGORIA_RISCO = codigos(CATEGORIAS_RISCO);
export const rotuloCategoriaRisco = rotuloDe(CATEGORIAS_RISCO);

/**
 * A escala GUT da qualidade (1 a 5 em cada eixo; pontuação = G × U × T, de 1 a 125). A escala do cadastro do outro
 * sistema (tipos Gravidade, Urgência e Tendência) é a da priorização de pagamentos do repasse e segue editável no
 * cadastro próprio; o risco da qualidade usa estes textos (D-GUT-48.5).
 */
export const ESCALA_GUT = {
  gravidade: [
    'Sem dano ou dano irrelevante',
    'Dano leve, sem prejuízo à assistência',
    'Dano moderado ou prejuízo parcial à assistência',
    'Dano grave ou interrupção de serviço',
    'Óbito, dano permanente ou interrupção de serviço essencial',
  ],
  urgencia: [
    'Pode esperar',
    'Pouco urgente (meses)',
    'Merece atenção em semanas',
    'Urgente (dias)',
    'Ação imediata',
  ],
  tendencia: [
    'Não vai piorar',
    'Piora a longo prazo',
    'Piora a médio prazo',
    'Piora em pouco tempo',
    'Piora rapidamente',
  ],
} as const;
export type EixoGut = keyof typeof ESCALA_GUT;

export const PRIORIDADES_RISCO = [
  { codigo: 'critica', rotulo: 'Crítica', minimo: 64 },
  { codigo: 'alta', rotulo: 'Alta', minimo: 27 },
  { codigo: 'moderada', rotulo: 'Moderada', minimo: 8 },
  { codigo: 'baixa', rotulo: 'Baixa', minimo: 1 },
] as const;
export type PrioridadeRisco = (typeof PRIORIDADES_RISCO)[number]['codigo'];
export const rotuloPrioridadeRisco = rotuloDe(PRIORIDADES_RISCO);

export const SITUACOES_RISCO = [
  { codigo: 'identificado', rotulo: 'Identificado' },
  { codigo: 'emTratamento', rotulo: 'Em tratamento' },
  { codigo: 'mitigado', rotulo: 'Mitigado (monitorar)' },
  { codigo: 'aceito', rotulo: 'Aceito pela direção' },
  { codigo: 'encerrado', rotulo: 'Encerrado' },
] as const;
export type SituacaoRisco = (typeof SITUACOES_RISCO)[number]['codigo'];
export const CODIGOS_SITUACAO_RISCO = codigos(SITUACOES_RISCO);
export const rotuloSituacaoRisco = rotuloDe(SITUACOES_RISCO);

export const ORIGENS_NAO_CONFORMIDADE = [
  { codigo: 'auditoria', rotulo: 'Auditoria interna' },
  { codigo: 'externa', rotulo: 'Auditoria externa ou visita de acreditação' },
  { codigo: 'indicador', rotulo: 'Indicador fora da meta' },
  { codigo: 'notificacao', rotulo: 'Notificação de incidente' },
  { codigo: 'ouvidoria', rotulo: 'Manifestação da ouvidoria' },
  { codigo: 'risco', rotulo: 'Risco da matriz' },
  { codigo: 'outra', rotulo: 'Outra origem' },
] as const;
export type OrigemNaoConformidade = (typeof ORIGENS_NAO_CONFORMIDADE)[number]['codigo'];
export const CODIGOS_ORIGEM_NAO_CONFORMIDADE = codigos(ORIGENS_NAO_CONFORMIDADE);
export const rotuloOrigemNaoConformidade = rotuloDe(ORIGENS_NAO_CONFORMIDADE);

export const CLASSIFICACOES_NAO_CONFORMIDADE = [
  { codigo: 'maior', rotulo: 'Maior (compromete o requisito)', diasPadrao: 30 },
  { codigo: 'menor', rotulo: 'Menor (falha pontual)', diasPadrao: 60 },
  { codigo: 'observacao', rotulo: 'Observação (oportunidade de melhoria)', diasPadrao: 90 },
] as const;
export type ClassificacaoNaoConformidade = (typeof CLASSIFICACOES_NAO_CONFORMIDADE)[number]['codigo'];
export const CODIGOS_CLASSIFICACAO_NAO_CONFORMIDADE = codigos(CLASSIFICACOES_NAO_CONFORMIDADE);
export const rotuloClassificacaoNaoConformidade = rotuloDe(CLASSIFICACOES_NAO_CONFORMIDADE);

export const SITUACOES_NAO_CONFORMIDADE = [
  { codigo: 'aberta', rotulo: 'Aberta' },
  { codigo: 'emTratamento', rotulo: 'Em tratamento' },
  { codigo: 'verificacao', rotulo: 'Em verificação da eficácia' },
  { codigo: 'encerrada', rotulo: 'Encerrada' },
] as const;
export type SituacaoNaoConformidade = (typeof SITUACOES_NAO_CONFORMIDADE)[number]['codigo'];
export const CODIGOS_SITUACAO_NAO_CONFORMIDADE = codigos(SITUACOES_NAO_CONFORMIDADE);
export const rotuloSituacaoNaoConformidade = rotuloDe(SITUACOES_NAO_CONFORMIDADE);

export const EFICACIAS_NAO_CONFORMIDADE = [
  { codigo: 'eficaz', rotulo: 'Eficaz (não voltou a ocorrer)' },
  { codigo: 'ineficaz', rotulo: 'Ineficaz (reabrir o tratamento)' },
] as const;
export type EficaciaNaoConformidade = (typeof EFICACIAS_NAO_CONFORMIDADE)[number]['codigo'];
export const CODIGOS_EFICACIA_NAO_CONFORMIDADE = codigos(EFICACIAS_NAO_CONFORMIDADE);

// ── Vocabulário: ouvidoria ───────────────────────────────────────────────────────────────────────────────────────

export const CANAIS_MANIFESTACAO = [
  { codigo: 'presencial', rotulo: 'Presencial' },
  { codigo: 'telefone', rotulo: 'Telefone' },
  { codigo: 'email', rotulo: 'E-mail' },
  { codigo: 'site', rotulo: 'Site ou portal' },
  { codigo: 'caixa', rotulo: 'Caixa de sugestões' },
  { codigo: 'pesquisa', rotulo: 'Pesquisa de satisfação' },
  { codigo: 'redeSocial', rotulo: 'Rede social' },
  // W0-04 (M4): o portal do paciente (W0-10, pela API da ouvidoria) e o atendimento digital da Hal-AI (desligado por
  // parâmetro até o dono configurar o canal). O CHECK do banco ganhou os dois no script 1021.
  { codigo: 'portal', rotulo: 'Portal do paciente' },
  { codigo: 'halai', rotulo: 'Atendimento digital (Hal-AI)' },
] as const;
export type CanalManifestacao = (typeof CANAIS_MANIFESTACAO)[number]['codigo'];
export const CODIGOS_CANAL_MANIFESTACAO = codigos(CANAIS_MANIFESTACAO);
export const rotuloCanalManifestacao = rotuloDe(CANAIS_MANIFESTACAO);

export const TIPOS_MANIFESTACAO = [
  { codigo: 'reclamacao', rotulo: 'Reclamação' },
  { codigo: 'elogio', rotulo: 'Elogio' },
  { codigo: 'sugestao', rotulo: 'Sugestão' },
  { codigo: 'solicitacao', rotulo: 'Solicitação' },
  { codigo: 'informacao', rotulo: 'Pedido de informação' },
  { codigo: 'denuncia', rotulo: 'Denúncia' },
] as const;
export type TipoManifestacao = (typeof TIPOS_MANIFESTACAO)[number]['codigo'];
export const CODIGOS_TIPO_MANIFESTACAO = codigos(TIPOS_MANIFESTACAO);
export const rotuloTipoManifestacao = rotuloDe(TIPOS_MANIFESTACAO);

export const SITUACOES_MANIFESTACAO = [
  { codigo: 'aberta', rotulo: 'Aberta' },
  { codigo: 'encaminhada', rotulo: 'Encaminhada à área' },
  { codigo: 'respondida', rotulo: 'Respondida' },
] as const;
export type SituacaoManifestacao = (typeof SITUACOES_MANIFESTACAO)[number]['codigo'];
export const CODIGOS_SITUACAO_MANIFESTACAO = codigos(SITUACOES_MANIFESTACAO);
export const rotuloSituacaoManifestacao = rotuloDe(SITUACOES_MANIFESTACAO);

/** Prazo da resposta ao manifestante, em dias úteis do calendário do estabelecimento (D-PRAZO-OUV-48.5). */
export const DIAS_UTEIS_RESPOSTA_OUVIDORIA = 10;

// ── Vocabulário: envios regulatórios ─────────────────────────────────────────────────────────────────────────────

/**
 * Os envios regulatórios. Nenhum tem API conhecida (cap-12 §12.4; DP-47.8): o Sante gera o arquivo com o resumo
 * SHA-256 e registra a transmissão manual (o protocolo do portal). Envio automático só em produção e com autorização
 * do dono para cada canal (regra 10): nenhum canal está autorizado.
 */
export const TIPOS_ENVIO_REGULATORIO = [
  {
    codigo: 'pmQualiss',
    rotulo: 'PM-QUALISS (ANS): indicadores hospitalares',
    destino: 'Portal do programa de monitoramento da qualidade dos prestadores (ANS)',
  },
  {
    codigo: 'iras',
    rotulo: 'IRAS (Anvisa): densidades das infecções por dispositivo',
    destino: 'Formulário de notificação das IRAS da coordenação estadual de controle de infecção',
  },
  {
    codigo: 'notivisa',
    rotulo: 'Notivisa (Anvisa): incidentes da competência',
    destino: 'Portal Notivisa (transcrição manual)',
  },
] as const;
export type TipoEnvioRegulatorio = (typeof TIPOS_ENVIO_REGULATORIO)[number]['codigo'];
export const CODIGOS_TIPO_ENVIO_REGULATORIO = codigos(TIPOS_ENVIO_REGULATORIO);
export const rotuloTipoEnvioRegulatorio = rotuloDe(TIPOS_ENVIO_REGULATORIO);

export const SITUACOES_ENVIO_REGULATORIO = [
  { codigo: 'gerado', rotulo: 'Gerado (aguardando transmissão)' },
  { codigo: 'transmitido', rotulo: 'Transmitido' },
  { codigo: 'substituido', rotulo: 'Substituído por nova geração' },
] as const;
export type SituacaoEnvioRegulatorio = (typeof SITUACOES_ENVIO_REGULATORIO)[number]['codigo'];
export const rotuloSituacaoEnvioRegulatorio = rotuloDe(SITUACOES_ENVIO_REGULATORIO);

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const versao = z.number().int().min(1);
const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Data inexistente.');
const instanteLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Data e hora sem fuso (horário local).')
  .refine((v) => {
    const d = new Date(`${v.length === 16 ? `${v}:00` : v}Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 16) === v.slice(0, 16);
  }, 'Data ou hora inexistente.');
export const esquemaCompetenciaQualidade = z
  .string()
  .regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const textoMin = (max: number, min: number) => textoCp1252(max).pipe(z.string().trim().min(min));
const textoOpcional = (max: number) => textoCp1252(max).nullable();
const area = textoMin(80, 2);
/** Login do outro sistema (o cadastro de usuários guarda o nome de acesso em maiúsculas). */
const login = z
  .string()
  .trim()
  .min(2)
  .max(31)
  .transform((v) => v.toUpperCase());
/** Código do documento (ex.: POP-ENF-001): letras, dígitos, ponto, hífen e barra. */
export const esquemaCodigoDocumento = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9./-]{1,19}$/, 'Código com letras, dígitos, ponto, hífen ou barra (até 20).'),
  );

/**
 * `qualidade.publicarDocumento`: a primeira publicação de um código ou a nova revisão (com `substitui` = a revisão
 * vigente lida e a versão dela; a anterior fica obsoleta na mesma transação). Quem publica é o aprovador; o
 * elaborador é outra pessoa (regra da ONA: elaboração e aprovação separadas).
 */
export const esquemaPublicarDocumento = z.object({
  codigo: esquemaCodigoDocumento,
  tipo: z.enum(CODIGOS_TIPO_DOCUMENTO_QUALIDADE),
  titulo: textoMin(200, 5),
  area,
  conteudo: textoMin(16000, 20),
  resumoAlteracao: textoOpcional(500),
  elaboradoPor: login,
  revisadoPor: login.nullable(),
  vigenciaAte: data,
  exigeCiencia: z.boolean(),
  substitui: z.object({ id, versao }).nullable(),
});
export type PublicarDocumentoEntrada = z.infer<typeof esquemaPublicarDocumento>;

/** `qualidade.retirarDocumento`: tira de uso a revisão vigente (sem substituta), com o motivo. */
export const esquemaRetirarDocumento = z.object({
  documento: id,
  versao,
  motivo: textoMin(500, 10),
});
export type RetirarDocumentoEntrada = z.infer<typeof esquemaRetirarDocumento>;

/** `qualidade.registrarCiencia`: o usuário da sessão declara que leu a revisão vigente. */
export const esquemaRegistrarCiencia = z.object({ documento: id });
export type RegistrarCienciaEntrada = z.infer<typeof esquemaRegistrarCiencia>;

/**
 * `qualidade.registrarAnaliseIndicador`: a análise crítica do indicador na competência. O valor (numerador e
 * denominador) e a meta são os apurados pelo servidor no momento do registro (não vêm da tela); fora da meta, a análise
 * exige as causas, o plano e o prazo (regra 9). Nulo em `analise` inclui; com ID e versão altera.
 */
export const esquemaRegistrarAnaliseIndicador = z.object({
  analise: id.nullable(),
  versao: versao.nullable(),
  indicador: z
    .string()
    .trim()
    .regex(/^[a-zA-Z][a-zA-Z0-9]{2,39}$/, 'Código de indicador do catálogo.'),
  competencia: esquemaCompetenciaQualidade,
  texto: textoMin(4000, 20),
  causas: textoOpcional(2000),
  plano: textoOpcional(2000),
  responsavel: textoOpcional(80),
  prazo: data.nullable(),
});
export type RegistrarAnaliseIndicadorEntrada = z.infer<typeof esquemaRegistrarAnaliseIndicador>;

export const esquemaItemChecklistAuditoria = z.object({
  requisito: textoMin(400, 3),
  /** Agrupamento do checklist (seção do manual, área, processo). */
  secao: textoOpcional(80),
  resultado: z.enum(CODIGOS_RESULTADO_ITEM_AUDITORIA),
  evidencia: textoOpcional(600),
});
export type ItemChecklistAuditoria = z.infer<typeof esquemaItemChecklistAuditoria>;

/** `qualidade.registrarAuditoria`: a auditoria interna realizada, com o checklist respondido e a conclusão. */
export const esquemaRegistrarAuditoria = z.object({
  titulo: textoMin(200, 5),
  area,
  referencial: z.enum(CODIGOS_REFERENCIAL_AUDITORIA),
  realizadaEm: data,
  auditores: textoMin(400, 3),
  itens: z.array(esquemaItemChecklistAuditoria).min(1).max(150),
  conclusao: textoMin(2000, 10),
});
export type RegistrarAuditoriaEntrada = z.infer<typeof esquemaRegistrarAuditoria>;

export const esquemaMembroComissao = z.object({
  nome: textoMin(80, 3),
  funcao: textoMin(60, 3),
  /** Login quando o membro usa o sistema (a presença pode ser conferida pela sessão no futuro). */
  login: login.nullable(),
});
export type MembroComissao = z.infer<typeof esquemaMembroComissao>;

/** `qualidade.registrarComissao`: a comissão (composição e periodicidade). Nulo inclui; com ID e versão altera. */
export const esquemaRegistrarComissao = z
  .object({
    comissao: id.nullable(),
    versao: versao.nullable(),
    tipo: z.enum(CODIGOS_TIPO_COMISSAO),
    nome: textoMin(120, 3),
    periodicidade: z.enum(CODIGOS_PERIODICIDADE_COMISSAO),
    membros: z.array(esquemaMembroComissao).min(1).max(40),
    ativa: z.boolean(),
    /**
     * Revisão do W0-04: a justificativa da alteração (10 a 500 caracteres), obrigatória ao alterar a comissão já
     * cadastrada; a composição anterior fica no histórico de versões.
     */
    justificativa: textoCp1252(500).pipe(z.string().trim().min(10)).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.comissao !== null && !v.justificativa)
      ctx.addIssue({
        code: 'custom',
        path: ['justificativa'],
        message: 'Informe a justificativa da alteração.',
      });
  });
export type RegistrarComissaoEntrada = z.infer<typeof esquemaRegistrarComissao>;

/** `qualidade.registrarReuniaoComissao`: a reunião realizada (pauta, ata, presença pelos membros, deliberações). */
export const esquemaRegistrarReuniaoComissao = z.object({
  comissao: id,
  tipo: z.enum(CODIGOS_TIPO_REUNIAO_COMISSAO),
  realizadaEm: instanteLocal,
  pauta: textoMin(2000, 5),
  ata: textoMin(8000, 20),
  /** A versão da comissão lida pela tela: as posições dos presentes valem para essa composição. */
  versaoComissao: versao,
  /** As posições (base 0) dos membros presentes na composição lida. */
  presentes: z.array(z.number().int().min(0).max(39)).max(40),
  convidados: textoOpcional(400),
  deliberacoes: textoOpcional(2000),
});
export type RegistrarReuniaoComissaoEntrada = z.infer<typeof esquemaRegistrarReuniaoComissao>;

const pontoGut = z.number().int().min(1).max(5);

/** `qualidade.registrarRisco`: o risco na matriz GUT (inclusão ou reavaliação com a versão). */
export const esquemaRegistrarRisco = z.object({
  risco: id.nullable(),
  versao: versao.nullable(),
  titulo: textoMin(200, 5),
  descricao: textoMin(2000, 10),
  area,
  categoria: z.enum(CODIGOS_CATEGORIA_RISCO),
  gravidade: pontoGut,
  urgencia: pontoGut,
  tendencia: pontoGut,
  controles: textoOpcional(2000),
  responsavel: textoMin(80, 3),
  situacao: z.enum(CODIGOS_SITUACAO_RISCO),
  reavaliarEm: data,
  /** Justificativa da aceitação (situação "aceito") ou do encerramento. */
  justificativa: textoOpcional(1000),
});
export type RegistrarRiscoEntrada = z.infer<typeof esquemaRegistrarRisco>;

/**
 * `qualidade.registrarNaoConformidade`: a não conformidade aberta (nulo em `naoConformidade`) ou o andamento (com ID
 * e versão): tratamento (causa, plano, responsável, prazo), verificação e encerramento com a eficácia.
 */
export const esquemaRegistrarNaoConformidade = z.object({
  naoConformidade: id.nullable(),
  versao: versao.nullable(),
  origem: z.enum(CODIGOS_ORIGEM_NAO_CONFORMIDADE),
  /** O registro de origem no Sante (auditoria, risco, manifestação, notificação); nulo nas externas e "outra". */
  idOrigem: id.nullable(),
  descricao: textoMin(2000, 10),
  area,
  classificacao: z.enum(CODIGOS_CLASSIFICACAO_NAO_CONFORMIDADE),
  acaoImediata: textoOpcional(1000),
  causa: textoOpcional(2000),
  plano: textoOpcional(2000),
  responsavel: textoOpcional(80),
  prazo: data.nullable(),
  situacao: z.enum(CODIGOS_SITUACAO_NAO_CONFORMIDADE),
  eficacia: z.enum(CODIGOS_EFICACIA_NAO_CONFORMIDADE).nullable(),
  eficaciaTexto: textoOpcional(1000),
});
export type RegistrarNaoConformidadeEntrada = z.infer<typeof esquemaRegistrarNaoConformidade>;

/**
 * `qualidade.registrarManifestacao`: a manifestação recebida pela ouvidoria. Identificada: com o paciente do cadastro
 * ou com o nome e o contato do manifestante; anônima: sem nada que identifique. Da pesquisa: a resposta do portal.
 */
export const esquemaRegistrarManifestacao = z
  .object({
    canal: z.enum(CODIGOS_CANAL_MANIFESTACAO),
    tipo: z.enum(CODIGOS_TIPO_MANIFESTACAO),
    identificada: z.boolean(),
    paciente: id.nullable(),
    manifestante: textoOpcional(120),
    contato: textoOpcional(120),
    area,
    relato: textoMin(4000, 10),
    recebidaEm: instanteLocal,
    /** A resposta da pesquisa de satisfação do portal que originou a manifestação (canal "pesquisa"). */
    pesquisa: id.nullable(),
  })
  .refine((e) => e.identificada || (e.paciente === null && !e.manifestante && !e.contato), {
    message: 'Manifestação anônima não leva paciente, nome nem contato.',
    path: ['identificada'],
  })
  // A resposta da pesquisa identificada leva o paciente da conta do portal (o servidor lê).
  .refine(
    (e) =>
      !e.identificada ||
      e.pesquisa !== null ||
      e.paciente !== null ||
      (e.manifestante?.trim().length ?? 0) >= 3,
    {
      message: 'Informe o paciente do cadastro ou o nome do manifestante.',
      path: ['manifestante'],
    },
  )
  .refine((e) => (e.canal === 'pesquisa') === (e.pesquisa !== null), {
    message: 'A resposta da pesquisa vem só pelo canal "Pesquisa de satisfação".',
    path: ['pesquisa'],
  });
export type RegistrarManifestacaoEntrada = z.infer<typeof esquemaRegistrarManifestacao>;

/** `qualidade.encaminharManifestacao`: a ouvidoria encaminha à área responsável pela resposta. */
export const esquemaEncaminharManifestacao = z.object({
  manifestacao: id,
  versao,
  encaminhadaA: textoMin(80, 2),
  observacao: textoOpcional(1000),
});
export type EncaminharManifestacaoEntrada = z.infer<typeof esquemaEncaminharManifestacao>;

/** `qualidade.responderManifestacao`: a resposta dada ao manifestante (encerra a manifestação). */
export const esquemaResponderManifestacao = z.object({
  manifestacao: id,
  versao,
  resposta: textoMin(4000, 10),
  /** Procedente (reclamação e denúncia): orienta a não conformidade. */
  procedente: z.boolean().nullable(),
});
export type ResponderManifestacaoEntrada = z.infer<typeof esquemaResponderManifestacao>;

/** `relatorio.gerarEnvioRegulatorio`: o arquivo da competência (gerar de novo substitui o anterior não transmitido). */
export const esquemaGerarEnvioRegulatorio = z.object({
  tipo: z.enum(CODIGOS_TIPO_ENVIO_REGULATORIO),
  competencia: esquemaCompetenciaQualidade,
});
export type GerarEnvioRegulatorioEntrada = z.infer<typeof esquemaGerarEnvioRegulatorio>;

/** `relatorio.registrarTransmissaoEnvio`: a transmissão manual feita no portal, com o protocolo recebido. */
export const esquemaRegistrarTransmissaoEnvio = z.object({
  envio: id,
  versao,
  transmitidoEm: instanteLocal,
  protocolo: textoMin(40, 3),
  /** O resumo SHA-256 do arquivo transmitido (a tela confere com o gerado; prova de que é o mesmo arquivo). */
  hash: z.string().regex(/^[0-9a-f]{64}$/, 'Resumo SHA-256 em hexadecimal.'),
});
export type RegistrarTransmissaoEnvioEntrada = z.infer<typeof esquemaRegistrarTransmissaoEnvio>;

// ── Consultas ────────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaFiltroDocumentosQualidade = z.object({
  situacao: z.enum(CODIGOS_SITUACAO_DOCUMENTO_QUALIDADE).optional(),
  tipo: z.enum(CODIGOS_TIPO_DOCUMENTO_QUALIDADE).optional(),
  busca: z.string().trim().max(60).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});
export type FiltroDocumentosQualidade = z.infer<typeof esquemaFiltroDocumentosQualidade>;

export const esquemaFiltroCompetenciaQualidade = z.object({ competencia: esquemaCompetenciaQualidade });

/** W0-04 (M2 e M3): a série mensal de um indicador, das `meses` competências que terminam em `ate` (até 12). */
export const esquemaSerieIndicadorQualidade = z.object({
  ate: esquemaCompetenciaQualidade,
  meses: z.coerce.number().int().min(2).max(12).default(6),
});
export type SerieIndicadorQualidadeFiltro = z.infer<typeof esquemaSerieIndicadorQualidade>;

export const esquemaFiltroGestao = z.object({
  situacao: z.string().trim().max(14).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});
export type FiltroGestao = z.infer<typeof esquemaFiltroGestao>;

export const esquemaFiltroManifestacoes = z.object({
  situacao: z.enum(CODIGOS_SITUACAO_MANIFESTACAO).optional(),
  tipo: z.enum(CODIGOS_TIPO_MANIFESTACAO).optional(),
  /** O protocolo (OUV-AAAA-NNNNNN, igual) ou um trecho do protocolo, da área ou do relato. */
  busca: z.string().trim().max(60).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});
export type FiltroManifestacoes = z.infer<typeof esquemaFiltroManifestacoes>;

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DocumentoQualidadeLido {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly revisao: number;
  readonly tipo: TipoDocumentoQualidade;
  readonly titulo: string;
  readonly area: string;
  readonly resumoAlteracao: string | null;
  readonly elaboradoPor: string;
  readonly revisadoPor: string | null;
  readonly aprovadoPor: string;
  readonly publicadoEm: string;
  readonly vigenciaAte: string;
  readonly exigeCiencia: boolean;
  readonly situacao: SituacaoDocumentoQualidade;
  readonly motivoRetirada: string | null;
  readonly hash: string;
  /** Revisão vencida (vigente depois da data de revisão). */
  readonly revisaoVencida: boolean;
  /** Ciências registradas na revisão e se o usuário da sessão já deu a dele. */
  readonly ciencias: number;
  readonly cienteSessao: boolean;
}

export interface DocumentoQualidadeCompleto extends DocumentoQualidadeLido {
  readonly conteudo: string;
}

/** Ficha técnica do indicador (regra 9: ANAHP, ONA e PM-QUALISS com a mesma ficha). */
export interface FichaIndicadorQualidade {
  readonly codigo: string;
  readonly nome: string;
  readonly formula: string;
  readonly numerador: string;
  readonly denominador: string | null;
  readonly fator: number;
  readonly unidade: 'percentual' | 'dias' | 'razao' | 'quantidade' | 'densidade' | 'minutos';
  readonly fonte: string;
  readonly periodicidade: 'mensal';
  readonly polaridade: 'maior-melhor' | 'menor-melhor' | 'faixa' | 'neutra';
  readonly responsavel: string;
  readonly referencia: string;
  /** Programas que usam o indicador (o envio do PM-QUALISS leva os marcados). */
  readonly programas: readonly ('anahp' | 'ona' | 'pmQualiss')[];
  /**
   * De onde vem o valor: o censo do M16, a qualidade (CCIH), a segurança do paciente (NSP e registro de dispositivos,
   * W0-04 M2), as linhas de cuidado (protocolos gerenciados, W0-04 M3), a higienização (etapas da limpeza, W0-07) ou o
   * atendimento (fichas do pronto atendimento, W0-07).
   */
  readonly origem: 'censo' | 'qualidade' | 'seguranca' | 'linhaCuidado' | 'higienizacao' | 'atendimento';
}

export type SituacaoMetaQualidade = 'na-meta' | 'fora-da-meta' | 'sem-meta' | 'sem-valor';

export interface AnaliseIndicadorLida {
  readonly id: number;
  readonly versao: number;
  readonly indicador: string;
  readonly competencia: string;
  readonly numerador: number;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly meta: number | null;
  readonly situacaoMeta: SituacaoMetaQualidade;
  readonly texto: string;
  readonly causas: string | null;
  readonly plano: string | null;
  readonly responsavel: string | null;
  readonly prazo: string | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly atualizadaPor: string | null;
  readonly atualizadaEm: string | null;
}

export interface IndicadorDaCompetencia {
  readonly ficha: FichaIndicadorQualidade;
  readonly competencia: string;
  readonly numerador: number | null;
  readonly denominador: number | null;
  readonly valor: number | null;
  /** A conta com as parcelas impressas (ex.: "3 / 1.250 × 1.000 = 2,40"). */
  readonly conta: string | null;
  readonly meta: number | null;
  readonly situacaoMeta: SituacaoMetaQualidade;
  readonly parcial: boolean;
  readonly analise: AnaliseIndicadorLida | null;
  /** Análise devida: competência fechada sem análise, ou fora da meta sem plano. */
  readonly pendente: boolean;
}

/** W0-04 (M2 e M3): um ponto da série mensal, com as parcelas (o que a exportação leva). */
export interface PontoSerieIndicadorQualidade {
  readonly competencia: string;
  readonly numerador: number | null;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly conta: string | null;
  readonly meta: number | null;
  readonly situacaoMeta: SituacaoMetaQualidade;
  readonly parcial: boolean;
}

export interface ResultadoChecklist {
  readonly conformes: number;
  readonly parciais: number;
  readonly naoConformes: number;
  readonly naoAplicaveis: number;
  readonly avaliados: number;
  /** Conformidade = (conformes + 0,5 × parciais) / avaliados × 100; nula sem item avaliado. */
  readonly conformidade: number | null;
  readonly conta: string | null;
}

export interface AuditoriaLida {
  readonly id: number;
  readonly titulo: string;
  readonly area: string;
  readonly referencial: ReferencialAuditoria;
  readonly realizadaEm: string;
  readonly auditores: string;
  readonly itens: readonly ItemChecklistAuditoria[];
  readonly resultado: ResultadoChecklist;
  readonly conclusao: string;
  readonly naoConformidades: number;
  readonly registradaPor: string;
  readonly registradaEm: string;
  /** W0-04: a versão (alteração) e o cancelamento lógico com motivo (o cancelado fica visível como inativo). */
  readonly versao?: number;
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
}

export interface ComissaoLida {
  readonly id: number;
  readonly versao: number;
  readonly tipo: TipoComissao;
  readonly nome: string;
  readonly periodicidade: PeriodicidadeComissao;
  readonly membros: readonly MembroComissao[];
  readonly ativa: boolean;
  readonly ultimaReuniao: string | null;
  readonly proximaReuniaoAte: string | null;
  /** Reunião ordinária atrasada pela periodicidade. */
  readonly atrasada: boolean;
}

export interface ReuniaoComissaoLida {
  readonly id: number;
  readonly comissao: number;
  readonly tipo: TipoReuniaoComissao;
  readonly realizadaEm: string;
  readonly pauta: string;
  readonly ata: string;
  readonly presentes: readonly string[];
  readonly membrosTotal: number;
  readonly presentesTotal: number;
  readonly quorum: boolean;
  readonly convidados: string | null;
  readonly deliberacoes: string | null;
  readonly registradaPor: string;
  readonly registradaEm: string;
  /** W0-04: a versão (alteração) e o cancelamento lógico com motivo (o cancelado fica visível como inativo). */
  readonly versao?: number;
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
  /** W0-04: a ata assinada (aprovada) não se cancela, só se retifica por nova versão. */
  readonly ataAssinadaEm?: string | null;
  readonly ataAssinadaPor?: string | null;
  /**
   * Revisão do W0-04: quem assinou a ata antes de ela ser retificada (o texto novo aguarda nova assinatura; a reunião
   * que já teve ata assinada não se cancela).
   */
  readonly assinaturaAnteriorEm?: string | null;
  readonly assinaturaAnteriorPor?: string | null;
}

export interface RiscoLido {
  readonly id: number;
  readonly versao: number;
  readonly titulo: string;
  readonly descricao: string;
  readonly area: string;
  readonly categoria: CategoriaRisco;
  readonly gravidade: number;
  readonly urgencia: number;
  readonly tendencia: number;
  readonly pontuacao: number;
  readonly prioridade: PrioridadeRisco;
  readonly controles: string | null;
  readonly responsavel: string;
  readonly situacao: SituacaoRisco;
  readonly reavaliarEm: string;
  readonly reavaliacaoVencida: boolean;
  readonly justificativa: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly atualizadoPor: string | null;
  readonly atualizadoEm: string | null;
}

export interface NaoConformidadeLida {
  readonly id: number;
  readonly versao: number;
  readonly origem: OrigemNaoConformidade;
  readonly idOrigem: number | null;
  readonly descricao: string;
  readonly area: string;
  readonly classificacao: ClassificacaoNaoConformidade;
  readonly acaoImediata: string | null;
  readonly causa: string | null;
  readonly plano: string | null;
  readonly responsavel: string | null;
  readonly prazo: string | null;
  readonly situacao: SituacaoNaoConformidade;
  readonly eficacia: EficaciaNaoConformidade | null;
  readonly eficaciaTexto: string | null;
  readonly vencida: boolean;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly encerradaPor: string | null;
  readonly encerradaEm: string | null;
  /** W0-04: o cancelamento da duplicada ou aberta por engano. */
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
  readonly duplicadaDe?: number | null;
}

export interface ManifestacaoLida {
  readonly id: number;
  readonly versao: number;
  readonly protocolo: string;
  readonly canal: CanalManifestacao;
  readonly tipo: TipoManifestacao;
  readonly identificada: boolean;
  /** Só para quem tem `qualidade.ouvidoria.ler` (o nome do paciente pelo cadastro; nunca na trilha). */
  readonly paciente: { readonly id: number; readonly nome: string } | null;
  readonly manifestante: string | null;
  readonly contato: string | null;
  readonly area: string;
  readonly relato: string;
  readonly recebidaEm: string;
  readonly prazoEm: string;
  readonly situacao: SituacaoManifestacao;
  readonly encaminhadaA: string | null;
  readonly observacao: string | null;
  readonly resposta: string | null;
  readonly procedente: boolean | null;
  readonly respondidaEm: string | null;
  readonly respondidaPor: string | null;
  readonly pesquisa: number | null;
  readonly estadoPrazo: 'noPrazo' | 'vencendo' | 'vencido' | 'cumprido' | 'respondidaComAtraso';
  readonly registradaPor: string;
  readonly registradaEm: string;
  /** W0-04: o cancelamento lógico com motivo (a manifestação protocolada não se apaga). */
  readonly canceladaEm?: string | null;
  readonly motivoCancelamento?: string | null;
}

/** NPS da competência com as parcelas (promotores 9 e 10, neutros 7 e 8, detratores 0 a 6). */
export interface NpsCompetencia {
  readonly competencia: string;
  readonly respostas: number;
  readonly promotores: number;
  readonly neutros: number;
  readonly detratores: number;
  readonly nps: number | null;
  readonly conta: string | null;
}

export interface EnvioRegulatorioLido {
  readonly id: number;
  readonly versao: number;
  readonly tipo: TipoEnvioRegulatorio;
  readonly competencia: string;
  readonly revisao: number;
  readonly arquivo: string;
  readonly hash: string;
  readonly linhas: number;
  readonly resumo: Readonly<Record<string, number>>;
  readonly situacao: SituacaoEnvioRegulatorio;
  readonly geradoPor: string;
  readonly geradoEm: string;
  readonly transmitidoEm: string | null;
  readonly transmitidoPor: string | null;
  readonly protocolo: string | null;
}

/** O resumo da gestão da qualidade (cabeçalho das telas e cartões). */
export interface ResumoGestaoQualidade {
  readonly documentosVigentes: number;
  readonly documentosRevisaoVencida: number;
  readonly cienciasPendentesSessao: number;
  readonly riscosCriticos: number;
  readonly naoConformidadesAbertas: number;
  readonly naoConformidadesVencidas: number;
  readonly manifestacoesAbertas: number;
  readonly manifestacoesVencidas: number;
  readonly comissoesAtrasadas: number;
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly agora: string;
}
