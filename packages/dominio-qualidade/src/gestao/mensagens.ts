// Os textos de toda recusa da gestão da qualidade (a API manda o código e o texto; a tela usa os mesmos). Sem nome de
// sistema antigo (ADR 0023).
import type { RecusaDocumento } from './documentos.js';
import type { RecusaEnvio } from './envio.js';
import type { RecusaAnaliseIndicador } from './ficha-indicador.js';
import type { RecusaOuvidoria } from './ouvidoria.js';
import type { RecusaAuditoria, RecusaComissao, RecusaNaoConformidade, RecusaRisco } from './registros.js';

export type RecusaGestaoQualidade =
  | RecusaDocumento
  | RecusaAnaliseIndicador
  | RecusaAuditoria
  | RecusaComissao
  | RecusaRisco
  | RecusaNaoConformidade
  | RecusaOuvidoria
  | RecusaEnvio
  | 'documento-inexistente';

export const MENSAGENS_RECUSA_GESTAO: Readonly<Record<RecusaGestaoQualidade, string>> = {
  'aprovador-e-elaborador':
    'Quem aprova a publicação não pode ser quem elaborou o documento: peça a aprovação a outra pessoa.',
  'revisor-e-elaborador': 'O revisor tem de ser outra pessoa, não quem elaborou o documento.',
  'vigencia-no-passado': 'A data da próxima revisão tem de ser depois de hoje.',
  'vigencia-longa': 'A próxima revisão fica em até cinco anos.',
  'codigo-ja-vigente':
    'Já existe revisão vigente com este código: publique como nova revisão do documento vigente.',
  'substituta-de-outro-codigo': 'A revisão substituída tem de ser do mesmo código.',
  'substituta-nao-vigente': 'Só a revisão vigente pode ser substituída (a outra já saiu de uso).',
  'documento-nao-vigente': 'O documento não está vigente.',
  'ciencia-ja-registrada': 'Você já registrou a ciência desta revisão.',
  'versao-desatualizada':
    'O registro mudou desde que você abriu a tela (outra pessoa agiu nele): recarregue e confira.',
  'documento-inexistente': 'Documento não encontrado.',
  'competencia-aberta': 'A competência ainda não terminou: a análise e o envio são do mês fechado.',
  'analise-ja-registrada': 'A análise deste indicador nesta competência já existe: altere a registrada.',
  'analise-inexistente': 'A análise informada não é deste indicador e desta competência.',
  'plano-obrigatorio': 'Indicador fora da meta: informe as causas, o plano de ação, o responsável e o prazo.',
  'plano-incompleto': 'O plano de ação precisa do responsável e do prazo juntos (ou de nenhum dos dois).',
  'prazo-antes-da-competencia': 'O prazo do plano tem de ser depois do fim da competência analisada.',
  'indicador-inexistente': 'Indicador fora do catálogo.',
  'sem-valor': 'O indicador não tem valor apurado na competência (sem denominador): não há o que analisar.',
  'data-futura': 'A data não pode estar no futuro.',
  'item-nao-conforme-sem-evidencia':
    'Todo item não conforme ou parcialmente conforme leva a evidência (o achado).',
  'comissao-inativa': 'A comissão está inativa: reative-a para registrar reunião.',
  'reuniao-futura': 'A reunião registrada não pode estar no futuro.',
  'presente-fora-da-composicao': 'Há presente que não está na composição da comissão.',
  'presente-repetido': 'O mesmo membro aparece duas vezes na presença.',
  'comissao-duplicada': 'Já existe comissão com este nome.',
  'comissao-inexistente': 'Comissão não encontrada.',
  'membro-repetido': 'O mesmo membro aparece duas vezes na composição.',
  'justificativa-obrigatoria': 'Risco aceito ou encerrado leva a justificativa (pelo menos 10 caracteres).',
  'controles-obrigatorios': 'Risco crítico em tratamento ou mitigado leva os controles adotados.',
  'reavaliacao-no-passado': 'A data da reavaliação tem de ser hoje ou depois.',
  'risco-inexistente': 'Risco não encontrado.',
  'risco-encerrado': 'O risco está encerrado: registre outro se ele voltou.',
  'transicao-invalida': 'Esta mudança de situação não é permitida para a não conformidade.',
  'tratamento-incompleto': 'O tratamento leva a causa, o plano, o responsável e o prazo.',
  'eficacia-obrigatoria': 'O encerramento leva a verificação da eficácia e o texto dela.',
  'eficacia-fora-de-hora': 'A eficácia se registra na verificação ou no encerramento.',
  'ineficaz-nao-encerra': 'Ação ineficaz não encerra a não conformidade: volte ao tratamento.',
  'nao-conformidade-inexistente': 'Não conformidade não encontrada.',
  'origem-sem-registro':
    'Auditoria, risco, manifestação ou notificação de origem leva o registro de origem; as outras origens, não.',
  'origem-cancelada':
    'O registro de origem (auditoria ou manifestação) foi cancelado: a não conformidade não pode nascer presa a ele.',
  'prazo-no-passado': 'O prazo tem de ser hoje ou depois.',
  'origem-alterada': 'A origem da não conformidade não muda depois de aberta.',
  'recebida-no-futuro': 'A data de recebimento não pode estar no futuro.',
  'recebida-antiga': 'A manifestação tem mais de 60 dias: fale com a coordenação da ouvidoria.',
  'manifestacao-respondida': 'A manifestação já foi respondida.',
  'pesquisa-ja-convertida': 'Esta resposta da pesquisa já virou manifestação.',
  'pesquisa-inexistente': 'Resposta da pesquisa não encontrada.',
  'paciente-inexistente': 'Paciente não encontrado no cadastro.',
  'manifestacao-inexistente': 'Manifestação não encontrada.',
  'procedencia-obrigatoria': 'Na reclamação e na denúncia, diga se a manifestação procede.',
  'ja-transmitido':
    'O envio desta competência já foi transmitido: a retificação se faz no portal do programa.',
  'envio-nao-pendente': 'O envio não está aguardando transmissão (já transmitido ou substituído).',
  'hash-diferente':
    'O resumo do arquivo informado não é o do arquivo gerado: transmita o arquivo baixado do Sante.',
  'transmissao-antes-da-geracao': 'A transmissão não pode ser antes da geração do arquivo.',
  'transmissao-futura': 'A data da transmissão não pode estar no futuro.',
  'envio-inexistente': 'Envio não encontrado.',
};
