<script setup lang="ts">
// Obstetrícia e neonatologia (ficha do M45, seção 7; DP-32): `/pep/especialidades/obstetricia/:reg`. O partograma (o
// gráfico da dilatação com as linhas de alerta e de ação a partir do início da fase ativa, a tabela dos registros com os
// alertas) e o registro novo pelo médico ou pela enfermagem; o recém-nascido com o Apgar, o peso, a idade gestacional e
// as classificações. As linhas, os alertas e as classificações vêm do servidor.
import {
  BOLSAS,
  type Bolsa,
  LIQUIDOS_AMNIOTICOS,
  type LiquidoAmniotico,
  SEXOS_RN,
  type SexoRn,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  lerGravacaoEspecialidade,
  lerObstetricia,
  novaChaveEspecialidade,
  registrarPartograma,
  registrarRecemNascido,
} from '../api-especialidades.js';
import AvisoEspecialidade from '../componentes/AvisoEspecialidade.vue';
import CabecalhoInternacao from '../componentes/CabecalhoInternacao.vue';
import ErroEspecialidade from '../componentes/ErroEspecialidade.vue';
import {
  agoraCivil,
  ALTURA_PARTOGRAMA,
  horasEntre,
  instanteCurto,
  LARGURA_PARTOGRAMA,
  numero,
  pontoNoGrafico,
} from '../regras-especialidades.js';

