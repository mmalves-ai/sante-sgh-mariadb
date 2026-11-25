<script setup lang="ts">
// Escolha das colunas de uma lista (01-ADM L84): mostrar/esconder e mudar a ordem na hora, sem abrir outra tela;
// as linhas por página também ficam na visão (a ordenação é pelo cabeçalho da própria lista). "Guardar" grava a visão
// na conta da pessoa (vale em qualquer computador) e "voltar às de fábrica" desfaz. A última coluna visível não sai (a
// lista nunca fica sem coluna). Quem usa passa a visão (`usarVisaoLista`) e os rótulos.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { usarVisaoLista } from './visao-lista.js';

const props = defineProps<{
  visao: ReturnType<typeof usarVisaoLista>;
  rotulos: Readonly<Record<string, string>>;
  /** Prefixo dos data-testid (um por lista na mesma tela). */
  prefixo: string;
}>();
const { t } = useI18n();
const v = props.visao;
const rotulo = (c: string) => props.rotulos[c] ?? c;
/** As visíveis na ordem escolhida, depois as escondidas na ordem de fábrica. */
const linhas = computed(() => [
  ...v.visiveis.value.map((c) => ({ coluna: c, visivel: true })),
  ...v.oferecidas.filter((c) => !v.visiveis.value.includes(c)).map((c) => ({ coluna: c, visivel: false })),
]);
/** Linhas por página: o bloco inteiro que o servidor manda (nenhum) ou uma parte dele. */
const opcoesItens = computed(() => [
  { valor: null, rotulo: t('preferencias.lista.blocoInteiro') },
  ...[25, 50, 100, 200].map((n) => ({ valor: n, rotulo: String(n) })),
]);
const itens = computed<number | null>({
  get: () => v.itensPorPagina.value,
  set: (n) => v.definirItensPorPagina(n),
});
const aviso = computed(() =>
  v.situacao.value === 'guardada'
    ? t('preferencias.lista.guardada')
    : v.situacao.value === 'fabrica'
      ? t('preferencias.lista.emFabrica')
      : t('preferencias.lista.naoGuardada'),
);
</script>

<template>
  <details class="colunas" :data-testid="`${prefixo}-colunas`">
    <summary>
      {{ t('preferencias.lista.colunas', { visiveis: v.visiveis.value.length, total: v.oferecidas.length }) }}
    </summary>
    <ul>
      <li v-for="(l, i) in linhas" :key="l.coluna" :data-testid="`${prefixo}-coluna-${l.coluna}`">
        <label>
          <input
            type="checkbox"
            :checked="l.visivel"
            :disabled="l.visivel && v.visiveis.value.length === 1"
            :aria-label="t('preferencias.lista.mostrar', { coluna: rotulo(l.coluna) })"
            :data-testid="`${prefixo}-mostrar-${l.coluna}`"
            @change="v.alternar(l.coluna)"
          />
          {{ rotulo(l.coluna) }}
        </label>
        <span v-if="l.visivel" class="mover">
          <button
            type="button"
            :disabled="i === 0"
            :aria-label="t('preferencias.lista.antes', { coluna: rotulo(l.coluna) })"
            :data-testid="`${prefixo}-antes-${l.coluna}`"
            @click="v.mover(l.coluna, -1)"
          >
            {{ t('preferencias.lista.setaAntes') }}
          </button>
          <button
            type="button"
            :disabled="i === v.visiveis.value.length - 1"
            :aria-label="t('preferencias.lista.depois', { coluna: rotulo(l.coluna) })"
            :data-testid="`${prefixo}-depois-${l.coluna}`"
            @click="v.mover(l.coluna, 1)"
          >
            {{ t('preferencias.lista.setaDepois') }}
          </button>
        </span>
      </li>
    </ul>
    <div class="itens">
      <SanteSelecao
        :id="`${prefixo}-itens-pagina`"
        v-model="itens"
        :rotulo="t('preferencias.lista.itensPorPagina')"
        :opcoes="opcoesItens"
        :data-testid="`${prefixo}-itens-pagina`"
      />
    </div>
    <p class="acoes">
      <SanteBotao
        :rotulo="t('preferencias.lista.guardar')"
        variante="secundario"
        :desabilitado="v.gravando.value || v.situacao.value !== 'mudada'"
        :data-testid="`${prefixo}-guardar-visao`"
        @acionar="v.guardar()"
      />
      <SanteBotao
        :rotulo="t('preferencias.lista.fabrica')"
        variante="texto"
        :desabilitado="v.gravando.value || v.situacao.value === 'fabrica'"
        :data-testid="`${prefixo}-visao-fabrica`"
        @acionar="v.voltarAFabrica()"
      />
    </p>
    <p role="status" :data-testid="`${prefixo}-situacao-visao`">{{ aviso }}</p>
    <SanteAlerta
      v-if="v.erro.value"
      :texto="t('preferencias.lista.erro', { motivo: v.erro.value })"
      variante="alerta"
      anunciar
    />
  </details>
</template>

<style scoped>
.colunas {
  margin: var(--sgh-espaco-2) 0;
}
ul {
  list-style: none;
  padding: 0;
  margin: var(--sgh-espaco-1) 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
li {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.mover {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
}
.mover button {
  font: inherit;
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.itens {
  max-width: 16rem;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
