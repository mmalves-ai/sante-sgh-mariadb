<script setup lang="ts">
// W1-04 (mercado): os termos de consentimento do paciente no balcão. Mostra os exigidos no tipo de atendimento ainda
// sem assinatura válida (bloqueio SUAVE quando o parâmetro recepcao.termos.exigir está ligado: quem atende confirma
// e segue; nada é impedido), colhe a assinatura em tela (traço + quem assina), lista os assinados com o hash e
// revoga com motivo (fato novo; a assinatura não se edita). No modo "chegada", o botão final registra a chegada.
import { chegadaPodeSeguir, type TermosDoPaciente } from '@sgh/contratos';
import {
  type PedidoGravacao,
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteDialogoGravacao,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  assinarTermo,
  lerModelosTermo,
  lerTermosDoPaciente,
  novaChave,
  revogarTermo,
} from '../api-recepcao.js';
import AssinaturaTela from './AssinaturaTela.vue';

const props = defineProps<{
  prontuario: number;
  tipo: string | null;
  senha: number | null;
  /** Modo chegada: mostra o botão que registra a chegada (com a confirmação no bloqueio suave). */
  chegada: boolean;
}>();
const emit = defineEmits<{ seguir: []; mensagem: [texto: string] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const chave = computed(() => ['recepcao', 'termos', 'paciente', props.prontuario, props.tipo]);
const termos = useQuery({
  queryKey: chave,
  queryFn: () => lerTermosDoPaciente(props.prontuario, props.tipo),
});
const modelos = useQuery({ queryKey: ['recepcao', 'termos', 'modelos'], queryFn: () => lerModelosTermo() });
const podeAssinar = computed(() => pode('recepcao.termo.assinar'));
const erro = ref<unknown>(null);
const confirmado = ref(false);

const dados = computed<TermosDoPaciente | undefined>(() => termos.data.value);
const podeSeguir = computed(() => !!dados.value && chegadaPodeSeguir(dados.value, confirmado.value));

// ── Assinar ──
const assinando = ref<{ modelo: number; titulo: string; versao: number } | null>(null);
const signatario = ref('');
const nomeSignatario = ref('');
const imagem = ref<string | null>(null);
const gravando = ref(false);
const textoDoModelo = computed(() => {
  const id = assinando.value?.modelo;
  for (const m of modelos.data.value ?? []) {
    const v = m.versoes.find((x) => x.id === id);
    if (v) return v.texto;
  }
  return '';
});
const opcoesSignatario = computed(() =>
  (dados.value?.signatarios ?? []).map((s) => ({ valor: String(s.codigo), rotulo: s.rotulo })),
);
watch(assinando, (a) => {
  if (!a) return;
  signatario.value = opcoesSignatario.value[0]?.valor ?? '';
  nomeSignatario.value = '';
  imagem.value = null;
});
const assinaturaValida = computed(
  () => !!assinando.value && !!signatario.value && nomeSignatario.value.trim().length >= 3 && !!imagem.value,
);
async function gravarAssinatura(): Promise<void> {
  const a = assinando.value;
  if (!a || !assinaturaValida.value) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await assinarTermo(
      {
        modelo: a.modelo,
        prontuario: props.prontuario,
        senha: props.senha,
        tipoAtendimento: props.tipo,
        meio: 'tela',
        signatario: Number(signatario.value),
        nomeSignatario: nomeSignatario.value,
        imagem: imagem.value,
      },
      novaChave('termo'),
    );
    assinando.value = null;
    emit('mensagem', r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
    await cliente.invalidateQueries({ queryKey: ['recepcao', 'termos'] });
  }
}

// ── Revogar (fato novo com motivo) ──
const dialogo = ref(false);
const pedido = ref<PedidoGravacao | null>(null);
function revogar(id: number, titulo: string): void {
  pedido.value = {
    titulo: t('recepcao.termos.revogarTitulo', { titulo }),
    texto: t('recepcao.termos.revogarTexto'),
    motivo: t('recepcao.termos.motivo'),
    senha: false,
    confirmar: t('recepcao.termos.revogar'),
    gravar: async ({ motivo }) => {
      const r = await revogarTermo(id, motivo, novaChave('revogar'));
      emit('mensagem', r.mensagem);
    },
  };
  dialogo.value = true;
}
async function aposRevogar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['recepcao', 'termos'] });
}
function falhou(e: unknown): void {
  erro.value = e;
}
const dataHora = (s: string) => s.replace('T', ' ').slice(0, 16);
</script>

