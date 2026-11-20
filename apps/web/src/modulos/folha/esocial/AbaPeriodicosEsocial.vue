<script setup lang="ts">
// Aba "Periódicos" (M53.7, etapa F6; consulta com `pessoas.esocial.ler`; gerar com `pessoas.esocial.gerar`; ficha do
// M53, seções 7 e 8, regras 1, 9 e 10): o período de apuração (mensal ou o 13º do ano) do empregador, a situação do
// fechamento da folha, as contagens do S-1200 e do S-1210 (esperados, por situação, aceitos e sem evento; nunca o
// trabalhador), os recibos de autônomo do repasse, as pendências do fechamento e as ações que o painel libera: gerar
// o S-1200 e o S-1210 dos sem evento (ou o S-1200 de todos, retificando os aceitos), o S-1299 e o S-1298 — sempre pela
// prévia conferida no leiaute oficial antes de gravar. Os gravados seguem pela aba Lotes. O servidor confere de novo.
import {
  APURACOES_FOLHA,
  type ApoioEsocial,
  type ApuracaoFolha,
  type ContagemPeriodicoEsocial,
  type ResultadoGeracaoEsocial,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { dataBr } from '../../pessoas/comum.js';
import { competenciasAte, instanteBr, rotuloCompetencia } from '../comum-folha.js';
import { anosAte, periodoSugerido, rotuloPeriodo } from '../fechamento/comum-fechamento.js';
import ErroFolha from '../telas/ErroFolha.vue';
import {
  gerarFechamentoEsocial,
  gerarPagamentosEsocial,
  gerarReaberturaEsocial,
  gerarRemuneracaoEsocial,
  lerPainelPeriodicos,
} from './api-esocial.js';
import { pedidosDoPainel, type PedidoPeriodico } from './comum-periodicos.js';
import { rotuloEvento } from './comum-esocial.js';

const props = defineProps<{ apoio: ApoioEsocial; empresa: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const rotulo = (ap: ApuracaoFolha, p: string) =>
  rotuloPeriodo(ap, p, (ano) => t('folha.fechamento.rotuloAnual', { ano }));

const apuracao = ref<ApuracaoFolha>('mensal');
const opcoesApuracao = APURACOES_FOLHA.map((a) => ({
  valor: a,
  rotulo: t(`folha.fechamento.apuracoes.${a}`),
}));
const periodo = ref<string>(periodoSugerido('mensal', props.apoio.hoje));
watch(apuracao, (a) => (periodo.value = periodoSugerido(a, props.apoio.hoje)));
const opcoesPeriodo = computed(() =>
  apuracao.value === 'mensal'
    ? competenciasAte(props.apoio.hoje, 24).map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }))
    : anosAte(props.apoio.hoje).map((a) => ({ valor: a, rotulo: a })),
);
const chave = computed(() => [
  'folha',
  'esocial',
  'periodicos',
  props.empresa,
  apuracao.value,
  periodo.value,
]);
const q = useQuery({
  queryKey: chave,
  queryFn: () =>
    lerPainelPeriodicos({ empresa: props.empresa, apuracao: apuracao.value, periodo: periodo.value }),
});
const p = computed(() => q.data.value ?? null);
const pedidos = computed(() => (p.value ? pedidosDoPainel(p.value, props.apoio.acoes.gerar) : []));
const linhas = computed(() =>
  p.value
    ? [
        { nome: 'remuneracao' as const, c: p.value.remuneracao },
        ...(p.value.pagamentos ? [{ nome: 'pagamentos' as const, c: p.value.pagamentos }] : []),
      ]
    : [],
);
const situacoesDe = (c: ContagemPeriodicoEsocial) => Object.entries(c.porSituacao).filter(([, n]) => n > 0);

