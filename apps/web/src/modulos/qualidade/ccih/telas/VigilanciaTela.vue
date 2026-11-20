<script setup lang="ts">
// Qualidade e segurança › CCIH › Vigilância ativa (M48, etapa 3; ficha, seção 7): a worklist da CCIH com os internados
// que têm algum motivo (dispositivo, restrito sem liberação, febre, cultura, pós-operatório, precaução, IRAS), do mais
// grave para o menos grave, com os filtros por setor, motivo e paciente. "Abrir" mostra a ficha do internado com os
// registros (dispositivos, IRAS, precauções). É também o cartão "CCIH: pacientes em vigilância" da página inicial.
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import {
  MOTIVOS_VIGILANCIA,
  PRECAUCOES,
  rotuloMotivoVigilancia,
  rotuloSituacaoLiberacaoAntimicrobiano,
  TIPOS_DISPOSITIVO_INVASIVO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { lerFormularioCcih, lerVigilancia } from '../api-ccih.js';
import ErroCcih from '../componentes/ErroCcih.vue';
import FichaInternado from '../componentes/FichaInternado.vue';
import NavCcih from '../componentes/NavCcih.vue';
import { classeDaSituacao, filtrarVigilancia, setoresDe } from '../regras-ccih.js';

const { t } = useI18n();
const formulario = useQuery({
  queryKey: ['ccih', 'formulario'],
  queryFn: lerFormularioCcih,
  staleTime: 60_000,
});
const lista = useQuery({
  queryKey: ['ccih', 'vigilancia'],
  queryFn: lerVigilancia,
  refetchInterval: 120_000,
});

const filtro = reactive({ setor: '', motivo: '', busca: '' });
const itens = computed(() => filtrarVigilancia(lista.data.value?.itens ?? [], filtro));
const opSetor = computed(() => [
  { valor: '', rotulo: t('ccih.todos') },
  ...setoresDe(lista.data.value?.itens ?? []).map((s) => ({ valor: s, rotulo: s })),
]);
const opMotivo = [
  { valor: '', rotulo: t('ccih.todos') },
  ...MOTIVOS_VIGILANCIA.map((m) => ({ valor: m.codigo as string, rotulo: m.rotulo })),
];
const sigla = (tipo: string) => TIPOS_DISPOSITIVO_INVASIVO.find((x) => x.codigo === tipo)?.sigla ?? tipo;
const rotuloPrecaucao = (c: string) => PRECAUCOES.find((p) => p.codigo === c)?.rotulo ?? c;
const acoes = computed(
  () => formulario.data.value?.acoes ?? { registrar: false, iras: false, precaucao: false },
);

const aberto = ref<number | null>(null);
async function abrir(internacao: number): Promise<void> {
  aberto.value = internacao;
  await nextTick();
  document.getElementById('ficha-ccih-titulo')?.focus?.();
}
function limpar(): void {
  Object.assign(filtro, { setor: '', motivo: '', busca: '' });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ccih-vigilancia-titulo" data-testid="tela-ccih-vigilancia">
    <h1 id="ccih-vigilancia-titulo">{{ t('ccih.vigilancia.titulo') }}</h1>
    <NavCcih />
    <p class="secundario">{{ t('ccih.vigilancia.explicacao') }}</p>
    <SanteAlerta
      v-if="formulario.data.value && !formulario.data.value.ligada"
      variante="info"
      :texto="formulario.data.value.motivo ?? t('ccih.desligado')"
      data-testid="ccih-desligado"
    />
    <ErroCcih v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('ccih.carregando') }}</p>
    <template v-else>
      <ul class="cartoes" data-testid="vigilancia-resumo">
        <li>
          <strong>{{
            t('ccih.vigilancia.resumo', {
              emVigilancia: lista.data.value.resumo.emVigilancia,
              internados: lista.data.value.resumo.internados,
            })
          }}</strong>
        </li>
        <li>{{ t('ccih.vigilancia.semLiberacao', { n: lista.data.value.resumo.semLiberacao }) }}</li>
        <li>{{ t('ccih.vigilancia.febre', { n: lista.data.value.resumo.febre }) }}</li>
        <li>{{ t('ccih.vigilancia.dispositivos', { n: lista.data.value.resumo.dispositivos }) }}</li>
      </ul>
      <form class="filtros" @submit.prevent>
        <SanteSelecao
          v-model="filtro.setor"
          :rotulo="t('ccih.setor')"
          :opcoes="opSetor"
          data-testid="filtro-setor"
        />
        <SanteSelecao
          v-model="filtro.motivo"
          :rotulo="t('ccih.vigilancia.filtroMotivo')"
          :opcoes="opMotivo"
          data-testid="filtro-motivo"
        />
        <SanteCampoTexto
          v-model="filtro.busca"
          :rotulo="t('ccih.vigilancia.busca')"
          :max-bytes="60"
          data-testid="filtro-busca"
        />
        <SanteBotao :rotulo="t('ccih.vigilancia.limpar')" variante="texto" @acionar="limpar" />
        <SanteBotao :rotulo="t('ccih.vigilancia.atualizar')" variante="texto" @acionar="lista.refetch()" />
      </form>
      <p v-if="lista.data.value.cortada" role="status">{{ t('ccih.cortada') }}</p>
      <p v-if="itens.length === 0" data-testid="vigilancia-nenhum">{{ t('ccih.vigilancia.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-vigilancia">
        <caption>
          {{
            t('ccih.vigilancia.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('ccih.vigilancia.colPaciente') }}</th>
            <th scope="col">{{ t('ccih.vigilancia.colMotivos') }}</th>
            <th scope="col">{{ t('ccih.vigilancia.colDispositivos') }}</th>
            <th scope="col">{{ t('ccih.vigilancia.colAntimicrobianos') }}</th>
            <th scope="col">{{ t('ccih.vigilancia.colCulturas') }}</th>
            <th scope="col">{{ t('ccih.vigilancia.colPrecaucao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens" :key="i.internacao" :data-testid="`vigilancia-${i.internacao}`">
            <td>
              <strong>{{ i.nome }}</strong>
              <div class="secundario">
                {{ t('ccih.prontuario', { n: i.prontuario }) }} · {{ i.leito }} ·
                {{ t('ccih.vigilancia.entrada', { data: dataHora(i.entrada) }) }}
              </div>
              <SanteBotao
                :rotulo="t('ccih.vigilancia.abrir')"
                variante="secundario"
                :data-testid="`abrir-${i.internacao}`"
                @acionar="abrir(i.internacao)"
              />
            </td>
            <td>
              <span
                v-for="m in i.motivos"
                :key="m"
                :class="m === 'antimicrobianoSemLiberacao' || m === 'febre' ? 'selo selo--grave' : 'selo'"
                >{{ rotuloMotivoVigilancia(m as never) }}</span
              >
            </td>
            <td>
              <div v-for="x in i.dispositivos" :key="x.id">
                {{ t('ccih.vigilancia.dias', { sigla: sigla(x.tipo), dias: x.dias }) }}
              </div>
            </td>
            <td>
              <div v-for="(a, k) in i.antimicrobianos" :key="k">
                {{ a.nome }}
                <span v-if="a.restrito" :class="classeDaSituacao(a.situacao)">{{
                  rotuloSituacaoLiberacaoAntimicrobiano(a.situacao as never)
                }}</span>
              </div>
            </td>
            <td>
              <div v-for="c in i.culturas" :key="c.id">
                {{ c.exame }} · {{ dataHora(c.data) }}
                <span class="secundario">{{
                  c.liberado ? t('ccih.vigilancia.culturaLiberada') : t('ccih.vigilancia.culturaPendente')
                }}</span>
              </div>
            </td>
            <td>
              <div v-for="p in i.precaucoes" :key="p">{{ rotuloPrecaucao(p) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="aberto !== null">
        <FichaInternado :internacao="aberto" :acoes="acoes" @alterado="lista.refetch()" />
        <SanteBotao
          :rotulo="t('ccih.fechar')"
          variante="texto"
          data-testid="fechar-ficha"
          @acionar="aberto = null"
        />
      </div>
    </template>
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
