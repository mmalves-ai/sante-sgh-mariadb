<script setup lang="ts">
// A sessão e o julgamento (M55, etapa 4; Lei 14.133, arts. 56 a 63): as propostas por item com o último lance e a nota
// técnica, a desclassificação e a inabilitação com o motivo (e a volta a válida), o registro de proposta
// (suprimentos.registrarPropostaLicitacao, com o licitante achado na busca), a classificação de cada item (a prévia na
// sessão; o resultado gravado depois) com o aviso de inexequível, e o julgamento com o desempate do art. 60 escolhido
// por item empatado e justificado. Só na sessão e por quem conduz; o servidor confere tudo de novo.
import {
  esquemaRegistrarPropostaLicitacao,
  esquemaSituacaoPropostaLicitacao,
  type PropostaLicitacao,
  type SituacaoProposta,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  avancarLicitacaoTela,
  buscarFornecedoresLicitacao,
  type DetalheLicitacaoTela,
  novaChaveLicitacao,
  registrarPropostaLicitacaoTela,
  situacaoPropostaLicitacaoTela,
} from '../api-licitacao.js';
import { reais } from '../usar-suprimentos.js';
import BuscaCodigoNome from './BuscaCodigoNome.vue';
import ErroSuprimentos from './ErroSuprimentos.vue';
import {
  comNotaTecnica,
  empatesDoJulgamento,
  lerNumero,
  nomeFornecedor,
  porDesconto,
  rotuloResultadoItem,
  rotuloSituacaoProposta,
} from './licitacao-tela.js';
import { usarEnvioLicitacao } from './usar-envio-licitacao.js';

