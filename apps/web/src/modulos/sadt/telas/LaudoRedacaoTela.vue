<script setup lang="ts">
// Redação do laudo de imagem e de métodos gráficos e laudo estruturado (F3.5, 05-SADT linhas 16 e 17). Numa tela só:
// o exame e o paciente, as medidas por seção com a faixa e a marca de fora da referência na hora, o modelo sugerido
// (o do médico primeiro) com os campos preenchidos pelas medidas, o texto, e "salvar e assinar" num clique. Depois de
// assinado, o texto só muda por retificação com motivo; o histórico de versões fica ao lado.
import { faixaDoPaciente, superficieCorporal } from '@sgh/dominio-sadt';
import { SanteBotao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  abrirLaudo,
  assinarLaudo,
  type CorpoLaudo,
  type LaudoEmRedacao,
  lerMotivosRetificacao,
  previaDoModelo,
  retificarLaudo,
  salvarLaudo,
} from '../api-laudo-redacao.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const M = {
  titulo: 'Laudo do exame',
  item: 'Exame (número do item)',
  abrir: 'Abrir',
  paciente: 'Paciente',
  idade: '{n} anos',
  medidas: 'Medidas',
  semSecao: 'Outras medidas',
  peso: 'Peso (kg)',
  altura: 'Altura (cm)',
  fora: 'fora da referência',
  obrigatoria: 'obrigatória',
  faixa: 'referência',
  modelo: 'Modelo',
  aplicar: 'Aplicar o modelo',
  faltam: 'Campos sem valor no modelo: {c}',
  texto: 'Texto do laudo',
  resultado: 'Resultado',
  resultados: { '': '—', normal: 'Normal', alterado: 'Alterado', inconclusivo: 'Inconclusivo' },
  critico: 'Achado crítico',
  criticoDescricao: 'Descrição do achado crítico',
  salvar: 'Salvar rascunho',
  revisao: 'Enviar para revisão',
  assinar: 'Salvar e assinar',
  motivo: 'Motivo da retificação',
  motivoTexto: 'Ou descreva o motivo',
  retificar: 'Retificar',
  versoes: 'Versões',
  situacao: {
    rascunho: 'Rascunho',
    aguardando_revisao: 'Aguardando revisão',
    assinado: 'Assinado',
    emitido: 'Emitido',
    retificado: 'Retificado',
    cancelado: 'Cancelado',
  } as Record<string, string>,
  gravado: 'Laudo {s} (versão {v}); {f} medida(s) fora da referência.',
};

