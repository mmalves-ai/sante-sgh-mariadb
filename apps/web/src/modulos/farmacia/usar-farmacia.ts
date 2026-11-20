// Dados comuns das telas da farmácia: o estado da gravação (cada funcionalidade e ação), as unidades e os avisos de
// mudança em tempo real (prescrição nova, suspensão, dispensação em outro terminal): a tela relê ao receber e ao
// reconectar (o canal não reenvia o que saiu durante a queda); sem canal, relê a cada 30 s.
import { useQuery } from '@tanstack/vue-query';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { lerGravacao } from './api-farmacia.js';

export function usarFarmacia(leitor = lerGravacao) {
  const gravacao = useQuery({
    queryKey: ['farmacia', 'gravacao', leitor.name],
    queryFn: () => leitor(),
    staleTime: 30_000,
  });
  const pode = (op: string) => gravacao.data.value?.operacoes[op]?.ligada ?? false;
  const motivo = (op: string) => gravacao.data.value?.operacoes[op]?.motivo ?? null;
  const motivoFuncionalidade = (f: string) => {
    const x = gravacao.data.value?.funcionalidades[f];
    return x && !x.ligada ? (x.motivo ?? null) : null;
  };
  return { gravacao, pode, motivo, motivoFuncionalidade };
}

export const RELEITURA_SEM_CANAL_MS = 30_000;

export function usarAvisosFarmacia(canal: string, aoMudar: () => void) {
  const conectado = ref(false);
  let fonte: EventSource | null = null;
  let reserva: ReturnType<typeof setInterval> | null = null;
  const ligarReserva = () => {
    reserva ??= setInterval(aoMudar, RELEITURA_SEM_CANAL_MS);
  };
  onMounted(() => {
    if (typeof EventSource === 'undefined') {
      ligarReserva();
      return;
    }
    fonte = new EventSource(canal);
    let jaAbriu = false;
    fonte.addEventListener('open', () => {
      conectado.value = true;
      if (jaAbriu) aoMudar();
      jaAbriu = true;
      if (reserva) clearInterval(reserva);
      reserva = null;
    });
    fonte.addEventListener('mudanca', () => aoMudar());
    fonte.addEventListener('error', () => {
      conectado.value = false;
      ligarReserva();
    });
  });
  onBeforeUnmount(() => {
    fonte?.close();
    if (reserva) clearInterval(reserva);
  });
  return { conectado };
}

/** "AAAA-MM-DDTHH:MM" → "DD/MM HH:MM". */
export function horario(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [d, h] = iso.split('T');
  const [, m, dia] = (d ?? '').split('-');
  return `${dia}/${m}${h ? ` ${h.slice(0, 5)}` : ''}`;
}
export function data(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('/');
}
const QTD = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
export const qtd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : QTD.format(v));
export const numero = (t: string | number): number => Number(String(t).trim().replace(',', '.'));
