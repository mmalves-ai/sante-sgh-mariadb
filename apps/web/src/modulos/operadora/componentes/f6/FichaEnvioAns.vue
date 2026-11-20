<script setup lang="ts">
// Ficha do envio à ANS (M56, etapa 7, F6; leitura na trilha): a obrigação, a competência, o arquivo com o SHA-256, o
// destino, o recibo, o retorno, a GRU; os quadros com as parcelas; os itens (movimentos do SIB, grupos do SIP, planos da
// TPS, guias do monitoramento, atendimentos do ressarcimento com a sugestão da análise e a decisão) com o resultado do
// retorno; o histórico. As ações vêm do servidor (situação, destino e quem está na tela): baixar o arquivo, registrar o
// envio (no simulador sem recibo; na ANS com o recibo; no ressarcimento, protocolar a impugnação), registrar o retorno
// (simulado fora de produção), a GRU paga e a decisão de cada atendimento.
import {
  CODIGOS_MOTIVO_IMPUGNACAO_SUS,
  OBRIGACOES_ANS,
  type ItemEnvioAns,
  type MotivoImpugnacaoSus,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import {
  baixarArquivoAns,
  decidirAtendimentoSus,
  lerArquivoAns,
  lerEnvioAns,
  registrarGruAns,
  registrarRetornoAns,
  transmitirEnvioAns,
  type ResultadoAns,
} from '../../api-ans.js';
import { dataBr, hoje, numeroDe } from '../f1/comum.js';
import { brl } from '../f2/comum.js';
import { competenciaTela, corpoRetorno, type MarcaRetorno } from './comum.js';
import QuadrosAns from './QuadrosAns.vue';

const props = defineProps<{ id: number; podeGerar: boolean }>();
const emit = defineEmits<{ gravado: [r: ResultadoAns]; fechar: [] }>();
const { t, te } = useI18n();

const ficha = useQuery({
  queryKey: computed(() => ['operadora', 'ans', 'ficha', props.id]),
  queryFn: () => lerEnvioAns(props.id),
});
const e = computed(() => ficha.data.value ?? null);
const tem = (a: 'transmitir' | 'retorno' | 'pagar' | 'decidir' | 'baixar') =>
  props.podeGerar || a === 'baixar' ? e.value?.acoes.includes(a) === true : false;
const quando = (d: string | null) => (d ? `${dataBr(d.slice(0, 10))} ${d.slice(11, 16)}`.trim() : '—');
const ressarcimento = computed(() => e.value?.obrigacao === 'RESSARCIMENTO_SUS');
const sib = computed(() => e.value?.obrigacao === 'SIB');
const prazoVencido = computed(() => !!e.value?.prazo && e.value.prazo.slice(0, 10) < hoje());
const tipoItem = (x: string) =>
  te(`operadoraAns.itens.tipos.${x}`) ? t(`operadoraAns.itens.tipos.${x}`) : x;
const motivoTexto = (m: MotivoImpugnacaoSus | null) => (m ? t(`operadoraAns.motivosSus.${m}`) : '');

// ── Diálogos ────────────────────────────────────────────────────────────────────────────────────
type Dialogo = 'transmitir' | 'retorno' | 'pagar' | 'decidir';
const dialogo = ref<Dialogo | null>(null);
const visivel = computed({
  get: () => dialogo.value !== null,
  set: (v: boolean) => {
    if (!v) dialogo.value = null;
  },
});
const recibo = ref('');
const modoRetorno = ref<'simular' | 'itens' | 'rejeitado'>('simular');
const resumo = ref('');
const marcas = ref<{ ordem: number; referencia: string; aceito: boolean; cco: string; erro: string }[]>([]);
const gru = ref('');
const valor = ref('');
const data = ref<string | null>(null);
const item = ref<ItemEnvioAns | null>(null);
const decisao = ref<'impugnar' | 'aceitar'>('impugnar');
const motivo = ref<MotivoImpugnacaoSus | null>(null);
const justificativa = ref('');
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);
const erroArquivo = ref<string | null>(null);

function abrir(d: Dialogo, i: ItemEnvioAns | null = null): void {
  const k = e.value;
  if (!k) return;
  dialogo.value = d;
  recusa.value = null;
  erro.value = null;
  recibo.value = '';
  resumo.value = '';
  modoRetorno.value = k.destino === 'simulador' ? 'simular' : 'itens';
  marcas.value = k.itens.map((x) => ({
    ordem: x.ordem,
    referencia: x.referencia,
    aceito: true,
    cco: '',
    erro: '',
  }));
  gru.value = '';
  valor.value = k.valorTotal !== null ? String(k.valorTotal).replace('.', ',') : '';
  data.value = hoje();
  item.value = i;
  decisao.value = prazoVencido.value ? 'aceitar' : i?.decisao === 'aceitar' ? 'aceitar' : 'impugnar';
  motivo.value = i?.motivo ?? i?.sugestao ?? null;
  justificativa.value = i?.justificativa ?? '';
}

