<script setup lang="ts">
// Respostas estruturadas em árvore (ORDEM do modelo): título, valores, a grade (linhas por SEQ) e a marca
// "a confirmar" quando a leitura não tem certeza (DP-28).
import type { ItemResposta } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'ItensRespostas' });
defineProps<{ itens: readonly ItemResposta[] }>();
const { t } = useI18n();
</script>

<template>
  <ul class="respostas">
    <li v-for="i in itens" :key="i.ordem" :data-testid="`resposta-${i.ordem}`">
      <span class="titulo">{{ i.titulo }}</span>
      <span v-if="i.valores.length > 0" class="valores">: {{ i.valores.join('; ') }}</span>
      <span v-if="i.autopreenchido" class="marca">{{ t('pep.campo.autopreenchido') }}</span>
      <span v-if="i.aConfirmar" class="marca" :title="i.aConfirmar">{{ t('pep.respostas.aConfirmar') }}</span>
      <table v-if="i.grade && i.grade.linhas.length > 0" class="grade">
        <caption class="oculto">
          {{
            i.titulo
          }}
        </caption>
        <thead>
          <tr>
            <th v-for="(c, k) in i.grade.colunas" :key="k" scope="col">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, k) in i.grade.linhas" :key="k">
            <td v-for="(v, j) in l" :key="j">{{ v }}</td>
          </tr>
        </tbody>
      </table>
      <ItensRespostas v-if="i.itens.length > 0" :itens="i.itens" />
    </li>
  </ul>
</template>

<style scoped>
.respostas {
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
.titulo {
  font-weight: 600;
}
.marca {
  margin-left: var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.grade {
  border-collapse: collapse;
  margin: var(--sgh-espaco-1) 0;
}
.grade th,
.grade td {
  border: 1px solid var(--sgh-borda);
  padding: 0 var(--sgh-espaco-1);
  text-align: left;
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
