<script setup lang="ts">
// "Trilha de auditoria e eventos auditáveis" (M10, ficha seção 7; cap-08 §8.12): as duas trilhas em ordem
// cronológica, período obrigatório de até 31 dias (conferido aqui e de novo no servidor), filtros por usuário,
// origem, tipo de ação, evento e prontuário do paciente; exportação CSV, XML e HTML do mesmo filtro (o período
// inteiro até 10.000 eventos; o arquivo diz quando cortou); até 20 páginas na tela, com o aviso para refinar o
// filtro quando o período tem mais; abaixo, as quantidades de exclusões (cada uma abre as linhas) e as conexões
// por módulo no período. Só quem tem o papel de auditor chega aqui (a rota exige a permissão); toda consulta e
// exportação fica registrada.
import { conferirPeriodo, mensagemPeriodo, ordenarLinhas } from '@sgh/dominio-acesso/autorizacao';
import {
  DIAS_MAXIMOS_PROVA_CADEIA,
  ORIGENS_TRILHA,
  type OrigemTrilha,
  PERMISSOES_M59_F5_CODIGOS,
  ROTA_TRILHA_AUDITORIA,
} from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import ColunasDaLista from '../../../casca/preferencias/ColunasDaLista.vue';
import { usarVisaoLista } from '../../../casca/preferencias/visao-lista.js';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarExclusoes, buscarTrilha, diaRelativo, type FiltroTrilhaTela, urlExportacao } from '../api.js';
import { urlExportacaoSbis } from '../api-sbis.js';
import PeriodoConsulta from '../componentes/PeriodoConsulta.vue';
import { periodoExportacaoSbis } from '../sbis-tela.js';
import RegistrosAuditoria from '../componentes/RegistrosAuditoria.vue';

const { t } = useI18n();
const inicio = ref(diaRelativo(1));
const fim = ref(diaRelativo(0));
const usuario = ref('');
const origem = ref<OrigemTrilha>('todas');
const tipo = ref<number | null>(null);
const evento = ref('');
const paciente = ref('');
const pagina = ref(1);
const filtro = ref<FiltroTrilhaTela | null>(null);
/** A parte do bloco (página do servidor) que a tela mostra, pelas linhas por página da visão. */
const parte = ref(0);
const recusa = ref('');

