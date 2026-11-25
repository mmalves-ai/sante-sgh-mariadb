<script setup lang="ts">
// Paciente com acesso restrito ao prontuário (F8, 02-CAD linha 10): `/cadastros/pacientes/acesso-restrito` (os pacientes
// com marca em vigor neste estabelecimento) e `/cadastros/pacientes/:id/acesso-restrito` (visão do paciente: as marcas,
// vivas e encerradas, com os liberados de cada uma). Quem tem cadastro.acessoRestrito.editar marca, encerra com motivo,
// libera profissional ou equipe com justificativa e revoga; a validação é na hora e nada é apagado. O prontuário do
// paciente marcado, em todos os módulos clínicos, só abre para os liberados e para quem o atende agora.
import { SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarDestinos,
  type Destinos,
  encerrarMarca,
  type EntradaLiberacao,
  type EntradaMarca,
  EXIBICOES,
  faltasLiberacao,
  faltasMarca,
  lerAcessoRestrito,
  lerRestritos,
  liberarDestino,
  type MarcaVisao,
  marcarPaciente,
  type PacienteRestrito,
  revogarLiberacao,
  TIPOS_MARCA,
  type VisaoAcessoRestrito,
} from '../api-acesso-restrito.js';

const props = defineProps<{ id?: string }>();
const { t } = useI18n();
const router = useRouter();
const podeEditar = computed(() => pode('cadastro.acessoRestrito.editar'));
const quando = (v: string | null) => (v ? v.slice(0, 16).replace('T', ' ') : '');
const hoje = () => new Date().toISOString().slice(0, 10);

const erro = ref<unknown>(null);
const mensagem = ref('');
const lista = ref<PacienteRestrito[]>([]);
const visao = ref<VisaoAcessoRestrito | null>(null);
const numero = ref('');

async function carregar(): Promise<void> {
  erro.value = null;
  try {
    if (props.id) visao.value = await lerAcessoRestrito(Number(props.id));
    else lista.value = await lerRestritos();
  } catch (e) {
    erro.value = e;
  }
}
watch(() => props.id, carregar, { immediate: true });

function abrir(): void {
  if (/^\d{1,15}$/.test(numero.value.trim()))
    void router.push(`/cadastros/pacientes/${numero.value.trim()}/acesso-restrito`);
}

