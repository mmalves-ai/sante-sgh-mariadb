<script setup lang="ts">
// W0-03, mercado M4: feridas e lesão por pressão (LPP) da unidade. Um cartão por paciente internado com as lesões dele:
// a ficha (tipo, local no mapa corporal, estágio NPUAP, medidas, leito, cobertura), a origem (presente na admissão ou
// adquirida), a área, o encerramento e a inativação (tachada, com o motivo). Ações: registrar a lesão (rascunho ou
// finalizada), continuar o rascunho, corrigir a finalizada (só o autor, com a justificativa; a versão anterior fica
// legível no histórico), registrar o curativo (a evolução) e corrigi-lo, anexar a foto (o arquivo vai ao prontuário
// no PDF de uma página e a lesão guarda a referência), encerrar o acompanhamento e inativar o lançado errado (motivo e
// senha, só do autor). A LPP adquirida mostra a sugestão de notificar ao NSP. A incidência de LPP do período imprime o
// numerador e o denominador. Tudo o que decide vem do servidor (a tela só mostra).
import {
  COBERTURAS,
  type Cobertura,
  type CurativoLido,
  DESFECHOS_LESAO,
  type DesfechoLesao,
  ESTAGIOS_LPP,
  type EstagioLpp,
  type IncidenciaLpp,
  type LesaoLida,
  REGIOES_LESAO,
  type RegiaoLesao,
  ROTULOS_COBERTURA,
  ROTULOS_DESFECHO_LESAO,
  ROTULOS_ESTAGIO_LPP,
  ROTULOS_REGIAO_LESAO,
  ROTULOS_TIPO_LESAO,
  TIPOS_LESAO,
  type TipoLesao,
} from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  anexarFotoLesao,
  corrigirCurativo,
  encerrarLesao,
  inativarLesao,
  lerIncidenciaLpp,
  lerLesoesDaUnidade,
  type PacienteLesao,
  registrarCurativo,
  registrarLesao,
  versaoLesao,
} from '../api-lesao.js';
import { fotoEmPdf } from '../foto-pdf.js';
import CamposLesao, {
  type FormMedidasLeito,
  formDe,
  formMedidasLeitoVazio,
  leitoDoForm,
  medidasDoForm,
} from '../componentes/CamposLesao.vue';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const uid = `fe-${useId()}`;
const { unidade, escolherUnidade, opcoesUnidade, login } = usarEnfermagem();
const { permissoes } = usarSessao();
const podeAnexar = computed(() => permissoes.value.has('pep.anexo.criar'));
/** O registro é do usuário da sessão (só o autor corrige ou inativa; o servidor confere de novo). */
const ehMeu = (u: string | null | undefined) =>
  !!login.value && (u ?? '').toUpperCase() === login.value.toUpperCase();
const tela = useQuery({
  queryKey: computed(() => ['enfermagem', 'lesoes', unidade.value]),
  queryFn: () => lerLesoesDaUnidade(unidade.value),
  enabled: computed(() => unidade.value !== ''),
});
const dados = computed(() => tela.data.value ?? null);
const pode = computed(() => dados.value?.gravacao ?? null);
const agir = computed(() => pode.value?.agir === true);
const agora = computed(() => (dados.value?.agora ?? new Date().toISOString()).slice(0, 16));
const mensagem = ref<string | null>(null);
const hora = (x: string | null | undefined) => (x ? x.slice(0, 16).replace('T', ' ') : '—');
const lesoesDe = (atendimento: number) =>
  (dados.value?.lesoes ?? []).filter((l) => l.atendimento === atendimento);
const resumo = (l: LesaoLida) =>
  [
    ROTULOS_TIPO_LESAO[l.dados.tipo],
    l.dados.regiao === 'outra' ? (l.dados.regiaoDescricao ?? '') : ROTULOS_REGIAO_LESAO[l.dados.regiao],
    l.dados.estagio ? ROTULOS_ESTAGIO_LPP[l.dados.estagio].split(':')[0] : null,
  ]
    .filter(Boolean)
    .join(' · ');
const area = (a: number | null) =>
  a === null ? t('enfermagem.lesao.semMedidas') : t('enfermagem.lesao.area', { area: a });
/** A versão vigente (a da própria lesão) e as anteriores (inativas, legíveis), da mais nova para a mais antiga. */
const versoesDe = (l: LesaoLida) => [
  {
    versao: l.versao,
    situacao: l.situacao,
    criadoEm: l.criadoEm,
    autor: l.autor,
    motivo: l.motivo,
    dados: l.dados,
  },
  ...l.versoes,
];
const aberta = (l: LesaoLida) => l.inativacao === null && l.encerramento === null;
async function recarregar(): Promise<void> {
  await tela.refetch();
}

