<script setup lang="ts">
// Aba "Lançar títulos" (M53.9, etapa F8; prévia com `pessoas.integracao.ler`, lançar com `pessoas.integracao.lancar`;
// ficha do M53, seções 5 a 8, regras 6 e 10): as origens do ano (períodos fechados e retornos da folha externa), a prévia
// com um título por destino e vencimento, a conta impressa (parcelas e total), a prova da soma, as pendências que barram,
// os avisos de possível lançamento manual, o vencimento ajustável título a título, os fatos contábeis por centro de custo
// e o lançamento com o resumo da prévia conferida (o plano mudou, o servidor recusa).
import type {
  ApoioIntegracaoFolha,
  AvisoTituloFolha,
  OrigemTitulosFolha,
  PendenciaTituloFolha,
  PreviaTitulosFolha,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import { reais } from '../comum-folha.js';
import { anosAte, rotuloPeriodo } from '../fechamento/comum-fechamento.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lancarTitulos, lerOrigens, previaTitulos } from './api-integracao.js';
import { entradaLancar, somaConfere, vencimentoDe, vencimentosAntesDaEmissao } from './comum-integracao.js';

const props = defineProps<{ apoio: ApoioIntegracaoFolha; empresa: number; podeLancar: boolean }>();
const { t, te } = useI18n();
const cliente = useQueryClient();

const anos = anosAte(props.apoio.hoje);
const ano = ref<string>(anos[0]!);
const opcoesAno = anos.map((a) => ({ valor: a, rotulo: a }));
const origens = useQuery({
  queryKey: computed(() => ['folha', 'integracao', 'origens', props.empresa, ano.value]),
  queryFn: () => lerOrigens(props.empresa, Number(ano.value)),
});
const periodo = (apuracao: OrigemTitulosFolha['apuracao'], p: string) =>
  rotuloPeriodo(apuracao, p, (a) => t('folha.integracao.rotuloAnual', { ano: a }));
const situacaoOrigem = (o: OrigemTitulosFolha) => {
  const k =
    o.origem === 'fechamento'
      ? `folha.integracao.situacoesFechamento.${o.situacao}`
      : `folha.interface.situacoes.${o.situacao}`;
  return te(k) ? t(k) : o.situacao;
};
const rotuloOrigem = (o: OrigemTitulosFolha) =>
  `${t('folha.integracao.rotuloOrigem', {
    periodo: periodo(o.apuracao, o.periodo),
    origem: t(`folha.integracao.origens.${o.origem}`),
    n: o.numero,
  })} (${situacaoOrigem(o)}${o.lancamento ? ` · ${t('folha.integracao.lancar.jaLancada')}` : ''})`;
const itens = computed(() => origens.data.value?.itens ?? []);
const opcoesOrigem = computed(() =>
  itens.value.map((o) => ({ valor: `${o.origem}:${o.id}`, rotulo: rotuloOrigem(o) })),
);
const escolhida = ref<string | null>(null);
// `immediate`: ao voltar à aba, as origens já vêm do cache da consulta e a sugestão precisa sair do mesmo jeito.
watch(
  itens,
  (xs) => {
    // A sugestão é a origem mais nova ainda não lançada (a escolha da pessoa fica enquanto existir).
    if (xs.some((o) => `${o.origem}:${o.id}` === escolhida.value)) return;
    const livre = xs.find((o) => o.lancamento === null);
    escolhida.value = livre ? `${livre.origem}:${livre.id}` : null;
  },
  { immediate: true },
);
const origem = computed(() => itens.value.find((o) => `${o.origem}:${o.id}` === escolhida.value) ?? null);

// ── Prévia ────────────────────────────────────────────────────────────────────────────────────────────────────
const previa = ref<PreviaTitulosFolha | null>(null);
const visivel = ref(false);
const emissao = ref<string | null>(props.apoio.hoje);
const ajustes = reactive<Record<string, string | null>>({});
const erro = ref<unknown>(null);
const erroPrevia = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
const credorNome = computed(() => new Map(props.apoio.credores.map((c) => [c.codigo, c.nome])));
const classificacaoNome = computed(
  () => new Map(props.apoio.classificacoes.map((c) => [`${c.grupo}.${c.subgrupo}.${c.item}`, c.nome])),
);
const rotinaNome = computed(() => new Map(props.apoio.rotinas.map((r) => [r.id, r.nome])));

async function conferir(): Promise<void> {
  const o = origem.value;
  if (!o) return;
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    previa.value = await previaTitulos({ empresa: props.empresa, origem: o.origem, id: o.id });
    for (const k of Object.keys(ajustes)) delete ajustes[k];
    erroPrevia.value = null;
    visivel.value = true;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const antes = computed(() =>
  previa.value ? vencimentosAntesDaEmissao(previa.value, emissao.value, ajustes) : [],
);
const entrada = computed(() => entradaLancar(previa.value, emissao.value, ajustes));
const textoPendencia = (p: PendenciaTituloFolha) =>
  `${t(`folha.integracao.pendencia.${p.codigo}`)}${
    p.destino ? `: ${t(`folha.integracao.destinos.${p.destino}`)}` : ''
  }`;
const textoAviso = (a: AvisoTituloFolha) =>
  t(`folha.integracao.aviso.${a.codigo}`, {
    destino: t(`folha.integracao.destinos.${a.destino}`),
    n: a.titulos,
  });

async function lancar(): Promise<void> {
  if (!entrada.value) return;
  erroPrevia.value = null;
  ocupado.value = true;
  try {
    const r = await lancarTitulos(entrada.value);
    aviso.value = t('folha.integracao.lancar.lancado', { n: r.lancamento.id, conta: r.conta });
    visivel.value = false;
    await cliente.invalidateQueries({ queryKey: ['folha', 'integracao'] });
  } catch (x) {
    erroPrevia.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.integracao.abas.lancar')" data-testid="integracao-lancar">
    <h2>{{ t('folha.integracao.abas.lancar') }}</h2>
    <p class="secundario">{{ t('folha.integracao.lancar.ajuda') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="integracao-lancado" />
    <ErroFolha v-if="erro" :erro="erro" />
    <form class="bloco" data-testid="integracao-lancar-form" @submit.prevent="conferir">
      <div class="campos">
        <SanteSelecao
          v-model="ano"
          :rotulo="t('folha.integracao.lancar.ano')"
          :opcoes="opcoesAno"
          data-testid="integracao-ano"
        />
        <SanteSelecao
          v-if="itens.length"
          v-model="escolhida"
          :rotulo="t('folha.integracao.lancar.origem')"
          :opcoes="opcoesOrigem"
          busca
          data-testid="integracao-origem"
        />
      </div>
      <ErroFolha v-if="origens.isError.value" :erro="origens.error.value" />
      <p v-else-if="!origens.data.value" role="status">{{ t('folha.integracao.carregando') }}</p>
      <p v-else-if="itens.length === 0" data-testid="integracao-sem-origens">
        {{ t('folha.integracao.lancar.semOrigens') }}
      </p>
      <SanteBotao
        :rotulo="t('folha.integracao.lancar.previa')"
        tipo="submit"
        :desabilitado="ocupado || !origem"
        data-testid="integracao-previa"
      />
    </form>

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="
        previa
          ? `${t('folha.integracao.lancar.previaTitulo')} · ${periodo(previa.apuracao, previa.periodo)}`
          : ''
      "
      largura="72rem"
    >
      <div v-if="previa" data-testid="integracao-previa-resultado">
        <ErroFolha v-if="erroPrevia" :erro="erroPrevia" />
        <template v-if="previa.pendencias.length">
          <p role="alert">{{ t('folha.integracao.lancar.pendencias') }}</p>
          <ul class="lista" data-testid="integracao-pendencias">
            <li
              v-for="(p, i) in previa.pendencias"
              :key="i"
              :data-testid="`integracao-pendencia-${p.codigo}`"
            >
              {{ textoPendencia(p) }}
            </li>
          </ul>
        </template>
        <p v-else class="secundario" data-testid="integracao-sem-pendencias">
          {{ t('folha.integracao.lancar.semPendencias') }}
        </p>
        <template v-if="previa.avisos.length">
          <p>{{ t('folha.integracao.lancar.avisos') }}</p>
          <ul class="lista" data-testid="integracao-avisos">
            <li v-for="(a, i) in previa.avisos" :key="i" :data-testid="`integracao-aviso-${a.destino}`">
              {{ textoAviso(a) }}
            </li>
          </ul>
        </template>

        <div class="campos">
          <SanteData
            v-model="emissao"
            :rotulo="t('folha.integracao.lancar.emissao')"
            editavel
            data-testid="integracao-emissao"
          />
        </div>
        <p class="secundario">{{ t('folha.integracao.lancar.emissaoAjuda') }}</p>
        <div
          class="rolagem"
          tabindex="0"
          role="region"
          :aria-label="t('folha.integracao.lancar.previaTitulo')"
        >
          <table class="tabela" data-testid="integracao-titulos">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.integracao.lancar.destino') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.credor') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.classificacao') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.documento') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.referente') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.valor') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.vencimento') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in previa.titulos" :key="x.chave" :data-testid="`integracao-titulo-${x.destino}`">
                <th scope="row">{{ t(`folha.integracao.destinos.${x.destino}`) }}</th>
                <td>
                  <template v-if="x.credor !== null">
                    {{ x.credor
                    }}<span v-if="credorNome.get(x.credor)"> — {{ credorNome.get(x.credor) }}</span>
                  </template>
                  <span v-else class="secundario">{{ t('folha.integracao.lancar.semCredor') }}</span>
                </td>
                <td>
                  <template v-if="x.classificacao">
                    {{ x.classificacao.grupo }}.{{ x.classificacao.subgrupo }}.{{ x.classificacao.item }}
                    <span class="secundario">{{
                      classificacaoNome.get(
                        `${x.classificacao.grupo}.${x.classificacao.subgrupo}.${x.classificacao.item}`,
                      ) ?? ''
                    }}</span>
                  </template>
                  <span v-else class="secundario">{{ t('folha.integracao.lancar.semCredor') }}</span>
                </td>
                <td>{{ x.documento }}</td>
                <td>{{ x.referente }}</td>
                <td>{{ reais(x.valor) }}</td>
                <td>
                  <SanteData
                    v-if="podeLancar && previa.podeLancar"
                    :model-value="vencimentoDe(x, ajustes)"
                    :rotulo="t('folha.integracao.lancar.vencimento')"
                    editavel
                    :data-testid="`integracao-vencimento-${x.destino}`"
                    @update:model-value="(v: string | null) => (ajustes[x.chave] = v)"
                  />
                  <template v-else>{{ dataBr(x.vencimento) }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <SanteAlerta
          v-if="antes.length"
          :texto="t('folha.integracao.lancar.vencimentoAntes')"
          variante="aviso"
          data-testid="integracao-vencimento-antes"
        />

        <h3>{{ t('folha.integracao.lancar.conta') }}</h3>
        <ul class="lista" data-testid="integracao-parcelas">
          <li v-for="(p, i) in previa.parcelas" :key="i">{{ p.rotulo }}: {{ reais(p.valor) }}</li>
        </ul>
        <p data-testid="integracao-conta">
          <strong>{{ previa.conta }}</strong>
        </p>
        <p :role="somaConfere(previa) ? undefined : 'alert'" data-testid="integracao-soma">
          {{
            somaConfere(previa)
              ? t('folha.integracao.lancar.somaConfere')
              : t('folha.integracao.lancar.somaDiverge', {
                  total: reais(previa.total),
                  esperado: reais(previa.esperado),
                })
          }}
        </p>

        <h3>{{ t('folha.integracao.lancar.fatos') }}</h3>
        <div class="rolagem" tabindex="0" role="region" :aria-label="t('folha.integracao.lancar.fatos')">
          <table class="tabela" data-testid="integracao-fatos">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.integracao.lancar.centro') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.rotina') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.natureza') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.contabiliza') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.valor') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(f, i) in previa.fatos" :key="i">
                <th scope="row">{{ f.centroCusto }}</th>
                <td>{{ f.rotina }} — {{ rotinaNome.get(f.rotina) ?? '' }}</td>
                <td>{{ t(`folha.integracao.lancar.naturezas.${f.natureza}`) }}</td>
                <td>
                  {{ f.contabiliza ? t('folha.integracao.lancar.sim') : t('folha.integracao.lancar.nao') }}
                </td>
                <td>{{ reais(f.valor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="secundario" data-testid="integracao-resumo">
          {{ t('folha.integracao.lancar.resumo') }}: <code>{{ previa.resumo }}</code>
        </p>
        <div class="acoes">
          <SanteBotao
            v-if="podeLancar && previa.podeLancar"
            :rotulo="t('folha.integracao.lancar.confirmar')"
            :desabilitado="ocupado || !entrada"
            data-testid="integracao-confirmar"
            @acionar="lancar"
          />
          <SanteBotao
            :rotulo="t('folha.fechar')"
            variante="secundario"
            data-testid="integracao-previa-fechar"
            @acionar="visivel = false"
          />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
