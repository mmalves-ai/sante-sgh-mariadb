<script setup lang="ts">
// Consulta provisória de um item das Fases 5 e 6 (M14; ficha, seção 7): o aviso "tela completa na Fase N", as
// tabelas que o item atende (consulta somente leitura) e, onde o item tem domínios de RH, o cadastro deles. O item que
// já tem a tela de trabalho (a rota do menu fora daqui) mostra as tabelas como apoio, com o caminho da tela.
import { ARVORE_MENU, SUBITENS_DOMINIOS } from '@sgh/contratos';
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { buscarIndiceConsultas } from '../api-consultas.js';
import { avisoDoItem } from '../aviso-item.js';
import ConsultaTela from './ConsultaTela.vue';

const props = defineProps<{ item: string }>();
const { t } = useI18n();
const menu = computed(() => ARVORE_MENU.find((i) => i.id === props.item) ?? null);
const aviso = computed(() => avisoDoItem(menu.value));
const consulta = useQuery({
  queryKey: computed(() => ['consultas', 'item', props.item]),
  queryFn: () => buscarIndiceConsultas(props.item),
});
const lista = computed(() => consulta.data.value?.consultas ?? []);
const escolhida = ref('');
const opcoesLista = computed(() =>
  lista.value.map((c) => ({ valor: `${c.modulo}.${c.recurso}`, rotulo: c.rotulo })),
);
watch(lista, (l) => {
  if (!l.some((c) => `${c.modulo}.${c.recurso}` === escolhida.value))
    escolhida.value = l[0] ? `${l[0].modulo}.${l[0].recurso}` : '';
});
const atual = computed(() => lista.value.find((c) => `${c.modulo}.${c.recurso}` === escolhida.value) ?? null);
const subitem = computed(
  () =>
    (Object.entries(SUBITENS_DOMINIOS) as [string, string][]).find(([, id]) => id === props.item)?.[0] ??
    null,
);
</script>

<template>
  <section class="tela" aria-labelledby="item-titulo" :data-testid="`item-consulta-${props.item}`">
    <h1 id="item-titulo">{{ menu?.titulo ?? props.item }}</h1>
    <SanteAlerta
      v-if="aviso?.tipo === 'fase'"
      :texto="t('consultas.item.fase', { fase: aviso.fase })"
      variante="info"
      data-testid="aviso-fase"
    />
    <p v-else-if="aviso?.tipo === 'apoio'" data-testid="aviso-apoio">
      {{ t('consultas.item.apoio') }}
      <RouterLink :to="aviso.rota">{{
        t('consultas.item.telaDeTrabalho', { titulo: menu?.titulo })
      }}</RouterLink>
    </p>
    <DominiosIndiceTela v-if="subitem" :subitem="subitem" embutido />
    <h2>{{ t('consultas.item.consultas') }}</h2>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('consultas.consulta.carregando') }}</p>
    <p v-else-if="lista.length === 0">{{ t('consultas.item.nenhuma') }}</p>
    <template v-else>
      <div class="campo">
        <SanteSelecao
          id="item-tabela"
          v-model="escolhida"
          :rotulo="t('consultas.item.consultas')"
          :opcoes="opcoesLista"
          data-testid="item-tabela"
        />
      </div>
      <ConsultaTela
        v-if="atual"
        :key="escolhida"
        :modulo="atual.modulo"
        :recurso="atual.recurso"
        secundaria
      />
    </template>
  </section>
</template>

<style scoped>
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 32rem;
  margin: var(--sgh-espaco-2) 0;
}
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
