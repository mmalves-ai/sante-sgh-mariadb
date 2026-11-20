<script setup lang="ts">
// Avaliação pré-anestésica (M46, etapa 1; ficha, seção 7; operação cirurgia.registrarApa). Sem agendamento, a escolha
// da cirurgia do dia; com ele, o cabeçalho (alergias, exames e medicações do prontuário, leitura auditada) e o
// formulário: estado físico (ASA) com o modificador de emergência, via aérea, jejum pela tabela ASA 2017 com o cálculo
// ao vivo, risco cardíaco de Lee (a creatinina acima de 2 sugere o critério), plano anestésico e conclusão. A mesma
// conferência do servidor roda na tela antes de gravar; a retificação é uma versão nova (a anterior fica no histórico).
import {
  CLASSES_ASA,
  CLASSES_MALLAMPATI,
  CONCLUSOES_APA,
  CRITERIOS_LEE,
  TIPOS_INGESTAO,
  type TipoIngestao,
} from '@sgh/contratos';
import { avaliarJejum, conferirApa, indiceLee } from '@sgh/dominio-cirurgia';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarAnestesia, lerApa, novaChaveAnestesia } from '../api-anestesia.js';
import CabecalhoAnestesia from '../componentes/CabecalhoAnestesia.vue';
import ErroAnestesia from '../componentes/ErroAnestesia.vue';
import EscolhaCirurgia from '../componentes/EscolhaCirurgia.vue';

const props = withDefaults(defineProps<{ agenda?: string }>(), { agenda: '' });
const { t } = useI18n();
const agenda = computed(() => Number(props.agenda) || null);

const dados = useQuery({
  queryKey: computed(() => ['anestesia', 'apa', agenda.value]),
  queryFn: () => lerApa(agenda.value!),
  enabled: computed(() => !!agenda.value),
});
const tela = computed(() => dados.data.value);

const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const form = reactive({
  avaliadoEm: agoraLocal(),
  asa: 1 as number,
  emergencia: false,
  pesoKg: '' as string,
  alturaCm: '' as string,
  mallampati: 1 as number,
  aberturaBucalCm: '' as string,
  distanciaTireomentonianaCm: '' as string,
  mobilidadeCervicalReduzida: false,
  protesesOuDentesSoltos: false,
  historicoViaAereaDificil: false,
  jejum: Object.fromEntries(TIPOS_INGESTAO.map((x) => [x, ''])) as Record<TipoIngestao, string>,
  criteriosLee: [] as string[],
  alergiasConferidas: false,
  comorbidades: '',
  medicacoesEmUso: '',
  examesConsiderados: '',
  anestesiasAnteriores: '',
  tipoAnestesia: null as number | null,
  tecnica: '',
  medicacaoPreAnestesica: '',
  reservaUti: false,
  reservaHemocomponente: false,
  orientacoes: '',
  conclusao: 'apto' as string,
  ressalvas: '',
});

// Pré-preenche com o contexto (peso, altura, medicações, tipo agendado) ou com a versão vigente (retificação).
watch(
  tela,
  (x) => {
    if (!x) return;
    const v = x.vigente;
    const c = x.contexto;
    form.pesoKg = String(v?.pesoKg ?? c.pesoKg ?? '');
    form.alturaCm = String(v?.alturaCm ?? c.alturaCm ?? '');
    form.medicacoesEmUso = v?.medicacoesEmUso ?? c.medicacoesEmUso.join(', ');
    form.tipoAnestesia = (v?.plano['tipoAnestesia'] as number | undefined) ?? c.tipoAnestesiaAgendado ?? null;
    if (v) {
      form.asa = v.asa;
      form.emergencia = v.emergencia;
      form.mallampati = Number(v.viaAerea['mallampati'] ?? 1);
      form.criteriosLee = [...v.criteriosLee];
      form.comorbidades = v.comorbidades ?? '';
      form.conclusao = v.conclusao;
      form.ressalvas = v.ressalvas ?? '';
      for (const tipo of TIPOS_INGESTAO) form.jejum[tipo] = v.ultimaIngestao[tipo] ?? '';
    }
  },
  { immediate: true },
);

const opcoesAsa = CLASSES_ASA.map((c) => ({
  valor: c.classe as number,
  rotulo: `${c.rotulo} · ${c.descricao}`,
}));
const opcoesMallampati = CLASSES_MALLAMPATI.map((m) => ({
  valor: m as number,
  rotulo: `${t('anestesia.apa.mallampati')} ${m}`,
}));
const opcoesConclusao = CONCLUSOES_APA.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo }));
const opcoesTipo = computed(() => [
  { valor: null, rotulo: '—' },
  ...(tela.value?.tiposAnestesia ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: x.id as number | null, rotulo: x.rotulo })),
]);

