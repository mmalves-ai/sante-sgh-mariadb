<!--
  C2-053 (01-ADM L117): central de comando assistencial. Uma tela só, na ordem do plantão: o resumo da unidade, os
  alertas de fluxo com o nível, os pacientes em ordem de gravidade (leito, riscos, metas das 24 horas, NEWS2 e
  protocolos abertos) e, ao abrir um, a visão do paciente: reconhecer, resolver ou descartar o risco com a conduta e as
  metas das 24 horas (incluir com prazo de até 24 h, encerrar com justificativa). Abaixo, a configuração feita pelo
  hospital: temas, regras de risco com critérios (exame, medicamento, dose, CID-10, sinal vital, permanência; presença
  ou ausência) e os limites de fluxo. A validação é a do domínio, na hora; o servidor confere de novo.
-->
<script setup lang="ts">
import {
  CATEGORIAS_META_24H,
  GRAVIDADES_REGRA_RISCO,
  MENSAGENS_ALERTA_FLUXO,
  MENSAGENS_META_24H,
  MENSAGENS_REGRA_RISCO,
  problemaDaNovaMeta,
  problemaDaPassagem,
  problemaDoEncerramentoMeta,
  problemasDaRegraRisco,
  problemasDoAlertaFluxo,
  TIPOS_ALERTA_FLUXO,
  TIPOS_CRITERIO_RISCO,
  UNIDADE_DO_ALERTA,
  type CriterioRisco,
  type TipoAlertaFluxo,
  type TipoCriterioRisco,
  type UnidadeLimite,
} from '@sgh/dominio-enfermagem';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apurar,
  ativarRegra,
  encerrarMeta,
  inativarAlerta,
  incluirAlerta,
  incluirMeta,
  incluirRegra,
  incluirTema,
  lerAtendimento,
  lerConfiguracao,
  lerQuadro,
  type Meta,
  type Ocorrencia,
  passarOcorrencia,
  type SituacaoMeta,
} from '../api-central-comando.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const { t } = useI18n();
const qc = useQueryClient();
const k = (s: string) => `enfermagem.centralComando.${s}`;
const CHAVE = 'central-comando';

const unidadeEscolhida = ref('');
const unidade = computed(() => Number(unidadeEscolhida.value) || null);
const quadro = useQuery({
  queryKey: computed(() => [CHAVE, 'quadro', unidade.value]),
  queryFn: () => lerQuadro(unidade.value),
  refetchInterval: 60_000,
});
const configuracao = useQuery({ queryKey: [CHAVE, 'configuracao'], queryFn: lerConfiguracao });
const apoio = computed(
  () => configuracao.data.value?.apoio ?? { exames: [], itens: [], sinais: [], unidades: [] },
);
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t(k('todasUnidades')) },
  ...apoio.value.unidades.map((u) => ({ valor: String(u.id), rotulo: u.rotulo })),
]);

