<script setup lang="ts">
// Documentos da internação por convênio, especialidade e modalidade (F3.4, 04-INT linha 69):
// `/internacao/documentos`. Numa tela só: os modelos (texto, faixa de idade e especialidade), as regras de cada modelo
// (o que fica vazio vale para todos; a mais específica vence) e a prévia de uma internação, que mostra na hora quais
// documentos sairão. A validação aparece ao lado do campo antes de gravar; nada se apaga: o modelo e a regra saem de
// uso e podem voltar.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerApoioInternacao, novaChave } from '../api-adt.js';
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
const MOMENTOS = ['admissao', 'prorrogacao', 'transferencia', 'alta'] as const;
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);

const vazioModelo = () => ({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  codigo: '',
  titulo: '',
  conteudo: '',
  especialidade: null as number | null,
  idadeMinima: null as number | null,
  idadeMaxima: null as number | null,
  copias: 1,
  todosEstabelecimentos: false,
  ativo: true,
});
const modelo = reactive(vazioModelo());
const problemasModelo = computed(() => {
  const p: Record<string, string> = {};
  if (!modelo.codigo.trim()) p['codigo'] = t('adt.documentos.obrigatorio');
  if (!modelo.titulo.trim()) p['titulo'] = t('adt.documentos.obrigatorio');
  if (!modelo.conteudo.trim()) p['conteudo'] = t('adt.documentos.obrigatorio');
  if (modelo.idadeMinima !== null && modelo.idadeMaxima !== null && modelo.idadeMaxima < modelo.idadeMinima)
    p['idadeMaxima'] = t('adt.documentos.idadeInvertida');
  if (modelo.copias < 1 || modelo.copias > 20) p['copias'] = t('adt.documentos.copiasFaixa');
  return p;
});

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
  const p: Record<string, string> = {};
  if (!regra.modelo) p['modelo'] = t('adt.documentos.obrigatorio');
  if (regra.copias < 1 || regra.copias > 20) p['copias'] = t('adt.documentos.copiasFaixa');
  return p;
});

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
    especialidade: m.especialidade,
    idadeMinima: m.idadeMinima,
    idadeMaxima: m.idadeMaxima,
    copias: m.copias,
    todosEstabelecimentos: m.todosEstabelecimentos,
    ativo: m.ativo,
  });
const editarRegra = (r: RegraDoc) => Object.assign(regra, { ...r });
const alternarRegra = (r: RegraDoc) =>
  gravar(
    () => salvarRegraDoc({ ...r, ativo: !r.ativo }, novaChave('doc-regra-ativo')),
    () => undefined,
  );

const reg = ref<number | null>(null);
const momentoPrevia = ref('admissao');
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
        <label for="doc-reg">{{ t('adt.documentos.internacao') }}</label>
        <input
          id="doc-reg"
          type="number"
          min="1"
          data-testid="doc-reg"
          @change="reg = numero(($event.target as HTMLInputElement).value)"
        />
        <label for="doc-momento-previa">{{ t('adt.documentos.momento') }}</label>
        <select id="doc-momento-previa" v-model="momentoPrevia">
          <option v-for="m in MOMENTOS" :key="m" :value="m">{{ t(`adt.documentos.momentos.${m}`) }}</option>
        </select>
        <ErroAdt v-if="previa.isError.value" :erro="previa.error.value" />
        <ul v-else-if="previa.data.value" class="lista-simples" data-testid="doc-previa-lista">
          <li v-if="previa.data.value.documentos.length === 0">{{ t('adt.documentos.nenhumSai') }}</li>
          <li v-for="d in previa.data.value.documentos" :key="d.modelo">
            {{ d.titulo }} ({{ t('adt.impressos.copias') }}: {{ d.copias }})
            <strong v-if="d.obrigatorio">{{ t('adt.documentos.obrigatorioDoc') }}</strong>
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
            <SanteBotao variante="texto" :rotulo="t('adt.documentos.editar')" @acionar="editarModelo(m)" />
          </li>
        </ul>
        <form class="grade-form" data-testid="doc-form-modelo" @submit.prevent="gravarModelo">
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
          <label for="doc-esp-modelo">{{ t('adt.documentos.especialidade') }}</label>
          <select id="doc-esp-modelo" v-model="modelo.especialidade">
            <option :value="null">{{ t('adt.documentos.todos') }}</option>
            <option v-for="e in apoio.data.value?.especialidades ?? []" :key="e.codigo" :value="e.codigo">
              {{ e.nome }}
            </option>
          </select>
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
          <label
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
            <SanteBotao variante="texto" :rotulo="t('adt.documentos.editar')" @acionar="editarRegra(r)" />
            <SanteBotao
              variante="secundario"
              :rotulo="r.ativo ? t('adt.documentos.tirarDeUso') : t('adt.documentos.voltarAoUso')"
              @acionar="alternarRegra(r)"
            />
          </li>
        </ul>
        <form class="grade-form" data-testid="doc-form-regra" @submit.prevent="gravarRegra">
          <label for="doc-regra-modelo">{{ t('adt.documentos.modelo') }}</label>
          <select
            id="doc-regra-modelo"
            v-model.number="regra.modelo"
            :aria-invalid="!!problemasRegra['modelo']"
          >
            <option :value="0" disabled>{{ t('adt.documentos.escolha') }}</option>
            <option v-for="m in config.data.value.modelos.filter((x) => x.ativo)" :key="m.id" :value="m.id">
              {{ m.titulo }}
            </option>
          </select>
          <label for="doc-regra-momento">{{ t('adt.documentos.momento') }}</label>
          <select id="doc-regra-momento" v-model="regra.momento">
            <option v-for="m in MOMENTOS" :key="m" :value="m">{{ t(`adt.documentos.momentos.${m}`) }}</option>
          </select>
          <label for="doc-regra-convenio">{{ t('adt.documentos.convenio') }}</label>
          <select id="doc-regra-convenio" v-model="regra.convenio">
            <option :value="null">{{ t('adt.documentos.todos') }}</option>
            <option v-for="c in apoio.data.value?.convenios ?? []" :key="c.codigo" :value="c.codigo">
              {{ c.nome }}
            </option>
          </select>
          <label for="doc-regra-esp">{{ t('adt.documentos.especialidade') }}</label>
          <select id="doc-regra-esp" v-model="regra.especialidade">
            <option :value="null">{{ t('adt.documentos.todos') }}</option>
            <option v-for="e in apoio.data.value?.especialidades ?? []" :key="e.codigo" :value="e.codigo">
              {{ e.nome }}
            </option>
          </select>
          <label for="doc-regra-modalidade">{{ t('adt.documentos.modalidade') }}</label>
          <select id="doc-regra-modalidade" v-model="regra.modalidade">
            <option :value="null">{{ t('adt.documentos.todos') }}</option>
            <option v-for="mo in config.data.value.modalidades" :key="mo.codigo" :value="mo.codigo">
              {{ mo.nome }}
            </option>
          </select>
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
