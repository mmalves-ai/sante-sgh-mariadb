<script setup lang="ts">
// Lances da disputa aberta (C2-030, 05-SUP linha 26; Lei 14.133, art. 56 e 57): `/suprimentos/licitacao/lances`, aberta
// pela tela da licitação. Quem conduz a sessão escolhe o pregão ou leilão em sessão e registra os lances na própria linha
// do item: o licitante (só os que têm proposta válida), o valor e, quando o edital fixa, o intervalo mínimo. A regra do
// domínio é conferida na hora (melhora sobre a oferta anterior do próprio licitante, intervalo mínimo, 4 casas) e de
// novo na API. A classificação parcial e o histórico dos lances ficam ao lado; nada é apagado. A permissão (conduzir)
// é conferida pela API.
import { podeRegistrarLance } from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  type DisputaTela,
  type ItemDisputaTela,
  lerDisputa,
  listarProcessosEmDisputa,
  novaChaveLance,
  type ProcessoEmDisputaTela,
  registrarLance,
} from '../api-lance-pregao.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensLancePregao as M } from '../i18n-lance-pregao.js';
import { reais } from '../usar-suprimentos.js';

type Chave = keyof typeof M;
const k = (chave: Chave, p: Record<string, string | number> = {}): string =>
  M[chave].replace(/\{(\w+)\}/g, (_x, n: string) => String(p[n] ?? ''));

const processos = ref<ProcessoEmDisputaTela[]>([]);
const disputa = ref<DisputaTela | null>(null);
const escolhido = ref('');
const carregando = ref(true);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const intervalo = ref('');
const gravando = ref<number | null>(null);
const formulario = reactive<Record<number, { fornecedor: string; valor: string }>>({});

onMounted(async () => {
  try {
    processos.value = await listarProcessosEmDisputa();
  } catch (x) {
    erro.value = x;
  } finally {
    carregando.value = false;
  }
});

const opcoesProcessos = computed(() => [
  { valor: '', rotulo: k('escolha') },
  ...processos.value.map((p) => ({ valor: String(p.id), rotulo: `${p.numero} · ${p.objeto}` })),
]);

async function abrir(v: string): Promise<void> {
  escolhido.value = v;
  disputa.value = null;
  mensagem.value = null;
  if (!v) return;
  try {
    disputa.value = await lerDisputa(Number(v));
    for (const i of disputa.value.itens) formulario[i.id] ??= { fornecedor: '', valor: '' };
  } catch (x) {
    erro.value = x;
  }
}

const nomeDe = (i: ItemDisputaTela, fornecedor: number) =>
  i.propostas.find((p) => p.fornecedor === fornecedor)?.fornecedorNome ?? String(fornecedor);
const opcoesLicitantes = (i: ItemDisputaTela) => [
  { valor: '', rotulo: k('escolha') },
  ...i.propostas
    .filter((p) => p.apta)
    .map((p) => ({ valor: String(p.fornecedor), rotulo: p.fornecedorNome })),
];
const numeroDe = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'));

/** A regra do domínio na hora: a mesma que a API confere antes de gravar. */
function aviso(i: ItemDisputaTela): string | null {
  const f = formulario[i.id];
  if (!disputa.value || !f || !f.fornecedor || !f.valor) return null;
  const fornecedor = Number(f.fornecedor);
  const p = i.propostas.find((x) => x.fornecedor === fornecedor);
  const r = podeRegistrarLance({
    etapa: disputa.value.etapa,
    modalidade: disputa.value.modalidade,
    proposta: p ? { valor: p.valor, desclassificada: !p.apta, inabilitada: false } : null,
    lancesProprios: i.lances.filter((l) => l.fornecedor === fornecedor).map((l) => l.valor),
    valor: numeroDe(f.valor),
    intervaloMinimoPercentual: intervalo.value ? numeroDe(intervalo.value) : null,
  });
  return r?.mensagem ?? null;
}

