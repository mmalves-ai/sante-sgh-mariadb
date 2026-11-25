<script setup lang="ts">
// F3.8, 07-FIN linha 109: as regras de retenção na fonte com vigência (o lançamento do título recebe a sugestão da regra
// vigente, não um valor digitado) e o recolhimento do retido da competência: um clique por tributo gera o título a
// pagar da guia, com o código de receita e o vencimento no mês seguinte, e liga as retenções a ele.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  gerarRecolhimento,
  gravarRegraRetencao,
  lerRegrasRetencao,
  lerRetidoEmAberto,
  lerApoioRetencao,
} from '../api-contabil-fiscal.js';
import { buscarMunicipiosRetencao, type MunicipioEncontrado } from '../api-retencao-sofrida.js';
import BuscaFornecedor from './BuscaFornecedor.vue';

const props = defineProps<{ competencia: string; podeEditar: boolean; podeRecolher: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      regras: 'Regras de retenção na fonte',
      tributo: 'Tributo',
      aliquota: 'Alíquota (%)',
      base: 'Base (% do valor)',
      minimo: 'Mínimo para reter',
      vigencia: 'Vigência',
      participante: 'Participante',
      encerrar: 'Encerrar vigência hoje',
      emAberto: 'Retido em aberto na competência',
      receita: 'Código de receita',
      credor: 'Órgão arrecadador (credor da guia)',
      natureza: 'Natureza financeira',
      naturezaDoTributo: 'A do tributo',
      nova: 'Nova regra de retenção',
      descricao: 'Descrição',
      momento: 'Momento',
      momentos: { emissao: 'Na emissão', pagamento: 'No pagamento', recebimento: 'No recebimento' },
      participantes: {
        pessoa_fisica: 'Pessoa física',
        pessoa_juridica: 'Pessoa jurídica',
        cooperativa: 'Cooperativa',
        simples_nacional: 'Optante do Simples',
        orgao_publico: 'Órgão público',
        todos: 'Todos',
      },
      deducao: 'Dedução',
      maximo: 'Teto (opcional)',
      faixaInicio: 'Faixa de (opcional)',
      faixaFim: 'Faixa até (opcional)',
      inicio: 'Início da vigência',
      incluir: 'Incluir regra',
      escolha: 'Escolha',
      municipio: 'Município do serviço (ISS)',
      municipioDica: 'Digite o começo do nome do município',
      municipioEscolhido: 'Escolhido: {nome}',
      municipioNenhum: 'Nenhum município encontrado.',
      municipioFalta: 'A regra do ISS é do município do serviço: escolha o município.',
      invalida: 'Preencha tributo, descrição (3 letras ou mais), alíquota e início da vigência.',
      gerar: 'Gerar título do recolhimento',
      nada: 'Nenhuma retenção em aberto.',
      ate: 'até',
    },
  },
});
const qc = useQueryClient();
const regras = useQuery({ queryKey: ['financeiro', 'regras-retencao'], queryFn: () => lerRegrasRetencao() });
const aberto = useQuery({
  queryKey: computed(() => ['financeiro', 'retido-aberto', props.competencia]),
  queryFn: () => lerRetidoEmAberto(props.competencia),
  enabled: computed(() => /^\d{4}-\d{2}$/.test(props.competencia)),
});
const erro = ref<unknown>(null);
const ok = ref('');
const credor = ref<number | null>(null);
const natureza = ref<number | null>(null);
const receitas = ref<Record<string, string>>({});
const hoje = () => new Date().toISOString().slice(0, 10);
const apoio = useQuery({ queryKey: ['financeiro', 'apoio-retencao'], queryFn: () => lerApoioRetencao() });
const MOMENTOS = ['emissao', 'pagamento', 'recebimento'] as const;
const PARTICIPANTES = [
  'pessoa_juridica',
  'pessoa_fisica',
  'cooperativa',
  'simples_nacional',
  'orgao_publico',
  'todos',
] as const;
const nova = reactive({
  tributo: null as number | null,
  descricao: '',
  momento: 'pagamento' as (typeof MOMENTOS)[number],
  participante: 'pessoa_juridica' as (typeof PARTICIPANTES)[number],
  percentualBase: '100',
  aliquota: '',
  deducao: '0',
  minimo: '0',
  maximo: '',
  faixaInicio: '',
  faixaFim: '',
  vigenciaInicio: hoje(),
});
// O ISS retido é do município do serviço: a regra do ISS só entra com o município, escolhido pelo nome.
const ehIss = computed(
  () => (apoio.data.value?.tributos ?? []).find((x) => x.id === nova.tributo)?.sigla.toUpperCase() === 'ISS',
);
const municipio = ref<MunicipioEncontrado | null>(null);
const termoMunicipio = ref('');
const municipios = useQuery({
  queryKey: computed(() => ['financeiro', 'busca-municipio', termoMunicipio.value.trim()]),
  queryFn: () => buscarMunicipiosRetencao(termoMunicipio.value.trim()),
  enabled: computed(() => ehIss.value && termoMunicipio.value.trim().length >= 2 && !municipio.value),
});
function digitarMunicipio(v: string) {
  termoMunicipio.value = v;
  municipio.value = null;
}
function escolherMunicipio(m: MunicipioEncontrado) {
  municipio.value = m;
  termoMunicipio.value = `${m.nome} (${m.uf})`;
}
const num = (v: string) => Number(String(v).replace(',', '.'));
const opcional = (v: string) => (String(v).trim() === '' ? null : num(v));
/** Validação na hora: o botão só liga com o mínimo que o servidor exige (o servidor confere o resto). */
const novaPronta = computed(
  () =>
    !!nova.tributo &&
    nova.descricao.trim().length >= 3 &&
    num(nova.aliquota) > 0 &&
    num(nova.aliquota) <= 100 &&
    num(nova.percentualBase) > 0 &&
    num(nova.percentualBase) <= 100 &&
    (!ehIss.value || !!municipio.value) &&
    /^\d{4}-\d{2}-\d{2}$/.test(nova.vigenciaInicio),
);
const incluir = () =>
  agir(async () => {
    const r = await gravarRegraRetencao(
      {
        acao: 'incluir',
        tributo: nova.tributo,
        descricao: nova.descricao.trim(),
        momento: nova.momento,
        participante: nova.participante,
        municipio: ehIss.value ? (municipio.value?.id ?? null) : null,
        percentualBase: num(nova.percentualBase),
        aliquota: num(nova.aliquota),
        faixaInicio: opcional(nova.faixaInicio),
        faixaFim: opcional(nova.faixaFim),
        deducao: num(nova.deducao) || 0,
        minimo: num(nova.minimo) || 0,
        maximo: opcional(nova.maximo),
        codigoReceita: null,
        vigenciaInicio: nova.vigenciaInicio,
        vigenciaFim: null,
      },
      novaChave('regra'),
    );
    nova.descricao = '';
    nova.aliquota = '';
    return r;
  });

