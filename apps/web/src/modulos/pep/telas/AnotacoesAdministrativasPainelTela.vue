<script setup lang="ts">
// Entrada das anotações administrativas do caso pelo menu (03-PEP L147): no topo a fila de leitura de quem recebeu
// (as anotações endereçadas a esta pessoa e ainda não lidas, sem o nome do paciente: o caso abre pela visão do
// paciente, que confere o vínculo e registra o acesso); abaixo, a busca do paciente (a mesma do prontuário, servida
// pelas rotas das anotações para o NIR e o serviço social sem leitura do prontuário) que leva à tela das anotações
// dele para escrever. Vindo de uma reserva de leito do NIR (?reserva=), abre direto o paciente da reserva.
import { type PacienteResumo } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { dataBr } from '../../cadastro/formato.js';
import {
  buscarPacientesAnotacoes,
  lerAnotacoesPendentes,
  lerPacienteDaReserva,
} from '../api-anotacoes-administrativas.js';
import { dataHoraBr } from '../formato.js';

const { t } = useI18n();
const fila = useQuery({
  queryKey: ['pep', 'anotacoes-administrativas', 'pendentes'],
  queryFn: () => lerAnotacoesPendentes(),
  staleTime: 0,
});
const termo = ref('');
const pedido = ref<string | null>(null);
const busca = useQuery({
  queryKey: computed(() => ['pep', 'anotacoes-administrativas', 'busca', pedido.value]),
  queryFn: () => buscarPacientesAnotacoes(pedido.value!),
  enabled: computed(() => pedido.value !== null),
  staleTime: 0,
});
function buscar(): void {
  const x = termo.value.trim();
  if (x) pedido.value = x;
}
const nomeDe = (p: PacienteResumo) => (p.nomeSocial ? `${p.nomeSocial} (${p.nome})` : p.nome);
const rotaDe = (paciente: number) => `/pep/paciente/${paciente}/anotacoes-administrativas`;

// Vindo da reserva de leito do NIR: o paciente da reserva abre com a anotação nova já ligada a ela.
const rota = useRoute();
const router = useRouter();
const reserva = computed(() => {
  const r = Number(rota.query['reserva']);
  return Number.isInteger(r) && r > 0 ? r : null;
});
const daReserva = useQuery({
  queryKey: computed(() => ['pep', 'anotacoes-administrativas', 'reserva', reserva.value]),
  queryFn: () => lerPacienteDaReserva(reserva.value!),
  enabled: computed(() => reserva.value !== null),
  staleTime: 0,
});
watch(
  () => daReserva.data.value,
  (r) => {
    if (r) void router.replace({ path: rotaDe(r.paciente), query: { reserva: String(r.reserva) } });
  },
  { immediate: true },
);
</script>

<template>
  <section class="tela" aria-labelledby="anot-painel-titulo" data-testid="anotacoes-adm-painel">
    <h1 id="anot-painel-titulo">{{ t('pep.anotAdm.painel.titulo') }}</h1>
    <p>{{ t('pep.anotAdm.painel.texto') }}</p>
    <MensagemErro v-if="daReserva.isError.value" :erro="daReserva.error.value" />
    <p v-else-if="reserva !== null && daReserva.isFetching.value" role="status">
      {{ t('pep.anotAdm.painel.reservaAbrindo') }}
    </p>
    <MensagemErro v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="fila.isFetching.value && !fila.data.value" role="status">{{ t('pep.carregando') }}</p>
    <template v-else-if="fila.data.value">
      <p v-if="fila.data.value.length === 0" role="status" data-testid="anotacoes-adm-fila-vazia">
        {{ t('pep.anotAdm.painel.vazio') }}
      </p>
      <ul v-else class="lista" data-testid="anotacoes-adm-fila">
        <li v-for="p in fila.data.value" :key="p.anotacao" :data-testid="`anotacoes-adm-fila-${p.anotacao}`">
          <RouterLink :to="rotaDe(p.paciente)">{{
            t('pep.anotAdm.painel.abrir', { prontuario: p.prontuario ?? '' })
          }}</RouterLink>
          <span>
            ·
            {{
              t('pep.anotAdm.painel.linha', {
                categoria: p.categoria,
                atendimento: p.atendimento,
                quando: dataHoraBr(p.registradaEm),
                autor: p.autor ?? '',
              })
            }}</span
          >
        </li>
      </ul>
    </template>

    <form class="barra" role="search" @submit.prevent="buscar">
      <div class="campo">
        <label for="termo-anotacoes">{{ t('pep.anotAdm.painel.termo') }}</label>
        <input
          id="termo-anotacoes"
          v-model="termo"
          type="search"
          maxlength="100"
          autocomplete="off"
          data-testid="anotacoes-adm-busca-paciente"
        />
      </div>
      <SanteBotao
        :rotulo="t('pep.anotAdm.painel.buscar')"
        tipo="submit"
        data-testid="anotacoes-adm-buscar-paciente"
      />
    </form>
    <MensagemErro v-if="busca.isError.value" :erro="busca.error.value" />
    <p v-else-if="busca.isFetching.value" role="status">{{ t('pep.carregando') }}</p>
    <template v-else-if="busca.data.value">
      <p v-if="busca.data.value.itens.length === 0" role="status">
        {{ t('pep.anotAdm.painel.nenhumPaciente') }}
      </p>
      <ul v-else class="lista" data-testid="anotacoes-adm-pacientes">
        <li v-for="p in busca.data.value.itens" :key="p.id" :data-testid="`anotacoes-adm-paciente-${p.id}`">
          <RouterLink
            :to="rotaDe(p.id)"
            :aria-label="t('pep.anotAdm.painel.abrirPaciente', { nome: nomeDe(p) })"
            >{{ nomeDe(p) }}</RouterLink
          >
          <span> · {{ dataBr(p.nascimento) }} · {{ p.prontuario }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
