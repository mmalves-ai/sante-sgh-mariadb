<script setup lang="ts">
// W0-04 (M1, mercado: dispositivos invasivos do paciente): a aba de dispositivos do prontuário. Usa o MESMO registro
// da CCIH (inserção, retirada e o checklist do bundle por turno), com os dias de uso, os dispositivos-dia da
// competência (a mesma conta do denominador) e o alerta de permanência longa (a sonda vesical acima de 48 h sem a
// indicação revisada nas últimas 24 h). Cada gravação abre o diálogo único; o aviso da aba é um só.
// Revisão do W0-04 (regras_governanca: "correção por versão, com justificativa e pelo autor; o cancelado fica
// visível"): a enfermagem corrige e cancela o PRÓPRIO dispositivo e corrige e estorna o PRÓPRIO checklist do turno pela
// aba (o de outro autor, só quem tem a permissão própria, com a senha); a inserção registra o profissional responsável.
import '../../componentes/estilo-qualidade.css';
import './estilo-ccih.css';
import {
  ITENS_BUNDLE,
  MOTIVOS_RETIRADA_DISPOSITIVO,
  rotuloDispositivoInvasivo,
  type TipoDispositivoInvasivo,
  TIPOS_DISPOSITIVO_INVASIVO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import DialogoCorrecao, { type PedidoCorrecao } from '../../componentes/DialogoCorrecao.vue';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import {
  type BundleTela,
  buscarProfissionaisNaAba,
  cancelarDispositivoNaAba,
  corrigirBundleNaAba,
  corrigirDispositivoNaAba,
  type DispositivoDaAba,
  estornarBundleNaAba,
  lerDependentesNaAba,
  lerDispositivosDoPaciente,
  novaChaveCcih,
  registrarBundleNaAba,
  registrarDispositivoNaAba,
  retirarDispositivoNaAba,
} from '../api-ccih.js';
import { instanteLocal } from '../regras-ccih.js';
import ErroCcih from './ErroCcih.vue';

const props = defineProps<{ paciente: number | string }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.aba.${k}`, p ?? {});
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const q = useQuery({
  queryKey: computed(() => ['ccih', 'aba-dispositivos', id.value]),
  queryFn: () => lerDispositivosDoPaciente(id.value),
});
const d = computed(() => q.data.value);
const ativos = computed(() => (d.value?.itens ?? []).filter((x) => x.retiradoEm === null && !x.canceladoEm));
const historico = computed(() =>
  (d.value?.itens ?? []).filter((x) => x.retiradoEm !== null || !!x.canceladoEm),
);
const aviso = ref<string | null>(null);
const rotuloItem = (tipo: string, codigo: string) =>
  ITENS_BUNDLE[tipo as TipoDispositivoInvasivo]?.find((i) => i.codigo === codigo)?.rotulo ?? codigo;

// ── Diálogo único (bundle, novo dispositivo, retirada, correção e cancelamento) ──
type Modo =
  'bundle' | 'novo' | 'retirada' | 'corrigir' | 'cancelar' | 'corrigirBundle' | 'estornarBundle' | null;
/** O autor corrige o próprio registro; o de outro, só com a permissão própria (e o servidor pede a senha). */
const podeMudar = (autor: string) =>
  !!d.value?.podeRegistrar &&
  (autor.trim().toUpperCase() === (d.value?.login ?? '').toUpperCase() || !!d.value?.podeCorrigirDeOutro);

// ── O profissional responsável pela inserção (busca no cadastro; SanteSelecao com busca) ──
const termoResp = ref('');
const candidatos = ref<{ id: number; cod: number; nome: string }[]>([]);
async function buscarResponsavel(): Promise<void> {
  candidatos.value =
    termoResp.value.trim().length >= 2 ? await buscarProfissionaisNaAba(termoResp.value.trim()) : [];
}
const opResponsavel = computed(() => [
  { valor: null as number | null, rotulo: T('semResponsavel') },
  ...candidatos.value.map((p) => ({ valor: p.id as number | null, rotulo: `${p.nome} (${String(p.cod)})` })),
]);
const modo = ref<Modo>(null);
const visivel = ref(false);
const pedido = ref<PedidoCorrecao | null>(null);
const textoFeito = ref('');
const alvo = ref<DispositivoDaAba | null>(null);
const marcados = ref<Record<string, boolean>>({});
const obs = ref('');

function abrirBundle(x: DispositivoDaAba): void {
  const turno = d.value?.turnoAtual;
  if (!turno) return;
  alvo.value = x;
  marcados.value = Object.fromEntries(x.itensBundle.map((k) => [k, false]));
  obs.value = '';
  modo.value = 'bundle';
  textoFeito.value = T('bundleGravado');
  pedido.value = {
    titulo: T('bundleTitulo', {
      turno: T(`turnos.${turno.turno}`),
      data: turno.data.split('-').reverse().join('/'),
    }),
    texto: T('bundleTexto'),
    semJustificativa: true,
    critica: false,
    confirmar: T('confirmarBundle'),
    gravar: () =>
      registrarBundleNaAba(
        x.id,
        {
          data: turno.data,
          turno: turno.turno,
          itens: { ...marcados.value },
          observacao: obs.value.trim() || null,
        },
        novaChaveCcih('bundle'),
      ),
  };
  visivel.value = true;
}

const opTipo = TIPOS_DISPOSITIVO_INVASIVO.map((x) => ({
  valor: x.codigo as TipoDispositivoInvasivo,
  rotulo: x.rotulo,
}));
const novo = reactive({
  tipo: 'sondaVesical' as TipoDispositivoInvasivo,
  sitio: '',
  data: null as string | null,
  hora: null as string | null,
  responsavel: null as number | null,
});
function abrirNovo(): void {
  const i = d.value?.internacao;
  if (!i) return;
  Object.assign(novo, { tipo: 'sondaVesical', sitio: '', data: null, hora: null, responsavel: null });
  termoResp.value = '';
  candidatos.value = [];
  modo.value = 'novo';
  textoFeito.value = T('gravado');
  pedido.value = {
    titulo: T('novoTitulo'),
    semJustificativa: true,
    critica: false,
    confirmar: T('confirmarNovo'),
    gravar: () =>
      registrarDispositivoNaAba(
        {
          internacao: i.internacao,
          tipo: novo.tipo,
          sitio: novo.sitio.trim() || null,
          inseridoEm: instanteLocal(novo.data, novo.hora) ?? '',
          itemPrescricao: null,
          observacao: null,
          responsavel: novo.responsavel,
        },
        novaChaveCcih('aba-dispositivo'),
      ),
  };
  visivel.value = true;
}

const opRetirada = MOTIVOS_RETIRADA_DISPOSITIVO.map((m) => ({ valor: m.codigo as string, rotulo: m.rotulo }));
const ret = reactive({ data: null as string | null, hora: null as string | null, motivo: 'eletiva' });
function abrirRetirada(x: DispositivoDaAba): void {
  alvo.value = x;
  Object.assign(ret, { data: null, hora: null, motivo: 'eletiva' });
  modo.value = 'retirada';
  textoFeito.value = T('retirado');
  pedido.value = {
    titulo: T('retirarTitulo'),
    semJustificativa: true,
    critica: false,
    confirmar: T('confirmarRetirada'),
    gravar: () =>
      retirarDispositivoNaAba(
        x.id,
        {
          versao: x.versao,
          retiradoEm: instanteLocal(ret.data, ret.hora) ?? '',
          motivo: ret.motivo,
          observacao: null,
        },
        novaChaveCcih('aba-retirada'),
      ),
  };
  visivel.value = true;
}

// ── Corrigir e cancelar o próprio dispositivo ──
const dia = (t0: string) => t0.slice(0, 10);
const hora = (t0: string) => t0.slice(11, 16);
const cor = reactive({
  tipo: 'sondaVesical' as TipoDispositivoInvasivo,
  sitio: '',
  data: null as string | null,
  hora: null as string | null,
  responsavel: null as number | null,
});
function abrirCorrecao(x: DispositivoDaAba): void {
  alvo.value = x;
  Object.assign(cor, {
    tipo: x.tipo,
    sitio: x.sitio ?? '',
    data: dia(x.inseridoEm),
    hora: hora(x.inseridoEm),
    responsavel: x.responsavel?.registro ?? null,
  });
  termoResp.value = '';
  candidatos.value = x.responsavel
    ? [{ id: x.responsavel.registro, cod: x.responsavel.registro, nome: x.responsavel.nome }]
    : [];
  modo.value = 'corrigir';
  textoFeito.value = t('qualidade.correcao.gravado');
  pedido.value = {
    titulo: T('corrigirTitulo'),
    texto: T('corrigirTexto'),
    critica: false,
    confirmar: T('confirmarCorrecao'),
    gravar: ({ justificativa, senha }) =>
      corrigirDispositivoNaAba(
        x.id,
        {
          versao: x.versao,
          tipo: cor.tipo,
          sitio: cor.sitio.trim() || null,
          inseridoEm: instanteLocal(cor.data, cor.hora) ?? '',
          retiradoEm: null,
          responsavel: cor.responsavel,
          justificativa,
          ...(senha ? { senha } : {}),
        },
        novaChaveCcih('aba-correcao'),
      ),
  };
  visivel.value = true;
}
async function abrirCancelamento(x: DispositivoDaAba): Promise<void> {
  alvo.value = x;
  modo.value = 'cancelar';
  textoFeito.value = t('qualidade.correcao.cancelado');
  const base: PedidoCorrecao = {
    titulo: T('cancelarTitulo'),
    texto: T('cancelarTexto'),
    alerta: t('qualidade.correcao.dependentes.carregando'),
    critica: true,
    impedido: true,
    confirmar: T('confirmarCancelamento'),
    gravar: (m) => cancelarDispositivoNaAba(x.id, x.versao, m, novaChaveCcih('aba-cancelamento')),
  };
  pedido.value = base;
  visivel.value = true;
  const dep = await lerDependentesNaAba(x.id);
  pedido.value = {
    ...base,
    impedido: !dep.podeCancelar,
    alerta: dep.podeCancelar
      ? undefined
      : [
          t('qualidade.correcao.dependentes.impedem'),
          ...dep.itens.map((i) =>
            t('qualidade.correcao.dependentes.item', {
              grupo: i.grupo,
              n: i.quantidade,
              ids: i.ids.join(', '),
            }),
          ),
        ].join(' '),
  };
}

// ── Corrigir e estornar o próprio checklist do turno ──
const alvoBundle = ref<BundleTela | null>(null);
function abrirCorrecaoBundle(x: DispositivoDaAba, b: BundleTela): void {
  alvo.value = x;
  alvoBundle.value = b;
  marcados.value = Object.fromEntries(x.itensBundle.map((k) => [k, b.itens[k] === true]));
  obs.value = b.observacao ?? '';
  modo.value = 'corrigirBundle';
  textoFeito.value = t('qualidade.correcao.gravado');
  pedido.value = {
    titulo: T('corrigirBundleTitulo', {
      turno: T(`turnos.${b.turno}`),
      data: b.data.split('-').reverse().join('/'),
    }),
    texto: T('corrigirBundleTexto'),
    critica: false,
    confirmar: T('confirmarCorrecao'),
    gravar: ({ justificativa, senha }) =>
      corrigirBundleNaAba(
        b.id,
        {
          versao: b.versao,
          itens: { ...marcados.value },
          observacao: obs.value.trim() || null,
          justificativa,
          ...(senha ? { senha } : {}),
        },
        novaChaveCcih('aba-bundle-correcao'),
      ),
  };
  visivel.value = true;
}
function abrirEstornoBundle(b: BundleTela): void {
  alvoBundle.value = b;
  modo.value = 'estornarBundle';
  textoFeito.value = T('bundleEstornado');
  pedido.value = {
    titulo: T('estornarBundleTitulo'),
    texto: T('estornarBundleTexto'),
    critica: true,
    confirmar: T('confirmarEstorno'),
    gravar: (m) => estornarBundleNaAba(b.id, b.versao, m, novaChaveCcih('aba-bundle-estorno')),
  };
  visivel.value = true;
}

const valido = computed(() => {
  if (modo.value === 'novo') return !!instanteLocal(novo.data, novo.hora);
  if (modo.value === 'corrigir') return !!instanteLocal(cor.data, cor.hora);
  if (modo.value === 'retirada') return !!instanteLocal(ret.data, ret.hora) && !!ret.motivo;
  return true;
});
async function feito(): Promise<void> {
  aviso.value = textoFeito.value;
  await cliente.invalidateQueries({ queryKey: ['ccih'] });
}
</script>

<template>
  <section
    class="aba painel-ccih"
    aria-labelledby="aba-dispositivos-titulo"
    data-testid="aba-dispositivos-conteudo"
  >
    <h2 id="aba-dispositivos-titulo">{{ T('titulo') }}</h2>
    <p class="secundario">{{ T('explicacao') }}</p>
    <ErroCcih v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!d" role="status">{{ t('qualidade.carregando') }}</p>
    <SanteAlerta
      v-else-if="!d.internacao"
      variante="info"
      :texto="T('semInternacao')"
      data-testid="aba-sem-internacao"
    />
    <template v-else>
      <div v-if="aviso" role="status" data-testid="aba-aviso">{{ aviso }}</div>
      <SanteBotao
        v-if="d.podeRegistrar"
        :rotulo="T('novo')"
        variante="secundario"
        data-testid="aba-novo-dispositivo"
        @acionar="abrirNovo"
      />
      <h3>{{ T('ativos') }}</h3>
      <p v-if="!ativos.length" data-testid="aba-nenhum">{{ T('nenhum') }}</p>
      <ul v-else class="lista-ccih">
        <li
          v-for="x in ativos"
          :key="x.id"
          class="cartao-dispositivo"
          :data-testid="`aba-dispositivo-${x.id}`"
        >
          <p>
            <strong>{{ rotuloDispositivoInvasivo(x.tipo) }}</strong>
            <span v-if="x.sitio"> · {{ x.sitio }}</span> · {{ T('inserido', { em: dataHora(x.inseridoEm) }) }}
          </p>
          <p class="secundario">
            {{ T('emUso', { dias: x.dias, competencia: x.dispositivosDiaCompetencia }) }}
          </p>
          <p class="secundario" :data-testid="`aba-responsavel-${x.id}`">
            {{
              x.responsavel ? T('responsavel', { nome: x.responsavel.nome }) : T('responsavelNaoInformado')
            }}
            · {{ T('registradoPor', { quem: x.registradoPor }) }}
          </p>
          <SanteAlerta
            v-if="x.alerta"
            variante="alerta"
            :texto="T('alerta', { horas: x.alerta.horas, limite: x.alerta.limiteHoras })"
            :data-testid="`aba-alerta-${x.id}`"
          />
          <p v-if="x.itensBundle.length">
            <span
              :class="['selo', x.bundleDoTurno ? '' : 'selo--grave']"
              :data-testid="`aba-bundle-situacao-${x.id}`"
              >{{ x.bundleDoTurno ? T('bundleFeito') : T('bundlePendente') }}</span
            >
          </p>
          <div class="linha-ccih">
            <SanteBotao
              v-if="d.podeRegistrar && x.itensBundle.length && !x.bundleDoTurno"
              :rotulo="T('fazerBundle')"
              variante="primario"
              :data-testid="`aba-bundle-${x.id}`"
              @acionar="abrirBundle(x)"
            />
            <SanteBotao
              v-if="d.podeRegistrar"
              :rotulo="T('retirar')"
              variante="texto"
              :data-testid="`aba-retirar-${x.id}`"
              @acionar="abrirRetirada(x)"
            />
            <SanteBotao
              v-if="podeMudar(x.registradoPor)"
              :rotulo="t('qualidade.correcao.corrigir')"
              variante="texto"
              :data-testid="`aba-corrigir-${x.id}`"
              @acionar="abrirCorrecao(x)"
            />
            <SanteBotao
              v-if="podeMudar(x.registradoPor)"
              :rotulo="t('qualidade.correcao.cancelarRegistro')"
              variante="texto"
              :data-testid="`aba-cancelar-${x.id}`"
              @acionar="abrirCancelamento(x)"
            />
            <HistoricoVersoes registro="dispositivo" :id="x.id" enfermagem />
          </div>
          <details v-if="x.bundles.length">
            <summary>{{ T('ultimos') }}</summary>
            <ul>
              <li
                v-for="b in x.bundles"
                :key="b.id"
                :class="{ inativo: !!b.estornadoEm }"
                :data-testid="`aba-checklist-${b.id}`"
              >
                {{ b.data.split('-').reverse().join('/') }} · {{ T(`turnos.${b.turno}`) }} ·
                {{ b.conforme ? T('conforme') : T('naoConforme') }} · {{ b.registradoPor }}
                <template v-if="b.estornadoEm">
                  · <span class="selo">{{ t('qualidade.correcao.inativo') }}</span>
                  <span class="secundario">
                    {{
                      t('qualidade.correcao.estornada', {
                        em: dataHora(b.estornadoEm),
                        motivo: b.motivoEstorno ?? '',
                      })
                    }}
                  </span>
                </template>
                <span v-else class="linha-ccih">
                  <SanteBotao
                    v-if="podeMudar(b.registradoPor)"
                    :rotulo="t('qualidade.correcao.corrigir')"
                    variante="texto"
                    :data-testid="`aba-corrigir-checklist-${b.id}`"
                    @acionar="abrirCorrecaoBundle(x, b)"
                  />
                  <SanteBotao
                    v-if="podeMudar(b.registradoPor)"
                    :rotulo="t('qualidade.correcao.estornar')"
                    variante="texto"
                    :data-testid="`aba-estornar-checklist-${b.id}`"
                    @acionar="abrirEstornoBundle(b)"
                  />
                </span>
                <HistoricoVersoes registro="bundle" :id="b.id" />
              </li>
            </ul>
          </details>
        </li>
      </ul>
      <template v-if="historico.length">
        <h3>{{ T('historico') }}</h3>
        <ul class="lista-ccih secundario">
          <li v-for="x in historico" :key="x.id" :data-testid="`aba-historico-${x.id}`">
            {{ rotuloDispositivoInvasivo(x.tipo) }} · {{ T('inserido', { em: dataHora(x.inseridoEm) }) }}
            <template v-if="x.canceladoEm">
              · <span class="selo">{{ t('qualidade.correcao.inativo') }}</span>
            </template>
            <template v-else-if="x.retiradoEm">
              ·
              {{
                t('ccih.ficha.retirado', {
                  em: dataHora(x.retiradoEm),
                  motivo:
                    MOTIVOS_RETIRADA_DISPOSITIVO.find((m) => m.codigo === x.motivoRetirada)?.rotulo ?? '',
                })
              }}
            </template>
          </li>
        </ul>
      </template>
    </template>
    <DialogoCorrecao v-model:visivel="visivel" :pedido="pedido" :valido="valido" @feito="feito">
      <fieldset
        v-if="(modo === 'bundle' || modo === 'corrigirBundle') && alvo"
        class="campos-aba"
        data-testid="aba-form-bundle"
      >
        <legend>{{ rotuloDispositivoInvasivo(alvo.tipo) }}</legend>
        <label v-for="k in alvo.itensBundle" :key="k" class="marca">
          <input v-model="marcados[k]" type="checkbox" :data-testid="`aba-bundle-item-${k}`" />
          {{ rotuloItem(alvo.tipo, k) }}
        </label>
        <SanteCampoTexto v-model="obs" :rotulo="t('ccih.observacao')" :max-bytes="200" />
      </fieldset>
      <div v-else-if="modo === 'novo'" class="campos-aba" data-testid="aba-form-novo">
        <SanteSelecao
          v-model="novo.tipo"
          :rotulo="t('ccih.ficha.tipo')"
          :opcoes="opTipo"
          obrigatorio
          data-testid="aba-novo-tipo"
        />
        <SanteCampoTexto v-model="novo.sitio" :rotulo="t('ccih.ficha.sitio')" :max-bytes="40" />
        <SanteData v-model="novo.data" :rotulo="t('ccih.ficha.inseridoEm')" editavel />
        <SanteHora v-model="novo.hora" :rotulo="t('ccih.ficha.horaInsercao')" editavel />
        <div class="busca-responsavel">
          <SanteCampoTexto
            v-model="termoResp"
            :rotulo="T('buscarResponsavel')"
            :max-bytes="60"
            data-testid="aba-resp-termo"
            @keydown.enter.prevent="buscarResponsavel"
          />
          <SanteBotao
            :rotulo="T('buscar')"
            variante="secundario"
            data-testid="aba-resp-buscar"
            @acionar="buscarResponsavel"
          />
        </div>
        <SanteSelecao
          v-model="novo.responsavel"
          :rotulo="T('responsavelCampo')"
          :opcoes="opResponsavel"
          :busca="true"
          data-testid="aba-novo-responsavel"
        />
      </div>
      <div v-else-if="modo === 'corrigir'" class="campos-aba" data-testid="aba-form-corrigir">
        <SanteSelecao
          v-model="cor.tipo"
          :rotulo="t('ccih.ficha.tipo')"
          :opcoes="opTipo"
          obrigatorio
          data-testid="aba-corrigir-tipo"
        />
        <SanteCampoTexto
          v-model="cor.sitio"
          :rotulo="t('ccih.ficha.sitio')"
          :max-bytes="40"
          data-testid="aba-corrigir-sitio"
        />
        <SanteData v-model="cor.data" :rotulo="t('ccih.ficha.inseridoEm')" editavel />
        <SanteHora v-model="cor.hora" :rotulo="t('ccih.ficha.horaInsercao')" editavel />
        <div class="busca-responsavel">
          <SanteCampoTexto
            v-model="termoResp"
            :rotulo="T('buscarResponsavel')"
            :max-bytes="60"
            data-testid="aba-corrigir-resp-termo"
            @keydown.enter.prevent="buscarResponsavel"
          />
          <SanteBotao
            :rotulo="T('buscar')"
            variante="secundario"
            data-testid="aba-corrigir-resp-buscar"
            @acionar="buscarResponsavel"
          />
        </div>
        <SanteSelecao
          v-model="cor.responsavel"
          :rotulo="T('responsavelCampo')"
          :opcoes="opResponsavel"
          :busca="true"
          data-testid="aba-corrigir-responsavel"
        />
      </div>
      <div v-else-if="modo === 'retirada'" class="campos-aba" data-testid="aba-form-retirada">
        <SanteData v-model="ret.data" :rotulo="t('ccih.ficha.retiradoEm')" editavel />
        <SanteHora v-model="ret.hora" :rotulo="t('ccih.ficha.horaRetirada')" editavel />
        <SanteSelecao
          v-model="ret.motivo"
          :rotulo="t('ccih.ficha.motivoRetirada')"
          :opcoes="opRetirada"
          obrigatorio
          data-testid="aba-retirada-motivo"
        />
      </div>
    </DialogoCorrecao>
  </section>
</template>

<style scoped>
.cartao-dispositivo {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2);
  display: grid;
  gap: var(--sgh-espaco-1);
}
.campos-aba {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 0;
  padding: 0;
}
.busca-responsavel {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: end;
  flex-wrap: wrap;
}
.marca {
  display: inline-flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
