<script setup lang="ts">
// W0-08: o contrato de manutenção depois de registrado (matriz: "encerrar com motivo; física só sem OS ou plano
// vinculado"), sempre com o motivo e pela versão lida:
//   - alterar: vigência, prazo de atendimento, valor mensal e equipamentos cobertos (a empresa, o número e o que cobre
//     não mudam); a versão anterior fica guardada e visível aqui;
//   - encerrar: a data em que deixa de valer (dentro da vigência); nada se apaga;
//   - excluir: só o registrado por engano; com ordem de serviço ou plano ligados, o servidor recusa (409) com quantos e
//     quais, e a tela oferece o encerramento.
// A tela confere pelo mesmo esquema do servidor.
import {
  esquemaAlterarContratoManutencao,
  esquemaEncerrarContratoManutencao,
  esquemaExcluirContratoManutencao,
  type ApoioManutencao,
  type ContratoManutencaoDetalhe,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarCobertura,
  buscarEquipamentos,
  dependentesDaRecusa,
  encerrarCobertura,
  excluirCobertura,
  lerCobertura,
} from '../api-manutencao.js';
import { comTodos, dataBr, problemasDe, reais, reaisDigitados } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

type Modo = 'alterar' | 'encerrar' | 'excluir';
const props = defineProps<{ contrato: number; modo: Modo; apoio: ApoioManutencao }>();
const emit = defineEmits<{ gravado: [string]; cancelar: [] }>();
const { t } = useI18n();

const modo = ref<Modo>(props.modo);
const consulta = useQuery({
  queryKey: computed(() => ['manutencao', 'cobertura', props.contrato]),
  queryFn: () => lerCobertura(props.contrato),
});
const atual = computed<ContratoManutencaoDetalhe | null>(() => consulta.data.value ?? null);

interface Rascunho {
  inicio: string | null;
  fim: string | null;
  slaHoras: string;
  valorMensal: string;
  equipamentos: number[];
}
const r = ref<Rascunho | null>(null);
const motivo = ref('');
const data = ref<string | null>(props.apoio.hoje);
watch(
  atual,
  (c) => {
    if (!c || r.value) return;
    r.value = {
      inicio: c.inicio,
      fim: c.fim,
      slaHoras: c.slaHoras === null ? '' : String(c.slaHoras),
      valorMensal: c.valorMensal === null ? '' : String(c.valorMensal).replace('.', ','),
      equipamentos: [...c.equipamentos],
    };
  },
  { immediate: true },
);

// Os equipamentos: a busca vai ao servidor com o termo; o nome de cada um fica guardado quando entra na lista.
const termo = ref('');
const buscado = ref('');
const equipamentos = useQuery({
  queryKey: computed(() => ['manutencao', 'equipamentos', 'busca', buscado.value]),
  queryFn: () => buscarEquipamentos(buscado.value, null),
  enabled: computed(() => modo.value === 'alterar'),
});
const nomes = ref<Record<number, string>>({});
const nomeEquipamento = (id: number) => {
  const e = (equipamentos.data.value ?? []).find((x) => x.id === id);
  return nomes.value[id] ?? (e ? `${e.codigo} - ${e.nome}` : `#${id}`);
};
const paraAdicionar = ref<number | null>(null);
const opcoesEquipamento = computed(() =>
  comTodos(
    t('manutencao.nenhumSelecionado'),
    (equipamentos.data.value ?? [])
      .filter((e) => !r.value?.equipamentos.includes(e.id))
      .map((e) => ({ valor: e.id, rotulo: `${e.codigo} - ${e.nome}` })),
  ),
);
function adicionar() {
  const id = paraAdicionar.value;
  if (id !== null && r.value && !r.value.equipamentos.includes(id)) {
    const o = opcoesEquipamento.value.find((x) => x.valor === id);
    if (o) nomes.value[id] = o.rotulo;
    r.value.equipamentos.push(id);
  }
  paraAdicionar.value = null;
}

const problemas = ref<Record<string, string>>({});
const listaProblemas = computed(() => Object.values(problemas.value));
const erro = ref<unknown>(null);
const dependentes = computed(() => dependentesDaRecusa(erro.value));
const gravando = ref(false);

