<script setup lang="ts">
// Situação dos colaboradores ativos nos cursos obrigatórios (M52.6; regra 20; NR32-04: capacitação continuada): as
// contagens, os pendentes por unidade e a ficha de cada colaborador (cursos, histórico de turmas e POPs com a ciência).
import { type ApoioTreinamento, PRESENCAS_TREINAMENTO, SITUACOES_TREINAMENTO } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import { lerFicha, lerSituacao } from './api-f6.js';

const props = defineProps<{ apoio: ApoioTreinamento }>();
const { t } = useI18n();
const unidade = ref<number | null>(null);
const situacao = ref<'comPendencia' | 'todas'>('comPendencia');
const termo = ref('');
const termoAplicado = ref('');
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('f6.realizado.todas') },
  ...props.apoio.unidades.map((u) => ({ valor: u.codigo as number | null, rotulo: u.rotulo })),
]);
const opcoesSituacao = computed(() => [
  { valor: 'comPendencia' as const, rotulo: t('f6.treinamentos.situacao.comPendencia') },
  { valor: 'todas' as const, rotulo: t('f6.treinamentos.situacao.todas') },
]);
const painel = useQuery({
  queryKey: computed(() => ['f6', 'situacao', unidade.value, situacao.value, termoAplicado.value]),
  queryFn: () =>
    lerSituacao({
      ...(unidade.value !== null ? { unidade: unidade.value } : {}),
      situacao: situacao.value,
      ...(termoAplicado.value ? { termo: termoAplicado.value } : {}),
    }),
});
const p = computed(() => painel.data.value ?? null);
const vinculo = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['f6', 'ficha', vinculo.value]),
  queryFn: () => lerFicha(vinculo.value!),
  enabled: computed(() => vinculo.value !== null),
});
const f = computed(() => ficha.data.value ?? null);
const textoPendencia = (x: { situacao: string; validoAte: string | null }) =>
  x.situacao === 'pendente'
    ? t('f6.treinamentos.situacao.nuncaFeito')
    : x.situacao === 'vencido'
      ? t('f6.treinamentos.situacao.venceuEm', { d: dataBr(x.validoAte) })
      : t('f6.treinamentos.situacao.venceEm', { d: dataBr(x.validoAte) });
</script>

