<script setup lang="ts">
// Os atos da autoridade competente (M55, etapa 4; Lei 14.133, arts. 71 e 165): a homologação (pessoa diferente de quem
// conduziu e de quem julgou; depois do prazo de recurso), a decisão do recurso (provido refaz o julgamento na sessão;
// não provido segue para a homologação), e a revogação (interesse público) ou anulação (ilegalidade) com a
// justificativa. Pela permissão de homologar; o motivo do bloqueio vem das ações do processo. O servidor confere tudo.
import {
  esquemaEncerrarLicitacao,
  esquemaHomologarLicitacao,
  esquemaRegistrarEventoLicitacao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type DetalheLicitacaoTela,
  encerrarLicitacaoTela,
  homologarLicitacaoTela,
  novaChaveLicitacao,
  registrarEventoLicitacaoTela,
} from '../api-licitacao.js';
import ErroSuprimentos from './ErroSuprimentos.vue';
import { etapaFinal } from './licitacao-tela.js';
import { usarEnvioLicitacao } from './usar-envio-licitacao.js';

const props = defineProps<{ d: DetalheLicitacaoTela; pode: boolean }>();
const emit = defineEmits<{ gravado: [mensagem: string] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.autoridade.${s}`, p ?? {});
const { erro, enviando, executar } = usarEnvioLicitacao((m) => emit('gravado', m));
const problemasDe = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : [...new Set((r.error?.issues ?? []).map((x) => x.message))];
const final = computed(() => etapaFinal(props.d.etapa));
const acaoHomologar = computed(() => props.d.acoes.find((a) => a.acao === 'homologar') ?? null);
const acaoRevogar = computed(() => props.d.acoes.find((a) => a.acao === 'revogar') ?? null);
const podeAnular = computed(() => props.d.etapa === 'homologado' || !final.value);

// ── Homologar ───────────────────────────────────────────────────────────────────────────────────────────────
const observacao = ref('');
let chaveHomologar = novaChaveLicitacao('homologar');
async function homologar(): Promise<void> {
  const corpo = { versao: props.d.versao, observacao: observacao.value.trim() || null };
  if (!props.pode || !acaoHomologar.value?.pode) return;
  if (!esquemaHomologarLicitacao.safeParse({ chave: 'previa.da.tela', ...corpo }).success) return;
  const ok = await executar(() => homologarLicitacaoTela(props.d.id, corpo, chaveHomologar));
  if (ok) {
    chaveHomologar = novaChaveLicitacao('homologar');
    observacao.value = '';
  }
}

// ── Decisão do recurso ──────────────────────────────────────────────────────────────────────────────────────
const r = reactive({ resultado: 'nao-provido' as string, descricao: '', data: props.d.hoje });
const resultados = [
  { valor: 'nao-provido', rotulo: k('naoProvido') },
  { valor: 'provido', rotulo: k('provido') },
];
const corpoDecisao = computed(() => ({
  versao: props.d.versao,
  tipo: 'decisao-recurso' as const,
  data: r.data,
  resultado: r.resultado,
  descricao: r.descricao,
  documento: null,
}));
const problemasDecisao = computed(() =>
  problemasDe(esquemaRegistrarEventoLicitacao.safeParse({ chave: 'previa.da.tela', ...corpoDecisao.value })),
);
const tentouDecisao = ref(false);
let chaveDecisao = novaChaveLicitacao('decisao');
async function decidir(): Promise<void> {
  tentouDecisao.value = true;
  if (!props.pode || problemasDecisao.value.length) return;
  const ok = await executar(() => registrarEventoLicitacaoTela(props.d.id, corpoDecisao.value, chaveDecisao));
  if (ok) {
    chaveDecisao = novaChaveLicitacao('decisao');
    tentouDecisao.value = false;
    r.descricao = '';
  }
}

// ── Revogar ou anular ───────────────────────────────────────────────────────────────────────────────────────
const enc = reactive({ para: 'revogado' as 'revogado' | 'anulado', justificativa: '' });
const opcoesEncerrar = computed(() => [
  ...(acaoRevogar.value ? [{ valor: 'revogado' as 'revogado' | 'anulado', rotulo: k('revogar') }] : []),
  ...(podeAnular.value ? [{ valor: 'anulado' as 'revogado' | 'anulado', rotulo: k('anular') }] : []),
]);
const corpoEncerrar = computed(() => ({
  versao: props.d.versao,
  para: enc.para,
  justificativa: enc.justificativa,
}));
const problemasEncerrar = computed(() =>
  problemasDe(esquemaEncerrarLicitacao.safeParse({ chave: 'previa.da.tela', ...corpoEncerrar.value })),
);
const tentouEncerrar = ref(false);
let chaveEncerrar = novaChaveLicitacao('encerrar');
async function encerrar(): Promise<void> {
  tentouEncerrar.value = true;
  if (!props.pode || problemasEncerrar.value.length) return;
  const ok = await executar(() => encerrarLicitacaoTela(props.d.id, corpoEncerrar.value, chaveEncerrar));
  if (ok) {
    chaveEncerrar = novaChaveLicitacao('encerrar');
    tentouEncerrar.value = false;
    enc.justificativa = '';
  }
}
</script>

<template>
  <section class="autoridade-licitacao" data-testid="lic-autoridade">
    <p class="secundario">{{ k('explicacao') }}</p>
    <SanteAlerta
      v-if="!pode"
      variante="info"
      :texto="k('semPermissao')"
      data-testid="lic-aut-sem-permissao"
    />
    <ErroSuprimentos v-if="erro" :erro="erro" />

    <form
      v-if="acaoHomologar"
      class="formulario-licitacao"
      data-testid="lic-homologar-form"
      @submit.prevent="homologar"
    >
      <h3>{{ k('homologar') }}</h3>
      <SanteAlerta
        v-if="acaoHomologar.motivo"
        variante="aviso"
        :texto="acaoHomologar.motivo"
        data-testid="lic-homologar-motivo"
      />
      <span class="campo campo-largo">
        <label for="lic-hom-obs">{{ k('observacao') }}</label>
        <textarea id="lic-hom-obs" v-model="observacao" maxlength="1000" rows="2" data-testid="lic-hom-obs" />
      </span>
      <SanteBotao
        tipo="submit"
        :rotulo="k('homologarBotao')"
        :desabilitado="!pode || enviando || !acaoHomologar.pode"
        data-testid="lic-homologar"
      />
    </form>

    <form
      v-if="d.etapa === 'recurso'"
      class="formulario-licitacao"
      data-testid="lic-decisao-form"
      @submit.prevent="decidir"
    >
      <h3>{{ k('recurso') }}</h3>
      <div class="barra">
        <SanteSelecao
          v-model="r.resultado"
          :rotulo="k('resultado')"
          :opcoes="resultados"
          data-testid="lic-decisao-resultado"
        />
        <span class="campo">
          <label for="lic-decisao-data">{{ t('licitacao.atos.data') }}</label>
          <input
            id="lic-decisao-data"
            v-model="r.data"
            type="date"
            :max="d.hoje"
            data-testid="lic-decisao-data"
          />
        </span>
      </div>
      <span class="campo campo-largo">
        <label for="lic-decisao-desc">{{ k('descricao') }}</label>
        <textarea
          id="lic-decisao-desc"
          v-model="r.descricao"
          maxlength="1000"
          rows="2"
          data-testid="lic-decisao-desc"
        />
      </span>
      <SanteAlerta
        v-if="tentouDecisao && problemasDecisao.length"
        variante="aviso"
        :texto="problemasDecisao.join('; ')"
        data-testid="lic-decisao-faltam"
      />
      <SanteBotao
        tipo="submit"
        :rotulo="k('decidir')"
        :desabilitado="!pode || enviando"
        data-testid="lic-decidir"
      />
    </form>

    <form
      v-if="opcoesEncerrar.length"
      class="formulario-licitacao"
      data-testid="lic-encerrar-form"
      @submit.prevent
    >
      <h3>{{ k('encerrar') }}</h3>
      <SanteAlerta
        v-if="acaoRevogar?.motivo"
        variante="aviso"
        :texto="acaoRevogar.motivo"
        data-testid="lic-encerrar-motivo"
      />
      <SanteSelecao
        v-model="enc.para"
        :rotulo="k('encerrar')"
        :opcoes="opcoesEncerrar"
        data-testid="lic-encerrar-para"
      />
      <span class="campo campo-largo">
        <label for="lic-encerrar-just">{{ k('justificativa') }}</label>
        <textarea
          id="lic-encerrar-just"
          v-model="enc.justificativa"
          maxlength="1000"
          rows="2"
          data-testid="lic-encerrar-just"
        />
      </span>
      <SanteAlerta
        v-if="tentouEncerrar && problemasEncerrar.length"
        variante="aviso"
        :texto="problemasEncerrar.join('; ')"
        data-testid="lic-encerrar-faltam"
      />
      <SanteBotao
        variante="destrutivo"
        :confirmacao="k('confirmarEncerrar')"
        :rotulo="k('encerrarBotao')"
        :desabilitado="!pode || enviando"
        data-testid="lic-encerrar"
        @acionar="encerrar"
      />
    </form>
    <p v-else-if="final" class="secundario">{{ k('final') }}</p>
  </section>
</template>
