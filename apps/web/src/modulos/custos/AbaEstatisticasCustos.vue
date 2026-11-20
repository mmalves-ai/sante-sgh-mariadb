<script setup lang="ts">
// Aba Estatísticas do mês (M54, etapa 4): a competência e a estatística com busca (ADR 0027); a coleta das fontes
// agregadas (o resumo de cada fonte, com os grupos sem centro no cadastro e a marca de estimada); os valores por centro
// com a origem (coletada ou lançada à mão), a fonte, a referência herdada e quem registrou; o total com as parcelas
// impressas; e o lançamento manual (que prevalece sobre o coletado). Coletar e lançar só com
// `custos.estatistica.registrar` e a liberação (o apoio diz); o servidor confere de novo.
import { type ApoioCustos, type ColetaEstatisticas, esquemaLancarEstatistica } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  coletarEstatisticas,
  lancarEstatistica,
  lerEstruturaCustos,
  lerMatrizEstatisticas,
} from './api-custos.js';
import {
  competenciasAte,
  dataHora,
  lerQuantidade,
  parcelasDaEstatistica,
  quantidade,
  rotuloCompetencia,
} from './comum-custos.js';
import ErroCustos from './ErroCustos.vue';

const props = defineProps<{ apoio: ApoioCustos; hoje: string }>();
const { t } = useI18n();
const cliente = useQueryClient();

const competencias = competenciasAte(props.hoje, 36);
const competencia = ref<string>(competencias[0]!);
const opcoesCompetencia = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));
const codigo = ref<string>(props.apoio.estatisticas[0]?.codigo ?? '');
const opcoesEstatistica = computed(() =>
  props.apoio.estatisticas.map((e) => ({ valor: e.codigo, rotulo: `${e.rotulo} (${e.unidade})` })),
);
const definicao = computed(() => props.apoio.estatisticas.find((e) => e.codigo === codigo.value) ?? null);
const rotuloFonte = (f: string) => props.apoio.fontes.find((x) => x.valor === f)?.rotulo ?? f;

const estrutura = useQuery({ queryKey: ['custos', 'centros'], queryFn: lerEstruturaCustos });
const centros = computed(() => estrutura.data.value?.centros ?? []);
const porId = computed(() => new Map(centros.value.map((c) => [c.id, c])));
const matriz = useQuery({
  queryKey: computed(() => ['custos', 'estatisticas', competencia.value]),
  queryFn: () => lerMatrizEstatisticas(competencia.value),
});
const m = computed(() => matriz.data.value ?? null);
const conta = computed(() =>
  m.value
    ? parcelasDaEstatistica(m.value.linhas, codigo.value, (id) => porId.value.get(id)?.codigo ?? id)
    : { parcelas: [], soma: 0 },
);
const casas = computed(() => definicao.value?.casas ?? 0);
const textoTotal = computed(() => {
  const d = definicao.value;
  if (!d) return '';
  if (conta.value.parcelas.length === 0)
    return t('custos.estatisticas.totalVazio', { estatistica: d.rotulo });
  return t('custos.estatisticas.total', {
    estatistica: d.rotulo,
    parcelas: conta.value.parcelas.map((p) => quantidade(p.valor.quantidade, casas.value)).join(' + '),
    total: quantidade(conta.value.soma, casas.value),
    unidade: d.unidade,
  });
});

// ── Coleta ──────────────────────────────────────────────────────────────────────────────────────────────────────
const coletando = ref(false);
const coleta = ref<ColetaEstatisticas | null>(null);
const erro = ref<unknown>(null);
watch(competencia, () => {
  coleta.value = null;
  erro.value = null;
  lancando.value = false;
});
async function coletar(): Promise<void> {
  coletando.value = true;
  erro.value = null;
  try {
    coleta.value = await coletarEstatisticas(competencia.value);
    await cliente.invalidateQueries({ queryKey: ['custos', 'estatisticas', competencia.value] });
  } catch (x) {
    erro.value = x;
  } finally {
    coletando.value = false;
  }
}
const resumo = computed(() => coleta.value ?? m.value?.ultimaColeta ?? null);

