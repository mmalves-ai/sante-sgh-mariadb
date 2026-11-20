<script setup lang="ts">
// Centros de custo e critérios de rateio (M54, etapa 4; item `Controladoria > Custos hospitalares > Centros de custo e
// critérios de rateio`; `custos.centro.ler` / `custos.centro.editar` / `custos.estatistica.registrar`): a estrutura de
// custos (classe, ordem e critério do rateio de cada centro, com a sugestão, as pendências que bloqueiam a apuração e a
// sequência do rateio), as estatísticas do mês (coleta das fontes agregadas, matriz com a origem e o total com as
// parcelas, lançamento manual) e os cadastros do custeio (CRUD genérico embutido). As ações aparecem só com a permissão e
// a liberação; o servidor confere de novo.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../config/telas/GrupoDominiosTela.vue';
import AbaEstatisticasCustos from './AbaEstatisticasCustos.vue';
import AbaEstruturaCustos from './AbaEstruturaCustos.vue';
import { lerApoioCustos } from './api-custos.js';
import ErroCustos from './ErroCustos.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const apoio = useQuery({ queryKey: ['custos', 'apoio'], queryFn: lerApoioCustos });
const a = computed(() => apoio.data.value ?? null);

type Aba = 'estrutura' | 'estatisticas' | 'cadastros';
const ABAS: readonly Aba[] = ['estrutura', 'estatisticas', 'cadastros'];
const aba = ref<Aba>('estrutura');
const hoje = props.hoje ?? new Date().toISOString().slice(0, 10);
const aviso = computed(() => {
  const x = a.value;
  if (!x) return null;
  if (!x.liberacao.ligada) return t('custos.desligada');
  if (!x.acoes.editar && !x.acoes.registrarEstatistica) return t('custos.semPermissaoGravar');
  return null;
});
</script>

<template>
  <section class="tela-custos" aria-labelledby="custos-titulo" data-testid="tela-centros-custo">
    <h1 id="custos-titulo">{{ t('custos.titulo') }}</h1>
    <p>{{ t('custos.subtitulo') }}</p>
    <ErroCustos v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('custos.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="custos-aviso-gravacao" />
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in ABAS"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`custos.abas.${x}`)"
          :data-testid="`custos-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <AbaEstruturaCustos v-if="aba === 'estrutura'" :apoio="a" />
      <AbaEstatisticasCustos v-else-if="aba === 'estatisticas'" :apoio="a" :hoje="hoje" />
      <section v-else class="bloco" :aria-label="t('custos.cadastros.titulo')" data-testid="custos-cadastros">
        <p class="secundario">{{ t('custos.cadastros.ajuda') }}</p>
        <GrupoDominiosTela subitem="custosCadastros" embutida />
      </section>
    </template>
  </section>
</template>

<style scoped src="./estilo-custos.css"></style>
