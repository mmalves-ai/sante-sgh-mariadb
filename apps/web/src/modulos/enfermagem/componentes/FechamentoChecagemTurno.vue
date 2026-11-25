<script setup lang="ts">
// 03-PEP L113: fechamento da checagem do turno, na própria linha do tempo. Um clique fecha o turno quando tudo está
// resolvido; com pendências, a tela mostra quantas são e pede a justificativa antes (validação na hora). O fechamento
// pode ser do setor inteiro ou de um só paciente (visão por paciente). Ele trava os horários resolvidos; os pendentes
// seguem ao turno seguinte, que os vê aqui ("recebidos do turno anterior") e volta a fechá-los. A reabertura pede o
// motivo e fica no histórico, com a composição e a justificativa de cada fechamento (nada é apagado).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { fecharTurno, lerFechamentos, reabrirFechamento } from '../api-fechamento-checagem.js';

interface PacienteDoTurno {
  atendimento: number;
  /** Leito e nome, como a linha do tempo mostra. */
  rotulo: string;
  pendentes: number;
}

const props = withDefaults(
  defineProps<{
    unidade: string;
    janela: { inicio: string; nome: 'diurno' | 'noturno' };
    pendentes: number;
    pacientes?: readonly PacienteDoTurno[];
  }>(),
  { pacientes: () => [] },
);
const emit = defineEmits<{ fechado: [] }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Fechamento da checagem do turno',
      escopo: 'Fechar',
      setor: 'O setor inteiro',
      fechar: 'Fechar a checagem do turno',
      fecharPaciente: 'Fechar a checagem deste paciente',
      pendentes: 'Há {n} horário(s) pendente(s): eles seguem para o próximo turno, sem trava.',
      recebidos: 'Pendentes recebidos do turno anterior',
      recebidosAviso:
        'Estes horários entram no fechamento deste turno: se ainda estiverem pendentes, justifique.',
      justificativa: 'Justificativa do fechamento com pendências',
      curta: 'Escreva ao menos 10 caracteres.',
      reabrir: 'Reabrir',
      motivo: 'Motivo da reabertura',
      confirmarReabrir: 'Confirmar a reabertura',
      nenhum: 'Nenhum fechamento hoje.',
      fechado: 'Fechado por {quem} em {quando} · {n} horário(s)',
      doPaciente: 'Paciente: {p}',
      doSetor: 'Setor inteiro',
      passados: '{n} pendente(s) passado(s) adiante: {lista}',
      porque: 'Justificativa: {j}',
      registrado: 'Registrado no prontuário de {n} paciente(s), à espera de assinatura',
      reaberto: 'Reaberto em {quando}: {motivo}',
      atendimento: 'atendimento {n}',
    },
  },
});
const podeFechar = pode('enfermagem.plantao.passar');
const podeReabrir = pode('enfermagem.administracao.estornar');
const data = computed(() => props.janela.inicio.slice(0, 10));
const lista = useQuery({
  queryKey: computed(() => [
    'enfermagem',
    'fechamento-checagem',
    props.unidade,
    data.value,
    props.janela.nome,
  ]),
  queryFn: () => lerFechamentos(props.unidade, data.value, props.janela.nome),
});
const escopo = ref('');
const opcoesEscopo = computed(() => [
  { valor: '', rotulo: t('setor') },
  ...props.pacientes.map((p) => ({ valor: String(p.atendimento), rotulo: p.rotulo })),
]);
const rotulos = computed(() => new Map(props.pacientes.map((p) => [p.atendimento, p.rotulo])));
const doPaciente = (atendimento: number) =>
  rotulos.value.get(atendimento) ?? t('atendimento', { n: atendimento });
const atendimento = computed(() => (escopo.value ? Number(escopo.value) : null));
const recebidos = computed(() =>
  (lista.data.value ?? [])
    .filter((f) => f.anterior && f.situacao === 'fechado')
    .flatMap((f) => f.pendentes)
    .filter((p) => atendimento.value === null || p.atendimento === atendimento.value),
);
const pendentesDoEscopo = computed(() =>
  atendimento.value === null
    ? props.pendentes
    : (props.pacientes.find((p) => p.atendimento === atendimento.value)?.pendentes ?? 0),
);
const justificativa = ref('');
const motivo = ref('');
const reabrindo = ref<number | null>(null);
const mensagem = ref('');
const erro = ref('');
const ocupado = ref(false);
const curta = (s: string) => s.trim().length < 10;
const pedeJustificativa = computed(() => pendentesDoEscopo.value > 0 || recebidos.value.length > 0);
const bloqueiaFechar = computed(() => pendentesDoEscopo.value > 0 && curta(justificativa.value));
const quando = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const hora = (iso: string) => iso.slice(11, 16);

