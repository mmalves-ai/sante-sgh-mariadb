<script setup lang="ts">
// Intervenções farmacêuticas para responder (ficha do M29, seção 5, `suprimentos.registrarIntervencao`: o aviso ao
// prescritor): `/farmacia/intervencoes`, também na fila de trabalho do médico. O prescritor do item aceita ou recusa
// (a recusa com a justificativa); base do indicador "intervenções aceitas".
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerMinhasIntervencoes, novaChave, responder } from '../api-farmacia.js';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { horario } from '../usar-farmacia.js';

const { t } = useI18n();
const lista = useQuery({
  queryKey: ['farmacia', 'intervencoes', 'minhas'],
  queryFn: () => lerMinhasIntervencoes(),
  refetchInterval: 60_000,
});
const justificativas = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function responderA(id: number, resposta: 'aceita' | 'recusada'): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (
      await responder(id, { resposta, justificativa: justificativas.value[id] ?? '' }, novaChave('resposta'))
    ).mensagem;
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="int-titulo" data-testid="tela-farmacia-intervencoes">
    <h1 id="int-titulo">{{ t('farmacia.intervencoes.titulo') }}</h1>
    <p>{{ t('farmacia.intervencoes.texto') }}</p>
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="int-mensagem">{{ mensagem }}</p>
    <p v-if="(lista.data.value ?? []).length === 0">{{ t('farmacia.intervencoes.nenhuma') }}</p>
    <article v-for="i in lista.data.value ?? []" :key="i.id" class="painel" :data-testid="`int-${i.id}`">
      <h2>{{ t(`farmacia.avaliacao.tipos.${i.tipo}`) }} · {{ horario(i.criadaEm) }} · {{ i.autor }}</h2>
      <p>{{ i.texto }}</p>
      <span class="campo">
        <label :for="`int-just-${i.id}`">{{ t('farmacia.justificativa') }}</label>
        <input :id="`int-just-${i.id}`" v-model="justificativas[i.id]" maxlength="250" />
      </span>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('farmacia.intervencoes.aceitar')"
          :data-testid="`int-aceitar-${i.id}`"
          @acionar="responderA(i.id, 'aceita')"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('farmacia.intervencoes.recusar')"
          @acionar="responderA(i.id, 'recusada')"
        />
      </div>
    </article>
  </section>
</template>
