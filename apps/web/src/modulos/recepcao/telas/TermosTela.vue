<script setup lang="ts">
// W1-04 (mercado): cadastro dos modelos de termo de consentimento e LGPD por tipo de atendimento. Incluir cria a
// versão 1; alterar é SEMPRE versão nova (a anterior fica no histórico e quem assinou segue ligado à versão que
// assinou); inativar e reativar com motivo; excluir só o termo nunca assinado (retrato no histórico de exclusões). Os
// textos jurídicos dependem do dono: até a aprovação, o parâmetro recepcao.termos.exigir segue desligado.
import {
  FINALIDADES_CONSENTIMENTO,
  type ModeloTermo,
  TIPOS_ATENDIMENTO_TERMO,
  type TipoAtendimentoTermo,
} from '@sgh/contratos';
import {
  type PedidoGravacao,
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteChave,
  SanteDialogo,
  SanteDialogoGravacao,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  excluirModeloTermo,
  incluirModeloTermo,
  lerModelosTermo,
  novaChave,
  novaVersaoTermo,
  situacaoModeloTermo,
} from '../api-recepcao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const modelos = useQuery({ queryKey: ['recepcao', 'termos', 'modelos'], queryFn: () => lerModelosTermo() });
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);

// ── Formulário (incluir ou nova versão) ──
const formAberto = ref(false);
const editando = ref<ModeloTermo | null>(null);
const codigo = ref('');
const titulo = ref('');
const finalidade = ref<string>('atendimento');
const tipos = ref<TipoAtendimentoTermo[]>([]);
const exigido = ref(false);
const texto = ref('');
const gravando = ref(false);
const opcoesFinalidade = computed(() =>
  FINALIDADES_CONSENTIMENTO.map((f) => ({ valor: f, rotulo: t(`recepcao.termos.finalidades.${f}`) })),
);
function novo(): void {
  editando.value = null;
  codigo.value = '';
  titulo.value = '';
  finalidade.value = 'atendimento';
  tipos.value = [];
  exigido.value = false;
  texto.value = '';
  formAberto.value = true;
}
function versaoNova(m: ModeloTermo): void {
  const v = m.versoes[0]!;
  editando.value = m;
  codigo.value = m.codigo;
  titulo.value = v.titulo;
  finalidade.value = m.finalidade;
  tipos.value = [...v.tiposAtendimento];
  exigido.value = v.exigido;
  texto.value = v.texto;
  formAberto.value = true;
}
const formValido = computed(
  () =>
    (editando.value !== null || /^[a-z0-9][a-z0-9-]{1,29}$/.test(codigo.value.trim().toLowerCase())) &&
    titulo.value.trim().length >= 3 &&
    tipos.value.length > 0 &&
    texto.value.trim().length >= 20,
);
async function gravarForm(): Promise<void> {
  if (!formValido.value) return;
  gravando.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const m = editando.value;
    const r = m
      ? await novaVersaoTermo(
          m.codigo,
          {
            titulo: titulo.value,
            tiposAtendimento: tipos.value,
            exigido: exigido.value,
            texto: texto.value,
            versaoVista: m.versoes[0]!.versao,
          },
          novaChave('termo-versao'),
        )
      : await incluirModeloTermo(
          {
            codigo: codigo.value,
            titulo: titulo.value,
            finalidade: finalidade.value,
            tiposAtendimento: tipos.value,
            exigido: exigido.value,
            texto: texto.value,
          },
          novaChave('termo-incluir'),
        );
    mensagem.value = r.mensagem;
    formAberto.value = false;
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
    await cliente.invalidateQueries({ queryKey: ['recepcao', 'termos'] });
  }
}

