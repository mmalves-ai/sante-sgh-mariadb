<script setup lang="ts">
// Gerar a ECD ou a ECF do exercício (M54.3; `contabil.sped.gerar`): o número de ordem do livro, a substituta (com o
// hash ou o recibo da anterior), na ECF a forma de tributação (só imune e isenta são geradas; as outras dizem o motivo)
// e o tipo da entidade, e os signatários (o contador, com o registro no conselho, e o responsável pela entidade). Os
// problemas aparecem antes de enviar; o servidor confere de novo. O arquivo anterior do mesmo exercício ainda não
// transmitido fica substituído.
import {
  type ApoioSped,
  FORMAS_ECF_GERADAS,
  type FormaTributacaoEcf,
  type QualificacaoSignatario,
  type TipoArquivoSped,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroContabil from './ErroContabil.vue';
import { gerarSped, lerSignatariosSped } from './api-demonstracoes.js';
import { corpoDoSped, novoRascunhoSped, problemasDoSped, signatarioVazio } from './comum-demonstracoes.js';

const props = defineProps<{ apoio: ApoioSped; empresa: number; tipo: TipoArquivoSped; exercicio: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const r = ref(novoRascunhoSped(props.tipo, props.exercicio));
const opcoesForma = computed(() =>
  props.apoio.formasTributacao.map((f) => ({
    valor: f.codigo as FormaTributacaoEcf | null,
    rotulo: f.gerada
      ? `${f.codigo} ${f.rotulo}`
      : `${f.codigo} ${f.rotulo} (${t('contabil.sped.naoGerada')})`,
  })),
);
const opcoesQualificacao = computed(() =>
  props.apoio.qualificacoes.map((q) => ({
    valor: q.codigo as QualificacaoSignatario | null,
    rotulo: `${q.codigo} ${q.rotulo}`,
  })),
);
const formaNaoGerada = computed(
  () => r.value.formaTributacao !== null && !FORMAS_ECF_GERADAS.includes(r.value.formaTributacao),
);
const problemas = computed(() => problemasDoSped(r.value));
const tentou = ref(false);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
// Os signatários vigentes do cadastro da empresa preenchem o formulário (contador e responsável).
const doCadastro = ref(0);
onMounted(async () => {
  try {
    const c = await lerSignatariosSped(props.empresa);
    if (c.faltas.length === 0 && c.itens.length >= 2) {
      r.value.signatarios = c.itens.map((s) => ({
        ...s,
        crc: s.crc ?? '',
        email: s.email ?? '',
        telefone: s.telefone ?? '',
      }));
      doCadastro.value = c.itens.length;
    }
  } catch {
    // Sem o cadastro, o formulário segue vazio para digitar.
  }
});
function incluirSignatario() {
  if (r.value.signatarios.length < 10) r.value.signatarios.push(signatarioVazio());
}
function removerSignatario(i: number) {
  r.value.signatarios.splice(i, 1);
}
async function gerar() {
  tentou.value = true;
  if (problemas.value.length > 0 || formaNaoGerada.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const x = await gerarSped(corpoDoSped(props.empresa, r.value));
    mensagem.value = x.mensagem;
    await cliente.invalidateQueries({ queryKey: ['contabil', 'sped-arquivos'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="sped-gerar-titulo" data-testid="sped-gerar">
    <h3 id="sped-gerar-titulo">{{ t('contabil.sped.gerar') }}</h3>
    <p class="secundario">{{ t('contabil.sped.gerarAjuda') }}</p>
    <div class="campos">
      <SanteCampoTexto
        v-if="tipo === 'ecd'"
        v-model="r.numeroOrdem"
        :rotulo="t('contabil.sped.numeroOrdem')"
        :max-bytes="5"
        data-testid="sped-numero-ordem"
      />
      <label class="marca">
        <input v-model="r.substituta" type="checkbox" data-testid="sped-substituta" />
        {{ t('contabil.sped.substituta') }}
      </label>
      <SanteCampoTexto
        v-if="r.substituta"
        v-model="r.hashAnterior"
        :rotulo="t('contabil.sped.hashAnterior')"
        :max-bytes="40"
        data-testid="sped-hash-anterior"
      />
    </div>
    <div v-if="tipo === 'ecf'" class="campos">
      <SanteSelecao
        v-model="r.formaTributacao"
        :rotulo="t('contabil.sped.formaTributacao')"
        :opcoes="opcoesForma"
        data-testid="sped-forma"
      />
      <SanteCampoTexto
        v-model="r.tipoEntidadeEcf"
        :rotulo="t('contabil.sped.tipoEntidade')"
        :max-bytes="2"
        data-testid="sped-tipo-entidade"
      />
    </div>
    <SanteAlerta
      v-if="formaNaoGerada"
      variante="alerta"
      :texto="t('contabil.recusas.forma-nao-gerada')"
      data-testid="sped-forma-nao-gerada"
    />
    <h4>{{ t('contabil.sped.signatarios') }}</h4>
    <SanteAlerta
      v-if="doCadastro > 0"
      variante="info"
      :texto="t('contabil.sped.doCadastro', { n: doCadastro })"
      data-testid="sped-signatarios-cadastro"
    />
    <p class="dica" data-testid="sped-guardar-signatarios">{{ t('contabil.sped.guardarSignatarios') }}</p>
    <fieldset
      v-for="(s, i) in r.signatarios"
      :key="i"
      class="bloco"
      :data-testid="`sped-signatario-${i + 1}`"
    >
      <legend>{{ t('contabil.sped.signatarioN', { n: i + 1 }) }}</legend>
      <div class="campos">
        <SanteCampoTexto
          v-model="s.nome"
          :rotulo="t('contabil.sped.nome')"
          :max-bytes="100"
          :data-testid="`sped-sig-nome-${i + 1}`"
        />
        <SanteCampoTexto
          v-model="s.cpf"
          :rotulo="t('contabil.sped.cpf')"
          :max-bytes="14"
          :data-testid="`sped-sig-cpf-${i + 1}`"
        />
        <SanteSelecao
          v-model="s.qualificacao"
          :rotulo="t('contabil.sped.qualificacao')"
          :opcoes="opcoesQualificacao"
          busca
          :data-testid="`sped-sig-qualificacao-${i + 1}`"
        />
        <SanteCampoTexto
          v-if="s.qualificacao === '900'"
          v-model="s.crc"
          :rotulo="t('contabil.sped.crc')"
          :max-bytes="20"
          :data-testid="`sped-sig-crc-${i + 1}`"
        />
        <SanteCampoTexto
          v-model="s.email"
          :rotulo="t('contabil.sped.email')"
          :max-bytes="60"
          :data-testid="`sped-sig-email-${i + 1}`"
        />
        <SanteCampoTexto
          v-model="s.telefone"
          :rotulo="t('contabil.sped.telefone')"
          :max-bytes="15"
          :data-testid="`sped-sig-telefone-${i + 1}`"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          v-if="r.signatarios.length > 2"
          variante="secundario"
          :rotulo="t('contabil.sped.removerSignatario')"
          :data-testid="`sped-sig-remover-${i + 1}`"
          @acionar="removerSignatario(i)"
        />
      </div>
    </fieldset>
    <div class="acoes">
      <SanteBotao
        v-if="r.signatarios.length < 10"
        variante="secundario"
        :rotulo="t('contabil.sped.incluirSignatario')"
        data-testid="sped-sig-incluir"
        @acionar="incluirSignatario"
      />
    </div>
    <ul v-if="tentou && problemas.length > 0" class="erro" role="alert" data-testid="sped-problemas">
      <li v-for="(x, i) in problemas" :key="i">
        {{
          x.n
            ? t('contabil.sped.doSignatario', { n: x.n, problema: t(`contabil.sped.problemas.${x.chave}`) })
            : t(`contabil.sped.problemas.${x.chave}`)
        }}
      </li>
    </ul>
    <div class="acoes">
      <SanteBotao
        :rotulo="t('contabil.sped.gerar')"
        :desabilitado="ocupado"
        data-testid="sped-gerar-confirmar"
        @acionar="gerar"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="sped-gerar-mensagem">{{ mensagem }}</p>
    <ErroContabil v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
