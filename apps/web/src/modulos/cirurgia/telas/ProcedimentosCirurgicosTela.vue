<script setup lang="ts">
// Cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91): `/cirurgia/procedimentos-cirurgicos`. Uma tela só: a
// busca com a situação, o formulário que inclui ou altera (com versão) com os combos de grupo, porte, especialidade,
// natureza, caráter e anestesia, a validação na hora pela mesma regra do domínio que a API aplica, a duração sugerida
// pelo porte num clique, tirar de uso e voltar (nada se apaga) e o atalho para os textos padrão do procedimento.
// Ligação com o faturamento: o item cobrado (TUSS ou tabela própria) e o procedimento SUS, achados por busca no
// servidor e escolhidos com SanteSelecao; via de acesso (TISS) e classe de contaminação esperada (controle de infecção).
import {
  duracaoSugeridaProcedimento,
  NATUREZAS_PROCEDIMENTO_CIRURGICO,
  validarProcedimentoCirurgico,
} from '@sgh/dominio-cirurgia';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarProcedimento,
  buscarItensFaturaveis,
  buscarSigtap,
  type ItemCatalogo,
  incluirProcedimento,
  lerApoioProcedimento,
  lerProcedimentosCirurgicos,
  type ProcedimentoCirurgico,
  usoProcedimento,
} from '../api-procedimentos-cirurgicos.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const busca = ref('');
const todos = ref(false);
const lista = useQuery({
  queryKey: computed(() => ['cirurgia', 'procedimentos-cirurgicos', busca.value.trim(), todos.value]),
  queryFn: () => lerProcedimentosCirurgicos(busca.value, todos.value),
});
const apoio = useQuery({
  queryKey: ['cirurgia', 'procedimentos-cirurgicos', 'apoio'],
  queryFn: lerApoioProcedimento,
});

const vazio = () => ({
  id: null as number | null,
  versao: 0,
  codigo: '',
  descricao: '',
  mnemonico: '',
  natureza: 'terapeutica',
  grupo: '',
  porte: '',
  especialidade: '',
  carater: '',
  tipoAnestesia: '',
  viaAcesso: '',
  classeContaminacao: '',
  itemFaturavel: '',
  itemRotulo: '',
  procedimentoSigtap: '',
  sigtapRotulo: '',
  duracaoMediaMinutos: '' as number | '',
  tempoPreparoSalaMinutos: '' as number | '',
  exigeLateralidade: false,
  obstetrico: false,
  hemodinamica: false,
  exigeExameImagem: false,
  exigePlano: false,
  orientacaoPaciente: '',
  preparo: '',
});
const f = reactive(vazio());
const idOuNulo = (v: string) => (v ? Number(v) : null);
const minutosOuNulo = (v: number | '') => (v === '' || v === null ? null : Number(v));

const opcoesDe = (xs: { id: number; descricao: string }[] | undefined, vazioRotulo: string) => [
  { valor: '', rotulo: vazioRotulo },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.descricao })),
];
const ap = computed(() => apoio.data.value);
const opcoesGrupo = computed(() => opcoesDe(ap.value?.grupos, t('cirurgia.procedimentoCirurgico.semGrupo')));
const opcoesPorte = computed(() => opcoesDe(ap.value?.portes, t('cirurgia.procedimentoCirurgico.escolha')));
const opcoesEspecialidade = computed(() =>
  opcoesDe(ap.value?.especialidades, t('cirurgia.procedimentoCirurgico.escolha')),
);
const opcoesCarater = computed(() =>
  opcoesDe(ap.value?.carateres, t('cirurgia.procedimentoCirurgico.semSugestao')),
);
const opcoesAnestesia = computed(() =>
  opcoesDe(ap.value?.anestesias, t('cirurgia.procedimentoCirurgico.semSugestao')),
);
const opcoesVia = computed(() => opcoesDe(ap.value?.vias, t('cirurgia.procedimentoCirurgico.semInformar')));
const opcoesClasse = computed(() =>
  opcoesDe(ap.value?.classesContaminacao, t('cirurgia.procedimentoCirurgico.semInformar')),
);

