<script setup lang="ts">
// Regra do plano na recepção (02-CAD linha 24): `/recepcao/atendimento/regras-plano`. Numa tela só, por fonte
// pagadora: o que a recepção confere ao abrir o atendimento em cada plano ou categoria (carteira com tamanho e prefixo,
// validade, titular, guia, senha, código de validação, documentos e orientação), o teto de atendimentos no período e a
// pendência do plano. A validação é a do domínio (a mesma que o servidor repete), na hora, campo a campo; a regra nova
// encerra a anterior da mesma chave na véspera, e o encerramento muda só a vigência (nada se apaga). A prévia mostra a
// crítica que a abertura vai aplicar, sem gravar.
import { type PropostaRegraPlano, PENDENCIAS_PLANO, validarRegraPlano } from '@sgh/dominio-recepcao';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteChave, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { novaChave } from '../api-atendimento.js';
import {
  type CriticaPlanoTela,
  type IncluirRegraPlano,
  lerFontesRegraPlano,
  lerRegrasPlano,
  manterRegraPlano,
  previaRegraPlano,
  type RegraPlanoTela,
} from '../api-regras-plano.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Regras do plano na recepção',
      texto:
        'O que a recepção confere ao abrir o atendimento em cada plano da fonte pagadora: carteira, guia, senha, documentos, o teto de atendimentos e a pendência do plano. A regra mais específica vale (plano, plano superior, categoria e unidade); o bloqueio recusa a abertura e o alerta avisa a recepção.',
      fonte: 'Fonte pagadora',
      escolhaFonte: 'Escolha a fonte pagadora',
      carregando: 'Carregando…',
      todosPlanos: 'Todos os planos',
      todasCategorias: 'Todas as categorias',
      regras: 'Regras da fonte',
      legenda: 'Regras da fonte pagadora, das mais recentes para as mais antigas',
      vazio: 'Nenhuma regra própria: a abertura segue sem crítica do plano.',
      plano: 'Plano',
      categoria: 'Categoria',
      especialidade: 'Especialidade',
      servico: 'Serviço',
      setor: 'Setor',
      todasEspecialidades: 'Todas as especialidades',
      todosServicos: 'Todos os serviços',
      todosSetores: 'Todos os setores',
      alcance: 'Especialidade, serviço e setor',
      unidade: 'Unidade',
      estaUnidade: 'Esta unidade',
      todasUnidades: 'Todas as unidades',
      exigencias: 'Exigências',
      teto: 'Teto',
      tetoTexto: '{n} em {d} dias',
      bloqueia: 'bloqueia',
      alerta: 'alerta',
      pendencia: 'Pendência',
      vigencia: 'Vigência',
      vigente: 'Vigente',
      periodo: '{de} a {ate}',
      semFim: 'sem fim',
      acao: 'Ação',
      encerrar: 'Encerrar',
      encerrarEm: 'Fim da vigência',
      confirmarEncerrar: 'Confirmar o encerramento',
      cancelar: 'Cancelar',
      nova: 'Nova regra',
      novaTexto:
        'A regra nova encerra, na véspera do início, a regra anterior com o mesmo plano, categoria e unidade.',
      exigeCarteira: 'Exige a carteira',
      exigeValidadeCarteira: 'Exige a validade da carteira',
      exigeTitular: 'Exige o nome do titular',
      exigeGuia: 'Exige a guia',
      exigeSenhaAutorizacao: 'Exige a senha de autorização',
      exigeCodigoValidacao: 'Exige o código de validação do beneficiário',
      permiteDependentes: 'Aceita dependentes',
      tamanhoCarteira: 'Tamanho da carteira (caracteres)',
      prefixoCarteira: 'Prefixo da carteira',
      prazoRetornoDias: 'Prazo de retorno (dias)',
      documentosExigidos: 'Documentos pedidos (um por linha)',
      orientacaoRecepcao: 'Orientação à recepção',
      tetoAtendimentos: 'Teto de atendimentos',
      tetoPeriodoDias: 'Período do teto (dias)',
      tetoBloqueia: 'O teto bloqueia a abertura',
      pendenciaMotivo: 'Motivo da pendência',
      vigenciaInicio: 'Início da vigência',
      vigenciaFim: 'Fim da vigência (opcional)',
      numeroInvalido: 'Informe um número inteiro.',
      gravar: 'Gravar a regra',
      pendencias: { nenhuma: 'Nenhuma', alerta: 'Alerta', bloqueio: 'Bloqueio' },
      siglas: {
        exigeCarteira: 'carteira',
        exigeValidadeCarteira: 'validade',
        exigeTitular: 'titular',
        exigeGuia: 'guia',
        exigeSenhaAutorizacao: 'senha',
        exigeCodigoValidacao: 'código de validação',
      },
      previa: 'Conferir a abertura',
      previaTexto:
        'Monte os dados de uma abertura e veja o que a regra vigente faria, sem gravar nada (a mesma crítica da abertura).',
      carteira: 'Carteira',
      validadeCarteira: 'Validade da carteira',
      guia: 'Guia',
      senhaAutorizacao: 'Senha de autorização',
      validadeSenha: 'Validade da senha',
      conferir: 'Conferir',
      semRegra: 'Nenhuma regra vigente para esses dados: a abertura segue sem crítica do plano.',
      liberada: 'A abertura passa pela regra do plano.',
      bloqueios: 'Bloqueios (a abertura é recusada)',
      alertas: 'Alertas (a abertura segue com o aviso)',
      documentos: 'Documentos: {lista}.',
      noPeriodo: 'Atendimentos no período do teto: {n}.',
    },
  },
});

