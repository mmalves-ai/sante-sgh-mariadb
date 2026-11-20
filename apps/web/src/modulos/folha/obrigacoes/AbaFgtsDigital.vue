<script setup lang="ts">
// Aba "FGTS Digital" (M53.8, etapa F7; consulta com `pessoas.obrigacao.ler`; gerar com `pessoas.obrigacao.gerar`; ficha
// do M53, seções 7 e 8, regras 3 e 7): a apuração da competência fechada na folha (por trabalhador: base, depósito,
// 13º, rescisório, os processamentos e a situação do evento do eSocial que alimenta o FGTS Digital; nunca CPF nem
// nome), a prova da soma com as parcelas, as pendências e os avisos; gerar a apuração (o arquivo de conferência) e,
// depois de emitir a guia no portal do governo, registrar a entrega com a conciliação da guia. O servidor confere tudo.
import type { ApoioObrigacoes, ObrigacaoLegal, ResultadoGeracaoObrigacao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { reais, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { gerarObrigacao, lerApuracaoFgts } from './api-obrigacoes.js';
import { periodosDoTipo } from './comum-obrigacoes.js';
import ObrigacaoGerada from './ObrigacaoGerada.vue';
import ResumoObrigacao from './ResumoObrigacao.vue';

const props = defineProps<{ apoio: ApoioObrigacoes; empresa: number; pode: boolean; hoje: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const B = 'folha.obrigacoes.recusa';

const competencia = ref(props.apoio.competenciaSugerida);
const opcoes = periodosDoTipo('fgts-digital', props.hoje).map((c) => ({
  valor: c,
  rotulo: rotuloCompetencia(c),
}));
const q = useQuery({
  queryKey: computed(() => ['folha', 'obrigacoes', 'fgts', props.empresa, competencia.value]),
  queryFn: () => lerApuracaoFgts({ empresa: props.empresa, competencia: competencia.value }),
});
const a = computed(() => q.data.value ?? null);
const pendenciaDe = (c: string) => a.value?.pendencias.some((p) => p.codigo === c) ?? false;

const vigente = ref<ObrigacaoLegal | null>(null);
const obrigacao = computed(() => vigente.value ?? a.value?.vigente ?? null);
const podeGerar = computed(
  () =>
    props.pode &&
    !!a.value &&
    a.value.exigida &&
    !!a.value.fechamento &&
    a.value.pendencias.length === 0 &&
    obrigacao.value?.situacao !== 'entregue',
);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const resultado = ref<ResultadoGeracaoObrigacao | null>(null);
async function gerar(): Promise<void> {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    const r = await gerarObrigacao({
      empresa: props.empresa,
      tipo: 'fgts-digital',
      periodo: competencia.value,
      simular: false,
      recolhimento: null,
    });
    resultado.value = r;
    if (r.gerado && r.obrigacao) {
      vigente.value = r.obrigacao;
      aviso.value = t('folha.obrigacoes.gerada', {
        tipo: t('folha.obrigacoes.tipos.fgts-digital'),
        periodo: rotuloCompetencia(competencia.value),
        n: r.obrigacao.numero,
      });
    } else aviso.value = t('folha.obrigacoes.nadaGerado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'obrigacoes'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function mudou(o: ObrigacaoLegal, texto: string): Promise<void> {
  vigente.value = o.situacao === 'cancelada' ? null : o;
  aviso.value = texto;
  await cliente.invalidateQueries({ queryKey: ['folha', 'obrigacoes'] });
}
function trocar(c: string): void {
  competencia.value = c;
  vigente.value = null;
  resultado.value = null;
  aviso.value = null;
  erro.value = null;
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.obrigacoes.fgts.titulo')" data-testid="obrigacoes-fgts">
    <h2>{{ t('folha.obrigacoes.fgts.titulo') }}</h2>
    <p class="secundario">{{ t('folha.obrigacoes.fgts.ajuda') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="obrigacoes-fgts-aviso" />
    <ErroFolha v-if="erro" :erro="erro" :base="B" />
    <div class="campos">
      <SanteSelecao
        :model-value="competencia"
        :rotulo="t('folha.obrigacoes.competencia')"
        :opcoes="opcoes"
        busca
        data-testid="obrigacoes-fgts-competencia"
        @update:model-value="(c: string) => trocar(c)"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" :base="B" />
    <p v-else-if="!a" role="status">{{ t('folha.obrigacoes.carregando') }}</p>
    <template v-else>
      <p v-if="!a.exigida" role="status" data-testid="obrigacoes-fgts-nao-exigida">
        {{ t('folha.obrigacoes.fgts.naoExigida') }}
      </p>
      <p data-testid="obrigacoes-fgts-fechamento">
        <template v-if="a.fechamento">{{
          t('folha.obrigacoes.fgts.fechamento', { n: a.fechamento.numero })
        }}</template>
        <template v-else>{{ t('folha.obrigacoes.fgts.semFechamento') }}</template>
        <template v-if="pendenciaDe('folha-nao-fechada')">
          ·
          <RouterLink to="/pessoas/folha?aba=fechamento" data-testid="obrigacoes-fgts-ir-folha">{{
            t('folha.obrigacoes.fgts.abrirFolha')
          }}</RouterLink>
        </template>
        <template v-if="pendenciaDe('evento-esocial-pendente')">
          ·
          <RouterLink to="/pessoas/esocial?aba=periodicos" data-testid="obrigacoes-fgts-ir-esocial">{{
            t('folha.obrigacoes.fgts.abrirEsocial')
          }}</RouterLink>
        </template>
      </p>

      <div
        v-if="a.trabalhadores && a.trabalhadores.length"
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('folha.obrigacoes.fgts.trabalhadores')"
      >
        <table class="tabela" data-testid="obrigacoes-fgts-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.obrigacoes.fgts.vinculo') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.matricula') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.categoria') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.base') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.deposito') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.baseDecimo') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.depositoDecimo') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.rescisorio') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.processos') }}</th>
              <th scope="col">{{ t('folha.obrigacoes.fgts.esocial') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in a.trabalhadores"
              :key="x.vinculo"
              :data-testid="`obrigacoes-fgts-vinculo-${x.vinculo}`"
            >
              <th scope="row">{{ x.vinculo }}</th>
              <td>{{ x.matricula ?? '—' }}</td>
              <td>{{ x.categoria ?? '—' }}</td>
              <td>{{ reais(x.baseFgts) }}</td>
              <td>{{ reais(x.fgts) }}</td>
              <td>{{ reais(x.baseDecimo) }}</td>
              <td>{{ reais(x.fgtsDecimo) }}</td>
              <td>{{ reais(x.rescisorio) }}</td>
              <td>{{ x.processos.join(', ') }}</td>
              <td :data-testid="`obrigacoes-fgts-esocial-${x.vinculo}`">
                {{ t(`folha.obrigacoes.esocial.${x.esocial}`) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ResumoObrigacao
        tipo="fgts-digital"
        :totais="a.totais"
        :trabalhadores="a.trabalhadores?.length ?? a.totais?.trabalhadores ?? 0"
        :conferencia="a.conferencia"
        :pendencias="a.pendencias"
        :avisos="a.avisos"
        prefixo="obrigacoes-fgts"
      />
      <div v-if="podeGerar" class="acoes">
        <SanteBotao
          :rotulo="
            obrigacao?.situacao === 'gerada' ? t('folha.obrigacoes.gerarDeNovo') : t('folha.obrigacoes.gerar')
          "
          :desabilitado="ocupado"
          data-testid="obrigacoes-fgts-gerar"
          @acionar="gerar"
        />
      </div>
      <ResumoObrigacao
        v-if="resultado && !resultado.gerado"
        tipo="fgts-digital"
        :totais="resultado.totais"
        :trabalhadores="resultado.trabalhadores"
        :conferencia="resultado.conferencia"
        :pendencias="resultado.pendencias"
        :avisos="resultado.avisos"
        prefixo="obrigacoes-fgts-resultado"
      />
      <ObrigacaoGerada
        v-if="obrigacao"
        :key="`${obrigacao.id}-${obrigacao.versao}`"
        :obrigacao="obrigacao"
        :pode="pode"
        :hoje="hoje"
        @mudou="mudou"
      />
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
