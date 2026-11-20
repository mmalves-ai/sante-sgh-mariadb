<script setup lang="ts">
// Censo hospitalar diário (M16; ficha, seção 7; regras 3, 5, 7, 8 e 14): o dia em aberto, um dia fechado (retrato)
// ou calculado na hora, por unidade, na hora de fechamento única; a série desde 2020 por dia ou mês; a exportação
// (permissão própria). As internações com dado impossível ficam marcadas (só contagens).
import { GRUPOS_MOTIVO_ALTA, ROTULO_GRUPO_MOTIVO_ALTA } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import AvisoIndisponivel from '../../onda0/componentes/AvisoIndisponivel.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  exportarCenso,
  exportarInternacoesMarcadas,
  lerCenso,
  lerInternacoesMarcadas,
  lerSerieCenso,
} from '../api-internacao.js';
import GraficoSerie from '../componentes/GraficoSerie.vue';
import {
  baixarTexto,
  formatarData,
  formatarDataHora,
  formatarMes,
  hojeNoEstabelecimento,
  semMovimentoRecente,
} from '../formato.js';

const { t } = useI18n();
const hoje = hojeNoEstabelecimento();
const dia = ref<string>('');
const censo = useQuery({
  queryKey: computed(() => ['internacao', 'censo', dia.value]),
  queryFn: () => lerCenso(dia.value || undefined),
});
const podeExportar = computed(() => pode('internacao.censo.exportar'));
const erroExportar = ref<unknown>(null);
async function exportar(q: Parameters<typeof exportarCenso>[0], nome: string): Promise<void> {
  erroExportar.value = null;
  try {
    baixarTexto(await exportarCenso(q), nome);
  } catch (e) {
    erroExportar.value = e;
  }
}

