<script setup lang="ts">
// Vínculo do item com a referência de preço (F3.6, 05-SUP linha 28), na própria ficha do item: o vigente em destaque,
// a busca com o fator sugerido pela unidade e a edição vigente já escolhida (um clique em "Escolher" e outro em
// "Vincular"), a conferência na hora pela mesma regra do servidor (fator, início depois do último, nada a mudar) e o
// histórico completo, que nunca some. Quem não pode editar o item recebe a recusa do servidor.
import {
  planejarVinculoReferenciaPreco,
  type VinculoReferenciaPrecoVigencia,
} from '@sgh/contratos/regras-suprimentos';
import { computed, ref, watch } from 'vue';
import {
  buscarReferenciaPreco,
  encerrarVinculoReferencia,
  type FichaVinculoReferencia,
  lerVinculoReferencia,
  type OpcaoReferencia,
  vincularReferenciaPreco,
} from '../api-vinculo-referencia.js';
import { mensagensVinculoReferencia as M } from '../i18n-vinculo-referencia.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ item: number }>();

const ficha = ref<FichaVinculoReferencia | null>(null);
const erro = ref<unknown>(null);
const aviso = ref('');
const termo = ref('');
const opcoes = ref<OpcaoReferencia[] | null>(null);
const escolhida = ref<OpcaoReferencia | null>(null);
const fator = ref<number | null>(null);
const inicio = ref('');
const fim = ref('');
const gravando = ref(false);

async function carregar(): Promise<void> {
  erro.value = null;
  ficha.value = await lerVinculoReferencia(props.item);
  inicio.value = ficha.value.hoje;
  fim.value = ficha.value.hoje;
}
watch(
  () => props.item,
  () => carregar().catch((e: unknown) => (erro.value = e)),
  { immediate: true },
);

let espera: ReturnType<typeof setTimeout> | null = null;
watch(termo, (v) => {
  if (espera) clearTimeout(espera);
  if (v.trim().length < 2) {
    opcoes.value = null;
    return;
  }
  espera = setTimeout(() => {
    buscarReferenciaPreco(props.item, v.trim())
      .then((r) => (opcoes.value = r))
      .catch((e: unknown) => (erro.value = e));
  }, 300);
});

function escolher(o: OpcaoReferencia): void {
  escolhida.value = o;
  fator.value = o.fatorSugerido;
  opcoes.value = null;
  termo.value = '';
}

const linhaDoTempo = computed<VinculoReferenciaPrecoVigencia[]>(() =>
  (ficha.value?.historico ?? []).map((v) => ({
    id: v.id,
    referencia: v.referencia.id,
    fator: v.fator,
    inicio: v.inicio,
    fim: v.fim,
  })),
);
/** A conferência na hora, pela mesma regra que o servidor aplica. */
const recusas = computed(() =>
  escolhida.value
    ? planejarVinculoReferenciaPreco(
        {
          referencia: escolhida.value.id,
          edicao: escolhida.value.edicaoVigente?.id ?? null,
          fator: Number(fator.value ?? 0),
          inicio: inicio.value,
        },
        linhaDoTempo.value,
      ).recusas
    : [],
);

