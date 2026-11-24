<script setup lang="ts">
// 03-PEP L113: fechamento da checagem do turno, na própria linha do tempo. Um clique fecha o turno quando tudo está
// resolvido; com pendências, a tela mostra quantas são e pede a justificativa antes (validação na hora). O fechamento
// trava os horários resolvidos; a reabertura pede o motivo e fica no histórico (nada é apagado).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { fecharTurno, lerFechamentos, reabrirFechamento } from '../api-fechamento-checagem.js';

const props = defineProps<{
  unidade: string;
  janela: { inicio: string; nome: 'diurno' | 'noturno' };
  pendentes: number;
}>();
const emit = defineEmits<{ fechado: [] }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Fechamento da checagem do turno',
      fechar: 'Fechar a checagem do turno',
      pendentes: 'Há {n} horário(s) pendente(s): eles seguem para o próximo turno, sem trava.',
      justificativa: 'Justificativa do fechamento com pendências',
      curta: 'Escreva ao menos 10 caracteres.',
      reabrir: 'Reabrir',
      motivo: 'Motivo da reabertura',
      confirmarReabrir: 'Confirmar a reabertura',
      nenhum: 'Nenhum fechamento hoje.',
      fechado: 'Fechado por {quem} em {quando} · {n} horário(s)',
      reaberto: 'Reaberto em {quando}: {motivo}',
    },
  },
});
const podeFechar = pode('enfermagem.plantao.passar');
const podeReabrir = pode('enfermagem.administracao.estornar');
const data = computed(() => props.janela.inicio.slice(0, 10));
const lista = useQuery({
  queryKey: computed(() => ['enfermagem', 'fechamento-checagem', props.unidade, data.value]),
  queryFn: () => lerFechamentos(props.unidade, data.value),
});
const justificativa = ref('');
const motivo = ref('');
const reabrindo = ref<number | null>(null);
const mensagem = ref('');
const erro = ref('');
const ocupado = ref(false);
const curta = (s: string) => s.trim().length < 10;
const bloqueiaFechar = computed(() => props.pendentes > 0 && curta(justificativa.value));
const quando = (iso: string) => iso.slice(0, 16).replace('T', ' ');

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
    <template v-if="podeFechar">
      <p v-if="pendentes > 0" role="status" data-testid="turno-fechamento-pendentes">
        {{ t('pendentes', { n: pendentes }) }}
      </p>
      <label v-if="pendentes > 0">
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
        :rotulo="t('fechar')"
        :desabilitado="ocupado || bloqueiaFechar"
        data-testid="turno-fechamento-fechar"
        @acionar="fechar"
      />
    </template>
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar />
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar />
    <p v-if="lista.data.value && lista.data.value.length === 0" class="secundario">{{ t('nenhum') }}</p>
    <ul v-else-if="lista.data.value">
      <li v-for="f in lista.data.value" :key="f.id" :data-testid="`turno-fechamento-${f.id}`">
        {{ t('fechado', { quem: f.fechadoPor ?? '-', quando: quando(f.fechadoEm), n: f.horarios }) }}
        <span v-if="f.situacao === 'reaberto'">
          · {{ t('reaberto', { quando: quando(f.reabertoEm ?? ''), motivo: f.motivoReabertura ?? '' }) }}
        </span>
        <template v-else-if="podeReabrir">
          <SanteBotao
            v-if="reabrindo !== f.id"
            variante="texto"
            :rotulo="t('reabrir')"
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
              @acionar="reabrir(f.id)"
            />
          </span>
        </template>
      </li>
    </ul>
  </section>
</template>
