<script setup lang="ts">
// Pacientes internados (ficha do M21, seção 7): `/internacao`. A lista das internações pela situação — os internados
// agora (leito, convênio, dias, a alta médica decidida), as com alta no período ou todas — com as telas de cada
// internação (guias, trocas, procedimentos, alta, impressos); o item do menu chega com `?acao=` e a tela destaca a ação
// pedida (e já busca também as com alta: o cancelamento da alta e as consultas depois da saída). A conferência para o
// SAME e a coordenação de leitos traz as contagens e a lista (registro, prontuário e datas, com o link da internação).
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { pode as podeNaSessao } from '../../../casca/sessao/pode.js';
import { dataBr } from '../../agenda/formato.js';
import { lerIncoerencias, listarInternacoes, type SituacaoInternacoes } from '../api-adt.js';
import ErroAdt from '../componentes/ErroAdt.vue';
import { leitoTexto } from '../regras-tela.js';

const { t } = useI18n();
const rota = useRoute();
// C1-074: atalho para os gases medicinais do paciente (registro da enfermagem).
const podeGases = computed(() => podeNaSessao('enfermagem.horario.ler'));
const ACOES = ['guias', 'trocas', 'procedimentos', 'alta', 'impressos'] as const;
const acaoDaRota = computed(() => {
  const a = rota.query['acao'];
  return typeof a === 'string' && (ACOES as readonly string[]).includes(a) ? a : null;
});
const busca = ref('');
const termo = ref('');
// Com a ação do menu (alta, guias, impressos…), a lista já inclui as internações com alta no período.
const situacao = ref<SituacaoInternacoes>(acaoDaRota.value ? 'todas' : 'internados');
const altaDe = ref<string | null>(null);
const altaAte = ref<string | null>(null);
const situacoes = computed(() =>
  (['internados', 'alta', 'todas'] as const).map((v) => ({ valor: v, rotulo: t(`adt.lista.situacao.${v}`) })),
);
const lista = useQuery({
  queryKey: computed(() => ['adt', 'internados', termo.value, situacao.value, altaDe.value, altaAte.value]),
  queryFn: () =>
    listarInternacoes({
      termo: termo.value,
      situacao: situacao.value,
      altaDe: altaDe.value,
      altaAte: altaAte.value,
    }),
});
const podeAdmitir = podeNaSessao('internacao.internacao.criar');
const incoerencias = useQuery({ queryKey: ['adt', 'incoerencias'], queryFn: () => lerIncoerencias() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="internados-titulo" data-testid="tela-internados">
    <h1 id="internados-titulo">{{ t('adt.lista.titulo') }}</h1>
    <p>{{ t('adt.lista.texto') }}</p>
    <p v-if="acaoDaRota" class="secundario" data-testid="internados-acao">
      {{ t('adt.lista.escolhaPara', { acao: t(`adt.acoes.${acaoDaRota}`) }) }}
    </p>
    <p class="acoes">
      <RouterLink v-if="podeAdmitir" to="/internacao/admissao">{{ t('adt.lista.admitir') }}</RouterLink>
      <RouterLink to="/internacao/pre">{{ t('adt.lista.pre') }}</RouterLink>
      <RouterLink to="/leitos/mapa">{{ t('adt.lista.mapa') }}</RouterLink>
    </p>
    <form class="filtros" role="search" @submit.prevent="termo = busca.trim()">
      <SanteCampoTexto
        v-model="busca"
        :rotulo="t('adt.lista.termo')"
        :max-bytes="60"
        data-testid="internados-termo"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('adt.lista.situacaoRotulo')"
        :opcoes="situacoes"
        data-testid="internados-situacao"
      />
      <template v-if="situacao !== 'internados'">
        <SanteData v-model="altaDe" :rotulo="t('adt.lista.altaDe')" editavel />
        <SanteData v-model="altaAte" :rotulo="t('adt.lista.altaAte')" editavel />
      </template>
      <SanteBotao tipo="submit" :rotulo="t('adt.buscar')" data-testid="internados-buscar" />
    </form>
    <p v-if="situacao !== 'internados'" class="secundario">{{ t('adt.lista.periodoPadrao') }}</p>
    <ErroAdt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.itens.length === 0">{{ t('adt.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-internados">
        <caption class="secundario">
          {{
            t('adt.lista.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.internacao') }}</th>
            <th scope="col">{{ t('adt.paciente') }}</th>
            <th scope="col">{{ t('adt.leito') }}</th>
            <th scope="col">{{ t('adt.convenio') }}</th>
            <th scope="col">{{ t('adt.entrada') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in lista.data.value.itens" :key="i.reg" :data-testid="`internado-${i.reg}`">
            <td>{{ i.reg }}</td>
            <td>
              {{ i.nome }} <span class="secundario">· {{ t('adt.prontuario', { n: i.prontuario }) }}</span>
              <span v-if="i.altaMedica" class="selo" data-testid="selo-alta-medica">{{
                t('adt.lista.altaMedica')
              }}</span>
            </td>
            <td>{{ leitoTexto(i.leito) }}</td>
            <td>{{ i.convenio.nome }}</td>
            <td>
              {{ dataBr(i.entrada) }} · {{ t('adt.dias', { n: i.diasInternacao }) }}
              <span v-if="i.alta" class="selo" :data-testid="`selo-alta-${i.reg}`">{{
                t('adt.lista.comAlta', { data: dataBr(i.alta) })
              }}</span>
            </td>
            <td class="acoes">
              <RouterLink
                v-for="a in ACOES"
                :key="a"
                :to="`/internacao/${i.reg}/${a}`"
                :class="{ destaque: acaoDaRota === a }"
                :aria-label="t('adt.lista.acaoDe', { acao: t(`adt.acoes.${a}`), reg: i.reg })"
                :data-testid="`int-${a}-${i.reg}`"
                >{{ t(`adt.acoes.${a}`) }}</RouterLink
              >
              <RouterLink
                v-if="podeGases"
                :to="`/internacao/${i.reg}/gases`"
                :aria-label="t('adt.gases.abrirDe', { reg: i.reg })"
                :data-testid="`int-gases-${i.reg}`"
                >{{ t('adt.gases.abrir') }}</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="lista.data.value.cortada" class="secundario">{{ t('adt.cortada') }}</p>
    </template>
    <section v-if="incoerencias.data.value" class="painel" aria-labelledby="internados-conf">
      <h2 id="internados-conf">{{ t('adt.lista.incoerencias') }}</h2>
      <ul class="cartoes" data-testid="incoerencias">
        <li>{{ t('adt.lista.altaAntes', { n: incoerencias.data.value.altaAntesDaEntrada.length }) }}</li>
        <li>
          {{
            t('adt.lista.leitosCadastro', {
              a: incoerencias.data.value.leitosCadastro,
              b: incoerencias.data.value.leitosEspelho,
            })
          }}
        </li>
        <li>{{ t('adt.lista.semTrecho', { n: incoerencias.data.value.internadosSemTrechoAberto }) }}</li>
      </ul>
      <template
        v-for="grupo in [
          { chave: 'altaAntes', itens: incoerencias.data.value.listaAltaAntes },
          { chave: 'semTrechoLista', itens: incoerencias.data.value.listaSemTrecho },
        ]"
        :key="grupo.chave"
      >
        <table v-if="grupo.itens.length > 0" class="tabela" :data-testid="`incoerencias-${grupo.chave}`">
          <caption class="secundario">
            {{
              t(`adt.lista.titulos.${grupo.chave}`)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('adt.internacao') }}</th>
              <th scope="col">{{ t('adt.lista.prontuarioColuna') }}</th>
              <th scope="col">{{ t('adt.entrada') }}</th>
              <th scope="col">{{ t('adt.saida') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in grupo.itens" :key="x.reg">
              <td>
                <RouterLink :to="`/internacao/${x.reg}/alta`">{{ x.reg }}</RouterLink>
              </td>
              <td>{{ x.prontuario }}</td>
              <td>{{ dataBr(x.entrada) }} {{ x.horaEntrada.slice(0, 2) }}:{{ x.horaEntrada.slice(2, 4) }}</td>
              <td>
                <template v-if="x.alta">
                  {{ dataBr(x.alta) }} {{ (x.horaSaida ?? '').slice(0, 2) }}:{{
                    (x.horaSaida ?? '').slice(2, 4)
                  }}
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.destaque {
  font-weight: 700;
}
.selo {
  margin-left: var(--sgh-espaco-1);
  font-weight: 600;
}
</style>