const opcoesTipo = TIPOS_LESAO.map((v) => ({ valor: v, rotulo: ROTULOS_TIPO_LESAO[v] }));
const opcoesRegiao = REGIOES_LESAO.map((v) => ({ valor: v, rotulo: ROTULOS_REGIAO_LESAO[v] }));
const opcoesEstagio = computed(() => [
  { valor: null, rotulo: t('enfermagem.lesao.campos.escolhaEstagio') },
  ...ESTAGIOS_LPP.map((v) => ({ valor: v, rotulo: ROTULOS_ESTAGIO_LPP[v] })),
]);
const opcoesCobertura = computed(() => [
  { valor: null, rotulo: t('enfermagem.lesao.campos.semCobertura') },
  ...COBERTURAS.map((v) => ({ valor: v, rotulo: ROTULOS_COBERTURA[v] })),
]);
const opcoesCoberturaObrigatoria = COBERTURAS.map((v) => ({ valor: v, rotulo: ROTULOS_COBERTURA[v] }));
const opcoesDesfecho = computed(() => [
  { valor: null, rotulo: t('enfermagem.lesao.campos.escolhaDesfecho') },
  ...DESFECHOS_LESAO.map((v) => ({ valor: v, rotulo: ROTULOS_DESFECHO_LESAO[v] })),
]);
const texto = (v: string) => (v.trim() ? v.trim() : undefined);

// ── A ficha: registrar, continuar o rascunho e corrigir a finalizada ─────────────────────────
const dialogoFicha = ref(false);
const alvoFicha = ref<{ paciente: PacienteLesao | null; lesao: LesaoLida | null } | null>(null);
const tipo = ref<TipoLesao>('lpp');
const regiao = ref<RegiaoLesao>('sacral');
const regiaoDescricao = ref('');
const estagio = ref<EstagioLpp | null>(null);
const dispositivo = ref(false);
const naAdmissao = ref(false);
const identificadaEm = ref('');
const formFicha = ref<FormMedidasLeito>(formMedidasLeitoVazio());
const cobertura = ref<Cobertura | null>(null);
const coberturaDescricao = ref('');
const observacao = ref('');
const finalizar = ref(true);
const motivoFicha = ref('');
const erroFicha = ref<unknown>(null);
const corrigindo = computed(() => alvoFicha.value?.lesao?.situacao === 'finalizada');
function abrirFicha(paciente: PacienteLesao | null, lesao: LesaoLida | null): void {
  const d = lesao?.dados;
  alvoFicha.value = { paciente, lesao };
  tipo.value = d?.tipo ?? 'lpp';
  regiao.value = d?.regiao ?? 'sacral';
  regiaoDescricao.value = d?.regiaoDescricao ?? '';
  estagio.value = d?.estagio ?? null;
  dispositivo.value = d?.relacionadaDispositivo ?? false;
  naAdmissao.value = d?.presenteNaAdmissao ?? false;
  identificadaEm.value = d?.identificadaEm ?? agora.value;
  formFicha.value = d ? formDe(d.medidas, d.leito) : formMedidasLeitoVazio();
  cobertura.value = d?.cobertura ?? null;
  coberturaDescricao.value = d?.coberturaDescricao ?? '';
  observacao.value = d?.observacao ?? '';
  finalizar.value = true;
  motivoFicha.value = '';
  erroFicha.value = null;
  dialogoFicha.value = true;
}
const fichaValida = computed(
  () =>
    identificadaEm.value.length >= 16 &&
    (tipo.value !== 'lpp' || estagio.value !== null) &&
    (!corrigindo.value || motivoFicha.value.trim().length >= 10),
);
async function confirmarFicha(): Promise<void> {
  const a = alvoFicha.value;
  if (!a || !fichaValida.value) return;
  erroFicha.value = null;
  const dados = {
    tipo: tipo.value,
    regiao: regiao.value,
    ...(regiao.value === 'outra' ? { regiaoDescricao: texto(regiaoDescricao.value) } : {}),
    estagio: tipo.value === 'lpp' ? estagio.value : null,
    relacionadaDispositivo: dispositivo.value,
    presenteNaAdmissao: naAdmissao.value,
    identificadaEm: identificadaEm.value.slice(0, 16),
    medidas: medidasDoForm(formFicha.value),
    leito: formFicha.value.avaliarLeito ? leitoDoForm(formFicha.value) : null,
    cobertura: cobertura.value,
    ...(cobertura.value === 'outra' ? { coberturaDescricao: texto(coberturaDescricao.value) } : {}),
    ...(texto(observacao.value) ? { observacao: texto(observacao.value) } : {}),
  };
  try {
    const r = a.lesao
      ? await versaoLesao(a.lesao.id, {
          dados,
          finalizar: corrigindo.value ? true : finalizar.value,
          ...(corrigindo.value ? { motivo: motivoFicha.value.trim() } : {}),
        })
      : await registrarLesao({
          paciente: a.paciente!.paciente,
          atendimento: a.paciente!.atendimento,
          dados,
          finalizar: finalizar.value,
        });
    mensagem.value = r.mensagem;
    dialogoFicha.value = false;
    await recarregar();
  } catch (x) {
    erroFicha.value = x;
  }
}

