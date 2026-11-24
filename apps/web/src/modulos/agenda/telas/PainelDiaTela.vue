<script setup lang="ts">
// Painel do dia (ficha do M17, seção 7): `/agenda/consultas/dia`. As marcações do dia (de uma agenda ou de todas)
// com o estado, o canal e o risco de falta pela antecedência; os candidatos a falta (passou a tolerância e não
// chegou) aparecem destacados e o fechamento do dia revisa cada um antes de gravar a falta (agenda.registrarFalta,
// uma gravação por consulta, cada uma com a sua Idempotency-Key). Atualiza sozinho a cada 30 s. A marcação de hoje
// leva à abertura do atendimento (M20: "Abrir atendimento" preenche a ficha pelo agendamento), para quem abre.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { codigoDaRecusa, lerPainelDia, novaChave, registrarFalta } from '../api-agenda.js';
import { ofereceAbertura } from '../../atendimento/regras-tela.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, horaBr } from '../formato.js';
import { usarAgenda } from '../usar-agenda.js';

const { t, te } = useI18n();
const cliente = useQueryClient();
const { opcoesAgenda, pode } = usarAgenda();
const podeFalta = pode('agenda.registrarFalta');
const podeIndicadores = computed(() => podePermissao('agenda.indicador.ler'));
const podeAbrirAtendimento = computed(() => podePermissao('atendimento.atendimento.abrir'));
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const data = ref('');
const agenda = ref('');
const painel = useQuery({
  queryKey: computed(() => ['agenda', 'dia', data.value, agenda.value]),
  queryFn: () => lerPainelDia(data.value || null, agenda.value ? Number(agenda.value) : null),
  refetchInterval: 30_000,
});
const escolhas = computed(() => [{ valor: '', rotulo: t('agenda.todas') }, ...opcoesAgenda.value]);
const candidatos = computed(() => new Set(painel.data.value?.candidatosAFalta ?? []));

