<script setup lang="ts">
// Resultado por unidade e por convênio (M54, etapa 5; item `Controladoria > Custos hospitalares > Resultado por unidade
// e por convênio`; `custos.resultado.ler`): a competência e o agrupamento (convênio, procedimento, unidade, tipo de conta);
// a apuração de que o resultado vem (com a marca de parcial); os grupos com receita bruta, glosa, recurso, líquida,
// custo e margem, e o total da competência; os indicadores econômicos com a ficha e as parcelas (Σ numeradores ÷ Σ
// denominadores); o custo e a margem por conta, paginados no servidor, filtrados por convênio e procedimento (combos com
// busca, das opções da própria apuração; ADR 0027), número da conta, prontuário do paciente ou margem negativa ("Ver as
// contas" do grupo preenche o filtro). O custo por paciente é o agrupamento pelo prontuário (a soma das contas dele na
// competência; D-PACIENTE-545): o paciente só pelo número do prontuário, nunca o nome, só nesta tela (com a permissão
// e a trilha da leitura no servidor), nunca no relatório nem na exportação.
import {
  type AgrupamentoResultado,
  type GrupoResultado,
  ROTULOS_SITUACAO_APURACAO,
  TAMANHO_PAGINA_CONTAS_CUSTO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerApoioApuracao, lerContasCusto, lerResultadoCustos } from './api-apuracao.js';
import {
  contaIndicador,
  dataHora,
  filtrarGrupos,
  percentual,
  quantidadeCent,
  reais,
} from './comum-apuracao.js';
import { competenciasAte, rotuloCompetencia } from './comum-custos.js';
import ErroCustos from './ErroCustos.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const hoje = props.hoje ?? new Date().toISOString().slice(0, 10);
const MAX_GRUPOS = 100;

const apoio = useQuery({ queryKey: ['custos', 'apuracao', 'apoio'], queryFn: lerApoioApuracao });
const a = computed(() => apoio.data.value ?? null);
const competencias = competenciasAte(hoje, 36);
const competencia = ref<string>(competencias[1] ?? competencias[0]!);
const opcoesCompetencia = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));
const agrupamento = ref<AgrupamentoResultado>('convenio');
const opcoesAgrupamento = computed(() => a.value?.agrupamentos ?? []);

const resultado = useQuery({
  queryKey: computed(() => ['custos', 'resultado', competencia.value, agrupamento.value]),
  queryFn: () => lerResultadoCustos(competencia.value, agrupamento.value),
  enabled: computed(() => !!a.value?.acoes.resultado),
});
const r = computed(() => resultado.data.value ?? null);
const busca = ref('');
const filtrados = computed(() => filtrarGrupos(r.value?.grupos ?? [], busca.value));
const mostrados = computed(() => filtrados.value.slice(0, MAX_GRUPOS));
// Os nomes dos centros (as parcelas dos indicadores e das contas vêm pelo ID): o agrupamento por unidade da competência.
const porCentro = useQuery({
  queryKey: computed(() => ['custos', 'resultado', competencia.value, 'centro']),
  queryFn: () => lerResultadoCustos(competencia.value, 'centro'),
  enabled: computed(() => !!a.value?.acoes.resultado),
});
const nomeCentro = computed(
  () => new Map((porCentro.data.value?.grupos ?? []).map((g) => [Number(g.chave), g.rotulo] as const)),
);

// ── Contas ────────────────────────────────────────────────────────────────────────────────────────────────────────
// As opções dos combos de convênio e procedimento vêm da própria apuração (os grupos do resultado), com busca.
const opcoesDe = (ag: 'convenio' | 'procedimento') =>
  useQuery({
    queryKey: computed(() => ['custos', 'resultado', competencia.value, ag]),
    queryFn: () => lerResultadoCustos(competencia.value, ag),
    enabled: computed(() => !!a.value?.acoes.resultado),
  });
