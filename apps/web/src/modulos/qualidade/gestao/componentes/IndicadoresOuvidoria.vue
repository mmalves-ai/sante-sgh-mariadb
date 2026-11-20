<script setup lang="ts">
// W0-04 (M4, mercado: ouvidoria/SAC hospitalar): os indicadores da ouvidoria na competência, sempre com a conta
// impressa: respostas no prazo (sobre as respondidas e as de prazo vencido), por tipo, por área responsável e por canal
// de origem. As canceladas ficam fora da conta.
import { rotuloCanalManifestacao, rotuloTipoManifestacao } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { type IndicadoresOuvidoriaTela, lerIndicadoresOuvidoria } from '../api-gestao.js';
import ErroGestao from './ErroGestao.vue';

const props = defineProps<{ competencia: string }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) =>
  t(`gestaoQualidade.ouvidoria.indicadores.${k}`, p ?? {});
const q = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'ouvidoriaIndicadores', props.competencia]),
  queryFn: () => lerIndicadoresOuvidoria(props.competencia),
  enabled: computed(() => !!props.competencia),
});
type Grupo = IndicadoresOuvidoriaTela['porTipo'][number];
const partes = computed(() => {
  const d = q.data.value;
  if (!d) return [];
  return [
    {
      id: 'tipo',
      titulo: T('porTipo'),
      itens: d.porTipo,
      rotulo: (g: Grupo) => rotuloTipoManifestacao(g.chave as never),
    },
    { id: 'area', titulo: T('porArea'), itens: d.porArea, rotulo: (g: Grupo) => g.chave },
    {
      id: 'canal',
      titulo: T('porCanal'),
      itens: d.porCanal,
      rotulo: (g: Grupo) => rotuloCanalManifestacao(g.chave as never),
    },
  ];
});
const taxa = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);
</script>

<template>
  <section class="painel-ccih" data-testid="ouvidoria-indicadores">
    <p class="secundario">{{ T('explicacao') }}</p>
    <ErroGestao v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <template v-else>
      <p data-testid="ouv-ind-prazo">{{ T('prazo', { n: q.data.value.prazoDiasUteis }) }}</p>
      <p v-if="q.data.value.cortada" role="alert">{{ T('cortada') }}</p>
      <dl class="ficha-gestao" data-testid="ouv-ind-resumo">
        <dt>{{ T('total') }}</dt>
        <dd>{{ q.data.value.total }}</dd>
        <dt>{{ T('canceladas') }}</dt>
        <dd>{{ q.data.value.canceladas }}</dd>
        <dt>{{ T('respondidas') }}</dt>
        <dd>{{ q.data.value.respondidas }}</dd>
        <dt>{{ T('vencidas') }}</dt>
        <dd>{{ q.data.value.vencidas }}</dd>
        <dt>{{ T('noPrazo') }}</dt>
        <dd data-testid="ouv-ind-no-prazo">
          {{ taxa(q.data.value.noPrazo.valor) }}
          <span v-if="q.data.value.noPrazo.conta" class="secundario">({{ q.data.value.noPrazo.conta }})</span>
        </dd>
      </dl>
      <table v-for="p in partes" :key="p.id" class="tabela" :data-testid="`ouv-ind-${p.id}`">
        <caption>
          {{
            p.titulo
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('colGrupo') }}</th>
            <th scope="col">{{ T('colTotal') }}</th>
            <th scope="col">{{ T('colRespondidas') }}</th>
            <th scope="col">{{ T('colVencidas') }}</th>
            <th scope="col">{{ T('colNoPrazo') }}</th>
            <th scope="col">{{ T('colConta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in p.itens" :key="g.chave" :data-testid="`ouv-ind-${p.id}-${g.chave}`">
            <th scope="row">{{ p.rotulo(g) }}</th>
            <td>{{ g.total }}</td>
            <td>{{ g.respondidas }}</td>
            <td>{{ g.vencidas }}</td>
            <td>{{ taxa(g.noPrazo.valor) }}</td>
            <td>{{ g.noPrazo.conta ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