// ── Inativar, reativar, excluir (motivo no diálogo único) ──
const dialogo = ref(false);
const pedido = ref<PedidoGravacao | null>(null);
function situacao(m: ModeloTermo): void {
  const ativo = !m.ativo;
  pedido.value = {
    titulo: t(ativo ? 'recepcao.termos.reativarTitulo' : 'recepcao.termos.inativarTitulo', {
      codigo: m.codigo,
    }),
    motivo: t('recepcao.termos.motivo'),
    senha: false,
    confirmar: t(ativo ? 'recepcao.termos.reativar' : 'recepcao.termos.inativar'),
    gravar: async ({ motivo }) => {
      mensagem.value = (
        await situacaoModeloTermo(m.codigo, { ativo, motivo }, novaChave('termo-situacao'))
      ).mensagem;
    },
  };
  dialogo.value = true;
}
function excluir(m: ModeloTermo): void {
  pedido.value = {
    titulo: t('recepcao.termos.excluirTitulo', { codigo: m.codigo }),
    texto: t('recepcao.termos.excluirTexto'),
    motivo: t('recepcao.termos.motivo'),
    senha: false,
    confirmar: t('recepcao.termos.excluir'),
    gravar: async ({ motivo }) => {
      mensagem.value = (await excluirModeloTermo(m.codigo, motivo, novaChave('termo-excluir'))).mensagem;
    },
  };
  dialogo.value = true;
}
async function feito(): Promise<void> {
  erro.value = null;
  await cliente.invalidateQueries({ queryKey: ['recepcao', 'termos'] });
}
function falha(e: unknown): void {
  mensagem.value = null;
  erro.value = e;
}
const dataHora = (s: string) => s.replace('T', ' ').slice(0, 16);
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="termos-titulo" data-testid="tela-termos">
    <header class="cabecalho-termos">
      <h1 id="termos-titulo">{{ t('recepcao.termos.titulo') }}</h1>
      <SanteBotao :rotulo="t('recepcao.termos.novo')" data-testid="termo-novo" @acionar="novo" />
    </header>
    <SanteAlerta variante="info" :texto="t('recepcao.termos.parametroDesligado')" />
    <p v-if="mensagem" role="status" data-testid="mensagem-termos">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="modelos.isError.value" :erro="modelos.error.value" />
    <p v-else-if="!modelos.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <p v-else-if="modelos.data.value.length === 0" role="status" data-testid="termos-vazio">
      {{ t('recepcao.termos.vazio') }}
    </p>
    <ul v-else class="cartoes-termo">
      <li v-for="m in modelos.data.value" :key="m.codigo" class="painel" :data-testid="`termo-${m.codigo}`">
        <h2>
          {{ m.versoes[0]?.titulo }}
          <small>
            {{ m.codigo }} · {{ t('recepcao.termos.versao', { n: m.versoes[0]?.versao ?? 0 }) }} ·
            {{ t(m.ativo ? 'recepcao.termos.ativo' : 'recepcao.termos.inativo') }}
          </small>
        </h2>
        <p>
          {{ t(`recepcao.termos.finalidades.${m.finalidade}`) }} ·
          {{ (m.versoes[0]?.tiposAtendimento ?? []).map((x) => t(`recepcao.termos.tipos.${x}`)).join(', ') }}
          ·
          {{ t(m.versoes[0]?.exigido ? 'recepcao.termos.exigidoSim' : 'recepcao.termos.exigidoNao') }}
        </p>
        <p v-if="m.assinaturas > 0" :data-testid="`termo-assinaturas-${m.codigo}`">
          {{ t('recepcao.termos.comAssinaturas', { n: m.assinaturas }) }}
        </p>
        <details>
          <summary>{{ t('recepcao.termos.versoes') }} ({{ m.versoes.length }})</summary>
          <ol class="versoes" :data-testid="`termo-versoes-${m.codigo}`">
            <li v-for="v in m.versoes" :key="v.id">
              <strong>{{ t('recepcao.termos.versao', { n: v.versao }) }}</strong> · {{ v.titulo }} ·
              {{ v.criadoPor }} · {{ dataHora(v.criadoEm) }}
              <pre class="termos-texto">{{ v.texto }}</pre>
            </li>
          </ol>
        </details>
        <div class="acoes-linha">
          <SanteBotao
            v-if="m.ativo"
            variante="secundario"
            :rotulo="t('recepcao.termos.novaVersao')"
            :data-testid="`termo-versao-${m.codigo}`"
            @acionar="versaoNova(m)"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t(m.ativo ? 'recepcao.termos.inativar' : 'recepcao.termos.reativar')"
            :data-testid="`termo-situacao-${m.codigo}`"
            @acionar="situacao(m)"
          />
          <SanteBotao
            v-if="m.assinaturas === 0"
            variante="secundario"
            :rotulo="t('recepcao.termos.excluir')"
            :data-testid="`termo-excluir-${m.codigo}`"
            @acionar="excluir(m)"
          />
        </div>
      </li>
    </ul>

    <SanteDialogo
      v-model:visivel="formAberto"
      :titulo="
        editando
          ? t('recepcao.termos.novaVersaoTitulo', { codigo: editando.codigo })
          : t('recepcao.termos.novo')
      "
      largura="44rem"
    >
      <p v-if="editando">{{ t('recepcao.termos.novaVersaoTexto') }}</p>
      <form class="formulario" data-testid="form-termo" @submit.prevent="gravarForm">
        <SanteCampoTexto
          v-if="!editando"
          v-model="codigo"
          :rotulo="t('recepcao.termos.codigo')"
          :max-bytes="30"
          obrigatorio
          data-testid="termo-codigo"
        />
        <SanteCampoTexto
          v-model="titulo"
          :rotulo="t('recepcao.termos.tituloCampo')"
          :max-bytes="120"
          obrigatorio
          data-testid="termo-titulo"
        />
        <SanteSelecao
          v-if="!editando"
          v-model="finalidade"
          :rotulo="t('recepcao.termos.finalidade')"
          :opcoes="opcoesFinalidade"
          data-testid="termo-finalidade"
        />
        <fieldset class="tipos-termo">
          <legend>{{ t('recepcao.termos.tiposAtendimento') }}</legend>
          <label v-for="x in TIPOS_ATENDIMENTO_TERMO" :key="x">
            <input v-model="tipos" type="checkbox" :value="x" :data-testid="`termo-tipo-${x}`" />
            {{ t(`recepcao.termos.tipos.${x}`) }}
          </label>
        </fieldset>
        <SanteChave
          :ligada="exigido"
          :rotulo="t('recepcao.termos.exigido')"
          data-testid="termo-exigido"
          @alternar="(v: boolean) => (exigido = v)"
        />
        <SanteCampoTexto
          v-model="texto"
          :rotulo="t('recepcao.termos.texto')"
          :max-bytes="20000"
          multilinha
          obrigatorio
          data-testid="termo-texto-campo"
        />
      </form>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="formAberto = false" />
        <SanteBotao
          :rotulo="t('recepcao.gravar')"
          :desabilitado="!formValido || gravando"
          data-testid="termo-gravar"
          @acionar="gravarForm"
        />
      </template>
    </SanteDialogo>

    <SanteDialogoGravacao
      v-model:visivel="dialogo"
      :pedido="pedido"
      :testids="{ motivo: 'termo-motivo', confirmar: 'termo-confirmar' }"
      @feito="feito"
      @falha="falha"
    />
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
<style scoped>
.cabecalho-termos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sgh-espaco-2);
}
.cartoes-termo {
  display: grid;
  gap: var(--sgh-espaco-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.painel h2 small {
  display: block;
  font-size: 0.85rem;
  font-weight: normal;
  color: var(--sgh-texto-secundario);
}
.versoes {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.termos-texto {
  max-height: 10rem;
  overflow: auto;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  white-space: pre-wrap;
  font-family: inherit;
}
.tipos-termo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
}
</style>
