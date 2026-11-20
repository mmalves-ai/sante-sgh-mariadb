<script setup lang="ts">
// Prontuário ao vivo: busca do paciente (M15; ficha, seção 7). A mesma busca do cadastro (nome sem acento, mãe,
// telefone, CPF, prontuário, nascimento), com a lista mascarada pelo servidor; cada paciente abre o prontuário,
// que pede o motivo de acesso na primeira abertura da sessão. O termo fica na URL (?q=) para a paleta (Ctrl+K).
import { TIPOS_BUSCA_PACIENTE, type PacienteResumo, type TipoBuscaPaciente } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { dataBr } from '../../cadastro/formato.js';
import { buscarPacientesPep } from '../api-pep.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const textoDaRota = (v: unknown) => (typeof v === 'string' ? v : '');
const termo = ref(textoDaRota(rota.query['q']));
const tipo = ref<TipoBuscaPaciente>('auto');
const pedido = ref<{ termo: string; tipo: TipoBuscaPaciente } | null>(
  termo.value.trim() ? { termo: termo.value.trim(), tipo: 'auto' } : null,
);
watch(
  () => rota.query['q'],
  (q) => {
    const novo = textoDaRota(q).trim();
    if (novo && novo !== pedido.value?.termo) {
      termo.value = novo;
      pedido.value = { termo: novo, tipo: tipo.value };
    }
  },
);
const opcoesTipo = computed(() =>
  TIPOS_BUSCA_PACIENTE.map((v) => ({ valor: v, rotulo: t(`cadastro.busca.tipos.${v}`) })),
);
const busca = useQuery({
  queryKey: computed(() => ['pep', 'busca', pedido.value]),
  queryFn: () => buscarPacientesPep(pedido.value!.termo, pedido.value!.tipo),
  enabled: computed(() => pedido.value !== null),
  staleTime: 0,
});
const r = computed(() => busca.data.value);

function buscar(): void {
  const x = termo.value.trim();
  if (!x) return;
  pedido.value = { termo: x, tipo: tipo.value };
  void roteador.replace({ query: { q: x } });
}
const nomeDe = (p: PacienteResumo) => (p.nomeSocial ? `${p.nomeSocial} (${p.nome})` : p.nome);
</script>

<template>
  <section class="tela" aria-labelledby="pep-busca-titulo" data-testid="tela-prontuario-busca">
    <h1 id="pep-busca-titulo">{{ t('pep.busca.titulo') }}</h1>
    <p>{{ t('pep.busca.texto') }}</p>
    <p>
      <RouterLink to="/pep/prontuario/excecoes" data-testid="link-excecoes">{{
        t('pep.busca.excecoes')
      }}</RouterLink>
    </p>
    <form class="barra" role="search" @submit.prevent="buscar">
      <div class="campo">
        <label for="termo-prontuario">{{ t('pep.busca.termo') }}</label>
        <input
          id="termo-prontuario"
          v-model="termo"
          type="search"
          maxlength="100"
          autocomplete="off"
          data-testid="termo-prontuario"
        />
      </div>
      <SanteSelecao v-model="tipo" :rotulo="t('cadastro.busca.tipo')" :opcoes="opcoesTipo" />
      <SanteBotao :rotulo="t('pep.busca.buscar')" tipo="submit" data-testid="botao-buscar-prontuario" />
    </form>
    <MensagemErro v-if="busca.isError.value" :erro="busca.error.value" />
    <p v-else-if="busca.isFetching.value" role="status">{{ t('pep.carregando') }}</p>
    <template v-else-if="r">
      <p v-if="r.itens.length === 0 && r.sugestoes.length === 0" role="status">{{ t('pep.busca.vazio') }}</p>
      <table v-if="r.itens.length > 0" data-testid="resultado-prontuario">
        <caption>
          {{
            t('pep.busca.legenda', { n: r.itens.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.busca.prontuario') }}</th>
            <th scope="col">{{ t('cadastro.busca.nome') }}</th>
            <th scope="col">{{ t('cadastro.busca.nascimento') }}</th>
            <th scope="col">{{ t('cadastro.busca.mae') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in r.itens" :key="p.id" :data-testid="`prontuario-paciente-${p.id}`">
            <td>{{ p.prontuario }}</td>
            <td>
              <RouterLink
                :to="`/pep/prontuario/${p.id}`"
                :aria-label="t('pep.busca.abrir', { nome: nomeDe(p) })"
                >{{ nomeDe(p) }}</RouterLink
              >
              <span v-if="p.obito" class="marca">{{ t('cadastro.busca.obito') }}</span>
            </td>
            <td>{{ dataBr(p.nascimento) }}</td>
            <td>{{ p.maeMascarada ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="r.sugestoes.length > 0">
        <p>{{ t('cadastro.busca.sugestoes') }}</p>
        <ul>
          <li v-for="p in r.sugestoes" :key="p.id">
            <RouterLink :to="`/pep/prontuario/${p.id}`">{{ nomeDe(p) }}</RouterLink>
            <span> · {{ dataBr(p.nascimento) }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style scoped>
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-width: 18rem;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
li a,
td a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.marca {
  margin-left: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
</style>
