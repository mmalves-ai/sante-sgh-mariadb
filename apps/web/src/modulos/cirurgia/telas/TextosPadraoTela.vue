<script setup lang="ts">
// Cadastro do texto padrão da descrição cirúrgica (F3.4-3, 04-CC linha 91): `/cirurgia/textos-padrao`. Uma tela só:
// a lista com a situação, o formulário que inclui ou altera (com versão), os campos a preencher detectados na hora
// pela mesma regra do domínio, a validação na hora, tirar de uso e voltar (nada se apaga) e a prévia do preenchimento.
import { camposDoTexto, validarTextoPadrao } from '@sgh/dominio-cirurgia';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarTextoPadrao,
  incluirTextoPadrao,
  lerTextosPadrao,
  preencherTextoPadrao,
  usoTextoPadrao,
  type TextoPadrao,
} from '../api-textos-padrao.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['cirurgia', 'textos-padrao'], queryFn: lerTextosPadrao });

const vazio = () => ({
  id: null as number | null,
  versao: 0,
  titulo: '',
  procedimento: null as number | null,
  cirurgiao: null as number | null,
  textoDescricao: '',
  textoRisco: '',
  textoIntercorrencia: '',
});
const f = reactive(vazio());
const campos = computed(() => camposDoTexto(f.textoDescricao, f.textoRisco, f.textoIntercorrencia));
const problemas = computed(() =>
  validarTextoPadrao({
    titulo: f.titulo,
    textoDescricao: f.textoDescricao,
    textoRisco: f.textoRisco || null,
    textoIntercorrencia: f.textoIntercorrencia || null,
  }).map((p) => p.mensagem),
);
const valores = reactive<Record<string, string>>({});
const previa = ref<{ textoDescricao: string; faltando?: unknown } | null>(null);
const aviso = ref('');
const erro = ref<unknown>(null);

