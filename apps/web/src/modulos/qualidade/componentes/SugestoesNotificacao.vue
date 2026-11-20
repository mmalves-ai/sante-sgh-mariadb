<script setup lang="ts">
// Sugestões de notificação (M48, etapa 2; regra 4 da ficha): os registros da própria pessoa nos últimos 7 dias que
// podem ser incidentes (dose não administrada, erro interceptado na checagem, reação transfusional, exceção do
// checklist). Quem decide é a pessoa: "Notificar este" preenche o formulário; "Não é incidente" dispensa sem avisar
// ninguém (o servidor guarda só um resumo, sem a origem nem o login).
import type { SugestaoNotificacao } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveQualidade } from '../api.js';
import { dispensarSugestao, lerSugestoes } from '../api-seguranca.js';
import { dataHora } from '../regras-qualidade.js';
import ErroQualidade from './ErroQualidade.vue';

const emit = defineEmits<{ usar: [s: SugestaoNotificacao] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const sugestoes = useQuery({
  queryKey: ['qualidade', 'sugestoes'],
  queryFn: lerSugestoes,
  staleTime: 30_000,
});
const itens = computed(() => (sugestoes.data.value?.ligada ? sugestoes.data.value.itens : []));
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
async function dispensar(origem: string): Promise<void> {
  erro.value = null;
  try {
    const r = await dispensarSugestao(origem, novaChaveQualidade('dispensar'));
    feito.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['qualidade', 'sugestoes'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section
    v-if="itens.length > 0 || feito"
    class="sugestoes"
    aria-labelledby="sugestoes-titulo"
    data-testid="sugestoes"
  >
    <h2 id="sugestoes-titulo">{{ t('qualidade.sugestoes.titulo') }}</h2>
    <p class="sugestoes__nota">{{ t('qualidade.sugestoes.explicacao') }}</p>
    <p v-if="feito" role="status" data-testid="sugestao-dispensada">{{ feito }}</p>
    <ErroQualidade v-if="erro" :erro="erro" />
    <ul>
      <li v-for="s in itens" :key="s.origem" :data-testid="`sugestao-${s.origem}`">
        <strong>{{ s.titulo }}</strong> · {{ dataHora(s.quando) }}
        <span v-if="s.atendimento !== null">
          · {{ t('qualidade.sugestoes.atendimento', { n: s.atendimento }) }}</span
        >
        <div class="sugestoes__botoes">
          <SanteBotao
            :rotulo="t('qualidade.sugestoes.usar')"
            variante="secundario"
            :data-testid="`sugestao-usar-${s.origem}`"
            @acionar="emit('usar', s)"
          />
          <SanteBotao
            :rotulo="t('qualidade.sugestoes.dispensar')"
            variante="texto"
            :data-testid="`sugestao-dispensar-${s.origem}`"
            @acionar="dispensar(s.origem)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.sugestoes {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
.sugestoes h2 {
  font-size: 1rem;
  margin: 0;
}
.sugestoes ul {
  margin: var(--sgh-espaco-2) 0 0;
  padding-inline-start: var(--sgh-espaco-3);
}
.sugestoes__nota {
  margin: var(--sgh-espaco-1) 0 0;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.sugestoes__botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