// ── Prévia e gravação ─────────────────────────────────────────────────────────────────────────────────────────
const pedido = ref<PedidoPeriodico | null>(null);
const resultado = ref<ResultadoGeracaoEsocial | null>(null);
const resultadoVisivel = ref(false);
const erro = ref<unknown>(null);
const erroResultado = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
function executar(x: PedidoPeriodico, gravar: boolean): Promise<ResultadoGeracaoEsocial> {
  const base = { empresa: props.empresa, apuracao: apuracao.value, periodo: periodo.value, gravar };
  if (x.tipo === 'remuneracao') return gerarRemuneracaoEsocial({ ...base, vinculos: [...x.vinculos] });
  if (x.tipo === 'pagamentos')
    return gerarPagamentosEsocial({
      empresa: props.empresa,
      periodo: periodo.value,
      vinculos: [...x.vinculos],
      gravar,
    });
  if (x.tipo === 'fechamento') return gerarFechamentoEsocial(base);
  return gerarReaberturaEsocial(base);
}
async function previa(x: PedidoPeriodico): Promise<void> {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    resultado.value = await executar(x, false);
    pedido.value = x;
    erroResultado.value = null;
    resultadoVisivel.value = true;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const podeGravar = computed(
  () =>
    !!pedido.value &&
    !!resultado.value &&
    !resultado.value.gravado &&
    resultado.value.eventos.some((e) => e.valido && e.pendencias.length === 0),
);
async function gravar(): Promise<void> {
  if (!pedido.value) return;
  erroResultado.value = null;
  ocupado.value = true;
  try {
    const r = await executar(pedido.value, true);
    resultado.value = r;
    const n = r.eventos.filter((e) => e.id !== null).length;
    aviso.value = n ? t('folha.esocial.previa.gravados', { n }) : t('folha.esocial.previa.nadaGravado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'esocial'] });
  } catch (e) {
    erroResultado.value = e;
  } finally {
    ocupado.value = false;
  }
}
const rotuloPedido = (x: PedidoPeriodico) =>
  t(`folha.esocial.periodicos.${x.rotulo}`, { n: x.vinculos.length });
</script>

<template>
  <section class="bloco" :aria-label="t('folha.esocial.periodicos.titulo')" data-testid="esocial-periodicos">
    <h2>{{ t('folha.esocial.periodicos.titulo') }}</h2>
    <p class="secundario">{{ t('folha.esocial.periodicos.ajuda') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso"
      variante="info"
      anunciar
      data-testid="esocial-periodicos-aviso"
    />
    <ErroFolha v-if="erro" :erro="erro" />
    <div class="campos">
      <SanteSelecao
        v-model="apuracao"
        :rotulo="t('folha.esocial.periodicos.apuracao')"
        :opcoes="opcoesApuracao"
        data-testid="esocial-periodicos-apuracao"
      />
      <SanteSelecao
        v-model="periodo"
        :rotulo="t('folha.esocial.periodicos.periodo')"
        :opcoes="opcoesPeriodo"
        busca
        data-testid="esocial-periodicos-periodo"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!p" role="status">{{ t('folha.esocial.carregando') }}</p>
    <template v-else>
      <h3>{{ t('folha.esocial.periodicos.folha') }}</h3>
      <p data-testid="esocial-periodicos-folha">
        <template v-if="p.folha">
          {{
            t('folha.esocial.periodicos.folhaFechada', {
              n: p.folha.numero,
              por: p.folha.fechadoPor,
              em: instanteBr(p.folha.fechadoEm),
            })
          }}
        </template>
        <template v-else>{{ t('folha.esocial.periodicos.folhaAberta') }}</template>
        <template v-if="p.acoes.fecharFolha || p.acoes.reabrirFolha">
          ·
          <RouterLink to="/pessoas/folha?aba=fechamento" data-testid="esocial-periodicos-ir-folha">{{
            t('folha.esocial.periodicos.abrirFechamento')
          }}</RouterLink>
        </template>
      </p>
      <p data-testid="esocial-periodicos-situacao">
        {{ t('folha.esocial.periodicos.situacaoPeriodo') }}:
        <strong>{{ t(`folha.esocial.periodicos.situacoes.${p.situacao}`) }}</strong>
        <span v-if="p.eventoFechamento">
          · {{ t('folha.esocial.periodicos.eventoFechamento', { id: p.eventoFechamento }) }}</span
        >
      </p>

      <div class="rolagem" tabindex="0" role="region" :aria-label="t('folha.esocial.periodicos.titulo')">
        <table class="tabela" data-testid="esocial-periodicos-contagens">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.esocial.periodicos.titulo') }}</th>
              <th scope="col">{{ t('folha.esocial.periodicos.esperados') }}</th>
              <th scope="col">{{ t('folha.esocial.periodicos.aceitos') }}</th>
              <th scope="col">{{ t('folha.esocial.periodicos.semEvento') }}</th>
              <th scope="col">{{ t('folha.esocial.periodicos.porSituacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="{ nome, c } in linhas" :key="nome">
              <tr :data-testid="`esocial-periodicos-${nome}`">
                <th scope="row">{{ t(`folha.esocial.periodicos.${nome}`) }}</th>
                <td :data-testid="`esocial-periodicos-${nome}-esperados`">{{ c.esperados }}</td>
                <td :data-testid="`esocial-periodicos-${nome}-aceitos`">{{ c.aceitos }}</td>
                <td :data-testid="`esocial-periodicos-${nome}-sem-evento`">{{ c.semEvento.length }}</td>
                <td>
                  <template v-if="situacoesDe(c).length">
                    <span v-for="([s, n], i) in situacoesDe(c)" :key="s"
                      >{{ i ? ' · ' : '' }}{{ t(`folha.esocial.situacoesEvento.${s}`) }}: {{ n }}</span
                    >
                  </template>
                  <template v-else>{{ t('folha.esocial.periodicos.nenhumaSituacao') }}</template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-if="apuracao === 'anual'" class="secundario">{{ t('folha.esocial.periodicos.soAnual') }}</p>
      <p v-if="p.repasse > 0" class="secundario" data-testid="esocial-periodicos-repasse">
        {{ t('folha.esocial.periodicos.repasse', { n: p.repasse }) }}
      </p>

      <template v-if="p.pendencias.length">
        <p role="alert">{{ t('folha.esocial.periodicos.pendencias') }}</p>
        <ul class="lista" data-testid="esocial-periodicos-pendencias">
          <li
            v-for="x in p.pendencias"
            :key="x.codigo"
            :data-testid="`esocial-periodicos-pendencia-${x.codigo}`"
          >
            {{ x.mensagem }}
          </li>
        </ul>
      </template>
      <p v-else class="secundario" data-testid="esocial-periodicos-sem-pendencias">
        {{ t('folha.esocial.periodicos.semPendencias') }}
      </p>

      <div v-if="pedidos.length" class="acoes" data-testid="esocial-periodicos-acoes">
        <SanteBotao
          v-for="x in pedidos"
          :key="x.rotulo"
          :rotulo="rotuloPedido(x)"
          :variante="x.principal ? 'primario' : 'secundario'"
          :desabilitado="ocupado"
          :data-testid="`esocial-periodicos-${x.rotulo}`"
          @acionar="previa(x)"
        />
      </div>
      <p class="secundario">{{ t('folha.esocial.periodicos.mandarLote') }}</p>
    </template>

    <SanteDialogo
      v-model:visivel="resultadoVisivel"
      :titulo="
        resultado?.gravado ? t('folha.esocial.previa.tituloGravado') : t('folha.esocial.previa.titulo')
      "
      largura="60rem"
    >
      <div v-if="resultado" data-testid="esocial-periodicos-resultado">
        <p class="secundario">{{ rotulo(apuracao, periodo) }}</p>
        <ErroFolha v-if="erroResultado" :erro="erroResultado" />
        <article
          v-for="(g, i) in resultado.eventos"
          :key="i"
          class="bloco"
          :data-testid="`esocial-periodicos-resultado-${g.evento}-${i}`"
        >
          <h3>
            {{ rotuloEvento(g.evento) }} · {{ dataBr(g.dataReferencia) }}
            <span v-if="g.id"> · {{ g.id }}</span>
          </h3>
          <template v-if="g.pendencias.length">
            <p role="alert">{{ t('folha.esocial.previa.pendencias') }}</p>
            <ul class="lista">
              <li v-for="x in g.pendencias" :key="x.codigo">{{ x.mensagem }}</li>
            </ul>
          </template>
          <p v-else-if="g.valido" class="secundario" :data-testid="`esocial-periodicos-valido-${i}`">
            {{ t('folha.esocial.previa.valido') }}
          </p>
          <template v-else>
            <p role="alert">{{ t('folha.esocial.previa.invalido') }}</p>
            <ul class="lista">
              <li v-for="(x, j) in g.errosXsd" :key="j">{{ x }}</li>
            </ul>
          </template>
          <details v-if="g.xml">
            <summary>{{ t('folha.esocial.previa.xml') }}</summary>
            <pre class="rolagem" tabindex="0">{{ g.xml }}</pre>
          </details>
        </article>
        <div class="acoes">
          <SanteBotao
            v-if="podeGravar"
            :rotulo="t('folha.esocial.previa.gravar')"
            :desabilitado="ocupado"
            data-testid="esocial-periodicos-gravar"
            @acionar="gravar"
          />
          <SanteBotao
            :rotulo="t('folha.esocial.fechar')"
            variante="secundario"
            data-testid="esocial-periodicos-resultado-fechar"
            @acionar="resultadoVisivel = false"
          />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
