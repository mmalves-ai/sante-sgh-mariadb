<script setup lang="ts">
// A meta do contrato SUS (faturamento.gravarMetaSus), nova ou alterada pela versão vista. Quantitativa: o código SIGTAP
// pelo nível (grupo, subgrupo, forma ou procedimento; achado na busca, ADR 0027), a produção que conta e a quantidade por
// competência. Qualitativa: o grupo do indicador, o formato, o sentido, a fonte da aferição e o valor do período. A
// periodicidade só mensal ou maior (D-PER-555). O corpo leva só os campos do tipo (corpoDaMeta).
import {
  AFERICOES_SUS,
  COMPLEXIDADES_SUS,
  FORMATOS_INDICADOR_SUS,
  type MetaSus,
  MODALIDADES_PRODUCAO_SUS,
  NIVEIS_SIGTAP_META,
  PERIODICIDADES_META_SUS,
  SENTIDOS_INDICADOR_SUS,
  TIPOS_INDICADOR_SUS,
  TIPOS_META_SUS,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarMetaSus, buscarSigtapMeta, criarMetaSus, novaChaveSus } from '../api-contratualizacao.js';
import {
  competenciaParaCampo,
  corpoDaMeta,
  digitosDoNivel,
  faltasDaMeta,
  type FormularioMetaSus,
} from './contratualizacao-tela.js';
import ErroFaturamento from './ErroFaturamento.vue';

