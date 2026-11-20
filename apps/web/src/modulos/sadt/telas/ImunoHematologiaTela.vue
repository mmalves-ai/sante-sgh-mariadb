<script setup lang="ts">
// Imuno-hematologia e prova cruzada (M47, etapa 2; ficha, seção 7 e regras 3 e 6; construída e desligada pela chave da
// agência completa até a DP-21): as requisições abertas com a amostra; a requisição aberta mostra a tipagem que vale
// para a transfusão (a liberada pela agência prevalece sobre a do cadastro, que é só ponto de partida; duas que
// discordam bloqueiam), os resultados do paciente e as provas cruzadas; o registro digitado da tipagem ABO e Rh (prova
// direta e reversa em cruzes, a interpretação na hora), da pesquisa de anticorpos e da prova cruzada da bolsa do
// estoque, ligado ao exame do laboratório já lançado na conta quando houver; a fila "a liberar" (a dupla conferência:
// quem registrou não libera) com a liberação e a invalidação. Combos com busca (ADR 0027).
import {
  CODIGOS_METODO_IMUNO,
  ESTADOS_IMUNO,
  METODOS_IMUNO,
  RESULTADOS_PAI,
  RESULTADOS_PROVA_CRUZADA,
  rotuloTipagem,
  TIPOS_EXAME_IMUNO,
  type ImunoHematologiaLida,
  type MetodoImuno,
  type TipoExameImuno,
} from '@sgh/contratos';
import { interpretarAboRh } from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type DetalheAgencia,
  invalidarImuno,
  lerDetalheAgencia,
  lerImunos,
  lerRequisicoesAbertas,
  liberarImuno,
  registrarImuno,
} from '../api-agencia.js';
import ErroTransfusao from '../componentes/ErroTransfusao.vue';
import { novaChave } from '../../enfermagem/api-enfermagem.js';

const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`sadt.agencia.${k}`, p ?? {});
const hora = (x: string | null) => (x ? x.slice(0, 16).replace('T', ' ') : '—');
const rotuloEstado = (c: string) => ESTADOS_IMUNO.find((x) => x.codigo === c)?.rotulo ?? c;
const rotuloTipo = (c: TipoExameImuno) => TIPOS_EXAME_IMUNO.find((x) => x.codigo === c)?.rotulo ?? c;

const abertas = useQuery({ queryKey: ['agencia', 'abertas'], queryFn: () => lerRequisicoesAbertas() });
const fila = useQuery({ queryKey: ['agencia', 'fila'], queryFn: () => lerImunos({ estado: 'registrado' }) });
const gravacao = computed(() => abertas.data.value?.gravacao ?? fila.data.value?.gravacao ?? null);

const chaves: Record<string, string> = {};
const chaveDe = (acao: string) => (chaves[acao] ??= novaChave(`agencia-${acao}`));
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const detalhe = ref<DetalheAgencia | null>(null);
async function abrir(id: number): Promise<void> {
  erro.value = null;
  try {
    detalhe.value = await lerDetalheAgencia(id);
  } catch (x) {
    erro.value = x;
  }
}
async function recarregar(): Promise<void> {
  await Promise.all([abertas.refetch(), fila.refetch()]);
  if (detalhe.value) await abrir(detalhe.value.requisicao.id);
}

const origem = computed(() => {
  const r = detalhe.value?.receptor;
  if (!r) return '';
  return r.origem === 'agencia'
    ? T('imuno.origemAgencia')
    : r.origem === 'cadastro'
      ? T('imuno.origemCadastro')
      : T('imuno.origemNenhuma');
});

