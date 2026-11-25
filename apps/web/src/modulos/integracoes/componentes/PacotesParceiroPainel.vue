<script setup lang="ts">
// F3.9, 08-INTG L134: os pacotes de dados de cada parceiro (campos com justificativa e tratamento, formato, meio,
// agenda, anonimização e revisão da minimização), a próxima entrega devida e o histórico de entregas, com a mudança de
// situação (enviada, confirmada com protocolo, rejeitada ou falhou com o motivo).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  conferirPacote,
  type ErroPacote,
  gravarPacote,
  lerEntregas,
  lerPacotes,
  lerVisoes,
  mudarEntrega,
  revisarPacote,
  urlArquivoEntrega,
} from '../api-comunicacao.js';

const props = defineProps<{ podeEditar: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Pacotes de dados e entregas agendadas',
      parceiro: 'Parceiro (código)',
      codigo: 'Código',
      nome: 'Nome',
      conteudo: 'Conteúdo',
      formato: 'Formato',
      meio: 'Meio',
      periodicidade: 'Periodicidade',
      agenda: 'Agenda (HH:MM; "seg HH:MM"; "DD HH:MM")',
      anonimizacao: 'Anonimização',
      campos: 'Campos',
      visao: 'Visão',
      campo: 'Campo',
      sensivelCatalogo: 'Dado sensível pelo catálogo',
      identificador: 'Identifica a pessoa',
      conferindo: 'Conferindo…',
      conferido: 'Pacote conforme a regra e o catálogo',
      baixar: 'Baixar arquivo',
      rotulo: 'Rótulo',
      tratamento: 'Tratamento',
      sensivel: 'Sensível',
      justificativa: 'Justificativa',
      maisCampo: 'Mais um campo',
      gravar: 'Gravar pacote',
      devida: 'Próxima entrega devida: {i} a {f}',
      emDia: 'Entregas em dia',
      revisaoVencida: 'Revisão da minimização vencida',
      semRevisao: 'Minimização ainda não revisada: a entrega fica bloqueada até a revisão',
      revisar: 'Revisar minimização',
      entregas: 'Entregas',
      enviada: 'Enviada',
      confirmar: 'Confirmar',
      rejeitar: 'Rejeitar',
      protocolo: 'Protocolo ou motivo',
      gravado: 'Gravado.',
    },
  },
});
const cliente = useQueryClient();
const pacotes = useQuery({ queryKey: ['integracoes', 'pacotes'], queryFn: lerPacotes });
const aviso = ref('');
const falha = ref('');
const novo = () => ({
  sequencia: 1,
  entidade: '',
  campo: '',
  rotuloSaida: '',
  tratamento: 'original',
  dadoSensivel: false,
  justificativa: '',
});
const lista = (xs: readonly string[]) => xs.map((x) => ({ valor: x, rotulo: x }));
const p = reactive({
  parceiroCodigo: '',
  codigo: '',
  nome: '',
  conteudo: '',
  formato: 'csv',
  meioEntrega: 'sftp',
  periodicidade: 'diaria',
  agenda: '02:00',
  anonimizacao: 'pseudonimizada',
  campos: [novo()],
});
const maisCampo = () =>
  p.campos.push({ ...novo(), entidade: p.campos[0]?.entidade ?? '', sequencia: p.campos.length + 1 });

// O catálogo das visões exportáveis: a visão e o campo só entre os da lista branca; o sensível vem do catálogo.
const visoes = useQuery({ queryKey: ['integracoes', 'pacotes', 'visoes'], queryFn: lerVisoes });
const opcoesVisao = computed(() =>
  (visoes.data.value?.itens ?? []).map((v) => ({ valor: v.entidade, rotulo: v.rotulo })),
);
const camposDa = (entidade: string) =>
  visoes.data.value?.itens.find((v) => v.entidade === entidade)?.campos ?? [];
const opcoesCampo = (entidade: string) =>
  camposDa(entidade).map((k) => ({
    valor: k.nome,
    rotulo: `${k.rotulo}${k.sensivel ? ' · sensível' : ''}${k.identificador ? ' · identifica' : ''}`,
  }));
const doCatalogo = (entidade: string, campo: string) => camposDa(entidade).find((k) => k.nome === campo);
watch(
  () => p.campos.map((c) => `${c.entidade}.${c.campo}`),
  () => {
    for (const c of p.campos) {
      const k = doCatalogo(c.entidade, c.campo);
      if (!k) continue;
      c.dadoSensivel = k.sensivel;
      if (!c.rotuloSaida.trim()) c.rotuloSaida = k.nome;
    }
  },
);

