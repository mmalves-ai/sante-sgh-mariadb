// Estado comum das telas da enfermagem (M25): o que a sessão pode fazer (liberação e permissão, do servidor), a
// unidade escolhida (lembrada neste navegador), o dono do cache da beira do leito e os avisos de mudança (o canal de
// eventos só diz "mudou"; a tela relê). Sem o canal, a tela relê sozinha a cada 30 s.
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { usarSessao } from '../../casca/sessao/sessao.js';
import { CANAL_ENFERMAGEM, lerGravacao, lerUnidades } from './api-enfermagem.js';
import type { DonoCofre } from './cofre-local.js';

const LEMBRAR_UNIDADE = 'sgh.enfermagem.unidade';

function lembrada(): string {
  try {
    return globalThis.localStorage?.getItem(LEMBRAR_UNIDADE) ?? '';
  } catch {
    return '';
  }
}

export function usarEnfermagem() {
  const gravacao = useQuery({
    queryKey: ['enfermagem', 'gravacao'],
    queryFn: () => lerGravacao(),
    staleTime: 60_000,
  });
  const unidades = useQuery({
    queryKey: ['enfermagem', 'unidades'],
    queryFn: () => lerUnidades(),
    staleTime: 300_000,
  });
  const unidade = ref(lembrada());
  watch(
    () => unidades.data.value,
    (us) => {
      if (us && us.length > 0 && !us.some((u) => u.unidade === unidade.value)) unidade.value = us[0]!.unidade;
    },
    { immediate: true },
  );
  function escolherUnidade(u: string): void {
    unidade.value = u;
    try {
      globalThis.localStorage?.setItem(LEMBRAR_UNIDADE, u);
    } catch {
      // Sem o armazenamento do navegador, a escolha vale só nesta tela.
    }
  }
  const opcoesUnidade = computed(() =>
    (unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: `${u.nome} (${u.internados})` })),
  );
  const pode = (op: string) => computed(() => gravacao.data.value?.operacoes[op]?.pode === true);
  const motivoDe = (op: string) =>
    computed(() => {
      const g = gravacao.data.value;
      if (!g) return null;
      const o = g.operacoes[op];
      return o && !o.pode ? (o.motivo ?? g.motivo) : null;
    });
  const { sessao } = usarSessao();
  const dono = computed<DonoCofre | null>(() => {
    const s = sessao.value;
    return s && s.estabelecimentoAtivo
      ? {
          rede: s.rede ?? '',
          estabelecimento: s.estabelecimentoAtivo,
          login: s.usuario.login ?? s.usuario.id,
        }
      : null;
  });
  const login = computed(() => sessao.value?.usuario.login ?? '');
  return { gravacao, unidades, unidade, escolherUnidade, opcoesUnidade, pode, motivoDe, dono, login };
}

export const RELEITURA_SEM_CANAL_MS = 30_000;

/** Avisos de mudança dos horários (suspensão, checagem em outro terminal, conflito): a tela relê. */
export function usarAvisosEnfermagem(aoMudar: () => void) {
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
    fonte = new EventSource(CANAL_ENFERMAGEM);
    let jaAbriu = false;
    fonte.addEventListener('open', () => {
      conectado.value = true;
      // Reconexão: o canal não reenvia o que saiu durante a queda, então a tela relê ao voltar.
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
