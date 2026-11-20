<script setup lang="ts">
// Análise (causa raiz) e plano de ação 5W2H de uma notificação (M48, etapa 2; ficha, seção 7; rota
// /qualidade/nsp/analises/:id): o que foi notificado (o gestor da área nunca vê quem notificou: a API já projeta), a
// análise pelo método escolhido e o plano de ação. Sem acesso à notificação, a mesma resposta de "não encontrada".
import { CLASSIFICACOES_OMS, GRAUS_DANO, SITUACOES_NOTIFICACAO, TIPOS_INCIDENTE } from '@sgh/contratos';
import { acoesAtivas } from '@sgh/dominio-qualidade';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerAnalise } from '../api-seguranca.js';
import EditorAnalise from '../componentes/EditorAnalise.vue';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import PlanoAcao from '../componentes/PlanoAcao.vue';
import { dataHora } from '../regras-qualidade.js';
import { dataCurta } from '../regras-seguranca.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const id = computed(() => Number(props.id));
const tela = useQuery({
  queryKey: computed(() => ['qualidade', 'analise', id.value]),
  queryFn: () => lerAnalise(id.value),
  enabled: computed(() => Number.isInteger(id.value) && id.value > 0),
});
const d = computed(() => tela.data.value);
const n = computed(() => d.value?.notificacao);
const rotulo = {
  tipo: (c: string) => TIPOS_INCIDENTE.find((x) => x.codigo === c)?.rotulo ?? c,
  classificacao: (c: string) => CLASSIFICACOES_OMS.find((x) => x.codigo === c)?.rotulo ?? c,
  dano: (c: string) => GRAUS_DANO.find((x) => x.codigo === c)?.rotulo ?? c,
  situacao: (c: string) => SITUACOES_NOTIFICACAO.find((x) => x.codigo === c)?.rotulo ?? c,
};
const nsp = computed(() => pode('qualidade.notificacao.ler'));
const registraProduto = computed(() => pode('qualidade.tecnovigilancia.registrar'));
const ativas = computed(() => acoesAtivas(d.value?.acoes ?? []));
const recarregar = () => void tela.refetch();
</script>

<template>
  <section class="tela-agenda" aria-labelledby="analise-titulo" data-testid="tela-analise">
    <ErroQualidade v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!d || !n" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <h1 id="analise-titulo">{{ t('qualidade.analise.titulo', { protocolo: n.protocolo }) }}</h1>
      <p class="acoes">
        <RouterLink to="/qualidade/nsp/analises" data-testid="analise-voltar">{{
          t('qualidade.analise.voltar')
        }}</RouterLink>
        <RouterLink
          v-if="nsp"
          :to="`/qualidade/nsp/notificacoes/${n.id}`"
          data-testid="analise-ir-notificacao"
          >{{ t('qualidade.analise.abrirNotificacao') }}</RouterLink
        >
        <RouterLink
          v-if="registraProduto"
          :to="{
            path: '/qualidade/nsp/tecnovigilancia',
            query: { notificacao: n.id, protocolo: n.protocolo },
          }"
          data-testid="analise-ir-vigilancia"
          >{{ t('qualidade.analise.registrarProduto') }}</RouterLink
        >
      </p>
      <SanteAlerta
        v-if="!d.gravacao.ligada"
        variante="info"
        :texto="d.gravacao.motivo ?? t('qualidade.analise.desligada')"
        data-testid="analise-desligada"
      />

      <section class="cartao" aria-labelledby="analise-notificacao" data-testid="analise-notificacao">
        <h2 id="analise-notificacao">{{ t('qualidade.analise.notificacao') }}</h2>
        <dl class="dados">
          <dt>{{ t('qualidade.analise.tipo') }}</dt>
          <dd>{{ rotulo.tipo(n.tipo) }}{{ n.tipoOutro ? ` (${n.tipoOutro})` : '' }}</dd>
          <dt>{{ t('qualidade.analise.classificacao') }}</dt>
          <dd>
            {{ rotulo.classificacao(n.classificacao) }}
            <span v-if="n.neverEvent" class="selo selo--grave">{{ t('qualidade.analise.neverEvent') }}</span>
          </dd>
          <dt>{{ t('qualidade.analise.dano') }}</dt>
          <dd>{{ rotulo.dano(n.dano) }}</dd>
          <dt>{{ t('qualidade.analise.ocorridoEm') }}</dt>
          <dd>{{ dataHora(n.ocorridoEm) }}</dd>
          <dt>{{ t('qualidade.analise.unidade') }}</dt>
          <dd>{{ n.unidade ?? '-' }}{{ n.local ? ` · ${n.local}` : '' }}</dd>
          <dt>{{ t('qualidade.analise.paciente') }}</dt>
          <dd data-testid="analise-paciente">
            <template v-if="n.paciente">
              {{ n.paciente.nome }}{{ n.paciente.leito ? ` · ${n.paciente.leito}` : '' }}
            </template>
            <template v-else>{{ t('qualidade.analise.semPaciente') }}</template>
          </dd>
          <dt>{{ t('qualidade.analise.situacao') }}</dt>
          <dd data-testid="analise-situacao">{{ rotulo.situacao(n.situacao) }}</dd>
        </dl>
        <p>
          <strong>{{ t('qualidade.analise.descricao') }}:</strong> {{ n.descricao }}
        </p>
        <p v-if="d.prazoAnalise" data-testid="analise-prazo">
          {{ t('qualidade.analise.prazoAnalise', { data: dataCurta(d.prazoAnalise) }) }}
        </p>
      </section>

      <EditorAnalise
        :notificacao="n.id"
        :analise="d.analise"
        :pode-analisar="d.gravacao.acoes.analisar"
        :acoes-ativas="ativas"
        @gravada="recarregar"
      />
      <PlanoAcao
        :notificacao="n.id"
        :acoes="d.acoes"
        :plano="d.plano"
        :pode-planejar="d.gravacao.acoes.planejar"
        @gravado="recarregar"
      />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
<style scoped>
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
.cartao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
  margin-block: var(--sgh-espaco-3);
}
.dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.dados dd {
  margin: 0;
}
</style>
