<script setup lang="ts">
// Criação e quebra automática de contas (F8, 06-FAT linha 13): `/faturamento/regras-conta`. O faturista cadastra a
// regra por origem da entrada, categoria do atendimento, setor, grupo e fonte pagadora de origem, com as exceções, e
// vê na hora o que falta (as mesmas validações do domínio, conferidas de novo pelo servidor). A regra de criação decide
// a fonte pagadora da conta aberta na entrada do paciente; a de quebra com período (diária, semanal, quinzenal, mensal)
// é aplicada pela rotina diária às contas de internação abertas. A simulação sobre um atendimento real mostra que regra
// vale, por que as outras não e o período da conta, antes de mudar a configuração. Nada se apaga: inativar é desmarcar
// "ativa"; a exceção retirada fica inativa no histórico.
import {
  ACOES_REGRA_CONTA,
  type AcaoRegraConta,
  PERIODICIDADES_CONTA,
  type PeriodicidadeConta,
  validarRegraConta,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-faturamento.js';
import {
  lerRegrasComerciais,
  type RegrasComerciais,
  salvarRegraConta,
  simularRegraConta,
} from '../api-regras-comerciais.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Criação e quebra automática de contas',
      explica:
        'A regra de criação decide o convênio da conta aberta na entrada do paciente; a de quebra divide a conta de internação por período na rotina diária. Vale a de menor número de prioridade; empatadas, a mais específica.',
      acao: 'O que a regra faz',
      acao_criar_conta: 'Criar a conta em outro convênio',
      acao_quebrar_conta: 'Quebrar a conta por período',
      acao_transferir_item: 'Transferir item para outra conta',
      origem: 'Origem da entrada',
      categoria: 'Categoria do atendimento',
      setor: 'Setor',
      grupo: 'Grupo de faturamento',
      fonteOrigem: 'Convênio do atendimento',
      fonteDestino: 'Convênio da conta criada',
      periodicidade: 'Período da quebra',
      per_diaria: 'Diária',
      per_semanal: 'Semanal (segunda a domingo)',
      per_quinzenal: 'Quinzenal (1 a 15 e 16 ao fim do mês)',
      per_mensal: 'Mensal',
      semPeriodo: 'Sem período',
      qualquer: 'Qualquer',
      prioridade: 'Prioridade (menor vale primeiro)',
      vigencia: 'Vale a partir de',
      ativa: 'Ativa',
      sim: 'Sim',
      nao: 'Não',
      excecoes: 'Exceções (a regra não vale quando a situação bate com uma delas)',
      novaExcecao: 'Acrescentar exceção',
      retirar: 'Retirar',
      salvar: 'Salvar a regra',
      nova: 'Nova regra',
      editar: 'Editar',
      semRegras: 'Nenhuma regra cadastrada: a conta fica no convênio do atendimento e não é quebrada.',
      criterios: 'Quando vale',
      destino: 'Resultado',
      todas: 'Todas as situações',
      gravado: 'Regra gravada.',
      simulacao: 'Simular num atendimento',
      atendimento: 'Número interno do atendimento',
      simular: 'Simular',
      naoVale: 'Nenhuma regra vale',
      vale: 'Vale a regra #{id}',
      periodo: 'Conta de {inicio} a {fim}',
      motivo_inativa: 'inativa',
      motivo_fora_da_vigencia: 'fora da vigência',
      motivo_criterio_diferente: 'critério diferente',
      motivo_horario_especial_diferente: 'horário especial diferente',
      motivo_excecao: 'afastada por exceção',
      motivo_null: 'vale',
    },
  },
});

const qc = useQueryClient();
const regras = useQuery({ queryKey: ['faturamento', 'regras-comerciais'], queryFn: lerRegrasComerciais });
const op = computed(() => regras.data.value?.opcoes);
type Opcao = { id: number; descricao: string };
const nomeDe = (lista: readonly Opcao[] | undefined, id: number | null | undefined) =>
  id === null || id === undefined ? '' : (lista?.find((o) => o.id === id)?.descricao ?? `#${id}`);