async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  ok.value = '';
  try {
    ok.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'regras-retencao'] });
    await qc.invalidateQueries({ queryKey: ['financeiro', 'retido-aberto'] });
  } catch (e) {
    erro.value = e;
  }
}
const encerrar = (id: number) =>
  agir(() => gravarRegraRetencao({ acao: 'encerrar', id, vigenciaFim: hoje() }, novaChave('regra')));
// 07-FIN linha 110: uma linha por tributo e código de receita das retenções; o botão recolhe só aquele código (uma
// guia). O código digitado só entra na linha sem código (nem na retenção nem no tributo).
const chaveAberto = (a: { tributo: number; codigoReceita: string | null }) =>
  `${a.tributo}-${a.codigoReceita ?? ''}`;
// O botão leva a sigla; com mais de um código no mesmo tributo, a sigla e o código (rt-gerar-IRRF-3280).
const idGerar = (a: { tributo: number; sigla: string; codigoReceita: string | null }) =>
  (aberto.data.value ?? []).filter((x) => x.tributo === a.tributo).length > 1
    ? `rt-gerar-${a.sigla}-${a.codigoReceita ?? 'sem-codigo'}`
    : `rt-gerar-${a.sigla}`;
const recolher = (a: { tributo: number; codigoReceita: string | null }) =>
  agir(() =>
    gerarRecolhimento(
      {
        competencia: props.competencia,
        tributo: a.tributo,
        credor: credor.value,
        natureza: natureza.value,
        codigoReceita: a.codigoReceita ?? (receitas.value[chaveAberto(a)]?.trim() || null),
      },
      novaChave('recolhimento'),
    ),
  );
</script>

