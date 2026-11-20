<script setup lang="ts">
// OPME: solicitações e autorizações (M46, etapa 3; ficha, seção 7; regra 6; operações suprimentos.solicitarOpme e
// suprimentos.avancarEtapaOpme). Duas abas: "Solicitar para a cirurgia" (a cirurgia do dia, o item de OPME do
// cadastro, o TUSS, a quantidade, o fornecedor e a justificativa) e "Acompanhar e autorizar" (as solicitações do
// período com a situação; o histórico das etapas e a etapa seguinte: cotação, autorização da operadora com a senha e a
// guia, negativa, pedido, consignação, esterilização, nota fiscal e cancelamento). O servidor confere tudo de novo.
import { ETAPAS_OPME, type EtapaManualOpme, type ItemOpme, type SolicitacaoOpme } from '@sgh/contratos';
import { ETAPAS_POR_SITUACAO } from '@sgh/dominio-suprimentos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  avancarEtapaOpme,
  buscarItensOpme,
  type CirurgiaOpme,
  lerCirurgiasOpme,
  lerSolicitacoesOpme,
  solicitarOpme,
} from '../api-opme.js';
import BuscaFornecedorOpme from '../componentes/BuscaFornecedorOpme.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import './estilo-opme.css';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const aba = ref<'solicitar' | 'acompanhar'>(rota.query['aba'] === 'autorizacao' ? 'acompanhar' : 'solicitar');
watch(
  () => rota.query['aba'],
  (a) => {
    aba.value = a === 'autorizacao' ? 'acompanhar' : 'solicitar';
  },
);
const trocar = (a: 'solicitar' | 'acompanhar') =>
  router.replace({ query: a === 'acompanhar' ? { aba: 'autorizacao' } : {} });

const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hora = (x: string) => x.slice(11, 16);
const diaHora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const erro = ref<unknown>(null);
const mensagem = ref('');
const enviando = ref(false);

// ── Solicitar ────────────────────────────────────────────────────────────────────────────────────────────────

const dia = ref('');
const cirurgias = useQuery({
  queryKey: computed(() => ['opme', 'cirurgias', dia.value]),
  queryFn: () => lerCirurgiasOpme(dia.value || null),
  enabled: computed(() => aba.value === 'solicitar'),
});
const cirurgia = ref<CirurgiaOpme | null>(null);
const termo = ref('');
const itens = ref<ItemOpme[] | null>(null);
const form = reactive({
  item: 0,
  tuss: '',
  quantidade: 1,
  fornecedor: null as number | null,
  justificativa: '',
});
// O local do bloco: o sugerido pelo servidor (o primeiro com saldo de OPME), trocável; a busca dos itens usa este local.
const local = ref<number | null>(null);
watch(
  () => cirurgias.data.value?.localSugerido,
  (l) => {
    if (local.value === null && l !== undefined) local.value = l;
  },
  { immediate: true },
);
const opcoesLocal = computed(() =>
  (cirurgias.data.value?.locais ?? []).map((l) => ({ valor: l.codigo as number | null, rotulo: l.nome })),
);
watch(local, () => {
  itens.value = null;
  form.item = 0;
});
const podeSolicitar = computed(() => cirurgias.data.value?.gravacao.operacoes['solicitar']?.pode === true);

async function buscar(): Promise<void> {
  erro.value = null;
  try {
    itens.value = (await buscarItensOpme(termo.value.trim(), local.value)).itens;
  } catch (e) {
    erro.value = e;
  }
}

async function solicitar(): Promise<void> {
  if (!cirurgia.value) return;
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    const r = await solicitarOpme({
      agendamento: cirurgia.value.agendamento,
      item: form.item,
      tuss: form.tuss.trim(),
      quantidade: Number(form.quantidade),
      fornecedor: form.fornecedor,
      justificativa: form.justificativa.trim(),
    });
    mensagem.value = r.mensagem;
    Object.assign(form, { item: 0, tuss: '', quantidade: 1, fornecedor: null, justificativa: '' });
    itens.value = null;
    await cirurgias.refetch();
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}

// ── Acompanhar e autorizar ───────────────────────────────────────────────────────────────────────────────────

