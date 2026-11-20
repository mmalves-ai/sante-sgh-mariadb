<script setup lang="ts">
// Aba "Lançamentos" (M53.9, etapa F8; `pessoas.integracao.ler`): os lançamentos de títulos da folha no ano, com o
// líquido, os encargos e o total, e o detalhe com cada título (destino, documento, valor, vencimento e a situação relida
// do contas a pagar: em aberto ou pago), com o atalho ao título para quem consulta o contas a pagar.
import type { ApoioIntegracaoFolha, LancamentoFolha } from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { dataBr } from '../../pessoas/comum.js';
import { instanteBr, reais } from '../comum-folha.js';
import { anosAte, rotuloPeriodo } from '../fechamento/comum-fechamento.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerLancamento, lerLancamentos } from './api-integracao.js';

const props = defineProps<{ apoio: ApoioIntegracaoFolha; empresa: number }>();
const { t } = useI18n();
const { permissoes } = usarSessao();
const veTitulo = computed(() => permissoes.value.has('financeiro.tituloPagar.ler'));

const anos = anosAte(props.apoio.hoje);
const ano = ref<string>(anos[0]!);
const opcoesAno = anos.map((a) => ({ valor: a, rotulo: a }));
const lista = useQuery({
  queryKey: computed(() => ['folha', 'integracao', 'lancamentos', props.empresa, ano.value]),
  queryFn: () => lerLancamentos(props.empresa, Number(ano.value)),
});
const itens = computed(() => lista.data.value?.itens ?? []);
const periodo = (l: Pick<LancamentoFolha, 'apuracao' | 'periodo'>) =>
  rotuloPeriodo(l.apuracao, l.periodo, (a) => t('folha.integracao.rotuloAnual', { ano: a }));

const detalhe = ref<LancamentoFolha | null>(null);
const visivel = ref(false);
const erro = ref<unknown>(null);
async function abrir(id: number): Promise<void> {
  erro.value = null;
  try {
    detalhe.value = await lerLancamento(id);
    visivel.value = true;
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section
    class="bloco"
    :aria-label="t('folha.integracao.lancamentos.titulo')"
    data-testid="integracao-lancamentos"
  >
    <h2>{{ t('folha.integracao.lancamentos.titulo') }}</h2>
    <div class="campos">
      <SanteSelecao
        v-model="ano"
        :rotulo="t('folha.integracao.lancar.ano')"
        :opcoes="opcoesAno"
        data-testid="integracao-lancamentos-ano"
      />
    </div>
    <ErroFolha v-if="erro" :erro="erro" />
    <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('folha.integracao.carregando') }}</p>
    <p v-else-if="itens.length === 0" data-testid="integracao-lancamentos-vazio">
      {{ t('folha.integracao.lancamentos.nenhum') }}
    </p>
    <div
      v-else
      class="rolagem"
      tabindex="0"
      role="region"
      :aria-label="t('folha.integracao.lancamentos.titulo')"
    >
      <table class="tabela" data-testid="integracao-lancamentos-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.integracao.lancamentos.numero') }}</th>
            <th scope="col">{{ t('folha.integracao.lancamentos.periodo') }}</th>
            <th scope="col">{{ t('folha.integracao.lancamentos.origem') }}</th>
            <th scope="col">{{ t('folha.integracao.lancamentos.liquido') }}</th>
            <th scope="col">{{ t('folha.integracao.lancamentos.encargos') }}</th>
            <th scope="col">{{ t('folha.integracao.lancamentos.total') }}</th>
            <th scope="col">{{ t('folha.integracao.lancamentos.lancadoPor') }}</th>
            <th scope="col">{{ t('folha.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in itens" :key="l.id" :data-testid="`integracao-lancamento-${l.id}`">
            <th scope="row">{{ l.id }}</th>
            <td>{{ periodo(l) }}</td>
            <td>
              {{
                t('folha.integracao.origemNumero', {
                  origem: t(`folha.integracao.origens.${l.origem}`),
                  n: l.idOrigem,
                })
              }}
            </td>
            <td>{{ reais(l.liquido) }}</td>
            <td>{{ reais(l.encargos) }}</td>
            <td>{{ reais(l.total) }}</td>
            <td>
              {{
                t('folha.integracao.lancamentos.porEm', { por: l.lancadoPor, em: instanteBr(l.lancadoEm) })
              }}
            </td>
            <td class="acoes">
              <SanteBotao
                :rotulo="t('folha.integracao.lancamentos.detalhe')"
                variante="secundario"
                :data-testid="`integracao-lancamento-detalhe-${l.id}`"
                @acionar="abrir(l.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="
        detalhe
          ? t('folha.integracao.lancamentos.detalheTitulo', { n: detalhe.id, periodo: periodo(detalhe) })
          : ''
      "
      largura="60rem"
    >
      <div v-if="detalhe" data-testid="integracao-lancamento-detalhe">
        <p>
          {{
            t('folha.integracao.lancamentos.porEm', {
              por: detalhe.lancadoPor,
              em: instanteBr(detalhe.lancadoEm),
            })
          }}
          · {{ t('folha.integracao.lancamentos.fatos') }}: {{ detalhe.fatos }}
        </p>
        <div
          class="rolagem"
          tabindex="0"
          role="region"
          :aria-label="t('folha.integracao.lancamentos.detalhe')"
        >
          <table class="tabela" data-testid="integracao-lancamento-titulos">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.integracao.lancar.destino') }}</th>
                <th scope="col">{{ t('folha.integracao.lancamentos.tituloPagar') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.credor') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.documento') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.valor') }}</th>
                <th scope="col">{{ t('folha.integracao.lancar.vencimento') }}</th>
                <th scope="col">{{ t('folha.integracao.lancamentos.situacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="x in detalhe.titulos"
                :key="x.chave"
                :data-testid="`integracao-lancado-${x.destino}`"
              >
                <th scope="row">{{ t(`folha.integracao.destinos.${x.destino}`) }}</th>
                <td>
                  <RouterLink
                    v-if="veTitulo"
                    :to="`/financeiro/pagar/titulos/${x.titulo}`"
                    :aria-label="`${t('folha.integracao.lancamentos.abrirTitulo')} ${x.titulo}`"
                    >{{ x.titulo }}</RouterLink
                  >
                  <template v-else>{{ x.titulo }}</template>
                </td>
                <td>{{ x.credor ?? '' }}</td>
                <td>{{ x.documento }}</td>
                <td>{{ reais(x.valor) }}</td>
                <td>{{ dataBr(x.vencimento) }}</td>
                <td :data-testid="`integracao-lancado-situacao-${x.destino}`">
                  {{
                    x.pago ? t('folha.integracao.lancamentos.pago') : t('folha.integracao.lancamentos.aberto')
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p data-testid="integracao-lancamento-soma">
          {{
            t('folha.integracao.lancamentos.soma', {
              liquido: reais(detalhe.liquido),
              encargos: reais(detalhe.encargos),
              total: reais(detalhe.total),
            })
          }}
        </p>
        <p class="secundario">
          {{ t('folha.integracao.lancar.resumo') }}: <code>{{ detalhe.resumo }}</code>
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.fechar')"
            variante="secundario"
            data-testid="integracao-lancamento-fechar"
            @acionar="visivel = false"
          />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
