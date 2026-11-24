<script setup lang="ts">
// Reclassificação gerencial (F3.8, 07-FIN linha 98): `/financeiro/gerencial/reclassificar?alvo=&id=`. A classificação
// atual fica ao lado da nova; o rateio já vem preenchido com o atual, a soma e o valor de cada centro aparecem enquanto
// se digita, e o botão só libera com 100%, sem centro repetido e com o motivo. O servidor confere de novo (tipo da
// natureza, competência fechada, lançamento cancelado) e guarda a classificação anterior no histórico.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  type AlvoReclassificacao,
  buscarLancamentos,
  type LancamentoAchado,
  lerCentros,
  lerClassificacao,
  reclassificar,
} from '../api-gestao.js';
import { quando, reais, usarFinanceiro } from '../usar-financeiro.js';

const MINIMO = 10;
const ALVOS: AlvoReclassificacao[] = ['titulo_pagar', 'titulo_receber', 'movimento_bancario'];
const { t } = useI18n();
const qc = useQueryClient();
const rota = useRoute();
const { apoio, pode, motivo: motivoOp } = usarFinanceiro();
const alvo = ref<AlvoReclassificacao>(
  ALVOS.includes(rota.query['alvo'] as AlvoReclassificacao)
    ? (rota.query['alvo'] as AlvoReclassificacao)
    : 'titulo_pagar',
);
const numero = ref('');
const achados = ref<LancamentoAchado[] | null>(null);
const aberto = ref<number | null>(Number(rota.query['id']) || null);
const atual = useQuery({
  queryKey: computed(() => ['financeiro', 'classificacao', alvo.value, aberto.value]),
  queryFn: () => lerClassificacao(alvo.value, aberto.value as number),
  enabled: computed(() => aberto.value !== null),
});
const centros = useQuery({
  queryKey: ['financeiro', 'centros'],
  queryFn: () => lerCentros(),
  staleTime: 60_000,
});

