<script setup lang="ts">
// Fila do consultório (ficha do M20, seção 7): `/consultorio/fila`. Os pacientes do dia do local — agendados e
// espontâneos — na ordem de chamada (em atendimento, chamados, aguardando por prioridade legal e hora), com a espera;
// chamar (a senha vai ao painel da recepção) e iniciar o atendimento do chamado; o encerramento abre a ficha. O
// médico vê a fila dele no local; "todos do local" mostra a do local inteiro. O canal de eventos avisa cada mudança
// (as gravações do novo e o vigia de 1 a 2 s das senhas: a chamada feita em outro terminal) e a lista relê; sem o
// canal, a cada 15 s. Cada linha leva ao prontuário do paciente (a leitura do prontuário é auditada).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { podeChamar } from '@sgh/dominio-atendimento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { CANAL_FILA, conduzirNoConsultorio, lerFilaConsultorio, novaChave } from '../api-atendimento.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';
import { usarAvisosAtendimento } from '../vigia.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { pode, motivoAmbulatorio } = usarAtendimento();
const LOCAL_SALVO = 'sgh.consultorio.local';
const lido = (() => {
  try {
    return globalThis.localStorage?.getItem(LOCAL_SALVO) ?? '';
  } catch {
    return '';
  }
})();
const local = ref(typeof rota.query['local'] === 'string' ? rota.query['local'] : lido);
const todos = ref(false);
watch(local, (v) => {
  try {
    globalThis.localStorage?.setItem(LOCAL_SALVO, v);
  } catch {
    /* sem armazenamento local: só a sessão */
  }
});
const avisos = usarAvisosAtendimento(CANAL_FILA, () => void fila.refetch());
const fila = useQuery({
  queryKey: computed(() => ['atendimento', 'fila', local.value, todos.value]),
  queryFn: () => lerFilaConsultorio(local.value ? Number(local.value) : null, todos.value),
  refetchInterval: computed(() => avisos.intervalo()),
});
const vePep = podePermissao('pep.prontuario.ler');
const locais = computed(() => [
  { valor: '', rotulo: t('atendimento.escolha') },
  ...(fila.data.value?.locais ?? []).map((l) => ({ valor: String(l.id), rotulo: l.descricao })),
]);
const podeConduzir = pode('atendimento.conduzirNoConsultorio');
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function conduzir(reg: number, evento: 'chamar' | 'atender'): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await conduzirNoConsultorio(reg, { local: Number(local.value), evento }, novaChave(evento));
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento', 'fila'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const prioridade = (p: '0' | '1' | '2') => t(`atendimento.fila.prioridades.${p}`);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="fila-titulo" data-testid="tela-fila-consultorio">
    <h1 id="fila-titulo">{{ t('atendimento.fila.titulo') }}</h1>
    <p>{{ t('atendimento.fila.texto') }}</p>
    <AvisoAtendimento :motivo="motivoAmbulatorio" />
    <div class="filtros">
      <SanteSelecao
        v-model="local"
        :rotulo="t('atendimento.fila.local')"
        :opcoes="locais"
        data-testid="fila-local"
      />
      <label><input v-model="todos" type="checkbox" /> {{ t('atendimento.fila.todos') }}</label>
    </div>
    <ErroAtendimento v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <p v-if="!fila.data.value.local">{{ t('atendimento.fila.escolhaLocal') }}</p>
      <p v-else-if="fila.data.value.itens.length === 0">{{ t('atendimento.fila.vazia') }}</p>
      <table v-else class="tabela" data-testid="tabela-fila">
        <caption>
          {{
            t('atendimento.fila.legenda', {
              n: fila.data.value.itens.length,
              local: fila.data.value.local.descricao,
            })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('atendimento.paciente') }}</th>
            <th scope="col">{{ t('atendimento.senha') }}</th>
            <th scope="col">{{ t('atendimento.fila.prioridade') }}</th>
            <th scope="col">{{ t('atendimento.fila.espera') }}</th>
            <th scope="col">{{ t('atendimento.situacao') }}</th>
            <th scope="col">{{ t('atendimento.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in fila.data.value.itens" :key="i.reg" :data-testid="`fila-${i.reg}`">
            <td>
              <strong>{{ i.paciente }}</strong>
              <span class="secundario">
                · {{ t('atendimento.prontuario', { n: i.prontuario }) }}
                <template v-if="i.agendadoPara">
                  · {{ t('atendimento.fila.agendado', { hora: i.agendadoPara }) }}</template
                >
              </span>
            </td>
            <td>{{ i.senha ?? '—' }}</td>
            <td>{{ prioridade(i.prioridade) }}</td>
            <td>{{ t('atendimento.minutos', { n: i.esperaMinutos }) }}</td>
            <td :data-testid="`fila-situacao-${i.reg}`">
              {{ t(`atendimento.fila.situacoes.${i.situacao}`) }}
              <span v-if="i.chamadas > 1" class="secundario"
                >· {{ t('atendimento.fila.chamadas', { n: i.chamadas }) }}</span
              >
            </td>
            <td class="acoes">
              <template v-if="podeConduzir">
                <SanteBotao
                  v-if="podeChamar(i.situacao)"
                  variante="secundario"
                  :rotulo="
                    i.situacao === 'chamado'
                      ? t('atendimento.fila.chamarDeNovo')
                      : t('atendimento.fila.chamar')
                  "
                  :desabilitado="ocupado"
                  :data-testid="`fila-chamar-${i.reg}`"
                  @acionar="conduzir(i.reg, 'chamar')"
                />
                <SanteBotao
                  v-if="i.situacao === 'chamado'"
                  :rotulo="t('atendimento.fila.atender')"
                  :desabilitado="ocupado"
                  :data-testid="`fila-atender-${i.reg}`"
                  @acionar="conduzir(i.reg, 'atender')"
                />
              </template>
              <RouterLink
                v-if="vePep && i.idPaciente"
                :to="`/pep/paciente/${i.idPaciente}`"
                :aria-label="t('atendimento.fila.prontuarioDe', { paciente: i.paciente })"
                :data-testid="`fila-pep-${i.reg}`"
                >{{ t('atendimento.fila.prontuario') }}</RouterLink
              >
              <RouterLink
                :to="`/recepcao/atendimento/${i.reg}/encerrar`"
                :data-testid="`fila-encerrar-${i.reg}`"
                >{{ t('atendimento.encerrar.titulo') }}</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <p v-if="mensagem" role="status" data-testid="fila-mensagem">{{ mensagem }}</p>
    <ErroAtendimento v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