const props = defineProps<{ contrato: number; meta?: MetaSus | null; pode: boolean; competencia: string }>();
const emit = defineEmits<{ gravado: [id: number, mensagem: string]; cancelar: [] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratualizacaoSus.meta.${s}`, p ?? {});
const m = props.meta ?? null;

const f = reactive<FormularioMetaSus>({
  tipo: m?.tipo ?? 'quantitativa',
  descricao: m?.descricao ?? '',
  periodicidade: m?.periodicidade ?? 5,
  inicio: competenciaParaCampo(m?.inicio ?? props.competencia),
  fim: competenciaParaCampo(m?.fim),
  pontos: String(m?.pontos ?? 10),
  nivelSigtap: m?.nivelSigtap ?? 'grupo',
  codigoSigtap: m?.codigoSigtap ?? '',
  modalidade: m?.modalidade ?? 'todas',
  complexidade: m?.complexidade ?? null,
  indicador: m?.indicador ?? null,
  formato: m?.formato ?? null,
  sentido: m?.sentido ?? 'maior',
  unidade: m?.unidade ?? '',
  afericao: m?.afericao ?? null,
  valorMeta: m ? String(m.valorMeta).replace('.', ',') : '',
  ativa: m?.ativa ?? true,
});
const opc = <T extends string | number>(xs: readonly { codigo: T; rotulo: string }[]) =>
  xs.map((x) => ({ valor: x.codigo as T, rotulo: x.rotulo }));
const tipos = opc(TIPOS_META_SUS);
const periodicidades = opc(PERIODICIDADES_META_SUS);
const niveis = NIVEIS_SIGTAP_META.map((x) => ({
  valor: x.codigo as string | null,
  rotulo: `${x.rotulo} (${x.digitos} dígitos)`,
}));
const modalidades = opc(MODALIDADES_PRODUCAO_SUS) as { valor: string | null; rotulo: string }[];
const complexidades = [
  { valor: null as number | null, rotulo: k('semComplexidade') },
  ...opc(COMPLEXIDADES_SUS).map((x) => ({ valor: x.valor as number | null, rotulo: x.rotulo })),
];
const indicadores = [
  { valor: null as number | null, rotulo: k('escolha') },
  ...opc(TIPOS_INDICADOR_SUS).map((x) => ({ valor: x.valor as number | null, rotulo: x.rotulo })),
];
const formatos = [
  { valor: null as number | null, rotulo: k('escolha') },
  ...opc(FORMATOS_INDICADOR_SUS).map((x) => ({ valor: x.valor as number | null, rotulo: x.rotulo })),
];
const sentidos = opc(SENTIDOS_INDICADOR_SUS) as { valor: string | null; rotulo: string }[];
const afericoes = [
  { valor: null as number | null, rotulo: k('semAfericao') },
  ...opc(AFERICOES_SUS).map((x) => ({ valor: x.valor as number | null, rotulo: x.rotulo })),
];

// A busca SIGTAP: o achado preenche o código cortado no nível escolhido.
const termo = ref('');
const achados = ref<{ codigo: string; nome: string }[] | null>(null);
const erroBusca = ref(false);
const escolhido = ref<string | null>(null);
async function procurar(): Promise<void> {
  erroBusca.value = false;
  try {
    achados.value = (await buscarSigtapMeta(termo.value.trim())).itens;
  } catch {
    erroBusca.value = true;
  }
}
const opcoesSigtap = computed(() =>
  (achados.value ?? []).map((x) => ({ valor: x.codigo as string | null, rotulo: `${x.codigo} · ${x.nome}` })),
);
function usarSigtap(v: string | null): void {
  escolhido.value = v;
  const d = digitosDoNivel(f.nivelSigtap);
  if (v && d) f.codigoSigtap = v.slice(0, d);
}

const NOMES: Record<string, string> = {
  descricao: 'descricao',
  inicio: 'inicio',
  fim: 'fim',
  pontos: 'pontos',
  valorMeta: 'valorMetaQuanti',
  nivelSigtap: 'nivelSigtap',
  codigoSigtap: 'codigoSigtap',
  indicador: 'indicador',
  formato: 'formato',
};
const faltam = computed(() => faltasDaMeta(f).map((c) => k(NOMES[c] ?? c)));
const erro = ref<unknown>(null);
const enviando = ref(false);
let chave = novaChaveSus(m ? 'meta-alterar' : 'meta');

async function gravar(): Promise<void> {
  if (faltam.value.length || !props.pode) return;
  erro.value = null;
  enviando.value = true;
  try {
    const corpo = corpoDaMeta(f, m?.versao ?? null);
    const r = m ? await alterarMetaSus(m.id, corpo, chave) : await criarMetaSus(props.contrato, corpo, chave);
    chave = novaChaveSus(m ? 'meta-alterar' : 'meta');
    emit('gravado', r.id, r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <form class="formulario-sus" data-testid="ms-formulario" @submit.prevent="gravar">
    <h3>{{ m ? k('tituloAlterar') : k('tituloNova') }}</h3>
    <div class="barra">
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="k('tipo')"
        :opcoes="tipos"
        :desabilitado="!!m"
        data-testid="ms-tipo"
      />
      <span class="campo campo-largo">
        <label for="ms-descricao">{{ k('descricao') }}</label>
        <input id="ms-descricao" v-model="f.descricao" maxlength="200" required data-testid="ms-descricao" />
      </span>
    </div>
    <div class="barra">
      <SanteSelecao
        v-model="f.periodicidade"
        :rotulo="k('periodicidade')"
        :opcoes="periodicidades"
        data-testid="ms-periodicidade"
      />
      <span class="campo">
        <label for="ms-inicio">{{ k('inicio') }}</label>
        <input id="ms-inicio" v-model="f.inicio" type="month" required data-testid="ms-inicio" />
      </span>
      <span class="campo">
        <label for="ms-fim">{{ k('fim') }}</label>
        <input id="ms-fim" v-model="f.fim" type="month" data-testid="ms-fim" />
      </span>
      <span class="campo">
        <label for="ms-pontos">{{ k('pontos') }}</label>
        <input
          id="ms-pontos"
          v-model="f.pontos"
          type="number"
          min="1"
          max="1000"
          step="1"
          data-testid="ms-pontos"
        />
      </span>
    </div>

    <template v-if="f.tipo === 'quantitativa'">
      <div class="barra">
        <SanteSelecao
          v-model="f.nivelSigtap"
          :rotulo="k('nivelSigtap')"
          :opcoes="niveis"
          data-testid="ms-nivel"
        />
        <span class="campo">
          <label for="ms-sigtap">{{ k('codigoSigtap') }}</label>
          <input
            id="ms-sigtap"
            v-model="f.codigoSigtap"
            inputmode="numeric"
            maxlength="10"
            data-testid="ms-sigtap"
          />
        </span>
        <SanteSelecao
          v-model="f.modalidade"
          :rotulo="k('modalidade')"
          :opcoes="modalidades"
          data-testid="ms-modalidade"
        />
        <SanteSelecao
          v-model="f.complexidade"
          :rotulo="k('complexidade')"
          :opcoes="complexidades"
          data-testid="ms-complexidade"
        />
      </div>
      <div class="barra">
        <span class="campo">
          <label for="ms-termo">{{ k('termoSigtap') }}</label>
          <input
            id="ms-termo"
            v-model="termo"
            type="search"
            maxlength="60"
            data-testid="ms-termo"
            @keyup.enter.prevent="procurar"
          />
        </span>
        <SanteBotao
          variante="secundario"
          :rotulo="k('buscarSigtap')"
          :desabilitado="termo.trim().length < 2"
          data-testid="ms-buscar"
          @acionar="procurar"
        />
        <SanteSelecao
          v-if="achados && achados.length"
          :model-value="escolhido"
          :rotulo="k('sigtapEscolhido')"
          :opcoes="opcoesSigtap"
          :busca="true"
          data-testid="ms-sigtap-achado"
          @update:model-value="usarSigtap"
        />
        <p v-if="(achados && !achados.length) || erroBusca" role="status">{{ k('sigtapNenhum') }}</p>
      </div>
      <p class="secundario">{{ k('sigtapUsar') }}</p>
    </template>

    <template v-else>
      <div class="barra">
        <SanteSelecao
          v-model="f.indicador"
          :rotulo="k('indicador')"
          :opcoes="indicadores"
          data-testid="ms-indicador"
        />
        <SanteSelecao
          v-model="f.formato"
          :rotulo="k('formato')"
          :opcoes="formatos"
          data-testid="ms-formato"
        />
        <SanteSelecao
          v-model="f.sentido"
          :rotulo="k('sentido')"
          :opcoes="sentidos"
          :desabilitado="f.formato === 2"
          data-testid="ms-sentido"
        />
        <span class="campo">
          <label for="ms-unidade">{{ k('unidade') }}</label>
          <input id="ms-unidade" v-model="f.unidade" maxlength="20" data-testid="ms-unidade" />
        </span>
        <SanteSelecao
          v-model="f.afericao"
          :rotulo="k('afericao')"
          :opcoes="afericoes"
          data-testid="ms-afericao"
        />
      </div>
      <p v-if="f.formato === 2" class="secundario">{{ k('valorSimNao') }}</p>
    </template>

    <div class="barra">
      <span class="campo">
        <label for="ms-valor">{{
          f.tipo === 'quantitativa' ? k('valorMetaQuanti') : k('valorMetaQuali')
        }}</label>
        <input
          id="ms-valor"
          v-model="f.valorMeta"
          inputmode="decimal"
          maxlength="14"
          data-testid="ms-valor"
        />
      </span>
      <span class="campo">
        <input id="ms-ativa" v-model="f.ativa" type="checkbox" data-testid="ms-ativa" />
        <label for="ms-ativa">{{ k('ativa') }}</label>
      </span>
    </div>

    <SanteAlerta
      v-if="faltam.length"
      variante="aviso"
      :texto="k('faltam', { campos: faltam.join(', ') })"
      data-testid="ms-faltam"
    />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <div class="barra">
      <SanteBotao
        tipo="submit"
        :rotulo="enviando ? k('gravando') : k('gravar')"
        :desabilitado="!pode || enviando || faltam.length > 0"
        data-testid="ms-gravar"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="k('cancelar')"
        data-testid="ms-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>