const opcoesDe = (lista: readonly Opcao[] | undefined) => [
  { valor: 0, rotulo: t('qualquer') },
  ...(lista ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
];
const opcoesFonteDestino = computed(() => [
  { valor: 0, rotulo: '' },
  ...(op.value?.fontes ?? []).map((o) => ({ valor: o.id, rotulo: o.descricao })),
]);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('regras-conta');

interface Excecao {
  categoriaAtendimentoId: number;
  origemEntradaId: number;
  grupoId: number;
}
const vazio = () => ({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  acao: 'criar_conta' as AcaoRegraConta,
  origemEntradaId: 0,
  categoriaAtendimentoId: 0,
  setorId: 0,
  grupoId: 0,
  fonteOrigemId: 0,
  fonteDestinoId: 0,
  periodicidade: '' as PeriodicidadeConta | '',
  prioridade: 100,
  vigenciaInicio: new Date().toISOString().slice(0, 10),
  ativo: true,
  excecoes: [] as Excecao[],
});
const f = reactive(vazio());
const ouNulo = (v: number) => (v > 0 ? v : null);

// As mesmas regras do domínio, na hora (o servidor confere de novo).
const erros = computed(() =>
  validarRegraConta({
    acao: f.acao,
    origemEntrada: ouNulo(f.origemEntradaId),
    categoriaAtendimento: ouNulo(f.categoriaAtendimentoId),
    setor: ouNulo(f.setorId),
    grupo: ouNulo(f.grupoId),
    fonteOrigem: ouNulo(f.fonteOrigemId),
    fonteDestino: ouNulo(f.fonteDestinoId),
    periodicidade: f.periodicidade || null,
    prioridade: f.prioridade,
    vigenciaInicio: f.vigenciaInicio,
    excecoes: f.excecoes.map((x) => ({
      categoriaAtendimento: ouNulo(x.categoriaAtendimentoId),
      origemEntrada: ouNulo(x.origemEntradaId),
      grupo: ouNulo(x.grupoId),
    })),
  }),
);
const listaErros = computed(() => Object.values(erros.value));

type RegraLida = RegrasComerciais['regrasConta'][number];
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
function editar(r: RegraLida) {
  const x = r as RegraLida & Record<string, unknown>;
  const exc = Array.isArray(x['excecoes']) ? (x['excecoes'] as Record<string, unknown>[]) : [];
  Object.assign(f, {
    id: r.id,
    versao: r.versao,
    acao: r.acao as AcaoRegraConta,
    origemEntradaId: r.origemEntrada ?? 0,
    categoriaAtendimentoId: r.categoriaAtendimento ?? 0,
    setorId: r.setor ?? 0,
    grupoId: r.grupo ?? 0,
    fonteOrigemId: num(x['fonteOrigem']),
    fonteDestinoId: r.fonteDestino ?? 0,
    periodicidade: (r.periodicidade ?? '') as PeriodicidadeConta | '',
    prioridade: r.prioridade,
    vigenciaInicio: r.vigenciaInicio,
    ativo: r.ativo,
    excecoes: exc.map((e) => ({
      categoriaAtendimentoId: num(e['categoriaAtendimento']),
      origemEntradaId: num(e['origemEntrada']),
      grupoId: num(e['grupo']),
    })),
  });
}
function nova() {
  Object.assign(f, vazio());
}
async function salvar() {
  if (listaErros.value.length) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await salvarRegraConta(
      {
        ...(f.id ? { id: f.id, versao: f.versao } : {}),
        acao: f.acao,
        origemEntradaId: ouNulo(f.origemEntradaId),
        categoriaAtendimentoId: ouNulo(f.categoriaAtendimentoId),
        setorId: ouNulo(f.setorId),
        grupoId: ouNulo(f.grupoId),
        fonteOrigemId: ouNulo(f.fonteOrigemId),
        fonteDestinoId: f.acao === 'quebrar_conta' ? null : ouNulo(f.fonteDestinoId),
        periodicidade: f.periodicidade || null,
        prioridade: f.prioridade,
        vigenciaInicio: f.vigenciaInicio,
        ativo: f.ativo,
        excecoes: f.excecoes.map((x) => ({
          categoriaAtendimentoId: ouNulo(x.categoriaAtendimentoId),
          origemEntradaId: ouNulo(x.origemEntradaId),
          grupoId: ouNulo(x.grupoId),
        })),
      },
      chave,
    );
    mensagem.value = t('gravado');
    chave = novaChave('regras-conta');
    nova();
    await qc.invalidateQueries({ queryKey: ['faturamento', 'regras-comerciais'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

function criteriosDe(r: RegraLida): string {
  const x = r as RegraLida & Record<string, unknown>;
  const partes = [
    r.origemEntrada ? `${t('origem')}: ${nomeDe(op.value?.origensEntrada, r.origemEntrada)}` : '',
    r.categoriaAtendimento
      ? `${t('categoria')}: ${nomeDe(op.value?.categoriasAtendimento, r.categoriaAtendimento)}`
      : '',
    r.setor ? `${t('setor')}: ${nomeDe(op.value?.setores, r.setor)}` : '',
    r.grupo ? `${t('grupo')}: ${nomeDe(op.value?.grupos, r.grupo)}` : '',
    num(x['fonteOrigem']) ? `${t('fonteOrigem')}: ${nomeDe(op.value?.fontes, num(x['fonteOrigem']))}` : '',
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : t('todas');
}
function destinoDe(r: RegraLida): string {
  if (r.acao === 'quebrar_conta')
    return r.periodicidade ? t(`per_${r.periodicidade}`) : t('acao_quebrar_conta');
  return nomeDe(op.value?.fontes, r.fonteDestino);
}

// Simulação sobre um atendimento real (só leitura).
const sim = reactive({ atendimento: '' });
const simulado = ref<Record<string, unknown> | null>(null);
const resumoSim = (k: 'criacao' | 'quebra') => {
  const r = simulado.value?.[k] as
    | {
        regraId: number | null;
        periodo: { inicio: string; fim: string } | null;
        avaliadas: { id: number; motivo: string | null }[];
      }
    | undefined;
  return r ?? null;
};
async function simular() {
  const a = Number(sim.atendimento);
  if (!Number.isInteger(a) || a <= 0) return;
  erro.value = null;
  try {
    simulado.value = await simularRegraConta(a);
  } catch (e) {
    erro.value = e;
    simulado.value = null;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rc-titulo" data-testid="tela-regras-conta">
    <h1 id="rc-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explica') }}</p>
    <MensagemFaturamento :texto="mensagem" testid="rc-mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="regras.error.value" :erro="regras.error.value" />

    <template v-if="regras.data.value">
      <table v-if="regras.data.value.regrasConta.length" class="tabela" data-testid="rc-regras">
        <thead>
          <tr>
            <th scope="col">{{ t('prioridade') }}</th>
            <th scope="col">{{ t('acao') }}</th>
            <th scope="col">{{ t('criterios') }}</th>
            <th scope="col">{{ t('destino') }}</th>
            <th scope="col">{{ t('vigencia') }}</th>
            <th scope="col">{{ t('ativa') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('editar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regras.data.value.regrasConta" :key="r.id" :data-testid="`rc-regra-${r.id}`">
            <td>{{ r.prioridade }}</td>
            <td>{{ t(`acao_${r.acao}`) }}</td>
            <td>{{ criteriosDe(r) }}</td>
            <td>{{ destinoDe(r) }}</td>
            <td>{{ r.vigenciaInicio }}</td>
            <td>{{ r.ativo ? t('sim') : t('nao') }}</td>
            <td>
              <button type="button" :data-testid="`rc-editar-${r.id}`" @click="editar(r)">
                {{ t('editar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="rc-sem-regras">{{ t('semRegras') }}</p>

      <form class="formulario" data-testid="rc-form" @submit.prevent="salvar">
        <SanteSelecao
          v-model="f.acao"
          :rotulo="t('acao')"
          :opcoes="ACOES_REGRA_CONTA.map((a) => ({ valor: a, rotulo: t(`acao_${a}`) }))"
          data-testid="rc-acao"
        />
        <SanteSelecao
          v-model="f.origemEntradaId"
          :rotulo="t('origem')"
          :opcoes="opcoesDe(op?.origensEntrada)"
          data-testid="rc-origem"
        />
        <SanteSelecao
          v-model="f.categoriaAtendimentoId"
          :rotulo="t('categoria')"
          :opcoes="opcoesDe(op?.categoriasAtendimento)"
          data-testid="rc-categoria"
        />
        <SanteSelecao
          v-model="f.setorId"
          :rotulo="t('setor')"
          :opcoes="opcoesDe(op?.setores)"
          data-testid="rc-setor"
        />
        <SanteSelecao
          v-model="f.grupoId"
          :rotulo="t('grupo')"
          :opcoes="opcoesDe(op?.grupos)"
          data-testid="rc-grupo"
        />
        <SanteSelecao
          v-model="f.fonteOrigemId"
          :rotulo="t('fonteOrigem')"
          :opcoes="opcoesDe(op?.fontes)"
          data-testid="rc-fonte-origem"
        />
        <SanteSelecao
          v-if="f.acao !== 'quebrar_conta'"
          v-model="f.fonteDestinoId"
          :rotulo="t('fonteDestino')"
          :opcoes="opcoesFonteDestino"
          data-testid="rc-fonte-destino"
        />
        <SanteSelecao
          v-model="f.periodicidade"
          :rotulo="t('periodicidade')"
          :opcoes="[
            { valor: '' as const, rotulo: t('semPeriodo') },
            ...PERIODICIDADES_CONTA.map((p) => ({ valor: p, rotulo: t(`per_${p}`) })),
          ]"
          data-testid="rc-periodicidade"
        />
        <label>
          {{ t('prioridade') }}
          <input
            v-model.number="f.prioridade"
            type="number"
            min="0"
            max="65535"
            data-testid="rc-prioridade"
          />
        </label>
        <label>
          {{ t('vigencia') }}
          <input v-model="f.vigenciaInicio" type="date" data-testid="rc-vigencia" />
        </label>
        <label><input v-model="f.ativo" type="checkbox" data-testid="rc-ativa" /> {{ t('ativa') }}</label>

        <fieldset data-testid="rc-excecoes">
          <legend>{{ t('excecoes') }}</legend>
          <div v-for="(x, i) in f.excecoes" :key="i" :data-testid="`rc-excecao-${i}`">
            <SanteSelecao
              v-model="x.origemEntradaId"
              :rotulo="t('origem')"
              :opcoes="opcoesDe(op?.origensEntrada)"
              :data-testid="`rc-excecao-${i}-origem`"
            />
            <SanteSelecao
              v-model="x.categoriaAtendimentoId"
              :rotulo="t('categoria')"
              :opcoes="opcoesDe(op?.categoriasAtendimento)"
              :data-testid="`rc-excecao-${i}-categoria`"
            />
            <SanteSelecao
              v-model="x.grupoId"
              :rotulo="t('grupo')"
              :opcoes="opcoesDe(op?.grupos)"
              :data-testid="`rc-excecao-${i}-grupo`"
            />
            <button type="button" @click="f.excecoes.splice(i, 1)">{{ t('retirar') }}</button>
          </div>
          <button
            type="button"
            data-testid="rc-nova-excecao"
            @click="f.excecoes.push({ categoriaAtendimentoId: 0, origemEntradaId: 0, grupoId: 0 })"
          >
            {{ t('novaExcecao') }}
          </button>
        </fieldset>

        <p v-if="listaErros.length" role="status" data-testid="rc-erros">{{ listaErros.join(' · ') }}</p>
        <button type="submit" :disabled="gravando || listaErros.length > 0" data-testid="rc-salvar">
          {{ t('salvar') }}
        </button>
        <button v-if="f.id" type="button" data-testid="rc-nova" @click="nova">{{ t('nova') }}</button>
      </form>

      <h2>{{ t('simulacao') }}</h2>
      <form class="formulario" data-testid="rc-simulacao" @submit.prevent="simular">
        <label>
          {{ t('atendimento') }}
          <input v-model="sim.atendimento" inputmode="numeric" data-testid="rc-sim-atendimento" />
        </label>
        <button type="submit" :disabled="!Number(sim.atendimento)" data-testid="rc-simular">
          {{ t('simular') }}
        </button>
      </form>
      <div v-if="simulado" data-testid="rc-sim-resultado">
        <div v-for="k in ['criacao', 'quebra'] as const" :key="k" :data-testid="`rc-sim-${k}`">
          <h3>{{ t(k === 'criacao' ? 'acao_criar_conta' : 'acao_quebrar_conta') }}</h3>
          <p>
            {{ resumoSim(k)?.regraId ? t('vale', { id: resumoSim(k)?.regraId }) : t('naoVale') }}
            <template v-if="resumoSim(k)?.periodo">
              · {{ t('periodo', { inicio: resumoSim(k)?.periodo?.inicio, fim: resumoSim(k)?.periodo?.fim }) }}
            </template>
          </p>
          <ul>
            <li v-for="a in resumoSim(k)?.avaliadas ?? []" :key="a.id">
              #{{ a.id }}: {{ t(`motivo_${a.motivo}`) }}
            </li>
          </ul>
        </div>
      </div>
    </template>
  </section>
</template>