const qc = useQueryClient();
const podeEditar = computed(() => pode('convenio.contrato.editar'));
const podePrevia = computed(() => pode('atendimento.atendimento.abrir'));
const fontes = useQuery({
  queryKey: ['atendimento', 'regras-plano', 'fontes'],
  queryFn: lerFontesRegraPlano,
});
const fonte = ref('');
const fonteId = computed(() => (fonte.value === '' ? 0 : Number(fonte.value)));
const CHAVE = computed(() => ['atendimento', 'regras-plano', fonteId.value]);
const dados = useQuery({
  queryKey: CHAVE,
  queryFn: () => lerRegrasPlano(fonteId.value),
  enabled: computed(() => fonteId.value > 0),
});
const opcoesFonte = computed(() => [
  ...(fonte.value === '' ? [{ valor: '', rotulo: t('escolhaFonte') }] : []),
  ...(fontes.data.value ?? []).map((o) => ({ valor: String(o.id), rotulo: o.rotulo })),
]);
const opcoesPlano = computed(() => [
  { valor: '', rotulo: t('todosPlanos') },
  ...(dados.data.value?.planos ?? []).map((o) => ({ valor: String(o.id), rotulo: o.rotulo })),
]);
const opcoesDe = (l: { id: number; rotulo: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(l ?? []).map((o) => ({ valor: String(o.id), rotulo: o.rotulo })),
];
const opcoesEspecialidade = computed(() =>
  opcoesDe(dados.data.value?.especialidades, t('todasEspecialidades')),
);
const opcoesServico = computed(() => opcoesDe(dados.data.value?.servicos, t('todosServicos')));
const opcoesSetor = computed(() => opcoesDe(dados.data.value?.setores, t('todosSetores')));
const alcanceDe = (r: {
  especialidadeId: number | null;
  servicoId: number | null;
  setorId: number | null;
}) => {
  const d = dados.data.value;
  return [
    rotuloDe(d?.especialidades ?? [], r.especialidadeId, t('todasEspecialidades')),
    rotuloDe(d?.servicos ?? [], r.servicoId, t('todosServicos')),
    rotuloDe(d?.setores ?? [], r.setorId, t('todosSetores')),
  ].join(' · ');
};
const opcoesCategoria = computed(() => [
  { valor: '', rotulo: t('todasCategorias') },
  ...(dados.data.value?.categorias ?? []).map((o) => ({ valor: String(o.id), rotulo: o.rotulo })),
]);
const opcoesPendencia = PENDENCIAS_PLANO.map((p) => ({ valor: p, rotulo: t(`pendencias.${p}`) }));
const rotuloDe = (
  lista: readonly { id: number; rotulo: string }[] | undefined,
  id: number | null,
  todos: string,
) => (id === null ? todos : (lista?.find((o) => o.id === id)?.rotulo ?? `#${id}`));
const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : t('semFim'));
const EXIGENCIAS = [
  'exigeCarteira',
  'exigeValidadeCarteira',
  'exigeTitular',
  'exigeGuia',
  'exigeSenhaAutorizacao',
  'exigeCodigoValidacao',
] as const;
const exigenciasDe = (r: RegraPlanoTela) =>
  EXIGENCIAS.filter((k) => r[k])
    .map((k) => t(`siglas.${k}`))
    .join(', ') || '—';

