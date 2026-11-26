<script setup lang="ts">
// Exceções das regras de lançamento automático (C1-090, 06-FAT linha 16): `/faturamento/lancamento-automatico/excecoes`.
// Cada regra ativa de taxa de abertura ou de diária aparece com as exceções dela (situação no dia, recorte, naturezas,
// vigência, motivo e autor). Incluir é um formulário só, com a validação do domínio na hora; encerrar faz a exceção
// valer até ontem e nunca a apaga. Consultar pede faturamento.regra.ler; incluir e encerrar, faturamento.regra.editar.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { novaChave } from '../api-faturamento.js';
import {
  encerramentoExcecaoRegra,
  encerrarExcecaoRegra,
  type ExcecaoRegra,
  incluirExcecaoRegra,
  lerExcecoesRegra,
  NATUREZAS_EXCECAO_REGRA,
  validarExcecaoRegraLancamento,
} from '../api-excecao-regra.js';
import BuscaItemCobertura from '../componentes/BuscaItemCobertura.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { data } from '../usar-faturamento.js';

const { t } = useI18n();
const qc = useQueryClient();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('faturamento.regra.editar'));
const p = useQuery({ queryKey: ['faturamento', 'excecoes-regra'], queryFn: lerExcecoesRegra });

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const aberto = ref(false);
const tentou = ref(false);
const novo = () => ({
  regraLancamentoId: null as number | null,
  todosEstabelecimentos: false,
  fontePagadoraId: null as number | null,
  planoId: null as number | null,
  setorId: null as number | null,
  especialidadeId: null as number | null,
  itemId: null as number | null,
  grupoId: null as number | null,
  efeito: 'nao_aplicar' as 'nao_aplicar' | 'aplicar_somente',
  aplica: { internacao: true, ambulatorial: true, externo: true, urgencia: true, domiciliar: true },
  vigenciaInicio: '',
  vigenciaFim: '',
  motivo: '',
});
const f = reactive(novo());
watch(
  () => f.fontePagadoraId,
  () => {
    if (f.planoId !== null && !planos.value.some((x) => x.valor === f.planoId)) f.planoId = null;
  },
);

const qualquer = computed(() => ({ valor: null, rotulo: t('excecaoRegra.qualquer') }));
const opcoesDe = (xs: readonly { id: number; rotulo: string }[] | undefined) => [
  qualquer.value,
  ...(xs ?? []).map((x) => ({ valor: x.id as number | null, rotulo: x.rotulo })),
];
const regras = computed(() =>
  (p.data.value?.regras ?? []).map((r) => ({
    valor: r.id as number | null,
    rotulo: `${r.codigo} · ${r.descricao}`,
  })),
);
const fontes = computed(() => opcoesDe(p.data.value?.opcoes.fontes));
const planos = computed(() =>
  opcoesDe(p.data.value?.opcoes.planos.filter((x) => x.fontePagadoraId === f.fontePagadoraId)),
);
const setores = computed(() => opcoesDe(p.data.value?.opcoes.setores));
const especialidades = computed(() => opcoesDe(p.data.value?.opcoes.especialidades));
const grupos = computed(() => opcoesDe(p.data.value?.opcoes.grupos));
const efeitos = computed(() =>
  (['nao_aplicar', 'aplicar_somente'] as const).map((e) => ({
    valor: e as string,
    rotulo: t(`excecaoRegra.efeitos.${e}`),
  })),
);
const estabelecimentos = computed(() => [
  { valor: 'este', rotulo: t('excecaoRegra.esteEstabelecimento') },
  { valor: 'todos', rotulo: t('excecaoRegra.todosEstabelecimentos') },
]);
const estab = computed({
  get: () => (f.todosEstabelecimentos ? 'todos' : 'este'),
  set: (v: string) => (f.todosEstabelecimentos = v === 'todos'),
});

// A validação do domínio na hora (o estabelecimento da sessão conta como recorte quando a exceção é só dele).
const erros = computed(() =>
  validarExcecaoRegraLancamento({
    regraLancamento: f.regraLancamentoId,
    estabelecimento: f.todosEstabelecimentos ? null : 1,
    fontePagadora: f.fontePagadoraId,
    plano: f.planoId,
    setor: f.setorId,
    especialidade: f.especialidadeId,
    item: f.itemId,
    grupo: f.grupoId,
    efeito: f.efeito,
    aplica: f.aplica,
    vigenciaInicio: f.vigenciaInicio || null,
    vigenciaFim: f.vigenciaFim || null,
    motivo: f.motivo,
  }),
);
const valido = computed(() => Object.keys(erros.value).length === 0);
const mostrar = (campo: string) =>
  tentou.value || campo === 'grupo' || campo === 'vigenciaFim' ? erros.value[campo] : undefined;

