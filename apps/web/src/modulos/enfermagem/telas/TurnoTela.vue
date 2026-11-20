<script setup lang="ts">
// Linha do tempo do turno (ficha do M25, seção 7): a worklist da enfermagem. As doses, os cuidados e os controles da
// unidade no turno, por hora, com o estado (atrasada e omitida em vermelho, suspensa riscada), os sinais devidos e
// os conflitos abertos. A suspensão feita na prescrição (neste ou no outro sistema) chega pelo canal de avisos em
// segundos. Em `/beira-leito/turno` a mesma tela abre a checagem do tablet.
import type { HorarioEnfermagem } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { gerarContingencia, lerTurno, lerUltimaContingencia } from '../api-enfermagem.js';
import { pode } from '../../../casca/sessao/pode.js';
import CuidadosDoTurno from '../componentes/CuidadosDoTurno.vue';
import TransfusoesDoTurno from '../componentes/TransfusoesDoTurno.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import EstadoHorario from '../componentes/EstadoHorario.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarAvisosEnfermagem, usarEnfermagem } from '../usar-enfermagem.js';

const props = withDefaults(defineProps<{ modo?: 'tela' | 'beira' }>(), { modo: 'tela' });
// M45 (etapa 4): a prescrição de enfermagem do turno, para quem lê o processo de enfermagem.
const verCuidados = pode('enfermagem.sae.ler');
// M47 (etapa 1; regra 4): as tarefas dos sinais das transfusões da unidade.
const verTransfusoes = pode('sadt.transfusao.ler');
const { t } = useI18n();
const roteador = useRouter();
const { unidade, escolherUnidade, opcoesUnidade, unidades } = usarEnfermagem();
const turno = useQuery({
  queryKey: computed(() => ['enfermagem', 'turno', unidade.value]),
  queryFn: () => lerTurno(unidade.value),
  enabled: computed(() => !!unidade.value),
});
const { conectado } = usarAvisosEnfermagem(() => void turno.refetch());

const porHora = computed(() => {
  const m = new Map<string, HorarioEnfermagem[]>();
  for (const h of turno.data.value?.horarios ?? []) {
    const k = h.previsto.slice(0, 13);
    m.set(k, [...(m.get(k) ?? []), h]);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
});
const nomes = computed(() => new Map((turno.data.value?.pacientes ?? []).map((p) => [p.paciente, p])));
const ESTADOS = ['pendente', 'atrasada', 'omitida', 'administrada', 'naoAdministrada', 'suspensa'] as const;
const hora = (iso: string) => iso.slice(11, 16);

function abrir(h: HorarioEnfermagem): void {
  if (props.modo === 'beira')
    void roteador.push({ path: '/beira-leito/checagem', query: { atendimento: h.atendimento } });
  else void roteador.push(`/enfermagem/checagem/${h.atendimento}`);
}
// M40 (regra 6): o relatório de contingência do posto (a unidade escolhida).
const horasContingencia = ref('6');
const opcoesHoras = [2, 4, 6, 8, 12].map((h) => ({ valor: String(h), rotulo: `${h} h` }));
const contingenciaMensagem = ref<string | null>(null);
const contingenciaErro = ref<unknown>(null);
const gerando = ref(false);
async function contingencia(): Promise<void> {
  if (!unidade.value) return;
  contingenciaErro.value = null;
  contingenciaMensagem.value = null;
  gerando.value = true;
  try {
    const r = await gerarContingencia(unidade.value, Number(horasContingencia.value));
    const url = URL.createObjectURL(r.pdf);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    contingenciaMensagem.value = t('enfermagem.contingencia.gerado', {
      pacientes: r.pacientes,
      horarios: r.horarios,
    });
  } catch (e) {
    // Sem o serviço de emissão (503): a saída de sempre, a impressão desta linha do tempo.
    if (e instanceof ErroApi && e.status === 503)
      contingenciaMensagem.value = t('enfermagem.contingencia.indisponivel');
    else contingenciaErro.value = e;
  } finally {
    gerando.value = false;
  }
}

// A estação de contingência baixa o último relatório do posto (o da hora) sem gerar outro.
async function ultimaContingencia(): Promise<void> {
  if (!unidade.value) return;
  contingenciaErro.value = null;
  contingenciaMensagem.value = null;
  gerando.value = true;
  try {
    const r = await lerUltimaContingencia(unidade.value);
    const url = URL.createObjectURL(r.pdf);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    contingenciaMensagem.value = t('enfermagem.contingencia.ultimaAberta', {
      em: r.geradoEm.slice(0, 16).replace('T', ' '),
      pacientes: r.pacientes,
    });
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404)
      contingenciaMensagem.value = t('enfermagem.contingencia.semUltima');
    else if (e instanceof ErroApi && e.status === 503)
      contingenciaMensagem.value = t('enfermagem.contingencia.indisponivel');
    else contingenciaErro.value = e;
  } finally {
    gerando.value = false;
  }
}