<template>
  <div class="termos-paciente" data-testid="termos-paciente">
    <MensagemErro v-if="termos.isError.value" :erro="termos.error.value" />
    <p v-else-if="!dados" role="status">{{ t('recepcao.carregando') }}</p>
    <template v-else>
      <template v-if="tipo">
        <SanteAlerta
          v-if="dados.bloqueioSuave"
          variante="aviso"
          :texto="t('recepcao.termos.bloqueioSuave')"
          anunciar
          data-testid="termos-bloqueio-suave"
        />
        <SanteAlerta
          v-else-if="dados.faltando.length > 0"
          variante="info"
          :texto="t('recepcao.termos.avisoSemExigir')"
          data-testid="termos-aviso"
        />
        <h3>{{ t('recepcao.termos.faltando') }}</h3>
        <p v-if="dados.faltando.length === 0" role="status" data-testid="termos-nada-faltando">
          {{ t('recepcao.termos.nadaFaltando') }}
        </p>
        <ul v-else class="termos-lista" data-testid="termos-faltando">
          <li v-for="f in dados.faltando" :key="f.modelo">
            <span>{{ f.titulo }} · {{ t('recepcao.termos.versao', { n: f.versao }) }}</span>
            <SanteBotao
              v-if="podeAssinar"
              variante="secundario"
              :rotulo="t('recepcao.termos.assinar')"
              :data-testid="`assinar-termo-${f.codigo}`"
              @acionar="assinando = { modelo: f.modelo, titulo: f.titulo, versao: f.versao }"
            />
          </li>
        </ul>
      </template>

      <section v-if="assinando" class="termos-assinar" data-testid="termos-assinar">
        <h3>
          {{ t('recepcao.termos.assinarTitulo', { titulo: assinando.titulo, versao: assinando.versao }) }}
        </h3>
        <!-- O texto da versão vigente, como será guardado (o hash do texto entra no conteúdo assinado). -->
        <pre class="termos-texto" tabindex="0" data-testid="termo-texto">{{ textoDoModelo }}</pre>
        <div class="formulario">
          <SanteSelecao
            v-model="signatario"
            :rotulo="t('recepcao.termos.signatario')"
            :opcoes="opcoesSignatario"
            data-testid="termo-signatario"
          />
          <SanteCampoTexto
            v-model="nomeSignatario"
            :rotulo="t('recepcao.termos.nomeSignatario')"
            :max-bytes="70"
            obrigatorio
            data-testid="termo-nome-signatario"
          />
        </div>
        <AssinaturaTela v-model="imagem" />
        <div class="acoes-linha">
          <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="assinando = null" />
          <SanteBotao
            :rotulo="t('recepcao.termos.gravarAssinatura')"
            :desabilitado="!assinaturaValida || gravando"
            data-testid="gravar-assinatura"
            @acionar="gravarAssinatura"
          />
        </div>
      </section>

      <MensagemErro v-if="erro" :erro="erro" />

      <h3>{{ t('recepcao.termos.assinaturas') }}</h3>
      <p v-if="dados.assinaturas.length === 0" role="status" data-testid="termos-sem-assinaturas">
        {{ t('recepcao.termos.semAssinaturas') }}
      </p>
      <ul v-else class="termos-lista" data-testid="termos-assinados">
        <li v-for="a in dados.assinaturas" :key="a.id" :data-testid="`termo-assinado-${a.id}`">
          <span>
            {{ a.titulo }} · {{ t('recepcao.termos.versao', { n: a.versao }) }} ·
            {{ t(`recepcao.termos.meios.${a.meio}`) }} ·
            {{ t('recepcao.termos.assinadoEm', { em: dataHora(a.assinadoEm), nome: a.nomeSignatario }) }}
          </span>
          <small class="termos-hash">{{ t('recepcao.termos.hash', { hash: a.hash }) }}</small>
          <span v-if="a.revogacao" class="marca-ident" :data-testid="`termo-revogado-${a.id}`">{{
            t('recepcao.termos.revogado', { em: dataHora(a.revogacao.em), motivo: a.revogacao.motivo })
          }}</span>
          <SanteBotao
            v-else-if="podeAssinar"
            variante="secundario"
            :rotulo="t('recepcao.termos.revogar')"
            :data-testid="`revogar-termo-${a.id}`"
            @acionar="revogar(a.id, a.titulo)"
          />
        </li>
      </ul>

      <div v-if="chegada" class="termos-seguir">
        <label v-if="dados.bloqueioSuave" class="termos-confirmar">
          <input v-model="confirmado" type="checkbox" data-testid="termos-confirmar-sem" />
          {{ t('recepcao.termos.confirmarSemTermo') }}
        </label>
        <SanteBotao
          :rotulo="t('recepcao.termos.registrarChegada')"
          :desabilitado="!podeSeguir"
          data-testid="termos-registrar-chegada"
          @acionar="emit('seguir')"
        />
      </div>
    </template>
    <SanteDialogoGravacao
      v-model:visivel="dialogo"
      :pedido="pedido"
      :testids="{ motivo: 'revogar-motivo', confirmar: 'revogar-confirmar' }"
      @feito="aposRevogar"
      @falha="falhou"
    />
  </div>
</template>

<style scoped>
.termos-paciente {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.termos-paciente h3 {
  margin: var(--sgh-espaco-2) 0 0;
  font-size: 1rem;
}
.termos-lista {
  display: grid;
  gap: var(--sgh-espaco-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.termos-lista li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-1) 0;
  border-top: 1px solid var(--sgh-borda);
}
.termos-hash {
  flex-basis: 100%;
  overflow-wrap: anywhere;
  color: var(--sgh-texto-secundario);
}
.termos-texto {
  max-height: 12rem;
  overflow: auto;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  white-space: pre-wrap;
  font-family: inherit;
}
.termos-assinar {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
}
.termos-seguir {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sgh-espaco-3);
}
</style>
