<script setup lang="ts">
// Quadro do bloco e rastreio do paciente (M46, etapa 2; ficha, seções 4 e 7; operação cirurgia.moverPacienteBloco): o
// mapa do dia com o estado de segurança por cirurgia (os três momentos do checklist, a exceção, os alertas e a avaliação
// pré-anestésica), o local de cada paciente agora e o código do painel para familiares, em tempo real (o canal de
// eventos; sem ele, relê a cada 15 s). Ao escolher a cirurgia, o histórico dos movimentos e o registro do próximo
// (só os que cabem agora: entrada, mudança de local, saída, retorno e a saída desfeita logo depois), com o código do
// painel para entregar à família.
import {
  CONCLUSOES_APA,
  DESTINOS_SAIDA_BLOCO,
  ID_LOCAL_SALA,
  TIPOS_MOVIMENTO_BLOCO,
  type LinhaQuadroBloco,
  type TipoMovimentoBloco,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { novaChaveAnestesia } from '../api-anestesia.js';
import { gravarBloco, lerDominiosRastreio, lerQuadroBloco, lerRastreio } from '../api-bloco-seguro.js';
import ErroBloco from '../componentes/ErroBloco.vue';
import { usarAvisosDoBloco } from '../usar-avisos-bloco.js';
import './estilo-anestesia.css';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { permissoes } = usarSessao();
const veOpme = computed(() => permissoes.value.has('suprimentos.opme.ler'));
const agenda = computed(() => Number(route.query['agenda']) || null);
const filtro = reactive({ data: '', sala: '' });

const quadro = useQuery({
  queryKey: computed(() => ['bloco', 'quadro', filtro.data, filtro.sala]),
  queryFn: () => lerQuadroBloco(filtro.data || null, filtro.sala || null),
});
const dominios = useQuery({ queryKey: ['bloco', 'dominios'], queryFn: () => lerDominiosRastreio() });
const rastreio = useQuery({
  queryKey: computed(() => ['bloco', 'rastreio', agenda.value]),
  queryFn: () => lerRastreio(agenda.value!),
  enabled: computed(() => !!agenda.value),
});
const { conectado } = usarAvisosDoBloco(() => {
  void quadro.refetch();
  if (agenda.value) void rastreio.refetch();
});

const hora = (x: string | null | undefined) => (x ? x.replace('T', ' ').slice(11, 16) : '—');
const totais = computed(() => {
  const q = quadro.data.value?.totais;
  if (!q) return '';
  return t('blocoSeguro.quadro.totais', {
    cirurgias: q.cirurgias,
    noBloco: q.noBloco,
    emSala: q.emSala,
    naRecuperacao: q.naRecuperacao,
    outros: q.noBloco - q.emSala - q.naRecuperacao,
    pausa: q.pausaConcluida,
  });
});
const opcoesSala = computed(() => [
  { valor: '', rotulo: '—' },
  ...(dominios.data.value?.salas ?? []).map((s) => ({
    valor: String(s.codigo),
    rotulo: `${s.codigo} · ${s.nome}`,
  })),
]);
const seguranca = (l: LinhaQuadroBloco) => {
  const c = l.checklist;
  if (!c) return t('blocoSeguro.escolha.semChecklist');
  const sim = t('blocoSeguro.quadro.sim');
  const nao = t('blocoSeguro.quadro.nao');
  const partes = [
    t('blocoSeguro.quadro.momentos', {
      inducao: c.inducao ? sim : nao,
      incisao: c.incisao ? sim : nao,
      saida: c.saida ? sim : nao,
    }),
  ];
  if (c.excecao) partes.push(t('blocoSeguro.quadro.excecao'));
  if (c.alertas > 0) partes.push(t('blocoSeguro.quadro.alertas', { n: c.alertas }));
  return partes.join(' · ');
};
const localAgora = (l: LinhaQuadroBloco) =>
  l.local
    ? `${l.local.rotulo}${l.local.salaCirurgica ? ` ${l.local.salaCirurgica}` : ''} · ${t('blocoSeguro.quadro.desde', { hora: hora(l.local.desde) })}`
    : l.saiu
      ? t('blocoSeguro.quadro.saiu', { hora: hora(l.saiu.em) })
      : t('blocoSeguro.quadro.fora');
function abrir(a: number | null): void {
  void router.push({ name: 'bloco.rastreio', query: a ? { agenda: String(a) } : {} });
}

const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const form = reactive({
  tipo: '' as TipoMovimentoBloco | '',
  local: '',
  salaCirurgica: '',
  destino: '',
  em: agoraLocal(),
  observacao: '',
});
const tela = computed(() => rastreio.data.value);
watch(tela, (r) => {
  if (!r) return;
  form.tipo = r.permitidos[0] ?? '';
  form.local = '';
  form.salaCirurgica = r.local?.salaCirurgica ? String(r.local.salaCirurgica) : String(r.sala);
  form.destino = '';
  form.em = agoraLocal();
  form.observacao = '';
});
const opcoesTipo = computed(() =>
  (tela.value?.permitidos ?? []).map((p) => ({
    valor: p as string,
    rotulo: TIPOS_MOVIMENTO_BLOCO.find((x) => x.codigo === p)!.rotulo,
  })),
);
const opcoesLocal = computed(() => [
  { valor: '', rotulo: '—' },
  ...(dominios.data.value?.locais ?? [])
    .filter((l) => !(tela.value?.local?.id === l.id && l.id !== ID_LOCAL_SALA))
    .map((l) => ({ valor: String(l.id), rotulo: l.rotulo })),
]);
const opcoesDestino = [
  { valor: '', rotulo: '—' },
  ...DESTINOS_SAIDA_BLOCO.map((d) => ({ valor: d.codigo as string, rotulo: d.rotulo })),
];
const precisaLocal = computed(
  () => form.tipo !== '' && form.tipo !== 'alta' && form.tipo !== 'cancelamentoAlta',
);
const naSala = computed(() => precisaLocal.value && Number(form.local) === ID_LOCAL_SALA);
const podeMover = computed(() => tela.value?.gravacao.operacoes['mover']?.pode === true);
const pronto = computed(
  () =>
    form.tipo !== '' &&
    (!precisaLocal.value || form.local !== '') &&
    (!naSala.value || form.salaCirurgica !== '') &&
    (form.tipo !== 'alta' || form.destino !== ''),
);
const erro = ref<unknown>(null);
const mensagem = ref('');
const enviando = ref(false);
async function mover(): Promise<void> {
  if (!tela.value) return;
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    const r = await gravarBloco(
      `/${tela.value.agendamento}/rastreio`,
      {
        agendamento: tela.value.agendamento,
        ultimoVisto: tela.value.ultimoMovimento,
        tipo: form.tipo,
        local: precisaLocal.value ? Number(form.local) : null,
        salaCirurgica: naSala.value ? Number(form.salaCirurgica) : null,
        em: form.em,
        destino: form.tipo === 'alta' ? form.destino : null,
        observacao: form.observacao.trim() || null,
      },
      novaChaveAnestesia('rastreio'),
    );
    mensagem.value = r.mensagem;
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
    await Promise.all([rastreio.refetch(), quadro.refetch()]);
  }
}
const imprimir = () => globalThis.print?.();
</script>

