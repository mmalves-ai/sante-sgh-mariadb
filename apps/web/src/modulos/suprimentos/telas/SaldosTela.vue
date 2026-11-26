<script setup lang="ts">
// Saldos, lotes, validades e rastreabilidade (ficha do M28, seção 7; regra 8): `/suprimentos/saldos`. A grade item ×
// local × lote × validade da competência corrente (do banco), com o alerta de validade (vencido, vence dentro da
// antecedência do parâmetro, suspeita de dígitos trocados) e o custo médio. O saneamento da validade suspeita (P2,
// permissão própria) grava com motivo quando liberado. Daqui se abre o rastreio do lote. Embaixo, o painel da onda 3
// (M41): o efeito no estoque dos documentos gravados aqui e a conferência de saldo e preço médio.
import type { LoteSaldo } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { corrigirValidade, listarSaldos, novaChave } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import EfeitoEstoquePainel from '../componentes/EfeitoEstoquePainel.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { data, qtd, reais, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { locais, pode, motivo } = usarSuprimentos();
const local = ref('');
const termo = ref('');
const busca = ref('');
const opcoes = computed(() => [
  { valor: '', rotulo: t('suprimentos.todos') },
  ...locais.value.map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const s = useQuery({
  queryKey: computed(() => ['suprimentos', 'saldos', local.value, busca.value]),
  queryFn: () => listarSaldos({ local: local.value ? Number(local.value) : null, termo: busca.value }),
});
const corrigindo = ref<LoteSaldo | null>(null);
const novaValidade = ref('');
const motivoCorrecao = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function corrigir(): Promise<void> {
  const l = corrigindo.value;
  if (!l) return;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await corrigirValidade(
      l.id,
      { validade: novaValidade.value, motivo: motivoCorrecao.value.trim() },
      novaChave('validade'),
    );
    mensagem.value = r.mensagem;
    corrigindo.value = null;
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'saldos'] });
  } catch (x) {
    erro.value = x;
  }
}
const ALERTA: Record<string, string> = {
  vencido: 'alertas.vencido',
  vence: 'alertas.vence',
  suspeita: 'alertas.suspeita',
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sal-titulo" data-testid="tela-suprimentos-saldos">
    <h1 id="sal-titulo">{{ t('suprimentos.saldos.titulo') }}</h1>
    <p>{{ t('suprimentos.saldos.texto') }}</p>
    <form class="filtros" @submit.prevent="busca = termo.trim()">
      <SanteSelecao
        v-model="local"
        :rotulo="t('suprimentos.local')"
        :opcoes="opcoes"
        data-testid="sal-local"
      />
      <span class="campo">
        <label for="sal-termo">{{ t('suprimentos.item') }}</label>
        <input id="sal-termo" v-model="termo" data-testid="sal-termo" />
      </span>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('suprimentos.buscar')"
        data-testid="sal-buscar"
      />
      <RouterLink to="/suprimentos/lotes/rastreio" data-testid="sal-rastreio">{{
        t('suprimentos.rastreio.abrir')
      }}</RouterLink>
    </form>
    <ErroSuprimentos v-if="s.error.value" :erro="s.error.value" />
    <p v-else-if="!s.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <p class="secundario">
        {{
          t('suprimentos.saldos.competencia', {
            m: String(s.data.value.competencia.mes).padStart(2, '0'),
            a: s.data.value.competencia.ano,
          })
        }}
      </p>
      <table class="tabela" data-testid="sal-tabela">
        <caption>
          {{
            t('suprimentos.saldos.grade')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.local') }}</th>
            <th scope="col">{{ t('suprimentos.saldo') }}</th>
            <th scope="col">{{ t('suprimentos.valor') }}</th>
            <th scope="col">{{ t('suprimentos.custoMedio') }}</th>
            <th scope="col">{{ t('suprimentos.lotes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in s.data.value.itens"
            :key="`${x.item}-${x.local}`"
            :data-testid="`sal-${x.item}-${x.local}`"
          >
            <td>
              {{ x.item }} · {{ x.nome }}
              <span v-if="x.controlado" class="secundario"> · {{ t('suprimentos.controlado') }}</span>
            </td>
            <td>{{ x.localNome }}</td>
            <td>{{ qtd(x.quantidade) }} {{ x.unidade }}</td>
            <td>{{ reais(x.valor) }}</td>
            <td>{{ reais(x.custoMedio) }}</td>
            <td>
              <ul v-if="x.lotes.length" class="lotes">
                <li v-for="l in x.lotes" :key="l.id" :data-testid="`sal-lote-${x.item}-${l.lote}`">
                  <RouterLink
                    :to="{ path: '/suprimentos/lotes/rastreio', query: { item: x.item, lote: l.lote } }"
                    >{{ l.lote }}</RouterLink
                  >
                  · {{ data(l.validade) }} · {{ qtd(l.quantidade) }}
                  <strong
                    v-if="l.alerta === 'sem-validade'"
                    :data-testid="`sal-sem-validade-${x.item}-${l.lote}`"
                  >
                    · {{ t('suprimentos.alertas.semValidade') }}</strong
                  >
                  <strong v-else-if="ALERTA[l.alerta]"> · {{ t(`suprimentos.${ALERTA[l.alerta]}`) }}</strong>
                  <SanteBotao
                    v-if="
                      (l.alerta === 'suspeita' || l.alerta === 'sem-validade') &&
                      pode('suprimentos.corrigirValidadeLote')
                    "
                    variante="texto"
                    :rotulo="t('suprimentos.saldos.corrigir')"
                    @acionar="
                      corrigindo = l;
                      novaValidade = '';
                      motivoCorrecao = '';
                    "
                  />
                </li>
              </ul>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="s.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="s.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
    <AvisoSuprimentos
      :motivo="pode('suprimentos.corrigirValidadeLote') ? null : motivo('suprimentos.corrigirValidadeLote')"
    />
    <form v-if="corrigindo" class="painel" @submit.prevent="corrigir">
      <h2>
        {{ t('suprimentos.saldos.corrigirLote', { l: corrigindo.lote, v: data(corrigindo.validade) }) }}
      </h2>
      <span class="campo">
        <label for="sal-val">{{ t('suprimentos.validade') }}</label>
        <input id="sal-val" v-model="novaValidade" type="date" />
      </span>
      <span class="campo">
        <label for="sal-mot">{{ t('suprimentos.motivo') }}</label>
        <input id="sal-mot" v-model="motivoCorrecao" />
      </span>
      <SanteBotao
        tipo="submit"
        :rotulo="t('suprimentos.gravar')"
        :desabilitado="!novaValidade || !motivoCorrecao.trim()"
      />
    </form>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <!-- M41: o efeito no estoque dos documentos gravados aqui (painel de acompanhamento da onda 3). -->
    <EfeitoEstoquePainel />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.lotes {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
