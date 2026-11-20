<script setup lang="ts">
// Aba Fatos da tela dos lançamentos automáticos dos módulos e razão (M54.1, etapa F1; `contabil.fato.ler`): acompanha a leitura incremental (regra 1: a
// contabilidade lê o que os módulos gravaram, por qualquer caminho): o resumo por origem (posição da leitura, última
// leitura, novos e alterados, situações com o total e as parcelas), a lista filtrada com busca (ADR 0027) e o detalhe
// com o motivo de "sem regra" ou "sem conta". A conferência do reprocessamento do período (regra 2) compara duas
// aplicações das regras; gravar as situações pede a senha (`contabil.regra.publicar`). M54.2: "Contabilizar os fatos"
// (`contabil.lancamento.criar`) grava os lançamentos dos fatos aguardando, lote a lote, sem esperar o ciclo automático.
import {
  type FatoListado,
  type OrigemLancamento,
  type ResultadoContabilizacaoLote,
  type ResultadoReprocessamento,
  rotuloDaFonte,
  SITUACOES_FATO,
  type SituacaoFato,
  type TipoFato,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import ErroContabil from './ErroContabil.vue';
import SenhaConfirmacao from '../administracao/componentes/SenhaConfirmacao.vue';
import { lerApoioFatos, lerFatos, lerResumoFatos, reprocessarPeriodo } from './api-contabil.js';
import { contabilizarFatos } from './api-lancamentos.js';
import {
  competenciasAte,
  dataBr,
  instante,
  reais,
  rotuloCompetencia,
  somaSituacoes,
} from './comum-contabil.js';

const props = defineProps<{ hoje?: string; podeContabilizar?: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const hoje = props.hoje ?? new Date().toISOString().slice(0, 10);
const apoio = useQuery({ queryKey: ['contabil', 'apoio-fatos'], queryFn: lerApoioFatos });
const a = computed(() => apoio.data.value ?? null);
const ligada = computed(() => a.value?.ligada === true && a.value.podeVerFatos);

const resumo = useQuery({
  queryKey: ['contabil', 'fatos', 'resumo'],
  queryFn: lerResumoFatos,
  enabled: ligada,
});
const r = computed(() => resumo.data.value ?? null);
const parcelasTotal = computed(() =>
  Object.entries(r.value?.totais ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([s, n]) => `${t(`contabil.situacoesFato.${s}`)} ${n}`)
    .join(' + '),
);

// ── Filtros e lista ────────────────────────────────────────────────────────────────────────────────
const empresa = ref<number | null>(null);
const competencia = ref<string | null>(null);
const origem = ref<OrigemLancamento | null>(null);
const tipoFato = ref<TipoFato | null>(null);
const situacao = ref<SituacaoFato | null>(null);
const pagina = ref(1);
const TAMANHO = 50;
const competencias = competenciasAte(hoje, 36);
const opcoesEmpresa = computed(() => [
  { valor: null as number | null, rotulo: t('contabil.todas') },
  ...(a.value?.empresas ?? []).map((e) => ({
    valor: e as number | null,
    rotulo: t('contabil.empresaN', { n: e }),
  })),
]);
const opcoesCompetencia = [
  { valor: null as string | null, rotulo: t('contabil.todas') },
  ...competencias.map((c) => ({ valor: c as string | null, rotulo: rotuloCompetencia(c) })),
];
const opcoesOrigem = computed(() => [
  { valor: null as OrigemLancamento | null, rotulo: t('contabil.todas') },
  ...(a.value?.origens ?? []).map((o) => ({ valor: o.id as OrigemLancamento | null, rotulo: o.rotulo })),
]);
const opcoesTipo = computed(() => [
  { valor: null as TipoFato | null, rotulo: t('contabil.todos') },
  ...(a.value?.tiposFato ?? [])
    .filter((x) => origem.value === null || x.origem === origem.value)
    .map((x) => ({ valor: x.codigo as TipoFato | null, rotulo: x.rotulo })),
]);
const opcoesSituacao = computed(() => [
  { valor: null as SituacaoFato | null, rotulo: t('contabil.todas') },
  ...(Object.keys(SITUACOES_FATO) as SituacaoFato[]).map((s) => ({
    valor: s as SituacaoFato | null,
    rotulo: t(`contabil.situacoesFato.${s}`),
  })),
]);
watch([empresa, competencia, origem, tipoFato, situacao], () => {
  pagina.value = 1;
});
watch(origem, () => {
  if (tipoFato.value && !opcoesTipo.value.some((x) => x.valor === tipoFato.value)) tipoFato.value = null;
});
const fatos = useQuery({
  queryKey: computed(() => [
    'contabil',
    'fatos',
    empresa.value,
    competencia.value,
    origem.value,
    tipoFato.value,
    situacao.value,
    pagina.value,
  ]),
  queryFn: () =>
    lerFatos({
      empresa: empresa.value,
      competencia: competencia.value,
      origem: origem.value,
      tipoFato: tipoFato.value,
      situacao: situacao.value,
      pagina: pagina.value,
      tamanho: TAMANHO,
    }),
  enabled: ligada,
});
const f = computed(() => fatos.data.value ?? null);
const paginas = computed(() => Math.max(1, Math.ceil((f.value?.total ?? 0) / TAMANHO)));
const aberto = ref<FatoListado | null>(null);

// ── Reprocessamento do período ──────────────────────────────────────────────────────────────────────
const repEmpresa = ref<number>(1);
watch(a, (x) => {
  if (x && !x.empresas.includes(repEmpresa.value)) repEmpresa.value = x.empresas[0] ?? 1;
});
const repCompetencia = ref<string>(competencias[0]!);
const opcoesRepEmpresa = computed(() =>
  (a.value?.empresas ?? [1]).map((e) => ({ valor: e, rotulo: t('contabil.empresaN', { n: e }) })),
);
const opcoesRepCompetencia = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));
const reprocessamento = ref<ResultadoReprocessamento | null>(null);
const senha = ref('');
const erroRep = ref<unknown>(null);
const ocupado = ref(false);
// ── Contabilizar (M54.2) ───────────────────────────────────────────────────────────────────────────
const contEmpresa = ref<number>(1);
watch(a, (x) => {
  if (x && !x.empresas.includes(contEmpresa.value)) contEmpresa.value = x.empresas[0] ?? 1;
});
const contCompetencia = ref<string | null>(null);
const incluirRecusados = ref(false);
const contabilizacao = ref<ResultadoContabilizacaoLote | null>(null);
const erroCont = ref<unknown>(null);
const contabilizando = ref(false);
async function contabilizar() {
  contabilizando.value = true;
  erroCont.value = null;
  try {
    contabilizacao.value = await contabilizarFatos({
      empresa: contEmpresa.value,
      ...(contCompetencia.value ? { competencia: contCompetencia.value } : {}),
      incluirRecusados: incluirRecusados.value,
    });
    await cliente.invalidateQueries({ queryKey: ['contabil'] });
  } catch (e) {
    erroCont.value = e;
  } finally {
    contabilizando.value = false;
  }
}

