<script setup lang="ts">
// Aba "De-para" (M53.9, etapa F8; consulta com `pessoas.integracao.ler`, gravar com `pessoas.integracao.configurar`;
// ficha do M53, seção 4): para cada destino da folha, o credor (busca por nome ou código) e a classificação gerencial
// (com busca, ADR 0027) do título a pagar, o vencimento dos encargos (dia, no mês da folha ou no seguinte) e a conta
// contábil sugerida à controladoria. Sem vigência, a classificação vem sugerida pelo perfil do contas a pagar. Cada
// gravação é uma vigência nova e completa; as anteriores ficam na lista. O servidor confere tudo de novo.
import type { ApoioIntegracaoFolha, CredorFolha } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import { instanteBr } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { buscarCredores, gravarDePara, lerDePara } from './api-integracao.js';
import {
  ehLiquido,
  entradaDePara,
  type LinhaDePara,
  linhaCompleta,
  linhasDePara,
  opcoesClassificacao,
} from './comum-integracao.js';

const props = defineProps<{ apoio: ApoioIntegracaoFolha; empresa: number; podeConfigurar: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();

const linhas = ref<LinhaDePara[]>(linhasDePara(props.apoio));
watch(
  () => props.apoio,
  (a) => (linhas.value = linhasDePara(a)),
);
const classificacoes = computed(() => opcoesClassificacao(props.apoio.classificacoes));
const nomeClassificacao = computed(() => new Map(classificacoes.value.map((o) => [o.valor, o.rotulo])));
const rotinaNome = computed(() => new Map(props.apoio.rotinas.map((r) => [r.id, r.nome])));
const vencimento = (l: LinhaDePara) =>
  ehLiquido(l.destino)
    ? t('folha.integracao.dePara.venceNoPagamento')
    : t('folha.integracao.dePara.venceDia', {
        dia: l.diaVencimento,
        quando:
          l.mesesDepois === 0
            ? t('folha.integracao.dePara.mesmoMes')
            : t('folha.integracao.dePara.mesSeguinte'),
      });

const historico = useQuery({
  queryKey: computed(() => ['folha', 'integracao', 'de-para', props.empresa]),
  queryFn: () => lerDePara(props.empresa),
});
const anteriores = computed(() =>
  (historico.data.value ?? []).filter((v) => v.id !== props.apoio.vigente?.id),
);

// ── Editar um destino ─────────────────────────────────────────────────────────────────────────────────────────
const editando = ref<LinhaDePara | null>(null);
const edicao = ref<LinhaDePara | null>(null);
const visivel = ref(false);
const termo = ref('');
const achados = ref<CredorFolha[] | null>(null);
const erroBusca = ref<unknown>(null);
const opcoesCredor = computed(() => {
  const e = edicao.value;
  const xs = [...(achados.value ?? [])];
  if (e?.credor != null && !xs.some((c) => c.codigo === e.credor))
    xs.unshift({ codigo: e.credor, nome: e.credorNome });
  return xs.map((c) => ({ valor: c.codigo, rotulo: c.nome ? `${c.codigo} — ${c.nome}` : String(c.codigo) }));
});
const opcoesDia = Array.from({ length: 31 }, (_, i) => ({ valor: i + 1, rotulo: String(i + 1) }));
const opcoesMeses = computed(() => [
  { valor: 0, rotulo: t('folha.integracao.dePara.mesmoMes') },
  { valor: 1, rotulo: t('folha.integracao.dePara.mesSeguinte') },
]);
function editar(l: LinhaDePara): void {
  editando.value = l;
  edicao.value = { ...l };
  termo.value = '';
  achados.value = null;
  erroBusca.value = null;
  visivel.value = true;
}
async function buscar(): Promise<void> {
  if (termo.value.trim().length < 2) return;
  erroBusca.value = null;
  try {
    achados.value = [...(await buscarCredores(termo.value.trim())).itens];
  } catch (x) {
    erroBusca.value = x;
  }
}
function aplicar(): void {
  const e = edicao.value;
  if (!e || !editando.value) return;
  e.credorNome =
    achados.value?.find((c) => c.codigo === e.credor)?.nome ??
    (e.credor === editando.value.credor ? editando.value.credorNome : '');
  e.sugerida = e.sugerida && e.classificacao === editando.value.classificacao;
  linhas.value = linhas.value.map((l) => (l.destino === e.destino ? e : l));
  visivel.value = false;
}

// ── Gravar a vigência ─────────────────────────────────────────────────────────────────────────────────────────
const inicio = ref<string | null>(props.apoio.hoje);
const entrada = computed(() => entradaDePara(props.empresa, inicio.value, linhas.value));
const faltam = computed(() => linhas.value.some((l) => l.financeiro && !linhaCompleta(l)));
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function gravar(): Promise<void> {
  if (!entrada.value) return;
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    const v = await gravarDePara(entrada.value);
    aviso.value = t('folha.integracao.dePara.gravado', { inicio: dataBr(v.inicio) });
    await cliente.invalidateQueries({ queryKey: ['folha', 'integracao'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.integracao.abas.dePara')" data-testid="integracao-de-para">
    <h2>{{ t('folha.integracao.abas.dePara') }}</h2>
    <p class="secundario">{{ t('folha.integracao.dePara.ajuda') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso"
      variante="info"
      anunciar
      data-testid="integracao-de-para-gravado"
    />
    <p v-if="apoio.vigente" data-testid="integracao-de-para-vigente">
      {{
        t('folha.integracao.dePara.vigente', {
          inicio: dataBr(apoio.vigente.inicio),
          por: apoio.vigente.criadoPor,
          em: instanteBr(apoio.vigente.criadoEm),
        })
      }}
    </p>
    <SanteAlerta
      v-else
      :texto="t('folha.integracao.dePara.semVigente')"
      variante="info"
      data-testid="integracao-de-para-sem-vigente"
    />
    <div class="rolagem" tabindex="0" role="region" :aria-label="t('folha.integracao.abas.dePara')">
      <table class="tabela" data-testid="integracao-de-para-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.integracao.dePara.destino') }}</th>
            <th scope="col">{{ t('folha.integracao.dePara.rotina') }}</th>
            <th scope="col">{{ t('folha.integracao.dePara.credor') }}</th>
            <th scope="col">{{ t('folha.integracao.dePara.classificacao') }}</th>
            <th scope="col">{{ t('folha.integracao.dePara.vencimento') }}</th>
            <th scope="col">{{ t('folha.integracao.dePara.contaContabil') }}</th>
            <th v-if="podeConfigurar" scope="col">{{ t('folha.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in linhas" :key="l.destino" :data-testid="`integracao-de-para-${l.destino}`">
            <th scope="row">{{ t(`folha.integracao.destinos.${l.destino}`) }}</th>
            <td>
              {{ l.rotina }} — {{ rotinaNome.get(l.rotina) ?? '' }}
              <span
                v-if="!l.financeiro"
                class="secundario"
                :data-testid="`integracao-sem-financeiro-${l.destino}`"
                >({{ t('folha.integracao.dePara.semFinanceiro') }})</span
              >
            </td>
            <td>
              <template v-if="l.credor !== null">
                {{ l.credor }}<span v-if="l.credorNome"> — {{ l.credorNome }}</span>
              </template>
              <span v-else-if="l.financeiro" class="secundario">{{
                t('folha.integracao.dePara.incompleta')
              }}</span>
            </td>
            <td>
              {{ nomeClassificacao.get(l.classificacao) ?? l.classificacao }}
              <span v-if="l.sugerida" class="secundario">({{ t('folha.integracao.dePara.sugerida') }})</span>
            </td>
            <td>{{ vencimento(l) }}</td>
            <td>{{ l.contaContabil }}</td>
            <td v-if="podeConfigurar" class="acoes">
              <SanteBotao
                v-if="l.financeiro"
                :rotulo="t('folha.integracao.dePara.editar')"
                variante="secundario"
                :data-testid="`integracao-de-para-editar-${l.destino}`"
                @acionar="editar(l)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form v-if="podeConfigurar" class="bloco" data-testid="integracao-de-para-form" @submit.prevent="gravar">
      <ErroFolha v-if="erro" :erro="erro" />
      <p v-if="faltam" class="secundario" data-testid="integracao-de-para-faltam">
        {{ t('folha.integracao.dePara.faltam') }}
      </p>
      <div class="campos">
        <SanteData
          v-model="inicio"
          :rotulo="t('folha.integracao.dePara.inicio')"
          editavel
          data-testid="integracao-de-para-inicio"
        />
      </div>
      <SanteBotao
        :rotulo="t('folha.integracao.dePara.gravar')"
        tipo="submit"
        :desabilitado="ocupado || !entrada"
        data-testid="integracao-de-para-gravar"
      />
    </form>

    <template v-if="anteriores.length">
      <h3>{{ t('folha.integracao.dePara.historico') }}</h3>
      <ul class="lista" data-testid="integracao-de-para-historico">
        <li v-for="v in anteriores" :key="v.id">
          {{ dataBr(v.inicio) }} · {{ t('folha.integracao.dePara.destinos', { n: v.destinos.length }) }} ·
          {{ t('folha.integracao.lancamentos.porEm', { por: v.criadoPor, em: instanteBr(v.criadoEm) }) }}
        </li>
      </ul>
    </template>

    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="
        edicao
          ? t('folha.integracao.dePara.editarTitulo', {
              destino: t(`folha.integracao.destinos.${edicao.destino}`),
            })
          : ''
      "
      largura="48rem"
    >
      <form v-if="edicao" data-testid="integracao-de-para-edicao" @submit.prevent="aplicar">
        <div class="campos">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('folha.integracao.dePara.buscarCredor')"
            :max-bytes="60"
            data-testid="integracao-credor-termo"
          />
          <SanteBotao
            :rotulo="t('folha.integracao.dePara.buscar')"
            variante="secundario"
            :desabilitado="termo.trim().length < 2"
            data-testid="integracao-credor-buscar"
            @acionar="buscar"
          />
        </div>
        <ErroFolha v-if="erroBusca" :erro="erroBusca" />
        <p v-if="achados && achados.length === 0" role="status" data-testid="integracao-credor-nenhum">
          {{ t('folha.integracao.dePara.nenhumCredor') }}
        </p>
        <div class="campos">
          <SanteSelecao
            v-model="edicao.credor"
            :rotulo="t('folha.integracao.dePara.credor')"
            :opcoes="opcoesCredor"
            busca
            data-testid="integracao-credor"
          />
          <SanteSelecao
            v-model="edicao.classificacao"
            :rotulo="t('folha.integracao.dePara.classificacao')"
            :opcoes="classificacoes"
            busca
            data-testid="integracao-classificacao"
          />
        </div>
        <div v-if="!ehLiquido(edicao.destino)" class="campos">
          <SanteSelecao
            v-model="edicao.diaVencimento"
            :rotulo="t('folha.integracao.dePara.dia')"
            :opcoes="opcoesDia"
            data-testid="integracao-dia"
          />
          <SanteSelecao
            v-model="edicao.mesesDepois"
            :rotulo="t('folha.integracao.dePara.meses')"
            :opcoes="opcoesMeses"
            data-testid="integracao-meses"
          />
        </div>
        <p v-else class="secundario">
          {{ t('folha.integracao.dePara.vencimento') }}: {{ t('folha.integracao.dePara.venceNoPagamento') }}
        </p>
        <SanteCampoTexto
          v-model="edicao.contaContabil"
          :rotulo="t('folha.integracao.dePara.contaContabil')"
          :max-bytes="20"
          data-testid="integracao-conta-contabil"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.integracao.dePara.aplicar')"
            tipo="submit"
            data-testid="integracao-de-para-aplicar"
          />
          <SanteBotao :rotulo="t('folha.cancelar')" variante="secundario" @acionar="visivel = false" />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
