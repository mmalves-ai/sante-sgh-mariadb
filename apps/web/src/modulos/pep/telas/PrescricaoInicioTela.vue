<script setup lang="ts">
// Entrada da prescrição pelo menu (M24): a busca do paciente (a mesma do prontuário) leva à tela do destino
// (prescrição, hemoterapia, aplicar protocolo, prescrição futura, reconciliação); abaixo, as prescrições que vencem
// nas próximas horas (renovar antes de vencer; a fila do turno chega com a jornada).
import { type PacienteResumo } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { dataBr } from '../../cadastro/formato.js';
import { buscarPacientesPep } from '../api-pep.js';
import { aRenovar } from '../api-prescricao.js';
import { dataHoraBr } from '../formato.js';

type Destino = 'prescricao' | 'hemoterapia' | 'montar' | 'futura' | 'reconciliacao' | 'farmacovigilancia';
const props = withDefaults(defineProps<{ destino?: Destino }>(), { destino: 'prescricao' });
const { t } = useI18n();
const termo = ref('');
const pedido = ref<string | null>(null);
const busca = useQuery({
  queryKey: computed(() => ['presc', 'busca', pedido.value]),
  queryFn: () => buscarPacientesPep(pedido.value!, 'auto'),
  enabled: computed(() => pedido.value !== null),
  staleTime: 0,
});
// Ficha, seção 4: as que vencem no turno por unidade (a lista de trabalho de renovação), com o paciente e o leito.
const unidade = ref('');
const todas = useQuery({
  queryKey: ['presc', 'a-renovar', ''],
  queryFn: () => aRenovar(6),
  staleTime: 60_000,
});
const vencem = useQuery({
  queryKey: computed(() => ['presc', 'a-renovar', unidade.value]),
  queryFn: () => aRenovar(6, unidade.value ? Number(unidade.value) : null),
  enabled: computed(() => unidade.value !== ''),
  staleTime: 60_000,
});
const lista = computed(() => (unidade.value ? vencem.data.value : todas.data.value) ?? []);
const erroVencem = computed(() => (unidade.value ? vencem.error.value : todas.error.value));
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t('pep.presc.inicio.todasUnidades') },
  ...[
    ...new Map(
      (todas.data.value ?? [])
        .filter((v) => v.unidade !== null)
        .map((v) => [String(v.unidade), v.unidadeNome ?? String(v.unidade)] as const),
    ).entries(),
  ].map(([valor, rotulo]) => ({ valor, rotulo })),
]);
function buscar(): void {
  const x = termo.value.trim();
  if (x) pedido.value = x;
}
const nomeDe = (p: PacienteResumo) => (p.nomeSocial ? `${p.nomeSocial} (${p.nome})` : p.nome);
function rotaDe(paciente: number): string {
  const base = `/pep/paciente/${paciente}`;
  switch (props.destino) {
    case 'hemoterapia':
      return `${base}/prescricao/nova?grupo=hemoterapia`;
    case 'montar':
      return `${base}/prescricao/nova?montar=1`;
    case 'futura':
      return `${base}/prescricao/futura`;
    case 'reconciliacao':
      return `${base}/reconciliacao`;
    case 'farmacovigilancia':
      return `${base}/farmacovigilancia`;
    default:
      return `${base}/prescricao`;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="presc-inicio-titulo" data-testid="tela-prescricao-inicio">
    <h1 id="presc-inicio-titulo">{{ t(`pep.presc.inicio.tituloDestino.${destino}`) }}</h1>
    <p>{{ t('pep.presc.inicio.texto') }}</p>
    <form class="barra" role="search" @submit.prevent="buscar">
      <div class="campo">
        <label for="termo-prescricao">{{ t('pep.presc.inicio.termo') }}</label>
        <input
          id="termo-prescricao"
          v-model="termo"
          type="search"
          maxlength="100"
          autocomplete="off"
          data-testid="busca-paciente-prescricao"
        />
      </div>
      <SanteBotao
        :rotulo="t('pep.presc.inicio.buscar')"
        tipo="submit"
        data-testid="buscar-paciente-prescricao"
      />
    </form>
    <MensagemErro v-if="busca.isError.value" :erro="busca.error.value" />
    <p v-else-if="busca.isFetching.value" role="status">{{ t('pep.presc.carregando') }}</p>
    <template v-else-if="busca.data.value">
      <p v-if="busca.data.value.itens.length === 0" role="status">{{ t('pep.presc.inicio.vazio') }}</p>
      <ul v-else class="lista" data-testid="pacientes-prescricao">
        <li v-for="p in busca.data.value.itens" :key="p.id" :data-testid="`paciente-prescricao-${p.id}`">
          <RouterLink :to="rotaDe(p.id)" :aria-label="t('pep.presc.inicio.abrir', { nome: nomeDe(p) })">{{
            nomeDe(p)
          }}</RouterLink>
          <span> · {{ dataBr(p.nascimento) }} · {{ p.prontuario }}</span>
        </li>
      </ul>
    </template>
    <section v-if="destino === 'prescricao'" aria-labelledby="presc-vencem">
      <h2 id="presc-vencem">{{ t('pep.presc.inicio.aRenovar', { horas: 6 }) }}</h2>
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('pep.presc.inicio.unidade')"
        :opcoes="opcoesUnidade"
        data-testid="a-renovar-unidade"
      />
      <MensagemErro v-if="erroVencem" :erro="erroVencem" />
      <p v-else-if="lista.length === 0" role="status">
        {{ t('pep.presc.inicio.aRenovarVazio') }}
      </p>
      <ul v-else class="lista" data-testid="a-renovar">
        <li v-for="v in lista" :key="v.prescricao" :data-testid="`a-renovar-${v.prescricao}`">
          <RouterLink
            :to="`/pep/paciente/${v.paciente}/prescricao/${v.prescricao}`"
            :aria-label="t('pep.presc.inicio.abrirRenovar', { nome: v.nome, fim: dataHoraBr(v.fim) })"
            >{{ v.nome }}</RouterLink
          >
          <span>
            ·
            {{
              t('pep.presc.inicio.aRenovarLinha', {
                unidade: v.unidadeNome ?? '—',
                leito: v.leito ?? '—',
                fim: dataHoraBr(v.fim),
              })
            }}</span
          >
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.tela {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
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
  min-height: var(--sgh-alvo-minimo);
}
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.lista a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
</style>
