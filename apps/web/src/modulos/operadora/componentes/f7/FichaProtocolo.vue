<script setup lang="ts">
// Ficha do protocolo de atendimento (M56, etapa 8, F7): a demanda (instância, natureza e classe, canal e origem, quem
// fez o contato, beneficiário, pedido de autorização, reanálise de origem e as pedidas, número na ANS), o prazo (com a
// prorrogação da ouvidoria), a resposta conclusiva com o fundamento, a resposta por escrito (pedida, prazo e envio, com o
// texto pronto para imprimir), o histórico e só as ações que valem agora (`acoes` do servidor). Cada ação abre o diálogo
// com os campos dela; a recusa do servidor volta com o texto.
import {
  type ApoioProtocolos,
  CONCLUSOES_PROTOCOLO,
  MEIOS_ESCRITOS_PROTOCOLO,
  MEIOS_RESPOSTA_PROTOCOLO,
  type ProtocoloDetalhe,
  type ResultadoProtocoloOpe,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import {
  type AcaoDaFicha,
  agirNoProtocolo,
  lerProtocolo,
  urlAnexoRespostaPrestador,
} from '../../api-atendimento.js';

const props = defineProps<{ id: number; apoio: ApoioProtocolos; podeRegistrar: boolean }>();
const emit = defineEmits<{ gravado: [r: ResultadoProtocoloOpe]; abrir: [id: number]; fechar: [] }>();
const { t } = useI18n();

const ficha = useQuery({
  queryKey: computed(() => ['operadora', 'protocolos', 'ficha', props.id]),
  queryFn: () => lerProtocolo(props.id),
});

const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: string | null) => (d ? `${data(d)} ${d.slice(11, 16)}`.trim() : '—');
const origemRotulo = (codigo: number) =>
  props.apoio.dominios.origem.find((o) => o.codigo === codigo)?.rotulo ?? String(codigo);
function prazoTexto(p: ProtocoloDetalhe): string {
  const x = props.apoio.parametros;
  const dias: Record<string, number> = {
    assistencial: x.diasUteisAssistencial,
    complexo: x.diasUteisComplexo,
    'nao-assistencial': x.diasUteisNaoAssistencial,
    ouvidoria: x.diasUteisOuvidoria,
    'nip-assistencial': x.diasUteisNipAssistencial,
    'nip-nao-assistencial': x.diasUteisNipNaoAssistencial,
  };
  return `${quando(p.prazoOriginalEm)} · ${t(`operadoraAtendimento.prazos.${p.prazoTipo}`, {
    dias: dias[p.prazoTipo] ?? 0,
    maximo: x.diasUteisOuvidoriaMaximo,
  })}`;
}

// ── Diálogo das ações ─────────────────────────────────────────────────────────────────────────
const acao = ref<AcaoDaFicha | null>(null);
const visivel = computed({
  get: () => acao.value !== null,
  set: (v: boolean) => {
    if (!v) acao.value = null;
  },
});
const d = reactive({
  texto: '',
  ate: null as string | null,
  conclusao: null as (typeof CONCLUSOES_PROTOCOLO)[number] | null,
  fundamento: '',
  meio: 'telefone' as (typeof MEIOS_RESPOSTA_PROTOCOLO)[number],
  meioEscrita: 'email' as 'email' | 'correspondencia' | 'portal',
  canal: 'telefone' as 'telefone' | 'presencial' | 'eletronico',
  origem: null as number | null,
  escritaPedida: false,
});
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

function abrirAcao(a: AcaoDaFicha): void {
  Object.assign(d, {
    texto: '',
    ate: null,
    conclusao: null,
    fundamento: '',
    meio: 'telefone',
    meioEscrita: 'email',
    canal: 'telefone',
    origem: props.apoio.dominios.origem[0]?.codigo ?? null,
    escritaPedida: false,
  });
  recusa.value = null;
  erro.value = null;
  acao.value = a;
}

