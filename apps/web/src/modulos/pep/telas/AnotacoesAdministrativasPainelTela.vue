<script setup lang="ts">
// Entrada das anotações administrativas do caso pelo menu (03-PEP L147): no topo a fila de leitura de quem recebeu
// (as anotações endereçadas a esta pessoa e ainda não lidas, sem o nome do paciente: o caso abre pela visão do
// paciente, que confere o vínculo e registra o acesso); abaixo, a busca do paciente (a mesma do prontuário) que leva
// à tela das anotações dele para escrever.
import { type PacienteResumo } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { dataBr } from '../../cadastro/formato.js';
import { lerAnotacoesPendentes } from '../api-anotacoes-administrativas.js';
import { buscarPacientesPep } from '../api-pep.js';
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
  queryFn: () => buscarPacientesPep(pedido.value!, 'auto'),
  enabled: computed(() => pedido.value !== null),
  staleTime: 0,
});
function buscar(): void {
  const x = termo.value.trim();
  if (x) pedido.value = x;
}
const nomeDe = (p: PacienteResumo) => (p.nomeSocial ? `${p.nomeSocial} (${p.nome})` : p.nome);
const rotaDe = (paciente: number) => `/pep/paciente/${paciente}/anotacoes-administrativas`;
</script>

<template>
  <section class="tela" aria-labelledby="anot-painel-titulo" data-testid="anotacoes-adm-painel">
    <h1 id="anot-painel-titulo">{{ t('pep.anotAdm.painel.titulo') }}</h1>
    <p>{{ t('pep.anotAdm.painel.texto') }}</p>
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
