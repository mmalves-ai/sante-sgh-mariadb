<script setup lang="ts">
// Pulseira e etiqueta do paciente com a reimpressão controlada (01-ADM L79). Ao lado do botão de emitir, mostra
// quantas vias já saíram e por qual impressora a próxima sai (a da estação; ninguém escolhe impressora a cada
// impressão). Já impressa, a nova via só sai com o motivo do catálogo, e o complemento quando o motivo pede: a
// conferência é na hora, antes de ir ao servidor. Sem o banco próprio (leitura indisponível), não mostra nada e a
// emissão segue como era.
import { SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerIdentificacoes, reimpressaoPronta } from '../../administracao/api-impressao.js';

export interface PedidoIdentificacao {
  reimpressao: boolean;
  pronto: boolean;
  /** O rótulo do botão quando é reimpressão (nulo: o rótulo normal de emitir). */
  rotulo: string | null;
  corpo: { motivo?: number; complemento?: string };
}

const props = defineProps<{
  alvo: 'atendimento' | 'internacao';
  id: number;
  tipo: 'pulseira' | 'etiqueta';
  /** Muda a cada emissão feita pela tela: relê a situação e limpa o motivo. */
  recarregar?: number;
}>();
const emit = defineEmits<{ mudou: [PedidoIdentificacao] }>();
const { t } = useI18n({
  useScope: 'local',
  inheritLocale: true,
  messages: {
    'pt-BR': {
      reimprimir: 'Reimprimir',
      configurar: 'Configurar as impressoras da estação',
      nunca: 'Ainda não impressa.',
      vias: 'Já impressa: {n} via(s).',
      impressora: 'Sai em: {nome}.',
      semImpressora: 'Nenhuma impressora configurada para esta estação: sai na fila da estação.',
      motivo: 'Motivo da reimpressão',
      escolha: 'Escolha o motivo',
      complemento: 'Complemento do motivo',
      faltaMotivo: 'Para reimprimir, escolha o motivo.',
      faltaComplemento: 'Este motivo pede o complemento (mínimo de 5 caracteres).',
      historico: 'Reimpressões',
      linha: 'Via {via}: {motivo} ({quem})',
    },
  },
});
const q = useQuery({
  queryKey: computed(() => ['identificacao-impressa', props.alvo, props.id]),
  queryFn: () => lerIdentificacoes(props.alvo, props.id),
  retry: false,
});
const motivo = ref('');
const complemento = ref('');
const atual = computed(() => q.data.value?.identificacoes.find((i) => i.tipo === props.tipo) ?? null);
const escolhido = computed(() => q.data.value?.motivos.find((m) => String(m.id) === motivo.value) ?? null);
const reimpressao = computed(() => (atual.value?.vias ?? 0) > 0);
const pronto = computed(() => !reimpressao.value || reimpressaoPronta(escolhido.value, complemento.value));
const historico = computed(() => (q.data.value?.reimpressoes ?? []).filter((r) => r.tipo === props.tipo));
watch(
  [reimpressao, pronto, motivo, complemento],
  () =>
    emit('mudou', {
      reimpressao: reimpressao.value,
      pronto: pronto.value,
      rotulo: reimpressao.value ? t('reimprimir') : null,
      corpo:
        reimpressao.value && escolhido.value
          ? {
              motivo: escolhido.value.id,
              ...(complemento.value.trim() ? { complemento: complemento.value.trim() } : {}),
            }
          : {},
    }),
  { immediate: true },
);
watch(
  () => props.recarregar,
  () => {
    motivo.value = '';
    complemento.value = '';
    void q.refetch();
  },
);
</script>

<template>
  <div v-if="atual" class="identificacao-impressa" :data-testid="`identificacao-${tipo}`">
    <p class="secundario" :data-testid="`identificacao-${tipo}-vias`">
      {{ reimpressao ? t('vias', { n: atual.vias }) : t('nunca') }}
      {{ atual.impressora ? t('impressora', { nome: atual.impressora.nome }) : t('semImpressora') }}
      <RouterLink
        v-if="!atual.impressora && pode('documento.cadastro.ler')"
        to="/administracao/impressao/estacoes"
        :data-testid="`identificacao-${tipo}-configurar`"
        >{{ t('configurar') }}</RouterLink
      >
    </p>
    <template v-if="reimpressao">
      <SanteSelecao
        v-model="motivo"
        :rotulo="t('motivo')"
        :opcoes="[
          { valor: '', rotulo: t('escolha') },
          ...(q.data.value?.motivos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
        ]"
        :data-testid="`identificacao-${tipo}-motivo`"
      />
      <SanteCampoTexto
        v-if="escolhido?.exigeComplemento"
        v-model="complemento"
        :rotulo="t('complemento')"
        :max-bytes="500"
        obrigatorio
        :data-testid="`identificacao-${tipo}-complemento`"
      />
      <p v-if="!pronto" role="status" :data-testid="`identificacao-${tipo}-falta`">
        {{ escolhido ? t('faltaComplemento') : t('faltaMotivo') }}
      </p>
      <details v-if="historico.length" :data-testid="`identificacao-${tipo}-historico`">
        <summary>{{ t('historico') }} ({{ historico.length }})</summary>
        <ul>
          <li v-for="r in historico" :key="r.id">
            {{
              t('linha', {
                via: r.via,
                motivo: r.complemento ? `${r.motivo}: ${r.complemento}` : r.motivo,
                quem: r.usuario ?? '-',
              })
            }}
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>
