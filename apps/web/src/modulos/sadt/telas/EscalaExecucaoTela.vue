<script setup lang="ts">
// Escala de execução do diagnóstico (F3.5, 05-SADT linha 19): `/sadt/escala-execucao`. Uma tela só para o coordenador
// do setor: a grade da semana (uma linha por executante, uma coluna por dia) mostra quem cobre cada dia e marca o dia
// sem ninguém; a escala nova aparece na grade enquanto é montada, e o que impede gravar (campo que falta, plantão que
// choca com outra escala do mesmo executante em qualquer setor) é conferido na hora pela mesma regra do servidor
// (@sgh/dominio-sadt), sem ir e voltar. Gravar pede a edição do catálogo: o servidor confere e a recusa aparece aqui. A escala que sai de uso é encerrada na própria linha, nunca apagada. Embaixo, a
// fila do setor na ordem de chamada (urgência, prioridade legal, chegada), com quem está escalado agora.
import {
  conferirEscala,
  conflitosDoExecutante,
  diasSemCobertura,
  duracaoDoPlantao,
  gradeDaSemana,
  inicioDaSemana,
  somarDias,
} from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  buscarNaEscala,
  camposDaRecusa,
  type CorpoEscala,
  encerrarEscala,
  type EscalaGravada,
  incluirEscala,
  lerFilaDoSetor,
  lerOpcoesDaEscala,
  listarEscalas,
} from '../api-escala-execucao.js';
import { codigoDaRecusa, novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t, te } = useI18n();
const cliente = useQueryClient();
const opcoes = useQuery({ queryKey: ['sadt', 'escala', 'opcoes'], queryFn: lerOpcoesDaEscala });

const setor = ref('');
const referencia = ref('');
// As escalas que ainda valem desde a semana mostrada (ou desde hoje, se a semana mostrada é futura: o choque da escala
// nova é conferido com as que valem a partir de hoje). A encerrada há mais tempo fica no cadastro e não é lida.
const desde = computed(() => {
  const hoje = opcoes.data.value?.hoje ?? '';
  if (!referencia.value || !hoje) return '';
  const semana = inicioDaSemana(referencia.value);
  return semana < hoje ? semana : hoje;
});
const escalas = useQuery({
  queryKey: ['sadt', 'escala', 'lista', setor, desde],
  queryFn: () => listarEscalas(Number(setor.value), desde.value),
  enabled: computed(() => setor.value !== '' && desde.value !== ''),
});
watch(
  () => opcoes.data.value,
  (o) => {
    if (!o) return;
    if (!referencia.value) referencia.value = o.hoje;
    if (!setor.value && o.setores.length === 1) setor.value = String(o.setores[0]!.id);
    if (!nova.value.vigenciaInicio) nova.value.vigenciaInicio = o.hoje;
  },
);

// A fila pede a leitura das requisições: o servidor decide; sem ela (403), a seção some em vez de mostrar erro.
const fila = useQuery({
  queryKey: ['sadt', 'escala', 'fila', setor],
  queryFn: () => lerFilaDoSetor(Number(setor.value)),
  enabled: computed(() => setor.value !== ''),
  retry: false,
});

const podeVerFila = computed(() => !(fila.error.value instanceof ErroApi && fila.error.value.status === 403));

