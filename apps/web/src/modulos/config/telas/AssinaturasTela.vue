<script setup lang="ts">
// Tela "Testes de assinatura de dados" (M03): operações por módulo, cenários, origem da referência, estado por
// estabelecimento, última execução e diferenças por tipo, por estabelecimento. Só leitura
// (config.assinatura.ler). M36: rodada de conferência (onda), conferência registrada por estabelecimento e as
// diferenças lado a lado; o painel da homologação só com config.coexistencia.ler.
import type { PainelAssinaturas, PainelHomologacao } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarPainelAssinaturas,
  buscarPainelHomologacao,
  filtrarOperacoes,
  type GrupoRotulo,
  resumoPorTipo,
  rotuloCodigo,
} from '../api.js';
import AbasAssinaturas from '../componentes/AbasAssinaturas.vue';
import RodadaConferencia from '../componentes/RodadaConferencia.vue';

const { t, te } = useI18n();
const rotulo = (grupo: GrupoRotulo, codigo: string) => rotuloCodigo(grupo, codigo, t, te);
const dados = ref<PainelAssinaturas | null>(null);
const erro = ref<string | null>(null);
const modulo = ref('');
const estado = ref('');
const estabelecimento = ref('');
const rodada = ref('');
const homologacao = ref<PainelHomologacao | null>(null);
const erroHomologacao = ref<string | null>(null);
const verHomologacao = pode('config.coexistencia.ler');
const porNome = computed(() => new Map((homologacao.value?.operacoes ?? []).map((o) => [o.nome, o])));
const opcoesRodada = computed(() => [
  todos.value,
  ...(homologacao.value?.rodadas ?? []).map((r) => ({ valor: String(r.onda), rotulo: r.rotulo })),
]);

const modulos = computed(() => [...new Set((dados.value?.operacoes ?? []).map((o) => o.modulo))].sort());
const estados = computed(() =>
  [...new Set((dados.value?.operacoes ?? []).flatMap((o) => Object.values(o.estados)))].sort(),
);
const todos = computed(() => ({ valor: '', rotulo: t('config.assinaturas.todos') }));
const opcoesModulo = computed(() => [todos.value, ...modulos.value.map((m) => ({ valor: m, rotulo: m }))]);
const opcoesEstado = computed(() => [
  todos.value,
  ...estados.value.map((e) => ({ valor: e, rotulo: rotulo('estadosOperacao', e) })),
]);
const opcoesEstabelecimento = computed(() => [
  todos.value,
  ...(dados.value?.estabelecimentos ?? []).map((e) => ({ valor: e, rotulo: e })),
]);
const lista = computed(() =>
  filtrarOperacoes(dados.value?.operacoes ?? [], {
    modulo: modulo.value,
    estado: estado.value,
    estabelecimento: estabelecimento.value,
  }).filter((o) => !rodada.value || String(porNome.value.get(o.nome)?.onda ?? '') === rodada.value),
);
const colunasEstab = computed(() =>
  estabelecimento.value ? [estabelecimento.value] : (dados.value?.estabelecimentos ?? []),
);

/** O estabelecimento tem diferença não aceita na última execução? */
const difs = (o: PainelAssinaturas['operacoes'][number], e: string) =>
  Object.keys(o.ultimasExecucoes[e]?.diferencasPorTipo ?? {}).length > 0;

/** Estabelecimentos com diferença não aceita detalhada (lado a lado) na última execução. */
const comDetalhes = (o: PainelAssinaturas['operacoes'][number]) =>
  colunasEstab.value.filter((e) => (o.ultimasExecucoes[e]?.detalhes ?? []).length > 0);

const rotuloRodada = (onda: number | undefined) =>
  onda === undefined
    ? '—'
    : (homologacao.value?.rodadas.find((r) => r.onda === onda)?.rotulo ?? String(onda));