const natureza = ref('');
const linhas = ref<{ centro: string; percentual: number }[]>([]);
const motivo = ref('');
watch(
  () => atual.data.value,
  (a) => {
    if (!a) return;
    natureza.value = a.natureza?.codigo ?? '';
    linhas.value = a.rateio.map((r) => ({ centro: String(r.centroCusto), percentual: r.percentual }));
    if (linhas.value.length === 0) linhas.value = [{ centro: '', percentual: 100 }];
  },
  { immediate: true },
);
const soma = computed(
  () => Math.round(linhas.value.reduce((s, l) => s + Number(l.percentual || 0), 0) * 10_000) / 10_000,
);
const repetido = computed(() => new Set(linhas.value.map((l) => l.centro)).size !== linhas.value.length);
const faltam = computed(() => Math.max(0, MINIMO - motivo.value.trim().length));
const valorDe = (p: number) => reais(Math.round((((atual.data.value?.valor ?? 0) * p) / 100) * 100) / 100);
const classificacao = computed(() => {
  const [g, s, i] = natureza.value.split('.').map(Number);
  return g && s !== undefined && i !== undefined ? { grupo: g, subgrupo: s, item: i } : null;
});
const pronto = computed(
  () =>
    !!classificacao.value &&
    soma.value === 100 &&
    !repetido.value &&
    faltam.value === 0 &&
    linhas.value.every((l) => l.centro && l.percentual > 0),
);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('reclassificar');
// A busca é pelo número de negócio (título) ou pelo documento e histórico (movimento); um só achado abre direto. Das
// telas do título e do movimento, o botão Reclassificar chega com alvo e id na rota, sem busca.
async function buscar() {
  mensagem.value = null;
  erro.value = null;
  try {
    const r = await buscarLancamentos(alvo.value, numero.value);
    achados.value = r;
    aberto.value = r.length === 1 ? r[0]!.id : null;
  } catch (e) {
    erro.value = e;
  }
}
function abrir(id: number) {
  aberto.value = id;
  mensagem.value = null;
  erro.value = null;
}
async function confirmar() {
  if (!pronto.value || !atual.data.value || !classificacao.value) return;
  erro.value = null;
  gravando.value = true;
  try {
    mensagem.value = (
      await reclassificar(
        {
          alvo: alvo.value,
          id: atual.data.value.id,
          classificacao: classificacao.value,
          rateio: linhas.value.map((l) => ({
            centroCusto: Number(l.centro),
            percentual: Number(l.percentual),
          })),
          motivo: motivo.value,
        },
        chave,
      )
    ).mensagem;
    chave = novaChave('reclassificar');
    motivo.value = '';
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rc-titulo" data-testid="tela-fin-reclassificar">
    <h1 id="rc-titulo">{{ t('financeiro.gestao.reclassificar.titulo') }}</h1>
    <p>{{ t('financeiro.gestao.reclassificar.texto') }}</p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />

    <form class="formulario" @submit.prevent="buscar">
      <span class="campo">
        <label for="rc-alvo">{{ t('financeiro.gestao.reclassificar.alvo') }}</label>
        <select id="rc-alvo" v-model="alvo" data-testid="rc-alvo">
          <option v-for="a in ALVOS" :key="a" :value="a">
            {{ t(`financeiro.gestao.reclassificar.alvos.${a}`) }}
          </option>
        </select>
      </span>
      <span class="campo">
        <label for="rc-numero">{{ t('financeiro.gestao.reclassificar.numero') }}</label>
        <input id="rc-numero" v-model="numero" minlength="2" data-testid="rc-numero" />
      </span>
      <button type="submit" data-testid="rc-buscar">{{ t('financeiro.gestao.reclassificar.buscar') }}</button>
    </form>
    <p v-if="achados && achados.length === 0" data-testid="rc-nenhum">
      {{ t('financeiro.gestao.reclassificar.nenhum') }}
    </p>
    <table v-else-if="achados && achados.length > 1" class="tabela" data-testid="rc-achados">
      <caption>
        {{
          t('financeiro.gestao.reclassificar.escolher')
        }}
      </caption>
      <tbody>
        <tr v-for="x in achados" :key="x.id">
          <td>{{ x.rotulo }}</td>
          <td>{{ quando(x.data) }}</td>
          <td>{{ reais(x.valor) }}</td>
          <td>{{ x.natureza ?? '' }}</td>
          <td>
            <button type="button" :data-testid="`rc-abrir-${x.id}`" @click="abrir(x.id)">
              {{ t('financeiro.gestao.reclassificar.abrir') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <ErroFaturamento v-if="atual.error.value" :erro="atual.error.value" />
    <div v-else-if="atual.data.value" class="colunas" data-testid="rc-lancamento">
      <div>
        <h2>{{ t('financeiro.gestao.reclassificar.atual') }}</h2>
        <p>
          {{ t('financeiro.gestao.reclassificar.valor') }}: {{ reais(atual.data.value.valor) }} ·
          {{ atual.data.value.data }}
        </p>
        <p data-testid="rc-natureza-atual">
          {{ t('financeiro.gestao.reclassificar.natureza') }}:
          {{
            atual.data.value.natureza
              ? `${atual.data.value.natureza.codigo} ${atual.data.value.natureza.descricao}`
              : t('financeiro.gestao.reclassificar.semNatureza')
          }}
        </p>
        <ul data-testid="rc-rateio-atual">
          <li v-for="r in atual.data.value.rateio" :key="r.centroCusto">
            {{ r.centro }}: {{ r.percentual }}% ({{ reais(r.valor) }})
          </li>
        </ul>
        <h3>{{ t('financeiro.gestao.reclassificar.historico') }}</h3>
        <ul v-if="atual.data.value.reclassificacoes.length" data-testid="rc-historico">
          <li v-for="h in atual.data.value.reclassificacoes" :key="h.em">
            {{ quando(h.em) }} · {{ h.por }} · {{ h.motivo }}
          </li>
        </ul>
        <p v-else>{{ t('financeiro.gestao.reclassificar.semHistorico') }}</p>
        <small>{{
          t('financeiro.gestao.reclassificar.substituidas', { n: atual.data.value.substituidas })
        }}</small>
      </div>

      <form class="formulario" data-testid="rc-nova" @submit.prevent="confirmar">
        <h2>{{ t('financeiro.gestao.reclassificar.nova') }}</h2>
        <span class="campo">
          <label for="rc-natureza">{{ t('financeiro.gestao.reclassificar.natureza') }}</label>
          <select id="rc-natureza" v-model="natureza" data-testid="rc-natureza">
            <option
              v-for="c in apoio.data.value?.classificacoes ?? []"
              :key="`${c.grupo}.${c.subgrupo}.${c.item}`"
              :value="`${c.grupo}.${c.subgrupo}.${c.item}`"
            >
              {{ c.grupo }}.{{ c.subgrupo }}.{{ c.item }} {{ c.nome }}
            </option>
          </select>
        </span>
        <div v-for="(l, i) in linhas" :key="i" class="linha" :data-testid="`rc-linha-${i}`">
          <select v-model="l.centro" :aria-label="t('financeiro.gestao.reclassificar.centro')">
            <option v-for="c in centros.data.value ?? []" :key="c.id" :value="String(c.id)">
              {{ c.codigo }} {{ c.nome }}
            </option>
          </select>
          <input
            v-model.number="l.percentual"
            type="number"
            min="0.0001"
            max="100"
            step="0.0001"
            :aria-label="t('financeiro.gestao.reclassificar.percentual')"
          />
          <span>{{ valorDe(Number(l.percentual || 0)) }}</span>
          <button v-if="linhas.length > 1" type="button" @click="linhas.splice(i, 1)">
            {{ t('financeiro.gestao.reclassificar.remover') }}
          </button>
        </div>
        <button
          type="button"
          data-testid="rc-incluir"
          @click="linhas.push({ centro: '', percentual: Math.max(0, 100 - soma) })"
        >
          {{ t('financeiro.gestao.reclassificar.incluirCentro') }}
        </button>
        <p :aria-invalid="soma !== 100" data-testid="rc-soma">
          {{ t('financeiro.gestao.reclassificar.soma', { soma }) }}
          <strong v-if="soma !== 100">{{ t('financeiro.gestao.reclassificar.somaErrada') }}</strong>
          <strong v-if="repetido">{{ t('financeiro.gestao.reclassificar.repetido') }}</strong>
        </p>
        <span class="campo">
          <label for="rc-motivo">{{ t('financeiro.gestao.reclassificar.motivo') }}</label>
          <textarea
            id="rc-motivo"
            v-model="motivo"
            maxlength="500"
            :aria-invalid="faltam > 0"
            data-testid="rc-motivo"
          ></textarea>
          <small v-if="faltam > 0">{{ t('financeiro.gestao.reclassificar.faltam', { n: faltam }) }}</small>
        </span>
        <button
          type="submit"
          :disabled="
            gravando ||
            !pronto ||
            !pode('financeiro.reclassificarLancamento', 'financeiro.classificacao.editar')
          "
          :title="motivoOp('financeiro.reclassificarLancamento') ?? undefined"
          data-testid="rc-confirmar"
        >
          {{ t('financeiro.gestao.reclassificar.confirmar') }}
        </button>
      </form>
    </div>
  </section>
</template>