<template>
  <section class="tela-anest" aria-labelledby="ras-titulo" data-testid="tela-rastreio">
    <h1 id="ras-titulo">{{ t('blocoSeguro.quadro.titulo') }}</h1>
    <div class="barra nao-imprimir">
      <span class="campo">
        <label for="ras-data">{{ t('blocoSeguro.escolha.data') }}</label>
        <input id="ras-data" v-model="filtro.data" type="date" data-testid="ras-data" />
      </span>
      <SanteSelecao
        v-model="filtro.sala"
        :rotulo="t('blocoSeguro.escolha.sala')"
        :opcoes="opcoesSala"
        data-testid="ras-sala"
      />
      <p class="secundario" data-testid="ras-canal">
        {{ conectado ? t('blocoSeguro.quadro.conectado') : t('blocoSeguro.quadro.semCanal') }}
      </p>
    </div>
    <ErroBloco v-if="quadro.isError.value" :erro="quadro.error.value" />
    <p v-else-if="!quadro.data.value" role="status">{{ t('blocoSeguro.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!quadro.data.value.gravacao.ligada"
        variante="aviso"
        :texto="quadro.data.value.gravacao.motivo ?? t('blocoSeguro.emConsulta')"
        class="nao-imprimir"
      />
      <p class="nao-imprimir" data-testid="ras-totais">{{ totais }}</p>
      <p v-if="quadro.data.value.linhas.length === 0">{{ t('blocoSeguro.quadro.semCirurgias') }}</p>
      <div v-else class="rolagem nao-imprimir">
        <table class="grade" data-testid="ras-quadro">
          <caption class="secundario">
            {{
              t('blocoSeguro.escolha.legenda', { data: quadro.data.value.data })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('blocoSeguro.escolha.sala') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.horario') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.paciente') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.procedimento') }}</th>
              <th scope="col">{{ t('blocoSeguro.quadro.estado') }}</th>
              <th scope="col">{{ t('blocoSeguro.quadro.seguranca') }}</th>
              <th scope="col">{{ t('blocoSeguro.quadro.local') }}</th>
              <th scope="col">{{ t('blocoSeguro.quadro.codigo') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.acao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="l in quadro.data.value.linhas"
              :key="l.agendamento"
              :data-testid="`ras-linha-${l.agendamento}`"
            >
              <td>{{ l.sala }}</td>
              <td>{{ l.inicio.slice(11, 16) }}</td>
              <td>{{ l.paciente }}</td>
              <td>{{ l.procedimento ?? '—' }}</td>
              <td>{{ t(`blocoSeguro.quadro.estados.${l.estado}`) }}</td>
              <td :data-testid="`ras-seguranca-${l.agendamento}`">
                {{ seguranca(l) }}
                <span class="secundario">
                  · {{ t('blocoSeguro.quadro.apa') }}:
                  {{
                    CONCLUSOES_APA.find((c) => c.codigo === l.apa)?.rotulo ?? t('blocoSeguro.quadro.semApa')
                  }}
                </span>
              </td>
              <td :data-testid="`ras-local-${l.agendamento}`">{{ localAgora(l) }}</td>
              <td>{{ l.codigoPainel ?? '—' }}</td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('blocoSeguro.quadro.abrir')"
                  :data-testid="`ras-abrir-${l.agendamento}`"
                  @acionar="abrir(l.agendamento)"
                />
                <!-- M46 (etapa 3): a remissão do bloco ao OPME da cirurgia (o consumo em sala com o rastreio). -->
                <SanteBotao
                  v-if="veOpme"
                  variante="texto"
                  :rotulo="t('blocoSeguro.quadro.opme')"
                  :data-testid="`ras-opme-${l.agendamento}`"
                  @acionar="router.push({ name: 'bloco.opme', params: { agenda: String(l.agendamento) } })"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="quadro.data.value.truncado" class="secundario">{{ t('blocoSeguro.escolha.truncado') }}</p>
      </div>
    </template>

    <section v-if="agenda" class="cartao" aria-labelledby="ras-pac" data-testid="ras-paciente">
      <ErroBloco v-if="rastreio.isError.value" :erro="rastreio.error.value" />
      <p v-else-if="!tela" role="status">{{ t('blocoSeguro.carregando') }}</p>
      <template v-else>
        <h2 id="ras-pac" class="nao-imprimir">
          {{ t('blocoSeguro.rastreio.titulo') }} · {{ tela.paciente }}
        </h2>
        <div class="codigo-painel" data-testid="ras-codigo">
          <p>{{ t('blocoSeguro.rastreio.codigo') }}</p>
          <p v-if="tela.codigoPainel" class="codigo" data-testid="ras-codigo-valor">
            {{ tela.codigoPainel }}
          </p>
          <p v-if="tela.codigoPainel" class="secundario">
            {{ t('blocoSeguro.rastreio.codigoValido', { hora: hora(tela.codigoValidoAte) }) }}
          </p>
          <p v-else class="secundario">{{ t('blocoSeguro.rastreio.semCodigo') }}</p>
          <SanteBotao
            v-if="tela.codigoPainel"
            variante="secundario"
            class="nao-imprimir"
            :rotulo="t('blocoSeguro.rastreio.imprimir')"
            data-testid="ras-imprimir"
            @acionar="imprimir"
          />
        </div>
        <div class="nao-imprimir">
          <h3>{{ t('blocoSeguro.rastreio.historico') }}</h3>
          <p v-if="tela.movimentos.length === 0" class="secundario">{{ t('blocoSeguro.rastreio.nenhum') }}</p>
          <ol v-else data-testid="ras-historico">
            <li v-for="m in tela.movimentos" :key="m.id">
              {{ hora(m.em) }} · {{ m.rotulo }}
              <template v-if="m.localRotulo"> · {{ m.localRotulo }}</template>
              <template v-if="m.salaCirurgica"> {{ m.salaCirurgica }}</template>
              <template v-if="m.destino">
                · {{ DESTINOS_SAIDA_BLOCO.find((d) => d.codigo === m.destino)?.rotulo }}</template
              >
              <span class="secundario"> · {{ t('blocoSeguro.rastreio.por', { usuario: m.usuario }) }}</span>
            </li>
          </ol>
          <ErroBloco v-if="erro" :erro="erro" />
          <p v-if="mensagem" role="status" data-testid="ras-mensagem">{{ mensagem }}</p>
          <form
            v-if="podeMover && opcoesTipo.length > 0"
            class="barra"
            data-testid="ras-form"
            @submit.prevent="mover"
          >
            <SanteSelecao
              v-model="form.tipo"
              :rotulo="t('blocoSeguro.rastreio.movimento')"
              :opcoes="opcoesTipo"
              data-testid="ras-tipo"
            />
            <SanteSelecao
              v-if="precisaLocal"
              v-model="form.local"
              :rotulo="t('blocoSeguro.rastreio.local')"
              :opcoes="opcoesLocal"
              data-testid="ras-local"
            />
            <SanteSelecao
              v-if="naSala"
              v-model="form.salaCirurgica"
              :rotulo="t('blocoSeguro.rastreio.salaCirurgica')"
              :opcoes="opcoesSala.slice(1)"
              data-testid="ras-sala-cirurgica"
            />
            <SanteSelecao
              v-if="form.tipo === 'alta'"
              v-model="form.destino"
              :rotulo="t('blocoSeguro.rastreio.destino')"
              :opcoes="opcoesDestino"
              data-testid="ras-destino"
            />
            <span class="campo">
              <label for="ras-em">{{ t('blocoSeguro.horario') }}</label>
              <input id="ras-em" v-model="form.em" type="datetime-local" data-testid="ras-em" />
            </span>
            <span class="campo">
              <label for="ras-obs">{{ t('blocoSeguro.rastreio.observacao') }}</label>
              <input
                id="ras-obs"
                v-model="form.observacao"
                type="text"
                maxlength="255"
                data-testid="ras-obs"
              />
            </span>
            <SanteBotao
              tipo="submit"
              :rotulo="t('blocoSeguro.rastreio.registrar')"
              :desabilitado="enviando || !pronto"
              data-testid="ras-registrar"
            />
          </form>
          <SanteBotao variante="texto" :rotulo="t('blocoSeguro.rastreio.fechar')" @acionar="abrir(null)" />
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped>
.codigo-painel {
  border: 2px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 4px);
  padding: var(--sgh-espaco-2);
  text-align: center;
}
.codigo {
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: 0.15em;
}
@media print {
  .nao-imprimir {
    display: none !important;
  }
}
</style>
