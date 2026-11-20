<script setup lang="ts">
// Portal do paciente: as teleconsultas do titular escolhido (M50, etapa 4; ficha, seção 7). Cada uma leva à sala de
// espera virtual (`/paciente/teleconsulta/:id`); a teleconsulta nasce da marcação pelo portal numa agenda que a oferece.
import type { SessaoContaPortal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ErroPortal from '../componentes/ErroPortal.vue';
import PortalCasca from '../componentes/PortalCasca.vue';
import { minhasTeleconsultas } from '../api-portal-teleconsulta.js';

const { t } = useI18n();
const roteador = useRouter();
const sessao = ref<SessaoContaPortal | null>(null);
const versao = ref(0);
const pode = computed(() => sessao.value?.ativo.escopos.includes('agendamentos') ?? false);
const lista = useQuery({
  queryKey: computed(() => [
    'portal-paciente',
    'teleconsultas',
    versao.value,
    sessao.value?.ativo.vinculo ?? '',
  ]),
  queryFn: () => minhasTeleconsultas(),
  refetchOnMount: 'always',
  staleTime: 0,
  enabled: pode,
});
const dia = (d: string) => d.split('-').reverse().join('/');
const hora = (h: string) => `${h.slice(0, 2)}:${h.slice(2, 4)}`;

function trocou(s: SessaoContaPortal): void {
  sessao.value = s;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.teleconsulta.titulo')" @sessao="(s) => (sessao = s)" @trocou="trocou">
    <p v-if="!pode">{{ t('portal.recusas.sem-escopo') }}</p>
    <template v-else>
      <p>{{ t('portal.teleconsulta.ajuda') }}</p>
      <ErroPortal v-if="lista.isError.value" :erro="lista.error.value" />
      <template v-else-if="lista.data.value">
        <SanteAlerta
          v-if="!lista.data.value.ligada"
          :texto="t('portal.teleconsulta.desligada')"
          variante="info"
          data-testid="pac-tele-desligada"
        />
        <p v-if="lista.data.value.itens.length === 0" data-testid="pac-tele-nenhuma">
          {{ t('portal.teleconsulta.nenhuma') }}
        </p>
        <ul v-else class="pac-teles" data-testid="pac-teleconsultas">
          <li
            v-for="x in lista.data.value.itens"
            :key="x.id"
            class="portal-painel"
            :data-testid="`pac-tele-${x.id}`"
          >
            <p>
              <strong>{{ t('portal.teleconsulta.quando', { dia: dia(x.data), hora: hora(x.hora) }) }}</strong>
              · {{ x.agenda }}
            </p>
            <p>{{ t(`portal.teleconsulta.situacoes.${x.situacao}`) }}</p>
            <SanteBotao
              variante="secundario"
              :rotulo="t('portal.teleconsulta.abrir')"
              :data-testid="`pac-tele-abrir-${x.id}`"
              @acionar="roteador.push({ name: 'portal.teleconsulta', params: { id: x.id } })"
            />
          </li>
        </ul>
      </template>
      <p v-else role="status">{{ t('portal.carregando') }}</p>
    </template>
  </PortalCasca>
</template>

<style scoped>
.pac-teles {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-3);
}
</style>
