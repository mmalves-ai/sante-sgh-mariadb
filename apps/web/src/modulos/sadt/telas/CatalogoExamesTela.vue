<script setup lang="ts">
// Catálogo de exames do diagnóstico (F3.5, análise 05-SADT linhas 1 a 3): `/sadt/catalogo`. Uma ficha por exame numa
// tela só, sem abrir janela por vínculo: à esquerda a busca; à direita o exame (inclui e altera com a versão vista), onde
// é feito, o material, o preparo, a lateralidade, os exames ligados e os analitos com a faixa de referência (todas as
// versões, a vigente em destaque) e a fórmula. A validação do domínio volta por campo (422) e aparece na hora; nada se
// apaga: "inativar" deixa o histórico, e a faixa e a fórmula ganham nova versão com a data de início.
import { SanteBotao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { z } from 'zod';
import { enviar, ler } from '../../exames/api-exames.js';
import { novaChave } from '../api-sadt.js';

type Linha = Record<string, unknown>;
const B = '/api/sadt/catalogo';
const qualquer = z.any();
const TIPOS = ['laboratorio', 'imagem', 'metodo_grafico', 'anatomia_patologica', 'hemoterapia', 'outro'];

/** Os textos da tela (a extração para o i18n do módulo fica com o integrador). */
const TXT: readonly string[] = [
  'Nome, código ou sigla',
  'Buscar exame',
  'Tipo de serviço',
  'CT - HDL',
  'CT=analito:12; HDL=digitado',
  'Catálogo de exames',
  'Todos',
  'Buscar',
  'Novo exame',
  'Código',
  'Sigla',
  'Nome',
  'Tipo',
  'Modalidade (id)',
  'Idade mínima (dias)',
  'Idade máxima (dias)',
  'Prazo (h)',
  'Exige laudo',
  'Ativo',
  'Gravar exame',
  '(padrão)',
  'Inativar',
  'Faixas e fórmula',
  'Início',
  'Fim',
  'Sexo',
  'Idade (dias)',
  'Referência',
  'Crítico',
  'Sexo (id)',
  'Ref. mín.',
  'Ref. máx.',
  'Crítico mín.',
  'Crítico máx.',
  'Texto',
  'Nova versão da faixa',
  'Descrição',
  'Expressão',
  'Variáveis',
  'Nova versão da fórmula',
  'Incluir',
];
const termo = ref('');
const tipo = ref('');
const lista = ref<Linha[]>([]);
const ficha = ref<Linha | null>(null);
const erro = ref('');
const aviso = ref('');
const exame = reactive<Linha>({});
const novo = reactive<Record<string, Linha>>({
  setor: { setorDiagnosticoId: null, padrao: true },
  material: { materialBiologicoId: null, padrao: true, conservacao: 'ambiente' },
  preparo: { orientacaoPreparoId: null, publico: 'todos' },
  lateralidade: { lado: 'direito', multiplicadorCobranca: 1 },
  ligado: { secundarioExameId: null, tipoRelacao: 'secundario' },
  analito: { analitoId: null, ordem: 1 },
});
const faixa = reactive<Linha>({ condicao: 'nenhuma', vigenciaInicio: new Date().toISOString().slice(0, 10) });
const formula = reactive<Linha>({
  descricao: '',
  expressao: '',
  vigenciaInicio: new Date().toISOString().slice(0, 10),
  variaveis: '',
});
const analitoAberto = ref<number | null>(null);

const numOuNulo = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

async function tentar(fn: () => Promise<unknown>, ok: string) {
  erro.value = '';
  aviso.value = '';
  try {
    await fn();
    aviso.value = ok;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}

async function buscar() {
  const q = new URLSearchParams({ termo: termo.value, ...(tipo.value ? { tipo: tipo.value } : {}) });
  lista.value = (await ler(`${B}/exames?${q}`, qualquer)) as Linha[];
}

async function abrir(id: number) {
  ficha.value = (await ler(`${B}/exames/${id}`, qualquer)) as Linha;
  Object.assign(exame, ficha.value['exame'] as Linha);
}

function novoExame() {
  ficha.value = null;
  for (const k of Object.keys(exame)) delete exame[k];
  Object.assign(exame, { codigo: '', sigla: '', nome: '', tipoServico: 'laboratorio', ativo: true });
}

const corpoExame = computed(() => ({
  versao: exame['id'] ? Number(exame['versao']) : undefined,
  codigo: String(exame['codigo'] ?? ''),
  sigla: String(exame['sigla'] ?? ''),
  nome: String(exame['nome'] ?? ''),
  tipoServico: String(exame['tipoServico'] ?? ''),
  modalidadeImagemId: numOuNulo(exame['modalidadeImagemId']),
  idadeMinimaDias: numOuNulo(exame['idadeMinimaDias']),
  idadeMaximaDias: numOuNulo(exame['idadeMaximaDias']),
  prazoEntregaHoras: numOuNulo(exame['prazoEntregaHoras']),
  orientacaoGeral: (exame['orientacaoGeral'] as string) || null,
  exigeLaudo: Boolean(exame['exigeLaudo']),
  ativo: Boolean(exame['ativo']),
}));

const salvarExame = () =>
  tentar(async () => {
    const id = exame['id'] ? Number(exame['id']) : null;
    const r = (await enviar(
      id ? `${B}/exames/${id}` : `${B}/exames`,
      corpoExame.value,
      qualquer,
      novaChave('catalogo.exame'),
    )) as Linha;
    await abrir(Number(r['id']));
    await buscar();
  }, 'Exame gravado.');

function corpoVinculo(t: string, v: Linha): Linha {
  const r: Linha = {};
  for (const [k, x] of Object.entries(v)) r[k] = /Id$|ordem|multiplicador/.test(k) ? numOuNulo(x) : x;
  return r;
}

const salvarVinculo = (t: string, v: Linha) =>
  tentar(async () => {
    await enviar(
      `${B}/exames/${Number(exame['id'])}/${t}`,
      corpoVinculo(t, v),
      qualquer,
      novaChave(`catalogo.${t}`),
    );
    await abrir(Number(exame['id']));
  }, 'Vínculo gravado.');

const inativar = (t: string, v: Linha) => salvarVinculo(t, { ...v, ativo: false });

const novaFaixa = (eaId: number) =>
  tentar(async () => {
    const c: Linha = {};
    for (const [k, x] of Object.entries(faixa))
      c[k] = ['condicao', 'vigenciaInicio', 'referenciaTexto'].includes(k) ? x || null : numOuNulo(x);
    c['condicao'] = faixa['condicao'] || 'nenhuma';
    await enviar(`${B}/analitos-exame/${eaId}/faixas`, c, qualquer, novaChave('catalogo.faixa'));
    await abrir(Number(exame['id']));
  }, 'Nova versão da faixa gravada; a anterior se encerra na véspera.');

/** Variáveis no formato "CT=analito:12; HDL=digitado; P=paciente:peso". */
function variaveis(txt: string) {
  return txt
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, resto = 'digitado'] = s.split('=').map((x) => x.trim());
      const [fonte, ref] = resto.split(':');
      return {
        identificador: id,
        descricao: id,
        fonte: fonte === 'paciente' ? 'dado_paciente' : fonte,
        analitoId: fonte === 'analito' ? Number(ref) : null,
        dadoPaciente: fonte === 'paciente' ? ref : null,
      };
    });
}

