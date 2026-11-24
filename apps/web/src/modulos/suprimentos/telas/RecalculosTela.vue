<script setup lang="ts">
// Recálculo de saldos (F3.6, 05-SUP linha 16): `/suprimentos/recalculos`. Em uma tela: escolhe o escopo (local e item,
// ou todos), o mês de partida e se refaz também o custo médio, escreve o motivo, vê a prévia pelo razão (o gravado, o
// refeito e a diferença de cada saldo, os pendentes com razão negativo) e aplica com um clique. O razão nunca é
// editado; cada aplicação fica registrada com o motivo e as diferenças, listada abaixo.
import { conferirRecalculo, type ItemBusca, type PreviaRecalculo } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { aplicarRecalculo, previaRecalculo } from '../api-recalculo.js';
import { lerRecalculos, novaChave } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { quando, usarSuprimentos } from '../usar-suprimentos.js';

const OP = 'suprimentos.recalcularSaldos';
const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo: motivoOp, locais } = usarSuprimentos();
const r = useQuery({ queryKey: ['suprimentos', 'recalculos'], queryFn: () => lerRecalculos() });

const hoje = new Date();
const mesInicio = ref(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`);
const local = ref<number | null>(null);
const item = ref<ItemBusca | null>(null);
const recalculaCusto = ref(true);
const motivo = ref('');
const previa = ref<PreviaRecalculo | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

const entrada = computed(() => ({
  local: local.value,
  insumo: item.value?.codigo ?? null,
  ano: Number(mesInicio.value.slice(0, 4)),
  mes: Number(mesInicio.value.slice(5, 7)),
  recalculaCusto: recalculaCusto.value,
  motivo: motivo.value.replace(/\s+/g, ' ').trim(),
}));
/** Validação na hora com a mesma regra da API (o mês fechado é conferido no servidor, que conhece os fechamentos). */
const recusas = computed(() =>
  conferirRecalculo(
    { competencia: { ano: entrada.value.ano, mes: entrada.value.mes }, motivo: entrada.value.motivo },
    [],
    { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 },
  ),
);
const valido = computed(() => /^\d{4}-\d{2}$/.test(mesInicio.value) && recusas.value.length === 0);
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function mudou(): void {
  previa.value = null;
  mensagem.value = null;
}
async function verPrevia(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    previa.value = await previaRecalculo(entrada.value, novaChave('previa-recalculo'));
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function aplicar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await aplicarRecalculo(entrada.value, novaChave('recalculo'))).mensagem;
    previa.value = null;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rec-titulo" data-testid="tela-suprimentos-recalculos">
    <h1 id="rec-titulo">{{ t('suprimentos.recalculos.titulo') }}</h1>
    <p>{{ t('suprimentos.recalculos.texto') }}</p>
    <AvisoSuprimentos :motivo="pode(OP) ? null : motivoOp(OP)" />
    <form v-if="pode(OP)" class="formulario" data-testid="rec-form" @submit.prevent="verPrevia">
      <label class="campo">
        {{ t('suprimentos.recalculos.mesInicio') }}
        <input v-model="mesInicio" type="month" required data-testid="rec-mes" @change="mudou" />
      </label>
      <label class="campo">
        {{ t('suprimentos.recalculos.local') }}
        <select v-model="local" data-testid="rec-local" @change="mudou">
          <option :value="null">{{ t('suprimentos.recalculos.todos') }}</option>
          <option v-for="l in locais" :key="l.codigo" :value="l.codigo">{{ l.nome }}</option>
        </select>
      </label>
      <div class="campo">
        <span v-if="item" data-testid="rec-item">
          {{ item.nome }}
          <button type="button" data-testid="rec-item-limpar" @click="((item = null), mudou())">
            {{ t('suprimentos.recalculos.todosItens') }}
          </button>
        </span>
        <BuscaItem
          v-else
          :rotulo="t('suprimentos.recalculos.item')"
          testid="rec-busca"
          @escolher="(i) => ((item = i), mudou())"
        />
      </div>
      <label class="campo">
        <input v-model="recalculaCusto" type="checkbox" data-testid="rec-custo" @change="mudou" />
        {{ t('suprimentos.recalculos.recalculaCusto') }}
      </label>
      <label class="campo">
        {{ t('suprimentos.recalculos.motivo') }}
        <textarea v-model="motivo" maxlength="250" rows="2" data-testid="rec-motivo" @input="mudou" />
      </label>
      <ul v-if="motivo.length > 0 && recusas.length > 0" class="erros" data-testid="rec-recusas">
        <li v-for="x in recusas" :key="x.codigo">{{ x.mensagem }}</li>
      </ul>
      <SanteBotao type="submit" :disabled="!valido || ocupado" data-testid="rec-previa">
        {{ t('suprimentos.recalculos.verPrevia') }}
      </SanteBotao>
    </form>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="rec-mensagem">{{ mensagem }}</p>

    <section v-if="previa" aria-labelledby="rec-previa-titulo" data-testid="rec-previa-resultado">
      <h2 id="rec-previa-titulo">{{ t('suprimentos.recalculos.previa') }}</h2>
      <p data-testid="rec-resumo">
        {{
          t('suprimentos.recalculos.resumo', {
            saldos: previa.saldos,
            diferentes: previa.diferencas.length,
            pendentes: previa.pendentes,
            abertura: previa.abertura ?? t('suprimentos.recalculos.semAbertura'),
          })
        }}
        {{ t('suprimentos.recalculos.totalValor') }}: <strong>{{ reais(previa.diferencaValorTotal) }}</strong>
      </p>
      <table v-if="previa.diferencas.length > 0" class="tabela" data-testid="rec-diferencas">
        <caption>
          {{
            t('suprimentos.recalculos.diferencas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.recalculos.local') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.item') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.gravado') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.refeito') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.custo') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.diferenca') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in previa.diferencas" :key="d.saldo" :data-pendente="d.negativoNoMovimento !== null">
            <td>{{ d.localNome }}</td>
            <td>{{ d.insumoNome }}</td>
            <td>{{ qtd(d.quantidadeGravada) }}</td>
            <td>
              {{ qtd(d.quantidadeRefeita) }}
              <em v-if="d.negativoNoMovimento !== null">
                {{ t('suprimentos.recalculos.pendente', { movimento: d.negativoNoMovimento }) }}
              </em>
            </td>
            <td>
              {{ reais(d.custoGravado) }} {{ t('suprimentos.recalculos.para') }} {{ reais(d.custoRefeito) }}
            </td>
            <td>{{ qtd(d.diferencaQuantidade) }} ({{ reais(d.diferencaValor) }})</td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="rec-sem-diferenca">{{ t('suprimentos.recalculos.semDiferenca') }}</p>
      <SanteBotao
        v-if="previa.diferencas.length > previa.pendentes"
        :disabled="ocupado"
        data-testid="rec-aplicar"
        @click="aplicar"
      >
        {{ t('suprimentos.recalculos.aplicar') }}
      </SanteBotao>
    </section>

    <ErroSuprimentos v-if="r.error.value" :erro="r.error.value" />
    <p v-else-if="!r.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="rec-tabela">
        <caption>
          {{
            t('suprimentos.recalculos.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.recalculos.inicio') }}</th>
            <th scope="col">{{ t('suprimentos.usuario') }}</th>
            <th scope="col">{{ t('suprimentos.competencia') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.motivo') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.corrigidos') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.diferenca') }}</th>
            <th scope="col">{{ t('suprimentos.recalculos.terminado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in r.data.value.itens" :key="x.id">
            <td>{{ quando(x.inicio) }}</td>
            <td>{{ x.usuario }}</td>
            <td>{{ x.competencia }}</td>
            <td>{{ x.motivo ?? '' }}</td>
            <td>{{ x.insumos ?? '' }}</td>
            <td>
              {{ x.diferencaValor === null || x.diferencaValor === undefined ? '' : reais(x.diferencaValor) }}
            </td>
            <td>{{ x.terminado ? t('suprimentos.sim') : t('suprimentos.nao') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="r.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