async function lancar(i: ItemDisputaTela): Promise<void> {
  const f = formulario[i.id];
  if (!disputa.value || !f || aviso(i)) return;
  gravando.value = i.id;
  erro.value = null;
  try {
    const r = await registrarLance(
      disputa.value.id,
      {
        item: i.id,
        fornecedor: Number(f.fornecedor),
        valor: numeroDe(f.valor),
        intervaloMinimoPercentual: intervalo.value ? numeroDe(intervalo.value) : null,
      },
      novaChaveLance(),
    );
    mensagem.value = k('registrado', { valor: reais(r.valor), rodada: r.rodada, posicao: r.posicao });
    f.valor = '';
    disputa.value = await lerDisputa(disputa.value.id);
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = null;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="lance-titulo" data-testid="tela-lances-pregao">
    <h1 id="lance-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <RouterLink to="/suprimentos/licitacao">{{ k('voltar') }}</RouterLink>
    <ErroSuprimentos :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="lance-mensagem">{{ mensagem }}</p>
    <p v-if="carregando">{{ k('carregando') }}</p>
    <p v-else-if="processos.length === 0" class="secundario" data-testid="lance-sem-processo">
      {{ k('semProcesso') }}
    </p>
    <div class="filtros">
      <SanteSelecao
        :model-value="escolhido"
        :rotulo="k('processo')"
        :opcoes="opcoesProcessos"
        data-testid="lance-processo"
        @update:model-value="abrir"
      />
      <span class="campo">
        <label for="lance-intervalo">{{ k('intervalo') }}</label>
        <input id="lance-intervalo" v-model="intervalo" inputmode="decimal" data-testid="lance-intervalo" />
      </span>
    </div>

    <template v-if="disputa">
      <p class="secundario">{{ disputa.sentido === 'maior' ? k('sentidoMaior') : k('sentidoMenor') }}</p>
      <article
        v-for="i in disputa.itens"
        :key="i.id"
        class="painel"
        :data-testid="`lance-item-${i.sequencia}`"
      >
        <h2>{{ k('item', { sequencia: i.sequencia, descricao: i.descricao, quantidade: i.quantidade }) }}</h2>
        <form class="filtros" @submit.prevent="lancar(i)">
          <SanteSelecao
            v-model="formulario[i.id]!.fornecedor"
            :rotulo="k('licitante')"
            :opcoes="opcoesLicitantes(i)"
            :data-testid="`lance-licitante-${i.sequencia}`"
          />
          <span class="campo">
            <label :for="`lance-valor-${i.id}`">{{ k('valor') }}</label>
            <input
              :id="`lance-valor-${i.id}`"
              v-model="formulario[i.id]!.valor"
              inputmode="decimal"
              :aria-invalid="aviso(i) !== null"
              :aria-describedby="aviso(i) ? `lance-aviso-${i.id}` : undefined"
              :data-testid="`lance-valor-${i.sequencia}`"
            />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="k('registrar')"
            :desabilitado="gravando === i.id || aviso(i) !== null || !formulario[i.id]?.fornecedor"
            :data-testid="`lance-registrar-${i.sequencia}`"
          />
        </form>
        <p
          v-if="aviso(i)"
          :id="`lance-aviso-${i.id}`"
          role="alert"
          :data-testid="`lance-aviso-${i.sequencia}`"
        >
          {{ aviso(i) }}
        </p>

        <table class="tabela" :data-testid="`lance-classificacao-${i.sequencia}`">
          <caption>
            {{
              k('classificacao')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ k('posicao') }}</th>
              <th scope="col">{{ k('licitante') }}</th>
              <th scope="col">{{ k('proposta') }}</th>
              <th scope="col">{{ k('oferta') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in i.propostas" :key="p.fornecedor">
              <td>
                {{
                  p.apta
                    ? (i.classificacao.find((c) => c.fornecedor === p.fornecedor)?.posicao ?? '')
                    : k('fora')
                }}
              </td>
              <td>{{ p.fornecedorNome }}</td>
              <td>{{ reais(p.valor) }}</td>
              <td>{{ p.ultimoLance === null ? '' : reais(p.ultimoLance) }}</td>
            </tr>
          </tbody>
        </table>

        <table v-if="i.lances.length" class="tabela" :data-testid="`lance-historico-${i.sequencia}`">
          <caption>
            {{
              k('historico')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ k('hora') }}</th>
              <th scope="col">{{ k('licitante') }}</th>
              <th scope="col">{{ k('rodada') }}</th>
              <th scope="col">{{ k('valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in i.lances" :key="l.id">
              <td>{{ new Date(l.em).toLocaleTimeString('pt-BR') }}</td>
              <td>{{ nomeDe(i, l.fornecedor) }}</td>
              <td>{{ l.rodada }}</td>
              <td>{{ reais(l.valor) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="secundario">{{ k('semLance') }}</p>
      </article>
    </template>
  </section>
</template>