// ── O registro ─────────────────────────────────────────────────────────────────────────────────────
const GRAUS = [0, 1, 2, 3, 4].map((n) => ({
  valor: String(n),
  rotulo: t('sadt.agencia.imuno.cruzes', { n }),
}));
const form = reactive({
  tipo: 'aboRh' as TipoExameImuno,
  metodo: 'gelTeste' as MetodoImuno,
  exameLancado: '',
  observacao: '',
  antiA: '0',
  antiB: '0',
  antiD: '0',
  controle: '0',
  hemaciaA1: '0',
  hemaciaB: '0',
  pai: 'negativo',
  anticorpos: '',
  bolsa: '',
  prova: 'compativel',
  faseAntiglobulina: 'sim',
});
const opcoesTipo = TIPOS_EXAME_IMUNO.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesMetodo = METODOS_IMUNO.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesPai = RESULTADOS_PAI.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesProva = RESULTADOS_PROVA_CRUZADA.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesSimNao = computed(() => [
  { valor: 'sim', rotulo: T('imuno.sim') },
  { valor: 'nao', rotulo: T('imuno.nao') },
]);
const opcoesExame = computed(() => [
  { valor: '', rotulo: T('imuno.semExameLancado') },
  ...(detalhe.value?.exames ?? []).map((x) => ({
    valor: String(x.id),
    rotulo: `${x.nome} · ${x.data ?? ''}`,
  })),
]);
const opcoesBolsa = computed(() => [
  ...(detalhe.value?.reservadas ?? []).map((b) => ({
    valor: b.numero,
    rotulo: `${b.numero} · ${rotuloTipagem(b.tipagem)}`,
  })),
  ...(detalhe.value?.candidatas ?? []).map((b) => ({
    valor: b.numero,
    rotulo: `${b.numero} · ${rotuloTipagem(b.tipagem)} · ${T('validade')} ${hora(b.validade)}${b.compativel ? '' : ` · ${T('imuno.incompativelAgora')}`}`,
  })),
]);
const interpretacao = computed(() => {
  if (form.tipo !== 'aboRh') return null;
  const i = interpretarAboRh(
    {
      antiA: Number(form.antiA),
      antiB: Number(form.antiB),
      antiD: Number(form.antiD),
      controle: Number(form.controle),
    },
    { hemaciaA1: Number(form.hemaciaA1), hemaciaB: Number(form.hemaciaB) },
  );
  return i.tipagem ? rotuloTipagem(i.tipagem) : i.problemas.join(', ');
});
const pronto = computed(
  () =>
    !!detalhe.value &&
    !!gravacao.value?.acoes.registrar &&
    CODIGOS_METODO_IMUNO.includes(form.metodo) &&
    (form.tipo !== 'provaCruzada' || !!form.bolsa) &&
    !ocupado.value,
);
async function registrar(): Promise<void> {
  const d = detalhe.value;
  if (!d) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  avisos.value = [];
  const comum = {
    paciente: d.requisicao.paciente.id,
    requisicao: d.requisicao.id,
    metodo: form.metodo,
    origem: 'digitado' as const,
    exameLancado: form.exameLancado ? Number(form.exameLancado) : null,
    observacao: form.observacao.trim() || null,
  };
  const e =
    form.tipo === 'aboRh'
      ? {
          tipo: 'aboRh' as const,
          ...comum,
          direta: {
            antiA: Number(form.antiA),
            antiB: Number(form.antiB),
            antiD: Number(form.antiD),
            controle: Number(form.controle),
          },
          reversa: { hemaciaA1: Number(form.hemaciaA1), hemaciaB: Number(form.hemaciaB) },
        }
      : form.tipo === 'pai'
        ? {
            tipo: 'pai' as const,
            ...comum,
            resultado: form.pai as 'negativo' | 'positivo',
            anticorpos: form.pai === 'positivo' ? form.anticorpos.trim() || null : null,
          }
        : {
            tipo: 'provaCruzada' as const,
            ...comum,
            requisicao: d.requisicao.id,
            bolsa: form.bolsa.trim().toUpperCase(),
            resultado: form.prova as 'compativel' | 'incompativel',
            faseAntiglobulina: form.faseAntiglobulina === 'sim',
          };
  try {
    const acao = `imuno-${d.requisicao.id}-${form.tipo}-${form.bolsa}`;
    const r = await registrarImuno(e, chaveDe(acao));
    delete chaves[acao];
    mensagem.value = r.mensagem;
    avisos.value = r.problemas ?? [];
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── A liberação e a invalidação ────────────────────────────────────────────────────────────────────
const invalidarDe = ref<ImunoHematologiaLida | null>(null);
const motivo = ref('');
async function liberar(i: ImunoHematologiaLida): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await liberarImuno(i.id, chaveDe(`liberar-${i.id}`));
    mensagem.value = r.mensagem;
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function invalidar(): Promise<void> {
  const i = invalidarDe.value;
  if (!i) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await invalidarImuno(i.id, motivo.value.trim(), chaveDe(`invalidar-${i.id}`));
    mensagem.value = r.mensagem;
    invalidarDe.value = null;
    motivo.value = '';
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const resumoResultado = (i: ImunoHematologiaLida) =>
  i.tipo === 'aboRh'
    ? i.tipagem?.abo
      ? rotuloTipagem(i.tipagem)
      : T('imuno.origemNenhuma')
    : i.tipo === 'pai'
      ? (RESULTADOS_PAI.find((x) => x.codigo === i.pai)?.rotulo ?? '') +
        (i.anticorpos ? ` (${i.anticorpos})` : '')
      : `${i.bolsa ?? ''} · ${RESULTADOS_PROVA_CRUZADA.find((x) => x.codigo === i.provaCruzada)?.rotulo ?? ''}`;
</script>

<template>
  <section class="tela-transfusao" aria-labelledby="ag-imuno-titulo" data-testid="tela-imuno">
    <h1 id="ag-imuno-titulo">{{ T('imuno.titulo') }}</h1>
    <SanteAlerta
      v-if="gravacao && !gravacao.ligada"
      variante="aviso"
      :texto="gravacao.motivo ?? T('desligada')"
      data-testid="ag-desligada"
    />
    <p v-if="mensagem" role="status" data-testid="ag-mensagem">{{ mensagem }}</p>
    <ul v-if="avisos.length" class="secundario" data-testid="ag-avisos">
      <li v-for="a in avisos" :key="a">{{ a }}</li>
    </ul>
    <ErroTransfusao v-if="erro" :erro="erro" />

    <section aria-labelledby="ag-abertas">
      <h2 id="ag-abertas">{{ T('imuno.requisicoes') }}</h2>
      <ErroTransfusao v-if="abertas.isError.value" :erro="abertas.error.value" />
      <p v-else-if="!abertas.data.value" role="status">{{ T('carregando') }}</p>
      <p v-else-if="abertas.data.value.itens.length === 0">{{ T('imuno.semRequisicoes') }}</p>
      <table v-else class="tabela" data-testid="ag-requisicoes">
        <caption class="sr">
          {{
            T('imuno.requisicoes')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('paciente') }}</th>
            <th scope="col">{{ T('hemocomponente') }}</th>
            <th scope="col">{{ T('situacao') }}</th>
            <th scope="col">{{ T('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in abertas.data.value.itens" :key="r.id" :data-testid="`ag-req-${r.id}`">
            <td>{{ r.paciente.nome }} · {{ T('prontuario', { n: r.paciente.prontuario ?? '—' }) }}</td>
            <td>{{ r.hemocomponente.rotulo }} · {{ r.quantidadeBolsas }}</td>
            <td>
              {{
                r.amostra
                  ? T('imuno.amostra', { c: r.amostra.codigo, v: hora(r.amostra.validaAte) })
                  : T('imuno.semAmostra')
              }}
            </td>
            <td>
              <SanteBotao
                :rotulo="T('imuno.abrir')"
                :data-testid="`ag-abrir-${r.id}`"
                @acionar="abrir(r.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="detalhe" class="cartao" aria-labelledby="ag-detalhe" data-testid="ag-detalhe">
      <h2 id="ag-detalhe">
        {{ detalhe.requisicao.paciente.nome }} · {{ detalhe.requisicao.hemocomponente.rotulo }}
      </h2>
      <p data-testid="ag-receptor">
        <strong>{{ T('imuno.receptor') }}:</strong>
        {{ rotuloTipagem(detalhe.receptor.tipagem) }} ({{ origem }})
      </p>
      <SanteAlerta
        v-if="detalhe.receptor.divergente"
        variante="alerta"
        :texto="T('imuno.divergente')"
        data-testid="ag-divergente"
      />
      <p v-if="detalhe.receptor.pai" class="secundario" data-testid="ag-pai">
        {{
          detalhe.receptor.pai === 'positivo'
            ? T('imuno.paiPositivo', { a: detalhe.receptor.anticorpos ?? '' })
            : T('imuno.paiNegativo')
        }}
      </p>

      <h3>{{ T('imuno.resultados') }}</h3>
      <p v-if="detalhe.resultados.length === 0 && detalhe.provas.length === 0">
        {{ T('imuno.semResultados') }}
      </p>
      <table v-else class="tabela" data-testid="ag-resultados">
        <caption class="sr">
          {{
            T('imuno.resultados')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('imuno.exame') }}</th>
            <th scope="col">{{ T('tipagem') }}</th>
            <th scope="col">{{ T('situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="i in [...detalhe.resultados, ...detalhe.provas]"
            :key="i.id"
            :data-testid="`ag-resultado-${i.id}`"
          >
            <td>{{ rotuloTipo(i.tipo) }}</td>
            <td>{{ resumoResultado(i) }}</td>
            <td>
              {{ rotuloEstado(i.estado) }} ·
              {{
                i.liberadoPor
                  ? T('imuno.liberadoPor', { p: i.liberadoPor, e: hora(i.liberadoEm) })
                  : T('imuno.registradoPor', { p: i.registradoPor, e: hora(i.registradoEm) })
              }}
            </td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="gravacao?.acoes.registrar"
        aria-labelledby="ag-novo"
        data-testid="ag-form"
        @submit.prevent="registrar"
      >
        <h3 id="ag-novo">{{ T('imuno.novo') }}</h3>
        <p class="secundario">{{ T('imuno.equipamento') }}</p>
        <div class="barra">
          <SanteSelecao
            v-model="form.tipo"
            :rotulo="T('imuno.tipoExame')"
            :opcoes="opcoesTipo"
            data-testid="ag-tipo"
          />
          <SanteSelecao
            v-model="form.metodo"
            :rotulo="T('imuno.metodo')"
            :opcoes="opcoesMetodo"
            data-testid="ag-metodo"
          />
          <SanteSelecao
            v-model="form.exameLancado"
            :rotulo="T('imuno.exameLancado')"
            :opcoes="opcoesExame"
            :busca="true"
            data-testid="ag-exame-lancado"
          />
        </div>
        <template v-if="form.tipo === 'aboRh'">
          <fieldset class="barra">
            <legend>{{ T('imuno.direta') }}</legend>
            <SanteSelecao
              v-model="form.antiA"
              :rotulo="T('imuno.antiA')"
              :opcoes="GRAUS"
              data-testid="ag-anti-a"
            />
            <SanteSelecao
              v-model="form.antiB"
              :rotulo="T('imuno.antiB')"
              :opcoes="GRAUS"
              data-testid="ag-anti-b"
            />
            <SanteSelecao
              v-model="form.antiD"
              :rotulo="T('imuno.antiD')"
              :opcoes="GRAUS"
              data-testid="ag-anti-d"
            />
            <SanteSelecao
              v-model="form.controle"
              :rotulo="T('imuno.controle')"
              :opcoes="GRAUS"
              data-testid="ag-controle"
            />
          </fieldset>
          <fieldset class="barra">
            <legend>{{ T('imuno.reversa') }}</legend>
            <SanteSelecao
              v-model="form.hemaciaA1"
              :rotulo="T('imuno.hemaciaA1')"
              :opcoes="GRAUS"
              data-testid="ag-a1"
            />
            <SanteSelecao
              v-model="form.hemaciaB"
              :rotulo="T('imuno.hemaciaB')"
              :opcoes="GRAUS"
              data-testid="ag-b"
            />
          </fieldset>
          <p role="status" data-testid="ag-interpretacao">
            {{ T('imuno.interpretacao', { t: interpretacao }) }}
          </p>
        </template>
        <div v-else-if="form.tipo === 'pai'" class="barra">
          <SanteSelecao
            v-model="form.pai"
            :rotulo="T('imuno.resultadoPai')"
            :opcoes="opcoesPai"
            data-testid="ag-pai-resultado"
          />
          <SanteCampoTexto
            v-if="form.pai === 'positivo'"
            id="ag-anticorpos"
            v-model="form.anticorpos"
            :rotulo="T('imuno.anticorpos')"
            :max-bytes="200"
          />
        </div>
        <div v-else class="barra">
          <SanteSelecao
            v-model="form.bolsa"
            :rotulo="T('imuno.bolsa')"
            :opcoes="opcoesBolsa"
            :busca="true"
            data-testid="ag-bolsa"
          />
          <SanteSelecao
            v-model="form.prova"
            :rotulo="T('imuno.resultadoProva')"
            :opcoes="opcoesProva"
            data-testid="ag-prova"
          />
          <SanteSelecao
            v-model="form.faseAntiglobulina"
            :rotulo="T('imuno.faseAntiglobulina')"
            :opcoes="opcoesSimNao"
            data-testid="ag-fase-agh"
          />
        </div>
        <SanteCampoTexto id="ag-obs" v-model="form.observacao" :rotulo="T('observacao')" :max-bytes="500" />
        <div class="barra">
          <SanteBotao tipo="submit" :rotulo="T('gravar')" :desabilitado="!pronto" data-testid="ag-gravar" />
          <SanteBotao variante="texto" :rotulo="T('fechar')" @acionar="detalhe = null" />
        </div>
      </form>
    </section>

    <section aria-labelledby="ag-fila">
      <h2 id="ag-fila">{{ T('imuno.filaLiberar') }}</h2>
      <ErroTransfusao v-if="fila.isError.value" :erro="fila.error.value" />
      <p v-else-if="!fila.data.value" role="status">{{ T('carregando') }}</p>
      <p v-else-if="fila.data.value.itens.length === 0">{{ T('imuno.semFila') }}</p>
      <table v-else class="tabela" data-testid="ag-fila">
        <caption class="sr">
          {{
            T('imuno.filaLiberar')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ T('imuno.exame') }}</th>
            <th scope="col">{{ T('tipagem') }}</th>
            <th scope="col">{{ T('situacao') }}</th>
            <th scope="col">{{ T('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in fila.data.value.itens" :key="i.id" :data-testid="`ag-fila-${i.id}`">
            <td>{{ rotuloTipo(i.tipo) }} · {{ i.amostra ?? '' }}</td>
            <td>{{ resumoResultado(i) }}</td>
            <td>{{ T('imuno.registradoPor', { p: i.registradoPor, e: hora(i.registradoEm) }) }}</td>
            <td class="acoes">
              <SanteBotao
                v-if="gravacao?.acoes.liberar"
                :rotulo="T('imuno.liberar')"
                :desabilitado="ocupado"
                :data-testid="`ag-liberar-${i.id}`"
                @acionar="liberar(i)"
              />
              <SanteBotao
                v-if="gravacao?.acoes.liberar"
                variante="texto"
                :rotulo="T('imuno.invalidar')"
                :data-testid="`ag-invalidar-${i.id}`"
                @acionar="invalidarDe = i"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <form v-if="invalidarDe" class="cartao" data-testid="ag-form-invalidar" @submit.prevent="invalidar">
      <SanteCampoTexto
        id="ag-motivo-invalidar"
        v-model="motivo"
        :rotulo="T('imuno.motivoInvalidacao')"
        :max-bytes="300"
      />
      <div class="barra">
        <SanteBotao
          tipo="submit"
          :rotulo="T('imuno.invalidar')"
          :desabilitado="motivo.trim().length < 5 || ocupado"
          data-testid="ag-confirmar-invalidar"
        />
        <SanteBotao variante="texto" :rotulo="T('cancelar')" @acionar="invalidarDe = null" />
      </div>
    </form>
  </section>
</template>

<style src="./estilo-transfusao.css"></style>
