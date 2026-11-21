<script setup lang="ts">
import { lerHoraDigitada } from '@sgh/contratos';
// Lançamentos da conta (ficha do M30, seção 7): `/faturamento/contas/:id/lancamentos`. A grade dos itens com a
// paginação no servidor (500 por página), a origem de cada item (legenda "a confirmar" nos códigos de baixa confiança,
// DP-46.5), "Explicar preço" (somente leitura; regra 8), a conferência em bloco (só os marcados, com a versão de cada
// item) e o lançamento manual (liberado por grupo de item pela meta da reprodução; o preço da tabela ou o manual na
// faixa, regra 12).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { conferirItens, explicarItem, lancarItem, listarItens, novaChave } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { data, num, numero, reais, usarFaturamento } from '../usar-faturamento.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivo, motivoFuncionalidade, apoio } = usarFaturamento();
const id = computed(() => Number(props.id));
const pagina = ref(0);
const tipo = ref<number | null>(null);
const opcoesGrupo = computed(() =>
  [1, 2, 3, 4].map((g) => ({ valor: g, rotulo: t(`faturamento.grupos.${g}`) })),
);
const opcoesFiltroGrupo = computed(() => [
  { valor: null, rotulo: t('faturamento.todos') },
  ...opcoesGrupo.value,
]);
const naoConferidos = ref(false);
const itens = useQuery({
  queryKey: computed(() => ['faturamento', 'itens', id.value, pagina.value, tipo.value, naoConferidos.value]),
  queryFn: () =>
    listarItens(id.value, { pagina: pagina.value, tipo: tipo.value, naoConferidos: naoConferidos.value }),
});
const marcados = ref<Set<number>>(new Set());
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const explicado = ref<number | null>(null);
const explicacao = useQuery({
  queryKey: computed(() => ['faturamento', 'explicacao', explicado.value]),
  queryFn: () => explicarItem(explicado.value!),
  enabled: computed(() => explicado.value !== null),
});
const novo = ref({
  tipo: 3,
  codigo: '',
  quantidade: '1',
  data: '',
  hora: '08:00',
  local: '0',
  ato: '0',
  manual: '',
  justificativa: '',
  aprovador: '',
});

function alternar(i: number) {
  const s = new Set(marcados.value);
  if (s.has(i)) s.delete(i);
  else s.add(i);
  marcados.value = s;
}
function marcarTodos() {
  marcados.value = new Set((itens.data.value?.itens ?? []).filter((i) => !i.conferidoPor).map((i) => i.id));
}
async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await fn()).mensagem;
    marcados.value = new Set();
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  }
}
const conferir = () =>
  agir(() =>
    conferirItens(
      id.value,
      (itens.data.value?.itens ?? [])
        .filter((i) => marcados.value.has(i.id))
        .map((i) => ({ id: i.id, versao: i.versao })),
      novaChave('conferir'),
    ),
  );
