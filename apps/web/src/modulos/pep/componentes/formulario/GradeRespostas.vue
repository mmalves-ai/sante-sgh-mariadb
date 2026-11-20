<script setup lang="ts">
// Grade do formulário (classe de colunas; ficha do M22, regra 3): uma linha por registro da grade, as colunas da
// pergunta (hora, número ou texto). Cada linha vira uma linha gravada por célula preenchida, com o número da
// linha. Navegação por teclado nativa (tabela com campos); acrescentar e tirar linha por botão.
import type { ColunaGrade } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{ rotulo: string; colunas: readonly ColunaGrade[]; desabilitado?: boolean }>(),
  {
    desabilitado: false,
  },
);
const linhas = defineModel<(string | null)[][]>({ required: true });
const { t } = useI18n();
const id = `grade-${useId()}`;

function celula(i: number, k: number, v: string): void {
  const copia = linhas.value.map((l) => [...l]);
  const linha = copia[i] ?? props.colunas.map(() => null);
  linha[k] = v.trim() === '' ? null : v;
  copia[i] = linha;
  linhas.value = copia;
}
function acrescentar(): void {
  linhas.value = [...linhas.value, props.colunas.map(() => null)];
}
function tirar(i: number): void {
  linhas.value = linhas.value.filter((_, j) => j !== i);
}
const modo = (c: ColunaGrade) => (c.tipo === 'numero' ? 'decimal' : c.tipo === 'hora' ? 'numeric' : 'text');
</script>

<template>
  <fieldset class="grade" :data-testid="`grade-${rotulo}`">
    <legend>{{ rotulo }}</legend>
    <table :aria-describedby="`${id}-ajuda`">
      <thead>
        <tr>
          <th v-for="c in colunas" :key="c.coluna" scope="col">
            {{ c.titulo }}<template v-if="c.unidade"> ({{ c.unidade }})</template>
          </th>
          <th scope="col">
            <span class="oculto">{{ t('pep.reg.grade.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(l, i) in linhas" :key="i">
          <td v-for="(c, k) in colunas" :key="c.coluna">
            <input
              :value="l[k] ?? ''"
              :inputmode="modo(c)"
              :placeholder="c.tipo === 'hora' ? '00:00' : ''"
              :aria-label="t('pep.reg.grade.celula', { coluna: c.titulo, linha: i + 1 })"
              :disabled="desabilitado"
              @change="celula(i, k, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>
            <SanteBotao
              variante="texto"
              :rotulo="t('pep.reg.grade.tirar', { linha: i + 1 })"
              :desabilitado="desabilitado"
              @acionar="tirar(i)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p :id="`${id}-ajuda`" class="ajuda">{{ t('pep.reg.grade.ajuda') }}</p>
    <SanteBotao
      variante="secundario"
      :rotulo="t('pep.reg.grade.acrescentar')"
      :desabilitado="desabilitado"
      @acionar="acrescentar"
    />
  </fieldset>
</template>

<style scoped>
.grade {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2);
  overflow-x: auto;
}
.grade legend {
  font-weight: 600;
}
table {
  border-collapse: collapse;
  min-width: 100%;
}
th,
td {
  border: 1px solid var(--sgh-borda);
  padding: 2px 4px;
  text-align: start;
}
input {
  font: inherit;
  width: 100%;
  min-width: 4rem;
  border: none;
  background: transparent;
  color: var(--sgh-texto);
}
input:focus-visible {
  outline: 2px solid var(--sgh-foco);
}
.ajuda {
  font-size: 0.85em;
  color: var(--sgh-texto-secundario);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
