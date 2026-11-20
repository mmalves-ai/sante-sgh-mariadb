<script setup lang="ts">
// Painel de indicadores de pessoas (W0-06, parte 7d; M4 de mercado; itens 193 e 215; `pessoas.indicadores.ler`): o
// período (no máximo um ano) e o setor do estabelecimento da sessão; um cartão por indicador com o valor consolidado e
// a conta por extenso (Σ numeradores ÷ Σ denominadores), a ficha técnica (definição, fórmula, numerador, denominador,
// fontes, norma e interpretação) e a tabela das parcelas por setor, todas impressas. Nas horas de enfermagem por
// paciente-dia, a referência do dimensionamento da COFEN e a razão realizado/referência; no fim, as horas da COFEN que
// valem (as da resolução ou as ajustadas no parâmetro). Fonte que não pôde ser lida vira aviso, nunca zero. Só leitura.
import {
  esquemaFiltroIndicadoresPessoas,
  FONTES_INDICADOR_PESSOAS,
  type IndicadorPessoasCalculado,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { lerApoioIndicadores, lerPainelIndicadores } from './api-indicadores.js';

const { t } = useI18n();

const apoio = useQuery({ queryKey: ['pessoas', 'indicadores', 'apoio'], queryFn: lerApoioIndicadores });

const inicio = ref<string | null>(null);
const fim = ref<string | null>(null);
const setor = ref<number | null>(null);
const aplicado = ref<{ inicio: string; fim: string; setor: number | null } | null>(null);
const erroFiltro = ref<string | null>(null);

/** O período padrão: do 1º dia do mês, dois meses antes de hoje, até hoje. */
function periodoPadrao(hoje: string): { inicio: string; fim: string } {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 3, 1));
  return { inicio: d.toISOString().slice(0, 10), fim: hoje };
}
watch(
  () => apoio.data.value,
  (a) => {
    if (!a || aplicado.value) return;
    const p = periodoPadrao(a.hoje);
    inicio.value = p.inicio;
    fim.value = p.fim;
    aplicado.value = { ...p, setor: null };
  },
  { immediate: true },
);

const opcoesSetor = computed(() => [
  { valor: null as number | null, rotulo: t('pessoas.indicadores.filtro.todos') },
  ...(apoio.data.value?.setores ?? []).map((s) => ({ valor: s.codigo as number | null, rotulo: s.rotulo })),
]);

function calcular(): void {
  const r = esquemaFiltroIndicadoresPessoas.safeParse({
    inicio: inicio.value ?? '',
    fim: fim.value ?? '',
    hospital: null,
    setor: setor.value,
  });
  if (!r.success) {
    erroFiltro.value = t('pessoas.indicadores.filtro.invalido', {
      m: r.error.issues.map((i) => i.message).join(' '),
    });
    return;
  }
  erroFiltro.value = null;
  aplicado.value = { inicio: r.data.inicio, fim: r.data.fim, setor: r.data.setor };
}

const painel = useQuery({
  queryKey: computed(() => ['pessoas', 'indicadores', 'painel', aplicado.value]),
  queryFn: () => lerPainelIndicadores(aplicado.value!),
  enabled: computed(() => aplicado.value !== null),
});
const dados = computed(() => painel.data.value ?? null);

const nomeSetor = computed(() => {
  const s = dados.value?.setor ?? null;
  if (s === null) return t('pessoas.indicadores.filtro.todos');
  return apoio.data.value?.setores.find((x) => x.codigo === s)?.rotulo ?? String(s);
});

const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const numero = (v: number | null): string => (v === null ? t('pessoas.indicadores.semValor') : fmt.format(v));
const valorComUnidade = (i: IndicadorPessoasCalculado): string =>
  i.valor === null ? t('pessoas.indicadores.semValor') : `${fmt.format(i.valor)} ${i.ficha.unidade}`;
const fontes = (i: IndicadorPessoasCalculado): string =>
  i.ficha.fontes.map((f) => FONTES_INDICADOR_PESSOAS[f]).join('; ');