const lancar = () =>
  agir(() =>
    lancarItem(
      id.value,
      {
        tipo: novo.value.tipo,
        codigo: Number(novo.value.codigo),
        quantidade: numero(novo.value.quantidade),
        data: novo.value.data || apoio.data.value?.hoje,
        hora: lerHoraDigitada(novo.value.hora) ?? novo.value.hora,
        local: Number(novo.value.local),
        ato: Number(novo.value.ato),
        precoManual: novo.value.manual
          ? {
              unitario: numero(novo.value.manual),
              justificativa: novo.value.justificativa,
              aprovador: novo.value.aprovador || null,
            }
          : null,
      },
      novaChave('lancar'),
    ),
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="lan-titulo" data-testid="tela-faturamento-lancamentos">
    <h1 id="lan-titulo">{{ t('faturamento.itens.titulo', { id }) }}</h1>
    <p>{{ t('faturamento.itens.texto') }}</p>
    <p>
      <RouterLink :to="`/faturamento/contas/${id}`">{{ t('faturamento.conta.titulo', { id }) }}</RouterLink>
    </p>
    <div class="filtros">
      <span class="campo">
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('faturamento.grupo')"
          :opcoes="opcoesFiltroGrupo"
          data-testid="lan-tipo"
        />
      </span>
      <label
        ><input v-model="naoConferidos" type="checkbox" data-testid="lan-nao-conferidos" />
        {{ t('faturamento.itens.soNaoConferidos') }}</label
      >
    </div>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contas')" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="lan-mensagem" />
    <ErroFaturamento v-if="itens.error.value" :erro="itens.error.value" />
    <p v-else-if="!itens.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <div v-if="pode('faturamento.conferirItem')" class="filtros">
        <button type="button" data-testid="lan-marcar-todos" @click="marcarTodos">
          {{ t('faturamento.itens.marcarTodos') }}
        </button>
        <button type="button" :disabled="marcados.size === 0" data-testid="lan-conferir" @click="conferir">
          {{ t('faturamento.itens.conferir', { n: marcados.size }) }}
        </button>
      </div>
      <table class="tabela" data-testid="lan-grade">
        <caption class="secundario">
          {{
            itens.data.value.total
          }}
          ·
          {{
            t('faturamento.itens.somaPagina')
          }}
          {{
            reais(itens.data.value.somaPagina)
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span class="sr-only">{{ t('faturamento.conferido') }}</span>
            </th>
            <th scope="col">{{ t('faturamento.data') }}</th>
            <th scope="col">{{ t('faturamento.grupo') }}</th>
            <th scope="col">{{ t('faturamento.codigo') }}</th>
            <th scope="col">{{ t('faturamento.nome') }}</th>
            <th scope="col">{{ t('faturamento.quantidade') }}</th>
            <th scope="col">{{ t('faturamento.unitario') }}</th>
            <th scope="col">{{ t('faturamento.valor') }}</th>
            <th scope="col">{{ t('faturamento.origem') }}</th>
            <th scope="col">{{ t('faturamento.conferido') }}</th>
            <th scope="col">{{ t('faturamento.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens.data.value.itens" :key="i.id" :data-testid="`lan-item-${i.id}`">
            <td>
              <input
                v-if="!i.conferidoPor"
                type="checkbox"
                :checked="marcados.has(i.id)"
                :aria-label="`${t('faturamento.conferido')} ${i.id}`"
                :data-testid="`lan-marca-${i.id}`"
                @change="alternar(i.id)"
              />
            </td>
            <td>{{ data(i.data) }} {{ i.hora }}</td>
            <td>{{ i.grupo }}</td>
            <td>{{ i.codigo }}</td>
            <td>{{ i.nome }}</td>
            <td>{{ num(i.quantidade) }}</td>
            <td>{{ num(i.unitario) }}</td>
            <td>{{ reais(i.valor) }}</td>
            <td>
              {{ i.origemRotulo
              }}<span v-if="i.documentoOrigem" class="secundario"> · {{ i.documentoOrigem }}</span>
            </td>
            <td :data-testid="`lan-conferido-${i.id}`">{{ i.conferidoPor || '—' }}</td>
            <td>
              <button type="button" :data-testid="`lan-explicar-${i.id}`" @click="explicado = i.id">
                {{ t('faturamento.itens.explicar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="filtros">
        <button type="button" :disabled="pagina === 0" @click="pagina -= 1">
          {{ t('faturamento.anterior') }}
        </button>
        <button
          type="button"
          :disabled="(pagina + 1) * itens.data.value.porPagina >= itens.data.value.total"
          @click="pagina += 1"
        >
          {{ t('faturamento.proxima') }}
        </button>
      </div>
    </template>

    <section v-if="explicado !== null" aria-labelledby="lan-exp-titulo" data-testid="lan-explicacao">
      <h2 id="lan-exp-titulo">{{ t('faturamento.itens.explicacao', { id: explicado }) }}</h2>
      <ErroFaturamento v-if="explicacao.error.value" :erro="explicacao.error.value" />
      <template v-else-if="explicacao.data.value">
        <ol>
          <li v-for="p in explicacao.data.value.passos" :key="p.ordem">{{ p.texto }}</li>
        </ol>
        <p data-testid="lan-explicacao-conclusao">
          <strong>{{ explicacao.data.value.conclusao }}</strong>
        </p>
      </template>
    </section>

    <section
      v-if="pode('faturamento.lancarItem') || motivo('faturamento.lancarItem')"
      aria-labelledby="lan-novo-titulo"
    >
      <h2 id="lan-novo-titulo">{{ t('faturamento.itens.lancar') }}</h2>
      <AvisoFaturamento :motivo="pode('faturamento.lancarItem') ? null : motivo('faturamento.lancarItem')" />
      <form v-if="pode('faturamento.lancarItem')" class="filtros" @submit.prevent="lancar">
        <span class="campo">
          <SanteSelecao
            v-model="novo.tipo"
            :rotulo="t('faturamento.itens.tipo')"
            :opcoes="opcoesGrupo"
            data-testid="lan-n-tipo"
          />
        </span>
        <span class="campo"
          ><label for="lan-n-codigo">{{ t('faturamento.codigo') }}</label
          ><input id="lan-n-codigo" v-model="novo.codigo" inputmode="numeric" data-testid="lan-n-codigo"
        /></span>
        <span class="campo"
          ><label for="lan-n-qtd">{{ t('faturamento.quantidade') }}</label
          ><input
            id="lan-n-qtd"
            v-model="novo.quantidade"
            inputmode="decimal"
            size="6"
            data-testid="lan-n-qtd"
        /></span>
        <span class="campo"
          ><label for="lan-n-data">{{ t('faturamento.data') }}</label
          ><input id="lan-n-data" v-model="novo.data" type="date" data-testid="lan-n-data"
        /></span>
        <span class="campo"
          ><label for="lan-n-hora">{{ t('faturamento.hora') }}</label
          ><input id="lan-n-hora" v-model="novo.hora" maxlength="5" size="5" data-testid="lan-n-hora"
        /></span>
        <span class="campo"
          ><label for="lan-n-local">{{ t('faturamento.itens.local') }}</label
          ><input id="lan-n-local" v-model="novo.local" inputmode="numeric" size="5"
        /></span>
        <span class="campo"
          ><label for="lan-n-ato">{{ t('faturamento.itens.ato') }}</label
          ><input id="lan-n-ato" v-model="novo.ato" inputmode="numeric" size="4"
        /></span>
        <span class="campo"
          ><label for="lan-n-manual">{{ t('faturamento.itens.precoManual') }}</label
          ><input
            id="lan-n-manual"
            v-model="novo.manual"
            inputmode="decimal"
            size="8"
            data-testid="lan-n-manual"
        /></span>
        <span v-if="novo.manual" class="campo"
          ><label for="lan-n-just">{{ t('faturamento.itens.justificativa') }}</label
          ><input id="lan-n-just" v-model="novo.justificativa" maxlength="250"
        /></span>
        <span v-if="novo.manual" class="campo"
          ><label for="lan-n-aprov">{{ t('faturamento.itens.aprovador') }}</label
          ><input id="lan-n-aprov" v-model="novo.aprovador" maxlength="31"
        /></span>
        <button type="submit" data-testid="lan-n-gravar">{{ t('faturamento.itens.lancar') }}</button>
      </form>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
