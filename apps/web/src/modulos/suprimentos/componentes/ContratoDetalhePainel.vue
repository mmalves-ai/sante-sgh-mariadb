<script setup lang="ts">
// O contrato aberto (M55, etapa 3; regras 5 a 8): o resumo com o saldo e as parcelas impressas (regra 6), os avisos, o
// histórico dos eventos, o registro de um evento (aditivo, reajuste, renovação, exceção, ocorrência, anexo,
// encerramento, rescisão; cada um pela permissão de agir da sua rota), a avaliação do fornecedor com a prévia do
// resultado (regra 8), os pedidos e títulos ligados com os candidatos do fornecedor para ligar (regra 7: fora da
// vigência só com a exceção aprovada) e a alteração do cadastro pela versão. O servidor confere tudo de novo.
import {
  CRITERIOS_AVALIACAO_FORNECEDOR,
  type CandidatoVinculo,
  type CriterioAvaliacao,
  type EventoContrato,
  type TipoEventoContrato,
} from '@sgh/contratos';
import { acrescimoAcimaDoLimite, avaliarFornecedor } from '@sgh/dominio-suprimentos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  lerCandidatosContrato,
  lerContratoTela,
  novaChaveContrato,
  registrarEventoContratoTela,
  vincularContratoTela,
} from '../api-contrato.js';
import { data, reais } from '../usar-suprimentos.js';
import ContratoFormulario from './ContratoFormulario.vue';
import {
  eventosRegistraveis,
  excecoesDisponiveis,
  foraDaVigencia,
  lerDinheiro,
  podeOperacao,
  rotuloEvento,
  rotuloFaixa,
  rotuloGarantia,
  rotuloIndice,
  rotuloResultado,
  rotuloSituacao,
  rotuloTipoContrato,
  rotuloVinculo,
} from './contrato-tela.js';
import ErroSuprimentos from './ErroSuprimentos.vue';
import SlaContratoPainel from './SlaContratoPainel.vue';