async function reprocessar(somenteConferir: boolean) {
  ocupado.value = true;
  erroRep.value = null;
  try {
    reprocessamento.value = await reprocessarPeriodo({
      empresa: repEmpresa.value,
      competencia: repCompetencia.value,
      somenteConferir,
      ...(somenteConferir ? {} : { senha: senha.value }),
    });
    if (!somenteConferir) await cliente.invalidateQueries({ queryKey: ['contabil', 'fatos'] });
  } catch (e) {
    erroRep.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <div data-testid="tela-fatos">
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('contabil.carregando') }}</p>
    <SanteAlerta
      v-else-if="!a.ligada"
      :texto="a.motivo ?? t('contabil.desligada')"
      variante="info"
      data-testid="contabil-desligada"
    />
    <p v-else-if="!a.podeVerFatos" data-testid="fatos-sem-permissao">
      {{ t('contabil.fatos.semPermissao') }}
    </p>
    <template v-else>
      <section class="bloco" aria-labelledby="fatos-titulo" data-testid="aba-fatos">
        <h2 id="fatos-titulo">{{ t('contabil.fatos.titulo') }}</h2>
        <p class="secundario">{{ t('contabil.fatos.descricao') }}</p>

        <h3>{{ t('contabil.fatos.resumo') }}</h3>
        <MensagemErro v-if="resumo.isError.value" :erro="resumo.error.value" />
        <p v-else-if="!r" role="status">{{ t('contabil.carregando') }}</p>
        <template v-else>
          <div class="rolagem">
            <table class="tabela" data-testid="tabela-resumo-fatos">
              <thead>
                <tr>
                  <th scope="col">{{ t('contabil.fatos.fonte') }}</th>
                  <th scope="col">{{ t('contabil.fatos.tipos') }}</th>
                  <th scope="col">{{ t('contabil.fatos.marca') }}</th>
                  <th scope="col">{{ t('contabil.fatos.ultimaLeituraColuna') }}</th>
                  <th scope="col">{{ t('contabil.fatos.lidosNovos') }}</th>
                  <th scope="col">{{ t('contabil.fatos.lidosAlterados') }}</th>
                  <th scope="col">{{ t('contabil.fatos.situacoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in r.fontes" :key="x.fonte" :data-testid="`resumo-fonte-${x.fonte}`">
                  <td>{{ rotuloDaFonte(x.fonte) }}</td>
                  <td>{{ x.tipos.join(', ') }}</td>
                  <td>{{ x.marca }}</td>
                  <td>{{ x.ultimaLeitura ? instante(x.ultimaLeitura) : t('contabil.fatos.nunca') }}</td>
                  <td>{{ x.lidosNovos }}</td>
                  <td>{{ x.lidosAlterados }}</td>
                  <td>
                    <span v-for="(n, s) in x.porSituacao" :key="s" class="marca">
                      {{ t(`contabil.situacoesFato.${s}`) }}: {{ n }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p data-testid="resumo-total">
            {{
              t('contabil.fatos.total', { total: somaSituacoes(r.totais), parcelas: parcelasTotal || '0' })
            }}
          </p>
        </template>

        <h3>{{ t('contabil.fatos.lista') }}</h3>
        <div class="campos" data-testid="fatos-filtros">
          <SanteSelecao
            v-model="empresa"
            :rotulo="t('contabil.empresa')"
            :opcoes="opcoesEmpresa"
            busca
            data-testid="fatos-empresa"
          />
          <SanteSelecao
            v-model="competencia"
            :rotulo="t('contabil.competencia')"
            :opcoes="opcoesCompetencia"
            busca
            data-testid="fatos-competencia"
          />
          <SanteSelecao
            v-model="origem"
            :rotulo="t('contabil.regras.origem')"
            :opcoes="opcoesOrigem"
            busca
            data-testid="fatos-origem"
          />
          <SanteSelecao
            v-model="tipoFato"
            :rotulo="t('contabil.regras.tipoFato')"
            :opcoes="opcoesTipo"
            busca
            data-testid="fatos-tipo"
          />
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('contabil.fatos.situacao')"
            :opcoes="opcoesSituacao"
            busca
            data-testid="fatos-situacao"
          />
        </div>
        <MensagemErro v-if="fatos.isError.value" :erro="fatos.error.value" />
        <p v-else-if="!f" role="status">{{ t('contabil.carregando') }}</p>
        <p v-else-if="f.itens.length === 0" data-testid="fatos-vazio">{{ t('contabil.nenhum') }}</p>
        <template v-else>
          <div class="rolagem">
            <table class="tabela" data-testid="tabela-fatos">
              <thead>
                <tr>
                  <th scope="col">{{ t('contabil.data') }}</th>
                  <th scope="col">{{ t('contabil.fatos.fonte') }}</th>
                  <th scope="col">{{ t('contabil.regras.tipoFato') }}</th>
                  <th scope="col">{{ t('contabil.fatos.documento') }}</th>
                  <th scope="col">{{ t('contabil.valor') }}</th>
                  <th scope="col">{{ t('contabil.fatos.situacao') }}</th>
                  <th scope="col">{{ t('contabil.acoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in f.itens" :key="x.id" :data-testid="`fato-${x.id}`">
                  <td>{{ dataBr(x.data) }}</td>
                  <td>{{ rotuloDaFonte(x.fonte) }}</td>
                  <td>
                    {{ x.tipoRotulo }}
                    <span v-if="x.estorno" class="secundario">({{ t('contabil.fatos.estorno') }})</span>
                  </td>
                  <td>{{ x.documento }}</td>
                  <td>{{ reais(x.valorCentavos) }}</td>
                  <td>{{ x.situacaoRotulo }}</td>
                  <td>
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('contabil.plano.detalhe')"
                      :data-testid="`fato-detalhe-${x.id}`"
                      @acionar="aberto = x"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="acoes" data-testid="fatos-paginacao">
            <SanteBotao
              variante="secundario"
              :rotulo="t('contabil.anterior')"
              :desabilitado="pagina <= 1"
              data-testid="fatos-anterior"
              @acionar="pagina--"
            />
            <span>{{ t('contabil.pagina', { pagina, paginas, total: f.total }) }}</span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('contabil.proxima')"
              :desabilitado="pagina >= paginas"
              data-testid="fatos-proxima"
              @acionar="pagina++"
            />
          </div>
        </template>

        <section v-if="aberto" class="bloco" aria-labelledby="fato-detalhe-titulo" data-testid="fato-detalhe">
          <h4 id="fato-detalhe-titulo">{{ aberto.tipoRotulo }}: {{ aberto.documento }}</h4>
          <dl class="dados">
            <dt>{{ t('contabil.fatos.fonte') }}</dt>
            <dd>{{ rotuloDaFonte(aberto.fonte) }}</dd>
            <dt>{{ t('contabil.empresa') }}</dt>
            <dd>{{ aberto.empresa }}</dd>
            <dt>{{ t('contabil.competencia') }}</dt>
            <dd>{{ rotuloCompetencia(aberto.competencia) }}</dd>
            <dt>{{ t('contabil.valor') }}</dt>
            <dd>{{ reais(aberto.valorCentavos) }}</dd>
            <dt>{{ t('contabil.fatos.centroCusto') }}</dt>
            <dd>{{ aberto.centroCusto ?? '—' }}</dd>
            <dt>{{ t('contabil.fatos.situacao') }}</dt>
            <dd>{{ aberto.situacaoRotulo }}</dd>
            <dt>{{ t('contabil.fatos.motivo') }}</dt>
            <dd data-testid="fato-motivo">{{ aberto.motivo ?? '—' }}</dd>
            <dt>{{ t('contabil.fatos.lidoEm') }}</dt>
            <dd>{{ instante(aberto.lidoEm) }}</dd>
          </dl>
          <p v-if="aberto.situacao === 'semConta'" data-testid="fato-sem-conta">
            {{ t('contabil.fatos.semContaAjuda') }}
            <RouterLink to="/financeiro/contabil/exportacao">{{
              t('contabil.fatos.tabelaIntegracao')
            }}</RouterLink>
          </p>
          <p v-else-if="aberto.situacao === 'semRegra'" data-testid="fato-sem-regra">
            {{ t('contabil.fatos.semRegraAjuda') }}
            <RouterLink to="/contabil/plano">{{ t('contabil.fatos.irParaRegras') }}</RouterLink>
          </p>
          <div class="acoes">
            <SanteBotao variante="secundario" :rotulo="t('contabil.fechar')" @acionar="aberto = null" />
          </div>
        </section>

        <section
          v-if="podeContabilizar"
          class="bloco"
          aria-labelledby="contabilizar-titulo"
          data-testid="fatos-contabilizar"
        >
          <h3 id="contabilizar-titulo">{{ t('contabil.lancamentos.contabilizar') }}</h3>
          <p class="secundario">{{ t('contabil.lancamentos.contabilizarAjuda') }}</p>
          <div class="campos">
            <SanteSelecao
              v-model="contEmpresa"
              :rotulo="t('contabil.empresa')"
              :opcoes="opcoesRepEmpresa"
              busca
              data-testid="contabilizar-empresa"
            />
            <SanteSelecao
              v-model="contCompetencia"
              :rotulo="t('contabil.competencia')"
              :opcoes="opcoesCompetencia"
              busca
              data-testid="contabilizar-competencia"
            />
          </div>
          <label class="marca">
            <input v-model="incluirRecusados" type="checkbox" data-testid="contabilizar-recusados" />
            {{ t('contabil.lancamentos.incluirRecusados') }}
          </label>
          <div class="acoes">
            <SanteBotao
              :rotulo="
                contabilizacao?.restam
                  ? t('contabil.lancamentos.contabilizarDeNovo')
                  : t('contabil.lancamentos.contabilizar')
              "
              :desabilitado="contabilizando"
              data-testid="contabilizar-acionar"
              @acionar="contabilizar"
            />
          </div>
          <div v-if="contabilizacao" role="status" data-testid="contabilizar-resultado">
            <p>{{ contabilizacao.mensagem }}</p>
            <p>
              {{
                t('contabil.lancamentos.resultadoContabilizacao', {
                  fatos: contabilizacao.fatos,
                  lancamentos: contabilizacao.lancamentos,
                  debitos: reais(contabilizacao.totais.debitos),
                  creditos: reais(contabilizacao.totais.creditos),
                })
              }}
            </p>
          </div>
          <ErroContabil v-if="erroCont" :erro="erroCont" />
        </section>

        <section
          v-if="a.podePublicar"
          class="bloco"
          aria-labelledby="reprocessar-titulo"
          data-testid="fatos-reprocessar"
        >
          <h3 id="reprocessar-titulo">{{ t('contabil.fatos.reprocessar') }}</h3>
          <div class="campos">
            <SanteSelecao
              v-model="repEmpresa"
              :rotulo="t('contabil.empresa')"
              :opcoes="opcoesRepEmpresa"
              busca
              data-testid="reprocessar-empresa"
            />
            <SanteSelecao
              v-model="repCompetencia"
              :rotulo="t('contabil.competencia')"
              :opcoes="opcoesRepCompetencia"
              busca
              data-testid="reprocessar-competencia"
            />
            <div class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('contabil.fatos.conferir')"
                :desabilitado="ocupado"
                data-testid="reprocessar-conferir"
                @acionar="reprocessar(true)"
              />
            </div>
          </div>
          <div v-if="reprocessamento" data-testid="reprocessar-resultado">
            <p>
              {{
                t('contabil.fatos.reprocessamento', {
                  competencia: rotuloCompetencia(reprocessamento.competencia),
                  iguais: reprocessamento.iguais,
                  diferentes: reprocessamento.diferentes,
                })
              }}
            </p>
            <p>{{ reprocessamento.mensagem }}</p>
            <p v-if="reprocessamento.identico" data-testid="reprocessar-identico">
              {{ t('contabil.fatos.reprocessamentoIdentico') }}
            </p>
            <p>
              {{
                t('contabil.fatos.reprocessamentoTotais', {
                  fatos: reprocessamento.fatos,
                  debitos: reais(reprocessamento.totais.debitos),
                  creditos: reais(reprocessamento.totais.creditos),
                  alteradas: reprocessamento.situacoesAlteradas,
                })
              }}
            </p>
            <template
              v-if="
                reprocessamento.somenteConferir &&
                reprocessamento.identico &&
                !reprocessamento.parcial &&
                reprocessamento.situacoesAlteradas > 0
              "
            >
              <SenhaConfirmacao v-model="senha" testid="reprocessar-senha" />
              <div class="acoes">
                <SanteBotao
                  :rotulo="t('contabil.fatos.gravarReprocessamento')"
                  :desabilitado="ocupado || !senha"
                  data-testid="reprocessar-gravar"
                  @acionar="reprocessar(false)"
                />
              </div>
            </template>
          </div>
          <MensagemErro v-if="erroRep" :erro="erroRep" />
        </section>
      </section>
    </template>
  </div>
</template>

<style scoped src="./estilo-contabil.css"></style>