const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    void cliente.invalidateQueries({ queryKey: ['cirurgia', 'textos-padrao'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const corpo = () => ({
  titulo: f.titulo.trim(),
  procedimento: f.procedimento || null,
  cirurgiao: f.cirurgiao || null,
  textoDescricao: f.textoDescricao,
  textoRisco: f.textoRisco || null,
  textoIntercorrencia: f.textoIntercorrencia || null,
});
const salvar = () =>
  acao.mutate(async () => {
    if (f.id) await alterarTextoPadrao(f.id, { ...corpo(), versao: f.versao });
    else await incluirTextoPadrao(corpo());
    Object.assign(f, vazio());
    aviso.value = t('cirurgia.textosPadrao.salvo');
  });
const limpar = () => {
  Object.assign(f, vazio());
  previa.value = null;
};
const editar = (x: TextoPadrao) => {
  Object.assign(f, {
    id: x.id,
    versao: x.versao,
    titulo: x.titulo,
    procedimento: x.procedimento,
    cirurgiao: x.cirurgiao,
    textoDescricao: x.textoDescricao,
    textoRisco: x.textoRisco ?? '',
    textoIntercorrencia: x.textoIntercorrencia ?? '',
  });
  previa.value = null;
};
const alternarUso = (x: TextoPadrao) => acao.mutate(() => usoTextoPadrao(x.id, !x.ativo, x.versao));
const gerarPrevia = () =>
  acao.mutate(async () => {
    previa.value = await preencherTextoPadrao(f.id!, { ...valores });
  });
const faltando = computed(() =>
  Array.isArray(previa.value?.faltando) ? (previa.value.faltando as string[]).join(', ') : '',
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="textos-padrao-titulo" data-testid="tela-textos-padrao">
    <h1 id="textos-padrao-titulo">{{ t('cirurgia.textosPadrao.titulo') }}</h1>
    <p>{{ t('cirurgia.textosPadrao.texto') }}</p>
    <ErroCirurgia v-if="lista.isError.value" :erro="lista.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="textos-padrao-aviso">{{ aviso }}</p>

    <form class="filtros" data-testid="texto-padrao-form" @submit.prevent="salvar">
      <label
        >{{ t('cirurgia.textosPadrao.tituloCampo') }}
        <input v-model="f.titulo" maxlength="150" required data-testid="texto-titulo"
      /></label>
      <label
        >{{ t('cirurgia.textosPadrao.procedimento') }}
        <input v-model.number="f.procedimento" type="number" min="1" data-testid="texto-procedimento"
      /></label>
      <label
        >{{ t('cirurgia.textosPadrao.cirurgiao') }}
        <input v-model.number="f.cirurgiao" type="number" min="1" data-testid="texto-cirurgiao"
      /></label>
      <label
        >{{ t('cirurgia.textosPadrao.descricao') }}
        <textarea v-model="f.textoDescricao" rows="6" required data-testid="texto-descricao"></textarea>
      </label>
      <label
        >{{ t('cirurgia.textosPadrao.risco') }}
        <textarea v-model="f.textoRisco" rows="2" data-testid="texto-risco"></textarea>
      </label>
      <label
        >{{ t('cirurgia.textosPadrao.intercorrencia') }}
        <textarea v-model="f.textoIntercorrencia" rows="2" data-testid="texto-intercorrencia"></textarea>
      </label>
      <p data-testid="texto-campos">
        {{ t('cirurgia.textosPadrao.campos') }}:
        {{ campos.length ? campos.join(', ') : t('cirurgia.textosPadrao.semCampos') }}
      </p>
      <ul v-if="problemas.length" class="problemas" data-testid="texto-problemas">
        <li v-for="p in problemas" :key="p">{{ p }}</li>
      </ul>
      <button
        type="submit"
        :disabled="problemas.length > 0 || acao.isPending.value"
        data-testid="texto-salvar"
      >
        {{ f.id ? t('cirurgia.textosPadrao.salvarAlteracao') : t('cirurgia.textosPadrao.incluir') }}
      </button>
      <button v-if="f.id" type="button" data-testid="texto-novo" @click="limpar">
        {{ t('cirurgia.textosPadrao.novo') }}
      </button>
    </form>

    <fieldset v-if="f.id && campos.length" data-testid="texto-previa">
      <legend>{{ t('cirurgia.textosPadrao.previa') }}</legend>
      <label v-for="c in campos" :key="c"
        >{{ c }} <input v-model="valores[c]" maxlength="2000" :data-testid="`texto-valor-${c}`"
      /></label>
      <button
        type="button"
        :disabled="acao.isPending.value"
        data-testid="texto-gerar-previa"
        @click="gerarPrevia"
      >
        {{ t('cirurgia.textosPadrao.gerarPrevia') }}
      </button>
      <template v-if="previa">
        <p v-if="faltando" role="status">{{ t('cirurgia.textosPadrao.faltando', { campos: faltando }) }}</p>
        <pre data-testid="texto-previa-resultado">{{ previa.textoDescricao }}</pre>
      </template>
    </fieldset>

    <p v-if="!lista.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="textos-padrao-nenhum">
      {{ t('cirurgia.textosPadrao.nenhum') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-textos-padrao">
      <thead>
        <tr>
          <th scope="col">{{ t('cirurgia.textosPadrao.tituloCampo') }}</th>
          <th scope="col">{{ t('cirurgia.procedimento') }}</th>
          <th scope="col">{{ t('cirurgia.textosPadrao.cirurgiao') }}</th>
          <th scope="col">{{ t('cirurgia.textosPadrao.campos') }}</th>
          <th scope="col">{{ t('cirurgia.textosPadrao.situacao') }}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`texto-padrao-${x.id}`">
          <td>{{ x.titulo }}</td>
          <td>{{ x.procedimentoDescricao ?? t('cirurgia.textosPadrao.qualquer') }}</td>
          <td>{{ x.cirurgiaoNome ?? t('cirurgia.textosPadrao.doServico') }}</td>
          <td>{{ x.campos.length }}</td>
          <td>{{ x.ativo ? t('cirurgia.textosPadrao.emUso') : t('cirurgia.textosPadrao.foraDeUso') }}</td>
          <td>
            <button type="button" :data-testid="`texto-editar-${x.id}`" @click="editar(x)">
              {{ t('cirurgia.textosPadrao.editar') }}
            </button>
            <button
              type="button"
              :disabled="acao.isPending.value"
              :data-testid="`texto-uso-${x.id}`"
              @click="alternarUso(x)"
            >
              {{ x.ativo ? t('cirurgia.textosPadrao.tirarDeUso') : t('cirurgia.textosPadrao.voltarAoUso') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
