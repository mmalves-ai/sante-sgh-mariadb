<script setup lang="ts">
// O cadastro do contrato com o gestor do SUS (faturamento.gravarContratoSus) e a alteração pela versão vista: número,
// esfera, gestor, objeto, vigência, CNES, habilitação, rede de atenção, o orçamento pré e pós-fixado, a parte ligada às
// metas qualitativas e os incentivos (trocados inteiros pela versão, D-INC-555). A tela confere o que dá antes de enviar;
// o servidor confere tudo de novo (o mesmo Zod de @sgh/contratos).
import { type ContratoSus, ESFERAS_CONTRATO_SUS, REDES_ASSISTENCIA_SUS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarContratoSus,
  criarContratoSus,
  type ItemDominioSusTela,
  novaChaveSus,
} from '../api-contratualizacao.js';
import { centavosDe, textoDeCentavos } from './contratualizacao-tela.js';
import ErroFaturamento from './ErroFaturamento.vue';

const props = defineProps<{
  contrato?: ContratoSus | null;
  pode: boolean;
  incentivosDominio: readonly ItemDominioSusTela[];
  cnesSugerido: string | null;
}>();
const emit = defineEmits<{ gravado: [id: number, mensagem: string]; cancelar: [] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratualizacaoSus.formulario.${s}`, p ?? {});
const c = props.contrato ?? null;
const alterando = !!c;

interface LinhaIncentivo {
  incentivo: number | null;
  nome: string;
  valor: string;
  inicio: string;
  fim: string;
}
const f = reactive({
  numero: c?.numero ?? '',
  esfera: (c?.esfera ?? 3) as number,
  gestor: c?.gestor ?? '',
  objeto: c?.objeto ?? '',
  inicio: c?.inicio ?? '',
  fim: c?.fim ?? '',
  cnes: c?.cnes ?? props.cnesSugerido ?? '',
  habilitacao: c?.habilitacao ?? '',
  habilitacaoValidade: c?.habilitacaoValidade ?? '',
  redeAssistencia: (c?.redeAssistencia ?? 0) as number,
  pre: textoDeCentavos(c?.valorPreMensalCentavos),
  pos: textoDeCentavos(c?.valorPosMensalCentavos),
  parteQualitativaPct: String(c?.parteQualitativaPct ?? 40),
  observacao: c?.observacao ?? '',
  incentivos: (c?.incentivos ?? []).map((x): LinhaIncentivo => ({
    incentivo: x.incentivo,
    nome: x.nome,
    valor: textoDeCentavos(x.valorMensalCentavos),
    inicio: x.inicio,
    fim: x.fim ?? '',
  })),
});
const esferas = ESFERAS_CONTRATO_SUS.map((x) => ({ valor: x.codigo as number, rotulo: x.rotulo }));
const redes = REDES_ASSISTENCIA_SUS.map((x) => ({ valor: x.codigo as number, rotulo: x.rotulo }));
const opcoesIncentivo = computed(() => [
  { valor: null as number | null, rotulo: k('incentivoAvulso') },
  ...props.incentivosDominio.map((x) => ({ valor: x.codigo as number | null, rotulo: x.rotulo })),
]);
function escolherIncentivo(linha: LinhaIncentivo, v: number | null): void {
  linha.incentivo = v;
  const d = props.incentivosDominio.find((x) => x.codigo === v);
  if (d && !linha.nome.trim()) linha.nome = d.rotulo;
}
function adicionarIncentivo(): void {
  f.incentivos.push({ incentivo: null, nome: '', valor: '', inicio: f.inicio, fim: '' });
}

const faltam = computed(() => {
  const xs: string[] = [];
  if (!f.numero.trim()) xs.push(k('numero'));
  if (f.gestor.trim().length < 3) xs.push(k('gestor'));
  if (f.objeto.trim().length < 5) xs.push(k('objeto'));
  if (!f.inicio) xs.push(k('inicio'));
  if (!f.fim) xs.push(k('fim'));
  if (f.cnes && !/^\d{7}$/.test(f.cnes.trim())) xs.push(k('cnes'));
  if (f.pre && centavosDe(f.pre) === null) xs.push(k('pre'));
  if (f.pos && centavosDe(f.pos) === null) xs.push(k('pos'));
  const pct = Number(f.parteQualitativaPct);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) xs.push(k('parteQualitativa'));
  f.incentivos.forEach((x, i) => {
    if (x.nome.trim().length < 3 || !(centavosDe(x.valor) ?? 0) || !x.inicio)
      xs.push(`${k('incentivos')} ${i + 1}`);
  });
  return xs;
});
const conflito = computed(() => {
  if (f.inicio && f.fim && f.fim < f.inicio) return k('fimAntes');
  if (!(centavosDe(f.pre) ?? 0) && !(centavosDe(f.pos) ?? 0)) return k('semOrcamento');
  return null;
});
const erro = ref<unknown>(null);
const enviando = ref(false);
let chave = novaChaveSus(alterando ? 'alterar' : 'contrato');

async function gravar(): Promise<void> {
  if (faltam.value.length || conflito.value || !props.pode) return;
  erro.value = null;
  enviando.value = true;
  const corpo = {
    numero: f.numero.trim(),
    esfera: f.esfera,
    gestor: f.gestor.trim(),
    objeto: f.objeto.trim(),
    inicio: f.inicio,
    fim: f.fim,
    cnes: f.cnes.trim() || null,
    habilitacao: f.habilitacao.trim() || null,
    habilitacaoValidade: f.habilitacaoValidade || null,
    redeAssistencia: f.redeAssistencia,
    valorPreMensalCentavos: centavosDe(f.pre) ?? 0,
    valorPosMensalCentavos: centavosDe(f.pos) ?? 0,
    parteQualitativaPct: Number(f.parteQualitativaPct),
    incentivos: f.incentivos.map((x) => ({
      incentivo: x.incentivo,
      nome: x.nome.trim(),
      valorMensalCentavos: centavosDe(x.valor) ?? 0,
      inicio: x.inicio,
      fim: x.fim || null,
    })),
    observacao: f.observacao.trim() || null,
    versaoVista: c?.versao ?? null,
  };
  try {
    const r = c ? await alterarContratoSus(c.id, corpo, chave) : await criarContratoSus(corpo, chave);
    chave = novaChaveSus(alterando ? 'alterar' : 'contrato');
    emit('gravado', r.id, r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <form class="formulario-sus" data-testid="cs-formulario" @submit.prevent="gravar">
    <h2>{{ alterando ? k('tituloAlterar') : k('tituloNovo') }}</h2>
    <p v-if="alterando" class="secundario">{{ k('explicaAlterar') }}</p>
    <div class="barra">
      <span class="campo">
        <label for="cs-numero">{{ k('numero') }}</label>
        <input id="cs-numero" v-model="f.numero" maxlength="30" required data-testid="cs-numero" />
      </span>
      <SanteSelecao v-model="f.esfera" :rotulo="k('esfera')" :opcoes="esferas" data-testid="cs-esfera" />
      <span class="campo campo-largo">
        <label for="cs-gestor">{{ k('gestor') }}</label>
        <input id="cs-gestor" v-model="f.gestor" maxlength="120" required data-testid="cs-gestor" />
      </span>
    </div>
    <span class="campo campo-largo">
      <label for="cs-objeto">{{ k('objeto') }}</label>
      <textarea id="cs-objeto" v-model="f.objeto" maxlength="500" rows="3" required data-testid="cs-objeto" />
    </span>
    <div class="barra">
      <span class="campo">
        <label for="cs-inicio">{{ k('inicio') }}</label>
        <input id="cs-inicio" v-model="f.inicio" type="date" required data-testid="cs-inicio" />
      </span>
      <span class="campo">
        <label for="cs-fim">{{ k('fim') }}</label>
        <input id="cs-fim" v-model="f.fim" type="date" required data-testid="cs-fim" />
      </span>
      <span class="campo">
        <label for="cs-cnes">{{ k('cnes') }}</label>
        <input
          id="cs-cnes"
          v-model="f.cnes"
          inputmode="numeric"
          maxlength="7"
          aria-describedby="cs-cnes-dica"
          data-testid="cs-cnes"
        />
        <span v-if="cnesSugerido" id="cs-cnes-dica" class="secundario">
          {{ k('cnesSugerido', { cnes: cnesSugerido }) }}
        </span>
      </span>
    </div>
    <div class="barra">
      <span class="campo campo-largo">
        <label for="cs-habilitacao">{{ k('habilitacao') }}</label>
        <input id="cs-habilitacao" v-model="f.habilitacao" maxlength="200" data-testid="cs-habilitacao" />
      </span>
      <span class="campo">
        <label for="cs-hab-validade">{{ k('habilitacaoValidade') }}</label>
        <input
          id="cs-hab-validade"
          v-model="f.habilitacaoValidade"
          type="date"
          data-testid="cs-hab-validade"
        />
      </span>
      <SanteSelecao v-model="f.redeAssistencia" :rotulo="k('rede')" :opcoes="redes" data-testid="cs-rede" />
    </div>
    <div class="barra">
      <span class="campo">
        <label for="cs-pre">{{ k('pre') }}</label>
        <input id="cs-pre" v-model="f.pre" inputmode="decimal" maxlength="18" data-testid="cs-pre" />
      </span>
      <span class="campo">
        <label for="cs-pos">{{ k('pos') }}</label>
        <input id="cs-pos" v-model="f.pos" inputmode="decimal" maxlength="18" data-testid="cs-pos" />
      </span>
      <span class="campo">
        <label for="cs-parte">{{ k('parteQualitativa') }}</label>
        <input
          id="cs-parte"
          v-model="f.parteQualitativaPct"
          type="number"
          min="0"
          max="100"
          step="1"
          data-testid="cs-parte"
        />
      </span>
    </div>

    <fieldset class="incentivos-sus" data-testid="cs-incentivos">
      <legend>{{ k('incentivos') }}</legend>
      <div v-for="(x, i) in f.incentivos" :key="i" class="barra" :data-testid="`cs-incentivo-${i}`">
        <SanteSelecao
          :model-value="x.incentivo"
          :rotulo="k('incentivoDominio')"
          :opcoes="opcoesIncentivo"
          :busca="true"
          :data-testid="`cs-incentivo-${i}-dominio`"
          @update:model-value="(v: number | null) => escolherIncentivo(x, v)"
        />
        <span class="campo">
          <label :for="`cs-inc-nome-${i}`">{{ k('incentivoNome') }}</label>
          <input
            :id="`cs-inc-nome-${i}`"
            v-model="x.nome"
            maxlength="120"
            :data-testid="`cs-incentivo-${i}-nome`"
          />
        </span>
        <span class="campo">
          <label :for="`cs-inc-valor-${i}`">{{ k('incentivoValor') }}</label>
          <input
            :id="`cs-inc-valor-${i}`"
            v-model="x.valor"
            inputmode="decimal"
            maxlength="18"
            :data-testid="`cs-incentivo-${i}-valor`"
          />
        </span>
        <span class="campo">
          <label :for="`cs-inc-inicio-${i}`">{{ k('incentivoInicio') }}</label>
          <input :id="`cs-inc-inicio-${i}`" v-model="x.inicio" type="date" />
        </span>
        <span class="campo">
          <label :for="`cs-inc-fim-${i}`">{{ k('incentivoFim') }}</label>
          <input :id="`cs-inc-fim-${i}`" v-model="x.fim" type="date" />
        </span>
        <SanteBotao
          variante="texto"
          :rotulo="k('incentivoRemover', { n: i + 1 })"
          :data-testid="`cs-incentivo-${i}-remover`"
          @acionar="f.incentivos.splice(i, 1)"
        />
      </div>
      <SanteBotao
        variante="secundario"
        :rotulo="k('incentivoAdicionar')"
        :desabilitado="f.incentivos.length >= 30"
        data-testid="cs-incentivo-adicionar"
        @acionar="adicionarIncentivo"
      />
    </fieldset>

    <span class="campo campo-largo">
      <label for="cs-observacao">{{ k('observacao') }}</label>
      <textarea id="cs-observacao" v-model="f.observacao" maxlength="500" rows="2" />
    </span>

    <SanteAlerta
      v-if="faltam.length"
      variante="aviso"
      :texto="k('faltam', { campos: faltam.join(', ') })"
      data-testid="cs-faltam"
    />
    <SanteAlerta v-else-if="conflito" variante="aviso" :texto="conflito" data-testid="cs-conflito" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <div class="barra">
      <SanteBotao
        tipo="submit"
        :rotulo="enviando ? k('gravando') : k('gravar')"
        :desabilitado="!pode || enviando || faltam.length > 0 || !!conflito"
        data-testid="cs-gravar"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="k('cancelar')"
        data-testid="cs-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>
