<script setup lang="ts">
// Prontuário do paciente (ficha do M23, seção 7): `/pep/paciente/:paciente`, com o cabeçalho fixo (identificação,
// localização, atendimento, alergias em três estados e alertas de completude) e as partes do prontuário em abas
// (rotas filhas). O novo registro clínico abre o formulário do M22; a evolução multiprofissional, os modelos da
// categoria do profissional. "Pedir parecer" escolhe a categoria (ou a especialidade da fila), a prioridade e o prazo
// e abre o registro de pedido de parecer com o fluxo. A exportação completa pede justificativa (e a senha, em sessão
// real). M57.2: o aviso "atendimentos em outro estabelecimento da rede" logo abaixo do cabeçalho fixo.
import { CATEGORIAS_ASSISTENCIAIS, PRIORIDADES_PARECER } from '@sgh/contratos';
import { SanteBotao, SanteCabecalhoPaciente, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { definirContextoClinico, rotuloDoPaciente } from '../../../casca/notificar/contexto-clinico.js';
import PrecaucaoNoCabecalho from '../../qualidade/ccih/componentes/PrecaucaoNoCabecalho.vue';
import AvisoRedePaciente from '../../rede/componentes/AvisoRedePaciente.vue';
import NotasAlertaPaciente from '../componentes/NotasAlertaPaciente.vue';
import AtalhoAnotacoesAdministrativas from '../componentes/AtalhoAnotacoesAdministrativas.vue';
import AtalhoEquipeAssistencial from '../componentes/AtalhoEquipeAssistencial.vue';
import { abrirArquivo, exportarProntuario, lerCabecalho, lerFila } from '../api-documentos.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const id = computed(() => Number(props.paciente));
const cab = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'cabecalho', id.value]),
  queryFn: () => lerCabecalho(id.value),
});
// M48 (etapa 1): o atendimento em uso vira o contexto do "Notificar incidente" (o diálogo mostra o que esta tela mostra
// e manda só o ID do atendimento).
let soltarContexto: (() => void) | null = null;
watch(
  () => cab.data.value,
  (d) => {
    soltarContexto?.();
    soltarContexto = null;
    if (!d || d.atendimentoAtual === null) return;
    const a = d.contexto.atendimento;
    soltarContexto = definirContextoClinico({
      atendimento: d.atendimentoAtual,
      rotulo: rotuloDoPaciente({
        nomeSocial: d.contexto.identificacao.nomeSocial,
        nomeCivil: d.contexto.identificacao.nomeCivil,
        atendimento: [a.tipo, a.numero].filter(Boolean).join(' '),
      }),
    });
  },
  { immediate: true },
);
onUnmounted(() => soltarContexto?.());
const ABAS = [
  'linha-do-tempo',
  'alergias',
  'problemas',
  'exames',
  'resultados',
  'receitas',
  'atestados',
  'tcle',
  // 02-AGE linha 53: pedidos de vaga na agenda, para quem tem a permissão da aba.
  'pedidos-vaga',
  'alta',
  'anexos',
  'tempos',
  // W0-04 (M1): os dispositivos invasivos (o mesmo registro da CCIH), para quem tem a permissão da aba.
  'dispositivos',
] as const;
const abasVisiveis = computed(() =>
  ABAS.filter(
    (a) =>
      (a !== 'dispositivos' || pode('qualidade.dispositivoInvasivo.ler')) &&
      (a !== 'pedidos-vaga' || pode('pep.pedidoVaga.ler')),
  ),
);

