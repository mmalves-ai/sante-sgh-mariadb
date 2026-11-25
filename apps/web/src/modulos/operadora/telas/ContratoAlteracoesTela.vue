<script setup lang="ts">
// Aditivos e cancelamento do contrato de plano (08-SGO linha 94, F7, C2-108). Numa tela: acha o contrato pelo número,
// mostra os planos ofertados com a tabela de preço, o período e as vidas; o aditivo (troca, inclusão, exclusão de plano,
// preço, prorrogação, cláusula) é validado na hora com as mesmas regras do domínio que o servidor aplica
// (problemasDoAditivo, efeitoDoAditivo: mostra antes de gravar o que encerra na véspera e o que abre no efeito); assinado
// na hora ou depois. O cancelamento mostra a data de efeito pela regra (RN 412 no individual, aviso de 60 dias e 12 meses
// no coletivo), o crédito ao contratante e avisa quando o motivo não tem a baixa cadastral ligada. Nada se apaga.
import {
  creditoDoCancelamento,
  efeitoDoAditivo,
  problemasDoAditivo,
  SOLICITANTES_CANCELAMENTO,
  TIPOS_ADITIVO,
} from '@sgh/dominio-operadora';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import {
  assinarAditivo,
  buscarContratos,
  type ContratoResumo,
  desistirCancelamento,
  efetivarCancelamento,
  lerAditivos,
  lerCancelamentos,
  lerPainelContrato,
  registrarAditivo,
  solicitarCancelamento,
} from '../api-contrato-alteracoes.js';
import { mensagensContratoAlteracoes } from '../i18n-contrato-alteracoes.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensContratoAlteracoes } });

const podeEditar = computed(() => pode('operadora.beneficiario.editar'));
const fila = useQueryClient();
const hoje = new Date().toISOString().slice(0, 10);
const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

const ROTULO_TIPO: Record<string, string> = {
  troca_plano: 'Troca de plano',
  inclusao_plano: 'Inclusão de plano',
  exclusao_plano: 'Exclusão de plano',
  preco: 'Preço (tabela nova)',
  clausula: 'Cláusula',
  vigencia: 'Prorrogação da vigência',
  renovacao: 'Renovação',
  adequacao_norma: 'Adequação à norma',
  outro: 'Outro',
};
const ROTULO_SOLICITANTE: Record<string, string> = {
  titular: 'Titular',
  contratante: 'Contratante',
  operadora: 'Operadora',
  inadimplencia: 'Falta de pagamento',
  fraude: 'Fraude',
  decisao_judicial: 'Decisão judicial',
  obito: 'Óbito',
};

// ---- busca do contrato ----
const termo = ref('');
const achados = ref<ContratoResumo[] | null>(null);
const contrato = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409, 422].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}
async function buscar(): Promise<void> {
  mensagem.value = recusa.value = erro.value = null;
  try {
    achados.value = await buscarContratos(termo.value.trim());
    if (achados.value.length === 1) contrato.value = achados.value[0]!.id;
  } catch (e) {
    tratar(e);
  }
}

const painel = useQuery({
  queryKey: computed(() => ['operadora', 'contrato', contrato.value, 'painel']),
  queryFn: () => lerPainelContrato(contrato.value!),
  enabled: computed(() => contrato.value !== null),
});
const aditivos = useQuery({
  queryKey: computed(() => ['operadora', 'contrato', contrato.value, 'aditivos']),
  queryFn: () => lerAditivos(contrato.value!),
  enabled: computed(() => contrato.value !== null),
});
const cancelamentos = useQuery({
  queryKey: computed(() => ['operadora', 'contrato', contrato.value, 'cancelamentos']),
  queryFn: () => lerCancelamentos(contrato.value!),
  enabled: computed(() => contrato.value !== null),
});
const recarregar = () => fila.invalidateQueries({ queryKey: ['operadora', 'contrato', contrato.value] });
async function gravar(acao: () => Promise<unknown>, ok: string): Promise<void> {
  mensagem.value = recusa.value = erro.value = null;
  try {
    await acao();
    mensagem.value = ok;
    await recarregar();
  } catch (e) {
    tratar(e);
  }
}

