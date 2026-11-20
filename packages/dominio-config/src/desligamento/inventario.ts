// Regra 2 do M58 (cap-07 §7.5 e §7.6; cap-08 §8.10): antes de desligar, cada executável, serviço, tarefa ou painel do
// fornecedor tem substituto em uso ou é aceito como perdido pela área, com a contingência que a DP-6 define. A
// avaliação é pura: recebe o inventário versionado e os registros da checklist (o último por item) e diz o que falta.
// Item com substituto "a confirmar" (equivalência ainda não conferida com a TI, DP-16) só se resolve com o aceite.
import {
  INVENTARIO_DESLIGAMENTO,
  type ContingenciaDesligamento,
  type ItemDesligamentoAvaliado,
  type ItemInventarioDesligamento,
  type SituacaoItemDesligamento,
} from '@sgh/contratos';

export interface RegistroItemLido {
  readonly item: string;
  readonly situacao: SituacaoItemDesligamento;
  readonly contingencia: ContingenciaDesligamento | null;
  /** ISO 8601. */
  readonly registradoEm: string;
  readonly papelResponsavel?: string | null;
  readonly evidencia?: string | null;
}

/** O último registro de cada item (pelo instante; empate fica com o que veio depois na lista). */
export function ultimoRegistroPorItem(registros: readonly RegistroItemLido[]): Map<string, RegistroItemLido> {
  const m = new Map<string, RegistroItemLido>();
  for (const r of registros) {
    const a = m.get(r.item);
    if (!a || r.registradoEm >= a.registradoEm) m.set(r.item, r);
  }
  return m;
}

export function avaliarItem(
  item: ItemInventarioDesligamento,
  registro: RegistroItemLido | undefined,
): ItemDesligamentoAvaliado {
  const pendencias: ItemDesligamentoAvaliado['pendencias'] = [];
  const situacao = registro?.situacao ?? 'pendente';
  if (situacao === 'pendente') pendencias.push('sem-registro');
  if (situacao === 'substituto-em-uso') {
    if (!item.substituto) pendencias.push('sem-substituto-e-sem-aceite');
    else if (item.substituto.aConfirmar) pendencias.push('substituto-a-confirmar');
  }
  if (situacao !== 'pendente' && !registro?.contingencia) pendencias.push('sem-contingencia');
  return {
    item: item.id,
    tipo: item.tipo,
    areaResponsavel: item.areaResponsavel,
    situacao,
    contingencia: registro?.contingencia ?? null,
    substituto: item.substituto ? { ...item.substituto } : null,
    resolvido: pendencias.length === 0,
    pendencias,
    registradoEm: registro?.registradoEm ?? null,
    papelResponsavel: registro?.papelResponsavel ?? null,
    evidencia: registro?.evidencia ?? null,
  };
}

/** O inventário inteiro avaliado, na ordem do contrato. Registro de item fora do inventário é ignorado. */
export function avaliarInventario(
  registros: readonly RegistroItemLido[],
  inventario: readonly ItemInventarioDesligamento[] = INVENTARIO_DESLIGAMENTO,
): ItemDesligamentoAvaliado[] {
  const ultimos = ultimoRegistroPorItem(registros);
  return inventario.map((i) => avaliarItem(i, ultimos.get(i.id)));
}

export function inventarioResolvido(itens: readonly ItemDesligamentoAvaliado[]): boolean {
  return itens.length > 0 && itens.every((i) => i.resolvido);
}