function corpo(c: ContratoManutencaoDetalhe) {
  const m = motivo.value.trim();
  if (modo.value === 'encerrar') return { versao: c.versao, data: data.value, motivo: m };
  if (modo.value === 'excluir') return { versao: c.versao, motivo: m };
  const x = r.value as Rascunho;
  const sla = x.slaHoras.trim();
  const valor = x.valorMensal.trim();
  return {
    versao: c.versao,
    inicio: x.inicio,
    fim: x.fim,
    equipamentos: x.equipamentos,
    slaHoras: sla === '' ? null : /^\d{1,3}$/.test(sla) ? Number(sla) : sla,
    valorMensal: valor === '' ? null : (reaisDigitados(valor) ?? valor),
    motivo: m,
  };
}

const ESQUEMAS = {
  alterar: esquemaAlterarContratoManutencao,
  encerrar: esquemaEncerrarContratoManutencao,
  excluir: esquemaExcluirContratoManutencao,
} as const;
const ENVIAR = { alterar: alterarCobertura, encerrar: encerrarCobertura, excluir: excluirCobertura } as const;

async function enviar() {
  const c = atual.value;
  if (!c || !r.value) return;
  erro.value = null;
  const b = corpo(c);
  problemas.value = problemasDe(ESQUEMAS[modo.value], { ...b, id: c.id });
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    const x = await ENVIAR[modo.value](c.id, b);
    emit('gravado', x.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

function encerrarEmVez() {
  erro.value = null;
  modo.value = 'encerrar';
}
</script>

<template>
  <section class="bloco" :data-testid="`contrato-gerir-${modo}`">
    <ErroManutencao v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!atual || !r" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <h3>
        {{
          t(
            `manutencao.contratos.gestao.${modo === 'alterar' ? 'tituloAlterar' : modo === 'encerrar' ? 'tituloEncerrar' : 'tituloExcluir'}`,
            { numero: atual.numero },
          )
        }}
      </h3>
      <SanteAlerta
        variante="info"
        :texto="
          t(
            `manutencao.contratos.gestao.${modo === 'alterar' ? 'ajudaAlterar' : modo === 'encerrar' ? 'ajudaEncerrar' : 'ajudaExcluir'}`,
          )
        "
      />
      <form data-testid="contrato-gerir-form" @submit.prevent="enviar">
        <template v-if="modo === 'alterar'">
          <div class="campos">
            <SanteData
              v-model="r.inicio"
              editavel
              :rotulo="t('manutencao.contratos.campos.inicio')"
              data-testid="contrato-gerir-inicio"
            />
            <SanteData
              v-model="r.fim"
              editavel
              :rotulo="t('manutencao.contratos.campos.fim')"
              data-testid="contrato-gerir-fim"
            />
            <SanteCampoTexto
              v-model="r.slaHoras"
              :rotulo="t('manutencao.contratos.campos.slaHoras')"
              :max-bytes="3"
              data-testid="contrato-gerir-sla"
            />
            <SanteCampoTexto
              v-model="r.valorMensal"
              :rotulo="t('manutencao.contratos.campos.valorMensal')"
              :max-bytes="16"
              data-testid="contrato-gerir-valor"
            />
          </div>
          <fieldset class="bloco">
            <legend>{{ t('manutencao.contratos.campos.equipamentos') }}</legend>
            <div class="campos">
              <SanteCampoTexto
                v-model="termo"
                :rotulo="t('manutencao.os.filtro.buscarEquipamento')"
                :max-bytes="80"
                data-testid="contrato-gerir-termo"
                @keydown.enter.prevent="buscado = termo.trim()"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('manutencao.buscar')"
                data-testid="contrato-gerir-buscar"
                @acionar="buscado = termo.trim()"
              />
              <SanteSelecao
                v-model="paraAdicionar"
                :rotulo="t('manutencao.os.campos.equipamento')"
                :opcoes="opcoesEquipamento"
                busca
                data-testid="contrato-gerir-equipamento"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('manutencao.contratos.adicionarEquipamento')"
                data-testid="contrato-gerir-adicionar"
                @acionar="adicionar"
              />
            </div>
            <p v-if="r.equipamentos.length === 0" class="secundario">
              {{ t('manutencao.contratos.nenhumEquipamento') }}
            </p>
            <ul v-else class="historico" data-testid="contrato-gerir-equipamentos">
              <li v-for="(id, i) in r.equipamentos" :key="id">
                {{ nomeEquipamento(id) }}
                <SanteBotao
                  variante="texto"
                  :rotulo="t('manutencao.contratos.remover')"
                  :data-testid="`contrato-gerir-remover-${id}`"
                  @acionar="r.equipamentos.splice(i, 1)"
                />
              </li>
            </ul>
          </fieldset>
        </template>
        <div v-else-if="modo === 'encerrar'" class="campos">
          <SanteData
            v-model="data"
            editavel
            :rotulo="t('manutencao.contratos.gestao.dataEncerramento')"
            data-testid="contrato-gerir-data"
          />
        </div>
        <SanteCampoTexto
          v-model="motivo"
          multilinha
          obrigatorio
          :rotulo="t('manutencao.motivo')"
          :max-bytes="400"
          data-testid="contrato-gerir-motivo"
        />
        <ul
          v-if="listaProblemas.length > 0"
          class="vencido"
          role="alert"
          data-testid="contrato-gerir-problemas"
        >
          <li v-for="x in listaProblemas" :key="x">{{ x }}</li>
        </ul>
        <ErroManutencao v-if="erro" :erro="erro" />
        <div v-if="dependentes.length > 0" class="bloco" data-testid="contrato-gerir-dependentes">
          <p>{{ t('manutencao.contratos.gestao.dependentes') }}</p>
          <ul>
            <li v-for="d in dependentes" :key="d.rotulo">{{ d.rotulo }}: {{ d.quantidade }}</li>
          </ul>
          <SanteBotao
            variante="secundario"
            :rotulo="t('manutencao.contratos.gestao.encerrarEmVez')"
            data-testid="contrato-gerir-encerrar-em-vez"
            @acionar="encerrarEmVez"
          />
        </div>
        <div class="acoes">
          <SanteBotao
            v-if="modo === 'excluir'"
            variante="destrutivo"
            :rotulo="t('manutencao.contratos.gestao.gravarExcluir')"
            :confirmacao="t('manutencao.contratos.gestao.confirmarExcluir', { numero: atual.numero })"
            :desabilitado="gravando || !apoio.gravacao.ligada"
            data-testid="contrato-gerir-gravar"
            @acionar="enviar"
          />
          <SanteBotao
            v-else
            tipo="submit"
            :rotulo="
              t(`manutencao.contratos.gestao.${modo === 'alterar' ? 'gravarAlterar' : 'gravarEncerrar'}`)
            "
            :desabilitado="gravando || !apoio.gravacao.ligada"
            data-testid="contrato-gerir-gravar"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('manutencao.cancelar')"
            data-testid="contrato-gerir-cancelar"
            @acionar="emit('cancelar')"
          />
        </div>
      </form>
      <h4>{{ t('manutencao.contratos.gestao.versoes') }}</h4>
      <p v-if="atual.versoes.length === 0">{{ t('manutencao.contratos.gestao.nenhumaVersao') }}</p>
      <ul v-else class="historico" data-testid="contrato-versoes">
        <li v-for="v in atual.versoes" :key="v.versao" :data-testid="`contrato-versao-${v.versao}`">
          {{ t('manutencao.contratos.gestao.versao', { versao: v.versao }) }}
          ({{ t(`manutencao.contratos.gestao.operacao.${v.operacao}`) }}):
          {{ t('manutencao.contratos.vigencia', { inicio: dataBr(v.inicio), fim: dataBr(v.fim) }) }} -
          {{ t('manutencao.contratos.gestao.equipamentosDaVersao', { n: v.equipamentos.length }) }}
          <template v-if="v.slaHoras !== null">
            - {{ t('manutencao.contratos.gestao.slaDaVersao', { h: v.slaHoras }) }}</template
          >
          <template v-if="v.valorMensal !== null"> - {{ reais(v.valorMensal) }}</template>
          ({{ t('manutencao.contratos.gestao.motivoDe') }}: {{ v.motivo }} - {{ v.por }}, {{ dataBr(v.em) }})
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
