// Solicitação de exames (ficha do M23, regra 11; cap-05b §5.6 e §5.10 Restrições): individual ou por kit, com
// indicação e urgência; vários exames assinados num pedido (agrupamento); duplicidade no intervalo mínimo e
// incompatibilidade de sexo ou idade avisadas (o profissional confirma); exame inativo no catálogo recusado.
import type { AvisoPedidoExame, ExameCatalogo, KitExames } from '@sgh/contratos';

/** Intervalo mínimo entre dois pedidos do mesmo exame para o mesmo paciente (horas; parâmetro do estabelecimento). */
export const INTERVALO_DUPLICIDADE_HORAS = 24;

export interface ItemPedido {
  readonly exame: number;
  readonly urgente: boolean;
  readonly indicacao?: string | undefined;
}

export interface PedidoAnterior {
  readonly exame: number;
  /** ISO do pedido. */
  readonly em: string;
  readonly suspenso: boolean;
}

export interface PacienteDoPedido {
  readonly sexo: 'F' | 'M' | null;
  readonly idade: number | null;
}

/** Itens do kit somados aos escolhidos (sem repetir o exame; o primeiro vence). */
export function itensComKit(
  itens: readonly ItemPedido[],
  kit: KitExames | null,
  urgente = false,
): ItemPedido[] {
  const r = [...itens];
  if (kit) for (const e of kit.exames) if (!r.some((x) => x.exame === e)) r.push({ exame: e, urgente });
  const vistos = new Set<number>();
  return r.filter((x) => (vistos.has(x.exame) ? false : (vistos.add(x.exame), true)));
}

export function avisosDoPedido(
  itens: readonly ItemPedido[],
  catalogo: ReadonlyMap<number, ExameCatalogo & { readonly ativo: boolean }>,
  paciente: PacienteDoPedido,
  anteriores: readonly PedidoAnterior[],
  agora: Date,
  intervaloHoras = INTERVALO_DUPLICIDADE_HORAS,
): AvisoPedidoExame[] {
  const avisos: AvisoPedidoExame[] = [];
  for (const it of itens) {
    const ex = catalogo.get(it.exame);
    if (!ex || !ex.ativo) {
      avisos.push({
        exame: it.exame,
        tipo: 'inativo',
        texto: 'Exame inativo ou fora do catálogo.',
        bloqueia: true,
      });
      continue;
    }
    const recente = anteriores.find(
      (a) =>
        a.exame === it.exame &&
        !a.suspenso &&
        agora.getTime() - new Date(a.em).getTime() < intervaloHoras * 3_600_000,
    );
    if (recente)
      avisos.push({
        exame: it.exame,
        tipo: 'duplicidade',
        texto: `${ex.nome}: já pedido para este paciente nas últimas ${intervaloHoras} horas.`,
        bloqueia: false,
      });
    if (ex.sexo && paciente.sexo && ex.sexo !== paciente.sexo)
      avisos.push({
        exame: it.exame,
        tipo: 'sexo',
        texto: `${ex.nome}: exame indicado para o sexo ${ex.sexo === 'F' ? 'feminino' : 'masculino'}.`,
        bloqueia: false,
      });
    if (
      paciente.idade !== null &&
      ((ex.idadeMinima !== null && paciente.idade < ex.idadeMinima) ||
        (ex.idadeMaxima !== null && paciente.idade > ex.idadeMaxima))
    )
      avisos.push({
        exame: it.exame,
        tipo: 'idade',
        texto: `${ex.nome}: fora da faixa de idade do exame.`,
        bloqueia: false,
      });
  }
  return avisos;
}

/** Pode gravar: nenhum aviso que bloqueia e, se há avisos, o profissional os confirmou. */
export function podeGravarPedido(avisos: readonly AvisoPedidoExame[], confirmou: boolean): boolean {
  if (avisos.some((a) => a.bloqueia)) return false;
  return avisos.length === 0 || confirmou;
}

/** Grupo do exame pelo tipo de ato do legado (8 anatomia, 15 laboratório, 16 radiologia, 24 US, 25 tomografia…). */
export function grupoDoAto(ato: number): 'laboratorio' | 'imagem' | 'outros' {
  if (ato === 15) return 'laboratorio';
  if (ato === 16 || ato === 24 || ato === 25) return 'imagem';
  return 'outros';
}
