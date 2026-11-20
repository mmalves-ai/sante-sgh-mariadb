<script setup lang="ts">
// Qualidade e segurança › Vigilância epidemiológica › Notificação compulsória (M48, etapa 4; ficha, seção 7; regras 3
// e 8; manual "Notificação compulsória de agravos"). Três partes: as sugestões a avaliar (CID notificável registrado no
// atendimento, resultado reagente de exame, óbito com CID notificável, ainda sem caso; quem decide abrir é a
// vigilância), os casos com o prazo (imediato em 24 h, semanal em 7 dias; notificar com a ficha impressa, descartar
// com justificativa) e a lista nacional com os exames que disparam a sugestão. Com a funcionalidade desligada, tudo
// fica em consulta.
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import {
  ORIGENS_CASO_AGRAVO,
  PERIODICIDADES_AGRAVO,
  rotuloOrigemCasoAgravo,
  rotuloPeriodicidadeAgravo,
  rotuloSituacaoCasoAgravo,
  SITUACOES_CASO_AGRAVO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { dataHora } from '../../regras-qualidade.js';
import {
  abrirCaso,
  type CasoAberto,
  type GatilhoTela,
  lerCasos,
  lerGatilhos,
  lerResumoAgravos,
  novaChaveAgravo,
} from '../api-agravo.js';
import CasoAgravo from '../componentes/CasoAgravo.vue';
import ErroAgravo from '../componentes/ErroAgravo.vue';
import ListaNacional from '../componentes/ListaNacional.vue';
import NovoCasoManual from '../componentes/NovoCasoManual.vue';
import PrazoAgravo from '../componentes/PrazoAgravo.vue';
import { entradaDoGatilho } from '../regras-agravo.js';

type Aba = 'fila' | 'casos' | 'lista';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();

const resumo = useQuery({
  queryKey: ['agravos', 'resumo'],
  queryFn: lerResumoAgravos,
  refetchInterval: 120_000,
});
const podeNotificar = computed(() => resumo.data.value?.podeNotificar ?? false);
const agora = computed(() => resumo.data.value?.agora ?? '');

const casoNaRota = Number(rota.query['caso']);
const aba = ref<Aba>(Number.isInteger(casoNaRota) && casoNaRota > 0 ? 'casos' : 'fila');
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

// ── Sugestões ──
const filtroFila = reactive({ dias: 7, origem: '' });
const opDias = [1, 7, 15, 30].map((n) => ({ valor: n, rotulo: t('agravos.fila.dias', { n }) }));
const opOrigem = [
  { valor: '', rotulo: t('agravos.todas') },
  ...ORIGENS_CASO_AGRAVO.filter((o) => o.codigo !== 'manual').map((o) => ({
    valor: o.codigo as string,
    rotulo: o.rotulo,
  })),
];
const fila = useQuery({
  queryKey: computed(() => ['agravos', 'gatilhos', filtroFila.dias, filtroFila.origem]),
  queryFn: () => lerGatilhos(filtroFila.dias, filtroFila.origem || undefined),
  enabled: computed(() => aba.value === 'fila'),
  refetchInterval: 120_000,
});
const confirmando = ref<string | null>(null);
const abrindo = ref(false);
let chaveAbrir = novaChaveAgravo('abrir');
async function abrir(g: GatilhoTela): Promise<void> {
  erro.value = null;
  aviso.value = null;
  abrindo.value = true;
  try {
    const r = await abrirCaso(entradaDoGatilho(g), chaveAbrir);
    chaveAbrir = novaChaveAgravo('abrir');
    confirmando.value = null;
    await aberto(r, t('agravos.fila.aberto', { data: dataHora(r.prazoEm) }));
  } catch (e) {
    erro.value = e;
  } finally {
    abrindo.value = false;
  }
}
async function aberto(r: CasoAberto, mensagem: string): Promise<void> {
  manual.value = false;
  aviso.value = mensagem;
  selecionado.value = r.id;
  aba.value = 'casos';
  await cliente.invalidateQueries({ queryKey: ['agravos'] });
}

// ── Caso sem sugestão ──
const manual = ref(false);

// ── Casos ──
const filtroCasos = reactive({ situacao: 'aberto', periodicidade: '', pagina: 1 });
const opSituacao = [
  { valor: '', rotulo: t('agravos.todas') },
  ...SITUACOES_CASO_AGRAVO.map((s) => ({ valor: s.codigo as string, rotulo: s.rotulo })),
];
const opPeriodicidade = [
  { valor: '', rotulo: t('agravos.todas') },
  ...PERIODICIDADES_AGRAVO.map((p) => ({ valor: p.codigo as string, rotulo: p.rotulo })),
];
watch(
  () => [filtroCasos.situacao, filtroCasos.periodicidade],
  () => {
    filtroCasos.pagina = 1;
  },
);
const casos = useQuery({
  queryKey: computed(() => ['agravos', 'casos', { ...filtroCasos }]),
  queryFn: () =>
    lerCasos({
      situacao: filtroCasos.situacao || undefined,
      periodicidade: filtroCasos.periodicidade || undefined,
      pagina: filtroCasos.pagina,
    }),
  enabled: computed(() => aba.value === 'casos'),
});
const paginas = computed(() =>
  casos.data.value ? Math.max(1, Math.ceil(casos.data.value.total / casos.data.value.porPagina)) : 1,
);
const selecionado = ref<number | null>(Number.isInteger(casoNaRota) && casoNaRota > 0 ? casoNaRota : null);
function gravadoNoCaso(mensagem: string): void {
  aviso.value = mensagem;
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="agravos-titulo" data-testid="tela-agravos">
    <h1 id="agravos-titulo">{{ t('agravos.titulo') }}</h1>
    <p class="secundario">{{ t('agravos.explicacao') }}</p>
    <SanteAlerta
      v-if="resumo.data.value && !resumo.data.value.ligada"
      variante="info"
      :texto="resumo.data.value.motivo ?? t('agravos.desligado')"
      data-testid="agravos-desligado"
    />
    <ErroAgravo v-if="resumo.isError.value" :erro="resumo.error.value" />
    <dl
      v-if="resumo.data.value"
      class="resumo-agravos"
      :aria-label="t('agravos.resumo.legenda')"
      data-testid="agravos-resumo"
    >
      <div>
        <dt>{{ t('agravos.resumo.abertos') }}</dt>
        <dd data-testid="resumo-abertos">{{ resumo.data.value.abertos }}</dd>
      </div>
      <div :class="resumo.data.value.imediatosAbertos ? 'selo selo--atencao' : ''">
        <dt>{{ t('agravos.resumo.imediatos') }}</dt>
        <dd data-testid="resumo-imediatos">{{ resumo.data.value.imediatosAbertos }}</dd>
      </div>
      <div :class="resumo.data.value.vencidos ? 'prazo prazo--vencido' : ''">
        <dt>{{ t('agravos.resumo.vencidos') }}</dt>
        <dd data-testid="resumo-vencidos">{{ resumo.data.value.vencidos }}</dd>
      </div>
      <div>
        <dt>{{ t('agravos.resumo.gatilhos') }}</dt>
        <dd data-testid="resumo-gatilhos">{{ resumo.data.value.gatilhosSemCaso }}</dd>
      </div>
      <div>
        <dt>{{ t('agravos.resumo.notificados') }}</dt>
        <dd data-testid="resumo-notificados">{{ resumo.data.value.notificadosNoMes }}</dd>
      </div>
    </dl>

    <div class="abas abas-ccih" role="tablist" :aria-label="t('agravos.abas.rotulo')">
      <SanteBotao
        v-for="a in ['fila', 'casos', 'lista'] as const"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="t(`agravos.abas.${a}`)"
        :data-testid="`aba-${a}`"
        @acionar="aba = a"
      />
    </div>
    <div v-if="aviso" role="status" data-testid="agravos-aviso">{{ aviso }}</div>
    <ErroAgravo v-if="erro" :erro="erro" />

    <!-- Sugestões a avaliar -->
    <template v-if="aba === 'fila'">
      <div class="linha-ccih">
        <SanteSelecao
          v-model="filtroFila.dias"
          :rotulo="t('agravos.fila.periodo')"
          :opcoes="opDias"
          data-testid="fila-dias"
        />
        <SanteSelecao
          v-model="filtroFila.origem"
          :rotulo="t('agravos.fila.origem')"
          :opcoes="opOrigem"
          data-testid="fila-origem"
        />
        <SanteBotao
          v-if="podeNotificar && !manual"
          :rotulo="t('agravos.manual.abrir')"
          variante="secundario"
          data-testid="manual-abrir"
          @acionar="manual = true"
        />
      </div>
      <NovoCasoManual
        v-if="manual && agora"
        :agora="agora"
        @gravado="(r) => aberto(r, t('agravos.manual.gravado'))"
        @cancelar="manual = false"
      />
      <ErroAgravo v-if="fila.isError.value" :erro="fila.error.value" />
      <p v-else-if="!fila.data.value" role="status">{{ t('agravos.carregando') }}</p>
      <p v-else-if="!fila.data.value.itens.length" data-testid="fila-vazia">
        {{ t('agravos.fila.nenhuma') }}
      </p>
      <template v-else>
        <p v-if="fila.data.value.cortada" class="secundario">{{ t('agravos.cortada') }}</p>
        <table class="tabela" data-testid="tabela-gatilhos">
          <caption>
            {{
              t('agravos.fila.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('agravos.fila.colPrazo') }}</th>
              <th scope="col">{{ t('agravos.fila.colPaciente') }}</th>
              <th scope="col">{{ t('agravos.fila.colAgravo') }}</th>
              <th scope="col">{{ t('agravos.fila.colOrigem') }}</th>
              <th scope="col">{{ t('agravos.fila.colQuando') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in fila.data.value.itens" :key="g.chave" :data-testid="`gatilho-${g.chave}`">
              <td><PrazoAgravo :estado="g.estadoPrazo" :prazo-em="g.prazoEm" :agora="agora || null" /></td>
              <td>
                {{ g.paciente.nome }}
                <div class="secundario">
                  {{
                    g.paciente.prontuario !== null
                      ? t('agravos.prontuario', { n: g.paciente.prontuario })
                      : t('agravos.semProntuario')
                  }}
                </div>
              </td>
              <td>
                <strong>{{ g.cid }}</strong> {{ g.nomeCid }}
                <div>
                  <span
                    :class="g.periodicidade === 'imediata' ? 'selo selo--atencao' : 'selo selo--neutro'"
                    >{{ rotuloPeriodicidadeAgravo(g.periodicidade) }}</span
                  >
                </div>
              </td>
              <td>
                {{ rotuloOrigemCasoAgravo(g.origem) }}
                <div v-if="g.exameNome" class="secundario">
                  {{ t('agravos.fila.resultado', { exame: g.exameNome, resultado: g.resultado ?? '' }) }}
                </div>
                <div v-if="g.unidade" class="secundario">
                  {{ t('agravos.fila.unidade', { unidade: g.unidade }) }}
                </div>
              </td>
              <td>
                {{ dataHora(g.gatilhoEm) }}
                <template v-if="podeNotificar">
                  <SanteBotao
                    v-if="confirmando !== g.chave"
                    :rotulo="t('agravos.fila.abrir')"
                    variante="secundario"
                    :data-testid="`abrir-${g.chave}`"
                    @acionar="confirmando = g.chave"
                  />
                  <div v-else class="painel-ccih" data-testid="confirmar-abertura">
                    <p>{{ t('agravos.fila.abrindo', { cid: g.cid, nome: g.paciente.nome }) }}</p>
                    <div class="linha-ccih">
                      <SanteBotao
                        :rotulo="t('agravos.fila.confirmar')"
                        :desabilitado="abrindo"
                        data-testid="confirmar-abrir"
                        @acionar="abrir(g)"
                      />
                      <SanteBotao
                        :rotulo="t('agravos.cancelar')"
                        variante="texto"
                        @acionar="confirmando = null"
                      />
                    </div>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <!-- Casos -->
    <template v-if="aba === 'casos'">
      <CasoAgravo
        v-if="selecionado !== null && agora"
        :id="selecionado"
        :key="selecionado"
        :pode-notificar="podeNotificar"
        :agora="agora"
        @fechar="selecionado = null"
        @gravado="gravadoNoCaso"
      />
      <div class="linha-ccih">
        <SanteSelecao
          v-model="filtroCasos.situacao"
          :rotulo="t('agravos.casos.situacao')"
          :opcoes="opSituacao"
          data-testid="casos-situacao"
        />
        <SanteSelecao
          v-model="filtroCasos.periodicidade"
          :rotulo="t('agravos.casos.periodicidade')"
          :opcoes="opPeriodicidade"
          data-testid="casos-periodicidade"
        />
      </div>
      <ErroAgravo v-if="casos.isError.value" :erro="casos.error.value" />
      <p v-else-if="!casos.data.value" role="status">{{ t('agravos.carregando') }}</p>
      <p v-else-if="!casos.data.value.itens.length" data-testid="casos-vazio">
        {{ t('agravos.casos.nenhum') }}
      </p>
      <template v-else>
        <p class="secundario" data-testid="casos-total">
          {{ t('agravos.casos.total', { total: casos.data.value.total }) }}
        </p>
        <table class="tabela" data-testid="tabela-casos">
          <caption>
            {{
              t('agravos.casos.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('agravos.casos.colPrazo') }}</th>
              <th scope="col">{{ t('agravos.casos.colPaciente') }}</th>
              <th scope="col">{{ t('agravos.casos.colAgravo') }}</th>
              <th scope="col">{{ t('agravos.casos.colOrigem') }}</th>
              <th scope="col">{{ t('agravos.casos.colSituacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in casos.data.value.itens"
              :key="c.id"
              :data-testid="`caso-${c.id}`"
              :aria-current="selecionado === c.id ? 'true' : undefined"
            >
              <td>
                <PrazoAgravo :estado="c.estadoPrazo" :prazo-em="c.prazoEm" :horas="c.horasRestantes" />
                <div class="secundario">{{ dataHora(c.prazoEm) }}</div>
              </td>
              <td>
                {{ c.paciente.nome }}
                <div class="secundario">
                  {{
                    c.paciente.prontuario !== null
                      ? t('agravos.prontuario', { n: c.paciente.prontuario })
                      : t('agravos.semProntuario')
                  }}
                </div>
              </td>
              <td>
                <strong>{{ c.cid }}</strong> {{ c.nomeCid }}
                <div class="secundario">{{ rotuloPeriodicidadeAgravo(c.periodicidade) }}</div>
              </td>
              <td>{{ rotuloOrigemCasoAgravo(c.origem) }}</td>
              <td>
                {{ rotuloSituacaoCasoAgravo(c.situacao) }}
                <SanteBotao
                  :rotulo="t('agravos.casos.ver')"
                  variante="texto"
                  :data-testid="`ver-caso-${c.id}`"
                  @acionar="selecionado = c.id"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="paginas > 1" class="linha-ccih">
          <SanteBotao
            :rotulo="t('agravos.casos.anterior')"
            variante="texto"
            :desabilitado="filtroCasos.pagina <= 1"
            @acionar="filtroCasos.pagina -= 1"
          />
          <span>{{ t('agravos.casos.pagina', { pagina: filtroCasos.pagina, paginas }) }}</span>
          <SanteBotao
            :rotulo="t('agravos.casos.proxima')"
            variante="texto"
            :desabilitado="filtroCasos.pagina >= paginas"
            @acionar="filtroCasos.pagina += 1"
          />
        </div>
      </template>
    </template>

    <!-- Lista nacional e exames -->
    <ListaNacional v-if="aba === 'lista'" :pode-notificar="podeNotificar" />
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.resumo-agravos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  margin: 0;
}
.resumo-agravos > div {
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
}
.resumo-agravos dt {
  font-size: var(--sgh-fonte-pequena);
}
.resumo-agravos dd {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 600;
}
</style>
