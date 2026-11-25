<script setup lang="ts">
// Programas de saúde e linhas de cuidado (F8, 02-CAD linha 11): `/cadastros/pacientes/linhas-cuidado`. Uma tela para quem
// coordena o cuidado: o painel de cada programa (em acompanhamento e encerradas, por estado, deste estabelecimento), a
// lista nominal dos inscritos só com cadastro.linhaCuidado.coordenar (o paciente com acesso restrito sai pelo
// pseudônimo, sem ficha aberta daqui) e o catálogo com cadastro.linhaCuidado.editar, com a validação na hora. Inativar
// um programa nunca apaga: as inscrições continuam no histórico dos pacientes. A inscrição é feita na ficha do paciente.
import { SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarPrograma,
  type EntradaPrograma,
  incluirPrograma,
  type Inscrito,
  lerInscritos,
  lerProgramas,
  type OpcoesProgramas,
  type Programa,
} from '../api-linhas-cuidado.js';
import { dataBr } from '../formato.js';
import { ORDEM_TIPOS } from '../linhas-cuidado-tela.js';

const { t } = useI18n();
const podeEditar = computed(() => pode('cadastro.linhaCuidado.editar'));
const podeCoordenar = computed(() => pode('cadastro.linhaCuidado.coordenar'));
const tipo = (x: string) => t(`linhasCuidado.tipos.${x}`);

const opcoes = ref<OpcoesProgramas | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref('');
async function carregar(): Promise<void> {
  try {
    opcoes.value = await lerProgramas();
  } catch (e) {
    erro.value = e;
  }
}
void carregar();

const resumoEstados = (p: Programa) =>
  ORDEM_TIPOS.filter((x) => (p.porEstado[x] ?? 0) > 0)
    .map((x) => `${tipo(x)}: ${p.porEstado[x]}`)
    .join(' · ');

// ── lista nominal ──
const aberto = ref<Programa | null>(null);
const todos = ref(false);
const inscritos = ref<Inscrito[]>([]);
async function verInscritos(p: Programa): Promise<void> {
  aberto.value = p;
  erro.value = null;
  try {
    inscritos.value = (await lerInscritos(p.id, todos.value)).itens;
  } catch (e) {
    erro.value = e;
  }
}

