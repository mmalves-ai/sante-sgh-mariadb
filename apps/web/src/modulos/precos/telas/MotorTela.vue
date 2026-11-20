<script setup lang="ts">
// Consultas do motor de preços (M12, ficha seção 7), uma tela por item do menu:
//   - "Códigos de prestador e acesso a portais" (login e senha de portal nunca aparecem);
//   - "Credenciamento e código do prestador por convênio" (colunas bancárias só com a permissão própria);
//   - "De-para de exames por convênio";
//   - "Portes anestésicos e tabelas próprias de operadora" (portes, tabelas de terceiros e Unimed).
// Todas paginadas no servidor, com o filtro de convênio (no credenciamento, também o profissional; nos
// portes, a tabela de porte ou o convênio; na Unimed, a busca por código ou nome).
import type { PaginaGenerica } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import TabelaPagina from '../componentes/TabelaPagina.vue';
import {
  buscarCodigosPrestador,
  buscarCredenciamento,
  buscarCredenciamentoComplementar,
  buscarDePara,
  buscarPortes,
  buscarTabelasTerceiros,
  buscarTerceiros,
  buscarUnimed,
  listarConvenios,
} from '../api-precos.js';

const props = defineProps<{ consulta: 'codigos' | 'credenciamento' | 'dePara' | 'portes' }>();
const { t } = useI18n();
const convenios = useQuery({
  queryKey: ['convenios', '', 'todos'],
  queryFn: () => listarConvenios('', 'todos'),
});
const convenio = ref('');
const opcoesConvenio = computed(() => [
  { valor: '', rotulo: t('precos.comum.todos') },
  ...(convenios.data.value?.itens ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.codigo} — ${c.nome}`,
  })),
]);
const exame = ref('');
const termoExame = ref('');
// Credenciamento: o profissional (registro no conselho ou trecho do nome). Portes: a tabela de porte.
const profissional = ref('');
const termoProfissional = ref('');
const tabelaPorte = ref('');
const termoTabelaPorte = ref('');
const pagina = ref(0);
watch([convenio, termoExame, termoProfissional, termoTabelaPorte], () => (pagina.value = 0));
const conv = computed(() => (convenio.value ? Number(convenio.value) : null));
function filtrar(): void {
  termoExame.value = exame.value;
  termoProfissional.value = profissional.value.trim();
  termoTabelaPorte.value = tabelaPorte.value.trim();
}
const principal = useQuery({
  queryKey: computed(() => [
    'motor',
    props.consulta,
    conv.value,
    termoExame.value,
    termoProfissional.value,
    termoTabelaPorte.value,
    pagina.value,
  ]),
  queryFn: (): Promise<PaginaGenerica> =>
    props.consulta === 'codigos'
      ? buscarCodigosPrestador(conv.value, pagina.value)
      : props.consulta === 'credenciamento'
        ? buscarCredenciamento(conv.value, pagina.value, termoProfissional.value)
        : props.consulta === 'dePara'
          ? buscarDePara(conv.value, termoExame.value, pagina.value)
          : buscarPortes(
              {
                tabela: conv.value === null && termoTabelaPorte.value ? Number(termoTabelaPorte.value) : null,
                convenio: conv.value,
              },
              pagina.value,
            ),
});
const complementar = useQuery({
  queryKey: computed(() => ['credenciamento-complementar', conv.value, termoProfissional.value]),
  queryFn: () => buscarCredenciamentoComplementar(conv.value, termoProfissional.value),
  enabled: computed(() => props.consulta === 'credenciamento'),
});
const tabelasTerceiros = useQuery({
  queryKey: ['terceiros-tabelas'],
  queryFn: () => buscarTabelasTerceiros(),
  enabled: computed(() => props.consulta === 'portes'),
});
const tabTerceiros = ref('');
const opcoesTerceiros = computed(() =>
  (tabelasTerceiros.data.value ?? []).map((x) => ({
    valor: String(x.tabela),
    rotulo: `${x.tabela} (${x.itens})`,
  })),
);
const buscaTerceiros = ref('');
const paginaTerceiros = ref(0);
const terceiros = useQuery({
  queryKey: computed(() => ['terceiros', tabTerceiros.value, buscaTerceiros.value, paginaTerceiros.value]),
  queryFn: () => buscarTerceiros(Number(tabTerceiros.value), buscaTerceiros.value, paginaTerceiros.value),
  enabled: computed(() => props.consulta === 'portes' && tabTerceiros.value !== ''),
});
const paginaUnimed = ref(0);
const buscaUnimed = ref('');
watch(buscaUnimed, () => (paginaUnimed.value = 0));
const unimed = useQuery({
  queryKey: computed(() => ['unimed', buscaUnimed.value, paginaUnimed.value]),
  queryFn: () => buscarUnimed(buscaUnimed.value, paginaUnimed.value),
  enabled: computed(() => props.consulta === 'portes'),
});
const titulo = computed(() => `precos.${props.consulta === 'portes' ? 'portes' : props.consulta}`);
</script>

<template>
  <section class="tela" aria-labelledby="motor-titulo">
    <h1 id="motor-titulo">{{ t(`${titulo}.titulo`) }}</h1>
    <p>{{ t(`${titulo}.texto`) }}</p>
    <form class="filtros" data-testid="motor-filtros" @submit.prevent="filtrar">
      <div class="campo">
        <SanteSelecao
          id="motor-convenio"
          v-model="convenio"
          :rotulo="t('precos.comum.convenio')"
          :opcoes="opcoesConvenio"
          data-testid="motor-convenio"
        />
      </div>
      <div v-if="consulta === 'dePara'" class="campo">
        <label for="motor-exame">{{ t('precos.dePara.exame') }}</label>
        <input id="motor-exame" v-model="exame" maxlength="4" />
      </div>
      <div v-if="consulta === 'credenciamento'" class="campo">
        <label for="motor-profissional">{{ t('precos.credenciamento.profissional') }}</label>
        <input
          id="motor-profissional"
          v-model="profissional"
          type="search"
          maxlength="60"
          data-testid="motor-profissional"
        />
      </div>
      <div v-if="consulta === 'portes'" class="campo">
        <label for="motor-tabela-porte">{{ t('precos.portes.tabelaPorte') }}</label>
        <input
          id="motor-tabela-porte"
          v-model="tabelaPorte"
          type="number"
          min="0"
          :disabled="convenio !== ''"
          data-testid="motor-tabela-porte"
        />
      </div>
      <SanteBotao
        v-if="consulta !== 'codigos'"
        :rotulo="t('precos.comum.buscar')"
        tipo="submit"
        variante="secundario"
        data-testid="motor-buscar"
      />
    </form>
    <MensagemErro v-if="principal.isError.value" :erro="principal.error.value" />
    <h2 v-if="consulta === 'portes'">{{ t('precos.portes.portes') }}</h2>
    <TabelaPagina
      :pagina="principal.data.value ?? null"
      :rotulo="t(`${titulo}.titulo`)"
      :testid="`tabela-${consulta}`"
      @pagina="pagina = $event"
    />
    <template v-if="consulta === 'credenciamento' && complementar.data.value">
      <h2>{{ t('precos.credenciamento.atos') }}</h2>
      <TabelaPagina
        :pagina="complementar.data.value.atos"
        :rotulo="t('precos.credenciamento.atos')"
        testid="tabela-atos"
      />
      <template v-if="complementar.data.value.auditoras">
        <h2>{{ t('precos.credenciamento.auditoras') }}</h2>
        <TabelaPagina
          :pagina="complementar.data.value.auditoras"
          :rotulo="t('precos.credenciamento.auditoras')"
          testid="tabela-auditoras"
        />
      </template>
    </template>
    <template v-if="consulta === 'portes'">
      <h2>{{ t('precos.portes.terceiros') }}</h2>
      <form class="filtros" @submit.prevent="paginaTerceiros = 0">
        <div class="campo">
          <SanteSelecao
            id="terceiros-tabela"
            v-model="tabTerceiros"
            :rotulo="t('precos.portes.tabelaTerceiros')"
            :opcoes="opcoesTerceiros"
            data-testid="terceiros-tabela"
          />
        </div>
        <div class="campo">
          <label for="terceiros-busca">{{ t('precos.comum.busca') }}</label>
          <input id="terceiros-busca" v-model="buscaTerceiros" type="search" />
        </div>
      </form>
      <TabelaPagina
        v-if="tabTerceiros"
        :pagina="terceiros.data.value ?? null"
        :rotulo="t('precos.portes.terceiros')"
        testid="tabela-terceiros"
        @pagina="paginaTerceiros = $event"
      />
      <h2>{{ t('precos.portes.unimed') }}</h2>
      <div class="campo">
        <label for="unimed-busca">{{ t('precos.comum.busca') }}</label>
        <input id="unimed-busca" v-model.lazy="buscaUnimed" type="search" data-testid="unimed-busca" />
      </div>
      <TabelaPagina
        :pagina="unimed.data.value ?? null"
        :rotulo="t('precos.portes.unimed')"
        testid="tabela-unimed"
        @pagina="paginaUnimed = $event"
      />
    </template>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