// A conferência na hora (as regras da gravação, sem gravar), meio segundo depois da última mudança.
const recusas = ref<ErroPacote[]>([]);
const conferindo = ref(false);
let espera: ReturnType<typeof setTimeout> | undefined;
watch(
  p,
  () => {
    clearTimeout(espera);
    espera = setTimeout(async () => {
      conferindo.value = true;
      try {
        recusas.value = (
          await conferirPacote({ ...p, agenda: p.periodicidade === 'sob_demanda' ? null : p.agenda })
        ).erros;
      } catch {
        recusas.value = [];
      } finally {
        conferindo.value = false;
      }
    }, 500);
  },
  { deep: true },
);
const recusasDoCampo = (i: number) => recusas.value.filter((e) => e.campo.startsWith(`campos.${i}.`));
const recusasGerais = computed(() => recusas.value.filter((e) => !/^campos\.\d+\./.test(e.campo)));
const semJustificativa = computed(() => p.campos.some((c) => c.justificativa.trim().length < 10));

async function executar(fn: () => Promise<unknown>) {
  aviso.value = '';
  falha.value = '';
  try {
    await fn();
    aviso.value = t('gravado');
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'pacotes'] });
  } catch (e) {
    falha.value = e instanceof Error ? e.message : String(e);
  }
}
const salvar = () =>
  executar(() => gravarPacote({ ...p, agenda: p.periodicidade === 'sob_demanda' ? null : p.agenda }));

const revisar = (id: number, versao: number) => executar(() => revisarPacote(id, versao));

