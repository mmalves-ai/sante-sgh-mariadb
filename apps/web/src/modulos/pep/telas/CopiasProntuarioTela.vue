<script setup lang="ts">
// Cópia do prontuário no balcão (03-PEP L131): a fila dos pedidos em aberto (atrasados em destaque) e, por paciente,
// todos os pedidos dele com a entrega. O pedido novo fica numa linha de decisões (quem pede, motivo, período e
// prazo), com validação na hora: o CPF é pedido de quem não é o paciente, o parentesco do familiar e o documento
// digitalizado do procurador. Cada pedido mostra só o próximo passo possível; a entrega pede quem recebeu, o vínculo,
// o documento conferido e as folhas. A regra final é do servidor; a recusa aparece como veio. Nada é apagado.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarPacientesAnotacoes } from '../api-anotacoes-administrativas.js';
import {
  acaoCopia,
  entregarCopia,
  lerCopias,
  pedirCopia,
  type PedidoCopiaTela,
} from '../api-copias-prontuario.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente?: string }>();
const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const id = computed(() => (props.paciente ? Number(props.paciente) : null));
const chave = computed(() => ['pep', 'copias', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerCopias(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const podeGravar = computed(() => pode('pep.prontuario.exportar'));
const erro = ref<unknown>(null);
const ok = ref('');

const SOLICITANTES = [
  'paciente',
  'representante_legal',
  'procurador',
  'familiar',
  'autoridade_judicial',
  'profissional',
  'outro',
] as const;
const VINCULOS = [
  'proprio_paciente',
  'conjuge',
  'pai_mae',
  'filho',
  'irmao',
  'responsavel_legal',
  'procurador',
  'herdeiro',
  'autoridade',
  'outro',
] as const;
const FORMAS = ['presencial', 'correio', 'digital'] as const;
const opcoes = <T extends string>(lista: readonly T[], grupo: string) =>
  lista.map((v) => ({ valor: v, rotulo: t(`pep.copias.${grupo}.${v}`) }));
const opcoesSolicitante = computed(() => opcoes(SOLICITANTES, 'solicitantes'));
const opcoesVinculo = computed(() => opcoes(VINCULOS, 'vinculos'));
const opcoesForma = computed(() => opcoes(FORMAS, 'formas'));
const opcoesTipoDoc = computed(() =>
  (d.value?.opcoes.tiposDocumento ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
);

// Busca do paciente (só na fila).
const termo = ref('');
const achados = ref<{ id: number; nome: string }[]>([]);
async function buscar() {
  erro.value = null;
  try {
    const r = await buscarPacientesAnotacoes(termo.value.trim());
    achados.value = r.itens.map((p) => ({ id: Number(p.id), nome: p.nome }));
  } catch (e) {
    erro.value = e;
  }
}
const abrirPaciente = (p: number) =>
  roteador.push({ name: 'pep.copiasProntuario.paciente', params: { paciente: p } });

// Pedido novo.
const novo = reactive({
  solicitanteTipo: 'paciente',
  solicitanteNome: '',
  solicitanteCpf: '',
  parentesco: '',
  motivo: '',
  periodoInicio: '',
  periodoFim: '',
  prazoDias: '15',
  arquivo: '',
});
const cpfDigitos = computed(() => novo.solicitanteCpf.replace(/\D/g, ''));
const faltasPedido = computed(() => {
  const f: string[] = [];
  if (novo.solicitanteNome.trim().length < 3) f.push(t('pep.copias.solicitanteNome'));
  if (
    novo.solicitanteTipo !== 'paciente' &&
    novo.solicitanteTipo !== 'autoridade_judicial' &&
    cpfDigitos.value.length !== 11
  )
    f.push(t('pep.copias.solicitanteCpf'));
  if (['familiar', 'representante_legal'].includes(novo.solicitanteTipo) && novo.parentesco.trim().length < 3)
    f.push(t('pep.copias.parentesco'));
  if (novo.solicitanteTipo === 'procurador' && !novo.arquivo) f.push(t('pep.copias.documentoArquivo'));
  if (novo.motivo.trim().length < 5) f.push(t('pep.copias.motivo'));
  if (novo.periodoInicio && novo.periodoFim && novo.periodoFim < novo.periodoInicio)
    f.push(t('pep.copias.periodoFim'));
  const prazo = Number(novo.prazoDias);
  if (!Number.isInteger(prazo) || prazo < 1 || prazo > 15) f.push(t('pep.copias.prazoDias'));
  return f;
});
async function executar(fn: () => Promise<unknown>) {
  erro.value = null;
  ok.value = '';
  try {
    await fn();
    ok.value = t('pep.copias.gravado');
    await cliente.invalidateQueries({ queryKey: ['pep', 'copias'] });
  } catch (e) {
    erro.value = e;
  }
}
const nulo = (s: string) => (s.trim() ? s.trim() : null);
function registrarPedido() {
  if (!id.value || faltasPedido.value.length) return;
  const arquivo = novo.arquivo ? Number(novo.arquivo) : null;
  void executar(() =>
    pedirCopia({
      paciente: id.value,
      solicitanteTipo: novo.solicitanteTipo,
      solicitanteNome: novo.solicitanteNome.trim(),
      solicitanteCpf: nulo(cpfDigitos.value),
      solicitanteParentesco: nulo(novo.parentesco),
      motivo: novo.motivo.trim(),
      periodoInicio: nulo(novo.periodoInicio),
      periodoFim: nulo(novo.periodoFim),
      prazoDias: Number(novo.prazoDias),
      procuracaoArquivo: novo.solicitanteTipo === 'procurador' ? arquivo : null,
      autorizacaoArquivo: novo.solicitanteTipo !== 'paciente' ? arquivo : null,
    }),
  );
}

// Próximos passos por situação.
const PASSOS: Record<string, readonly string[]> = {
  solicitada: ['analisar', 'autorizar', 'negar', 'cancelar'],
  em_analise: ['autorizar', 'negar', 'cancelar'],
  autorizada: ['produzir', 'pronta', 'negar', 'cancelar'],
  em_producao: ['pronta', 'negar', 'cancelar'],
  pronta: ['cancelar'],
};
const motivoAcao = reactive<Record<number, string>>({});
const arquivoAcao = reactive<Record<number, string>>({});
function agir(p: PedidoCopiaTela, acao: string) {
  void executar(() =>
    acaoCopia(p.id, {
      versao: p.versao,
      acao,
      motivo: nulo(motivoAcao[p.id] ?? ''),
      autorizacaoArquivo: arquivoAcao[p.id] ? Number(arquivoAcao[p.id]) : null,
    }),
  );
}

// Entrega.
const entrega = reactive<
  Record<
    number,
    {
      recebedorNome: string;
      vinculo: string;
      tipoDocumento: string;
      numeroDocumento: string;
      folhas: string;
      forma: string;
      endereco: string;
    }
  >
>({});
const formEntrega = (p: PedidoCopiaTela) =>
  (entrega[p.id] ??= {
    recebedorNome: p.solicitanteTipo === 'paciente' ? p.solicitanteNome : '',
    vinculo: p.solicitanteTipo === 'paciente' ? 'proprio_paciente' : '',
    tipoDocumento: '',
    numeroDocumento: '',
    folhas: '',
    forma: 'presencial',
    endereco: '',
  });
const entregaPronta = (p: PedidoCopiaTela) => {
  const e = formEntrega(p);
  return (
    e.recebedorNome.trim().length >= 3 &&
    Boolean(e.vinculo) &&
    Boolean(e.tipoDocumento) &&
    e.numeroDocumento.trim().length >= 4 &&
    Number(e.folhas) >= 1 &&
    (e.forma !== 'correio' || e.endereco.trim().length >= 10)
  );
};
function entregar(p: PedidoCopiaTela) {
  const e = formEntrega(p);
  void executar(() =>
    entregarCopia(p.id, {
      versao: p.versao,
      forma: e.forma,
      recebedorNome: e.recebedorNome.trim(),
      vinculo: e.vinculo,
      tipoDocumento: Number(e.tipoDocumento),
      numeroDocumento: e.numeroDocumento.trim(),
      quantidadeFolhas: Number(e.folhas),
      endereco: nulo(e.endereco),
      procuracaoArquivo: arquivoAcao[p.id] ? Number(arquivoAcao[p.id]) : null,
    }),
  );
}
</script>

<template>
  <section class="copias" data-testid="copias-prontuario">
    <h1>{{ t('pep.copias.titulo') }}</h1>
    <p class="explicacao">{{ t('pep.copias.explicacao') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" />

    <form v-if="id === null" class="linha" @submit.prevent="buscar">
      <label>
        {{ t('pep.copias.buscarPaciente') }}
        <input v-model="termo" data-testid="copias-busca" />
      </label>
      <SanteBotao tipo="submit" :rotulo="t('pep.copias.buscar')" :desabilitado="termo.trim().length < 3" />
      <ul>
        <li v-for="a in achados" :key="a.id">
          <SanteBotao
            variante="texto"
            :rotulo="`${a.nome} · ${t('pep.copias.abrir')}`"
            @acionar="abrirPaciente(a.id)"
          />
        </li>
      </ul>
    </form>

    <form
      v-if="id !== null && podeGravar"
      class="novo"
      data-testid="copias-novo"
      @submit.prevent="registrarPedido"
    >
      <h2>{{ t('pep.copias.novo') }}</h2>
      <div class="linha">
        <SanteSelecao
          v-model="novo.solicitanteTipo"
          :rotulo="t('pep.copias.solicitanteTipo')"
          :opcoes="opcoesSolicitante"
          data-testid="copias-solicitante"
        />
        <label
          >{{ t('pep.copias.solicitanteNome')
          }}<input v-model="novo.solicitanteNome" data-testid="copias-nome"
        /></label>
        <label v-if="novo.solicitanteTipo !== 'paciente'">
          {{ t('pep.copias.solicitanteCpf')
          }}<input v-model="novo.solicitanteCpf" inputmode="numeric" data-testid="copias-cpf" />
        </label>
        <label v-if="['familiar', 'representante_legal'].includes(novo.solicitanteTipo)">
          {{ t('pep.copias.parentesco') }}<input v-model="novo.parentesco" data-testid="copias-parentesco" />
        </label>
        <label v-if="novo.solicitanteTipo !== 'paciente'">
          {{ t('pep.copias.documentoArquivo')
          }}<input v-model="novo.arquivo" inputmode="numeric" data-testid="copias-arquivo" />
        </label>
      </div>
      <div class="linha">
        <label
          >{{ t('pep.copias.motivo')
          }}<input v-model="novo.motivo" maxlength="150" data-testid="copias-motivo"
        /></label>
        <label>{{ t('pep.copias.periodoInicio') }}<input v-model="novo.periodoInicio" type="date" /></label>
        <label>{{ t('pep.copias.periodoFim') }}<input v-model="novo.periodoFim" type="date" /></label>
        <label
          >{{ t('pep.copias.prazoDias') }}<input v-model="novo.prazoDias" type="number" min="1" max="15"
        /></label>
      </div>
      <p v-if="faltasPedido.length" class="faltas" data-testid="copias-faltas">
        {{ faltasPedido.join(' · ') }}
      </p>
      <SanteBotao
        tipo="submit"
        :rotulo="t('pep.copias.pedir')"
        :desabilitado="faltasPedido.length > 0"
        data-testid="copias-pedir"
      />
    </form>

    <h2>{{ id === null ? t('pep.copias.fila') : t('pep.copias.doPaciente') }}</h2>
    <p v-if="dados.isLoading.value">{{ t('pep.carregando') }}</p>
    <p v-else-if="!d?.pedidos.length">{{ t('pep.copias.vazio') }}</p>
    <article
      v-for="p in d?.pedidos ?? []"
      :key="p.id"
      class="pedido"
      :class="{ atrasada: p.atrasada }"
      :data-testid="`copia-${p.numero}`"
    >
      <header>
        <strong>{{ t('pep.copias.numero', { numero: p.numero }) }}</strong>
        · {{ p.pacienteNome }} · {{ t(`pep.copias.solicitantes.${p.solicitanteTipo}`) }}:
        {{ p.solicitanteNome }} ·
        <span data-testid="copia-situacao">{{ t(`pep.copias.situacoes.${p.situacao}`) }}</span> ·
        {{ t('pep.copias.prazo', { data: p.prazo }) }}
        <span v-if="p.atrasada" class="selo">{{ t('pep.copias.atrasada') }}</span>
        <span v-if="p.portal" class="selo">{{ t('pep.copias.portal') }}</span>
        <SanteBotao
          v-if="id === null"
          variante="texto"
          :rotulo="t('pep.copias.abrir')"
          @acionar="abrirPaciente(p.paciente)"
        />
      </header>
      <p>
        {{ p.motivo }}<template v-if="p.motivoNegativa"> · {{ p.motivoNegativa }}</template>
      </p>
      <p v-if="p.entrega" data-testid="copia-entrega">
        {{
          t('pep.copias.entregue', {
            nome: p.entrega.recebedorNome,
            vinculo: t(`pep.copias.vinculos.${p.entrega.vinculo}`),
            quando: dataHoraBr(p.entrega.entregueEm),
            folhas: p.entrega.quantidadeFolhas ?? 0,
            por: p.entrega.entregador ?? '',
          })
        }}
      </p>
      <div v-if="podeGravar && !p.portal && PASSOS[p.situacao]" class="linha">
        <label
          v-if="
            ['solicitada', 'em_analise'].includes(p.situacao) &&
            !p.temAutorizacao &&
            p.solicitanteTipo !== 'paciente'
          "
        >
          {{ t('pep.copias.documentoArquivo') }}<input v-model="arquivoAcao[p.id]" inputmode="numeric" />
        </label>
        <label
          >{{ t('pep.copias.motivoAcao')
          }}<input v-model="motivoAcao[p.id]" :data-testid="`copia-motivo-${p.numero}`"
        /></label>
        <SanteBotao
          v-for="a in PASSOS[p.situacao]"
          :key="a"
          variante="secundario"
          :rotulo="t(`pep.copias.acoes.${a}`)"
          :data-testid="`copia-${a}-${p.numero}`"
          @acionar="agir(p, a)"
        />
      </div>
      <form
        v-if="podeGravar && !p.portal && p.situacao === 'pronta'"
        class="linha"
        @submit.prevent="entregar(p)"
      >
        <label
          >{{ t('pep.copias.recebedorNome')
          }}<input v-model="formEntrega(p).recebedorNome" data-testid="entrega-nome"
        /></label>
        <SanteSelecao
          v-model="formEntrega(p).vinculo"
          :rotulo="t('pep.copias.vinculo')"
          :opcoes="opcoesVinculo"
          data-testid="entrega-vinculo"
        />
        <SanteSelecao
          v-model="formEntrega(p).tipoDocumento"
          :rotulo="t('pep.copias.tipoDocumento')"
          :opcoes="opcoesTipoDoc"
          data-testid="entrega-tipo-documento"
        />
        <label
          >{{ t('pep.copias.numeroDocumento')
          }}<input v-model="formEntrega(p).numeroDocumento" data-testid="entrega-documento"
        /></label>
        <label
          >{{ t('pep.copias.folhas')
          }}<input v-model="formEntrega(p).folhas" type="number" min="1" data-testid="entrega-folhas"
        /></label>
        <SanteSelecao v-model="formEntrega(p).forma" :rotulo="t('pep.copias.forma')" :opcoes="opcoesForma" />
        <label v-if="formEntrega(p).forma === 'correio'"
          >{{ t('pep.copias.endereco') }}<input v-model="formEntrega(p).endereco"
        /></label>
        <SanteBotao
          tipo="submit"
          :rotulo="t('pep.copias.entregar')"
          :desabilitado="!entregaPronta(p)"
          :data-testid="`copia-entregar-${p.numero}`"
        />
      </form>
    </article>
  </section>
</template>

<style scoped>
.copias {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
label {
  display: grid;
  gap: 2px;
}
.pedido {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2);
}
.pedido.atrasada {
  border-left-width: 4px;
}
.selo,
.faltas {
  font-weight: 600;
}
</style>