// ── Lançamento manual ───────────────────────────────────────────────────────────────────────────────────────────
const lancando = ref(false);
const centro = ref<number | null>(null);
const qtd = ref('');
const observacao = ref('');
const lancado = ref<string | null>(null);
const opcoesCentro = computed(() => [
  { valor: null as number | null, rotulo: '' },
  ...centros.value
    .filter((c) => c.ativo)
    .map((c) => ({ valor: c.id as number | null, rotulo: `${c.codigo} ${c.nome}` })),
]);
const qtdNumero = computed(() => lerQuantidade(qtd.value));
const qtdInvalida = computed(() => qtd.value.trim() !== '' && qtdNumero.value === null);
const entrada = computed(() =>
  esquemaLancarEstatistica.safeParse({
    competencia: competencia.value,
    centro: centro.value,
    codigo: codigo.value,
    quantidade: qtdNumero.value,
    observacao: observacao.value.trim() || null,
  }),
);
function abrirLancamento(): void {
  lancando.value = true;
  lancado.value = null;
  erro.value = null;
  centro.value = null;
  qtd.value = '';
  observacao.value = '';
}
async function lancar(): Promise<void> {
  if (!entrada.value.success) return;
  erro.value = null;
  try {
    const r = await lancarEstatistica(entrada.value.data);
    const c = porId.value.get(entrada.value.data.centro);
    lancado.value = t('custos.estatisticas.lancado', {
      estatistica: definicao.value?.rotulo ?? codigo.value,
      centro: c ? `${c.codigo} ${c.nome}` : String(entrada.value.data.centro),
      substituidas: r.substituidas,
    });
    lancando.value = false;
    await cliente.invalidateQueries({ queryKey: ['custos', 'estatisticas', competencia.value] });
  } catch (x) {
    erro.value = x;
  }
}
const nomeCentro = (id: number) => {
  const c = porId.value.get(id);
  return c ? c.nome : String(id);
};
const codigoCentro = (id: number) => porId.value.get(id)?.codigo ?? id;
</script>

