<script setup lang="ts">
// Alta prevista (DPA) e barreiras de alta (ficha do M44, seção 7, etapa 2): `/internacao/nir/altas-previstas`. Os
// internados com a alta prevista vigente, o histórico das mudanças, os dias de permanência pela Portaria 312, os dias
// em terapia intensiva pela trajetória e as barreiras; o médico registra a alta prevista, o NIR e a equipe as barreiras.
import { SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';
import { CANAL_NIR, lerAltasPrevistas, lerGravacaoNir } from '../api-nir.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import InternadoNirDetalhe from '../componentes/InternadoNirDetalhe.vue';
import { leitoTexto } from '../regras-tela.js';

const { t } = useI18n();
const gravacao = useQuery({ queryKey: ['nir', 'gravacao'], queryFn: lerGravacaoNir, staleTime: 30_000 });
const pode = (acao: string) => gravacao.data.value?.operacoes[acao]?.pode ?? false;
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const avisos = usarAvisosAtendimento(CANAL_NIR, () => void altas.refetch());
const altas = useQuery({
  queryKey: ['nir', 'altas'],
  queryFn: lerAltasPrevistas,
  refetchInterval: computed(() => avisos.intervalo()),
});
const filtro = ref('');
const visiveis = computed(() => {
  const f = filtro.value.trim().toUpperCase();
  const itens = altas.data.value?.itens ?? [];
  return f
    ? itens.filter((i) => i.nome.toUpperCase().includes(f) || leitoTexto(i.leito).toUpperCase().includes(f))
    : itens;
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nir-altas-titulo" data-testid="tela-altas-previstas">
    <h1 id="nir-altas-titulo">{{ t('nir.altas.titulo') }}</h1>
    <p>{{ t('nir.altas.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/internacao/nir/permanencia">{{ t('nir.atalhos.permanencia') }}</RouterLink>
      <RouterLink to="/internacao/nir/fila">{{ t('nir.atalhos.fila') }}</RouterLink>
    </p>
    <AvisoAdt :motivo="aviso" />
    <SanteCampoTexto
      v-model="filtro"
      :rotulo="t('nir.altas.filtro')"
      :max-bytes="70"
      data-testid="altas-filtro"
    />
    <ErroAdt v-if="altas.isError.value" :erro="altas.error.value" />
    <p v-else-if="!altas.data.value" role="status">{{ t('nir.carregando') }}</p>
    <ul v-else class="lista-cartoes" data-testid="lista-altas">
      <InternadoNirDetalhe
        v-for="i in visiveis"
        :key="i.internacao"
        :internado="i"
        :pode="pode"
        @mudou="altas.refetch()"
      />
    </ul>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.lista-cartoes {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
</style>
