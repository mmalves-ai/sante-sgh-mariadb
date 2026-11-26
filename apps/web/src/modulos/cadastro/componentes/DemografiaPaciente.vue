<script setup lang="ts">
// Dados demográficos do paciente na própria ficha (F3.1, 02-CAD linha 15): nome social, identidade de gênero, raça/cor
// e povo indígena, escolaridade, ocupação, religião, nacionalidade, país de nascimento, capacidade civil e as
// condições de vulnerabilidade. Um bloco só, gravado de uma vez; a validação na hora mostra o que falta (nome social
// usado sem o nome, raça/cor indígena sem o povo, capacidade que exige responsável sem responsável vigente) e o botão
// só libera sem pendência. O povo indígena só aparece com a raça/cor que o exige. A vulnerabilidade é declarada com
// data e informante e encerrada com data; nada é apagado. O servidor confere tudo de novo (regra no domínio).
// Cadastro nacional (09-AREA linha 73): orientação sexual (opcional, com 'não quis declarar'), situação familiar, língua
// indígena (opcional, só com a raça/cor indígena, junto do povo) e as doenças crônicas referidas (CondicoesCronicas).
import { SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import CondicoesCronicasPaciente from './CondicoesCronicasPaciente.vue';
import {
  buscarOcupacoes,
  CAMPOS_OPCAO,
  type CampoOpcao,
  declararVulnerabilidade,
  type Demografia,
  encerrarVulnerabilidade,
  exigeEtnia,
  gravarDemografia,
  type GravacaoDemografia,
  lerDemografia,
  pendenciasDemografia,
  type Vulnerabilidade,
} from '../api-demografia.js';
import { dataBr } from '../formato.js';

const props = defineProps<{ idPaciente: number; podeEditar: boolean }>();
const { t } = useI18n();

const dados = ref<Demografia | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref('');
const editando = ref(false);

type Formulario = Record<CampoOpcao, number> & { usaNomeSocial: boolean; nomeSocial: string };
const vazio = (): Formulario => ({
  usaNomeSocial: false,
  nomeSocial: '',
  identidadeGenero: 0,
  racaCor: 0,
  povoIndigena: 0,
  escolaridade: 0,
  religiao: 0,
  nacionalidade: 0,
  paisNascimento: 0,
  capacidadeCivil: 0,
  orientacaoSexual: 0,
  situacaoFamiliar: 0,
  idiomaIndigena: 0,
});
const form = ref<Formulario>(vazio());
const ocupacao = ref<{ id: number; descricao: string } | null>(null);
const termoOcupacao = ref('');
const achadas = ref<{ id: number; descricao: string }[] | null>(null);

/** Os campos de escolha fora o povo indígena (que depende da raça/cor e tem lugar próprio na tela). */
const CAMPOS_SIMPLES = CAMPOS_OPCAO.filter(
  (c) => c !== 'povoIndigena' && c !== 'racaCor' && c !== 'idiomaIndigena' && c !== 'orientacaoSexual',
);
/** Sem a permissão de ver dado sensível (LGPD art. 5º II), a religião não vem do servidor e não aparece. */
const camposSimples = computed(() =>
  dados.value?.sensivelRestrito ? CAMPOS_SIMPLES.filter((c) => c !== 'religiao') : CAMPOS_SIMPLES,
);

const pedeEtnia = computed(() => (dados.value ? exigeEtnia(form.value.racaCor || null, dados.value) : false));
const gravacao = computed<GravacaoDemografia>(() => {
  const f = form.value;
  const id = (c: CampoOpcao) => f[c] || null;
  return {
    usaNomeSocial: f.usaNomeSocial,
    nomeSocial: f.nomeSocial.trim() || null,
    identidadeGenero: id('identidadeGenero'),
    racaCor: id('racaCor'),
    // O povo indígena só vale com a raça/cor que o exige: trocar a raça/cor tira o povo do pedido.
    povoIndigena: pedeEtnia.value ? id('povoIndigena') : null,
    escolaridade: id('escolaridade'),
    religiao: id('religiao'),
    nacionalidade: id('nacionalidade'),
    paisNascimento: id('paisNascimento'),
    capacidadeCivil: id('capacidadeCivil'),
    orientacaoSexual: id('orientacaoSexual'),
    situacaoFamiliar: id('situacaoFamiliar'),
    // A língua indígena também só vale com a raça/cor que exige a etnia (opcional nela).
    idiomaIndigena: pedeEtnia.value ? id('idiomaIndigena') : null,
    ocupacao: ocupacao.value?.id ?? null,
  };
});
const pendencias = computed(() => (dados.value ? pendenciasDemografia(gravacao.value, dados.value) : []));
const sugereNomeSocial = computed(
  () =>
    !form.value.usaNomeSocial &&
    dados.value?.opcoes.identidadeGenero.find((o) => o.id === form.value.identidadeGenero)?.marca === true,
);
const descricao = (campo: CampoOpcao): string => {
  const d = dados.value;
  if (!d) return '';
  return d.opcoes[campo].find((o) => o.id === d[campo])?.descricao ?? t('demografia.naoInformado');
};
const opcoesDe = (campo: CampoOpcao) => [
  { valor: 0, rotulo: t('demografia.naoInformado') },
  ...(dados.value?.opcoes[campo] ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
];

function preencher(d: Demografia): void {
  const f = vazio();
  f.usaNomeSocial = d.usaNomeSocial;
  f.nomeSocial = d.nomeSocial ?? '';
  for (const c of CAMPOS_OPCAO) f[c] = d[c] ?? 0;
  form.value = f;
  ocupacao.value = d.ocupacao;
  termoOcupacao.value = '';
  achadas.value = null;
}

async function carregar(): Promise<void> {
  try {
    dados.value = await lerDemografia(props.idPaciente);
    preencher(dados.value);
  } catch (e) {
    erro.value = e;
  }
}
watch(() => props.idPaciente, carregar, { immediate: true });

function abrirEdicao(): void {
  if (dados.value) preencher(dados.value);
  mensagem.value = '';
  erro.value = null;
  editando.value = true;
}

async function gravar(): Promise<void> {
  if (pendencias.value.length > 0) return;
  mensagem.value = '';
  erro.value = null;
  try {
    await gravarDemografia(props.idPaciente, gravacao.value);
    editando.value = false;
    await carregar();
    mensagem.value = t('demografia.gravado');
  } catch (e) {
    erro.value = e;
  }
}

// Busca da ocupação: a partir de 3 letras, com espera curta para não ir ao servidor a cada tecla.
let espera: ReturnType<typeof setTimeout> | null = null;
watch(termoOcupacao, (termo) => {
  if (espera) clearTimeout(espera);
  if (termo.trim().length < 3) {
    achadas.value = null;
    return;
  }
  espera = setTimeout(() => {
    void buscarOcupacoes(termo.trim())
      .then((r) => {
        if (termoOcupacao.value === termo) achadas.value = r.itens;
      })
      .catch((e: unknown) => {
        erro.value = e;
      });
  }, 250);
});
function escolherOcupacao(o: { id: number; descricao: string }): void {
  ocupacao.value = o;
  termoOcupacao.value = '';
  achadas.value = null;
}

// ── Vulnerabilidades ──
const nova = ref({ condicao: 0, declaradaEm: '', informanteTipo: 'paciente', informanteNome: '' });
const fins = ref<Record<number, string>>({});
const INFORMANTES_COM_NOME = ['responsavel', 'familiar', 'outro'];
const pedeNomeInformante = computed(() => INFORMANTES_COM_NOME.includes(nova.value.informanteTipo));
const jaVigente = computed(
  () =>
    dados.value?.vulnerabilidades.some((v) => v.vigente && v.condicao.id === nova.value.condicao) ?? false,
);
const pendenciasVulnerabilidade = computed(() => {
  const r: string[] = [];
  if (jaVigente.value) r.push(t('demografia.vulnerabilidade.jaVigente'));
  if (pedeNomeInformante.value && nova.value.informanteNome.trim().length < 3)
    r.push(t('demografia.vulnerabilidade.faltaNome'));
  return r;
});
const podeDeclarar = computed(
  () =>
    nova.value.condicao > 0 && nova.value.declaradaEm !== '' && pendenciasVulnerabilidade.value.length === 0,
);

async function declarar(): Promise<void> {
  if (!podeDeclarar.value) return;
  mensagem.value = '';
  erro.value = null;
  try {
    await declararVulnerabilidade(props.idPaciente, {
      condicao: nova.value.condicao,
      declaradaEm: nova.value.declaradaEm,
      informanteTipo: nova.value.informanteTipo,
      informanteNome: pedeNomeInformante.value ? nova.value.informanteNome.trim() : null,
    });
    nova.value = { condicao: 0, declaradaEm: '', informanteTipo: 'paciente', informanteNome: '' };
    await carregar();
    mensagem.value = t('demografia.vulnerabilidade.declarada');
  } catch (e) {
    erro.value = e;
  }
}

async function cronicaAlterada(m: string): Promise<void> {
  erro.value = null;
  await carregar();
  mensagem.value = m;
}

async function encerrar(v: Vulnerabilidade): Promise<void> {
  const fim = fins.value[v.id] ?? '';
  if (!fim) return;
  mensagem.value = '';
  erro.value = null;
  try {
    await encerrarVulnerabilidade(props.idPaciente, v.id, fim);
    await carregar();
    mensagem.value = t('demografia.vulnerabilidade.encerradaMsg');
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section aria-labelledby="sec-demografia" data-testid="demografia-paciente">
    <h2 id="sec-demografia">{{ t('demografia.titulo') }}</h2>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <template v-if="dados">
      <!-- ── leitura ── -->
      <template v-if="!editando">
        <dl data-testid="demografia-leitura">
          <dt>{{ t('demografia.nomeSocial') }}</dt>
          <dd>
            {{ dados.nomeSocial ?? t('demografia.naoInformado') }}
            <template v-if="dados.nomeSocial && !dados.usaNomeSocial">
              {{ t('demografia.nomeSocialSemUso') }}</template
            >
          </dd>
          <template v-if="dados.sensivelRestrito">
            <dt>{{ t('demografia.sensivel.titulo') }}</dt>
            <dd data-testid="demografia-sensivel-restrito">{{ t('demografia.sensivel.restrito') }}</dd>
          </template>
          <template v-else>
            <dt>{{ t('demografia.campos.racaCor') }}</dt>
            <dd>{{ descricao('racaCor') }}</dd>
            <template v-if="dados.povoIndigena">
              <dt>{{ t('demografia.campos.povoIndigena') }}</dt>
              <dd>{{ descricao('povoIndigena') }}</dd>
            </template>
            <template v-if="dados.idiomaIndigena">
              <dt>{{ t('demografia.campos.idiomaIndigena') }}</dt>
              <dd>{{ descricao('idiomaIndigena') }}</dd>
            </template>
            <dt>{{ t('demografia.campos.orientacaoSexual') }}</dt>
            <dd>{{ descricao('orientacaoSexual') }}</dd>
          </template>
          <template v-for="c in camposSimples" :key="c">
            <dt>{{ t(`demografia.campos.${c}`) }}</dt>
            <dd>{{ descricao(c) }}</dd>
          </template>
          <dt>{{ t('demografia.ocupacao') }}</dt>
          <dd>{{ dados.ocupacao?.descricao ?? t('demografia.naoInformado') }}</dd>
        </dl>
        <button v-if="podeEditar" type="button" data-testid="editar-demografia" @click="abrirEdicao">
          {{ t('demografia.editar') }}
        </button>
      </template>

      <!-- ── edição: o bloco inteiro de uma vez ── -->
      <form v-else class="bloco" data-testid="form-demografia" @submit.prevent="gravar">
        <label
          ><input v-model="form.usaNomeSocial" type="checkbox" /> {{ t('demografia.usaNomeSocial') }}</label
        >
        <label
          >{{ t('demografia.nomeSocial') }}
          <input v-model="form.nomeSocial" maxlength="150" :aria-required="form.usaNomeSocial"
        /></label>
        <SanteSelecao
          v-model="form.identidadeGenero"
          :rotulo="t('demografia.campos.identidadeGenero')"
          :opcoes="opcoesDe('identidadeGenero')"
        />
        <p v-if="dados.sensivelRestrito" class="ajuda" data-testid="demografia-sensivel-mantido">
          {{ t('demografia.sensivel.mantido') }}
        </p>
        <template v-else>
          <SanteSelecao
            v-model="form.racaCor"
            :rotulo="t('demografia.campos.racaCor')"
            :opcoes="opcoesDe('racaCor')"
          />
          <template v-if="pedeEtnia">
            <SanteSelecao
              v-model="form.povoIndigena"
              :rotulo="t('demografia.campos.povoIndigena')"
              obrigatorio
              :opcoes="opcoesDe('povoIndigena')"
            />
            <p v-if="dados.opcoes.povoIndigena.length === 0" class="ajuda">{{ t('demografia.semPovos') }}</p>
            <SanteSelecao
              v-model="form.idiomaIndigena"
              :rotulo="t('demografia.campos.idiomaIndigena')"
              :opcoes="opcoesDe('idiomaIndigena')"
            />
            <p v-if="dados.opcoes.idiomaIndigena.length === 0" class="ajuda">
              {{ t('demografia.semIdiomas') }}
            </p>
          </template>
          <SanteSelecao
            v-model="form.orientacaoSexual"
            :rotulo="t('demografia.campos.orientacaoSexual')"
            :opcoes="opcoesDe('orientacaoSexual')"
          />
          <p class="ajuda">{{ t('demografia.orientacaoAjuda') }}</p>
        </template>
        <SanteSelecao
          v-for="c in camposSimples.filter((x) => x !== 'identidadeGenero')"
          :key="c"
          v-model="form[c]"
          :rotulo="t(`demografia.campos.${c}`)"
          :opcoes="opcoesDe(c)"
        />
        <div class="ocupacao" data-testid="ocupacao-paciente">
          <p>
            {{ t('demografia.ocupacao') }}:
            <strong>{{ ocupacao?.descricao ?? t('demografia.naoInformado') }}</strong>
            <button v-if="ocupacao" type="button" @click="ocupacao = null">
              {{ t('demografia.retirarOcupacao') }}
            </button>
          </p>
          <label
            >{{ t('demografia.buscarOcupacao') }} <input v-model="termoOcupacao" maxlength="60" type="search"
          /></label>
          <p v-if="termoOcupacao && termoOcupacao.trim().length < 3" class="ajuda">
            {{ t('demografia.ocupacaoAjuda') }}
          </p>
          <p v-else-if="achadas && achadas.length === 0" class="ajuda">
            {{ t('demografia.ocupacaoNenhuma') }}
          </p>
          <ul v-else-if="achadas" class="achadas">
            <li v-for="o in achadas" :key="o.id">
              <button type="button" @click="escolherOcupacao(o)">{{ o.descricao }}</button>
            </li>
          </ul>
        </div>
        <p v-if="sugereNomeSocial" class="ajuda">{{ t('demografia.sugereNomeSocial') }}</p>
        <ul v-if="pendencias.length" class="pendencias" data-testid="pendencias-demografia">
          <li v-for="p in pendencias" :key="p">{{ t(`demografia.pendencias.${p}`) }}</li>
        </ul>
        <div class="acoes">
          <button type="submit" :disabled="pendencias.length > 0">{{ t('demografia.gravar') }}</button>
          <button type="button" @click="editando = false">{{ t('demografia.cancelar') }}</button>
        </div>
      </form>

      <p v-if="dados.sensivelRestrito" data-testid="declaracoes-sensiveis-restritas">
        {{ t('demografia.sensivel.declaracoes') }}
      </p>
      <template v-else>
        <!-- ── vulnerabilidades: vigentes primeiro, encerradas no histórico ── -->
        <h3 id="sec-vulnerabilidade">{{ t('demografia.vulnerabilidade.titulo') }}</h3>
        <p v-if="dados.vulnerabilidades.length === 0">{{ t('demografia.vulnerabilidade.nenhuma') }}</p>
        <table v-else data-testid="vulnerabilidades-paciente">
          <caption>
            {{
              t('demografia.vulnerabilidade.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('demografia.vulnerabilidade.condicao') }}</th>
              <th scope="col">{{ t('demografia.vulnerabilidade.declaradaEm') }}</th>
              <th scope="col">{{ t('demografia.vulnerabilidade.informante') }}</th>
              <th scope="col">{{ t('demografia.vulnerabilidade.situacao') }}</th>
              <th v-if="podeEditar" scope="col">{{ t('demografia.vulnerabilidade.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="v in dados.vulnerabilidades"
              :key="v.id"
              :data-situacao="v.vigente ? 'vigente' : 'encerrada'"
            >
              <td>{{ v.condicao.descricao }}</td>
              <td>{{ dataBr(v.declaradaEm) }}</td>
              <td>
                {{ t(`demografia.vulnerabilidade.informantes.${v.informanteTipo}`) }}
                <template v-if="v.informanteNome">({{ v.informanteNome }})</template>
              </td>
              <td>
                {{
                  v.vigente
                    ? t('demografia.vulnerabilidade.vigente')
                    : `${t('demografia.vulnerabilidade.encerrada')} ${dataBr(v.fim)}`
                }}
              </td>
              <td v-if="podeEditar">
                <template v-if="v.vigente">
                  <label
                    >{{ t('demografia.vulnerabilidade.dataFim') }}
                    <input v-model="fins[v.id]" type="date" :min="v.declaradaEm" :max="dados.hoje"
                  /></label>
                  <button type="button" :disabled="!fins[v.id]" @click="encerrar(v)">
                    {{ t('demografia.vulnerabilidade.encerrar') }}
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="podeEditar && dados.opcoes.condicoesVulnerabilidade.length > 0"
          class="bloco"
          data-testid="nova-vulnerabilidade"
          @submit.prevent="declarar"
        >
          <SanteSelecao
            v-model="nova.condicao"
            :rotulo="t('demografia.vulnerabilidade.condicao')"
            obrigatorio
            :opcoes="[
              { valor: 0, rotulo: t('demografia.naoInformado'), desabilitada: true },
              ...dados.opcoes.condicoesVulnerabilidade.map((o) => ({ valor: o.id, rotulo: o.descricao })),
            ]"
          />
          <label
            >{{ t('demografia.vulnerabilidade.declaradaEm') }}
            <input v-model="nova.declaradaEm" type="date" :max="dados.hoje" required
          /></label>
          <SanteSelecao
            v-model="nova.informanteTipo"
            :rotulo="t('demografia.vulnerabilidade.informante')"
            :opcoes="
              dados.opcoes.informantes.map((i) => ({
                valor: i,
                rotulo: t(`demografia.vulnerabilidade.informantes.${i}`),
              }))
            "
          />
          <label v-if="pedeNomeInformante"
            >{{ t('demografia.vulnerabilidade.informanteNome') }}
            <input v-model="nova.informanteNome" maxlength="150"
          /></label>
          <ul v-if="pendenciasVulnerabilidade.length && nova.condicao" class="pendencias">
            <li v-for="p in pendenciasVulnerabilidade" :key="p">{{ p }}</li>
          </ul>
          <button type="submit" :disabled="!podeDeclarar">
            {{ t('demografia.vulnerabilidade.declarar') }}
          </button>
        </form>

        <!-- ── doenças crônicas referidas: mesma forma, lista própria ── -->
        <CondicoesCronicasPaciente
          :id-paciente="idPaciente"
          :pode-editar="podeEditar"
          :dados="dados"
          @alterado="cronicaAlterada"
          @erro="(e) => (erro = e)"
        />
      </template>
    </template>
  </section>
</template>

<style scoped>
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
dd {
  margin: 0;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.bloco {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin-top: var(--sgh-espaco-2);
}
.ocupacao,
.pendencias,
.acoes,
.ajuda {
  flex-basis: 100%;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.achadas {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.pendencias {
  color: var(--sgh-texto);
  margin: 0;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
