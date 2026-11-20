<script setup lang="ts">
// Atendimento ao beneficiário com protocolo (M56, etapa 8, F7; na tela `Atendimento, autorização e protocolos`;
// `operadora.protocolo.ler` / `.registrar`): as contagens (abertos, em análise, vencidos, escrita pendente, respondidos
// hoje), a consulta pelo número (atendimento ou autorização), a lista (busca, situação, instância, natureza, só os
// atrasados, páginas), o registro com o número e o prazo e a ficha com as ações. A fatia nasce desligada (POL-3): o
// motivo aparece e nada da operadora é lido.
import {
  type ConsultaProtocolo,
  INSTANCIAS_PROTOCOLO,
  NATUREZAS_PROTOCOLO,
  type ProtocoloOpeResumo,
  type ResultadoProtocoloOpe,
  SITUACOES_PROTOCOLO_OPE,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { consultarProtocolo, lerApoioProtocolos, lerProtocolos } from '../../api-atendimento.js';
import FichaProtocolo from './FichaProtocolo.vue';
import RegistroProtocolo from './RegistroProtocolo.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({
  queryKey: ['operadora', 'protocolos', 'apoio'],
  queryFn: () => lerApoioProtocolos(),
});
const ligada = computed(() => apoio.data.value?.ligada === true);
const podeRegistrar = computed(() => apoio.data.value?.podeRegistrar === true);

const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: string) => `${data(d)} ${d.slice(11, 16)}`.trim();

// ── Lista ───────────────────────────────────────────────────────────────────────────────────────
type Filtro = {
  busca: string;
  situacao: (typeof SITUACOES_PROTOCOLO_OPE)[number] | null;
  instancia: (typeof INSTANCIAS_PROTOCOLO)[number] | null;
  natureza: (typeof NATUREZAS_PROTOCOLO)[number] | null;
  vencidos: boolean;
};
const vazio = (): Filtro => ({ busca: '', situacao: null, instancia: null, natureza: null, vencidos: false });
const filtro = ref<Filtro>(vazio());
const aplicado = ref<Filtro>(vazio());
const cursores = ref<(number | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'protocolos', 'lista', aplicado.value, cursor.value]),
  queryFn: () =>
    lerProtocolos({ ...aplicado.value, busca: aplicado.value.busca || null, apos: cursor.value }),
  enabled: ligada,
});
function filtrar(): void {
  aplicado.value = { ...filtro.value, busca: filtro.value.busca.trim() };
  cursores.value = [null];
}
function proxima(): void {
  const p = lista.data.value?.proxima;
  if (p) cursores.value = [...cursores.value, p];
}
function anterior(): void {
  if (cursores.value.length > 1) cursores.value = cursores.value.slice(0, -1);
}
const todas = () => ({ valor: null, rotulo: t('operadoraAtendimento.filtro.todas') });
const opcoesSituacao = computed(() => [
  todas(),
  ...SITUACOES_PROTOCOLO_OPE.map((s) => ({ valor: s, rotulo: t(`operadoraAtendimento.situacoes.${s}`) })),
]);
const opcoesInstancia = computed(() => [
  todas(),
  ...INSTANCIAS_PROTOCOLO.map((s) => ({ valor: s, rotulo: t(`operadoraAtendimento.instancias.${s}`) })),
]);
const opcoesNatureza = computed(() => [
  todas(),
  ...NATUREZAS_PROTOCOLO.map((s) => ({ valor: s, rotulo: t(`operadoraAtendimento.naturezas.${s}`) })),
]);

// ── Consulta pelo número ────────────────────────────────────────────────────────────────────────
const numero = ref('');
const achado = ref<ConsultaProtocolo | null>(null);
const recusaConsulta = ref<string | null>(null);
const erroConsulta = ref<unknown>(null);
async function consultar(): Promise<void> {
  achado.value = null;
  recusaConsulta.value = null;
  erroConsulta.value = null;
  try {
    achado.value = await consultarProtocolo(numero.value.trim());
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 404].includes(e.status))
      recusaConsulta.value = e.problema.detail;
    else erroConsulta.value = e;
  }
}

// ── Registro e ficha ─────────────────────────────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const registrando = ref(false);
async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['operadora', 'protocolos', 'lista'] });
}
async function gravado(r: ResultadoProtocoloOpe): Promise<void> {
  registrando.value = false;
  mensagem.value = r.mensagem;
  aberto.value = r.id;
  await recarregar();
}
function abrir(p: Pick<ProtocoloOpeResumo, 'id'>): void {
  mensagem.value = null;
  aberto.value = p.id;
}
</script>

