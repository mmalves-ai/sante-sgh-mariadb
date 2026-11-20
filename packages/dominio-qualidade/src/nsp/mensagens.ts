// Os textos de toda recusa do fluxo da notificação (a API manda o código e o texto; a tela usa os mesmos). Sem nome de
// sistema antigo (ADR 0023).
import type { ProblemaClassificacao } from './classificacao.js';
import type { RecusaFluxo } from './fluxo.js';

/** Toda recusa do fluxo do NSP (fluxo.ts e classificacao.ts) com o texto da tela. */
export const MENSAGENS_RECUSA_NOTIFICACAO: Readonly<Record<RecusaFluxo | ProblemaClassificacao, string>> = {
  'versao-desatualizada': 'Outra pessoa alterou esta notificação. Recarregue para ver a versão atual.',
  'situacao-nao-permite': 'A situação atual da notificação não permite esta ação.',
  'justificativa-obrigatoria':
    'Ao corrigir o que foi notificado, escreva a justificativa (pelo menos 10 caracteres).',
  'prazo-no-passado': 'O prazo da análise não pode ser anterior a hoje.',
  'ja-transcrita': 'A transcrição no Notivisa já foi registrada.',
  'instante-futuro': 'A data e a hora não podem estar no futuro.',
  'antes-da-ocorrencia': 'A transcrição não pode ser anterior à ocorrência do incidente.',
  'duplicada-sem-protocolo': 'Informe o número da notificação que fica (a original).',
  'duplicada-de-si-mesma': 'A notificação não pode ser duplicada dela mesma.',
  'dano-sem-ter-atingido':
    'Circunstância notificável e quase erro não atingiram o paciente: o dano é "nenhum".',
  'evento-adverso-sem-dano': 'Evento adverso tem dano (de leve a óbito); sem dano é incidente sem dano.',
  'incidente-sem-dano-com-dano': 'Incidente sem dano não tem grau de dano; com dano é evento adverso.',
};

/** Recusas da ocorrência informada no diálogo (conferirOcorrencia). */
export const MENSAGENS_RECUSA_OCORRENCIA: Readonly<Record<'instante-futuro' | 'muito-antigo', string>> = {
  'instante-futuro': 'A data e a hora do incidente não podem estar no futuro.',
  'muito-antigo': 'O incidente tem mais de um ano. Fale com o Núcleo de Segurança do Paciente.',
};