// ── catálogo ──
const vazio = (): EntradaPrograma & { id: number; versao: number; ativo: boolean } => ({
  id: 0,
  versao: 0,
  ativo: true,
  codigo: '',
  descricao: '',
  codigoExterno: null,
  publicoAlvo: null,
  criterioEntrada: null,
  criterioSaida: null,
  faixaEtaria: null,
  exigeReferencia: false,
});
const editando = ref(false);
const f = reactive(vazio());
const faixa = computed({
  get: () => f.faixaEtaria ?? 0,
  set: (v: number) => {
    f.faixaEtaria = v || null;
  },
});
function novo(): void {
  Object.assign(f, vazio());
  editando.value = true;
  mensagem.value = '';
}
function editar(p: Programa): void {
  Object.assign(f, {
    id: p.id,
    versao: p.versao,
    ativo: p.ativo,
    codigo: p.codigo,
    descricao: p.descricao,
    codigoExterno: p.codigoExterno,
    publicoAlvo: p.publicoAlvo,
    criterioEntrada: p.criterioEntrada,
    criterioSaida: p.criterioSaida,
    faixaEtaria: p.faixaEtaria,
    exigeReferencia: p.exigeReferencia,
  });
  editando.value = true;
  mensagem.value = '';
}
const faltas = computed(() => {
  const r: string[] = [];
  if (!f.codigo.trim()) r.push('codigo');
  if (f.descricao.trim().length < 3) r.push('descricao');
  return r;
});
const texto = (x: string | null) => (x ?? '').trim() || null;
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  const e: EntradaPrograma = {
    codigo: f.codigo.trim(),
    descricao: f.descricao.trim(),
    codigoExterno: texto(f.codigoExterno),
    publicoAlvo: texto(f.publicoAlvo),
    criterioEntrada: texto(f.criterioEntrada),
    criterioSaida: texto(f.criterioSaida),
    faixaEtaria: f.faixaEtaria,
    exigeReferencia: f.exigeReferencia,
  };
  try {
    if (f.id) await alterarPrograma(f.id, f.versao, f.ativo, e);
    else await incluirPrograma(e);
    mensagem.value = t('linhasCuidado.gravado');
    editando.value = false;
    await carregar();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela" data-testid="tela-linhas-cuidado" aria-labelledby="lc-titulo">
    <h1 id="lc-titulo">{{ t('linhasCuidado.titulo') }}</h1>
    <p class="sigilo">{{ t('linhasCuidado.sigilo') }}</p>
    <p>
      {{ t('linhasCuidado.pacientesBusca') }}
      <RouterLink to="/cadastros/pacientes">{{ t('linhasCuidado.irBusca') }}</RouterLink>
    </p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>

    <template v-if="opcoes">
      <p v-if="opcoes.linhas.length === 0">{{ t('linhasCuidado.nenhumPrograma') }}</p>
      <table v-else data-testid="lc-painel">
        <caption>
          {{
            t('linhasCuidado.painelLegenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('linhasCuidado.codigo') }}</th>
            <th scope="col">{{ t('linhasCuidado.programa') }}</th>
            <th scope="col">{{ t('linhasCuidado.vivos') }}</th>
            <th scope="col">{{ t('linhasCuidado.encerradas') }}</th>
            <th scope="col">{{ t('linhasCuidado.porEstado') }}</th>
            <th v-if="podeCoordenar || podeEditar" scope="col">
              <span class="so-leitor">{{ t('linhasCuidado.editar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in opcoes.linhas" :key="p.id" :data-programa="p.codigo" :class="{ inativo: !p.ativo }">
            <td>{{ p.codigo }}</td>
            <td>
              {{ p.descricao }} <span v-if="!p.ativo">{{ t('linhasCuidado.inativo') }}</span>
              <small v-if="p.exigeReferencia"><br />{{ t('linhasCuidado.exigeReferencia') }}</small>
            </td>
            <td>{{ p.inscritosVivos }}</td>
            <td>{{ p.encerradas }}</td>
            <td>{{ resumoEstados(p) }}</td>
            <td v-if="podeCoordenar || podeEditar" class="acoes">
              <button v-if="podeCoordenar" type="button" @click="verInscritos(p)">
                {{ t('linhasCuidado.verInscritos') }}
              </button>
              <button v-if="podeEditar" type="button" @click="editar(p)">
                {{ t('linhasCuidado.editar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <section
        v-if="aberto && podeCoordenar"
        data-testid="lc-inscritos"
        aria-labelledby="lc-inscritos-titulo"
      >
        <h2 id="lc-inscritos-titulo">{{ t('linhasCuidado.inscritosDe', { programa: aberto.descricao }) }}</h2>
        <label
          ><input v-model="todos" type="checkbox" @change="verInscritos(aberto)" />
          {{ t('linhasCuidado.incluirEncerradas') }}</label
        >
        <p v-if="inscritos.length === 0">{{ t('linhasCuidado.nenhumInscrito') }}</p>
        <table v-else>
          <caption>
            {{
              t('linhasCuidado.inscritosLegenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('linhasCuidado.paciente') }}</th>
              <th scope="col">{{ t('linhasCuidado.estado') }}</th>
              <th scope="col">{{ t('linhasCuidado.desde') }}</th>
              <th scope="col">{{ t('linhasCuidado.inicio') }}</th>
              <th scope="col">{{ t('linhasCuidado.referencia') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in inscritos" :key="x.inscricao" :data-restrito="x.restrito ? 'sim' : 'nao'">
              <td>
                <template v-if="x.restrito">{{ x.nome }} ({{ t('linhasCuidado.restrito') }})</template>
                <RouterLink v-else :to="`/cadastros/pacientes/${x.paciente}`">{{ x.nome }}</RouterLink>
              </td>
              <td>{{ x.estado }} ({{ tipo(x.tipo) }})</td>
              <td>{{ dataBr(x.estadoDesde) }}</td>
              <td>{{ dataBr(x.vigenciaInicio) }}</td>
              <td>{{ x.referencia ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <button v-if="podeEditar && !editando" type="button" @click="novo">
        {{ t('linhasCuidado.novoPrograma') }}
      </button>
      <form v-if="podeEditar && editando" class="ficha" data-testid="lc-ficha" @submit.prevent="gravar">
        <h2>{{ f.id ? t('linhasCuidado.editarPrograma') : t('linhasCuidado.novoPrograma') }}</h2>
        <label
          >{{ t('linhasCuidado.codigo') }}
          <input v-model="f.codigo" maxlength="30" required :disabled="!!f.id"
        /></label>
        <label
          >{{ t('linhasCuidado.descricao') }} <input v-model="f.descricao" maxlength="150" required
        /></label>
        <label
          >{{ t('linhasCuidado.codigoExterno') }} <input v-model="f.codigoExterno" maxlength="30"
        /></label>
        <label
          >{{ t('linhasCuidado.publicoAlvo') }} <textarea v-model="f.publicoAlvo" maxlength="500" rows="2" />
        </label>
        <label
          >{{ t('linhasCuidado.criterioEntrada') }}
          <textarea v-model="f.criterioEntrada" maxlength="4000" rows="2" />
        </label>
        <label
          >{{ t('linhasCuidado.criterioSaida') }}
          <textarea v-model="f.criterioSaida" maxlength="4000" rows="2" />
        </label>
        <SanteSelecao
          v-model="faixa"
          :rotulo="t('linhasCuidado.faixaEtaria')"
          :opcoes="[
            { valor: 0, rotulo: t('linhasCuidado.semFaixa') },
            ...opcoes.faixas.map((x) => ({ valor: x.id, rotulo: x.descricao })),
          ]"
        />
        <label
          ><input v-model="f.exigeReferencia" type="checkbox" />
          {{ t('linhasCuidado.exigeReferencia') }}</label
        >
        <label v-if="f.id"><input v-model="f.ativo" type="checkbox" /> {{ t('linhasCuidado.ativo') }}</label>
        <ul v-if="faltas.length" class="pendencias">
          <li v-for="x in faltas" :key="x">{{ t(`linhasCuidado.faltaPrograma.${x}`) }}</li>
        </ul>
        <div class="linha">
          <button type="submit" :disabled="faltas.length > 0">{{ t('linhasCuidado.gravar') }}</button>
          <button type="button" @click="editando = false">{{ t('linhasCuidado.cancelar') }}</button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.sigilo {
  font-size: 0.9em;
}
.inativo td {
  text-decoration: line-through;
}
.acoes,
.linha {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.ficha label {
  display: block;
  margin-bottom: var(--sgh-espaco-1);
}
.pendencias {
  color: var(--sgh-alerta);
}
.so-leitor {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
