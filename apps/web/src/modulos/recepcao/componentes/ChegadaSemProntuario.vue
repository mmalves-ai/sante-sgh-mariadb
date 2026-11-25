<script setup lang="ts">
// 02-AGE 42: na chegada, os marcados de hoje sem prontuário (a lista de agendados do guichê só traz quem já é
// paciente, e a chegada recusa a marcação sem paciente). A recepção converte o pré-cadastro ali mesmo e a marcação
// passa à lista para ligar a senha. A leitura é a do painel do dia da agenda (agenda.marcacao.ler); a regra de quem
// tem pré-cadastro a converter vem do domínio da agenda (preCadastroAConverter), pelo campo da resposta.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerPainelDia } from '../../agenda/api-agenda.js';
import ConverterPreCadastro from '../../cadastro/componentes/ConverterPreCadastro.vue';

const emit = defineEmits<{ convertido: [] }>();
const { t } = useI18n();
const painel = useQuery({
  queryKey: ['recepcao', 'sem-prontuario-hoje'],
  queryFn: () => lerPainelDia(null, null),
});
const pendentes = computed(() =>
  (painel.data.value?.marcacoes ?? []).filter((m) => (m.preCadastroAConverter ?? null) !== null),
);
const aberto = ref<number | null>(null);
const aviso = ref('');
async function convertido(): Promise<void> {
  aberto.value = null;
  aviso.value = t('recepcao.guiche.semProntuarioConvertido');
  await painel.refetch();
  emit('convertido');
}
</script>

<template>
  <section
    v-if="pendentes.length || aviso"
    class="sem-prontuario"
    data-testid="chegada-sem-prontuario"
    :aria-label="t('recepcao.guiche.semProntuarioTitulo')"
  >
    <h3>{{ t('recepcao.guiche.semProntuarioTitulo') }}</h3>
    <p v-if="aviso" role="status" data-testid="chegada-sem-prontuario-aviso">{{ aviso }}</p>
    <template v-if="pendentes.length">
      <p>{{ t('recepcao.guiche.semProntuarioTexto') }}</p>
      <ul>
        <li v-for="m in pendentes" :key="m.id">
          <SanteBotao
            variante="texto"
            :rotulo="
              t('recepcao.guiche.semProntuarioConverter', {
                paciente: m.paciente,
                hora: m.hora,
                agenda: m.nomeAgenda,
              })
            "
            :data-testid="`chegada-converter-${m.id}`"
            @acionar="aberto = m.preCadastroAConverter ?? null"
          />
          <ConverterPreCadastro
            v-if="aberto !== null && aberto === m.preCadastroAConverter"
            :pre-cadastro="aberto"
            @convertido="convertido"
            @fechar="aberto = null"
          />
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.sem-prontuario {
  margin-block-end: 0.75rem;
  padding-block-end: 0.5rem;
  border-block-end: 1px solid var(--sgh-borda);
}
</style>
