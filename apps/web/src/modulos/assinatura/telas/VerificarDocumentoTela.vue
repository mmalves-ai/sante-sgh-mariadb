<script setup lang="ts">
// Verificador público de documentos (M49, etapa 3; ficha, seção 7; regra 9): `/verificar/:codigo`, sem login e sem a
// casca (aplicação do portal). O QR do documento assinado aponta para cá: tipo, datas, profissional (como o selo do
// documento mostra) e o resultado da validação no servidor; nunca o conteúdo nem o paciente. Quem tem o arquivo confere
// que é o mesmo: o SHA-256 é calculado neste navegador e o arquivo não sai do computador. Sem código na rota, um campo
// para digitar o código impresso. A verificação vale para o documento assinado, não para o prontuário (regra 11).
import { SITUACOES_VERIFICACAO, type SituacaoVerificacao, type VerificacaoPublica } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { dataHoraBr } from '../../pep/formato.js';
import { sha256DoArquivo, verificarDocumento } from '../api-assinatura.js';

const props = defineProps<{ codigo?: string }>();
const { t } = useI18n();
const roteador = useRouter();

const digitado = ref(props.codigo ?? '');
const formatoValido = (c: string) => /^[A-Za-z0-9_-]{16,64}$/.test(c.trim());
const invalido = ref(false);
const carregando = ref(false);
const erro = ref<'limite' | 'indisponivel' | null>(null);
const r = ref<VerificacaoPublica | null>(null);
const arquivo = ref<'confere' | 'nao-confere' | null>(null);

async function consultar(codigo: string | undefined) {
  r.value = null;
  erro.value = null;
  arquivo.value = null;
  if (!codigo) return;
  carregando.value = true;
  try {
    r.value = await verificarDocumento(codigo);
  } catch (e) {
    erro.value = e instanceof ErroApi && e.status === 429 ? 'limite' : 'indisponivel';
  } finally {
    carregando.value = false;
  }
}
watch(
  () => props.codigo,
  (c) => {
    digitado.value = c ?? '';
    void consultar(c);
  },
  { immediate: true },
);

function verificar() {
  const c = digitado.value.trim();
  invalido.value = !formatoValido(c);
  if (invalido.value) return;
  if (c === props.codigo) void consultar(c);
  else void roteador.push({ name: 'assinatura.verificar', params: { codigo: c } });
}

const situacao = computed<SituacaoVerificacao | null>(() =>
  r.value && (SITUACOES_VERIFICACAO as readonly string[]).includes(r.value.situacao)
    ? r.value.situacao
    : null,
);
const variante = computed(() =>
  situacao.value === 'valida'
    ? 'info'
    : situacao.value === 'pendente' || situacao.value === 'indeterminada'
      ? 'aviso'
      : 'alerta',
);
const encontrado = computed(() => !!r.value && r.value.situacao !== 'nao-encontrado');
const politica = computed(() =>
  r.value?.politica ? t(`assinatura.politicas.${r.value.politica}`) : t('assinatura.verificador.semRegistro'),
);

async function escolherArquivo(ev: Event) {
  arquivo.value = null;
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f || !r.value?.hashPdf) return;
  arquivo.value = (await sha256DoArquivo(f)) === r.value.hashPdf ? 'confere' : 'nao-confere';
}
</script>

