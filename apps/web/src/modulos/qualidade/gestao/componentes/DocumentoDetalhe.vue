<script setup lang="ts">
// O documento aberto: os dados da revisão (quem elaborou, revisou e aprovou; vigência; resumo SHA-256), o conteúdo, a
// ciência do usuário da sessão e, para quem publica, as revisões, quem já deu ciência, a nova revisão e a retirada
// com o motivo (a versão lida vai junto; outra pessoa ter mudado antes vira aviso de colisão).
import { rotuloSituacaoDocumentoQualidade, rotuloTipoDocumentoQualidade } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  type DocumentoCompletoTela,
  lerCientes,
  lerDocumento,
  novaChaveGestao,
  registrarCiencia,
  retirarDocumento,
} from '../api-gestao.js';
import { acoesDoDocumento, dataBr, montarRetirada } from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{ id: number; podePublicar: boolean; ligada: boolean }>();
const emit = defineEmits<{
  revisar: [d: DocumentoCompletoTela];
  abrir: [id: number];
  aviso: [texto: string];
  fechar: [];
}>();
const { t } = useI18n();
const cliente = useQueryClient();

const doc = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'documento', props.id]),
  queryFn: () => lerDocumento(props.id),
});
const acoes = computed(() =>
  doc.data.value
    ? acoesDoDocumento(doc.data.value, props.podePublicar, props.ligada)
    : { ciencia: false, revisar: false, retirar: false },
);
const verCientes = ref(false);
const cientes = useQuery({
  queryKey: computed(() => ['gestaoQualidade', 'cientes', props.id]),
  queryFn: () => lerCientes(props.id),
  enabled: computed(() => verCientes.value && props.podePublicar),
});