const novaFormula = (eaId: number) =>
  tentar(async () => {
    await enviar(
      `${B}/analitos-exame/${eaId}/formulas`,
      {
        ...formula,
        casasDecimais: numOuNulo(formula['casasDecimais']),
        variaveis: variaveis(String(formula['variaveis'] ?? '')),
      },
      qualquer,
      novaChave('catalogo.formula'),
    );
    await abrir(Number(exame['id']));
  }, 'Nova versão da fórmula gravada.');

const SECOES: { t: string; titulo: string; chave: string; campos: [string, string][] }[] = [
  {
    t: 'setor',
    titulo: 'Onde é feito (setor executante)',
    chave: 'setores',
    campos: [
      ['setorDiagnosticoId', 'Setor (id)'],
      ['prazoEntregaHoras', 'Prazo (h)'],
    ],
  },
  {
    t: 'material',
    titulo: 'Material e recipiente',
    chave: 'materiais',
    campos: [
      ['materialBiologicoId', 'Material (id)'],
      ['recipienteColetaId', 'Recipiente (id)'],
      ['conservacao', 'Conservação'],
    ],
  },
  {
    t: 'preparo',
    titulo: 'Preparo do paciente',
    chave: 'preparos',
    campos: [
      ['orientacaoPreparoId', 'Orientação (id)'],
      ['publico', 'Público'],
    ],
  },
  {
    t: 'lateralidade',
    titulo: 'Lateralidade',
    chave: 'lateralidades',
    campos: [
      ['lado', 'Lado'],
      ['multiplicadorCobranca', 'Multiplicador'],
    ],
  },
  {
    t: 'ligado',
    titulo: 'Exames ligados',
    chave: 'ligados',
    campos: [
      ['secundarioExameId', 'Exame (id)'],
      ['tipoRelacao', 'Relação'],
    ],
  },
  {
    t: 'analito',
    titulo: 'Analitos do exame',
    chave: 'analitos',
    campos: [
      ['analitoId', 'Analito (id)'],
      ['ordem', 'Ordem'],
    ],
  },
];
const rotulo = (v: Linha) =>
  String(
    v['nomeSetor'] ??
      v['nomeMaterial'] ??
      v['descricaoPreparo'] ??
      v['nomeLigado'] ??
      v['nomeAnalito'] ??
      v['lado'] ??
      v['id'],
  );