const opcoesConclusao = computed(() => [
  { valor: null, rotulo: t('operadoraAtendimento.form.escolha') },
  ...CONCLUSOES_PROTOCOLO.map((c) => ({ valor: c, rotulo: t(`operadoraAtendimento.conclusoes.${c}`) })),
]);
const opcoesMeio = computed(() =>
  MEIOS_RESPOSTA_PROTOCOLO.map((m) => ({ valor: m, rotulo: t(`operadoraAtendimento.meios.${m}`) })),
);
const opcoesMeioEscrita = computed(() =>
  MEIOS_ESCRITOS_PROTOCOLO.map((m) => ({
    valor: m as 'email' | 'correspondencia' | 'portal',
    rotulo: t(`operadoraAtendimento.meios.${m}`),
  })),
);
const opcoesCanal = computed(() =>
  (['telefone', 'presencial', 'eletronico'] as const).map((c) => ({
    valor: c,
    rotulo: t(`operadoraAtendimento.canais.${c}`),
  })),
);
const opcoesOrigem = computed(() =>
  props.apoio.dominios.origem.map((o) => ({ valor: o.codigo as number | null, rotulo: o.rotulo })),
);

const precisaFundamento = computed(() => d.conclusao === 'desfavoravel' || d.conclusao === 'parcial');
const completo = computed(() => {
  switch (acao.value) {
    case 'interagir':
      return d.texto.trim().length >= 5;
    case 'prorrogar':
      return !!d.ate && d.texto.trim().length >= 10;
    case 'responder':
      return (
        d.conclusao !== null &&
        d.texto.trim().length >= 20 &&
        (!precisaFundamento.value || d.fundamento.trim().length >= 5)
      );
    case 'cancelar':
      return d.texto.trim().length >= 10;
    case 'reanalise':
      return d.origem !== null && d.texto.trim().length >= 10;
    default:
      return acao.value !== null;
  }
});

function corpo(p: ProtocoloDetalhe): Record<string, unknown> {
  const v = { versao: p.versao };
  switch (acao.value) {
    case 'interagir':
      return { ...v, texto: d.texto };
    case 'prorrogar':
      return { ...v, ate: d.ate, motivo: d.texto };
    case 'responder':
      return {
        ...v,
        conclusao: d.conclusao,
        resposta: d.texto,
        ...(d.fundamento.trim() ? { fundamento: d.fundamento } : {}),
        meio: d.meio,
      };
    case 'enviarEscrita':
      return { ...v, meio: d.meioEscrita };
    case 'cancelar':
      return { ...v, motivo: d.texto };
    case 'reanalise':
      return { ...v, canal: d.canal, origem: d.origem, relato: d.texto, escritaPedida: d.escritaPedida };
    default:
      return v;
  }
}