const erro = ref<unknown>(null);
const gravando = ref(false);
let chaveCiencia = novaChaveGestao('ciencia');
async function darCiencia(): Promise<void> {
  erro.value = null;
  gravando.value = true;
  try {
    await registrarCiencia(props.id, chaveCiencia);
    chaveCiencia = novaChaveGestao('ciencia');
    emit('aviso', t('gestaoQualidade.documentos.detalhe.cienciaGravada'));
    await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const retirando = ref(false);
const motivo = ref('');
const erros = ref<Record<string, string>>({});
let chaveRetirar = novaChaveGestao('retirar');
async function retirar(): Promise<void> {
  const d = doc.data.value;
  if (!d) return;
  erro.value = null;
  const m = montarRetirada(d, motivo.value);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    await retirarDocumento(d.id, m.entrada, chaveRetirar);
    chaveRetirar = novaChaveGestao('retirar');
    retirando.value = false;
    emit('aviso', t('gestaoQualidade.documentos.detalhe.retirado'));
    await cliente.invalidateQueries({ queryKey: ['gestaoQualidade'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="documento-titulo" data-testid="documento-detalhe">
    <ErroGestao v-if="doc.isError.value" :erro="doc.error.value" />
    <p v-else-if="!doc.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <template v-else>
      <h2 id="documento-titulo">
        {{
          t('gestaoQualidade.documentos.detalhe.titulo', {
            codigo: doc.data.value.codigo,
            revisao: doc.data.value.revisao,
            titulo: doc.data.value.titulo,
          })
        }}
      </h2>
      <div class="linha-ccih">
        <span class="selo" data-testid="doc-situacao">{{
          rotuloSituacaoDocumentoQualidade(doc.data.value.situacao)
        }}</span>
        <span v-if="doc.data.value.revisaoVencida" class="prazo prazo--vencido">{{
          t('gestaoQualidade.documentos.revisaoVencida')
        }}</span>
        <span
          v-if="doc.data.value.exigeCiencia"
          :class="doc.data.value.cienteSessao ? 'prazo prazo--cumprido' : 'selo selo--atencao'"
          >{{
            doc.data.value.cienteSessao
              ? t('gestaoQualidade.documentos.ciente')
              : t('gestaoQualidade.documentos.pendente')
          }}</span
        >
      </div>
      <dl class="ficha-gestao">
        <dt>{{ t('gestaoQualidade.documentos.tipo') }}</dt>
        <dd>{{ rotuloTipoDocumentoQualidade(doc.data.value.tipo) }}</dd>
        <dt>{{ t('gestaoQualidade.area') }}</dt>
        <dd>{{ doc.data.value.area }}</dd>
        <dt>{{ t('gestaoQualidade.documentos.detalhe.elaborado') }}</dt>
        <dd>{{ doc.data.value.elaboradoPor }}</dd>
        <template v-if="doc.data.value.revisadoPor">
          <dt>{{ t('gestaoQualidade.documentos.detalhe.revisado') }}</dt>
          <dd>{{ doc.data.value.revisadoPor }}</dd>
        </template>
        <dt>{{ t('gestaoQualidade.documentos.detalhe.aprovado') }}</dt>
        <dd>{{ doc.data.value.aprovadoPor }}</dd>
        <dt>{{ t('gestaoQualidade.documentos.detalhe.publicadoEm') }}</dt>
        <dd>{{ dataHora(doc.data.value.publicadoEm) }}</dd>
        <dt>{{ t('gestaoQualidade.documentos.detalhe.vigencia') }}</dt>
        <dd>{{ dataBr(doc.data.value.vigenciaAte) }}</dd>
        <template v-if="doc.data.value.resumoAlteracao">
          <dt>{{ t('gestaoQualidade.documentos.detalhe.resumoAlteracao') }}</dt>
          <dd>{{ doc.data.value.resumoAlteracao }}</dd>
        </template>
        <template v-if="doc.data.value.motivoRetirada">
          <dt>{{ t('gestaoQualidade.documentos.detalhe.motivoRetirada') }}</dt>
          <dd>{{ doc.data.value.motivoRetirada }}</dd>
        </template>
        <dt>{{ t('gestaoQualidade.documentos.detalhe.ciencias') }}</dt>
        <dd data-testid="doc-ciencias">{{ doc.data.value.ciencias }}</dd>
        <dt>{{ t('gestaoQualidade.documentos.detalhe.hash') }}</dt>
        <dd class="hash-gestao">{{ doc.data.value.hash }}</dd>
      </dl>
      <h3>{{ t('gestaoQualidade.documentos.detalhe.conteudo') }}</h3>
      <div class="conteudo-documento" data-testid="doc-conteudo-lido">{{ doc.data.value.conteudo }}</div>

      <ErroGestao v-if="erro" :erro="erro" />
      <div class="linha-ccih">
        <SanteBotao
          v-if="acoes.ciencia"
          :rotulo="t('gestaoQualidade.documentos.detalhe.darCiencia')"
          :desabilitado="gravando"
          data-testid="doc-dar-ciencia"
          @acionar="darCiencia"
        />
        <SanteBotao
          v-if="acoes.revisar"
          :rotulo="t('gestaoQualidade.documentos.detalhe.revisar')"
          variante="secundario"
          data-testid="doc-revisar"
          @acionar="emit('revisar', doc.data.value)"
        />
        <SanteBotao
          v-if="acoes.retirar && !retirando"
          :rotulo="t('gestaoQualidade.documentos.detalhe.retirar')"
          variante="secundario"
          data-testid="doc-retirar"
          @acionar="retirando = true"
        />
        <SanteBotao :rotulo="t('gestaoQualidade.fechar')" variante="texto" @acionar="emit('fechar')" />
      </div>

      <form v-if="retirando" class="painel-ccih" data-testid="form-retirada" @submit.prevent="retirar">
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('gestaoQualidade.documentos.detalhe.motivo')"
          :max-bytes="500"
          multilinha
          obrigatorio
          data-testid="doc-motivo"
        />
        <ErrosFormulario :erros="erros" />
        <div class="linha-ccih">
          <SanteBotao
            tipo="submit"
            :rotulo="t('gestaoQualidade.documentos.detalhe.confirmarRetirada')"
            :desabilitado="gravando"
            data-testid="doc-confirmar-retirada"
          />
          <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="retirando = false" />
        </div>
      </form>

      <template v-if="podePublicar && doc.data.value.revisoes.length > 1">
        <h3>{{ t('gestaoQualidade.documentos.detalhe.revisoes') }}</h3>
        <ul class="lista-ccih" data-testid="doc-revisoes">
          <li v-for="r in doc.data.value.revisoes" :key="r.id">
            <SanteBotao
              v-if="r.id !== doc.data.value.id"
              variante="texto"
              :rotulo="`${t('gestaoQualidade.documentos.revisao', { n: r.revisao })}: ${rotuloSituacaoDocumentoQualidade(r.situacao)} (${dataBr(r.publicadoEm)})`"
              @acionar="emit('abrir', r.id)"
            />
            <strong v-else
              >{{ t('gestaoQualidade.documentos.revisao', { n: r.revisao }) }}:
              {{ rotuloSituacaoDocumentoQualidade(r.situacao) }}</strong
            >
          </li>
        </ul>
      </template>
      <template v-if="podePublicar">
        <SanteBotao
          v-if="!verCientes"
          variante="texto"
          :rotulo="t('gestaoQualidade.documentos.detalhe.verCientes')"
          data-testid="doc-ver-cientes"
          @acionar="verCientes = true"
        />
        <template v-else>
          <h3>{{ t('gestaoQualidade.documentos.detalhe.cientes') }}</h3>
          <ErroGestao v-if="cientes.isError.value" :erro="cientes.error.value" />
          <p v-else-if="cientes.data.value && !cientes.data.value.itens.length">
            {{ t('gestaoQualidade.documentos.detalhe.nenhumCiente') }}
          </p>
          <ul v-else-if="cientes.data.value" class="lista-ccih" data-testid="doc-cientes">
            <li v-for="c in cientes.data.value.itens" :key="c.usuario">
              {{ c.usuario }}: {{ dataHora(c.cienteEm) }}
            </li>
          </ul>
        </template>
      </template>
    </template>
  </section>
</template>
