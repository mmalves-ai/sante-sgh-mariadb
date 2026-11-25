<script setup lang="ts">
// Documentos da internação por convênio, especialidade e modalidade (F3.4, 04-INT linha 69):
// `/internacao/documentos`. Numa tela só: os modelos (texto, faixa de idade e especialidade), as regras de cada modelo
// (o que fica vazio vale para todos; a mais específica vence) e a prévia de uma internação, que mostra na hora quais
// documentos sairão. A validação aparece ao lado do campo antes de gravar; nada se apaga: o modelo e a regra saem de
// uso e podem voltar. A validação é a do domínio (a mesma da API). Sem config.parametro.editar a tela fica só para
// leitura; o modelo comum a todos os estabelecimentos só é mexido pela administração da plataforma (os outros o copiam).
// A prévia abre com a internação já escolhida quando vem da tela de impressos (`?reg=`).
import {
  MARCADORES_DOCUMENTO_INTERNACAO,
  MOMENTOS_DOCUMENTO_INTERNACAO,
  MOMENTOS_MODELO_DOCUMENTO,
  validarModeloDocumento,
  validarRegraDocumento,
} from '@sgh/dominio-internacao';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { lerApoioInternacao, listarInternacoes, novaChave } from '../api-adt.js';
import {
  lerConfiguracaoDocumentos,
  lerDocumentosDaInternacao,
  type ModeloDoc,
  type RegraDoc,
  salvarModeloDoc,
  salvarRegraDoc,
} from '../api-documentos-internacao.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const fila = useQueryClient();
const config = useQuery({ queryKey: ['adt', 'documentos'], queryFn: lerConfiguracaoDocumentos });
const apoio = useQuery({ queryKey: ['adt', 'apoio', 'internacoes'], queryFn: () => lerApoioInternacao() });
const MOMENTOS = MOMENTOS_DOCUMENTO_INTERNACAO;
const MARCADORES = MARCADORES_DOCUMENTO_INTERNACAO.map((m) => `{${m}}`).join(' ');
const podeEditar = computed(() => config.data.value?.podeEditar === true);
const podeComum = computed(() => config.data.value?.podeModeloComum === true);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);

const vazioModelo = () => ({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  codigo: '',
  titulo: '',
  conteudo: '',
  momento: 'admissao' as string,
  especialidade: null as number | null,
  idadeMinima: null as number | null,
  idadeMaxima: null as number | null,
  copias: 1,
  todosEstabelecimentos: false,
  ativo: true,
});
const modelo = reactive(vazioModelo());
const porCampo = (lista: readonly { campo: string; mensagem: string }[]) => {
  const p: Record<string, string> = {};
  for (const x of lista) p[x.campo] = p[x.campo] ? `${p[x.campo]} ${x.mensagem}` : x.mensagem;
  return p;
};
const problemasModelo = computed(() => porCampo(validarModeloDocumento(modelo)));

const vazioRegra = () => ({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  modelo: 0,
  momento: 'admissao' as string,
  convenio: null as number | null,
  especialidade: null as number | null,
  modalidade: null as number | null,
  obrigatorio: false,
  selecionadoPorPadrao: true,
  copias: 1,
  ordem: 0,
  ativo: true,
});
const regra = reactive(vazioRegra());
const problemasRegra = computed(() => {
  const p = porCampo(validarRegraDocumento(regra));
  if (!regra.modelo) p['modelo'] = t('adt.documentos.obrigatorio');
  return p;
});
// Regra nova: o momento e as cópias do modelo escolhido vêm preenchidos (o padrão do modelo).
watch(
  () => regra.modelo,
  (id) => {
    const m = config.data.value?.modelos.find((x) => x.id === id);
    if (!m || regra.id !== undefined) return;
    regra.momento = (MOMENTOS as readonly string[]).includes(m.momento) ? m.momento : 'admissao';
    regra.copias = m.copias;
  },
);

const nome = (lista: { codigo: number; nome: string }[] | undefined, id: number | null) =>
  id === null ? t('adt.documentos.todos') : (lista?.find((x) => x.codigo === id)?.nome ?? String(id));