// ── marcar ──
const marcando = ref(false);
const nova = reactive<EntradaMarca>({
  todosEstabelecimentos: false,
  tipo: 'confidencial',
  motivo: '',
  exibicao: 'normal',
  pseudonimo: null,
  exigeQuebraVidro: true,
  inicio: hoje(),
  fim: null,
});
const faltasNova = computed(() => faltasMarca(nova));
async function marcar(): Promise<void> {
  if (!props.id || faltasNova.value.length) return;
  try {
    await marcarPaciente(Number(props.id), { ...nova, fim: nova.fim || null });
    marcando.value = false;
    nova.motivo = '';
    mensagem.value = t('acessoRestrito.gravado');
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}

// ── encerrar ──
const encerrando = ref<number | null>(null);
const motivoEncerrar = ref('');
async function encerrar(m: MarcaVisao): Promise<void> {
  if (motivoEncerrar.value.trim().length < 10) return;
  try {
    await encerrarMarca(m.id, m.versao, motivoEncerrar.value);
    encerrando.value = null;
    motivoEncerrar.value = '';
    mensagem.value = t('acessoRestrito.gravado');
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}

// ── liberar ──
const liberandoEm = ref<number | null>(null);
const busca = ref('');
const destinos = ref<Destinos>({ profissionais: [], equipes: [] });
const destino = ref('');
const lib = reactive<EntradaLiberacao>({
  profissionalId: null,
  equipeId: null,
  justificativa: '',
  inicio: hoje(),
  fim: null,
});
watch(busca, async (b) => {
  if (b.trim().length < 3) return;
  try {
    destinos.value = await buscarDestinos(b.trim());
  } catch (e) {
    erro.value = e;
  }
});
watch(destino, (d) => {
  lib.profissionalId = d.startsWith('p:') ? Number(d.slice(2)) : null;
  lib.equipeId = d.startsWith('e:') ? Number(d.slice(2)) : null;
});
const opcoesDestino = computed(() => [
  ...destinos.value.profissionais.map((x) => ({
    valor: `p:${x.id}`,
    rotulo: `${t('acessoRestrito.profissional')}: ${x.nome}`,
  })),
  ...destinos.value.equipes.map((x) => ({
    valor: `e:${x.id}`,
    rotulo: `${t('acessoRestrito.equipe')}: ${x.nome}`,
  })),
]);
const faltasLib = computed(() => faltasLiberacao(lib));
async function liberar(m: MarcaVisao): Promise<void> {
  if (faltasLib.value.length) return;
  try {
    await liberarDestino(m.id, { ...lib, fim: lib.fim || null });
    liberandoEm.value = null;
    destino.value = '';
    lib.justificativa = '';
    mensagem.value = t('acessoRestrito.gravado');
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
async function revogar(id: number, versao: number): Promise<void> {
  try {
    await revogarLiberacao(id, versao);
    mensagem.value = t('acessoRestrito.gravado');
    await carregar();
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <main data-testid="acesso-restrito">
    <h1>{{ props.id ? t('acessoRestrito.tituloPaciente') : t('acessoRestrito.titulo') }}</h1>
    <p class="sigilo">{{ t('acessoRestrito.sigilo') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>

    <template v-if="!props.id">
      <form class="linha" @submit.prevent="abrir">
        <label
          >{{ t('acessoRestrito.abrirPaciente') }}
          <input v-model="numero" inputmode="numeric" data-testid="ar-numero" />
        </label>
        <button type="submit">{{ t('acessoRestrito.abrir') }}</button>
      </form>
      <p v-if="lista.length === 0">{{ t('acessoRestrito.nenhum') }}</p>
      <table v-else>
        <thead>
          <tr>
            <th scope="col">{{ t('acessoRestrito.paciente') }}</th>
            <th scope="col">{{ t('acessoRestrito.marcas') }}</th>
            <th scope="col">{{ t('acessoRestrito.liberacoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista" :key="x.paciente">
            <td>
              <RouterLink :to="`/cadastros/pacientes/${x.paciente}/acesso-restrito`">{{ x.nome }}</RouterLink>
            </td>
            <td>{{ x.tipos.map((y) => t(`acessoRestrito.tipos.${y}`)).join(', ') }}</td>
            <td>{{ x.liberacoes }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else-if="visao">
      <p data-testid="ar-paciente">
        {{ t('acessoRestrito.paciente') }}: <strong>{{ visao.paciente.nome }}</strong>
        <span v-if="visao.paciente.prontuario">
          · {{ t('acessoRestrito.prontuario') }} {{ visao.paciente.prontuario }}</span
        >
      </p>
      <p v-if="visao.marcas.length === 0">{{ t('acessoRestrito.semMarca') }}</p>

      <section
        v-for="m in visao.marcas"
        :key="m.id"
        class="marca"
        :class="{ inativa: !m.viva }"
        :data-testid="`ar-marca-${m.id}`"
      >
        <h2>
          {{ t(`acessoRestrito.tipos.${m.tipo}`) }} ·
          {{ m.viva ? t('acessoRestrito.viva') : t('acessoRestrito.encerrada') }}
        </h2>
        <p>{{ m.motivo }}</p>
        <p>
          {{ t('acessoRestrito.periodo', { inicio: quando(m.inicio), fim: quando(m.fim) }) }} ·
          {{ t(`acessoRestrito.exibicoes.${m.exibicao}`) }}
          <template v-if="m.pseudonimo"> ({{ m.pseudonimo }})</template>
          <template v-if="m.todosEstabelecimentos"> · {{ t('acessoRestrito.todos') }}</template>
          <template v-if="m.exigeQuebraVidro"> · {{ t('acessoRestrito.quebraVidro') }}</template>
        </p>

        <h3>{{ t('acessoRestrito.liberacoes') }}</h3>
        <p v-if="m.liberacoes.length === 0">{{ t('acessoRestrito.semLiberacao') }}</p>
        <ul v-else>
          <li v-for="l in m.liberacoes" :key="l.id" :data-testid="`ar-liberacao-${l.id}`">
            {{ l.destino }} ·
            {{ t('acessoRestrito.periodo', { inicio: quando(l.inicio), fim: quando(l.fim) }) }} ·
            {{ l.vigente ? t('acessoRestrito.vigente') : t('acessoRestrito.terminada') }} ·
            {{ l.justificativa }}
            <button v-if="podeEditar && l.vigente" type="button" @click="revogar(l.id, l.versao)">
              {{ t('acessoRestrito.revogar') }}
            </button>
          </li>
        </ul>

        <div v-if="podeEditar && m.situacao === 'ativa'" class="linha">
          <button type="button" data-testid="ar-liberar" @click="liberandoEm = m.id">
            {{ t('acessoRestrito.liberar') }}
          </button>
          <button type="button" data-testid="ar-encerrar" @click="encerrando = m.id">
            {{ t('acessoRestrito.encerrar') }}
          </button>
        </div>

        <form
          v-if="liberandoEm === m.id"
          class="ficha"
          data-testid="ar-form-liberar"
          @submit.prevent="liberar(m)"
        >
          <label
            >{{ t('acessoRestrito.buscarDestino') }} <input v-model="busca" data-testid="ar-busca"
          /></label>
          <SanteSelecao v-model="destino" :rotulo="t('acessoRestrito.destino')" :opcoes="opcoesDestino" />
          <label
            >{{ t('acessoRestrito.justificativa') }}
            <textarea v-model="lib.justificativa" maxlength="500" rows="2" data-testid="ar-justificativa" />
          </label>
          <label>{{ t('acessoRestrito.inicio') }} <input v-model="lib.inicio" type="date" /></label>
          <label>{{ t('acessoRestrito.fim') }} <input v-model="lib.fim" type="date" /></label>
          <ul v-if="faltasLib.length" class="pendencias">
            <li v-for="x in faltasLib" :key="x">{{ t(`acessoRestrito.falta.${x}`) }}</li>
          </ul>
          <div class="linha">
            <button type="submit" :disabled="faltasLib.length > 0">{{ t('acessoRestrito.liberar') }}</button>
            <button type="button" @click="liberandoEm = null">{{ t('acessoRestrito.cancelar') }}</button>
          </div>
        </form>

        <form v-if="encerrando === m.id" class="ficha" @submit.prevent="encerrar(m)">
          <label
            >{{ t('acessoRestrito.motivoEncerrar') }}
            <textarea v-model="motivoEncerrar" maxlength="500" rows="2" data-testid="ar-motivo-encerrar" />
          </label>
          <div class="linha">
            <button type="submit" :disabled="motivoEncerrar.trim().length < 10">
              {{ t('acessoRestrito.encerrar') }}
            </button>
            <button type="button" @click="encerrando = null">{{ t('acessoRestrito.cancelar') }}</button>
          </div>
        </form>
      </section>

      <button v-if="podeEditar && !marcando" type="button" data-testid="ar-nova" @click="marcando = true">
        {{ t('acessoRestrito.novaMarca') }}
      </button>
      <form v-if="podeEditar && marcando" class="ficha" data-testid="ar-form-marca" @submit.prevent="marcar">
        <h2>{{ t('acessoRestrito.novaMarca') }}</h2>
        <SanteSelecao
          v-model="nova.tipo"
          :rotulo="t('acessoRestrito.tipo')"
          :opcoes="TIPOS_MARCA.map((x) => ({ valor: x, rotulo: t(`acessoRestrito.tipos.${x}`) }))"
        />
        <label
          >{{ t('acessoRestrito.motivo') }}
          <textarea v-model="nova.motivo" maxlength="500" rows="2" data-testid="ar-motivo" />
        </label>
        <SanteSelecao
          v-model="nova.exibicao"
          :rotulo="t('acessoRestrito.exibicao')"
          :opcoes="EXIBICOES.map((x) => ({ valor: x, rotulo: t(`acessoRestrito.exibicoes.${x}`) }))"
        />
        <label v-if="nova.exibicao === 'pseudonimo'"
          >{{ t('acessoRestrito.pseudonimo') }} <input v-model="nova.pseudonimo" maxlength="150"
        /></label>
        <label
          ><input v-model="nova.todosEstabelecimentos" type="checkbox" />
          {{ t('acessoRestrito.todos') }}</label
        >
        <label
          ><input v-model="nova.exigeQuebraVidro" type="checkbox" />
          {{ t('acessoRestrito.quebraVidro') }}</label
        >
        <label>{{ t('acessoRestrito.inicio') }} <input v-model="nova.inicio" type="date" /></label>
        <label>{{ t('acessoRestrito.fim') }} <input v-model="nova.fim" type="date" /></label>
        <ul v-if="faltasNova.length" class="pendencias">
          <li v-for="x in faltasNova" :key="x">{{ t(`acessoRestrito.falta.${x}`) }}</li>
        </ul>
        <div class="linha">
          <button type="submit" :disabled="faltasNova.length > 0">{{ t('acessoRestrito.marcar') }}</button>
          <button type="button" @click="marcando = false">{{ t('acessoRestrito.cancelar') }}</button>
        </div>
      </form>
    </template>
  </main>
</template>

<style scoped>
.sigilo {
  font-size: 0.9em;
}
.marca {
  border-top: 1px solid var(--sgh-borda);
  padding-top: var(--sgh-espaco-2);
}
.inativa {
  opacity: 0.7;
}
.linha {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.ficha label {
  display: block;
  margin-bottom: var(--sgh-espaco-1);
}
.pendencias {
  color: var(--sgh-alerta);
}
</style>
