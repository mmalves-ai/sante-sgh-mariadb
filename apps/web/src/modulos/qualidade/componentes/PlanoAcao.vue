<script setup lang="ts">
// O plano de ação 5W2H da notificação (M48, etapa 2; ficha, seção 7): as ações com o resumo (abertas, atrasadas,
// concluídas, canceladas e eficazes entre as verificadas), incluir e alterar com o responsável buscado entre as contas
// ativas, iniciar, concluir com a evidência, cancelar com o motivo e verificar a eficácia da concluída. Cada mudança
// vai com a versão lida da ação; o plano continua depois de concluída a análise.
import { type AcaoPlanoLida, EFICACIAS_ACAO, type EficaciaAcao, SITUACOES_ACAO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveQualidade } from '../api.js';
import { buscarResponsaveis, registrarPlanoAcao, type TelaAnalise } from '../api-seguranca.js';
import { RECUSAS_ANALISE } from '../i18n-seguranca.js';
import { dataHora } from '../regras-qualidade.js';
import { dataCurta, type FormularioAcao, formularioDaAcao, montarAcao } from '../regras-seguranca.js';
import ErroQualidade from './ErroQualidade.vue';

const props = defineProps<{
  notificacao: number;
  acoes: readonly AcaoPlanoLida[];
  plano: TelaAnalise['plano'];
  podePlanejar: boolean;
}>();
const emit = defineEmits<{ gravado: [] }>();
const { t } = useI18n();

type Modo =
  | { tipo: 'incluir' }
  | { tipo: 'alterar'; acao: AcaoPlanoLida }
  | { tipo: 'situacao'; acao: AcaoPlanoLida; situacao: 'emAndamento' | 'concluida' | 'cancelada' }
  | { tipo: 'eficacia'; acao: AcaoPlanoLida };
const modo = ref<Modo | null>(null);
const form = reactive<FormularioAcao>(formularioDaAcao());
const texto = ref('');
const eficacia = ref<EficaciaAcao | ''>('');
const falta = ref<string | null>(null);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChaveQualidade('plano');

function abrir(m: Modo): void {
  modo.value = m;
  falta.value = null;
  erro.value = null;
  feito.value = null;
  texto.value = '';
  eficacia.value = '';
  Object.assign(form, formularioDaAcao(m.tipo === 'alterar' ? m.acao : null));
  busca.value = '';
  termo.value = '';
  chave = novaChaveQualidade('plano');
}
function fechar(): void {
  modo.value = null;
}

// O responsável: busca remota (2 letras ou mais) entre as contas ativas; na alteração, o atual fica como opção.
const busca = ref('');
const termo = ref('');
const pessoas = useQuery({
  queryKey: computed(() => ['qualidade', 'responsaveis', termo.value]),
  queryFn: () => buscarResponsaveis(termo.value),
  enabled: computed(() => termo.value.length >= 2),
});
const opResponsavel = computed(() => {
  const itens = (pessoas.data.value?.itens ?? []).map((p) => ({
    valor: p.login,
    rotulo: `${p.nome} (${p.login})`,
  }));
  if (form.quem && !itens.some((i) => i.valor === form.quem))
    itens.unshift({ valor: form.quem, rotulo: form.quem });
  return [{ valor: '', rotulo: t('qualidade.plano.escolhaResponsavel') }, ...itens];
});
function buscar(): void {
  termo.value = busca.value.trim().slice(0, 40);
}

const rotuloSituacao = (c: string) => SITUACOES_ACAO.find((s) => s.codigo === c)?.rotulo ?? c;
const rotuloEficacia = (c: string) => EFICACIAS_ACAO.find((s) => s.codigo === c)?.rotulo ?? c;
const opEficacia = EFICACIAS_ACAO.map((e) => ({ valor: e.codigo as EficaciaAcao | '', rotulo: e.rotulo }));
const aberta = (a: AcaoPlanoLida) => a.situacao === 'planejada' || a.situacao === 'emAndamento';