<template>
  <section class="bloco" aria-labelledby="prot-titulo" data-testid="operadora-protocolos">
    <h2 id="prot-titulo">{{ t('operadoraAtendimento.titulo') }}</h2>
    <p>{{ t('operadoraAtendimento.texto') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!apoio.data.value" role="status">{{ t('operadoraAtendimento.carregando') }}</p>
    <div v-else-if="!ligada" data-testid="prot-desligada">
      <SanteAlerta :texto="apoio.data.value.motivo ?? t('operadoraAtendimento.desligada')" variante="info" />
    </div>

    <template v-if="apoio.data.value && ligada">
      <p v-if="mensagem" role="status" data-testid="prot-mensagem">{{ mensagem }}</p>
      <dl v-if="lista.data.value" class="totais" data-testid="prot-totais">
        <div v-for="(v, k) in lista.data.value.totais" :key="k" :data-testid="`prot-total-${k}`">
          <dt>{{ t(`operadoraAtendimento.totais.${k}`) }}</dt>
          <dd>{{ v }}</dd>
        </div>
      </dl>

      <form class="campos" data-testid="prot-consulta" @submit.prevent="consultar">
        <SanteCampoTexto
          id="prot-consulta-numero"
          v-model="numero"
          :rotulo="t('operadoraAtendimento.consulta.numero')"
          :max-bytes="20"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('operadoraAtendimento.consulta.consultar')"
          :desabilitado="!/^\d{20}$/.test(numero.trim())"
          data-testid="prot-consultar"
        />
      </form>
      <div v-if="recusaConsulta" role="alert"><SanteAlerta :texto="recusaConsulta" variante="aviso" /></div>
      <MensagemErro v-if="erroConsulta" :erro="erroConsulta" />
      <p v-if="achado" role="status" data-testid="prot-consulta-resultado">
        {{
          t('operadoraAtendimento.consulta.resultado', {
            tipo: t(`operadoraAtendimento.consulta.${achado.tipo}`),
            protocolo: achado.protocolo,
            situacao: achado.situacaoRotulo,
            aberto: quando(achado.abertoEm),
            prazo: quando(achado.prazoEm),
          })
        }}
        <template v-if="achado.vencido"> {{ t('operadoraAtendimento.consulta.vencido') }}</template>
        <SanteBotao
          v-if="achado.tipo === 'atendimento'"
          variante="texto"
          :rotulo="t('operadoraAtendimento.abrir')"
          data-testid="prot-consulta-abrir"
          @acionar="abrir(achado)"
        />
      </p>

      <form class="campos" data-testid="prot-filtro" @submit.prevent="filtrar">
        <SanteCampoTexto
          id="prot-busca"
          v-model="filtro.busca"
          :rotulo="t('operadoraAtendimento.filtro.busca')"
          :max-bytes="60"
        />
        <SanteSelecao
          v-model="filtro.situacao"
          :rotulo="t('operadoraAtendimento.filtro.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="prot-filtro-situacao"
        />
        <SanteSelecao
          v-model="filtro.instancia"
          :rotulo="t('operadoraAtendimento.filtro.instancia')"
          :opcoes="opcoesInstancia"
          data-testid="prot-filtro-instancia"
        />
        <SanteSelecao
          v-model="filtro.natureza"
          :rotulo="t('operadoraAtendimento.filtro.natureza')"
          :opcoes="opcoesNatureza"
          data-testid="prot-filtro-natureza"
        />
        <label class="marcar"
          ><input v-model="filtro.vencidos" type="checkbox" data-testid="prot-filtro-vencidos" />
          {{ t('operadoraAtendimento.filtro.vencidos') }}</label
        >
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('operadoraAtendimento.filtro.buscar')"
            data-testid="prot-buscar"
          />
          <SanteBotao
            v-if="podeRegistrar"
            variante="secundario"
            :rotulo="t('operadoraAtendimento.novo')"
            data-testid="prot-novo"
            @acionar="registrando = true"
          />
        </div>
      </form>

      <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('operadoraAtendimento.carregando') }}</p>
      <p v-else-if="!lista.data.value.itens.length" data-testid="prot-nenhum">
        {{ t('operadoraAtendimento.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="prot-lista">
        <caption class="visualmente-oculto">
          {{
            t('operadoraAtendimento.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraAtendimento.colunas.protocolo') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.colunas.instancia') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.colunas.beneficiario') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.colunas.assunto') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.colunas.situacao') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.colunas.prazo') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`prot-linha-${p.id}`">
            <td>{{ p.protocolo }}</td>
            <td>
              {{ t(`operadoraAtendimento.instancias.${p.instancia}`) }}<br /><span class="secundario">{{
                t(`operadoraAtendimento.naturezas.${p.natureza}`)
              }}</span>
            </td>
            <td>
              {{ p.beneficiarioNome ?? t('operadoraAtendimento.semBeneficiario') }}
              <span v-if="p.carteirinha" class="secundario"><br />{{ p.carteirinha }}</span>
            </td>
            <td>{{ p.assunto }}</td>
            <td>
              {{ t(`operadoraAtendimento.situacoes.${p.situacao}`) }}
              <span v-if="p.escritaVencida" class="alerta">
                · {{ t('operadoraAtendimento.escritaVencida') }}</span
              >
              <span v-else-if="p.escritaPendente" class="secundario">
                · {{ t('operadoraAtendimento.escritaPendente') }}</span
              >
            </td>
            <td>
              {{ quando(p.prazoEm) }}
              <span v-if="p.vencido" class="alerta"> · {{ t('operadoraAtendimento.vencido') }}</span>
            </td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('operadoraAtendimento.abrir')"
                :data-testid="`prot-abrir-${p.id}`"
                @acionar="abrir(p)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="lista.data.value" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAtendimento.filtro.anterior')"
          :desabilitado="cursores.length <= 1"
          @acionar="anterior"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraAtendimento.filtro.proxima')"
          :desabilitado="!lista.data.value.proxima"
          @acionar="proxima"
        />
      </div>

      <FichaProtocolo
        v-if="aberto !== null"
        :id="aberto"
        :key="aberto"
        :apoio="apoio.data.value"
        :pode-registrar="podeRegistrar"
        @gravado="(r) => ((mensagem = r.mensagem), recarregar())"
        @abrir="(id) => (aberto = id)"
        @fechar="aberto = null"
      />
    </template>

    <SanteDialogo
      v-model:visivel="registrando"
      :titulo="t('operadoraAtendimento.form.titulo')"
      largura="56rem"
    >
      <RegistroProtocolo
        v-if="registrando && apoio.data.value"
        :apoio="apoio.data.value"
        @gravado="gravado"
        @cancelar="registrando = false"
      />
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.totais {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.totais div {
  display: grid;
  gap: 0.125rem;
}
.totais dd {
  font-size: 1.5rem;
  margin: 0;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
.alerta {
  font-weight: 600;
}
</style>
