<script setup lang="ts">
// Recuperação pós-anestésica (M46, etapa 1; ficha, seção 7; regra 4; operação cirurgia.registrarSrpa). Sem paciente
// escolhido, o quadro dos admitidos sem alta (permanência, último índice, a próxima avaliação e a vencida em destaque,
// relido a cada 30 s) e a escolha da cirurgia do dia para a admissão. Com o paciente: a série de avaliações e o painel
// da avaliação (os cinco itens de Aldrete-Kroulik com o texto do nível, dor, náusea e vômito, sinais opcionais) e a alta
// com o destino e os impedimentos ao vivo pela regra versionada (a mesma do servidor).
import {
  DESTINOS_ALTA_SRPA,
  ITENS_ALDRETE,
  NIVEIS_NVPO,
  REGRA_ALTA_SRPA_V1,
  type ItemAldrete,
  type MomentoSrpa,
} from '@sgh/contratos';
import { impedimentosDaAlta, totalAldrete } from '@sgh/dominio-cirurgia';
import { SanteAlerta, SanteBotao, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { gravarAnestesia, lerQuadroSrpa, lerSrpa, novaChaveAnestesia } from '../api-anestesia.js';
import CabecalhoAnestesia from '../componentes/CabecalhoAnestesia.vue';
import ErroAnestesia from '../componentes/ErroAnestesia.vue';
import EscolhaCirurgia from '../componentes/EscolhaCirurgia.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const agenda = computed(() => Number(route.query['agenda']) || null);

const quadro = useQuery({
  queryKey: ['anestesia', 'srpa', 'quadro'],
  queryFn: () => lerQuadroSrpa(),
  enabled: computed(() => !agenda.value),
  refetchInterval: 30_000,
});
const dados = useQuery({
  queryKey: computed(() => ['anestesia', 'srpa', agenda.value]),
  queryFn: () => lerSrpa(agenda.value!),
  enabled: computed(() => !!agenda.value),
  refetchInterval: 30_000,
});
const tela = computed(() => dados.data.value);
// De volta ao quadro (sem o paciente), o quadro é relido: a admissão ou a alta de agora entram na hora.
watch(agenda, (a) => {
  if (!a) void quadro.refetch();
});
const srpa = computed(() => tela.value?.srpa);

const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hora = (x: string | null | undefined) => (x ? x.replace('T', ' ').slice(11, 16) : '—');

const form = reactive({
  momento: 'admissao' as MomentoSrpa,
  em: agoraLocal(),
  aldrete: Object.fromEntries(ITENS_ALDRETE.map((i) => [i.item, '2'])) as Record<ItemAldrete, string>,
  dor: 0,
  nvpo: '0',
  pas: '',
  pad: '',
  fc: '',
  spo2: '',
  temperatura: '',
  observacao: '',
  destino: 'unidade' as string,
  motivoDestino: '',
});
// O formulário volta ao começo só quando a série muda (uma avaliação nova), não a cada releitura do quadro.
watch(
  () => srpa.value?.ultima ?? -1,
  () => {
    const s = srpa.value;
    if (!s) return;
    form.momento = s.avaliacoes.length === 0 ? 'admissao' : 'avaliacao';
    form.em = agoraLocal();
  },
  { immediate: true },
);
const momentos = computed(() =>
  (srpa.value?.avaliacoes.length ?? 0) === 0
    ? [{ valor: 'admissao' as MomentoSrpa, rotulo: t('anestesia.srpa.momentos.admissao') }]
    : (['avaliacao', 'alta'] as MomentoSrpa[]).map((m) => ({
        valor: m,
        rotulo: t(`anestesia.srpa.momentos.${m}`),
      })),
);
const opcoesNivel = (i: (typeof ITENS_ALDRETE)[number]) =>
  i.niveis.map((rotulo, nivel) => ({ valor: String(nivel), rotulo: `${nivel} · ${rotulo}` }));
const aldrete = computed(
  () =>
    Object.fromEntries(ITENS_ALDRETE.map((i) => [i.item, Number(form.aldrete[i.item])])) as Record<
      ItemAldrete,
      number
    >,
);
const opcoesDor = Array.from({ length: 11 }, (_, i) => ({ valor: i, rotulo: String(i) }));
const opcoesNvpo = NIVEIS_NVPO.map((x) => ({ valor: String(x.nivel), rotulo: x.rotulo }));
const opcoesDestino = DESTINOS_ALTA_SRPA.map((d) => ({ valor: d.codigo as string, rotulo: d.rotulo }));
const total = computed(() => totalAldrete(aldrete.value));
const impedimentos = computed(() => {
  const s = srpa.value;
  if (!s || form.momento !== 'alta') return [];
  return impedimentosDaAlta(
    s.avaliacoes.map((a) => ({ momento: a.momento, em: a.em, aldrete: a.aldrete, dor: a.dor, nvpo: a.nvpo })),
    {
      em: form.em,
      aldrete: aldrete.value,
      dor: form.dor,
      nvpo: Number(form.nvpo),
      destino: form.destino as 'unidade',
      motivoDestino: form.motivoDestino || null,
    },
  );
});
const pode = computed(() => tela.value?.gravacao.operacoes['srpa']?.pode === true && !srpa.value?.alta);

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
async function registrar(): Promise<void> {
  if (!agenda.value || !srpa.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const alta = form.momento === 'alta';
    const r = await gravarAnestesia(
      `/${agenda.value}/srpa`,
      {
        agendamento: agenda.value,
        ultimaVista: srpa.value.ultima,
        momento: form.momento,
        em: form.em,
        aldrete: aldrete.value,
        dor: form.dor,
        nvpo: Number(form.nvpo),
        pas: num(form.pas),
        pad: num(form.pad),
        fc: num(form.fc),
        spo2: num(form.spo2),
        temperatura: num(form.temperatura),
        observacao: form.observacao.trim() || null,
        destino: alta ? form.destino : null,
        motivoDestino: alta ? form.motivoDestino.trim() || null : null,
      },
      novaChaveAnestesia('srpa'),
    );
    mensagem.value = r.mensagem;
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
function abrir(a: number): void {
  void router.push({ name: 'bloco.srpa', query: { agenda: String(a) } });
}
function voltar(): void {
  void router.push({ name: 'bloco.srpa' });
}
const regra = REGRA_ALTA_SRPA_V1;
</script>

<template>
  <section class="tela-anest" aria-labelledby="srpa-titulo" data-testid="tela-srpa">
    <h1 id="srpa-titulo">{{ t('anestesia.srpa.titulo') }}</h1>
    <p class="secundario">
      {{
        t('anestesia.srpa.regra', {
          versao: regra.versao,
          minimo: regra.aldreteMinimo,
          dor: regra.dorMaxima,
          minutos: regra.permanenciaMinimaMin,
        })
      }}
    </p>

    <template v-if="!agenda">
      <section aria-labelledby="srpa-quadro" data-testid="srpa-quadro">
        <h2 id="srpa-quadro">{{ t('anestesia.srpa.quadro') }}</h2>
        <ErroAnestesia v-if="quadro.isError.value" :erro="quadro.error.value" />
        <p v-else-if="!quadro.data.value" role="status">{{ t('anestesia.carregando') }}</p>
        <p v-else-if="quadro.data.value.linhas.length === 0">{{ t('anestesia.srpa.quadroVazio') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ t('anestesia.escolha.sala') }}</th>
                <th scope="col">{{ t('anestesia.escolha.paciente') }}</th>
                <th scope="col">{{ t('anestesia.srpa.admissao') }}</th>
                <th scope="col">{{ t('anestesia.srpa.aldrete') }}</th>
                <th scope="col">{{ t('anestesia.srpa.proxima') }}</th>
                <th scope="col">{{ t('anestesia.escolha.acao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="l in quadro.data.value.linhas"
                :key="l.agendamento"
                :data-estado="l.avaliacaoVencida ? 'atrasada' : 'ok'"
                :data-testid="`srpa-linha-${l.agendamento}`"
              >
                <td>{{ l.sala }}</td>
                <td>{{ l.paciente ?? '—' }}</td>
                <td>
                  {{ t('anestesia.srpa.admitidoEm', { hora: hora(l.admitidoEm) }) }} ·
                  {{ t('anestesia.srpa.permanencia', { minutos: l.permanenciaMin }) }}
                </td>
                <td>
                  {{ l.ultimoTotal ?? '—'
                  }}<template v-if="l.podeDarAlta"> · {{ t('anestesia.srpa.podeAlta') }}</template>
                </td>
                <td>
                  <strong v-if="l.avaliacaoVencida" class="alerta">{{
                    t('anestesia.srpa.avaliacaoVencida')
                  }}</strong>
                  <template v-else>{{ hora(l.proximaAte) }}</template>
                </td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('anestesia.srpa.avaliar')"
                    :data-testid="`srpa-abrir-${l.agendamento}`"
                    @acionar="abrir(l.agendamento)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <EscolhaCirurgia destino="srpa" />
    </template>

    <template v-else>
      <SanteBotao
        variante="texto"
        :rotulo="t('anestesia.srpa.voltarQuadro')"
        data-testid="srpa-voltar"
        @acionar="voltar"
      />
      <ErroAnestesia v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!tela || !srpa" role="status">{{ t('anestesia.carregando') }}</p>
      <template v-else>
        <CabecalhoAnestesia :contexto="tela.contexto" :exames="false" />
        <SanteAlerta
          v-if="!tela.gravacao.ligada"
          variante="aviso"
          :texto="tela.gravacao.motivo ?? t('anestesia.emConstrucao')"
        />
        <SanteAlerta
          v-if="srpa.avaliacaoVencida"
          variante="alerta"
          :texto="t('anestesia.srpa.avaliacaoVencida')"
          data-testid="srpa-vencida"
        />
        <p v-if="srpa.alta" class="secundario">{{ t('anestesia.prontuarioPendente') }}</p>
        <p v-if="srpa.alta" data-testid="srpa-alta">
          {{
            t('anestesia.srpa.altaEm', {
              hora: hora(srpa.alta.em),
              destino: DESTINOS_ALTA_SRPA.find((d) => d.codigo === srpa!.alta!.destino)?.rotulo ?? '',
            })
          }}
        </p>
        <p v-else-if="srpa.proximaAvaliacaoAte" class="secundario">
          {{ t('anestesia.srpa.proximaAte', { hora: hora(srpa.proximaAvaliacaoAte) }) }}
        </p>
        <section aria-labelledby="srpa-serie">
          <h2 id="srpa-serie">{{ t('anestesia.srpa.serie') }}</h2>
          <p v-if="srpa.avaliacoes.length === 0">{{ t('anestesia.semRegistro') }}</p>
          <ul v-else data-testid="srpa-avaliacoes">
            <li v-for="a in srpa.avaliacoes" :key="a.id">
              {{ hora(a.em) }} · {{ t(`anestesia.srpa.momentos.${a.momento}`) }} ·
              {{ t('anestesia.srpa.total', { total: a.total }) }} · {{ t('anestesia.srpa.dor') }}
              {{ a.dor }} · {{ NIVEIS_NVPO[a.nvpo]?.rotulo }} · {{ a.usuario }}
            </li>
          </ul>
        </section>
        <p v-if="mensagem" role="status" data-testid="srpa-mensagem">{{ mensagem }}</p>
        <ErroAnestesia v-if="erro" :erro="erro" />

        <form v-if="pode" class="cartao" data-testid="srpa-form" @submit.prevent="registrar">
          <div class="barra">
            <SanteSelecao
              v-model="form.momento"
              :rotulo="t('anestesia.srpa.momento')"
              :opcoes="momentos"
              data-testid="srpa-momento"
            />
            <span class="campo">
              <label for="srpa-em">{{ t('anestesia.horario') }}</label>
              <input id="srpa-em" v-model="form.em" type="datetime-local" data-testid="srpa-em" />
            </span>
          </div>
          <fieldset data-testid="srpa-aldrete">
            <legend>{{ t('anestesia.srpa.aldrete') }} · {{ t('anestesia.srpa.total', { total }) }}</legend>
            <SanteOpcoes
              v-for="i in ITENS_ALDRETE"
              :key="i.item"
              v-model="form.aldrete[i.item]"
              :legenda="i.rotulo"
              :opcoes="opcoesNivel(i)"
              :data-testid="`srpa-${i.item}`"
            />
          </fieldset>
          <div class="barra">
            <SanteSelecao
              v-model="form.dor"
              :rotulo="t('anestesia.srpa.dor')"
              :opcoes="opcoesDor"
              data-testid="srpa-dor"
            />
            <SanteOpcoes
              v-model="form.nvpo"
              :legenda="t('anestesia.srpa.nvpo')"
              :opcoes="opcoesNvpo"
              data-testid="srpa-nvpo"
            />
          </div>
          <fieldset>
            <legend>{{ t('anestesia.srpa.sinais') }}</legend>
            <span v-for="c in ['pas', 'pad', 'fc', 'spo2', 'temperatura'] as const" :key="c" class="campo">
              <label :for="`srpa-${c}`">{{
                c === 'temperatura' ? t('anestesia.srpa.temperatura') : c.toUpperCase()
              }}</label>
              <input :id="`srpa-${c}`" v-model="form[c]" inputmode="decimal" />
            </span>
          </fieldset>
          <div v-if="form.momento === 'alta'" class="barra">
            <SanteSelecao
              v-model="form.destino"
              :rotulo="t('anestesia.srpa.destino')"
              :opcoes="opcoesDestino"
              data-testid="srpa-destino"
            />
            <span class="campo">
              <label for="srpa-motivo">{{ t('anestesia.srpa.motivoDestino') }}</label>
              <input
                id="srpa-motivo"
                v-model="form.motivoDestino"
                maxlength="255"
                data-testid="srpa-motivo"
              />
            </span>
          </div>
          <span class="campo">
            <label for="srpa-obs">{{ t('anestesia.observacao') }}</label>
            <input id="srpa-obs" v-model="form.observacao" maxlength="400" />
          </span>
          <template v-if="form.momento === 'alta'">
            <p v-if="impedimentos.length === 0" data-testid="srpa-pode-alta">
              {{ t('anestesia.srpa.podeAlta') }}
            </p>
            <template v-else>
              <p>{{ t('anestesia.srpa.impedimentos') }}</p>
              <ul data-testid="srpa-impedimentos">
                <li v-for="i in impedimentos" :key="i" class="alerta">{{ t(`anestesia.recusas.${i}`) }}</li>
              </ul>
            </template>
          </template>
          <SanteBotao
            tipo="submit"
            :rotulo="
              form.momento === 'alta'
                ? t('anestesia.srpa.darAlta')
                : form.momento === 'admissao'
                  ? t('anestesia.srpa.admitir')
                  : t('anestesia.srpa.avaliar')
            "
            :desabilitado="ocupado || (form.momento === 'alta' && impedimentos.length > 0)"
            data-testid="srpa-registrar"
          />
        </form>
      </template>
    </template>
  </section>
</template>

<style src="./estilo-anestesia.css"></style>