const tituloModelo = (id: number) =>
  config.data.value?.modelos.find((m) => m.id === id)?.titulo ?? String(id);

async function gravar(fn: () => Promise<unknown>, depois: () => void): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    await fn();
    depois();
    aviso.value = t('adt.documentos.gravado');
    await fila.invalidateQueries({ queryKey: ['adt', 'documentos'] });
  } catch (x) {
    erro.value = x;
  }
}
const gravarModelo = () =>
  gravar(
    () => salvarModeloDoc({ ...modelo }, novaChave('doc-modelo')),
    () => Object.assign(modelo, vazioModelo()),
  );
const gravarRegra = () =>
  gravar(
    () => salvarRegraDoc({ ...regra }, novaChave('doc-regra')),
    () => Object.assign(regra, vazioRegra()),
  );
const editarModelo = (m: ModeloDoc) =>
  Object.assign(modelo, {
    id: m.id,
    versao: m.versao,
    codigo: m.codigo,
    titulo: m.titulo,
    conteudo: m.conteudo,
    momento: m.momento,
    especialidade: m.especialidade,
    idadeMinima: m.idadeMinima,
    idadeMaxima: m.idadeMaxima,
    copias: m.copias,
    todosEstabelecimentos: m.todosEstabelecimentos,
    ativo: m.ativo,
  });
// O modelo comum, para quem não é da plataforma: vira a base de um modelo deste estabelecimento.
const copiarModelo = (m: ModeloDoc) => {
  editarModelo(m);
  Object.assign(modelo, { id: undefined, versao: undefined, codigo: '', todosEstabelecimentos: false });
};
const editarRegra = (r: RegraDoc) => Object.assign(regra, { ...r });
const alternarRegra = (r: RegraDoc) =>
  gravar(
    () => salvarRegraDoc({ ...r, ativo: !r.ativo }, novaChave('doc-regra-ativo')),
    () => undefined,
  );

const rota = useRoute();
const regDaRota = Number(rota.query['reg']);
const reg = ref<number | null>(Number.isInteger(regDaRota) && regDaRota > 0 ? regDaRota : null);
const momentoPrevia = ref('admissao');
// Opções dos combos (SanteSelecao): o vazio (null) é "todos"; o modelo da regra começa em 0, sem escolha.
const todos = computed(() => ({ valor: null, rotulo: t('adt.documentos.todos') }));
const opMomentos = computed(() =>
  MOMENTOS.map((m) => ({ valor: m as string, rotulo: t(`adt.documentos.momentos.${m}`) })),
);
const opMomentosModelo = computed(() =>
  MOMENTOS_MODELO_DOCUMENTO.map((m) => ({ valor: m as string, rotulo: t(`adt.documentos.momentos.${m}`) })),
);
const opEspecialidades = computed(() => [
  todos.value,
  ...(apoio.data.value?.especialidades ?? []).map((e) => ({ valor: e.codigo, rotulo: e.nome })),
]);
const opConvenios = computed(() => [
  todos.value,
  ...(apoio.data.value?.convenios ?? []).map((c) => ({ valor: c.codigo, rotulo: c.nome })),
]);
const opModalidades = computed(() => [
  todos.value,
  ...(config.data.value?.modalidades ?? []).map((m) => ({ valor: m.codigo, rotulo: m.nome })),
]);
const opModelosAtivos = computed(() => [
  { valor: 0, rotulo: t('adt.documentos.escolha'), desabilitada: true },
  ...(config.data.value?.modelos ?? [])
    .filter((x) => x.ativo)
    .map((m) => ({ valor: m.id, rotulo: m.titulo })),
]);

// Visão por paciente: a prévia acha a internação pelo nome ou prontuário (3 letras ou mais), sem decorar o número.
const termoPaciente = ref('');
const termoBuscado = ref('');
const buscarPaciente = () => {
  termoBuscado.value = termoPaciente.value.trim();
};
const pacientes = useQuery({
  queryKey: computed(() => ['adt', 'documentos', 'pacientes', termoBuscado.value]),
  queryFn: () => listarInternacoes({ termo: termoBuscado.value }),
  enabled: computed(() => termoBuscado.value.length >= 3),
});
const escolherInternacao = (r: number) => {
  reg.value = r;
  termoBuscado.value = '';
};

