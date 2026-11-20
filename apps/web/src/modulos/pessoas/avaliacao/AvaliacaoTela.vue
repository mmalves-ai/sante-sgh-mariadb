<script setup lang="ts">
// Avaliação de desempenho (W0-06, parte 5d; M2 de mercado; `pessoas.avaliacao.ler`, gravação com
// `pessoas.avaliacao.gerir` e a chave `pessoas.colaborador` ligada). Abas: os ciclos (período, prazo, escala de notas,
// situação com motivo, as avaliações do ciclo e o histórico) e as competências (com os cargos avaliados em cada uma).
// Toda alteração, inativação, passagem de situação e exclusão pede o motivo; a exclusão só vale para o nunca usado
// (o 409 traz a contagem e a tela oferece o caminho certo no próprio diálogo). Parte 5d-2: a ficha da avaliação (notas,
// finalização, ciência registrada, correção por versão, exclusão do rascunho) e a aba dos alertas de experiência. O modelo nasce vazio: competências e
// escala são dados do estabelecimento.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { lerApoioAvaliacao } from './api-avaliacao.js';
import AlertasExperiencia from './AlertasExperiencia.vue';
import CiclosAvaliacao from './CiclosAvaliacao.vue';
import CompetenciasAvaliacao from './CompetenciasAvaliacao.vue';
import FichaAvaliacao from './FichaAvaliacao.vue';

type Aba = 'ciclos' | 'competencias' | 'alertas';
const ABAS: readonly Aba[] = ['ciclos', 'competencias', 'alertas'];

const { t } = useI18n();
const qc = useQueryClient();
const apoio = useQuery({ queryKey: ['pessoas', 'avaliacao', 'apoio'], queryFn: lerApoioAvaliacao });
const a = computed(() => apoio.data.value ?? null);
const aba = ref<Aba>('ciclos');
const resultado = ref<string | null>(null);
/** A avaliação aberta na ficha (da lista do ciclo, do alerta ou da abertura). */
const avaliacao = ref<number | null>(null);

async function aposGravar(r: unknown): Promise<void> {
  const m = (r as { mensagem?: unknown } | null)?.mensagem;
  resultado.value = typeof m === 'string' ? m : null;
  await qc.invalidateQueries({ queryKey: ['pessoas', 'avaliacao'] });
}
function trocar(x: Aba): void {
  resultado.value = null;
  avaliacao.value = null;
  aba.value = x;
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-aval-titulo" data-testid="tela-avaliacao">
    <h1 id="pes-aval-titulo">{{ t('pessoas.avaliacao.titulo') }}</h1>
    <p>{{ t('pessoas.avaliacao.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.acoes.gerir && a.acoes.motivo"
        :texto="a.acoes.motivo"
        variante="info"
        data-testid="avaliacao-gravacao-desligada"
      />
      <div role="status" aria-live="polite">
        <SanteAlerta v-if="resultado" :texto="resultado" variante="info" data-testid="avaliacao-resultado" />
      </div>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in ABAS"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`pessoas.avaliacao.abas.${x}`)"
          :data-testid="`avaliacao-aba-${x}`"
          @acionar="trocar(x)"
        />
      </div>
      <CiclosAvaliacao v-if="aba === 'ciclos'" :apoio="a" @gravado="aposGravar" @abrir="avaliacao = $event" />
      <AlertasExperiencia
        v-else-if="aba === 'alertas'"
        :apoio="a"
        @gravado="aposGravar"
        @abrir="avaliacao = $event"
      />
      <CompetenciasAvaliacao v-else :apoio="a" @gravado="aposGravar" />
      <FichaAvaliacao v-if="avaliacao !== null" v-model:id="avaliacao" @gravado="aposGravar" />
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