const ingestao = computed(
  () =>
    Object.fromEntries(TIPOS_INGESTAO.map((x) => [x, form.jejum[x] || null])) as Record<
      TipoIngestao,
      string | null
    >,
);
const jejum = computed(() => (tela.value ? avaliarJejum(ingestao.value, tela.value.contexto.dataHora) : []));
const lee = computed(() => indiceLee(form.criteriosLee));
const creatininaAlta = computed(() => (tela.value?.contexto.creatinina ?? 0) > 2);
const conferencia = computed(() =>
  tela.value
    ? conferirApa(
        {
          asa: form.asa as 1,
          emergencia: form.emergencia,
          alergiasConferidas: form.alergiasConferidas,
          conclusao: form.conclusao as 'apto',
          jejum: ingestao.value,
          criteriosLee: form.criteriosLee,
        },
        tela.value.contexto.dataHora,
        'confirmado',
      )
    : null,
);
const pode = computed(() => tela.value?.gravacao.operacoes['apa']?.pode === true);
const pronto = computed(
  () =>
    pode.value &&
    form.tipoAnestesia !== null &&
    (conferencia.value?.recusas.length ?? 1) === 0 &&
    (form.conclusao !== 'apto-ressalvas' || form.ressalvas.trim().length >= 5),
);

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const txt = (v: string) => (v.trim() === '' ? null : v.trim());

