<script setup lang="ts">
// A versão aberta do orçamento (M54, etapa 7): o cabeçalho (situação, origem, quem criou, alterou, aprovou ou
// descartou), o total do ano com as parcelas, a aprovação (segregação: o motivo da recusa fica visível) e o descarte
// com motivo; as abas Valores por mês (a grade) e Orçado × realizado. As ações seguem o que o servidor devolve no
// detalhe (`acoes`); ele confere de novo ao gravar.
import {
  type ApoioOrcamento,
  esquemaAprovarOrcamento,
  esquemaDescartarOrcamento,
  ROTULOS_SITUACAO_VERSAO_ORCAMENTO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraBr } from '../pep/formato.js';
import { aprovarOrcamento, descartarOrcamento, lerDetalheOrcamento } from './api-orcamento.js';
import { reais } from './comum-orcamento.js';
import ComparativoOrcamento from './ComparativoOrcamento.vue';
import ErroOrcamento from './ErroOrcamento.vue';
import GradeOrcamento from './GradeOrcamento.vue';

const props = defineProps<{ id: number; apoio: ApoioOrcamento; hoje: string }>();
const emit = defineEmits<{ voltar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const detalhe = useQuery({
  queryKey: computed(() => ['orcamento', 'versao', props.id]),
  queryFn: () => lerDetalheOrcamento(props.id),
});
const d = computed(() => detalhe.data.value ?? null);
const o = computed(() => d.value?.orcamento ?? null);

type Aba = 'valores' | 'comparativo';
const ABAS: readonly Aba[] = ['valores', 'comparativo'];
const aba = ref<Aba>('valores');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);

const aprovando = ref(false);
const observacao = ref('');
const descartando = ref(false);
const motivo = ref('');
const entradaDescarte = computed(() =>
  esquemaDescartarOrcamento.safeParse({ versao: o.value?.versao ?? 0, motivo: motivo.value }),
);

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['orcamento'] });
}

async function aoGravar(texto: string): Promise<void> {
  mensagem.value = texto;
  await recarregar();
}

async function aprovar(): Promise<void> {
  if (!o.value || enviando.value) return;
  const e = esquemaAprovarOrcamento.safeParse({
    versao: o.value.versao,
    observacao: observacao.value.trim() || null,
  });
  if (!e.success) return;
  enviando.value = true;
  erro.value = null;
  try {
    const r = await aprovarOrcamento(props.id, e.data);
    mensagem.value =
      r.substituida !== null
        ? t('orcamentoEmpresarial.aprovacao.aprovadaSubstituiu')
        : t('orcamentoEmpresarial.aprovacao.aprovada');
    aprovando.value = false;
    await recarregar();
  } catch (x) {
    erro.value = x;
    aprovando.value = false;
  } finally {
    enviando.value = false;
  }
}

async function descartar(): Promise<void> {
  if (!entradaDescarte.value.success || enviando.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await descartarOrcamento(props.id, entradaDescarte.value.data);
    mensagem.value = t('orcamentoEmpresarial.descarte.descartada');
    descartando.value = false;
    await recarregar();
  } catch (x) {
    erro.value = x;
    descartando.value = false;
  } finally {
    enviando.value = false;
  }
}

const porEm = (quem: string | null, quando: string | null) =>
  t('orcamentoEmpresarial.detalhe.porEm', { quem: quem ?? '', quando: dataHoraBr(quando) });
</script>

