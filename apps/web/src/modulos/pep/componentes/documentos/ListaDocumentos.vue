<script setup lang="ts">
// Receitas ou atestados do paciente: abrir (leitura auditada e impressão) e suspender com justificativa (o
// documento continua visível, marcado). A suspensão é crítica: pede a senha numa sessão real.
import type { DocumentoResumo, DocumentosPaciente } from '@sgh/contratos';
import { SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { suspenderDocumento } from '../../api-documentos.js';
import { dataHoraBr } from '../../formato.js';
import AvisoConsulta from './AvisoConsulta.vue';
import DocumentoDialogo from './DocumentoDialogo.vue';

const props = defineProps<{ paciente: number; familia: 'receita' | 'atestado'; dados: DocumentosPaciente }>();
const emit = defineEmits<{ atualizar: [] }>();
const { t } = useI18n();
const aberto = ref<number | null>(null);
const visivel = computed({
  get: () => aberto.value !== null,
  set: (v) => (aberto.value = v ? aberto.value : null),
});
const suspendendo = ref<DocumentoResumo | null>(null);
const dialogoSuspensao = computed({
  get: () => suspendendo.value !== null,
  set: (v) => (suspendendo.value = v ? suspendendo.value : null),
});
const justificativa = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function suspender(): Promise<void> {
  if (!suspendendo.value) return;
  erro.value = null;
  try {
    await suspenderDocumento(
      props.paciente,
      props.familia === 'receita' ? 'receitas' : 'atestados',
      suspendendo.value.id,
      justificativa.value.trim(),
      senha.value || undefined,
    );
    mensagem.value = t('pep.doc.suspender.feito');
    suspendendo.value = null;
    justificativa.value = '';
    emit('atualizar');
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <div>
    <p v-if="dados.documentos.length === 0">{{ t('pep.doc.nenhum') }}</p>
    <table v-else class="tabela" :data-testid="`tabela-${familia}`">
      <tbody>
        <tr v-for="d in dados.documentos" :key="d.id" :data-testid="`${familia}-${d.id}`">
          <td>{{ d.titulo }}</td>
          <td>{{ dataHoraBr(d.emitidoEm) }}</td>
          <td>{{ d.profissional ?? '-' }}</td>
          <td>
            <span class="marcador">{{
              t(
                `pep.doc.documento.situacao.${d.situacao === 'emitido' && d.assinado ? 'assinado' : d.situacao}`,
              )
            }}</span>
          </td>
          <td class="acoes">
            <SanteBotao variante="texto" :rotulo="t('pep.doc.abrir')" @acionar="aberto = d.id" />
            <SanteBotao
              v-if="d.situacao === 'emitido' && dados.suspender.pode"
              variante="secundario"
              :rotulo="t('pep.doc.suspender.acao')"
              :data-testid="`suspender-${d.id}`"
              @acionar="suspendendo = d"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <AvisoConsulta :acao="dados.suspender" />
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <DocumentoDialogo
      v-if="aberto !== null"
      v-model:visivel="visivel"
      :paciente="paciente"
      :tipo="familia"
      :id="aberto"
    />
    <SanteDialogo
      v-model:visivel="dialogoSuspensao"
      :titulo="t('pep.doc.suspender.titulo', { titulo: suspendendo?.titulo ?? '' })"
    >
      <form class="form" @submit.prevent="suspender">
        <p>{{ t('pep.doc.suspender.texto') }}</p>
        <label>
          <span>{{ t('pep.doc.justificativa') }}</span>
          <input
            v-model="justificativa"
            maxlength="70"
            minlength="10"
            required
            data-testid="justificativa-suspensao"
          />
        </label>
        <label>
          <span>{{ t('pep.doc.senha') }}</span>
          <input v-model="senha" type="password" autocomplete="current-password" />
        </label>
        <MensagemErro v-if="erro" :erro="erro" />
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.confirmar')" data-testid="confirmar-suspensao" />
      </form>
    </SanteDialogo>
  </div>
</template>

<style scoped src="../../telas/abas/abas.css"></style>
