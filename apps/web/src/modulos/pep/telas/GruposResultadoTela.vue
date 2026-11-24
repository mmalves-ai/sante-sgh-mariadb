<script setup lang="ts">
// Cadastro dos grupos comparativos de resultados (F3.3, linha 03-PEP L128): busca o exame, adiciona o exame inteiro
// ou um analito com um clique, reordena e grava com a versão lida; a validação do domínio volta campo a campo.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  buscarExames,
  type ExameBusca,
  gravarGrupo,
  type Grupo,
  lerGrupos,
} from '../api-resultados-grupos.js';

const { t } = useI18n();
const k = (c: string) => t(`pep.resultadosGrupos.admin.${c}`);
const grupos = ref<Grupo[]>([]);
const atual = ref<Grupo | null>(null);
const termo = ref('');
const achados = ref<ExameBusca[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const TIPOS = ['laboratorio', 'imagem', 'outro'] as const;

async function carregar(): Promise<void> {
  try {
    grupos.value = (await lerGrupos()).itens;
  } catch (e) {
    erro.value = e;
  }
}
onMounted(carregar);

function novo(): void {
  atual.value = {
    id: null,
    nome: '',
    tipoExame: 'laboratorio',
    ordem: 0,
    ativo: true,
    versao: null,
    itens: [],
  };
}
function editar(g: Grupo): void {
  atual.value = JSON.parse(JSON.stringify(g)) as Grupo;
}
async function buscar(): Promise<void> {
  if (termo.value.trim().length < 2) return;
  try {
    achados.value = (await buscarExames(termo.value)).itens;
  } catch (e) {
    erro.value = e;
  }
}
function adicionar(e: ExameBusca, analito: { id: number; nome: string } | null): void {
  if (!atual.value) return;
  const ja = atual.value.itens.some((i) => i.exame === e.id && i.exameAnalito === (analito?.id ?? null));
  if (ja) return;
  atual.value.itens.push({
    exame: e.id,
    nomeExame: e.nome,
    exameAnalito: analito?.id ?? null,
    nomeAnalito: analito?.nome ?? null,
    rotulo: null,
  });
}
function subir(i: number): void {
  const it = atual.value?.itens;
  if (!it || i === 0) return;
  [it[i - 1], it[i]] = [it[i]!, it[i - 1]!];
}
async function gravar(): Promise<void> {
  if (!atual.value) return;
  erro.value = null;
  mensagem.value = null;
  try {
    await gravarGrupo(atual.value);
    mensagem.value = t('pep.resultadosGrupos.gravado');
    atual.value = null;
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <main class="grupos" aria-labelledby="grupos-titulo" data-testid="tela-grupos-resultado">
    <h1 id="grupos-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('explica') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="mensagem" variante="info">{{ mensagem }}</SanteAlerta>
    <SanteBotao data-testid="grupo-novo" @click="novo">{{ k('novo') }}</SanteBotao>
    <table v-if="grupos.length" data-testid="grupos-lista">
      <thead>
        <tr>
          <th scope="col">{{ k('nome') }}</th>
          <th scope="col">{{ k('tipo') }}</th>
          <th scope="col">{{ k('itens') }}</th>
          <th scope="col">{{ k('ativo') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in grupos" :key="g.id ?? 0">
          <td>
            <SanteBotao variante="texto" @click="editar(g)">{{ g.nome }}</SanteBotao>
          </td>
          <td>{{ k(`tipos.${g.tipoExame}`) }}</td>
          <td>{{ g.itens.map((i) => i.rotulo || i.nomeAnalito || i.nomeExame).join(', ') }}</td>
          <td>{{ g.ativo ? '✓' : '—' }}</td>
        </tr>
      </tbody>
    </table>

    <form v-if="atual" class="editor" data-testid="grupo-editor" @submit.prevent="gravar">
      <div class="linha">
        <label
          >{{ k('nome') }} <input v-model="atual.nome" data-testid="grupo-nome" maxlength="100" required
        /></label>
        <label>
          {{ k('tipo') }}
          <select v-model="atual.tipoExame">
            <option v-for="x in TIPOS" :key="x" :value="x">{{ k(`tipos.${x}`) }}</option>
          </select>
        </label>
        <label
          >{{ k('ordem') }} <input v-model.number="atual.ordem" type="number" min="0" max="9999"
        /></label>
        <label><input v-model="atual.ativo" type="checkbox" /> {{ k('ativo') }}</label>
      </div>
      <div class="linha">
        <label>
          {{ k('buscar') }}
          <input v-model="termo" data-testid="grupo-busca" @keydown.enter.prevent="buscar" />
        </label>
        <SanteBotao variante="secundario" data-testid="grupo-buscar" @click="buscar">{{
          k('buscarBotao')
        }}</SanteBotao>
      </div>
      <ul class="achados">
        <li v-for="e in achados" :key="e.id">
          <strong>{{ e.nome }}</strong> ({{ e.codigo }})
          <SanteBotao variante="texto" :data-testid="`grupo-add-${e.id}`" @click="adicionar(e, null)">{{
            k('todosAnalitos')
          }}</SanteBotao>
          <SanteBotao v-for="a in e.analitos" :key="a.id" variante="texto" @click="adicionar(e, a)">{{
            a.nome
          }}</SanteBotao>
        </li>
      </ul>
      <h2>{{ k('itens') }}</h2>
      <ol data-testid="grupo-itens">
        <li v-for="(i, n) in atual.itens" :key="`${i.exame}|${i.exameAnalito}`">
          {{ i.nomeExame }}<template v-if="i.nomeAnalito"> — {{ i.nomeAnalito }}</template>
          <input
            v-if="i.exameAnalito !== null"
            :value="i.rotulo ?? ''"
            :placeholder="k('rotulo')"
            maxlength="60"
            @input="i.rotulo = ($event.target as HTMLInputElement).value || null"
          />
          <SanteBotao variante="texto" :desabilitado="n === 0" @click="subir(n)">{{ k('subir') }}</SanteBotao>
          <SanteBotao variante="texto" @click="atual.itens.splice(n, 1)">{{ k('tirar') }}</SanteBotao>
        </li>
      </ol>
      <SanteBotao tipo="submit" data-testid="grupo-gravar">{{ k('gravar') }}</SanteBotao>
    </form>
  </main>
</template>

<style scoped>
.grupos {
  padding: 1rem;
}
.editor .linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: end;
  margin-block: 0.5rem;
}
.achados li,
ol li {
  margin-block: 0.25rem;
}
</style>
