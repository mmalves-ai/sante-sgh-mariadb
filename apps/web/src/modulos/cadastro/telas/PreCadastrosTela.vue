<script setup lang="ts">
// Pré-cadastro de quem marca sem prontuário (F3.1, 02-CAD linha 6). Em cima, a central de marcação grava o mínimo
// (nome, nascimento, telefone; CPF e convênio se houver) com a validação na hora. Embaixo, a recepção vê os pendentes e,
// na chegada, converte com um clique: o sistema reaproveita o paciente do mesmo CPF; sem ele, mostra os dados para a
// ficha nova e liga ao paciente cadastrado. Nada é apagado.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  converterPreCadastro,
  lerOpcoes,
  lerPreCadastros,
  type Opcoes,
  type PreCadastro,
  type PreviaConversao,
  previaConversao,
  registrarPreCadastro,
} from '../api-vinculos.js';

const { t } = useI18n();
const hoje = new Date().toISOString().slice(0, 10);
const f = ref({ nome: '', nascimento: '', celular: '', cpf: '', fontePagadora: 0, numeroCarteira: '' });
const opcoes = ref<Opcoes | null>(null);
const lista = ref<PreCadastro[]>([]);
const situacao = ref('pendente');
const termo = ref('');
const erro = ref<unknown>(null);
const mensagem = ref('');
const previa = ref<{ id: number; p: PreviaConversao } | null>(null);
const pacienteEscolhido = ref(0);
const digitos = (s: string) => s.replace(/\D/g, '');

const pendencias = computed(() => {
  const r: string[] = [];
  if (f.value.nome.trim().split(/\s+/).filter(Boolean).length < 2) r.push(t('vinculos.pre.faltas.nome'));
  if (!f.value.nascimento || f.value.nascimento > hoje) r.push(t('vinculos.pre.faltas.nascimento'));
  if (digitos(f.value.celular).length < 10) r.push(t('vinculos.pre.faltas.telefone'));
  if (f.value.cpf && digitos(f.value.cpf).length !== 11) r.push(t('vinculos.pre.faltas.cpf'));
  if (f.value.numeroCarteira && !f.value.fontePagadora) r.push(t('vinculos.pre.faltas.fonte'));
  return r;
});