async function gravar(): Promise<void> {
  const m = modo.value;
  if (!m) return;
  falta.value = null;
  erro.value = null;
  let entrada: Parameters<typeof registrarPlanoAcao>[0];
  if (m.tipo === 'incluir' || m.tipo === 'alterar') {
    const a = montarAcao(form);
    if (!a.ok) {
      falta.value = a.mensagem;
      return;
    }
    entrada =
      m.tipo === 'incluir'
        ? { tipo: 'incluir', notificacao: props.notificacao, acao: a.entrada }
        : {
            tipo: 'alterar',
            notificacao: props.notificacao,
            id: m.acao.id,
            versao: m.acao.versao,
            acao: a.entrada,
          };
  } else if (m.tipo === 'situacao') {
    if (m.situacao !== 'emAndamento' && texto.value.trim().length < 3) {
      falta.value = t('qualidade.plano.falta.texto');
      return;
    }
    entrada = {
      tipo: 'situacao',
      notificacao: props.notificacao,
      id: m.acao.id,
      versao: m.acao.versao,
      situacao: m.situacao,
      texto: texto.value.trim() || null,
    };
  } else {
    if (!eficacia.value || texto.value.trim().length < 10) {
      falta.value = t('qualidade.plano.falta.eficacia');
      return;
    }
    entrada = {
      tipo: 'eficacia',
      notificacao: props.notificacao,
      id: m.acao.id,
      versao: m.acao.versao,
      eficacia: eficacia.value,
      texto: texto.value.trim(),
    };
  }
  gravando.value = true;
  try {
    const r = await registrarPlanoAcao(entrada, chave);
    feito.value = r.mensagem;
    modo.value = null;
    emit('gravado');
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="plano" aria-labelledby="plano-titulo" data-testid="plano-acao">
    <h2 id="plano-titulo">{{ t('qualidade.plano.titulo') }}</h2>
    <p data-testid="plano-resumo">{{ t('qualidade.plano.resumo', { ...plano }) }}</p>
    <p v-if="feito" role="status" data-testid="plano-feito">{{ feito }}</p>
    <p v-if="acoes.length === 0" data-testid="plano-nenhuma">{{ t('qualidade.plano.nenhuma') }}</p>
    <ol v-else class="plano__lista">
      <li v-for="a in acoes" :key="a.id" class="plano__acao" :data-testid="`acao-${a.sequencia}`">
        <h3>
          {{ t('qualidade.plano.acao', { n: a.sequencia }) }}: {{ a.oQue }}
          <span class="selo">{{ rotuloSituacao(a.situacao) }}</span>
          <span v-if="a.atrasada" class="selo selo--grave" :data-testid="`acao-atrasada-${a.sequencia}`">{{
            t('qualidade.plano.atrasada')
          }}</span>
        </h3>
        <dl class="plano__5w2h">
          <dt>{{ t('qualidade.plano.porQue') }}</dt>
          <dd>{{ a.porQue }}</dd>
          <dt>{{ t('qualidade.plano.onde') }}</dt>
          <dd>{{ a.onde }}</dd>
          <dt>{{ t('qualidade.plano.quando') }}</dt>
          <dd>{{ dataCurta(a.quando) }}</dd>
          <dt>{{ t('qualidade.plano.quem') }}</dt>
          <dd>{{ a.quem }}</dd>
          <dt>{{ t('qualidade.plano.como') }}</dt>
          <dd>{{ a.como }}</dd>
          <dt>{{ t('qualidade.plano.quanto') }}</dt>
          <dd>{{ a.quanto ?? '-' }}</dd>
        </dl>
        <p v-if="a.texto" class="secundario">
          {{ t('qualidade.plano.textoRegistrado', { texto: a.texto }) }}
        </p>
        <p v-if="a.eficacia" class="secundario" :data-testid="`acao-eficacia-${a.sequencia}`">
          {{
            t('qualidade.plano.eficaciaRegistrada', {
              eficacia: rotuloEficacia(a.eficacia),
              em: dataHora(a.eficaciaEm),
              por: a.eficaciaPor ?? '-',
            })
          }}
          {{ a.eficaciaTexto }}
        </p>
        <div v-if="podePlanejar" class="plano__botoes">
          <SanteBotao
            v-if="aberta(a)"
            :rotulo="t('qualidade.plano.alterar')"
            variante="texto"
            :data-testid="`acao-alterar-${a.sequencia}`"
            @acionar="abrir({ tipo: 'alterar', acao: a })"
          />
          <SanteBotao
            v-if="a.situacao === 'planejada'"
            :rotulo="t('qualidade.plano.iniciar')"
            variante="secundario"
            :data-testid="`acao-iniciar-${a.sequencia}`"
            @acionar="abrir({ tipo: 'situacao', acao: a, situacao: 'emAndamento' })"
          />
          <SanteBotao
            v-if="aberta(a)"
            :rotulo="t('qualidade.plano.concluir')"
            variante="secundario"
            :data-testid="`acao-concluir-${a.sequencia}`"
            @acionar="abrir({ tipo: 'situacao', acao: a, situacao: 'concluida' })"
          />
          <SanteBotao
            v-if="aberta(a)"
            :rotulo="t('qualidade.plano.cancelar')"
            variante="texto"
            :data-testid="`acao-cancelar-${a.sequencia}`"
            @acionar="abrir({ tipo: 'situacao', acao: a, situacao: 'cancelada' })"
          />
          <SanteBotao
            v-if="a.situacao === 'concluida' && a.eficacia === null"
            :rotulo="t('qualidade.plano.verificarEficacia')"
            variante="secundario"
            :data-testid="`acao-eficacia-abrir-${a.sequencia}`"
            @acionar="abrir({ tipo: 'eficacia', acao: a })"
          />
        </div>
      </li>
    </ol>

    <SanteBotao
      v-if="podePlanejar && !modo"
      :rotulo="t('qualidade.plano.incluir')"
      variante="primario"
      data-testid="plano-incluir"
      @acionar="abrir({ tipo: 'incluir' })"
    />

    <form v-if="modo" class="plano__form" data-testid="form-plano" novalidate @submit.prevent="gravar">
      <template v-if="modo.tipo === 'incluir' || modo.tipo === 'alterar'">
        <SanteCampoTexto
          v-model="form.oQue"
          :rotulo="t('qualidade.plano.oQue')"
          :max-bytes="400"
          obrigatorio
          data-testid="plano-oque"
        />
        <SanteCampoTexto
          v-model="form.porQue"
          :rotulo="t('qualidade.plano.porQue')"
          :max-bytes="400"
          obrigatorio
          data-testid="plano-porque"
        />
        <SanteCampoTexto
          v-model="form.onde"
          :rotulo="t('qualidade.plano.onde')"
          :max-bytes="120"
          obrigatorio
          data-testid="plano-onde"
        />
        <SanteData
          v-model="form.quando"
          :rotulo="t('qualidade.plano.quando')"
          editavel
          data-testid="plano-quando"
        />
        <div class="plano__linha">
          <SanteCampoTexto
            v-model="busca"
            :rotulo="t('qualidade.plano.buscarResponsavel')"
            :max-bytes="40"
            data-testid="plano-busca"
          />
          <SanteBotao
            :rotulo="t('qualidade.plano.buscar')"
            variante="secundario"
            data-testid="plano-buscar"
            @acionar="buscar"
          />
        </div>
        <SanteSelecao
          v-model="form.quem"
          :rotulo="t('qualidade.plano.quem')"
          :opcoes="opResponsavel"
          busca
          obrigatorio
          data-testid="plano-quem"
        />
        <p v-if="termo && pessoas.data.value?.itens.length === 0" role="status">
          {{ t('qualidade.plano.nenhumResponsavel') }}
        </p>
        <SanteCampoTexto
          v-model="form.como"
          :rotulo="t('qualidade.plano.como')"
          :max-bytes="400"
          obrigatorio
          data-testid="plano-como"
        />
        <SanteCampoTexto
          v-model="form.quanto"
          :rotulo="t('qualidade.plano.quanto')"
          :max-bytes="120"
          data-testid="plano-quanto"
        />
      </template>
      <template v-else-if="modo.tipo === 'situacao'">
        <p>
          <strong>{{ modo.acao.oQue }}</strong
          >: {{ rotuloSituacao(modo.situacao) }}
        </p>
        <SanteCampoTexto
          v-if="modo.situacao !== 'emAndamento'"
          v-model="texto"
          :rotulo="
            modo.situacao === 'concluida'
              ? t('qualidade.plano.evidencia')
              : t('qualidade.plano.motivoCancelamento')
          "
          :max-bytes="1000"
          multilinha
          obrigatorio
          data-testid="plano-texto"
        />
      </template>
      <template v-else>
        <p>
          <strong>{{ modo.acao.oQue }}</strong>
        </p>
        <SanteOpcoes
          v-model="eficacia"
          :legenda="t('qualidade.plano.eficacia')"
          :opcoes="opEficacia"
          nome="plano-eficacia"
          data-testid="plano-eficacia"
        />
        <SanteCampoTexto
          v-model="texto"
          :rotulo="t('qualidade.plano.eficaciaTexto')"
          :max-bytes="1000"
          multilinha
          obrigatorio
          data-testid="plano-texto"
        />
      </template>
      <SanteAlerta v-if="falta" variante="aviso" :texto="falta" anunciar data-testid="plano-falta" />
      <ErroQualidade v-if="erro" :erro="erro" :recusas="RECUSAS_ANALISE" />
      <div class="plano__botoes">
        <SanteBotao
          :rotulo="
            modo.tipo === 'incluir' || modo.tipo === 'alterar'
              ? t('qualidade.plano.gravarAcao')
              : t('qualidade.plano.confirmar')
          "
          variante="primario"
          tipo="submit"
          :desabilitado="gravando"
          data-testid="plano-gravar"
        />
        <SanteBotao :rotulo="t('qualidade.plano.cancelarEdicao')" variante="texto" @acionar="fechar" />
      </div>
    </form>
  </section>
</template>

<style>
@import './estilo-qualidade.css';
</style>
<style scoped>
.plano,
.plano__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.plano__lista {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  padding-inline-start: 0;
  list-style: none;
}
.plano__acao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
}
.plano__acao h3 {
  margin: 0 0 var(--sgh-espaco-2);
  font-size: 1rem;
}
.plano__5w2h {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: 0;
}
.plano__5w2h dt {
  font-weight: 600;
}
.plano__5w2h dd {
  margin: 0;
}
.plano__linha,
.plano__botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.secundario {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
  margin: var(--sgh-espaco-1) 0 0;
}
</style>