const props = defineProps<{ d: DetalheLicitacaoTela; pode: boolean }>();
const emit = defineEmits<{ gravado: [mensagem: string] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.sessao.${s}`, p ?? {});
const { erro, enviando, executar } = usarEnvioLicitacao((m) => emit('gravado', m));
const naSessao = computed(() => props.d.etapa === 'sessao');
const desconto = computed(() => porDesconto(props.d.criterio));
const nota = computed(() => comNotaTecnica(props.d.criterio));
const lances = computed(() => props.d.modalidade.startsWith('pregao') || props.d.modalidade === 'leilao');
const valorTexto = (n: number) =>
  desconto.value
    ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const numeroDoItem = (id: number) => props.d.itensDetalhe.find((i) => i.id === id)?.numero ?? id;
const descricaoDoItem = (id: number) => props.d.itensDetalhe.find((i) => i.id === id)?.descricao ?? '';

// ── Registrar proposta ──────────────────────────────────────────────────────────────────────────────────────

const itens = computed(() =>
  props.d.itensDetalhe.map((i) => ({ valor: i.id as number | null, rotulo: `${i.numero} · ${i.descricao}` })),
);
const f = reactive({
  item: (props.d.itensDetalhe[0]?.id ?? null) as number | null,
  fornecedor: null as number | null,
  valor: '',
  lance: '',
  nota: '',
  marca: '',
});
const buscarFornecedor = (termo: string) => buscarFornecedoresLicitacao(termo);
const corpoProposta = computed(() => ({
  versao: props.d.versao,
  item: f.item,
  fornecedor: f.fornecedor,
  valor: lerNumero(f.valor),
  lance: lances.value ? lerNumero(f.lance) : null,
  notaTecnica: nota.value ? lerNumero(f.nota) : null,
  marca: f.marca.trim() || null,
}));
const problemasProposta = computed(() => {
  const r = esquemaRegistrarPropostaLicitacao.safeParse({ chave: 'previa.da.tela', ...corpoProposta.value });
  const xs = r.success ? [] : r.error.issues.map((x) => x.message);
  if (nota.value && corpoProposta.value.notaTecnica === null) xs.push(k('nota'));
  return [...new Set(xs)];
});
const tentou = ref(false);
let chave = novaChaveLicitacao('proposta');
async function registrar(): Promise<void> {
  tentou.value = true;
  if (problemasProposta.value.length || !props.pode) return;
  const ok = await executar(() => registrarPropostaLicitacaoTela(props.d.id, corpoProposta.value, chave));
  if (ok) {
    chave = novaChaveLicitacao('proposta');
    tentou.value = false;
    Object.assign(f, { fornecedor: null, valor: '', lance: '', nota: '', marca: '' });
  }
}

// ── Situação da proposta ────────────────────────────────────────────────────────────────────────────────────

const mudando = reactive({
  proposta: null as number | null,
  situacao: 'valida' as SituacaoProposta,
  motivo: '',
});
function abrirSituacao(x: PropostaLicitacao, s: SituacaoProposta): void {
  Object.assign(mudando, { proposta: x.id, situacao: s, motivo: '' });
}
const problemasSituacao = computed(() => {
  const r = esquemaSituacaoPropostaLicitacao.safeParse({
    versao: props.d.versao,
    situacao: mudando.situacao,
    motivo: mudando.motivo.trim() || null,
  });
  return r.success ? [] : [...new Set(r.error.issues.map((x) => x.message))];
});
async function confirmarSituacao(): Promise<void> {
  if (mudando.proposta === null || problemasSituacao.value.length || !props.pode) return;
  const id = mudando.proposta;
  const ok = await executar(() =>
    situacaoPropostaLicitacaoTela(props.d.id, id, {
      versao: props.d.versao,
      situacao: mudando.situacao,
      motivo: mudando.motivo.trim() || null,
    }),
  );
  if (ok) mudando.proposta = null;
}

// ── Julgamento e desempate ──────────────────────────────────────────────────────────────────────────────────

const j = computed(() => props.d.julgamento);
const empates = computed(() => empatesDoJulgamento(j.value));
const escolhas = reactive<Record<number, number | null>>({});
const justificativaDesempate = ref('');
const opcoesEmpate = (fornecedores: number[]) => [
  { valor: null as number | null, rotulo: '—' },
  ...fornecedores.map((x) => ({ valor: x as number | null, rotulo: nomeFornecedor(props.d.propostas, x) })),
];
const acaoJulgar = computed(() => props.d.acoes.find((a) => a.acao === 'julgado') ?? null);
const faltaDesempate = computed(
  () =>
    empates.value.some((e) => !escolhas[e.item]) ||
    (empates.value.length > 0 && justificativaDesempate.value.trim().length < 20),
);
let chaveJulgar = novaChaveLicitacao('julgado');
async function julgar(): Promise<void> {
  if (!props.pode || !acaoJulgar.value?.pode || faltaDesempate.value) return;
  const ok = await executar(() =>
    avancarLicitacaoTela(
      props.d.id,
      {
        versao: props.d.versao,
        para: 'julgado',
        desempates: empates.value.map((e) => ({ item: e.item, fornecedor: escolhas[e.item] as number })),
        justificativaDesempate: empates.value.length ? justificativaDesempate.value.trim() : null,
      },
      chaveJulgar,
    ),
  );
  if (ok) chaveJulgar = novaChaveLicitacao('julgado');
}
</script>

<template>
  <section class="sessao-licitacao" data-testid="lic-sessao">
    <h3>{{ k('propostas') }}</h3>
    <p v-if="d.propostas.length === 0" class="secundario">{{ k('nenhuma') }}</p>
    <div v-else class="rolagem">
      <table class="grade" data-testid="lic-propostas">
        <thead>
          <tr>
            <th scope="col">{{ k('colItem') }}</th>
            <th scope="col">{{ k('colFornecedor') }}</th>
            <th scope="col">{{ desconto ? k('colDesconto') : k('colValor') }}</th>
            <th v-if="lances" scope="col">{{ k('colLance') }}</th>
            <th v-if="nota" scope="col">{{ k('colNota') }}</th>
            <th scope="col">{{ k('colMarca') }}</th>
            <th scope="col">{{ k('colSituacao') }}</th>
            <th v-if="naSessao" scope="col">{{ k('colAcoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in d.propostas" :key="x.id" :data-testid="`lic-proposta-${x.id}`">
            <td>{{ numeroDoItem(x.item) }}</td>
            <td>{{ x.fornecedor }} · {{ x.fornecedorNome }}</td>
            <td>{{ valorTexto(x.valor) }}</td>
            <td v-if="lances">{{ x.lance === null ? '—' : valorTexto(x.lance) }}</td>
            <td v-if="nota">{{ x.notaTecnica ?? '—' }}</td>
            <td>{{ x.marca ?? '—' }}</td>
            <td :data-testid="`lic-proposta-situacao-${x.id}`">
              {{ rotuloSituacaoProposta(x.situacao)
              }}<span v-if="x.motivo" class="secundario"> · {{ x.motivo }}</span>
            </td>
            <td v-if="naSessao">
              <SanteBotao
                v-if="x.situacao === 'valida'"
                variante="texto"
                :rotulo="k('desclassificar')"
                :desabilitado="!pode"
                :data-testid="`lic-desclassificar-${x.id}`"
                @acionar="abrirSituacao(x, 'desclassificada')"
              />
              <SanteBotao
                v-if="x.situacao === 'valida'"
                variante="texto"
                :rotulo="k('inabilitar')"
                :desabilitado="!pode"
                :data-testid="`lic-inabilitar-${x.id}`"
                @acionar="abrirSituacao(x, 'inabilitada')"
              />
              <SanteBotao
                v-if="x.situacao !== 'valida'"
                variante="texto"
                :rotulo="k('revalidar')"
                :desabilitado="!pode"
                :data-testid="`lic-revalidar-${x.id}`"
                @acionar="abrirSituacao(x, 'valida')"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form
      v-if="mudando.proposta !== null"
      class="formulario-licitacao"
      data-testid="lic-situacao-form"
      @submit.prevent="confirmarSituacao"
    >
      <p>
        <strong>{{ rotuloSituacaoProposta(mudando.situacao) }}</strong>
      </p>
      <span v-if="mudando.situacao !== 'valida'" class="campo campo-largo">
        <label for="lic-situacao-motivo">{{ k('motivo') }}</label>
        <input
          id="lic-situacao-motivo"
          v-model="mudando.motivo"
          maxlength="400"
          data-testid="lic-situacao-motivo"
        />
      </span>
      <div class="barra">
        <SanteBotao
          tipo="submit"
          :rotulo="k('confirmar')"
          :desabilitado="!pode || enviando || problemasSituacao.length > 0"
          data-testid="lic-situacao-confirmar"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="k('cancelar')"
          data-testid="lic-situacao-cancelar"
          @acionar="mudando.proposta = null"
        />
      </div>
    </form>

    <form
      v-if="naSessao"
      class="formulario-licitacao"
      :aria-label="k('registrar')"
      data-testid="lic-proposta-form"
      @submit.prevent="registrar"
    >
      <h3>{{ k('registrar') }}</h3>
      <div class="barra">
        <SanteSelecao v-model="f.item" :rotulo="k('item')" :opcoes="itens" data-testid="lic-proposta-item" />
        <span class="campo">
          <label for="lic-proposta-valor">{{ desconto ? k('desconto') : k('valor') }}</label>
          <input
            id="lic-proposta-valor"
            v-model="f.valor"
            inputmode="decimal"
            size="12"
            data-testid="lic-proposta-valor"
          />
        </span>
        <span v-if="lances" class="campo">
          <label for="lic-proposta-lance">{{ k('lance') }}</label>
          <input
            id="lic-proposta-lance"
            v-model="f.lance"
            inputmode="decimal"
            size="12"
            data-testid="lic-proposta-lance"
          />
        </span>
        <span v-if="nota" class="campo">
          <label for="lic-proposta-nota">{{ k('nota') }}</label>
          <input
            id="lic-proposta-nota"
            v-model="f.nota"
            inputmode="decimal"
            size="6"
            data-testid="lic-proposta-nota"
          />
        </span>
        <span class="campo">
          <label for="lic-proposta-marca">{{ k('marca') }}</label>
          <input id="lic-proposta-marca" v-model="f.marca" maxlength="100" data-testid="lic-proposta-marca" />
        </span>
      </div>
      <BuscaCodigoNome
        v-model="f.fornecedor"
        :rotulo="k('fornecedor')"
        :rotulo-buscar="t('licitacao.pesquisa.buscarFornecedor')"
        :rotulo-escolhido="t('licitacao.pesquisa.fornecedorEscolhido')"
        :rotulo-nenhum="t('licitacao.pesquisa.fornecedorNenhum')"
        :buscar="buscarFornecedor"
        testid="lic-proposta-fornecedor"
      />
      <SanteAlerta
        v-if="tentou && problemasProposta.length"
        variante="aviso"
        :texto="problemasProposta.join('; ')"
        data-testid="lic-proposta-faltam"
      />
      <SanteBotao
        tipo="submit"
        :rotulo="k('registrar')"
        :desabilitado="!pode || enviando"
        data-testid="lic-proposta-registrar"
      />
    </form>
    <p v-else class="secundario">{{ k('soNaSessao') }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />

    <h3>{{ k('julgamento') }}</h3>
    <p v-if="!j" class="secundario">{{ k('semJulgamento') }}</p>
    <template v-else>
      <p class="secundario">{{ naSessao ? k('previa') : k('gravado') }}</p>
      <div v-for="x in j.itens" :key="x.item" :data-testid="`lic-julg-item-${numeroDoItem(x.item)}`">
        <h4>
          {{ numeroDoItem(x.item) }} · {{ descricaoDoItem(x.item) }}: {{ rotuloResultadoItem(x.resultado) }}
        </h4>
        <p v-if="x.vencedor !== null && x.valorUnitario !== null">
          {{
            k('vencedor', {
              fornecedor: nomeFornecedor(d.propostas, x.vencedor),
              valor: valorTexto(x.valorUnitario),
              total: x.valorTotal === null ? '—' : reais(x.valorTotal),
            })
          }}
        </p>
        <div v-if="x.classificacao.length" class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ k('colPosicao') }}</th>
                <th scope="col">{{ k('colFornecedor') }}</th>
                <th scope="col">{{ k('colFinal') }}</th>
                <th v-if="nota" scope="col">{{ k('colPontuacao') }}</th>
                <th scope="col">{{ k('colSituacao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in x.classificacao" :key="c.proposta">
                <td>{{ c.posicao ?? '—' }}</td>
                <td>{{ nomeFornecedor(d.propostas, c.fornecedor) }}</td>
                <td>{{ valorTexto(c.valorFinal) }}</td>
                <td v-if="nota">{{ c.pontuacao ?? '—' }}</td>
                <td>
                  {{ rotuloSituacaoProposta(c.situacao) }}
                  <span v-if="c.avisoInexequivel" class="alerta">· {{ k('inexequivel') }}</span>
                  <span v-if="c.motivo" class="secundario">· {{ c.motivo }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p data-testid="lic-julg-conta">
        <strong>{{ k('totalJulgado') }}:</strong> {{ j.conta }}
      </p>

      <form
        v-if="naSessao"
        class="formulario-licitacao"
        data-testid="lic-julgar-form"
        @submit.prevent="julgar"
      >
        <fieldset v-if="empates.length" data-testid="lic-desempate">
          <legend>{{ k('desempate') }}</legend>
          <SanteSelecao
            v-for="e in empates"
            :key="e.item"
            :model-value="escolhas[e.item] ?? null"
            :rotulo="k('desempateItem', { n: numeroDoItem(e.item) })"
            :opcoes="opcoesEmpate(e.fornecedores)"
            :data-testid="`lic-desempate-${numeroDoItem(e.item)}`"
            @update:model-value="(v: unknown) => (escolhas[e.item] = (v as number | null) ?? null)"
          />
          <span class="campo campo-largo">
            <label for="lic-desempate-just">{{ k('justificativaDesempate') }}</label>
            <input
              id="lic-desempate-just"
              v-model="justificativaDesempate"
              maxlength="1000"
              data-testid="lic-desempate-just"
            />
          </span>
        </fieldset>
        <SanteAlerta
          v-if="acaoJulgar?.motivo"
          :variante="acaoJulgar.pode ? 'info' : 'aviso'"
          :texto="acaoJulgar.motivo"
          data-testid="lic-julgar-motivo"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="k('julgar')"
          :desabilitado="!pode || enviando || !acaoJulgar?.pode || faltaDesempate"
          data-testid="lic-julgar"
        />
      </form>
    </template>
  </section>
</template>