async function carregar(): Promise<void> {
  try {
    lista.value = (await lerPreCadastros(situacao.value, termo.value)).itens;
  } catch (e) {
    erro.value = e;
  }
}
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  try {
    await registrarPreCadastro({
      nome: f.value.nome,
      nascimento: f.value.nascimento,
      celular: f.value.celular,
      cpf: f.value.cpf || null,
      fontePagadora: f.value.fontePagadora || null,
      numeroCarteira: f.value.numeroCarteira || null,
    });
    mensagem.value = t('vinculos.pre.gravado');
    f.value = { nome: '', nascimento: '', celular: '', cpf: '', fontePagadora: 0, numeroCarteira: '' };
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
async function verChegada(id: number): Promise<void> {
  erro.value = null;
  try {
    previa.value = { id, p: await previaConversao(id) };
  } catch (e) {
    erro.value = e;
  }
}
async function converter(id: number, paciente?: number): Promise<void> {
  erro.value = null;
  try {
    const r = await converterPreCadastro(id, paciente);
    mensagem.value = t('vinculos.pre.convertido', { paciente: r.paciente, marcacoes: r.marcacoes });
    previa.value = null;
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
void lerOpcoes()
  .then((o) => {
    opcoes.value = o;
  })
  .catch(() => undefined);
void carregar();
</script>

<template>
  <main class="tela" data-testid="pre-cadastros">
    <h1>{{ t('vinculos.pre.titulo') }}</h1>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <form v-if="pode('agenda.marcacao.agendar')" data-testid="novo-pre-cadastro" @submit.prevent="gravar">
      <label
        >{{ t('vinculos.pre.nome') }} <input v-model="f.nome" name="nome" maxlength="150" required
      /></label>
      <label
        >{{ t('vinculos.pre.nascimento') }}
        <input v-model="f.nascimento" name="nascimento" type="date" :max="hoje" required
      /></label>
      <label
        >{{ t('vinculos.pre.celular') }} <input v-model="f.celular" name="celular" maxlength="20" required
      /></label>
      <label>{{ t('vinculos.pre.cpf') }} <input v-model="f.cpf" name="cpf" maxlength="14" /></label>
      <label v-if="opcoes"
        >{{ t('vinculos.pre.fonte') }}
        <select v-model.number="f.fontePagadora">
          <option :value="0">{{ t('vinculos.pre.naoInformada') }}</option>
          <option v-for="x in opcoes.fontes" :key="x.id" :value="x.id">{{ x.nome }}</option>
        </select>
      </label>
      <label v-if="f.fontePagadora"
        >{{ t('vinculos.pre.carteira') }} <input v-model="f.numeroCarteira" maxlength="30"
      /></label>
      <ul v-if="pendencias.length && f.nome" class="pendencias">
        <li v-for="p in pendencias" :key="p">{{ t('vinculos.pre.falta', { item: p }) }}</li>
      </ul>
      <button type="submit" :disabled="pendencias.length > 0">{{ t('vinculos.pre.gravar') }}</button>
    </form>

    <h2>{{ t('vinculos.pre.lista') }}</h2>
    <form @submit.prevent="carregar">
      <select v-model="situacao" :aria-label="t('vinculos.pre.situacao')" @change="carregar">
        <option value="pendente">{{ t('vinculos.pre.pendentes') }}</option>
        <option value="convertido">{{ t('vinculos.pre.convertidos') }}</option>
        <option value="">{{ t('vinculos.pre.todos') }}</option>
      </select>
      <input v-model="termo" :placeholder="t('vinculos.pre.nome')" :aria-label="t('vinculos.pre.nome')" />
      <button type="submit">{{ t('vinculos.pre.buscar') }}</button>
    </form>
    <table v-if="lista.length" data-testid="lista-pre-cadastros">
      <thead>
        <tr>
          <th scope="col">{{ t('vinculos.pre.nome') }}</th>
          <th scope="col">{{ t('vinculos.pre.nascimento') }}</th>
          <th scope="col">{{ t('vinculos.pre.telefone') }}</th>
          <th scope="col">{{ t('vinculos.pre.marcacoes') }}</th>
          <th scope="col">{{ t('vinculos.pre.situacao') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('vinculos.comum.acoes') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista" :key="x.id">
          <td>{{ x.nome }}</td>
          <td>{{ x.nascimento }}</td>
          <td>{{ x.celular ?? x.telefone }}</td>
          <td>{{ x.marcacoes }}</td>
          <td>
            <RouterLink v-if="x.paciente" :to="`/cadastros/pacientes/${x.paciente}`">{{
              x.situacao
            }}</RouterLink>
            <template v-else>{{ x.situacao }}</template>
          </td>
          <td>
            <button
              v-if="x.situacao === 'pendente' && pode('cadastro.paciente.criar')"
              type="button"
              @click="verChegada(x.id)"
            >
              {{ t('vinculos.pre.chegou') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('vinculos.pre.nenhum') }}</p>

    <section v-if="previa" data-testid="chegada" :aria-label="t('vinculos.pre.chegada')">
      <template v-if="previa.p.acao === 'vincular'">
        <p>{{ t('vinculos.pre.jaCadastrado', { paciente: previa.p.paciente }) }}</p>
        <button type="button" @click="converter(previa.id)">{{ t('vinculos.pre.ligar') }}</button>
      </template>
      <template v-else>
        <p v-if="previa.p.mensagem" role="alert">{{ previa.p.mensagem }}</p>
        <p v-else>{{ t('vinculos.pre.semCpf') }}</p>
        <dl v-if="previa.p.rascunho">
          <template v-for="(v, k) in previa.p.rascunho" :key="k">
            <dt>{{ k }}</dt>
            <dd>{{ v ?? '—' }}</dd>
          </template>
        </dl>
        <RouterLink to="/cadastros/pacientes/novo">{{ t('vinculos.pre.cadastrar') }}</RouterLink>
        <label
          >{{ t('vinculos.pre.codigoPaciente') }}
          <input v-model.number="pacienteEscolhido" type="number" min="1"
        /></label>
        <button type="button" :disabled="!pacienteEscolhido" @click="converter(previa.id, pacienteEscolhido)">
          {{ t('vinculos.pre.ligarEscolhido') }}
        </button>
      </template>
    </section>
  </main>
</template>