async function confirmar(): Promise<void> {
  const p = ficha.data.value;
  const a = acao.value;
  if (!p || !a || !completo.value || gravando.value) return;
  recusa.value = null;
  erro.value = null;
  gravando.value = true;
  try {
    const r = await agirNoProtocolo(p.id, a, corpo(p));
    acao.value = null;
    emit('gravado', r);
    if (a === 'reanalise') emit('abrir', r.id);
    else await ficha.refetch();
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const rotuloTexto = computed(() => {
  if (acao.value === 'interagir') return t('operadoraAtendimento.dialogo.texto');
  if (acao.value === 'prorrogar') return t('operadoraAtendimento.dialogo.motivoProrrogacao');
  if (acao.value === 'responder') return t('operadoraAtendimento.dialogo.resposta');
  if (acao.value === 'reanalise') return t('operadoraAtendimento.dialogo.relatoReanalise');
  return t('operadoraAtendimento.dialogo.motivo');
});
const comTexto = computed(() =>
  ['interagir', 'prorrogar', 'responder', 'cancelar', 'reanalise'].includes(acao.value ?? ''),
);
const aviso = computed(() => {
  if (acao.value === 'analisar') return t('operadoraAtendimento.dialogo.analisar');
  if (acao.value === 'pedirEscrita')
    return t('operadoraAtendimento.dialogo.pedirEscrita', { horas: props.apoio.parametros.horasEscrita });
  if (acao.value === 'encerrar') return t('operadoraAtendimento.dialogo.encerrar');
  return null;
});
const imprimir = () => window.print();
</script>

<template>
  <section class="bloco" aria-labelledby="prot-ficha-titulo" data-testid="prot-ficha">
    <MensagemErro v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('operadoraAtendimento.carregando') }}</p>
    <template v-else>
      <div class="acoes">
        <h3 id="prot-ficha-titulo">
          {{ t('operadoraAtendimento.ficha.titulo', { protocolo: ficha.data.value.protocolo }) }}
        </h3>
        <span data-testid="prot-ficha-situacao"
          >· {{ t(`operadoraAtendimento.situacoes.${ficha.data.value.situacao}`) }}</span
        >
        <span v-if="ficha.data.value.vencido" class="alerta">· {{ t('operadoraAtendimento.vencido') }}</span>
        <SanteBotao
          variante="texto"
          :rotulo="t('operadoraAtendimento.fechar')"
          data-testid="prot-ficha-fechar"
          @acionar="emit('fechar')"
        />
      </div>

      <div v-if="podeRegistrar && ficha.data.value.acoes.length" class="acoes" data-testid="prot-acoes">
        <SanteBotao
          v-for="a in ficha.data.value.acoes"
          :key="a"
          :variante="a === 'cancelar' ? 'secundario' : 'primario'"
          :rotulo="t(`operadoraAtendimento.acoes.${a}`)"
          :data-testid="`prot-acao-${a}`"
          @acionar="abrirAcao(a)"
        />
      </div>

      <dl class="ficha">
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.instancia') }}</dt>
          <dd>{{ t(`operadoraAtendimento.instancias.${ficha.data.value.instancia}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.natureza') }}</dt>
          <dd>
            {{ t(`operadoraAtendimento.naturezas.${ficha.data.value.natureza}`) }} ·
            {{ t(`operadoraAtendimento.classes.${ficha.data.value.classe}`) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.canal') }}</dt>
          <dd>
            {{ t(`operadoraAtendimento.canais.${ficha.data.value.canal}`) }} ·
            {{ ficha.data.value.origemRotulo || origemRotulo(ficha.data.value.origem) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.solicitante') }}</dt>
          <dd>
            {{ t(`operadoraAtendimento.solicitantes.${ficha.data.value.solicitante}`) }}
            <template v-if="ficha.data.value.solicitanteNome">
              · {{ ficha.data.value.solicitanteNome }}</template
            >
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.beneficiario') }}</dt>
          <dd>
            {{ ficha.data.value.beneficiarioNome ?? t('operadoraAtendimento.semBeneficiario') }}
            <template v-if="ficha.data.value.carteirinha"> · {{ ficha.data.value.carteirinha }}</template>
          </dd>
        </div>
        <div v-if="ficha.data.value.autorizacao">
          <dt>{{ t('operadoraAtendimento.ficha.autorizacao') }}</dt>
          <dd data-testid="prot-ficha-autorizacao">
            {{ ficha.data.value.autorizacao.protocolo }} ·
            {{ t(`operadoraAutorizacao.situacoes.${ficha.data.value.autorizacao.situacao}`) }}
          </dd>
        </div>
        <div v-if="ficha.data.value.origemProtocolo">
          <dt>{{ t('operadoraAtendimento.ficha.origemProtocolo') }}</dt>
          <dd>
            <a
              href="#"
              data-testid="prot-ficha-origem"
              @click.prevent="emit('abrir', ficha.data.value.origemProtocolo.id)"
              >{{ ficha.data.value.origemProtocolo.protocolo }}</a
            >
          </dd>
        </div>
        <div v-if="ficha.data.value.reanalises.length">
          <dt>{{ t('operadoraAtendimento.ficha.reanalises') }}</dt>
          <dd>
            <span v-for="r in ficha.data.value.reanalises" :key="r.id">
              <a
                href="#"
                :data-testid="`prot-ficha-reanalise-${r.id}`"
                @click.prevent="emit('abrir', r.id)"
                >{{ r.protocolo }}</a
              >
              ({{ t(`operadoraAtendimento.situacoes.${r.situacao}`) }})
            </span>
          </dd>
        </div>
        <div v-if="ficha.data.value.numeroNip">
          <dt>{{ t('operadoraAtendimento.ficha.numeroNip') }}</dt>
          <dd>{{ ficha.data.value.numeroNip }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.marcas') }}</dt>
          <dd>
            <template v-if="ficha.data.value.urgente || ficha.data.value.altaComplexidade">
              {{
                [
                  ficha.data.value.urgente ? t('operadoraAtendimento.ficha.urgente') : '',
                  ficha.data.value.altaComplexidade ? t('operadoraAtendimento.ficha.complexo') : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              }}
            </template>
            <template v-else>{{ t('operadoraAtendimento.ficha.nenhuma') }}</template>
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.abertoEm') }}</dt>
          <dd>{{ quando(ficha.data.value.abertoEm) }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraAtendimento.ficha.prazo') }}</dt>
          <dd data-testid="prot-ficha-prazo">
            {{ prazoTexto(ficha.data.value) }}
            <template v-if="ficha.data.value.prorrogadoAte">
              <br />
              {{
                t('operadoraAtendimento.ficha.prorrogado', {
                  ate: data(ficha.data.value.prorrogadoAte),
                  motivo: ficha.data.value.prorrogacaoMotivo ?? '',
                })
              }}
            </template>
          </dd>
        </div>
        <div v-if="ficha.data.value.encerradoEm">
          <dt>{{ t('operadoraAtendimento.ficha.encerradoEm') }}</dt>
          <dd>{{ quando(ficha.data.value.encerradoEm) }}</dd>
        </div>
        <div v-if="ficha.data.value.motivoCancelamento">
          <dt>{{ t('operadoraAtendimento.ficha.motivoCancelamento') }}</dt>
          <dd>{{ ficha.data.value.motivoCancelamento }}</dd>
        </div>
      </dl>

      <h4>{{ t('operadoraAtendimento.ficha.assunto') }}: {{ ficha.data.value.assunto }}</h4>
      <p class="pre">{{ ficha.data.value.relato }}</p>

      <template v-if="ficha.data.value.conclusao">
        <h4>
          {{ t('operadoraAtendimento.ficha.resposta') }}:
          <span data-testid="prot-ficha-conclusao">{{
            t(`operadoraAtendimento.conclusoes.${ficha.data.value.conclusao}`)
          }}</span>
        </h4>
        <p class="pre">{{ ficha.data.value.resposta }}</p>
        <p v-if="ficha.data.value.fundamento">
          <strong>{{ t('operadoraAtendimento.ficha.fundamento') }}:</strong> {{ ficha.data.value.fundamento }}
        </p>
        <p class="secundario">
          {{
            t('operadoraAtendimento.ficha.respondido', {
              em: quando(ficha.data.value.respondidoEm),
              por: ficha.data.value.respondidoPor ?? '—',
              meio: ficha.data.value.meio ? t(`operadoraAtendimento.meios.${ficha.data.value.meio}`) : '—',
            })
          }}
        </p>
      </template>

      <h4>{{ t('operadoraAtendimento.ficha.escrita') }}</h4>
      <p data-testid="prot-ficha-escrita">
        <template v-if="!ficha.data.value.escritaPedida">{{
          t('operadoraAtendimento.ficha.escritaNaoPedida')
        }}</template>
        <template v-else>
          {{
            t('operadoraAtendimento.ficha.escritaPedidaEm', {
              em: quando(ficha.data.value.escritaPedidaEm),
              prazo: quando(ficha.data.value.escritaPrazoEm),
            })
          }}
          <template v-if="ficha.data.value.escritaEnviadaEm">
            ·
            {{
              t('operadoraAtendimento.ficha.escritaEnviadaEm', {
                em: quando(ficha.data.value.escritaEnviadaEm),
                meio: ficha.data.value.escritaMeio
                  ? t(`operadoraAtendimento.meios.${ficha.data.value.escritaMeio}`)
                  : '—',
              })
            }}
          </template>
          <span v-else-if="ficha.data.value.escritaVencida" class="alerta">
            · {{ t('operadoraAtendimento.escritaVencida') }}</span
          >
        </template>
      </p>
      <template v-if="ficha.data.value.textoEscrito">
        <div class="acoes">
          <h4>{{ t('operadoraAtendimento.ficha.textoEscrito') }}</h4>
          <SanteBotao
            variante="secundario"
            :rotulo="t('operadoraAtendimento.imprimir')"
            data-testid="prot-imprimir"
            @acionar="imprimir"
          />
        </div>
        <pre class="comunicado" data-testid="prot-texto-escrito">{{ ficha.data.value.textoEscrito }}</pre>
      </template>

      <template v-if="ficha.data.value.respostasPrestador.length">
        <h4>{{ t('operadoraAtendimento.ficha.respostasPrestador') }}</h4>
        <ul class="respostas-prestador" data-testid="prot-respostas-prestador">
          <li
            v-for="r in ficha.data.value.respostasPrestador"
            :key="r.id"
            :data-testid="`prot-resposta-prestador-${r.id}`"
          >
            {{ quando(r.em) }} · {{ r.texto }}
            <a
              v-if="r.anexo"
              :href="urlAnexoRespostaPrestador(ficha.data.value.id, r.id)"
              :download="r.anexo.nome"
              :data-testid="`prot-resposta-anexo-${r.id}`"
              >{{ t('operadoraAtendimento.ficha.baixar', { nome: r.anexo.nome }) }}</a
            >
          </li>
        </ul>
      </template>

      <h4>{{ t('operadoraAtendimento.ficha.eventos') }}</h4>
      <table class="tabela" data-testid="prot-ficha-eventos">
        <caption class="visualmente-oculto">
          {{
            t('operadoraAtendimento.ficha.eventos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('operadoraAtendimento.ficha.quando') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.ficha.evento') }}</th>
            <th scope="col">{{ t('operadoraAtendimento.ficha.texto') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in ficha.data.value.eventos" :key="e.id">
            <td>{{ quando(e.em) }} · {{ e.por }}</td>
            <td>
              {{ t(`operadoraAtendimento.eventos.${e.evento}`) }} ·
              {{ t(`operadoraAtendimento.situacoes.${e.situacao}`) }}
            </td>
            <td class="pre">{{ e.texto ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="acao ? t(`operadoraAtendimento.acoes.${acao}`) : ''"
      largura="44rem"
    >
      <form
        v-if="acao && ficha.data.value"
        class="formulario"
        data-testid="prot-dialogo"
        @submit.prevent="confirmar"
      >
        <p v-if="aviso">{{ aviso }}</p>
        <template v-if="acao === 'prorrogar'">
          <SanteData
            v-model="d.ate"
            :rotulo="t('operadoraAtendimento.dialogo.ate', { limite: data(ficha.data.value.prorrogavelAte) })"
            editavel
          />
        </template>
        <template v-if="acao === 'responder'">
          <SanteSelecao
            v-model="d.conclusao"
            :rotulo="t('operadoraAtendimento.dialogo.conclusao')"
            :opcoes="opcoesConclusao"
            obrigatorio
            data-testid="prot-conclusao"
          />
          <SanteSelecao
            v-model="d.meio"
            :rotulo="t('operadoraAtendimento.dialogo.meio')"
            :opcoes="opcoesMeio"
            obrigatorio
            data-testid="prot-meio"
          />
        </template>
        <SanteSelecao
          v-if="acao === 'enviarEscrita'"
          v-model="d.meioEscrita"
          :rotulo="t('operadoraAtendimento.dialogo.meioEscrita')"
          :opcoes="opcoesMeioEscrita"
          obrigatorio
          data-testid="prot-meio-escrita"
        />
        <template v-if="acao === 'reanalise'">
          <SanteSelecao
            v-model="d.canal"
            :rotulo="t('operadoraAtendimento.form.canal')"
            :opcoes="opcoesCanal"
            obrigatorio
            data-testid="prot-reanalise-canal"
          />
          <SanteSelecao
            v-model="d.origem"
            :rotulo="t('operadoraAtendimento.form.origem')"
            :opcoes="opcoesOrigem"
            obrigatorio
            data-testid="prot-reanalise-origem"
          />
          <label class="marcar"
            ><input v-model="d.escritaPedida" type="checkbox" data-testid="prot-reanalise-escrita" />
            {{ t('operadoraAtendimento.form.escritaPedida') }}</label
          >
        </template>
        <SanteCampoTexto
          v-if="comTexto"
          id="prot-dialogo-texto"
          v-model="d.texto"
          :rotulo="rotuloTexto"
          :max-bytes="acao === 'responder' ? 4000 : acao === 'reanalise' ? 2000 : 1000"
          multilinha
          obrigatorio
        />
        <SanteCampoTexto
          v-if="acao === 'responder'"
          id="prot-dialogo-fundamento"
          v-model="d.fundamento"
          :rotulo="t('operadoraAtendimento.dialogo.fundamento')"
          :max-bytes="400"
          :obrigatorio="precisaFundamento"
        />
        <div v-if="recusa" role="alert" data-testid="prot-dialogo-recusa">
          <SanteAlerta :texto="recusa" variante="alerta" />
        </div>
        <MensagemErro v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('operadoraAtendimento.dialogo.confirmar')"
            :desabilitado="!completo || gravando"
            data-testid="prot-dialogo-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('operadoraAtendimento.dialogo.voltar')"
            @acionar="acao = null"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.respostas-prestador {
  margin: 0;
  padding-left: 1.25rem;
}
.ficha {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}
.ficha div {
  display: grid;
  gap: 0.125rem;
}
.ficha dt {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
}
.ficha dd {
  margin: 0;
}
.pre {
  white-space: pre-wrap;
  margin: 0;
}
.formulario {
  display: grid;
  gap: 0.75rem;
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
.comunicado {
  white-space: pre-wrap;
  font-family: inherit;
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
}
h3,
h4 {
  margin: 0;
}
</style>
