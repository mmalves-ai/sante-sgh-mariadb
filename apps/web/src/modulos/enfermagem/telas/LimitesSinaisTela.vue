<script setup lang="ts">
// 03-PEP linha 115 (C2-003): limites de alerta dos sinais vitais. Ativos e inativos (o histórico nunca é apagado:
// inativar pede motivo); incluir um limite por abrangência, setor, instrumento, sexo e faixa etária, com a ordem das
// faixas conferida na hora; o padrão do adulto pelo NEWS2 num clique; e a regra do parâmetro no setor (exigir local
// ou posição). Gravar pede a permissão enfermagem.limiteSinal.editar; sem ela, a tela é só consulta.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  aplicarPadraoNews2,
  gravarRegraSetor,
  inativarLimite,
  incluirLimite,
  lerCatalogosAfericao,
  lerLimites,
  type LimiteSinal,
} from '../api-sinais-detalhe.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('enfermagem.limiteSinal.editar'));

const catalogos = useQuery({
  queryKey: ['enfermagem', 'afericao', 'catalogos'],
  queryFn: () => lerCatalogosAfericao(),
});
const dados = useQuery({ queryKey: ['enfermagem', 'limites-sinais'], queryFn: () => lerLimites() });
const ativos = computed(() => (dados.data.value?.limites ?? []).filter((l) => l.ativo));
const inativos = computed(() => (dados.data.value?.limites ?? []).filter((l) => !l.ativo));

const opcoesParametro = computed(() =>
  (catalogos.data.value?.parametros ?? []).map((p) => ({ valor: p.codigo, rotulo: p.descricao })),
);
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('enfermagem.sinaisDetalhe.limites.todosSetores') },
  ...(catalogos.data.value?.setores ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
]);
const opcoesSetorRegra = computed(() => opcoesSetor.value.slice(1));
const opcoesAbrangencia = computed(() => [
  { valor: 'estabelecimento', rotulo: t('enfermagem.sinaisDetalhe.limites.abrEstabelecimento') },
  { valor: 'cliente', rotulo: t('enfermagem.sinaisDetalhe.limites.abrCliente') },
]);
const opcoesSexo = computed(() =>
  (['ambos', 'feminino', 'masculino'] as const).map((s) => ({
    valor: s,
    rotulo: t(`enfermagem.sinaisDetalhe.limites.sexos.${s}`),
  })),
);

const num = (s: string): number | null => {
  const v = Number(s.replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(v) ? v : null;
};
const ANO = 365;

// Novo limite.
const novo = ref({
  parametro: '',
  abrangencia: 'estabelecimento' as 'cliente' | 'estabelecimento',
  setor: '',
  instrumento: '',
  sexo: 'ambos' as 'ambos' | 'feminino' | 'masculino',
  idadeMinima: '',
  idadeMaxima: '',
  limiteInferior: '',
  normalInferior: '',
  normalSuperior: '',
  limiteSuperior: '',
});
const opcoesInstrumento = computed(() => [
  { valor: '', rotulo: t('enfermagem.sinaisDetalhe.limites.qualquerInstrumento') },
  ...(catalogos.data.value?.instrumentos ?? [])
    .filter((i) => i.parametro === null || i.parametro === novo.value.parametro)
    .map((i) => ({ valor: String(i.id), rotulo: i.descricao })),
]);
/** A ordem das faixas (crítico inferior ≤ normal inferior ≤ normal superior ≤ crítico superior), conferida na hora. */
const problemaNovo = computed<string | null>(() => {
  const n = novo.value;
  if (!n.parametro) return null;
  const faixas = [n.limiteInferior, n.normalInferior, n.normalSuperior, n.limiteSuperior].map(num);
  if (faixas.every((f) => f === null)) return t('enfermagem.sinaisDetalhe.limites.faixaVazia');
  const presentes = faixas.filter((f): f is number => f !== null);
  for (let i = 1; i < presentes.length; i++)
    if (presentes[i]! < presentes[i - 1]!) return t('enfermagem.sinaisDetalhe.limites.faixaFora');
  const iMin = num(n.idadeMinima) ?? 0;
  const iMax = num(n.idadeMaxima);
  if (iMax !== null && iMax < iMin) return t('enfermagem.sinaisDetalhe.limites.idadeInvertida');
  return null;
});
const ocupado = ref(false);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);

