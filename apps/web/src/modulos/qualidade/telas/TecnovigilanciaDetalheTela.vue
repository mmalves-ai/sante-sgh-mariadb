<script setup lang="ts">
// Um registro de vigilância de produto (M48, etapa 2; rota /qualidade/nsp/tecnovigilancia/:id): o produto, o lote e a
// descrição, o histórico do andamento, o andamento (a situação só anda para a frente; "notificada" exige o número do
// Notivisa) e os pacientes expostos ao lote (só números, sob demanda: a consulta fica na trilha).
import {
  AREAS_VIGILANCIA_PRODUTO,
  CONDUTAS_PRODUTO,
  type CondutaProduto,
  SITUACOES_VIGILANCIA_PRODUTO,
  type SituacaoVigilanciaProduto,
  TIPOS_VIGILANCIA_PRODUTO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveQualidade } from '../api.js';
import { andamentoQueixa, type Expostos, lerExpostos, lerQueixa } from '../api-seguranca.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import { RECUSAS_VIGILANCIA } from '../i18n-seguranca.js';
import { dataHora } from '../regras-qualidade.js';
import { dataCurta, montarAndamento, situacoesSeguintes } from '../regras-seguranca.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const id = computed(() => Number(props.id));
const tela = useQuery({
  queryKey: computed(() => ['qualidade', 'vigilancia', 'registro', id.value]),
  queryFn: () => lerQueixa(id.value),
  enabled: computed(() => Number.isInteger(id.value) && id.value > 0),
});
const r = computed(() => tela.data.value?.registro);
const rotulo = {
  area: (c: string) => AREAS_VIGILANCIA_PRODUTO.find((x) => x.codigo === c)?.rotulo ?? c,
  tipo: (c: string) => TIPOS_VIGILANCIA_PRODUTO.find((x) => x.codigo === c)?.rotulo ?? c,
  situacao: (c: string) => SITUACOES_VIGILANCIA_PRODUTO.find((x) => x.codigo === c)?.rotulo ?? c,
  conduta: (c: string) => CONDUTAS_PRODUTO.find((x) => x.codigo === c)?.rotulo ?? c,
};

const form = reactive({
  situacao: 'aberta' as SituacaoVigilanciaProduto,
  conduta: 'nenhuma' as CondutaProduto,
  notivisaNumero: '',
  texto: '',
});
watch(
  r,
  (x) => {
    if (!x) return;
    Object.assign(form, {
      situacao: x.situacao,
      conduta: x.conduta,
      notivisaNumero: x.notivisaNumero ?? '',
      texto: '',
    });
  },
  { immediate: true },
);
const opSituacao = computed(() =>
  situacoesSeguintes(r.value?.situacao ?? 'aberta').map((s) => ({
    valor: s.codigo as SituacaoVigilanciaProduto,
    rotulo: s.rotulo,
  })),
);
const opConduta = CONDUTAS_PRODUTO.map((c) => ({ valor: c.codigo as CondutaProduto, rotulo: c.rotulo }));

