<script setup lang="ts">
// Oncologia do paciente (ficha do M45, seção 7; mina, regra 19; DP-32): `/pep/especialidades/oncologia/:reg`. Os ciclos de
// quimioterapia do paciente (a base do cálculo, as doses com as parcelas impressas, a redução e a validação farmacêutica)
// e o registro do ciclo seguinte pelo médico, na versão vigente do protocolo. As doses são calculadas pelo servidor; os
// medicamentos do ciclo são prescritos pela prescrição geral e ligados ao ciclo (a prescrição da internação que vale no
// dia previsto), antes da validação; o mesmo protocolo recomeça num tratamento novo, com o motivo.
// W0-05: o ciclo de vida do ciclo pelo diálogo de correção (motivo obrigatório): ajustar a data e a redução antes da
// validação (as doses recalculadas; a versão anterior nos eventos), suspender e retomar, cancelar (crítico: a senha de
// novo; o cancelado é final e continua visível) e desfazer a ligação com a prescrição (só o vínculo; a prescrição fica
// intacta). Os eventos de cada ciclo, o mais recente primeiro; a impressão sai com os ciclos suspensos e cancelados.
// W0-05 (revisão): o cartão do paciente e as abas (Ciclos; Novo ciclo), como a ficha do profissional; o ajuste é nova
// versão: a versão anterior (data, redução e doses) aparece riscada e inativa no ciclo e sai na impressão; o ajuste pede
// a justificativa do intervalo quando a data nova fica dentro do intervalo do protocolo.
import {
  type CategoriaMotivoCiclo,
  CATEGORIAS_MOTIVO_CICLO,
  type CicloOncologicoLido,
  type EventoOncoLido,
  type VersaoCicloAnterior,
  UNIDADES_DOSE_ONCO,
  VIAS_ONCO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import type { PrescricoesDoCiclo } from '@sgh/contratos';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AbasFicha from '../../nutricao/componentes/AbasFicha.vue';
import CartaoPerfil from '../../nutricao/componentes/CartaoPerfil.vue';
import DialogoCorrecao from '../../nutricao/componentes/DialogoCorrecao.vue';
import {
  ajustarCiclo,
  desligarPrescricao,
  lerGravacaoEspecialidade,
  lerOncologia,
  lerPrescricoesDoCiclo,
  mudarAndamentoCiclo,
  novaChaveEspecialidade,
  registrarCiclo,
  vincularPrescricao,
} from '../api-especialidades.js';
import AvisoEspecialidade from '../componentes/AvisoEspecialidade.vue';
import ErroEspecialidade from '../componentes/ErroEspecialidade.vue';
import { dataLonga, instanteCurto, leitoTexto, numero } from '../regras-especialidades.js';

const { t } = useI18n();
const rota = useRoute();
const reg = computed(() => Number(rota.params['reg']));
const gravacao = useQuery({
  queryKey: ['especialidades', 'oncologia', 'gravacao'],
  queryFn: () => lerGravacaoEspecialidade('oncologia'),
  staleTime: 30_000,
});
const pode = computed(() => gravacao.data.value?.operacoes['registrar']?.pode ?? false);
const motivoPode = computed(() => gravacao.data.value?.operacoes['registrar']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const dados = useQuery({
  queryKey: computed(() => ['especialidades', 'oncologia', reg.value]),
  queryFn: () => lerOncologia(reg.value),
});
const protocolos = computed(() =>
  (dados.data.value?.protocolos ?? []).map((p) => ({
    valor: p.id,
    rotulo: `${p.codigo} v${p.versao}: ${p.nome}`,
  })),
);
const unidadeTexto = (u: string) => UNIDADES_DOSE_ONCO.find((x) => x.codigo === u)?.rotulo ?? u;
const viaTexto = (v: string) => VIAS_ONCO.find((x) => x.codigo === v)?.rotulo ?? v;

const protocolo = ref<number | null>(null);
const numeroCiclo = ref('1');
const dataPrevista = ref<string | null>(null);
const peso = ref('');
const altura = ref('');
const creatinina = ref('');
const reducao = ref('0');
const motivoReducao = ref('');
const justificativa = ref('');
const novoTratamento = ref(false);
const motivoTratamento = ref('');
const dec = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const alertas = ref<string[]>([]);
// A aba da ficha (Ciclos; Novo ciclo): o ciclo registrado leva de volta à lista.
const aba = ref('ciclos');
const ocupado = ref(false);
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarCiclo(
      {
        internacao: reg.value,
        protocolo: protocolo.value,
        numero: Number(numeroCiclo.value),
        dataPrevista: dataPrevista.value,
        pesoKg: dec(peso.value),
        alturaCm: Number(altura.value),
        creatininaMgDl: dec(creatinina.value),
        reducaoPct: Number(reducao.value || '0'),
        ...(motivoReducao.value.trim() ? { motivoReducao: motivoReducao.value.trim() } : {}),
        ...(justificativa.value.trim() ? { justificativaIntervalo: justificativa.value.trim() } : {}),
        ...(novoTratamento.value ? { novoTratamento: motivoTratamento.value.trim() } : {}),
      },
      novaChaveEspecialidade('ciclo'),
    );
    mensagem.value = r.mensagem;
    alertas.value = r.alertas;
    await dados.refetch();
    numeroCiclo.value = String(Number(numeroCiclo.value) + 1);
    aba.value = 'ciclos';
    novoTratamento.value = false;
    motivoTratamento.value = '';
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// A ligação do ciclo com a prescrição geral (PRPRESC.ID): as prescrições da internação que valem no dia previsto.
const candidatas = reactive<Record<number, PrescricoesDoCiclo>>({});
const erroLigar = ref<unknown>(null);
const erroLigarDe = ref<number | null>(null);
async function abrirPrescricoes(ciclo: number): Promise<void> {
  erroLigar.value = null;
  erroLigarDe.value = null;
  try {
    candidatas[ciclo] = await lerPrescricoesDoCiclo(ciclo);
  } catch (x) {
    erroLigar.value = x;
    erroLigarDe.value = ciclo;
  }
}
async function ligar(ciclo: number, prescricao: number): Promise<void> {
  erroLigar.value = null;
  erroLigarDe.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await vincularPrescricao(ciclo, { prescricao }, novaChaveEspecialidade('ciclo-prescricao'));
    mensagem.value = r.mensagem;
    alertas.value = [];
    await dados.refetch();
    candidatas[ciclo] = await lerPrescricoesDoCiclo(ciclo);
  } catch (x) {
    erroLigar.value = x;
    erroLigarDe.value = ciclo;
  } finally {
    ocupado.value = false;
  }
}

// ── W0-05: ajustar, suspender, retomar, cancelar e desfazer a ligação ──
type AcaoCiclo =
  | { tipo: 'ajustar' | 'suspender' | 'retomar' | 'cancelar'; ciclo: CicloOncologicoLido }
  | { tipo: 'desligar'; ciclo: CicloOncologicoLido; prescricao: number };
const acao = ref<AcaoCiclo | null>(null);
const dialogo = ref(false);
const aData = ref<string | null>(null);
const aReducao = ref('0');
const aMotivoReducao = ref('');
const aJustificativa = ref('');
const categoria = ref<CategoriaMotivoCiclo | null>(null);
const categorias = CATEGORIAS_MOTIVO_CICLO.map((c) => ({ valor: c.codigo, rotulo: c.rotulo }));
function abrir(a: AcaoCiclo): void {
  acao.value = a;
  aData.value = a.ciclo.dataPrevista;
  aReducao.value = String(a.ciclo.reducaoPct ?? 0);
  aMotivoReducao.value = a.ciclo.motivoReducao ?? '';
  aJustificativa.value = '';
  categoria.value = null;
  dialogo.value = true;
}
const tituloAcao = computed(() => {
  const a = acao.value;
  if (!a) return '';
  const O = 'especialidades.oncologia';
  if (a.tipo === 'desligar') return t(`${O}.desligarTitulo`, { id: a.prescricao });
  const chave = {
    ajustar: 'ajustarTitulo',
    suspender: 'suspenderTitulo',
    retomar: 'retomarTitulo',
    cancelar: 'cancelarTitulo',
  }[a.tipo];
  return t(`${O}.${chave}`, { n: a.ciclo.numero });
});
const textoAcao = computed(() => (acao.value ? t(`especialidades.oncologia.${acao.value.tipo}Texto`) : ''));
const confirmarAcao = computed(() => {
  const a = acao.value?.tipo;
  return a === 'cancelar'
    ? t('especialidades.oncologia.cancelarCiclo')
    : a
      ? t(`especialidades.oncologia.${a}`)
      : '';
});
const incompleto = computed(() => {
  const a = acao.value?.tipo;
  if (a === 'suspender' || a === 'cancelar') return categoria.value === null;
  if (a === 'ajustar')
    return !aData.value || (Number(aReducao.value || '0') > 0 && aMotivoReducao.value.trim().length === 0);
  return false;
});
function gravarAcao({ motivo, senha }: { motivo: string; senha: string }) {
  const a = acao.value;
  if (!a) return Promise.reject(new Error('sem ação'));
  const chave = novaChaveEspecialidade(`ciclo-${a.tipo}`);
  if (a.tipo === 'desligar') return desligarPrescricao(a.ciclo.id, a.prescricao, motivo, chave);
  if (a.tipo === 'ajustar')
    return ajustarCiclo(
      a.ciclo.id,
      {
        dataPrevista: aData.value,
        reducaoPct: Number(aReducao.value || '0'),
        ...(aMotivoReducao.value.trim() ? { motivoReducao: aMotivoReducao.value.trim() } : {}),
        ...(aJustificativa.value.trim() ? { justificativaIntervalo: aJustificativa.value.trim() } : {}),
        motivo,
      },
      chave,
    );
  if (a.tipo === 'retomar') return mudarAndamentoCiclo(a.ciclo.id, 'retomar', { motivo }, chave);
  return mudarAndamentoCiclo(
    a.ciclo.id,
    a.tipo,
    { categoria: categoria.value, motivo, ...(a.tipo === 'cancelar' ? { senha } : {}) },
    chave,
  );
}
async function feito(r: unknown): Promise<void> {
  erro.value = null;
  alertas.value = [];
  mensagem.value = (r as { mensagem: string }).mensagem;
  const a = acao.value;
  if (a) delete candidatas[a.ciclo.id];
  await dados.refetch();
}
const pilulaAndamento = (a: string) =>
  a === 'ativo' ? 'pilula--ok' : a === 'suspenso' ? 'pilula--aviso' : 'pilula--alerta';
const eventoTexto = (e: EventoOncoLido) =>
  [
    t('especialidades.oncologia.eventoLinha', {
      evento: t(`especialidades.oncologia.eventosNomes.${e.evento}`),
      em: instanteCurto(e.em),
      por: e.por,
      motivo: e.motivo,
    }),
    e.categoria ? CATEGORIAS_MOTIVO_CICLO.find((c) => c.codigo === e.categoria)?.rotulo : null,
    e.prescricao ? t('especialidades.oncologia.eventoPrescricao', { id: e.prescricao }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
const imprimir = () => window.print();

// Revisão: as versões anteriores do ciclo (cada ajuste guarda a que substituiu), da mais recente para a mais antiga.
const versoesAnteriores = (c: CicloOncologicoLido) =>
  c.eventos
    .filter(
      (e): e is EventoOncoLido & { antes: VersaoCicloAnterior } => e.evento === 'ciclo-ajustado' && !!e.antes,
    )
    .map((e) => ({ id: e.id, por: e.por, em: e.em, motivo: e.motivo, ...e.antes }));
const abas = computed(() => [
  {
    id: 'ciclos',
    rotulo: t('especialidades.oncologia.abas.ciclos'),
    n: dados.data.value?.ciclos.length ?? 0,
  },
  { id: 'novo', rotulo: t('especialidades.oncologia.abas.novo') },
]);
const emAndamento = computed(
  () => (dados.data.value?.ciclos ?? []).filter((c) => c.andamento !== 'cancelado').length,
);
</script>

<template>
  <section class="tela-agenda tela-correcoes" aria-labelledby="esp-titulo" data-testid="tela-oncologia">
    <ErroEspecialidade v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('especialidades.carregando') }}</p>
    <template v-else>
      <CartaoPerfil
        id-titulo="esp-titulo"
        :titulo="dados.data.value.internacao.nome"
        :linhas="[
          `${t('especialidades.oncologia.titulo')} · ${t('especialidades.prontuario')} ${dados.data.value.internacao.prontuario}${dados.data.value.internacao.nascimento ? ` · ${t('especialidades.nascimento')} ${dataLonga(dados.data.value.internacao.nascimento)}` : ''}`,
          `${leitoTexto(dados.data.value.internacao.leito)} · ${t('especialidades.admissao')} ${instanteCurto(dados.data.value.internacao.admissao)}`,
        ]"
        data-testid="esp-cabecalho"
      >
        <template #pilulas>
          <span class="pilula pilula--ok">{{
            t('especialidades.oncologia.pilulaAndamento', { n: emAndamento })
          }}</span>
          <span v-if="!dados.data.value.internacao.aberta" class="pilula pilula--neutra">{{
            t('especialidades.encerrada')
          }}</span>
        </template>
        <template #acoes>
          <SanteBotao
            variante="secundario"
            :rotulo="t('especialidades.oncologia.imprimir')"
            :title="t('especialidades.oncologia.imprimirAjuda')"
            data-testid="onco-imprimir"
            @acionar="imprimir"
          />
        </template>
      </CartaoPerfil>
      <p class="acoes nao-imprimir">
        <RouterLink to="/pep/especialidades/oncologia">{{ t('especialidades.voltar') }}</RouterLink>
        <RouterLink to="/pep/especialidades/oncologia/protocolos">{{
          t('especialidades.oncologia.protocolos')
        }}</RouterLink>
        <RouterLink to="/pep/prescricao">{{ t('especialidades.oncologia.prescricao') }}</RouterLink>
      </p>
      <AvisoEspecialidade :motivo="aviso" />
      <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="ciclo-mensagem" />
      <ul v-if="alertas.length" class="alertas">
        <li v-for="a in alertas" :key="a">{{ a }}</li>
      </ul>
      <AbasFicha
        v-model="aba"
        :abas="abas"
        prefixo="onco"
        :rotulo="t('especialidades.oncologia.abasRotulo')"
      />
      <div
        v-show="aba === 'ciclos'"
        id="onco-painel-ciclos"
        class="painel-aba"
        role="tabpanel"
        aria-labelledby="onco-aba-ciclos"
      >
        <section class="painel" aria-labelledby="onco-ciclos">
          <h2 id="onco-ciclos">{{ t('especialidades.oncologia.ciclosDoPaciente') }}</h2>
          <p v-if="dados.data.value.ciclos.length === 0">{{ t('especialidades.oncologia.semCiclos') }}</p>
          <article
            v-for="c in dados.data.value.ciclos"
            :key="c.id"
            :class="['cartao-registro', { inativo: c.andamento === 'cancelado' }]"
            :data-testid="`ciclo-${c.id}`"
            :data-situacao="c.situacao"
            :data-andamento="c.andamento"
          >
            <p>
              <strong>{{
                t('especialidades.oncologia.cicloLinha', {
                  n: c.numero,
                  codigo: c.protocolo.codigo,
                  versao: c.protocolo.versao,
                  data: dataLonga(c.dataPrevista),
                })
              }}</strong>
              <span class="chip">{{ t(`especialidades.oncologia.situacoes.${c.situacao}`) }}</span>
              <span
                :class="['pilula', pilulaAndamento(c.andamento)]"
                :data-testid="`ciclo-andamento-${c.id}`"
                >{{ t(`especialidades.oncologia.andamentos.${c.andamento}`) }}</span
              >
            </p>
            <p v-if="c.curso > 1" class="secundario" :data-testid="`ciclo-curso-${c.id}`">
              {{
                c.motivoCurso
                  ? t('especialidades.oncologia.tratamentoMotivo', { curso: c.curso, motivo: c.motivoCurso })
                  : t('especialidades.oncologia.tratamento', { curso: c.curso })
              }}
            </p>
            <p class="secundario">
              {{
                t('especialidades.oncologia.base', {
                  peso: numero(c.pesoKg),
                  altura: c.alturaCm,
                  sc: numero(c.superficieM2, 2),
                })
              }}
              <span v-if="c.clearanceMlMin !== null">
                ·
                {{
                  t('especialidades.oncologia.clearance', {
                    cr: numero(c.creatininaMgDl, 2),
                    tfg: numero(c.clearanceMlMin),
                  })
                }}</span
              >
              <span v-if="c.reducaoPct">
                ·
                {{
                  t('especialidades.oncologia.reducao', { pct: c.reducaoPct, motivo: c.motivoReducao })
                }}</span
              >
            </p>
            <table class="tabela">
              <caption>
                {{
                  t('especialidades.oncologia.doses')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('especialidades.oncologia.farmacoColuna') }}</th>
                  <th scope="col">{{ t('especialidades.oncologia.prescritaColuna') }}</th>
                  <th scope="col">{{ t('especialidades.oncologia.contaColuna') }}</th>
                  <th scope="col">{{ t('especialidades.oncologia.finalColuna') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(d, i) in c.doses" :key="i">
                  <td>
                    {{
                      t('especialidades.un.farmacoDias', {
                        farmaco: d.farmaco,
                        via: viaTexto(d.via),
                        dias: d.dias.join(', D'),
                      })
                    }}
                  </td>
                  <td>{{ numero(d.prescrita) }} {{ unidadeTexto(d.unidade) }}</td>
                  <td>{{ d.conta }}</td>
                  <td>
                    <strong>{{ t('especialidades.un.mg', { v: numero(d.final) }) }}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="secundario">
              {{ t('especialidades.oncologia.prescritoPor', { por: c.por, em: instanteCurto(c.em) }) }}
              <span v-if="c.validadoPor">
                ·
                {{
                  t('especialidades.oncologia.validadoPor', {
                    por: c.validadoPor,
                    em: instanteCurto(c.validadoEm),
                  })
                }}</span
              >
            </p>
            <p v-if="c.justificativaIntervalo">
              {{ t('especialidades.oncologia.justificativa') }}: {{ c.justificativaIntervalo }}
            </p>
            <p :data-testid="`ciclo-prescricoes-${c.id}`">
              {{
                c.prescricoes.length
                  ? t('especialidades.oncologia.prescricoesLigadas', { ids: c.prescricoes.join(', ') })
                  : t('especialidades.oncologia.semPrescricaoLigada')
              }}
            </p>
            <ul
              v-if="pode && c.situacao === 'prescrito' && c.andamento !== 'cancelado' && c.prescricoes.length"
              class="lista-simples nao-imprimir"
            >
              <li v-for="pid in c.prescricoes" :key="pid">
                {{ t('especialidades.oncologia.eventoPrescricao', { id: pid }) }}
                <SanteBotao
                  variante="texto"
                  :rotulo="t('especialidades.oncologia.desligar')"
                  :data-testid="`ciclo-desligar-${c.id}-${pid}`"
                  @acionar="abrir({ tipo: 'desligar', ciclo: c, prescricao: pid })"
                />
              </li>
            </ul>
            <template v-if="pode && c.situacao === 'prescrito' && c.andamento === 'ativo'">
              <SanteBotao
                v-if="!candidatas[c.id]"
                variante="secundario"
                :rotulo="t('especialidades.oncologia.ligarPrescricao')"
                :desabilitado="ocupado"
                :data-testid="`ciclo-ligar-${c.id}`"
                @click="abrirPrescricoes(c.id)"
              />
              <div v-else :data-testid="`ciclo-candidatas-${c.id}`">
                <p>
                  <strong>{{
                    t('especialidades.oncologia.prescricoesDoDia', {
                      data: dataLonga(candidatas[c.id]!.dataPrevista),
                    })
                  }}</strong>
                </p>
                <p v-if="candidatas[c.id]!.itens.length === 0">
                  {{ t('especialidades.oncologia.semPrescricoesDoDia') }}
                </p>
                <ul v-else class="lista-simples">
                  <li v-for="p in candidatas[c.id]!.itens" :key="p.id">
                    {{
                      p.inicio
                        ? t('especialidades.oncologia.prescricaoLinha', {
                            id: p.id,
                            inicio: instanteCurto(p.inicio),
                            itens: p.itens,
                          })
                        : t('especialidades.oncologia.prescricaoAntiga', { id: p.id })
                    }}
                    <span v-if="p.suspensa" class="chip">{{ t('especialidades.oncologia.suspensa') }}</span>
                    <span v-if="p.vinculada" class="chip">{{ t('especialidades.oncologia.ligada') }}</span>
                    <SanteBotao
                      v-else-if="!p.suspensa"
                      variante="secundario"
                      :rotulo="t('especialidades.oncologia.ligar')"
                      :desabilitado="ocupado"
                      :data-testid="`ligar-${c.id}-${p.id}`"
                      @click="ligar(c.id, p.id)"
                    />
                  </li>
                </ul>
              </div>
            </template>
            <ErroEspecialidade v-if="erroLigar && erroLigarDe === c.id" :erro="erroLigar" />
            <p v-if="pode && c.andamento !== 'cancelado'" class="acoes-registro nao-imprimir">
              <SanteBotao
                v-if="c.situacao === 'prescrito' && c.andamento === 'ativo'"
                variante="secundario"
                :rotulo="t('especialidades.oncologia.ajustar')"
                :data-testid="`ciclo-ajustar-${c.id}`"
                @acionar="abrir({ tipo: 'ajustar', ciclo: c })"
              />
              <SanteBotao
                v-if="c.andamento === 'ativo'"
                variante="secundario"
                :rotulo="t('especialidades.oncologia.suspender')"
                :data-testid="`ciclo-suspender-${c.id}`"
                @acionar="abrir({ tipo: 'suspender', ciclo: c })"
              />
              <SanteBotao
                v-if="c.andamento === 'suspenso'"
                variante="secundario"
                :rotulo="t('especialidades.oncologia.retomar')"
                :data-testid="`ciclo-retomar-${c.id}`"
                @acionar="abrir({ tipo: 'retomar', ciclo: c })"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('especialidades.oncologia.cancelarCiclo')"
                :data-testid="`ciclo-cancelar-${c.id}`"
                @acionar="abrir({ tipo: 'cancelar', ciclo: c })"
              />
            </p>
            <section
              v-if="versoesAnteriores(c).length"
              class="versoes-anteriores"
              :aria-label="t('especialidades.oncologia.versoesAnteriores')"
              :data-testid="`ciclo-versoes-${c.id}`"
            >
              <h3>{{ t('especialidades.oncologia.versoesAnteriores') }}</h3>
              <div
                v-for="v in versoesAnteriores(c)"
                :key="v.id"
                class="cartao-registro inativo"
                data-situacao="substituida"
                :data-testid="`ciclo-versao-${v.id}`"
              >
                <p class="cabeca-registro">
                  <span class="pilula pilula--neutra">{{ t('especialidades.oncologia.versaoInativa') }}</span>
                  <span class="riscado">{{
                    t('especialidades.oncologia.versaoAnteriorLinha', {
                      data: dataLonga(v.dataPrevista),
                      pct: v.reducaoPct,
                    })
                  }}</span>
                </p>
                <ul class="lista-simples riscado">
                  <li v-for="(d, i) in v.doses" :key="i">
                    {{ d.farmaco }}: {{ t('especialidades.un.mg', { v: numero(d.final) }) }}
                  </li>
                </ul>
                <p v-if="v.motivoReducao || v.justificativaIntervalo" class="nota-correcao">
                  <span v-if="v.motivoReducao"
                    >{{ t('especialidades.oncologia.motivoReducao') }}: {{ v.motivoReducao }}</span
                  >
                  <span v-if="v.justificativaIntervalo">
                    · {{ t('especialidades.oncologia.justificativa') }}: {{ v.justificativaIntervalo }}</span
                  >
                </p>
                <p class="nota-correcao">
                  {{
                    t('especialidades.oncologia.substituidaEm', {
                      em: instanteCurto(v.em),
                      por: v.por,
                      motivo: v.motivo,
                    })
                  }}
                </p>
              </div>
            </section>
            <details v-if="c.eventos.length" open :data-testid="`ciclo-eventos-${c.id}`">
              <summary>{{ t('especialidades.oncologia.eventos') }} ({{ c.eventos.length }})</summary>
              <ul class="eventos">
                <li v-for="e in c.eventos" :key="e.id">{{ eventoTexto(e) }}</li>
              </ul>
            </details>
          </article>
        </section>
      </div>
      <DialogoCorrecao
        v-model:visivel="dialogo"
        :titulo="tituloAcao"
        :texto="textoAcao"
        :confirmar="confirmarAcao"
        :critica="acao?.tipo === 'cancelar'"
        :incompleto="incompleto"
        :gravar="gravarAcao"
        @feito="feito"
      >
        <SanteSelecao
          v-if="acao?.tipo === 'suspender' || acao?.tipo === 'cancelar'"
          v-model="categoria"
          :rotulo="t('especialidades.oncologia.categoria')"
          :opcoes="categorias"
          obrigatorio
          data-testid="ciclo-categoria"
        />
        <template v-if="acao?.tipo === 'ajustar'">
          <SanteData v-model="aData" :rotulo="t('especialidades.oncologia.dataPrevista')" editavel />
          <div class="campo">
            <label for="ajuste-reducao">{{ t('especialidades.oncologia.reducaoPct') }}</label>
            <input
              id="ajuste-reducao"
              v-model="aReducao"
              type="number"
              min="0"
              max="75"
              data-testid="ajuste-reducao"
            />
          </div>
          <SanteCampoTexto
            v-model="aMotivoReducao"
            :rotulo="t('especialidades.oncologia.motivoReducao')"
            :max-bytes="200"
            data-testid="ajuste-motivo-reducao"
          />
          <SanteCampoTexto
            v-model="aJustificativa"
            :rotulo="t('especialidades.oncologia.justificativaIntervalo')"
            :max-bytes="200"
            data-testid="ajuste-justificativa"
          />
          <p class="nota-correcao">{{ t('especialidades.oncologia.ajusteComPrescricao') }}</p>
        </template>
      </DialogoCorrecao>
      <div
        v-show="aba === 'novo'"
        id="onco-painel-novo"
        class="painel-aba nao-imprimir"
        role="tabpanel"
        aria-labelledby="onco-aba-novo"
      >
        <section class="painel" aria-labelledby="onco-novo">
          <h2 id="onco-novo">{{ t('especialidades.oncologia.novoCiclo') }}</h2>
          <p v-if="!pode" class="secundario">{{ motivoPode }}</p>
          <p v-else-if="protocolos.length === 0">{{ t('especialidades.oncologia.semProtocolos') }}</p>
          <form v-else class="formulario" data-testid="form-ciclo" @submit.prevent="gravar">
            <div class="grade">
              <SanteSelecao
                v-model="protocolo"
                :rotulo="t('especialidades.oncologia.protocolo')"
                :opcoes="protocolos"
                obrigatorio
                data-testid="ciclo-protocolo"
              />
              <div class="campo">
                <label for="ciclo-numero">{{ t('especialidades.oncologia.numero') }}</label>
                <input id="ciclo-numero" v-model="numeroCiclo" type="number" min="1" max="24" required />
              </div>
              <SanteData
                v-model="dataPrevista"
                :rotulo="t('especialidades.oncologia.dataPrevista')"
                editavel
              />
              <div class="campo">
                <label for="ciclo-peso">{{ t('especialidades.oncologia.peso') }}</label>
                <input
                  id="ciclo-peso"
                  v-model="peso"
                  type="text"
                  inputmode="decimal"
                  maxlength="6"
                  required
                />
              </div>
              <div class="campo">
                <label for="ciclo-altura">{{ t('especialidades.oncologia.altura') }}</label>
                <input id="ciclo-altura" v-model="altura" type="number" min="30" max="250" required />
              </div>
              <div class="campo">
                <label for="ciclo-creatinina">{{ t('especialidades.oncologia.creatinina') }}</label>
                <input
                  id="ciclo-creatinina"
                  v-model="creatinina"
                  type="text"
                  inputmode="decimal"
                  maxlength="5"
                />
              </div>
              <div class="campo">
                <label for="ciclo-reducao">{{ t('especialidades.oncologia.reducaoPct') }}</label>
                <input id="ciclo-reducao" v-model="reducao" type="number" min="0" max="75" />
              </div>
            </div>
            <SanteCampoTexto
              v-model="motivoReducao"
              :rotulo="t('especialidades.oncologia.motivoReducao')"
              :max-bytes="200"
            />
            <SanteCampoTexto
              v-model="justificativa"
              :rotulo="t('especialidades.oncologia.justificativaIntervalo')"
              :max-bytes="200"
            />
            <label class="opcao">
              <input v-model="novoTratamento" type="checkbox" data-testid="ciclo-novo-tratamento" />
              {{ t('especialidades.oncologia.novoTratamento') }}
            </label>
            <SanteCampoTexto
              v-if="novoTratamento"
              v-model="motivoTratamento"
              :rotulo="t('especialidades.oncologia.motivoNovoTratamento')"
              :max-bytes="200"
              data-testid="ciclo-motivo-tratamento"
            />
            <ErroEspecialidade v-if="erro" :erro="erro" />
            <SanteBotao
              tipo="submit"
              :rotulo="t('especialidades.oncologia.registrarCiclo')"
              :desabilitado="
                ocupado || protocolo === null || !dataPrevista || (novoTratamento && !motivoTratamento.trim())
              "
              data-testid="ciclo-gravar"
            />
          </form>
        </section>
      </div>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-especialidades.css"></style>
<style src="../../nutricao/componentes/estilo-correcao.css"></style>
<style scoped>
.versoes-anteriores {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.versoes-anteriores h3 {
  margin: 0;
  font-size: 1rem;
}
</style>