// ── Combos ──────────────────────────────────────────────────────────────────────────────────────────
type Nome = { id: number; nome: string };
const comEscolha = (lista: readonly Nome[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(lista ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const opcoesSetor = computed(() => comEscolha(opcoes.data.value?.setores, t('sadt.escala.escolha')));
// O profissional e o exame são cadastros grandes: a tela busca por digitação (os primeiros nomes vêm sem digitar) e
// guarda o nome de quem já foi escolhido, para o combo e a grade não perderem o nome quando a busca muda.
function buscaComAtraso(tipo: 'exame' | 'profissional') {
  const digitado = ref('');
  const termo = ref('');
  let relogio: ReturnType<typeof setTimeout> | undefined;
  watch(digitado, (v) => {
    clearTimeout(relogio);
    relogio = setTimeout(() => (termo.value = v.trim()), 250);
  });
  const achados = useQuery({
    queryKey: ['sadt', 'escala', 'busca', tipo, termo],
    queryFn: () => buscarNaEscala(tipo, termo.value),
    staleTime: 60_000,
  });
  return { digitado, achados };
}
const buscaProfissional = buscaComAtraso('profissional');
const buscaExame = buscaComAtraso('exame');
const nomesEscolhidos = ref<{ profissional: Record<number, string>; exame: Record<number, string> }>({
  profissional: {},
  exame: {},
});
function lembrarNome(tipo: 'exame' | 'profissional', v: string): void {
  const achado = (tipo === 'exame' ? buscaExame : buscaProfissional).achados.data.value?.find(
    (x) => String(x.id) === v,
  );
  if (achado) nomesEscolhidos.value[tipo][achado.id] = achado.nome;
}
const opcoesProfissional = computed(() => {
  const achados = buscaProfissional.achados.data.value ?? [];
  const atual = nova.value.profissional ? Number(nova.value.profissional) : null;
  const guardado = atual !== null ? nomesEscolhidos.value.profissional[atual] : undefined;
  return comEscolha(
    atual !== null && guardado !== undefined && !achados.some((x) => x.id === atual)
      ? [{ id: atual, nome: guardado }, ...achados]
      : achados,
    t('sadt.escala.form.nenhum'),
  );
});
const opcoesRecurso = computed(() => comEscolha(opcoes.data.value?.recursos, t('sadt.escala.form.nenhum')));
const opcoesExame = computed(() => comEscolha(buscaExame.achados.data.value, t('sadt.escala.escolha')));
const opcoesGrupo = computed(() =>
  comEscolha(opcoes.data.value?.gruposPrioridade, t('sadt.escala.form.nenhum')),
);
const opcoesPapel = computed(() =>
  (['executa', 'lauda'] as const).map((v) => ({ valor: v, rotulo: t(`sadt.escala.grade.papel.${v}`) })),
);
const DIAS = [1, 2, 3, 4, 5, 6, 7] as const;
const opcoesDia = computed(() => [
  ...DIAS.map((d) => ({ valor: String(d), rotulo: t(`sadt.escala.dias.${d}`) })),
  { valor: 'avulsa', rotulo: t('sadt.escala.form.dataAvulsa') },
]);
const nomeDe = (lista: readonly Nome[] | undefined, id: number | null): string =>
  id === null ? '' : ((lista ?? []).find((x) => x.id === id)?.nome ?? `#${id}`);
const nomeGuardado = (tipo: 'exame' | 'profissional', id: number | null): string =>
  id === null ? '' : (nomesEscolhidos.value[tipo][id] ?? `#${id}`);
// O nome de quem executa vem com a escala gravada; o da escala nova é o que a busca trouxe na escolha.
const executanteDe = (e: {
  profissional: number | null;
  recurso: number | null;
  profissionalNome?: string | null;
  recursoNome?: string | null;
}): string =>
  [
    e.profissionalNome ?? nomeGuardado('profissional', e.profissional),
    e.recursoNome ?? nomeDe(opcoes.data.value?.recursos, e.recurso),
  ]
    .filter(Boolean)
    .join(' · ');

// ── A escala nova, montada na tela ──────────────────────────────────────────────────────────────────
interface PlantaoDigitado {
  quando: string;
  data: string;
  inicio: string;
  fim: string;
  capacidade: string;
}
interface ExameDigitado {
  exame: number;
  limite: string;
  grupo: string;
  vagas: string;
}
const plantaoVazio = (): PlantaoDigitado => ({
  quando: '2',
  data: '',
  inicio: '07:00',
  fim: '13:00',
  capacidade: '10',
});
const vazia = () => ({
  papel: 'executa' as 'executa' | 'lauda',
  profissional: '',
  recurso: '',
  descricao: '',
  vigenciaInicio: opcoes.data.value?.hoje ?? '',
  vigenciaFim: '',
  atendeFeriado: false,
  plantoes: [plantaoVazio()],
  exames: [] as ExameDigitado[],
});
const nova = ref(vazia());
const tocado = ref(false);
const exameEscolhido = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const camposServidor = ref<string[]>([]);

const inteiro = (v: string): number => (v.trim() === '' ? Number.NaN : Number(v));
const corpo = computed<CorpoEscala | null>(() =>
  setor.value === ''
    ? null
    : {
        setor: Number(setor.value),
        profissional: nova.value.profissional ? Number(nova.value.profissional) : null,
        recurso: nova.value.recurso ? Number(nova.value.recurso) : null,
        papel: nova.value.papel,
        descricao: nova.value.descricao.trim(),
        vigenciaInicio: nova.value.vigenciaInicio,
        vigenciaFim: nova.value.vigenciaFim || null,
        atendeFeriado: nova.value.atendeFeriado,
        plantoes: nova.value.plantoes.map((p) => ({
          diaSemana: p.quando === 'avulsa' ? null : Number(p.quando),
          data: p.quando === 'avulsa' ? p.data || '' : null,
          inicio: p.inicio,
          fim: p.fim,
          capacidade: inteiro(p.capacidade),
        })),
        exames: nova.value.exames.map((x) => ({
          exame: x.exame,
          limitePorTurno: x.limite.trim() === '' ? null : Number(x.limite),
          grupoPrioridade: x.grupo ? Number(x.grupo) : null,
          vagasReservadas: x.vagas.trim() === '' ? 0 : Number(x.vagas),
        })),
      },
);
// A mesma conferência do servidor, na hora: todos os problemas de uma vez, e o choque do mesmo executante.
const problemas = computed(() => (corpo.value ? conferirEscala(corpo.value) : []));
const choques = computed(() =>
  corpo.value && problemas.value.every((p) => !p.campo.startsWith('plantoes'))
    ? conflitosDoExecutante(corpo.value, escalas.data.value ?? [])
    : [],
);
const plantoesEmConflito = computed(
  () =>
    new Set([
      ...choques.value.map((c) => c.plantao),
      ...camposServidor.value.filter((c) => /^plantoes\.\d+$/.test(c)).map((c) => Number(c.slice(9))),
    ]),
);
const podeGravar = computed(() => corpo.value !== null && !problemas.value.length && !choques.value.length);

function mexeu(): void {
  tocado.value = true;
  camposServidor.value = [];
  mensagem.value = null;
}
function incluirExame(v: string): void {
  exameEscolhido.value = '';
  if (!v || nova.value.exames.some((x) => x.exame === Number(v))) return;
  lembrarNome('exame', v);
  nova.value.exames.push({ exame: Number(v), limite: '', grupo: '', vagas: '0' });
  mexeu();
}
function limpar(): void {
  nova.value = vazia();
  tocado.value = false;
  camposServidor.value = [];
}

async function executar(fn: () => Promise<string>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  camposServidor.value = [];
  try {
    mensagem.value = await fn();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'escala'] });
  } catch (x) {
    erro.value = x;
    camposServidor.value = camposDaRecusa(x);
  }
}
const gravar = () =>
  executar(async () => {
    await incluirEscala(corpo.value!, novaChave('escala.incluir'));
    limpar();
    return t('sadt.escala.form.gravada');
  });