const hoje = new Date().toISOString().slice(0, 10);
const de = ref(hoje);
const ate = ref(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
const lista = useQuery({
  queryKey: computed(() => ['opme', 'solicitacoes', de.value, ate.value]),
  queryFn: () => lerSolicitacoesOpme(de.value || null, ate.value || null),
  enabled: computed(() => aba.value === 'acompanhar'),
});
const aberta = ref<number | null>(null);
const sol = computed<SolicitacaoOpme | null>(
  () => lista.data.value?.solicitacoes.find((s) => s.id === aberta.value) ?? null,
);
const pode = (op: string) => lista.data.value?.gravacao.operacoes[op]?.pode === true;
const etapasDisponiveis = computed(() => {
  const s = sol.value;
  if (!s) return [];
  const manuais = ETAPAS_OPME.filter((e) => e.manual).map((e) => e.codigo) as EtapaManualOpme[];
  return manuais.filter(
    (e) =>
      ETAPAS_POR_SITUACAO[s.situacao].includes(e) &&
      (e === 'autorizacao' || e === 'negativa' ? pode('autorizar') : pode('avancar')),
  );
});
const opcoesEtapa = computed(() => [
  { valor: '' as EtapaManualOpme | '', rotulo: '—', desabilitada: true },
  ...etapasDisponiveis.value.map((e) => ({
    valor: e as EtapaManualOpme | '',
    rotulo: t(`opme.etapas.${e}`),
  })),
]);
const etapa = reactive({
  etapa: '' as EtapaManualOpme | '',
  em: agoraLocal(),
  quantidade: 1,
  senha: '',
  guia: '',
  validade: '',
  fornecedor: null as number | null,
  pedidoAno: new Date().getFullYear(),
  pedidoDoc: '',
  nfAno: new Date().getFullYear(),
  nfMes: new Date().getMonth() + 1,
  nfDoc: '',
  observacao: '',
});
watch(sol, (s) => {
  etapa.etapa = '';
  etapa.quantidade = s?.quantidade ?? 1;
});

async function registrarEtapa(): Promise<void> {
  const s = sol.value;
  if (!s || !etapa.etapa) return;
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  const e = etapa.etapa;
  try {
    const r = await avancarEtapaOpme(s.id, {
      versaoVista: s.versao,
      etapa: e,
      em: etapa.em,
      quantidade: e === 'autorizacao' ? Number(etapa.quantidade) : null,
      senha: e === 'autorizacao' ? etapa.senha.trim() || null : null,
      guia: e === 'autorizacao' ? etapa.guia.trim() || null : null,
      validade: e === 'autorizacao' && etapa.validade ? etapa.validade : null,
      fornecedor: e === 'consignacao' ? etapa.fornecedor : null,
      pedido:
        e === 'pedido' && etapa.pedidoDoc
          ? { ano: Number(etapa.pedidoAno), doc: Number(etapa.pedidoDoc) }
          : null,
      nf:
        e === 'nf' && etapa.nfDoc
          ? { ano: Number(etapa.nfAno), mes: Number(etapa.nfMes), doc: Number(etapa.nfDoc) }
          : null,
      observacao: etapa.observacao.trim() || null,
    });
    mensagem.value = r.mensagem;
    etapa.etapa = '';
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
    await lista.refetch();
  }
}
</script>

<template>
  <section class="tela-opme" aria-labelledby="opme-titulo" data-testid="tela-opme-solicitacoes">
    <h1 id="opme-titulo">{{ t('opme.solicitacoes.titulo') }}</h1>
    <div class="abas" role="tablist">
      <SanteBotao
        role="tab"
        :aria-selected="aba === 'solicitar'"
        variante="secundario"
        :rotulo="t('opme.solicitacoes.abaSolicitar')"
        data-testid="opme-aba-solicitar"
        @acionar="trocar('solicitar')"
      />
      <SanteBotao
        role="tab"
        :aria-selected="aba === 'acompanhar'"
        variante="secundario"
        :rotulo="t('opme.solicitacoes.abaAcompanhar')"
        data-testid="opme-aba-acompanhar"
        @acionar="trocar('acompanhar')"
      />
    </div>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="opme-mensagem">{{ mensagem }}</p>

    <template v-if="aba === 'solicitar'">
      <div class="barra">
        <span class="campo">
          <label for="opme-dia">{{ t('opme.solicitacoes.data') }}</label>
          <input id="opme-dia" v-model="dia" type="date" data-testid="opme-dia" />
        </span>
      </div>
      <ErroSuprimentos v-if="cirurgias.isError.value" :erro="cirurgias.error.value" />
      <p v-else-if="!cirurgias.data.value" role="status">{{ t('opme.carregando') }}</p>
      <template v-else>
        <SanteAlerta
          v-if="!cirurgias.data.value.gravacao.ligada"
          variante="aviso"
          :texto="cirurgias.data.value.gravacao.motivo ?? t('opme.emConsulta')"
          data-testid="opme-desligado"
        />
        <p v-if="cirurgias.data.value.cirurgias.length === 0">{{ t('opme.solicitacoes.semCirurgias') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <caption class="secundario">
              {{
                t('opme.solicitacoes.cirurgiasDoDia')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('opme.solicitacoes.colCirurgia') }}</th>
                <th scope="col">{{ t('opme.consumo.paciente') }}</th>
                <th scope="col">{{ t('opme.solicitacoes.colItem') }}</th>
                <th scope="col">{{ t('opme.solicitacoes.colAcao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in cirurgias.data.value.cirurgias"
                :key="c.agendamento"
                :data-testid="`opme-cirurgia-${c.agendamento}`"
              >
                <td>{{ c.sala }} · {{ hora(c.inicio) }} · {{ c.procedimento ?? '—' }}</td>
                <td>{{ c.paciente }}</td>
                <td>{{ t('opme.consumo.pedidas', { n: c.solicitacoes }) }}</td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('opme.solicitacoes.escolher')"
                    :data-testid="`opme-escolher-${c.agendamento}`"
                    @acionar="cirurgia = c"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <section v-if="cirurgia" class="cartao" aria-labelledby="opme-form" data-testid="opme-form">
          <h2 id="opme-form">
            {{
              t('opme.solicitacoes.escolhida', {
                sala: cirurgia.sala,
                hora: hora(cirurgia.inicio),
                atendimento: cirurgia.atendimento,
              })
            }}
          </h2>
          <div class="barra">
            <SanteSelecao
              v-model="local"
              :rotulo="t('opme.solicitacoes.local')"
              :opcoes="opcoesLocal"
              data-testid="opme-sol-local"
            />
            <span class="campo">
              <label for="opme-termo">{{ t('opme.solicitacoes.item') }}</label>
              <input id="opme-termo" v-model="termo" type="search" maxlength="60" data-testid="opme-termo" />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('opme.solicitacoes.buscar')"
              data-testid="opme-buscar"
              @acionar="buscar"
            />
          </div>
          <p v-if="itens && itens.length === 0">{{ t('opme.solicitacoes.semItens') }}</p>
          <fieldset v-else-if="itens" class="campo">
            <legend>{{ t('opme.solicitacoes.colItem') }}</legend>
            <label v-for="i in itens" :key="i.item" :data-testid="`opme-item-${i.item}`">
              <input v-model="form.item" type="radio" name="opme-item" :value="i.item" />
              {{ i.item }} · {{ i.nome }} ({{
                t('opme.solicitacoes.saldo', { saldo: i.saldoLocal, unidade: i.unidade })
              }}{{ i.consignado ? `, ${t('opme.solicitacoes.consignado')}` : '' }})
            </label>
          </fieldset>
          <div class="barra">
            <span class="campo">
              <label for="opme-tuss">{{ t('opme.solicitacoes.tuss') }}</label>
              <input
                id="opme-tuss"
                v-model="form.tuss"
                inputmode="numeric"
                maxlength="8"
                data-testid="opme-tuss"
              />
            </span>
            <span class="campo">
              <label for="opme-qtd">{{ t('opme.solicitacoes.quantidade') }}</label>
              <input
                id="opme-qtd"
                v-model.number="form.quantidade"
                type="number"
                min="1"
                step="1"
                data-testid="opme-qtd"
              />
            </span>
          </div>
          <div class="barra">
            <BuscaFornecedorOpme
              v-model="form.fornecedor"
              :rotulo="t('opme.solicitacoes.fornecedor')"
              testid="opme-fornecedor"
            />
          </div>
          <span class="campo">
            <label for="opme-just">{{ t('opme.solicitacoes.justificativa') }}</label>
            <textarea
              id="opme-just"
              v-model="form.justificativa"
              rows="3"
              maxlength="500"
              data-testid="opme-justificativa"
            />
          </span>
          <SanteBotao
            :rotulo="t('opme.solicitacoes.solicitar')"
            :desabilitado="!podeSolicitar || enviando || !form.item"
            data-testid="opme-solicitar"
            @acionar="solicitar"
          />
        </section>
      </template>
    </template>

    <template v-else>
      <div class="barra">
        <span class="campo">
          <label for="opme-de">{{ t('opme.periodo.de') }}</label>
          <input id="opme-de" v-model="de" type="date" data-testid="opme-de" />
        </span>
        <span class="campo">
          <label for="opme-ate">{{ t('opme.periodo.ate') }}</label>
          <input id="opme-ate" v-model="ate" type="date" data-testid="opme-ate" />
        </span>
      </div>
      <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('opme.carregando') }}</p>
      <template v-else>
        <p v-if="lista.data.value.solicitacoes.length === 0">{{ t('opme.solicitacoes.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <caption class="secundario">
              {{
                t('opme.solicitacoes.lista', { de: lista.data.value.de, ate: lista.data.value.ate })
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('opme.solicitacoes.colCirurgia') }}</th>
                <th scope="col">{{ t('opme.solicitacoes.colItem') }}</th>
                <th scope="col">{{ t('opme.solicitacoes.colQtd') }}</th>
                <th scope="col">{{ t('opme.solicitacoes.colSituacao') }}</th>
                <th scope="col">{{ t('opme.solicitacoes.colAutorizacao') }}</th>
                <th scope="col">{{ t('opme.solicitacoes.colAcao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in lista.data.value.solicitacoes" :key="s.id" :data-testid="`opme-sol-${s.id}`">
                <td>{{ diaHora(s.dataHora) }} · {{ s.sala }} · {{ s.atendimento }}</td>
                <td>
                  {{ s.item }} · {{ s.itemNome ?? '—' }} ·
                  {{ t('opme.solicitacoes.tussCurto', { tuss: s.tuss }) }}
                </td>
                <td>{{ s.quantidade }} ({{ s.autorizada }}/{{ s.consumida }}/{{ s.devolvida }})</td>
                <td :data-testid="`opme-sol-situacao-${s.id}`">{{ t(`opme.situacoes.${s.situacao}`) }}</td>
                <td>{{ s.senha ? `${s.senha} · ${s.guia}` : '—' }}</td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('opme.solicitacoes.abrir')"
                    :data-testid="`opme-sol-abrir-${s.id}`"
                    @acionar="aberta = s.id"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="lista.data.value.cortada" class="secundario">{{ t('opme.solicitacoes.cortada') }}</p>
        </div>
        <section v-if="sol" class="cartao" aria-labelledby="opme-det" data-testid="opme-detalhe">
          <h2 id="opme-det">
            {{ t('opme.solicitacoes.detalhe', { id: sol.id, item: sol.itemNome ?? sol.item }) }}
          </h2>
          <p class="secundario">{{ sol.justificativa }}</p>
          <h3>{{ t('opme.solicitacoes.historico') }}</h3>
          <ol>
            <li v-for="e in sol.etapas" :key="e.seq">
              {{
                t('opme.solicitacoes.etapaPor', {
                  etapa: t(`opme.etapas.${e.etapa}`),
                  em: diaHora(e.em),
                  usuario: e.usuario,
                })
              }}
              <span v-if="e.senha"> · {{ e.senha }} / {{ e.guia }}</span>
              <span v-if="e.observacao" class="secundario"> · {{ e.observacao }}</span>
            </li>
          </ol>
          <p v-if="etapasDisponiveis.length === 0" class="secundario">
            {{ t('opme.solicitacoes.encerrada') }}
          </p>
          <template v-else>
            <h3>{{ t('opme.solicitacoes.novaEtapa') }}</h3>
            <div class="barra">
              <SanteSelecao
                v-model="etapa.etapa"
                :rotulo="t('opme.solicitacoes.etapa')"
                :opcoes="opcoesEtapa"
                data-testid="opme-etapa"
              />
              <span class="campo">
                <label for="opme-em">{{ t('opme.solicitacoes.em') }}</label>
                <input id="opme-em" v-model="etapa.em" type="datetime-local" data-testid="opme-etapa-em" />
              </span>
            </div>
            <div v-if="etapa.etapa === 'autorizacao'" class="barra">
              <span class="campo">
                <label for="opme-senha">{{ t('opme.solicitacoes.senha') }}</label>
                <input id="opme-senha" v-model="etapa.senha" maxlength="20" data-testid="opme-senha" />
              </span>
              <span class="campo">
                <label for="opme-guia">{{ t('opme.solicitacoes.guia') }}</label>
                <input id="opme-guia" v-model="etapa.guia" maxlength="20" data-testid="opme-guia" />
              </span>
              <span class="campo">
                <label for="opme-val">{{ t('opme.solicitacoes.validade') }}</label>
                <input id="opme-val" v-model="etapa.validade" type="date" data-testid="opme-validade" />
              </span>
              <span class="campo">
                <label for="opme-qaut">{{ t('opme.solicitacoes.qtdAutorizada') }}</label>
                <input
                  id="opme-qaut"
                  v-model.number="etapa.quantidade"
                  type="number"
                  min="1"
                  data-testid="opme-qtd-aut"
                />
              </span>
              <p class="secundario">{{ t('opme.solicitacoes.anexoTiss') }}</p>
            </div>
            <div v-if="etapa.etapa === 'consignacao'" class="barra">
              <BuscaFornecedorOpme
                v-model="etapa.fornecedor"
                :rotulo="t('opme.solicitacoes.fornecedorConsignacao')"
                testid="opme-etapa-fornecedor"
              />
            </div>
            <p v-if="etapa.etapa === 'pedido' || etapa.etapa === 'nf'" class="secundario">
              {{ t('opme.solicitacoes.conferido') }}
            </p>
            <div v-if="etapa.etapa === 'pedido'" class="barra">
              <span class="campo">
                <label for="opme-pano">{{ t('opme.solicitacoes.pedidoAno') }}</label>
                <input id="opme-pano" v-model.number="etapa.pedidoAno" type="number" />
              </span>
              <span class="campo">
                <label for="opme-pdoc">{{ t('opme.solicitacoes.pedidoDoc') }}</label>
                <input
                  id="opme-pdoc"
                  v-model="etapa.pedidoDoc"
                  inputmode="numeric"
                  data-testid="opme-pedido"
                />
              </span>
            </div>
            <div v-if="etapa.etapa === 'nf'" class="barra">
              <span class="campo">
                <label for="opme-nano">{{ t('opme.solicitacoes.nfAno') }}</label>
                <input id="opme-nano" v-model.number="etapa.nfAno" type="number" />
              </span>
              <span class="campo">
                <label for="opme-nmes">{{ t('opme.solicitacoes.nfMes') }}</label>
                <input id="opme-nmes" v-model.number="etapa.nfMes" type="number" min="1" max="12" />
              </span>
              <span class="campo">
                <label for="opme-ndoc">{{ t('opme.solicitacoes.nfDoc') }}</label>
                <input id="opme-ndoc" v-model="etapa.nfDoc" inputmode="numeric" data-testid="opme-nf" />
              </span>
            </div>
            <span v-if="etapa.etapa" class="campo">
              <label for="opme-obs">{{ t('opme.solicitacoes.observacao') }}</label>
              <textarea
                id="opme-obs"
                v-model="etapa.observacao"
                rows="2"
                maxlength="500"
                data-testid="opme-observacao"
              />
            </span>
            <SanteBotao
              :rotulo="t('opme.enviar')"
              :desabilitado="!etapa.etapa || enviando"
              data-testid="opme-registrar-etapa"
              @acionar="registrarEtapa"
            />
          </template>
        </section>
      </template>
    </template>
  </section>
</template>
