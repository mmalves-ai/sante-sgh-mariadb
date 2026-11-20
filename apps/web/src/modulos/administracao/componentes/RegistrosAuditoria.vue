<script setup lang="ts">
// Linhas de um tipo de exclusão ou das conexões ao banco (M10, ficha seção 4): período da trilha, filtro por
// usuário e 500 por página, até 20 páginas (além disso, refinar o filtro). Só o ID do registro afetado: nenhum
// outro dado do paciente. Toda consulta fica registrada no servidor.
import { useQuery } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarConexoes, buscarRegistrosExclusao } from '../api.js';

const props = defineProps<{
  /** Tipo de exclusão (chave) ou null para as conexões. */
  chave: string | null;
  rotulo: string;
  inicio: string;
  fim: string;
}>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const usuario = ref('');
const aplicado = ref('');
const pagina = ref(1);
watch(
  () => [props.chave, props.inicio, props.fim],
  () => {
    pagina.value = 1;
  },
);
const filtro = computed(() => ({
  inicio: props.inicio,
  fim: props.fim,
  usuario: aplicado.value || undefined,
  pagina: pagina.value,
}));
const exclusoes = useQuery({
  queryKey: computed(() => ['adm', 'exclusoes-linhas', props.chave, filtro.value]),
  queryFn: () => buscarRegistrosExclusao(props.chave ?? '', filtro.value),
  enabled: computed(() => props.chave !== null),
});
const conexoes = useQuery({
  queryKey: computed(() => ['adm', 'conexoes-linhas', filtro.value]),
  queryFn: () => buscarConexoes(filtro.value),
  enabled: computed(() => props.chave === null),
});
const dados = computed(() => (props.chave === null ? conexoes.data.value : exclusoes.data.value));
const erro = computed(() => (props.chave === null ? conexoes.error.value : exclusoes.error.value));
const filtrar = () => {
  aplicado.value = usuario.value.trim();
  pagina.value = 1;
};
</script>

<template>
  <section class="registros" aria-labelledby="registros-titulo" data-testid="registros-auditoria">
    <h3 id="registros-titulo">{{ t('adm.trilha.detalhe', { rotulo }) }}</h3>
    <form class="filtros" role="search" @submit.prevent="filtrar">
      <div class="campo">
        <label for="registros-usuario">{{ t('adm.trilha.usuario') }}</label>
        <input id="registros-usuario" v-model="usuario" maxlength="31" data-testid="registros-usuario" />
      </div>
      <SanteBotao :rotulo="t('adm.comum.consultar')" tipo="submit" data-testid="registros-filtrar" />
      <SanteBotao :rotulo="t('adm.trilha.fechar')" variante="texto" @acionar="emit('fechar')" />
    </form>
    <MensagemErro v-if="erro" :erro="erro" />
    <template v-else-if="dados">
      <SanteAlerta
        v-if="exclusoes.data.value && chave !== null && !exclusoes.data.value.comUsuario"
        :texto="t('adm.trilha.semUsuario')"
        variante="info"
      />
      <SanteAlerta
        v-if="dados.cortado"
        :texto="t('adm.trilha.cortado')"
        variante="aviso"
        anunciar
        data-testid="registros-cortado"
      />
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('adm.comum.rolagem')">
        <table data-testid="tabela-registros">
          <caption>
            {{
              t('adm.trilha.detalhe', { rotulo })
            }}
          </caption>
          <thead v-if="chave !== null">
            <tr>
              <th scope="col">{{ t('adm.trilha.dataHora') }}</th>
              <th scope="col">{{ t('adm.trilha.usuario') }}</th>
              <th scope="col">{{ t('adm.trilha.registro') }}</th>
              <th scope="col">{{ t('adm.trilha.justificativa') }}</th>
            </tr>
          </thead>
          <thead v-else>
            <tr>
              <th scope="col">{{ t('adm.trilha.dataHora') }}</th>
              <th scope="col">{{ t('adm.trilha.usuario') }}</th>
              <th scope="col">{{ t('adm.trilha.modulo') }}</th>
            </tr>
          </thead>
          <tbody v-if="chave !== null && exclusoes.data.value">
            <tr v-if="exclusoes.data.value.itens.length === 0">
              <td colspan="4">{{ t('adm.comum.nenhum') }}</td>
            </tr>
            <tr v-for="(x, i) in exclusoes.data.value.itens" :key="i">
              <th scope="row">{{ x.dataHora }}</th>
              <td>{{ x.usuario ?? '—' }}</td>
              <td>{{ x.registro ?? '—' }}</td>
              <td>{{ x.justificativa ?? '—' }}</td>
            </tr>
          </tbody>
          <tbody v-else-if="conexoes.data.value">
            <tr v-if="conexoes.data.value.itens.length === 0">
              <td colspan="3">{{ t('adm.comum.nenhum') }}</td>
            </tr>
            <tr v-for="(x, i) in conexoes.data.value.itens" :key="i">
              <th scope="row">{{ x.dataHora }}</th>
              <td>{{ x.usuario }}</td>
              <td>{{ x.nome }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="paginas">
        <SanteBotao
          :rotulo="t('adm.comum.anterior')"
          variante="texto"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('adm.comum.pagina', { n: pagina }) }}</span>
        <SanteBotao
          :rotulo="t('adm.comum.proxima')"
          variante="texto"
          :desabilitado="!dados.temMais"
          @acionar="pagina++"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.filtros,
.paginas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