// ── O curativo e a correção dele ─────────────────────────────────────────────────────────
const dialogoCurativo = ref(false);
const alvoCurativo = ref<{ lesao: LesaoLida; curativo: CurativoLido | null } | null>(null);
const realizadoEm = ref('');
const estagioCurativo = ref<EstagioLpp | null>(null);
const formCurativo = ref<FormMedidasLeito>(formMedidasLeitoVazio());
const limpeza = ref('');
const coberturaCurativo = ref<Cobertura>('espuma');
const coberturaCurativoDescricao = ref('');
const observacaoCurativo = ref('');
const motivoCurativo = ref('');
const erroCurativo = ref<unknown>(null);
function abrirCurativo(lesao: LesaoLida, curativo: CurativoLido | null): void {
  const d = curativo?.dados;
  alvoCurativo.value = { lesao, curativo };
  realizadoEm.value = d?.realizadoEm ?? agora.value;
  estagioCurativo.value = d ? d.estagio : lesao.dados.estagio;
  formCurativo.value = d ? formDe(d.medidas, d.leito) : formDe(null, null);
  limpeza.value = d?.limpeza ?? '';
  coberturaCurativo.value = d?.cobertura ?? lesao.dados.cobertura ?? 'espuma';
  coberturaCurativoDescricao.value = d?.coberturaDescricao ?? '';
  observacaoCurativo.value = d?.observacao ?? '';
  motivoCurativo.value = '';
  erroCurativo.value = null;
  dialogoCurativo.value = true;
}
const curativoValido = computed(
  () =>
    realizadoEm.value.length >= 16 &&
    (alvoCurativo.value?.lesao.dados.tipo !== 'lpp' || estagioCurativo.value !== null) &&
    (!alvoCurativo.value?.curativo || motivoCurativo.value.trim().length >= 10),
);
async function confirmarCurativo(): Promise<void> {
  const a = alvoCurativo.value;
  if (!a || !curativoValido.value) return;
  erroCurativo.value = null;
  const e = {
    realizadoEm: realizadoEm.value.slice(0, 16),
    estagio: a.lesao.dados.tipo === 'lpp' ? estagioCurativo.value : null,
    medidas: medidasDoForm(formCurativo.value),
    leito: leitoDoForm(formCurativo.value),
    ...(texto(limpeza.value) ? { limpeza: texto(limpeza.value) } : {}),
    cobertura: coberturaCurativo.value,
    ...(coberturaCurativo.value === 'outra'
      ? { coberturaDescricao: texto(coberturaCurativoDescricao.value) }
      : {}),
    ...(texto(observacaoCurativo.value) ? { observacao: texto(observacaoCurativo.value) } : {}),
  };
  try {
    const r = a.curativo
      ? await corrigirCurativo(a.curativo.id, e, motivoCurativo.value.trim())
      : await registrarCurativo(a.lesao.id, e);
    mensagem.value = r.mensagem;
    dialogoCurativo.value = false;
    await recarregar();
  } catch (x) {
    erroCurativo.value = x;
  }
}

// ── A foto (o PDF da foto, anexo do prontuário) ──────────────────────────────────────────────
const dialogoFoto = ref(false);
const alvoFoto = ref<LesaoLida | null>(null);
const arquivo = ref<File | null>(null);
const tiradaEm = ref('');
const curativoDaFoto = ref<number | null>(null);
const erroFoto = ref<unknown>(null);
const arquivoRecusado = ref(false);
const ocupadoFoto = ref(false);
const TETO_FOTO = 8 * 1024 * 1024;
function abrirFoto(l: LesaoLida): void {
  alvoFoto.value = l;
  arquivo.value = null;
  tiradaEm.value = agora.value;
  curativoDaFoto.value = null;
  erroFoto.value = null;
  arquivoRecusado.value = false;
  dialogoFoto.value = true;
}
const extensaoDe = (f: File): 'jpg' | 'jpeg' | 'png' | null => {
  const x = (f.name.split('.').pop() ?? '').toLowerCase();
  return x === 'jpg' || x === 'jpeg' || x === 'png' ? x : null;
};
function escolherArquivo(ev: Event): void {
  const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
  arquivoRecusado.value = !!f && (extensaoDe(f) === null || f.size > TETO_FOTO || f.size === 0);
  arquivo.value = f && !arquivoRecusado.value ? f : null;
}
const opcoesCurativoDaFoto = computed(() => [
  { valor: null, rotulo: t('enfermagem.lesao.campos.semCurativo') },
  ...(alvoFoto.value?.curativos ?? [])
    .filter((c) => c.vigente)
    .map((c) => ({
      valor: c.id,
      rotulo: `${hora(c.dados.realizadoEm)} · ${ROTULOS_COBERTURA[c.dados.cobertura]}`,
    })),
]);
async function confirmarFoto(): Promise<void> {
  const l = alvoFoto.value;
  const f = arquivo.value;
  if (!l || !f || tiradaEm.value.length < 16) return;
  erroFoto.value = null;
  ocupadoFoto.value = true;
  try {
    const nome = f.name.replace(/\.[^.]*$/, '').replace(/[^\w .-]/g, '_') || 'foto';
    const r = await anexarFotoLesao(
      l,
      { nome: `FOTO LESAO ${nome}`.slice(0, 40), pdf: await fotoEmPdf(f) },
      {
        tiradaEm: tiradaEm.value.slice(0, 16),
        ...(curativoDaFoto.value ? { curativo: curativoDaFoto.value } : {}),
      },
    );
    mensagem.value = r.mensagem;
    dialogoFoto.value = false;
    await recarregar();
  } catch (x) {
    erroFoto.value = x;
  } finally {
    ocupadoFoto.value = false;
  }
}

