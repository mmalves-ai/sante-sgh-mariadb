// Textos do perfil epidemiológico pela CID-10 (F7, 09-AREA linha 83): capítulos, grupos e subgrupos da fonte oficial
// e as ocorrências de diagnóstico do período. Os textos das recusas vêm de @sgh/dominio-qualidade (os mesmos da API).
// Sem "|" nem "@".
import { MENSAGENS_PERFIL_CID } from '@sgh/dominio-qualidade';

export const RECUSAS_PERFIL_CID = MENSAGENS_PERFIL_CID;

export const mensagensPerfilCid = {
  titulo: 'Perfil epidemiológico pela CID-10',
  explicacao:
    'Ocorrências de diagnóstico do estabelecimento no período, agrupadas por capítulo, grupo e subgrupo da CID-10 (fonte oficial). Fica de fora o diagnóstico descartado ou inativado.',
  voltar: 'Notificação compulsória',
  desde: 'De',
  ate: 'Até',
  tipo: 'Diagnósticos',
  tipoTodos: 'Principais e secundários',
  tipoPrincipal: 'Só o principal',
  certeza: 'Certeza',
  certezaConfirmados: 'Só confirmados',
  certezaSuspeitos: 'Confirmados e suspeitos',
  periodoInvalido: MENSAGENS_PERFIL_CID.periodoInvalido,
  carregando: 'Carregando…',
  resumo: {
    legenda: 'Resumo do período',
    total: 'Ocorrências',
    atendimentos: 'Atendimentos',
    pacientes: 'Pacientes',
    semCapitulo: 'Fora da CID-10 vigente',
  },
  tabela: {
    legenda: 'Ocorrências por capítulo, grupo e subgrupo',
    codigo: 'Código',
    descricao: 'Descrição',
    ocorrencias: 'Ocorrências',
    percentual: '% do período',
    abrir: 'Capítulo {codigo}: mostrar os grupos',
    fechar: 'Capítulo {codigo}: esconder os grupos',
    capitulo: 'Capítulo {codigo}',
    vazio: 'Nenhum diagnóstico no período com esses filtros.',
  },
  cid: {
    titulo: 'Onde fica um código',
    campo: 'Código da CID-10',
    localizar: 'Localizar',
    invalido: MENSAGENS_PERFIL_CID.cidInvalido,
    foraDaHierarquia: MENSAGENS_PERFIL_CID.cidForaDaHierarquia,
    capitulo: 'Capítulo',
    grupo: 'Grupo',
    subgrupo: 'Subgrupo',
    semAgrupamento: 'A categoria não pertence a nenhum grupo do capítulo.',
  },
};