</script>

<template>
  <section class="catalogo" data-testid="catalogo-exames">
    <h1>{{ TXT[5] }}</h1>
    <div class="grade">
      <aside>
        <form @submit.prevent="buscar">
          <input v-model="termo" :placeholder="TXT[0]" :aria-label="TXT[1]" />
          <select v-model="tipo" :aria-label="TXT[2]">
            <option value="">{{ TXT[6] }}</option>
            <option v-for="x in TIPOS" :key="x" :value="x">{{ x }}</option>
          </select>
          <SanteBotao type="submit">{{ TXT[7] }}</SanteBotao>
          <SanteBotao type="button" @click="novoExame">{{ TXT[8] }}</SanteBotao>
        </form>
        <ul>
          <li v-for="e in lista" :key="String(e['id'])">
            <button type="button" :class="{ inativo: !e['ativo'] }" @click="abrir(Number(e['id']))">
              {{ e['sigla'] }} · {{ e['nome'] }}
            </button>
          </li>
        </ul>
      </aside>
      <main v-if="exame['codigo'] !== undefined">
        <p v-if="erro" role="alert" class="erro">{{ erro }}</p>
        <p v-if="aviso" role="status">{{ aviso }}</p>
        <form class="exame" @submit.prevent="salvarExame">
          <label>{{ TXT[9] }} <input v-model="exame['codigo']" required maxlength="30" /></label>
          <label>{{ TXT[10] }} <input v-model="exame['sigla']" required maxlength="10" /></label>
          <label>{{ TXT[11] }} <input v-model="exame['nome']" required maxlength="150" /></label>
          <label
            >{{ TXT[12] }}
            <select v-model="exame['tipoServico']">
              <option v-for="x in TIPOS" :key="x" :value="x">{{ x }}</option>
            </select>
          </label>
          <label v-if="exame['tipoServico'] === 'imagem'"
            >{{ TXT[13] }} <input v-model="exame['modalidadeImagemId']" required
          /></label>
          <label>{{ TXT[14] }} <input v-model="exame['idadeMinimaDias']" type="number" min="0" /></label>
          <label>{{ TXT[15] }} <input v-model="exame['idadeMaximaDias']" type="number" min="0" /></label>
          <label>{{ TXT[16] }} <input v-model="exame['prazoEntregaHoras']" type="number" min="0" /></label>
          <label><input v-model="exame['exigeLaudo']" type="checkbox" /> {{ TXT[17] }}</label>
          <label><input v-model="exame['ativo']" type="checkbox" /> {{ TXT[18] }}</label>
          <SanteBotao type="submit" data-testid="salvar-exame">{{ TXT[19] }}</SanteBotao>
        </form>
        <template v-if="ficha">
          <section v-for="s in SECOES" :key="s.t" :data-testid="`secao-${s.t}`">
            <h2>{{ s.titulo }}</h2>
            <ul>
              <li
                v-for="v in ficha[s.chave] as Linha[]"
                :key="String(v['id'])"
                :class="{ inativo: !v['ativo'] }"
              >
                {{ rotulo(v) }}<span v-if="v['padrao']"> {{ TXT[20] }}</span>
                <SanteBotao
                  v-if="v['ativo']"
                  type="button"
                  @click="inativar(s.t, { ...v, id: v['id'], versao: v['versao'] })"
                  >{{ TXT[21] }}</SanteBotao
                >
                <template v-if="s.t === 'analito'">
                  <SanteBotao
                    type="button"
                    @click="analitoAberto = analitoAberto === Number(v['id']) ? null : Number(v['id'])"
                    >{{ TXT[22] }}</SanteBotao
                  >
                  <div v-if="analitoAberto === Number(v['id'])" class="analito">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ TXT[23] }}</th>
                          <th>{{ TXT[24] }}</th>
                          <th>{{ TXT[25] }}</th>
                          <th>{{ TXT[26] }}</th>
                          <th>{{ TXT[27] }}</th>
                          <th>{{ TXT[28] }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="f in v['faixas'] as Linha[]"
                          :key="String(f['id'])"
                          :class="{ vigente: !f['vigenciaFim'] }"
                        >
                          <td>{{ f['vigenciaInicio'] }}</td>
                          <td>{{ f['vigenciaFim'] ?? 'em vigor' }}</td>
                          <td>{{ f['sexoId'] ?? 'todos' }}</td>
                          <td>{{ f['idadeMinimaDias'] ?? 0 }}{{ '–' }}{{ f['idadeMaximaDias'] ?? '∞' }}</td>
                          <td>
                            {{
                              f['referenciaTexto'] ??
                              `${f['referenciaMinima'] ?? ''} a ${f['referenciaMaxima'] ?? ''}`
                            }}
                          </td>
                          <td>{{ f['criticoMinimo'] ?? '' }} / {{ f['criticoMaximo'] ?? '' }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <form @submit.prevent="novaFaixa(Number(v['id']))">
                      <label
                        >{{ TXT[23] }} <input v-model="faixa['vigenciaInicio']" type="date" required
                      /></label>
                      <label>{{ TXT[29] }} <input v-model="faixa['sexoId']" /></label>
                      <label
                        >{{ TXT[30] }} <input v-model="faixa['referenciaMinima']" type="number" step="any"
                      /></label>
                      <label
                        >{{ TXT[31] }} <input v-model="faixa['referenciaMaxima']" type="number" step="any"
                      /></label>
                      <label
                        >{{ TXT[32] }} <input v-model="faixa['criticoMinimo']" type="number" step="any"
                      /></label>
                      <label
                        >{{ TXT[33] }} <input v-model="faixa['criticoMaximo']" type="number" step="any"
                      /></label>
                      <label
                        >{{ TXT[34] }} <input v-model="faixa['referenciaTexto']" maxlength="300"
                      /></label>
                      <SanteBotao type="submit">{{ TXT[35] }}</SanteBotao>
                    </form>
                    <p v-for="fo in v['formulas'] as Linha[]" :key="String(fo['id'])">
                      {{ fo['vigenciaInicio'] }}: {{ fo['expressao'] }}
                      {{ fo['vigenciaFim'] ? `(até ${fo['vigenciaFim']})` : '(em vigor)' }}
                    </p>
                    <form @submit.prevent="novaFormula(Number(v['id']))">
                      <label>{{ TXT[36] }} <input v-model="formula['descricao']" required /></label>
                      <label
                        >{{ TXT[37] }} <input v-model="formula['expressao']" required :placeholder="TXT[3]"
                      /></label>
                      <label
                        >{{ TXT[38] }} <input v-model="formula['variaveis']" :placeholder="TXT[4]"
                      /></label>
                      <label
                        >{{ TXT[23] }} <input v-model="formula['vigenciaInicio']" type="date" required
                      /></label>
                      <SanteBotao type="submit">{{ TXT[39] }}</SanteBotao>
                    </form>
                  </div>
                </template>
              </li>
            </ul>
            <form class="novo" @submit.prevent="salvarVinculo(s.t, novo[s.t] as Linha)">
              <label v-for="[k, r] in s.campos" :key="k"
                >{{ r }} <input v-model="(novo[s.t] as Linha)[k]"
              /></label>
              <SanteBotao type="submit">{{ TXT[40] }}</SanteBotao>
            </form>
          </section>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.grade {
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) 3fr;
  gap: 1rem;
}
.inativo {
  opacity: 0.55;
  text-decoration: line-through;
}
.vigente {
  font-weight: 600;
}
.erro {
  color: var(--sante-perigo, #b00020);
}
form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin: 0.5rem 0;
}
</style>