<template>
  <section aria-labelledby="rt-titulo" data-testid="rt-painel">
    <h2 id="rt-titulo">{{ t('regras') }}</h2>
    <ErroFaturamento v-if="erro || regras.error.value" :erro="erro ?? regras.error.value" />
    <p v-if="ok" role="status" class="secundario" data-testid="rt-ok">{{ ok }}</p>
    <table class="tabela" data-testid="rt-regras">
      <thead>
        <tr>
          <th scope="col">{{ t('tributo') }}</th>
          <th scope="col">{{ t('participante') }}</th>
          <th scope="col">{{ t('base') }}</th>
          <th scope="col">{{ t('aliquota') }}</th>
          <th scope="col">{{ t('minimo') }}</th>
          <th scope="col">{{ t('vigencia') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('encerrar') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras.data.value" :key="r.id">
          <th scope="row">{{ `${r.tributo} - ${r.descricao}` }}</th>
          <td>{{ t(`participantes.${r.participante}`) }}</td>
          <td>{{ r.percentualBase }}</td>
          <td>{{ r.aliquota }}</td>
          <td>{{ r.minimo.toFixed(2) }}</td>
          <td>
            {{ r.vigenciaInicio }}
            <template v-if="r.vigenciaFim">{{ t('ate') }} {{ r.vigenciaFim }}</template>
          </td>
          <td>
            <button v-if="podeEditar && !r.vigenciaFim" type="button" @click="encerrar(r.id)">
              {{ t('encerrar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <form
      v-if="podeEditar"
      class="formulario"
      data-testid="rt-nova"
      @submit.prevent="novaPronta && incluir()"
    >
      <h3>{{ t('nova') }}</h3>
      <span class="campo">
        <SanteSelecao
          v-model="nova.tributo"
          :rotulo="t('tributo')"
          obrigatorio
          :opcoes="[
            { valor: null, rotulo: t('escolha') },
            ...(apoio.data.value?.tributos ?? []).map((x) => ({
              valor: x.id,
              rotulo: `${x.sigla} - ${x.descricao}`,
            })),
          ]"
          data-testid="rt-nova-tributo"
        />
      </span>
      <span class="campo">
        <label for="rt-nova-descricao">{{ t('descricao') }}</label>
        <input
          id="rt-nova-descricao"
          v-model="nova.descricao"
          maxlength="150"
          required
          data-testid="rt-nova-descricao"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="nova.momento"
          :rotulo="t('momento')"
          :opcoes="MOMENTOS.map((m) => ({ valor: m, rotulo: t(`momentos.${m}`) }))"
          data-testid="rt-nova-momento"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="nova.participante"
          :rotulo="t('participante')"
          :opcoes="PARTICIPANTES.map((x) => ({ valor: x, rotulo: t(`participantes.${x}`) }))"
          data-testid="rt-nova-participante"
        />
      </span>
      <span v-if="ehIss" class="campo">
        <label for="rt-nova-municipio">{{ t('municipio') }}</label>
        <input
          id="rt-nova-municipio"
          :value="termoMunicipio"
          :placeholder="t('municipioDica')"
          maxlength="80"
          autocomplete="off"
          required
          data-testid="rt-nova-municipio"
          @input="digitarMunicipio(($event.target as HTMLInputElement).value)"
        />
        <small v-if="municipio" class="secundario" role="status" data-testid="rt-nova-municipio-escolhido">
          {{ t('municipioEscolhido', { nome: `${municipio.nome} (${municipio.uf})` }) }}
        </small>
        <ul
          v-else-if="municipios.data.value?.length"
          class="lista-simples"
          data-testid="rt-nova-municipio-achados"
        >
          <li v-for="m in municipios.data.value" :key="m.id">
            <button type="button" @click="escolherMunicipio(m)">{{ m.nome }} ({{ m.uf }})</button>
          </li>
        </ul>
        <small v-else-if="municipios.data.value" class="secundario">{{ t('municipioNenhum') }}</small>
        <small v-else class="secundario">{{ t('municipioFalta') }}</small>
      </span>
      <span
        v-for="c in [
          'percentualBase',
          'aliquota',
          'deducao',
          'minimo',
          'maximo',
          'faixaInicio',
          'faixaFim',
        ] as const"
        :key="c"
        class="campo"
      >
        <label :for="`rt-nova-${c}`">{{ t(c === 'percentualBase' ? 'base' : c) }}</label>
        <input :id="`rt-nova-${c}`" v-model="nova[c]" inputmode="decimal" :data-testid="`rt-nova-${c}`" />
      </span>
      <span class="campo">
        <label for="rt-nova-inicio">{{ t('inicio') }}</label>
        <input
          id="rt-nova-inicio"
          v-model="nova.vigenciaInicio"
          type="date"
          required
          data-testid="rt-nova-inicio"
        />
      </span>
      <small v-if="!novaPronta" class="secundario">{{ t('invalida') }}</small>
      <button type="submit" :disabled="!novaPronta" data-testid="rt-nova-incluir">{{ t('incluir') }}</button>
    </form>
    <h2>{{ t('emAberto') }} {{ competencia }}</h2>
    <p v-if="!aberto.data.value?.length">{{ t('nada') }}</p>
    <template v-else>
      <BuscaFornecedor :rotulo="t('credor')" prefixo="rt-credor" @escolhido="(f) => (credor = f.id)" />
      <span class="campo">
        <SanteSelecao
          v-model="natureza"
          :rotulo="t('natureza')"
          :opcoes="[
            { valor: null, rotulo: t('naturezaDoTributo') },
            ...(apoio.data.value?.naturezas ?? []).map((n) => ({
              valor: n.id,
              rotulo: `${n.codigo} ${n.descricao}`,
            })),
          ]"
          data-testid="rt-natureza"
        />
      </span>
      <table class="tabela" data-testid="rt-aberto">
        <tbody>
          <tr v-for="a in aberto.data.value" :key="chaveAberto(a)">
            <th scope="row">{{ a.sigla }}</th>
            <td>{{ a.retencoes }}</td>
            <td>{{ a.valor.toFixed(2) }}</td>
            <td>
              <span v-if="a.codigoReceita">
                {{ a.codigoReceita }}
              </span>
              <input
                v-else
                v-model="receitas[chaveAberto(a)]"
                :aria-label="`${t('receita')} ${a.sigla}`"
                :data-testid="`rt-receita-${a.sigla}`"
                maxlength="10"
              />
            </td>
            <td>
              <button
                type="button"
                :disabled="
                  !podeRecolher || !credor || (!a.codigoReceita && !receitas[chaveAberto(a)]?.trim())
                "
                :data-testid="idGerar(a)"
                @click="recolher(a)"
              >
                {{ t('gerar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
