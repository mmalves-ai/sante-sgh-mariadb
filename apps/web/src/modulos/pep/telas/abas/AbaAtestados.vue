<script setup lang="ts">
// Atestados, declarações e requerimentos (regra 5): no modelo de impressão em uso; o atestado informa os dias; o
// CID só sai com a autorização expressa registrada; a correção suspende o original e liga o novo a ele.
import { TIPOS_ATESTADO, type TipoAtestado } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { emitirAtestado, lerAtestados } from '../../api-documentos.js';
import AvisoConsulta from '../../componentes/documentos/AvisoConsulta.vue';
import ListaDocumentos from '../../componentes/documentos/ListaDocumentos.vue';
import SeletorAtendimento from '../../componentes/documentos/SeletorAtendimento.vue';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'atestados', props.paciente]),
  queryFn: () => lerAtestados(props.paciente),
});
const atendimento = ref<number | null>(null);
const tipo = ref<TipoAtestado>('atestado');
const modelo = ref<number | null>(null);
const texto = ref('');
const dias = ref<number | null>(1);
const cid = ref('');
const autorizacao = ref<'paciente' | 'responsavel' | ''>('');
const corrige = ref<number | null>(null);
const modelos = computed(() => (dados.data.value?.modelos ?? []).filter((m) => m.tipo === tipo.value));
watch(modelos, (ms) => {
  if (!ms.some((m) => m.codigo === modelo.value))
    modelo.value = ms[0]?.codigo ?? dados.data.value?.modelos[0]?.codigo ?? null;
});
const suspensos = computed(() =>
  (dados.data.value?.documentos ?? []).filter((d) => d.situacao === 'suspenso'),
);
const opcoesTipo = computed(() =>
  TIPOS_ATESTADO.map((x) => ({ valor: x, rotulo: t(`pep.doc.atestados.tipos.${x}`) })),
);
const opcoesModelo = computed(() =>
  (modelos.value.length ? modelos.value : (dados.data.value?.modelos ?? [])).map((m) => ({
    valor: m.codigo,
    rotulo: m.nome,
  })),
);
const opcoesAutorizacao = computed<{ valor: 'paciente' | 'responsavel' | ''; rotulo: string }[]>(() => [
  { valor: '', rotulo: '-' },
  { valor: 'paciente', rotulo: t('pep.doc.atestados.autorizacoes.paciente') },
  { valor: 'responsavel', rotulo: t('pep.doc.atestados.autorizacoes.responsavel') },
]);
const opcoesCorrige = computed<{ valor: number | null; rotulo: string }[]>(() => [
  { valor: null, rotulo: '-' },
  ...suspensos.value.map((d) => ({ valor: d.id, rotulo: `${d.titulo} (${d.id})` })),
]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function emitir(): Promise<void> {
  erro.value = null;
  if (atendimento.value === null || modelo.value === null) return;
  // O atestado exige os dias de afastamento (0 a 365); declaração e requerimento não levam.
  const diasValidos = typeof dias.value === 'number' && Number.isInteger(dias.value) && dias.value >= 0 && dias.value <= 365;
  if (tipo.value === 'atestado' && !diasValidos) return;
  try {
    await emitirAtestado(props.paciente, {
      atendimento: atendimento.value,
      tipo: tipo.value,
      modelo: modelo.value,
      texto: texto.value.trim(),
      ...(tipo.value === 'atestado' && diasValidos ? { diasAfastamento: dias.value as number } : {}),
      ...(cid.value.trim() ? { cid: cid.value.trim().toUpperCase() } : {}),
      ...(autorizacao.value ? { autorizacaoCid: autorizacao.value } : {}),
      ...(corrige.value !== null ? { corrige: corrige.value } : {}),
    });
    mensagem.value = t('pep.doc.atestados.emitido');
    texto.value = '';
    cid.value = '';
    autorizacao.value = '';
    corrige.value = null;
    await cliente.invalidateQueries({ queryKey: ['pep', 'doc'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="aba" aria-labelledby="atestados-titulo" data-testid="aba-atestados-conteudo">
    <h2 id="atestados-titulo">{{ t('pep.doc.atestados.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <ListaDocumentos
        :paciente="paciente"
        familia="atestado"
        :dados="dados.data.value"
        @atualizar="cliente.invalidateQueries({ queryKey: ['pep', 'doc'] })"
      />
      <AvisoConsulta :acao="dados.data.value.emitir" />
      <form
        v-if="dados.data.value.emitir.pode"
        class="form"
        data-testid="form-atestado"
        @submit.prevent="emitir"
      >
        <h3>{{ t('pep.doc.atestados.novo') }}</h3>
        <SeletorAtendimento v-model="atendimento" :atendimentos="dados.data.value.atendimentos" />
        <div class="linha">
          <SanteSelecao
            v-model="tipo"
            class="campo"
            data-testid="atestado-tipo"
            :rotulo="t('pep.doc.atestados.tipo')"
            :opcoes="opcoesTipo"
          />
          <SanteSelecao
            v-model="modelo"
            class="campo"
            data-testid="atestado-modelo"
            :rotulo="t('pep.doc.atestados.modelo')"
            :opcoes="opcoesModelo"
          />
          <label v-if="tipo === 'atestado'">
            <span>{{ t('pep.doc.atestados.dias') }}</span>
            <input
              v-model.number="dias"
              type="number"
              min="0"
              max="365"
              required
              data-testid="atestado-dias"
            />
          </label>
        </div>
        <label
          ><span>{{ t('pep.doc.atestados.texto') }}</span
          ><textarea v-model="texto" rows="4" maxlength="4000" required data-testid="atestado-texto" />
        </label>
        <div v-if="tipo === 'atestado'" class="linha">
          <label
            ><span>{{ t('pep.doc.atestados.cid') }}</span
            ><input v-model="cid" maxlength="6" data-testid="atestado-cid"
          /></label>
          <SanteSelecao
            v-model="autorizacao"
            class="campo"
            data-testid="atestado-autorizacao"
            :rotulo="t('pep.doc.atestados.autorizacao')"
            :opcoes="opcoesAutorizacao"
          />
        </div>
        <SanteSelecao
          v-if="suspensos.length"
          v-model="corrige"
          class="campo"
          :rotulo="t('pep.doc.atestados.corrige')"
          :opcoes="opcoesCorrige"
        />
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.atestados.emitir')" data-testid="emitir-atestado" />
      </form>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style scoped src="./abas.css"></style>