<template>
  <section class="bloco" aria-labelledby="custos-est-titulo" data-testid="custos-estatisticas">
    <h2 id="custos-est-titulo">{{ t('custos.estatisticas.titulo') }}</h2>
    <p class="secundario">{{ t('custos.estatisticas.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="competencia"
        :rotulo="t('custos.estatisticas.competencia')"
        :opcoes="opcoesCompetencia"
        busca
        data-testid="custos-competencia"
      />
      <SanteSelecao
        v-model="codigo"
        :rotulo="t('custos.estatisticas.estatistica')"
        :opcoes="opcoesEstatistica"
        busca
        data-testid="custos-estatistica"
      />
    </div>
    <p v-if="definicao" class="secundario" data-testid="custos-definicao">
      {{ definicao.descricao }}
      {{
        definicao.tipoDado === 2
          ? t('custos.estatisticas.tipoReferencia')
          : t('custos.estatisticas.tipoLancamento')
      }}
    </p>
    <div v-if="apoio.acoes.registrarEstatistica" class="acoes">
      <SanteBotao
        :rotulo="coletando ? t('custos.estatisticas.coletando') : t('custos.estatisticas.coletar')"
        :desabilitado="coletando"
        data-testid="custos-coletar"
        @acionar="coletar"
      />
      <SanteBotao
        :rotulo="t('custos.estatisticas.lancar')"
        variante="secundario"
        data-testid="custos-lancar"
        @acionar="abrirLancamento"
      />
    </div>
    <ErroCustos v-if="erro" :erro="erro" />
    <SanteAlerta
      v-if="coleta"
      :texto="
        t('custos.estatisticas.coletada', {
          gravadas: coleta.gravadas,
          substituidas: coleta.substituidas,
          segundos: (coleta.duracaoMs / 1000).toFixed(1).replace('.', ','),
        })
      "
      variante="info"
      anunciar
      data-testid="custos-coletada"
    />
    <SanteAlerta v-if="lancado" :texto="lancado" variante="info" anunciar data-testid="custos-lancado" />

    <form
      v-if="lancando && definicao"
      class="bloco"
      :aria-label="
        t('custos.estatisticas.lancarTitulo', {
          estatistica: definicao.rotulo,
          competencia: rotuloCompetencia(competencia),
        })
      "
      data-testid="custos-form-lancamento"
      @submit.prevent="lancar"
    >
      <h3>
        {{
          t('custos.estatisticas.lancarTitulo', {
            estatistica: definicao.rotulo,
            competencia: rotuloCompetencia(competencia),
          })
        }}
      </h3>
      <div class="campos">
        <SanteSelecao
          v-model="centro"
          :rotulo="t('custos.estatisticas.centro')"
          :opcoes="opcoesCentro"
          busca
          obrigatorio
          data-testid="custos-lanc-centro"
        />
        <label class="campo-numero">
          <span>{{ t('custos.estatisticas.quantidade', { unidade: definicao.unidade }) }}</span>
          <input
            v-model="qtd"
            inputmode="decimal"
            maxlength="16"
            required
            :aria-invalid="qtdInvalida"
            data-testid="custos-lanc-quantidade"
          />
          <span v-if="qtdInvalida" class="secundario" role="alert">{{
            t('custos.estatisticas.quantidadeInvalida')
          }}</span>
        </label>
      </div>
      <SanteCampoTexto
        v-model="observacao"
        :rotulo="t('custos.estatisticas.observacao')"
        :max-bytes="400"
        data-testid="custos-lanc-observacao"
      />
      <div class="acoes">
        <SanteBotao :rotulo="t('custos.classificar.cancelar')" variante="texto" @acionar="lancando = false" />
        <SanteBotao
          :rotulo="t('custos.estatisticas.gravarLancamento')"
          tipo="submit"
          :desabilitado="!entrada.success"
          data-testid="custos-lanc-gravar"
        />
      </div>
    </form>

    <ErroCustos v-if="matriz.isError.value" :erro="matriz.error.value" />
    <p v-else-if="!m" role="status">{{ t('custos.carregando') }}</p>
    <template v-else>
      <p data-testid="custos-ultima-coleta">
        {{
          resumo
            ? t('custos.estatisticas.ultimaColeta', {
                quando: dataHora(resumo.coletadaEm),
                quem: resumo.coletadaPor,
              })
            : t('custos.estatisticas.semColeta')
        }}
      </p>
      <section v-if="resumo" class="bloco" aria-labelledby="custos-fontes-titulo" data-testid="custos-fontes">
        <h3 id="custos-fontes-titulo">{{ t('custos.estatisticas.fontes') }}</h3>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('custos.estatisticas.fonteColunas.fonte') }}</th>
              <th scope="col">{{ t('custos.estatisticas.fonteColunas.grupos') }}</th>
              <th scope="col">{{ t('custos.estatisticas.fonteColunas.centros') }}</th>
              <th scope="col">{{ t('custos.estatisticas.fonteColunas.semCentro') }}</th>
              <th scope="col">{{ t('custos.estatisticas.fonteColunas.observacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in resumo.fontes" :key="f.fonte" :data-testid="`custos-fonte-${f.fonte}`">
              <td>
                {{ rotuloFonte(f.fonte) }}
                <span v-if="f.estimada" class="marca">{{ t('custos.estatisticas.estimada') }}</span>
              </td>
              <td class="numero">{{ f.grupos }}</td>
              <td class="numero">{{ f.centros }}</td>
              <td class="numero">{{ f.semCentro }}</td>
              <td>{{ f.aviso ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-if="m.avisos.length" class="bloco" aria-labelledby="custos-avisos-titulo">
        <h3 id="custos-avisos-titulo">{{ t('custos.estatisticas.avisos') }}</h3>
        <ul data-testid="custos-avisos">
          <li v-for="(x, i) in m.avisos" :key="i">{{ x }}</li>
        </ul>
      </section>

      <p class="total" data-testid="custos-total">{{ textoTotal }}</p>
      <table v-if="conta.parcelas.length" class="tabela" data-testid="custos-matriz">
        <thead>
          <tr>
            <th scope="col">{{ t('custos.estatisticas.colunas.codigo') }}</th>
            <th scope="col">{{ t('custos.estatisticas.colunas.centro') }}</th>
            <th scope="col">{{ t('custos.estatisticas.colunas.quantidade') }}</th>
            <th scope="col">{{ t('custos.estatisticas.colunas.origem') }}</th>
            <th scope="col">{{ t('custos.estatisticas.colunas.registro') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in conta.parcelas"
            :key="p.centro"
            :data-testid="`custos-valor-${codigoCentro(p.centro)}`"
          >
            <td class="numero">{{ codigoCentro(p.centro) }}</td>
            <td>{{ nomeCentro(p.centro) }}</td>
            <td class="numero">{{ quantidade(p.valor.quantidade, casas) }}</td>
            <td>
              {{ t(`custos.estatisticas.origem.${p.valor.origem}`) }}
              <span class="secundario"
                >· {{ t('custos.estatisticas.fonte', { fonte: rotuloFonte(p.valor.fonte) }) }}</span
              >
              <span v-if="p.valor.estimada" class="marca">{{ t('custos.estatisticas.estimada') }}</span>
              <span v-if="p.valor.herdadaDe" class="marca">{{
                t('custos.estatisticas.herdada', { competencia: rotuloCompetencia(p.valor.herdadaDe) })
              }}</span>
              <span v-if="p.valor.observacao" class="secundario">· {{ p.valor.observacao }}</span>
            </td>
            <td>{{ p.valor.registradoPor }} · {{ dataHora(p.valor.registradoEm) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped src="./estilo-custos.css"></style>