const rota = useRoute();
const roteador = useRouter();
const itemTexto = ref(String(rota.query['item'] ?? ''));
const dados = ref<LaudoEmRedacao | null>(null);
const motivos = ref<{ id: number; descricao: string }[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const faltam = ref<string[]>([]);
const f = reactive({
  modelo: '' as string,
  titulo: '',
  texto: '',
  resultado: '' as '' | 'normal' | 'alterado' | 'inconclusivo',
  achadoCritico: false,
  achadoCriticoDescricao: '',
  peso: '',
  altura: '',
  medidas: {} as Record<number, string>,
  motivo: '',
  motivoTexto: '',
});

const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const valores = (): CorpoLaudo['valores'] =>
  Object.entries(f.medidas)
    .filter(([, v]) => (v ?? '').trim() !== '')
    .map(([g, v]) => {
      const x = numero(v);
      return Number.isFinite(x)
        ? { grandeza: Number(g), numero: x, texto: null }
        : { grandeza: Number(g), numero: null, texto: v.trim() };
    });
const corpo = (): CorpoLaudo => ({
  modelo: f.modelo ? Number(f.modelo) : null,
  titulo: f.titulo.trim() || null,
  texto: f.texto,
  resultado: f.resultado || null,
  achadoCritico: f.achadoCritico,
  achadoCriticoDescricao: f.achadoCritico ? f.achadoCriticoDescricao.trim() : null,
  pesoKg: numero(f.peso),
  alturaCm: numero(f.altura),
  valores: valores(),
});

// A marca de fora da referência na hora: a faixa sai de todas as faixas do exame pela mesma regra do domínio
// (faixaDoPaciente), com o sexo, a idade e a data do exame e o peso e a altura digitados; vale para a medida nova também.
const superficie = computed(() => superficieCorporal(numero(f.peso), numero(f.altura)));
function faixaDe(g: number) {
  const d = dados.value;
  if (!d) return null;
  const fx = faixaDoPaciente(d.faixas, g, {
    sexo: d.paciente.sexo,
    idadeDias: d.paciente.idadeDias,
    pesoKg: numero(f.peso),
    alturaCm: numero(f.altura),
    dataExame: d.paciente.dataExame,
  });
  return fx ? { minima: fx.minima, maxima: fx.maxima, indexada: fx.indexadaSuperficie } : null;
}
const faixaTexto = (g: number) => {
  const fx = faixaDe(g);
  return fx ? `${M.faixa} ${fx.minima ?? '…'}–${fx.maxima ?? '…'}${fx.indexada ? ' /m²' : ''}` : '';
};
function fora(g: number): boolean {
  const fx = faixaDe(g);
  const v = numero(f.medidas[g] ?? '');
  if (!fx || v === null || !Number.isFinite(v)) return false;
  const base = fx.indexada ? (superficie.value ? v / superficie.value : null) : v;
  return (
    base !== null && ((fx.minima !== null && base < fx.minima) || (fx.maxima !== null && base > fx.maxima))
  );
}
const grupos = computed(() => {
  const d = dados.value;
  if (!d) return [];
  const secoes = [
    ...d.secoes.map((s) => ({ id: s.id as number | null, nome: s.nome })),
    { id: null, nome: M.semSecao },
  ];
  return secoes
    .map((s) => ({ ...s, grandezas: d.grandezas.filter((g) => g.secao === s.id) }))
    .filter((s) => s.grandezas.length > 0);
});

async function carregar(): Promise<void> {
  erro.value = null;
  const item = Number(itemTexto.value);
  if (!Number.isInteger(item) || item <= 0) return;
  try {
    const d = await abrirLaudo(item);
    dados.value = d;
    f.modelo = d.laudo?.modelo ? String(d.laudo.modelo) : d.modelos[0] ? String(d.modelos[0].id) : '';
    f.titulo = d.laudo?.titulo ?? '';
    f.texto = d.laudo?.texto ?? '';
    f.resultado = (d.laudo?.resultado ?? '') as typeof f.resultado;
    f.achadoCritico = d.laudo?.achadoCritico ?? false;
    f.achadoCriticoDescricao = d.laudo?.achadoCriticoDescricao ?? '';
    f.peso = d.laudo?.pesoKg != null ? String(d.laudo.pesoKg) : '';
    f.altura = d.laudo?.alturaCm != null ? String(d.laudo.alturaCm) : '';
    f.medidas = Object.fromEntries(
      d.valores.map((v) => [v.grandeza, v.numero !== null ? String(v.numero) : (v.texto ?? '')]),
    );
    if (d.pode.retificar && motivos.value.length === 0) motivos.value = (await lerMotivosRetificacao()).itens;
    if (String(rota.query['item'] ?? '') !== String(item))
      await roteador.replace({ query: { ...rota.query, item: String(item) } });
  } catch (x) {
    erro.value = x;
  }
}
watch(
  () => rota.query['item'],
  (v) => {
    if (v && String(v) !== itemTexto.value) {
      itemTexto.value = String(v);
      void carregar();
    }
  },
);
if (itemTexto.value) void carregar();

async function executar(
  fn: () => Promise<{ situacao: string; versaoAtual: number; foraReferencia: number }>,
) {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await fn();
    mensagem.value = M.gravado
      .replace('{s}', (M.situacao[r.situacao] ?? r.situacao).toLowerCase())
      .replace('{v}', String(r.versaoAtual))
      .replace('{f}', String(r.foraReferencia));
    await carregar();
  } catch (x) {
    erro.value = x;
  }
}
const item = () => dados.value!.exame.item;
const salvar = (revisao: boolean) =>
  executar(() => salvarLaudo(item(), { ...corpo(), revisao }, novaChave('laudo.salvar')));
const assinar = () => executar(() => assinarLaudo(item(), corpo(), novaChave('laudo.assinar')));
const retificar = () =>
  executar(() =>
    retificarLaudo(
      item(),
      { ...corpo(), motivo: f.motivo ? Number(f.motivo) : null, motivoTexto: f.motivoTexto.trim() || null },
      novaChave('laudo.retificar'),
    ),
  );
async function aplicarModelo(): Promise<void> {
  if (!f.modelo || !dados.value) return;
  erro.value = null;
  try {
    const r = await previaDoModelo(
      item(),
      { modelo: Number(f.modelo), pesoKg: numero(f.peso), alturaCm: numero(f.altura), valores: valores() },
      novaChave('laudo.previa'),
    );
    f.texto = r.texto;
    faltam.value = r.faltam;
  } catch (x) {
    erro.value = x;
  }
}
const podeEditar = computed(() => !!dados.value && (dados.value.pode.salvar || dados.value.pode.retificar));
const motivoOk = computed(() => !!f.motivo || f.motivoTexto.trim().length >= 10);
</script>

