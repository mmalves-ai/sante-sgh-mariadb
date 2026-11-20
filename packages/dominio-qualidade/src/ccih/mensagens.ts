// Os textos de toda recusa da CCIH (a API manda o código e o texto; a tela usa os mesmos). Sem nome de sistema antigo
// (ADR 0023).
import type { RecusaPrecaucao } from './precaucao.js';
import type { RecusaDispositivo, RecusaSurto } from './registros.js';

export type RecusaCcih =
  | RecusaDispositivo
  | RecusaPrecaucao
  | RecusaSurto
  | 'versao-desatualizada'
  | 'internacao-encerrada'
  | 'criterio-de-outro-sitio'
  | 'criterios-insuficientes'
  | 'antes-da-cirurgia'
  | 'fora-da-janela-isc'
  | 'data-futura'
  | 'antes-do-terceiro-dia'
  | 'cirurgia-de-outra-internacao'
  | 'iras-descartada'
  | 'nao-e-restrito'
  | 'ja-decidido'
  | 'sem-liberacao'
  | 'revisao-ja-feita'
  | 'revisao-antes-do-dia'
  | 'nao-e-antimicrobiano'
  | 'exame-de-outra-internacao';

export const MENSAGENS_RECUSA_CCIH: Readonly<Record<RecusaCcih, string>> = {
  'instante-futuro': 'A data e a hora não podem estar no futuro.',
  'muito-antigo': 'O registro tem mais de 30 dias: fale com a coordenação da CCIH para a correção.',
  'antes-da-internacao': 'A data é anterior à entrada da internação.',
  'dispositivo-ja-ativo':
    'O paciente já tem um dispositivo deste tipo em uso: registre a retirada (troca) antes de registrar o novo.',
  'ja-retirado': 'A retirada deste dispositivo já foi registrada.',
  'antes-da-insercao': 'A retirada não pode ser anterior à inserção.',
  'sem-leito': 'O paciente não está num leito do mapa: confira a internação.',
  'precaucao-ja-aberta': 'O paciente já está em precaução por este motivo.',
  'bloqueio-vizinho-exigido':
    'Precaução para aerossóis em quarto com outros leitos exige bloquear os leitos vizinhos (quarto privativo).',
  'precaucao-encerrada': 'Esta precaução já foi encerrada.',
  'surto-encerrado': 'O surto já foi encerrado.',
  'encerramento-antes-do-inicio': 'O encerramento não pode ser anterior ao início do surto.',
  'data-futura': 'A data não pode estar no futuro.',
  'versao-desatualizada': 'Outra pessoa alterou este registro. Recarregue para ver a versão atual.',
  'internacao-encerrada': 'A internação já teve alta: o registro não cabe mais.',
  'criterio-de-outro-sitio': 'Há critério marcado que não é deste sítio de infecção.',
  'criterios-insuficientes':
    'Os critérios marcados não fecham o diagnóstico deste sítio pelos critérios da Anvisa.',
  'antes-da-cirurgia': 'A infecção de sítio cirúrgico não pode ser anterior à cirurgia.',
  'fora-da-janela-isc': 'A infecção está fora da janela da cirurgia (30 dias; 90 dias com implante).',
  'antes-do-terceiro-dia':
    'Infecção antes do 3º dia de internação é comunitária e não entra na vigilância de IRAS.',
  'cirurgia-de-outra-internacao': 'A cirurgia escolhida não é deste paciente.',
  'iras-descartada': 'A ficha já foi descartada.',
  'nao-e-restrito': 'Este antimicrobiano não é de uso restrito: não precisa de liberação.',
  'ja-decidido': 'A CCIH já decidiu sobre este item da prescrição.',
  'sem-liberacao': 'Não há liberação registrada para revisar.',
  'revisao-ja-feita': 'Esta revisão já foi registrada.',
  'revisao-antes-do-dia': 'A revisão só cabe a partir do dia previsto do tratamento.',
  'nao-e-antimicrobiano': 'O item não está marcado como antimicrobiano no cadastro de produtos.',
  'exame-de-outra-internacao': 'A cultura escolhida não é deste paciente.',
};