// ── O encerramento ───────────────────────────────────────────────────────────────────────
const dialogoEncerrar = ref(false);
const alvoEncerrar = ref<LesaoLida | null>(null);
const desfecho = ref<DesfechoLesao | null>(null);
const encerradaEm = ref('');
const observacaoEncerrar = ref('');
const erroEncerrar = ref<unknown>(null);
function abrirEncerrar(l: LesaoLida): void {
  alvoEncerrar.value = l;
  desfecho.value = null;
  encerradaEm.value = agora.value;
  observacaoEncerrar.value = '';
  erroEncerrar.value = null;
  dialogoEncerrar.value = true;
}
async function confirmarEncerrar(): Promise<void> {
  const l = alvoEncerrar.value;
  if (!l || !desfecho.value || encerradaEm.value.length < 16) return;
  erroEncerrar.value = null;
  try {
    const r = await encerrarLesao(l.id, {
      desfecho: desfecho.value,
      em: encerradaEm.value.slice(0, 16),
      ...(observacaoEncerrar.value.trim() ? { observacao: observacaoEncerrar.value.trim() } : {}),
    });
    mensagem.value = r.mensagem;
    dialogoEncerrar.value = false;
    await recarregar();
  } catch (x) {
    erroEncerrar.value = x;
  }
}

// ── A inativação do lançado errado (lesão, curativo ou foto) ─────────────────────────────
const dialogoInativar = ref(false);
const alvoInativar = ref<{ origem: 'lesao' | 'curativo' | 'foto'; id: number } | null>(null);
function abrirInativar(origem: 'lesao' | 'curativo' | 'foto', id: number): void {
  alvoInativar.value = { origem, id };
  dialogoInativar.value = true;
}
async function inativar(c: DadosCorrecao): Promise<void> {
  const a = alvoInativar.value;
  if (!a) return;
  mensagem.value = (await inativarLesao(a.origem, a.id, c.motivo, c.senha)).mensagem;
  await recarregar();
}

// ── O histórico da lesão ─────────────────────────────────────────────────────────────────
const historicoDe = ref<number | null>(null);

// ── A incidência de LPP ──────────────────────────────────────────────────────────────────
const hoje = new Date().toISOString().slice(0, 10);
const de = ref(`${hoje.slice(0, 8)}01`);
const ate = ref(hoje);
const incidencia = ref<IncidenciaLpp | null>(null);
const erroIncidencia = ref<unknown>(null);
async function calcular(): Promise<void> {
  erroIncidencia.value = null;
  try {
    incidencia.value = await lerIncidenciaLpp(de.value, ate.value);
  } catch (x) {
    erroIncidencia.value = x;
  }
}
</script>

