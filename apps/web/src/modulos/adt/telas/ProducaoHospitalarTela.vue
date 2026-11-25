<script setup lang="ts">
// Produção hospitalar mensal (F8, 09-AREA linha 87): `/internacao/producao-hospitalar`. Três abas:
// - o mês: indicadores ao vivo por categoria clínica e do hospital (Portaria MS 312/2002), com as parcelas impressas,
//   ao lado do apurado; apurar grava o retrato, fechar o congela (só depois do fim do mês);
// - o paciente: pelo número do atendimento, os períodos em cada categoria com diárias e valor, e a troca de categoria
//   com a validação do domínio na hora (nada se apaga: o período vigente encerra no instante da troca);
// - as faixas de valor da diária por categoria e vigência (a nova encerra a anterior na véspera).
import { validarFaixaValor, validarPeriodoCategoria } from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apurarProducao,
  classificarCategoria,
  incluirFaixaCategoria,
  type IndicadoresProducaoTela,
  lerCategoriasAtendimento,
  lerFaixasCategoria,
  lerPainelProducao,
} from '../api-producao-hospitalar.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const hoje = () => new Date().toISOString().slice(0, 10);
const agoraLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const aba = ref<'mes' | 'paciente' | 'faixas'>('mes');

// ---- o mês
const mes = ref(hoje().slice(0, 7));
const painel = useQuery({
  queryKey: computed(() => ['adt', 'producao', 'painel', mes.value]),
  queryFn: () => lerPainelProducao(mes.value),
  enabled: computed(() => /^\d{4}-\d{2}$/.test(mes.value)),
});
const nomeClinica = (id: number | null) =>
  id === null
    ? t('adt.producao.semCategoria')
    : (painel.data.value?.clinicas.find((c) => c.id === id)?.rotulo ?? String(id));
const linhas = computed(() => {
  const p = painel.data.value;
  if (!p) return [];
  return [
    ...p.aoVivo.porClinica.map((c) => ({ chave: `c${c.clinicaId}`, nome: nomeClinica(c.clinicaId), x: c })),
    { chave: 'total', nome: t('adt.producao.total'), x: p.aoVivo.total },
  ];
});
const gravadoTotal = computed(() => painel.data.value?.gravada.find((g) => g.clinicaId === null) ?? null);
const difere = computed(() => {
  const g = gravadoTotal.value;
  const v = painel.data.value?.aoVivo.total;
  return (
    !!g &&
    !!v &&
    (g.pacienteDia !== v.pacienteDia || g.saidas !== v.saidas || g.valorProduzido !== v.valorProduzido)
  );
});
const mesTerminou = computed(() => !!painel.data.value && mes.value < painel.data.value.hoje.slice(0, 7));
const fmt = (v: number | null, casas = 2) =>
  v === null
    ? '—'
    : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parcelas = (x: IndicadoresProducaoTela) => ({
  ocupacao: `${x.pacienteDia} / ${x.leitoDia}`,
  permanencia: `${x.pacienteDia} / ${x.saidas}`,
  giro: `${x.saidas} / ${x.leitosOperacionais}`,
  intervalo: `(${x.leitoDia} − ${x.pacienteDia}) / ${x.saidas}`,
  mortalidade: `${x.obitos} / ${x.saidas}`,
  pontualidade: `${x.saidasNoPrazo} / ${x.saidasComPrevisao}`,
});

// ---- o paciente
const numero = ref('');
const buscado = ref('');
const categorias = useQuery({
  queryKey: computed(() => ['adt', 'producao', 'categorias', buscado.value]),
  queryFn: () => lerCategoriasAtendimento(buscado.value),
  enabled: computed(() => buscado.value !== ''),
});
const troca = reactive({ clinicaId: null as number | null, inicio: agoraLocal() });
const opClinicas = computed(() =>
  (categorias.data.value?.clinicas ?? faixas.data.value?.clinicas ?? []).map((c) => ({
    valor: c.id,
    rotulo: c.rotulo,
  })),
);
const problemasTroca = computed(() => {
  const c = categorias.data.value;
  if (!c) return [];
  const vigente = c.periodos[c.periodos.length - 1] ?? null;
  const erros = Object.values(
    validarPeriodoCategoria({
      entrada: c.atendimento.entrada,
      saida: c.atendimento.saida,
      inicioVigente: vigente?.inicio ?? null,
      inicio: `${troca.inicio}:00`,
      agora: `${agoraLocal()}:59`,
    }),
  );
  if (vigente && troca.clinicaId === vigente.clinicaId) erros.push(t('adt.producao.mesmaCategoria'));
  return erros;
});