async function registrar(): Promise<void> {
  if (!agenda.value || !tela.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await gravarAnestesia(
      `/${agenda.value}/apa`,
      {
        agendamento: agenda.value,
        versao: tela.value.vigente?.versao ?? 0,
        avaliadoEm: form.avaliadoEm,
        asa: form.asa,
        emergencia: form.emergencia,
        pesoKg: num(form.pesoKg),
        alturaCm: num(form.alturaCm),
        viaAerea: {
          mallampati: form.mallampati,
          aberturaBucalCm: num(form.aberturaBucalCm),
          distanciaTireomentonianaCm: num(form.distanciaTireomentonianaCm),
          mobilidadeCervicalReduzida: form.mobilidadeCervicalReduzida,
          protesesOuDentesSoltos: form.protesesOuDentesSoltos,
          historicoViaAereaDificil: form.historicoViaAereaDificil,
        },
        jejum: ingestao.value,
        criteriosLee: form.criteriosLee,
        alergiasConferidas: form.alergiasConferidas,
        comorbidades: txt(form.comorbidades),
        medicacoesEmUso: txt(form.medicacoesEmUso),
        examesConsiderados: txt(form.examesConsiderados),
        anestesiasAnteriores: txt(form.anestesiasAnteriores),
        plano: {
          tipoAnestesia: form.tipoAnestesia,
          tecnica: txt(form.tecnica),
          medicacaoPreAnestesica: txt(form.medicacaoPreAnestesica),
          reservaUti: form.reservaUti,
          reservaHemocomponente: form.reservaHemocomponente,
          orientacoes: txt(form.orientacoes),
        },
        conclusao: form.conclusao,
        ressalvas: txt(form.ressalvas),
      },
      novaChaveAnestesia('apa'),
    );
    mensagem.value = r.mensagem;
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const hora = (x: string) => x.replace('T', ' ').slice(0, 16);
</script>

<template>
  <section class="tela-anest" aria-labelledby="apa-titulo" data-testid="tela-apa">
    <h1 id="apa-titulo">{{ t('anestesia.apa.titulo') }}</h1>
    <EscolhaCirurgia v-if="!agenda" destino="apa" />
    <template v-else>
      <ErroAnestesia v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!tela" role="status">{{ t('anestesia.carregando') }}</p>
      <template v-else>
        <CabecalhoAnestesia :contexto="tela.contexto" />
        <SanteAlerta
          v-if="!tela.gravacao.ligada"
          variante="aviso"
          :texto="tela.gravacao.motivo ?? t('anestesia.emConstrucao')"
        />
        <section v-if="tela.vigente" class="cartao" aria-labelledby="apa-vigente" data-testid="apa-vigente">
          <h2 id="apa-vigente">{{ t('anestesia.apa.vigente', { versao: tela.vigente.versao }) }}</h2>
          <p>
            <strong>{{ tela.vigente.rotuloAsa }}</strong> ·
            {{ CONCLUSOES_APA.find((c) => c.codigo === tela!.vigente!.conclusao)?.rotulo }} ·
            {{
              t('anestesia.apa.classeLee', {
                classe: tela.vigente.lee.classe,
                pontos: tela.vigente.lee.pontos,
              })
            }}
            · {{ hora(tela.vigente.avaliadoEm) }} · {{ tela.vigente.avaliadoPorNome ?? tela.vigente.usuario }}
          </p>
          <p
            v-if="tela.vigente.registroProntuario === null"
            class="secundario"
            data-testid="apa-prontuario-pendente"
          >
            {{ t('anestesia.prontuarioPendente') }}
          </p>
          <p v-if="tela.vigente.fechaPendencia" class="secundario">
            {{ t('anestesia.apa.pendenciaFechada') }}
          </p>
          <details v-if="tela.versoes.length > 1">
            <summary>{{ t('anestesia.apa.versoes') }}</summary>
            <ul>
              <li v-for="v in tela.versoes" :key="v.versao">
                {{ v.versao }} · {{ hora(v.avaliadoEm) }} ·
                {{ CONCLUSOES_APA.find((c) => c.codigo === v.conclusao)?.rotulo }} · {{ v.usuario }}
              </li>
            </ul>
          </details>
        </section>
        <p v-if="mensagem" role="status" data-testid="apa-mensagem">{{ mensagem }}</p>
        <ErroAnestesia v-if="erro" :erro="erro" />

        <form v-if="pode" class="cartao" data-testid="apa-form" @submit.prevent="registrar">
          <h2>{{ tela.vigente ? t('anestesia.apa.retificar') : t('anestesia.apa.nova') }}</h2>
          <fieldset>
            <legend>{{ t('anestesia.apa.estadoFisico') }}</legend>
            <span class="campo">
              <label for="apa-avaliado">{{ t('anestesia.apa.avaliadoEm') }}</label>
              <input
                id="apa-avaliado"
                v-model="form.avaliadoEm"
                type="datetime-local"
                data-testid="apa-avaliado"
              />
            </span>
            <SanteSelecao
              v-model="form.asa"
              :rotulo="t('anestesia.apa.estadoFisico')"
              :opcoes="opcoesAsa"
              data-testid="apa-asa"
            />
            <label class="linha"
              ><input v-model="form.emergencia" type="checkbox" data-testid="apa-emergencia" />
              {{ t('anestesia.apa.emergencia') }}</label
            >
            <span class="campo">
              <label for="apa-peso">{{ t('anestesia.apa.peso') }}</label>
              <input id="apa-peso" v-model="form.pesoKg" inputmode="decimal" />
            </span>
            <span class="campo">
              <label for="apa-altura">{{ t('anestesia.apa.altura') }}</label>
              <input id="apa-altura" v-model="form.alturaCm" inputmode="numeric" />
            </span>
          </fieldset>
          <fieldset>
            <legend>{{ t('anestesia.apa.viaAerea') }}</legend>
            <SanteSelecao
              v-model="form.mallampati"
              :rotulo="t('anestesia.apa.mallampati')"
              :opcoes="opcoesMallampati"
              data-testid="apa-mallampati"
            />
            <span class="campo">
              <label for="apa-abertura">{{ t('anestesia.apa.aberturaBucal') }}</label>
              <input id="apa-abertura" v-model="form.aberturaBucalCm" inputmode="decimal" />
            </span>
            <span class="campo">
              <label for="apa-dtm">{{ t('anestesia.apa.distanciaTireomentoniana') }}</label>
              <input id="apa-dtm" v-model="form.distanciaTireomentonianaCm" inputmode="decimal" />
            </span>
            <label class="linha"
              ><input v-model="form.mobilidadeCervicalReduzida" type="checkbox" />
              {{ t('anestesia.apa.mobilidadeCervicalReduzida') }}</label
            >
            <label class="linha"
              ><input v-model="form.protesesOuDentesSoltos" type="checkbox" />
              {{ t('anestesia.apa.protesesOuDentesSoltos') }}</label
            >
            <label class="linha"
              ><input v-model="form.historicoViaAereaDificil" type="checkbox" />
              {{ t('anestesia.apa.historicoViaAereaDificil') }}</label
            >
          </fieldset>
          <fieldset data-testid="apa-jejum">
            <legend>{{ t('anestesia.apa.jejum') }} · {{ t('anestesia.apa.ultimaIngestao') }}</legend>
            <span v-for="j in jejum" :key="j.tipo" class="campo">
              <label :for="`apa-jejum-${j.tipo}`">{{ t(`anestesia.apa.ingestoes.${j.tipo}`) }}</label>
              <input
                :id="`apa-jejum-${j.tipo}`"
                v-model="form.jejum[j.tipo]"
                type="datetime-local"
                :data-testid="`apa-jejum-${j.tipo}`"
              />
              <span :class="j.suficiente ? 'secundario' : 'alerta'">
                {{
                  j.horas === null
                    ? t('anestesia.apa.naoIngeriu')
                    : t('anestesia.apa.horasDeJejum', { horas: j.horas, minimo: j.minimo })
                }}
                <template v-if="!j.suficiente"> · {{ t('anestesia.apa.jejumInsuficiente') }}</template>
              </span>
            </span>
          </fieldset>
          <fieldset data-testid="apa-lee">
            <legend>
              {{ t('anestesia.apa.riscoCardiaco') }} ·
              {{ t('anestesia.apa.classeLee', { classe: lee.classe, pontos: lee.pontos }) }}
            </legend>
            <label v-for="c in CRITERIOS_LEE" :key="c.codigo" class="linha">
              <input v-model="form.criteriosLee" type="checkbox" :value="c.codigo" /> {{ c.rotulo }}
            </label>
            <p v-if="creatininaAlta" class="alerta">
              {{ t('anestesia.apa.creatininaSugere', { valor: tela.contexto.creatinina }) }}
            </p>
          </fieldset>
          <fieldset>
            <legend>{{ t('anestesia.apa.historia') }}</legend>
            <label class="linha"
              ><input v-model="form.alergiasConferidas" type="checkbox" data-testid="apa-alergias" />
              {{ t('anestesia.apa.alergiasConferidas') }}</label
            >
            <span class="campo"
              ><label for="apa-comorb">{{ t('anestesia.apa.comorbidades') }}</label
              ><textarea id="apa-comorb" v-model="form.comorbidades" maxlength="800" />
            </span>
            <span class="campo"
              ><label for="apa-med">{{ t('anestesia.apa.medicacoesEmUso') }}</label
              ><textarea id="apa-med" v-model="form.medicacoesEmUso" maxlength="800" />
            </span>
            <span class="campo"
              ><label for="apa-exames">{{ t('anestesia.apa.examesConsiderados') }}</label
              ><textarea id="apa-exames" v-model="form.examesConsiderados" maxlength="800" />
            </span>
            <span class="campo"
              ><label for="apa-ant">{{ t('anestesia.apa.anestesiasAnteriores') }}</label
              ><textarea id="apa-ant" v-model="form.anestesiasAnteriores" maxlength="400" />
            </span>
          </fieldset>
          <fieldset>
            <legend>{{ t('anestesia.apa.plano') }}</legend>
            <SanteSelecao
              v-model="form.tipoAnestesia"
              :rotulo="t('anestesia.apa.tipoAnestesia')"
              :opcoes="opcoesTipo"
              :busca="true"
              data-testid="apa-tipo"
            />
            <span class="campo"
              ><label for="apa-tecnica">{{ t('anestesia.apa.tecnica') }}</label
              ><input id="apa-tecnica" v-model="form.tecnica" maxlength="400"
            /></span>
            <span class="campo"
              ><label for="apa-mpa">{{ t('anestesia.apa.medicacaoPreAnestesica') }}</label
              ><input id="apa-mpa" v-model="form.medicacaoPreAnestesica" maxlength="400"
            /></span>
            <label class="linha"
              ><input v-model="form.reservaUti" type="checkbox" /> {{ t('anestesia.apa.reservaUti') }}</label
            >
            <label class="linha"
              ><input v-model="form.reservaHemocomponente" type="checkbox" />
              {{ t('anestesia.apa.reservaHemocomponente') }}</label
            >
            <span class="campo"
              ><label for="apa-orient">{{ t('anestesia.apa.orientacoes') }}</label
              ><textarea id="apa-orient" v-model="form.orientacoes" maxlength="400" />
            </span>
          </fieldset>
          <fieldset>
            <legend>{{ t('anestesia.apa.conclusao') }}</legend>
            <SanteSelecao
              v-model="form.conclusao"
              :rotulo="t('anestesia.apa.conclusao')"
              :opcoes="opcoesConclusao"
              data-testid="apa-conclusao"
            />
            <span v-if="form.conclusao === 'apto-ressalvas'" class="campo">
              <label for="apa-ressalvas">{{ t('anestesia.apa.ressalvas') }}</label>
              <input
                id="apa-ressalvas"
                v-model="form.ressalvas"
                maxlength="400"
                data-testid="apa-ressalvas"
              />
            </span>
          </fieldset>
          <ul v-if="conferencia && conferencia.recusas.length > 0" data-testid="apa-recusas">
            <li v-for="r in conferencia.recusas" :key="r" class="alerta">
              {{ t(`anestesia.recusas.${r}`) }}
            </li>
          </ul>
          <SanteBotao
            tipo="submit"
            :rotulo="t('anestesia.salvar')"
            :desabilitado="!pronto || ocupado"
            data-testid="apa-registrar"
          />
        </form>
        <p v-else-if="tela.gravacao.ligada" class="secundario">
          {{ tela.gravacao.operacoes['apa']?.motivo }}
        </p>
      </template>
    </template>
  </section>
</template>

<style src="./estilo-anestesia.css"></style>
