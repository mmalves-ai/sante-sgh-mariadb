<script setup lang="ts">
// Paleta de comandos (Ctrl+K): combobox com lista agrupada; setas e Enter abrem, Esc fecha.
import { SanteDialogo } from '@sgh/ui';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../sessao/sessao.js';
import { ORDEM_GRUPOS, provedores, type ResultadoBusca } from './paleta.js';

const aberta = defineModel<boolean>('aberta', { required: true });
const { t } = useI18n();
const { permissoes } = usarSessao();
const termo = ref('');
const indice = ref(0);
const campo = ref<HTMLInputElement | null>(null);

const resultados = computed<ResultadoBusca[]>(() =>
  aberta.value ? provedores.buscar(termo.value, permissoes.value) : [],
);
const grupos = computed(() =>
  ORDEM_GRUPOS.map((g) => ({ grupo: g, itens: resultados.value.filter((r) => r.grupo === g) })).filter(
    (g) => g.itens.length > 0,
  ),
);
const ativo = computed(() => resultados.value[indice.value] ?? null);
const idOpcao = (r: ResultadoBusca) => `paleta-opcao-${r.grupo}-${r.id}`;

watch(termo, () => (indice.value = 0));
watch(aberta, (v) => {
  if (v) {
    termo.value = '';
    indice.value = 0;
  }
});

async function focar(): Promise<void> {
  await nextTick();
  campo.value?.focus();
}
function mover(passo: number): void {
  const n = resultados.value.length;
  if (n > 0) indice.value = (indice.value + passo + n) % n;
}
function abrir(r: ResultadoBusca | null): void {
  if (!r) return;
  aberta.value = false;
  r.executar();
}
</script>

<template>
  <SanteDialogo v-model:visivel="aberta" :titulo="t('paleta.titulo')" largura="40rem" @aberto="focar">
    <div class="paleta" data-testid="paleta">
      <label for="paleta-campo" class="paleta__rotulo">{{ t('paleta.campo') }}</label>
      <input
        id="paleta-campo"
        ref="campo"
        v-model="termo"
        class="paleta__campo"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-expanded="true"
        aria-controls="paleta-lista"
        aria-autocomplete="list"
        aria-describedby="paleta-ajuda"
        :aria-activedescendant="ativo ? idOpcao(ativo) : undefined"
        @keydown.down.prevent="mover(1)"
        @keydown.up.prevent="mover(-1)"
        @keydown.enter.prevent="abrir(ativo)"
      />
      <p id="paleta-ajuda" class="paleta__ajuda">{{ t('paleta.ajuda') }}</p>
      <div id="paleta-lista" role="listbox" class="paleta__lista" :aria-label="t('paleta.titulo')">
        <div v-for="g in grupos" :key="g.grupo" role="group" :aria-labelledby="`paleta-grupo-${g.grupo}`">
          <div :id="`paleta-grupo-${g.grupo}`" role="presentation" class="paleta__grupo">
            {{ t(`paleta.grupos.${g.grupo}`) }}
          </div>
          <div
            v-for="r in g.itens"
            :id="idOpcao(r)"
            :key="r.id"
            role="option"
            class="paleta__opcao"
            :aria-selected="ativo === r"
            :data-resultado="r.id"
            @click="abrir(r)"
            @mousemove="indice = resultados.indexOf(r)"
          >
            <span class="paleta__titulo">{{ r.titulo }}</span>
            <span v-if="r.detalhe" class="paleta__detalhe">{{ r.detalhe }}</span>
          </div>
        </div>
      </div>
      <p v-if="resultados.length === 0" class="paleta__nada" role="status">
        {{ t('paleta.nenhum', { termo }) }}
      </p>
      <p v-else class="sgh-visualmente-oculto" role="status">
        {{ t('paleta.resultados', { n: resultados.length }) }}
      </p>
    </div>
  </SanteDialogo>
</template>

<style scoped>
.paleta {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.paleta__rotulo {
  font-weight: 600;
}
.paleta__campo {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
  padding: 0 var(--sgh-espaco-2);
  color: var(--sgh-texto);
  background: var(--sgh-fundo-elevado);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
}
.paleta__ajuda,
.paleta__nada {
  margin: 0;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.paleta__lista {
  max-height: 50vh;
  overflow-y: auto;
}
.paleta__grupo {
  margin: var(--sgh-espaco-2) 0 var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 700;
  color: var(--sgh-texto-secundario);
  text-transform: uppercase;
}
.paleta__opcao {
  display: flex;
  flex-direction: column;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  min-height: var(--sgh-alvo-minimo);
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  color: var(--sgh-texto);
}
.paleta__opcao[aria-selected='true'] {
  background: var(--sgh-primaria-suave);
  outline: 2px solid var(--sgh-foco);
  outline-offset: -2px;
}
.paleta__detalhe {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
</style>
