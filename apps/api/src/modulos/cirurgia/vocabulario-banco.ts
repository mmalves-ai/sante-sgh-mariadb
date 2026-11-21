// Tradução explícita entre os códigos gravados no modelo (CHECK das tabelas do bloco) e os códigos do contrato das
// telas da anestesia e do checklist. Código do banco sem par no contrato: ou é ignorado de propósito (marcos que a
// ficha ainda não mostra, listados abaixo) ou é erro de vocabulário, com a tabela, a coluna e o código (nunca dado de
// pessoa), para não chegar à tela com outro sentido.
// Melhoria: nenhuma leitura converte vocabulário do banco por coerção de tipo; o inverso serve à gravação.
import type {
  MarcoFicha,
  MomentoChecklist,
  ParteFicha,
  RespostaChecklist,
  SituacaoFicha,
} from '@sgh/contratos';

export class ErroVocabularioBanco extends Error {
  constructor(
    readonly tabela: string,
    readonly coluna: string,
    readonly codigo: string,
  ) {
    super(`Código "${codigo}" de ${tabela}.${coluna} sem tradução para o contrato.`);
  }
}

function tradutor<B extends string, C extends string>(
  tabela: string,
  coluna: string,
  mapa: Readonly<Record<B, C>>,
) {
  const inverso = new Map<C, B>(Object.entries(mapa).map(([b, c]) => [c as C, b as B]));
  return {
    doBanco(v: string): C {
      const c = (mapa as Record<string, C>)[v];
      if (c === undefined) throw new ErroVocabularioBanco(tabela, coluna, v);
      return c;
    },
    paraBanco(c: C): B {
      const b = inverso.get(c);
      if (b === undefined) throw new ErroVocabularioBanco(tabela, coluna, c);
      return b;
    },
  };
}

/** Marcos do modelo sem lugar no contrato da ficha (pedido de contrato do lote 03-01): lidos e não mostrados. */
export const MARCOS_SEM_CONTRATO: readonly string[] = ['inducao', 'intubacao', 'extubacao'];

export const MARCO_FICHA = tradutor('marco_ficha_anestesica', 'marco', {
  entrada_sala: 'entradaSala',
  inicio_anestesia: 'inicioAnestesia',
  inicio_cirurgia: 'inicioCirurgia',
  fim_cirurgia: 'fimCirurgia',
  fim_anestesia: 'fimAnestesia',
  saida_sala: 'saidaSala',
} as const satisfies Record<string, MarcoFicha>);

export const PARTE_FICHA = tradutor('lancamento_ficha_anestesica', 'parte', {
  sinal: 'sinal',
  medicamento: 'medicamento',
  gas: 'gas',
  fluido: 'fluido',
  perda: 'perda',
  evento: 'evento',
  modo_ventilatorio: 'modoRespiratorio',
  posicao: 'posicao',
  equipe: 'equipe',
  procedimento: 'procedimento',
  exame: 'exame',
  avulso: 'avulso',
  bomba_infusao: 'bi',
} as const satisfies Record<string, ParteFicha>);

export const RESPOSTA_CHECKLIST = tradutor('confirmacao_checklist_cirurgia', 'resposta', {
  sim: 'sim',
  nao: 'nao',
  nao_se_aplica: 'na',
} as const satisfies Record<string, RespostaChecklist>);

export const MOMENTO_CHECKLIST = tradutor('confirmacao_checklist_cirurgia', 'momento', {
  inducao: 'inducao',
  incisao: 'incisao',
  saida: 'saida',
} as const satisfies Record<string, MomentoChecklist>);

export type SituacaoChecklistLida = 'aberto' | 'concluido' | 'dispensado' | 'interrompido';
export const SITUACAO_CHECKLIST = tradutor('checklist_cirurgia_segura', 'situacao', {
  em_andamento: 'aberto',
  concluido: 'concluido',
  dispensado: 'dispensado',
  interrompido: 'interrompido',
} as const satisfies Record<string, SituacaoChecklistLida>);

export const SITUACAO_FICHA = tradutor('ficha_anestesica', 'situacao', {
  aberta: 'aberta',
  encerrada: 'encerrada',
  assinada: 'assinada',
} as const satisfies Record<string, SituacaoFicha>);
