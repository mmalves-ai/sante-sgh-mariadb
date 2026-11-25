<script setup lang="ts">
// Incapacidade do paciente e comprovantes da representação (F3.1, 02-CAD linha 4), dentro da tela de contatos e
// responsáveis, por paciente:
//   - a incapacidade é uma condição com data de início e documento (sentença de curatela, curatela provisória ou
//     laudo médico); o levantamento encerra com data e motivo, e o histórico fica na lista;
//   - o que a abertura do atendimento vai avisar (menor sem representante, incapaz sem curador) aparece aqui antes;
//   - o comprovante (termo de guarda, tutela, curatela, sentença ou laudo) é anexado direto na linha: escolher o
//     arquivo já envia (um passo), com o tipo e o tamanho conferidos na hora.
// A validação aparece antes de gravar; o servidor confere tudo de novo pela regra do domínio.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { lerResponsaveis } from '../api-ficha-complementar.js';
import {
  DOCUMENTOS_JUDICIAIS,
  encerrarIncapacidade,
  enviarComprovante,
  lerIncapacidades,
  registrarIncapacidade,
  TAMANHO_MAXIMO_COMPROVANTE,
  TIPOS_COMPROVANTE,
} from '../api-representacao.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Incapacidade do paciente e comprovantes',
      naAbertura: 'Aviso na abertura do atendimento: {mensagem}',
      semRegistro: 'Nenhuma incapacidade registrada.',
      desde: 'desde {data}',
      vigente: 'vigente',
      levantada: 'levantada em {data}',
      processo: 'nº {numero}',
      comprovanteAnexado: 'comprovante anexado',
      anexar: 'Anexar comprovante (PDF ou imagem, até 640 KB)',
      inicio: 'Início da incapacidade',
      documento: 'Documento',
      numero: 'Número do processo ou do laudo',
      dataDocumento: 'Data do documento',
      registrar: 'Registrar incapacidade',
      levantamento: 'Levantamento da incapacidade',
      fim: 'Data do levantamento',
      motivo: 'Motivo',
      registrarLevantamento: 'Registrar levantamento',
      comprovantes: 'Comprovantes dos responsáveis',
      gravado: 'Gravado.',
      anexado: 'Comprovante anexado.',
      indisponivel: 'A incapacidade do paciente não pôde ser lida agora.',
      docs: {
        sentenca_curatela: 'Sentença de curatela',
        curatela_provisoria: 'Curatela provisória',
        laudo_medico: 'Laudo médico',
      },
      papeis: { guardiao_legal: 'Guardião legal', tutor: 'Tutor', curador: 'Curador' },
      erro: {
        inicioFuturo: 'O início não pode ser uma data futura.',
        dataDocumentoFutura: 'A data do documento não pode ser futura.',
        numero: 'Informe o número do processo da curatela.',
        fim: 'O levantamento não pode ser futuro nem anterior ao início da incapacidade.',
        motivo: 'Informe o motivo.',
        arquivo: 'O comprovante tem de ser PDF, PNG ou JPEG, com até 640 KB.',
      },
    },
  },
});

const podeEditar = computed(() => pode('cadastro.paciente.editar'));
const cliente = useQueryClient();
const incapacidades = useQuery({
  queryKey: computed(() => ['cadastro', 'incapacidades', props.paciente]),
  queryFn: () => lerIncapacidades(props.paciente),
  retry: false,
});
// A mesma consulta da tela (mesma chave): os vínculos que pedem comprovante e ainda não têm.
const responsaveis = useQuery({
  queryKey: computed(() => ['cadastro', 'responsaveis', props.paciente]),
  queryFn: () => lerResponsaveis(props.paciente),
});
const COM_COMPROVANTE = ['guardiao_legal', 'tutor', 'curador'];
const semComprovante = computed(() =>
  (responsaveis.data.value?.itens ?? []).filter(
    (r) => r.vigente && !r.temComprovante && COM_COMPROVANTE.includes(r.papel),
  ),
);
const vigente = computed(() => incapacidades.data.value?.itens.find((i) => i.vigente) ?? null);