<template>
  <main class="tela-assinatura verificador" aria-labelledby="verif-titulo" data-testid="tela-verificar">
    <h1 id="verif-titulo">{{ t('assinatura.verificador.titulo') }}</h1>
    <p>{{ t('assinatura.verificador.subtitulo') }}</p>
    <form class="bloco" data-testid="verif-form" @submit.prevent="verificar">
      <SanteCampoTexto
        id="verif-codigo"
        v-model="digitado"
        :rotulo="t('assinatura.verificador.codigo')"
        :max-bytes="64"
        obrigatorio
        data-testid="verif-codigo"
      />
      <p class="secundario">{{ t('assinatura.verificador.codigoAjuda') }}</p>
      <SanteAlerta v-if="invalido" :texto="t('assinatura.verificador.codigoInvalido')" anunciar />
      <SanteBotao
        :rotulo="t('assinatura.verificador.verificar')"
        tipo="submit"
        data-testid="verif-verificar"
      />
    </form>

    <p v-if="carregando" role="status">{{ t('assinatura.verificador.conferindo') }}</p>
    <SanteAlerta
      v-else-if="erro"
      :texto="
        erro === 'limite' ? t('assinatura.verificador.limite') : t('assinatura.verificador.indisponivel')
      "
      variante="aviso"
      anunciar
      data-testid="verif-erro"
    />
    <section v-else-if="r" class="bloco" aria-labelledby="verif-resultado" data-testid="verif-resultado">
      <h2 id="verif-resultado">{{ t('assinatura.verificador.resultado') }}</h2>
      <SanteAlerta
        v-if="situacao"
        :texto="t(`assinatura.verificador.situacoes.${situacao}`)"
        :variante="variante"
        :icone="situacao === 'valida' ? 'check' : 'alerta'"
        anunciar
        :data-situacao="situacao"
        data-testid="verif-situacao"
      />
      <dl v-if="encontrado" class="dados" data-testid="verif-dados">
        <dt>{{ t('assinatura.verificador.tipo') }}</dt>
        <dd data-testid="verif-tipo">{{ r.tipoDocumento ?? '—' }}</dd>
        <dt>{{ t('assinatura.verificador.emitidoEm') }}</dt>
        <dd>{{ r.emitidoEm ? dataHoraBr(r.emitidoEm) : '—' }}</dd>
        <dt>{{ t('assinatura.verificador.assinadoEm') }}</dt>
        <dd>{{ r.assinadoEm ? dataHoraBr(r.assinadoEm) : '—' }}</dd>
        <dt>{{ t('assinatura.verificador.profissional') }}</dt>
        <dd data-testid="verif-profissional">
          {{ r.profissional ?? t('assinatura.verificador.semRegistro') }}
        </dd>
        <dt>{{ t('assinatura.verificador.registro') }}</dt>
        <dd data-testid="verif-registro">{{ r.registro ?? t('assinatura.verificador.semRegistro') }}</dd>
        <dt>{{ t('assinatura.verificador.politica') }}</dt>
        <dd>{{ politica }}</dd>
        <dt>{{ t('assinatura.verificador.carimbo') }}</dt>
        <dd>{{ r.carimboEm ? dataHoraBr(r.carimboEm) : '—' }}</dd>
        <dt>{{ t('assinatura.verificador.validadaEm') }}</dt>
        <dd>{{ r.validadaEm ? dataHoraBr(r.validadaEm) : '—' }}</dd>
        <dt>{{ t('assinatura.verificador.impressao') }}</dt>
        <dd class="hash" data-testid="verif-hash">{{ r.hashPdf ?? '—' }}</dd>
      </dl>
      <p class="secundario">{{ t('assinatura.verificador.semConteudo') }}</p>
      <p class="secundario" data-testid="verif-concessao">{{ t('assinatura.verificador.concessao') }}</p>
      <p v-if="encontrado" class="secundario">{{ t('assinatura.verificador.validadorIti') }}</p>
    </section>

    <section v-if="r && encontrado" class="bloco" aria-labelledby="verif-arquivo" data-testid="verif-arquivo">
      <h2 id="verif-arquivo">{{ t('assinatura.verificador.arquivo.titulo') }}</h2>
      <template v-if="r.hashPdf">
        <p class="secundario">{{ t('assinatura.verificador.arquivo.ajuda') }}</p>
        <span class="campo">
          <label for="verif-arquivo-campo">{{ t('assinatura.verificador.arquivo.escolher') }}</label>
          <input
            id="verif-arquivo-campo"
            type="file"
            accept="application/pdf,.pdf"
            data-testid="verif-arquivo-campo"
            @change="escolherArquivo"
          />
        </span>
        <SanteAlerta
          v-if="arquivo"
          :texto="
            arquivo === 'confere'
              ? t('assinatura.verificador.arquivo.confere')
              : t('assinatura.verificador.arquivo.naoConfere')
          "
          :variante="arquivo === 'confere' ? 'info' : 'alerta'"
          :icone="arquivo === 'confere' ? 'check' : 'alerta'"
          anunciar
          :data-arquivo="arquivo"
          data-testid="verif-arquivo-resultado"
        />
      </template>
      <p v-else class="secundario">{{ t('assinatura.verificador.arquivo.semHash') }}</p>
    </section>
  </main>
</template>

<style scoped src="../estilo-assinatura.css"></style>
<style scoped>
.verificador {
  margin: 0 auto;
  padding: 1rem;
  max-width: 48rem;
}
.dados {
  display: grid;
  grid-template-columns: minmax(10rem, max-content) 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
}
.dados dt {
  font-weight: 600;
}
.dados dd {
  margin: 0;
}
.hash {
  font-family: monospace;
  overflow-wrap: anywhere;
}
</style>