// ---- aditivo ----
const ad = reactive({
  tipo: 'troca_plano',
  efeito: hoje,
  assinarJa: 'sim',
  planoAnterior: '',
  planoNovo: '',
  tabela: '',
  valorNovo: '',
  novaVigenciaFim: '',
  descricao: '',
});
const num = (v: string) => (v === '' ? null : Number(v));
const opcoesTipo = TIPOS_ADITIVO.map((v) => ({ valor: v as string, rotulo: ROTULO_TIPO[v] ?? v }));
const opcoesPlanos = computed(() =>
  (painel.data.value?.planos ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
);
const opcoesOfertados = computed(() =>
  (painel.data.value?.ofertas ?? [])
    .filter((o) => o.fim === null || o.fim >= ad.efeito)
    .map((o) => ({ valor: String(o.plano), rotulo: `${o.nomePlano} (${o.vidas} vidas)` })),
);
const opcoesTabelas = computed(() =>
  (painel.data.value?.tabelas ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
);
const opcoesSimNao = [
  { valor: 'sim', rotulo: 'Assinado hoje' },
  { valor: 'nao', rotulo: 'Rascunho (assinar depois)' },
];
const corpoAditivo = computed(() => ({
  tipo: ad.tipo,
  assinatura: ad.assinarJa === 'sim' ? hoje : null,
  efeito: ad.efeito,
  planoAnterior: num(ad.planoAnterior),
  planoNovo: num(ad.planoNovo),
  valorAnterior: null,
  valorNovo: num(ad.valorNovo.replace(',', '.')),
  novaVigenciaFim: ad.novaVigenciaFim || null,
  descricao: ad.descricao,
  tabelaPreco: num(ad.tabela),
}));
const previa = computed(() => {
  const p = painel.data.value;
  if (!p) return null;
  const ofertas = p.ofertas.map((o) => ({
    id: o.id,
    plano: o.plano,
    tabela: o.tabela,
    inicio: o.inicio,
    fim: o.fim,
  }));
  const vidas = (plano: number) =>
    p.ofertas.filter((o) => o.plano === plano && o.fim === null).reduce((s, o) => s + o.vidas, 0);
  const base = problemasDoAditivo(corpoAditivo.value, {
    inicio: p.contrato.inicio,
    fim: p.contrato.fim,
    situacao: p.contrato.situacao,
  });
  const efeito = efeitoDoAditivo(corpoAditivo.value, ofertas, vidas);
  return { problemas: [...base, ...efeito.problemas], efeito };
});
const nomePlano = (id: number) => painel.data.value?.planos.find((p) => p.id === id)?.nome ?? String(id);
const nomeOferta = (id: number) => {
  const o = painel.data.value?.ofertas.find((x) => x.id === id);
  return o ? `${o.nomePlano} / ${o.nomeTabela}` : String(id);
};
const nomeTabela = (id: number) => painel.data.value?.tabelas.find((t) => t.id === id)?.nome ?? String(id);
const gravarAditivo = () =>
  gravar(() => registrarAditivo(contrato.value!, corpoAditivo.value), 'Aditivo registrado.');

// ---- cancelamento ----
const ca = reactive({
  motivo: '',
  solicitante: 'contratante',
  dataEfeito: '',
  credito: '',
  aviso: '',
  atraso: '',
});
const opcoesSolicitante = SOLICITANTES_CANCELAMENTO.map((v) => ({
  valor: v as string,
  rotulo: ROTULO_SOLICITANTE[v] ?? v,
}));
const opcoesMotivo = computed(() =>
  (painel.data.value?.motivos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
);
const motivoEscolhido = computed(
  () => painel.data.value?.motivos.find((m) => String(m.id) === ca.motivo) ?? null,
);
const credito = computed(() => creditoDoCancelamento(num(ca.credito.replace(',', '.'))));
const gravarCancelamento = () =>
  gravar(
    () =>
      solicitarCancelamento(contrato.value!, {
        motivo: Number(ca.motivo),
        solicitante: ca.solicitante,
        dataEfeito: ca.dataEfeito || null,
        diasAtraso: num(ca.atraso),
        avisoRecebimento: null,
        avisoEntregueEm: ca.aviso || null,
        observacao: null,
        valorCredito: credito.value.valor,
      }),
    'Pedido de cancelamento registrado.',
  );
const motivoDesistencia = ref('');
</script>

<template>
  <main class="tela" data-testid="tela-contrato-alteracoes">
    <h1>{{ t('titulo') }}</h1>
    <form class="busca" @submit.prevent="buscar">
      <SanteCampoTexto id="ctr-numero" v-model="termo" :rotulo="t('numeroContrato')" :max-bytes="30" />
      <SanteBotao
        :rotulo="t('buscar')"
        :desabilitado="!termo.trim()"
        data-testid="ctr-buscar"
        @acionar="buscar"
      />
    </form>
    <ul v-if="achados && achados.length > 1" class="achados" data-testid="ctr-achados">
      <li v-for="a in achados" :key="a.id">
        <SanteBotao
          :rotulo="`${a.numero} (${a.situacao})`"
          variante="secundario"
          @acionar="contrato = a.id"
        />
      </li>
    </ul>
    <p v-else-if="achados && !achados.length" role="status">{{ t('nenhumContrato') }}</p>
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="ctr-mensagem" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="ctr-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />

    <template v-if="painel.data.value">
      <section class="bloco" data-testid="ctr-ofertas" aria-labelledby="ctr-ofertas-t">
        <h2 id="ctr-ofertas-t">
          {{
            t('contratoCabecalho', {
              numero: painel.data.value.contrato.numero,
              situacao: painel.data.value.contrato.situacao,
              inicio: dataBr(painel.data.value.contrato.inicio),
              fim: dataBr(painel.data.value.contrato.fim),
            })
          }}
        </h2>
        <table class="tabela">
          <thead>
            <tr>
              <th>{{ t('plano') }}</th>
              <th>{{ t('tabelaPreco') }}</th>
              <th>{{ t('inicio') }}</th>
              <th>{{ t('fim') }}</th>
              <th>{{ t('vidas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in painel.data.value.ofertas" :key="o.id" :data-testid="`ctr-oferta-${o.id}`">
              <td>{{ o.nomePlano }}</td>
              <td>{{ o.nomeTabela }}</td>
              <td>{{ dataBr(o.inicio) }}</td>
              <td>{{ dataBr(o.fim) }}</td>
              <td>{{ o.vidas }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="bloco" data-testid="ctr-aditivos" aria-labelledby="ctr-aditivos-t">
        <h2 id="ctr-aditivos-t">{{ t('aditivos') }}</h2>
        <table v-if="aditivos.data.value?.length" class="tabela">
          <tbody>
            <tr v-for="a in aditivos.data.value" :key="a.id" :data-testid="`ctr-aditivo-${a.sequencia}`">
              <td>{{ a.sequencia }}</td>
              <td>{{ ROTULO_TIPO[a.tipo] ?? a.tipo }}</td>
              <td>{{ dataBr(a.efeito) }}</td>
              <td>{{ a.situacao }}</td>
              <td>{{ a.descricao }}</td>
              <td>
                <SanteBotao
                  v-if="podeEditar && a.situacao === 'rascunho'"
                  :rotulo="t('assinarHoje')"
                  variante="secundario"
                  :data-testid="`ctr-assinar-${a.sequencia}`"
                  @acionar="gravar(() => assinarAditivo(a.id, hoje), 'Aditivo assinado.')"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="podeEditar" class="campos" data-testid="ctr-aditivo-novo" @submit.prevent="gravarAditivo">
          <SanteSelecao
            v-model="ad.tipo"
            :rotulo="t('tipo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="ctr-ad-tipo"
          />
          <SanteData v-model="ad.efeito" :rotulo="t('efeito')" editavel />
          <SanteSelecao
            v-model="ad.assinarJa"
            :rotulo="t('assinatura')"
            :opcoes="opcoesSimNao"
            data-testid="ctr-ad-assinatura"
          />
          <SanteSelecao
            v-if="['troca_plano', 'exclusao_plano'].includes(ad.tipo)"
            v-model="ad.planoAnterior"
            :rotulo="t('planoQueSai')"
            :opcoes="opcoesOfertados"
            data-testid="ctr-ad-plano-anterior"
          />
          <SanteSelecao
            v-if="['troca_plano', 'inclusao_plano', 'preco'].includes(ad.tipo)"
            v-model="ad.planoNovo"
            :rotulo="ad.tipo === 'preco' ? t('planoTodos') : t('planoQueEntra')"
            :opcoes="ad.tipo === 'preco' ? opcoesOfertados : opcoesPlanos"
            data-testid="ctr-ad-plano-novo"
          />
          <SanteSelecao
            v-if="['troca_plano', 'inclusao_plano', 'preco'].includes(ad.tipo)"
            v-model="ad.tabela"
            :rotulo="t('tabelaPreco')"
            :opcoes="opcoesTabelas"
            data-testid="ctr-ad-tabela"
          />
          <SanteCampoTexto
            v-if="ad.tipo === 'preco'"
            id="ctr-ad-valor"
            v-model="ad.valorNovo"
            :rotulo="t('valorAcordado')"
            :max-bytes="16"
          />
          <SanteData
            v-if="['vigencia', 'renovacao'].includes(ad.tipo)"
            v-model="ad.novaVigenciaFim"
            :rotulo="t('novoFimVigencia')"
            editavel
          />
          <SanteCampoTexto
            id="ctr-ad-descricao"
            v-model="ad.descricao"
            :rotulo="t('alteracaoAcordada')"
            :max-bytes="4000"
          />
          <ul v-if="previa?.problemas.length" class="problemas" data-testid="ctr-ad-problemas">
            <li v-for="p in previa.problemas" :key="p.codigo + p.campo">{{ p.detalhe }}</li>
          </ul>
          <ul v-else-if="previa" class="previa" data-testid="ctr-ad-previa">
            <li v-for="f in previa.efeito.fechar" :key="`f${f.oferta}`">
              {{ t('encerra', { oferta: nomeOferta(f.oferta), data: dataBr(f.fim) }) }}
            </li>
            <li v-for="o in previa.efeito.abrir" :key="`a${o.plano}`">
              {{
                t('abre', { plano: nomePlano(o.plano), tabela: nomeTabela(o.tabela), data: dataBr(o.inicio) })
              }}
            </li>
            <li v-if="previa.efeito.mover">{{ t('moverBeneficiarios') }}</li>
          </ul>
          <SanteBotao
            :rotulo="t('registrarAditivo')"
            :desabilitado="!previa || previa.problemas.length > 0"
            data-testid="ctr-ad-gravar"
            @acionar="gravarAditivo"
          />
        </form>
      </section>

      <section class="bloco" data-testid="ctr-cancelamentos" aria-labelledby="ctr-cancel-t">
        <h2 id="ctr-cancel-t">{{ t('cancelamento') }}</h2>
        <table v-if="cancelamentos.data.value?.length" class="tabela">
          <tbody>
            <tr v-for="k in cancelamentos.data.value" :key="k.id" :data-testid="`ctr-cancel-${k.protocolo}`">
              <td>{{ k.protocolo }}</td>
              <td>{{ ROTULO_SOLICITANTE[k.solicitante] ?? k.solicitante }}</td>
              <td>{{ dataBr(k.dataEfeito) }}</td>
              <td>{{ k.situacao }}</td>
              <td v-if="podeEditar && ['solicitado', 'agendado'].includes(k.situacao)">
                <SanteBotao
                  :rotulo="t('efetivar')"
                  :desabilitado="k.dataEfeito > hoje"
                  data-testid="ctr-cancel-efetivar"
                  @acionar="
                    gravar(
                      () => efetivarCancelamento(k.id),
                      'Cancelamento efetivado: beneficiários baixados.',
                    )
                  "
                />
                <SanteCampoTexto
                  id="ctr-desist-motivo"
                  v-model="motivoDesistencia"
                  :rotulo="t('motivoDesistencia')"
                  :max-bytes="500"
                />
                <SanteBotao
                  :rotulo="t('desistir')"
                  variante="secundario"
                  :desabilitado="!motivoDesistencia.trim()"
                  data-testid="ctr-cancel-desistir"
                  @acionar="
                    gravar(() => desistirCancelamento(k.id, motivoDesistencia), 'Desistência registrada.')
                  "
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="podeEditar && ['ativo', 'suspenso'].includes(painel.data.value.contrato.situacao)"
          class="campos"
          data-testid="ctr-cancel-novo"
          @submit.prevent="gravarCancelamento"
        >
          <SanteSelecao
            v-model="ca.motivo"
            :rotulo="t('motivo')"
            :opcoes="opcoesMotivo"
            obrigatorio
            data-testid="ctr-ca-motivo"
          />
          <SanteSelecao
            v-model="ca.solicitante"
            :rotulo="t('solicitante')"
            :opcoes="opcoesSolicitante"
            data-testid="ctr-ca-solicitante"
          />
          <SanteData v-model="ca.dataEfeito" :rotulo="t('efeitoCancelamento')" editavel />
          <SanteCampoTexto
            id="ctr-ca-credito"
            v-model="ca.credito"
            :rotulo="t('creditoContratante')"
            :max-bytes="16"
          />
          <template v-if="motivoEscolhido?.exigeNotificacao || ca.solicitante === 'inadimplencia'">
            <SanteCampoTexto
              id="ctr-ca-atraso"
              v-model="ca.atraso"
              :rotulo="t('diasAtraso')"
              :max-bytes="4"
            />
            <SanteData v-model="ca.aviso" :rotulo="t('notificacaoEntregue')" editavel />
          </template>
          <SanteAlerta
            v-if="motivoEscolhido && !motivoEscolhido.temBaixa"
            :texto="t('semBaixa')"
            variante="aviso"
            data-testid="ctr-ca-sem-baixa"
          />
          <SanteAlerta v-if="credito.problema" :texto="credito.problema.detalhe" variante="alerta" />
          <SanteBotao
            :rotulo="t('pedirCancelamento')"
            :desabilitado="!ca.motivo || !!credito.problema"
            data-testid="ctr-ca-gravar"
            @acionar="gravarCancelamento"
          />
        </form>
      </section>
    </template>
  </main>
</template>

<style scoped>
.tela {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}
.busca,
.campos {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.tabela {
  width: 100%;
  border-collapse: collapse;
}
</style>