const porConvenio = opcoesDe('convenio');
const porProcedimento = opcoesDe('procedimento');
const opcoesConvenio = computed(() => [
  { valor: null as number | null, rotulo: t('custos.resultado.contas.todosConvenios') },
  ...(porConvenio.data.value?.grupos ?? [])
    .filter((g) => /^\d+$/.test(g.chave))
    .map((g) => ({ valor: Number(g.chave) as number | null, rotulo: `${g.chave} · ${g.rotulo}` }))
    .sort((x, y) => x.rotulo.localeCompare(y.rotulo)),
]);
const opcoesProcedimento = computed(() => [
  { valor: null as string | null, rotulo: t('custos.resultado.contas.todosProcedimentos') },
  ...(porProcedimento.data.value?.grupos ?? [])
    .filter((g) => g.chave !== 'sem')
    .map((g) => ({ valor: g.chave as string | null, rotulo: g.rotulo }))
    .sort((x, y) => x.rotulo.localeCompare(y.rotulo)),
]);
const convenio = ref<number | null>(null);
const procedimento = ref<string | null>(null);
const numeroTexto = ref('');
const prontuarioTexto = ref('');
const negativas = ref<'todas' | 'negativas'>('todas');
const opcoesNegativas = computed(() => [
  { valor: 'todas' as const, rotulo: t('custos.resultado.contas.todas') },
  { valor: 'negativas' as const, rotulo: t('custos.resultado.contas.negativas') },
]);
const pagina = ref(1);
const filtro = ref<{
  convenio: number | null;
  procedimento: string | null;
  numero: number | null;
  prontuario: number | null;
  negativas: boolean;
}>({
  convenio: null,
  procedimento: null,
  numero: null,
  prontuario: null,
  negativas: false,
});
const inteiroInvalido = (x: string) => x.trim() !== '' && !/^\d{1,9}$/.test(x.trim());
const numeroInvalido = computed(() => inteiroInvalido(numeroTexto.value));
const prontuarioInvalido = computed(() => inteiroInvalido(prontuarioTexto.value));
const inteiroOuNulo = (x: string) => (x.trim() ? Number(x.trim()) : null);
function filtrar(): void {
  if (numeroInvalido.value || prontuarioInvalido.value) return;
  filtro.value = {
    convenio: convenio.value,
    procedimento: procedimento.value,
    numero: inteiroOuNulo(numeroTexto.value),
    prontuario: inteiroOuNulo(prontuarioTexto.value),
    negativas: negativas.value === 'negativas',
  };
  pagina.value = 1;
}
function limpar(): void {
  convenio.value = null;
  procedimento.value = null;
  numeroTexto.value = '';
  prontuarioTexto.value = '';
  negativas.value = 'todas';
  filtrar();
}
function verContas(g: GrupoResultado): void {
  convenio.value = agrupamento.value === 'convenio' && /^\d+$/.test(g.chave) ? Number(g.chave) : null;
  procedimento.value = agrupamento.value === 'procedimento' && g.chave !== 'sem' ? g.chave : null;
  prontuarioTexto.value = agrupamento.value === 'paciente' && /^\d+$/.test(g.chave) ? g.chave : '';
  numeroTexto.value = '';
  filtrar();
  document.getElementById('resultado-contas-titulo')?.scrollIntoView?.({ block: 'start' });
}
watch(competencia, () => {
  pagina.value = 1;
});
const contas = useQuery({
  queryKey: computed(() => ['custos', 'resultado', 'contas', competencia.value, filtro.value, pagina.value]),
  queryFn: () => lerContasCusto({ competencia: competencia.value, ...filtro.value, pagina: pagina.value }),
  enabled: computed(() => !!a.value?.acoes.resultado),
  placeholderData: keepPreviousData,
});
const pc = computed(() => contas.data.value ?? null);
const paginas = computed(() => Math.max(1, Math.ceil((pc.value?.total ?? 0) / TAMANHO_PAGINA_CONTAS_CUSTO)));
const podeVerContas = computed(
  () =>
    agrupamento.value === 'convenio' ||
    agrupamento.value === 'procedimento' ||
    agrupamento.value === 'paciente',
);
</script>

