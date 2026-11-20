<script setup lang="ts">
// Movimentos da rouparia (M55, fatia F2): `/hotelaria/rouparia/movimentos`. O período (até 62 dias), o tipo e o setor;
// a lista paginada pela chave (teto de 200 por página, "carregar mais"); o detalhe com a conferência do retorno e o
// cancelamento no prazo.
import type { MovimentoRoupa } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { listarMovimentosRoupa } from '../api-rouparia.js';
import AvisoRouparia from '../componentes/AvisoRouparia.vue';
import DetalheMovimentoRoupa from '../componentes/DetalheMovimentoRoupa.vue';
import ErroRouparia from '../componentes/ErroRouparia.vue';
import NavRouparia from '../componentes/NavRouparia.vue';
import { dataCurta, fmtKg, instanteCurto, itensTexto, menosDias } from '../regras-rouparia.js';
import { OPCOES_TIPO, ROTULO_SITUACAO, ROTULO_TIPO, usarPainelRouparia } from '../usar-rouparia.js';

const { t } = useI18n();
const { painel, d, pode, aviso, opcoesSetor, nomeSetor } = usarPainelRouparia();
const de = ref<string | null>(null);
const ate = ref<string | null>(null);
const tipo = ref<string | null>(null);
const setor = ref<number | null>(null);
const opcoesTipo = computed(() => [{ valor: null, rotulo: t('rouparia.movimentos.todos') }, ...OPCOES_TIPO]);
const opcoesSetores = computed(() => [
  { valor: null, rotulo: t('rouparia.movimentos.todosSetores') },
  ...opcoesSetor.value,
]);

const itens = ref<MovimentoRoupa[]>([]);
const proximo = ref<number | null>(null);
const carregado = ref(false);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const aberto = ref<number | null>(null);
const mensagem = ref<string | null>(null);
async function buscar(antesDe: number | null): Promise<void> {
  if (!de.value || !ate.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await listarMovimentosRoupa({
      de: de.value,
      ate: ate.value,
      tipo: tipo.value,
      centroCusto: setor.value,
      antesDe,
    });
    itens.value = antesDe === null ? r.itens : [...itens.value, ...r.itens];
    proximo.value = r.proximo;
    carregado.value = true;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const filtrar = () => buscar(null);
watch(
  () => d.value?.hoje,
  (hoje) => {
    if (hoje && !ate.value) {
      ate.value = hoje;
      de.value = menosDias(hoje, 7);
      void filtrar();
    }
  },
  { immediate: true },
);
async function cancelado(m: string): Promise<void> {
  mensagem.value = m;
  aberto.value = null;
  await filtrar();
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rouparia-mov-titulo" data-testid="tela-rouparia-movimentos">
    <h1 id="rouparia-mov-titulo">{{ t('rouparia.movimentos.titulo') }}</h1>
    <NavRouparia />
    <AvisoRouparia :motivo="aviso" />
    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar />
    <ErroRouparia v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!d" role="status">{{ t('rouparia.carregando') }}</p>
    <template v-else>
      <form class="filtros" data-testid="rouparia-mov-filtros" @submit.prevent="filtrar">
        <SanteData v-model="de" :rotulo="t('rouparia.movimentos.de')" editavel />
        <SanteData v-model="ate" :rotulo="t('rouparia.movimentos.ate')" editavel />
        <SanteSelecao v-model="tipo" :rotulo="t('rouparia.campos.tipo')" :opcoes="opcoesTipo" />
        <SanteSelecao v-model="setor" :rotulo="t('rouparia.campos.setor')" :opcoes="opcoesSetores" busca />
        <SanteBotao
          tipo="submit"
          :rotulo="t('rouparia.movimentos.filtrar')"
          :desabilitado="ocupado"
          data-testid="rouparia-mov-filtrar"
        />
      </form>
      <p class="secundario">{{ t('rouparia.movimentos.periodo') }}</p>
      <ErroRouparia v-if="erro" :erro="erro" />
      <p v-else-if="carregado && itens.length === 0">{{ t('rouparia.movimentos.nenhum') }}</p>
      <table v-else-if="itens.length" class="tabela" data-testid="rouparia-mov-tabela">
        <caption>
          {{
            t('rouparia.movimentos.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('rouparia.tabela.quando') }}</th>
            <th scope="col">{{ t('rouparia.tabela.tipo') }}</th>
            <th scope="col">{{ t('rouparia.tabela.setor') }}</th>
            <th scope="col">{{ t('rouparia.tabela.peso') }}</th>
            <th scope="col">{{ t('rouparia.tabela.pecas') }}</th>
            <th scope="col">{{ t('rouparia.tabela.situacao') }}</th>
            <th scope="col">{{ t('rouparia.tabela.por') }}</th>
            <th scope="col">{{ t('rouparia.tabela.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in itens" :key="m.id" :data-testid="`mov-${m.id}`" :data-situacao="m.situacao">
            <td>{{ dataCurta(m.data) }} · {{ instanteCurto(m.em) }}</td>
            <td>
              {{ ROTULO_TIPO[m.tipo] }}
              <strong v-if="m.ocorrencia" class="alerta-texto">
                · {{ t('rouparia.tabela.ocorrencia') }}</strong
              >
            </td>
            <td>{{ nomeSetor(m.centroCusto) ?? t('rouparia.tabela.central') }}</td>
            <td>{{ fmtKg(m.pesoKg) }}</td>
            <td>
              {{ m.pecas }}
              <div class="secundario">{{ itensTexto(m.itens, d.pecas) }}</div>
            </td>
            <td>{{ ROTULO_SITUACAO[m.situacao] }}</td>
            <td>{{ m.por }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('rouparia.tabela.detalhe')"
                :data-testid="`mov-detalhe-${m.id}`"
                @click="aberto = m.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="proximo !== null"
        variante="secundario"
        :rotulo="t('rouparia.movimentos.mais')"
        :desabilitado="ocupado"
        @click="buscar(proximo)"
      />
      <DetalheMovimentoRoupa
        v-if="aberto !== null"
        :id="aberto"
        :painel="d"
        :pode="pode"
        @fechar="aberto = null"
        @cancelado="cancelado"
      />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-rouparia.css"></style>