async function agir(acao: () => Promise<{ mensagem: string }>) {
  ocupado.value = true;
  erro.value = null;
  feito.value = null;
  try {
    feito.value = (await acao()).mensagem;
    await cliente.invalidateQueries({ queryKey: ['enfermagem', 'limites-sinais'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

function incluir() {
  const n = novo.value;
  if (!podeEditar.value || !n.parametro || problemaNovo.value) return;
  const iMax = num(n.idadeMaxima);
  void agir(async () => {
    const r = await incluirLimite({
      parametro: n.parametro,
      abrangencia: n.abrangencia,
      setor: n.setor ? Number(n.setor) : null,
      instrumento: n.instrumento ? Number(n.instrumento) : null,
      sexo: n.sexo,
      idadeMinimaDias: Math.round((num(n.idadeMinima) ?? 0) * ANO),
      idadeMaximaDias: iMax === null ? null : Math.round(iMax * ANO),
      limiteInferior: num(n.limiteInferior),
      normalInferior: num(n.normalInferior),
      normalSuperior: num(n.normalSuperior),
      limiteSuperior: num(n.limiteSuperior),
    });
    n.limiteInferior = n.normalInferior = n.normalSuperior = n.limiteSuperior = '';
    return r;
  });
}

const news2 = () => agir(() => aplicarPadraoNews2());

// Inativação com motivo.
const inativando = ref<LimiteSinal | null>(null);
const motivo = ref('');
function inativar() {
  const l = inativando.value;
  if (!l || motivo.value.trim().length < 10) return;
  void agir(async () => {
    const r = await inativarLimite(l.id, l.versao, motivo.value.trim());
    inativando.value = null;
    motivo.value = '';
    return r;
  });
}

// Regra do parâmetro no setor.
const regra = ref({
  setor: '',
  parametro: '',
  exigeLocal: false,
  exigePosicao: false,
  obrigatorio: false,
  periodo: '',
});
function gravarRegra() {
  const g = regra.value;
  if (!podeEditar.value || !g.setor || !g.parametro) return;
  const existente = dados.data.value?.regras.find(
    (r) => String(r.setor) === g.setor && r.parametro === g.parametro,
  );
  const periodo = num(g.periodo);
  void agir(() =>
    gravarRegraSetor({
      setor: Number(g.setor),
      parametro: g.parametro,
      obrigatorio: g.obrigatorio,
      periodicidadeMinutos: periodo === null ? null : Math.round(periodo),
      exibeLocal: g.exigeLocal,
      exigeLocal: g.exigeLocal,
      exibePosicao: g.exigePosicao,
      exigePosicao: g.exigePosicao,
      ativo: true,
      versao: existente?.versao ?? null,
    }),
  );
}

const anos = (d: number | null) => (d === null ? '∞' : String(Math.round(d / ANO)));
const faixa = (v: number | null) => (v === null ? '—' : String(v));
</script>

<template>
  <section class="tela-enf" aria-labelledby="ls-titulo" data-testid="tela-limites-sinais">
    <h1 id="ls-titulo">{{ t('enfermagem.sinaisDetalhe.limites.titulo') }}</h1>
    <p class="ajuda">{{ t('enfermagem.sinaisDetalhe.limites.texto') }}</p>
    <SanteAlerta
      v-if="!podeEditar"
      variante="info"
      :texto="t('enfermagem.sinaisDetalhe.limites.semPermissao')"
    />
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <p v-if="feito" role="status" data-testid="ls-feito">{{ feito }}</p>

    <div v-if="podeEditar" class="barra">
      <SanteBotao
        :rotulo="t('enfermagem.sinaisDetalhe.limites.news2')"
        :desabilitado="ocupado"
        data-testid="ls-news2"
        @acionar="news2"
      />
      <span class="ajuda">{{ t('enfermagem.sinaisDetalhe.limites.news2Ajuda') }}</span>
    </div>

    <form v-if="podeEditar" class="cartao" data-testid="ls-novo" @submit.prevent="incluir">
      <h2>{{ t('enfermagem.sinaisDetalhe.limites.novo') }}</h2>
      <div class="linha">
        <SanteSelecao
          v-model="novo.parametro"
          :rotulo="t('enfermagem.sinaisDetalhe.parametro')"
          :opcoes="opcoesParametro"
          obrigatorio
          data-testid="ls-parametro"
        />
        <SanteSelecao
          v-model="novo.abrangencia"
          :rotulo="t('enfermagem.sinaisDetalhe.limites.abrangencia')"
          :opcoes="opcoesAbrangencia"
          data-testid="ls-abrangencia"
        />
        <SanteSelecao
          v-model="novo.setor"
          :rotulo="t('enfermagem.sinaisDetalhe.limites.setor')"
          :opcoes="opcoesSetor"
          data-testid="ls-setor"
        />
        <SanteSelecao
          v-model="novo.instrumento"
          :rotulo="t('enfermagem.sinaisDetalhe.instrumento')"
          :opcoes="opcoesInstrumento"
          data-testid="ls-instrumento"
        />
        <SanteSelecao
          v-model="novo.sexo"
          :rotulo="t('enfermagem.sinaisDetalhe.limites.sexo')"
          :opcoes="opcoesSexo"
          data-testid="ls-sexo"
        />
      </div>
      <div class="linha">
        <label>
          {{ t('enfermagem.sinaisDetalhe.limites.idadeMinima') }}
          <input v-model="novo.idadeMinima" inputmode="numeric" data-testid="ls-idade-min" />
        </label>
        <label>
          {{ t('enfermagem.sinaisDetalhe.limites.idadeMaxima') }}
          <input v-model="novo.idadeMaxima" inputmode="numeric" data-testid="ls-idade-max" />
        </label>
        <label>
          {{ t('enfermagem.sinaisDetalhe.limites.limiteInferior') }}
          <input v-model="novo.limiteInferior" inputmode="decimal" data-testid="ls-limite-inferior" />
        </label>
        <label>
          {{ t('enfermagem.sinaisDetalhe.limites.normalInferior') }}
          <input v-model="novo.normalInferior" inputmode="decimal" data-testid="ls-normal-inferior" />
        </label>
        <label>
          {{ t('enfermagem.sinaisDetalhe.limites.normalSuperior') }}
          <input v-model="novo.normalSuperior" inputmode="decimal" data-testid="ls-normal-superior" />
        </label>
        <label>
          {{ t('enfermagem.sinaisDetalhe.limites.limiteSuperior') }}
          <input v-model="novo.limiteSuperior" inputmode="decimal" data-testid="ls-limite-superior" />
        </label>
      </div>
      <p v-if="problemaNovo" class="alerta" data-testid="ls-problema">{{ problemaNovo }}</p>
      <SanteBotao
        tipo="submit"
        :rotulo="t('enfermagem.sinaisDetalhe.limites.incluir')"
        :desabilitado="ocupado || !novo.parametro || !!problemaNovo"
        data-testid="ls-incluir"
      />
    </form>

    <ErroEnfermagem v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <h2>{{ t('enfermagem.sinaisDetalhe.limites.ativos') }}</h2>
      <p v-if="ativos.length === 0">{{ t('enfermagem.sinaisDetalhe.limites.vazio') }}</p>
      <div v-else class="rolagem">
        <table class="grade" data-testid="ls-ativos">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.parametro') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.limites.setor') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.instrumento') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.limites.sexo') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.limites.idadeMinima') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.limites.limiteInferior') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.limites.normalInferior') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.limites.normalSuperior') }}</th>
              <th scope="col">{{ t('enfermagem.sinaisDetalhe.limites.limiteSuperior') }}</th>
              <th v-if="podeEditar" scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in ativos" :key="l.id" :data-testid="`ls-limite-${l.parametro}`">
              <td>{{ l.parametroDescricao }}</td>
              <td>{{ l.setorNome ?? t('enfermagem.sinaisDetalhe.limites.todosSetores') }}</td>
              <td>
                {{ l.instrumentoDescricao ?? t('enfermagem.sinaisDetalhe.limites.qualquerInstrumento') }}
              </td>
              <td>{{ t(`enfermagem.sinaisDetalhe.limites.sexos.${l.sexo}`) }}</td>
              <td>{{ `${anos(l.idadeMinimaDias)}–${anos(l.idadeMaximaDias)}` }}</td>
              <td>{{ faixa(l.limiteInferior) }}</td>
              <td>{{ faixa(l.normalInferior) }}</td>
              <td>{{ faixa(l.normalSuperior) }}</td>
              <td>{{ faixa(l.limiteSuperior) }}</td>
              <td v-if="podeEditar">
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('enfermagem.sinaisDetalhe.limites.inativar')"
                  :data-testid="`ls-inativar-${l.id}`"
                  @acionar="inativando = l"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form v-if="inativando" class="cartao" data-testid="ls-inativacao" @submit.prevent="inativar">
        <label>
          {{ t('enfermagem.sinaisDetalhe.limites.motivoInativar') }} — {{ inativando.parametroDescricao }}
          <input v-model="motivo" maxlength="300" data-testid="ls-motivo" />
        </label>
        <SanteBotao
          tipo="submit"
          :rotulo="t('enfermagem.sinaisDetalhe.limites.inativar')"
          :desabilitado="ocupado || motivo.trim().length < 10"
          data-testid="ls-confirmar-inativar"
        />
      </form>

      <details v-if="inativos.length" data-testid="ls-inativos">
        <summary>{{ t('enfermagem.sinaisDetalhe.limites.inativos') }} ({{ inativos.length }})</summary>
        <ul>
          <li v-for="l in inativos" :key="l.id">
            {{ l.parametroDescricao }} ·
            {{ l.setorNome ?? t('enfermagem.sinaisDetalhe.limites.todosSetores') }} ·
            {{ faixa(l.limiteInferior) }} / {{ faixa(l.normalInferior) }} / {{ faixa(l.normalSuperior) }} /
            {{ faixa(l.limiteSuperior) }}
          </li>
        </ul>
      </details>

      <form v-if="podeEditar" class="cartao" data-testid="ls-regra" @submit.prevent="gravarRegra">
        <h2>{{ t('enfermagem.sinaisDetalhe.limites.regras') }}</h2>
        <p class="ajuda">{{ t('enfermagem.sinaisDetalhe.limites.regrasTexto') }}</p>
        <div class="linha">
          <SanteSelecao
            v-model="regra.setor"
            :rotulo="t('enfermagem.sinaisDetalhe.limites.setor')"
            :opcoes="opcoesSetorRegra"
            obrigatorio
            data-testid="ls-regra-setor"
          />
          <SanteSelecao
            v-model="regra.parametro"
            :rotulo="t('enfermagem.sinaisDetalhe.parametro')"
            :opcoes="opcoesParametro"
            obrigatorio
            data-testid="ls-regra-parametro"
          />
          <label
            ><input v-model="regra.exigeLocal" type="checkbox" data-testid="ls-regra-local" />
            {{ t('enfermagem.sinaisDetalhe.limites.exigeLocal') }}</label
          >
          <label
            ><input v-model="regra.exigePosicao" type="checkbox" data-testid="ls-regra-posicao" />
            {{ t('enfermagem.sinaisDetalhe.limites.exigePosicao') }}</label
          >
          <label
            ><input v-model="regra.obrigatorio" type="checkbox" />
            {{ t('enfermagem.sinaisDetalhe.limites.obrigatorio') }}</label
          >
          <label>
            {{ t('enfermagem.sinaisDetalhe.limites.periodicidade') }}
            <input v-model="regra.periodo" inputmode="numeric" />
          </label>
        </div>
        <SanteBotao
          tipo="submit"
          :rotulo="t('enfermagem.sinaisDetalhe.limites.gravarRegra')"
          :desabilitado="ocupado || !regra.setor || !regra.parametro"
          data-testid="ls-gravar-regra"
        />
      </form>
    </template>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