const erro = ref<unknown>(null);
const mensagem = ref('');
const ocupado = ref(false);

// ── Nova regra ──
const formVazio = (hoje: string) => ({
  plano: '',
  categoria: '',
  especialidade: '',
  servico: '',
  setor: '',
  todasUnidades: false,
  exigeCarteira: false,
  exigeValidadeCarteira: false,
  exigeTitular: false,
  exigeGuia: false,
  exigeSenhaAutorizacao: false,
  exigeCodigoValidacao: false,
  permiteDependentes: true,
  tamanhoCarteira: '',
  prefixoCarteira: '',
  prazoRetornoDias: '',
  documentos: '',
  orientacao: '',
  tetoAtendimentos: '',
  tetoPeriodoDias: '',
  tetoBloqueia: false,
  pendencia: 'nenhuma' as (typeof PENDENCIAS_PLANO)[number],
  pendenciaMotivo: '',
  vigenciaInicio: hoje,
  vigenciaFim: '',
});
const f = ref(formVazio(''));
const tocado = ref(false);
watch(
  () => dados.data.value?.hoje,
  (h) => {
    if (h && !tocado.value) f.value = formVazio(h);
  },
  { immediate: true },
);
watch(f, () => (tocado.value = true), { deep: true });

/** Texto de número inteiro: '' vira nulo; texto que não é inteiro vira NaN (a tela avisa e trava o botão). */
const inteiro = (v: string): number | null =>
  v.trim() === '' ? null : /^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
const NUMERICOS = ['tamanhoCarteira', 'prazoRetornoDias', 'tetoAtendimentos', 'tetoPeriodoDias'] as const;

const proposta = computed((): PropostaRegraPlano => {
  const x = f.value;
  return {
    planoId: x.plano === '' ? null : Number(x.plano),
    categoriaId: x.categoria === '' ? null : Number(x.categoria),
    estabelecimentoId: null,
    exigeCarteira: x.exigeCarteira,
    exigeValidadeCarteira: x.exigeValidadeCarteira,
    exigeTitular: x.exigeTitular,
    exigeGuia: x.exigeGuia,
    exigeSenhaAutorizacao: x.exigeSenhaAutorizacao,
    exigeCodigoValidacao: x.exigeCodigoValidacao,
    tamanhoCarteira: inteiro(x.tamanhoCarteira),
    prefixoCarteira: x.prefixoCarteira.trim() || null,
    permiteDependentes: x.permiteDependentes,
    prazoRetornoDias: inteiro(x.prazoRetornoDias),
    documentosExigidos: x.documentos
      .split('\n')
      .map((d) => d.trim())
      .filter((d) => d !== ''),
    orientacaoRecepcao: x.orientacao.trim() || null,
    tetoAtendimentos: inteiro(x.tetoAtendimentos),
    tetoPeriodoDias: inteiro(x.tetoPeriodoDias),
    tetoBloqueia: x.tetoBloqueia,
    pendencia: x.pendencia,
    pendenciaMotivo: x.pendencia === 'nenhuma' ? null : x.pendenciaMotivo.trim() || null,
    vigenciaInicio: x.vigenciaInicio,
    vigenciaFim: x.vigenciaFim || null,
  };
});
const erros = computed((): Record<string, string> => {
  const p = proposta.value;
  const e: Record<string, string> = {};
  for (const k of NUMERICOS) if (Number.isNaN(p[k])) e[k] = t('numeroInvalido');
  return { ...validarRegraPlano(p), ...e };
});
const temErro = computed(() => Object.keys(erros.value).length > 0);
const erroDe = (campo: string) => (tocado.value ? (erros.value[campo] ?? null) : null);

async function gravar(a: Parameters<typeof manterRegraPlano>[0]): Promise<boolean> {
  erro.value = null;
  mensagem.value = '';
  ocupado.value = true;
  try {
    const r = await manterRegraPlano(a, novaChave('regra-plano'));
    mensagem.value = r.mensagem ?? '';
    await qc.invalidateQueries({ queryKey: CHAVE.value });
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  } finally {
    ocupado.value = false;
  }
}