<template>
  <section class="laudo" data-testid="laudo-redacao">
    <h1>{{ M.titulo }}</h1>
    <form class="linha" @submit.prevent="carregar">
      <label for="laudo-item">{{ M.item }}</label>
      <input id="laudo-item" v-model="itemTexto" inputmode="numeric" data-testid="laudo-item" />
      <SanteBotao type="submit" data-testid="laudo-abrir">{{ M.abrir }}</SanteBotao>
    </form>
    <ErroSadt v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="laudo-mensagem">{{ mensagem }}</p>
    <template v-if="dados">
      <p data-testid="laudo-cabecalho">
        {{ dados.exame.nome }} · {{ M.paciente }} {{ dados.paciente.id }}
        <span v-if="dados.paciente.idadeDias !== null"
          >· {{ M.idade.replace('{n}', String(Math.floor(dados.paciente.idadeDias / 365.25))) }}</span
        >
        · {{ M.situacao[dados.laudo?.situacao ?? 'rascunho'] }}
      </p>
      <div class="colunas">
        <div class="principal">
          <fieldset v-if="dados.grandezas.length" class="medidas">
            <legend>{{ M.medidas }}</legend>
            <div class="linha">
              <label
                >{{ M.peso }} <input v-model="f.peso" inputmode="decimal" data-testid="laudo-peso"
              /></label>
              <label
                >{{ M.altura }} <input v-model="f.altura" inputmode="decimal" data-testid="laudo-altura"
              /></label>
            </div>
            <div v-for="s in grupos" :key="String(s.id)">
              <h3>{{ s.nome }}</h3>
              <label v-for="g in s.grandezas" :key="g.id" class="medida" :class="{ fora: fora(g.id) }">
                <span
                  >{{ g.descricao }} ({{ g.sigla }})<em v-if="g.obrigatoria"> · {{ M.obrigatoria }}</em></span
                >
                <input
                  v-model="f.medidas[g.id]"
                  :disabled="!podeEditar"
                  :data-testid="`laudo-medida-${g.codigo}`"
                />
                <small v-if="faixaDe(g.id)">
                  {{ faixaTexto(g.id) }}
                </small>
                <strong v-if="fora(g.id)" :data-testid="`laudo-fora-${g.codigo}`">{{ M.fora }}</strong>
              </label>
            </div>
          </fieldset>
          <div class="linha">
            <label>
              {{ M.modelo }}
              <select v-model="f.modelo" data-testid="laudo-modelo">
                <option value="">—</option>
                <option v-for="m in dados.modelos" :key="m.id" :value="String(m.id)">{{ m.nome }}</option>
              </select>
            </label>
            <SanteBotao
              :disabled="!f.modelo || !podeEditar"
              data-testid="laudo-aplicar"
              @click="aplicarModelo"
              >{{ M.aplicar }}</SanteBotao
            >
          </div>
          <p v-if="faltam.length" role="note">{{ M.faltam.replace('{c}', faltam.join(', ')) }}</p>
          <label
            >{{ M.texto }}
            <textarea v-model="f.texto" rows="14" :disabled="!podeEditar" data-testid="laudo-texto" />
          </label>
          <div class="linha">
            <label>
              {{ M.resultado }}
              <select v-model="f.resultado" data-testid="laudo-resultado">
                <option v-for="(r, k) in M.resultados" :key="k" :value="k">{{ r }}</option>
              </select>
            </label>
            <label
              ><input v-model="f.achadoCritico" type="checkbox" data-testid="laudo-critico" />
              {{ M.critico }}</label
            >
            <input
              v-if="f.achadoCritico"
              v-model="f.achadoCriticoDescricao"
              :aria-label="M.criticoDescricao"
              maxlength="500"
            />
          </div>
          <div v-if="dados.pode.salvar" class="linha">
            <SanteBotao data-testid="laudo-salvar" @click="salvar(false)">{{ M.salvar }}</SanteBotao>
            <SanteBotao data-testid="laudo-revisao" @click="salvar(true)">{{ M.revisao }}</SanteBotao>
            <SanteBotao data-testid="laudo-assinar" @click="assinar">{{ M.assinar }}</SanteBotao>
          </div>
          <div v-if="dados.pode.retificar" class="linha">
            <label>
              {{ M.motivo }}
              <select v-model="f.motivo" data-testid="laudo-motivo">
                <option value="">—</option>
                <option v-for="m in motivos" :key="m.id" :value="String(m.id)">{{ m.descricao }}</option>
              </select>
            </label>
            <input
              v-model="f.motivoTexto"
              :aria-label="M.motivoTexto"
              :placeholder="M.motivoTexto"
              maxlength="500"
            />
            <SanteBotao :disabled="!motivoOk" data-testid="laudo-retificar" @click="retificar">{{
              M.retificar
            }}</SanteBotao>
          </div>
        </div>
        <aside class="versoes" data-testid="laudo-versoes">
          <h2>{{ M.versoes }}</h2>
          <ol reversed>
            <li v-for="v in dados.versoes" :key="v.numero">
              {{ v.numero }} · {{ M.situacao[v.situacao] ?? v.situacao }} ·
              {{ new Date(v.em).toLocaleString('pt-BR') }}
              <span v-if="v.motivo"> · {{ v.motivo }}</span>
            </li>
          </ol>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.laudo {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.colunas {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16rem;
  gap: 1rem;
}
.principal {
  display: grid;
  gap: 0.75rem;
}
.medida {
  display: grid;
  grid-template-columns: 1fr 8rem auto auto;
  gap: 0.5rem;
  align-items: center;
}
.medida.fora input {
  border-color: var(--sante-cor-alerta, #b45309);
}
textarea {
  width: 100%;
}
@media (max-width: 800px) {
  .colunas {
    grid-template-columns: 1fr;
  }
}
</style>
