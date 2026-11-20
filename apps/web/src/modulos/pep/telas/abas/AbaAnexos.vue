<script setup lang="ts">
// Anexos e documentos digitalizados: lista com abrir (PDF) e anexar um PDF ao atendimento (até 8 MB).
import { TETO_ANEXO_BYTES } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { anexarDocumento, lerAnexos, urlArquivoAnexo } from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import SeletorAtendimento from '../../componentes/documentos/SeletorAtendimento.vue';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'anexos', props.paciente]),
  queryFn: () => lerAnexos(props.paciente),
});
const atendimento = ref<number | null>(null);
const nome = ref('');
const tipo = ref<number | null>(null);
const referencia = ref('');
const arquivo = ref<File | null>(null);
const opcoesTipo = computed<{ valor: number | null; rotulo: string }[]>(() => [
  { valor: null, rotulo: '-' },
  ...(dados.data.value?.tipos ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);
const grande = computed(() => (arquivo.value?.size ?? 0) > TETO_ANEXO_BYTES);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
function escolher(ev: Event): void {
  arquivo.value = (ev.target as HTMLInputElement).files?.[0] ?? null;
}
async function base64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function anexar(): Promise<void> {
  erro.value = null;
  if (atendimento.value === null || !arquivo.value || grande.value) return;
  try {
    await anexarDocumento(props.paciente, {
      atendimento: atendimento.value,
      nome: nome.value.trim(),
      extensao: 'pdf',
      ...(tipo.value !== null ? { tipo: tipo.value } : {}),
      ...(referencia.value ? { referencia: referencia.value } : {}),
      conteudo: await base64(arquivo.value),
    });
    mensagem.value = t('pep.doc.gravado');
    nome.value = '';
    arquivo.value = null;
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="anexos-titulo" data-testid="aba-anexos-conteudo">
    <h2 id="anexos-titulo">{{ t('pep.doc.anexos.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <p v-if="dados.data.value.anexos.length === 0">{{ t('pep.doc.nenhum') }}</p>
      <ul v-else class="lista">
        <li v-for="a in dados.data.value.anexos" :key="a.id" class="cartao" :data-testid="`anexo-${a.id}`">
          <a :href="urlArquivoAnexo(paciente, a.id)" target="_blank" rel="noopener">{{
            t('pep.doc.anexos.abrir', { nome: a.nome ?? a.id })
          }}</a>
          · {{ a.tipo ?? '-' }} · {{ dataHoraBr(a.em) }} · {{ a.profissional ?? '-' }}
        </li>
      </ul>
      <AvisoConsulta :acao="dados.data.value.criar" />
      <form v-if="dados.data.value.criar.pode" class="form" @submit.prevent="anexar">
        <h3>{{ t('pep.doc.anexos.novo') }}</h3>
        <SeletorAtendimento v-model="atendimento" :atendimentos="dados.data.value.atendimentos" />
        <label
          ><span>{{ t('pep.doc.anexos.nome') }}</span
          ><input v-model="nome" maxlength="40" required
        /></label>
        <SanteSelecao v-model="tipo" class="campo" :rotulo="t('pep.doc.anexos.tipo')" :opcoes="opcoesTipo" />
        <label
          ><span>{{ t('pep.doc.anexos.referencia') }}</span
          ><input v-model="referencia" type="date"
        /></label>
        <label
          ><span>{{ t('pep.doc.anexos.arquivo') }}</span
          ><input type="file" accept="application/pdf" required @change="escolher"
        /></label>
        <SanteAlerta v-if="grande" variante="aviso" :texto="t('pep.doc.anexos.grande')" />
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.anexos.anexar')" :desabilitado="grande" />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
