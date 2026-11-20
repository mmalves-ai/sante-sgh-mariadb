<script setup lang="ts">
// Faixa da onda 0 (ficha do M38, campo 7): nas telas de consulta com ações de escrita, quando todas as gravações da
// tela estão recusadas para quem usa (a escrita do setor ainda não foi liberada), a faixa diz que a tela é só de
// consulta nesta etapa; as ações de escrita já aparecem desabilitadas ou escondidas pela mesma regra do executor.
// Texto de produto (ADR 0023): não aponta para outro sistema.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CHAVE_TELAS_ONDA0, usarSessao } from '../../../casca/sessao/sessao.js';
import { lerTelasOnda0 } from '../api-onda0.js';

const props = defineProps<{ tela: string }>();
const { t } = useI18n();
const { sessao } = usarSessao();
// A mesma consulta da sessão (mesma chave do cache): nenhuma leitura a mais.
const telas = useQuery({
  queryKey: computed(() => [CHAVE_TELAS_ONDA0, sessao.value?.estabelecimentoAtivo ?? '']),
  queryFn: () => lerTelasOnda0(),
  staleTime: 60_000,
  retry: 1,
});
const situacao = computed(() => telas.data.value?.telas.find((x) => x.id === props.tela) ?? null);
const soConsulta = computed(() => situacao.value?.escritaLiberada === false);
</script>

<template>
  <SanteAlerta
    v-if="soConsulta"
    :texto="t('liberacao.onda0.escritaDesligada')"
    variante="info"
    icone="info"
    data-testid="faixa-onda0"
  />
</template>