const fimDe = ref<Record<number, string>>({});
const encerrar = (e: EscalaGravada) =>
  executar(async () => {
    await encerrarEscala(e.id, fimDe.value[e.id] ?? '', e.versao, novaChave('escala.encerrar'));
    return t('sadt.escala.encerrar.feito');
  });
const chaveRecusa = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`sadt.escala.recusas.${c}`) ? `sadt.escala.recusas.${c}` : null;
});

// ── A grade da semana ───────────────────────────────────────────────────────────────────────────────
const br = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const domingo = computed(() => (referencia.value ? inicioDaSemana(referencia.value) : ''));
const diasDaSemana = computed(() =>
  domingo.value ? DIAS.map((d) => ({ dia: d, data: somarDias(domingo.value, d - 1) })) : [],
);
const mudarSemana = (dias: number): void => {
  referencia.value = somarDias(referencia.value, dias);
};
// As escalas do setor que ainda valem na semana mostrada (a encerrada antes dela sai da grade, não do cadastro).
const doSetor = computed(() =>
  (escalas.data.value ?? []).filter(
    (e) =>
      String(e.setor) === setor.value &&
      e.ativa &&
      (e.vigenciaFim === null || e.vigenciaFim >= domingo.value),
  ),
);
const linhas = computed(() =>
  domingo.value ? doSetor.value.map((e) => ({ escala: e, dias: gradeDaSemana(e, referencia.value) })) : [],
);
// A escala nova entra na grade assim que tem plantão conferível (os índices são os mesmos dos campos da recusa).
const linhaNova = computed(() =>
  tocado.value && corpo.value && domingo.value && corpo.value.vigenciaInicio
    ? gradeDaSemana(corpo.value, referencia.value)
    : null,
);
const semCobertura = computed(() =>
  domingo.value && setor.value
    ? diasSemCobertura(
        doSetor.value.filter((e) => e.papel === 'executa'),
        referencia.value,
      )
    : [],
);
const viraNoite = (p: { inicio: string; fim: string }): boolean =>
  /^\d\d:\d\d$/.test(p.inicio) && /^\d\d:\d\d$/.test(p.fim) && p.fim <= p.inicio && duracaoDoPlantao(p) > 0;