onMounted(async () => {
  try {
    dados.value = await buscarPainelAssinaturas();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
  if (!verHomologacao) return;
  try {
    homologacao.value = await buscarPainelHomologacao();
  } catch (e) {
    erroHomologacao.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <section aria-labelledby="titulo-assinaturas">
    <h1 id="titulo-assinaturas">{{ t('config.assinaturas.titulo') }}</h1>
    <AbasAssinaturas atual="operacoes" />
    <p>{{ t('config.assinaturas.texto') }}</p>
    <p v-if="erro" role="alert">{{ t('config.assinaturas.erro', { erro }) }}</p>
    <p v-if="erroHomologacao" role="alert">{{ t('config.homologacao.erro', { erro: erroHomologacao }) }}</p>
    <RodadaConferencia v-if="homologacao" :painel="homologacao" />
    <p v-else-if="verHomologacao && !erroHomologacao" data-testid="homologacao-nao-gerada">
      {{ t('config.homologacao.naoGerado') }}
    </p>
    <form v-if="dados" class="filtros" :aria-label="t('config.assinaturas.filtros')" @submit.prevent>
      <SanteSelecao
        v-model="modulo"
        :rotulo="t('config.assinaturas.modulo')"
        :opcoes="opcoesModulo"
        data-testid="filtro-modulo"
      />
      <SanteSelecao
        v-model="estado"
        :rotulo="t('config.assinaturas.estado')"
        :opcoes="opcoesEstado"
        data-testid="filtro-estado"
      />
      <SanteSelecao
        v-model="estabelecimento"
        :rotulo="t('config.assinaturas.estabelecimento')"
        :opcoes="opcoesEstabelecimento"
        data-testid="filtro-estabelecimento"
      />
      <SanteSelecao
        v-if="homologacao"
        v-model="rodada"
        :rotulo="t('config.homologacao.filtroRodada')"
        :opcoes="opcoesRodada"
        data-testid="filtro-rodada"
      />
    </form>
    <table v-if="dados" data-testid="tabela-assinaturas">
      <caption>
        {{
          t('config.assinaturas.legenda', { n: lista.length })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('config.assinaturas.operacao') }}</th>
          <th scope="col">{{ t('config.assinaturas.modulo') }}</th>
          <th scope="col">{{ t('config.assinaturas.cenarios') }}</th>
          <th scope="col">{{ t('config.assinaturas.origem') }}</th>
          <th scope="col">{{ t('config.assinaturas.estados') }}</th>
          <th scope="col">{{ t('config.assinaturas.ultima') }}</th>
          <th scope="col">{{ t('config.assinaturas.diferencas') }}</th>
          <th v-if="homologacao" scope="col">{{ t('config.assinaturas.rodada') }}</th>
          <th v-if="homologacao" scope="col">{{ t('config.assinaturas.conferencia') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in lista" :key="o.nome" data-testid="linha-operacao">
          <th scope="row">
            <code>{{ o.nome }}</code>
            <div class="descricao">{{ o.descricao }}</div>
          </th>
          <td>{{ o.modulo }}</td>
          <td>{{ o.cenarios.join(', ') }}</td>
          <td>{{ rotulo('origens', o.origem) }}</td>
          <td>
            <span v-if="colunasEstab.length === 0">{{ t('config.assinaturas.semEstabelecimento') }}</span>
            <ul v-else class="estados">
              <li v-for="e in colunasEstab" :key="e">
                <strong>{{ e }}</strong
                >: {{ rotulo('estadosOperacao', o.estados[e] ?? 'especificada') }}
              </li>
            </ul>
          </td>
          <td>
            <ul v-if="colunasEstab.some((e) => o.ultimasExecucoes[e])" class="estados">
              <li v-for="e in colunasEstab.filter((x) => o.ultimasExecucoes[x])" :key="e">
                {{
                  t('config.assinaturas.execucao', {
                    data: new Date(o.ultimasExecucoes[e]?.executadoEm ?? '').toLocaleString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                    }),
                    hospital: e,
                    resultado: rotulo('resultados', o.ultimasExecucoes[e]?.resultado ?? ''),
                  })
                }}
              </li>
            </ul>
            <span v-else>{{ t('config.assinaturas.nunca') }}</span>
          </td>
          <td>
            <ul v-if="colunasEstab.some((e) => difs(o, e))" class="estados">
              <li v-for="e in colunasEstab.filter((x) => difs(o, x))" :key="e">
                <strong>{{ e }}</strong
                >: {{ resumoPorTipo(o.ultimasExecucoes[e]?.diferencasPorTipo ?? {}) }}
              </li>
            </ul>
            <span v-else>{{ t('config.assinaturas.nenhuma') }}</span>
            <details v-for="e in comDetalhes(o)" :key="e" data-testid="detalhes-diferencas">
              <summary>{{ t('config.assinaturas.detalhes', { hospital: e }) }}</summary>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{{ t('config.assinaturas.cenario') }}</th>
                    <th scope="col">{{ t('config.assinaturas.elemento') }}</th>
                    <th scope="col">{{ t('config.assinaturas.tipo') }}</th>
                    <th scope="col">{{ t('config.assinaturas.esperado') }}</th>
                    <th scope="col">{{ t('config.assinaturas.obtido') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(d, i) in o.ultimasExecucoes[e]?.detalhes ?? []" :key="i">
                    <td>{{ d.cenario }}</td>
                    <td>
                      <code>{{ d.elemento }}</code>
                    </td>
                    <td>{{ d.tipo }}</td>
                    <td>
                      <code>{{ d.esperado }}</code>
                    </td>
                    <td>
                      <code>{{ d.obtido }}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </details>
          </td>
          <td v-if="homologacao" data-testid="rodada-operacao">
            {{ rotuloRodada(porNome.get(o.nome)?.onda) }}
          </td>
          <td v-if="homologacao">
            <ul v-if="Object.keys(porNome.get(o.nome)?.conferencias ?? {}).length" class="estados">
              <li v-for="(c, h) in porNome.get(o.nome)?.conferencias ?? {}" :key="h">
                {{
                  c.problemas.length
                    ? t('config.assinaturas.conferenciaComProblema', { hospital: h, n: c.problemas.length })
                    : t('config.assinaturas.conferidaEm', {
                        hospital: h,
                        resultado: c.resultado,
                        data: c.data,
                        papeis: c.papeis.join(', '),
                      })
                }}
              </li>
            </ul>
            <span v-else>{{ t('config.assinaturas.semConferencia') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-block: 1rem;
}
.descricao {
  font-weight: normal;
}
.estados {
  margin: 0;
  padding-inline-start: 1rem;
}
</style>