const titulo = computed(() => {
  if (dialogo.value === 'transmitir')
    return ressarcimento.value ? t('operadoraAns.acoes.protocolar') : t('operadoraAns.transmissao.titulo');
  if (dialogo.value === 'retorno') return t('operadoraAns.retorno.titulo');
  if (dialogo.value === 'pagar') return t('operadoraAns.gru.titulo');
  return t('operadoraAns.decisao.titulo', { referencia: item.value?.referencia ?? '' });
});

const completo = computed(() => {
  const k = e.value;
  if (!k) return false;
  if (dialogo.value === 'transmitir')
    return ressarcimento.value || k.destino === 'simulador' || recibo.value.trim().length > 0;
  if (dialogo.value === 'retorno')
    return (
      modoRetorno.value !== 'itens' ||
      marcas.value.every((m) => !m.aceito || !m.cco.trim() || /^\d{12}$/.test(m.cco.trim()))
    );
  if (dialogo.value === 'pagar') {
    const v = numeroDe(valor.value);
    return /^\d{10,30}$/.test(gru.value.trim()) && v !== null && v > 0 && !!data.value;
  }
  if (decisao.value === 'aceitar') return true;
  return motivo.value !== null && (motivo.value !== 'outro' || justificativa.value.trim().length >= 3);
});

async function confirmar(): Promise<void> {
  const k = e.value;
  if (!k || !completo.value) return;
  recusa.value = null;
  erro.value = null;
  enviando.value = true;
  try {
    const versao = k.versao;
    const r =
      dialogo.value === 'transmitir'
        ? await transmitirEnvioAns(k.id, {
            versao,
            ...(k.destino === 'ans' && !ressarcimento.value ? { recibo: recibo.value.trim() } : {}),
          })
        : dialogo.value === 'retorno'
          ? await registrarRetornoAns(
              k.id,
              corpoRetorno(versao, modoRetorno.value, resumo.value, marcas.value as MarcaRetorno[]),
            )
          : dialogo.value === 'pagar'
            ? await registrarGruAns(k.id, {
                versao,
                gru: gru.value.trim(),
                valor: numeroDe(valor.value),
                data: data.value,
              })
            : await decidirAtendimentoSus(k.id, item.value!.id, {
                versao,
                decisao: decisao.value,
                motivo: decisao.value === 'impugnar' ? motivo.value : null,
                justificativa: justificativa.value.trim() || null,
              });
    dialogo.value = null;
    emit('gravado', r);
    await ficha.refetch();
  } catch (x) {
    if (x instanceof ErroApi && x.problema?.detail && [400, 403, 404, 409, 422].includes(x.status))
      recusa.value = x.problema.detail;
    else erro.value = x;
  } finally {
    enviando.value = false;
  }
}

async function baixar(): Promise<void> {
  erroArquivo.value = null;
  try {
    baixarArquivoAns(await lerArquivoAns(props.id));
  } catch (x) {
    erroArquivo.value = x instanceof ErroApi && x.problema?.detail ? x.problema.detail : String(x);
  }
}

const opcoesDecisao = computed(() =>
  (prazoVencido.value ? (['aceitar'] as const) : (['impugnar', 'aceitar'] as const)).map((d) => ({
    valor: d,
    rotulo: t(`operadoraAns.decisao.opcoes.${d}`),
  })),
);
const opcoesMotivo = computed(() =>
  CODIGOS_MOTIVO_IMPUGNACAO_SUS.map((m) => ({
    valor: m as MotivoImpugnacaoSus | null,
    rotulo: t(`operadoraAns.motivosSus.${m}`),
  })),
);
const opcoesModo = computed(() =>
  (e.value?.destino === 'simulador'
    ? (['simular', 'itens', 'rejeitado'] as const)
    : (['itens', 'rejeitado'] as const)
  ).map((m) => ({ valor: m, rotulo: t(`operadoraAns.retorno.modos.${m}`) })),
);
</script>

