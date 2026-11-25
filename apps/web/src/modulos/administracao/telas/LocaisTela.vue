<script setup lang="ts">
// "Locais de atendimento, centros de custo e locais de conta" (M10, ficha seção 7): os cadastros de locais,
// clínicas, feriados, prioridades e afins pelo cadastro genérico, e os complementos dos locais (guichês por
// recepção). Os consultórios e salas (horário, encaminhamento, visibilidade e usuários) têm manutenção própria
// (02-REC linha 34) no painel abaixo.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarLocaisComplementos } from '../api.js';
import LocaisAtendimentoManutencao from '../componentes/LocaisAtendimentoManutencao.vue';

const props = defineProps<{
  subitem: 'estruturaLocais' | 'estruturaCentrosCusto' | 'estruturaLocaisConta';
  titulo: string;
}>();
const { t } = useI18n();
const complementos = useQuery({
  queryKey: ['adm', 'locais-complementos'],
  queryFn: () => buscarLocaisComplementos(),
  enabled: props.subitem === 'estruturaLocais',
});
const podeEditarLocal = computed(() => pode('organizacao.local.editar'));
</script>

<template>
  <section class="tela" aria-labelledby="locais-titulo">
    <h1 id="locais-titulo">{{ t(titulo) }}</h1>
    <DominiosIndiceTela :subitem="subitem" :embutido="true" />
    <template v-if="subitem === 'estruturaLocais'">
      <LocaisAtendimentoManutencao :pode-editar="podeEditarLocal" />
      <MensagemErro v-if="complementos.isError.value" :erro="complementos.error.value" />
      <template v-else-if="complementos.data.value">
        <h2>{{ t('adm.locais.guiches') }}</h2>
        <ul data-testid="guiches">
          <li v-for="g in complementos.data.value.guiches" :key="`${g.recepcao}-${g.numero}`">
            {{ g.recepcao }} · {{ g.numero }}
          </li>
        </ul>
        <p>
          {{
            t('adm.locais.complementos', {
              h: complementos.data.value.horarios,
              e: complementos.data.value.encaminhamentos,
              p: complementos.data.value.pesquisados,
            })
          }}
        </p>
      </template>
    </template>
  </section>
</template>