const props = defineProps<{ id: number; hoje: string }>();
const emit = defineEmits<{ fechar: []; mudou: [] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratoFornecedor.${s}`, p ?? {});
type Aba = 'resumo' | 'eventos' | 'registrar' | 'avaliacao' | 'vinculos' | 'sla' | 'cadastro';
const abas: Aba[] = ['resumo', 'eventos', 'registrar', 'avaliacao', 'vinculos', 'sla', 'cadastro'];
const aba = ref<Aba>('resumo');
const consulta = useQuery({
  queryKey: computed(() => ['contratos', 'detalhe', props.id]),
  queryFn: () => lerContratoTela(props.id),
});
const c = computed(() => consulta.data.value ?? null);
const g = computed(() => c.value?.gravacao ?? null);
const podeEditar = computed(() => podeOperacao(g.value, 'editar'));
const podeAvaliar = computed(() => podeOperacao(g.value, 'avaliar'));
const mensagem = ref('');
const erro = ref<unknown>(null);
const enviando = ref(false);
const pct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const diaHora = (x: string) => `${data(x)} ${x.slice(11, 16)}`;

async function executar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    await consulta.refetch();
    emit('mudou');
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    enviando.value = false;
  }
}

// ── Histórico ───────────────────────────────────────────────────────────────────────────────────────────────

function detalheEvento(e: EventoContrato): string {
  const xs: string[] = [];
  if (e.numeroTermo) xs.push(k('eventos.termo', { numero: e.numeroTermo }));
  if (e.valor !== null && e.valor !== 0) xs.push(k('eventos.valor', { valor: reais(e.valor) }));
  if (e.percentual !== null) xs.push(k('eventos.percentual', { p: pct(e.percentual) }));
  if (e.novoFim) xs.push(k('eventos.novoFim', { data: data(e.novoFim) }));
  if (e.resultado) xs.push(k('eventos.resultado', { resultado: rotuloResultado(e.resultado) }));
  if (e.documento) xs.push(k('eventos.documento', { n: e.documento }));
  if (e.tipo === 'excecao') xs.push(e.usado ? k('eventos.usada') : k('eventos.livre'));
  if (e.descricao) xs.push(e.descricao);
  return xs.join(' · ');
}

// ── Registrar evento ────────────────────────────────────────────────────────────────────────────────────────

const registraveis = computed(() => eventosRegistraveis(g.value));
const tipoEvento = ref<TipoEventoContrato | null>(null);
watch(
  registraveis,
  (xs) => {
    if (!tipoEvento.value || !xs.includes(tipoEvento.value)) tipoEvento.value = xs[0] ?? null;
  },
  { immediate: true },
);
const opcoesEvento = computed(() =>
  registraveis.value.map((x) => ({ valor: x as TipoEventoContrato | null, rotulo: rotuloEvento(x) })),
);
const ev = reactive({
  valor: '',
  novoFim: '',
  numeroTermo: '',
  descricao: '',
  percentual: '',
  data: '',
  documento: '',
});
watch(
  () => props.hoje,
  (h) => {
    if (h && !ev.data) ev.data = h;
  },
  { immediate: true },
);
const avisoAcrescimo = computed(() => {
  const x = c.value;
  if (!x || tipoEvento.value !== 'aditivo') return null;
  const v = lerDinheiro(ev.valor) ?? 0;
  const soma = x.saldoDetalhe.aditivos + (v > 0 ? v : 0);
  return acrescimoAcimaDoLimite(x.valorInicial, soma)
    ? k('registrar.avisoAcrescimo', { p: pct((soma / x.valorInicial) * 100) })
    : null;
});
const previaReajuste = computed(() => {
  const x = c.value;
  const p = lerDinheiro(ev.percentual);
  if (!x || tipoEvento.value !== 'reajuste' || !p) return null;
  const base = x.saldoDetalhe.valorInicial + x.saldoDetalhe.aditivos + x.saldoDetalhe.reajustes;
  return k('registrar.previaReajuste', { valor: reais(x.saldoDetalhe.valorTotal + (base * p) / 100) });
});
const docNum = (s: string) => (s.trim() ? Number(s.trim()) : null);
function corpoEvento(tipo: TipoEventoContrato): Record<string, unknown> & { tipo: string } {
  const versao = c.value!.versao;
  const desc = ev.descricao.trim();
  switch (tipo) {
    case 'aditivo':
      return {
        tipo,
        versao,
        valor: lerDinheiro(ev.valor) ?? 0,
        novoFim: ev.novoFim || null,
        numeroTermo: ev.numeroTermo,
        descricao: desc,
        documento: docNum(ev.documento),
      };
    case 'reajuste':
      return { tipo, versao, percentual: lerDinheiro(ev.percentual) ?? 0, data: ev.data, descricao: desc };
    case 'renovacao':
      return {
        tipo,
        versao,
        novoFim: ev.novoFim,
        valor: lerDinheiro(ev.valor) ?? 0,
        numeroTermo: ev.numeroTermo,
        descricao: desc,
        documento: docNum(ev.documento),
      };
    case 'anexo':
      return { tipo, versao, documento: docNum(ev.documento), descricao: desc };
    case 'excecao':
      return { tipo, versao, descricao: desc };
    case 'encerramento':
      return { tipo, versao, data: ev.data, descricao: desc };
    default:
      return { tipo, versao, data: ev.data, descricao: desc, documento: docNum(ev.documento) };
  }
}
let chaveEvento = novaChaveContrato('evento');
async function registrarEvento(): Promise<void> {
  const tipo = tipoEvento.value;
  if (!tipo || !c.value) return;
  const ok = await executar(() => registrarEventoContratoTela(props.id, corpoEvento(tipo), chaveEvento));
  if (ok) {
    chaveEvento = novaChaveContrato('evento');
    Object.assign(ev, {
      valor: '',
      novoFim: '',
      numeroTermo: '',
      descricao: '',
      percentual: '',
      documento: '',
    });
  }
}
const usa = (campos: TipoEventoContrato[]) => !!tipoEvento.value && campos.includes(tipoEvento.value);

// ── Avaliação ───────────────────────────────────────────────────────────────────────────────────────────────

const notas = reactive<Record<CriterioAvaliacao, number>>({
  qualidade: 5,
  prazo: 5,
  atendimento: 5,
  documentacao: 5,
});
const avaliacao = reactive({ data: '', descricao: '' });
watch(
  () => props.hoje,
  (h) => {
    if (h && !avaliacao.data) avaliacao.data = h;
  },
  { immediate: true },
);
const opcoesNota = [1, 2, 3, 4, 5].map((n) => ({ valor: n, rotulo: String(n) }));
const previaAvaliacao = computed(() => {
  const r = avaliarFornecedor(notas);
  return k('avaliacao.previa', { resultado: rotuloResultado(r.resultado), media: pct(r.media) });
});
let chaveAvaliacao = novaChaveContrato('avaliacao');
async function avaliar(): Promise<void> {
  if (!c.value) return;
  const ok = await executar(() =>
    registrarEventoContratoTela(
      props.id,
      {
        tipo: 'avaliacao',
        versao: c.value!.versao,
        data: avaliacao.data,
        notas: { ...notas },
        descricao: avaliacao.descricao.trim(),
      },
      chaveAvaliacao,
    ),
  );
  if (ok) {
    chaveAvaliacao = novaChaveContrato('avaliacao');
    avaliacao.descricao = '';
  }
}

// ── Pedidos e títulos ligados ───────────────────────────────────────────────────────────────────────────────

const candidatos = ref<readonly CandidatoVinculo[] | null>(null);
async function procurarCandidatos(): Promise<void> {
  erro.value = null;
  try {
    candidatos.value = (await lerCandidatosContrato(props.id)).itens;
  } catch (e) {
    erro.value = e;
  }
}
const precisaExcecao = computed(() => !!c.value && foraDaVigencia(c.value.faixa));
const excecoes = computed(() => (c.value ? excecoesDisponiveis(c.value.eventos, props.hoje) : []));
const excecao = ref<number | null>(null);
const opcoesExcecao = computed(() => [
  { valor: null as number | null, rotulo: k('vinculos.semExcecao') },
  ...excecoes.value.map((e) => ({
    valor: e.id as number | null,
    rotulo: `${diaHora(e.criadoEm)} · ${e.usuario} · ${(e.descricao ?? '').slice(0, 60)}`,
  })),
]);
// Regra 6: o título que paga um pedido já ligado a este contrato informa o pedido de origem e não abate o saldo de novo.
const pedidosLigados = computed(() =>
  c.value ? c.value.vinculos.filter((v) => v.tipo === 'pedido' && v.ativo) : [],
);
const origem = ref<number | null>(null);
const opcoesOrigem = computed(() => [
  { valor: null as number | null, rotulo: k('vinculos.semOrigem') },
  ...pedidosLigados.value.map((v) => ({
    valor: v.id as number | null,
    rotulo: k('vinculos.opcaoOrigem', { pedido: v.chaveNatural, valor: reais(v.valor) }),
  })),
]);
const haTituloCandidato = computed(() => !!candidatos.value?.some((x) => x.tipo === 'titulo'));
async function ligar(x: CandidatoVinculo): Promise<void> {
  const ok = await executar(() =>
    vincularContratoTela(props.id, {
      tipo: x.tipo,
      ids: x.ids,
      excecao: precisaExcecao.value ? excecao.value : null,
      ...(x.tipo === 'titulo' ? { pedidoDeOrigem: origem.value } : {}),
    }),
  );
  if (ok) {
    excecao.value = null;
    origem.value = null;
    await procurarCandidatos();
  }
}
function situacaoVinculo(v: { ativo: boolean; pedidoDeOrigem: number | null }): string {
  if (!v.ativo) return k('vinculos.inativo');
  if (v.pedidoDeOrigem !== null) return k('vinculos.deOrigem');
  return k('vinculos.ativo');
}

// ── Cadastro ────────────────────────────────────────────────────────────────────────────────────────────────

async function cadastroGravado(_id: number, m: string): Promise<void> {
  mensagem.value = m;
  await consulta.refetch();
  emit('mudou');
  aba.value = 'resumo';
}
const tid = (s: string) => `ctr-det-${s}`;
</script>

<template>
  <section class="detalhe-contrato" aria-labelledby="ctr-det-titulo" :data-testid="tid('painel')">
    <ErroSuprimentos v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!c" role="status">{{ k('carregando') }}</p>
    <template v-else>
      <div class="barra">
        <h2 id="ctr-det-titulo">{{ c.numero }} · {{ c.fornecedorNome }}</h2>
        <SanteBotao
          variante="secundario"
          :rotulo="k('fechar')"
          :data-testid="tid('fechar')"
          @acionar="emit('fechar')"
        />
      </div>
      <div class="abas" role="tablist">
        <SanteBotao
          v-for="a in abas"
          :key="a"
          role="tab"
          :aria-selected="aba === a"
          variante="secundario"
          :rotulo="k(`detalhe.abas.${a}`)"
          :data-testid="tid(`aba-${a}`)"
          @acionar="aba = a"
        />
      </div>
      <p v-if="mensagem" role="status" :data-testid="tid('mensagem')">{{ mensagem }}</p>
      <ErroSuprimentos v-if="erro" :erro="erro" />
      <SanteAlerta
        v-if="!c.gravacao.ligada"
        variante="aviso"
        :texto="c.gravacao.motivo ?? k('emConsulta')"
        :data-testid="tid('desligado')"
      />
      <SanteAlerta
        v-for="a in c.avisos"
        :key="a.codigo"
        variante="aviso"
        :texto="a.mensagem"
        :data-testid="tid(`aviso-${a.codigo}`)"
      />

      <!-- Resumo e saldo -->
      <template v-if="aba === 'resumo'">
        <dl class="resumo-contrato" :data-testid="tid('dados')">
          <div>
            <dt>{{ k('detalhe.tipo') }}</dt>
            <dd>
              {{ rotuloTipoContrato(c.tipo) }}<span v-if="c.critico"> · {{ k('lista.critico') }}</span>
            </dd>
          </div>
          <div>
            <dt>{{ k('detalhe.objeto') }}</dt>
            <dd>{{ c.objeto }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.vigencia') }}</dt>
            <dd :data-testid="tid('vigencia')">
              {{ k('detalhe.vigenciaTexto', { inicio: data(c.inicio), fim: data(c.fim) }) }} ·
              {{ rotuloFaixa(c.faixa) }}
              <span v-if="c.fim !== c.fimOriginal" class="secundario"
                >({{ k('detalhe.fimOriginal', { fim: data(c.fimOriginal) }) }})</span
              >
            </dd>
          </div>
          <div>
            <dt>{{ k('detalhe.situacao') }}</dt>
            <dd>{{ rotuloSituacao(c.situacao) }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.responsaveis') }}</dt>
            <dd>{{ k('lista.responsaveis', { gestor: c.gestor, fiscal: c.fiscal }) }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.indice') }}</dt>
            <dd>
              {{
                c.dataBase
                  ? k('detalhe.indiceTexto', {
                      indice: rotuloIndice(c.indiceReajuste),
                      dataBase: data(c.dataBase),
                    })
                  : rotuloIndice(c.indiceReajuste)
              }}
              <span v-if="c.proximoReajuste">
                · {{ k('detalhe.proximoReajuste') }} {{ data(c.proximoReajuste) }}</span
              >
            </dd>
          </div>
          <div>
            <dt>{{ k('detalhe.garantia') }}</dt>
            <dd>
              {{
                c.garantia === 'nenhuma'
                  ? rotuloGarantia(c.garantia)
                  : k('detalhe.garantiaTexto', {
                      garantia: rotuloGarantia(c.garantia),
                      valor: reais(c.garantiaValor ?? 0),
                      validade: data(c.garantiaValidade),
                    })
              }}
            </dd>
          </div>
          <div v-if="c.centroCusto">
            <dt>{{ k('detalhe.centro') }}</dt>
            <dd>{{ c.centroCusto }} · {{ c.centroCustoNome ?? '—' }}</dd>
          </div>
          <div v-if="c.observacao">
            <dt>{{ k('detalhe.observacao') }}</dt>
            <dd>{{ c.observacao }}</dd>
          </div>
        </dl>
        <p class="secundario">{{ k('detalhe.criado', { usuario: c.criadoPor, em: diaHora(c.criadoEm) }) }}</p>
        <h3>{{ k('detalhe.saldo') }}</h3>
        <table class="grade" :data-testid="tid('saldo')">
          <caption class="secundario">
            {{
              k('detalhe.saldoLegenda')
            }}
          </caption>
          <tbody>
            <tr>
              <th scope="row">{{ k('detalhe.valorInicial') }}</th>
              <td>{{ reais(c.saldoDetalhe.valorInicial) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.aditivos') }}</th>
              <td>{{ reais(c.saldoDetalhe.aditivos) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.reajustes') }}</th>
              <td>{{ reais(c.saldoDetalhe.reajustes) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.renovacoes') }}</th>
              <td>{{ reais(c.saldoDetalhe.renovacoes) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.valorTotal') }}</th>
              <td>
                <strong>{{ reais(c.saldoDetalhe.valorTotal) }}</strong>
              </td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.pedidos') }}</th>
              <td>{{ reais(c.saldoDetalhe.pedidos) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.titulosAvulsos') }}</th>
              <td>{{ reais(c.saldoDetalhe.titulosAvulsos) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.titulosDePedidos') }}</th>
              <td class="secundario">{{ reais(c.saldoDetalhe.titulosDePedidos) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.consumido') }}</th>
              <td>
                {{ reais(c.saldoDetalhe.consumido) }} ({{
                  k('detalhe.percentual', { p: pct(c.saldoDetalhe.percentualConsumido) })
                }})
              </td>
            </tr>
            <tr>
              <th scope="row">{{ k('detalhe.saldoValor') }}</th>
              <td :data-testid="tid('saldo-valor')">
                <strong>{{ reais(c.saldoDetalhe.saldo) }}</strong>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="secundario" :data-testid="tid('saldo-conta')">{{ c.saldoDetalhe.conta }}</p>
        <h3>{{ k('detalhe.avaliacao') }}</h3>
        <p :data-testid="tid('avaliacao')">
          {{
            c.ultimaAvaliacao
              ? k('detalhe.ultimaAvaliacao', {
                  data: data(c.ultimaAvaliacao.data),
                  resultado: rotuloResultado(c.ultimaAvaliacao.resultado),
                  media: pct(c.ultimaAvaliacao.media),
                })
              : k('detalhe.semAvaliacao')
          }}
          · {{ k('detalhe.proximaAvaliacao', { data: data(c.proximaAvaliacao) }) }}
        </p>
      </template>

      <!-- Histórico -->
      <template v-else-if="aba === 'eventos'">
        <p v-if="c.eventos.length === 0">{{ k('eventos.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ k('eventos.colQuando') }}</th>
                <th scope="col">{{ k('eventos.colTipo') }}</th>
                <th scope="col">{{ k('eventos.colData') }}</th>
                <th scope="col">{{ k('eventos.colDetalhe') }}</th>
                <th scope="col">{{ k('eventos.colUsuario') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in c.eventos" :key="e.id" :data-testid="tid(`evento-${e.id}`)" :data-tipo="e.tipo">
                <td>{{ diaHora(e.criadoEm) }}</td>
                <td>{{ rotuloEvento(e.tipo) }}</td>
                <td>{{ data(e.data) }}</td>
                <td>{{ detalheEvento(e) }}</td>
                <td>{{ e.usuario }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- Registrar evento -->
      <form v-else-if="aba === 'registrar'" class="formulario-contrato" @submit.prevent="registrarEvento">
        <p v-if="registraveis.length === 0">{{ k('registrar.semPermissao') }}</p>
        <template v-else>
          <SanteSelecao
            v-model="tipoEvento"
            :rotulo="k('registrar.tipo')"
            :opcoes="opcoesEvento"
            :data-testid="tid('ev-tipo')"
          />
          <p v-if="tipoEvento === 'excecao'" class="secundario">{{ k('registrar.explicaExcecao') }}</p>
          <div class="barra">
            <span v-if="usa(['aditivo', 'renovacao'])" class="campo">
              <label for="ctr-ev-termo">{{ k('registrar.numeroTermo') }}</label>
              <input
                id="ctr-ev-termo"
                v-model="ev.numeroTermo"
                maxlength="30"
                :data-testid="tid('ev-termo')"
              />
            </span>
            <span v-if="usa(['aditivo', 'renovacao'])" class="campo">
              <label for="ctr-ev-valor">{{
                tipoEvento === 'aditivo' ? k('registrar.valorAditivo') : k('registrar.valorRenovacao')
              }}</label>
              <input
                id="ctr-ev-valor"
                v-model="ev.valor"
                inputmode="decimal"
                :data-testid="tid('ev-valor')"
              />
            </span>
            <span v-if="usa(['aditivo', 'renovacao'])" class="campo">
              <label for="ctr-ev-fim">{{
                tipoEvento === 'aditivo' ? k('registrar.novoFimOpcional') : k('registrar.novoFim')
              }}</label>
              <input id="ctr-ev-fim" v-model="ev.novoFim" type="date" :data-testid="tid('ev-fim')" />
            </span>
            <span v-if="usa(['reajuste'])" class="campo">
              <label for="ctr-ev-pct">{{ k('registrar.percentual') }}</label>
              <input
                id="ctr-ev-pct"
                v-model="ev.percentual"
                inputmode="decimal"
                :data-testid="tid('ev-pct')"
              />
            </span>
            <span v-if="usa(['reajuste', 'ocorrencia', 'encerramento', 'rescisao'])" class="campo">
              <label for="ctr-ev-data">{{
                tipoEvento === 'reajuste' ? k('registrar.dataReajuste') : k('registrar.data')
              }}</label>
              <input id="ctr-ev-data" v-model="ev.data" type="date" :data-testid="tid('ev-data')" />
            </span>
            <span v-if="usa(['aditivo', 'renovacao', 'ocorrencia', 'anexo', 'rescisao'])" class="campo">
              <label for="ctr-ev-doc">{{
                tipoEvento === 'anexo' ? k('registrar.documento') : k('registrar.documentoOpcional')
              }}</label>
              <input
                id="ctr-ev-doc"
                v-model="ev.documento"
                inputmode="numeric"
                maxlength="16"
                :data-testid="tid('ev-doc')"
              />
            </span>
          </div>
          <span class="campo campo-largo">
            <label for="ctr-ev-desc">
              {{
                tipoEvento === 'excecao'
                  ? k('registrar.justificativa')
                  : tipoEvento === 'rescisao'
                    ? k('registrar.motivoRescisao')
                    : k('registrar.descricao')
              }}
            </label>
            <textarea
              id="ctr-ev-desc"
              v-model="ev.descricao"
              maxlength="1000"
              rows="3"
              :data-testid="tid('ev-desc')"
            />
          </span>
          <SanteAlerta
            v-if="avisoAcrescimo"
            variante="aviso"
            :texto="avisoAcrescimo"
            :data-testid="tid('ev-acrescimo')"
          />
          <p v-if="previaReajuste" class="secundario" :data-testid="tid('ev-previa')">{{ previaReajuste }}</p>
          <SanteBotao
            tipo="submit"
            :rotulo="k('registrar.gravar')"
            :desabilitado="enviando || !tipoEvento"
            :data-testid="tid('ev-gravar')"
          />
        </template>
      </form>

      <!-- Avaliação do fornecedor -->
      <form v-else-if="aba === 'avaliacao'" class="formulario-contrato" @submit.prevent="avaliar">
        <p class="secundario">{{ k('avaliacao.explica') }}</p>
        <div class="barra">
          <span class="campo">
            <label for="ctr-av-data">{{ k('avaliacao.data') }}</label>
            <input id="ctr-av-data" v-model="avaliacao.data" type="date" :data-testid="tid('av-data')" />
          </span>
          <SanteSelecao
            v-for="cr in CRITERIOS_AVALIACAO_FORNECEDOR"
            :key="cr.codigo"
            v-model="notas[cr.codigo]"
            :rotulo="k('avaliacao.nota', { criterio: cr.rotulo })"
            :opcoes="opcoesNota"
            :data-testid="tid(`av-${cr.codigo}`)"
          />
        </div>
        <span class="campo campo-largo">
          <label for="ctr-av-obs">{{ k('avaliacao.observacao') }}</label>
          <textarea
            id="ctr-av-obs"
            v-model="avaliacao.descricao"
            maxlength="1000"
            rows="2"
            :data-testid="tid('av-obs')"
          />
        </span>
        <p role="status" :data-testid="tid('av-previa')">{{ previaAvaliacao }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="k('avaliacao.gravar')"
          :desabilitado="enviando || !podeAvaliar"
          :data-testid="tid('av-gravar')"
        />
      </form>

      <!-- Pedidos e títulos ligados -->
      <template v-else-if="aba === 'vinculos'">
        <p v-if="c.vinculos.length === 0">{{ k('vinculos.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ k('vinculos.colTipo') }}</th>
                <th scope="col">{{ k('vinculos.colDocumento') }}</th>
                <th scope="col">{{ k('vinculos.colValor') }}</th>
                <th scope="col">{{ k('vinculos.colSituacao') }}</th>
                <th scope="col">{{ k('vinculos.colUsuario') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in c.vinculos" :key="v.id" :data-testid="tid(`vinculo-${v.id}`)">
                <td>
                  {{ rotuloVinculo(v.tipo)
                  }}<span v-if="v.excecao" class="secundario"> · {{ k('vinculos.comExcecao') }}</span>
                </td>
                <td>{{ v.chaveNatural }}</td>
                <td>{{ reais(v.valor) }}</td>
                <td>{{ situacaoVinculo(v) }}</td>
                <td>{{ v.usuario }} · {{ diaHora(v.criadoEm) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-if="podeEditar">
          <h3>{{ k('vinculos.candidatos') }}</h3>
          <SanteBotao
            variante="secundario"
            :rotulo="k('vinculos.carregarCandidatos')"
            :data-testid="tid('candidatos')"
            @acionar="procurarCandidatos"
          />
          <template v-if="precisaExcecao">
            <SanteAlerta
              variante="aviso"
              :texto="k('vinculos.precisaExcecao')"
              :data-testid="tid('precisa-excecao')"
            />
            <SanteSelecao
              v-model="excecao"
              :rotulo="k('vinculos.excecao')"
              :opcoes="opcoesExcecao"
              :data-testid="tid('excecao')"
            />
          </template>
          <template v-if="haTituloCandidato && pedidosLigados.length > 0">
            <SanteSelecao
              v-model="origem"
              :rotulo="k('vinculos.origem')"
              :opcoes="opcoesOrigem"
              :data-testid="tid('origem')"
            />
            <p class="secundario">{{ k('vinculos.explicaOrigem') }}</p>
          </template>
          <p v-if="candidatos && candidatos.length === 0" role="status">{{ k('vinculos.semCandidatos') }}</p>
          <div v-else-if="candidatos" class="rolagem">
            <table class="grade">
              <thead>
                <tr>
                  <th scope="col">{{ k('vinculos.colTipo') }}</th>
                  <th scope="col">{{ k('vinculos.colDocumento') }}</th>
                  <th scope="col">{{ k('vinculos.colData') }}</th>
                  <th scope="col">{{ k('vinculos.colValor') }}</th>
                  <th scope="col">{{ k('vinculos.colDescricao') }}</th>
                  <th scope="col">{{ k('lista.colAcoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="x in candidatos"
                  :key="`${x.tipo}:${x.ids.join(',')}`"
                  :data-testid="tid(`candidato-${x.tipo}-${x.ids[0]}`)"
                >
                  <td>{{ rotuloVinculo(x.tipo) }}</td>
                  <td>{{ x.chaveNatural }}</td>
                  <td>{{ data(x.data) }}</td>
                  <td>{{ reais(x.valor) }}</td>
                  <td>{{ x.descricao }}</td>
                  <td>
                    <SanteBotao
                      variante="secundario"
                      :rotulo="k('vinculos.ligar', { chave: x.chaveNatural })"
                      :desabilitado="enviando || (precisaExcecao && excecao === null)"
                      :data-testid="tid(`ligar-${x.tipo}-${x.ids[0]}`)"
                      @acionar="ligar(x)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>

      <!-- SLA (09-AREA linha 88) -->
      <SlaContratoPainel
        v-else-if="aba === 'sla'"
        :contrato="c.id"
        :pode-editar="podeEditar"
        :pode-avaliar="podeAvaliar"
      />

      <!-- Cadastro -->
      <ContratoFormulario
        v-else
        :key="c.versao"
        :contrato="c"
        :pode="podeEditar"
        @gravado="cadastroGravado"
        @cancelar="aba = 'resumo'"
      />
    </template>
  </section>
</template>
