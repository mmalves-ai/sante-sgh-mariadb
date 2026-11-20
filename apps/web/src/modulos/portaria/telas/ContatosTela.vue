<script setup lang="ts">
// Relatório de contatos de visita (M50, etapa 5; regra 9; `hotelaria.visita.contatos`, das opções de relatórios da
// portaria): o controle de infecção escolhe a unidade (e, se quiser, o paciente) e o período (até 90 dias) e vê quem
// esteve com o paciente, com o documento mascarado e o telefone, para a investigação de surto. A tela lê só o que precisa
// (as unidades e os internados da unidade), sem depender das regras de visita da supervisão.
import type { ContatoVisita } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type InternadoDaUnidade,
  lerContatos,
  lerInternadosContatos,
  lerUnidadesContatos,
} from '../api-portaria.js';
import ErroPortaria from '../componentes/ErroPortaria.vue';

const { t } = useI18n();
const unidades = useQuery({
  queryKey: ['portaria', 'contatos', 'unidades'],
  queryFn: () => lerUnidadesContatos(),
});
const erro = ref<unknown>(null);
const hora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const contatos = ref<ContatoVisita[] | null>(null);
const contato = ref({ unidade: '', internacao: null as number | null, de: '', ate: '' });
const internadosContato = ref<InternadoDaUnidade[]>([]);
watch(
  () => contato.value.unidade,
  async (u) => {
    internadosContato.value = [];
    contato.value.internacao = null;
    if (!u) return;
    try {
      internadosContato.value = await lerInternadosContatos(u);
    } catch (x) {
      erro.value = x;
    }
  },
);
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: '—' },
  ...(unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: u.nome })),
]);
const opcoesInternadosContato = computed(() => [
  { valor: null, rotulo: t('portaria.contatos.todaUnidade') },
  ...internadosContato.value.map((i) => ({
    valor: i.internacao as number | null,
    rotulo: `${i.leito} · ${i.nome}`,
  })),
]);
async function emitirContatos(): Promise<void> {
  erro.value = null;
  try {
    contatos.value = await lerContatos({
      internacao: contato.value.internacao,
      unidade: contato.value.internacao ? null : contato.value.unidade,
      de: contato.value.de,
      ate: contato.value.ate,
    });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-portaria" aria-labelledby="ct-titulo" data-testid="tela-portaria-contatos">
    <h1 id="ct-titulo">{{ t('portaria.contatos.titulo') }}</h1>
    <p class="secundario">{{ t('portaria.contatos.ajuda') }}</p>
    <nav class="barra" :aria-label="t('portaria.navegacao')">
      <RouterLink to="/portaria">{{ t('portaria.links.portaria') }}</RouterLink>
    </nav>
    <p v-if="unidades.isLoading.value">{{ t('portaria.carregando') }}</p>
    <ErroPortaria v-else-if="unidades.error.value" :erro="unidades.error.value" />
    <template v-else>
      <ErroPortaria v-if="erro" :erro="erro" />
      <form class="campos cartao" @submit.prevent="emitirContatos">
        <SanteSelecao
          v-model="contato.unidade"
          :rotulo="t('portaria.regras.unidade')"
          :opcoes="opcoesUnidade"
          data-testid="rg-contato-unidade"
        />
        <SanteSelecao
          v-model="contato.internacao"
          :rotulo="t('portaria.bloqueios.paciente')"
          :opcoes="opcoesInternadosContato"
          data-testid="rg-contato-paciente"
        />
        <span class="campo">
          <label for="rg-contato-de">{{ t('portaria.contatos.de') }}</label>
          <input id="rg-contato-de" v-model="contato.de" type="date" data-testid="rg-contato-de" />
        </span>
        <span class="campo">
          <label for="rg-contato-ate">{{ t('portaria.contatos.ate') }}</label>
          <input id="rg-contato-ate" v-model="contato.ate" type="date" data-testid="rg-contato-ate" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portaria.contatos.emitir')"
          :desabilitado="!contato.unidade || !contato.de || !contato.ate"
          data-testid="rg-contato-emitir"
        />
      </form>
      <p v-if="contatos && contatos.length === 0">{{ t('portaria.contatos.nenhum') }}</p>
      <div v-else-if="contatos" class="rolagem">
        <table class="grade" data-testid="rg-contatos">
          <thead>
            <tr>
              <th scope="col">{{ t('portaria.abertas.visitante') }}</th>
              <th scope="col">{{ t('portaria.contatos.documento') }}</th>
              <th scope="col">{{ t('portaria.contatos.telefone') }}</th>
              <th scope="col">{{ t('portaria.bloqueios.paciente') }}</th>
              <th scope="col">{{ t('portaria.abertas.entrada') }}</th>
              <th scope="col">{{ t('portaria.contatos.saida') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in contatos" :key="c.visita">
              <td>
                {{ c.visitante
                }}<span v-if="c.papel === 'acompanhante'" class="secundario">
                  · {{ t('portaria.abertas.acompanhante') }}</span
                >
              </td>
              <td>{{ c.documentoMascarado }}</td>
              <td>{{ c.telefone ?? '—' }}</td>
              <td>{{ c.paciente }} · {{ c.unidade }}</td>
              <td>{{ hora(c.entrada) }}</td>
              <td>{{ c.saida ? hora(c.saida) : t('portaria.contatos.emVisita') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style src="../estilo-portaria.css"></style>
