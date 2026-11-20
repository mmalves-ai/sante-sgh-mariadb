<script setup lang="ts">
// Entrada das especialidades (ficha do M45, seção 7; DP-32): `/pep/especialidades/<oftalmologia|oncologia|obstetricia>`.
// A busca das internações abertas (nome, prontuário ou número), auditada no servidor; o paciente abre a tela da
// especialidade. A oncologia tem ainda os protocolos e a fila da validação farmacêutica.
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  lerGravacaoEspecialidade,
  lerInternacoesEspecialidade,
  type NomeEspecialidade,
} from '../api-especialidades.js';
import AvisoEspecialidade from '../componentes/AvisoEspecialidade.vue';
import ErroEspecialidade from '../componentes/ErroEspecialidade.vue';
import { instanteCurto, leitoTexto } from '../regras-especialidades.js';

const { t } = useI18n();
const rota = useRoute();
const nome = computed(() => (rota.meta['especialidade'] as NomeEspecialidade | undefined) ?? 'oftalmologia');
const gravacao = useQuery({
  queryKey: computed(() => ['especialidades', nome.value, 'gravacao']),
  queryFn: () => lerGravacaoEspecialidade(nome.value),
  staleTime: 30_000,
});
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const termo = ref('');
const buscado = ref('');
const lista = useQuery({
  queryKey: computed(() => ['especialidades', nome.value, 'internacoes', buscado.value]),
  queryFn: () => lerInternacoesEspecialidade(nome.value, buscado.value),
});
function buscar(): void {
  buscado.value = termo.value.trim();
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="esp-busca-titulo" data-testid="tela-especialidade-busca">
    <h1 id="esp-busca-titulo">{{ t(`especialidades.${nome}.titulo`) }}</h1>
    <p>{{ t(`especialidades.${nome}.texto`) }}</p>
    <p v-if="nome === 'oncologia'" class="acoes">
      <RouterLink to="/pep/especialidades/oncologia/protocolos" data-testid="link-protocolos">{{
        t('especialidades.oncologia.protocolos')
      }}</RouterLink>
      <RouterLink to="/pep/especialidades/oncologia/validacao">{{
        t('especialidades.oncologia.validacao')
      }}</RouterLink>
    </p>
    <AvisoEspecialidade :motivo="aviso" />
    <form class="filtros" @submit.prevent="buscar">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t('especialidades.buscar')"
        :max-bytes="60"
        data-testid="esp-busca-termo"
      />
      <SanteBotao tipo="submit" :rotulo="t('especialidades.pesquisar')" data-testid="esp-busca-pesquisar" />
    </form>
    <ErroEspecialidade v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.cortada" role="status">{{ t('especialidades.cortada') }}</p>
      <p v-if="lista.data.value.itens.length === 0">{{ t('especialidades.nenhum') }}</p>
      <table v-else class="tabela" data-testid="esp-busca-tabela">
        <caption>
          {{
            t('especialidades.internados')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('especialidades.paciente') }}</th>
            <th scope="col">{{ t('especialidades.prontuario') }}</th>
            <th scope="col">{{ t('especialidades.leito') }}</th>
            <th scope="col">{{ t('especialidades.admissao') }}</th>
            <th scope="col">{{ t('especialidades.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in lista.data.value.itens" :key="i.internacao">
            <td>
              <strong>{{ i.nome }}</strong>
            </td>
            <td>{{ i.prontuario }}</td>
            <td>{{ leitoTexto(i.leito) }}</td>
            <td>{{ instanteCurto(i.entrada) }}</td>
            <td>
              <RouterLink
                :to="`/pep/especialidades/${nome}/${i.internacao}`"
                :data-testid="`esp-abrir-${i.internacao}`"
                >{{ t('especialidades.abrir') }}</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