// Busca no servidor do item cobrado e do SUS (a partir de 2 letras); a opção já gravada fica sempre na lista.
const termoItem = ref('');
const termoSigtap = ref('');
const itensAchados = useQuery({
  queryKey: computed(() => ['cirurgia', 'procedimentos-cirurgicos', 'itens', termoItem.value.trim()]),
  queryFn: () => buscarItensFaturaveis(termoItem.value),
  enabled: computed(() => termoItem.value.trim().length >= 2),
});
const sigtapAchados = useQuery({
  queryKey: computed(() => ['cirurgia', 'procedimentos-cirurgicos', 'sigtap', termoSigtap.value.trim()]),
  queryFn: () => buscarSigtap(termoSigtap.value),
  enabled: computed(() => termoSigtap.value.trim().length >= 2),
});
const rotuloCatalogo = (x: ItemCatalogo) => `${x.codigo} — ${x.descricao}`;
const opcoesCatalogo = (achados: ItemCatalogo[] | undefined, atual: string, rotuloAtual: string) => {
  const xs = (achados ?? []).map((x) => ({ valor: String(x.id), rotulo: rotuloCatalogo(x) }));
  const comAtual =
    atual && !xs.some((x) => x.valor === atual) ? [{ valor: atual, rotulo: rotuloAtual }, ...xs] : xs;
  return [{ valor: '', rotulo: t('cirurgia.procedimentoCirurgico.semLigacao') }, ...comAtual];
};
const opcoesItem = computed(() => opcoesCatalogo(itensAchados.data.value, f.itemFaturavel, f.itemRotulo));
const opcoesSigtap = computed(() =>
  opcoesCatalogo(sigtapAchados.data.value, f.procedimentoSigtap, f.sigtapRotulo),
);
const opcoesNatureza = computed(() =>
  NATUREZAS_PROCEDIMENTO_CIRURGICO.map((n) => ({
    valor: n,
    rotulo: t(`cirurgia.procedimentoCirurgico.naturezas.${n}`),
  })),
);
const referencia = computed(
  () => ap.value?.portes.find((p) => String(p.id) === f.porte)?.duracaoReferenciaMinutos ?? null,
);
const sugestao = computed(() =>
  minutosOuNulo(f.duracaoMediaMinutos) === null ? duracaoSugeridaProcedimento(null, referencia.value) : null,
);
const usarReferencia = () => {
  if (sugestao.value !== null) f.duracaoMediaMinutos = sugestao.value;
};

const corpo = () => ({
  codigo: f.codigo,
  descricao: f.descricao,
  mnemonico: f.mnemonico.trim() || null,
  natureza: f.natureza,
  grupo: idOuNulo(f.grupo),
  porte: idOuNulo(f.porte),
  especialidade: idOuNulo(f.especialidade),
  carater: idOuNulo(f.carater),
  tipoAnestesia: idOuNulo(f.tipoAnestesia),
  viaAcesso: idOuNulo(f.viaAcesso),
  classeContaminacao: idOuNulo(f.classeContaminacao),
  itemFaturavel: idOuNulo(f.itemFaturavel),
  procedimentoSigtap: idOuNulo(f.procedimentoSigtap),
  duracaoMediaMinutos: minutosOuNulo(f.duracaoMediaMinutos),
  tempoPreparoSalaMinutos: minutosOuNulo(f.tempoPreparoSalaMinutos),
  exigeLateralidade: f.exigeLateralidade,
  obstetrico: f.obstetrico,
  hemodinamica: f.hemodinamica,
  exigeExameImagem: f.exigeExameImagem,
  exigePlano: f.exigePlano,
  orientacaoPaciente: f.orientacaoPaciente.trim() || null,
  preparo: f.preparo.trim() || null,
});
const problemas = computed(() => validarProcedimentoCirurgico(corpo()).map((p) => p.mensagem));