const falta = ref<string | null>(null);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChaveQualidade('andamento');
watch(form, () => {
  if (!gravando.value) chave = novaChaveQualidade('andamento');
});
async function gravar(): Promise<void> {
  if (!r.value) return;
  falta.value = null;
  erro.value = null;
  feito.value = null;
  const m = montarAndamento(form, r.value.id, r.value.versao);
  if (!m.ok) {
    falta.value = m.mensagem;
    return;
  }
  gravando.value = true;
  try {
    const x = await andamentoQueixa(m.entrada, chave);
    feito.value = x.mensagem;
    await tela.refetch();
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// Os expostos: só quando a pessoa pede (cada consulta é registrada na trilha).
const expostos = ref<Expostos | null>(null);
const erroExpostos = ref<unknown>(null);
const consultando = ref(false);
async function verExpostos(): Promise<void> {
  erroExpostos.value = null;
  consultando.value = true;
  try {
    expostos.value = await lerExpostos(id.value);
  } catch (e) {
    erroExpostos.value = e;
  } finally {
    consultando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="vigd-titulo" data-testid="tela-vigilancia-detalhe">
    <ErroQualidade v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!tela.data.value || !r" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <h1 id="vigd-titulo">{{ t('qualidade.vigilancia.detalheTitulo', { n: r.id }) }}</h1>
      <p>
        <RouterLink to="/qualidade/nsp/tecnovigilancia">{{ t('qualidade.vigilancia.voltar') }}</RouterLink>
      </p>
      <dl class="dados" data-testid="vigd-dados">
        <dt>{{ t('qualidade.vigilancia.area') }}</dt>
        <dd>{{ rotulo.area(r.area) }}</dd>
        <dt>{{ t('qualidade.vigilancia.tipo') }}</dt>
        <dd>{{ rotulo.tipo(r.tipo) }}{{ r.alerta ? ` · ${r.alerta}` : '' }}</dd>
        <dt>{{ t('qualidade.vigilancia.produto') }}</dt>
        <dd>{{ r.itemNome ?? r.produto ?? '-' }}</dd>
        <dt>{{ t('qualidade.vigilancia.lote') }}</dt>
        <dd>{{ r.lote ?? '-' }}{{ r.serie ? ` · ${r.serie}` : '' }}</dd>
        <dt>{{ t('qualidade.vigilancia.fabricante') }}</dt>
        <dd>{{ r.fabricante ?? '-' }}{{ r.registroAnvisa ? ` · ${r.registroAnvisa}` : '' }}</dd>
        <dt>{{ t('qualidade.vigilancia.situacao') }}</dt>
        <dd data-testid="vigd-situacao">
          {{ rotulo.situacao(r.situacao) }}{{ r.notivisaNumero ? ` · ${r.notivisaNumero}` : '' }}
        </dd>
        <dt>{{ t('qualidade.vigilancia.conduta') }}</dt>
        <dd>{{ rotulo.conduta(r.conduta) }}</dd>
      </dl>
      <p v-if="tela.data.value.protocoloNotificacao" data-testid="vigd-notificacao">
        {{ t('qualidade.vigilancia.notificacaoLigada', { protocolo: tela.data.value.protocoloNotificacao }) }}
      </p>
      <p>
        <strong>{{ t('qualidade.vigilancia.descricao') }}:</strong> {{ r.descricao }}
      </p>

      <h2>{{ t('qualidade.vigilancia.historico') }}</h2>
      <table class="tabela" data-testid="vigd-historico">
        <caption>
          {{
            t('qualidade.vigilancia.historico')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('qualidade.vigilancia.em') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.por') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.situacao') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.conduta') }}</th>
            <th scope="col">{{ t('qualidade.vigilancia.texto') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(e, i) in tela.data.value.eventos" :key="i">
            <td>{{ dataHora(e.em) }}</td>
            <td>{{ e.por }}</td>
            <td>{{ rotulo.situacao(e.situacao) }}</td>
            <td>{{ rotulo.conduta(e.conduta) }}</td>
            <td>{{ e.texto ?? '-' }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="r.situacao === 'encerrada'" data-testid="vigd-encerrado">
        {{ t('qualidade.vigilancia.encerrado') }}
      </p>
      <form
        v-else-if="tela.data.value.gravacao.registrar"
        class="vig__form"
        data-testid="form-andamento"
        novalidate
        @submit.prevent="gravar"
      >
        <h2>{{ t('qualidade.vigilancia.andamento') }}</h2>
        <SanteSelecao
          v-model="form.situacao"
          :rotulo="t('qualidade.vigilancia.situacao')"
          :opcoes="opSituacao"
          data-testid="vigd-nova-situacao"
        />
        <SanteSelecao
          v-model="form.conduta"
          :rotulo="t('qualidade.vigilancia.conduta')"
          :opcoes="opConduta"
          data-testid="vigd-conduta"
        />
        <SanteCampoTexto
          v-if="form.situacao === 'notificada' || r.notivisaNumero"
          v-model="form.notivisaNumero"
          :rotulo="t('qualidade.vigilancia.notivisaNumero')"
          :max-bytes="30"
          data-testid="vigd-notivisa"
        />
        <SanteCampoTexto
          v-model="form.texto"
          :rotulo="t('qualidade.vigilancia.andamentoTexto')"
          :max-bytes="1000"
          multilinha
          obrigatorio
          data-testid="vigd-texto"
        />
        <SanteAlerta v-if="falta" variante="aviso" :texto="falta" anunciar data-testid="vigd-falta" />
        <ErroQualidade v-if="erro" :erro="erro" :recusas="RECUSAS_VIGILANCIA" />
        <p v-if="feito" role="status" data-testid="vigd-feito">{{ feito }}</p>
        <SanteBotao
          :rotulo="t('qualidade.vigilancia.registrarAndamento')"
          variante="primario"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="vigd-gravar"
        />
      </form>

      <section aria-labelledby="vigd-expostos" data-testid="vigd-expostos">
        <h2 id="vigd-expostos">{{ t('qualidade.vigilancia.expostos') }}</h2>
        <p v-if="!tela.data.value.calculaExpostos">{{ t('qualidade.vigilancia.semLote') }}</p>
        <template v-else>
          <p class="secundario">{{ t('qualidade.vigilancia.expostosAjuda') }}</p>
          <SanteBotao
            v-if="!expostos"
            :rotulo="t('qualidade.vigilancia.verExpostos')"
            variante="secundario"
            :desabilitado="consultando"
            data-testid="vigd-ver-expostos"
            @acionar="verExpostos"
          />
          <ErroQualidade v-if="erroExpostos" :erro="erroExpostos" />
          <template v-if="expostos">
            <p v-if="expostos.expostos.length === 0" data-testid="vigd-sem-expostos">
              {{ t('qualidade.vigilancia.semExpostos') }}
            </p>
            <table v-else class="tabela" data-testid="vigd-tabela-expostos">
              <caption>
                {{
                  t('qualidade.vigilancia.expostos')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('qualidade.vigilancia.origem') }}</th>
                  <th scope="col">{{ t('qualidade.vigilancia.data') }}</th>
                  <th scope="col">{{ t('qualidade.vigilancia.atendimento') }}</th>
                  <th scope="col">{{ t('qualidade.vigilancia.pacienteN') }}</th>
                  <th scope="col">{{ t('qualidade.vigilancia.quantidade') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(x, i) in expostos.expostos" :key="i">
                  <td>{{ t(`qualidade.vigilancia.origens.${x.origem}`) }}</td>
                  <td>{{ dataCurta(x.data) }}</td>
                  <td>{{ x.atendimento }}</td>
                  <td>
                    <RouterLink v-if="x.paciente !== null" :to="`/pep/prontuario/${x.paciente}`">{{
                      t('qualidade.vigilancia.abrirProntuario')
                    }}</RouterLink>
                    <template v-else>-</template>
                  </td>
                  <td>{{ x.quantidade }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="expostos.cortada" role="status">{{ t('qualidade.vigilancia.expostosCortada') }}</p>
          </template>
        </template>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
<style scoped>
.dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.dados dd {
  margin: 0;
}
.vig__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
  margin-block: var(--sgh-espaco-3);
}
.secundario {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
</style>
