<script setup lang="ts">
// F3.8, 07-FIN linha 109: o saldo a compensar do tributo que os tomadores retiveram do hospital. Por tributo: o retido,
// o já compensado e o que sobra, com a competência mais antiga em aberto. Um clique usa o crédito na apuração da
// competência da tela (só entra o retido até ela) e o saldo cai na hora.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import { compensarRetencaoSofrida, lerSaldoACompensar } from '../api-retencao-sofrida.js';

const props = defineProps<{ competencia: string; pode: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Retido pelos tomadores: saldo a compensar',
      tributo: 'Tributo',
      retido: 'Retido',
      compensado: 'Compensado',
      aCompensar: 'A compensar',
      desde: 'Em aberto desde',
      compensar: 'Compensar na apuração de {competencia}',
      futuro: 'O crédito é de competência posterior a {competencia}.',
      nada: 'Nenhum tributo retido pelos tomadores.',
      acao: 'Compensar',
    },
  },
});
const qc = useQueryClient();
const saldo = useQuery({ queryKey: ['financeiro', 'saldo-compensar'], queryFn: () => lerSaldoACompensar() });
const valida = computed(() => /^\d{4}-\d{2}$/.test(props.competencia));
const erro = ref<unknown>(null);
const ok = ref('');
const gravando = ref(false);
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function compensar(tributo: number) {
  erro.value = null;
  ok.value = '';
  gravando.value = true;
  try {
    ok.value = (
      await compensarRetencaoSofrida(
        { competencia: props.competencia, tributo },
        novaChave('compensar-retido'),
      )
    ).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'saldo-compensar'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="sc-titulo" data-testid="sc-painel">
    <h2 id="sc-titulo">{{ t('titulo') }}</h2>
    <ErroFaturamento v-if="erro || saldo.error.value" :erro="erro ?? saldo.error.value" />
    <p v-if="ok" role="status" class="secundario" data-testid="sc-ok">{{ ok }}</p>
    <p v-if="saldo.data.value && !saldo.data.value.length" data-testid="sc-nada">{{ t('nada') }}</p>
    <table v-else-if="saldo.data.value" class="tabela" data-testid="sc-saldo">
      <thead>
        <tr>
          <th scope="col">{{ t('tributo') }}</th>
          <th scope="col">{{ t('retido') }}</th>
          <th scope="col">{{ t('compensado') }}</th>
          <th scope="col">{{ t('aCompensar') }}</th>
          <th scope="col">{{ t('desde') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('acao') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in saldo.data.value" :key="s.tributoId" :data-testid="`sc-linha-${s.tributo}`">
          <th scope="row">{{ s.tributo }}</th>
          <td>{{ brl(s.retido) }}</td>
          <td>{{ brl(s.compensado) }}</td>
          <td>{{ brl(s.aCompensar) }}</td>
          <td>{{ s.desde ?? '' }}</td>
          <td>
            <template v-if="s.aCompensar > 0 && valida">
              <small v-if="s.desde && s.desde > competencia" class="secundario">
                {{ t('futuro', { competencia }) }}
              </small>
              <button
                v-else
                type="button"
                :disabled="gravando || !pode"
                :data-testid="`sc-compensar-${s.tributo}`"
                @click="compensar(s.tributoId)"
              >
                {{ t('compensar', { competencia }) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