function abrir() {
  Object.assign(f, novo(), { vigenciaInicio: p.data.value?.hoje ?? '' });
  tentou.value = false;
  aberto.value = true;
  mensagem.value = null;
}
async function gravar() {
  tentou.value = true;
  erro.value = null;
  if (!valido.value || f.regraLancamentoId === null) return;
  try {
    await incluirExcecaoRegra(
      {
        ...f,
        regraLancamentoId: f.regraLancamentoId,
        aplica: { ...f.aplica },
        vigenciaFim: f.vigenciaFim || null,
        motivo: f.motivo.trim(),
      },
      novaChave('excecao-regra'),
    );
    aberto.value = false;
    mensagem.value = t('excecaoRegra.gravado');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'excecoes-regra'] });
  } catch (e) {
    erro.value = e;
  }
}
const encerravel = (x: ExcecaoRegra) =>
  p.data.value ? encerramentoExcecaoRegra(x.vigenciaInicio, x.vigenciaFim, p.data.value.hoje).ok : false;
async function encerrar(x: ExcecaoRegra) {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await encerrarExcecaoRegra(x.id, x.versao, novaChave('excecao-regra-fim'));
    mensagem.value = t('excecaoRegra.encerrada', { fim: data(String(r['vigenciaFim'] ?? '')) });
    await qc.invalidateQueries({ queryKey: ['faturamento', 'excecoes-regra'] });
  } catch (e) {
    erro.value = e;
  }
}
function recorte(x: ExcecaoRegra): string {
  const partes = [
    x.todosEstabelecimentos ? t('excecaoRegra.todosEstabelecimentos') : t('excecaoRegra.esteEstabelecimento'),
    x.fonte && `${t('excecaoRegra.fonte')}: ${x.fonte}`,
    x.plano && `${t('excecaoRegra.plano')}: ${x.plano}`,
    x.setor && `${t('excecaoRegra.setor')}: ${x.setor}`,
    x.especialidade && `${t('excecaoRegra.especialidade')}: ${x.especialidade}`,
    x.item && `${t('excecaoRegra.item')}: ${x.item}`,
    x.grupo && `${t('excecaoRegra.grupo')}: ${x.grupo}`,
  ];
  return partes.filter(Boolean).join(' · ');
}
const naturezas = (x: ExcecaoRegra) =>
  NATUREZAS_EXCECAO_REGRA.filter((k) => x.aplica[k])
    .map((k) => t(`excecaoRegra.natureza.${k}`))
    .join(', ');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="exr-titulo" data-testid="tela-excecoes-regra">
    <h1 id="exr-titulo">{{ t('excecaoRegra.titulo') }}</h1>
    <p>{{ t('excecaoRegra.explicacao') }}</p>
    <p>
      <RouterLink to="/faturamento/lancamento-automatico">{{ t('excecaoRegra.voltar') }}</RouterLink>
    </p>
    <p v-if="!podeEditar" class="secundario" data-testid="exr-somente-leitura">
      {{ t('excecaoRegra.somenteLeitura') }}
    </p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="[]" testid="exr-mensagem" />
    <ErroFaturamento v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <p v-if="p.data.value.regras.length === 0" data-testid="exr-sem-regras">
        {{ t('excecaoRegra.semRegras') }}
      </p>
      <SanteBotao
        v-if="podeEditar && !aberto && p.data.value.regras.length"
        :rotulo="t('excecaoRegra.nova')"
        data-testid="exr-nova"
        @acionar="abrir"
      />

      <form v-if="aberto" class="filtros" data-testid="exr-form" novalidate @submit.prevent="gravar">
        <SanteSelecao
          v-model="f.regraLancamentoId"
          :rotulo="t('excecaoRegra.regra')"
          :opcoes="regras"
          obrigatorio
          data-testid="exr-regra"
        />
        <p v-if="mostrar('regraLancamento')" class="erro" data-testid="exr-erro-regraLancamento">
          {{ erros['regraLancamento'] }}
        </p>
        <SanteSelecao
          v-model="f.efeito"
          :rotulo="t('excecaoRegra.efeito')"
          :opcoes="efeitos"
          data-testid="exr-efeito"
        />
        <SanteSelecao
          v-model="estab"
          :rotulo="t('excecaoRegra.estabelecimento')"
          :opcoes="estabelecimentos"
          data-testid="exr-estabelecimento"
        />
        <SanteSelecao
          v-model="f.fontePagadoraId"
          :rotulo="t('excecaoRegra.fonte')"
          :opcoes="fontes"
          data-testid="exr-fonte"
        />
        <SanteSelecao
          v-model="f.planoId"
          :rotulo="t('excecaoRegra.plano')"
          :opcoes="planos"
          :desabilitado="f.fontePagadoraId === null"
          data-testid="exr-plano"
        />
        <SanteSelecao
          v-model="f.setorId"
          :rotulo="t('excecaoRegra.setor')"
          :opcoes="setores"
          data-testid="exr-setor"
        />
        <SanteSelecao
          v-model="f.especialidadeId"
          :rotulo="t('excecaoRegra.especialidade')"
          :opcoes="especialidades"
          data-testid="exr-especialidade"
        />
        <BuscaItemCobertura v-model="f.itemId" :rotulo="t('excecaoRegra.item')" testid="exr-item" />
        <SanteSelecao
          v-model="f.grupoId"
          :rotulo="t('excecaoRegra.grupo')"
          :opcoes="grupos"
          data-testid="exr-grupo"
        />
        <p v-if="mostrar('grupo')" class="erro" data-testid="exr-erro-grupo">{{ erros['grupo'] }}</p>
        <p v-if="mostrar('recorte')" class="erro" data-testid="exr-erro-recorte">{{ erros['recorte'] }}</p>
        <p v-if="mostrar('plano')" class="erro" data-testid="exr-erro-plano">{{ erros['plano'] }}</p>
        <fieldset class="campo" data-testid="exr-naturezas">
          <legend>{{ t('excecaoRegra.naturezas') }}</legend>
          <label v-for="k in NATUREZAS_EXCECAO_REGRA" :key="k">
            <input v-model="f.aplica[k]" type="checkbox" :data-testid="`exr-nat-${k}`" />
            {{ t(`excecaoRegra.natureza.${k}`) }}
          </label>
        </fieldset>
        <p v-if="mostrar('aplica')" class="erro" data-testid="exr-erro-aplica">{{ erros['aplica'] }}</p>
        <span class="campo"
          ><label for="exr-inicio">{{ t('excecaoRegra.inicio') }}</label
          ><input id="exr-inicio" v-model="f.vigenciaInicio" type="date" required data-testid="exr-inicio"
        /></span>
        <p v-if="mostrar('vigenciaInicio')" class="erro" data-testid="exr-erro-vigenciaInicio">
          {{ erros['vigenciaInicio'] }}
        </p>
        <span class="campo"
          ><label for="exr-fim">{{ t('excecaoRegra.fim') }}</label
          ><input id="exr-fim" v-model="f.vigenciaFim" type="date" data-testid="exr-fim"
        /></span>
        <p v-if="mostrar('vigenciaFim')" class="erro" data-testid="exr-erro-vigenciaFim">
          {{ erros['vigenciaFim'] }}
        </p>
        <span class="campo"
          ><label for="exr-motivo">{{ t('excecaoRegra.motivo') }}</label
          ><textarea
            id="exr-motivo"
            v-model="f.motivo"
            maxlength="500"
            rows="2"
            required
            data-testid="exr-motivo"
          />
        </span>
        <p v-if="mostrar('motivo')" class="erro" data-testid="exr-erro-motivo">{{ erros['motivo'] }}</p>
        <button type="submit" :disabled="tentou && !valido" data-testid="exr-gravar">
          {{ t('excecaoRegra.gravar') }}
        </button>
        <button type="button" data-testid="exr-cancelar" @click="aberto = false">
          {{ t('excecaoRegra.cancelar') }}
        </button>
      </form>

      <article
        v-for="r in p.data.value.regras"
        :key="r.id"
        class="cartao"
        :data-testid="`exr-regra-${r.id}`"
        :aria-labelledby="`exr-regra-t-${r.id}`"
      >
        <h2 :id="`exr-regra-t-${r.id}`">
          {{ r.codigo }} · {{ r.descricao }}
          <span class="secundario">· {{ t(`excecaoRegra.gatilhos.${r.gatilho}`) }}</span>
        </h2>
        <p v-if="r.excecoes.length === 0">{{ t('excecaoRegra.semExcecoes') }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('excecaoRegra.efeito') }}</th>
              <th scope="col">{{ t('excecaoRegra.recorte') }}</th>
              <th scope="col">{{ t('excecaoRegra.naturezas') }}</th>
              <th scope="col">{{ t('excecaoRegra.vigencia') }}</th>
              <th scope="col">{{ t('excecaoRegra.motivo') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('excecaoRegra.encerrar') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in r.excecoes" :key="x.id" :data-testid="`exr-excecao-${x.id}`">
              <td>{{ t(`excecaoRegra.efeitos.${x.efeito}`) }}</td>
              <td>{{ recorte(x) }}</td>
              <td>{{ naturezas(x) }}</td>
              <td>
                {{ data(x.vigenciaInicio ?? '') }} {{ t('excecaoRegra.ate') }}
                {{ x.vigenciaFim ? data(x.vigenciaFim) : t('excecaoRegra.semFim') }}
                <span :data-testid="`exr-situacao-${x.id}`"
                  >· {{ t(`excecaoRegra.situacoes.${x.situacao}`) }}</span
                >
              </td>
              <td>
                {{ x.motivo }}
                <span v-if="x.criadoPor" class="secundario"
                  >· {{ t('excecaoRegra.criadoPor', { nome: x.criadoPor }) }}</span
                >
              </td>
              <td>
                <SanteBotao
                  v-if="podeEditar && encerravel(x)"
                  variante="destrutivo"
                  :rotulo="t('excecaoRegra.encerrar')"
                  :confirmacao="t('excecaoRegra.confirmarEncerrar')"
                  :data-testid="`exr-encerrar-${x.id}`"
                  @acionar="encerrar(x)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </article>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
