// Situações da farmácia (ficha do M29, regra 7; ref 02 §1): os 12 códigos da situação da farmácia com a legenda da
// cópia e o agrupamento em 5 situações de leitura fácil (cap-11 §11.2). O agrupamento é só da tela: o que se grava
// continua o código do outro sistema. Os códigos 2, 3 e 4 nunca foram gravados (perfil: 0 linhas na
// situação do item da prescrição); só entram com a decisão registrada (regra 8, DP-25).

export const SITUACOES_FARMACIA = [
  { id: 1, nome: 'Pendente avaliação farmacêutica', grupo: 'a-avaliar' },
  { id: 2, nome: 'Avaliado e válido', grupo: 'liberado' },
  { id: 3, nome: 'Não aprovado', grupo: 'pendencia' },
  { id: 4, nome: 'Avaliado com pendência de revisão médica', grupo: 'pendencia' },
  { id: 5, nome: 'Avaliado e válido automaticamente', grupo: 'liberado' },
  { id: 6, nome: 'Suspenso', grupo: 'interrompido' },
  { id: 7, nome: 'Dispensado', grupo: 'dispensacao' },
  { id: 8, nome: 'Entregue', grupo: 'dispensacao' },
  { id: 9, nome: 'Estornado', grupo: 'interrompido' },
  { id: 10, nome: 'Excluído no estoque', grupo: 'interrompido' },
  { id: 11, nome: 'Dispensação em andamento', grupo: 'dispensacao' },
  { id: 12, nome: 'Substituição', grupo: 'dispensacao' },
] as const;

export type CodigoSituacaoFarmacia = (typeof SITUACOES_FARMACIA)[number]['id'];
export type GrupoSituacaoFarmacia = (typeof SITUACOES_FARMACIA)[number]['grupo'];

/** As 5 situações de leitura fácil, na ordem da tela. */
export const GRUPOS_SITUACAO_FARMACIA: readonly { id: GrupoSituacaoFarmacia; rotulo: string }[] = [
  { id: 'a-avaliar', rotulo: 'A avaliar' },
  { id: 'liberado', rotulo: 'Liberado' },
  { id: 'pendencia', rotulo: 'Com pendência' },
  { id: 'dispensacao', rotulo: 'Na dispensação' },
  { id: 'interrompido', rotulo: 'Interrompido' },
];

/** Códigos que o outro sistema nunca gravou: a gravação deles exige a decisão registrada (regra 8). */
export const SITUACOES_NUNCA_VISTAS: readonly number[] = [2, 3, 4];

/** O grupo de leitura fácil de um código (desconhecido: null, a tela mostra o código cru). */
export function grupoDaSituacao(codigo: number | null | undefined): GrupoSituacaoFarmacia | null {
  const s = SITUACOES_FARMACIA.find((x) => x.id === codigo);
  return s ? s.grupo : null;
}

export function nomeDaSituacao(codigo: number | null | undefined): string {
  return SITUACOES_FARMACIA.find((x) => x.id === codigo)?.nome ?? `Situação ${codigo ?? '?'}`;
}

/** Conta os itens por grupo (o resumo da fila de avaliação): sempre os 5 grupos, mesmo com zero. */
export function resumoPorGrupo(
  codigos: readonly (number | null)[],
): Readonly<Record<GrupoSituacaoFarmacia | 'outros', number>> {
  const r: Record<GrupoSituacaoFarmacia | 'outros', number> = {
    'a-avaliar': 0,
    liberado: 0,
    pendencia: 0,
    dispensacao: 0,
    interrompido: 0,
    outros: 0,
  };
  for (const c of codigos) r[grupoDaSituacao(c) ?? 'outros'] += 1;
  return r;
}

/** A situação de entrega do documento de saída: só 7, 8 e 9 vistos (272.413, 2.607 e 3). */
export const SITUACOES_ENTREGA = [7, 8, 9] as const;