const aberto = ref<number | null>(null);
const entregas = useQuery({
  queryKey: computed(() => ['integracoes', 'pacotes', 'entregas', aberto.value]),
  queryFn: () => lerEntregas(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});
const texto = ref('');
const mudar = (id: number, situacao: string) =>
  executar(() =>
    mudarEntrega(id, {
      situacao,
      protocolo: situacao === 'confirmada' ? texto.value : null,
      mensagem: situacao === 'rejeitada' ? texto.value : null,
    }),
  );
const data = (v: string) => new Date(v).toLocaleString('pt-BR');
</script>

<template>
  <section class="painel" data-testid="pacotes-painel">
    <h2>{{ t('titulo') }}</h2>
    <p v-if="aviso" role="status">{{ aviso }}</p>
    <p v-if="falha" role="alert">{{ falha }}</p>
    <article v-for="x in pacotes.data.value?.itens ?? []" :key="x.id" data-testid="pacote">
      <h3>
        {{ x.parceiro }} · {{ x.nome }} ({{ x.formato }}, {{ x.meioEntrega }}, {{ x.periodicidade }}
        {{ x.agenda ?? '' }})
      </h3>
      <p>{{ x.anonimizacao }} · {{ x.campos.map((c) => c.rotuloSaida).join(', ') }}</p>
      <p v-if="x.revisaoVencida" role="alert">{{ t('revisaoVencida') }}</p>
      <p v-else-if="!x.proximaRevisao" role="alert">{{ t('semRevisao') }}</p>
      <button
        v-if="props.podeEditar"
        type="button"
        data-testid="pacote-revisar"
        @click="revisar(x.id, x.versao)"
      >
        {{ t('revisar') }}
      </button>
      <p>
        {{
          x.proximaDevida
            ? t('devida', { i: data(x.proximaDevida.inicio), f: data(x.proximaDevida.fim) })
            : t('emDia')
        }}
      </p>
      <button type="button" @click="aberto = aberto === x.id ? null : x.id">{{ t('entregas') }}</button>
      <table v-if="aberto === x.id && entregas.data.value">
        <tr v-for="e in entregas.data.value.itens" :key="e.id">
          <td>{{ data(e.periodoInicio) }}</td>
          <td>{{ data(e.periodoFim) }}</td>
          <td>{{ e.quantidadeRegistros }}</td>
          <td>{{ e.situacao }} {{ e.protocolo ?? e.mensagem ?? '' }}</td>
          <td v-if="props.podeEditar">
            <a v-if="e.arquivoId" :href="urlArquivoEntrega(e.id)" download data-testid="entrega-baixar">{{
              t('baixar')
            }}</a>
            <button v-if="e.situacao === 'gerada'" type="button" @click="mudar(e.id, 'enviada')">
              {{ t('enviada') }}
            </button>
            <template v-if="e.situacao === 'enviada'">
              <input v-model="texto" :placeholder="t('protocolo')" maxlength="100" />
              <button type="button" :disabled="!texto.trim()" @click="mudar(e.id, 'confirmada')">
                {{ t('confirmar') }}
              </button>
              <button type="button" :disabled="!texto.trim()" @click="mudar(e.id, 'rejeitada')">
                {{ t('rejeitar') }}
              </button>
            </template>
          </td>
        </tr>
      </table>
    </article>
    <form v-if="props.podeEditar" data-testid="pacote-novo" @submit.prevent="salvar">
      <label>{{ t('parceiro') }} <input v-model="p.parceiroCodigo" required maxlength="40" /></label>
      <label>{{ t('codigo') }} <input v-model="p.codigo" required maxlength="40" /></label>
      <label>{{ t('nome') }} <input v-model="p.nome" required maxlength="150" /></label>
      <label>{{ t('conteudo') }} <input v-model="p.conteudo" required maxlength="1000" /></label>
      <SanteSelecao
        v-model="p.formato"
        :rotulo="t('formato')"
        :opcoes="lista(['csv', 'json', 'xml', 'fhir', 'parquet', 'pdf'])"
      />
      <SanteSelecao
        v-model="p.meioEntrega"
        :rotulo="t('meio')"
        :opcoes="lista(['api', 'webhook', 'sftp', 'arquivo_seguro', 'email_seguro'])"
      />
      <SanteSelecao
        v-model="p.periodicidade"
        :rotulo="t('periodicidade')"
        :opcoes="lista(['sob_demanda', 'diaria', 'semanal', 'mensal'])"
      />
      <label v-if="p.periodicidade !== 'sob_demanda'"
        >{{ t('agenda') }} <input v-model="p.agenda" maxlength="60"
      /></label>
      <SanteSelecao
        v-model="p.anonimizacao"
        :rotulo="t('anonimizacao')"
        :opcoes="lista(['nenhuma', 'pseudonimizada', 'anonimizada', 'agregada'])"
      />
      <fieldset>
        <legend>{{ t('campos') }}</legend>
        <div v-for="(c, i) in p.campos" :key="i">
          <input v-model.number="c.sequencia" type="number" min="1" style="width: 4em" />
          <SanteSelecao
            v-model="c.entidade"
            :rotulo="t('visao')"
            :opcoes="opcoesVisao"
            :data-testid="`pacote-campo-visao-${i}`"
          />
          <SanteSelecao
            v-model="c.campo"
            :rotulo="t('campo')"
            :opcoes="opcoesCampo(c.entidade)"
            :data-testid="`pacote-campo-nome-${i}`"
          />
          <input v-model="c.rotuloSaida" :placeholder="t('rotulo')" maxlength="100" />
          <SanteSelecao
            v-model="c.tratamento"
            :rotulo="t('tratamento')"
            :opcoes="lista(['original', 'pseudonimizado', 'mascarado', 'generalizado', 'agregado'])"
            ocultar-rotulo
          />
          <label
            ><input
              v-model="c.dadoSensivel"
              type="checkbox"
              :disabled="!!doCatalogo(c.entidade, c.campo)"
              :title="doCatalogo(c.entidade, c.campo) ? t('sensivelCatalogo') : ''"
            />
            {{ t('sensivel') }}</label
          >
          <span v-if="doCatalogo(c.entidade, c.campo)?.identificador">{{ t('identificador') }}</span>
          <input v-model="c.justificativa" :placeholder="t('justificativa')" maxlength="500" />
          <p
            v-for="e in recusasDoCampo(i)"
            :key="e.campo + e.codigo"
            role="alert"
            data-testid="pacote-recusa"
          >
            {{ e.mensagem }}
          </p>
        </div>
        <button type="button" @click="maisCampo">{{ t('maisCampo') }}</button>
      </fieldset>
      <p v-for="e in recusasGerais" :key="e.campo + e.codigo" role="alert" data-testid="pacote-recusa">
        {{ e.mensagem }}
      </p>
      <p v-if="conferindo" role="status">{{ t('conferindo') }}</p>
      <p
        v-else-if="!recusas.length && p.campos.some((c) => c.campo)"
        role="status"
        data-testid="pacote-conforme"
      >
        {{ t('conferido') }}
      </p>
      <button type="submit" :disabled="semJustificativa || recusas.length > 0">{{ t('gravar') }}</button>
    </form>
  </section>
</template>