function sinais(paciente: number): void {
  if (props.modo === 'beira') void roteador.push({ path: '/beira-leito/sinais-vitais', query: { paciente } });
  else void roteador.push(`/enfermagem/paciente/${paciente}/sinais-vitais`);
}
</script>

<template>
  <section class="tela-enf" aria-labelledby="turno-titulo" data-testid="tela-turno">
    <h1 id="turno-titulo">{{ t('enfermagem.turno.titulo') }}</h1>
    <p>{{ t('enfermagem.turno.texto') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.comum.atualizar')"
        @acionar="turno.refetch()"
      />
      <span class="secundario" role="status">{{
        conectado ? t('enfermagem.comum.aoVivo') : t('enfermagem.comum.semCanal')
      }}</span>
    </div>
    <section
      v-if="props.modo === 'tela' && unidade"
      class="barra"
      aria-labelledby="contingencia-titulo"
      data-testid="contingencia"
    >
      <h2 id="contingencia-titulo">{{ t('enfermagem.contingencia.titulo') }}</h2>
      <p>{{ t('enfermagem.contingencia.texto') }}</p>
      <SanteSelecao
        id="contingencia-horas"
        v-model="horasContingencia"
        :rotulo="t('enfermagem.contingencia.horas')"
        :opcoes="opcoesHoras"
        data-testid="contingencia-horas"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.contingencia.gerar')"
        :desabilitado="gerando"
        data-testid="contingencia-gerar"
        @acionar="contingencia"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.contingencia.ultima')"
        :desabilitado="gerando"
        data-testid="contingencia-ultima"
        @acionar="ultimaContingencia"
      />
      <SanteAlerta
        v-if="contingenciaMensagem"
        :texto="contingenciaMensagem"
        variante="info"
        anunciar
        data-testid="contingencia-mensagem"
      />
      <ErroEnfermagem v-if="contingenciaErro" :erro="contingenciaErro" />
    </section>
    <ErroEnfermagem v-if="unidades.isError.value" :erro="unidades.error.value" />
    <ErroEnfermagem v-if="turno.isError.value" :erro="turno.error.value" />
    <p v-else-if="!turno.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <p data-testid="turno-janela">
        {{
          t('enfermagem.turno.turno', {
            nome: t(`enfermagem.turno.${turno.data.value.turno.nome}`),
            inicio: hora(turno.data.value.turno.inicio),
            fim: hora(turno.data.value.turno.fim),
          })
        }}
      </p>
      <dl class="resumo" :aria-label="t('enfermagem.turno.resumo')" data-testid="turno-resumo">
        <div v-for="e in ESTADOS" :key="e">
          <dt><EstadoHorario :estado="e" /></dt>
          <dd :data-testid="`resumo-${e}`">{{ turno.data.value.resumo[e] ?? 0 }}</dd>
        </div>
      </dl>
      <p v-if="turno.data.value.conflitosAbertos > 0" role="alert">
        <RouterLink to="/enfermagem/conflitos" data-testid="turno-conflitos">
          {{ t('enfermagem.turno.conflitos', { n: turno.data.value.conflitosAbertos }) }}
        </RouterLink>
      </p>
      <p v-if="turno.data.value.cortada" role="note">{{ t('enfermagem.turno.cortada') }}</p>
      <p v-if="porHora.length === 0">{{ t('enfermagem.turno.vazio') }}</p>
      <div v-for="[k, hs] in porHora" :key="k" class="hora">
        <h2>{{ t('enfermagem.turno.hora', { hora: k.slice(11, 13) }) }}</h2>
        <table class="grade">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.comum.previsto') }}</th>
              <th scope="col">{{ t('enfermagem.comum.paciente') }}</th>
              <th scope="col">{{ t('enfermagem.comum.item') }}</th>
              <th scope="col">{{ t('enfermagem.comum.situacao') }}</th>
              <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in hs" :key="h.id" :data-testid="`horario-${h.id}`" :data-estado="h.estado">
              <td>{{ hora(h.previsto) }}</td>
              <td>
                {{
                  h.leito ? t('enfermagem.comum.leito', { leito: h.leito }) : t('enfermagem.comum.semLeito')
                }}
                ·
                {{ h.pacienteNome }}
                <span v-if="nomes.get(h.paciente)?.alergia" class="alerta"
                  >· {{ t('enfermagem.comum.alergia') }}</span
                >
              </td>
              <td>
                {{ h.descricao }}
                <span v-if="h.dose !== null"> · {{ h.dose }} {{ h.unidadeDose ?? '' }}</span>
                <strong v-if="h.altaVigilancia || h.hemocomponente" class="alerta">
                  ·
                  {{
                    h.hemocomponente
                      ? t('enfermagem.comum.hemocomponente')
                      : t('enfermagem.comum.altaVigilancia')
                  }}
                </strong>
                <span v-if="h.seNecessario"> · {{ t('enfermagem.comum.seNecessario') }}</span>
              </td>
              <td>
                <EstadoHorario :estado="h.estado" />
                <span v-if="h.atrasoMinutos && h.estado === 'atrasada'" class="alerta">
                  {{ t('enfermagem.comum.atraso', { n: h.atrasoMinutos }) }}
                </span>
              </td>
              <td>
                <SanteBotao
                  v-if="['pendente', 'atrasada', 'omitida'].includes(h.estado)"
                  :rotulo="t('enfermagem.turno.checar')"
                  :data-testid="`turno-checar-${h.id}`"
                  @acionar="abrir(h)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section v-if="turno.data.value.sinaisDevidos.length" aria-labelledby="sinais-devidos">
        <h2 id="sinais-devidos">{{ t('enfermagem.turno.sinaisDevidos') }}</h2>
        <ul>
          <li v-for="s in turno.data.value.sinaisDevidos" :key="s.paciente">
            {{ nomes.get(s.paciente)?.nome ?? s.paciente }} ·
            {{
              s.ultimo
                ? t('enfermagem.turno.ultimoSinal', { quando: s.ultimo.slice(0, 16).replace('T', ' ') })
                : t('enfermagem.turno.nuncaRegistrado')
            }}
            <SanteBotao
              variante="texto"
              :rotulo="t('enfermagem.turno.sinais')"
              @acionar="sinais(s.paciente)"
            />
          </li>
        </ul>
      </section>
      <section
        v-if="turno.data.value.contencoes?.length"
        aria-labelledby="contencao-turno"
        data-testid="turno-contencoes"
      >
        <h2 id="contencao-turno">{{ t('enfermagem.turno.contencao.titulo') }}</h2>
        <ul>
          <li
            v-for="c in turno.data.value.contencoes"
            :key="`${c.ordem}-${c.previsto}`"
            :data-testid="`turno-contencao-${c.ordem}`"
          >
            {{ hora(c.previsto) }} ·
            {{ c.leito ? t('enfermagem.comum.leito', { leito: c.leito }) : t('enfermagem.comum.semLeito') }} ·
            {{ nomes.get(c.paciente)?.nome ?? c.paciente }} ·
            {{ t(`enfermagem.turno.contencao.estados.${c.estado}`) }}
            <strong v-if="c.ordemVencida" class="alerta" role="alert" data-testid="turno-contencao-vencida">
              · {{ t('enfermagem.turno.contencao.ordemVencida') }}
            </strong>
          </li>
        </ul>
        <RouterLink to="/enfermagem/contencao" data-testid="turno-contencao-abrir">{{
          t('enfermagem.turno.contencao.abrir')
        }}</RouterLink>
      </section>
      <CuidadosDoTurno v-if="verCuidados && unidade" :unidade="unidade" />
      <TransfusoesDoTurno v-if="verTransfusoes && unidade" :unidade="unidade" />
    </template>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