async function incluir(): Promise<void> {
  tocado.value = true;
  if (temErro.value || fonteId.value <= 0) return;
  const p = proposta.value;
  const a: IncluirRegraPlano = {
    acao: 'incluir',
    fonteId: fonteId.value,
    planoId: p.planoId,
    categoriaId: p.categoriaId,
    especialidadeId: f.value.especialidade === '' ? null : Number(f.value.especialidade),
    servicoId: f.value.servico === '' ? null : Number(f.value.servico),
    setorId: f.value.setor === '' ? null : Number(f.value.setor),
    todasUnidades: f.value.todasUnidades,
    exigeCarteira: p.exigeCarteira,
    exigeValidadeCarteira: p.exigeValidadeCarteira,
    exigeTitular: p.exigeTitular,
    exigeGuia: p.exigeGuia,
    exigeSenhaAutorizacao: p.exigeSenhaAutorizacao,
    exigeCodigoValidacao: p.exigeCodigoValidacao,
    tamanhoCarteira: p.tamanhoCarteira,
    prefixoCarteira: p.prefixoCarteira,
    permiteDependentes: p.permiteDependentes,
    prazoRetornoDias: p.prazoRetornoDias,
    documentosExigidos: [...p.documentosExigidos],
    orientacaoRecepcao: p.orientacaoRecepcao,
    tetoAtendimentos: p.tetoAtendimentos,
    tetoPeriodoDias: p.tetoPeriodoDias,
    tetoBloqueia: p.tetoBloqueia,
    pendencia: p.pendencia,
    pendenciaMotivo: p.pendenciaMotivo,
    vigenciaInicio: p.vigenciaInicio,
    vigenciaFim: p.vigenciaFim,
  };
  if (await gravar(a)) {
    f.value = formVazio(dados.data.value?.hoje ?? '');
    tocado.value = false;
  }
}

// ── Encerrar ──
const encerrando = ref<{ id: number; versao: number; fim: string } | null>(null);
const podeEncerrar = (r: RegraPlanoTela) =>
  podeEditar.value && (r.vigenciaFim === null || r.vigenciaFim >= (dados.data.value?.hoje ?? ''));
function pedirEncerrar(r: RegraPlanoTela): void {
  encerrando.value = { id: r.id, versao: r.versao, fim: dados.data.value?.hoje ?? '' };
}
async function encerrar(): Promise<void> {
  const e = encerrando.value;
  if (!e || !e.fim) return;
  if (
    await gravar({ acao: 'encerrar', fonteId: fonteId.value, id: e.id, versao: e.versao, vigenciaFim: e.fim })
  )
    encerrando.value = null;
}