async function agir(fn: () => Promise<{ mensagem: string }>): Promise<void> {
  ocupado.value = true;
  erro.value = '';
  try {
    mensagem.value = (await fn()).mensagem;
    justificativa.value = '';
    motivo.value = '';
    reabrindo.value = null;
    await lista.refetch();
    emit('fechado');
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  } finally {
    ocupado.value = false;
  }
}

function fechar(): Promise<void> {
  return agir(() =>
    fecharTurno({
      unidade: props.unidade,
      data: data.value,
      turno: props.janela.nome,
      atendimento: atendimento.value,
      justificativa: justificativa.value.trim() || null,
    }),
  );
}
function reabrir(id: number): Promise<void> {
  return agir(() => reabrirFechamento(id, motivo.value.trim()));
}
</script>

<template>
  <section class="cartao" aria-labelledby="fech-titulo" data-testid="turno-fechamento">
    <h2 id="fech-titulo">{{ t('titulo') }}</h2>
    <div v-if="recebidos.length > 0" role="status" data-testid="turno-fechamento-recebidos">
      <h3>{{ t('recebidos') }}</h3>
      <ul>
        <li v-for="p in recebidos" :key="p.horario" :data-testid="`turno-fechamento-recebido-${p.horario}`">
          {{ hora(p.previsto) }} · {{ doPaciente(p.atendimento) }}
        </li>
      </ul>
      <p class="secundario">{{ t('recebidosAviso') }}</p>
    </div>
    <template v-if="podeFechar">
      <SanteSelecao
        v-if="pacientes.length > 0"
        id="turno-fechamento-escopo"
        v-model="escopo"
        :rotulo="t('escopo')"
        :opcoes="opcoesEscopo"
        data-testid="turno-fechamento-escopo"
      />
      <p v-if="pendentesDoEscopo > 0" role="status" data-testid="turno-fechamento-pendentes">
        {{ t('pendentes', { n: pendentesDoEscopo }) }}
      </p>
      <label v-if="pedeJustificativa">
        {{ t('justificativa') }}
        <textarea
          v-model="justificativa"
          maxlength="500"
          rows="2"
          data-testid="turno-fechamento-justificativa"
        />
        <small v-if="justificativa && curta(justificativa)" class="alerta">{{ t('curta') }}</small>
      </label>
      <SanteBotao
        :rotulo="atendimento === null ? t('fechar') : t('fecharPaciente')"
        :desabilitado="ocupado || bloqueiaFechar"
        data-testid="turno-fechamento-fechar"
        @acionar="fechar"
      />
    </template>
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar />
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar />
    <p v-if="lista.data.value && lista.data.value.length === 0" class="secundario">{{ t('nenhum') }}</p>
    <ul v-else-if="lista.data.value">
      <li
        v-for="f in lista.data.value"
        :key="f.id"
        :data-testid="`turno-fechamento-${f.id}`"
        :data-situacao="f.situacao"
      >
        {{ t('fechado', { quem: f.fechadoPor ?? '-', quando: quando(f.fechadoEm), n: f.horarios }) }}
        · {{ f.atendimento === null ? t('doSetor') : t('doPaciente', { p: doPaciente(f.atendimento) }) }}
        <span v-if="f.pendentes.length > 0" :data-testid="`turno-fechamento-passados-${f.id}`">
          ·
          {{
            t('passados', {
              n: f.pendentes.length,
              lista: f.pendentes.map((p) => `${hora(p.previsto)} ${doPaciente(p.atendimento)}`).join('; '),
            })
          }}
        </span>
        <span v-if="f.justificativaPendencias"> · {{ t('porque', { j: f.justificativaPendencias }) }}</span>
        <span v-if="(f.documentos?.length ?? 0) > 0" :data-testid="`turno-fechamento-prontuario-${f.id}`">
          · {{ t('registrado', { n: f.documentos!.length }) }}
        </span>
        <span v-if="f.situacao === 'reaberto'">
          · {{ t('reaberto', { quando: quando(f.reabertoEm ?? ''), motivo: f.motivoReabertura ?? '' }) }}
        </span>
        <template v-else-if="podeReabrir">
          <SanteBotao
            v-if="reabrindo !== f.id"
            variante="texto"
            :rotulo="t('reabrir')"
            :data-testid="`turno-fechamento-reabrir-${f.id}`"
            @acionar="reabrindo = f.id"
          />
          <span v-else>
            <label>
              {{ t('motivo') }}
              <input v-model="motivo" maxlength="500" data-testid="turno-fechamento-motivo" />
            </label>
            <SanteBotao
              variante="secundario"
              :rotulo="t('confirmarReabrir')"
              :desabilitado="ocupado || curta(motivo)"
              data-testid="turno-fechamento-confirmar-reabertura"
              @acionar="reabrir(f.id)"
            />
          </span>
        </template>
      </li>
    </ul>
  </section>
</template>