const hoje = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const gravando = ref(false);
async function executar(fn: () => Promise<unknown>, mensagem: string): Promise<boolean> {
  if (gravando.value) return false;
  gravando.value = true;
  recusa.value = null;
  erro.value = null;
  aviso.value = null;
  try {
    await fn();
    aviso.value = mensagem;
    await cliente.invalidateQueries({ queryKey: ['cadastro'] });
    return true;
  } catch (e) {
    const tipo = e instanceof ErroApi && e.problema ? tipoDoProblema(e.problema) : null;
    if ((tipo === 'recusa-de-negocio' || tipo === 'entrada-invalida') && e instanceof ErroApi && e.problema)
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}

// ── Registro ──
const nova = ref({ inicio: '', documentoTipo: 'sentenca_curatela', documentoNumero: '', documentoData: '' });
const errosNova = computed(() => {
  const e: string[] = [];
  if (nova.value.inicio && nova.value.inicio > hoje) e.push(t('erro.inicioFuturo'));
  if (nova.value.documentoData && nova.value.documentoData > hoje) e.push(t('erro.dataDocumentoFutura'));
  if (
    DOCUMENTOS_JUDICIAIS.includes(nova.value.documentoTipo) &&
    nova.value.documentoData &&
    !nova.value.documentoNumero.trim()
  )
    e.push(t('erro.numero'));
  return e;
});
const novaCompleta = computed(() => Boolean(nova.value.inicio && nova.value.documentoData));
async function registrar(): Promise<void> {
  if (errosNova.value.length || !novaCompleta.value) return;
  const ok = await executar(
    () =>
      registrarIncapacidade(props.paciente, {
        inicio: nova.value.inicio,
        documentoTipo: nova.value.documentoTipo,
        documentoNumero: nova.value.documentoNumero.trim() || null,
        documentoData: nova.value.documentoData,
      }),
    t('gravado'),
  );
  if (ok)
    nova.value = { inicio: '', documentoTipo: 'sentenca_curatela', documentoNumero: '', documentoData: '' };
}

// ── Levantamento ──
const fim = ref('');
const motivo = ref('');
const errosFim = computed(() => {
  const e: string[] = [];
  if (fim.value && (fim.value > hoje || (vigente.value?.inicio && fim.value < vigente.value.inicio)))
    e.push(t('erro.fim'));
  if (motivo.value && motivo.value.trim().length < 3) e.push(t('erro.motivo'));
  return e;
});
async function levantar(): Promise<void> {
  if (!vigente.value || errosFim.value.length || !fim.value || motivo.value.trim().length < 3) return;
  const ok = await executar(
    () =>
      encerrarIncapacidade(props.paciente, vigente.value!.id, {
        fim: fim.value,
        motivo: motivo.value.trim(),
      }),
    t('gravado'),
  );
  if (ok) {
    fim.value = '';
    motivo.value = '';
  }
}

// ── Comprovante: escolher o arquivo já envia ──
function anexar(ev: Event, alvo: 'responsavel' | 'incapacidade', id: number): void {
  const campo = ev.target as HTMLInputElement;
  const arq = campo.files?.[0];
  campo.value = '';
  if (!arq) return;
  if (!TIPOS_COMPROVANTE.includes(arq.type) || arq.size > TAMANHO_MAXIMO_COMPROVANTE || arq.size === 0) {
    aviso.value = null;
    erro.value = null;
    recusa.value = t('erro.arquivo');
    return;
  }
  const leitor = new FileReader();
  leitor.onload = () => {
    void executar(
      () => enviarComprovante(props.paciente, { alvo, id, conteudo: String(leitor.result), nome: arq.name }),
      t('anexado'),
    );
  };
  leitor.readAsDataURL(arq);
}
</script>

<template>
  <section aria-labelledby="incapacidade-titulo" data-testid="bloco-incapacidade">
    <h2 id="incapacidade-titulo">{{ t('titulo') }}</h2>
    <SanteAlerta
      v-for="a in incapacidades.data.value?.alertas ?? []"
      :key="a.alerta"
      :texto="t('naAbertura', { mensagem: a.mensagem })"
      variante="aviso"
      data-testid="alerta-abertura"
    />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" data-testid="recusa-representacao" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="aviso-representacao" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="incapacidades.isError.value" role="status" data-testid="incapacidade-indisponivel">
      {{ t('indisponivel') }}
    </p>
    <p v-else-if="incapacidades.data.value && !incapacidades.data.value.itens.length">
      {{ t('semRegistro') }}
    </p>
    <ul>
      <li
        v-for="i in incapacidades.data.value?.itens ?? []"
        :key="i.id"
        :data-testid="`incapacidade-${i.id}`"
      >
        <strong>{{ t(`docs.${i.documentoTipo}`) }}</strong>
        <span v-if="i.documentoNumero"> · {{ t('processo', { numero: i.documentoNumero }) }}</span>
        · {{ t('desde', { data: i.inicio ?? '' }) }} ·
        {{ i.vigente ? t('vigente') : t('levantada', { data: i.fim ?? '' }) }}
        <span v-if="i.motivoEncerramento"> · {{ i.motivoEncerramento }}</span>
        <span v-if="i.temComprovante"> · {{ t('comprovanteAnexado') }}</span>
        <label v-else-if="podeEditar && i.vigente">
          {{ t('anexar') }}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            :data-testid="`anexo-incapacidade-${i.id}`"
            :disabled="gravando"
            @change="anexar($event, 'incapacidade', i.id)"
          />
        </label>
      </li>
    </ul>

    <form
      v-if="podeEditar && incapacidades.data.value && !vigente"
      class="barra"
      data-testid="form-incapacidade"
      @submit.prevent="registrar"
    >
      <label
        >{{ t('inicio') }}
        <input v-model="nova.inicio" type="date" :max="hoje" data-testid="incapacidade-inicio"
      /></label>
      <SanteSelecao
        v-model="nova.documentoTipo"
        :rotulo="t('documento')"
        :opcoes="
          (incapacidades.data.value?.documentos ?? []).map((d) => ({ valor: d, rotulo: t(`docs.${d}`) }))
        "
        data-testid="incapacidade-documento"
      />
      <label
        >{{ t('numero') }}
        <input v-model="nova.documentoNumero" maxlength="60" data-testid="incapacidade-numero"
      /></label>
      <label
        >{{ t('dataDocumento') }}
        <input v-model="nova.documentoData" type="date" :max="hoje" data-testid="incapacidade-data-documento"
      /></label>
      <p v-for="x in errosNova" :key="x" class="erro-campo" role="alert">{{ x }}</p>
      <SanteBotao
        :rotulo="t('registrar')"
        variante="primario"
        tipo="submit"
        :desabilitado="gravando || errosNova.length > 0 || !novaCompleta"
      />
    </form>

    <form
      v-if="podeEditar && vigente"
      class="barra"
      data-testid="form-levantamento"
      :aria-label="t('levantamento')"
      @submit.prevent="levantar"
    >
      <label
        >{{ t('fim') }} <input v-model="fim" type="date" :max="hoje" data-testid="levantamento-fim"
      /></label>
      <label
        >{{ t('motivo') }} <input v-model="motivo" maxlength="300" data-testid="levantamento-motivo"
      /></label>
      <p v-for="x in errosFim" :key="x" class="erro-campo" role="alert">{{ x }}</p>
      <SanteBotao
        :rotulo="t('registrarLevantamento')"
        variante="primario"
        tipo="submit"
        :desabilitado="gravando || errosFim.length > 0 || !fim || motivo.trim().length < 3"
      />
    </form>

    <template v-if="podeEditar && semComprovante.length">
      <h3>{{ t('comprovantes') }}</h3>
      <ul>
        <li v-for="r in semComprovante" :key="r.id" :data-testid="`comprovante-pendente-${r.id}`">
          <strong>{{ r.nome }}</strong> · {{ t(`papeis.${r.papel}`) }}
          <label>
            {{ t('anexar') }}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              :data-testid="`anexo-responsavel-${r.id}`"
              :disabled="gravando"
              @change="anexar($event, 'responsavel', r.id)"
            />
          </label>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sante-espaco-2, 0.5rem);
  align-items: flex-end;
}
.erro-campo {
  color: var(--sgh-alerta);
  width: 100%;
}
</style>