function consultar(): void {
  const c = conferirPeriodo(inicio.value, fim.value, diaRelativo(0));
  if (!c.ok) {
    recusa.value = mensagemPeriodo(c.falha);
    return;
  }
  recusa.value = '';
  pagina.value = 1;
  parte.value = 0;
  filtro.value = montar();
}
function montar(): FiltroTrilhaTela {
  const pront = Number(paciente.value);
  return {
    inicio: inicio.value,
    fim: fim.value,
    usuario: usuario.value.trim() || undefined,
    origem: origem.value,
    tipo: tipo.value,
    evento: evento.value.trim() || undefined,
    prontuario: Number.isInteger(pront) && pront > 0 ? pront : null,
    pagina: pagina.value,
  };
}
function irPara(p: number): void {
  if (!filtro.value) return;
  pagina.value = p;
  filtro.value = { ...filtro.value, pagina: p };
}
/** Anterior: a parte anterior do bloco; na primeira parte, a última parte do bloco anterior. */
function anterior(): void {
  if (parteAtual.value > 0) parte.value = parteAtual.value - 1;
  else if (pagina.value > 1) {
    parte.value = Number.MAX_SAFE_INTEGER;
    irPara(pagina.value - 1);
  }
}
/** Próxima: a parte seguinte do bloco; na última parte, o bloco seguinte do servidor. */
function proxima(): void {
  if (parteAtual.value < ultimaParte.value) parte.value = parteAtual.value + 1;
  else if (trilha.data.value?.temMais) {
    parte.value = 0;
    irPara(pagina.value + 1);
  }
}
const trilha = useQuery({
  queryKey: computed(() => ['adm', 'trilha', filtro.value]),
  queryFn: () => buscarTrilha(filtro.value as FiltroTrilhaTela),
  enabled: computed(() => filtro.value !== null),
});
const exclusoes = useQuery({
  queryKey: computed(() => ['adm', 'exclusoes', filtro.value?.inicio, filtro.value?.fim]),
  queryFn: () => buscarExclusoes(filtro.value?.inicio ?? '', filtro.value?.fim ?? ''),
  enabled: computed(() => filtro.value !== null),
});
const opcoesOrigem = computed(() =>
  ORIGENS_TRILHA.map((o) => ({ valor: o, rotulo: t(`adm.trilha.origens.${o}`) })),
);
const opcoesTipo = computed(() => [
  { valor: null, rotulo: t('adm.comum.todos') },
  ...(trilha.data.value?.tipos ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);
const podeExportar = computed(() => pode('auditoria.trilha.exportar'));
/** As linhas de um tipo de exclusão (chave) ou das conexões (chave null). */
const detalhe = ref<{ chave: string | null; rotulo: string } | null>(null);
const exportar = (formato: 'csv' | 'xml' | 'html') =>
  filtro.value ? urlExportacao(filtro.value, formato) : '#';
// M59-F5: a exportação para a auditoria SBIS (identificação e prova da cadeia) do mesmo período, até 31 dias.
const podeVerSbis = computed(() => pode(PERMISSOES_M59_F5_CODIGOS.sbisLer));
const periodoSbis = computed(() =>
  filtro.value ? periodoExportacaoSbis(filtro.value.inicio, filtro.value.fim) : 'invalido',
);
const exportarSbis = (formato: 'csv' | 'xml') =>
  filtro.value ? urlExportacaoSbis(filtro.value.inicio, filtro.value.fim, formato) : '#';
// 01-ADM L84: as colunas da tabela seguem a visão guardada na conta (escolha e ordem), com as de fábrica sem ela.
const visao = usarVisaoLista(ROTA_TRILHA_AUDITORIA);
onMounted(() => void visao.carregar());
const rotulosColunas = computed<Record<string, string>>(() =>
  Object.fromEntries(visao.oferecidas.map((c) => [c, t(`adm.trilha.${c}`)])),
);
type LinhaTrilha = NonNullable<typeof trilha.data.value>['itens'][number];
/** Valor para ordenar: o número do paciente como número; data e hora em ISO (ordena como texto); vazio vai ao fim. */
function valorOrdenacao(l: LinhaTrilha, coluna: string): unknown {
  if (coluna === 'paciente') return l.paciente;
  const c = celula(l, coluna);
  return c === '—' ? null : c;
}
// 01-ADM L84: a ordenação (clique no cabeçalho) e as linhas por página seguem a visão guardada na conta.
const linhasOrdenadas = computed(() =>
  ordenarLinhas(trilha.data.value?.itens ?? [], visao.ordenacao.value, valorOrdenacao),
);
const tamanhoParte = computed(() => visao.itensPorPagina.value ?? Math.max(1, linhasOrdenadas.value.length));
const ultimaParte = computed(() =>
  Math.max(0, Math.ceil(linhasOrdenadas.value.length / tamanhoParte.value) - 1),
);
const parteAtual = computed(() => Math.min(parte.value, ultimaParte.value));
const linhasDaTela = computed(() =>
  linhasOrdenadas.value.slice(
    parteAtual.value * tamanhoParte.value,
    (parteAtual.value + 1) * tamanhoParte.value,
  ),
);
watch([() => visao.itensPorPagina.value, () => visao.ordenacao.value], () => {
  parte.value = 0;
});
function ordemDa(coluna: string): 'ascending' | 'descending' | 'none' {
  const o = visao.ordenacao.value.find((x) => x.coluna === coluna);
  return o ? (o.direcao === 'asc' ? 'ascending' : 'descending') : 'none';
}
function celula(l: LinhaTrilha, coluna: string): string {
  switch (coluna) {
    case 'origem':
      return t(`adm.trilha.origens.${l.origem}`);
    case 'acao':
      return l.resultado ? `${l.acao} (${l.resultado})` : l.acao;
    case 'ator':
      return l.atorReal ?? '—';
    case 'dataHora':
      return l.dataHora;
    default: {
      const v = (l as unknown as Record<string, unknown>)[coluna];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="trilha-titulo">
    <h1 id="trilha-titulo">{{ t('adm.trilha.titulo') }}</h1>
    <p>{{ t('adm.trilha.texto') }}</p>
    <p v-if="podeVerSbis">
      <RouterLink to="/administracao/auditoria/sbis" data-testid="trilha-certificacao-sbis">
        {{ t('sbis.exportacao.certificacao') }}
      </RouterLink>
    </p>
    <form class="filtros" role="search" data-testid="filtros-trilha" @submit.prevent="consultar">
      <PeriodoConsulta v-model:inicio="inicio" v-model:fim="fim" />
      <div class="campo">
        <label for="trilha-usuario">{{ t('adm.trilha.usuario') }}</label>
        <input id="trilha-usuario" v-model="usuario" maxlength="31" data-testid="trilha-usuario" />
      </div>
      <div class="campo">
        <SanteSelecao
          id="trilha-origem"
          v-model="origem"
          :rotulo="t('adm.trilha.origem')"
          :opcoes="opcoesOrigem"
          data-testid="trilha-origem"
        />
      </div>
      <div class="campo">
        <SanteSelecao id="trilha-tipo" v-model="tipo" :rotulo="t('adm.trilha.tipo')" :opcoes="opcoesTipo" />
      </div>
      <div class="campo">
        <label for="trilha-evento">{{ t('adm.trilha.evento') }}</label>
        <input id="trilha-evento" v-model="evento" maxlength="80" />
      </div>
      <div class="campo">
        <label for="trilha-paciente">{{ t('adm.trilha.prontuario') }}</label>
        <input
          id="trilha-paciente"
          v-model="paciente"
          inputmode="numeric"
          pattern="\d*"
          data-testid="trilha-prontuario"
        />
      </div>
      <SanteBotao :rotulo="t('adm.comum.consultar')" tipo="submit" data-testid="trilha-consultar" />
    </form>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="trilha-recusa" />
    <MensagemErro v-if="trilha.isError.value" :erro="trilha.error.value" />
    <p v-else-if="filtro && trilha.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="trilha.data.value">
      <p role="status">
        {{ t('adm.trilha.tempo', { ms: trilha.data.value.tempoMs }) }}
        <span v-if="trilha.data.value.destino === 'memoria'"> · {{ t('adm.comum.memoria') }}</span>
      </p>
      <p v-if="podeExportar" class="exportar">
        <a
          v-for="f in ['csv', 'xml', 'html'] as const"
          :key="f"
          :href="exportar(f)"
          :data-testid="`exportar-${f}`"
          download
        >
          {{ t('adm.trilha.exportar', { formato: f.toUpperCase() }) }}
        </a>
      </p>
      <section
        v-if="podeExportar"
        class="exportar-sbis"
        aria-labelledby="trilha-sbis-titulo"
        data-testid="trilha-sbis"
      >
        <h2 id="trilha-sbis-titulo">{{ t('sbis.exportacao.titulo') }}</h2>
        <p>{{ t('sbis.exportacao.texto') }}</p>
        <p v-if="periodoSbis === 'ok'" class="exportar">
          <a
            v-for="f in ['csv', 'xml'] as const"
            :key="f"
            :href="exportarSbis(f)"
            :data-testid="`exportar-sbis-${f}`"
            download
          >
            {{ t('sbis.exportacao.link', { formato: f.toUpperCase() }) }}
          </a>
        </p>
        <p v-else data-testid="exportar-sbis-longo">
          {{ t('sbis.exportacao.longo', { dias: DIAS_MAXIMOS_PROVA_CADEIA }) }}
        </p>
      </section>
      <ColunasDaLista :visao="visao" :rotulos="rotulosColunas" prefixo="trilha" />
      <p class="nota">{{ t('preferencias.lista.notaOrdem') }}</p>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('adm.comum.rolagem')">
        <table data-testid="tabela-trilha">
          <caption>
            {{
              t('adm.trilha.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th
                v-for="c in visao.visiveis.value"
                :key="c"
                scope="col"
                :aria-sort="ordemDa(c)"
                :data-testid="`trilha-cab-${c}`"
              >
                <button
                  type="button"
                  class="ordenar"
                  :aria-label="t('preferencias.lista.ordenar', { coluna: rotulosColunas[c] })"
                  :data-testid="`trilha-ordenar-${c}`"
                  @click="visao.ordenarPor(c)"
                >
                  {{ rotulosColunas[c] }}
                  <span v-if="ordemDa(c) !== 'none'" aria-hidden="true">
                    {{
                      ordemDa(c) === 'ascending'
                        ? t('preferencias.lista.ordemAsc')
                        : t('preferencias.lista.ordemDesc')
                    }}
                  </span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="trilha.data.value.itens.length === 0">
              <td :colspan="visao.visiveis.value.length">{{ t('adm.comum.nenhum') }}</td>
            </tr>
            <tr v-for="l in linhasDaTela" :key="`${l.origem}-${l.id}`">
              <template v-for="(c, i) in visao.visiveis.value" :key="c">
                <th v-if="i === 0" scope="row">{{ celula(l, c) }}</th>
                <td v-else>{{ celula(l, c) }}</td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
      <SanteAlerta
        v-if="trilha.data.value.cortado"
        :texto="t('adm.trilha.cortado')"
        variante="aviso"
        anunciar
        data-testid="trilha-cortado"
      />
      <div class="paginas">
        <SanteBotao
          :rotulo="t('adm.comum.anterior')"
          variante="texto"
          :desabilitado="pagina <= 1 && parteAtual === 0"
          data-testid="trilha-anterior"
          @acionar="anterior()"
        />
        <span data-testid="trilha-pagina">
          {{ t('adm.comum.pagina', { n: pagina }) }}
          <template v-if="ultimaParte > 0">
            · {{ t('preferencias.lista.parte', { parte: parteAtual + 1, total: ultimaParte + 1 }) }}
          </template>
        </span>
        <SanteBotao
          :rotulo="t('adm.comum.proxima')"
          variante="texto"
          :desabilitado="parteAtual >= ultimaParte && !trilha.data.value.temMais"
          data-testid="trilha-proxima"
          @acionar="proxima()"
        />
      </div>
    </template>
    <template v-if="exclusoes.data.value">
      <h2>{{ t('adm.trilha.exclusoes') }}</h2>
      <ul data-testid="exclusoes">
        <li v-for="x in exclusoes.data.value.tipos" :key="x.chave">
          <SanteBotao
            :rotulo="t('adm.trilha.verLinhas', { rotulo: x.rotulo, n: x.quantidade })"
            variante="texto"
            :data-testid="`exclusao-${x.chave}`"
            @acionar="detalhe = { chave: x.chave, rotulo: x.rotulo }"
          />
        </li>
      </ul>
      <h2>{{ t('adm.trilha.conexoes') }}</h2>
      <ul>
        <li v-for="c in exclusoes.data.value.conexoes" :key="c.modulo">
          {{ c.nome }}: {{ t('adm.trilha.usuarios', { n: c.usuarios }) }}
        </li>
      </ul>
      <SanteBotao
        :rotulo="t('adm.trilha.verConexoes')"
        variante="texto"
        data-testid="ver-conexoes"
        @acionar="detalhe = { chave: null, rotulo: t('adm.trilha.conexoes') }"
      />
      <RegistrosAuditoria
        v-if="detalhe && filtro"
        :chave="detalhe.chave"
        :rotulo="detalhe.rotulo"
        :inicio="filtro.inicio"
        :fim="filtro.fim"
        @fechar="detalhe = null"
      />
    </template>
  </section>
</template>

<style scoped>
.filtros,
.paginas,
.exportar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.ordenar {
  font: inherit;
  font-weight: 600;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--sgh-texto);
  cursor: pointer;
  text-align: left;
}
.nota {
  color: var(--sgh-texto-secundario);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
