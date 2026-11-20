<script setup lang="ts">
// Aba "Histórico" das obrigações (M53.8, etapa F7; `pessoas.obrigacao.ler`): todas as gerações da empresa no ano, com
// filtro por obrigação e situação, a soma de verificação e a entrega; o detalhe abre a obrigação com o arquivo, a
// entrega e o cancelamento para quem tem `pessoas.obrigacao.gerar`. Sem CPF, NIS ou nome (só quantidades e valores).
import {
  type ApoioObrigacoes,
  type ObrigacaoLegal,
  SITUACOES_OBRIGACAO,
  type SituacaoObrigacao,
  TIPOS_OBRIGACAO,
  type TipoObrigacao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { instanteBr } from '../comum-folha.js';
import { anosAte } from '../fechamento/comum-fechamento.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerObrigacoes } from './api-obrigacoes.js';
import { rotuloPeriodoObrigacao } from './comum-obrigacoes.js';
import ObrigacaoGerada from './ObrigacaoGerada.vue';

const props = defineProps<{ apoio: ApoioObrigacoes; empresa: number; pode: boolean; hoje: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const B = 'folha.obrigacoes.recusa';

const tipo = ref<TipoObrigacao | ''>('');
const situacao = ref<SituacaoObrigacao | ''>('');
const anos = anosAte(props.hoje, 15);
const ano = ref(anos[0]!);
const opcoesTipo = computed(() => [
  { valor: '' as const, rotulo: t('folha.obrigacoes.todos') },
  ...TIPOS_OBRIGACAO.map((x) => ({ valor: x, rotulo: t(`folha.obrigacoes.tipos.${x}`) })),
]);
const opcoesSituacao = computed(() => [
  { valor: '' as const, rotulo: t('folha.obrigacoes.todas') },
  ...SITUACOES_OBRIGACAO.map((x) => ({ valor: x, rotulo: t(`folha.obrigacoes.situacoes.${x}`) })),
]);
const opcoesAno = anos.map((a) => ({ valor: a, rotulo: a }));
const q = useQuery({
  queryKey: computed(() => [
    'folha',
    'obrigacoes',
    'historico',
    props.empresa,
    tipo.value,
    ano.value,
    situacao.value,
  ]),
  queryFn: () =>
    lerObrigacoes({
      empresa: props.empresa,
      tipo: tipo.value || undefined,
      ano: ano.value,
      situacao: situacao.value || undefined,
    }),
});
const itens = computed(() => q.data.value?.itens ?? []);

const aberta = ref<ObrigacaoLegal | null>(null);
const visivel = ref(false);
const aviso = ref<string | null>(null);
function abrir(o: ObrigacaoLegal): void {
  aberta.value = o;
  visivel.value = true;
}
async function mudou(o: ObrigacaoLegal, texto: string): Promise<void> {
  aberta.value = o;
  aviso.value = texto;
  await cliente.invalidateQueries({ queryKey: ['folha', 'obrigacoes'] });
}
</script>

<template>
  <section
    class="bloco"
    :aria-label="t('folha.obrigacoes.historico.titulo')"
    data-testid="obrigacoes-historico"
  >
    <h2>{{ t('folha.obrigacoes.historico.titulo') }}</h2>
    <p class="secundario">{{ t('folha.obrigacoes.historico.ajuda') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso"
      variante="info"
      anunciar
      data-testid="obrigacoes-historico-aviso"
    />
    <div class="campos">
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('folha.obrigacoes.tipo')"
        :opcoes="opcoesTipo"
        data-testid="obrigacoes-historico-tipo"
      />
      <SanteSelecao
        v-model="ano"
        :rotulo="t('folha.obrigacoes.ano')"
        :opcoes="opcoesAno"
        data-testid="obrigacoes-historico-ano"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('folha.obrigacoes.situacao')"
        :opcoes="opcoesSituacao"
        data-testid="obrigacoes-historico-situacao"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" :base="B" />
    <p v-else-if="!q.data.value" role="status">{{ t('folha.obrigacoes.carregando') }}</p>
    <p v-else-if="itens.length === 0" data-testid="obrigacoes-historico-vazio">
      {{ t('folha.obrigacoes.nenhuma') }}
    </p>
    <template v-else>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('folha.obrigacoes.historico.titulo')">
        <table class="tabela" data-testid="obrigacoes-historico-lista">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.obrigacoes.tipo') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.periodo') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.numero') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.situacao') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.totais.trabalhadores') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.leiaute') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.registro') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in itens" :key="o.id" :data-testid="`obrigacoes-historico-${o.id}`">
              <th scope="row">{{ t(`folha.obrigacoes.tipos.${o.tipo}`) }}</th>
              <td>{{ rotuloPeriodoObrigacao(o.tipo, o.periodo) }}</td>
              <td>{{ o.numero }}</td>
              <td>{{ t(`folha.obrigacoes.situacoes.${o.situacao}`) }}</td>
              <td>{{ o.trabalhadores }}</td>
              <td>
                {{ o.leiaute }} ·
                {{
                  o.leiauteConferido
                    ? t('folha.obrigacoes.leiauteConferido')
                    : t('folha.obrigacoes.leiauteNaoConferido')
                }}
              </td>
              <td class="secundario">{{ o.geradoPor }} · {{ instanteBr(o.geradoEm) }}</td>
              <td>
                <SanteBotao
                  :rotulo="t('folha.obrigacoes.detalhe')"
                  variante="secundario"
                  :data-testid="`obrigacoes-historico-abrir-${o.id}`"
                  @acionar="abrir(o)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="q.data.value.limitado" class="secundario">{{ t('folha.obrigacoes.limitado') }}</p>
    </template>

    <SanteDialogo v-model:visivel="visivel" :titulo="t('folha.obrigacoes.detalhe')" largura="48rem">
      <ObrigacaoGerada
        v-if="aberta"
        :key="`${aberta.id}-${aberta.versao}`"
        :obrigacao="aberta"
        :pode="pode"
        :hoje="hoje"
        @mudou="mudou"
      />
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