const temReferencia = (i: IndicadorPessoasCalculado): boolean =>
  i.parcelas.some((p) => p.referencia !== null);
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-indicadores" data-testid="tela-indicadores-pessoas">
    <h1 id="pes-indicadores">{{ t('pessoas.indicadores.titulo') }}</h1>
    <p>{{ t('pessoas.indicadores.subtitulo') }}</p>

    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!apoio.data.value" role="status">{{ t('pessoas.carregando') }}</p>
    <form v-else class="campos" data-testid="indicadores-filtro" @submit.prevent="calcular">
      <SanteData
        v-model="inicio"
        :rotulo="t('pessoas.indicadores.filtro.inicio')"
        editavel
        data-testid="indicadores-inicio"
      />
      <SanteData
        v-model="fim"
        :rotulo="t('pessoas.indicadores.filtro.fim')"
        editavel
        data-testid="indicadores-fim"
      />
      <SanteSelecao
        v-model="setor"
        :rotulo="t('pessoas.indicadores.filtro.setor')"
        :opcoes="opcoesSetor"
        busca
        data-testid="indicadores-setor"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('pessoas.indicadores.filtro.calcular')"
          data-testid="indicadores-calcular"
          @acionar="calcular"
        />
      </div>
    </form>
    <div role="status" aria-live="polite">
      <SanteAlerta
        v-if="erroFiltro"
        :texto="erroFiltro"
        variante="alerta"
        data-testid="indicadores-erro-filtro"
      />
    </div>

    <ErroPessoas v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="aplicado && !dados" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else-if="dados">
      <p data-testid="indicadores-recorte">
        {{
          t('pessoas.indicadores.recorte', {
            inicio: dataBr(dados.inicio),
            fim: dataBr(dados.fim),
            setor: nomeSetor,
          })
        }}
        <span class="secundario">{{ t('pessoas.indicadores.consolidado') }}</span>
      </p>
      <div v-if="dados.avisos.length > 0" class="bloco" data-testid="indicadores-avisos">
        <h2 class="sub">{{ t('pessoas.indicadores.avisos') }}</h2>
        <SanteAlerta v-for="(a, n) in dados.avisos" :key="n" :texto="a" variante="aviso" />
      </div>

      <article
        v-for="i in dados.indicadores"
        :key="i.ficha.codigo"
        class="bloco"
        :aria-labelledby="`ind-${i.ficha.codigo}`"
        :data-testid="`indicador-${i.ficha.codigo}`"
      >
        <h2 :id="`ind-${i.ficha.codigo}`" class="sub">{{ i.ficha.rotulo }}</h2>
        <p class="valor">
          <strong :data-testid="`indicador-${i.ficha.codigo}-valor`">{{ valorComUnidade(i) }}</strong>
        </p>
        <dl class="dados">
          <dt>{{ t('pessoas.indicadores.conta') }}</dt>
          <dd :data-testid="`indicador-${i.ficha.codigo}-conta`">{{ i.conta }}</dd>
          <template v-if="i.referencia !== null">
            <dt>{{ t('pessoas.indicadores.referencia') }}</dt>
            <dd :data-testid="`indicador-${i.ficha.codigo}-referencia`">
              {{ t('pessoas.indicadores.referenciaValor', { v: fmt.format(i.referencia) }) }}
            </dd>
            <dt>{{ t('pessoas.indicadores.razao') }}</dt>
            <dd :data-testid="`indicador-${i.ficha.codigo}-razao`">{{ numero(i.razaoReferencia) }}</dd>
          </template>
          <template v-for="c in i.complementos" :key="c.rotulo">
            <dt>{{ c.rotulo }}</dt>
            <dd>{{ c.valor }}</dd>
          </template>
        </dl>

        <h3 class="sub">{{ t('pessoas.indicadores.ficha.titulo') }}</h3>
        <dl class="dados" :data-testid="`indicador-${i.ficha.codigo}-ficha`">
          <dt>{{ t('pessoas.indicadores.ficha.definicao') }}</dt>
          <dd>{{ i.ficha.definicao }}</dd>
          <dt>{{ t('pessoas.indicadores.ficha.formula') }}</dt>
          <dd>{{ i.ficha.formula }}</dd>
          <dt>{{ t('pessoas.indicadores.ficha.unidade') }}</dt>
          <dd>{{ i.ficha.unidade }}</dd>
          <dt>{{ t('pessoas.indicadores.ficha.numerador') }}</dt>
          <dd>{{ i.ficha.numerador }}</dd>
          <dt>{{ t('pessoas.indicadores.ficha.denominador') }}</dt>
          <dd>{{ i.ficha.denominador }}</dd>
          <dt>{{ t('pessoas.indicadores.ficha.fontes') }}</dt>
          <dd>{{ fontes(i) }}</dd>
          <dt>{{ t('pessoas.indicadores.ficha.norma') }}</dt>
          <dd>{{ i.ficha.norma }}</dd>
          <dt>{{ t('pessoas.indicadores.ficha.interpretacao') }}</dt>
          <dd>{{ i.ficha.interpretacao }}</dd>
        </dl>

        <h3 class="sub">{{ t('pessoas.indicadores.parcelas.titulo') }}</h3>
        <p v-if="i.parcelas.length === 0" class="secundario">{{ t('pessoas.indicadores.parcelas.vazio') }}</p>
        <div v-else class="rolagem">
          <table class="tabela" :data-testid="`indicador-${i.ficha.codigo}-parcelas`">
            <caption class="secundario">
              {{
                t('pessoas.indicadores.parcelas.legenda', { indicador: i.ficha.rotulo })
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('pessoas.indicadores.parcelas.unidade') }}</th>
                <th scope="col">{{ t('pessoas.indicadores.parcelas.setor') }}</th>
                <th scope="col">{{ t('pessoas.indicadores.parcelas.numerador') }}</th>
                <th scope="col">{{ t('pessoas.indicadores.parcelas.denominador') }}</th>
                <th scope="col">{{ t('pessoas.indicadores.parcelas.valor') }}</th>
                <th scope="col">{{ t('pessoas.indicadores.parcelas.conta') }}</th>
                <th v-if="temReferencia(i)" scope="col">
                  {{ t('pessoas.indicadores.parcelas.referencia') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in i.parcelas"
                :key="`${p.hospital}-${p.setor}`"
                :data-testid="`indicador-${i.ficha.codigo}-parcela-${p.setor ?? 'sem'}`"
              >
                <td>{{ p.hospital }}</td>
                <td>{{ p.nomeSetor }}</td>
                <td>{{ fmt.format(p.numerador) }}</td>
                <td>{{ fmt.format(p.denominador) }}</td>
                <td>{{ numero(p.valor) }}</td>
                <td>{{ p.conta }}</td>
                <td v-if="temReferencia(i)">
                  {{ p.referencia === null ? '' : fmt.format(p.referencia) }}
                  <div v-if="p.contaReferencia" class="secundario">{{ p.contaReferencia }}</div>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colspan="2">{{ t('pessoas.indicadores.parcelas.total') }}</th>
                <td>{{ fmt.format(i.numerador) }}</td>
                <td>{{ fmt.format(i.denominador) }}</td>
                <td>{{ numero(i.valor) }}</td>
                <td>{{ i.conta }}</td>
                <td v-if="temReferencia(i)">{{ i.referencia === null ? '' : fmt.format(i.referencia) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </article>
    </template>

    <section
      v-if="apoio.data.value"
      class="bloco"
      aria-labelledby="pes-ind-cofen"
      data-testid="indicadores-cofen"
    >
      <h2 id="pes-ind-cofen" class="sub">{{ t('pessoas.indicadores.cofen.titulo') }}</h2>
      <p class="secundario">{{ t('pessoas.indicadores.cofen.texto') }}</p>
      <table class="tabela">
        <caption class="secundario">
          {{
            t('pessoas.indicadores.cofen.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.indicadores.cofen.categoria') }}</th>
            <th scope="col">{{ t('pessoas.indicadores.cofen.horas') }}</th>
            <th scope="col">{{ t('pessoas.indicadores.cofen.origem') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in apoio.data.value.horasCofen"
            :key="c.categoria"
            :data-testid="`cofen-${c.categoria}`"
          >
            <td>{{ c.rotulo }}</td>
            <td>{{ fmt.format(c.horas) }}</td>
            <td>
              {{
                c.ajustada ? t('pessoas.indicadores.cofen.ajustada') : t('pessoas.indicadores.cofen.padrao')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.sub {
  font-size: 1rem;
  margin: 0.5rem 0 0;
}
.valor {
  font-size: 1.5rem;
  margin: 0;
}
.rolagem {
  overflow-x: auto;
}
</style>