<template>
  <section class="tela-enf" :aria-labelledby="`${uid}-titulo`" data-testid="tela-feridas">
    <h1 :id="`${uid}-titulo`">{{ t('enfermagem.lesao.titulo') }}</h1>
    <p>{{ t('enfermagem.lesao.texto') }}</p>
    <p class="base">{{ t('enfermagem.lesao.base') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
    </div>
    <p v-if="mensagem" role="status" data-testid="fe-mensagem">{{ mensagem }}</p>
    <p v-if="pode && !pode.ligada" role="note" data-testid="fe-desligada">
      {{ t('enfermagem.lesao.semGravacao', { motivo: pode.motivo ?? '' }) }}
    </p>
    <p v-else-if="pode && !pode.agir" role="note" data-testid="fe-sem-acao">
      {{ t('enfermagem.lesao.semAcao') }}
    </p>
    <ErroEnfermagem v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="unidade && !dados" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <ul v-else-if="dados" class="cartoes" data-testid="fe-pacientes">
      <li
        v-for="p in dados.pacientes"
        :key="p.atendimento"
        class="cartao"
        :data-testid="`fe-paciente-${p.atendimento}`"
      >
        <header class="cab">
          <strong>{{ p.leito }} · {{ p.nome }}</strong>
          <SanteBotao
            v-if="agir"
            :rotulo="t('enfermagem.lesao.registrar')"
            :data-testid="`fe-registrar-${p.atendimento}`"
            @acionar="abrirFicha(p, null)"
          />
        </header>
        <p v-if="lesoesDe(p.atendimento).length === 0" class="discreto">
          {{ t('enfermagem.lesao.nenhumaLesao') }}
        </p>
        <article
          v-for="l in lesoesDe(p.atendimento)"
          :key="l.id"
          :class="['lesao', { inativo: l.inativacao }]"
          :data-testid="`fe-lesao-${l.id}`"
          :data-situacao="l.situacao"
          :data-inativo="l.inativacao ? 'sim' : 'nao'"
        >
          <p class="cab">
            <span :class="{ tachado: l.inativacao }">{{ resumo(l) }}</span>
            <span class="selo">{{ t(`enfermagem.lesao.situacoes.${l.situacao}`) }}</span>
            <span class="selo" :data-testid="`fe-origem-${l.id}`">{{
              t(`enfermagem.lesao.origens.${l.origem}`)
            }}</span>
          </p>
          <p class="discreto">
            {{ area(l.areaCm2) }} ·
            {{
              t('enfermagem.lesao.porQuem', { versao: l.versao, autor: l.autor, quando: hora(l.criadoEm) })
            }}
          </p>
          <p v-if="l.encerramento" :data-testid="`fe-encerramento-${l.id}`">
            {{
              t('enfermagem.lesao.encerrada', {
                desfecho: ROTULOS_DESFECHO_LESAO[l.encerramento.desfecho],
                quando: hora(l.encerramento.em),
                por: l.encerramento.usuario,
              })
            }}
          </p>
          <p v-if="l.inativacao" :data-testid="`fe-inativacao-${l.id}`">
            {{
              t('enfermagem.lesao.inativada', {
                por: l.inativacao.usuario,
                quando: hora(l.inativacao.em),
                motivo: l.inativacao.motivo,
              })
            }}
          </p>
          <div v-if="l.sugerirNotificacao" role="note" class="alerta" :data-testid="`fe-nsp-${l.id}`">
            {{ t('enfermagem.lesao.nsp') }}
            <RouterLink :to="{ path: '/qualidade/notificar' }">{{
              t('enfermagem.lesao.nspNotificar')
            }}</RouterLink>
          </div>
          <div class="acoes">
            <template v-if="agir && aberta(l)">
              <SanteBotao
                v-if="ehMeu(l.autor)"
                :rotulo="
                  l.situacao === 'rascunho' ? t('enfermagem.lesao.continuar') : t('enfermagem.lesao.corrigir')
                "
                variante="secundario"
                :data-testid="`fe-versao-${l.id}`"
                @acionar="abrirFicha(p, l)"
              />
              <template v-if="l.situacao === 'finalizada'">
                <SanteBotao
                  :rotulo="t('enfermagem.lesao.curativo')"
                  :data-testid="`fe-curativo-${l.id}`"
                  @acionar="abrirCurativo(l, null)"
                />
                <SanteBotao
                  v-if="podeAnexar"
                  variante="secundario"
                  :rotulo="t('enfermagem.lesao.foto')"
                  :data-testid="`fe-foto-${l.id}`"
                  @acionar="abrirFoto(l)"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('enfermagem.lesao.encerrar')"
                  :data-testid="`fe-encerrar-${l.id}`"
                  @acionar="abrirEncerrar(l)"
                />
              </template>
            </template>
            <SanteBotao
              v-if="agir && !l.inativacao && ehMeu(l.autor)"
              variante="secundario"
              :rotulo="t('enfermagem.lesao.inativar')"
              :data-testid="`fe-inativar-${l.id}`"
              @acionar="abrirInativar('lesao', l.id)"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="
                historicoDe === l.id ? t('enfermagem.lesao.fecharHistorico') : t('enfermagem.lesao.historico')
              "
              :data-testid="`fe-historico-${l.id}`"
              @acionar="historicoDe = historicoDe === l.id ? null : l.id"
            />
          </div>

          <div v-if="historicoDe === l.id" class="historico" :data-testid="`fe-hist-${l.id}`">
            <h2 :id="`${uid}-v-${l.id}`">{{ t('enfermagem.lesao.versoes') }}</h2>
            <ul :aria-labelledby="`${uid}-v-${l.id}`">
              <li
                v-for="v in versoesDe(l)"
                :key="v.versao"
                :class="{ tachado: v.versao !== l.versao }"
                :data-testid="`fe-versao-lida-${l.id}-${v.versao}`"
              >
                {{
                  t('enfermagem.lesao.versaoLinha', {
                    versao: v.versao,
                    situacao: t(`enfermagem.lesao.situacoes.${v.situacao}`),
                  })
                }}
                · {{ hora(v.criadoEm) }} · {{ v.autor }}
                <template v-if="v.dados">
                  ·
                  {{
                    v.dados.estagio
                      ? ROTULOS_ESTAGIO_LPP[v.dados.estagio].split(':')[0]
                      : ROTULOS_TIPO_LESAO[v.dados.tipo]
                  }}</template
                >
                <template v-if="v.motivo"> · {{ v.motivo }}</template>
              </li>
            </ul>
            <h2 :id="`${uid}-c-${l.id}`">{{ t('enfermagem.lesao.curativos') }}</h2>
            <p v-if="l.curativos.length === 0" class="discreto">{{ t('enfermagem.comum.nenhum') }}</p>
            <ul v-else :aria-labelledby="`${uid}-c-${l.id}`">
              <li
                v-for="c in l.curativos"
                :key="c.id"
                :data-testid="`fe-curativo-lido-${c.id}`"
                :data-vigente="c.vigente ? 'sim' : 'nao'"
              >
                <span :class="{ tachado: !c.vigente }">{{
                  t('enfermagem.lesao.curativoLinha', {
                    quando: hora(c.dados.realizadoEm),
                    cobertura: ROTULOS_COBERTURA[c.dados.cobertura],
                    area: area(c.areaCm2),
                  })
                }}</span>
                · {{ c.autor }}
                <template v-if="c.anterior && c.motivo">
                  · {{ t('enfermagem.lesao.correcaoDe', { id: c.anterior, motivo: c.motivo }) }}</template
                >
                <template v-if="c.inativacao">
                  ·
                  {{
                    t('enfermagem.lesao.inativada', {
                      por: c.inativacao.usuario,
                      quando: hora(c.inativacao.em),
                      motivo: c.inativacao.motivo,
                    })
                  }}</template
                >
                <span v-if="agir && aberta(l) && c.vigente && ehMeu(c.autor)" class="acoes">
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('enfermagem.lesao.corrigirCurativo')"
                    :data-testid="`fe-corrigir-curativo-${c.id}`"
                    @acionar="abrirCurativo(l, c)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('enfermagem.lesao.inativarCurativo')"
                    :data-testid="`fe-inativar-curativo-${c.id}`"
                    @acionar="abrirInativar('curativo', c.id)"
                  />
                </span>
              </li>
            </ul>
            <h2 :id="`${uid}-f-${l.id}`">{{ t('enfermagem.lesao.fotos') }}</h2>
            <p v-if="l.fotos.length === 0" class="discreto">{{ t('enfermagem.comum.nenhum') }}</p>
            <ul v-else :aria-labelledby="`${uid}-f-${l.id}`">
              <li
                v-for="f in l.fotos"
                :key="f.id"
                :data-testid="`fe-foto-lida-${f.id}`"
                :data-inativo="f.inativacao ? 'sim' : 'nao'"
              >
                <span :class="{ tachado: f.inativacao }">{{
                  t('enfermagem.lesao.fotoLinha', {
                    anexo: f.anexo,
                    quando: hora(f.tiradaEm),
                    por: f.usuario,
                  })
                }}</span>
                <template v-if="f.inativacao">
                  ·
                  {{
                    t('enfermagem.lesao.inativada', {
                      por: f.inativacao.usuario,
                      quando: hora(f.inativacao.em),
                      motivo: f.inativacao.motivo,
                    })
                  }}</template
                >
                <SanteBotao
                  v-if="agir && !f.inativacao && ehMeu(f.usuario)"
                  variante="secundario"
                  :rotulo="t('enfermagem.lesao.inativarFoto')"
                  :data-testid="`fe-inativar-foto-${f.id}`"
                  @acionar="abrirInativar('foto', f.id)"
                />
              </li>
            </ul>
          </div>
        </article>
      </li>
    </ul>

    <section class="cartao" :aria-labelledby="`${uid}-ind`" data-testid="fe-indicador">
      <h2 :id="`${uid}-ind`">{{ t('enfermagem.lesao.indicador.titulo') }}</h2>
      <form class="barra" @submit.prevent="calcular">
        <span class="campo">
          <label :for="`${uid}-de`">{{ t('enfermagem.lesao.indicador.de') }}</label>
          <input :id="`${uid}-de`" v-model="de" type="date" data-testid="fe-ind-de" />
        </span>
        <span class="campo">
          <label :for="`${uid}-ate`">{{ t('enfermagem.lesao.indicador.ate') }}</label>
          <input :id="`${uid}-ate`" v-model="ate" type="date" data-testid="fe-ind-ate" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('enfermagem.lesao.indicador.calcular')"
          data-testid="fe-ind-calcular"
        />
      </form>
      <ErroEnfermagem v-if="erroIncidencia" :erro="erroIncidencia" />
      <dl v-if="incidencia" class="indicador" data-testid="fe-ind-resultado">
        <dt>{{ t('enfermagem.lesao.indicador.densidade') }}</dt>
        <dd data-testid="fe-ind-densidade">
          {{ incidencia.densidade.por1000 ?? t('enfermagem.lesao.indicador.semDenominador') }}
          ({{ t('enfermagem.lesao.indicador.formulaMil', incidencia.densidade) }})
        </dd>
        <dt>{{ t('enfermagem.lesao.indicador.pacientes') }}</dt>
        <dd data-testid="fe-ind-pacientes">
          {{
            incidencia.pacientes.percentual === null
              ? t('enfermagem.lesao.indicador.semDenominador')
              : `${incidencia.pacientes.percentual}%`
          }}
          ({{ t('enfermagem.lesao.indicador.formula', incidencia.pacientes) }})
        </dd>
      </dl>
      <p v-if="incidencia" class="discreto" data-testid="fe-ind-impressao">{{ incidencia.impressao }}</p>
    </section>

    <SanteDialogo
      v-model:visivel="dialogoFicha"
      :titulo="
        !alvoFicha?.lesao
          ? t('enfermagem.lesao.dialogoRegistrar')
          : corrigindo
            ? t('enfermagem.lesao.dialogoCorrigir')
            : t('enfermagem.lesao.dialogoVersao')
      "
    >
      <form class="form" data-testid="fe-dialogo-ficha" @submit.prevent="confirmarFicha">
        <p v-if="alvoFicha?.paciente">
          <strong>{{ alvoFicha.paciente.leito }} · {{ alvoFicha.paciente.nome }}</strong>
        </p>
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('enfermagem.lesao.campos.tipo')"
          :opcoes="opcoesTipo"
          obrigatorio
          data-testid="fe-tipo"
        />
        <SanteSelecao
          v-model="regiao"
          :rotulo="t('enfermagem.lesao.campos.regiao')"
          :opcoes="opcoesRegiao"
          obrigatorio
          data-testid="fe-regiao"
        />
        <span v-if="regiao === 'outra'" class="campo">
          <label :for="`${uid}-reg`">{{ t('enfermagem.lesao.campos.regiaoDescricao') }}</label>
          <input
            :id="`${uid}-reg`"
            v-model="regiaoDescricao"
            maxlength="80"
            data-testid="fe-regiao-descricao"
          />
        </span>
        <SanteSelecao
          v-if="tipo === 'lpp'"
          v-model="estagio"
          :rotulo="t('enfermagem.lesao.campos.estagio')"
          :opcoes="opcoesEstagio"
          obrigatorio
          data-testid="fe-estagio"
        />
        <label class="marca">
          <input v-model="dispositivo" type="checkbox" data-testid="fe-dispositivo" />
          {{ t('enfermagem.lesao.campos.dispositivo') }}
        </label>
        <label class="marca">
          <input v-model="naAdmissao" type="checkbox" data-testid="fe-admissao" />
          {{ t('enfermagem.lesao.campos.admissao') }}
        </label>
        <span class="campo">
          <label :for="`${uid}-ident`">{{ t('enfermagem.lesao.campos.identificadaEm') }}</label>
          <input
            :id="`${uid}-ident`"
            v-model="identificadaEm"
            type="datetime-local"
            :max="agora"
            required
            data-testid="fe-identificada"
          />
        </span>
        <CamposLesao v-model="formFicha" testid="fe-ficha" />
        <SanteSelecao
          v-model="cobertura"
          :rotulo="t('enfermagem.lesao.campos.cobertura')"
          :opcoes="opcoesCobertura"
          data-testid="fe-cobertura"
        />
        <span v-if="cobertura === 'outra'" class="campo">
          <label :for="`${uid}-cobd`">{{ t('enfermagem.lesao.campos.coberturaDescricao') }}</label>
          <input
            :id="`${uid}-cobd`"
            v-model="coberturaDescricao"
            maxlength="120"
            data-testid="fe-cobertura-descricao"
          />
        </span>
        <span class="campo">
          <label :for="`${uid}-obs`">{{ t('enfermagem.lesao.campos.observacao') }}</label>
          <textarea
            :id="`${uid}-obs`"
            v-model="observacao"
            maxlength="400"
            rows="2"
            data-testid="fe-observacao"
          ></textarea>
        </span>
        <label v-if="!corrigindo" class="marca">
          <input v-model="finalizar" type="checkbox" data-testid="fe-finalizar" />
          {{ t('enfermagem.lesao.campos.finalizar') }}
        </label>
        <span v-if="corrigindo" class="campo">
          <label :for="`${uid}-mot`">{{ t('enfermagem.lesao.campos.motivo') }}</label>
          <textarea
            :id="`${uid}-mot`"
            v-model="motivoFicha"
            maxlength="300"
            rows="2"
            required
            :aria-describedby="`${uid}-mot-ajuda`"
            data-testid="fe-motivo"
          ></textarea>
          <small :id="`${uid}-mot-ajuda`">{{ t('enfermagem.lesao.campos.motivoAjuda') }}</small>
        </span>
        <ErroEnfermagem v-if="erroFicha" :erro="erroFicha" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.lesao.confirmarFicha')"
            :desabilitado="!fichaValida"
            data-testid="fe-ficha-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoFicha = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoCurativo"
      :titulo="
        alvoCurativo?.curativo
          ? t('enfermagem.lesao.dialogoCorrigirCurativo')
          : t('enfermagem.lesao.dialogoCurativo')
      "
    >
      <form class="form" data-testid="fe-dialogo-curativo" @submit.prevent="confirmarCurativo">
        <p v-if="alvoCurativo">
          <strong>{{ resumo(alvoCurativo.lesao) }}</strong>
        </p>
        <span class="campo">
          <label :for="`${uid}-real`">{{ t('enfermagem.lesao.campos.realizadoEm') }}</label>
          <input
            :id="`${uid}-real`"
            v-model="realizadoEm"
            type="datetime-local"
            :max="agora"
            required
            data-testid="fe-realizado"
          />
        </span>
        <SanteSelecao
          v-if="alvoCurativo?.lesao.dados.tipo === 'lpp'"
          v-model="estagioCurativo"
          :rotulo="t('enfermagem.lesao.campos.estagio')"
          :opcoes="opcoesEstagio"
          obrigatorio
          data-testid="fe-curativo-estagio"
        />
        <CamposLesao v-model="formCurativo" testid="fe-curativo" leito-obrigatorio />
        <span class="campo">
          <label :for="`${uid}-limp`">{{ t('enfermagem.lesao.campos.limpeza') }}</label>
          <input :id="`${uid}-limp`" v-model="limpeza" maxlength="120" data-testid="fe-limpeza" />
        </span>
        <SanteSelecao
          v-model="coberturaCurativo"
          :rotulo="t('enfermagem.lesao.campos.cobertura')"
          :opcoes="opcoesCoberturaObrigatoria"
          obrigatorio
          data-testid="fe-curativo-cobertura"
        />
        <span v-if="coberturaCurativo === 'outra'" class="campo">
          <label :for="`${uid}-ccd`">{{ t('enfermagem.lesao.campos.coberturaDescricao') }}</label>
          <input
            :id="`${uid}-ccd`"
            v-model="coberturaCurativoDescricao"
            maxlength="120"
            data-testid="fe-curativo-cobertura-descricao"
          />
        </span>
        <span class="campo">
          <label :for="`${uid}-cobs`">{{ t('enfermagem.lesao.campos.observacao') }}</label>
          <textarea
            :id="`${uid}-cobs`"
            v-model="observacaoCurativo"
            maxlength="400"
            rows="2"
            data-testid="fe-curativo-observacao"
          ></textarea>
        </span>
        <span v-if="alvoCurativo?.curativo" class="campo">
          <label :for="`${uid}-cmot`">{{ t('enfermagem.lesao.campos.motivo') }}</label>
          <textarea
            :id="`${uid}-cmot`"
            v-model="motivoCurativo"
            maxlength="300"
            rows="2"
            required
            :aria-describedby="`${uid}-cmot-ajuda`"
            data-testid="fe-curativo-motivo"
          ></textarea>
          <small :id="`${uid}-cmot-ajuda`">{{ t('enfermagem.lesao.campos.motivoAjuda') }}</small>
        </span>
        <ErroEnfermagem v-if="erroCurativo" :erro="erroCurativo" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.lesao.confirmarCurativo')"
            :desabilitado="!curativoValido"
            data-testid="fe-curativo-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoCurativo = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoFoto" :titulo="t('enfermagem.lesao.dialogoFoto')">
      <form class="form" data-testid="fe-dialogo-foto" @submit.prevent="confirmarFoto">
        <p class="discreto">{{ t('enfermagem.lesao.textoFoto') }}</p>
        <span class="campo">
          <label :for="`${uid}-arq`">{{ t('enfermagem.lesao.campos.arquivo') }}</label>
          <input
            :id="`${uid}-arq`"
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            data-testid="fe-foto-arquivo"
            @change="escolherArquivo"
          />
        </span>
        <p v-if="arquivoRecusado" role="alert" data-testid="fe-foto-recusada">
          {{ t('enfermagem.lesao.arquivoInvalido') }}
        </p>
        <span class="campo">
          <label :for="`${uid}-tir`">{{ t('enfermagem.lesao.campos.tiradaEm') }}</label>
          <input
            :id="`${uid}-tir`"
            v-model="tiradaEm"
            type="datetime-local"
            :max="agora"
            required
            data-testid="fe-foto-tirada"
          />
        </span>
        <SanteSelecao
          v-model="curativoDaFoto"
          :rotulo="t('enfermagem.lesao.campos.doCurativo')"
          :opcoes="opcoesCurativoDaFoto"
          data-testid="fe-foto-curativo"
        />
        <ErroEnfermagem v-if="erroFoto" :erro="erroFoto" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.lesao.confirmarFoto')"
            :desabilitado="!arquivo || tiradaEm.length < 16 || ocupadoFoto"
            data-testid="fe-foto-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoFoto = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoEncerrar" :titulo="t('enfermagem.lesao.dialogoEncerrar')">
      <form class="form" data-testid="fe-dialogo-encerrar" @submit.prevent="confirmarEncerrar">
        <SanteSelecao
          v-model="desfecho"
          :rotulo="t('enfermagem.lesao.campos.desfecho')"
          :opcoes="opcoesDesfecho"
          obrigatorio
          data-testid="fe-desfecho"
        />
        <span class="campo">
          <label :for="`${uid}-enc`">{{ t('enfermagem.lesao.campos.em') }}</label>
          <input
            :id="`${uid}-enc`"
            v-model="encerradaEm"
            type="datetime-local"
            :max="agora"
            required
            data-testid="fe-encerrar-em"
          />
        </span>
        <span class="campo">
          <label :for="`${uid}-eobs`">{{ t('enfermagem.lesao.campos.observacao') }}</label>
          <textarea
            :id="`${uid}-eobs`"
            v-model="observacaoEncerrar"
            maxlength="300"
            rows="2"
            data-testid="fe-encerrar-observacao"
          ></textarea>
        </span>
        <ErroEnfermagem v-if="erroEncerrar" :erro="erroEncerrar" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.lesao.confirmarEncerrar')"
            :desabilitado="!desfecho || encerradaEm.length < 16"
            data-testid="fe-encerrar-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoEncerrar = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <DialogoCorrecao
      v-model:visivel="dialogoInativar"
      :titulo="t('enfermagem.lesao.dialogoInativar')"
      :texto="t('enfermagem.lesao.textoInativar')"
      :rotulo-confirmar="t('enfermagem.lesao.inativar')"
      com-senha
      testid="fe-dialogo-inativar"
      :executar="inativar"
    />
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.base,
.discreto {
  color: var(--sgh-texto-secundario);
}
.cartoes {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.cab {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.lesao {
  border-top: 1px solid var(--sgh-borda-forte);
  padding-top: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
}
.selo {
  border: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.alerta {
  font-weight: 700;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.historico h2 {
  font-size: 1rem;
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.marca {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.tachado {
  text-decoration: line-through;
}
.indicador {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
textarea,
input:not([type='checkbox']):not([type='radio']) {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
