<script setup lang="ts">
// Pré-cadastro de quem marca sem prontuário (F3.1, 02-CAD linha 6). Em cima, a central de marcação grava o mínimo
// (nome, nascimento, telefone; CPF e convênio se houver) com a validação na hora. Embaixo, a recepção vê os pendentes e,
// na chegada, converte com um clique: o sistema reaproveita o paciente do mesmo CPF; sem ele, mostra os dados para a
// ficha nova e liga ao paciente achado na busca, que mostra nome e nascimento e confere a divergência antes de ligar
// (dados divergentes só com motivo). Quem já é paciente é avisado na gravação. Cancelar guarda o motivo; nada é apagado.
import { SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarPacientes } from '../api-cadastro.js';
import {
  cancelarPreCadastro,
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
type Achado = Awaited<ReturnType<typeof buscarPacientes>>['itens'][number];
const termoPaciente = ref('');
const achados = ref<Achado[] | null>(null);
const escolhido = ref<Achado | null>(null);
const motivoDivergencia = ref('');
const outraPessoa = ref(false);
const cancelando = ref<{ id: number; motivo: string } | null>(null);
const codigoErro = computed(() => (erro.value instanceof ErroApi ? erro.value.problema?.codigo : undefined));
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
      ...(outraPessoa.value ? { confirmadoOutraPessoa: true } : {}),
    });
    outraPessoa.value = false;
    mensagem.value = t('vinculos.pre.gravado');
    f.value = { nome: '', nascimento: '', celular: '', cpf: '', fontePagadora: 0, numeroCarteira: '' };
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
async function verChegada(id: number): Promise<void> {
  erro.value = null;
  escolhido.value = null;
  achados.value = null;
  motivoDivergencia.value = '';
  try {
    previa.value = { id, p: await previaConversao(id) };
  } catch (e) {
    erro.value = e;
  }
}
async function buscarPaciente(): Promise<void> {
  erro.value = null;
  try {
    achados.value = (await buscarPacientes(termoPaciente.value)).itens;
  } catch (e) {
    erro.value = e;
  }
}
/** Escolher na busca já mostra, antes de ligar, o que diverge entre o paciente e o pré-cadastro. */
async function escolher(p: Achado): Promise<void> {
  if (!previa.value) return;
  erro.value = null;
  escolhido.value = p;
  try {
    previa.value = { id: previa.value.id, p: await previaConversao(previa.value.id, p.id) };
  } catch (e) {
    erro.value = e;
  }
}
async function cancelar(): Promise<void> {
  if (!cancelando.value) return;
  erro.value = null;
  try {
    await cancelarPreCadastro(cancelando.value.id, cancelando.value.motivo);
    mensagem.value = t('vinculos.pre.cancelado');
    cancelando.value = null;
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
async function converter(id: number, paciente?: number): Promise<void> {
  erro.value = null;
  try {
    const r = await converterPreCadastro(id, paciente, motivoDivergencia.value.trim() || undefined);
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
watch(situacao, () => void carregar());
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
      <SanteSelecao
        v-if="opcoes"
        v-model="f.fontePagadora"
        :rotulo="t('vinculos.pre.fonte')"
        :opcoes="[
          { valor: 0, rotulo: t('vinculos.pre.naoInformada') },
          ...opcoes.fontes.map((x) => ({ valor: x.id, rotulo: x.nome })),
        ]"
      />
      <label v-if="f.fontePagadora"
        >{{ t('vinculos.pre.carteira') }} <input v-model="f.numeroCarteira" maxlength="30"
      /></label>
      <label v-if="codigoErro === 'paciente-semelhante' || outraPessoa"
        ><input v-model="outraPessoa" type="checkbox" name="outraPessoa" />
        {{ t('vinculos.pre.confirmarOutraPessoa') }}</label
      >
      <ul v-if="pendencias.length && f.nome" class="pendencias">
        <li v-for="p in pendencias" :key="p">{{ t('vinculos.pre.falta', { item: p }) }}</li>
      </ul>
      <button type="submit" :disabled="pendencias.length > 0">{{ t('vinculos.pre.gravar') }}</button>
    </form>

    <h2>{{ t('vinculos.pre.lista') }}</h2>
    <form @submit.prevent="carregar">
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('vinculos.pre.situacao')"
        ocultar-rotulo
        :opcoes="[
          { valor: 'pendente', rotulo: t('vinculos.pre.pendentes') },
          { valor: 'convertido', rotulo: t('vinculos.pre.convertidos') },
          { valor: 'cancelado', rotulo: t('vinculos.pre.cancelados') },
          { valor: '', rotulo: t('vinculos.pre.todos') },
        ]"
      />
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
            <button
              v-if="x.situacao === 'pendente' && pode('agenda.marcacao.agendar')"
              type="button"
              @click="cancelando = { id: x.id, motivo: '' }"
            >
              {{ t('vinculos.pre.cancelar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('vinculos.pre.nenhum') }}</p>

    <form v-if="cancelando" data-testid="cancelar-pre-cadastro" @submit.prevent="cancelar">
      <label
        >{{ t('vinculos.pre.motivoCancelamento') }}
        <input v-model="cancelando.motivo" name="motivoCancelamento" minlength="3" maxlength="400" required
      /></label>
      <button type="submit" :disabled="cancelando.motivo.trim().length < 3">
        {{ t('vinculos.pre.cancelar') }}
      </button>
    </form>

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
        <form data-testid="busca-paciente-chegada" @submit.prevent="buscarPaciente">
          <label
            >{{ t('vinculos.pre.buscaPaciente') }}
            <input v-model="termoPaciente" name="termoPaciente" minlength="2" maxlength="60" required
          /></label>
          <button type="submit">{{ t('vinculos.pre.buscarPaciente') }}</button>
        </form>
        <ul v-if="achados" data-testid="achados-chegada">
          <li v-for="p in achados" :key="p.id">
            {{ p.nome }} · {{ p.nascimento ?? '—' }} · {{ p.cpfMascarado ?? '—' }}
            <button type="button" @click="escolher(p)">{{ t('vinculos.pre.escolher') }}</button>
          </li>
          <li v-if="achados.length === 0">{{ t('vinculos.pre.nenhumPaciente') }}</li>
        </ul>
        <template v-if="escolhido">
          <p>
            {{
              t('vinculos.pre.escolhido', { nome: escolhido.nome, nascimento: escolhido.nascimento ?? '—' })
            }}
          </p>
          <p v-if="previa.p.divergencias.length" role="alert">
            {{ t('vinculos.pre.divergencias', { itens: previa.p.divergencias.join(', ') }) }}
          </p>
          <label v-if="previa.p.divergencias.length"
            >{{ t('vinculos.pre.motivoDivergencia') }}
            <input v-model="motivoDivergencia" name="motivoDivergencia" maxlength="400"
          /></label>
          <button
            type="button"
            :disabled="
              previa.p.codigo === 'cpf-de-outro-paciente' ||
              (previa.p.divergencias.length > 0 && motivoDivergencia.trim().length < 10)
            "
            @click="converter(previa.id, escolhido.id)"
          >
            {{ t('vinculos.pre.ligarEscolhido') }}
          </button>
        </template>
      </template>
    </section>
  </main>
</template>