// ── Pedir parecer (regra 10): categoria ou especialidade, prioridade e prazo ──────────────────────────
const roteador = useRouter();
const pedindo = ref(false);
const filaParecer = useQuery({
  queryKey: ['pep', 'doc', 'fila', 'para-pedir'],
  queryFn: () => lerFila({}),
  enabled: pedindo,
});
const paraCategoria = ref<(typeof CATEGORIAS_ASSISTENCIAIS)[number]>('medico');
const paraEspecialidade = ref<number | null>(null);
const prioridade = ref<(typeof PRIORIDADES_PARECER)[number]>('rotina');
const opcoesCategoria = computed(() =>
  CATEGORIAS_ASSISTENCIAIS.map((c) => ({ valor: c, rotulo: t(`pep.doc.categorias.${c}`) })),
);
const opcoesEspecialidade = computed(() => [
  { valor: null, rotulo: t('pep.doc.prontuario.qualquerEspecialidade') },
  ...(filaParecer.data.value?.especialidades ?? []).map((e) => ({ valor: e.id, rotulo: e.nome })),
]);
const opcoesPrioridade = computed(() =>
  PRIORIDADES_PARECER.map((pr) => ({ valor: pr, rotulo: t(`pep.doc.pareceres.prioridades.${pr}`) })),
);
const prazoHoras = ref('');
const prazoValido = computed(() => {
  if (prazoHoras.value.trim() === '') return true;
  const n = Number(prazoHoras.value);
  return Number.isInteger(n) && n >= 1 && n <= 720;
});
async function pedirParecer(): Promise<void> {
  if (!prazoValido.value) return;
  pedindo.value = false;
  await roteador.push({
    path: `/pep/${id.value}/registro/MED09`,
    query: {
      pedirParecer: paraCategoria.value,
      prioridade: prioridade.value,
      ...(paraEspecialidade.value !== null ? { especialidade: String(paraEspecialidade.value) } : {}),
      ...(prazoHoras.value.trim() ? { prazoHoras: prazoHoras.value.trim() } : {}),
    },
  });
}

const exportando = ref(false);
const justificativa = ref('');
const senha = ref('');
const erroExportar = ref<unknown>(null);
async function exportar(): Promise<void> {
  erroExportar.value = null;
  try {
    abrirArquivo(await exportarProntuario(id.value, justificativa.value, senha.value || undefined));
    exportando.value = false;
  } catch (e) {
    erroExportar.value = e;
  }
}
</script>