const { t } = useI18n();
const rota = useRoute();
const reg = computed(() => Number(rota.params['reg']));
const gravacao = useQuery({
  queryKey: ['especialidades', 'obstetricia', 'gravacao'],
  queryFn: () => lerGravacaoEspecialidade('obstetricia'),
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['registrar']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['registrar']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const dados = useQuery({
  queryKey: computed(() => ['especialidades', 'obstetricia', reg.value]),
  queryFn: () => lerObstetricia(reg.value),
});

// ── Gráfico ──────────────────────────────────────────────────────────────────────────────────────
const grafico = computed(() => {
  const d = dados.data.value;
  if (!d?.linhas.inicioFaseAtiva) return null;
  const inicio = d.linhas.inicioFaseAtiva.em;
  const linha = (pts: { horas: number; dilatacaoCm: number }[]) =>
    pts.map((p) => pontoNoGrafico(p.horas, p.dilatacaoCm));
  return {
    alerta: linha(d.linhas.alerta),
    acao: linha(d.linhas.acao),
    pontos: d.pontos
      .filter((p) => p.dilatacaoCm !== null && p.em >= inicio)
      .map((p) => ({ id: p.id, ...pontoNoGrafico(horasEntre(inicio, p.em), p.dilatacaoCm ?? 0) })),
  };
});
// O padrão da hora dos registros é o relógio do estabelecimento (o servidor), não o do navegador.
watch(
  () => dados.data.value?.agora,
  (agora) => {
    if (!agora) return;
    if (!p.em) p.em = agora;
    if (!rn.nascimentoEm) rn.nascimentoEm = agora;
  },
  { immediate: true },
);
const marcasHoras = Array.from({ length: 13 }, (_, h) => h);
const marcasCm = Array.from({ length: 11 }, (_, c) => c);

// ── Partograma ───────────────────────────────────────────────────────────────────────────────────
const bolsas = computed(() => [
  { valor: null, rotulo: t('especialidades.naoInformado') },
  ...BOLSAS.map((b) => ({ valor: b, rotulo: t(`especialidades.obstetricia.bolsas.${b}`) })),
]);
const liquidos = computed(() => [
  { valor: null, rotulo: t('especialidades.naoInformado') },
  ...LIQUIDOS_AMNIOTICOS.map((l) => ({ valor: l.codigo, rotulo: l.rotulo })),
]);
const p = reactive({
  em: '',
  dilatacao: '',
  altura: '',
  bcf: '',
  contracoes: '',
  duracao: '',
  paS: '',
  paD: '',
  temperatura: '',
  ocitocina: '',
  observacao: '',
});
const bolsa = ref<Bolsa | null>(null);
const liquido = ref<LiquidoAmniotico | null>(null);
// O v-model dos campos numéricos do navegador devolve número; os de texto, texto.
const num = (s: string | number) => (String(s).trim() === '' ? null : Number(String(s).replace(',', '.')));
const int = (s: string | number) => (String(s).trim() === '' ? null : Math.round(Number(s)));

const erroP = ref<unknown>(null);
const mensagemP = ref<string | null>(null);
const alertasP = ref<string[]>([]);
const ocupado = ref(false);
async function gravarPonto(): Promise<void> {
  erroP.value = null;
  mensagemP.value = null;
  ocupado.value = true;
  try {
    const r = await registrarPartograma(
      {
        internacao: reg.value,
        em: p.em,
        dilatacaoCm: num(p.dilatacao),
        alturaApresentacao: int(p.altura),
        bcf: int(p.bcf),
        contracoes10min: int(p.contracoes),
        duracaoContracaoS: int(p.duracao),
        bolsa: bolsa.value,
        liquido: liquido.value,
        paSistolica: int(p.paS),
        paDiastolica: int(p.paD),
        temperatura: num(p.temperatura),
        ocitocina: num(p.ocitocina),
        ...(p.observacao.trim() ? { observacao: p.observacao.trim() } : {}),
      },
      novaChaveEspecialidade('partograma'),
    );
    mensagemP.value = r.mensagem;
    alertasP.value = r.alertas;
    Object.assign(p, {
      em: dados.data.value?.agora ?? agoraCivil(),
      dilatacao: '',
      altura: '',
      bcf: '',
      contracoes: '',
      duracao: '',
      paS: '',
      paD: '',
      temperatura: '',
      ocitocina: '',
      observacao: '',
    });
    await dados.refetch();
  } catch (x) {
    erroP.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Recém-nascido ────────────────────────────────────────────────────────────────────────────────
const sexos = computed(() =>
  SEXOS_RN.map((s) => ({ valor: s, rotulo: t(`especialidades.obstetricia.sexos.${s}`) })),
);
const tiposParto = computed(() =>
  (dados.data.value?.tiposParto ?? []).map((x) => ({ valor: x.codigo, rotulo: x.nome })),
);
const rn = reactive({
  nascimentoEm: '',
  peso: '',
  comprimento: '',
  pc: '',
  apgar1: '',
  apgar5: '',
  apgar10: '',
  igSemanas: '',
  igDias: '0',
  observacao: '',
});
const sexo = ref<SexoRn>('F');
const tipoParto = ref<number | null>(null);
const reanimacao = ref(false);
const erroR = ref<unknown>(null);
const mensagemR = ref<string | null>(null);
async function gravarRn(): Promise<void> {
  erroR.value = null;
  mensagemR.value = null;
  ocupado.value = true;
  try {
    const r = await registrarRecemNascido(
      {
        internacao: reg.value,
        nascimentoEm: rn.nascimentoEm,
        sexo: sexo.value,
        pesoG: int(rn.peso),
        comprimentoCm: num(rn.comprimento),
        perimetroCefalicoCm: num(rn.pc),
        apgar1: int(rn.apgar1),
        apgar5: int(rn.apgar5),
        apgar10: int(rn.apgar10),
        igSemanas: int(rn.igSemanas),
        igDias: int(rn.igDias) ?? 0,
        tipoParto: tipoParto.value,
        reanimacao: reanimacao.value,
        ...(rn.observacao.trim() ? { observacao: rn.observacao.trim() } : {}),
      },
      novaChaveEspecialidade('rn'),
    );
    mensagemR.value = r.mensagem;
    await dados.refetch();
  } catch (x) {
    erroR.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="esp-titulo" data-testid="tela-obstetricia">
    <ErroEspecialidade v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <template v-else>
      <CabecalhoInternacao
        :internacao="dados.data.value.internacao"
        :titulo="t('especialidades.obstetricia.titulo')"
      />
      <p class="acoes">
        <RouterLink to="/pep/especialidades/obstetricia">{{ t('especialidades.voltar') }}</RouterLink>
      </p>
      <AvisoEspecialidade :motivo="aviso" />
      <section class="painel" aria-labelledby="partograma-titulo">
        <h2 id="partograma-titulo">{{ t('especialidades.obstetricia.partograma') }}</h2>
        <p v-if="dados.data.value.linhas.inicioFaseAtiva" data-testid="partograma-fase-ativa">
          {{
            t('especialidades.obstetricia.faseAtiva', {
              em: instanteCurto(dados.data.value.linhas.inicioFaseAtiva.em),
              cm: numero(dados.data.value.linhas.inicioFaseAtiva.dilatacaoCm),
            })
          }}
        </p>
        <p v-else class="secundario">
          {{ t('especialidades.obstetricia.antesFaseAtiva', { cm: dados.data.value.faseAtivaCm }) }}
        </p>
        <svg
          v-if="grafico"
          class="grafico"
          :viewBox="`-30 -10 ${LARGURA_PARTOGRAMA + 40} ${ALTURA_PARTOGRAMA + 40}`"
          role="img"
          :aria-label="t('especialidades.obstetricia.graficoRotulo')"
          data-testid="partograma-grafico"
        >
          <g stroke="var(--sgh-borda)" stroke-width="1">
            <line
              v-for="h in marcasHoras"
              :key="`h${h}`"
              :x1="pontoNoGrafico(h, 0).x"
              :x2="pontoNoGrafico(h, 0).x"
              y1="0"
              :y2="ALTURA_PARTOGRAMA"
            />
            <line
              v-for="c in marcasCm"
              :key="`c${c}`"
              x1="0"
              :x2="LARGURA_PARTOGRAMA"
              :y1="pontoNoGrafico(0, c).y"
              :y2="pontoNoGrafico(0, c).y"
            />
          </g>
          <g fill="var(--sgh-texto-secundario)" font-size="10">
            <text v-for="c in marcasCm" :key="`tc${c}`" x="-22" :y="pontoNoGrafico(0, c).y + 3">{{ c }}</text>
            <text
              v-for="h in marcasHoras"
              :key="`th${h}`"
              :x="pontoNoGrafico(h, 0).x - 3"
              :y="ALTURA_PARTOGRAMA + 14"
            >
              {{ h }}
            </text>
          </g>
          <polyline
            :points="grafico.alerta.map((q) => `${q.x},${q.y}`).join(' ')"
            fill="none"
            stroke="var(--sgh-aviso)"
            stroke-width="2"
          />
          <polyline
            :points="grafico.acao.map((q) => `${q.x},${q.y}`).join(' ')"
            fill="none"
            stroke="var(--sgh-alerta)"
            stroke-width="2"
            stroke-dasharray="6 4"
          />
          <polyline
            :points="grafico.pontos.map((q) => `${q.x},${q.y}`).join(' ')"
            fill="none"
            stroke="var(--sgh-primaria)"
            stroke-width="2"
          />
          <circle
            v-for="q in grafico.pontos"
            :key="q.id"
            :cx="q.x"
            :cy="q.y"
            r="4"
            fill="var(--sgh-primaria)"
          />
        </svg>
        <p v-if="grafico" class="secundario">{{ t('especialidades.obstetricia.legenda') }}</p>
        <p v-if="dados.data.value.pontos.length === 0">{{ t('especialidades.obstetricia.semRegistros') }}</p>
        <table v-else class="tabela" data-testid="partograma-tabela">
          <caption>
            {{
              t('especialidades.obstetricia.registros')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('especialidades.obstetricia.hora') }}</th>
              <th scope="col">{{ t('especialidades.obstetricia.dilatacao') }}</th>
              <th scope="col">{{ t('especialidades.obstetricia.altura') }}</th>
              <th scope="col">{{ t('especialidades.obstetricia.bcf') }}</th>
              <th scope="col">{{ t('especialidades.obstetricia.contracoes') }}</th>
              <th scope="col">{{ t('especialidades.obstetricia.bolsaLiquido') }}</th>
              <th scope="col">{{ t('especialidades.obstetricia.sinais') }}</th>
              <th scope="col">{{ t('especialidades.obstetricia.alertas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in dados.data.value.pontos" :key="x.id" :data-testid="`partograma-${x.id}`">
              <td>
                {{ instanteCurto(x.em) }}<br /><span class="secundario">{{ x.por }}</span>
              </td>
              <td>{{ x.dilatacaoCm === null ? '-' : `${numero(x.dilatacaoCm)} cm` }}</td>
              <td>{{ x.alturaApresentacao ?? '-' }}</td>
              <td>{{ x.bcf ?? '-' }}</td>
              <td>
                {{ x.contracoes10min ?? '-'
                }}<span v-if="x.duracaoContracaoS !== null">{{
                  t('especialidades.un.duracao', { v: x.duracaoContracaoS })
                }}</span>
              </td>
              <td>
                {{ x.bolsa ? t(`especialidades.obstetricia.bolsas.${x.bolsa}`) : '-' }}
                <span v-if="x.liquido">
                  · {{ LIQUIDOS_AMNIOTICOS.find((l) => l.codigo === x.liquido)?.rotulo }}</span
                >
              </td>
              <td>
                <span v-if="x.paSistolica !== null">{{
                  t('especialidades.un.pa', { s: x.paSistolica, d: x.paDiastolica ?? '-' })
                }}</span>
                <span v-if="x.temperatura !== null">
                  · {{ t('especialidades.un.celsius', { v: numero(x.temperatura) }) }}</span
                >
                <span v-if="x.ocitocina !== null">
                  · {{ t('especialidades.obstetricia.ocitocinaValor', { v: numero(x.ocitocina) }) }}</span
                >
              </td>
              <td>
                <span v-for="a in x.alertas" :key="a" class="alerta-texto">{{ a }} </span>
                <span v-if="x.observacao">{{ x.observacao }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <SanteAlerta
          v-if="mensagemP"
          variante="info"
          :texto="mensagemP"
          anunciar
          data-testid="partograma-mensagem"
        />
        <ul v-if="alertasP.length" class="alertas" data-testid="partograma-alertas">
          <li v-for="a in alertasP" :key="a">{{ a }}</li>
        </ul>
        <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
        <form v-else class="formulario" data-testid="form-partograma" @submit.prevent="gravarPonto">
          <div class="grade">
            <div class="campo">
              <label for="part-em">{{ t('especialidades.obstetricia.hora') }}</label>
              <input id="part-em" v-model="p.em" type="datetime-local" required />
            </div>
            <div class="campo">
              <label for="part-dil">{{ t('especialidades.obstetricia.dilatacaoCm') }}</label>
              <input id="part-dil" v-model="p.dilatacao" type="text" inputmode="decimal" maxlength="4" />
            </div>
            <div class="campo">
              <label for="part-alt">{{ t('especialidades.obstetricia.alturaDeLee') }}</label>
              <input id="part-alt" v-model="p.altura" type="number" min="-3" max="3" />
            </div>
            <div class="campo">
              <label for="part-bcf">{{ t('especialidades.obstetricia.bcfBpm') }}</label>
              <input id="part-bcf" v-model="p.bcf" type="number" min="50" max="220" />
            </div>
            <div class="campo">
              <label for="part-cont">{{ t('especialidades.obstetricia.contracoes10') }}</label>
              <input id="part-cont" v-model="p.contracoes" type="number" min="0" max="10" />
            </div>
            <div class="campo">
              <label for="part-dur">{{ t('especialidades.obstetricia.duracao') }}</label>
              <input id="part-dur" v-model="p.duracao" type="number" min="0" max="180" />
            </div>
            <SanteSelecao v-model="bolsa" :rotulo="t('especialidades.obstetricia.bolsa')" :opcoes="bolsas" />
            <SanteSelecao
              v-model="liquido"
              :rotulo="t('especialidades.obstetricia.liquido')"
              :opcoes="liquidos"
            />
            <div class="campo">
              <label for="part-pas">{{ t('especialidades.obstetricia.paSistolica') }}</label>
              <input id="part-pas" v-model="p.paS" type="number" min="50" max="260" />
            </div>
            <div class="campo">
              <label for="part-pad">{{ t('especialidades.obstetricia.paDiastolica') }}</label>
              <input id="part-pad" v-model="p.paD" type="number" min="20" max="160" />
            </div>
            <div class="campo">
              <label for="part-temp">{{ t('especialidades.obstetricia.temperatura') }}</label>
              <input id="part-temp" v-model="p.temperatura" type="text" inputmode="decimal" maxlength="4" />
            </div>
            <div class="campo">
              <label for="part-oci">{{ t('especialidades.obstetricia.ocitocina') }}</label>
              <input id="part-oci" v-model="p.ocitocina" type="text" inputmode="decimal" maxlength="4" />
            </div>
          </div>
          <SanteCampoTexto v-model="p.observacao" :rotulo="t('especialidades.observacao')" :max-bytes="300" />
          <ErroEspecialidade v-if="erroP" :erro="erroP" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('especialidades.obstetricia.registrarPonto')"
            :desabilitado="ocupado"
            data-testid="partograma-gravar"
          />
        </form>
      </section>
      <section class="painel" aria-labelledby="rn-titulo">
        <h2 id="rn-titulo">{{ t('especialidades.obstetricia.recemNascidos') }}</h2>
        <p v-if="dados.data.value.recemNascidos.length === 0">{{ t('especialidades.obstetricia.semRn') }}</p>
        <article
          v-for="x in dados.data.value.recemNascidos"
          :key="x.id"
          class="registro"
          :data-testid="`rn-${x.id}`"
        >
          <p>
            <strong
              >{{ instanteCurto(x.nascimentoEm) }} · {{ t(`especialidades.obstetricia.sexos.${x.sexo}`) }} ·
              {{ t('especialidades.un.g', { v: x.pesoG }) }}</strong
            >
            · {{ x.tipoParto }}
          </p>
          <p>
            {{
              t('especialidades.obstetricia.apgarLinha', {
                a1: x.apgar1,
                a5: x.apgar5,
                a10: x.apgar10 ?? '-',
              })
            }}
            ·
            {{ t('especialidades.obstetricia.igLinha', { s: x.igSemanas, d: x.igDias }) }}
          </p>
          <p class="secundario">
            {{ x.classificacaoIg }} · {{ x.classificacaoPeso }} · {{ x.classificacaoApgar }}
          </p>
          <p v-if="x.reanimacao" class="alerta-texto">{{ t('especialidades.obstetricia.reanimado') }}</p>
        </article>
        <SanteAlerta v-if="mensagemR" variante="info" :texto="mensagemR" anunciar data-testid="rn-mensagem" />
        <form v-if="pode" class="formulario" data-testid="form-rn" @submit.prevent="gravarRn">
          <div class="grade">
            <div class="campo">
              <label for="rn-nasc">{{ t('especialidades.obstetricia.nascimentoEm') }}</label>
              <input id="rn-nasc" v-model="rn.nascimentoEm" type="datetime-local" required />
            </div>
            <SanteSelecao v-model="sexo" :rotulo="t('especialidades.obstetricia.sexo')" :opcoes="sexos" />
            <div class="campo">
              <label for="rn-peso">{{ t('especialidades.obstetricia.pesoG') }}</label>
              <input id="rn-peso" v-model="rn.peso" type="number" min="300" max="7000" required />
            </div>
            <div class="campo">
              <label for="rn-comp">{{ t('especialidades.obstetricia.comprimento') }}</label>
              <input id="rn-comp" v-model="rn.comprimento" type="text" inputmode="decimal" maxlength="4" />
            </div>
            <div class="campo">
              <label for="rn-pc">{{ t('especialidades.obstetricia.pc') }}</label>
              <input id="rn-pc" v-model="rn.pc" type="text" inputmode="decimal" maxlength="4" />
            </div>
            <div class="campo">
              <label for="rn-a1">{{ t('especialidades.obstetricia.apgar1') }}</label>
              <input id="rn-a1" v-model="rn.apgar1" type="number" min="0" max="10" required />
            </div>
            <div class="campo">
              <label for="rn-a5">{{ t('especialidades.obstetricia.apgar5') }}</label>
              <input id="rn-a5" v-model="rn.apgar5" type="number" min="0" max="10" required />
            </div>
            <div class="campo">
              <label for="rn-a10">{{ t('especialidades.obstetricia.apgar10') }}</label>
              <input id="rn-a10" v-model="rn.apgar10" type="number" min="0" max="10" />
            </div>
            <div class="campo">
              <label for="rn-igs">{{ t('especialidades.obstetricia.igSemanas') }}</label>
              <input id="rn-igs" v-model="rn.igSemanas" type="number" min="20" max="45" required />
            </div>
            <div class="campo">
              <label for="rn-igd">{{ t('especialidades.obstetricia.igDias') }}</label>
              <input id="rn-igd" v-model="rn.igDias" type="number" min="0" max="6" />
            </div>
            <SanteSelecao
              v-model="tipoParto"
              :rotulo="t('especialidades.obstetricia.tipoParto')"
              :opcoes="tiposParto"
              obrigatorio
              data-testid="rn-tipo-parto"
            />
          </div>
          <label class="opcao">
            <input v-model="reanimacao" type="checkbox" />
            {{ t('especialidades.obstetricia.reanimacao') }}
          </label>
          <SanteCampoTexto
            v-model="rn.observacao"
            :rotulo="t('especialidades.observacao')"
            :max-bytes="300"
          />
          <ErroEspecialidade v-if="erroR" :erro="erroR" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('especialidades.obstetricia.registrarRn')"
            :desabilitado="ocupado || tipoParto === null"
            data-testid="rn-gravar"
          />
        </form>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-especialidades.css"></style>
