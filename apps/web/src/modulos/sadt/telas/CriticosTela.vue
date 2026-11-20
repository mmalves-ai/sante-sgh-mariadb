<script setup lang="ts">
// Valor crítico (ficha do M26, seção 7; regra 7): `/sadt/valores-criticos`. O painel dos avisos do dia (o canal de
// eventos avisa cada aviso novo: a liberação feita aqui e a vista pela vigia na liberação do outro sistema), com o
// nível do escalonamento, a comunicação registrada e a ciência dada no prontuário; os indicadores com as parcelas. Abaixo,
// as faixas críticas por elemento (a lista do laboratório aprovada pela diretoria clínica).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';
import {
  CANAL_CRITICOS,
  comunicarAviso,
  gravarValorCritico,
  lerPainelCriticos,
  listarElementos,
  listarValoresCriticos,
  novaChave,
} from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import { hojeLocal, quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const data = ref(hojeLocal());
const { gravacao, apoio, pode } = usarSadt(ref('laboratorio'));
const avisosCanal = usarAvisosAtendimento(CANAL_CRITICOS, () => void painel.refetch());
const painel = useQuery({
  queryKey: computed(() => ['sadt', 'criticos', data.value]),
  queryFn: () => lerPainelCriticos(data.value, data.value),
  refetchInterval: computed(() => avisosCanal.intervalo()),
});
const faixas = useQuery({ queryKey: ['sadt', 'valores-criticos'], queryFn: () => listarValoresCriticos() });
const motivoCritico = computed(() =>
  gravacao.data.value && !gravacao.data.value.critico.ligada ? gravacao.data.value.critico.motivo : null,
);
const podeComunicar = computed(() => pode('critico', 'comunicar'));
const podeEditar = computed(() => pode('critico', 'valorCritico'));
const canais = computed(() =>
  (['painel', 'telefone', 'presencial'] as const).map((c) => ({
    valor: c,
    rotulo: t(`sadt.criticos.canais.${c}`),
  })),
);
const canal = ref<Record<number, 'painel' | 'telefone' | 'presencial'>>({});
const destinatario = ref<Record<number, string>>({});
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function comunicar(id: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await comunicarAviso(
      id,
      { canal: canal.value[id] ?? 'telefone', destinatario: destinatario.value[id] ?? '' },
      novaChave('comunicar'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'criticos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Faixa crítica ───────────────────────────────────────────────────────────────────────────────────
const exame = ref('');
const elemento = ref('');
const abaixo = ref('');
const acima = ref('');
const prazo = ref('30');
const aprovacao = ref('');
const examesLab = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.exames ?? [])
    .filter((e) => e.ato === 15)
    .map((e) => ({ valor: e.codigo, rotulo: e.nome })),
]);
const elementos = useQuery({
  queryKey: computed(() => ['sadt', 'elementos', exame.value]),
  queryFn: () => listarElementos(exame.value),
  enabled: computed(() => exame.value !== ''),
});
const opcoesElementos = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(elementos.data.value ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
]);
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
async function gravarFaixa(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await gravarValorCritico(
      {
        ato: 15,
        exame: exame.value,
        elemento: Number(elemento.value),
        abaixoDe: num(abaixo.value),
        acimaDe: num(acima.value),
        prazoMinutos: Number(prazo.value),
        aprovacao: aprovacao.value,
        ativo: true,
      },
      novaChave('faixa'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'valores-criticos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="criticos-titulo" data-testid="tela-sadt-criticos">
    <h1 id="criticos-titulo">{{ t('sadt.criticos.titulo') }}</h1>
    <p>{{ t('sadt.criticos.texto') }}</p>
    <AvisoSadt :motivo="motivoCritico" />
    <div class="filtros">
      <span class="campo">
        <label for="criticos-data">{{ t('sadt.data') }}</label>
        <input id="criticos-data" v-model="data" type="date" />
      </span>
    </div>
    <ErroSadt v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <template v-else>
      <p data-testid="criticos-indicadores">
        {{
          t('sadt.criticos.noPrazo', { noPrazo: painel.data.value.noPrazo, total: painel.data.value.total })
        }}
        ·
        {{
          painel.data.value.mediaMinutosCiencia !== null
            ? t('sadt.criticos.media', { n: painel.data.value.mediaMinutosCiencia })
            : t('sadt.criticos.semMedia')
        }}
      </p>
      <p v-if="painel.data.value.avisos.length === 0">{{ t('sadt.nenhum') }}</p>
      <div v-for="a in painel.data.value.avisos" :key="a.id" class="painel" :data-testid="`aviso-${a.exame}`">
        <h2>{{ a.elemento }}: {{ a.valor }}</h2>
        <p><PacienteSadt :paciente="a.paciente" /> · {{ t('sadt.atendimento') }} {{ a.atendimento }}</p>
        <p class="secundario">
          {{ t(`sadt.criticos.origem.${a.origem}`) }} · {{ quando(a.liberadoEm) }} · {{ a.nivelRotulo }} ·
          <span :data-testid="`aviso-situacao-${a.exame}`">{{
            t(`sadt.criticos.situacao.${a.situacao}`)
          }}</span>
        </p>
        <p v-if="a.comunicado">
          {{ t('sadt.criticos.comunicado', { por: a.comunicado.por, para: a.comunicado.destinatario }) }}
        </p>
        <p v-if="a.ciencia" data-testid="aviso-ciencia">
          {{ t('sadt.criticos.ciencia', { usuario: a.ciencia.usuario, em: quando(a.ciencia.em) }) }}
        </p>
        <div v-if="podeComunicar && !a.comunicado" class="filtros">
          <SanteSelecao
            :model-value="canal[a.id] ?? 'telefone'"
            @update:model-value="(v: 'painel' | 'telefone' | 'presencial') => (canal[a.id] = v)"
            :rotulo="t('sadt.criticos.canal')"
            :opcoes="canais"
          />
          <span class="campo">
            <label :for="`destinatario-${a.id}`">{{ t('sadt.criticos.destinatario') }}</label>
            <input
              :id="`destinatario-${a.id}`"
              v-model="destinatario[a.id]"
              :data-testid="`aviso-destinatario-${a.exame}`"
            />
          </span>
          <SanteBotao
            :rotulo="t('sadt.criticos.comunicar')"
            :desabilitado="ocupado || (destinatario[a.id] ?? '').trim().length < 3"
            :data-testid="`aviso-comunicar-${a.exame}`"
            @acionar="comunicar(a.id)"
          />
        </div>
      </div>
    </template>

    <section class="painel" aria-labelledby="faixas-titulo">
      <h2 id="faixas-titulo">{{ t('sadt.criticos.faixas') }}</h2>
      <p>{{ t('sadt.criticos.faixasTexto') }}</p>
      <table v-if="(faixas.data.value?.length ?? 0) > 0" class="tabela" data-testid="tabela-faixas">
        <caption>
          {{
            t('sadt.criticos.faixas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('sadt.exame') }}</th>
            <th scope="col">{{ t('sadt.digitacao.elemento') }}</th>
            <th scope="col">{{ t('sadt.criticos.abaixoDe') }}</th>
            <th scope="col">{{ t('sadt.criticos.acimaDe') }}</th>
            <th scope="col">{{ t('sadt.criticos.prazo') }}</th>
            <th scope="col">{{ t('sadt.criticos.aprovacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in faixas.data.value ?? []" :key="f.id">
            <td>{{ f.exameNome }}</td>
            <td>{{ f.elementoNome }}</td>
            <td>{{ f.abaixoDe ?? '—' }}</td>
            <td>{{ f.acimaDe ?? '—' }}</td>
            <td>{{ f.prazoMinutos }}</td>
            <td>{{ f.aprovacao }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="podeEditar" class="filtros">
        <SanteSelecao v-model="exame" :rotulo="t('sadt.exame')" :opcoes="examesLab" />
        <SanteSelecao v-model="elemento" :rotulo="t('sadt.digitacao.elemento')" :opcoes="opcoesElementos" />
        <span class="campo">
          <label for="faixa-abaixo">{{ t('sadt.criticos.abaixoDe') }}</label>
          <input id="faixa-abaixo" v-model="abaixo" inputmode="decimal" />
        </span>
        <span class="campo">
          <label for="faixa-acima">{{ t('sadt.criticos.acimaDe') }}</label>
          <input id="faixa-acima" v-model="acima" inputmode="decimal" />
        </span>
        <span class="campo">
          <label for="faixa-prazo">{{ t('sadt.criticos.prazo') }}</label>
          <input id="faixa-prazo" v-model="prazo" type="number" min="1" max="240" />
        </span>
        <span class="campo">
          <label for="faixa-aprovacao">{{ t('sadt.criticos.aprovacao') }}</label>
          <input id="faixa-aprovacao" v-model="aprovacao" />
        </span>
        <SanteBotao
          :rotulo="t('sadt.criticos.novaFaixa')"
          :desabilitado="ocupado || !exame || elemento === '' || aprovacao.trim().length < 5"
          @acionar="gravarFaixa"
        />
      </div>
    </section>
    <p v-if="mensagem" role="status" data-testid="criticos-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