// ---- as faixas
const faixas = useQuery({ queryKey: ['adt', 'producao', 'faixas'], queryFn: lerFaixasCategoria });
const f = reactive({
  clinicaId: null as number | null,
  valorDiaria: 0,
  inicio: hoje(),
  fim: '',
  todasUnidades: false,
  observacao: '',
});
const corpoFaixa = () => ({
  clinicaId: f.clinicaId!,
  valorDiaria: Number(f.valorDiaria),
  inicio: f.inicio,
  fim: f.fim || null,
  todasUnidades: f.todasUnidades,
  observacao: f.observacao.trim() || null,
});
const problemasFaixa = computed(() =>
  Object.values(
    validarFaixaValor({ valorDiaria: Number(f.valorDiaria), inicio: f.inicio, fim: f.fim || null }),
  ),
);
const opClinicasFaixa = computed(() =>
  (faixas.data.value?.clinicas ?? []).map((c) => ({ valor: c.id, rotulo: c.rotulo })),
);

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<{ mensagem: string }>) => fn(),
  onSuccess: (r) => {
    erro.value = null;
    aviso.value = r.mensagem || t('adt.producao.salvo');
    void cliente.invalidateQueries({ queryKey: ['adt', 'producao'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="producao-titulo" data-testid="tela-producao-hospitalar">
    <h1 id="producao-titulo">{{ t('adt.producao.titulo') }}</h1>
    <p>{{ t('adt.producao.texto') }}</p>
    <div role="tablist">
      <button
        v-for="a in ['mes', 'paciente', 'faixas'] as const"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`producao-aba-${a}`"
        @click="aba = a"
      >
        {{ t(`adt.producao.abas.${a}`) }}
      </button>
    </div>
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="producao-aviso">{{ aviso }}</p>

    <template v-if="aba === 'mes'">
      <div class="filtros">
        <label
          >{{ t('adt.producao.mes') }}
          <input v-model="mes" type="month" :max="hoje().slice(0, 7)" data-testid="producao-mes"
        /></label>
        <button
          type="button"
          :disabled="!painel.data.value || painel.data.value.situacao === 'fechada' || acao.isPending.value"
          data-testid="producao-apurar"
          @click="acao.mutate(() => apurarProducao(mes, false))"
        >
          {{ t('adt.producao.apurar') }}
        </button>
        <button
          type="button"
          :disabled="!mesTerminou || painel.data.value?.situacao === 'fechada' || acao.isPending.value"
          :title="mesTerminou ? '' : t('adt.producao.fecharSoDepois')"
          data-testid="producao-fechar"
          @click="acao.mutate(() => apurarProducao(mes, true))"
        >
          {{ t('adt.producao.fechar') }}
        </button>
      </div>
      <ErroAdt v-if="painel.isError.value" :erro="painel.error.value" />
      <template v-if="painel.data.value">
        <p data-testid="producao-situacao">
          {{ t(`adt.producao.situacao.${painel.data.value.situacao}`) }} ·
          {{
            t('adt.producao.contadoAte', {
              de: painel.data.value.aoVivo.de,
              ate: painel.data.value.aoVivo.ate,
              dias: painel.data.value.aoVivo.dias,
            })
          }}
        </p>
        <p v-if="difere" role="note" data-testid="producao-difere">{{ t('adt.producao.diferenca') }}</p>
        <p
          v-if="painel.data.value.aoVivo.total.diasSemFaixa > 0"
          role="note"
          data-testid="producao-sem-faixa"
        >
          {{ t('adt.producao.semFaixa', { n: painel.data.value.aoVivo.total.diasSemFaixa }) }}
        </p>
        <table data-testid="producao-tabela">
          <thead>
            <tr>
              <th>{{ t('adt.producao.categoria') }}</th>
              <th>{{ t('adt.producao.colunas.leitos') }}</th>
              <th>{{ t('adt.producao.colunas.entradas') }}</th>
              <th>{{ t('adt.producao.colunas.saidas') }}</th>
              <th>{{ t('adt.producao.colunas.obitos') }}</th>
              <th>{{ t('adt.producao.colunas.pacienteDia') }}</th>
              <th>{{ t('adt.producao.colunas.ocupacao') }}</th>
              <th>{{ t('adt.producao.colunas.permanencia') }}</th>
              <th>{{ t('adt.producao.colunas.giro') }}</th>
              <th>{{ t('adt.producao.colunas.intervalo') }}</th>
              <th>{{ t('adt.producao.colunas.mortalidade') }}</th>
              <th>{{ t('adt.producao.colunas.pontualidade') }}</th>
              <th>{{ t('adt.producao.colunas.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in linhas" :key="l.chave" :data-testid="`producao-linha-${l.chave}`">
              <th scope="row">{{ l.nome }}</th>
              <td>{{ l.x.leitosOperacionais }}</td>
              <td>{{ l.x.entradas }}</td>
              <td>{{ l.x.saidas }}</td>
              <td>{{ l.x.obitos }}</td>
              <td>{{ l.x.pacienteDia }}</td>
              <td :title="parcelas(l.x).ocupacao">
                {{ fmt(l.x.taxaOcupacao) }} <small>({{ parcelas(l.x).ocupacao }})</small>
              </td>
              <td>
                {{ fmt(l.x.mediaPermanencia) }} <small>({{ parcelas(l.x).permanencia }})</small>
              </td>
              <td>
                {{ fmt(l.x.giroLeito) }} <small>({{ parcelas(l.x).giro }})</small>
              </td>
              <td>
                {{ fmt(l.x.intervaloSubstituicao) }} <small>({{ parcelas(l.x).intervalo }})</small>
              </td>
              <td>
                {{ fmt(l.x.taxaMortalidade) }} <small>({{ parcelas(l.x).mortalidade }})</small>
              </td>
              <td>
                {{ fmt(l.x.pontualidadeAlta) }}% <small>({{ parcelas(l.x).pontualidade }})</small>
              </td>
              <td>{{ moeda(l.x.valorProduzido) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <template v-else-if="aba === 'paciente'">
      <form class="filtros" data-testid="producao-busca" @submit.prevent="buscado = numero.trim()">
        <label
          >{{ t('adt.producao.atendimento') }}
          <input v-model="numero" maxlength="20" required data-testid="producao-atendimento"
        /></label>
        <button type="submit" data-testid="producao-buscar">{{ t('adt.producao.buscar') }}</button>
      </form>
      <ErroAdt v-if="categorias.isError.value" :erro="categorias.error.value" />
      <template v-if="categorias.data.value">
        <p data-testid="producao-paciente">
          {{ t('adt.producao.entrada') }}: {{ categorias.data.value.atendimento.entrada.replace('T', ' ') }} ·
          {{ t('adt.producao.saida') }}:
          {{ categorias.data.value.atendimento.saida?.replace('T', ' ') ?? t('adt.producao.internado') }}
        </p>
        <p v-if="categorias.data.value.periodos.length === 0">{{ t('adt.producao.vazio') }}</p>
        <table v-else data-testid="producao-periodos">
          <caption>
            {{
              t('adt.producao.periodos')
            }}
          </caption>
          <thead>
            <tr>
              <th>{{ t('adt.producao.categoria') }}</th>
              <th>{{ t('adt.producao.inicio') }}</th>
              <th>{{ t('adt.producao.fim') }}</th>
              <th>{{ t('adt.producao.diarias') }}</th>
              <th>{{ t('adt.producao.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in categorias.data.value.periodos"
              :key="p.id"
              :data-testid="`producao-periodo-${p.id}`"
            >
              <td>{{ p.clinica }}</td>
              <td>{{ p.inicio.replace('T', ' ') }}</td>
              <td>{{ p.fim?.replace('T', ' ') ?? t('adt.producao.emAberto') }}</td>
              <td>{{ p.diarias }}</td>
              <td>{{ moeda(p.valor) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th colspan="4">{{ t('adt.producao.valorTotal') }}</th>
              <td data-testid="producao-valor-total">{{ moeda(categorias.data.value.valorTotal) }}</td>
            </tr>
          </tfoot>
        </table>
        <form
          class="filtros"
          data-testid="producao-troca"
          @submit.prevent="
            acao.mutate(() =>
              classificarCategoria({
                atendimentoId: categorias.data.value!.atendimento.id,
                clinicaId: troca.clinicaId!,
                inicio: troca.inicio,
              }),
            )
          "
        >
          <SanteSelecao
            v-model="troca.clinicaId"
            :rotulo="t('adt.producao.novaCategoria')"
            :opcoes="opClinicas"
            data-testid="producao-troca-categoria"
          />
          <label
            >{{ t('adt.producao.desde') }}
            <input v-model="troca.inicio" type="datetime-local" required data-testid="producao-troca-inicio"
          /></label>
          <ul v-if="problemasTroca.length" class="problemas" data-testid="producao-troca-problemas">
            <li v-for="p in problemasTroca" :key="p">{{ p }}</li>
          </ul>
          <button
            type="submit"
            :disabled="!troca.clinicaId || problemasTroca.length > 0 || acao.isPending.value"
            data-testid="producao-troca-gravar"
          >
            {{ t('adt.producao.mudar') }}
          </button>
        </form>
      </template>
    </template>

    <template v-else>
      <form
        class="filtros"
        data-testid="producao-faixa-form"
        @submit.prevent="acao.mutate(() => incluirFaixaCategoria(corpoFaixa()))"
      >
        <SanteSelecao
          v-model="f.clinicaId"
          :rotulo="t('adt.producao.faixaCategoria')"
          :opcoes="opClinicasFaixa"
          data-testid="producao-faixa-categoria"
        />
        <label
          >{{ t('adt.producao.valorDiaria') }}
          <input
            v-model.number="f.valorDiaria"
            type="number"
            min="0"
            step="0.01"
            required
            data-testid="producao-faixa-valor"
        /></label>
        <label
          >{{ t('adt.producao.inicioVigencia') }}
          <input v-model="f.inicio" type="date" required data-testid="producao-faixa-inicio"
        /></label>
        <label
          >{{ t('adt.producao.fimVigencia') }}
          <input v-model="f.fim" type="date" data-testid="producao-faixa-fim"
        /></label>
        <label
          ><input v-model="f.todasUnidades" type="checkbox" /> {{ t('adt.producao.todasUnidades') }}</label
        >
        <label>{{ t('adt.producao.observacao') }} <input v-model="f.observacao" maxlength="400" /></label>
        <ul v-if="problemasFaixa.length" class="problemas" data-testid="producao-faixa-problemas">
          <li v-for="p in problemasFaixa" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="!f.clinicaId || problemasFaixa.length > 0 || acao.isPending.value"
          data-testid="producao-faixa-incluir"
        >
          {{ t('adt.producao.incluirFaixa') }}
        </button>
      </form>
      <ErroAdt v-if="faixas.isError.value" :erro="faixas.error.value" />
      <p v-if="faixas.data.value?.faixas.length === 0">{{ t('adt.producao.vazio') }}</p>
      <table v-else-if="faixas.data.value" data-testid="producao-faixas">
        <thead>
          <tr>
            <th>{{ t('adt.producao.faixaCategoria') }}</th>
            <th>{{ t('adt.producao.valorDiaria') }}</th>
            <th>{{ t('adt.producao.inicioVigencia') }}</th>
            <th>{{ t('adt.producao.fimVigencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in faixas.data.value.faixas" :key="x.id">
            <td>
              {{ x.clinica }} <small v-if="x.vigente">({{ t('adt.producao.vigente') }})</small>
            </td>
            <td>{{ moeda(x.valorDiaria) }}</td>
            <td>{{ x.inicio }}</td>
            <td>{{ x.fim ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