const aviso = ref('');
const erro = ref<unknown>(null);
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    void cliente.invalidateQueries({ queryKey: ['cirurgia', 'procedimentos-cirurgicos'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});
const salvar = () =>
  acao.mutate(async () => {
    if (f.id) await alterarProcedimento(f.id, { ...corpo(), versao: f.versao });
    else await incluirProcedimento(corpo());
    Object.assign(f, vazio());
    aviso.value = t('cirurgia.procedimentoCirurgico.salvo');
  });
const limpar = () => Object.assign(f, vazio());
const texto = (v: string | null) => v ?? '';
const valor = (v: number | null) => (v === null ? '' : String(v));
const editar = (x: ProcedimentoCirurgico) => {
  Object.assign(f, {
    id: x.id,
    versao: x.versao,
    codigo: x.codigo,
    descricao: x.descricao,
    mnemonico: texto(x.mnemonico),
    natureza: x.natureza,
    grupo: valor(x.grupo),
    porte: valor(x.porte),
    especialidade: valor(x.especialidade),
    carater: valor(x.carater),
    tipoAnestesia: valor(x.tipoAnestesia),
    viaAcesso: valor(x.viaAcesso),
    classeContaminacao: valor(x.classeContaminacao),
    itemFaturavel: valor(x.itemFaturavel),
    itemRotulo: x.itemFaturavel ? `${x.itemFaturavelCodigo ?? ''} — ${x.itemFaturavelDescricao ?? ''}` : '',
    procedimentoSigtap: valor(x.procedimentoSigtap),
    sigtapRotulo: x.procedimentoSigtap ? `${x.sigtapCodigo ?? ''} — ${x.sigtapDescricao ?? ''}` : '',
    duracaoMediaMinutos: x.duracaoMediaMinutos ?? '',
    tempoPreparoSalaMinutos: x.tempoPreparoSalaMinutos ?? '',
    exigeLateralidade: x.exigeLateralidade,
    obstetrico: x.obstetrico,
    hemodinamica: x.hemodinamica,
    exigeExameImagem: x.exigeExameImagem,
    exigePlano: x.exigePlano,
    orientacaoPaciente: texto(x.orientacaoPaciente),
    preparo: texto(x.preparo),
  });
  aviso.value = '';
};
const alternarUso = (x: ProcedimentoCirurgico) =>
  acao.mutate(() => usoProcedimento(x.id, !x.ativo, x.versao));
const MARCAS = ['exigeLateralidade', 'exigeExameImagem', 'exigePlano', 'obstetrico', 'hemodinamica'] as const;
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="procedimentos-cirurgicos-titulo"
    data-testid="tela-procedimentos-cirurgicos"
  >
    <h1 id="procedimentos-cirurgicos-titulo">{{ t('cirurgia.procedimentoCirurgico.titulo') }}</h1>
    <p>{{ t('cirurgia.procedimentoCirurgico.texto') }}</p>
    <ErroCirurgia v-if="lista.isError.value" :erro="lista.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="procedimento-aviso">{{ aviso }}</p>

    <form class="filtros" data-testid="procedimento-form" @submit.prevent="salvar">
      <label
        >{{ t('cirurgia.procedimentoCirurgico.codigo') }}
        <input v-model="f.codigo" maxlength="30" required data-testid="procedimento-codigo"
      /></label>
      <label
        >{{ t('cirurgia.procedimentoCirurgico.descricao') }}
        <input v-model="f.descricao" maxlength="150" required data-testid="procedimento-descricao"
      /></label>
      <label
        >{{ t('cirurgia.procedimentoCirurgico.mnemonico') }}
        <input v-model="f.mnemonico" maxlength="15" data-testid="procedimento-mnemonico"
      /></label>
      <SanteSelecao
        v-model="f.natureza"
        :rotulo="t('cirurgia.procedimentoCirurgico.natureza')"
        :opcoes="opcoesNatureza"
        data-testid="procedimento-natureza"
      />
      <SanteSelecao
        v-model="f.grupo"
        :rotulo="t('cirurgia.procedimentoCirurgico.grupo')"
        :opcoes="opcoesGrupo"
        data-testid="procedimento-grupo"
      />
      <SanteSelecao
        v-model="f.porte"
        :rotulo="t('cirurgia.procedimentoCirurgico.porte')"
        :opcoes="opcoesPorte"
        data-testid="procedimento-porte"
      />
      <SanteSelecao
        v-model="f.especialidade"
        :rotulo="t('cirurgia.procedimentoCirurgico.especialidade')"
        :opcoes="opcoesEspecialidade"
        data-testid="procedimento-especialidade"
      />
      <SanteSelecao
        v-model="f.carater"
        :rotulo="t('cirurgia.procedimentoCirurgico.carater')"
        :opcoes="opcoesCarater"
        data-testid="procedimento-carater"
      />
      <SanteSelecao
        v-model="f.tipoAnestesia"
        :rotulo="t('cirurgia.procedimentoCirurgico.anestesia')"
        :opcoes="opcoesAnestesia"
        data-testid="procedimento-anestesia"
      />
      <SanteSelecao
        v-model="f.viaAcesso"
        :rotulo="t('cirurgia.procedimentoCirurgico.viaAcesso')"
        :opcoes="opcoesVia"
        data-testid="procedimento-via"
      />
      <SanteSelecao
        v-model="f.classeContaminacao"
        :rotulo="t('cirurgia.procedimentoCirurgico.classeContaminacao')"
        :opcoes="opcoesClasse"
        data-testid="procedimento-classe"
      />
      <fieldset>
        <legend>{{ t('cirurgia.procedimentoCirurgico.faturamento') }}</legend>
        <label
          >{{ t('cirurgia.procedimentoCirurgico.buscarItem') }}
          <input v-model="termoItem" type="search" maxlength="60" data-testid="procedimento-busca-item"
        /></label>
        <SanteSelecao
          v-model="f.itemFaturavel"
          :rotulo="t('cirurgia.procedimentoCirurgico.itemFaturavel')"
          :opcoes="opcoesItem"
          :busca="false"
          data-testid="procedimento-item"
        />
        <label
          >{{ t('cirurgia.procedimentoCirurgico.buscarSigtap') }}
          <input v-model="termoSigtap" type="search" maxlength="60" data-testid="procedimento-busca-sigtap"
        /></label>
        <SanteSelecao
          v-model="f.procedimentoSigtap"
          :rotulo="t('cirurgia.procedimentoCirurgico.procedimentoSigtap')"
          :opcoes="opcoesSigtap"
          :busca="false"
          data-testid="procedimento-sigtap"
        />
        <p v-if="!f.itemFaturavel" role="note" data-testid="procedimento-sem-faturamento">
          {{ t('cirurgia.procedimentoCirurgico.semFaturamento') }}
        </p>
      </fieldset>
      <label
        >{{ t('cirurgia.procedimentoCirurgico.duracao') }}
        <input
          v-model.number="f.duracaoMediaMinutos"
          type="number"
          min="1"
          max="1440"
          data-testid="procedimento-duracao"
      /></label>
      <button
        v-if="sugestao !== null"
        type="button"
        data-testid="procedimento-usar-referencia"
        @click="usarReferencia"
      >
        {{ t('cirurgia.procedimentoCirurgico.usarReferencia') }}
        ({{ t('cirurgia.procedimentoCirurgico.duracaoReferencia', { n: sugestao }) }})
      </button>
      <label
        >{{ t('cirurgia.procedimentoCirurgico.preparoSala') }}
        <input
          v-model.number="f.tempoPreparoSalaMinutos"
          type="number"
          min="0"
          max="240"
          data-testid="procedimento-preparo-sala"
      /></label>
      <fieldset>
        <legend>{{ t('cirurgia.procedimentoCirurgico.exigencias') }}</legend>
        <label v-for="k in MARCAS" :key="k"
          ><input v-model="f[k]" type="checkbox" :data-testid="`procedimento-${k}`" />
          {{ t(`cirurgia.procedimentoCirurgico.${k}`) }}</label
        >
      </fieldset>
      <label
        >{{ t('cirurgia.procedimentoCirurgico.orientacao') }}
        <textarea
          v-model="f.orientacaoPaciente"
          rows="2"
          maxlength="4000"
          data-testid="procedimento-orientacao"
        ></textarea>
      </label>
      <label
        >{{ t('cirurgia.procedimentoCirurgico.preparo') }}
        <textarea v-model="f.preparo" rows="2" maxlength="4000" data-testid="procedimento-preparo"></textarea>
      </label>
      <ul v-if="problemas.length" class="problemas" data-testid="procedimento-problemas">
        <li v-for="p in problemas" :key="p">{{ p }}</li>
      </ul>
      <button
        type="submit"
        :disabled="problemas.length > 0 || acao.isPending.value"
        data-testid="procedimento-salvar"
      >
        {{
          f.id
            ? t('cirurgia.procedimentoCirurgico.salvarAlteracao')
            : t('cirurgia.procedimentoCirurgico.incluir')
        }}
      </button>
      <button v-if="f.id" type="button" data-testid="procedimento-novo" @click="limpar">
        {{ t('cirurgia.procedimentoCirurgico.novo') }}
      </button>
    </form>

    <div class="filtros">
      <label
        >{{ t('cirurgia.procedimentoCirurgico.busca') }}
        <input v-model="busca" type="search" maxlength="60" data-testid="procedimento-busca"
      /></label>
      <label
        ><input v-model="todos" type="checkbox" data-testid="procedimento-todos" />
        {{ t('cirurgia.procedimentoCirurgico.mostrarForaDeUso') }}</label
      >
    </div>

    <p v-if="!lista.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="procedimentos-nenhum">
      {{ t('cirurgia.procedimentoCirurgico.nenhum') }}
    </p>
    <template v-else>
      <p v-if="lista.data.value.truncado" role="status">{{ t('cirurgia.truncado') }}</p>
      <table class="tabela" data-testid="tabela-procedimentos-cirurgicos">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.procedimentoCirurgico.codigo') }}</th>
            <th scope="col">{{ t('cirurgia.procedimentoCirurgico.descricao') }}</th>
            <th scope="col">{{ t('cirurgia.procedimentoCirurgico.porte') }}</th>
            <th scope="col">{{ t('cirurgia.procedimentoCirurgico.especialidade') }}</th>
            <th scope="col">{{ t('cirurgia.procedimentoCirurgico.cobranca') }}</th>
            <th scope="col">{{ t('cirurgia.procedimentoCirurgico.textos') }}</th>
            <th scope="col">{{ t('cirurgia.procedimentoCirurgico.situacao') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`procedimento-${x.id}`">
            <td>{{ x.codigo }}</td>
            <td>{{ x.descricao }}</td>
            <td>{{ x.porteDescricao ?? '—' }}</td>
            <td>{{ x.especialidadeDescricao ?? '—' }}</td>
            <td>{{ [x.itemFaturavelCodigo, x.sigtapCodigo].filter(Boolean).join(' · ') || '—' }}</td>
            <td>
              <RouterLink to="/cirurgia/textos-padrao">{{
                t('cirurgia.procedimentoCirurgico.verTextos', { n: x.textosPadrao })
              }}</RouterLink>
            </td>
            <td>
              {{
                x.ativo
                  ? t('cirurgia.procedimentoCirurgico.emUso')
                  : t('cirurgia.procedimentoCirurgico.foraDeUso')
              }}
            </td>
            <td>
              <button type="button" :data-testid="`procedimento-editar-${x.id}`" @click="editar(x)">
                {{ t('cirurgia.procedimentoCirurgico.editar') }}
              </button>
              <button
                type="button"
                :disabled="acao.isPending.value"
                :data-testid="`procedimento-uso-${x.id}`"
                @click="alternarUso(x)"
              >
                {{
                  x.ativo
                    ? t('cirurgia.procedimentoCirurgico.tirarDeUso')
                    : t('cirurgia.procedimentoCirurgico.voltarAoUso')
                }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
