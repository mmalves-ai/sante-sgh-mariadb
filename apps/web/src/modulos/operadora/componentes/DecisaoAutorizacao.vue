<script setup lang="ts">
// Decisão do auditor designado sobre o pedido de autorização (M56, etapa 5, F4), e a conclusão da junta com o parecer do
// desempatador: autorizar (a quantidade de cada item e as diárias da internação, até o pedido) ou negar; menos que o
// pedido e a negativa pedem a crítica do domínio da operadora, a cláusula do contrato ou o dispositivo legal e o médico
// auditor (o servidor confere; a recusa volta com o texto). A crítica automática que impede autorizar aparece antes.
import { type ApoioAutorizacoes, type AutorizacaoDetalhe, type ResultadoAutorizacao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { concluirJunta, decidirAutorizacao } from '../api-autorizacao.js';

const props = defineProps<{ apoio: ApoioAutorizacoes; pedido: AutorizacaoDetalhe; junta: boolean }>();
const emit = defineEmits<{ gravado: [r: ResultadoAutorizacao]; cancelar: [] }>();
const { t } = useI18n();

const bloqueado = computed(() => props.pedido.criticas.some((c) => c.bloqueia));
const f = reactive({
  decisao: (bloqueado.value ? 'negar' : 'autorizar') as string | null,
  diarias: props.pedido.internacao ? String(props.pedido.internacao.diarias) : '',
  critica: (props.pedido.criticas.find((c) => c.critica !== null)?.critica ?? null) as number | null,
  fundamento: '',
  parecer: '',
  parecerJunta: '',
});
/** Uma linha por item, com a quantidade a autorizar (começa na pedida). */
const linhas = reactive(
  props.pedido.itens.map((i) => ({
    id: i.id,
    ordem: i.ordem,
    codigo: i.codigo,
    pedida: i.quantidadeSolicitada,
    quantidade: String(i.quantidadeSolicitada),
  })),
);
const opcoesDecisao = computed(() => [
  { valor: 'autorizar', rotulo: t('operadoraAutorizacao.decisao.autorizar') },
  { valor: 'negar', rotulo: t('operadoraAutorizacao.decisao.negar') },
]);
const opcoesCritica = computed(() => [
  { valor: null, rotulo: t('operadoraAutorizacao.form.escolha') },
  ...props.apoio.dominios.critica.map((c) => ({ valor: c.codigo, rotulo: c.rotulo })),
]);
const autorizar = computed(() => f.decisao === 'autorizar');
const completo = computed(
  () =>
    f.decisao !== null &&
    f.parecer.trim().length >= 10 &&
    (!props.junta || f.parecerJunta.trim().length >= 10) &&
    (!autorizar.value ||
      (linhas.every((l) => /^\d{1,3}$/.test(l.quantidade)) &&
        (!props.pedido.internacao || /^\d{1,3}$/.test(f.diarias)))),
);

const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

async function gravar(): Promise<void> {
  if (!completo.value || gravando.value) return;
  recusa.value = null;
  erro.value = null;
  gravando.value = true;
  const corpo = {
    versao: props.pedido.versao,
    decisao: f.decisao,
    itens: autorizar.value
      ? linhas.map((l) => ({ item: l.id, quantidadeAutorizada: Number(l.quantidade) }))
      : [],
    diariasAutorizadas: autorizar.value && props.pedido.internacao ? Number(f.diarias) : null,
    critica: f.critica,
    fundamento: f.fundamento.trim() || null,
    parecer: f.parecer,
    ...(props.junta ? { parecerDesempatador: f.parecerJunta } : {}),
  };
  try {
    emit(
      'gravado',
      props.junta
        ? await concluirJunta(props.pedido.id, corpo)
        : await decidirAutorizacao(props.pedido.id, corpo),
    );
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="formulario-aut" data-testid="form-decisao" @submit.prevent="gravar">
    <p class="secundario">{{ t('operadoraAutorizacao.decisao.texto') }}</p>
    <SanteAlerta
      v-for="c in pedido.criticas.filter((x) => x.bloqueia)"
      :key="c.codigo"
      :texto="c.texto"
      variante="alerta"
    />
    <SanteCampoTexto
      v-if="junta"
      id="aut-dec-parecer-junta"
      v-model="f.parecerJunta"
      :rotulo="t('operadoraAutorizacao.decisao.parecerJunta')"
      :max-bytes="1000"
      multilinha
      obrigatorio
    />
    <SanteSelecao
      v-model="f.decisao"
      :rotulo="t('operadoraAutorizacao.decisao.decisao')"
      :opcoes="opcoesDecisao"
      obrigatorio
      data-testid="aut-dec-decisao"
    />
    <div v-if="autorizar" class="campos">
      <SanteCampoTexto
        v-for="l in linhas"
        :id="`aut-dec-qtd-${l.ordem}`"
        :key="l.id"
        v-model="l.quantidade"
        :rotulo="t('operadoraAutorizacao.decisao.quantidade', { codigo: l.codigo, n: l.pedida })"
        :max-bytes="3"
        obrigatorio
      />
      <SanteCampoTexto
        v-if="pedido.internacao"
        id="aut-dec-diarias"
        v-model="f.diarias"
        :rotulo="t('operadoraAutorizacao.decisao.diarias', { n: pedido.internacao.diarias })"
        :max-bytes="3"
        obrigatorio
      />
    </div>
    <div class="campos">
      <SanteSelecao
        v-model="f.critica"
        :rotulo="t('operadoraAutorizacao.decisao.critica')"
        :opcoes="opcoesCritica"
        data-testid="aut-dec-critica"
      />
      <SanteCampoTexto
        id="aut-dec-fundamento"
        v-model="f.fundamento"
        :rotulo="t('operadoraAutorizacao.decisao.fundamento')"
        :max-bytes="400"
      />
    </div>
    <SanteCampoTexto
      id="aut-dec-parecer"
      v-model="f.parecer"
      :rotulo="t('operadoraAutorizacao.decisao.parecer')"
      :max-bytes="2000"
      multilinha
      obrigatorio
    />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="aut-dec-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t('operadoraAutorizacao.acoes.voltar')"
        @acionar="emit('cancelar')"
      />
      <SanteBotao
        tipo="submit"
        :rotulo="
          junta ? t('operadoraAutorizacao.acoes.concluirJunta') : t('operadoraAutorizacao.acoes.decidir')
        "
        :desabilitado="!completo || gravando"
        data-testid="aut-dec-gravar"
      />
    </div>
  </form>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.formulario-aut {
  display: grid;
  gap: 0.75rem;
}
</style>