<template>
  <section class="tela-custos" aria-labelledby="resultado-titulo" data-testid="tela-resultado-custos">
    <h1 id="resultado-titulo">{{ t('custos.resultado.titulo') }}</h1>
    <p>{{ t('custos.resultado.subtitulo') }}</p>
    <ErroCustos v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('custos.resultado.carregando') }}</p>
    <SanteAlerta
      v-else-if="!a.acoes.resultado"
      :texto="t('custos.resultado.semPermissao')"
      variante="info"
      data-testid="resultado-sem-permissao"
    />
    <template v-else>
      <div class="campos">
        <SanteSelecao
          v-model="competencia"
          :rotulo="t('custos.apuracao.competencia')"
          :opcoes="opcoesCompetencia"
          busca
          data-testid="resultado-competencia"
        />
        <SanteSelecao
          v-model="agrupamento"
          :rotulo="t('custos.resultado.agrupamento')"
          :opcoes="opcoesAgrupamento"
          data-testid="resultado-agrupamento"
        />
      </div>
      <div class="acoes">
        <RouterLink to="/custos/apuracao">{{ t('custos.resultado.irApuracao') }}</RouterLink>
      </div>
      <ErroCustos v-if="resultado.isError.value" :erro="resultado.error.value" />
      <p v-else-if="!r" role="status">{{ t('custos.resultado.carregando') }}</p>
      <p v-else-if="!r.apuracao" data-testid="resultado-nao-apurada">
        {{ t('custos.resultado.naoApurada', { competencia: rotuloCompetencia(competencia) }) }}
      </p>
      <template v-else>
        <p data-testid="resultado-apuracao">
          {{
            t('custos.resultado.apuracao', {
              situacao: ROTULOS_SITUACAO_APURACAO[r.apuracao.situacao].toLowerCase(),
              quem: r.apuracao.apuradaPor,
              quando: dataHora(r.apuracao.apuradaEm),
            })
          }}
        </p>
        <SanteAlerta
          v-if="r.apuracao.parcial && r.apuracao.rotuloParcial"
          :texto="t('custos.resultado.parcial', { rotulo: r.apuracao.rotuloParcial })"
          variante="aviso"
          data-testid="resultado-parcial"
        />

        <section
          class="bloco"
          :aria-label="t('custos.resultado.grupos.titulo')"
          data-testid="resultado-grupos"
        >
          <h2>{{ t('custos.resultado.grupos.titulo') }}</h2>
          <label class="campo-numero">
            <span>{{ t('custos.resultado.grupos.busca') }}</span>
            <input v-model="busca" type="search" maxlength="60" data-testid="resultado-busca" />
          </label>
          <p v-if="filtrados.length > MAX_GRUPOS" class="secundario" role="status">
            {{ t('custos.resultado.grupos.mostrando', { n: MAX_GRUPOS, total: filtrados.length }) }}
          </p>
          <p v-if="mostrados.length === 0">{{ t('custos.resultado.grupos.nenhum') }}</p>
          <div v-else class="rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('custos.resultado.grupos.colunas.grupo') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.contas') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.bruta') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.glosa') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.recurso') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.liquida') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.custo') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.margem') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.grupos.colunas.percentual') }}</th>
                  <th v-if="podeVerContas" scope="col">{{ t('custos.resultado.grupos.colunas.acoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in mostrados" :key="g.chave" :data-testid="`resultado-grupo-${g.chave}`">
                  <td>{{ g.rotulo }}</td>
                  <td class="numero">{{ g.contas }}</td>
                  <td class="numero">{{ reais(g.receitaBruta) }}</td>
                  <td class="numero">{{ reais(g.glosa) }}</td>
                  <td class="numero">{{ reais(g.recurso) }}</td>
                  <td class="numero">{{ reais(g.receitaLiquida) }}</td>
                  <td class="numero">{{ reais(g.custo) }}</td>
                  <td class="numero">{{ reais(g.margem) }}</td>
                  <td class="numero">{{ percentual(g.margemPercentualCent) }}</td>
                  <td v-if="podeVerContas">
                    <SanteBotao
                      :rotulo="t('custos.resultado.grupos.verContas')"
                      variante="texto"
                      :aria-label="`${t('custos.resultado.grupos.verContas')}: ${g.rotulo}`"
                      :data-testid="`resultado-ver-contas-${g.chave}`"
                      @acionar="verContas(g)"
                    />
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="total" data-testid="resultado-total">
                  <td>{{ t('custos.resultado.grupos.total', { grupos: r.grupos.length }) }}</td>
                  <td class="numero">{{ r.total.contas }}</td>
                  <td class="numero">{{ reais(r.total.receitaBruta) }}</td>
                  <td class="numero">{{ reais(r.total.glosa) }}</td>
                  <td class="numero">{{ reais(r.total.recurso) }}</td>
                  <td class="numero">{{ reais(r.total.receitaLiquida) }}</td>
                  <td class="numero">{{ reais(r.total.custo) }}</td>
                  <td class="numero">{{ reais(r.total.margem) }}</td>
                  <td class="numero">{{ percentual(r.total.margemPercentualCent) }}</td>
                  <td v-if="podeVerContas"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section
          class="bloco"
          :aria-label="t('custos.resultado.indicadores.titulo')"
          data-testid="resultado-indicadores"
        >
          <h2>{{ t('custos.resultado.indicadores.titulo') }}</h2>
          <p v-if="r.indicadores.length === 0">{{ t('custos.resultado.indicadores.nenhum') }}</p>
          <article
            v-for="i in r.indicadores"
            :key="i.codigo"
            :data-testid="`resultado-indicador-${i.codigo}`"
          >
            <h3>{{ i.rotulo }}</h3>
            <p class="conta total">{{ contaIndicador(i) }}</p>
            <p class="secundario">{{ t('custos.resultado.indicadores.formula', { formula: i.formula }) }}</p>
            <details>
              <summary>{{ t('custos.resultado.indicadores.parcelas') }}</summary>
              <ul>
                <li v-for="x in i.parcelas" :key="x.centro">
                  {{
                    t('custos.resultado.indicadores.parcela', {
                      centro: nomeCentro.get(x.centro) ?? x.centro,
                      numerador: reais(x.numerador),
                      denominador: quantidadeCent(x.denominador),
                    })
                  }}
                </li>
              </ul>
            </details>
          </article>
        </section>
      </template>

      <section class="bloco" aria-labelledby="resultado-contas-titulo" data-testid="resultado-contas">
        <h2 id="resultado-contas-titulo">{{ t('custos.resultado.contas.titulo') }}</h2>
        <p class="secundario">{{ t('custos.resultado.contas.ajuda') }}</p>
        <form class="campos" @submit.prevent="filtrar">
          <SanteSelecao
            v-model="convenio"
            :rotulo="t('custos.resultado.contas.convenio')"
            :opcoes="opcoesConvenio"
            busca
            data-testid="resultado-filtro-convenio"
          />
          <SanteSelecao
            v-model="procedimento"
            :rotulo="t('custos.resultado.contas.procedimento')"
            :opcoes="opcoesProcedimento"
            busca
            data-testid="resultado-filtro-procedimento"
          />
          <label class="campo-numero">
            <span>{{ t('custos.resultado.contas.numero') }}</span>
            <input
              v-model="numeroTexto"
              inputmode="numeric"
              maxlength="9"
              :aria-invalid="numeroInvalido"
              data-testid="resultado-filtro-numero"
            />
            <span v-if="numeroInvalido" class="secundario" role="alert">{{
              t('custos.resultado.contas.numeroInvalido')
            }}</span>
          </label>
          <label class="campo-numero">
            <span>{{ t('custos.resultado.contas.prontuario') }}</span>
            <input
              v-model="prontuarioTexto"
              inputmode="numeric"
              maxlength="9"
              :aria-invalid="prontuarioInvalido"
              data-testid="resultado-filtro-prontuario"
            />
            <span v-if="prontuarioInvalido" class="secundario" role="alert">{{
              t('custos.resultado.contas.prontuarioInvalido')
            }}</span>
          </label>
          <SanteOpcoes
            v-model="negativas"
            :legenda="t('custos.resultado.contas.negativas')"
            :opcoes="opcoesNegativas"
            data-testid="resultado-filtro-negativas"
          />
          <div class="acoes">
            <SanteBotao
              tipo="submit"
              :rotulo="t('custos.resultado.contas.filtrar')"
              :desabilitado="numeroInvalido || prontuarioInvalido"
              data-testid="resultado-filtrar"
            />
            <SanteBotao :rotulo="t('custos.resultado.contas.limpar')" variante="texto" @acionar="limpar" />
          </div>
        </form>
        <ErroCustos v-if="contas.isError.value" :erro="contas.error.value" />
        <p v-else-if="!pc" role="status">{{ t('custos.resultado.carregando') }}</p>
        <p v-else-if="pc.contas.length === 0" data-testid="resultado-sem-contas">
          {{ t('custos.resultado.contas.nenhuma') }}
        </p>
        <template v-else>
          <div class="rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('custos.resultado.contas.colunas.numero') }}</th>
                  <th scope="col">{{ t('custos.resultado.contas.colunas.prontuario') }}</th>
                  <th scope="col">{{ t('custos.resultado.contas.colunas.tipo') }}</th>
                  <th scope="col">{{ t('custos.resultado.contas.colunas.convenio') }}</th>
                  <th scope="col">{{ t('custos.resultado.contas.colunas.procedimento') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.contas.colunas.liquida') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.contas.colunas.custo') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.contas.colunas.margem') }}</th>
                  <th scope="col" class="numero">{{ t('custos.resultado.contas.colunas.percentual') }}</th>
                  <th scope="col">{{ t('custos.resultado.contas.colunas.parcelas') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in pc.contas" :key="c.conta" :data-testid="`resultado-conta-${c.numero}`">
                  <td>{{ c.numero }}</td>
                  <td>{{ c.prontuario ?? '—' }}</td>
                  <td>{{ c.tipoConta ?? '—' }}</td>
                  <td>{{ c.convenio ?? '—' }}</td>
                  <td>{{ c.procedimento ?? '—' }}</td>
                  <td class="numero">{{ reais(c.receitaLiquida) }}</td>
                  <td class="numero">{{ reais(c.custo) }}</td>
                  <td class="numero">{{ reais(c.margem) }}</td>
                  <td class="numero">{{ percentual(c.margemPercentualCent) }}</td>
                  <td>
                    <ul>
                      <li v-for="x in c.parcelas" :key="x.centro">
                        {{
                          t('custos.resultado.contas.parcela', {
                            centro: nomeCentro.get(x.centro) ?? x.centro,
                            receita: reais(x.receita),
                            custo: reais(x.custo),
                          })
                        }}
                      </li>
                    </ul>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('custos.resultado.contas.anterior')"
              variante="secundario"
              :desabilitado="pagina <= 1"
              data-testid="resultado-pagina-anterior"
              @acionar="pagina -= 1"
            />
            <span role="status" data-testid="resultado-pagina">
              {{ t('custos.resultado.contas.pagina', { pagina, paginas, total: pc.total }) }}
            </span>
            <SanteBotao
              :rotulo="t('custos.resultado.contas.proxima')"
              variante="secundario"
              :desabilitado="pagina >= paginas"
              data-testid="resultado-pagina-proxima"
              @acionar="pagina += 1"
            />
          </div>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped src="./estilo-custos.css"></style>
