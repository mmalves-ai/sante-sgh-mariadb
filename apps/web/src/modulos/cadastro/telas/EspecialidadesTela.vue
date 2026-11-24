<script setup lang="ts">
// Especialidades, CBOs e procedimentos por especialidade (M11; F3.1, 02-CAD linha 17): o CRUD genérico do M08 para as
// especialidades e para a ligação CBO × especialidade e, abaixo, os procedimentos permitidos (com vigência) e as
// ocupações da especialidade ESCOLHIDA PELO NOME: a busca devolve o id da especialidade, que vai às consultas e às
// gravações (nunca o código digitado, que não é o id). Uma lista só: a tabela antiga paginada saiu.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DominioTela from '../../config/telas/DominioTela.vue';
import { lerOpcoesLigacoes } from '../api-ligacoes.js';
import LigacoesEspecialidade from '../componentes/LigacoesEspecialidade.vue';

const { t } = useI18n();
const termo = ref('');
const escolhida = ref<{ id: number; codigo: string; descricao: string } | null>(null);
const busca = useQuery({
  queryKey: computed(() => ['cadastro', 'ligacoes-opcoes', termo.value]),
  queryFn: () => lerOpcoesLigacoes(termo.value),
  enabled: computed(() => termo.value.trim().length >= 3 && escolhida.value === null),
});
const achadas = computed(() => busca.data.value?.especialidades ?? []);
function escolher(e: { id: number; codigo: string; descricao: string }): void {
  escolhida.value = e;
  termo.value = '';
}
</script>

<template>
  <div data-testid="tela-especialidades">
    <DominioTela modulo="cadastro" recurso="especialidade" />
    <DominioTela modulo="cadastro" recurso="cboEspecialidade" secundaria />
    <section class="tela" aria-labelledby="procedimentos-titulo">
      <h2 id="procedimentos-titulo">{{ t('cadastro.especialidades.procedimentos') }}</h2>
      <div v-if="escolhida" class="barra">
        <p data-testid="especialidade-escolhida">
          {{ t('ligacoes.especialidade.escolhida', { nome: `${escolhida.codigo} ${escolhida.descricao}` }) }}
        </p>
        <SanteBotao
          :rotulo="t('ligacoes.especialidade.trocar')"
          variante="secundario"
          data-testid="trocar-especialidade"
          @click="escolhida = null"
        />
      </div>
      <div v-else class="campo">
        <label for="busca-especialidade">{{ t('ligacoes.especialidade.escolher') }}</label>
        <input
          id="busca-especialidade"
          v-model="termo"
          type="search"
          autocomplete="off"
          data-testid="busca-especialidade"
        />
        <ul v-if="achadas.length" class="achadas" data-testid="especialidades-achadas">
          <li v-for="e in achadas" :key="e.id">
            <button type="button" :data-testid="`especialidade-${e.id}`" @click="escolher(e)">
              {{ e.codigo }} {{ e.descricao }}
            </button>
          </li>
        </ul>
      </div>
    </section>
    <!-- F3.1 (02-CAD linha 17): procedimentos com vigência e ocupações da especialidade escolhida (pelo id). -->
    <LigacoesEspecialidade v-if="escolhida !== null" :key="escolhida.id" :especialidade="escolhida.id" />
  </div>
</template>

<style scoped>
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.achadas {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.achadas button {
  font: inherit;
  text-align: left;
  width: 100%;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  cursor: pointer;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