const horaLocal = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
</script>

<template>
  <section class="escala" data-testid="escala-execucao">
    <h1>{{ t('sadt.escala.titulo') }}</h1>
    <p>{{ t('sadt.escala.ajuda') }}</p>
    <ErroSadt v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <ErroSadt v-else-if="escalas.isError.value" :erro="escalas.error.value" />

    <div class="linha">
      <SanteSelecao
        v-model="setor"
        :rotulo="t('sadt.escala.setor')"
        :opcoes="opcoesSetor"
        obrigatorio
        data-testid="escala-setor"
      />
      <template v-if="domingo">
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.escala.anterior')"
          data-testid="escala-semana-anterior"
          @acionar="mudarSemana(-7)"
        />
        <strong data-testid="escala-semana">{{
          t('sadt.escala.semana', { inicio: br(domingo), fim: br(somarDias(domingo, 6)) })
        }}</strong>
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.escala.proxima')"
          data-testid="escala-semana-proxima"
          @acionar="mudarSemana(7)"
        />
        <SanteBotao
          variante="texto"
          :rotulo="t('sadt.escala.hoje')"
          data-testid="escala-semana-hoje"
          @acionar="referencia = opcoes.data.value?.hoje ?? referencia"
        />
      </template>
    </div>

    <template v-if="setor && domingo">
      <p v-if="escalas.isSuccess.value && linhas.length === 0 && !linhaNova" data-testid="escala-vazia">
        {{ t('sadt.escala.grade.semEscalas') }}
      </p>
      <div class="rolagem">
        <table data-testid="escala-grade">
          <caption>
            {{
              t('sadt.escala.grade.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sadt.escala.grade.executante') }}</th>
              <th v-for="d in diasDaSemana" :key="d.dia" scope="col" :data-testid="`escala-dia-${d.dia}`">
                {{ t(`sadt.escala.dias.${d.dia}`) }} {{ br(d.data) }}
                <span
                  v-if="semCobertura.includes(d.dia)"
                  class="furo"
                  :data-testid="`escala-sem-cobertura-${d.dia}`"
                  >{{ t('sadt.escala.grade.semCobertura') }}</span
                >
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in linhas" :key="l.escala.id" :data-testid="`escala-linha-${l.escala.id}`">
              <th scope="row">
                <strong>{{ executanteDe(l.escala) }}</strong>
                <span>{{ t(`sadt.escala.grade.papel.${l.escala.papel}`) }} · {{ l.escala.descricao }}</span>
                <span class="discreto">
                  {{ t('sadt.escala.grade.exames', { n: l.escala.exames.length }) }} ·
                  {{
                    l.escala.vigenciaFim
                      ? t('sadt.escala.grade.encerrada', { data: br(l.escala.vigenciaFim) })
                      : t('sadt.escala.grade.semFim')
                  }}
                </span>
                <span class="linha">
                  <label>
                    {{ t('sadt.escala.encerrar.data') }}
                    <input
                      v-model="fimDe[l.escala.id]"
                      type="date"
                      :min="l.escala.vigenciaInicio"
                      :data-testid="`escala-fim-${l.escala.id}`"
                    />
                  </label>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('sadt.escala.encerrar.botao')"
                    :desabilitado="!fimDe[l.escala.id]"
                    :data-testid="`escala-encerrar-${l.escala.id}`"
                    @acionar="encerrar(l.escala)"
                  />
                </span>
              </th>
              <td v-for="d in l.dias" :key="d.data">
                <span v-for="p in d.plantoes" :key="p.indice" class="plantao">
                  {{
                    t('sadt.escala.grade.plantao', {
                      inicio: p.plantao.inicio,
                      fim: p.plantao.fim,
                      capacidade: p.plantao.capacidade,
                    })
                  }}
                  <em v-if="viraNoite(p.plantao)">{{ t('sadt.escala.grade.viraNoite') }}</em>
                </span>
              </td>
            </tr>
            <tr v-if="linhaNova" class="nova" data-testid="escala-linha-nova">
              <th scope="row">
                <strong>{{ corpo ? executanteDe(corpo) : '' }}</strong>
                <span>{{ t('sadt.escala.grade.nova') }}</span>
              </th>
              <td v-for="d in linhaNova" :key="d.data">
                <span
                  v-for="p in d.plantoes"
                  :key="p.indice"
                  class="plantao"
                  :class="{ conflito: plantoesEmConflito.has(p.indice) }"
                  :data-testid="`escala-nova-plantao-${p.indice}`"
                >
                  {{
                    t('sadt.escala.grade.plantao', {
                      inicio: p.plantao.inicio,
                      fim: p.plantao.fim,
                      capacidade: p.plantao.capacidade,
                    })
                  }}
                  <em v-if="viraNoite(p.plantao)">{{ t('sadt.escala.grade.viraNoite') }}</em>
                  <strong
                    v-if="plantoesEmConflito.has(p.indice)"
                    :data-testid="`escala-conflito-${p.indice}`"
                    >{{ t('sadt.escala.grade.conflito') }}</strong
                  >
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- A escala nova: cada mudança confere tudo de novo e redesenha a linha dela na grade. -->
      <div class="escala" data-testid="escala-nova">
        <h2>{{ t('sadt.escala.form.titulo') }}</h2>
        <div class="linha" @input="mexeu">
          <SanteSelecao
            :model-value="nova.papel"
            :rotulo="t('sadt.escala.form.papel')"
            :opcoes="opcoesPapel"
            data-testid="escala-papel"
            @update:model-value="(v: string) => ((nova.papel = v as 'executa' | 'lauda'), mexeu())"
          />
          <SanteSelecao
            :model-value="nova.profissional"
            :rotulo="t('sadt.escala.form.profissional')"
            :opcoes="opcoesProfissional"
            data-testid="escala-profissional"
            @update:model-value="
              (v: string) => (lembrarNome('profissional', v), (nova.profissional = v), mexeu())
            "
          />
          <label>
            {{ t('sadt.escala.form.buscarProfissional') }}
            <input
              v-model="buscaProfissional.digitado.value"
              maxlength="80"
              data-testid="escala-profissional-busca"
              @input.stop
            />
          </label>
          <SanteSelecao
            :model-value="nova.recurso"
            :rotulo="t('sadt.escala.form.recurso')"
            :opcoes="opcoesRecurso"
            data-testid="escala-recurso"
            @update:model-value="(v: string) => ((nova.recurso = v), mexeu())"
          />
          <label>
            {{ t('sadt.escala.form.descricao') }}
            <input v-model="nova.descricao" maxlength="150" data-testid="escala-descricao" />
          </label>
          <label>
            {{ t('sadt.escala.form.inicio') }}
            <input v-model="nova.vigenciaInicio" type="date" data-testid="escala-inicio" />
          </label>
          <label>
            {{ t('sadt.escala.form.fim') }}
            <input v-model="nova.vigenciaFim" type="date" data-testid="escala-fim" />
          </label>
          <label>
            <input v-model="nova.atendeFeriado" type="checkbox" data-testid="escala-feriado" />
            {{ t('sadt.escala.form.feriado') }}
          </label>
        </div>

        <h3>{{ t('sadt.escala.form.plantoes') }}</h3>
        <div
          v-for="(p, i) in nova.plantoes"
          :key="i"
          class="linha"
          :class="{ conflito: plantoesEmConflito.has(i) }"
          :data-testid="`escala-plantao-${i}`"
          @input="mexeu"
        >
          <strong>{{ t('sadt.escala.form.plantaoN', { n: i + 1 }) }}</strong>
          <strong
            v-if="plantoesEmConflito.has(i)"
            class="furo"
            :data-testid="`escala-plantao-conflito-${i}`"
            >{{ t('sadt.escala.grade.conflito') }}</strong
          >
          <SanteSelecao
            :model-value="p.quando"
            :rotulo="t('sadt.escala.form.quando')"
            :opcoes="opcoesDia"
            :data-testid="`escala-plantao-dia-${i}`"
            @update:model-value="(v: string) => ((p.quando = v), mexeu())"
          />
          <label v-if="p.quando === 'avulsa'">
            {{ t('sadt.escala.form.data') }}
            <input v-model="p.data" type="date" :data-testid="`escala-plantao-data-${i}`" />
          </label>
          <label>
            {{ t('sadt.escala.form.horaInicio') }}
            <input v-model="p.inicio" type="time" :data-testid="`escala-plantao-inicio-${i}`" />
          </label>
          <label>
            {{ t('sadt.escala.form.horaFim') }}
            <input v-model="p.fim" type="time" :data-testid="`escala-plantao-fim-${i}`" />
          </label>
          <label>
            {{ t('sadt.escala.form.capacidade') }}
            <input
              v-model="p.capacidade"
              type="number"
              min="1"
              inputmode="numeric"
              :data-testid="`escala-plantao-capacidade-${i}`"
            />
          </label>
          <SanteBotao
            v-if="nova.plantoes.length > 1"
            variante="texto"
            :rotulo="t('sadt.escala.form.tirarPlantao', { n: i + 1 })"
            :data-testid="`escala-plantao-tirar-${i}`"
            @acionar="(nova.plantoes.splice(i, 1), mexeu())"
          />
        </div>
        <div class="linha">
          <SanteBotao
            variante="secundario"
            :rotulo="t('sadt.escala.form.maisPlantao')"
            data-testid="escala-plantao-mais"
            @acionar="(nova.plantoes.push(plantaoVazio()), mexeu())"
          />
        </div>

        <h3>{{ t('sadt.escala.form.exames') }}</h3>
        <div class="linha">
          <SanteSelecao
            :model-value="exameEscolhido"
            :rotulo="t('sadt.escala.form.maisExame')"
            :opcoes="opcoesExame"
            data-testid="escala-exame-mais"
            @update:model-value="incluirExame"
          />
          <label>
            {{ t('sadt.escala.form.buscarExame') }}
            <input v-model="buscaExame.digitado.value" maxlength="80" data-testid="escala-exame-busca" />
          </label>
        </div>
        <div
          v-for="(x, i) in nova.exames"
          :key="x.exame"
          class="linha"
          :data-testid="`escala-exame-${i}`"
          @input="mexeu"
        >
          <strong>{{ nomeGuardado('exame', x.exame) }}</strong>
          <label>
            {{ t('sadt.escala.form.limite') }}
            <input v-model="x.limite" type="number" min="1" inputmode="numeric" />
          </label>
          <SanteSelecao
            :model-value="x.grupo"
            :rotulo="t('sadt.escala.form.grupo')"
            :opcoes="opcoesGrupo"
            @update:model-value="(v: string) => ((x.grupo = v), mexeu())"
          />
          <label>
            {{ t('sadt.escala.form.vagas') }}
            <input v-model="x.vagas" type="number" min="0" inputmode="numeric" />
          </label>
          <SanteBotao
            variante="texto"
            :rotulo="t('sadt.escala.form.tirarExame', { nome: nomeGuardado('exame', x.exame) })"
            :data-testid="`escala-exame-tirar-${i}`"
            @acionar="(nova.exames.splice(i, 1), mexeu())"
          />
        </div>

        <div
          v-if="tocado && (problemas.length || choques.length)"
          role="alert"
          data-testid="escala-pendencias"
        >
          <strong>{{ t('sadt.escala.form.pendencias') }}</strong>
          <ul>
            <li v-for="(p, i) in problemas" :key="`p${i}`" :data-campo="p.campo">{{ p.mensagem }}</li>
            <li v-for="(c, i) in choques" :key="`c${i}`" :data-campo="`plantoes.${c.plantao}`">
              {{ t('sadt.escala.form.choque', { n: c.plantao + 1, descricao: c.descricao }) }}
            </li>
          </ul>
        </div>
        <div class="linha">
          <SanteBotao
            :rotulo="t('sadt.escala.form.gravar')"
            :desabilitado="!podeGravar"
            data-testid="escala-gravar"
            @acionar="gravar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('sadt.escala.form.limpar')"
            data-testid="escala-limpar"
            @acionar="limpar"
          />
        </div>
      </div>
      <p v-if="mensagem" role="status" data-testid="escala-mensagem">{{ mensagem }}</p>
      <div v-if="chaveRecusa" role="alert" data-testid="escala-recusa">
        <SanteAlerta variante="alerta" :texto="t(chaveRecusa)" />
      </div>
      <ErroSadt v-else-if="erro" :erro="erro" />

      <!-- A fila do setor, na ordem em que a regra manda chamar. -->
      <template v-if="podeVerFila">
        <h2>{{ t('sadt.escala.fila.titulo') }}</h2>
        <p>{{ t('sadt.escala.fila.ajuda') }}</p>
        <div class="linha">
          <SanteBotao
            variante="secundario"
            :rotulo="t('sadt.escala.fila.atualizar')"
            data-testid="escala-fila-atualizar"
            @acionar="fila.refetch()"
          />
          <span v-if="fila.data.value" data-testid="escala-fila-momento">{{
            t('sadt.escala.fila.momento', { data: br(fila.data.value.data), hora: fila.data.value.hora })
          }}</span>
        </div>
        <ErroSadt v-if="fila.isError.value" :erro="fila.error.value" />
        <template v-else-if="fila.data.value">
          <p v-if="fila.data.value.itens.length === 0" data-testid="escala-fila-vazia">
            {{ t('sadt.escala.fila.vazia') }}
          </p>
          <div v-if="fila.data.value.antigos > 0" data-testid="escala-fila-antigos">
            <SanteAlerta
              variante="aviso"
              :texto="t('sadt.escala.fila.antigos', { n: fila.data.value.antigos })"
            />
          </div>
          <p
            v-if="fila.data.value.total > fila.data.value.itens.length"
            class="discreto"
            data-testid="escala-fila-parte"
          >
            {{
              t('sadt.escala.fila.parte', { n: fila.data.value.itens.length, total: fila.data.value.total })
            }}
          </p>
          <div v-if="fila.data.value.semExecutante > 0" data-testid="escala-fila-sem-executante">
            <SanteAlerta
              variante="aviso"
              :texto="t('sadt.escala.fila.semExecutante', { n: fila.data.value.semExecutante })"
            />
          </div>
          <div v-if="fila.data.value.itens.length" class="rolagem">
            <table data-testid="escala-fila">
              <caption>
                {{
                  t('sadt.escala.fila.titulo')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('sadt.escala.fila.posicao') }}</th>
                  <th scope="col">{{ t('sadt.escala.fila.paciente') }}</th>
                  <th scope="col">{{ t('sadt.escala.fila.exame') }}</th>
                  <th scope="col">{{ t('sadt.escala.fila.prioridade') }}</th>
                  <th scope="col">{{ t('sadt.escala.fila.chegada') }}</th>
                  <th scope="col">{{ t('sadt.escala.fila.executa') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in fila.data.value.itens" :key="x.id" :data-testid="`escala-fila-item-${x.id}`">
                  <td>{{ x.posicao }}</td>
                  <td>{{ x.paciente }}</td>
                  <td>
                    {{ x.exameNome }}
                    <span class="discreto">{{ t('sadt.escala.fila.requisicao') }} {{ x.requisicao }}</span>
                  </td>
                  <td>
                    <strong v-if="x.urgente">{{ t('sadt.escala.fila.urgente') }}</strong>
                    <span v-if="x.grupoPrioridadeNome">{{ x.grupoPrioridadeNome }}</span>
                    <span v-if="!x.urgente && !x.grupoPrioridadeNome" class="discreto">{{
                      t('sadt.escala.fila.semPrioridade')
                    }}</span>
                  </td>
                  <td>{{ horaLocal(x.chegada) }}</td>
                  <td>
                    <span v-for="e in x.executantes" :key="e.escala">{{
                      executanteDe(e) || e.descricao
                    }}</span>
                    <strong v-if="x.executantes.length === 0">{{ t('sadt.escala.fila.ninguem') }}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.escala {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  color: var(--sgh-texto-secundario);
  padding-bottom: var(--sgh-espaco-1);
}
th,
td {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  text-align: left;
  vertical-align: top;
}
th[scope='row'] > *,
td > span {
  display: block;
}
.discreto {
  color: var(--sgh-texto-secundario);
}
.furo {
  display: block;
  color: var(--sgh-alerta);
  font-weight: 600;
}
.plantao {
  padding: var(--sgh-espaco-1);
}
.nova {
  background: var(--sgh-aviso-suave);
}
.conflito {
  outline: 2px solid var(--sgh-alerta);
}
</style>