const mensagem = ref('');
const erro = ref<unknown>(null);
async function gravar(acao: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  try {
    mensagem.value = (await acao()).mensagem;
    await qc.invalidateQueries({ queryKey: [CHAVE] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}
async function apurarAgora() {
  erro.value = null;
  try {
    const r = await apurar();
    mensagem.value = t(k('apurado'), {
      avaliados: r.avaliados,
      abertas: r.abertas,
      encerradas: r.encerradas,
    });
    await qc.invalidateQueries({ queryKey: [CHAVE] });
  } catch (e) {
    erro.value = e;
  }
}
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');

// ── Visão do paciente ──
const aberto = ref<number | null>(null);
const pacienteAberto = computed(
  () => quadro.data.value?.pacientes.find((p) => p.atendimento === aberto.value) ?? null,
);
const visao = useQuery({
  queryKey: computed(() => [CHAVE, 'atendimento', aberto.value]),
  queryFn: () => lerAtendimento(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});

const condutas = ref<Record<number, string>>({});
const problemaConduta = (o: Ocorrencia, acao: 'reconhecer' | 'resolver' | 'descartar') =>
  problemaDaPassagem(o.situacao, acao, (condutas.value[o.id] ?? '').trim() || null);
const passar = (o: Ocorrencia, acao: 'reconhecer' | 'resolver' | 'descartar') =>
  gravar(() =>
    passarOcorrencia(
      o.id,
      acao,
      o.versao,
      acao === 'reconhecer' ? null : (condutas.value[o.id] ?? '').trim() || null,
    ),
  );
const condutaCurta = (o: Ocorrencia) => (condutas.value[o.id] ?? '').trim().length < 10;
const descreverEvidencia = (o: Ocorrencia) =>
  (o.evidencia?.criterios ?? [])
    .map(
      (c) =>
        `${t(k(`tiposCriterio.${c.tipo}`))}${c.negado ? ` (${t(k('ausente'))})` : ''}${
          c.valor !== null ? `: ${c.valor}` : ''
        }`,
    )
    .join('; ');

const justificativas = ref<Record<number, string>>({});
const problemaEncerrar = (m: Meta, nova: Exclude<SituacaoMeta, 'pendente'>) =>
  problemaDoEncerramentoMeta(m.situacao, nova, (justificativas.value[m.id] ?? '').trim() || null);
const encerrar = (m: Meta, nova: Exclude<SituacaoMeta, 'pendente'>) =>
  gravar(() => encerrarMeta(m.id, m.versao, nova, (justificativas.value[m.id] ?? '').trim() || null));

const doisDigitos = (n: number) => String(n).padStart(2, '0');
function localDaqui(horas: number): string {
  const d = new Date(Date.now() + horas * 3_600_000);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}T${doisDigitos(
    d.getHours(),
  )}:${doisDigitos(d.getMinutes())}`;
}
const novaMeta = ref({ categoria: 'seguranca', descricao: '', prazo: localDaqui(12), ocorrencia: '' });
const opcoesCategoria = computed(() =>
  CATEGORIAS_META_24H.map((c) => ({ valor: c, rotulo: t(k(`categorias.${c}`)) })),
);
const opcoesOcorrencia = computed(() => [
  { valor: '', rotulo: t(k('nenhuma')) },
  ...(visao.data.value?.ocorrencias ?? [])
    .filter((o) => o.situacao === 'aberta' || o.situacao === 'reconhecida')
    .map((o) => ({ valor: String(o.id), rotulo: o.regra })),
]);
const prazoIso = computed(() => {
  const ms = Date.parse(novaMeta.value.prazo);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
});
const problemaMeta = computed(() => {
  if (!prazoIso.value) return MENSAGENS_META_24H['prazo-passado'];
  const p = problemaDaNovaMeta(novaMeta.value.descricao, prazoIso.value, new Date().toISOString());
  return p ? MENSAGENS_META_24H[p] : null;
});
async function incluirNovaMeta() {
  const n = novaMeta.value;
  const ok = await gravar(() =>
    incluirMeta({
      atendimento: aberto.value!,
      categoria: n.categoria,
      descricao: n.descricao.trim(),
      prazoEm: prazoIso.value,
      ocorrencia: Number(n.ocorrencia) || null,
    }),
  );
  if (ok) novaMeta.value = { ...n, descricao: '', ocorrencia: '', prazo: localDaqui(12) };
}

// ── Configuração: temas ──
const novoTema = ref({ codigo: '', descricao: '' });
const temaInvalido = computed(
  () =>
    !/^[A-Za-z0-9._-]{2,30}$/.test(novoTema.value.codigo.trim()) ||
    novoTema.value.descricao.trim().length < 3,
);
async function incluirNovoTema() {
  const ok = await gravar(() =>
    incluirTema({ codigo: novoTema.value.codigo.trim(), descricao: novoTema.value.descricao.trim() }),
  );
  if (ok) novoTema.value = { codigo: '', descricao: '' };
}

// ── Configuração: regras ──
const motivosRegra = ref<Record<number, string>>({});
const opcoesTema = computed(() => [
  { valor: '', rotulo: t(k('escolha')) },
  ...(configuracao.data.value?.temas ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: String(x.id), rotulo: `${x.codigo} · ${x.descricao}` })),
]);
const opcoesGravidade = computed(() =>
  GRAVIDADES_REGRA_RISCO.map((g) => ({ valor: g, rotulo: t(k(`gravidades.${g}`)) })),
);
const opcoesCombinacao = computed(() =>
  (['todos', 'qualquer'] as const).map((c) => ({ valor: c, rotulo: t(k(`combinacoes.${c}`)) })),
);
const opcoesTipoCriterio = computed(() =>
  TIPOS_CRITERIO_RISCO.map((c) => ({ valor: c, rotulo: t(k(`tiposCriterio.${c}`)) })),
);
const opcoesPresenca = computed(() => [
  { valor: 'presente', rotulo: t(k('presencas.presente')) },
  { valor: 'ausente', rotulo: t(k('presencas.ausente')) },
]);
const alvosDo = (tipo: string) => {
  const lista =
    tipo === 'exame'
      ? apoio.value.exames
      : tipo === 'medicamento' || tipo === 'dose'
        ? apoio.value.itens
        : tipo === 'sinal_vital'
          ? apoio.value.sinais
          : [];
  return [
    { valor: '', rotulo: t(k('escolha')) },
    ...lista.map((o) => ({ valor: String(o.id), rotulo: o.rotulo })),
  ];
};

interface CriterioTela {
  tipo: TipoCriterioRisco;
  alvo: string;
  cid: string;
  horas: string;
  minimo: string;
  maximo: string;
  presenca: string;
}
const criterioVazio = (): CriterioTela => ({
  tipo: 'exame',
  alvo: '',
  cid: '',
  horas: '',
  minimo: '',
  maximo: '',
  presenca: 'presente',
});
const hoje = () => new Date().toISOString().slice(0, 10);
const novaRegra = ref({
  codigo: '',
  nome: '',
  tema: '',
  gravidade: 'alta',
  combinacao: 'todos',
  janela: '24',
  vigenciaInicio: hoje(),
  criterios: [criterioVazio()] as CriterioTela[],
});
const numero = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const criterioDoBanco = (c: CriterioTela): CriterioRisco => {
  const alvo = Number(c.alvo) || null;
  return {
    tipo: c.tipo,
    exame: c.tipo === 'exame' ? alvo : null,
    item: c.tipo === 'medicamento' || c.tipo === 'dose' ? alvo : null,
    cid: c.tipo === 'diagnostico' ? c.cid.trim() || null : null,
    parametroVital: c.tipo === 'sinal_vital' ? alvo : null,
    valorMinimo:
      c.tipo === 'dose' || c.tipo === 'sinal_vital' || c.tipo === 'exame' ? numero(c.minimo) : null,
    valorMaximo:
      c.tipo === 'dose' || c.tipo === 'sinal_vital' || c.tipo === 'exame' ? numero(c.maximo) : null,
    permanenciaMinimaHoras: c.tipo === 'permanencia' ? numero(c.horas) : null,
    negado: c.presenca === 'ausente',
  };
};
const regraDoBanco = computed(() => {
  const r = novaRegra.value;
  return {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    tema: Number(r.tema) || 0,
    gravidade: r.gravidade as (typeof GRAVIDADES_REGRA_RISCO)[number],
    sexo: 'ambos' as const,
    idadeMinimaDias: null,
    idadeMaximaDias: null,
    combinacao: r.combinacao as 'todos' | 'qualquer',
    janelaHoras: numero(r.janela),
    vigenciaInicio: r.vigenciaInicio,
    vigenciaFim: null,
    criterios: r.criterios.map(criterioDoBanco),
  };
});
const problemasRegra = computed(() => {
  const p: string[] = problemasDaRegraRisco(regraDoBanco.value).map((x) => MENSAGENS_REGRA_RISCO[x]);
  if (!regraDoBanco.value.tema) p.unshift(t(k('tema')) + ': ' + t(k('escolha')));
  return p;
});
async function gravarRegra() {
  const ok = await gravar(() => incluirRegra(regraDoBanco.value));
  if (ok) novaRegra.value = { ...novaRegra.value, codigo: '', nome: '', criterios: [criterioVazio()] };
}

// ── Configuração: limites de fluxo ──
const motivosAlerta = ref<Record<number, string>>({});
const novoAlerta = ref({ unidade: '', tipo: 'ocupacao', atencao: '', critico: '' });
const opcoesTipoAlerta = computed(() =>
  TIPOS_ALERTA_FLUXO.filter((x) => x !== 'indicador').map((x) => ({
    valor: x,
    rotulo: t(k(`tiposAlerta.${x}`)),
  })),
);
const unidadeDoLimite = computed<UnidadeLimite>(
  () => UNIDADE_DO_ALERTA[novoAlerta.value.tipo as Exclude<TipoAlertaFluxo, 'indicador'>],
);
const problemaAlerta = computed(() => {
  const critico = numero(novoAlerta.value.critico);
  if (critico === null || Number.isNaN(critico)) return t(k('limiteInvalido'));
  const p = problemasDoAlertaFluxo({
    tipo: novoAlerta.value.tipo as TipoAlertaFluxo,
    unidadeLimite: unidadeDoLimite.value,
    limiteAtencao: numero(novoAlerta.value.atencao),
    limiteCritico: critico,
    indicador: null,
  });
  return p.length ? MENSAGENS_ALERTA_FLUXO[p[0]!] : null;
});
async function incluirNovoAlerta() {
  const a = novoAlerta.value;
  const ok = await gravar(() =>
    incluirAlerta({
      unidade: Number(a.unidade) || null,
      tipo: a.tipo,
      unidadeLimite: unidadeDoLimite.value,
      limiteAtencao: numero(a.atencao),
      limiteCritico: numero(a.critico),
      indicador: null,
    }),
  );
  if (ok) novoAlerta.value = { ...a, atencao: '', critico: '' };
}
const opcoesUnidadeAlerta = computed(() => [
  { valor: '', rotulo: t(k('todasUnidades')) },
  ...apoio.value.unidades.map((u) => ({ valor: String(u.id), rotulo: u.rotulo })),
]);
</script>

<template>
  <section class="tela-enfermagem" aria-labelledby="cc-titulo">
    <h1 id="cc-titulo">{{ t(k('titulo')) }}</h1>
    <p>{{ t(k('texto')) }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="unidadeEscolhida"
        :rotulo="t(k('unidade'))"
        :opcoes="opcoesUnidade"
        data-testid="cc-unidade"
      />
      <SanteBotao :rotulo="t(k('apurar'))" data-testid="cc-apurar" @acionar="apurarAgora" />
    </div>
    <p v-if="mensagem" role="status" data-testid="cc-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="erro" :erro="erro" />

    <ErroEnfermagem v-if="quadro.isError.value" :erro="quadro.error.value" />
    <p v-else-if="quadro.isLoading.value">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else-if="quadro.data.value">
      <p class="discreto">{{ t(k('atualizadoEm'), { hora: hora(quadro.data.value.agora) }) }}</p>
      <dl class="resumo" data-testid="cc-resumo">
        <div>
          <dt>{{ t(k('resumo.pacientes')) }}</dt>
          <dd>{{ quadro.data.value.resumo.pacientes }}</dd>
        </div>
        <div>
          <dt>{{ t(k('resumo.comRisco')) }}</dt>
          <dd data-testid="cc-com-risco">{{ quadro.data.value.resumo.comRisco }}</dd>
        </div>
        <div>
          <dt>{{ t(k('resumo.riscosCriticos')) }}</dt>
          <dd :class="{ critico: quadro.data.value.resumo.riscosCriticos > 0 }">
            {{ quadro.data.value.resumo.riscosCriticos }}
          </dd>
        </div>
        <div>
          <dt>{{ t(k('resumo.metas')) }}</dt>
          <dd>
            {{ quadro.data.value.resumo.metas.cumpridas }} / {{ quadro.data.value.resumo.metas.total }}
            <span v-if="quadro.data.value.resumo.metas.percentual !== null">
              ({{ quadro.data.value.resumo.metas.percentual }}%)</span
            >
          </dd>
        </div>
        <div>
          <dt>{{ t(k('resumo.metasAtrasadas')) }}</dt>
          <dd :class="{ critico: quadro.data.value.resumo.metasAtrasadas > 0 }">
            {{ quadro.data.value.resumo.metasAtrasadas }}
          </dd>
        </div>
        <div>
          <dt>{{ t(k('resumo.alertasCriticos')) }}</dt>
          <dd :class="{ critico: quadro.data.value.resumo.alertasCriticos > 0 }">
            {{ quadro.data.value.resumo.alertasCriticos }}
          </dd>
        </div>
      </dl>

      <h2>{{ t(k('alertas')) }}</h2>
      <p v-if="!quadro.data.value.alertas.length">{{ t(k('semAlertas')) }}</p>
      <ul v-else class="lista" data-testid="cc-alertas">
        <li v-for="a in quadro.data.value.alertas" :key="a.id" :class="`nivel-${a.nivel ?? 'sem_medida'}`">
          <strong>{{ t(k(`tiposAlerta.${a.tipo}`)) }}</strong>
          · {{ a.unidadeNome ?? t(k('todasUnidades')) }} · {{ t(k('medida')) }}: {{ a.medida ?? '—' }}
          {{ t(k(`unidadesLimite.${a.unidadeLimite}`)) }} ·
          {{ t(k('limites'), { atencao: a.limiteAtencao ?? '—', critico: a.limiteCritico }) }} ·
          <span :data-testid="`cc-nivel-${a.id}`">{{ t(k(`niveis.${a.nivel ?? 'sem_medida'}`)) }}</span>
        </li>
      </ul>

      <h2>{{ t(k('pacientes')) }}</h2>
      <p v-if="!quadro.data.value.pacientes.length" data-testid="cc-sem-pacientes">
        {{ t(k('semPacientes')) }}
      </p>
      <table v-else class="tabela" data-testid="cc-pacientes">
        <thead>
          <tr>
            <th>{{ t(k('paciente')) }}</th>
            <th>{{ t(k('leito')) }}</th>
            <th>{{ t(k('riscos')) }}</th>
            <th>{{ t(k('metas')) }}</th>
            <th>{{ t(k('news2')) }}</th>
            <th>{{ t(k('protocolos')) }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in quadro.data.value.pacientes"
            :key="p.atendimento"
            :data-testid="`cc-paciente-${p.atendimento}`"
            :class="p.maiorGravidade ? `gravidade-${p.maiorGravidade}` : ''"
          >
            <td>{{ p.nome }} · {{ p.numero }} · {{ t(k('permanencia'), { h: p.permanenciaHoras }) }}</td>
            <td>{{ p.leito ?? t(k('semLeito')) }}</td>
            <td>
              <span v-if="p.maiorGravidade">{{ t(k(`gravidades.${p.maiorGravidade}`)) }} · </span>
              {{ p.riscosAbertos }}
              <span v-if="p.riscos.length"> · {{ p.riscos.map((r) => r.regra).join('; ') }}</span>
            </td>
            <td :class="{ critico: p.metasAtrasadas > 0 }">
              {{ p.cumprimento.cumpridas }} / {{ p.cumprimento.total }}
              <span v-if="p.metasAtrasadas"> · {{ t(k('atrasada')) }}: {{ p.metasAtrasadas }}</span>
            </td>
            <td>{{ p.escorePiora ?? '—' }}</td>
            <td>{{ p.protocolosAbertos }}</td>
            <td>
              <SanteBotao
                :rotulo="t(k('abrir'))"
                :data-testid="`cc-abrir-${p.atendimento}`"
                @acionar="aberto = p.atendimento"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <section v-if="aberto !== null" aria-live="polite" data-testid="cc-visao">
      <h2>{{ t(k('visao'), { nome: pacienteAberto?.nome ?? aberto }) }}</h2>
      <SanteBotao :rotulo="t(k('fecharVisao'))" data-testid="cc-fechar" @acionar="aberto = null" />
      <ErroEnfermagem v-if="visao.isError.value" :erro="visao.error.value" />
      <template v-else-if="visao.data.value">
        <h3>{{ t(k('ocorrencias')) }}</h3>
        <p v-if="!visao.data.value.ocorrencias.length">{{ t(k('semOcorrencias')) }}</p>
        <ul v-else class="lista" data-testid="cc-ocorrencias">
          <li
            v-for="o in visao.data.value.ocorrencias"
            :key="o.id"
            :data-testid="`cc-ocorrencia-${o.id}`"
            :class="`gravidade-${o.gravidade}`"
          >
            <strong>{{ o.regra }}</strong> · {{ o.tema }} · {{ t(k(`gravidades.${o.gravidade}`)) }} ·
            <span :data-testid="`cc-situacao-${o.id}`">{{ t(k(`situacoes.${o.situacao}`)) }}</span> ·
            {{ t(k('detectado'), { quando: hora(o.detectadoEm) }) }}
            <br />
            <span v-if="o.evidencia">{{ t(k('evidencia')) }}: {{ descreverEvidencia(o) }}</span>
            <span v-if="o.resolucao"> · {{ o.resolucao }}</span>
            <div v-if="o.situacao === 'aberta' || o.situacao === 'reconhecida'" class="campos">
              <label
                >{{ t(k('conduta')) }}
                <input v-model="condutas[o.id]" maxlength="1000" :data-testid="`cc-conduta-${o.id}`"
              /></label>
              <SanteBotao
                v-if="o.situacao === 'aberta'"
                :rotulo="t(k('reconhecer'))"
                :desabilitado="!!problemaConduta(o, 'reconhecer')"
                :data-testid="`cc-reconhecer-${o.id}`"
                @acionar="passar(o, 'reconhecer')"
              />
              <SanteBotao
                :rotulo="t(k('resolver'))"
                :desabilitado="!!problemaConduta(o, 'resolver')"
                :data-testid="`cc-resolver-${o.id}`"
                @acionar="passar(o, 'resolver')"
              />
              <SanteBotao
                :rotulo="t(k('descartar'))"
                :desabilitado="!!problemaConduta(o, 'descartar')"
                :data-testid="`cc-descartar-${o.id}`"
                @acionar="passar(o, 'descartar')"
              />
            </div>
            <p
              v-if="
                (o.situacao === 'aberta' || o.situacao === 'reconhecida') && condutas[o.id] && condutaCurta(o)
              "
              role="alert"
              :data-testid="`cc-conduta-curta-${o.id}`"
            >
              {{ t(k('condutaCurta')) }}
            </p>
          </li>
        </ul>

        <h3>{{ t(k('metasPaciente')) }}</h3>
        <p v-if="!visao.data.value.metas.length">{{ t(k('semMetas')) }}</p>
        <table v-else class="tabela" data-testid="cc-metas">
          <tbody>
            <tr
              v-for="m in visao.data.value.metas"
              :key="m.id"
              :data-testid="`cc-meta-${m.id}`"
              :class="{ critico: m.atrasada }"
            >
              <td>{{ t(k(`categorias.${m.categoria}`)) }}</td>
              <td>{{ m.descricao }}</td>
              <td>
                {{ t(k('prazo')) }}: {{ hora(m.prazoEm) }}
                <span v-if="m.atrasada"> · {{ t(k('atrasada')) }}</span>
              </td>
              <td :data-testid="`cc-meta-situacao-${m.id}`">{{ t(k(`situacaoMeta.${m.situacao}`)) }}</td>
              <td>
                <template v-if="m.situacao === 'pendente'">
                  <label
                    >{{ t(k('justificativa')) }}
                    <input
                      v-model="justificativas[m.id]"
                      maxlength="1000"
                      :data-testid="`cc-justificativa-${m.id}`"
                  /></label>
                  <SanteBotao
                    :rotulo="t(k('cumprir'))"
                    :data-testid="`cc-cumprir-${m.id}`"
                    @acionar="encerrar(m, 'cumprida')"
                  />
                  <SanteBotao
                    :rotulo="t(k('naoCumprir'))"
                    :desabilitado="!!problemaEncerrar(m, 'nao_cumprida')"
                    :data-testid="`cc-nao-cumprir-${m.id}`"
                    @acionar="encerrar(m, 'nao_cumprida')"
                  />
                  <SanteBotao
                    :rotulo="t(k('cancelarMeta'))"
                    :desabilitado="!!problemaEncerrar(m, 'cancelada')"
                    :data-testid="`cc-cancelar-meta-${m.id}`"
                    @acionar="encerrar(m, 'cancelada')"
                  />
                </template>
                <span v-else>{{ m.justificativa ?? '' }}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <h3>{{ t(k('novaMeta')) }}</h3>
        <div class="campos">
          <SanteSelecao
            v-model="novaMeta.categoria"
            :rotulo="t(k('categoria'))"
            :opcoes="opcoesCategoria"
            data-testid="cc-meta-categoria"
          />
          <label
            >{{ t(k('descricao')) }}
            <input v-model="novaMeta.descricao" maxlength="500" data-testid="cc-meta-descricao"
          /></label>
          <label
            >{{ t(k('prazoEm')) }}
            <input v-model="novaMeta.prazo" type="datetime-local" data-testid="cc-meta-prazo"
          /></label>
          <SanteSelecao
            v-model="novaMeta.ocorrencia"
            :rotulo="t(k('ligadaA'))"
            :opcoes="opcoesOcorrencia"
            data-testid="cc-meta-ocorrencia"
          />
        </div>
        <p v-if="novaMeta.descricao && problemaMeta" role="alert" data-testid="cc-problema-meta">
          {{ problemaMeta }}
        </p>
        <SanteBotao
          :rotulo="t(k('incluirMeta'))"
          :desabilitado="!!problemaMeta"
          data-testid="cc-incluir-meta"
          @acionar="incluirNovaMeta"
        />
      </template>
    </section>

    <h2>{{ t(k('configuracao')) }}</h2>
    <ErroEnfermagem v-if="configuracao.isError.value" :erro="configuracao.error.value" />
    <template v-else-if="configuracao.data.value">
      <h3>{{ t(k('temas')) }}</h3>
      <ul class="lista" data-testid="cc-temas">
        <li v-for="x in configuracao.data.value.temas" :key="x.id" :class="{ inativo: !x.ativo }">
          {{ x.codigo }} · {{ x.descricao }}
        </li>
      </ul>
      <div class="campos">
        <label
          >{{ t(k('codigo')) }} <input v-model="novoTema.codigo" maxlength="30" data-testid="cc-tema-codigo"
        /></label>
        <label
          >{{ t(k('descricao')) }}
          <input v-model="novoTema.descricao" maxlength="150" data-testid="cc-tema-descricao"
        /></label>
      </div>
      <p v-if="(novoTema.codigo || novoTema.descricao) && temaInvalido" role="alert">
        {{ t(k('temaCurto')) }}
      </p>
      <SanteBotao
        :rotulo="t(k('incluirTema'))"
        :desabilitado="temaInvalido"
        data-testid="cc-incluir-tema"
        @acionar="incluirNovoTema"
      />

      <h3>{{ t(k('regras')) }}</h3>
      <p v-if="!configuracao.data.value.regras.length">{{ t(k('semRegras')) }}</p>
      <table v-else class="tabela" data-testid="cc-regras">
        <tbody>
          <tr v-for="r in configuracao.data.value.regras" :key="r.id" :class="{ inativo: !r.ativo }">
            <td>{{ r.codigo }}</td>
            <td>{{ r.nome }}</td>
            <td>{{ t(k(`gravidades.${r.gravidade}`)) }}</td>
            <td>{{ r.ativo ? t(k('ativa')) : t(k('inativa')) }}</td>
            <td>
              <label
                >{{ t(k('motivo')) }}
                <input
                  v-model="motivosRegra[r.id]"
                  maxlength="500"
                  :data-testid="`cc-motivo-regra-${r.codigo}`"
              /></label>
              <SanteBotao
                :rotulo="r.ativo ? t(k('desligar')) : t(k('ligar'))"
                :desabilitado="(motivosRegra[r.id] ?? '').trim().length < 10"
                :data-testid="`cc-ativar-regra-${r.codigo}`"
                @acionar="
                  gravar(() => ativarRegra(r.id, r.versao, !r.ativo, (motivosRegra[r.id] ?? '').trim()))
                "
              />
            </td>
          </tr>
        </tbody>
      </table>

      <h4>{{ t(k('novaRegra')) }}</h4>
      <div class="campos">
        <label
          >{{ t(k('codigo')) }}
          <input v-model="novaRegra.codigo" maxlength="30" data-testid="cc-regra-codigo"
        /></label>
        <label
          >{{ t(k('nome')) }} <input v-model="novaRegra.nome" maxlength="150" data-testid="cc-regra-nome"
        /></label>
        <SanteSelecao
          v-model="novaRegra.tema"
          :rotulo="t(k('tema'))"
          :opcoes="opcoesTema"
          data-testid="cc-regra-tema"
        />
        <SanteSelecao
          v-model="novaRegra.gravidade"
          :rotulo="t(k('gravidade'))"
          :opcoes="opcoesGravidade"
          data-testid="cc-regra-gravidade"
        />
        <SanteSelecao
          v-model="novaRegra.combinacao"
          :rotulo="t(k('combinacao'))"
          :opcoes="opcoesCombinacao"
          data-testid="cc-regra-combinacao"
        />
        <label
          >{{ t(k('janela')) }}
          <input v-model="novaRegra.janela" inputmode="numeric" data-testid="cc-regra-janela"
        /></label>
        <label
          >{{ t(k('vigencia')) }}
          <input v-model="novaRegra.vigenciaInicio" type="date" data-testid="cc-regra-vigencia"
        /></label>
      </div>
      <h5>{{ t(k('criterios')) }}</h5>
      <div
        v-for="(c, i) in novaRegra.criterios"
        :key="i"
        class="campos criterio"
        :data-testid="`cc-criterio-${i}`"
      >
        <SanteSelecao
          v-model="c.tipo"
          :rotulo="t(k('tipo'))"
          :opcoes="opcoesTipoCriterio"
          :data-testid="`cc-criterio-tipo-${i}`"
        />
        <SanteSelecao
          v-if="
            c.tipo === 'exame' || c.tipo === 'medicamento' || c.tipo === 'dose' || c.tipo === 'sinal_vital'
          "
          v-model="c.alvo"
          :rotulo="t(k('alvo'))"
          :opcoes="alvosDo(c.tipo)"
          :data-testid="`cc-criterio-alvo-${i}`"
        />
        <label v-if="c.tipo === 'diagnostico'"
          >{{ t(k('cid')) }} <input v-model="c.cid" maxlength="6" :data-testid="`cc-criterio-cid-${i}`"
        /></label>
        <label v-if="c.tipo === 'permanencia'"
          >{{ t(k('horas')) }}
          <input v-model="c.horas" inputmode="numeric" :data-testid="`cc-criterio-horas-${i}`"
        /></label>
        <template v-if="c.tipo === 'exame' || c.tipo === 'dose' || c.tipo === 'sinal_vital'">
          <label
            >{{ t(k('minimo')) }}
            <input v-model="c.minimo" inputmode="decimal" :data-testid="`cc-criterio-minimo-${i}`"
          /></label>
          <label
            >{{ t(k('maximo')) }}
            <input v-model="c.maximo" inputmode="decimal" :data-testid="`cc-criterio-maximo-${i}`"
          /></label>
        </template>
        <SanteSelecao
          v-model="c.presenca"
          :rotulo="t(k('presenca'))"
          :opcoes="opcoesPresenca"
          :data-testid="`cc-criterio-presenca-${i}`"
        />
        <SanteBotao
          v-if="novaRegra.criterios.length > 1"
          :rotulo="t(k('removerCriterio'))"
          @acionar="novaRegra.criterios.splice(i, 1)"
        />
      </div>
      <SanteBotao
        :rotulo="t(k('incluirCriterio'))"
        :desabilitado="novaRegra.criterios.length >= 20"
        data-testid="cc-incluir-criterio"
        @acionar="novaRegra.criterios.push(criterioVazio())"
      />
      <ul v-if="problemasRegra.length" role="alert" class="lista" data-testid="cc-problemas-regra">
        <li v-for="p in problemasRegra" :key="p">{{ p }}</li>
      </ul>
      <SanteBotao
        :rotulo="t(k('gravarRegra'))"
        :desabilitado="problemasRegra.length > 0"
        data-testid="cc-gravar-regra"
        @acionar="gravarRegra"
      />

      <h3>{{ t(k('limitesFluxo')) }}</h3>
      <table class="tabela" data-testid="cc-limites">
        <tbody>
          <tr v-for="a in configuracao.data.value.alertas" :key="a.id" :class="{ inativo: !a.ativo }">
            <td>{{ t(k(`tiposAlerta.${a.tipo}`)) }}</td>
            <td>{{ a.unidadeNome ?? t(k('todasUnidades')) }}</td>
            <td>{{ t(k('limites'), { atencao: a.limiteAtencao ?? '—', critico: a.limiteCritico }) }}</td>
            <td>
              <template v-if="a.ativo">
                <label>{{ t(k('motivo')) }} <input v-model="motivosAlerta[a.id]" maxlength="500" /></label>
                <SanteBotao
                  :rotulo="t(k('inativarLimite'))"
                  :desabilitado="(motivosAlerta[a.id] ?? '').trim().length < 10"
                  @acionar="gravar(() => inativarAlerta(a.id, a.versao, (motivosAlerta[a.id] ?? '').trim()))"
                />
              </template>
              <span v-else>{{ t(k('inativa')) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="campos">
        <SanteSelecao
          v-model="novoAlerta.unidade"
          :rotulo="t(k('unidade'))"
          :opcoes="opcoesUnidadeAlerta"
          data-testid="cc-limite-unidade"
        />
        <SanteSelecao
          v-model="novoAlerta.tipo"
          :rotulo="t(k('tipo'))"
          :opcoes="opcoesTipoAlerta"
          data-testid="cc-limite-tipo"
        />
        <label
          >{{ t(k('limiteAtencao')) }} ({{ t(k(`unidadesLimite.${unidadeDoLimite}`)) }})
          <input v-model="novoAlerta.atencao" inputmode="decimal" data-testid="cc-limite-atencao"
        /></label>
        <label
          >{{ t(k('limiteCritico')) }} ({{ t(k(`unidadesLimite.${unidadeDoLimite}`)) }})
          <input v-model="novoAlerta.critico" inputmode="decimal" data-testid="cc-limite-critico"
        /></label>
      </div>
      <p v-if="novoAlerta.critico && problemaAlerta" role="alert" data-testid="cc-problema-limite">
        {{ problemaAlerta }}
      </p>
      <SanteBotao
        :rotulo="t(k('incluirLimite'))"
        :desabilitado="!!problemaAlerta"
        data-testid="cc-incluir-limite"
        @acionar="incluirNovoAlerta"
      />
    </template>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.campos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.resumo {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.resumo dd {
  font-size: 1.5rem;
  margin: 0;
}
.criterio {
  border-left: 2px solid var(--sgh-borda);
  padding-left: var(--sgh-espaco-2);
}
.inativo {
  opacity: 0.6;
}
.discreto {
  opacity: 0.8;
}
.critico,
.nivel-critico,
.gravidade-critica {
  color: var(--sgh-alerta);
  font-weight: 600;
}
.nivel-atencao,
.gravidade-alta {
  color: var(--sgh-aviso);
}
</style>
