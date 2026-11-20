<script setup lang="ts">
// OPME: conciliação com a conta e rastreio reverso (M46, etapa 3; ficha, seção 7; regras 8 e 9). A conciliação mostra,
// por consumo em sala do período, o usado (consumido menos devolvido) contra o lançado na conta do paciente para o mesmo
// item, a situação (na conta, usado sem cobrança, cobrado a menos ou a mais, devolvido) e o indicador "OPME usado sem
// cobrança" com o numerador e o denominador. O rastreio reverso vai do lote ou da série aos pacientes expostos (recall e
// tecnovigilância; leitura auditada). A tabela é a acessível do @sgh/ui (o volume do período cabe na página; D-GRADE-463).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerConciliacaoOpme } from '../api-opme.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import RastreioOpmePainel from '../componentes/RastreioOpmePainel.vue';
import './estilo-opme.css';

const { t } = useI18n();
const aba = ref<'conciliacao' | 'rastreio'>('conciliacao');
// O rastreio reverso só aparece com a permissão dele (o servidor exige suprimentos.lote.rastrear); quem só tem a
// permissão do rastreio entra pela rota própria, /suprimentos/opme/rastreio.
const podeRastrear = computed(() => pode('suprimentos.lote.rastrear'));
const hoje = new Date().toISOString().slice(0, 10);
const de = ref(`${hoje.slice(0, 8)}01`);
const ate = ref(hoje);
const filtro = ref<'todos' | 'pendentes'>('todos');
const dados = useQuery({
  queryKey: computed(() => ['opme', 'conciliacao', de.value, ate.value]),
  queryFn: () => lerConciliacaoOpme(de.value || null, ate.value || null),
  enabled: computed(() => aba.value === 'conciliacao'),
});
const linhas = computed(() =>
  (dados.data.value?.linhas ?? []).filter(
    (l) => filtro.value === 'todos' || (l.situacao !== 'conciliado' && l.situacao !== 'devolvido'),
  ),
);
const indicador = computed(() => {
  const i = dados.data.value?.indicador;
  if (!i || i.denominador === 0) return t('opme.conciliacao.indicadorVazio');
  return t('opme.conciliacao.indicador', {
    numerador: i.numerador,
    denominador: i.denominador,
    percentual: `${String(i.percentual ?? 0).replace('.', ',')}%`,
  });
});
const diaHora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
</script>

<template>
  <section class="tela-opme" aria-labelledby="opmez-titulo" data-testid="tela-opme-conciliacao">
    <h1 id="opmez-titulo">{{ t('opme.conciliacao.titulo') }}</h1>
    <div class="abas" role="tablist">
      <SanteBotao
        role="tab"
        :aria-selected="aba === 'conciliacao'"
        variante="secundario"
        :rotulo="t('opme.conciliacao.abaConciliacao')"
        data-testid="opmez-aba-conciliacao"
        @acionar="aba = 'conciliacao'"
      />
      <SanteBotao
        v-if="podeRastrear"
        role="tab"
        :aria-selected="aba === 'rastreio'"
        variante="secundario"
        :rotulo="t('opme.conciliacao.abaRastreio')"
        data-testid="opmez-aba-rastreio"
        @acionar="aba = 'rastreio'"
      />
    </div>

    <template v-if="aba === 'conciliacao'">
      <div class="barra">
        <span class="campo">
          <label for="opmez-de">{{ t('opme.periodo.de') }}</label>
          <input id="opmez-de" v-model="de" type="date" data-testid="opmez-de" />
        </span>
        <span class="campo">
          <label for="opmez-ate">{{ t('opme.periodo.ate') }}</label>
          <input id="opmez-ate" v-model="ate" type="date" data-testid="opmez-ate" />
        </span>
        <SanteSelecao
          v-model="filtro"
          :rotulo="t('opme.conciliacao.filtro')"
          :opcoes="[
            { valor: 'todos', rotulo: t('opme.conciliacao.todos') },
            { valor: 'pendentes', rotulo: t('opme.conciliacao.soPendentes') },
          ]"
          data-testid="opmez-filtro"
        />
      </div>
      <ErroSuprimentos v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!dados.data.value" role="status">{{ t('opme.carregando') }}</p>
      <template v-else>
        <SanteAlerta
          :variante="(dados.data.value.indicador.numerador ?? 0) > 0 ? 'aviso' : 'info'"
          :texto="indicador"
          data-testid="opmez-indicador"
        />
        <p v-if="linhas.length === 0">{{ t('opme.conciliacao.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <caption class="secundario">
              {{
                t('opme.conciliacao.acertoNaConta')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('opme.conciliacao.colData') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colAtendimento') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colConta') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colItem') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colRastreio') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colUsada') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colNaConta') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colSituacao') }}</th>
                <th scope="col">{{ t('opme.conciliacao.colNf') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="l in linhas"
                :key="l.consumo"
                :data-testid="`opmez-linha-${l.consumo}`"
                :data-situacao="l.situacao"
              >
                <td>{{ diaHora(l.dataHora) }}</td>
                <td>{{ l.atendimento }}</td>
                <td>{{ l.conta || '—' }}</td>
                <td>{{ l.item }} · {{ l.itemNome ?? '—' }}{{ l.tuss ? ` · TUSS ${l.tuss}` : '' }}</td>
                <td>{{ l.lote ?? l.serie ?? '—' }}</td>
                <td>{{ l.usada }}</td>
                <td>{{ l.naConta }}</td>
                <td :data-testid="`opmez-situacao-${l.consumo}`">
                  {{ t(`opme.conciliacao.situacoes.${l.situacao}`) }}
                </td>
                <td>{{ l.nf ? `${l.nf.doc} (${l.nf.mes}/${l.nf.ano})` : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="dados.data.value.cortada" class="secundario">{{ t('opme.conciliacao.cortada') }}</p>
        </div>
      </template>
    </template>

    <RastreioOpmePainel v-else-if="podeRastrear" />
  </section>
</template>