// Série: os últimos 12 meses por mês (ou um período por dia).
const anoPassado = `${Number(hoje.slice(0, 4)) - 1}-${hoje.slice(5, 7)}-01`;
const de = ref(anoPassado);
const ate = ref(hoje);
const agrupamento = ref<'dia' | 'mes'>('mes');
const opcoesAgrupamento = computed(() => [
  { valor: 'mes' as const, rotulo: t('internacao.censo.porMes') },
  { valor: 'dia' as const, rotulo: t('internacao.censo.porDia') },
]);
const pedido = ref({ de: de.value, ate: ate.value, agrupamento: agrupamento.value });
const serie = useQuery({
  queryKey: computed(() => ['internacao', 'censo-serie', pedido.value]),
  queryFn: () => lerSerieCenso(pedido.value.de, pedido.value.ate, pedido.value.agrupamento),
});
const aplicar = () => (pedido.value = { de: de.value, ate: ate.value, agrupamento: agrupamento.value });
const rotuloPeriodo = (p: string) => (p.length === 7 ? formatarMes(p) : formatarData(p));
const marcasComCasos = computed(() =>
  Object.entries(censo.data.value?.marcas ?? {}).filter(([, n]) => n > 0),
);
// Relatório das internações marcadas (regra 5), para o arquivo médico corrigir: só o número e a marca; a consulta
// vai à trilha, por isso só quando pedida.
const verMarcadas = ref(false);
const marcadas = useQuery({
  queryKey: ['internacao', 'censo-marcadas'],
  queryFn: () => lerInternacoesMarcadas(),
  enabled: verMarcadas,
});
const temCasos = computed(() => marcasComCasos.value.some(([m]) => m !== 'transferencias-sem-trecho'));
async function exportarMarcadas(): Promise<void> {
  erroExportar.value = null;
  try {
    baixarTexto(await exportarInternacoesMarcadas(), 'internacoes-marcadas.csv');
  } catch (e) {
    erroExportar.value = e;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="censo-titulo">
    <h1 id="censo-titulo">{{ t('internacao.censo.titulo') }}</h1>
    <p>{{ t('internacao.censo.texto') }}</p>
    <div class="linha">
      <label for="censo-dia">{{ t('internacao.censo.dia') }}</label>
      <input id="censo-dia" v-model="dia" type="date" :max="hoje" data-testid="censo-dia" />
      <SanteBotao
        v-if="podeExportar && censo.data.value"
        :rotulo="t('internacao.comum.exportar')"
        variante="secundario"
        data-testid="censo-exportar"
        @acionar="exportar({ data: censo.data.value.data }, `censo-${censo.data.value.data}.csv`)"
      />
    </div>
    <MensagemErro v-if="erroExportar" :erro="erroExportar" />
    <AvisoIndisponivel v-if="censo.isError.value" :erro="censo.error.value" />
    <MensagemErro v-if="censo.isError.value" :erro="censo.error.value" />
    <p v-else-if="censo.isPending.value">{{ t('internacao.comum.carregando') }}</p>
    <template v-else-if="censo.data.value">
      <p role="status" data-testid="censo-situacao">
        <strong
          >{{ formatarData(censo.data.value.data) }} ·
          {{ t(`internacao.censo.situacoes.${censo.data.value.situacao}`) }}</strong
        >
        · {{ t('internacao.censo.hora', { hora: censo.data.value.horaFechamento }) }} ·
        {{ t('internacao.comum.dadosAte', { quando: formatarDataHora(censo.data.value.dadosAte) }) }}
      </p>
      <SanteAlerta
        v-if="semMovimentoRecente(censo.data.value.ultimoMovimento, hoje)"
        :texto="t('internacao.comum.semMovimento', { data: formatarData(censo.data.value.ultimoMovimento) })"
        variante="aviso"
      />
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('internacao.censo.titulo')">
        <table data-testid="censo-tabela">
          <caption>
            {{
              t('internacao.censo.titulo')
            }}
            ·
            {{
              formatarData(censo.data.value.data)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('internacao.censo.unidade') }}</th>
              <th scope="col">{{ t('internacao.censo.tipo') }}</th>
              <th scope="col">{{ t('internacao.censo.internados') }}</th>
              <th scope="col">{{ t('internacao.censo.admissoes') }}</th>
              <th v-for="g in GRUPOS_MOTIVO_ALTA" :key="g" scope="col">{{ ROTULO_GRUPO_MOTIVO_ALTA[g] }}</th>
              <th scope="col">{{ t('internacao.censo.entradas') }}</th>
              <th scope="col">{{ t('internacao.censo.saidasTransf') }}</th>
              <th scope="col">{{ t('internacao.censo.leitos') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in censo.data.value.linhas" :key="`${l.bloco}-${l.acomodacao}-${l.tipo.id}`">
              <th scope="row">{{ l.bloco }} · {{ l.nome }}</th>
              <td>
                {{ l.tipo.nome }}<span v-if="l.intensiva"> · {{ t('internacao.painel.intensiva') }}</span>
              </td>
              <td>{{ l.internados }}</td>
              <td>{{ l.admissoes }}</td>
              <td v-for="g in GRUPOS_MOTIVO_ALTA" :key="g">{{ l.altas[g] }}</td>
              <td>{{ l.transferenciasEntrada }}</td>
              <td>{{ l.transferenciasSaida }}</td>
              <td>{{ l.leitosOperacionais }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr data-testid="censo-total">
              <th scope="row" colspan="2">{{ t('internacao.censo.total') }}</th>
              <td>{{ censo.data.value.totais.internados }}</td>
              <td>{{ censo.data.value.totais.admissoes }}</td>
              <td v-for="g in GRUPOS_MOTIVO_ALTA" :key="g">{{ censo.data.value.totais.altas[g] }}</td>
              <td>{{ censo.data.value.totais.transferenciasEntrada }}</td>
              <td>{{ censo.data.value.totais.transferenciasSaida }}</td>
              <td>{{ censo.data.value.totais.leitosOperacionais }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <section v-if="marcasComCasos.length" aria-labelledby="censo-marcas">
        <h2 id="censo-marcas">{{ t('internacao.censo.marcas') }}</h2>
        <p>{{ t('internacao.censo.marcasTexto') }}</p>
        <ul>
          <li v-for="[m, n] in marcasComCasos" :key="m">
            {{ t(`internacao.censo.nomesMarcas.${m}`) }}: {{ n < 5 ? '<5' : n }}
          </li>
        </ul>
        <div v-if="temCasos" class="linha">
          <SanteBotao
            :rotulo="t('internacao.censo.verMarcadas')"
            variante="secundario"
            data-testid="censo-ver-marcadas"
            @acionar="verMarcadas = true"
          />
          <SanteBotao
            v-if="podeExportar"
            :rotulo="t('internacao.censo.exportarMarcadas')"
            variante="secundario"
            data-testid="censo-exportar-marcadas"
            @acionar="exportarMarcadas"
          />
        </div>
        <MensagemErro v-if="marcadas.isError.value" :erro="marcadas.error.value" />
        <div
          v-else-if="verMarcadas && marcadas.data.value"
          class="rolagem"
          tabindex="0"
          role="region"
          :aria-label="t('internacao.censo.marcas')"
        >
          <table data-testid="censo-marcadas-tabela">
            <caption>
              {{
                t('internacao.censo.marcadasLegenda')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('internacao.censo.internacao') }}</th>
                <th scope="col">{{ t('internacao.censo.marca') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in marcadas.data.value.casos" :key="`${c.marca}-${c.internacao}`">
                <td>{{ c.internacao }}</td>
                <td>{{ t(`internacao.censo.nomesMarcas.${c.marca}`) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <section aria-labelledby="censo-serie">
      <h2 id="censo-serie">{{ t('internacao.censo.serie') }}</h2>
      <form class="linha" @submit.prevent="aplicar">
        <label for="serie-de">{{ t('internacao.comum.de') }}</label>
        <input id="serie-de" v-model="de" type="date" min="2020-01-01" :max="hoje" />
        <label for="serie-ate">{{ t('internacao.comum.ate') }}</label>
        <input id="serie-ate" v-model="ate" type="date" min="2020-01-01" :max="hoje" />
        <SanteSelecao
          id="serie-agrupamento"
          v-model="agrupamento"
          :rotulo="t('internacao.censo.periodo')"
          :opcoes="opcoesAgrupamento"
        />
        <SanteBotao :rotulo="t('internacao.comum.aplicar')" tipo="submit" data-testid="serie-aplicar" />
        <SanteBotao
          v-if="podeExportar"
          :rotulo="t('internacao.comum.exportar')"
          variante="secundario"
          @acionar="exportar(pedido, `censo-${pedido.de}-${pedido.ate}.csv`)"
        />
      </form>
      <MensagemErro v-if="serie.isError.value" :erro="serie.error.value" />
      <template v-else-if="serie.data.value">
        <GraficoSerie
          :titulo="t('internacao.censo.pacientesDia')"
          unidade="quantidade"
          :series="[
            {
              rotulo: t('internacao.censo.pacientesDia'),
              valores: serie.data.value.periodos.map((p) => ({
                periodo: p.periodo,
                valor: p.pacientesDia,
                parcial: p.parcial,
              })),
            },
          ]"
          testid="censo-grafico"
        />
        <p v-if="serie.data.value.periodos.some((p) => p.parcial)">{{ t('internacao.comum.mesParcial') }}</p>
        <div class="rolagem" tabindex="0" role="region" :aria-label="t('internacao.censo.serie')">
          <table data-testid="serie-tabela">
            <caption>
              {{
                t('internacao.censo.serie')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('internacao.censo.periodo') }}</th>
                <th scope="col">{{ t('internacao.censo.pacientesDia') }}</th>
                <th scope="col">{{ t('internacao.censo.admissoes') }}</th>
                <th scope="col">{{ t('internacao.censo.saidas') }}</th>
                <th scope="col">{{ t('internacao.censo.obitos') }}</th>
                <th scope="col">{{ t('internacao.censo.entradas') }}</th>
                <th scope="col">{{ t('internacao.censo.leitosDia') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in serie.data.value.periodos" :key="p.periodo">
                <th scope="row">
                  {{ rotuloPeriodo(p.periodo)
                  }}<span v-if="p.parcial"> ({{ t('internacao.comum.parcial') }})</span>
                </th>
                <td>{{ p.pacientesDia }}</td>
                <td>{{ p.admissoes }}</td>
                <td>{{ p.saidas }}</td>
                <td>{{ p.obitos }}</td>
                <td>{{ p.transferenciasEntrada }}</td>
                <td>{{ p.leitosDia }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped>
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin: var(--sgh-espaco-2) 0;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
caption {
  text-align: left;
  font-weight: 600;
}
tfoot th,
tfoot td {
  font-weight: 700;
}
</style>