// ── Prévia ──
const pv = ref({
  plano: '',
  categoria: '',
  carteira: '',
  validadeCarteira: '',
  guia: '',
  senhaAutorizacao: '',
  validadeSenha: '',
});
const critica = ref<CriticaPlanoTela | null>(null);
const erroPrevia = ref<unknown>(null);
watch(fonteId, () => {
  critica.value = null;
  encerrando.value = null;
  pv.value.plano = '';
  pv.value.categoria = '';
});
const ouNulo = (v: string) => (v.trim() === '' ? null : v.trim());
async function conferir(): Promise<void> {
  erroPrevia.value = null;
  try {
    critica.value = await previaRegraPlano({
      fonteId: fonteId.value,
      planoId: pv.value.plano === '' ? null : Number(pv.value.plano),
      categoriaId: pv.value.categoria === '' ? null : Number(pv.value.categoria),
      carteira: ouNulo(pv.value.carteira),
      validadeCarteira: ouNulo(pv.value.validadeCarteira),
      guia: ouNulo(pv.value.guia),
      senhaAutorizacao: ouNulo(pv.value.senhaAutorizacao),
      validadeSenha: ouNulo(pv.value.validadeSenha),
    });
  } catch (x) {
    erroPrevia.value = x;
    critica.value = null;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rp-titulo" data-testid="tela-regras-plano">
    <h1 id="rp-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>
    <MensagemErro v-if="fontes.error.value" :erro="fontes.error.value" />
    <SanteSelecao v-model="fonte" :rotulo="t('fonte')" :opcoes="opcoesFonte" busca data-testid="rp-fonte" />
    <MensagemErro v-if="erro || dados.error.value" :erro="erro ?? dados.error.value" />
    <p v-if="mensagem" role="status" data-testid="rp-mensagem">{{ mensagem }}</p>
    <p v-if="fonteId > 0 && dados.isLoading.value" role="status">{{ t('carregando') }}</p>

    <template v-if="dados.data.value">
      <section class="painel" aria-labelledby="rp-regras">
        <h2 id="rp-regras">{{ t('regras') }}</h2>
        <p v-if="dados.data.value.regras.length === 0" data-testid="rp-vazio">{{ t('vazio') }}</p>
        <table v-else class="tabela" data-testid="rp-tabela">
          <caption>
            {{
              t('legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('plano') }}</th>
              <th scope="col">{{ t('categoria') }}</th>
              <th scope="col">{{ t('alcance') }}</th>
              <th scope="col">{{ t('unidade') }}</th>
              <th scope="col">{{ t('exigencias') }}</th>
              <th scope="col">{{ t('teto') }}</th>
              <th scope="col">{{ t('pendencia') }}</th>
              <th scope="col">{{ t('vigencia') }}</th>
              <th scope="col">{{ t('acao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in dados.data.value.regras" :key="r.id" :data-testid="`rp-regra-${r.id}`">
              <td>{{ rotuloDe(dados.data.value.planos, r.planoId, t('todosPlanos')) }}</td>
              <td>{{ rotuloDe(dados.data.value.categorias, r.categoriaId, t('todasCategorias')) }}</td>
              <td>{{ alcanceDe(r) }}</td>
              <td>{{ r.estabelecimentoId === null ? t('todasUnidades') : t('estaUnidade') }}</td>
              <td>
                {{ exigenciasDe(r) }}
                <span v-if="r.documentosExigidos.length" class="secundario">
                  · {{ r.documentosExigidos.join(', ') }}</span
                >
              </td>
              <td>
                <template v-if="r.tetoAtendimentos !== null">
                  {{ t('tetoTexto', { n: r.tetoAtendimentos, d: r.tetoPeriodoDias }) }}
                  ({{ r.tetoBloqueia ? t('bloqueia') : t('alerta') }})
                </template>
                <template v-else>—</template>
              </td>
              <td>
                {{ t(`pendencias.${r.pendencia}`) }}
                <span v-if="r.pendenciaMotivo" class="secundario">· {{ r.pendenciaMotivo }}</span>
              </td>
              <td>
                {{ t('periodo', { de: dataBr(r.vigenciaInicio), ate: dataBr(r.vigenciaFim) }) }}
                <strong v-if="r.vigente" :data-testid="`rp-vigente-${r.id}`">· {{ t('vigente') }}</strong>
              </td>
              <td>
                <template v-if="encerrando?.id === r.id">
                  <label :for="`rp-fim-${r.id}`">{{ t('encerrarEm') }}</label>
                  <input
                    :id="`rp-fim-${r.id}`"
                    v-model="encerrando.fim"
                    type="date"
                    data-testid="rp-encerrar-data"
                  />
                  <SanteBotao
                    :rotulo="t('confirmarEncerrar')"
                    :desabilitado="ocupado || !encerrando.fim"
                    data-testid="rp-encerrar-confirmar"
                    @acionar="encerrar"
                  />
                  <SanteBotao variante="secundario" :rotulo="t('cancelar')" @acionar="encerrando = null" />
                </template>
                <SanteBotao
                  v-else-if="podeEncerrar(r)"
                  variante="secundario"
                  :rotulo="t('encerrar')"
                  :data-testid="`rp-encerrar-${r.id}`"
                  @acionar="pedirEncerrar(r)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="podeEditar" class="painel" aria-labelledby="rp-nova">
        <h2 id="rp-nova">{{ t('nova') }}</h2>
        <p class="secundario">{{ t('novaTexto') }}</p>
        <form class="grade-campos" data-testid="rp-form" @submit.prevent="incluir">
          <SanteSelecao v-model="f.plano" :rotulo="t('plano')" :opcoes="opcoesPlano" data-testid="rp-plano" />
          <SanteSelecao
            v-model="f.categoria"
            :rotulo="t('categoria')"
            :opcoes="opcoesCategoria"
            data-testid="rp-categoria"
          />
          <SanteSelecao
            v-model="f.especialidade"
            :rotulo="t('especialidade')"
            :opcoes="opcoesEspecialidade"
            data-testid="rp-especialidade"
          />
          <SanteSelecao
            v-model="f.servico"
            :rotulo="t('servico')"
            :opcoes="opcoesServico"
            data-testid="rp-servico"
          />
          <SanteSelecao v-model="f.setor" :rotulo="t('setor')" :opcoes="opcoesSetor" data-testid="rp-setor" />
          <SanteChave
            :ligada="f.todasUnidades"
            :rotulo="t('todasUnidades')"
            data-testid="rp-todas-unidades"
            @alternar="(v: boolean) => (f.todasUnidades = v)"
          />
          <template v-for="k in EXIGENCIAS" :key="k">
            <SanteChave
              :ligada="f[k]"
              :rotulo="t(k)"
              :data-testid="`rp-${k}`"
              @alternar="(v: boolean) => (f[k] = v)"
            />
            <p v-if="erroDe(k)" class="erro-campo" :data-testid="`rp-erro-${k}`">{{ erroDe(k) }}</p>
          </template>
          <SanteChave
            :ligada="f.permiteDependentes"
            :rotulo="t('permiteDependentes')"
            data-testid="rp-permite-dependentes"
            @alternar="(v: boolean) => (f.permiteDependentes = v)"
          />
          <div v-for="k in NUMERICOS" :key="k" class="campo">
            <label :for="`rp-campo-${k}`">{{ t(k) }}</label>
            <input
              :id="`rp-campo-${k}`"
              v-model="f[k]"
              inputmode="numeric"
              maxlength="5"
              :aria-invalid="erroDe(k) ? 'true' : undefined"
              :data-testid="`rp-campo-${k}`"
            />
            <p v-if="erroDe(k)" class="erro-campo" :data-testid="`rp-erro-${k}`">{{ erroDe(k) }}</p>
          </div>
          <div class="campo">
            <label for="rp-campo-prefixo">{{ t('prefixoCarteira') }}</label>
            <input
              id="rp-campo-prefixo"
              v-model="f.prefixoCarteira"
              maxlength="10"
              :aria-invalid="erroDe('prefixoCarteira') ? 'true' : undefined"
              data-testid="rp-campo-prefixoCarteira"
            />
            <p v-if="erroDe('prefixoCarteira')" class="erro-campo" data-testid="rp-erro-prefixoCarteira">
              {{ erroDe('prefixoCarteira') }}
            </p>
          </div>
          <SanteChave
            :ligada="f.tetoBloqueia"
            :rotulo="t('tetoBloqueia')"
            data-testid="rp-teto-bloqueia"
            @alternar="(v: boolean) => (f.tetoBloqueia = v)"
          />
          <p v-if="erroDe('tetoBloqueia')" class="erro-campo" data-testid="rp-erro-tetoBloqueia">
            {{ erroDe('tetoBloqueia') }}
          </p>
          <SanteSelecao
            v-model="f.pendencia"
            :rotulo="t('pendencia')"
            :opcoes="opcoesPendencia"
            data-testid="rp-pendencia"
          />
          <div v-if="f.pendencia !== 'nenhuma'" class="campo">
            <label for="rp-campo-pendencia-motivo">{{ t('pendenciaMotivo') }}</label>
            <input
              id="rp-campo-pendencia-motivo"
              v-model="f.pendenciaMotivo"
              maxlength="500"
              data-testid="rp-campo-pendenciaMotivo"
            />
            <p v-if="erroDe('pendenciaMotivo')" class="erro-campo" data-testid="rp-erro-pendenciaMotivo">
              {{ erroDe('pendenciaMotivo') }}
            </p>
          </div>
          <SanteCampoTexto
            id="rp-campo-documentos"
            v-model="f.documentos"
            :rotulo="t('documentosExigidos')"
            :max-bytes="2400"
            multilinha
          />
          <p v-if="erroDe('documentosExigidos')" class="erro-campo" data-testid="rp-erro-documentosExigidos">
            {{ erroDe('documentosExigidos') }}
          </p>
          <SanteCampoTexto
            id="rp-campo-orientacao"
            v-model="f.orientacao"
            :rotulo="t('orientacaoRecepcao')"
            :max-bytes="2000"
            multilinha
          />
          <div class="campo">
            <label for="rp-campo-inicio">{{ t('vigenciaInicio') }}</label>
            <input
              id="rp-campo-inicio"
              v-model="f.vigenciaInicio"
              type="date"
              data-testid="rp-campo-vigenciaInicio"
            />
            <p v-if="erroDe('vigenciaInicio')" class="erro-campo" data-testid="rp-erro-vigenciaInicio">
              {{ erroDe('vigenciaInicio') }}
            </p>
          </div>
          <div class="campo">
            <label for="rp-campo-fim">{{ t('vigenciaFim') }}</label>
            <input id="rp-campo-fim" v-model="f.vigenciaFim" type="date" data-testid="rp-campo-vigenciaFim" />
            <p v-if="erroDe('vigenciaFim')" class="erro-campo" data-testid="rp-erro-vigenciaFim">
              {{ erroDe('vigenciaFim') }}
            </p>
          </div>
          <p class="acoes">
            <SanteBotao
              :rotulo="t('gravar')"
              :desabilitado="ocupado || (tocado && temErro)"
              data-testid="rp-gravar"
              @acionar="incluir"
            />
          </p>
        </form>
      </section>

      <section v-if="podePrevia" class="painel" aria-labelledby="rp-previa">
        <h2 id="rp-previa">{{ t('previa') }}</h2>
        <p class="secundario">{{ t('previaTexto') }}</p>
        <div class="grade-campos">
          <SanteSelecao
            v-model="pv.plano"
            :rotulo="t('plano')"
            :opcoes="opcoesPlano"
            data-testid="rp-previa-plano"
          />
          <SanteSelecao
            v-model="pv.categoria"
            :rotulo="t('categoria')"
            :opcoes="opcoesCategoria"
            data-testid="rp-previa-categoria"
          />
          <div v-for="k in ['carteira', 'guia', 'senhaAutorizacao'] as const" :key="k" class="campo">
            <label :for="`rp-previa-${k}`">{{ t(k) }}</label>
            <input :id="`rp-previa-${k}`" v-model="pv[k]" maxlength="30" :data-testid="`rp-previa-${k}`" />
          </div>
          <div v-for="k in ['validadeCarteira', 'validadeSenha'] as const" :key="k" class="campo">
            <label :for="`rp-previa-${k}`">{{ t(k) }}</label>
            <input :id="`rp-previa-${k}`" v-model="pv[k]" type="date" :data-testid="`rp-previa-${k}`" />
          </div>
        </div>
        <p class="acoes">
          <SanteBotao :rotulo="t('conferir')" data-testid="rp-previa-conferir" @acionar="conferir" />
        </p>
        <MensagemErro v-if="erroPrevia" :erro="erroPrevia" />
        <div v-if="critica" data-testid="rp-previa-resultado" aria-live="polite">
          <SanteAlerta v-if="critica.regraId === null" variante="info" :texto="t('semRegra')" />
          <template v-else>
            <SanteAlerta
              v-if="critica.bloqueios.length === 0 && critica.alertas.length === 0"
              variante="info"
              :texto="t('liberada')"
            />
            <div v-if="critica.bloqueios.length" data-testid="rp-previa-bloqueios">
              <h3>{{ t('bloqueios') }}</h3>
              <ul>
                <li v-for="b in critica.bloqueios" :key="b.codigo">{{ b.mensagem }}</li>
              </ul>
            </div>
            <div v-if="critica.alertas.length" data-testid="rp-previa-alertas">
              <h3>{{ t('alertas') }}</h3>
              <ul>
                <li v-for="a in critica.alertas" :key="a.codigo">{{ a.mensagem }}</li>
              </ul>
            </div>
            <p v-if="critica.documentos.length">
              {{ t('documentos', { lista: critica.documentos.join(', ') }) }}
            </p>
            <p v-if="critica.orientacao">{{ critica.orientacao }}</p>
            <p class="secundario">{{ t('noPeriodo', { n: critica.atendimentosNoPeriodo }) }}</p>
          </template>
        </div>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.grade-campos {
  display: grid;
  gap: var(--sgh-espaco-3);
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
}
.erro-campo {
  margin: 0;
  color: var(--sgh-alerta);
}
</style>