// ── Fechamento do dia: revisão dos candidatos a falta ──
// Todo candidato entra marcado; o coordenador desmarca quem chegou ou foi atendido por outro caminho.
const desmarcados = ref<Set<number>>(new Set());
const chaves = new Map<number, string>();
const chaveDe = (id: number) => {
  if (!chaves.has(id)) chaves.set(id, novaChave('falta'));
  return chaves.get(id) as string;
};
const resultados = ref<Map<number, string>>(new Map());
const resumoFaltas = ref<string | null>(null);
const gravando = ref(false);
const listaCandidatos = computed(() =>
  (painel.data.value?.marcacoes ?? []).filter((m) => candidatos.value.has(m.id) && m.acoes.registrarFalta),
);
const revisao = computed(
  () => new Set(listaCandidatos.value.map((m) => m.id).filter((id) => !desmarcados.value.has(id))),
);
function alternar(id: number, marcado: boolean): void {
  const n = new Set(desmarcados.value);
  if (marcado) n.delete(id);
  else n.add(id);
  desmarcados.value = n;
}
async function registrarFaltas(): Promise<void> {
  gravando.value = true;
  resumoFaltas.value = null;
  const r = new Map(resultados.value);
  let feitas = 0;
  let recusadas = 0;
  for (const id of [...revisao.value]) {
    try {
      await registrarFalta(id, chaveDe(id));
      r.set(id, t('agenda.dia.faltaOk'));
      feitas++;
    } catch (e) {
      // Regra 15: o texto da aplicação para a recusa conhecida; nunca o texto do servidor.
      const c = codigoDaRecusa(e);
      r.set(id, c && te(`agenda.recusas.${c}`) ? t(`agenda.recusas.${c}`) : t('agenda.dia.faltaRecusada'));
      recusadas++;
      chaves.set(id, novaChave('falta'));
    }
  }
  resultados.value = r;
  resumoFaltas.value = t('agenda.dia.resultadoFaltas', { feitas, recusadas });
  gravando.value = false;
  await cliente.invalidateQueries({ queryKey: ['agenda'] });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dia-titulo" data-testid="tela-dia">
    <h1 id="dia-titulo">{{ t('agenda.dia.titulo') }}</h1>
    <p>{{ t('agenda.dia.texto') }}</p>
    <div class="filtros">
      <div class="campo">
        <label for="dia-data">{{ t('agenda.data') }}</label>
        <input id="dia-data" v-model="data" type="date" data-testid="dia-data" />
      </div>
      <SanteSelecao v-model="agenda" :rotulo="t('agenda.agenda')" :opcoes="escolhas" />
      <SanteBotao variante="secundario" :rotulo="t('agenda.dia.atualizar')" @acionar="painel.refetch()" />
    </div>
    <p v-if="podeIndicadores">
      <RouterLink to="/agenda/consultas/indicadores">{{ t('agenda.linkIndicadores') }}</RouterLink>
    </p>
    <ErroAgenda v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value" role="status">{{ t('agenda.carregando') }}</p>
    <template v-else>
      <p role="status">
        {{
          t('agenda.dia.resumo', {
            total: painel.data.value.resumo.total,
            alto: painel.data.value.resumo.riscoAlto,
          })
        }}
        · {{ t('agenda.dia.agora', { agora: painel.data.value.agora }) }}
      </p>
      <SanteAlerta
        v-if="painel.data.value.candidatosAFalta.length"
        variante="aviso"
        :texto="t('agenda.dia.candidatos', { n: painel.data.value.candidatosAFalta.length })"
      />
      <p v-if="painel.data.value.marcacoes.length === 0">{{ t('agenda.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-dia">
        <caption>
          {{
            t('agenda.dia.legenda', { data: dataBr(painel.data.value.data) })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('agenda.hora') }}</th>
            <th scope="col">{{ t('agenda.agenda') }}</th>
            <th scope="col">{{ t('agenda.paciente') }}</th>
            <th scope="col">{{ t('agenda.marcacao.situacao') }}</th>
            <th scope="col">{{ t('agenda.canal') }}</th>
            <th scope="col">{{ t('agenda.risco.titulo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in painel.data.value.marcacoes"
            :key="m.id"
            :class="{ candidato: candidatos.has(m.id) }"
            :data-testid="`dia-marcacao-${m.id}`"
          >
            <td>
              {{ horaBr(m.hora) }}<template v-if="m.encaixe"> · {{ t('agenda.estados.encaixe') }}</template>
            </td>
            <td>{{ m.nomeAgenda }}</td>
            <td>
              <RouterLink
                :to="`/agenda/consultas/marcacoes/${m.id}`"
                :aria-label="t('agenda.dia.detalhe', { paciente: m.paciente })"
              >
                {{ m.paciente }}
              </RouterLink>
              <span
                v-if="m.prioridadeLegal"
                class="prioridade-legal"
                :data-testid="`dia-prioridade-${m.id}`"
                :title="t('agenda.dia.prioridadeLegal')"
              >
                {{ t('agenda.dia.prioridadeLegal') }}: {{ m.prioridadeLegal }}
              </span>
              <template v-if="podeAbrirAtendimento && ofereceAbertura(m, hoje)">
                ·
                <RouterLink
                  :to="`/recepcao/atendimento/novo?marcacao=${m.id}`"
                  :aria-label="t('agenda.dia.abrirAtendimentoDe', { paciente: m.paciente })"
                  :data-testid="`dia-abrir-atendimento-${m.id}`"
                  >{{ t('agenda.dia.abrirAtendimento') }}</RouterLink
                >
              </template>
            </td>
            <td>{{ t(`agenda.estados.${m.estado}`) }}</td>
            <td>
              {{ m.canal }}<template v-if="m.canalAConfirmar"> ({{ t('agenda.aConfirmar') }})</template>
            </td>
            <td>{{ t(`agenda.risco.${m.risco.nivel}`) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="painel.data.value.marcacoes.some((m) => m.canalAConfirmar)" class="secundario">
        {{ t('agenda.canalAConfirmar') }}
      </p>
      <section
        v-if="podeFalta && listaCandidatos.length"
        class="painel"
        aria-labelledby="dia-fechamento"
        data-testid="fechamento-dia"
      >
        <h2 id="dia-fechamento">{{ t('agenda.dia.fechamento') }}</h2>
        <p>{{ t('agenda.dia.fechamentoTexto') }}</p>
        <ul class="lista-faltas">
          <li v-for="m in listaCandidatos" :key="m.id">
            <label>
              <input
                type="checkbox"
                :checked="revisao.has(m.id)"
                :data-testid="`falta-${m.id}`"
                @change="alternar(m.id, ($event.target as HTMLInputElement).checked)"
              />
              {{ t('agenda.dia.marcarFalta', { paciente: m.paciente, hora: horaBr(m.hora) }) }} ·
              {{ m.nomeAgenda }}
            </label>
            <span v-if="resultados.get(m.id)" class="secundario"> — {{ resultados.get(m.id) }}</span>
          </li>
        </ul>
        <SanteBotao
          variante="destrutivo"
          :rotulo="t('agenda.dia.registrarFaltas', { n: revisao.size })"
          :desabilitado="revisao.size === 0 || gravando"
          :confirmacao="t('agenda.dia.registrarFaltasPergunta', { n: revisao.size })"
          data-testid="botao-registrar-faltas"
          @acionar="registrarFaltas"
        />
      </section>
      <p v-if="resumoFaltas" role="status" data-testid="resultado-faltas">{{ resumoFaltas }}</p>
    </template>
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
<style scoped>
.prioridade-legal {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
  background: var(--sgh-aviso-suave);
  color: var(--sgh-aviso);
}
.candidato td {
  font-weight: 600;
  border-inline-start: 4px solid var(--sgh-aviso);
}
</style>