<template>
  <section class="bloco" aria-labelledby="ans-ficha-titulo" data-testid="ans-ficha">
    <div class="acoes cabeca">
      <h2 id="ans-ficha-titulo">{{ t('operadoraAns.ficha.titulo') }}</h2>
      <SanteBotao variante="texto" :rotulo="t('operadoraAns.acoes.fechar')" @acionar="emit('fechar')" />
    </div>
    <MensagemErro v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!e" role="status">{{ t('operadoraAns.carregando') }}</p>
    <template v-else>
      <h3 data-testid="ans-ficha-cabeca">
        {{ OBRIGACOES_ANS[e.obrigacao].rotulo }} · {{ competenciaTela(e.competencia) }} · {{ e.sequencial }}
      </h3>
      <dl class="ficha">
        <div>
          <dt>{{ t('operadoraAns.ficha.operadora') }}</dt>
          <dd>{{ e.operadora.nome }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.registroAns') }}</dt>
          <dd>{{ e.operadora.registroAns }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.situacao') }}</dt>
          <dd :data-situacao="e.situacao" data-testid="ans-ficha-situacao">
            {{ t(`operadoraAns.situacoes.${e.situacao}`) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.destino') }}</dt>
          <dd>{{ t(`operadoraAns.destinos.${e.destino}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.registros') }}</dt>
          <dd>{{ e.registros }}</dd>
        </div>
        <div v-if="e.valorTotal !== null">
          <dt>{{ t('operadoraAns.ficha.valor') }}</dt>
          <dd>{{ brl(e.valorTotal) }}</dd>
        </div>
        <div v-if="e.arquivoNome">
          <dt>{{ t('operadoraAns.ficha.arquivo') }}</dt>
          <dd>{{ e.arquivoNome }}</dd>
        </div>
        <div v-if="e.hash" class="largo">
          <dt>{{ t('operadoraAns.ficha.hash') }}</dt>
          <dd class="hash" data-testid="ans-ficha-hash">{{ e.hash }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.recibo') }}</dt>
          <dd data-testid="ans-ficha-recibo">
            {{ e.recibo ?? (e.destino === 'simulador' ? t('operadoraAns.ficha.semRecibo') : '—') }}
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.gerado') }}</dt>
          <dd>{{ t('operadoraAns.ficha.por', { quem: e.criadoPor, quando: quando(e.criadoEm) }) }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.enviado') }}</dt>
          <dd>{{ quando(e.enviadoEm) }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAns.ficha.retorno') }}</dt>
          <dd>{{ quando(e.retornoEm) }}</dd>
        </div>
        <div v-if="e.prazo">
          <dt>{{ t('operadoraAns.ficha.prazo') }}</dt>
          <dd data-testid="ans-ficha-prazo">
            {{ dataBr(e.prazo) }}
            <strong v-if="prazoVencido"> · {{ t('operadoraAns.decisao.prazoVencido') }}</strong>
          </dd>
        </div>
        <div v-if="e.gru">
          <dt>{{ t('operadoraAns.ficha.gru') }}</dt>
          <dd>{{ e.gru }} · {{ dataBr(e.pagoEm) }} · {{ brl(e.valorPago) }}</dd>
        </div>
      </dl>
      <p v-if="e.retornoResumo" data-testid="ans-ficha-retorno-resumo">
        <strong>{{ t('operadoraAns.ficha.retornoResumo') }}:</strong> {{ e.retornoResumo }}
      </p>

      <div class="acoes" data-testid="ans-ficha-acoes">
        <SanteBotao
          v-if="tem('baixar')"
          variante="secundario"
          :rotulo="t('operadoraAns.acoes.baixar')"
          data-testid="ans-baixar"
          @acionar="baixar"
        />
        <SanteBotao
          v-if="tem('transmitir')"
          :rotulo="ressarcimento ? t('operadoraAns.acoes.protocolar') : t('operadoraAns.acoes.transmitir')"
          data-testid="ans-transmitir"
          @acionar="abrir('transmitir')"
        />
        <SanteBotao
          v-if="tem('retorno')"
          :rotulo="t('operadoraAns.acoes.retorno')"
          data-testid="ans-retorno"
          @acionar="abrir('retorno')"
        />
        <SanteBotao
          v-if="tem('pagar')"
          variante="secundario"
          :rotulo="t('operadoraAns.acoes.pagar')"
          data-testid="ans-pagar"
          @acionar="abrir('pagar')"
        />
      </div>
      <p v-if="erroArquivo" role="alert">{{ erroArquivo }}</p>

      <section v-if="e.quadros.length" class="bloco" aria-labelledby="ans-ficha-quadros">
        <h3 id="ans-ficha-quadros">{{ t('operadoraAns.ficha.quadros') }}</h3>
        <QuadrosAns :quadros="e.quadros" prefixo="ans-ficha" />
      </section>

      <section class="bloco" aria-labelledby="ans-ficha-itens">
        <h3 id="ans-ficha-itens">{{ t('operadoraAns.ficha.itens') }}</h3>
        <p v-if="e.itens.length === 0">{{ t('operadoraAns.ficha.semItens') }}</p>
        <div v-else class="rolagem">
          <table class="tabela" data-testid="ans-ficha-itens">
            <caption class="visualmente-oculto">
              {{
                t('operadoraAns.ficha.itens')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('operadoraAns.itens.ordem') }}</th>
                <th scope="col">{{ t('operadoraAns.itens.tipo') }}</th>
                <th scope="col">{{ t('operadoraAns.itens.referencia') }}</th>
                <th scope="col">{{ t('operadoraAns.itens.descricao') }}</th>
                <th scope="col">{{ t('operadoraAns.itens.valor') }}</th>
                <th scope="col">{{ t('operadoraAns.itens.resultado') }}</th>
                <template v-if="ressarcimento">
                  <th scope="col">{{ t('operadoraAns.itens.sugestao') }}</th>
                  <th scope="col">{{ t('operadoraAns.itens.decisao') }}</th>
                  <th scope="col">
                    <span class="visualmente-oculto">{{ t('operadoraAns.colunas.acoes') }}</span>
                  </th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in e.itens" :key="i.id" :data-testid="`ans-item-${i.ordem}`">
                <td>{{ i.ordem }}</td>
                <td>{{ tipoItem(i.tipo) }}</td>
                <td>{{ i.referencia }}</td>
                <td>{{ i.descricao }}</td>
                <td>{{ brl(i.valor) }}</td>
                <td :data-resultado="i.resultado">
                  {{ t(`operadoraAns.resultados.${i.resultado}`) }}
                  <span v-if="i.erro" class="secundario"> · {{ i.erro }}</span>
                </td>
                <template v-if="ressarcimento">
                  <td>{{ i.sugestao ? motivoTexto(i.sugestao) : t('operadoraAns.itens.semSugestao') }}</td>
                  <td :data-decisao="i.decisao ?? 'pendente'">
                    {{ t(`operadoraAns.decisoes.${i.decisao ?? 'pendente'}`) }}
                    <span v-if="i.motivo" class="secundario"> · {{ motivoTexto(i.motivo) }}</span>
                    <span v-if="i.justificativa" class="secundario"> · {{ i.justificativa }}</span>
                  </td>
                  <td>
                    <SanteBotao
                      v-if="tem('decidir')"
                      variante="texto"
                      :rotulo="`${t('operadoraAns.acoes.decidir')} ${i.referencia}`"
                      :data-testid="`ans-decidir-${i.ordem}`"
                      @acionar="abrir('decidir', i)"
                    />
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="bloco" aria-labelledby="ans-ficha-historico">
        <h3 id="ans-ficha-historico">{{ t('operadoraAns.ficha.historico') }}</h3>
        <ol data-testid="ans-ficha-historico">
          <li v-for="(h, n) in e.eventos" :key="n">
            {{ te(`operadoraAns.eventos.${h.evento}`) ? t(`operadoraAns.eventos.${h.evento}`) : h.evento }} ·
            {{ t(`operadoraAns.situacoes.${h.situacao}`) }} ·
            {{ t('operadoraAns.ficha.por', { quem: h.por, quando: quando(h.em) }) }}
            <span v-if="h.texto" class="secundario"> · {{ h.texto }}</span>
          </li>
        </ol>
      </section>
    </template>

    <SanteDialogo v-model:visivel="visivel" :titulo="titulo" largura="44rem">
      <form v-if="e && dialogo" class="dialogo" data-testid="ans-dialogo" @submit.prevent="confirmar">
        <template v-if="dialogo === 'transmitir'">
          <p v-if="ressarcimento">{{ t('operadoraAns.transmissao.impugnacao') }}</p>
          <p v-else-if="e.destino === 'simulador'">{{ t('operadoraAns.transmissao.simulador') }}</p>
          <template v-else>
            <p>{{ t('operadoraAns.transmissao.ans') }}</p>
            <SanteCampoTexto
              id="ans-recibo"
              v-model="recibo"
              :rotulo="t('operadoraAns.transmissao.recibo')"
              :max-bytes="40"
              obrigatorio
            />
          </template>
        </template>

        <template v-else-if="dialogo === 'retorno'">
          <SanteSelecao
            v-model="modoRetorno"
            :rotulo="t('operadoraAns.retorno.modo')"
            :opcoes="opcoesModo"
            data-testid="ans-retorno-modo"
          />
          <p v-if="e.destino === 'ans'" class="secundario">
            {{ t('operadoraAns.retorno.simuladoSoForaProducao') }}
          </p>
          <SanteCampoTexto
            v-if="modoRetorno !== 'simular'"
            id="ans-retorno-resumo"
            v-model="resumo"
            :rotulo="t('operadoraAns.retorno.resumo')"
            :max-bytes="500"
            multilinha
          />
          <div v-if="modoRetorno === 'itens'" class="rolagem">
            <table class="tabela" data-testid="ans-retorno-itens">
              <caption class="visualmente-oculto">
                {{
                  t('operadoraAns.ficha.itens')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('operadoraAns.itens.referencia') }}</th>
                  <th scope="col">{{ t('operadoraAns.retorno.aceito') }}</th>
                  <th scope="col">
                    {{ sib ? t('operadoraAns.retorno.cco') : t('operadoraAns.retorno.erro') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in marcas" :key="m.ordem">
                  <td>{{ m.ordem }} · {{ m.referencia }}</td>
                  <td>
                    <label class="marcar"
                      ><input
                        v-model="m.aceito"
                        type="checkbox"
                        :data-testid="`ans-retorno-aceito-${m.ordem}`"
                      />
                      <span class="visualmente-oculto"
                        >{{ t('operadoraAns.retorno.aceito') }} {{ m.referencia }}</span
                      >
                    </label>
                  </td>
                  <td>
                    <SanteCampoTexto
                      v-if="m.aceito && sib"
                      :id="`ans-retorno-cco-${m.ordem}`"
                      v-model="m.cco"
                      :rotulo="`${t('operadoraAns.retorno.cco')} ${m.referencia}`"
                      :max-bytes="12"
                    />
                    <SanteCampoTexto
                      v-else-if="!m.aceito"
                      :id="`ans-retorno-erro-${m.ordem}`"
                      v-model="m.erro"
                      :rotulo="`${t('operadoraAns.retorno.erro')} ${m.referencia}`"
                      :max-bytes="300"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <template v-else-if="dialogo === 'pagar'">
          <SanteCampoTexto
            id="ans-gru"
            v-model="gru"
            :rotulo="t('operadoraAns.gru.numero')"
            :max-bytes="30"
          />
          <p v-if="gru.trim() && !/^\d{10,30}$/.test(gru.trim())" class="erro">
            {{ t('operadoraAns.gru.numeroInvalido') }}
          </p>
          <SanteCampoTexto
            id="ans-gru-valor"
            v-model="valor"
            :rotulo="t('operadoraAns.gru.valor')"
            :max-bytes="20"
          />
          <SanteData v-model="data" :rotulo="t('operadoraAns.gru.data')" editavel />
        </template>

        <template v-else>
          <p v-if="item?.sugestao" data-testid="ans-decisao-sugestao">
            {{ t('operadoraAns.decisao.sugestao', { motivo: motivoTexto(item.sugestao) }) }}
          </p>
          <SanteAlerta v-if="prazoVencido" :texto="t('operadoraAns.decisao.prazoVencido')" variante="aviso" />
          <SanteSelecao
            v-model="decisao"
            :rotulo="t('operadoraAns.decisao.decisao')"
            :opcoes="opcoesDecisao"
            data-testid="ans-decisao"
          />
          <SanteSelecao
            v-if="decisao === 'impugnar'"
            v-model="motivo"
            :rotulo="t('operadoraAns.decisao.motivo')"
            :opcoes="opcoesMotivo"
            obrigatorio
            data-testid="ans-decisao-motivo"
          />
          <SanteCampoTexto
            id="ans-decisao-justificativa"
            v-model="justificativa"
            :rotulo="t('operadoraAns.decisao.justificativa')"
            :max-bytes="1000"
            multilinha
          />
        </template>

        <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="ans-dialogo-recusa" />
        <MensagemErro v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('operadoraAns.acoes.confirmar')"
            :desabilitado="!completo || enviando"
            data-testid="ans-dialogo-confirmar"
          />
          <SanteBotao variante="texto" :rotulo="t('operadoraAns.acoes.cancelar')" @acionar="dialogo = null" />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.cabeca {
  justify-content: space-between;
}
.ficha {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}
.ficha dd {
  margin: 0;
}
.ficha .largo {
  grid-column: 1 / -1;
}
.hash {
  font-family: monospace;
  overflow-wrap: anywhere;
}
.rolagem {
  overflow-x: auto;
  max-height: 32rem;
}
.dialogo {
  display: grid;
  gap: 0.75rem;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
.erro {
  color: var(--sgh-perigo);
}
</style>
