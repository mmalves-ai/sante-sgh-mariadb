<script setup lang="ts">
// Regiões anatômicas do exame (F8, 09-AREA linha 84), dentro da ficha do exame em `/sadt/catalogo`: as regiões
// codificadas (hierarquia "estrutura do corpo" da terminologia clínica) que o exame admite, com a padrão marcada. Ligar é buscar e escolher, com a opção de já marcar como padrão (a padrão é única: a nova tira a anterior);
// retirar só desativa a ligação, que pode ser religada. A regra final (região ativa, repetida) é do servidor.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { buscarRegioes, gravarRegiaoExame, type RegiaoTela } from '../../pep/api-terminologia-clinica.js';

const props = defineProps<{ exameId: number }>();

const T = {
  titulo: 'Regiões anatômicas do exame',
  texto: 'Regiões codificadas que o exame admite, com a padrão marcada; retirar só desativa a ligação.',
  nenhuma: 'Nenhuma região ligada a este exame.',
  padrao: 'padrão',
  buscar: 'Buscar a região (nome ou código)',
  regiao: 'Região',
  semResultado: 'Nenhuma região encontrada.',
  comoPadrao: 'Marcar como padrão',
  ligar: 'Ligar a região',
  tornarPadrao: 'Tornar padrão',
  retirar: 'Retirar',
  gravado: 'Regiões do exame atualizadas.',
} as const;

const ligadas = ref<RegiaoTela[]>([]);
const erro = ref('');
const aviso = ref('');
const busca = ref('');
const achadas = ref<RegiaoTela[]>([]);
const escolhida = ref('');
const padrao = ref(false);

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function carregar() {
  try {
    ligadas.value = [...(await buscarRegioes({ exame: props.exameId }))];
  } catch (e) {
    erro.value = mensagem(e);
  }
}
onMounted(carregar);
watch(() => props.exameId, carregar);

let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (v) => {
  clearTimeout(espera);
  espera = setTimeout(async () => {
    const q = v.trim();
    if (q.length < 2) {
      achadas.value = [];
      return;
    }
    try {
      const ja = new Set(ligadas.value.map((r) => r.id));
      achadas.value = (await buscarRegioes({ texto: q })).filter((r) => !ja.has(r.id));
      if (achadas.value.length === 1) escolhida.value = String(achadas.value[0]!.id);
    } catch (e) {
      erro.value = mensagem(e);
    }
  }, 300);
});
const opcoes = computed(() =>
  achadas.value.map((r) => ({ valor: String(r.id), rotulo: `${r.descricao} (${r.codigo})` })),
);

async function gravar(corpo: Record<string, unknown>) {
  erro.value = '';
  aviso.value = '';
  try {
    await gravarRegiaoExame({ exame: props.exameId, ...corpo });
    aviso.value = T.gravado;
    await carregar();
    return true;
  } catch (e) {
    erro.value = mensagem(e);
    return false;
  }
}
async function ligar() {
  if (!escolhida.value) return;
  if (await gravar({ acao: 'ligar', regiao: Number(escolhida.value), padrao: padrao.value })) {
    busca.value = '';
    achadas.value = [];
    escolhida.value = '';
    padrao.value = false;
  }
}
// Tornar padrão: uma gravação só no servidor (a anterior deixa de ser padrão na mesma transação; nada é retirado).
async function tornarPadrao(r: RegiaoTela) {
  await gravar({ acao: 'padrao', regiao: r.id });
}
</script>

<template>
  <section data-testid="secao-regioes-anatomicas">
    <h2>{{ T.titulo }}</h2>
    <p>{{ T.texto }}</p>
    <p v-if="erro" role="alert" class="erro">{{ erro }}</p>
    <p v-if="aviso" role="status">{{ aviso }}</p>
    <p v-if="!ligadas.length" data-testid="regioes-nenhuma">{{ T.nenhuma }}</p>
    <ul v-else>
      <li v-for="r in ligadas" :key="r.id" :data-testid="`regiao-exame-${r.codigo}`">
        {{ r.descricao }} ({{ r.codigo }})
        <strong v-if="r.padrao" :data-testid="`regiao-marca-padrao-${r.codigo}`"> · {{ T.padrao }}</strong>
        <SanteBotao
          v-if="!r.padrao"
          variante="secundario"
          :rotulo="T.tornarPadrao"
          :data-testid="`regiao-padrao-${r.codigo}`"
          @acionar="tornarPadrao(r)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="T.retirar"
          :data-testid="`regiao-retirar-${r.codigo}`"
          @acionar="gravar({ acao: 'retirar', regiao: r.id })"
        />
      </li>
    </ul>
    <form class="regioes__nova" data-testid="regioes-ligar" @submit.prevent="ligar">
      <label
        >{{ T.buscar }}
        <input v-model="busca" type="search" maxlength="100" data-testid="regioes-busca" />
      </label>
      <SanteSelecao v-model="escolhida" :rotulo="T.regiao" :opcoes="opcoes" data-testid="regioes-escolha" />
      <small v-if="busca.trim().length >= 2 && !opcoes.length">{{ T.semResultado }}</small>
      <label
        ><input v-model="padrao" type="checkbox" data-testid="regioes-padrao" /> {{ T.comoPadrao }}</label
      >
      <SanteBotao
        tipo="submit"
        :desabilitado="!escolhida"
        :rotulo="T.ligar"
        data-testid="regioes-ligar-botao"
      />
    </form>
  </section>
</template>

<style scoped>
.regioes__nova {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
</style>
