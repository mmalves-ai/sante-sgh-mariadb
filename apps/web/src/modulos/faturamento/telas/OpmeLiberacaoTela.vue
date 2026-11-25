<script setup lang="ts">
// Liberação da OPME acima do limite do procedimento (06-FAT linha 25): `/faturamento/opme-liberacao`.
// Uma fila só: cada pedido retido mostra o paciente, a fonte pagadora, o valor pedido contra o limite e a justificativa
// de quem pediu; liberar é um clique, recusar pede o motivo na hora. Quem pediu vê o próprio pedido sem os botões de
// decisão (quatro olhos, regra do domínio, conferida de novo no servidor) e pode cancelá-lo.
import { conferirDecisaoLiberacaoOpme, type SituacaoLiberacaoOpme } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { decidirLiberacaoOpme, lerLiberacoesOpme, type PedidoLiberacaoOpme } from '../api-opme-liberacao.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const podeLiberar = computed(() => permissoes.value.has('faturamento.autorizacao.liberar'));
const qc = useQueryClient();
const q = useQuery({ queryKey: ['faturamento', 'opme-liberacao'], queryFn: lerLiberacoesOpme });
const abertos = computed(() =>
  (q.data.value?.pedidos ?? []).filter((p) => p.situacao === 'pendente' || p.situacao === 'em_aprovacao'),
);
const decididos = computed(() =>
  (q.data.value?.pedidos ?? []).filter((p) => p.situacao !== 'pendente' && p.situacao !== 'em_aprovacao'),
);
const motivos = reactive<Record<number, string>>({});
const erro = ref<unknown>(null);
const aviso = ref('');
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Validação na hora, pela mesma regra do servidor (solicitante 0 quando o pedido é de outra pessoa). */
function motivoBloqueio(p: PedidoLiberacaoOpme, decisao: 'aprovar' | 'recusar' | 'cancelar'): string | null {
  return conferirDecisaoLiberacaoOpme({
    situacao: p.situacao as SituacaoLiberacaoOpme,
    solicitante: p.meu ? 1 : 0,
    decisor: 1,
    decisao,
    justificativa: motivos[p.id]?.trim() || null,
  });
}

async function decidir(p: PedidoLiberacaoOpme, decisao: 'aprovar' | 'recusar' | 'cancelar') {
  erro.value = null;
  aviso.value = '';
  try {
    const r = await decidirLiberacaoOpme(
      p.id,
      { versao: p.versao, decisao, justificativa: motivos[p.id]?.trim() || null },
      crypto.randomUUID(),
    );
    aviso.value = r.faltam.length
      ? t('opmeLiberacao.faltam', { n: r.faltam.join(', ') })
      : t('opmeLiberacao.feito');
    motivos[p.id] = '';
    await qc.invalidateQueries({ queryKey: ['faturamento', 'opme-liberacao'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela" data-testid="opme-liberacao">
    <h1>{{ t('opmeLiberacao.titulo') }}</h1>
    <p class="secundario">{{ t('opmeLiberacao.explicacao') }}</p>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="opme-lib-aviso">{{ aviso }}</p>
    <template v-if="q.data.value">
      <h2>{{ t('opmeLiberacao.abertos', { n: abertos.length }) }}</h2>
      <p v-if="!abertos.length" class="secundario" data-testid="opme-lib-vazio">
        {{ t('opmeLiberacao.vazio') }}
      </p>
      <article v-for="p in abertos" :key="p.id" :data-testid="`opme-lib-${p.numero}`">
        <h3>
          {{ t('opmeLiberacao.pedido', { numero: p.numero ?? p.solicitacao }) }} ·
          {{ t(`opmeLiberacao.situacoes.${p.situacao}`) }} ·
          {{ t('opmeLiberacao.nivel', { n: p.nivelAtual }) }}
        </h3>
        <dl>
          <dt>{{ t('opmeLiberacao.paciente') }}</dt>
          <dd>{{ p.paciente ?? '—' }}</dd>
          <dt>{{ t('opmeLiberacao.fonte') }}</dt>
          <dd>{{ p.fonte ?? '—' }}</dd>
          <dt>{{ t('opmeLiberacao.solicitante') }}</dt>
          <dd>{{ p.solicitante ?? '—' }}</dd>
          <dt>{{ t('opmeLiberacao.valor') }}</dt>
          <dd data-testid="opme-lib-valor">
            {{ reais(p.valor) }} · {{ t('opmeLiberacao.limite') }}:
            {{ p.limiteValor !== null ? reais(p.limiteValor) : t('opmeLiberacao.semLimiteValor') }}
          </dd>
          <dt>{{ t('opmeLiberacao.justificativa') }}</dt>
          <dd>{{ p.justificativa ?? '—' }}</dd>
        </dl>
        <ul>
          <li v-for="(m, k) in p.motivos" :key="k">{{ m }}</li>
        </ul>
        <p v-if="p.meu" class="secundario" role="note" data-testid="opme-lib-meu">
          {{ t('opmeLiberacao.meu') }}
        </p>
        <form v-if="podeLiberar || p.meu" class="filtros" @submit.prevent>
          <label v-if="!p.meu">
            {{ t('opmeLiberacao.motivo') }}
            <input v-model="motivos[p.id]" maxlength="500" :data-testid="`opme-lib-motivo-${p.numero}`" />
          </label>
          <button
            v-if="!p.meu"
            type="button"
            :disabled="motivoBloqueio(p, 'aprovar') !== null"
            :data-testid="`opme-lib-aprovar-${p.numero}`"
            @click="decidir(p, 'aprovar')"
          >
            {{ t('opmeLiberacao.aprovar') }}
          </button>
          <button
            v-if="!p.meu"
            type="button"
            :disabled="motivoBloqueio(p, 'recusar') !== null"
            :title="motivoBloqueio(p, 'recusar') ?? ''"
            :data-testid="`opme-lib-recusar-${p.numero}`"
            @click="decidir(p, 'recusar')"
          >
            {{ t('opmeLiberacao.recusar') }}
          </button>
          <button
            v-if="p.meu"
            type="button"
            :data-testid="`opme-lib-cancelar-${p.numero}`"
            @click="decidir(p, 'cancelar')"
          >
            {{ t('opmeLiberacao.cancelar') }}
          </button>
        </form>
      </article>

      <h2>{{ t('opmeLiberacao.decididos') }}</h2>
      <article v-for="p in decididos" :key="p.id" :data-testid="`opme-lib-decidido-${p.numero}`">
        <h3>
          {{ t('opmeLiberacao.pedido', { numero: p.numero ?? p.solicitacao }) }} ·
          {{ t(`opmeLiberacao.situacoes.${p.situacao}`) }} · {{ reais(p.valor) }}
        </h3>
        <ul :aria-label="t('opmeLiberacao.historico')">
          <li v-for="(d, k) in p.decisoes" :key="k">
            {{ t('opmeLiberacao.nivel', { n: d.nivel }) }}: {{ d.aprovador ?? '—' }}
            {{ t(`opmeLiberacao.decisoesNome.${d.decisao}`) }}
            <span v-if="d.justificativa">· {{ d.justificativa }}</span>
          </li>
        </ul>
      </article>
    </template>
  </section>
</template>