<template>
  <section class="bloco" aria-labelledby="orc-versao-titulo" data-testid="orc-versao">
    <div class="acoes">
      <SanteBotao
        :rotulo="t('orcamentoEmpresarial.detalhe.voltar')"
        variante="texto"
        data-testid="orc-voltar"
        @acionar="emit('voltar')"
      />
    </div>
    <ErroOrcamento v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!d || !o" role="status">{{ t('orcamentoEmpresarial.carregando') }}</p>
    <template v-else>
      <h2 id="orc-versao-titulo">
        {{
          t('orcamentoEmpresarial.detalhe.titulo', { numero: o.numero, ano: o.ano, descricao: o.descricao })
        }}
      </h2>
      <dl class="dados" data-testid="orc-cabecalho">
        <dt>{{ t('orcamentoEmpresarial.detalhe.situacao') }}</dt>
        <dd data-testid="orc-situacao">{{ ROTULOS_SITUACAO_VERSAO_ORCAMENTO[o.situacao] }}</dd>
        <dt>{{ t('orcamentoEmpresarial.detalhe.origem') }}</dt>
        <dd>{{ o.base }}</dd>
        <dt>{{ t('orcamentoEmpresarial.detalhe.total') }}</dt>
        <dd data-testid="orc-total">
          {{ t('orcamentoEmpresarial.moeda', { valor: reais(o.totalCentavos) }) }}
          <span class="secundario">
            ({{
              t('orcamentoEmpresarial.versoes.conta', {
                receita: reais(o.totaisPorNatureza.receita),
                despesa: reais(o.totaisPorNatureza.despesa),
                consumo: reais(o.totaisPorNatureza.consumo),
              })
            }})
          </span>
        </dd>
        <dt>{{ t('orcamentoEmpresarial.detalhe.criado') }}</dt>
        <dd>{{ porEm(o.criadoPor, o.criadoEm) }}</dd>
        <dt>{{ t('orcamentoEmpresarial.detalhe.alterado') }}</dt>
        <dd>{{ porEm(o.alteradoPor, o.alteradoEm) }}</dd>
        <template v-if="o.aprovadoPor">
          <dt>{{ t('orcamentoEmpresarial.detalhe.aprovado') }}</dt>
          <dd data-testid="orc-aprovado-por">{{ porEm(o.aprovadoPor, o.aprovadoEm) }}</dd>
        </template>
        <template v-if="o.observacaoAprovacao">
          <dt>{{ t('orcamentoEmpresarial.detalhe.observacaoAprovacao') }}</dt>
          <dd>{{ o.observacaoAprovacao }}</dd>
        </template>
        <template v-if="o.descartadoPor">
          <dt>{{ t('orcamentoEmpresarial.detalhe.descartado') }}</dt>
          <dd>{{ o.descartadoPor }}</dd>
          <dt>{{ t('orcamentoEmpresarial.detalhe.motivoDescarte') }}</dt>
          <dd data-testid="orc-motivo-descarte">{{ o.motivoDescarte }}</dd>
        </template>
      </dl>

      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="orc-mensagem" />
      <ErroOrcamento v-if="erro" :erro="erro" />
      <SanteAlerta
        v-if="o.situacao !== 'rascunho'"
        :texto="t('orcamentoEmpresarial.detalhe.fechada')"
        variante="info"
        data-testid="orc-fechada"
      />

      <div v-if="o.situacao === 'rascunho'" class="acoes">
        <SanteBotao
          :rotulo="t('orcamentoEmpresarial.detalhe.aprovar')"
          :desabilitado="!d.acoes.aprovar"
          data-testid="orc-aprovar"
          @acionar="aprovando = true"
        />
        <SanteBotao
          v-if="d.acoes.descartar"
          :rotulo="t('orcamentoEmpresarial.detalhe.descartar')"
          variante="secundario"
          data-testid="orc-descartar"
          @acionar="descartando = true"
        />
      </div>
      <p
        v-if="o.situacao === 'rascunho' && !d.acoes.aprovar && d.acoes.motivoSemAprovar"
        class="secundario"
        data-testid="orc-motivo-sem-aprovar"
      >
        {{ t('orcamentoEmpresarial.detalhe.semAprovar', { motivo: d.acoes.motivoSemAprovar }) }}
      </p>

      <SanteDialogo
        v-model:visivel="aprovando"
        :titulo="t('orcamentoEmpresarial.aprovacao.titulo', { numero: o.numero, ano: o.ano })"
      >
        <form class="bloco" data-testid="orc-form-aprovar" @submit.prevent="aprovar">
          <p>{{ t('orcamentoEmpresarial.aprovacao.texto') }}</p>
          <SanteCampoTexto
            v-model="observacao"
            :rotulo="t('orcamentoEmpresarial.aprovacao.observacao')"
            :max-bytes="400"
            multilinha
            data-testid="orc-aprovar-observacao"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('orcamentoEmpresarial.nova.cancelar')"
              variante="texto"
              @acionar="aprovando = false"
            />
            <SanteBotao
              :rotulo="t('orcamentoEmpresarial.aprovacao.confirmar')"
              tipo="submit"
              :desabilitado="enviando"
              data-testid="orc-aprovar-confirmar"
            />
          </div>
        </form>
      </SanteDialogo>
      <SanteDialogo
        v-model:visivel="descartando"
        :titulo="t('orcamentoEmpresarial.descarte.titulo', { numero: o.numero, ano: o.ano })"
      >
        <form class="bloco" data-testid="orc-form-descartar" @submit.prevent="descartar">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('orcamentoEmpresarial.descarte.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="orc-descartar-motivo"
          />
          <p v-if="!entradaDescarte.success" class="secundario">
            {{ t('orcamentoEmpresarial.descarte.motivoCurto') }}
          </p>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('orcamentoEmpresarial.nova.cancelar')"
              variante="texto"
              @acionar="descartando = false"
            />
            <SanteBotao
              :rotulo="t('orcamentoEmpresarial.descarte.confirmar')"
              tipo="submit"
              :desabilitado="!entradaDescarte.success || enviando"
              data-testid="orc-descartar-confirmar"
            />
          </div>
        </form>
      </SanteDialogo>

      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in ABAS"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`orcamentoEmpresarial.detalhe.abas.${x}`)"
          :data-testid="`orc-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <GradeOrcamento
        v-if="aba === 'valores'"
        :key="`${o.id}-${o.versao}`"
        :detalhe="d"
        :apoio="apoio"
        @gravado="aoGravar"
      />
      <ComparativoOrcamento v-else :id="o.id" :ano="o.ano" :hoje="hoje" :apoio="apoio" />
    </template>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