const previa = useQuery({
  queryKey: computed(() => ['adt', 'documentos', 'previa', reg.value, momentoPrevia.value]),
  queryFn: () => lerDocumentosDaInternacao(reg.value!, momentoPrevia.value),
  enabled: computed(() => !!reg.value && reg.value > 0),
});
const numero = (v: string) => (v === '' ? null : Number(v));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="doc-int-titulo" data-testid="tela-documentos-internacao">
    <h1 id="doc-int-titulo">{{ t('adt.documentos.titulo') }}</h1>
    <p>{{ t('adt.documentos.texto') }}</p>
    <ErroAdt v-if="config.isError.value" :erro="config.error.value" />
    <p v-else-if="!config.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <section class="painel" aria-labelledby="doc-previa">
        <h2 id="doc-previa">{{ t('adt.documentos.previa') }}</h2>
        <form class="acoes" role="search" @submit.prevent="buscarPaciente">
          <label for="doc-busca-paciente">{{ t('adt.documentos.buscarPaciente') }}</label>
          <input
            id="doc-busca-paciente"
            v-model="termoPaciente"
            type="search"
            minlength="3"
            autocomplete="off"
            data-testid="doc-busca-paciente"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('adt.documentos.buscar')"
            :desabilitado="termoPaciente.trim().length < 3"
            data-testid="doc-buscar-paciente"
          />
        </form>
        <ErroAdt v-if="pacientes.isError.value" :erro="pacientes.error.value" />
        <ul
          v-else-if="termoBuscado && pacientes.data.value"
          class="lista-simples"
          data-testid="doc-pacientes"
        >
          <li v-if="pacientes.data.value.itens.length === 0">{{ t('adt.documentos.nenhumPaciente') }}</li>
          <li v-for="p in pacientes.data.value.itens" :key="p.reg">
            <SanteBotao
              variante="texto"
              :rotulo="
                t('adt.documentos.pacienteInternado', {
                  nome: p.nome,
                  prontuario: p.prontuario,
                  reg: p.reg,
                  convenio: p.convenio.nome,
                })
              "
              :data-testid="`doc-paciente-${p.reg}`"
              @acionar="escolherInternacao(p.reg)"
            />
          </li>
        </ul>
        <label for="doc-reg">{{ t('adt.documentos.internacao') }}</label>
        <input
          id="doc-reg"
          type="number"
          min="1"
          :value="reg ?? ''"
          data-testid="doc-reg"
          @change="reg = numero(($event.target as HTMLInputElement).value)"
        />
        <SanteSelecao
          v-model="momentoPrevia"
          :rotulo="t('adt.documentos.momento')"
          :opcoes="opMomentos"
          data-testid="doc-momento-previa"
        />
        <ErroAdt v-if="previa.isError.value" :erro="previa.error.value" />
        <ul v-else-if="previa.data.value" class="lista-simples" data-testid="doc-previa-lista">
          <li v-if="previa.data.value.documentos.length === 0">{{ t('adt.documentos.nenhumSai') }}</li>
          <li v-for="d in previa.data.value.documentos" :key="d.modelo">
            {{ d.titulo }} ({{ t('adt.impressos.copias') }}: {{ d.copias }})
            <strong v-if="d.obrigatorio">{{ t('adt.documentos.obrigatorioDoc') }}</strong>
            <em v-if="d.sobDemanda">{{ t('adt.documentos.momentos.sob_demanda') }}</em>
          </li>
        </ul>
      </section>

      <section class="painel" aria-labelledby="doc-modelos">
        <h2 id="doc-modelos">{{ t('adt.documentos.modelos') }}</h2>
        <ul class="lista-simples" data-testid="doc-modelos">
          <li v-for="m in config.data.value.modelos" :key="m.id" class="acoes">
            <span :class="{ secundario: !m.ativo }">
              {{ m.codigo }} · {{ m.titulo }}
              <template v-if="!m.ativo">({{ t('adt.documentos.foraDeUso') }})</template>
            </span>
            <em v-if="m.todosEstabelecimentos">{{ t('adt.documentos.comum') }}</em>
            <template v-if="podeEditar">
              <SanteBotao
                v-if="!m.todosEstabelecimentos || podeComum"
                variante="texto"
                :rotulo="t('adt.documentos.editar')"
                @acionar="editarModelo(m)"
              />
              <SanteBotao
                v-else
                variante="texto"
                :rotulo="t('adt.documentos.copiar')"
                :data-testid="`doc-copiar-${m.id}`"
                @acionar="copiarModelo(m)"
              />
            </template>
          </li>
        </ul>
        <p v-if="!podeEditar" class="secundario" data-testid="doc-somente-leitura">
          {{ t('adt.documentos.somenteLeitura') }}
        </p>
        <form v-else class="grade-form" data-testid="doc-form-modelo" @submit.prevent="gravarModelo">
          <label for="doc-codigo">{{ t('adt.documentos.codigo') }}</label>
          <input
            id="doc-codigo"
            v-model="modelo.codigo"
            maxlength="30"
            :aria-invalid="!!problemasModelo['codigo']"
          />
          <label for="doc-titulo">{{ t('adt.documentos.tituloModelo') }}</label>
          <input
            id="doc-titulo"
            v-model="modelo.titulo"
            maxlength="150"
            :aria-invalid="!!problemasModelo['titulo']"
          />
          <label for="doc-conteudo">{{ t('adt.documentos.conteudo') }}</label>
          <textarea
            id="doc-conteudo"
            v-model="modelo.conteudo"
            rows="5"
            :aria-invalid="!!problemasModelo['conteudo']"
          />
          <p class="secundario">{{ t('adt.documentos.marcadores') }} {{ MARCADORES }}</p>
          <SanteSelecao
            v-model="modelo.momento"
            :rotulo="t('adt.documentos.momentoModelo')"
            :opcoes="opMomentosModelo"
            data-testid="doc-momento-modelo"
          />
          <label for="doc-copias-modelo">{{ t('adt.impressos.copias') }}</label>
          <input
            id="doc-copias-modelo"
            v-model.number="modelo.copias"
            type="number"
            min="1"
            max="20"
            :aria-invalid="!!problemasModelo['copias']"
          />
          <SanteSelecao
            v-model="modelo.especialidade"
            :rotulo="t('adt.documentos.especialidade')"
            :opcoes="opEspecialidades"
            data-testid="doc-esp-modelo"
          />
          <label for="doc-idade-min">{{ t('adt.documentos.idadeMinima') }}</label>
          <input
            id="doc-idade-min"
            type="number"
            min="0"
            max="150"
            :value="modelo.idadeMinima ?? ''"
            @input="modelo.idadeMinima = numero(($event.target as HTMLInputElement).value)"
          />
          <label for="doc-idade-max">{{ t('adt.documentos.idadeMaxima') }}</label>
          <input
            id="doc-idade-max"
            type="number"
            min="0"
            max="150"
            :value="modelo.idadeMaxima ?? ''"
            :aria-invalid="!!problemasModelo['idadeMaxima']"
            @input="modelo.idadeMaxima = numero(($event.target as HTMLInputElement).value)"
          />
          <label v-if="podeComum"
            ><input v-model="modelo.todosEstabelecimentos" type="checkbox" />
            {{ t('adt.documentos.todosEstabelecimentos') }}</label
          >
          <label><input v-model="modelo.ativo" type="checkbox" /> {{ t('adt.documentos.emUso') }}</label>
          <ul
            v-if="Object.keys(problemasModelo).length"
            class="erros"
            role="alert"
            data-testid="doc-problemas-modelo"
          >
            <li v-for="(msg, campo) in problemasModelo" :key="campo">
              {{ t(`adt.documentos.campos.${campo}`) }}: {{ msg }}
            </li>
          </ul>
          <SanteBotao
            tipo="submit"
            :rotulo="t('adt.documentos.gravarModelo')"
            :desabilitado="Object.keys(problemasModelo).length > 0"
            data-testid="doc-gravar-modelo"
          />
        </form>
      </section>

      <section class="painel" aria-labelledby="doc-regras">
        <h2 id="doc-regras">{{ t('adt.documentos.regras') }}</h2>
        <ul class="lista-simples" data-testid="doc-regras">
          <li v-for="r in config.data.value.regras" :key="r.id" class="acoes">
            <span :class="{ secundario: !r.ativo }">
              {{ tituloModelo(r.modelo) }} · {{ t(`adt.documentos.momentos.${r.momento}`) }} ·
              {{ nome(apoio.data.value?.convenios, r.convenio) }} ·
              {{ nome(apoio.data.value?.especialidades, r.especialidade) }} ·
              {{ nome(config.data.value.modalidades, r.modalidade) }} · {{ t('adt.impressos.copias') }}:
              {{ r.copias }}
              <strong v-if="r.obrigatorio">{{ t('adt.documentos.obrigatorioDoc') }}</strong>
            </span>
            <SanteBotao
              v-if="podeEditar"
              variante="texto"
              :rotulo="t('adt.documentos.editar')"
              @acionar="editarRegra(r)"
            />
            <SanteBotao
              v-if="podeEditar"
              variante="secundario"
              :rotulo="r.ativo ? t('adt.documentos.tirarDeUso') : t('adt.documentos.voltarAoUso')"
              @acionar="alternarRegra(r)"
            />
          </li>
        </ul>
        <form v-if="podeEditar" class="grade-form" data-testid="doc-form-regra" @submit.prevent="gravarRegra">
          <SanteSelecao
            v-model="regra.modelo"
            :rotulo="t('adt.documentos.modelo')"
            :opcoes="opModelosAtivos"
            :aria-invalid="!!problemasRegra['modelo']"
            obrigatorio
            data-testid="doc-regra-modelo"
          />
          <SanteSelecao
            v-model="regra.momento"
            :rotulo="t('adt.documentos.momento')"
            :opcoes="opMomentos"
            :aria-invalid="!!problemasRegra['momento']"
            data-testid="doc-regra-momento"
          />
          <SanteSelecao
            v-model="regra.convenio"
            :rotulo="t('adt.documentos.convenio')"
            :opcoes="opConvenios"
            data-testid="doc-regra-convenio"
          />
          <SanteSelecao
            v-model="regra.especialidade"
            :rotulo="t('adt.documentos.especialidade')"
            :opcoes="opEspecialidades"
            data-testid="doc-regra-esp"
          />
          <SanteSelecao
            v-model="regra.modalidade"
            :rotulo="t('adt.documentos.modalidade')"
            :opcoes="opModalidades"
            data-testid="doc-regra-modalidade"
          />
          <label for="doc-regra-copias">{{ t('adt.impressos.copias') }}</label>
          <input
            id="doc-regra-copias"
            v-model.number="regra.copias"
            type="number"
            min="1"
            max="20"
            :aria-invalid="!!problemasRegra['copias']"
          />
          <label for="doc-regra-ordem">{{ t('adt.documentos.ordem') }}</label>
          <input id="doc-regra-ordem" v-model.number="regra.ordem" type="number" min="0" max="999" />
          <label
            ><input v-model="regra.obrigatorio" type="checkbox" />
            {{ t('adt.documentos.obrigatorioDoc') }}</label
          >
          <label
            ><input v-model="regra.selecionadoPorPadrao" type="checkbox" />
            {{ t('adt.documentos.marcado') }}</label
          >
          <ul
            v-if="Object.keys(problemasRegra).length"
            class="erros"
            role="alert"
            data-testid="doc-problemas-regra"
          >
            <li v-for="(msg, campo) in problemasRegra" :key="campo">
              {{ t(`adt.documentos.campos.${campo}`) }}: {{ msg }}
            </li>
          </ul>
          <SanteBotao
            tipo="submit"
            :rotulo="t('adt.documentos.gravarRegra')"
            :desabilitado="Object.keys(problemasRegra).length > 0"
            data-testid="doc-gravar-regra"
          />
        </form>
      </section>
      <p v-if="aviso" role="status" data-testid="doc-aviso">{{ aviso }}</p>
      <ErroAdt v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