async function vincular(): Promise<void> {
  if (!escolhida.value || recusas.value.length || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  aviso.value = '';
  try {
    await vincularReferenciaPreco(props.item, {
      referencia: escolhida.value.id,
      edicao: escolhida.value.edicaoVigente?.id ?? null,
      fator: Number(fator.value),
      inicio: inicio.value,
    });
    escolhida.value = null;
    fator.value = null;
    await carregar();
    aviso.value = M.vinculado;
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

async function encerrar(): Promise<void> {
  const v = ficha.value?.historico.find((x) => x.fim === null);
  if (!v || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  aviso.value = '';
  try {
    await encerrarVinculoReferencia(props.item, v.id, fim.value);
    await carregar();
    aviso.value = M.encerrado;
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const aberto = computed(() => ficha.value?.historico.find((x) => x.fim === null) ?? null);
const descricao = (r: OpcaoReferencia | FichaVinculoReferencia['historico'][number]['referencia']) =>
  `${r.fonte} ${r.codigo} · ${r.descricao}${r.apresentacao ? ` (${r.apresentacao})` : ''}${r.unidade ? ` · ${r.unidade}` : ''}`;
</script>

<template>
  <section class="cartao" aria-labelledby="vinculo-ref-titulo" data-testid="vinculo-referencia">
    <h2 id="vinculo-ref-titulo">{{ M.titulo }}</h2>
    <p>{{ M.texto }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="vinculo-referencia-ok">{{ aviso }}</p>
    <template v-if="ficha">
      <p data-testid="vinculo-referencia-vigente">
        <strong>{{ M.vigente }}:</strong>
        <template v-if="ficha.vigente">
          {{ descricao(ficha.vigente.referencia) }} · {{ M.fator }} {{ ficha.vigente.fator }}
          <template v-if="ficha.vigente.edicao"> · {{ M.edicao }} {{ ficha.vigente.edicao.numero }}</template>
        </template>
        <template v-else>{{ M.nenhum }}</template>
      </p>

      <fieldset>
        <label class="campo"
          >{{ M.buscar }}
          <input v-model="termo" maxlength="60" autocomplete="off" data-testid="vinculo-referencia-busca"
        /></label>
        <p v-if="opcoes && !opcoes.length">{{ M.semResultado }}</p>
        <ul v-if="opcoes && opcoes.length" data-testid="vinculo-referencia-opcoes">
          <li v-for="o in opcoes" :key="o.id">
            {{ descricao(o) }}
            <button
              type="button"
              class="link"
              :data-testid="`vinculo-referencia-escolher-${o.codigo}`"
              @click="escolher(o)"
            >
              {{ M.escolher }}
            </button>
          </li>
        </ul>
        <template v-if="escolhida">
          <p data-testid="vinculo-referencia-escolhida">
            <strong>{{ M.escolhida }}:</strong> {{ descricao(escolhida) }} ·
            {{
              escolhida.edicaoVigente ? `${M.edicaoVigente} ${escolhida.edicaoVigente.numero}` : M.semEdicao
            }}
          </p>
          <label class="campo"
            >{{ M.fator }}
            <input
              v-model.number="fator"
              type="number"
              min="0"
              step="any"
              data-testid="vinculo-referencia-fator"
          /></label>
          <small v-if="escolhida.fatorSugerido !== null">{{
            M.fatorSugerido.replace('{f}', String(escolhida.fatorSugerido))
          }}</small>
          <label class="campo"
            >{{ M.inicio }} <input v-model="inicio" type="date" data-testid="vinculo-referencia-inicio"
          /></label>
          <small
            v-for="r in recusas"
            :key="r.codigo"
            class="erro"
            :data-testid="`vinculo-referencia-recusa-${r.codigo}`"
            >{{ r.mensagem }}</small
          >
          <button
            type="button"
            class="botao primario"
            :disabled="recusas.length > 0 || gravando"
            data-testid="vinculo-referencia-vincular"
            @click="vincular"
          >
            {{ M.vincular }}
          </button>
        </template>
      </fieldset>

      <fieldset v-if="aberto">
        <label class="campo"
          >{{ M.encerrar }} <input v-model="fim" type="date" data-testid="vinculo-referencia-fim"
        /></label>
        <button
          type="button"
          class="botao"
          :disabled="gravando"
          data-testid="vinculo-referencia-encerrar"
          @click="encerrar"
        >
          {{ M.encerrarBotao }}
        </button>
      </fieldset>

      <h3>{{ M.historico }}</h3>
      <p v-if="!ficha.historico.length">{{ M.semHistorico }}</p>
      <table v-else data-testid="vinculo-referencia-historico">
        <thead>
          <tr>
            <th scope="col">{{ M.referencia }}</th>
            <th scope="col">{{ M.edicao }}</th>
            <th scope="col">{{ M.fator }}</th>
            <th scope="col">{{ M.periodo }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in ficha.historico" :key="v.id" :class="{ destaque: v.vigente }">
            <td>{{ descricao(v.referencia) }}</td>
            <td>{{ v.edicao?.numero ?? '' }}</td>
            <td>{{ v.fator }}</td>
            <td>{{ v.inicio }} {{ M.ate }} {{ v.fim ?? M.emAberto }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
