<script setup lang="ts">
// Linha do tempo de um cadastro (M11): as versões do retrato que os triggers do sistema atual gravam, da mais
// nova para a mais antiga, com o que mudou em cada uma (o servidor compara versão a versão e omite o que o
// perfil não pode ver). Paginada no servidor (100 por página).
import { useI18n } from 'vue-i18n';
import { carimboBr } from '../formato.js';

interface Versao {
  readonly id: number;
  readonly em: string;
  readonly usuario: string | null;
  readonly mudancas: readonly {
    campo: string;
    rotulo: string;
    antes: string | null;
    depois: string | null;
  }[];
  readonly telefones: readonly { tipo: string; numero: string }[];
}
defineProps<{ legenda: string; versoes: readonly Versao[] }>();
const { t } = useI18n();
const v = (x: string | null) => (x === null || x === '' ? t('cadastro.historico.vazio') : x);
</script>

<template>
  <p v-if="versoes.length === 0">{{ t('cadastro.historico.semVersoes') }}</p>
  <table v-else data-testid="linha-do-tempo">
    <caption>
      {{
        legenda
      }}
    </caption>
    <thead>
      <tr>
        <th scope="col">{{ t('cadastro.historico.em') }}</th>
        <th scope="col">{{ t('cadastro.historico.usuario') }}</th>
        <th scope="col">{{ t('cadastro.historico.mudancas') }}</th>
        <th scope="col">{{ t('cadastro.historico.telefones') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="x in versoes" :key="x.id">
        <td>{{ carimboBr(x.em) }}</td>
        <td>{{ x.usuario ?? '' }}</td>
        <td>
          <ul>
            <li v-for="m in x.mudancas" :key="m.campo">
              {{
                t('cadastro.historico.campo', { rotulo: m.rotulo, antes: v(m.antes), depois: v(m.depois) })
              }}
            </li>
          </ul>
        </td>
        <td>{{ x.telefones.map((f) => `${f.tipo}: ${f.numero}`).join(' · ') }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  vertical-align: top;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
ul {
  margin: 0;
  padding-left: var(--sgh-espaco-3, 1rem);
}
</style>