<template>
  <section class="bloco" aria-labelledby="treino-situacao" data-testid="treino-situacao">
    <h2 id="treino-situacao">{{ t('f6.treinamentos.abas.situacao') }}</h2>
    <form class="campos" @submit.prevent="termoAplicado = termo.trim()">
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('f6.treinamentos.situacao.filtroUnidade')"
        :opcoes="opcoesUnidade"
        data-testid="situacao-unidade"
      />
      <SanteOpcoes
        v-model="situacao"
        :legenda="t('f6.treinamentos.situacao.filtroSituacao')"
        :opcoes="opcoesSituacao"
        data-testid="situacao-filtro"
      />
      <SanteCampoTexto v-model="termo" :rotulo="t('f6.treinamentos.situacao.termo')" :max-bytes="60" />
      <SanteBotao :rotulo="t('f6.buscar')" tipo="submit" variante="secundario" />
    </form>
    <ErroPessoas v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!p" role="status">{{ t('f6.carregando') }}</p>
    <template v-else>
      <p data-testid="situacao-contagem">
        {{
          t('f6.treinamentos.situacao.colaboradores', {
            n: p.contagem.colaboradores,
            emDia: p.contagem.emDia,
            aVencer: p.contagem.aVencer,
            vencidos: p.contagem.vencidos,
            pendentes: p.contagem.pendentes,
          })
        }}
      </p>
      <p v-if="p.limitado" class="secundario">{{ t('f6.limitado') }}</p>
      <p v-if="p.itens.length === 0">{{ t('f6.nenhum') }}</p>
      <table v-else class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('f6.treinamentos.situacao.colaborador') }}</th>
            <th scope="col">{{ t('f6.treinamentos.situacao.unidade') }}</th>
            <th scope="col">{{ t('f6.treinamentos.situacao.pendencias') }}</th>
            <th scope="col">{{ t('f6.treinamentos.situacao.pops') }}</th>
            <th scope="col"><span class="secundario">—</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in p.itens" :key="x.vinculo" :data-testid="`situacao-${x.vinculo}`">
            <th scope="row">
              {{ x.nome }} <span v-if="x.matricula" class="secundario">{{ x.matricula }}</span>
              <div class="secundario">{{ x.funcao }}</div>
            </th>
            <td>{{ x.unidadeNome ?? '' }}</td>
            <td>
              <span v-if="x.pendencias.length === 0">{{ t('f6.treinamentos.situacao.emDia') }}</span>
              <ul v-else class="lista-simples">
                <li v-for="c in x.pendencias" :key="c.curso" :class="`situacao-${c.situacao}`">
                  {{ c.titulo }} — {{ SITUACOES_TREINAMENTO[c.situacao] }} ({{ textoPendencia(c) }})
                </li>
              </ul>
            </td>
            <td>{{ x.popsPendentes }}</td>
            <td>
              <SanteBotao
                :rotulo="t('f6.treinamentos.situacao.ficha')"
                variante="texto"
                :data-testid="`ficha-${x.vinculo}`"
                @acionar="vinculo = x.vinculo"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
  <section v-if="vinculo !== null" class="bloco" aria-labelledby="treino-ficha" data-testid="treino-ficha">
    <ErroPessoas v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!f" role="status">{{ t('f6.carregando') }}</p>
    <template v-else>
      <h2 id="treino-ficha">{{ t('f6.treinamentos.situacao.ficha') }}: {{ f.colaborador.nome }}</h2>
      <p class="secundario">
        {{ f.colaborador.funcao ?? f.colaborador.cargo }} · {{ f.colaborador.unidadeNome ?? '' }}
      </p>
      <h3>{{ t('f6.treinamentos.ficha.cursos') }}</h3>
      <ul class="lista-simples">
        <li v-for="c in f.cursos" :key="c.curso" :data-testid="`ficha-curso-${c.codigo}`">
          {{ c.titulo }} — {{ SITUACOES_TREINAMENTO[c.situacao] }}
          <span class="secundario">
            {{ c.obrigatorio ? t('f6.treinamentos.ficha.obrigatorio') : '' }}
            {{
              c.validoAte
                ? t('f6.treinamentos.ficha.valido', { d: dataBr(c.validoAte) })
                : c.ultimaConclusao
                  ? t('f6.treinamentos.ficha.semValidade')
                  : ''
            }}
          </span>
        </li>
      </ul>
      <h3>{{ t('f6.treinamentos.ficha.historico') }}</h3>
      <p v-if="f.participacoes.length === 0">{{ t('f6.nenhum') }}</p>
      <ul v-else class="lista-simples">
        <li v-for="h in f.participacoes" :key="h.treinamento">
          {{ dataBr(h.inicio) }} · {{ h.cursoTitulo }} · {{ h.instrutor }} ·
          {{ PRESENCAS_TREINAMENTO[h.presenca] }}
          <span v-if="h.conclusao" class="secundario">{{ dataBr(h.conclusao) }}</span>
        </li>
      </ul>
      <h3>{{ t('f6.treinamentos.ficha.pops') }}</h3>
      <ul class="lista-simples">
        <li v-for="pop in f.pops" :key="pop.id">
          {{ pop.codigo }} {{ t('f6.versao', { v: pop.versao }) }} · {{ pop.titulo }} —
          {{
            pop.ciente
              ? pop.origemCiencia === 'treinamento'
                ? t('f6.treinamentos.ficha.cienteTurma', { d: dataBr(pop.ciente) })
                : t('f6.treinamentos.ficha.ciente', { d: dataBr(pop.ciente) })
              : t('f6.treinamentos.ficha.semCiencia')
          }}
        </li>
      </ul>
      <div class="acoes">
        <SanteBotao :rotulo="t('f6.fechar')" variante="texto" @acionar="vinculo = null" />
      </div>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.lista-simples {
  margin: 0;
  padding-left: 1rem;
}
.situacao-vencido,
.situacao-pendente {
  font-weight: 600;
}
</style>