<template>
  <section class="prontuario" aria-labelledby="prontuario-titulo" data-testid="tela-prontuario-paciente">
    <h1 id="prontuario-titulo" class="sr">{{ t('pep.doc.prontuario.titulo') }}</h1>
    <MensagemErro v-if="cab.isError.value" :erro="cab.error.value" />
    <p v-else-if="!cab.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <div class="fixo">
        <SanteCabecalhoPaciente :paciente="cab.data.value.contexto" />
        <PrecaucaoNoCabecalho :paciente="id" />
        <AvisoRedePaciente :paciente="id" />
        <NotasAlertaPaciente :paciente="id" />
        <div class="acoes">
          <RouterLink :to="`/pep/${id}/registro`" data-testid="novo-registro">{{
            t('pep.doc.prontuario.novoRegistro')
          }}</RouterLink>
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.doc.prontuario.pedirParecer')"
            data-testid="pedir-parecer"
            @acionar="pedindo = true"
          />
          <RouterLink
            v-if="cab.data.value.categoria && cab.data.value.categoria !== 'medico'"
            :to="{
              path: `/pep/paciente/${id}/registros/novo`,
              query: { categoria: cab.data.value.categoria },
            }"
            >{{ t('pep.doc.prontuario.multiprofissional') }}</RouterLink
          >
          <RouterLink
            v-if="pode('pep.reconciliacao.ler') || pode('pep.farmacovigilancia.avaliar')"
            :to="`/pep/paciente/${id}/farmacovigilancia`"
            data-testid="atalho-farmacovigilancia"
            >{{ t('pep.doc.prontuario.farmacovigilancia') }}</RouterLink
          >
          <RouterLink
            :to="{
              path: `/pep/paciente/${id}/diagnosticos`,
              query: cab.data.value.atendimentoAtual ? { atendimento: cab.data.value.atendimentoAtual } : {},
            }"
            data-testid="atalho-diagnosticos"
            >{{ t('pep.terminologia.atalho') }}</RouterLink
          >
          <RouterLink :to="`/pep/paciente/${id}/notas`" data-testid="atalho-notas">{{
            t('pep.notas.atalho')
          }}</RouterLink>
          <RouterLink :to="`/pep/paciente/${id}/crescimento`" data-testid="atalho-crescimento">{{
            t('pep.crescimento.atalho')
          }}</RouterLink>
          <RouterLink :to="`/pep/paciente/${id}/exame-fisico`" data-testid="atalho-exame-fisico">{{
            t('pep.exameFisico.atalho')
          }}</RouterLink>
          <RouterLink :to="`/pep/paciente/${id}/nota-soap`" data-testid="atalho-nota-soap">{{
            t('pep.notaSoap.atalho')
          }}</RouterLink>
          <AtalhoAnotacoesAdministrativas :paciente="id" />
          <AtalhoEquipeAssistencial :atendimento="cab.data.value.atendimentoAtual" />
          <SanteBotao
            variante="secundario"
            :rotulo="t('pep.doc.prontuario.exportar')"
            @acionar="exportando = true"
          />
        </div>
      </div>
      <nav class="abas" :aria-label="t('pep.doc.prontuario.abas')">
        <RouterLink
          v-for="a in abasVisiveis"
          :key="a"
          :to="`/pep/paciente/${id}/${a}`"
          :data-testid="`aba-${a}`"
          >{{ a === 'pedidos-vaga' ? t('pep.pedidoVaga.aba') : t(`pep.doc.prontuario.aba.${a}`) }}</RouterLink
        >
      </nav>
      <RouterView v-slot="{ Component }">
        <component :is="Component" :paciente="id" :cabecalho="cab.data.value" />
      </RouterView>
    </template>

    <SanteDialogo v-model:visivel="pedindo" :titulo="t('pep.doc.prontuario.pedirParecer')">
      <form class="form" data-testid="form-pedir-parecer" @submit.prevent="pedirParecer">
        <p>{{ t('pep.doc.prontuario.pedirParecerTexto') }}</p>
        <MensagemErro v-if="filaParecer.isError.value" :erro="filaParecer.error.value" />
        <p v-if="filaParecer.data.value && !filaParecer.data.value.criar.pode" role="alert">
          {{ filaParecer.data.value.criar.motivo }}
        </p>
        <SanteSelecao
          v-model="paraCategoria"
          class="campo"
          :rotulo="t('pep.doc.pareceres.categoria')"
          :opcoes="opcoesCategoria"
          data-testid="parecer-categoria"
        />
        <SanteSelecao
          v-model="paraEspecialidade"
          class="campo"
          :rotulo="t('pep.doc.pareceres.especialidade')"
          :opcoes="opcoesEspecialidade"
          data-testid="parecer-especialidade"
        />
        <SanteSelecao
          v-model="prioridade"
          class="campo"
          :rotulo="t('pep.doc.pareceres.col.prioridade')"
          :opcoes="opcoesPrioridade"
          data-testid="parecer-prioridade"
        />
        <label>
          <span>{{ t('pep.doc.prontuario.prazoHoras') }}</span>
          <input
            v-model="prazoHoras"
            inputmode="numeric"
            :aria-invalid="!prazoValido"
            data-testid="parecer-prazo"
          />
        </label>
        <p v-if="!prazoValido" role="alert">{{ t('pep.doc.prontuario.prazoInvalido') }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="t('pep.doc.prontuario.abrirPedido')"
          :desabilitado="filaParecer.data.value ? !filaParecer.data.value.criar.pode : false"
          data-testid="parecer-abrir"
        />
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="exportando" :titulo="t('pep.doc.prontuario.exportar')">
      <form class="form" @submit.prevent="exportar">
        <p>{{ t('pep.doc.prontuario.exportarTexto') }}</p>
        <label>
          <span>{{ t('pep.doc.justificativa') }}</span>
          <textarea
            v-model="justificativa"
            rows="3"
            maxlength="255"
            required
            data-testid="exportar-justificativa"
          />
        </label>
        <label>
          <span>{{ t('pep.doc.senha') }}</span>
          <input v-model="senha" type="password" autocomplete="current-password" />
        </label>
        <MensagemErro v-if="erroExportar" :erro="erroExportar" />
        <SanteBotao tipo="submit" :rotulo="t('pep.doc.confirmar')" />
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.prontuario {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.fixo {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--sgh-fundo);
  padding-bottom: var(--sgh-espaco-1);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
}
.abas a {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  text-decoration: none;
  color: var(--sgh-texto);
}
.abas a.router-link-active {
  font-weight: 700;
  border-color: var(--sgh-borda-forte);
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.form .campo {
  flex-direction: column;
  align-items: stretch;
  gap: var(--sgh-espaco-1);
}
.form label {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
